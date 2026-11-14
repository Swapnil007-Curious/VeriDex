// 8-bit sounds made with the Web Audio API (square and triangle oscillators; no audio files). Off by
// default; the typewriter tick has its own switch and is throttled and very quiet. The context is
// created on the first sound after the visitor turned sound on (a user gesture), and each sound is
// scheduled for "now", so it starts in the same frame as its visual.

type Wave = OscillatorType;

interface SoundSettings {
  enabled: boolean;
  tick: boolean;
  volume: number; // 0..1
}

const settings: SoundSettings = { enabled: false, tick: false, volume: 0.6 };
let ctx: AudioContext | null = null;
let lastTick = 0;

export function configureSound(s: Partial<SoundSettings>): void {
  Object.assign(settings, s);
  if (!settings.enabled && ctx) {
    void ctx.close().catch(() => undefined);
    ctx = null;
  }
}

function audio(): AudioContext | null {
  if (!settings.enabled || settings.volume <= 0) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One note: frequency (Hz), start offset and length (s), wave and relative gain. */
function note(a: AudioContext, freq: number, at: number, len: number, wave: Wave, gain: number, slideTo?: number): void {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t + len);
  const peak = Math.max(0.0001, gain * settings.volume * 0.25);
  amp.gain.setValueAtTime(peak, t);
  amp.gain.setValueAtTime(peak, t + len * 0.7);
  amp.gain.linearRampToValueAtTime(0.0001, t + len);
  osc.connect(amp).connect(a.destination);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

export const sfx = {
  send(): void {
    const a = audio();
    if (a) note(a, 660, 0, 0.06, "square", 0.5, 990);
  },
  tick(): void {
    if (!settings.tick) return;
    const now = performance.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    const a = audio();
    if (a) note(a, 1800, 0, 0.012, "square", 0.08);
  },
  verified(): void {
    const a = audio();
    if (!a) return;
    note(a, 784, 0, 0.08, "square", 0.45);
    note(a, 1175, 0.08, 0.16, "square", 0.45);
  },
  levelUp(): void {
    const a = audio();
    if (!a) return;
    [523, 659, 784, 1047].forEach((f, i) => note(a, f, i * 0.07, 0.09, "square", 0.45));
    note(a, 1047, 0.28, 0.25, "triangle", 0.5);
  },
  error(): void {
    const a = audio();
    if (a) note(a, 140, 0, 0.18, "square", 0.4, 90);
  },
};
