// Veridex's identity: meta-question routing, the local about and small-talk answers (no model
// call), the identity prompts and their drift against the Worker (deploy/worker/src/identity.ts,
// wrangler.jsonc's model and limits), the safety net for model replies (retry once with the
// reminder, then strip), and every request the engine sends, passed through the Worker's own
// validate() and buildMessages(): each final message array opens with the identity (snapshotted).
// The proxy is a stubbed fetch; nothing leaves the test.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as worker from "../../../deploy/worker/src/identity.ts";
import { buildMessages, identityPrompt, validate, type IdentityKind } from "../../../deploy/worker/src/request.ts";
import type { LibrarySearch, SearchResult } from "../../src/embedder.ts";
import { Assistant } from "../../src/engine.ts";
import {
  aboutAnswer,
  buildSystemPrompt,
  classifyIntent,
  findFalseIdentity,
  GENERAL_TAIL,
  IDENTITY_NOTE,
  IDENTITY_REMINDER,
  identityCore,
  libraryFacts,
  noteTakerIdentity,
  smalltalkAnswer,
  stripFalseIdentity,
  VERIDEX_FACTS,
  verifierIdentity,
  workerIdentitySource,
  type PromptMode,
} from "../../src/identity.ts";
import type { HitRef } from "../../src/library.ts";
import type { Chunk, Manifest } from "../../src/types.ts";

