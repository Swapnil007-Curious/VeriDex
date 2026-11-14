// Web Worker: bge-small-en-v1.5 (ONNX, self-hosted under models/) with transformers.js on ONNX
// Runtime Web's WASM backend (self-hosted under ort/), plus the whole library's int8 vector
// indexes. CLS pooling and L2 normalisation, as the sentence-transformers model is configured.
// Nothing is fetched from another origin: remote models are off and the WASM paths point at this
// site. A search embeds the queries and scores every collection here, off the main thread; the
// page receives the query vectors (for uploaded PDFs) and the top rows per collection.
//
// The model files are downloaded once, with byte progress, into the Cache API entry that
// transformers.js reads ("transformers-cache", keyed by the local path); the pipeline then loads
// them from there. Passing a progress callback to the pipeline instead would make transformers.js
// fetch every local file twice: once for its size, once for its content. The vectors go into the
// library cache (data.ts). One progress stream covers both.

import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { fetchFile } from "./data.ts";
import type { FileInfo } from "./types.ts";
import { Int8Index, topK } from "./vectors.ts";

export interface ModelFile {
  path: string; // relative to the model directory, e.g. "onnx/model_fp16.onnx"
  bytes: number;
}

export interface LibraryFile {
  id: string;
  file: FileInfo;
}

export interface SearchHitRef {
  source: string;
  row: number;
  score: number;
}

export type WorkerRequest =
  | { type: "init"; base: string; dtype: string; model: string; files: ModelFile[]; library: { version: string; collections: LibraryFile[] } }
  | { type: "embed"; id: number; texts: string[] }
  | { type: "search"; id: number; texts: string[]; k: number; only?: string };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number; cached: boolean }
  | { type: "ready"; ms: number }
  | { type: "result"; id: number; vectors: Float32Array[] }
  | { type: "searched"; id: number; vectors: Float32Array[]; hits: SearchHitRef[]; embedMs: number; searchMs: number }
  | { type: "error"; id: number | null; message: string };

interface Loaded {
  ex: FeatureExtractionPipeline;
  library: Map<string, Int8Index>;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let loaded: Promise<Loaded> | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

type Bytes = (loaded: number, cached: boolean) => void;

async function prefetch(urls: { url: string; bytes: number }[], onBytes: Bytes): Promise<void> {
  let cache: Cache;
  try {
    cache = await caches.open(env.cacheKey);
  } catch {
    onBytes(urls.reduce((s, u) => s + u.bytes, 0), false);
    return; // no Cache API (private window): transformers.js downloads the files itself
  }
  let done = 0;
  let allCached = true;
  for (const { url, bytes } of urls) {
    if (await cache.match(url)) {
      done += bytes;
      onBytes(done, allCached);
      continue;
    }
    allCached = false;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      parts.push(value);
      got += value.byteLength;
      onBytes(done + Math.min(got, bytes), false);
    }
    const blob = new Blob(parts as BlobPart[]);
    const headers = { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "content-length": String(blob.size) };
    await cache.put(url, new Response(blob, { headers })).catch(() => undefined);
    done += bytes;
  }
  onBytes(done, allCached);
}

async function loadLibrary(base: string, version: string, files: LibraryFile[], onBytes: Bytes): Promise<Map<string, Int8Index>> {
  const got = files.map(() => 0);
  const sum = (): number => got.reduce((a, b) => a + b, 0);
  let cached = true;
  const parts = await Promise.all(
    files.map(async (f, i) => {
      const r = await fetchFile(base, version, f.file, (l) => {
        got[i] = l;
        onBytes(sum(), false);
      });
      cached &&= r.cached;
      got[i] = f.file.bytes;
      return [f.id, new Int8Index(r.buf)] as const;
    }),
  );
  onBytes(sum(), cached);
  return new Map(parts);
}

async function load(msg: Extract<WorkerRequest, { type: "init" }>): Promise<Loaded> {
  const root = new URL(msg.base, scope.location.origin).href;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // a path, not a full URL: transformers.js only checks local files for paths
  env.localModelPath = `${msg.base}models/`;
  env.useBrowserCache = true;
  env.useWasmCache = false; // the WASM files are same-origin and cached by the browser
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = { mjs: `${root}ort/ort-wasm-simd-threaded.mjs`, wasm: `${root}ort/ort-wasm-simd-threaded.wasm` };
    wasm.numThreads = 1; // GitHub Pages cannot send the headers that multi-threading needs
  }
  const t0 = performance.now();
  const modelTotal = msg.files.reduce((s, f) => s + f.bytes, 0);
  const libTotal = msg.library.collections.reduce((s, c) => s + c.file.bytes, 0);
  let m = 0;
  let l = 0;
  let mCached = true;
  let lCached = true;
  const report = (): void => post({ type: "progress", loaded: m + l, total: modelTotal + libTotal, cached: m + l >= modelTotal + libTotal && mCached && lCached });
  const library = loadLibrary(root, msg.library.version, msg.library.collections, (bytes, cached) => {
    l = bytes;
    lCached = cached;
    report();
  });
  library.catch(() => undefined); // awaited (and reported) below
  await prefetch(
    msg.files.map((f) => ({ url: `${root}models/${msg.model}/${f.path}`, bytes: f.bytes })),
    (bytes, cached) => {
      m = bytes;
      mCached = cached;
      report();
    },
  );
  const ex = (await pipeline("feature-extraction", msg.model, {
    dtype: msg.dtype === "q8" ? "q8" : "fp16",
    device: "wasm",
  })) as FeatureExtractionPipeline;
  const lib = await library;
  post({ type: "ready", ms: performance.now() - t0 });
  return { ex, library: lib };
}

async function embed(ex: FeatureExtractionPipeline, texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const out = await ex(texts, { pooling: "cls", normalize: true });
  const tensor = out.type === "float32" ? out : out.to("float32");
  const dim = tensor.dims[tensor.dims.length - 1] ?? 0;
  const data = tensor.data as Float32Array;
  return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim));
}

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    loaded ??= load(msg);
    loaded.catch((err: unknown) => post({ type: "error", id: null, message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  try {
    if (!loaded) throw new Error("the embedding model is not initialised");
    const { ex, library } = await loaded;
    const t0 = performance.now();
    const vectors = await embed(ex, msg.texts);
    if (msg.type === "embed") {
      post({ type: "result", id: msg.id, vectors }, vectors.map((v) => v.buffer));
      return;
    }
    const embedMs = performance.now() - t0;
    const t1 = performance.now();
    const hits: SearchHitRef[] = [];
    for (const [source, index] of library) {
      if (msg.only && source !== msg.only) continue;
      for (const { row, score } of topK(index, vectors, msg.k)) hits.push({ source, row, score });
    }
    post({ type: "searched", id: msg.id, vectors, hits, embedMs, searchMs: performance.now() - t1 }, vectors.map((v) => v.buffer));
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
