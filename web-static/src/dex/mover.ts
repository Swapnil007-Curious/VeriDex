// Moving the floating Dex. Pointer Events (mouse, touch, pen): pointerdown captures the pointer
// and keeps the grab offset; he tracks 1:1 with transform only (rubber-banding past the edges) and a
// short velocity history is kept. On release the throw is projected (deceleration 0.995), clamped
// inside the viewport (12 px plus the safe-area insets), snapped to an edge within 48 px with a
// spring (bounce 0.2, 0.35 s) that carries the release velocity, and moved off the composer if he
// landed on it. A press that moves less than 6 px is a click; two clicks send him home. Arrow keys
// move him 16 px (Shift 64), Home sends him home. His position is remembered as a fraction of the
// viewport and re-clamped on resize. Under reduced motion he goes straight to the drop point.

import { avoid, bounds, CLICK_SLOP, clamp, fromFraction, release, rubberband, settled, springParams, stepSpring, toFraction, Velocity2D, type AxisState, type Point, type Rect, type Size } from "./physics.ts";

const KEY = "veridex.dex.position.v1";
const DOUBLE_MS = 300;

export interface MoverOptions {
  reducedMotion(): boolean;
  home(size: Size): Point;
  composer(): Rect | null;
  insets(): Rect;
  store: { get(): Point | null; set(p: Point | null): void };
  onCarry(carried: boolean): void;
  onDragStart(): void;
  onActivate(): void;
  onMove(p: Point): void;
}

/** localStorage for the remembered position, every access guarded. */
export function positionStore(): MoverOptions["store"] {
  return {
    get: () => {
      try {
        const raw = localStorage.getItem(KEY);
        const v = raw ? (JSON.parse(raw) as Point) : null;
        return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
      } catch {
        return null;
      }
    },
    set: (p) => {
      try {
        if (p) localStorage.setItem(KEY, JSON.stringify(p));
        else localStorage.removeItem(KEY);
      } catch {
        /* storage blocked: the position lasts until the tab closes */
      }
    },
  };
}

