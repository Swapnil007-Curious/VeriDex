// The boot sequence: once per session, a 900 ms CRT power-on (a line widens and the screen opens,
// a scanline rolls), then the title-screen logo builds row by row. Any key or click skips it. It is
// skipped under reduced motion, without session storage, and when the page already painted before
// this script ran (a slow first load: a black screen after the content would only be a flash).

import { $ } from "./dom.ts";
import { reducedMotion } from "./motion.ts";

const KEY = "veridex.booted";

function painted(): boolean {
  try {
    return performance.getEntriesByType("paint").some((e) => e.name === "first-contentful-paint");
  } catch {
    return false;
  }
}

export function shouldBoot(): boolean {
  if (reducedMotion() || painted()) return false;
  try {
    return sessionStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

/** Build the hero logo in, row by row (only while it has not been seen yet, so it never flashes). */
export function buildLogo(force = false): void {
  const logo = document.querySelector<SVGElement>(".hero-logo");
  if (!logo || reducedMotion() || (!force && painted())) return;
  logo.classList.remove("build");
  void logo.getBoundingClientRect();
  logo.classList.add("build");
}

/**
 * Run the boot screen; resolves when it is over. The frames are stepped by timers (4 for the line,
 * 4 for the roll), so the screen is redrawn only when it changes.
 */
export function runBoot(onDone: () => void): Promise<void> {
  const boot = $("boot");
  const line = boot.querySelector<HTMLElement>(".boot-line");
  const roll = boot.querySelector<HTMLElement>(".boot-roll");
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* a blocked session store just means the boot may show again */
  }
  return new Promise<void>((resolve) => {
    const timers: number[] = [];
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
      boot.hidden = true;
      onDone();
      resolve();
    };
    const skip = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    const at = (ms: number, fn: () => void): void => {
      timers.push(window.setTimeout(fn, ms));
    };
    boot.hidden = false;
    if (line) line.style.transform = "scaleX(0)";
    if (roll) roll.style.opacity = "0";
    // the screen stays opaque until it ends: a translucent frame would make the browser draw the
    // whole page underneath it again, which is slow without a GPU
    for (let i = 1; i <= 4; i++) at(i * 80, () => line && (line.style.transform = `scaleX(${i / 4})`));
    for (let i = 0; i < 4; i++) {
      at(420 + i * 110, () => {
        if (roll) {
          roll.style.opacity = "1";
          roll.style.transform = `translateY(${i * 100}%)`;
        }
      });
    }
    at(900, finish);
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
  });
}
