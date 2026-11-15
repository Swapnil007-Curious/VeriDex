// The title-screen logo builds in row by row (`steps()`, under 600 ms) on a visit that has not
// painted yet; the arcade intro (src/intro/intro.ts) replaced the old boot screen.

import { reducedMotion } from "./motion.ts";

function painted(): boolean {
  try {
    return performance.getEntriesByType("paint").some((e) => e.name === "first-contentful-paint");
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
