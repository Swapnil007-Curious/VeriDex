// "Enter the game": the arcade opening, once per browser session (main.ts decides), loaded on
// demand. About 3.2 s to PRESS START: a CRT powers on, boot text types out with the real library
// progress, a pixel dissolve, the VERIDEX logo builds in 8 steps with the stripes, Dex flies in on
// his thruster and waves, PRESS START blinks over a slow parallax starfield. Any key, click or tap
// jumps to PRESS START; the next press enters the app with a diagonal pixel wipe while Dex flies to
// his spot. All pixel motion is stepped. Under reduced motion it is the logo and PRESS START, then
// a 400 ms fade. The overlay is a modal dialog (focus on PRESS START); the app underneath loads
// meanwhile and is inert until it closes. No network requests: the logo is cloned from the page.

import { stateFrames, type FrameSpec } from "../dex/frames.ts";
import type { Point } from "../dex/physics.ts";
import { DexSprite } from "../dex/sprite.ts";

export interface IntroHooks {
  logo: SVGSVGElement | null;
  reducedMotion: boolean;
  touch: boolean; // "TAP TO START"
  sound(): boolean;
  toggleSound(): boolean;
  jingle(): void;
  progress(listener: (fraction: number, done: boolean) => void): () => void;
  announce(text: string): void;
  /** START was pressed: where the intro's Dex is, so the floating Dex can fly on from there. */
  onStart(from: Point | null): void;
}

type Stage = "crt" | "boot" | "logo" | "dex" | "press" | "leaving";

