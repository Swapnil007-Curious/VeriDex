// Dex on the page: one floating sprite above the content (below dialogs, sheets and toasts), at a
// whole-number scale from Settings (Large x7 by default; on phones Large is x5, Medium x4), with a
// speech bubble that picks the side where it fits. The frame ticker pauses while the tab is hidden;
// under reduced motion each state shows one still frame. Status lines from real app events go to
// the bubble and to a polite live region. He blinks, sleeps after two minutes, wakes on any input,
// and can be picked up and thrown (mover.ts). The answer portrait follows his frames (onFrame).

import { react, type DexEvent } from "./brain.ts";
import { BLINK, stateFrames, type DexState, type FrameSpec } from "./frames.ts";
import { Mover, positionStore } from "./mover.ts";
import { bubblePosition, bubbleSide, type Point, type Rect, type Size } from "./physics.ts";
import { DexSprite } from "./sprite.ts";

const SLEEP_AFTER_MS = 120_000;
const BUBBLE_MS = 3000;
const DRAG_LINES = ["Wheee!", "Where to?", "Hold on tight!"];

export type DexSize = "small" | "medium" | "large";

/** The integer scale for a size setting at a viewport width. */
export function dexScale(size: DexSize, width: number): number {
  const phone = width < 700;
  if (size === "small") return 3;
  if (size === "medium") return phone ? 4 : 5;
  return phone ? 5 : 7;
}

export interface DexOptions {
  button: HTMLElement;
  bubble: HTMLElement;
  reducedMotion(): boolean;
  effects(): boolean; // game effects: hops, sparkles, drag lines
  size(): DexSize;
  announce(text: string): void;
  home(size: Size): Point;
  composer(): Rect | null;
  onActivate(): void;
  onFrame?(spec: FrameSpec): void;
}

function safeInsets(): Rect {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = { top: Number.parseFloat(cs.paddingTop) || 0, right: Number.parseFloat(cs.paddingRight) || 0, bottom: Number.parseFloat(cs.paddingBottom) || 0, left: Number.parseFloat(cs.paddingLeft) || 0 };
  probe.remove();
  return r;
}

