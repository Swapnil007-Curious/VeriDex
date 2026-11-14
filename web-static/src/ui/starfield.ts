// The background starfield: a canvas with 48 pixel stars that twinkle in steps four times a second.
// It pauses while the tab is hidden and is drawn once (static) under reduced motion. Decorative:
// the canvas is aria-hidden.

import { reducedMotion } from "./motion.ts";

const STARS = 48;
const TICK_MS = 250;

interface Star {
  x: number;
  y: number;
  size: number;
  level: number; // 0..3 brightness step
}

export function startStarfield(canvas: HTMLCanvasElement, color: () => string): { redraw(): void } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { redraw: () => undefined };
  let stars: Star[] = [];
  let timer = 0;
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const layout = (): void => {
    const w = Math.ceil(window.innerWidth / 4);
    const h = Math.ceil(window.innerHeight / 4);
    canvas.width = w;
    canvas.height = h;
    seed = 7;
    stars = Array.from({ length: STARS }, () => ({ x: Math.floor(rand() * w), y: Math.floor(rand() * h), size: rand() < 0.2 ? 2 : 1, level: Math.floor(rand() * 4) }));
  };
  const draw = (): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color();
    for (const s of stars) {
      ctx.globalAlpha = [0.15, 0.3, 0.5, 0.75][s.level] ?? 0.3;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
  };
  const tick = (): void => {
    for (let i = 0; i < 5; i++) {
      const s = stars[Math.floor(rand() * stars.length)];
      if (s) s.level = (s.level + 1 + Math.floor(rand() * 2)) % 4;
    }
    draw();
  };
  const run = (): void => {
    clearInterval(timer);
    timer = 0;
    if (!document.hidden && !reducedMotion()) timer = window.setInterval(tick, TICK_MS);
  };
  layout();
  draw();
  run();
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
      draw();
    }, 150);
  });
  document.addEventListener("visibilitychange", run);
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => {
    run();
    draw();
  });
  return { redraw: draw };
}