const manifest = JSON.parse(readFileSync(new URL("../../public/data/manifest.json", import.meta.url), "utf8")) as Manifest;
const wrangler = readFileSync(new URL("../../../deploy/worker/wrangler.jsonc", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../../../deploy/worker/src/identity.ts", import.meta.url), "utf8");
const LIB = libraryFacts(manifest);
const TODAY = "2026-11-14";
const FALSE_SELF = /I'm ChatGPT|I am ChatGPT|created by OpenAI|developed by OpenAI/i;

describe("classifyIntent", () => {
  const about = [
    "who are you", "Who are you?", "WHO ARE YOU", "who r u", "introduce yourself", "Introduce yourself.", "Please introduce yourself",
    "tell me about yourself", "what are you", "What are you?", "are you veridex", "Are you Veridex?", "are you chatgpt", "ARE YOU CHAT GPT??",
    "are you chatgtp", "are you gpt-4", "who built you", "Who made you?", "who created you", "who developed you", "what can you do",
    "What can you do?!", "what model are you", "Which model powers you?", "how do you work", "How do you work?", "what's in your library",
    "whats in ur library", "what is in your library?", "what is veridex", "Hi! Who are you?", "Introduce yourself. Who built you and what can you do?",
  ];
  const smalltalk = ["hi", "Hi!", "hello", "Hello.", "hey", "hey there", "thanks", "Thanks!", "thank you", "Thank you so much", "bye", "good morning", "Good Morning!", "ok", "okay", "cool", "ok thanks"];
  const normal = [
    "who created the Indian constitution", "what can a transformer model do", "who invented git", "how does git rebase work",
    "what model of the atom did Bohr propose", "how do vaccines work", "what can I do about a defective product", "hello world program in python",
    "who are you supposed to call in an emergency", "tell me about the cell membrane", "who are you and what is git rebase", "what are the fundamental duties under Article 51A",
  ];
  it.each(about)("routes %j to about", (q) => expect(classifyIntent(q)).toBe("about"));
  it.each(smalltalk)("routes %j to smalltalk", (q) => expect(classifyIntent(q)).toBe("smalltalk"));
  it.each(normal)("leaves %j to retrieval", (q) => expect(classifyIntent(q)).toBe("normal"));
  it("treats an empty message as normal", () => expect(classifyIntent("  ?! ")).toBe("normal"));
});

describe("local about answers (no model call)", () => {
  const counts = `${LIB.books} books and ${LIB.passages.toLocaleString("en-US")} passages`;
  it("introduces Veridex with the builder, the model, the real library counts, capabilities and limits", () => {
    const { text, variant } = aboutAnswer("Introduce yourself. Who built you and what can you do?", LIB);
    expect(variant).toBe("intro");
    expect(text).toContain("I'm **Veridex**");
    expect(text).toContain("built by Swapnil (GitHub: [Swapnil007-Curious](https://github.com/Swapnil007-Curious))");
    expect(text).toContain("an independent student research project");
    expect(text).toContain("**gpt-oss-120b**, an open-weight language model, served through Groq");
    expect(text).toContain(counts);
    for (const c of VERIDEX_FACTS.capabilities) expect(text.toLowerCase()).toContain(c.toLowerCase());
    expect(text).toContain("No live web access");
    expect(text).toContain("20 questions per 10 minutes, 200 per day");
  });
  it("answers each kind of question with its own variant", () => {
    const chatgpt = aboutAnswer("Are you ChatGPT?", LIB);
    expect(chatgpt.variant).toBe("other-assistant");
    expect(chatgpt.text.startsWith("No, I'm **Veridex**, not ChatGPT")).toBe(true);
    const yes = aboutAnswer("Are you Veridex?", LIB);
    expect(yes.variant).toBe("veridex");
    expect(yes.text.startsWith("Yes, I'm **Veridex**")).toBe(true);
    const model = aboutAnswer("What model are you?", LIB);
    expect(model.variant).toBe("model");
    expect(model.text).toContain("I run on **gpt-oss-120b**");
    const lib = aboutAnswer("What's in your library?", LIB);
    expect(lib.variant).toBe("library");
    for (const c of manifest.collections) expect(lib.text).toContain(`**${c.label}**: ${c.sources.length} ${c.sources.length === 1 ? "book" : "books"}, ${c.count.toLocaleString("en-US")} passages`);
    const how = aboutAnswer("How do you work?", LIB);
    expect(how.variant).toBe("how");
    expect(how.text.match(/^\d\. \*\*/gm)).toHaveLength(4);
    expect(how.text).toContain("How it works");
  });
  it("never describes Veridex as ChatGPT or as made by OpenAI", () => {
    for (const q of ["Introduce yourself", "Are you ChatGPT?", "Are you Veridex?", "What model are you?", "What's in your library?", "How do you work?"]) {
      const { text } = aboutAnswer(q, LIB);
      expect(text).not.toMatch(FALSE_SELF);
      expect(findFalseIdentity(text)).toEqual([]);
    }
  });
});

describe("local small talk", () => {
  it("greets with one of today's quests, thanks with Anytime!", () => {
    expect(smalltalkAnswer("hi", "What does Archimedes' principle state?").text).toBe("Hi! I'm Veridex. Ask me anything, or try one of today's quests: *What does Archimedes' principle state?*");
    expect(smalltalkAnswer("Hello!", null).text).toBe("Hi! I'm Veridex. Ask me anything.");
    expect(smalltalkAnswer("thanks!", null).text).toBe("Anytime!");
    expect(smalltalkAnswer("ok thanks", null).kind).toBe("thanks");
    expect(smalltalkAnswer("bye", null).kind).toBe("bye");
    expect(smalltalkAnswer("cool", null).kind).toBe("ack");
  });
});

describe("the identity system prompts", () => {
  const modes: PromptMode[] = ["chat", "general", "synth", "critic", "summary"];
  it.each(modes)("%s: under 220 words, Veridex, today's date, no training cutoff", (mode) => {
    const p = buildSystemPrompt(mode, TODAY, LIB);
    expect(p.split(/\s+/).filter(Boolean).length).toBeLessThan(220);
    expect(p).toContain("Veridex");
    expect(p).toContain(TODAY);
    expect(p.toLowerCase()).not.toMatch(/knowledge cutoff|trained (?:up )?(?:until|to)/);
  });
  it("names the model, the builder, the real library and the rules", () => {
    const p = identityCore(TODAY, LIB);
    expect(p.startsWith("You are Veridex, an independent student research project by Swapnil (GitHub: Swapnil007-Curious)")).toBe(true);
    expect(p).toContain(`${LIB.books} books, ${LIB.passages.toLocaleString("en-US")} passages`);
    expect(p).toContain("Never call yourself ChatGPT, GPT-4, Gemini or any other company's assistant");
    expect(p).toContain("Do not state a training cutoff.");
    expect(buildSystemPrompt("general", TODAY, LIB).endsWith(GENERAL_TAIL)).toBe(true);
    expect(verifierIdentity(TODAY).startsWith("You are Veridex's verifier")).toBe(true);
  });
});

describe("drift with the Worker", () => {
  it("deploy/worker/src/identity.ts is the export of src/identity.ts (rerun: npm run identity)", () => {
    expect(workerSource).toBe(workerIdentitySource(LIB));
    expect(worker.VERIDEX_SYSTEM).toBe(identityCore("{{today}}", LIB));
    expect(worker.VERIDEX_GENERAL).toBe(GENERAL_TAIL);
    expect(worker.VERIDEX_REMINDER).toBe(IDENTITY_REMINDER);
    expect(worker.VERIDEX_VERIFIER).toBe(verifierIdentity("{{today}}"));
    expect(worker.VERIDEX_NOTE_TAKER).toBe(noteTakerIdentity("{{today}}"));
    expect(worker.VERIDEX_MODEL).toBe(VERIDEX_FACTS.model);
  });
  it("names the model and the limits in wrangler.jsonc", () => {
    expect(wrangler).toContain(`"LLM_MODEL": "openai/${VERIDEX_FACTS.model}"`);
    expect(wrangler).toContain(`"LIMIT_PER_10MIN": "${VERIDEX_FACTS.limits.per10min}"`);
    expect(wrangler).toContain(`"LIMIT_PER_DAY": "${VERIDEX_FACTS.limits.perDay}"`);
  });
});

describe("safety net: false self-identity in model replies", () => {
  it("flags first-person claims to be another assistant, made by OpenAI, or with a training cutoff", () => {
    for (const bad of [
      "Hello! I'm ChatGPT, created by OpenAI.",
      "I am ChatGPT.",
      "I'm GPT-4, a large language model.",
      "I am Gemini, here to help.",
      "I'm Llama 3.",
      "I was developed by OpenAI to help you.",
      "As an AI language model trained by OpenAI, I can explain that.",
      "My knowledge cutoff is November 2023.",
      "I was trained on data up to 2023, so I may not know.",
    ]) expect(findFalseIdentity(`Rain is water. ${bad} It falls from clouds.`), bad).toHaveLength(1);
  });
  it("leaves answers about AI alone, and never looks inside code", () => {
    for (const ok of ["ChatGPT was created by OpenAI in 2022.", "GPT-4 is a model developed by OpenAI.", "Large language models have a knowledge cutoff.", "Gemini is made by Google."]) expect(findFalseIdentity(ok), ok).toEqual([]);
    expect(findFalseIdentity("Example:\n\n```python\nprint(\"I'm ChatGPT, created by OpenAI\")\n```")).toEqual([]);
  });
  it("strips only the offending sentences and adds the note", () => {
    const out = stripFalseIdentity("Hello! I'm ChatGPT, created by OpenAI. Rain is water falling from clouds [C1].\n\nIt helps plants grow.");
    expect(out).toBe(`Hello! Rain is water falling from clouds [C1].\n\nIt helps plants grow.\n\n${IDENTITY_NOTE}`);
  });
});

// ------------------------------------------------------------------ the engine, end to end

class FakeLibrary implements LibrarySearch {
  ready = Promise.resolve(1);
  searches = 0;
  constructor(private readonly hits: SearchResult["hits"]) {}
  async search(): Promise<SearchResult> {
    this.searches += 1;
    return { vectors: [new Float32Array(4)], hits: this.hits, embedMs: 1, searchMs: 1 };
  }
  async passages(): Promise<Float32Array[]> {
    return [];
  }
}

const chunk = (source: string, row: number): Chunk => ({ chunk_id: `${source}:${row}`, doc_id: "coi", heading_path: `${source} > Section ${row}`, section_ids: [`${source}:s${row}`], pages: "1", n_tokens: 80, text: `Passage ${row} of ${source} states a fact.` });
const shards = { resolve: async (refs: readonly HitRef[]) => refs.map((r) => chunk(r.source, r.row)) };
const noUploads = { docs: [], sources: () => [], titles: () => new Map<string, string>() };
const EVIDENCE = [{ source: "consumer_law", row: 1, score: 0.9 }];
const NONE = [{ source: "cs_ai", row: 2, score: 0.1 }];

function sse(text: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stub(reply: (b: Record<string, unknown>, n: number) => string): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    return sse(reply(body, bodies.length));
  });
  return bodies;
}

