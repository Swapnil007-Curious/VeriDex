// Dex's reactions: real app events in, a state (and how long to hold it) plus an optional speech
// bubble out. Pure, so the mapping is unit-tested; dex.ts runs the timers and draws the frames.

import type { DexState } from "./frames.ts";

export type DexEvent =
  | { type: "load" }
  | { type: "greet" }
  | { type: "listen-start" }
  | { type: "listen-end" }
  | { type: "search"; passages: number }
  | { type: "found"; sources: number }
  | { type: "no-evidence" }
  | { type: "draft" }
  | { type: "answer"; kind: "grounded" | "general" | "local" | "stopped" }
  | { type: "verified"; supported: number; total: number }
  | { type: "partial"; supported: number; total: number }
  | { type: "abstain" }
  | { type: "error"; kind: "rate" | "other"; wait?: string; message?: string }
  | { type: "speak-start" }
  | { type: "speak-end" }
  | { type: "celebrate" }
  | { type: "activity" }
  | { type: "idle-timeout" };

export interface Reaction {
  state: DexState;
  holdMs: number | null; // null: stays until another event changes it
  bubble: string | null; // null: the bubble is left as it is; "": the bubble is cleared
}

const n = (x: number): string => x.toLocaleString("en-US");

/** The reaction to an event in the current state; null when the event changes nothing. */
export function react(event: DexEvent, current: DexState): Reaction | null {
  // listening and speaking hold until they end; only errors and their own end interrupt them
  const busy = current === "listening" || current === "speaking";
  switch (event.type) {
    case "load":
      return { state: "greeting", holdMs: 2400, bubble: null };
    case "greet":
      return busy ? null : { state: "greeting", holdMs: 2000, bubble: null };
    case "listen-start":
      return { state: "listening", holdMs: null, bubble: "I'm listening…" };
    case "listen-end":
      return current === "listening" ? { state: "idle", holdMs: null, bubble: "" } : null;
    case "search":
      return busy ? null : { state: "thinking", holdMs: null, bubble: `Searching ${n(event.passages)} passages…` };
    case "found":
      return busy ? null : { state: "thinking", holdMs: null, bubble: `Found ${event.sources} ${event.sources === 1 ? "source" : "sources"}!` };
    case "no-evidence":
      return busy ? null : { state: "thinking", holdMs: null, bubble: "The library doesn't cover this one." };
    case "draft":
      return busy ? null : { state: "thinking", holdMs: null, bubble: "Writing your answer…" };
    case "answer":
      if (busy) return null;
      return { state: "idle", holdMs: null, bubble: "" };
    case "verified":
      return busy ? null : { state: "happy", holdMs: 2500, bubble: event.total ? `Verified ${event.supported}/${event.total} sentences ✓` : "Verified ✓" };
    case "partial":
      return busy ? null : { state: "idle", holdMs: null, bubble: `Verified ${event.supported}/${event.total} sentences` };
    case "abstain":
      return busy ? null : { state: "confused", holdMs: 3000, bubble: "The library doesn't cover this one." };
    case "error":
      return { state: "error", holdMs: 4000, bubble: event.kind === "rate" ? `Too many questions - back in ${event.wait ?? "a few minutes"}` : (event.message ?? "Something went wrong.") };
    case "speak-start":
      return current === "listening" ? null : { state: "speaking", holdMs: null, bubble: null };
    case "speak-end":
      return current === "speaking" ? { state: "idle", holdMs: null, bubble: null } : null;
    case "celebrate":
      return busy ? null : { state: "celebrate", holdMs: 2500, bubble: null };
    case "activity":
      return current === "sleeping" ? { state: "idle", holdMs: null, bubble: null } : null;
    case "idle-timeout":
      return current === "idle" ? { state: "sleeping", holdMs: null, bubble: null } : null;
    default:
      return null;
  }
}
