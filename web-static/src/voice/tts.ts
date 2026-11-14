// Speech output: a queue of sentences read one utterance at a time (Chrome stops long utterances),
// interruptible at any point, with the sentence and word boundaries reported for the highlight and
// Dex's mouth. Voices: English only, preferring a natural en-IN or en-GB voice.

export interface SpeakOptions {
  voice?: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  onSentence?(index: number): void;
  onBoundary?(index: number, charIndex: number): void;
  /** completed: the queue reached its end (false when it was stopped). */
  onEnd?(completed: boolean): void;
}

type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export class SpeechQueue {
  private token = 0;
  private current: SpeakOptions | null = null;
  speaking = false;

  constructor(
    private readonly synth: SpeechSynthesis,
    private readonly Utterance: UtteranceCtor,
  ) {}

  speak(sentences: readonly string[], opts: SpeakOptions): void {
    this.stop();
    if (!sentences.length) {
      opts.onEnd?.(true);
      return;
    }
    const token = ++this.token;
    this.current = opts;
    this.speaking = true;
    let i = 0;
    const next = (): void => {
      if (token !== this.token) return;
      if (i >= sentences.length) {
        this.speaking = false;
        this.current = null;
        opts.onEnd?.(true);
        return;
      }
      const index = i;
      const u = new this.Utterance(sentences[index] ?? "");
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      if (opts.voice) {
        u.voice = opts.voice;
        u.lang = opts.voice.lang;
      } else u.lang = "en-IN";
      u.onstart = () => {
        if (token === this.token) opts.onSentence?.(index);
      };
      u.onboundary = (e) => {
        if (token === this.token && e.name !== "sentence") opts.onBoundary?.(index, e.charIndex);
      };
      const advance = (): void => {
        if (token !== this.token) return;
        i += 1;
        next();
      };
      u.onend = advance;
      u.onerror = advance;
      this.synth.speak(u);
    };
    next();
  }

  /** Stop at once (a new question, Esc, the STOP button, leaving the page). */
  stop(): void {
    if (!this.speaking) return;
    this.token += 1;
    this.speaking = false;
    const opts = this.current;
    this.current = null;
    this.synth.cancel();
    opts?.onEnd?.(false);
  }
}

export function englishVoices(synth: Pick<SpeechSynthesis, "getVoices">): SpeechSynthesisVoice[] {
  return synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

/** A natural en-IN voice, else a natural en-GB one, else any en-IN / en-GB / en-US voice. */
export function preferredVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const natural = (v: SpeechSynthesisVoice): boolean => /natural|neural|online|google|premium|enhanced/i.test(v.name);
  const lang = (v: SpeechSynthesisVoice, l: string): boolean => v.lang.replace("_", "-").toLowerCase().startsWith(l);
  return (
    voices.find((v) => lang(v, "en-in") && natural(v)) ??
    voices.find((v) => lang(v, "en-gb") && natural(v)) ??
    voices.find((v) => lang(v, "en-in")) ??
    voices.find((v) => lang(v, "en-gb")) ??
    voices.find((v) => lang(v, "en-us")) ??
    voices[0] ??
    null
  );
}
