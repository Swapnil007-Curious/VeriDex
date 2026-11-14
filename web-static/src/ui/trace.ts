// The quest trace: the real pipeline stages of one answer as a pixel level map. Each node is a
// 12 px block, pending (grey) -> active (amber, blinking) -> done (green, with its measured time);
// connectors fill block by block as stages finish; a skipped stage shows a dashed outline.

import { el } from "./dom.ts";
import type { StageEvent } from "../engine.ts";
import type { Verdict } from "./stamp.ts";

export type StepStatus = "pending" | "active" | "done" | "skipped";

export interface TraceStep {
  id: string;
  label: string;
  status: StepStatus;
  ms: number | null;
  note?: string;
  verdict?: Verdict;
}

const LABELS: Record<string, string> = {
  local: "Local",
  embed: "Embed",
  search: "Search",
  draft: "Draft",
  synth: "Synth",
  guards: "Guards",
  critic: "Critic",
  verify: "Verify",
};

/** The expected stages of a mode, all pending, so the trace reserves its space before the first event. */
export function initialTrace(groundedOnly: boolean, hasDocuments = true, local = false): TraceStep[] {
  const ids = local ? ["local"] : groundedOnly ? ["embed", "search", "synth", "guards", "critic"] : hasDocuments ? ["embed", "search", "draft", "verify"] : ["draft"];
  return ids.map((id) => ({ id, label: LABELS[id] ?? id, status: "pending", ms: null }));
}

/** Apply a stage event; a stage that repeats (a revision round) gets a new step. */
export function applyStage(steps: TraceStep[], e: StageEvent): TraceStep[] {
  const out = steps.map((s) => ({ ...s }));
  let idx = out.findIndex((s) => s.id === e.stage && s.status !== "done" && s.status !== "skipped");
  if (idx < 0) {
    const label = `${LABELS[e.stage] ?? e.stage}${e.note === "revision" ? " (revision)" : ""}`;
    const step: TraceStep = { id: e.stage, label, status: "pending", ms: null };
    idx = out.length;
    out.push(step);
  }
  const step = out[idx] as TraceStep;
  step.status = e.status;
  if (e.ms !== undefined) step.ms = e.ms;
  if (e.note && e.note !== "revision") step.note = e.note;
  if (e.note === "revision" && !step.label.includes("revision")) step.label = `${step.label} (revision)`;
  return out;
}

export function finishTrace(steps: TraceStep[]): TraceStep[] {
  return steps.map((s) => (s.status === "active" ? { ...s, status: "done" as const } : s));
}

export function formatMs(n: number | null): string {
  if (n === null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

export function renderTrace(host: HTMLElement, steps: TraceStep[], opts: { onVerify?: () => void; verifying?: boolean } = {}): void {
  host.textContent = "";
  host.className = "trace";
  host.setAttribute("role", "list");
  host.setAttribute("aria-label", "Quest trace: the steps behind this answer");
  steps.forEach((s, i) => {
    if (i > 0) {
      const link = el("span", "trace-link");
      link.setAttribute("aria-hidden", "true");
      for (let k = 0; k < 3; k++) link.appendChild(el("i"));
      const prev = steps[i - 1];
      if (prev && (prev.status === "done" || prev.status === "skipped")) link.classList.add("is-lit");
      host.appendChild(link);
    }
    const step = el("span", "trace-step");
    step.setAttribute("role", "listitem");
    step.dataset.status = s.status;
    step.dataset.stage = s.id;
    if (s.verdict) step.dataset.verdict = s.verdict;
    step.appendChild(el("span", "trace-node"));
    if (s.id === "verify" && s.status === "pending" && opts.onVerify) {
      const b = el("button", "trace-btn", opts.verifying ? "Verifying…" : "Run verify");
      b.type = "button";
      b.disabled = Boolean(opts.verifying);
      b.setAttribute("aria-label", "Verify this answer against its sources");
      b.addEventListener("click", opts.onVerify);
      step.appendChild(b);
    } else {
      step.appendChild(el("span", "trace-label", s.label));
    }
    const time = s.status === "skipped" ? "Skipped" : formatMs(s.ms);
    if (time) step.appendChild(el("span", "trace-ms", time));
    step.title = [s.label, s.status, s.ms !== null ? formatMs(s.ms) : "", s.note ?? ""].filter(Boolean).join(" · ");
    host.appendChild(step);
  });
}
