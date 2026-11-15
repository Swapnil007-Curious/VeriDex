// @vitest-environment happy-dom
// Dex: every frame is a 32 x 32 grid in the seven Dex colours; the state machine turns real app
// events into states and status lines; the drag physics (projection, bounds, edge snap, rubber
// band, keeping off the composer, the remembered fraction, the bubble side, the spring) are pure
// and tested here; the mover handles clicks, double-clicks, drags and the keyboard; the controller
// scales him by the size setting and shows his bubble; and the shipped code stays small (bundled
// and minified with esbuild: Dex + voice under 25 KB gzipped, the intro under 12 KB).

import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { react, type DexEvent } from "../../src/dex/brain.ts";
import { Dex, dexScale } from "../../src/dex/dex.ts";
import { BLINK, composeFrame, DEX_COLORS, FACES, stateFrames, type DexState } from "../../src/dex/frames.ts";
import { Mover } from "../../src/dex/mover.ts";
import { avoid, bounds, bubblePosition, bubbleSide, clamp, fromFraction, project, release, rubberband, settled, snapToEdges, springParams, stepSpring, toFraction, Velocity2D, type Point } from "../../src/dex/physics.ts";
import { frameRuns } from "../../src/dex/sprite.ts";

const STATES: DexState[] = ["idle", "greeting", "listening", "thinking", "speaking", "happy", "confused", "error", "celebrate", "sleeping", "carried"];

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

  it("faces fit the visor and differ by state; carried has hands up and a flickering thruster", () => {
    for (const face of Object.values(FACES)) {
      expect(face).toHaveLength(6);
      for (const row of face) expect(row).toHaveLength(14);
    }
    const idle = composeFrame(stateFrames("idle", { sparkles: false }).frames[0] as never).join("");
    for (const state of ["listening", "thinking", "happy", "confused", "error", "sleeping", "carried"] as const) {
      expect(composeFrame(stateFrames(state, { sparkles: false }).frames[0] as never).join("")).not.toBe(idle);
    }
    const carried = stateFrames("carried", { sparkles: false }).frames;
    expect(carried.every((f) => f.hands === "up")).toBe(true);
    expect(new Set(carried.map((f) => f.flame)).size).toBeGreaterThan(1);
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
    expect(r({ type: "draft" }, "thinking")?.bubble).toBe("Writing your answer…");
    expect(r({ type: "answer", kind: "general" }, "thinking")).toEqual({ state: "idle", holdMs: null, bubble: "" });
    expect(r({ type: "verified", supported: 2, total: 2 })).toEqual({ state: "happy", holdMs: 2500, bubble: "Verified 2/2 sentences ✓" });
    expect(r({ type: "abstain" }, "thinking")).toEqual({ state: "confused", holdMs: 3000, bubble: "The library doesn't cover this one." });
    expect(r({ type: "greet" })?.state).toBe("greeting");
  });
  it("errors say what happened; listening and speaking hold until they end", () => {
    expect(r({ type: "error", kind: "rate", wait: "05:41" })?.bubble).toBe("Too many questions - back in 05:41");
    expect(r({ type: "search", passages: 10 }, "listening")).toBeNull();
    expect(r({ type: "speak-end" }, "speaking")?.state).toBe("idle");
    expect(r({ type: "idle-timeout" })?.state).toBe("sleeping");
    expect(r({ type: "activity" }, "sleeping")?.state).toBe("idle");
  });
});

