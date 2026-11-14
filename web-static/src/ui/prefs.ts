// Visitor preferences (theme, text face, CRT, game effects, sound, voice, Dex, mode, rail): localStorage with
// every access guarded (storage.ts); with storage blocked the defaults apply each visit.

import { storage } from "../storage.ts";
import { configureSound } from "./sound.ts";
import { applyTheme, type Theme } from "./theme.ts";

export const PREF_KEY = "ragsys.static.prefs.v1";

export interface Prefs {
  theme?: Theme;
  text?: "pixel" | "clean";
  crt?: boolean;
  game?: boolean;
  sound?: boolean;
  tick?: boolean;
  volume?: number; // 0..100
  mode?: "chat" | "grounded";
  railCollapsed?: boolean;
  pdfOpen?: boolean;
  dex?: boolean; // show Dex, the pixel guide
  autoSend?: boolean; // voice: send 1.2 s after the speaker stops
  readSpoken?: boolean; // voice: read the answer to a spoken question aloud
  autoRead?: boolean; // voice: read every answer aloud
  voiceURI?: string;
  rate?: number; // 0.8..1.4
  pitch?: number; // 0.8..1.4
  robot?: boolean; // Dex's voice: pitch x1.15, rate x1.05
  voiceNotice?: boolean; // the one-time note about the browser's speech service was accepted
}

export const DEFAULTS: Required<Pick<Prefs, "text" | "crt" | "game" | "sound" | "tick" | "volume" | "dex" | "autoSend" | "readSpoken" | "autoRead" | "rate" | "pitch" | "robot">> = {
  text: "pixel",
  crt: true,
  game: true,
  sound: false,
  tick: false,
  volume: 60,
  dex: true,
  autoSend: true,
  readSpoken: true,
  autoRead: false,
  rate: 1,
  pitch: 1,
  robot: false,
};

let memory: Prefs = {};

export function loadPrefs(): Prefs {
  memory = { ...memory, ...(storage.get<Prefs>(PREF_KEY) ?? {}) };
  return memory;
}

export function savePrefs(update: Prefs): Prefs {
  memory = { ...memory, ...update };
  storage.set(PREF_KEY, memory);
  return memory;
}

export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  applyTheme(p.theme === "light" ? "light" : "dark");
  root.classList.toggle("clean-text", (p.text ?? DEFAULTS.text) === "clean");
  root.dataset.crt = (p.crt ?? DEFAULTS.crt) ? "on" : "off";
  root.classList.toggle("game-off", !(p.game ?? DEFAULTS.game));
  root.classList.toggle("dex-off", !(p.dex ?? DEFAULTS.dex));
  configureSound({ enabled: p.sound ?? DEFAULTS.sound, tick: p.tick ?? DEFAULTS.tick, volume: (p.volume ?? DEFAULTS.volume) / 100 });
}

export function gameOn(p: Prefs): boolean {
  return p.game ?? DEFAULTS.game;
}

/** The speech settings with the robot filter applied (Web Speech accepts rate 0.1..10, pitch 0..2). */
export function speechTuning(p: Prefs): { rate: number; pitch: number } {
  const robot = p.robot ?? DEFAULTS.robot;
  const rate = (p.rate ?? DEFAULTS.rate) * (robot ? 1.05 : 1);
  const pitch = (p.pitch ?? DEFAULTS.pitch) * (robot ? 1.15 : 1);
  return { rate: Math.min(2, Math.max(0.5, rate)), pitch: Math.min(2, Math.max(0, pitch)) };
}
