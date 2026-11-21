// The voice controller, loaded on first use. Speaking: the browser's recognizer fills the composer
// (settled words in cream, the changing guess dimmed) while a 16-bar meter shows the microphone
// level; a pause of 1.2 s sends the question (a setting), releasing Space sends it in push-to-talk,
// and hands-free mode listens again after each reply until 20 s pass without speech. Listening:
// answers are read one sentence at a time, the sentence being read is underlined with the CSS
// Custom Highlight API, and Esc, Stop, a new question or leaving the page stop the voice at once.

import type { DexEvent } from "../dex/brain.ts";
import { speechSentences } from "./speech-text.ts";
import { AudioMeter, recognitionCtor, VoiceInput } from "./stt.ts";
import { englishVoices, preferredVoice, SpeechQueue } from "./tts.ts";

const SEND_AFTER_MS = 1200;
const HANDS_FREE_IDLE_MS = 20_000;
const HIGHLIGHT = "dex-read";

export interface VoiceUi {
  composer: HTMLTextAreaElement;
  wrap: HTMLElement; // the composer's input box
  overlay: HTMLElement;
  finalEl: HTMLElement;
  interimEl: HTMLElement;
  meter: HTMLElement;
  micBtn: HTMLButtonElement;
  hfBtn: HTMLButtonElement;
  hfChip: HTMLElement;
}

export interface VoiceSettings {
  autoSend: boolean;
  voiceURI?: string;
  rate: number;
  pitch: number;
  highlight: boolean; // off with game effects off
}

export interface VoiceHooks {
  settings(): VoiceSettings;
  /** Send a spoken question; false when it could not be sent (an answer is still streaming). */
  send(text: string): boolean;
  autosize(): void;
  dex(event: DexEvent): void;
  dexWord(): void;
  error(text: string): void;
  announce(text: string): void;
  /** The answer being read changed (null: nothing is being read). */
  onSpeaking(id: string | null): void;
  onListening(on: boolean): void;
}

type ListenMode = "toggle" | "push" | "hands-free";

export const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in the address bar, or type instead.",
  "service-not-allowed": "This browser's speech service is turned off. Typing works too.",
  "audio-capture": "No microphone was found. Typing works too.",
  network: "The speech service can't be reached. Check your connection, or type instead.",
  "start-failed": "Voice input could not start. Try again.",
};

// ------------------------------------------------------------------ sentence highlight

const SKIP = "pre, .katex, .cite, button, .caret, .visually-hidden";

export interface TextIndex {
  text: string; // lower case, runs of space collapsed
  at: { node: Text; offset: number }[]; // the DOM position of each character of text
}

/** The readable text of an answer, with each character's DOM position. */
export function textIndex(root: Element): TextIndex {
  const at: TextIndex["at"] = [];
  let text = "";
  let space = true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const v = node.data;
    for (let i = 0; i < v.length; i++) {
      const raw = v[i] as string;
      if (/\s/.test(raw)) {
        if (space) continue;
        text += " ";
        space = true;
      } else {
        const low = raw.toLowerCase();
        text += low.length === 1 ? low : raw;
        space = false;
      }
      at.push({ node, offset: i });
    }
    if (!space) {
      text += " ";
      at.push({ node, offset: v.length });
      space = true;
    }
  }
  return { text, at };
}

const esc = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GAP = "[^\\p{L}\\p{N}]+";

