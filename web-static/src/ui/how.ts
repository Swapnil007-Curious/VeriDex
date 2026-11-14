// "How it works": the real stages of one question (gate.ts, engine.ts, grounded.ts, verify.ts)
// and what stays on this device. Loaded on first use.

import { el } from "./dom.ts";
import { hydrateIcons } from "./icons.ts";

const STEPS: [string, string][] = [
  ["Embed in your browser", "bge-small-en-v1.5 runs on ONNX Runtime in a Web Worker on this page and turns your question into a vector. No server reads it to understand it."],
  ["Search the whole library", "The worker scores every passage of all five libraries (and any PDF you added) by cosine similarity. Each hit gets a margin: its score minus its own library's threshold."],
  ["Keep only real evidence", "A passage counts only when its margin is at least 0. The best ones, ranked by margin, are labelled C1, C2, … and packed within the context budget."],
  ["Draft the answer", "With evidence, the model cites a passage after each claim. Without any, Chat answers from general knowledge and says so; Grounded only stops and says there is not enough evidence."],
  ["Check it", "Guards run here: each sentence must cite a given passage and each number must occur in what it cites. A critic model then reviews the answer. Grounded only does this for every answer; in Chat you press Run verify."],
  ["Stamp the result", "VERIFIED, PARTIAL or NO EVIDENCE comes only from that check. XP, quests and trophies are kept in this browser and never sent anywhere."],
];

let dialog: HTMLDialogElement | null = null;
let opener: HTMLElement | null = null;

function build(repo: string): HTMLDialogElement {
  const d = el("dialog", "dialog how");
  d.setAttribute("aria-labelledby", "how-title");
  const head = el("header", "dialog-head");
  const h = el("h2", null, "How it works");
  h.id = "how-title";
  const close = el("button", "icon-btn");
  close.type = "button";
  close.dataset.icon = "close";
  close.setAttribute("aria-label", "Close How it works");
  close.addEventListener("click", () => d.close());
  head.append(h, close);
  const body = el("div", "dialog-body");
  body.appendChild(el("p", null, "One assistant, one library. Every question goes through the same steps; the trace above each answer shows them as they happen, with their real times."));
  const ol = el("ol", "how-steps");
  STEPS.forEach(([title, text], i) => {
    const li = el("li");
    li.append(el("span", "how-num", String(i + 1)), el("b", null, title), el("span", null, text));
    ol.appendChild(li);
  });
  body.appendChild(ol);
  const p = el("p");
  p.appendChild(document.createTextNode("Only the packed passages, your question and the recent conversation go to the LLM proxy. The code is on "));
  const a = el("a", null, "GitHub");
  a.href = repo;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  p.append(a, document.createTextNode("."));
  body.appendChild(p);
  d.append(head, body);
  d.addEventListener("close", () => {
    if (opener && document.body.contains(opener)) opener.focus();
  });
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  hydrateIcons(d);
  document.body.appendChild(d);
  return d;
}

export function openHow(repo: string): void {
  opener = document.activeElement as HTMLElement | null;
  dialog ??= build(repo);
  dialog.showModal();
}

export function closeHow(): boolean {
  if (dialog?.open) {
    dialog.close();
    return true;
  }
  return false;
}
