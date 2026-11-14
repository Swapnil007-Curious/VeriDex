// The one library: totals for the hero line, the passage text resolver (text shards, fetched per
// hit and kept in memory), and the policies that follow the packed passages: which notices to
// show, which collection label and notice go to the chat prompt, and which profile the grounded
// pipeline uses.

import { fetchShard, SHARD_ROWS, shardOf } from "./data.ts";
import type { Chunk, CollectionMeta, Manifest } from "./types.ts";

/** Short library tags for source cards and the About view. */
export const LIBRARY_TAGS: Record<string, string> = {
  cs_ai: "CS & AI",
  consumer_law: "Consumer Law",
  indian_law: "Indian Law",
  human_biology: "Human Biology",
  physics_chemistry: "Physics & Chemistry",
  upload: "Your PDF",
};

export function libraryTag(source: string, collections: readonly CollectionMeta[] = []): string {
  return LIBRARY_TAGS[source] ?? collections.find((c) => c.id === source)?.label ?? source;
}

// the totals live in identity.ts (it must load without a bundler); re-exported here
export { libraryTotals, type LibraryTotals } from "./identity.ts";

export interface HitRef {
  source: string;
  row: number;
}

/** Fetches the text of library hits from the shards; one request per shard, shared and kept. */
export class TextShards {
  private readonly shards = new Map<string, Promise<Chunk[]>>();

  constructor(
    private readonly base: string,
    private readonly manifest: Manifest,
  ) {}

  private shard(collection: string, n: number): Promise<Chunk[]> {
    const key = `${collection}:${n}`;
    let p = this.shards.get(key);
    if (!p) {
      const meta = this.manifest.collections.find((c) => c.id === collection);
      if (!meta) return Promise.reject(new Error(`unknown collection ${collection}`));
      p = fetchShard(this.base, this.manifest.version, collection, n, meta.count);
      p.catch(() => this.shards.delete(key));
      this.shards.set(key, p);
    }
    return p;
  }

  async resolve(refs: readonly HitRef[]): Promise<Chunk[]> {
    const shards = await Promise.all(refs.map((r) => this.shard(r.source, shardOf(r.row))));
    return refs.map((r, i) => {
      const c = shards[i]?.[r.row - shardOf(r.row) * SHARD_ROWS];
      if (!c) throw new Error(`${r.source}: passage ${r.row} is missing`);
      return c;
    });
  }
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/m;

export function hasCodeBlock(answer: string): boolean {
  return FENCE_RE.test(answer);
}

interface Sourced {
  source: string;
  score?: number;
  margin?: number;
}

/** The library collections of some passages, in order of first appearance (PDFs are not one). */
export function librariesOf(passages: readonly Sourced[], collections: readonly CollectionMeta[]): CollectionMeta[] {
  const out: CollectionMeta[] = [];
  for (const p of passages) {
    const c = collections.find((x) => x.id === p.source);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The notices under an answer: one per collection of the packed passages, each only when it
 * applies (CS & AI's code notice only when the answer has a code block), duplicates once.
 */
export function noticesFor(passages: readonly Sourced[], answer: string, collections: readonly CollectionMeta[]): string[] {
  const out: string[] = [];
  for (const c of librariesOf(passages, collections)) {
    if (!c.notice) continue;
    if (c.id === "cs_ai" && !hasCodeBlock(answer)) continue;
    if (!out.includes(c.notice)) out.push(c.notice);
  }
  return out;
}

/** The notices of a finished answer: its cited libraries, or every packed one when it cites none. */
export function answerNotices(cited: readonly Sourced[], packed: readonly Sourced[], answer: string, collections: readonly CollectionMeta[]): string[] {
  return noticesFor(cited.length ? cited : packed, answer, collections);
}

/** The chat request's collection field (label + notice, within the Worker's limits), or null. */
export function promptCollection(passages: readonly Sourced[], collections: readonly CollectionMeta[]): { label: string; notice: string } | null {
  const libs = librariesOf(passages, collections);
  if (!libs.length) return null;
  const label = libs.map((c) => c.label).join(" + ").slice(0, 100);
  const notices: string[] = [];
  for (const c of libs) if (c.notice && !notices.includes(c.notice)) notices.push(c.notice);
  return { label, notice: notices.join(" ").slice(0, 300) };
}

/** The library with the most passages (ties: the better margin, then cosine); null for PDFs only. */
export function dominantSource(passages: readonly Sourced[]): string | null {
  const stats = new Map<string, { n: number; best: number; bestScore: number; first: number }>();
  passages.forEach((p, i) => {
    if (p.source === "upload") return;
    const s = stats.get(p.source) ?? { n: 0, best: Number.NEGATIVE_INFINITY, bestScore: Number.NEGATIVE_INFINITY, first: i };
    s.n += 1;
    s.best = Math.max(s.best, p.margin ?? Number.NEGATIVE_INFINITY);
    s.bestScore = Math.max(s.bestScore, p.score ?? Number.NEGATIVE_INFINITY);
    stats.set(p.source, s);
  });
  let winner: string | null = null;
  let w: { n: number; best: number; bestScore: number; first: number } | null = null;
  for (const [id, s] of stats) {
    if (!w || s.n > w.n || (s.n === w.n && (s.best > w.best || (s.best === w.best && (s.bestScore > w.bestScore || (s.bestScore === w.bestScore && s.first < w.first)))))) {
      winner = id;
      w = s;
    }
  }
  return winner;
}
