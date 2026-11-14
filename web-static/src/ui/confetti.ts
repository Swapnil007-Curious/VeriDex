// Pixel confetti for a level-up: one canvas, at most 80 square particles snapped to a 4 px grid,
// one second, then removed. Loaded on first use; never called under reduced motion. Decorative.

const COLORS = ["#F7A531", "#F26A1B", "#C8321E", "#F6E3B4", "#3BD16F"];
const MAX = 80;

export function burst(): void {
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  const scale = 4;
  canvas.width = Math.ceil(window.innerWidth / scale);
  canvas.height = Math.ceil(window.innerHeight / scale);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const parts = Array.from({ length: MAX }, (_, i) => {
    const a = (i / MAX) * Math.PI * 2 + Math.random() * 0.4;
    const v = 40 + Math.random() * 90;
    return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, size: Math.random() < 0.3 ? 2 : 1, color: COLORS[i % COLORS.length] as string };
  });
  const start = performance.now();
  let last = start;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 160 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    if (now - start < 1000) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