describe("drag physics", () => {
  const view = { w: 1366, h: 768 };
  const size = { w: 224, h: 224 };
  const b = bounds(view, size, 12, { top: 0, right: 0, bottom: 20, left: 0 });

  it("projects a flick with Apple's formula (deceleration 0.995)", () => {
    expect(project(1000)).toBeCloseTo(199, 0);
    expect(project(-500)).toBeCloseTo(-99.5, 1);
    expect(project(0)).toBe(0);
  });
  it("keeps him inside the viewport less a 12 px margin and the safe-area insets", () => {
    expect(b).toEqual({ left: 12, top: 12, right: 1366 - 12 - 224, bottom: 768 - 12 - 20 - 224 });
    expect(clamp({ x: -50, y: 9999 }, b)).toEqual({ x: 12, y: b.bottom });
  });
  it("snaps to an edge within 48 px, each axis on its own", () => {
    expect(snapToEdges({ x: 40, y: 300 }, b)).toEqual({ point: { x: 12, y: 300 }, snapped: true });
    expect(snapToEdges({ x: 600, y: b.bottom - 30 }, b)).toEqual({ point: { x: 600, y: b.bottom }, snapped: true });
    expect(snapToEdges({ x: 600, y: 300 }, b).snapped).toBe(false);
  });
  it("a throw past an edge ends on it (and rubber-bands), a drop on the composer moves above it", () => {
    const thrown = release({ x: 900, y: 300 }, { x: 4000, y: 0 }, size, b, null);
    expect(thrown.overshoot.x).toBe(true);
    expect(thrown.target.x).toBe(b.right);
    expect(thrown.snapped).toBe(true);
    const still = release({ x: 600, y: 300 }, { x: 0, y: 0 }, size, b, null, { momentum: false });
    expect(still.target).toEqual({ x: 600, y: 300 });
    const composer = { left: 430, top: 594, right: 1206, bottom: 727 };
    expect(avoid({ x: 600, y: 450 }, size, composer, b)).toEqual({ x: 600, y: 594 - 224 - 8 });
    expect(avoid({ x: 100, y: 100 }, size, composer, b)).toEqual({ x: 100, y: 100 });
    expect(release({ x: 600, y: 480 }, { x: 0, y: 0 }, size, b, composer, { momentum: false }).target.y).toBe(594 - 224 - 8);
  });
  it("resists more the further past the edge, never past the dimension", () => {
    expect(rubberband(10, 224)).toBeLessThan(10);
    expect(rubberband(1000, 224)).toBeLessThan(224);
    expect(rubberband(-50, 224)).toBeLessThan(0);
  });
  it("remembers the position as a fraction of the viewport", () => {
    const f = toFraction({ x: 683, y: 192 }, view);
    expect(f).toEqual({ x: 0.5, y: 0.25 });
    expect(fromFraction(f, { w: 2000, h: 1000 })).toEqual({ x: 1000, y: 250 });
  });
  it("puts the bubble on the side where it fits: right, else left, else above, else below", () => {
    const bubble = { w: 200, h: 60 };
    expect(bubbleSide({ left: 100, top: 300, right: 324, bottom: 524 }, bubble, view)).toBe("right");
    expect(bubbleSide({ left: 1130, top: 12, right: 1354, bottom: 236 }, bubble, view)).toBe("left");
    expect(bubbleSide({ left: 0, top: 300, right: 1366, bottom: 500 }, bubble, view)).toBe("top");
    expect(bubbleSide({ left: 0, top: 20, right: 1366, bottom: 500 }, bubble, view)).toBe("bottom");
    const at = bubblePosition("left", { left: 1130, top: 12, right: 1354, bottom: 236 }, bubble, view);
    expect(at.x + bubble.w).toBeLessThanOrEqual(1130);
  });
  it("the spring settles on its target; bounce 0.2 overshoots a little, bounce 0 does not", () => {
    for (const [bounce, overshoots] of [[0.2, true], [0, false]] as const) {
      const p = springParams(bounce, 0.35);
      let s = { x: 0, v: 0 };
      let max = 0;
      for (let i = 0; i < 240; i++) {
        s = stepSpring(s, 100, p, 1 / 60);
        max = Math.max(max, s.x);
      }
      expect(settled(s, 100)).toBe(true);
      expect(max > 100.5).toBe(overshoots);
    }
  });
  it("measures velocity over the last 100 ms", () => {
    const v = new Velocity2D();
    v.add(0, 0, 0);
    v.add(10, -5, 50);
    v.add(20, -10, 100);
    expect(v.get()).toEqual({ x: 200, y: -100 });
    v.add(20, -10, 400); // the old samples drop out
    expect(v.get()).toEqual({ x: 0, y: 0 });
  });
});