export class Mover {
  pos: Point = { x: 0, y: 0 };
  size: Size = { w: 0, h: 0 };
  /** No remembered position: he follows the layout's home spot. */
  atHome = true;
  moving = false;
  private grab: Point | null = null;
  private downAt: Point = { x: 0, y: 0 };
  private dragging = false;
  private pointerId: number | null = null;
  private readonly velocity = new Velocity2D();
  private raf = 0;
  private clickTimer = 0;
  private lastClick = Number.NEGATIVE_INFINITY;
  private pointerClick = false;
  private keyActivated = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly opts: MoverOptions,
  ) {
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", (e) => this.up(e, true));
    el.addEventListener("keydown", (e) => this.key(e));
    // a click from assistive technology (no pointer, no key) still activates
    el.addEventListener("click", (e) => {
      if (this.pointerClick || performance.now() - this.keyActivated < 600) {
        this.pointerClick = false;
        return;
      }
      if (e.detail === 0) this.opts.onActivate();
    });
    el.addEventListener("dblclick", (e) => e.preventDefault());
  }

  private viewport(): Size {
    return { w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight };
  }

  private box(): Rect {
    return bounds(this.viewport(), this.size, 12, this.opts.insets());
  }

  /** Set his size, then put him back where he belongs (remembered spot or home). */
  setSize(size: Size): void {
    this.size = size;
    this.el.style.width = `${size.w}px`;
    this.el.style.height = `${size.h}px`;
    this.layout();
  }

  /** Re-place after a resize, an orientation change or a layout change (the composer grew). */
  layout(): void {
    if (this.grab || this.moving) return;
    const saved = this.opts.store.get();
    this.atHome = !saved;
    const b = this.box();
    const target = saved ? fromFraction(saved, this.viewport()) : this.opts.home(this.size);
    this.render(avoid(clamp(target, b), this.size, this.opts.composer(), b));
  }

  private render(p: Point): void {
    this.pos = p;
    this.el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    this.el.dataset.x = String(Math.round(p.x));
    this.el.dataset.y = String(Math.round(p.y));
    this.opts.onMove(p);
  }

  private save(): void {
    this.atHome = false;
    this.opts.store.set(toFraction(this.pos, this.viewport()));
  }

  // -------------------------------------------------------------- pointer

  private down(e: PointerEvent): void {
    if (e.button !== 0 || this.pointerId !== null) return;
    cancelAnimationFrame(this.raf);
    this.moving = false;
    this.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone: tracking still works while it stays over him */
    }
    this.grab = { x: e.clientX - this.pos.x, y: e.clientY - this.pos.y };
    this.downAt = { x: e.clientX, y: e.clientY };
    this.dragging = false;
    this.velocity.reset();
    this.velocity.add(this.pos.x, this.pos.y, e.timeStamp);
    this.el.classList.add("is-grabbed");
    this.opts.onCarry(true);
  }

  private move(e: PointerEvent): void {
    if (!this.grab || e.pointerId !== this.pointerId) return;
    if (!this.dragging && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) >= CLICK_SLOP) {
      this.dragging = true;
      clearTimeout(this.clickTimer);
      this.opts.onDragStart();
    }
    if (!this.dragging) return;
    const raw = { x: e.clientX - this.grab.x, y: e.clientY - this.grab.y };
    const b = this.box();
    // past an edge he follows with resistance
    const band = (v: number, lo: number, hi: number, dim: number): number => (v < lo ? lo - rubberband(lo - v, dim) : v > hi ? hi + rubberband(v - hi, dim) : v);
    this.render({ x: band(raw.x, b.left, b.right, this.size.w), y: band(raw.y, b.top, b.bottom, this.size.h) });
    this.velocity.add(this.pos.x, this.pos.y, e.timeStamp);
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    this.grab = null;
    this.el.classList.remove("is-grabbed");
    this.opts.onCarry(false);
    if (this.dragging) {
      this.dragging = false;
      this.throwFrom(this.velocity.get(e.timeStamp));
      return;
    }
    if (cancelled) return;
    this.pointerClick = true;
    const now = e.timeStamp;
    if (now - this.lastClick < DOUBLE_MS) {
      // a double-click or double-tap: home, and the first click's activation is cancelled
      clearTimeout(this.clickTimer);
      this.lastClick = Number.NEGATIVE_INFINITY;
      this.goHome();
      return;
    }
    this.lastClick = now;
    clearTimeout(this.clickTimer);
    this.clickTimer = window.setTimeout(() => this.opts.onActivate(), DOUBLE_MS);
  }

  private throwFrom(v: Point): void {
    const b = this.box();
    const reduced = this.opts.reducedMotion();
    const r = release(this.pos, v, this.size, b, this.opts.composer(), { momentum: !reduced });
    if (reduced) {
      this.render(r.target);
      this.save();
      return;
    }
    this.animate(r.target, v, r.snapped ? springParams(0.2, 0.35) : springParams(0, 0.45), () => this.save());
  }

  // -------------------------------------------------------------- keyboard

  private key(e: KeyboardEvent): void {
    const step = e.shiftKey ? 64 : 16;
    const d: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.keyActivated = performance.now();
      this.opts.onActivate();
    } else if (e.key === "Home") {
      e.preventDefault();
      this.goHome();
    } else if (d[e.key]) {
      e.preventDefault();
      const delta = d[e.key] as Point;
      cancelAnimationFrame(this.raf);
      this.moving = false;
      const b = this.box();
      this.render(avoid(clamp({ x: this.pos.x + delta.x, y: this.pos.y + delta.y }, b), this.size, this.opts.composer(), b));
      this.save();
    }
  }

  // -------------------------------------------------------------- motion

  /** Spring home (double-click, Home, Settings: Reset Dex position). */
  goHome(): void {
    this.opts.store.set(null);
    this.atHome = true;
    const b = this.box();
    const target = avoid(clamp(this.opts.home(this.size), b), this.size, this.opts.composer(), b);
    if (this.opts.reducedMotion()) this.render(target);
    else this.animate(target, { x: 0, y: 0 }, springParams(0.2, 0.35));
  }

  /** Start at ``from`` (the intro's Dex) and fly to where he belongs. */
  flyFrom(from: Point): void {
    const saved = this.opts.store.get();
    const b = this.box();
    const target = avoid(clamp(saved ? fromFraction(saved, this.viewport()) : this.opts.home(this.size), b), this.size, this.opts.composer(), b);
    if (this.opts.reducedMotion()) return this.render(target);
    this.render(from);
    this.animate(target, { x: 0, y: 0 }, springParams(0.2, 0.5));
  }

  private animate(target: Point, v: Point, params: ReturnType<typeof springParams>, done?: () => void): void {
    cancelAnimationFrame(this.raf);
    let sx: AxisState = { x: this.pos.x, v: v.x };
    let sy: AxisState = { x: this.pos.y, v: v.y };
    let last = performance.now();
    this.moving = true;
    this.el.dataset.moving = "true";
    const b = this.box();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sx = stepSpring(sx, target.x, params, dt);
      sy = stepSpring(sy, target.y, params, dt);
      // momentum past an edge rubber-bands instead of leaving the screen
      const band = (v: number, lo: number, hi: number, dim: number): number => (v < lo ? lo - rubberband(lo - v, dim) : v > hi ? hi + rubberband(v - hi, dim) : v);
      this.render({ x: band(sx.x, b.left, b.right, this.size.w), y: band(sy.x, b.top, b.bottom, this.size.h) });
      if (settled(sx, target.x) && settled(sy, target.y)) {
        this.render(target);
        this.moving = false;
        delete this.el.dataset.moving;
        done?.();
        return;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}
