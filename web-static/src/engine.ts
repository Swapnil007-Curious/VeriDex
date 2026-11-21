// One chat request in the static app (the browser counterpart of src/ragsys/assistant/service.py),
// over one library: every question searches all collection indexes (in the worker) and the
// uploaded PDFs (here); each hit gets a margin, its cosine minus the threshold of its own source;
// only hits with a margin of at least 0 are evidence. With evidence, Chat answers with citations
// and Grounded only runs the grounded pipeline (grounded.ts) on it; without, Chat answers from
// general knowledge and Grounded only abstains without calling the model. The history is capped
// (and summarised through the proxy when needed) and the reply streams from the LLM proxy.

import { callProxy, ProxyError, type ProxyPassage } from "./api.ts";
import { cleanCitations, sourceLine } from "./citations.ts";
import type { LibrarySearch, SearchResult } from "./embedder.ts";
import { evidenceOf, gateQueries, marginOf, pack, rankByMargin, type Scored } from "./gate.ts";
import { closestSections, groundedAnswer, toProxyPassages, type ClosestSection, type GroundedResult } from "./grounded.ts";
import type { GuardReport } from "./guards.ts";
import type { CriticOutput } from "./jsonx.ts";
import { planHistory, transcript, type Summary, type Turn } from "./history.ts";
import { aboutAnswer, classifyIntent, findFalseIdentity, libraryFacts, localToday, smalltalkAnswer, stripFalseIdentity } from "./identity.ts";
import { chatBody, criticBody, summaryBody, synthBody } from "./requests.ts";
import { dominantSource, promptCollection, type HitRef } from "./library.ts";
import type { Chunk, GroundedSettings, Hit, Manifest, Passage } from "./types.ts";
import { verifyAnswer, type VerifyResult } from "./verify.ts";
import type { SearchSource } from "./vectors.ts";

export const NO_EVIDENCE_MESSAGE = "Not enough evidence in the library to answer this.";

export interface ChatRequest {
  turns: Turn[];
  groundedOnly: boolean;
  summary: Summary | null;
  suggestion?: string | null; // one of today's quests, offered in reply to a greeting
  dex?: boolean; // Dex is on screen (the introduction mentions him)
}

/** A pipeline stage as it starts and finishes (for the UI's quest trace; informational only). */
export type StageId = "local" | "embed" | "search" | "draft" | "synth" | "guards" | "critic";
export interface StageEvent {
  stage: StageId;
  status: "active" | "done" | "skipped";
  ms?: number;
  note?: string;
}

export interface ChatCallbacks {
  onContext?(grounded: boolean, passages: Passage[]): void;
  onToken?(t: string): void;
  onStatus?(text: string): void;
  onStage?(event: StageEvent): void;
  /** The streamed text is about to be replaced (a retry after a false self-description). */
  onRestart?(): void;
}

/** What the grounded pipeline checked (the fields groundedAnswer returns). */
export interface GroundedCheck {
  guards: GuardReport | null;
  critic: CriticOutput | null;
  reason: GroundedResult["reason"] | "no_evidence";
  detail: string;
  llmCalls: number;
}

export interface ChatOutcome {
  mode: "chat" | "grounded_only";
  answer: string;
  citations: string[];
  passages: Passage[]; // the cited passages (shown as chips; kept for Verify)
  context: Passage[]; // every packed passage (they choose the notices and the prompt variant)
  grounded: boolean;
  sourceLine: string;
  stopped: boolean;
  summary: Summary | null;
  outcome?: "answered" | "abstained";
  closest?: ClosestSection[];
  abstentionMessage?: string;
  check?: GroundedCheck;
  intent?: "about" | "smalltalk"; // a question about VeriDex itself, or small talk: answered locally
  variant?: string; // which local answer (the about variant or the small-talk kind)
  identityFix?: "retried" | "stripped"; // the reply described itself as another assistant
  timings: { gate_ms: number; ttft_ms: number | null; total_ms: number; embed_ms?: number; search_ms?: number };
}


/** Text of library hits (the shards); a fake in unit tests. */
export interface ShardResolver {
  resolve(refs: readonly HitRef[]): Promise<Chunk[]>;
}

/** The uploaded PDFs (UploadStore; a fake in unit tests). */
export interface UploadsLike {
  readonly docs: readonly unknown[];
  sources(): SearchSource[];
  titles(): Map<string, string>;
}

/** A ranked hit: a library row (text not fetched yet) or an upload hit (text in memory). */
interface Candidate extends Scored {
  ref?: HitRef;
  hit?: Hit;
}

