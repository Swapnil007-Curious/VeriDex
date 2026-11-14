// Dex's frames as SVG: one <rect> per horizontal run of a colour, shape-rendering crispEdges, drawn
// at whole-number scales only (x1 portrait, x2 top bar, x3 dock, x4 / x6 title screen). Each frame
// is built once per sprite and shown or hidden, so a frame change repaints only Dex.

import { composeFrame, DEX_COLORS, type FrameSpec } from "./frames.ts";

const NS = "http://www.w3.org/2000/svg";
const cache = new Map<string, [number, number, number, string][]>();

function keyOf(spec: FrameSpec): string {
  return `${spec.face}|${spec.hands}|${spec.antenna}|${spec.flame}|${(spec.extras ?? []).join(",")}|${spec.droop ? 1 : 0}`;
}

/** The colour runs of a frame: [x, y, width, colour]. */
export function frameRuns(spec: FrameSpec): [number, number, number, string][] {
  const key = keyOf(spec);
  let runs = cache.get(key);
  if (!runs) {
    runs = [];
    composeFrame(spec).forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x] as string;
        let w = 1;
        while (row[x + w] === ch) w++;
        if (ch !== ".") (runs as [number, number, number, string][]).push([x, y, w, DEX_COLORS[ch] ?? "#ff00ff"]);
        x += w;
      }
    });
    cache.set(key, runs);
  }
  return runs;
}

function group(spec: FrameSpec): SVGGElement {
  const g = document.createElementNS(NS, "g");
  for (const [x, y, w, fill] of frameRuns(spec)) {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", "1");
    r.setAttribute("fill", fill);
    g.appendChild(r);
  }
  return g;
}

/** One Dex on the page: an SVG whose frames are built on first use and toggled. */
export class DexSprite {
  readonly svg: SVGSVGElement;
  private readonly frames = new Map<string, SVGGElement>();
  private shown: SVGGElement | null = null;

  /** rows: how much of the 32-row grid to show from the top (the phone top bar crops the bottom). */
  constructor(scale: number, rows = 32) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 32 ${rows}`);
    this.svg.setAttribute("width", String(32 * scale));
    this.svg.setAttribute("height", String(rows * scale));
    this.svg.setAttribute("shape-rendering", "crispEdges");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.setAttribute("focusable", "false");
    this.svg.classList.add("dex-svg");
  }

  show(spec: FrameSpec): void {
    const key = keyOf(spec);
    let g = this.frames.get(key);
    if (!g) {
      g = group(spec);
      g.setAttribute("display", "none");
      this.frames.set(key, g);
      this.svg.appendChild(g);
    }
    if (g === this.shown) return;
    this.shown?.setAttribute("display", "none");
    g.removeAttribute("display");
    this.shown = g;
  }
}

/** A still Dex (the portrait in each answer). */
export function dexStill(scale: number, spec: FrameSpec = { face: "neutral", hands: "rest", antenna: "normal", flame: 0 }): SVGSVGElement {
  const s = new DexSprite(scale);
  s.show(spec);
  return s.svg;
}
