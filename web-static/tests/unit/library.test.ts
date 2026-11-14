// The one-library search: margins, the merged ranking, the evidence gate, the notices and prompt
// variants chosen by the packed passages, and the engine's two no-coverage paths (Chat answers
// from general knowledge with no passages; Grounded only abstains without calling the model).
// The LLM proxy is a stubbed fetch that streams SSE; nothing leaves the test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERAL_LINE } from "../../src/citations.ts";
import type { LibrarySearch, SearchResult } from "../../src/embedder.ts";
import { Assistant, NO_EVIDENCE_MESSAGE, type StageEvent } from "../../src/engine.ts";
import { evidenceOf, isEvidence, marginOf, rankByMargin } from "../../src/gate.ts";
import { answerNotices, dominantSource, hasCodeBlock, libraryTotals, noticesFor, promptCollection, type HitRef } from "../../src/library.ts";
import type { Chunk, CollectionMeta, GroundedSettings, Manifest } from "../../src/types.ts";

const grounded: GroundedSettings = { budget_tokens: 2048, revision_budget_tokens: 3072, min_passages: 1, max_synth_calls: 2, max_critic_calls: 2, critic_on_guard_fail: false, on_final_revise: "abstain" };

function coll(id: string, label: string, threshold: number, notice: string, docs: string[], count = 64): CollectionMeta {
  return {
    id, label, description: "", notice, examples: [], evaluated: true, profile: id, abstention_message: "Not found", threshold, grounded, count, dim: 4,
    sources: docs.map((d) => ({ doc_id: d, title: d.toUpperCase(), authors: "", edition: "", licence: "", licence_url: "", source_url: "" })),
    files: { passages: { path: "", bytes: 0, gzip_bytes: 0, sha256: "" }, vectors: { path: "", bytes: 0, gzip_bytes: 0, sha256: "" } },
  };
}

const COLLECTIONS = [
  coll("cs_ai", "Computer Science, AI & Coding", 0.74, "Code is not executed here; test it before use.", ["progit", "d2l"]),
  coll("consumer_law", "Indian Consumer Law", 0.61, "Not legal advice.", ["cpa2019"]),
  coll("indian_law", "Indian Law, Constitution & Tax", 0.62, "Not legal advice.", ["coi", "bns2023"]),
  coll("human_biology", "Human Biology", 0.62, "Educational, not medical advice; for symptoms or emergencies contact a doctor or local emergency services.", ["ap2e"]),
];

const MANIFEST = {
  format: 1, version: "t", model: { id: "m", source: "", pooling: "cls", normalize: true, max_tokens: 512, query_instruction: "" },
  gate: { default_threshold: 0.62, upload_threshold: 0.62, follow_up_max_words: 12, search_k: 20, max_passages: 8 },
  context_tokens: 2048, uploads_grounded: grounded,
  history: { max_turns: 10, budget_tokens: 3000, summary_target_share: 0.3, summary_input_chars: 8000 },
  limits: { max_message_chars: 4000, max_output_tokens: 1500 },
  uploads: { max_files: 3, max_mb: 10, max_pages: 50, max_chunks_per_file: 400 },
  general_examples: [], collections: COLLECTIONS,
} as unknown as Manifest;

function chunk(source: string, row: number, n = 100): Chunk {
  return { chunk_id: `${source}:${row}`, doc_id: source === "cs_ai" ? "progit" : "coi", heading_path: `${source} > Section ${row}`, section_ids: [`${source}:s${row}`], pages: String(row), n_tokens: n, text: `Passage ${row} of ${source}. It says something specific.` };
}

class FakeLibrary implements LibrarySearch {
  ready = Promise.resolve(1);
  calls: { texts: string[]; k: number }[] = [];
  constructor(private readonly hits: SearchResult["hits"]) {}
  async search(texts: string[], k: number): Promise<SearchResult> {
    this.calls.push({ texts, k });
    return { vectors: [new Float32Array(4)], hits: this.hits, embedMs: 5, searchMs: 3 };
  }
  async passages(): Promise<Float32Array[]> {
    return [];
  }
}