export class Assistant {
  constructor(
    readonly manifest: Manifest,
    readonly library: LibrarySearch,
    readonly shards: ShardResolver,
    readonly uploads: UploadsLike,
    readonly workerUrl: string,
  ) {}

  private threshold(source: string): number {
    return this.manifest.collections.find((c) => c.id === source)?.threshold ?? this.manifest.gate.default_threshold;
  }

  private settingsOf(source: string | null): GroundedSettings {
    return (source && this.manifest.collections.find((c) => c.id === source)?.grounded) || this.manifest.uploads_grounded;
  }

  /** Every hit of the library and the uploads, ranked by margin. */
  private rank(res: SearchResult, k: number): Candidate[] {
    const lib: Candidate[] = res.hits.map((h) => ({
      key: `${h.source}:${h.row}`,
      source: h.source,
      score: h.score,
      margin: marginOf(h.score, this.threshold(h.source)),
      ref: { source: h.source, row: h.row },
    }));
    const up: Candidate[] = [];
    for (const src of this.uploads.sources()) {
      for (const h of src.search(res.vectors, k)) {
        up.push({ key: `upload:${h.chunk.chunk_id}`, source: "upload", score: h.score, margin: marginOf(h.score, src.threshold), hit: h });
      }
    }
    return rankByMargin([...lib, ...up]);
  }

  /** Fetch the text of the library candidates (uploads are in memory already). */
  private async resolve(cands: readonly Candidate[]): Promise<Hit[]> {
    const refs = cands.flatMap((c) => (c.ref ? [c.ref] : []));
    const chunks = refs.length ? await this.shards.resolve(refs) : [];
    let j = 0;
    return cands.map((c) => {
      if (c.hit) return { ...c.hit, margin: c.margin };
      const chunk = chunks[j++] as Chunk;
      return { chunk, score: c.score, source: c.source, margin: c.margin };
    });
  }

  private summarizer(signal?: AbortSignal) {
    return async (previous: string, turns: Turn[]): Promise<string> => {
      const r = await callProxy(
        this.workerUrl,
        summaryBody(localToday(), transcript(turns, this.manifest.history.summary_input_chars), previous),
        signal ? { signal } : {},
      );
      return r.text.trim();
    };
  }

  private async search(req: ChatRequest, k: number, cb: ChatCallbacks): Promise<{ latest: string; ranked: Candidate[]; embedMs: number; workerSearchMs: number }> {
    const latest = req.turns[req.turns.length - 1]?.content.trim() ?? "";
    const previous = [...req.turns.slice(0, -1)].reverse().find((t) => t.role === "user")?.content ?? null;
    await this.library.ready;
    cb.onStage?.({ stage: "embed", status: "active" });
    const res = await this.library.search(gateQueries(latest, previous, this.manifest.gate.follow_up_max_words), k);
    cb.onStage?.({ stage: "embed", status: "done", ms: res.embedMs });
    cb.onStage?.({ stage: "search", status: "active" });
    return { latest, ranked: this.rank(res, k), embedMs: res.embedMs, workerSearchMs: res.searchMs };
  }

