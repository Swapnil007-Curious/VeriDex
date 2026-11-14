// @vitest-environment happy-dom
// Voice: the text a speech voice reads (code, tables and citations announced or dropped), the
// sentence queue (one utterance at a time, stoppable at once), voice choice, the sentence finder
// behind the reading highlight, and the controller with the Web Speech APIs mocked: listening,
// auto-send after a pause, push-to-talk, hands-free timing out, errors and a browser without speech.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speechTuning } from "../../src/ui/prefs.ts";
import { cleanForSpeech, speechSentences } from "../../src/voice/speech-text.ts";
import { recognitionCtor, voiceSupport, VoiceInput } from "../../src/voice/stt.ts";
import { englishVoices, preferredVoice, SpeechQueue } from "../../src/voice/tts.ts";
import { findSentence, textIndex, Voice, VOICE_ERRORS, type VoiceHooks, type VoiceUi } from "../../src/voice/voice.ts";

describe("cleanForSpeech", () => {
  it("drops citation markers, keeps link text, skips URLs and reads symbols as words", () => {
    const md = "Refunds are due within 30 days [C1] [C2, C3].\nSee [the Act](https://example.org/act) or www.example.org for more.\nPrice → refund ≈ 2 × cost.";
    const out = cleanForSpeech(md);
    expect(out).not.toMatch(/\[C\d/);
    expect(out).not.toMatch(/https?:|www\./);
    expect(out).toContain("See the Act or for more.");
    expect(out).toContain("Price to refund about 2 times cost.");
  });

  it("announces code blocks, tables and display formulas instead of reading them", () => {
    const md = ["Here is the code:", "```python", "print('hi')", "x = 1", "```", "", "| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |", "", "$$", "E = mc^2", "$$", "Done"].join("\n");
    const out = cleanForSpeech(md).split("\n");
    expect(out).toEqual(["Here is the code:", "A code block is shown on screen.", "A table with 2 rows is shown on screen.", "A formula is shown on screen.", "Done."]);
    expect(cleanForSpeech(md)).not.toContain("print");
  });

  it("ends a line that stops on a comma with a full stop; a one-line $$ formula is announced", () => {
    expect(cleanForSpeech("The tide comes in on silver feet,\nthe lamps go dim;")).toBe("The tide comes in on silver feet.\nthe lamps go dim;");
    expect(cleanForSpeech("$$E = mc^2$$\nAfter.")).toBe("A formula is shown on screen.\nAfter.");
  });

  it("strips Markdown emphasis, headings, list markers and inline code", () => {
    expect(cleanForSpeech("## Key points\n- **Bold** and *italic* with `code`\n1. Second")).toBe("Key points.\nBold and italic with code.\nSecond.");
  });
});

describe("speechSentences", () => {
  it("splits into sentences and never returns one longer than the limit", () => {
    const long = `${"word ".repeat(120).trim()}.`;
    const out = speechSentences(`First one. Second one!\n${long}`, 100);
    expect(out.slice(0, 2)).toEqual(["First one.", "Second one!"]);
    expect(out.length).toBeGreaterThan(3);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(100);
    expect(out.join(" ").replace(/\s+/g, " ")).toContain("word word");
  });
});

// ------------------------------------------------------------------ speech synthesis mock

class FakeUtterance {
  rate = 1;
  pitch = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((e: { name: string; charIndex: number }) => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth() {
  const spoken: FakeUtterance[] = [];
  let current: FakeUtterance | null = null;
  const synth = {
    cancelled: 0,
    speak(u: FakeUtterance) {
      spoken.push(u);
      current = u;
      u.onstart?.();
    },
    cancel() {
      synth.cancelled += 1;
      current = null;
    },
    getVoices: () => [] as SpeechSynthesisVoice[],
    addEventListener() {},
  };
  const finish = (): void => {
    const u = current;
    current = null;
    u?.onend?.();
  };
  return { synth, spoken, finish, boundary: (i: number) => current?.onboundary?.({ name: "word", charIndex: i }) };
}

describe("SpeechQueue", () => {
  it("reads sentences one utterance at a time and reports each sentence and the end", () => {
    const { synth, spoken, finish } = fakeSynth();
    const q = new SpeechQueue(synth as unknown as SpeechSynthesis, FakeUtterance as unknown as new (t: string) => SpeechSynthesisUtterance);
    const seen: number[] = [];
    const end = vi.fn();
    q.speak(["One.", "Two.", "Three."], { rate: 1.1, pitch: 0.9, onSentence: (i) => seen.push(i), onEnd: end });
    expect(spoken.map((u) => u.text)).toEqual(["One."]);
    expect(spoken[0]?.rate).toBe(1.1);
    expect(spoken[0]?.lang).toBe("en-IN");
    finish();
    finish();
    expect(spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Three."]);
    finish();
    expect(seen).toEqual([0, 1, 2]);
    expect(end).toHaveBeenCalledWith(true);
    expect(q.speaking).toBe(false);
  });

  it("stop() cancels at once, reports an unfinished end and ignores late events", () => {
    const { synth, spoken, finish } = fakeSynth();
    const q = new SpeechQueue(synth as unknown as SpeechSynthesis, FakeUtterance as unknown as new (t: string) => SpeechSynthesisUtterance);
    const end = vi.fn();
    q.speak(["One.", "Two."], { rate: 1, pitch: 1, onEnd: end });
    const first = spoken[0] as FakeUtterance;
    q.stop();
    expect(synth.cancelled).toBe(1);
    expect(end).toHaveBeenCalledWith(false);
    first.onend?.(); // a late end from the cancelled utterance
    finish();
    expect(spoken).toHaveLength(1);
    expect(end).toHaveBeenCalledTimes(1);
    q.stop(); // stopping twice is harmless
    expect(synth.cancelled).toBe(1);
  });
});

describe("voices", () => {
  const v = (name: string, lang: string) => ({ name, lang, voiceURI: name }) as SpeechSynthesisVoice;
  it("keeps English voices and prefers a natural Indian, then British voice", () => {
    const all = [v("Hindi", "hi-IN"), v("US", "en-US"), v("UK", "en-GB"), v("Google UK English Female", "en-GB"), v("Microsoft Heera", "en-IN")];
    const english = englishVoices({ getVoices: () => all });
    expect(english.map((x) => x.name)).not.toContain("Hindi");
    expect(preferredVoice(english)?.name).toBe("Google UK English Female");
    expect(preferredVoice([...english, v("Microsoft Neerja Online (Natural)", "en-IN")])?.name).toBe("Microsoft Neerja Online (Natural)");
    expect(preferredVoice([v("US", "en-US")])?.name).toBe("US");
    expect(preferredVoice([])).toBeNull();
  });

  it("the robot filter raises pitch and rate, within the Web Speech limits", () => {
    expect(speechTuning({})).toEqual({ rate: 1, pitch: 1 });
    const robot = speechTuning({ robot: true, rate: 1.2, pitch: 1.4 });
    expect(robot.rate).toBeCloseTo(1.26);
    expect(robot.pitch).toBeCloseTo(1.61);
    expect(speechTuning({ robot: true, rate: 9, pitch: 9 })).toEqual({ rate: 2, pitch: 2 });
  });
});

describe("the reading highlight", () => {
  it("finds each spoken sentence in the answer's text, in order", () => {
    const text = "here is a short poem. the tide comes in on silver feet, the harbour lamps go dim. why it works: short lines. ";
    const a = findSentence(text, "Here is a short poem.", 0);
    expect(a && text.slice(a[0], a[1])).toBe("here is a short poem");
    const b = findSentence(text, "The tide comes in on silver feet, the harbour lamps go dim.", a?.[1] ?? 0);
    expect(b && text.slice(b[0], b[1])).toBe("the tide comes in on silver feet, the harbour lamps go dim");
    expect(findSentence(text, "Not in the answer at all.", 0)).toBeNull();
    expect(findSentence(text, "...", 0)).toBeNull();
  });

  it("indexes the answer's DOM text, skipping code, citation chips and buttons", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Refunds are <strong>due</strong> soon<button class='cite'>C1</button>.</p><pre>code here</pre><p>Next  line.</p>";
    const ix = textIndex(root);
    expect(ix.text).toBe("refunds are due soon . next line. ");
    expect(ix.text).not.toContain("c1");
    expect(ix.at).toHaveLength(ix.text.length);
    const found = findSentence(ix.text, "Refunds are due soon.", 0);
    expect(found).not.toBeNull();
    expect(ix.at[found?.[0] ?? 0]?.node.data).toBe("Refunds are ");
  });
});

// ------------------------------------------------------------------ the controller, APIs mocked

interface FakeRec {
  lang: string;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  started: number;
  stopped: number;
}

function speechWindow(opts: { input: boolean; output: boolean }) {
  const recs: FakeRec[] = [];
  class Recognition {
    lang = "";
    interimResults = false;
    continuous = false;
    maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = 0;
    stopped = 0;
    constructor() {
      recs.push(this);
    }
    start() {
      this.started += 1;
    }
    stop() {
      this.stopped += 1;
    }
    abort() {}
  }
  const synth = fakeSynth();
  const listeners: Record<string, (() => void)[]> = {};
  const win = {
    ...(opts.input ? { webkitSpeechRecognition: Recognition } : {}),
    ...(opts.output ? { speechSynthesis: synth.synth, SpeechSynthesisUtterance: FakeUtterance } : {}),
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
  } as unknown as Window;
  // like the real recognizer: the result list grows; resultIndex is the first result that changed
  const finals = new Map<FakeRec, string[]>();
  const say = (final: string, interim = ""): void => {
    const rec = recs[recs.length - 1];
    if (!rec) return;
    const done = finals.get(rec) ?? [];
    finals.set(rec, done);
    const resultIndex = done.length;
    if (final) done.push(final);
    const results: unknown[] = done.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
    if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
    rec.onresult?.({ resultIndex, results });
  };
  return { win, recs, say, synth, fire: (type: string) => listeners[type]?.forEach((f) => f()) };
}

function setup(opts: { input?: boolean; output?: boolean; autoSend?: boolean } = {}) {
  const env = speechWindow({ input: opts.input ?? true, output: opts.output ?? true });
  document.body.innerHTML = `<div id="wrap"><textarea id="box"></textarea><div id="ov" hidden><span id="f"></span><span id="i"></span></div><span id="meter" hidden></span></div>
    <button id="mic"></button><button id="hf"></button><span id="chip" hidden></span>`;
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const ui: VoiceUi = {
    composer: $("box") as HTMLTextAreaElement,
    wrap: $("wrap"),
    overlay: $("ov"),
    finalEl: $("f"),
    interimEl: $("i"),
    meter: $("meter"),
    micBtn: $("mic") as HTMLButtonElement,
    hfBtn: $("hf") as HTMLButtonElement,
    hfChip: $("chip"),
  };
  const sent: string[] = [];
  const events: string[] = [];
  const hooks: VoiceHooks = {
    settings: () => ({ autoSend: opts.autoSend ?? true, rate: 1, pitch: 1, highlight: false }),
    send: (text) => {
      sent.push(text);
      return true;
    },
    autosize: () => undefined,
    dex: (e) => events.push(e.type),
    dexWord: () => events.push("word"),
    error: (text) => events.push(`error:${text}`),
    announce: () => undefined,
    onSpeaking: (id) => events.push(`speaking:${id}`),
    onListening: (on) => events.push(`listening:${on}`),
  };
  const voice = new Voice(ui, hooks, env.win);
  return { env, ui, voice, sent, events };
}

describe("Voice controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // the meter asks for the microphone; in tests there is none, so it animates a stand-in
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.reject(new Error("no microphone")) }, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a browser without speech: nothing to listen with or read with, and nothing breaks", () => {
    const { voice, ui, events } = setup({ input: false, output: false });
    expect(voice.input).toBe(false);
    expect(voice.output).toBe(false);
    voice.listen();
    voice.speak("m1", "Hello there.");
    expect(voice.listening).toBe(false);
    expect(ui.overlay.hidden).toBe(true);
    expect(events).toEqual([]);
    expect(voiceSupport({} as Window)).toEqual({ input: false, output: false });
    expect(recognitionCtor({} as Window)).toBeNull();
  });

  it("listening fills the composer (settled words and the live guess) and sends after a 1.2 s pause", () => {
    const { voice, env, ui, sent, events } = setup();
    voice.listen();
    expect(env.recs[0]?.lang).toBe("en-IN");
    expect(ui.overlay.hidden).toBe(false);
    expect(ui.micBtn.getAttribute("aria-pressed")).toBe("true");
    expect(ui.interimEl.textContent).toBe("Listening… speak now");
    expect(events).toContain("listen-start");
    env.say("What is a tort", " in law");
    expect(ui.finalEl.textContent).toBe("What is a tort");
    expect(ui.interimEl.textContent).toBe("in law");
    expect(ui.composer.value).toBe("What is a tort in law");
    vi.advanceTimersByTime(1100);
    expect(sent).toEqual([]);
    env.say("in law?");
    expect(ui.composer.value).toBe("What is a tort in law?");
    vi.advanceTimersByTime(1199);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["What is a tort in law?"]);
    expect(voice.listening).toBe(false);
    expect(ui.overlay.hidden).toBe(true);
    expect(ui.composer.value).toBe("");
    expect(events).toContain("listen-end");
  });

  it("with auto-send off the words stay in the composer; push-to-talk sends on release", () => {
    const off = setup({ autoSend: false });
    off.voice.listen();
    off.env.say("Explain photosynthesis");
    vi.advanceTimersByTime(5000);
    expect(off.sent).toEqual([]);
    off.voice.stopListening(false);
    expect(off.ui.composer.value).toBe("Explain photosynthesis");

    const push = setup();
    push.voice.listen("push");
    expect(push.ui.interimEl.textContent).toBe("Listening… release Space to send");
    push.env.say("Define entropy");
    vi.advanceTimersByTime(5000);
    expect(push.sent).toEqual([]);
    push.voice.stopListening(true);
    expect(push.sent).toEqual(["Define entropy"]);
  });

  it("a blocked microphone explains itself and ends listening; en-IN falls back to en-US", () => {
    const { voice, env, events, ui } = setup();
    voice.listen();
    env.recs[0]?.onerror?.({ error: "language-not-supported" });
    expect(env.recs[1]?.lang).toBe("en-US");
    expect(voice.listening).toBe(true);
    env.recs[1]?.onerror?.({ error: "not-allowed" });
    expect(voice.listening).toBe(false);
    expect(ui.overlay.hidden).toBe(true);
    expect(events).toContain(`error:${VOICE_ERRORS["not-allowed"]}`);
  });

  it("hands-free keeps listening through recognizer restarts and ends after 20 s of silence", () => {
    const { voice, env, ui, events } = setup();
    voice.setHandsFree(true);
    expect(ui.hfChip.hidden).toBe(false);
    expect(voice.listening).toBe(true);
    env.recs[0]?.onend?.(); // the service stopped on its own: hands-free starts it again
    expect(env.recs).toHaveLength(2);
    expect(env.recs[1]?.started).toBe(1);
    expect(voice.listening).toBe(true);
    vi.advanceTimersByTime(19_999);
    expect(voice.handsFree).toBe(true);
    vi.advanceTimersByTime(1);
    expect(voice.handsFree).toBe(false);
    expect(voice.listening).toBe(false);
    expect(ui.hfChip.hidden).toBe(true);
    expect(events).toContain("error");
  });

  it("reads an answer sentence by sentence; Stop, a new listen or stopAll end the reading", () => {
    const { voice, env, events } = setup();
    voice.speak("m1", "First sentence. Second sentence [C1].");
    expect(voice.speakingId).toBe("m1");
    expect(env.synth.spoken.map((u) => u.text)).toEqual(["First sentence."]);
    env.synth.boundary(3);
    expect(events).toContain("speak-start");
    expect(events).toContain("word");
    env.synth.finish();
    expect(env.synth.spoken.map((u) => u.text)).toEqual(["First sentence.", "Second sentence."]);
    voice.stopSpeaking();
    expect(voice.speakingId).toBeNull();
    expect(events.filter((e) => e === "speaking:null")).toHaveLength(1);
    voice.speak("m2", "Again.");
    voice.listen();
    expect(voice.speakingId).toBeNull();
    expect(voice.stopAll()).toBe(true);
    expect(voice.stopAll()).toBe(false);
    voice.speak("m3", "Leaving.");
    env.fire("pagehide");
    expect(voice.speakingId).toBeNull();
  });

  it("VoiceInput keeps text across a restart and ignores no-speech", () => {
    const env = speechWindow({ input: true, output: false });
    const texts: string[] = [];
    const errors: string[] = [];
    const input = new VoiceInput(recognitionCtor(env.win) as never, { onText: (f, i) => texts.push(`${f}|${i}`), onError: (c) => errors.push(c), onEnd: () => undefined });
    input.start("kept");
    env.say("more");
    expect(texts.at(-1)).toBe("kept more|");
    env.recs[0]?.onerror?.({ error: "no-speech" });
    expect(errors).toEqual([]);
    expect(input.text).toBe("kept more");
  });
});