const shards = { resolve: async (refs: readonly HitRef[]) => refs.map((r) => chunk(r.source, r.row)) };
const noUploads = { docs: [], sources: () => [], titles: () => new Map<string, string>() };

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stubProxy(reply: (body: Record<string, unknown>) => string): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    return sse(reply(body));
  });
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe("margin ranking across libraries", () => {
  it("ranks by margin over each library's own threshold, not by raw cosine", () => {
    const items = [
      { key: "cs_ai:1", source: "cs_ai", score: 0.78, margin: marginOf(0.78, 0.74) }, // +0.04
      { key: "indian_law:9", source: "indian_law", score: 0.7, margin: marginOf(0.7, 0.62) }, // +0.08
      { key: "consumer_law:3", source: "consumer_law", score: 0.65, margin: marginOf(0.65, 0.61) }, // +0.04, lower cosine
      { key: "human_biology:2", source: "human_biology", score: 0.6, margin: marginOf(0.6, 0.62) }, // -0.02
    ];
    expect(rankByMargin(items).map((h) => h.key)).toEqual(["indian_law:9", "cs_ai:1", "consumer_law:3", "human_biology:2"]);
  });
  it("keeps one entry per passage (the better margin) and is stable on full ties", () => {
    const ranked = rankByMargin([
      { key: "a:1", source: "a", score: 0.7, margin: 0.01 },
      { key: "b:1", source: "b", score: 0.7, margin: 0.05 },
      { key: "a:1", source: "a", score: 0.8, margin: 0.06 },
      { key: "c:1", source: "c", score: 0.7, margin: 0.05 },
    ]);
    expect(ranked.map((h) => [h.key, h.margin])).toEqual([["a:1", 0.06], ["b:1", 0.05], ["c:1", 0.05]]);
  });
});

describe("margin gate", () => {
  it("counts a passage as evidence only at margin >= 0", () => {
    expect(isEvidence({ margin: 0 })).toBe(true);
    expect(isEvidence({ margin: 0.0001 })).toBe(true);
    expect(isEvidence({ margin: -0.0001 })).toBe(false);
    expect(evidenceOf([{ margin: 0.2 }, { margin: -0.1 }, { margin: 0 }]).map((h) => h.margin)).toEqual([0.2, 0]);
  });
});

describe("notices and prompt variants follow the packed passages", () => {
  const p = (source: string, margin = 0.05, score = 0.8) => ({ source, margin, score });
  it("shows Not legal advice once for both law libraries", () => {
    expect(noticesFor([p("indian_law"), p("consumer_law")], "An answer.", COLLECTIONS)).toEqual(["Not legal advice."]);
  });
  it("shows the CS & AI notice only when the answer has a code block", () => {
    expect(noticesFor([p("cs_ai")], "Rebase replays commits [C1].", COLLECTIONS)).toEqual([]);
    expect(noticesFor([p("cs_ai")], "Run:\n\n```bash\ngit rebase main\n```", COLLECTIONS)).toEqual(["Code is not executed here; test it before use."]);
    expect(hasCodeBlock("inline `code` only")).toBe(false);
  });
  it("shows the medical notice for Human Biology and nothing for a general answer or PDFs", () => {
    expect(noticesFor([p("human_biology")], "x", COLLECTIONS)[0]).toContain("not medical advice");
    expect(noticesFor([], "```py\nprint(1)\n```", COLLECTIONS)).toEqual([]);
    expect(noticesFor([p("upload")], "x", COLLECTIONS)).toEqual([]);
  });
  it("follows the cited libraries of an answer, or every packed one when it cites none", () => {
    // a CNN answer citing only CS & AI does not get a medical notice for an uncited packed passage
    expect(answerNotices([p("cs_ai")], [p("cs_ai"), p("human_biology")], "No code here.", COLLECTIONS)).toEqual([]);
    // an uncited answer next to packed law passages still says it is not legal advice
    expect(answerNotices([], [p("indian_law")], "A general answer.", COLLECTIONS)).toEqual(["Not legal advice."]);
    expect(answerNotices([], [], "A general answer.", COLLECTIONS)).toEqual([]);
  });
  it("builds the chat collection field and the grounded profile from the packed passages", () => {
    expect(promptCollection([p("indian_law"), p("cs_ai"), p("indian_law")], COLLECTIONS)).toEqual({ label: "Indian Law, Constitution & Tax + Computer Science, AI & Coding", notice: "Not legal advice. Code is not executed here; test it before use." });
    expect(promptCollection([p("upload")], COLLECTIONS)).toBeNull();
    expect(dominantSource([p("cs_ai", 0.1), p("indian_law", 0.02), p("indian_law", 0.01)])).toBe("indian_law");
    expect(dominantSource([p("cs_ai", 0.01), p("indian_law", 0.09)])).toBe("indian_law");
    expect(dominantSource([p("upload")])).toBeNull();
  });
  it("counts books and passages from the manifest", () => {
    expect(libraryTotals(MANIFEST)).toEqual({ books: 6, passages: 256, libraries: 4 });
  });
});