export class Dex {
  state: DexState = "idle";
  readonly mover: Mover;
  private readonly sprite: DexSprite;
  private scale = 0;
  private carried = false;
  private frames: FrameSpec[] = [];
  private frame = 0;
  private fps = 3;
  private ticker = 0;
  private holdTimer = 0;
  private blinkTimer = 0;
  private sleepTimer = 0;
  private bubbleTimer = 0;
  private lastLine = "";
  private mouth = 0;
  private insets: Rect = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(private readonly opts: DexOptions) {
    this.sprite = new DexSprite(1);
    opts.button.appendChild(this.sprite.svg);
    this.insets = safeInsets();
    this.mover = new Mover(opts.button, {
      reducedMotion: opts.reducedMotion,
      home: opts.home,
      composer: opts.composer,
      insets: () => this.insets,
      store: positionStore(),
      onCarry: (on) => this.carry(on),
      onDragStart: () => {
        if (this.opts.effects()) this.say(DRAG_LINES[Math.floor(Math.random() * DRAG_LINES.length)] as string, 1600);
      },
      onActivate: opts.onActivate,
      onMove: () => this.placeBubble(),
    });
    document.addEventListener("visibilitychange", () => this.schedule());
    for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => this.activity(), { passive: true });
    const relayout = (): void => {
      this.insets = safeInsets();
      this.resize();
    };
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", relayout);
    this.resize();
    this.enter("idle");
    this.activity();
  }

  /** Apply the size setting (and the phone mapping), then re-place him. */
  resize(): void {
    const scale = dexScale(this.opts.size(), window.innerWidth);
    const px = 32 * scale;
    if (scale !== this.scale) {
      this.scale = scale;
      this.sprite.svg.setAttribute("width", String(px));
      this.sprite.svg.setAttribute("height", String(px));
      this.opts.button.style.setProperty("--dex-px", `${scale}px`);
      this.opts.button.dataset.scale = String(scale);
      document.documentElement.style.setProperty("--dex-size", `${px}px`);
      this.mover.setSize({ w: px, h: px });
    } else this.mover.layout();
    this.opts.bubble.dataset.size = this.opts.size();
    this.placeBubble();
  }

  send(event: DexEvent): void {
    if (event.type !== "idle-timeout") this.activity();
    const r = react(event, this.state);
    if (!r) return;
    if (r.bubble) this.say(r.bubble);
    else if (r.bubble === "") this.hush();
    this.enter(r.state);
    clearTimeout(this.holdTimer);
    if (r.holdMs !== null) this.holdTimer = window.setTimeout(() => this.enter("idle"), r.holdMs);
  }

  /** A word was spoken: advance the mouth (speech boundary events drive it; the ticker is the fallback). */
  word(): void {
    if (this.state !== "speaking" || this.carried || !this.frames.length) return;
    this.mouth = (this.mouth + 1) % this.frames.length;
    this.draw(this.frames[this.mouth] as FrameSpec);
  }

  private carry(on: boolean): void {
    this.carried = on;
    this.opts.button.classList.toggle("dex-carried", on && !this.opts.reducedMotion());
    this.enter(this.state);
  }

  private activity(): void {
    if (this.state === "sleeping") {
      const r = react({ type: "activity" }, this.state);
      if (r) this.enter(r.state);
    }
    clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => this.send({ type: "idle-timeout" }), SLEEP_AFTER_MS);
  }

  private enter(state: DexState): void {
    this.state = state;
    const shown: DexState = this.carried ? "carried" : state;
    const { frames, fps } = stateFrames(shown, { sparkles: this.opts.effects() && !this.opts.reducedMotion() });
    this.frames = frames;
    this.fps = fps;
    this.frame = 0;
    this.mouth = 0;
    const b = this.opts.button;
    b.dataset.dexState = shown;
    b.classList.toggle("dex-jump", shown === "happy" && this.opts.effects() && !this.opts.reducedMotion());
    this.draw(frames[0] as FrameSpec);
    this.schedule();
  }

  private draw(spec: FrameSpec): void {
    this.sprite.show(spec);
    this.opts.onFrame?.(spec);
  }

  /** Run the frame ticker and the idle blink, unless the tab is hidden or motion is reduced. */
  private schedule(): void {
    clearInterval(this.ticker);
    clearTimeout(this.blinkTimer);
    this.ticker = 0;
    if (document.hidden || this.opts.reducedMotion()) return;
    if (this.frames.length > 1) {
      this.ticker = window.setInterval(() => {
        this.frame = (this.frame + 1) % this.frames.length;
        this.draw(this.frames[this.frame] as FrameSpec);
      }, Math.round(1000 / this.fps));
    }
    if (this.state === "idle" && !this.carried) this.blink();
  }

  private blink(): void {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = window.setTimeout(() => {
      if (this.state !== "idle" || this.carried || document.hidden || this.opts.reducedMotion()) return;
      this.draw(BLINK);
      window.setTimeout(() => {
        if (this.state === "idle" && !this.carried) this.draw(this.frames[this.frame] as FrameSpec);
        this.blink();
      }, 160);
    }, 3000 + Math.random() * 3000);
  }

  // -------------------------------------------------------------- the speech bubble

  /** Keep the bubble beside him on the side where it fits (right, left, above, below). */
  placeBubble(): void {
    const bubble = this.opts.bubble;
    if (bubble.hidden) return;
    const p = this.mover.pos;
    const s = this.mover.size;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const view = { w: vw, h: window.innerHeight };
    const box = { w: bubble.offsetWidth, h: bubble.offsetHeight };
    // the sprite's drawn area is inset a little from its square box
    const dex = { left: p.x + s.w * 0.06, top: p.y, right: p.x + s.w * 0.94, bottom: p.y + s.h * 0.9 };
    const side = bubbleSide(dex, box, view);
    const at = bubblePosition(side, dex, box, view);
    bubble.dataset.side = side;
    bubble.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`;
  }

  /** Clear the status line now. */
  hush(): void {
    clearTimeout(this.bubbleTimer);
    this.opts.bubble.hidden = true;
    this.lastLine = "";
  }

  /** A short status line in his bubble (and the live region), gone after ``ms``. */
  say(text: string, ms = BUBBLE_MS): void {
    clearTimeout(this.bubbleTimer);
    const bubble = this.opts.bubble;
    bubble.textContent = text;
    bubble.hidden = false;
    this.placeBubble();
    if (text !== this.lastLine) this.opts.announce(text);
    this.lastLine = text;
    this.bubbleTimer = window.setTimeout(() => this.hush(), ms);
  }
}
