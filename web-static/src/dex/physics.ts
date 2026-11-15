// The physics of the floating Dex, kept pure so it can be unit-tested: where a throw comes to rest
// (Apple's momentum projection), the bounds he must stay inside, edge snapping, rubber-banding,
// keeping clear of the composer, his position as a fraction of the viewport, which side his speech
// bubble goes on, and a damped spring stepped frame by frame.

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const DECELERATION = 0.995;
export const EDGE_SNAP = 48;
export const CLICK_SLOP = 6;

/** Where a flick comes to rest (Apple's projection; velocity in px/s). */
export function project(velocity: number, rate = DECELERATION): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Progressive resistance past a boundary. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** The box Dex's top-left corner may occupy: the viewport less the margin and the safe-area insets. */
export function bounds(viewport: Size, size: Size, margin = 12, insets: Rect = { left: 0, top: 0, right: 0, bottom: 0 }): Rect {
  const left = margin + insets.left;
  const top = margin + insets.top;
  return {
    left,
    top,
    right: Math.max(left, viewport.w - margin - insets.right - size.w),
    bottom: Math.max(top, viewport.h - margin - insets.bottom - size.h),
  };
}

export function clamp(p: Point, b: Rect): Point {
  return { x: Math.min(b.right, Math.max(b.left, p.x)), y: Math.min(b.bottom, Math.max(b.top, p.y)) };
}

/** Within EDGE_SNAP of an edge, snap onto it (each axis on its own). */
export function snapToEdges(p: Point, b: Rect, distance = EDGE_SNAP): { point: Point; snapped: boolean } {
  let { x, y } = p;
  let snapped = false;
  if (x - b.left <= distance) [x, snapped] = [b.left, true];
  else if (b.right - x <= distance) [x, snapped] = [b.right, true];
  if (y - b.top <= distance) [y, snapped] = [b.top, true];
  else if (b.bottom - y <= distance) [y, snapped] = [b.bottom, true];
  return { point: { x, y }, snapped };
}

function overlaps(p: Point, size: Size, r: Rect): boolean {
  return p.x < r.right && p.x + size.w > r.left && p.y < r.bottom && p.y + size.h > r.top;
}

/** Off the composer: when Dex overlaps it, the nearest free spot above it (still inside the bounds). */
export function avoid(p: Point, size: Size, composer: Rect | null, b: Rect, gap = 8): Point {
  if (!composer || !overlaps(p, size, composer)) return p;
  return clamp({ x: p.x, y: composer.top - size.h - gap }, b);
}

export interface Release {
  target: Point;
  snapped: boolean;
  /** The throw would have left the bounds on this axis (the motion rubber-bands back). */
  overshoot: { x: boolean; y: boolean };
}

/** Where a release with velocity v (px/s) ends: projected, clamped, snapped to an edge, off the composer. */
export function release(p: Point, v: Point, size: Size, b: Rect, composer: Rect | null, opts: { momentum?: boolean } = {}): Release {
  const momentum = opts.momentum ?? true;
  const projected = momentum ? { x: p.x + project(v.x), y: p.y + project(v.y) } : p;
  const clamped = clamp(projected, b);
  const overshoot = { x: projected.x !== clamped.x, y: projected.y !== clamped.y };
  const snap = snapToEdges(clamped, b);
  const target = avoid(snap.point, size, composer, b);
  return { target, snapped: snap.snapped, overshoot };
}

/** A position as fractions of the viewport (what is remembered), and back. */
export function toFraction(p: Point, viewport: Size): Point {
  return { x: viewport.w ? p.x / viewport.w : 0, y: viewport.h ? p.y / viewport.h : 0 };
}
export function fromFraction(f: Point, viewport: Size): Point {
  return { x: f.x * viewport.w, y: f.y * viewport.h };
}

export type BubbleSide = "right" | "left" | "top" | "bottom";

/** The side of Dex his bubble fits on: right, else left, else above, else below. */
export function bubbleSide(dex: Rect, bubble: Size, viewport: Size, margin = 12, gap = 12): BubbleSide {
  if (dex.right + gap + bubble.w <= viewport.w - margin) return "right";
  if (dex.left - gap - bubble.w >= margin) return "left";
  if (dex.top - gap - bubble.h >= margin) return "top";
  return "bottom";
}

/** Where the bubble's top-left goes for a side, kept inside the viewport. */
export function bubblePosition(side: BubbleSide, dex: Rect, bubble: Size, viewport: Size, margin = 12, gap = 12): Point {
  const midX = (dex.left + dex.right) / 2;
  let p: Point;
  if (side === "right") p = { x: dex.right + gap, y: dex.top + (dex.bottom - dex.top) * 0.18 };
  else if (side === "left") p = { x: dex.left - gap - bubble.w, y: dex.top + (dex.bottom - dex.top) * 0.18 };
  else if (side === "top") p = { x: midX - bubble.w / 2, y: dex.top - gap - bubble.h };
  else p = { x: midX - bubble.w / 2, y: dex.bottom + gap };
  return {
    x: Math.min(viewport.w - margin - bubble.w, Math.max(margin, p.x)),
    y: Math.min(viewport.h - margin - bubble.h, Math.max(margin, p.y)),
  };
}

// ------------------------------------------------------------------ a damped spring, stepped per frame

export interface SpringParams {
  stiffness: number;
  damping: number;
}

/** Apple-style parameters: bounce 0 is critically damped; duration is the response in seconds. */
export function springParams(bounce: number, duration: number): SpringParams {
  const ratio = 1 - Math.min(0.99, Math.max(0, bounce));
  const omega = (2 * Math.PI) / duration;
  return { stiffness: omega * omega, damping: 2 * ratio * omega };
}

export interface AxisState {
  x: number;
  v: number;
}

/** Advance one axis by dt seconds toward target (semi-implicit Euler, sub-stepped for stability). */
export function stepSpring(s: AxisState, target: number, p: SpringParams, dt: number): AxisState {
  let { x, v } = s;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -p.stiffness * (x - target) - p.damping * v;
    v += a * h;
    x += v * h;
  }
  return { x, v };
}

export function settled(s: AxisState, target: number): boolean {
  return Math.abs(s.x - target) < 0.5 && Math.abs(s.v) < 8;
}

/** Velocity (px/s) on two axes from the last 100 ms of pointer samples. */
export class Velocity2D {
  private samples: { t: number; x: number; y: number }[] = [];
  add(x: number, y: number, t: number): void {
    this.samples.push({ t, x, y });
    this.samples = this.samples.filter((s) => t - s.t <= 100);
  }
  /** The velocity at time `now` (ms): samples older than 100 ms by then no longer count (a pause before the release means a drop, not a throw). */
  get(now?: number): Point {
    const s = now === undefined ? this.samples : this.samples.filter((p) => now - p.t <= 100);
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0] as { t: number; x: number; y: number };
    const b = s[s.length - 1] as { t: number; x: number; y: number };
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
  }
  reset(): void {
    this.samples = [];
  }
}