const BG = "#120806";
const LINES = ["VERIDEX OS v1.0", "> CHECKING MEMORY ........ OK", "> LOADING LIBRARY ........ ", "> WAKING DEX ............. OK"];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function playIntro(hooks: IntroHooks): Promise<void> {
  return new Promise((resolve) => {
    const root = document.documentElement;
    const app = document.getElementById("app");
    const timers: number[] = [];
    const intervals: number[] = [];
    const at = (ms: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, ms));
    };
    let stage: Stage = "crt";
    let started = false;

    // ---------------------------------------------------------------- the overlay
    const overlay = h("div", "intro");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "intro-heading");
    const heading = h("h1", "visually-hidden", "Veridex");
    heading.id = "intro-heading";
    const stars = h("canvas", "intro-stars");
    stars.setAttribute("aria-hidden", "true");
    const power = h("div", "intro-power");
    power.setAttribute("aria-hidden", "true");
    power.append(h("i", "intro-line"), h("i", "intro-roll"));

    const boot = h("div", "intro-boot");
    boot.setAttribute("aria-hidden", "true");
    const lineEls = LINES.map((text) => {
      const p = h("p", "ib-line");
      p.dataset.text = text;
      boot.appendChild(p);
      return p;
    });
    const bar = h("span", "ib-bar");
    const segs = Array.from({ length: 10 }, () => bar.appendChild(h("i")));
    const pct = h("span", "ib-pct");

    const title = h("div", "intro-title");
    const hero = h("div", "intro-hero");
    const logoBox = h("div", "intro-logo");
    if (hooks.logo) {
      const clone = hooks.logo.cloneNode(true) as SVGSVGElement;
      clone.classList.remove("build");
      clone.setAttribute("aria-hidden", "true");
      clone.removeAttribute("role");
      logoBox.appendChild(clone);
    }
    const dexBox = h("div", "intro-dex");
    dexBox.setAttribute("aria-hidden", "true");
    const scale = window.innerWidth < 700 ? 4 : 5;
    const sprite = new DexSprite(scale);
    const bubble = h("p", "dex-bubble intro-bubble", "Ready, player one?");
    bubble.dataset.side = "top";
    bubble.hidden = true;
    dexBox.append(sprite.svg, bubble);
    hero.append(logoBox, dexBox);
    const stripes = h("div", "intro-stripes");
    stripes.setAttribute("aria-hidden", "true");
    stripes.append(h("i"), h("i"), h("i"));
    const startBtn = h("button", "intro-start");
    startBtn.type = "button";
    startBtn.append(h("span", "intro-cursor", "▶"), h("span", undefined, hooks.touch ? "TAP TO START" : "PRESS START"));
    (startBtn.firstChild as HTMLElement).setAttribute("aria-hidden", "true");
    const row = h("p", "intro-row");
    const soundBtn = h("button", "intro-sound");
    soundBtn.type = "button";
    const syncSound = (on: boolean): void => {
      soundBtn.textContent = `[SOUND: ${on ? "ON" : "OFF"}]`;
      soundBtn.setAttribute("aria-pressed", String(on));
    };
    syncSound(hooks.sound());
    row.append(soundBtn, h("span", undefined, "© Veridex"));
    title.append(hero, stripes, startBtn, row);

    const skip = h("button", "intro-skip", "SKIP ▸");
    skip.type = "button";
    const wipe = h("canvas", "intro-wipe");
    wipe.setAttribute("aria-hidden", "true");
    overlay.append(heading, stars, power, boot, title, skip, wipe);

    document.body.appendChild(overlay);
    document.getElementById("intro-cover")?.remove();
    root.classList.add("intro-open");
    if (app) app.inert = true;
    startBtn.focus({ preventScroll: true });
    hooks.announce("Veridex is loading");

    // ---------------------------------------------------------------- Dex's frames
    let dexTimer = 0;
    const playFrames = (frames: FrameSpec[], fps: number): void => {
      clearInterval(dexTimer);
      let i = 0;
      sprite.show(frames[0] as FrameSpec);
      if (hooks.reducedMotion || frames.length < 2) return;
      dexTimer = window.setInterval(() => {
        i = (i + 1) % frames.length;
        sprite.show(frames[i] as FrameSpec);
      }, Math.round(1000 / fps));
      intervals.push(dexTimer);
    };
    const flying: FrameSpec[] = [0, 1, 2].map((flame) => ({ face: "happy", hands: "up", antenna: "glow", flame: flame as 0 | 1 | 2 }));
    const greet = (): void => {
      const g = stateFrames("greeting", { sparkles: false });
      playFrames(g.frames, g.fps);
      bubble.hidden = false;
    };

    // ---------------------------------------------------------------- the starfield (two parallax layers, 8 fps)
    const startStars = (): void => {
      const ctx = stars.getContext("2d");
      if (!ctx) return;
      const w = (stars.width = Math.ceil(window.innerWidth / 3));
      const ht = (stars.height = Math.ceil(window.innerHeight / 3));
      const layers = [0.5, 1.5].map((speed) => ({ speed, pts: Array.from({ length: 36 }, () => ({ x: Math.random() * w, y: Math.random() * ht })) }));
      const draw = (): void => {
        ctx.clearRect(0, 0, w, ht);
        for (const [li, layer] of layers.entries()) {
          ctx.fillStyle = li ? "#F6E3B4" : "#8A6248";
          for (const p of layer.pts) {
            p.x -= layer.speed;
            if (p.x < 0) p.x += w;
            ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
          }
        }
      };
      draw();
      if (!hooks.reducedMotion) intervals.push(window.setInterval(draw, 125));
    };

    // ---------------------------------------------------------------- the library bar
    const stopProgress = hooks.progress((f, done) => {
      const n = done ? 10 : Math.floor(Math.max(0, Math.min(1, f)) * 10);
      segs.forEach((s, i) => s.classList.toggle("on", i < n));
      pct.textContent = done ? " OK" : ` ${Math.floor(f * 100)}%`;
    });

    // ---------------------------------------------------------------- the stages
    const typeLine = (el: HTMLElement, startMs: number, perChar = 9): number => {
      const text = el.dataset.text ?? "";
      const chunk = 3;
      for (let i = chunk; i < text.length + chunk; i += chunk) at(startMs + (i / chunk) * perChar * chunk, () => (el.textContent = text.slice(0, i)));
      return startMs + Math.ceil(text.length / chunk) * perChar * chunk;
    };

    const showPress = (): void => {
      stage = "press";
      overlay.dataset.stage = "press";
      startBtn.focus({ preventScroll: true });
    };

    /** Everything in its final place, then PRESS START (a skip lands here too). */
    const toPress = (): void => {
      if (stage === "press" || stage === "leaving") return;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      boot.hidden = true;
      overlay.classList.add("powered", "titled", "dexed");
      if (!overlay.classList.contains("starry")) {
        overlay.classList.add("starry");
        startStars();
      }
      greet();
      showPress();
    };

    const run = (): void => {
      overlay.dataset.stage = "crt";
      // 0.0 s: the CRT powers on (a line opens to the full screen, a flash, a scanline roll)
      at(20, () => overlay.classList.add("powering"));
      at(420, () => overlay.classList.add("powered"));
      // 0.5 s: boot text, the real library bar on the third line
      at(500, () => {
        stage = "boot";
        overlay.dataset.stage = "boot";
      });
      let t = 520;
      for (const [i, el] of lineEls.entries()) {
        t = typeLine(el, t) + 40;
        if (i === 2) at(t - 30, () => el.append(bar, pct));
      }
      // 1.6 s: pixel dissolve, then the logo builds and the stripes slide in, stars start
      at(1600, () => dissolve(220, () => {
        stage = "logo";
        overlay.dataset.stage = "logo";
        overlay.classList.add("titled", "starry");
        startStars();
      }));
      // 2.3 s: Dex flies in from the bottom-right, overshoots, settles, waves
      at(2300, () => {
        stage = "dex";
        overlay.dataset.stage = "dex";
        overlay.classList.add("dexed");
        playFrames(flying, 12);
        const r = dexBox.getBoundingClientRect();
        const dx = window.innerWidth - r.left;
        const dy = window.innerHeight - r.top;
        dexBox.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, easing: "steps(6, end)" },
            { transform: "translate(-10px, -10px)", offset: 0.8, easing: "steps(2, end)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 520, fill: "backwards" },
        );
      });
      at(2850, greet);
      // 3.0 s: PRESS START
      at(3050, showPress);
    };

    /** Random 16 px blocks in the screen colour over the boot text, then it is gone. */
    const dissolve = (ms: number, done: () => void): void => {
      const ctx = wipe.getContext("2d");
      const w = (wipe.width = window.innerWidth);
      const ht = (wipe.height = window.innerHeight);
      if (!ctx) return done();
      const cells: [number, number][] = [];
      for (let y = 0; y < ht; y += 16) for (let x = 0; x < w; x += 16) cells.push([x, y]);
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j] as [number, number], cells[i] as [number, number]];
      }
      ctx.fillStyle = BG;
      const steps = 4;
      for (let s = 1; s <= steps; s++) {
        at((ms / steps) * s, () => {
          for (const [x, y] of cells.slice(Math.floor(((s - 1) / steps) * cells.length), Math.floor((s / steps) * cells.length))) ctx.fillRect(x, y, 16, 16);
          if (s === steps) {
            boot.hidden = true;
            ctx.clearRect(0, 0, w, ht);
            done();
          }
        });
      }
    };

    // ---------------------------------------------------------------- START: a diagonal pixel wipe into the app
    const close = (): void => {
      for (const t of timers) clearTimeout(t);
      for (const i of intervals) clearInterval(i);
      stopProgress();
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", keepFocus, true);
      overlay.remove();
      if (app) app.inert = false;
      resolve();
    };

    const start = (): void => {
      if (started) return;
      started = true;
      stage = "leaving";
      hooks.jingle();
      const r = sprite.svg.getBoundingClientRect();
      const from = r.width ? { x: r.left, y: r.top } : null;
      root.classList.remove("intro-open");
      hooks.onStart(from);
      if (hooks.reducedMotion) {
        overlay.classList.add("fading");
        window.setTimeout(close, 400);
        return;
      }
      overlay.classList.add("wiping");
      const ctx = wipe.getContext("2d");
      const w = (wipe.width = window.innerWidth);
      const ht = (wipe.height = window.innerHeight);
      if (!ctx) return close();
      const cols = Math.ceil(w / 16);
      const rows = Math.ceil(ht / 16);
      const span = cols + rows;
      const steps = 9;
      const frame = (s: number): void => {
        ctx.clearRect(0, 0, w, ht);
        ctx.fillStyle = BG;
        const front = (s / steps) * (span + 4);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const d = front - (x + (rows - 1 - y)); // from the bottom-left corner, diagonally
            if (d >= 2) continue; // flipped: the app shows through
            const size = d >= 1 ? 6 : d >= 0 ? 12 : 16; // a block flips in two steps
            const o = (16 - size) / 2;
            ctx.fillRect(x * 16 + o, y * 16 + o, size, size);
          }
        }
      };
      for (let s = 0; s <= steps; s++) at((450 / steps) * s, () => (s === steps ? close() : frame(s)));
    };

    // ---------------------------------------------------------------- input: skip, start, sound
    const onKey = (e: KeyboardEvent): void => {
      if (["Tab", "Shift", "Alt", "Control", "Meta"].includes(e.key)) return;
      if ((e.target === soundBtn || e.target === skip) && (e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      e.stopPropagation();
      if (stage === "press") start();
      else toPress();
    };
    // on the window: a key counts even if focus wandered; focus is kept inside the dialog
    window.addEventListener("keydown", onKey, true);
    const keepFocus = (e: FocusEvent): void => {
      if (!overlay.contains(e.target as Node)) startBtn.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", keepFocus, true);
    overlay.addEventListener("click", (e) => {
      const target = e.target as Node;
      if (soundBtn.contains(target)) {
        syncSound(hooks.toggleSound());
        return;
      }
      if (skip.contains(target)) return toPress();
      if (stage === "press") start();
      else toPress();
    });

    if (hooks.reducedMotion) {
      overlay.classList.add("still", "powered", "titled", "dexed", "starry");
      startStars();
      greet();
      showPress();
    } else run();
  });
}
