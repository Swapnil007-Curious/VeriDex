// Dex on the page: the sprites (title screen, chat dock, phone top bar), the frame ticker, the
// speech bubbles with live status lines from real events, blinking, sleeping after two minutes,
// waking on any input. The ticker pauses while the tab is hidden; under reduced motion each state
// shows one still frame and nothing bobs, jumps or sparkles. Sprites are aria-hidden; every bubble
// line is also sent to the page's polite live region.

import { react, type DexEvent } from "./brain.ts";
import { BLINK, stateFrames, type DexState, type FrameSpec } from "./frames.ts";
import { DexSprite } from "./sprite.ts";

const SLEEP_AFTER_MS = 120_000;
const BUBBLE_MS = 3000;

export interface DexHost {
  el: HTMLElement; // the container (it gets the state in data-dex-state)
  scale: number;
  rows?: number;
  /** The host's speech bubble; one with data-default keeps that text between status lines. */
  bubble?: HTMLElement | null;
}

export interface DexOptions {
  reducedMotion(): boolean;
  effects(): boolean; // game effects: jumps and sparkles
  announce(text: string): void;
  /** Where a bubble goes when its host is not on screen (phone: a toast above the composer). */
  toast: HTMLElement | null;
}

export class Dex {
  private readonly sprites: { host: DexHost; sprite: DexSprite }[] = [];
  state: DexState = "idle";
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

  constructor(
    hosts: DexHost[],
    private readonly opts: DexOptions,
  ) {
    for (const host of hosts) {
      const sprite = new DexSprite(host.scale, host.rows);
      host.el.prepend(sprite.svg);
      this.sprites.push({ host, sprite });
    }
    document.addEventListener("visibilitychange", () => this.schedule());
    for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => this.activity(), { passive: true });
    this.enter("idle");
    this.activity();
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
    if (this.state !== "speaking" || !this.frames.length) return;
    this.mouth = (this.mouth + 1) % this.frames.length;
    this.draw(this.frames[this.mouth] as FrameSpec);
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
    const { frames, fps } = stateFrames(state, { sparkles: this.opts.effects() && !this.opts.reducedMotion() });
    this.frames = frames;
    this.fps = fps;
    this.frame = 0;
    this.mouth = 0;
    for (const { host } of this.sprites) {
      host.el.dataset.dexState = state;
      host.el.classList.toggle("dex-jump", state === "happy" && this.opts.effects() && !this.opts.reducedMotion());
    }
    this.draw(frames[0] as FrameSpec);
    this.schedule();
  }

  private draw(spec: FrameSpec): void {
    for (const { sprite } of this.sprites) sprite.show(spec);
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
    if (this.state === "idle") this.blink();
  }

  private blink(): void {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = window.setTimeout(() => {
      if (this.state !== "idle" || document.hidden || this.opts.reducedMotion()) return;
      this.draw(BLINK);
      window.setTimeout(() => {
        if (this.state === "idle") this.draw(this.frames[this.frame] as FrameSpec);
        this.blink();
      }, 160);
    }, 3000 + Math.random() * 3000);
  }

  /** Clear the status line now (bubbles with a default text go back to it). */
  hush(): void {
    clearTimeout(this.bubbleTimer);
    this.restore();
  }

  private restore(): void {
    for (const { host } of this.sprites) {
      const b = host.bubble;
      if (!b) continue;
      if (b.dataset.default) {
        b.textContent = b.dataset.default;
        b.hidden = false;
      } else b.hidden = true;
    }
    if (this.opts.toast) this.opts.toast.hidden = true;
    this.lastLine = "";
  }

  /** A short status line in the bubble of every visible Dex (or the toast), gone after 3 s. */
  say(text: string): void {
    clearTimeout(this.bubbleTimer);
    let shown = false;
    for (const { host } of this.sprites) {
      const b = host.bubble;
      if (!b) continue;
      const visible = host.el.offsetParent !== null;
      b.textContent = text;
      b.hidden = !visible && !b.dataset.default;
      shown ||= visible;
    }
    const toast = this.opts.toast;
    if (toast) {
      toast.textContent = text;
      toast.hidden = shown;
    }
    if (text !== this.lastLine) this.opts.announce(text);
    this.lastLine = text;
    this.bubbleTimer = window.setTimeout(() => this.restore(), BUBBLE_MS);
  }
}