describe("engine: merged search", () => {
  it("cites library evidence from several collections in margin order, labelled C1, C2", async () => {
    const lib = new FakeLibrary([
      { source: "cs_ai", row: 4, score: 0.79 }, // +0.05
      { source: "cs_ai", row: 5, score: 0.7 }, // -0.04: not evidence
      { source: "indian_law", row: 7, score: 0.71 }, // +0.09
    ]);
    const bodies = stubProxy(() => "Article 21 protects life [C1]. Rebase rewrites history [C2]. Bad label [C7].");
    const a = new Assistant(MANIFEST, lib, shards, noUploads, "https://proxy.test");
    const stages: StageEvent[] = [];
    const out = await a.chat({ turns: [{ role: "user", content: "two topics" }], groundedOnly: false, summary: null }, { onStage: (e) => stages.push(e) });
    const sent = bodies[0] as { passages: { label: string; heading: string }[]; collection: { label: string; notice: string } };
    expect(sent.passages.map((x) => [x.label, x.heading])).toEqual([["C1", "indian_law > Section 7"], ["C2", "cs_ai > Section 4"]]);
    expect(sent.collection.label).toBe("Indian Law, Constitution & Tax + Computer Science, AI & Coding");
    expect(out.grounded).toBe(true);
    expect(out.citations).toEqual(["C1", "C2"]);
    expect(out.answer).not.toContain("[C7]");
    expect(out.context.map((x) => x.source)).toEqual(["indian_law", "cs_ai"]);
    expect(out.passages[0]?.margin).toBeCloseTo(0.09, 5);
    expect(stages.filter((s) => s.status === "done").map((s) => s.stage)).toEqual(["embed", "search", "draft"]);
  });

  it("Chat with no evidence answers from general knowledge: no passages, no collection, no citations", async () => {
    const lib = new FakeLibrary([{ source: "cs_ai", row: 1, score: 0.73 }, { source: "human_biology", row: 2, score: 0.5 }]);
    const long = "Here is a general answer.\n\nIt has a second paragraph [C1].\n\n- and a list item\n- and another";
    const bodies = stubProxy(() => long);
    const a = new Assistant(MANIFEST, lib, shards, noUploads, "https://proxy.test");
    const out = await a.chat({ turns: [{ role: "user", content: "write a poem about the sea" }], groundedOnly: false, summary: null });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.passages).toBeUndefined();
    expect(bodies[0]?.collection).toBeUndefined();
    expect(out.grounded).toBe(false);
    expect(out.citations).toEqual([]);
    expect(out.context).toEqual([]);
    expect(out.sourceLine).toBe(GENERAL_LINE);
    expect(out.answer).toBe("Here is a general answer.\n\nIt has a second paragraph.\n\n- and a list item\n- and another");
  });

  it("Grounded only with no evidence abstains without calling the model", async () => {
    const lib = new FakeLibrary([{ source: "indian_law", row: 3, score: 0.6 }, { source: "cs_ai", row: 8, score: 0.7 }]);
    const bodies = stubProxy(() => "never");
    const a = new Assistant(MANIFEST, lib, shards, noUploads, "https://proxy.test");
    const stages: StageEvent[] = [];
    const out = await a.chat({ turns: [{ role: "user", content: "capital of France?" }], groundedOnly: true, summary: null }, { onStage: (e) => stages.push(e) });
    expect(bodies).toHaveLength(0);
    expect(out.outcome).toBe("abstained");
    expect(out.abstentionMessage).toBe(NO_EVIDENCE_MESSAGE);
    expect(out.check?.reason).toBe("no_evidence");
    expect(out.check?.llmCalls).toBe(0);
    expect(out.closest?.length).toBeGreaterThan(0);
    expect(stages.filter((s) => s.status === "skipped").map((s) => s.stage)).toEqual(["synth", "guards", "critic"]);
    expect(lib.calls[0]?.k).toBe(40);
  });

  it("Grounded only with evidence uses the profile of the dominant library", async () => {
    const lib = new FakeLibrary([{ source: "consumer_law", row: 1, score: 0.7 }, { source: "consumer_law", row: 2, score: 0.69 }, { source: "indian_law", row: 3, score: 0.66 }]);
    const bodies = stubProxy((b) =>
      b.mode === "synth" ? JSON.stringify({ abstain: false, answer: "Passage 1 of consumer_law [C1].", citations: ["C1"] }) : JSON.stringify({ verdict: "accept", unsupported_sentences: [], feedback: "" }),
    );
    const a = new Assistant(MANIFEST, lib, shards, noUploads, "https://proxy.test");
    const out = await a.chat({ turns: [{ role: "user", content: "who may complain?" }], groundedOnly: true, summary: null });
    expect(bodies.map((b) => [b.mode, b.profile])).toEqual([["synth", "consumer_law"], ["critic", "consumer_law"]]);
    expect(out.outcome).toBe("answered");
    expect(out.passages.map((p) => p.source)).toEqual(["consumer_law"]);
  });
});