describe("the mover: clicks, double-clicks, drags, keys", () => {
  let el: HTMLElement;
  let activated: number;
  let saved: Point | null;
  let homeAt: Point;
  const make = () => {
    el = document.createElement("button");
    document.body.appendChild(el);
    activated = 0;
    saved = null;
    homeAt = { x: 100, y: 300 };
    const m = new Mover(el, {
      reducedMotion: () => true, // straight to the drop point: no animation frames in the test
      home: () => homeAt,
      composer: () => ({ left: 400, top: 600, right: 1000, bottom: 700 }),
      insets: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
      store: { get: () => saved, set: (p) => (saved = p) },
      onCarry: () => undefined,
      onDragStart: () => undefined,
      onActivate: () => activated++,
      onMove: () => undefined,
    });
    m.setSize({ w: 160, h: 160 });
    return m;
  };
  const pointer = (type: string, x: number, y: number, t: number) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, timeStamp: t } as PointerEventInit));
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, "clientWidth", { value: 1366, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts at home; a click (under 6 px) activates after the double-click window", () => {
    const m = make();
    expect(m.pos).toEqual({ x: 100, y: 300 });
    pointer("pointerdown", 150, 350, 0);
    pointer("pointermove", 153, 352, 10);
    pointer("pointerup", 153, 352, 20);
    expect(activated).toBe(0);
    vi.advanceTimersByTime(300);
    expect(activated).toBe(1);
    expect(m.pos).toEqual({ x: 100, y: 300 });
  });
  it("a double-click sends him home and does not activate", () => {
    const m = make();
    saved = { x: 0.5, y: 0.1 };
    m.layout();
    expect(m.pos.x).toBe(683);
    pointer("pointerdown", 700, 100, 0);
    pointer("pointerup", 700, 100, 10);
    pointer("pointerdown", 700, 100, 120);
    pointer("pointerup", 700, 100, 130);
    vi.advanceTimersByTime(400);
    expect(activated).toBe(0);
    expect(m.pos).toEqual({ x: 100, y: 300 });
    expect(saved).toBeNull();
  });
  it("a drag moves him 1:1, never activates, and is remembered as a fraction", () => {
    const m = make();
    pointer("pointerdown", 150, 350, 0);
    pointer("pointermove", 250, 250, 16);
    pointer("pointermove", 350, 150, 32);
    pointer("pointerup", 350, 150, 48);
    vi.advanceTimersByTime(400);
    expect(activated).toBe(0);
    expect(m.pos).toEqual({ x: 300, y: 100 });
    expect(saved).toEqual({ x: 300 / 1366, y: 100 / 768 });
  });
  it("dropped on the composer he moves just above it", () => {
    const m = make();
    pointer("pointerdown", 150, 350, 0);
    pointer("pointermove", 550, 620, 16);
    pointer("pointerup", 550, 620, 32);
    expect(m.pos.y).toBe(600 - 160 - 8);
  });
  it("arrow keys move 16 px (Shift 64), Home goes home, Enter activates", () => {
    const m = make();
    const key = (k: string, shift = false) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));
    key("ArrowRight");
    expect(m.pos).toEqual({ x: 116, y: 300 });
    key("ArrowUp", true);
    expect(m.pos).toEqual({ x: 116, y: 236 });
    key("Home");
    expect(m.pos).toEqual({ x: 100, y: 300 });
    key("Enter");
    key(" ");
    expect(activated).toBe(2);
  });
});

describe("the Dex controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("maps the size setting to whole-number scales (phones: Large x5, Medium x4)", () => {
    expect([dexScale("small", 1440), dexScale("medium", 1440), dexScale("large", 1440)]).toEqual([3, 5, 7]);
    expect([dexScale("small", 390), dexScale("medium", 390), dexScale("large", 390)]).toEqual([3, 4, 5]);
  });

  it("draws an aria-hidden crisp sprite at x7, says status lines in his bubble, takes the carried pose", () => {
    document.body.innerHTML = `<button id="dex"></button><p id="bubble" hidden></p>`;
    const lines: string[] = [];
    const frames: string[] = [];
    const button = document.getElementById("dex") as HTMLElement;
    const bubble = document.getElementById("bubble") as HTMLElement;
    const dex = new Dex({
      button,
      bubble,
      reducedMotion: () => false,
      effects: () => true,
      size: () => "large",
      announce: (t) => lines.push(t),
      home: () => ({ x: 100, y: 300 }),
      composer: () => null,
      onActivate: () => undefined,
      onFrame: (spec) => frames.push(spec.face),
    });
    const svg = button.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg.getAttribute("width")).toBe(String(32 * dexScale("large", window.innerWidth)));
    dex.send({ type: "search", passages: 14064 });
    expect(button.dataset.dexState).toBe("thinking");
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe("Searching 14,064 passages…");
    expect(lines).toEqual(["Searching 14,064 passages…"]);
    expect(frames.at(-1)).toMatch(/^scan/); // the answer portrait follows his frames
    vi.advanceTimersByTime(3000);
    expect(bubble.hidden).toBe(true);
    button.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, pointerId: 7, button: 0, bubbles: true }));
    expect(button.dataset.dexState).toBe("carried");
    button.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 10, pointerId: 7, button: 0, bubbles: true }));
    expect(button.dataset.dexState).toBe("thinking");
  });
});

describe("size budget (bundled and minified)", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  const gz = (entry: string): number => {
    const out = buildSync({ entryPoints: [join(src, entry)], bundle: true, minify: true, format: "esm", write: false, logLevel: "silent" });
    return gzipSync(Buffer.from(out.outputFiles[0]?.contents ?? new Uint8Array())).length;
  };
  it("Dex and the voice code stay under 25 KB gzipped; the intro under 12 KB", () => {
    const dex = gz("dex/dex.ts");
    const voice = gz("voice/voice.ts");
    const intro = gz("intro/intro.ts");
    expect(dex + voice).toBeLessThan(25 * 1024);
    expect(intro).toBeLessThan(12 * 1024);
  });
});
