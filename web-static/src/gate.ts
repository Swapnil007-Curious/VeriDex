// Automatic grounding without an LLM call and context packing (port of
// src/ragsys/agents/context.py), over one library: the latest message, joined with the previous
// user message for a short follow-up, is embedded once; every hit of every collection (and of the
// uploaded PDFs) gets a margin, its cosine minus the threshold of its own collection; hits with a
// margin of at least 0 are evidence, ranked by margin, and the best become labelled passages within
// the token budget.

import { sanitize } from "./text.ts";
import type { Hit, Passage } from "./types.ts";

const BACK_REFERENCE_RE =
  /\b(it|its|it's|that|this|those|these|they|them|their|there|above|previous|same|again|more|another|instead|example|examples|why|how come)\b/i;
const FOLLOW_UP_START_RE =
  /^\s*(and|but|so|also|then|ok|okay|what about|how about|why|elaborate|explain more|tell me more|continue|go on)\b/i;
const MAX_QUERY_CHARS = 2000;

export function isFollowUp(latest: string, maxWords: number): boolean {
  if (latest.split(/\s+/).filter(Boolean).length > maxWords) return false;
  return FOLLOW_UP_START_RE.test(latest) || BACK_REFERENCE_RE.test(latest);
}

export function gateQueries(latest: string, previous: string | null, maxWords: number): string[] {
  const out = [latest.trim().slice(0, MAX_QUERY_CHARS)];
  if (previous && previous.trim() && isFollowUp(latest, maxWords)) {
    out.push(`${previous.trim().slice(0, MAX_QUERY_CHARS / 2)}\n${latest.trim()}`.slice(0, MAX_QUERY_CHARS));
  }
  return out;
}

/** A search hit before its text is known: enough to rank it across collections. */
export interface Scored {
  key: string; // unique per passage, e.g. "cs_ai:812" or "upload:up_ab12:00003"
  source: string; // collection id or "upload"
  score: number; // cosine
  margin: number; // cosine minus the threshold of the source
}

/** How far a hit clears the threshold of its own collection. */
export function marginOf(score: number, threshold: number): number {
  return score - threshold;
}

/**
 * Pool the hits of every source into one ranking: one entry per key (the better margin), ordered
 * by margin, then cosine, then the order the hits came in.
 */
export function rankByMargin<T extends Scored>(items: readonly T[]): T[] {
  const best = new Map<string, { item: T; order: number }>();
  items.forEach((item, order) => {
    const cur = best.get(item.key);
    if (!cur) best.set(item.key, { item, order });
    else if (item.margin > cur.item.margin) best.set(item.key, { item, order: cur.order });
  });
  return [...best.values()]
    .sort((a, b) => b.item.margin - a.item.margin || b.item.score - a.item.score || a.order - b.order)
    .map((x) => x.item);
}

/** A passage counts as evidence only when it clears the threshold of its own collection. */
export function isEvidence(h: { margin: number }): boolean {
  return h.margin >= 0;
}

export function evidenceOf<T extends { margin: number }>(ranked: readonly T[]): T[] {
  return ranked.filter(isEvidence);
}

/** Pool hits of several sources, best score first (stable), one entry per chunk. */
export function mergeHits(groups: readonly (readonly Hit[])[]): Hit[] {
  const pooled = new Map<string, Hit>();
  for (const group of groups) {
    for (const h of group) {
      const cur = pooled.get(h.chunk.chunk_id);
      if (!cur || h.score > cur.score) pooled.set(h.chunk.chunk_id, h);
    }
  }
  return [...pooled.values()].sort((a, b) => b.score - a.score);
}

export interface Packed {
  passages: Passage[];
  usedTokens: number;
  nextIndex: number;
  budget: number;
}

function toPassage(h: Hit, label: string, titles: ReadonlyMap<string, string>): Passage {
  return { ...h.chunk, label, source: h.source, score: h.score, ...(h.margin === undefined ? {} : { margin: h.margin }), title: titles.get(h.chunk.doc_id) ?? "" };
}

/** Rank order until the next chunk would exceed the budget (at least ``minPassages``). */
export function pack(
  ranked: readonly Hit[],
  budget: number,
  minPassages = 1,
  titles: ReadonlyMap<string, string> = new Map(),
  start: Packed | null = null,
): Packed {
  const passages = start ? [...start.passages] : [];
  let used = start ? start.usedTokens : 0;
  let i = start ? start.nextIndex : 0;
  while (i < ranked.length) {
    const h = ranked[i] as Hit;
    if (used + h.chunk.n_tokens > budget && passages.length >= minPassages) break;
    passages.push(toPassage(h, `C${passages.length + 1}`, titles));
    used += h.chunk.n_tokens;
    i += 1;
  }
  return { passages, usedTokens: used, nextIndex: i, budget };
}

/** The delimited passage block, exactly as the Python agents see it. */
export function passageBlock(p: Pick<Passage, "label" | "heading_path" | "section_ids" | "text">): string {
  return [
    `<<<PASSAGE ${p.label}>>>`,
    `Source: ${sanitize(p.heading_path)}`,
    `Sections: ${p.section_ids.join(", ") || "-"}`,
    "<<<TEXT>>>",
    sanitize(p.text.trim()),
    `<<<END ${p.label}>>>`,
  ].join("\n");
}
