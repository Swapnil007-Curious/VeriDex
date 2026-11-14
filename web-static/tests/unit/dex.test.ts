// @vitest-environment happy-dom
// Dex: every frame is a 32 x 32 grid in the seven Dex colours; the state machine turns real app
// events into states and status lines; the controller draws aria-hidden sprites, mirrors each
// line to the live region, sleeps after two minutes, holds still under reduced motion; and Dex
// plus the voice code stay inside their size budget.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { react, type DexEvent } from "../../src/dex/brain.ts";
import { Dex } from "../../src/dex/dex.ts";
import { BLINK, composeFrame, DEX_COLORS, FACES, stateFrames, type DexState } from "../../src/dex/frames.ts";
import { frameRuns } from "../../src/dex/sprite.ts";

const STATES: DexState[] = ["idle", "greeting", "listening", "thinking", "speaking", "happy", "confused", "error", "celebrate", "sleeping"];

describe("Dex frames", () => {
  it("every frame of every state is 32 rows of 32 known colours", () => {
    for (const state of STATES) {
      for (const sparkles of [true, false]) {
        const { frames, fps } = stateFrames(state, { sparkles });
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.length).toBeLessThanOrEqual(4);
        expect(fps).toBeGreaterThan(0);
        for (const spec of [...frames, BLINK]) {
          const rows = composeFrame(spec);
          expect(rows).toHaveLength(32);
          for (const row of rows) {
            expect(row).toHaveLength(32);
            for (const ch of row) expect(ch === "." || ch in DEX_COLORS).toBe(true);
          }
        }
      }
    }
    expect(Object.keys(DEX_COLORS)).toHaveLength(7);
  });

  it("faces fit the visor and differ by state", () => {
    for (const face of Object.values(FACES)) {
      expect(face).toHaveLength(6);
      for (const row of face) expect(row).toHaveLength(14);
    }
    const idle = composeFrame(stateFrames("idle", { sparkles: false }).frames[0] as never).join("");
    for (const state of ["listening", "thinking", "happy", "confused", "error", "sleeping"] as const) {
      expect(composeFrame(stateFrames(state, { sparkles: false }).frames[0] as never).join("")).not.toBe(idle);
    }
  });

  it("sparkles are an effect: without them celebrate is one still frame", () => {
    expect(stateFrames("celebrate", { sparkles: true }).frames).toHaveLength(2);
    expect(stateFrames("celebrate", { sparkles: false }).frames).toHaveLength(1);
  });

  it("the SVG runs cover exactly the painted pixels", () => {
    const spec = stateFrames("idle", { sparkles: false }).frames[0] as never;
    const painted = composeFrame(spec).join("").replace(/\./g, "").length;
    expect(frameRuns(spec).reduce((n, [, , w]) => n + w, 0)).toBe(painted);
  });
});

describe("Dex reactions", () => {
  const r = (e: DexEvent, s: DexState = "idle") => react(e, s);

  it("follows the answer pipeline with live status lines", () => {
    expect(r({ type: "search", passages: 14064 })).toEqual({ state: "thinking", holdMs: null, bubble: "Searching 14,064 passages…" });
    expect(r({ type: "found", sources: 3 }, "thinking")?.bubble).toBe("Found 3 sources!");
    expect(r({ type: "found", sources: 1 }, "thinking")?.bubble).toBe("Found 1 source!");
    expect(r({ type: "draft" }, "thinking")?.bubble).toBe("Writing your answer…");
    expect(r({ type: "answer", kind: "general" }, "thinking")).toEqual({ state: "idle", holdMs: null, bubble: "" });
    expect(r({ type: "verified", supported: 2, total: 2 })).toEqual({ state: "happy", holdMs: 2500, bubble: "Verified 2/2 sentences ✓" });
    expect(r({ type: "verified", supported: 0, total: 0 })?.bubble).toBe("Verified ✓");
    expect(r({ type: "partial", supported: 1, total: 3 })?.bubble).toBe("Verified 1/3 sentences");
    expect(r({ type: "abstain" }, "thinking")).toEqual({ state: "confused", holdMs: 3000, bubble: "The library doesn't cover this one." });
  });

  it("errors say what happened, with the rate-limit countdown", () => {
    expect(r({ type: "error", kind: "rate", wait: "05:41" })).toEqual({ state: "error", holdMs: 4000, bubble: "Too many questions - back in 05:41" });
    expect(r({ type: "error", kind: "rate" })?.bubble).toBe("Too many questions - back in a few minutes");
    expect(r({ type: "error", kind: "other", message: "Can't reach the answer service." })?.bubble).toBe("Can't reach the answer service.");
  });

  it("listening and speaking hold until they end; sleep comes only from idle", () => {
    expect(r({ type: "listen-start" })).toEqual({ state: "listening", holdMs: null, bubble: "I'm listening…" });
    expect(r({ type: "search", passages: 10 }, "listening")).toBeNull();
    expect(r({ type: "verified", supported: 1, total: 1 }, "speaking")).toBeNull();
    expect(r({ type: "listen-end" }, "listening")?.state).toBe("idle");
    expect(r({ type: "listen-end" }, "thinking")).toBeNull();
    expect(r({ type: "speak-start" })?.state).toBe("speaking");
    expect(r({ type: "speak-start" }, "listening")).toBeNull();
    expect(r({ type: "speak-end" }, "speaking")?.state).toBe("idle");
    expect(r({ type: "speak-end" }, "happy")).toBeNull();
    expect(r({ type: "idle-timeout" })?.state).toBe("sleeping");
    expect(r({ type: "idle-timeout" }, "thinking")).toBeNull();
    expect(r({ type: "activity" }, "sleeping")?.state).toBe("idle");
    expect(r({ type: "activity" })).toBeNull();
    expect(r({ type: "error", kind: "other" }, "listening")?.state).toBe("error");
  });
});

