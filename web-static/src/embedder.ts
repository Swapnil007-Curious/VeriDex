// Main-thread client of the embedding worker: one worker for the whole page. It holds the model
// and the whole library's vector indexes; queries get the bge query instruction, document chunks
// (uploads) do not.

import lock from "../assets.lock.json" with { type: "json" };
import type { LibraryFile, ModelFile, SearchHitRef, WorkerRequest, WorkerResponse } from "./embed.worker.ts";

export type ProgressListener = (loaded: number, total: number, cached: boolean) => void;

export interface SearchResult {
  vectors: Float32Array[];
  hits: SearchHitRef[];
  embedMs: number;
  searchMs: number;
}

/** What the engine needs from the library search (the worker here; a fake in unit tests). */
export interface LibrarySearch {
  readonly ready: Promise<number>;
  search(texts: string[], k: number, only?: string): Promise<SearchResult>;
  passages(texts: string[], onBatch?: (done: number, total: number) => void, batch?: number): Promise<Float32Array[]>;
}

const MODEL_FILES: Record<string, string> = { fp16: "onnx/model_fp16.onnx", q8: "onnx/model_quantized.onnx" };

/** The files the pipeline reads (sizes from assets.lock.json, the file the build verified). */
export function modelFiles(dtype: string): ModelFile[] {
  const files = lock.model.files as Record<string, { bytes: number }>;
  const weights = MODEL_FILES[dtype] ?? "onnx/model_fp16.onnx";
  return ["config.json", "tokenizer_config.json", "tokenizer.json", weights].map((path) => ({
    path,
    bytes: files[path]?.bytes ?? 0,
  }));
}

type Pending = { resolve: (v: Float32Array[] | SearchResult) => void; reject: (e: Error) => void };

export class Embedder implements LibrarySearch {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly progress = new Set<ProgressListener>();
  readonly ready: Promise<number>;

  constructor(
    base: string,
    dtype: string,
    private readonly instruction: string,
    library: { version: string; collections: LibraryFile[] },
  ) {
    this.worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
    let resolveReady: (ms: number) => void = () => {};
    let rejectReady: (e: Error) => void = () => {};
    this.ready = new Promise<number>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.ready.catch(() => undefined); // reported through the callers
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") for (const fn of this.progress) fn(msg.loaded, msg.total, msg.cached);
      else if (msg.type === "ready") resolveReady(msg.ms);
      else if (msg.type === "result") {
        this.pending.get(msg.id)?.resolve(msg.vectors);
        this.pending.delete(msg.id);
      } else if (msg.type === "searched") {
        this.pending.get(msg.id)?.resolve({ vectors: msg.vectors, hits: msg.hits, embedMs: msg.embedMs, searchMs: msg.searchMs });
        this.pending.delete(msg.id);
      } else if (msg.type === "error") {
        const err = new Error(msg.message);
        if (msg.id === null) {
          rejectReady(err);
          for (const p of this.pending.values()) p.reject(err);
          this.pending.clear();
        } else {
          this.pending.get(msg.id)?.reject(err);
          this.pending.delete(msg.id);
        }
      }
    };
    const init: WorkerRequest = { type: "init", base, dtype, model: lock.model.dir, files: modelFiles(dtype), library };
    this.worker.postMessage(init);
  }

  onProgress(fn: ProgressListener): () => void {
    this.progress.add(fn);
    return () => this.progress.delete(fn);
  }

  private send<T extends Float32Array[] | SearchResult>(msg: WorkerRequest & { id: number }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.id, { resolve: resolve as Pending["resolve"], reject });
      this.worker.postMessage(msg);
    });
  }

  private run(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return Promise.resolve([]);
    return this.send<Float32Array[]>({ type: "embed", id: this.nextId++, texts });
  }

  /** Query vectors (with the retrieval instruction, as the Python index was queried). */
  queries(texts: string[]): Promise<Float32Array[]> {
    return this.run(texts.map((t) => this.instruction + t));
  }

  /** Embed the queries and search every collection (or ``only`` one): top ``k`` rows per collection. */
  search(texts: string[], k: number, only?: string): Promise<SearchResult> {
    return this.send<SearchResult>({ type: "search", id: this.nextId++, texts: texts.map((t) => this.instruction + t), k, ...(only ? { only } : {}) });
  }

  /** Passage vectors in batches (no instruction), reporting progress. */
  async passages(texts: string[], onBatch?: (done: number, total: number) => void, batch = 16): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batch) {
      out.push(...(await this.run(texts.slice(i, i + batch))));
      onBatch?.(Math.min(i + batch, texts.length), texts.length);
    }
    return out;
  }
}