/** Where a spoken sentence sits in the answer's text, searching from ``from``; null if not found. */
export function findSentence(text: string, sentence: string, from: number): [number, number] | null {
  const words = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return null;
  const head = new RegExp(words.slice(0, 3).map(esc).join(GAP), "gu");
  head.lastIndex = from;
  const m = head.exec(text);
  if (!m) return null;
  let end = m.index + m[0].length;
  if (words.length > 3) {
    const tail = new RegExp(words.slice(Math.max(3, words.length - 2)).map(esc).join(GAP), "gu");
    tail.lastIndex = end;
    const t = tail.exec(text);
    if (t && t.index - m.index <= sentence.length * 1.5 + 40) end = t.index + t[0].length;
  }
  return [m.index, end];
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function highlights(): HighlightRegistry | null {
  const g = globalThis as unknown as { CSS?: { highlights?: HighlightRegistry }; Highlight?: unknown };
  return g.CSS?.highlights && typeof g.Highlight === "function" ? g.CSS.highlights : null;
}

// ------------------------------------------------------------------ the controller

export class Voice {
  readonly input: boolean;
  readonly output: boolean;
  private readonly rec: VoiceInput | null = null;
  private readonly meter: AudioMeter;
  private readonly queue: SpeechQueue | null = null;
  private readonly synth: SpeechSynthesis | null = null;
  private mode: ListenMode | null = null;
  handsFree = false;
  speakingId: string | null = null;
  private final = "";
  private interim = "";
  private sendTimer = 0;
  private idleTimer = 0;
  private readCursor = 0;

  constructor(
    private readonly ui: VoiceUi,
    private readonly hooks: VoiceHooks,
    win: Window = window,
  ) {
    const Ctor = recognitionCtor(win);
    this.input = Boolean(Ctor);
    this.output = typeof win.speechSynthesis !== "undefined" && typeof (win as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function";
    if (Ctor) {
      this.rec = new VoiceInput(Ctor, {
        onText: (final, interim) => this.onText(final, interim),
        onError: (code) => this.onError(code),
        onEnd: () => this.onEnd(),
        onSpeech: () => this.armIdle(),
      });
    }
    if (this.output) this.synth = win.speechSynthesis;
    if (this.synth) this.queue = new SpeechQueue(this.synth, (win as unknown as { SpeechSynthesisUtterance: new (text: string) => SpeechSynthesisUtterance }).SpeechSynthesisUtterance);
    this.meter = new AudioMeter((levels) => this.drawMeter(levels));
    if (!ui.meter.children.length) for (let i = 0; i < 16; i++) ui.meter.appendChild(document.createElement("i"));
    win.addEventListener("pagehide", () => this.stopAll());
  }

  get listening(): boolean {
    return this.mode !== null;
  }

  get pushing(): boolean {
    return this.mode === "push";
  }

  // -------------------------------------------------------------- listening

  listen(mode: ListenMode = "toggle"): void {
    if (!this.rec) return;
    this.stopSpeaking();
    if (this.mode) this.rec.stop();
    this.mode = mode;
    const keep = this.ui.composer.value.trim();
    this.final = keep;
    this.interim = "";
    this.rec.start(keep);
    if (!this.rec.listening) return; // start failed: onError already reset everything
    this.ui.wrap.classList.add("listening");
    this.ui.overlay.hidden = false;
    this.ui.meter.hidden = false;
    this.renderTranscript();
    this.ui.micBtn.setAttribute("aria-pressed", "true");
    void this.meter.start();
    this.hooks.dex({ type: "listen-start" });
    this.hooks.onListening(true);
    this.armIdle();
  }

  toggleListening(): void {
    if (this.mode) this.stopListening(false);
    else this.listen("toggle");
  }

  /** Stop the microphone; with send, the words go out as a question (if there are any). */
  stopListening(send: boolean): void {
    if (!this.mode) return;
    const text = `${this.final} ${this.interim}`.trim();
    this.mode = null;
    clearTimeout(this.sendTimer);
    clearTimeout(this.idleTimer);
    this.rec?.stop();
    this.meter.stop();
    this.ui.wrap.classList.remove("listening");
    this.ui.overlay.hidden = true;
    this.ui.meter.hidden = true;
    this.ui.micBtn.setAttribute("aria-pressed", "false");
    this.hooks.dex({ type: "listen-end" });
    this.hooks.onListening(false);
    this.ui.composer.value = text;
    this.hooks.autosize();
    if (send && text && this.hooks.send(text)) {
      this.ui.composer.value = "";
      this.hooks.autosize();
    }
  }

  private onText(final: string, interim: string): void {
    this.final = final;
    this.interim = interim;
    this.ui.composer.value = `${final} ${interim}`.trim();
    this.hooks.autosize();
    this.renderTranscript();
    clearTimeout(this.sendTimer);
    const auto = this.mode === "hands-free" || (this.mode === "toggle" && this.hooks.settings().autoSend);
    if (auto && `${final}${interim}`.trim()) this.sendTimer = window.setTimeout(() => this.stopListening(true), SEND_AFTER_MS);
  }

  /** Hands-free ends after 20 s without speech. */
  private armIdle(): void {
    clearTimeout(this.idleTimer);
    if (this.mode !== "hands-free") return;
    this.idleTimer = window.setTimeout(() => {
      this.setHandsFree(false);
      this.hooks.dex({ type: "error", kind: "other", message: "Hands-free is off: nothing heard for 20 seconds." });
    }, HANDS_FREE_IDLE_MS);
  }

  private onError(code: string): void {
    const text = VOICE_ERRORS[code] ?? `Voice input stopped (${code}).`;
    this.handsFree = false;
    this.ui.hfBtn.setAttribute("aria-pressed", "false");
    this.ui.hfChip.hidden = true;
    if (this.mode) this.stopListening(false);
    else this.mode = null;
    this.hooks.error(text);
  }

  /** The recognizer stopped on its own (a long pause, the service timing out). */
  private onEnd(): void {
    if (!this.mode) return;
    if (this.mode === "hands-free") {
      this.rec?.start(`${this.final} ${this.interim}`.trim());
      return;
    }
    this.stopListening(this.mode === "toggle" && this.hooks.settings().autoSend);
  }

  private renderTranscript(): void {
    this.ui.finalEl.textContent = this.final;
    this.ui.interimEl.textContent = this.interim || (this.final ? "" : this.mode === "push" ? "Listening… release Space to send" : "Listening… speak now");
    this.ui.interimEl.classList.toggle("is-hint", !this.interim && !this.final);
  }

  private drawMeter(levels: number[]): void {
    const bars = this.ui.meter.children;
    levels.forEach((v, i) => {
      const bar = bars[i] as HTMLElement | undefined;
      if (bar) bar.style.height = `${4 + Math.round(v * 5) * 4}px`;
    });
  }

  // -------------------------------------------------------------- hands-free

  setHandsFree(on: boolean): void {
    if (on === this.handsFree) return;
    this.handsFree = on;
    this.ui.hfBtn.setAttribute("aria-pressed", on ? "true" : "false");
    this.ui.hfChip.hidden = !on;
    this.hooks.announce(on ? "Hands-free on. Ask a question; Esc ends it." : "Hands-free off.");
    if (on) this.listen("hands-free");
    else if (this.mode === "hands-free") this.stopListening(false);
  }

  /** After an answer in hands-free mode: listen for the next question. */
  resume(): void {
    if (!this.handsFree || this.mode || this.speakingId) return;
    window.setTimeout(() => {
      if (this.handsFree && !this.mode && !this.speakingId) this.listen("hands-free");
    }, 300);
  }

  // -------------------------------------------------------------- reading answers

  voices(): SpeechSynthesisVoice[] {
    return this.synth ? englishVoices(this.synth) : [];
  }

  private voice(): SpeechSynthesisVoice | null {
    const all = this.voices();
    const uri = this.hooks.settings().voiceURI;
    return (uri ? all.find((v) => v.voiceURI === uri) : undefined) ?? preferredVoice(all);
  }

  /** Read an answer aloud; ``root`` finds its text on the page for the highlight. */
  speak(id: string, markdown: string, root: () => Element | null = () => null): void {
    if (!this.queue) return;
    if (this.mode) this.stopListening(false);
    const s = this.hooks.settings();
    const sentences = speechSentences(markdown);
    this.readCursor = 0;
    this.speakingId = id;
    this.hooks.onSpeaking(id);
    this.queue.speak(sentences, {
      voice: this.voice(),
      rate: s.rate,
      pitch: s.pitch,
      onSentence: (i) => {
        if (i === 0) this.hooks.dex({ type: "speak-start" });
        if (s.highlight) this.mark(root(), sentences[i] ?? "");
      },
      onBoundary: () => this.hooks.dexWord(),
      onEnd: (completed) => {
        highlights()?.delete(HIGHLIGHT);
        this.speakingId = null;
        this.hooks.onSpeaking(null);
        this.hooks.dex({ type: "speak-end" });
        if (completed) this.resume();
      },
    });
  }

  test(): void {
    this.speak("test", "Hi! I'm Dex, VeriDex's guide. Ask me anything.");
  }

  private mark(root: Element | null, sentence: string): void {
    const hl = highlights();
    if (!hl || !root) return;
    const ix = textIndex(root);
    const found = findSentence(ix.text, sentence, this.readCursor);
    if (!found) return;
    const a = ix.at[found[0]];
    const b = ix.at[found[1] - 1];
    if (!a || !b) return;
    this.readCursor = found[1];
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, Math.min(b.node.data.length, b.offset + 1));
    const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    hl.set(HIGHLIGHT, new H(range));
  }

  stopSpeaking(): void {
    this.queue?.stop();
  }

  /** Stop everything the voice is doing; true when something was running. */
  stopAll(): boolean {
    const active = this.listening || this.handsFree || this.speakingId !== null;
    this.setHandsFree(false);
    this.stopListening(false);
    this.stopSpeaking();
    return active;
  }
}