  async chat(req: ChatRequest, cb: ChatCallbacks = {}, signal?: AbortSignal): Promise<ChatOutcome> {
    const t0 = performance.now();
    const intent = classifyIntent(req.turns[req.turns.length - 1]?.content ?? "");
    if (intent !== "normal") return this.local(req, intent, cb, t0);
    if (req.groundedOnly) return this.grounded(req, cb, signal, t0);
    const g = this.manifest.gate;
    const { ranked, embedMs, workerSearchMs } = await this.search(req, g.search_k, cb);
    const tResolve = performance.now();
    const evidence = await this.resolve(evidenceOf(ranked).slice(0, g.max_passages));
    const packed = pack(evidence, this.manifest.context_tokens, 1, this.uploads.titles()).passages;
    const searchMs = workerSearchMs + (performance.now() - tResolve);
    const grounded = packed.length > 0;
    cb.onStage?.({ stage: "search", status: "done", ms: searchMs, note: grounded ? `${packed.length} passages` : "no evidence" });
    cb.onContext?.(grounded, packed);
    const plan = await planHistory(req.turns, this.manifest.history.budget_tokens, {
      maxTurns: this.manifest.history.max_turns,
      summary: req.summary,
      summarize: this.summarizer(signal),
      targetShare: this.manifest.history.summary_target_share,
    });
    const collection = grounded ? promptCollection(packed, this.manifest.collections) : null;
    const tReq = performance.now();
    let first: number | null = null;
    let stopped = false;
    const labels = packed.map((p) => p.label);
    const ask = async (reminder: boolean): Promise<string> => {
      let text = "";
      const body = chatBody({
        turns: plan.kept,
        today: localToday(),
        maxChars: this.manifest.limits.max_message_chars,
        passages: grounded ? toProxyPassages(packed) : [],
        summary: plan.summary?.text ?? null,
        collection,
        reminder,
      });
      try {
        await callProxy(this.workerUrl, body, {
          ...(signal ? { signal } : {}),
          onToken: (t) => {
            first ??= performance.now();
            text += t;
            cb.onToken?.(t);
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") stopped = true;
        else throw err;
      }
      return text;
    };
    cb.onStage?.({ stage: "draft", status: "active" });
    let cleaned = cleanCitations(await ask(false), labels);
    // the safety net: a reply that calls itself another assistant (or made by OpenAI, or states a
    // training cutoff) is asked again once with a stronger reminder; if it persists, those
    // sentences are removed and a note says so
    let identityFix: ChatOutcome["identityFix"];
    if (!stopped && findFalseIdentity(cleaned.text).length) {
      identityFix = "retried";
      cb.onRestart?.();
      cb.onStatus?.("Rechecking the answer…");
      cleaned = cleanCitations(await ask(true), labels);
      if (!stopped && findFalseIdentity(cleaned.text).length) {
        identityFix = "stripped";
        cleaned = { ...cleaned, text: stripFalseIdentity(cleaned.text) };
      }
    }
    cb.onStage?.({ stage: "draft", status: "done", ms: performance.now() - tReq, ...(first === null ? {} : { note: `first token ${Math.round(first - tReq)} ms` }) });
    const cited = packed.filter((p) => cleaned.used.includes(p.label));
    return {
      mode: "chat",
      answer: cleaned.text,
      citations: cleaned.used,
      passages: cited,
      context: packed,
      grounded: cleaned.used.length > 0,
      sourceLine: sourceLine(cleaned.used.length),
      stopped,
      summary: plan.newSummary ? plan.summary : null,
      ...(identityFix ? { identityFix } : {}),
      timings: { gate_ms: embedMs + searchMs, ttft_ms: first === null ? null : first - tReq, total_ms: performance.now() - t0, embed_ms: embedMs, search_ms: searchMs },
    };
  }

  /**
   * A question about VeriDex itself, or small talk: answered here from the facts in identity.ts,
   * with no embedding, no search and no model call (so no quota and no chance of a wrong
   * self-description). The trace shows one LOCAL step.
   */
  private async local(req: ChatRequest, intent: "about" | "smalltalk", cb: ChatCallbacks, t0: number): Promise<ChatOutcome> {
    const question = req.turns[req.turns.length - 1]?.content ?? "";
    const reply = intent === "about" ? aboutAnswer(question, libraryFacts(this.manifest), { dex: req.dex }) : smalltalkAnswer(question, req.suggestion ?? null);
    const ms = performance.now() - t0;
    cb.onStage?.({ stage: "local", status: "done", ms, note: "0 ms network" });
    return {
      mode: "chat",
      answer: reply.text,
      citations: [],
      passages: [],
      context: [],
      grounded: false,
      sourceLine: intent === "about" ? "About VeriDex: from its built-in facts, no model call" : "Small talk: answered locally",
      stopped: false,
      summary: null,
      intent,
      variant: "variant" in reply ? reply.variant : reply.kind,
      timings: { gate_ms: 0, ttft_ms: null, total_ms: performance.now() - t0 },
    };
  }

  private async grounded(req: ChatRequest, cb: ChatCallbacks, signal: AbortSignal | undefined, t0: number): Promise<ChatOutcome> {
    cb.onStatus?.("Searching the library…");
    const g = this.manifest.gate;
    const { latest, ranked, embedMs, workerSearchMs } = await this.search(req, g.search_k * 2, cb);
    const tResolve = performance.now();
    const titles = this.uploads.titles();
    const evidence = await this.resolve(evidenceOf(ranked).slice(0, g.search_k * 2));
    if (!evidence.length) {
      // nothing clears its threshold: abstain without calling the model
      const nearest = await this.resolve(ranked.slice(0, 6));
      const searchMs = workerSearchMs + (performance.now() - tResolve);
      cb.onStage?.({ stage: "search", status: "done", ms: searchMs, note: "no evidence" });
      for (const stage of ["synth", "guards", "critic"] as const) cb.onStage?.({ stage, status: "skipped", note: "no evidence" });
      return {
        mode: "grounded_only",
        answer: "",
        citations: [],
        passages: [],
        context: [],
        grounded: false,
        sourceLine: NO_EVIDENCE_MESSAGE,
        stopped: false,
        summary: null,
        outcome: "abstained",
        closest: closestSections(nearest),
        abstentionMessage: NO_EVIDENCE_MESSAGE,
        check: { guards: null, critic: null, reason: "no_evidence", detail: "no passage cleared the threshold of its library", llmCalls: 0 },
        timings: { gate_ms: embedMs + searchMs, ttft_ms: null, total_ms: performance.now() - t0, embed_ms: embedMs, search_ms: searchMs },
      };
    }
    const searchMs = workerSearchMs + (performance.now() - tResolve);
    cb.onStage?.({ stage: "search", status: "done", ms: searchMs, note: `${evidence.length} candidates` });
    // the prompt profile and the budgets follow the passages that will be packed
    const first = this.settingsOf(evidence[0]?.source ?? null);
    const profileSource = dominantSource(pack(evidence, first.budget_tokens, first.min_passages, titles).passages);
    const settings = this.settingsOf(profileSource);
    const profile = profileSource ?? "uploads";
    const opts = signal ? { signal } : {};
    let synthCalls = 0;
    let guardsReported = false;
    const result = await groundedAnswer(
      latest,
      evidence,
      settings,
      {
        synth: async (r) => {
          synthCalls += 1;
          const note = synthCalls > 1 ? { note: "revision" } : {};
          cb.onStage?.({ stage: "synth", status: "active", ...note });
          const t = performance.now();
          const text = (await callProxy(this.workerUrl, synthBody(localToday(), profile, r), opts)).text;
          cb.onStage?.({ stage: "synth", status: "done", ms: performance.now() - t, ...note });
          cb.onStage?.({ stage: "guards", status: "active" });
          guardsReported = false;
          return text;
        },
        critic: async (r) => {
          // the guards ran between the synthesizer reply and this call (inside groundedAnswer)
          cb.onStage?.({ stage: "guards", status: "done" });
          guardsReported = true;
          cb.onStage?.({ stage: "critic", status: "active" });
          const t = performance.now();
          const text = (await callProxy(this.workerUrl, criticBody(localToday(), profile, r.question, r.passages, r.answer), opts)).text;
          cb.onStage?.({ stage: "critic", status: "done", ms: performance.now() - t });
          return text;
        },
      },
      titles,
    );
    if (!guardsReported && result.guards) cb.onStage?.({ stage: "guards", status: "done", note: result.guards.passed ? "passed" : "failed" });
    else if (!guardsReported) cb.onStage?.({ stage: "guards", status: "skipped" });
    if (!result.critic) cb.onStage?.({ stage: "critic", status: "skipped" });
    const answered = result.outcome === "answered";
    // the safety net for Grounded only: the answer is built from the passages, so a false
    // self-description is only removed, never retried
    if (answered && findFalseIdentity(result.answer).length) result.answer = stripFalseIdentity(result.answer);
    const cited = result.passages.filter((p) => result.citations.includes(p.label));
    return {
      mode: "grounded_only",
      answer: result.answer,
      citations: answered ? cited.map((p) => p.label) : [],
      passages: answered ? cited : [],
      context: answered ? result.passages : [],
      grounded: answered,
      sourceLine: answered ? sourceLine(cited.length) : NO_EVIDENCE_MESSAGE,
      stopped: false,
      summary: null,
      outcome: result.outcome,
      closest: result.closest,
      abstentionMessage: NO_EVIDENCE_MESSAGE,
      check: { guards: result.guards, critic: result.critic, reason: result.reason, detail: result.detail, llmCalls: result.llmCalls },
      timings: { gate_ms: embedMs + searchMs, ttft_ms: null, total_ms: performance.now() - t0, embed_ms: embedMs, search_ms: searchMs },
    };
  }

  /** Guards here, critic through the proxy, on the passages the reply cites. */
  verify(question: string, answer: string, passages: readonly Passage[]): Promise<VerifyResult> {
    const profile = dominantSource(passages) ?? "uploads";
    return verifyAnswer(answer, passages, async (cited, prose) => {
      const body: ProxyPassage[] = cited.map((p) => ({ label: p.label, heading: p.heading_path, sections: p.section_ids, text: p.text }));
      const r = await callProxy(this.workerUrl, criticBody(localToday(), profile, question.slice(0, 4000), body, prose.slice(0, 8000)));
      return r.text;
    });
  }
}

export { ProxyError };
