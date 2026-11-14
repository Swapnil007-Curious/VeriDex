// Speech input: the Web Speech API's recognizer (SpeechRecognition / webkitSpeechRecognition), en-IN
// with an en-US fallback, interim results on; and a 16-bar audio meter fed by getUserMedia and an
// AnalyserNode, with an animated stand-in when the microphone stream is refused.

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => Recognition;

/** The browser's recognizer, if it has one (Chrome, Edge, Safari; not Firefox). */
export function recognitionCtor(win: Window = window): RecognitionCtor | null {
  const w = win as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupport(win: Window = window): { input: boolean; output: boolean } {
  return { input: Boolean(recognitionCtor(win)), output: typeof win.speechSynthesis !== "undefined" && typeof (win as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function" };
}

export interface InputHandlers {
  /** The transcript so far: settled text and the guess still changing. */
  onText(final: string, interim: string): void;
  onError(code: string): void;
  onEnd(): void;
  onSpeech?(): void;
}

export class VoiceInput {
  private rec: Recognition | null = null;
  private final = "";
  private lang = "en-IN";
  listening = false;

  constructor(
    private readonly Ctor: RecognitionCtor,
    private readonly h: InputHandlers,
  ) {}

  get text(): string {
    return this.final.trim();
  }

  start(keep = ""): void {
    this.stop();
    this.final = keep ? `${keep.trim()} ` : "";
    const rec = new this.Ctor();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as RecognitionResult;
        if (r.isFinal) this.final += `${r[0].transcript.trim()} `;
        else interim += r[0].transcript;
      }
      this.h.onSpeech?.();
      this.h.onText(this.final.trim(), interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "language-not-supported" && this.lang !== "en-US") {
        this.lang = "en-US";
        const keepText = this.final;
        this.listening = false;
        this.rec = null;
        this.start(keepText);
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.h.onError(e.error);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.listening = false;
      this.rec = null;
      this.h.onEnd();
    };
    this.rec = rec;
    this.listening = true;
    try {
      rec.start();
    } catch {
      this.listening = false;
      this.rec = null;
      this.h.onError("start-failed");
    }
  }

  stop(): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    this.listening = false;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  }
}

/** Sixteen levels (0..1) about fifteen times a second while the microphone is on. */
export class AudioMeter {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer = 0;
  live = false;

  constructor(private readonly onLevels: (levels: number[]) => void) {}

  async start(): Promise<void> {
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ctx = new AudioContext();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      this.ctx.createMediaStreamSource(this.stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.live = true;
      this.timer = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        const levels = Array.from({ length: 16 }, (_, i) => Math.min(1, ((data[i + 1] ?? 0) / 255) * 1.4));
        this.onLevels(levels);
      }, 66);
    } catch {
      // the stream was refused or there is no device: an animated stand-in, honest about it
      this.live = false;
      let t = 0;
      this.timer = window.setInterval(() => {
        t += 1;
        this.onLevels(Array.from({ length: 16 }, (_, i) => 0.25 + 0.25 * Math.sin(t / 2 + i / 1.5) ** 2));
      }, 120);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.live = false;
  }
}