/** The message array the Worker would send upstream for a request body. */
const upstream = (body: Record<string, unknown>) => buildMessages(validate(body, new Date(`${TODAY}T12:00:00Z`))).messages;
const turn = (content: string) => ({ turns: [{ role: "user" as const, content }], summary: null });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("every model request opens with the identity", () => {
  it("Chat with evidence, general knowledge, regenerate, Grounded only, Verify and the summary", async () => {
    const bodies = stub((b) => (b.mode === "synth" ? JSON.stringify({ abstain: false, answer: "Passage 1 of consumer_law states a fact [C1].", citations: ["C1"] }) : b.mode === "critic" ? JSON.stringify({ verdict: "accept", unsupported_sentences: [], feedback: "" }) : "Reply [C1]."));
    const grounded = new Assistant(manifest, new FakeLibrary(EVIDENCE), shards, noUploads, "https://proxy.test");
    const none = new Assistant(manifest, new FakeLibrary(NONE), shards, noUploads, "https://proxy.test");
    const out = await grounded.chat({ ...turn("who may file a complaint"), groundedOnly: false }); // Chat with evidence (and PDF Q&A: same builder)
    await grounded.chat({ ...turn("who may file a complaint"), groundedOnly: false }); // Regenerate sends the same request again
    await none.chat({ ...turn("write a haiku"), groundedOnly: false }); // general knowledge
    await grounded.chat({ ...turn("who may file a complaint"), groundedOnly: true }); // synth + critic
    await grounded.verify("who may file a complaint", "Passage 1 of consumer_law states a fact [C1].", out.passages); // Verify
    await (grounded as unknown as { summarizer(): (p: string, t: { role: "user"; content: string }[]) => Promise<string> }).summarizer()("", [{ role: "user", content: "hello" }]);
    expect(bodies.map((b) => b.mode)).toEqual(["chat", "chat", "chat", "synth", "critic", "critic", "summary"]);
    for (const b of bodies) expect(b.today).toBe(TODAY);
    const kinds: IdentityKind[] = ["chat", "chat", "general", "synth", "critic", "critic", "summary"];
    const arrays = bodies.map(upstream);
    arrays.forEach((messages, i) => {
      expect(messages[0]?.role).toBe("system");
      expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
      expect(messages[0]?.content.startsWith(identityPrompt(kinds[i] as IdentityKind, TODAY))).toBe(true);
    });
    expect(arrays[0]?.[0]?.content).toContain("[C1], [C2]"); // the mode's own rules follow, unchanged
    expect(arrays[3]?.[0]?.content).toContain('"abstain"');
    expect(arrays[4]?.[0]?.content).toContain('"verdict"');
    expect(arrays).toMatchSnapshot();
  });

  it("about and small talk are answered locally: no search, no request, one LOCAL step", async () => {
    const bodies = stub(() => "never");
    const lib = new FakeLibrary(EVIDENCE);
    const a = new Assistant(manifest, lib, shards, noUploads, "https://proxy.test");
    const stages: string[] = [];
    const out = await a.chat({ ...turn("Introduce yourself. Who built you and what can you do?"), groundedOnly: false }, { onStage: (e) => stages.push(`${e.stage}:${e.status}`) });
    const hi = await a.chat({ ...turn("hi"), groundedOnly: true, suggestion: "What does Article 21 protect?" });
    expect(bodies).toHaveLength(0);
    expect(lib.searches).toBe(0);
    expect(stages).toEqual(["local:done"]);
    expect(out.intent).toBe("about");
    expect(out.answer).toContain("I'm **Veridex**");
    expect(out.answer).toContain(`${LIB.books} books and ${LIB.passages.toLocaleString("en-US")} passages`);
    expect(hi.intent).toBe("smalltalk");
    expect(hi.answer).toContain("What does Article 21 protect?");
  });
});