describe("Dex on the page", () => {
  let lines: string[];
  let reduced: boolean;
  const make = (effects = true) => {
    document.body.innerHTML = `<div id="h"></div><p id="b" data-default="Hi! I'm Dex.">Hi! I'm Dex.</p><div id="d"></div><p id="t" hidden></p>`;
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    return new Dex(
      [
        { el: $("h"), scale: 6, bubble: $("b") },
        { el: $("d"), scale: 2, rows: 30 },
      ],
      { reducedMotion: () => reduced, effects: () => effects, announce: (t) => lines.push(t), toast: $("t") },
    );
  };
  beforeEach(() => {
    vi.useFakeTimers();
    lines = [];
    reduced = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("draws crisp aria-hidden sprites at whole-number scales", () => {
    make();
    const [big, small] = [...document.querySelectorAll("svg")];
    expect(big?.getAttribute("aria-hidden")).toBe("true");
    expect(big?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(big?.getAttribute("width")).toBe("192");
    expect(small?.getAttribute("viewBox")).toBe("0 0 32 30");
    expect(small?.getAttribute("height")).toBe("60");
  });

  it("status lines go to the bubble and the live region, then the bubble returns to its greeting", () => {
    const dex = make();
    dex.send({ type: "search", passages: 14064 });
    expect(document.getElementById("h")?.dataset.dexState).toBe("thinking");
    expect(document.getElementById("b")?.textContent).toBe("Searching 14,064 passages…");
    expect(lines).toEqual(["Searching 14,064 passages…"]);
    vi.advanceTimersByTime(3000);
    expect(document.getElementById("b")?.textContent).toBe("Hi! I'm Dex.");
    dex.send({ type: "draft" });
    dex.send({ type: "answer", kind: "grounded" });
    expect(document.getElementById("b")?.textContent).toBe("Hi! I'm Dex.");
  });

  it("happy hops back to idle; sleeps after two minutes and wakes on input", () => {
    const dex = make();
    dex.send({ type: "verified", supported: 2, total: 2 });
    expect(document.getElementById("h")?.classList.contains("dex-jump")).toBe(true);
    vi.advanceTimersByTime(2500);
    expect(dex.state).toBe("idle");
    vi.advanceTimersByTime(120_000);
    expect(dex.state).toBe("sleeping");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(dex.state).toBe("idle");
  });

  it("game effects off: no hop; reduced motion: no frame ticker", () => {
    const calm = make(false);
    calm.send({ type: "verified", supported: 1, total: 1 });
    expect(document.getElementById("h")?.classList.contains("dex-jump")).toBe(false);
    reduced = true;
    const spy = vi.spyOn(window, "setInterval");
    const still = make();
    still.send({ type: "search", passages: 5 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("size budget", () => {
  it("Dex and the voice code stay under 25 KB gzipped (source, comments included)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    let total = 0;
    for (const dir of ["dex", "voice"]) {
      for (const f of readdirSync(join(root, dir))) total += gzipSync(readFileSync(join(root, dir, f))).length;
    }
    total += gzipSync(readFileSync(join(root, "styles", "dex-voice.css"))).length;
    expect(total).toBeLessThan(25 * 1024);
  });
});
