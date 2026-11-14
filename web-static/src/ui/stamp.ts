// The verified stamp, shown only from real verifier output: VERIFIED (every sentence backed),
// PARTIAL (some), NO EVIDENCE (abstained or none backed). It slams in once, in three steps, with a
// two-frame screen nudge; reduced motion shows it without the slam.

import { el } from "./dom.ts";
import { pixelIcon } from "./icons.ts";
import { reducedMotion } from "./motion.ts";

export type Verdict = "supported" | "partial" | "unsupported" | "none";

export function stampLabel(verdict: Verdict, supported?: number, total?: number): { label: string; detail: string } {
  const counts = total ? `${supported ?? 0}/${total}` : "";
  switch (verdict) {
    case "supported":
      return { label: "Verified", detail: total ? `${counts} sentence${total === 1 ? "" : "s"} backed by sources` : "Checked by guards and the critic" };
    case "partial":
      return { label: "Partial", detail: `${counts} sentence${total === 1 ? "" : "s"} backed` };
    case "unsupported":
      return { label: "No evidence", detail: total ? `${counts} sentences backed` : "Not enough evidence in the library" };
    default:
      return { label: "", detail: "" };
  }
}

/** The stamp element (and its detail line). ``slam`` animates it in and nudges ``nudgeTarget``. */
export function stampNode(verdict: Exclude<Verdict, "none">, opts: { supported?: number; total?: number; slam?: boolean; nudgeTarget?: HTMLElement | null; detail?: boolean } = {}): HTMLElement {
  const wrap = el("span", "stamp-wrap");
  const { label, detail } = stampLabel(verdict, opts.supported, opts.total);
  const stamp = el("span", "stamp");
  stamp.dataset.verdict = verdict;
  stamp.appendChild(pixelIcon(verdict === "supported" ? "check" : verdict === "partial" ? "question" : "close", 16));
  stamp.appendChild(el("span", null, label));
  wrap.appendChild(stamp);
  if (opts.detail !== false) wrap.appendChild(el("span", "stamp-detail", detail));
  if (opts.slam && !reducedMotion()) {
    stamp.classList.add("slam");
    const target = opts.nudgeTarget;
    if (target) {
      stamp.addEventListener(
        "animationend",
        () => {
          target.classList.remove("nudge");
          void target.offsetWidth;
          target.classList.add("nudge");
          target.addEventListener("animationend", () => target.classList.remove("nudge"), { once: true });
        },
        { once: true },
      );
    }
  }
  return wrap;
}