describe("the safety net in the engine", () => {
  it("retries once with the reminder and keeps the clean second reply", async () => {
    const bodies = stub((_b, n) => (n === 1 ? "Hello! I'm ChatGPT, created by OpenAI. Rain is water." : "Rain is water falling from clouds."));
    const a = new Assistant(manifest, new FakeLibrary(NONE), shards, noUploads, "https://proxy.test");
    let restarts = 0;
    const out = await a.chat({ ...turn("what is rain"), groundedOnly: false }, { onRestart: () => (restarts += 1) });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.identity_reminder).toBeUndefined();
    expect(bodies[1]?.identity_reminder).toBe(true);
    expect(upstream(bodies[1] as Record<string, unknown>)[0]?.content).toContain(IDENTITY_REMINDER);
    expect(restarts).toBe(1);
    expect(out.answer).toBe("Rain is water falling from clouds.");
    expect(out.identityFix).toBe("retried");
  });
  it("strips the false sentences and adds the note when the retry is still wrong", async () => {
    stub(() => "I am ChatGPT, developed by OpenAI. Rain is water.");
    const a = new Assistant(manifest, new FakeLibrary(NONE), shards, noUploads, "https://proxy.test");
    const out = await a.chat({ ...turn("what is rain"), groundedOnly: false });
    expect(out.identityFix).toBe("stripped");
    expect(out.answer).toBe(`Rain is water.\n\n${IDENTITY_NOTE}`);
  });
  it("does nothing to a clean reply (one request)", async () => {
    const bodies = stub(() => "ChatGPT was created by OpenAI; Veridex runs on an open-weight model.");
    const a = new Assistant(manifest, new FakeLibrary(NONE), shards, noUploads, "https://proxy.test");
    const out = await a.chat({ ...turn("who made chatgpt"), groundedOnly: false });
    expect(bodies).toHaveLength(1);
    expect(out.identityFix).toBeUndefined();
  });
});

describe("the identity smoke script", () => {
  it("lives at the repo root and checks the five prompts", () => {
    const src = readFileSync(new URL("../../../scripts/smoke_identity.mjs", import.meta.url), "utf8");
    for (const q of ["Introduce yourself. Who built you and what can you do?", "Are you Veridex?", "Are you ChatGPT?", "What model are you?", "Who created the Indian constitution?"]) expect(src).toContain(q);
    expect(src).toContain("web-static/src/identity.ts");
    expect(src).toContain("web-static/src/requests.ts");
  });
});
