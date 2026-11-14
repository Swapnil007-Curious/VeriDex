// The game's on-screen feedback: the player card and the phone's mini XP bar, the "+25 XP" float,
// the level-up banner (with a lazy-loaded confetti burst) and the achievement toasts. Everything
// here is hidden by Settings -> Game effects off (html.game-off) and skipped by the callers then.

import type { Achievement } from "../game/game.ts";
import type { Progress } from "../game/rules.ts";
import { $, el } from "./dom.ts";
import { pixelIcon } from "./icons.ts";
import { reducedMotion } from "./motion.ts";

const BLOCKS = 10;
let shownBlocks = -1;
let fillTimers: number[] = [];

/** Update the player card and the mini bar; new blocks fill one by one. */
export function renderHud(p: Progress, streak: number): void {
  $("lv-badge").textContent = `LV ${p.level}`;
  $("player-title").textContent = p.title;
  $("streak-n").textContent = String(streak);
  $("streak").classList.toggle("is-cold", streak === 0);
  $("mini-lv").textContent = `LV ${p.level}`;
  const frac = p.span ? p.into / p.span : 0;
  $("mini-fill").style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  const bar = $("xp-bar");
  bar.setAttribute("aria-valuemax", String(p.span));
  bar.setAttribute("aria-valuenow", String(p.into));
  bar.setAttribute("aria-valuetext", `Level ${p.level}, ${p.into} of ${p.span} XP`);
  $("xp-text").textContent = `${p.into} / ${p.span} XP`;
  if (bar.children.length !== BLOCKS) {
    bar.textContent = "";
    for (let i = 0; i < BLOCKS; i++) bar.appendChild(el("i"));
  }
  const filled = Math.min(BLOCKS, Math.floor(frac * BLOCKS));
  const blocks = [...bar.children] as HTMLElement[];
  for (const t of fillTimers) clearTimeout(t);
  fillTimers = [];
  const from = shownBlocks < 0 || filled < shownBlocks || reducedMotion() ? filled : shownBlocks;
  blocks.forEach((b, i) => b.classList.toggle("on", i < from));
  for (let i = from; i < filled; i++) {
    fillTimers.push(
      window.setTimeout(() => {
        const b = blocks[i];
        if (!b) return;
        b.classList.add("on", "pop");
        b.addEventListener("animationend", () => b.classList.remove("pop"), { once: true });
      }, (i - from) * 70),
    );
  }
  shownBlocks = filled;
}

/** "+25 XP" rising from a message. */
export function xpFloat(host: HTMLElement, gained: number): void {
  if (gained <= 0 || document.documentElement.classList.contains("game-off")) return;
  const f = el("span", "xp-float", `+${gained} XP`);
  f.setAttribute("aria-hidden", "true");
  host.appendChild(f);
  f.addEventListener("animationend", () => f.remove(), { once: true });
  setTimeout(() => f.remove(), 2000);
}

let levelTimer = 0;

export function dismissLevelUp(): boolean {
  const box = $("levelup");
  if (box.hidden) return false;
  clearTimeout(levelTimer);
  box.hidden = true;
  box.textContent = "";
  return true;
}

export function showLevelUp(p: Progress): void {
  const box = $("levelup");
  box.textContent = "";
  const card = el("div", "levelup-card");
  card.setAttribute("role", "status");
  card.appendChild(el("p", "levelup-kicker", "Level up!"));
  card.appendChild(el("p", "levelup-line", `LV ${p.level} · ${p.title}`));
  card.appendChild(el("p", "levelup-hint", "Click or press Esc"));
  box.appendChild(card);
  box.hidden = false;
  box.onclick = () => dismissLevelUp();
  clearTimeout(levelTimer);
  levelTimer = window.setTimeout(dismissLevelUp, 2500);
  if (!reducedMotion()) void import("./confetti.ts").then((m) => m.burst());
}

export function trophyToast(a: Achievement): void {
  const host = $("trophies");
  const t = el("div", "trophy-toast");
  t.setAttribute("role", "status");
  const icon = el("span", "t-icon");
  icon.appendChild(pixelIcon(a.icon, 32));
  t.append(icon, el("span", "t-kicker", "Achievement unlocked"), el("span", "t-name", a.name));
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    t.addEventListener("animationend", () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400);
  }, 4000);
}
