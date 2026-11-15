// Library data: manifest.json, each collection's vectors.bin (loaded by the embedding worker at
// startup) and the passage text, fetched per hit from shards of SHARD_ROWS passages
// (data/<collection>/text/<n>.json, written at build time by scripts/shard-library.mjs). Downloads
// are checked (vectors against the manifest's SHA-256, shards for their row count) and kept in the
// Cache API under the manifest version, so later visits load them without the network. Used by
// both the page and the worker.

import type { Chunk, FileInfo, Manifest } from "./types.ts";

const CACHE_PREFIX = "agentic-rag-data-";
export const SHARD_ROWS = 32; // keep in step with scripts/shard-library.mjs

export type Progress = (loaded: number, total: number) => void;

export async function loadManifest(base: string): Promise<Manifest> {
  const res = await fetch(`${base}data/manifest.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

export function cacheName(version: string): string {
  return `${CACHE_PREFIX}${version}-s${SHARD_ROWS}`;
}

async function openCache(version: string): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    const name = cacheName(version);
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== name) await caches.delete(key);
    }
    return await caches.open(name);
  } catch {
    return null; // private windows and some browsers refuse storage: download every time
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Download with byte progress (totals from the manifest: the response may be compressed). */
async function download(url: string, total: number, onProgress: Progress): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(loaded, total), total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out.buffer;
}

/** A manifest file (vectors.bin), from the cache or the network, checked against its SHA-256. */
export async function fetchFile(base: string, version: string, file: FileInfo, onProgress: Progress): Promise<{ buf: ArrayBuffer; cached: boolean }> {
  const url = `${base}data/${file.path}`;
  const cache = await openCache(version);
  const hit = cache ? await cache.match(url).catch(() => undefined) : undefined;
  if (hit) {
    const buf = await hit.arrayBuffer();
    onProgress(file.bytes, file.bytes);
    return { buf, cached: true };
  }
  const buf = await download(url, file.bytes, onProgress);
  const digest = await sha256Hex(buf);
  if (digest !== null && digest !== file.sha256) throw new Error(`${file.path}: the download is damaged (checksum)`);
  if (cache) await cache.put(url, new Response(buf.slice(0))).catch(() => undefined);
  return { buf, cached: false };
}

type Row = [string, string, string, string[], string, number, string];

export function parseRows(rows: readonly Row[]): Chunk[] {
  return rows.map(([chunk_id, doc_id, heading_path, section_ids, pages, n_tokens, body]) => ({
    chunk_id,
    doc_id,
    heading_path,
    section_ids,
    pages,
    n_tokens,
    text: body,
  }));
}

export function shardOf(row: number): number {
  return Math.floor(row / SHARD_ROWS);
}

export function shardUrl(base: string, collection: string, shard: number): string {
  return `${base}data/${collection}/text/${shard}.json`;
}

/** One text shard: SHARD_ROWS passages (fewer in the last shard of a collection). */
export async function fetchShard(base: string, version: string, collection: string, shard: number, count: number): Promise<Chunk[]> {
  const url = shardUrl(base, collection, shard);
  const expected = Math.min(SHARD_ROWS, count - shard * SHARD_ROWS);
  if (expected <= 0) throw new Error(`${collection}: shard ${shard} is out of range`);
  const cache = await openCache(version);
  const hit = cache ? await cache.match(url).catch(() => undefined) : undefined;
  const res = hit ?? (await fetch(url));
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.clone().text();
  const rows = (JSON.parse(text) as { rows: Row[] }).rows;
  if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`${collection}: text shard ${shard} is damaged`);
  if (!hit && cache) await cache.put(url, new Response(text, { headers: { "content-type": "application/json" } })).catch(() => undefined);
  return parseRows(rows);
}
