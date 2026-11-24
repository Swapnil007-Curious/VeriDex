// VeriDex's identity: meta-question routing, the local about and small-talk answers (no model
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
  aboutTopics,
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
  type AboutTopic,
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
    "tell me about yourself", "what are you", "What are you?", "are you veridex", "Are you VeriDex?", "are you chatgpt", "ARE YOU CHAT GPT??",
    "are you chatgtp", "are you gpt-4", "who built you", "Who made you?", "who created you", "who developed you", "what can you do",
    "What can you do?!", "what model are you", "Which model powers you?", "how do you work", "How do you work?", "what's in your library",
    "whats in ur library", "what is in your library?", "what is veridex", "Hi! Who are you?", "Introduce yourself. Who built you and what can you do?",
    "hi who's this", "where is your code", "are you open source", "is veridex on github", "what powers you", "what ai are you", "what can't you do",
    "what are your limitations", "are you always right", "how can you help", "what do you know", "what books do you have", "who is behind veridex",
  ];
  const smalltalk = ["hi", "Hi!", "hello", "Hello.", "hey", "hey there", "thanks", "Thanks!", "thank you", "Thank you so much", "bye", "good morning", "Good Morning!", "ok", "okay", "cool", "ok thanks"];
  const normal = [
    "who created the Indian constitution", "what can a transformer model do", "who invented git", "how does git rebase work",
    "what model of the atom did Bohr propose", "how do vaccines work", "what can I do about a defective product", "hello world program in python",
    "who are you supposed to call in an emergency", "tell me about the cell membrane", "who are you and what is git rebase", "what are the fundamental duties under Article 51A",
    // topic questions that share words with meta ones
    "who built the Taj Mahal", "what can a neural network do", "what is a library in Python", "what model of atom did Bohr propose", "who wrote Hamlet",
    "is Python open source", "what powers a car engine", "where is the code of civil procedure", "who runs the Supreme Court", "what are the limitations of Newton's laws",
    "what books did Darwin write", "what is GitHub", "which model of car is most reliable", "how can I help my plants grow", "what can't penguins do",
    "are you sure that is right about the Krebs cycle", "how does a transistor work",
  ];
  it.each(about)("routes %j to about", (q) => expect(classifyIntent(q)).toBe("about"));
  it.each(smalltalk)("routes %j to smalltalk", (q) => expect(classifyIntent(q)).toBe("smalltalk"));
  it.each(normal)("leaves %j to retrieval", (q) => expect(classifyIntent(q)).toBe("normal"));
  it("treats an empty message as normal", () => expect(classifyIntent("  ?! ")).toBe("normal"));
});

describe("local about answers: short, need-to-know only", () => {
  const cases: [string, AboutTopic, string][] = [
    ["Introduce yourself", "intro", "Hi! I'm VeriDex, and this little robot is Dex, your guide. Ask me anything - science, law, code, the human body - and I'll show you where my answers come from."],
    ["Who are you?", "intro", "Hi! I'm VeriDex, and this little robot is Dex, your guide."],
    ["Are you VeriDex?", "identity", "Yep, I'm VeriDex!"],
    ["Are you ChatGPT?", "identity", "Nope - I'm VeriDex."],
    ["are you gpt-4", "identity", "Nope - I'm VeriDex."],
    ["Who built you?", "builder", "Swapnil Shukla built me."],
    ["What model are you?", "model", "I'm powered by an open-weight language model (gpt-oss-120b), with my own search and fact-checking on top."],
    ["Where is your code?", "code", "My code is on GitHub: [github.com/Swapnil007-Curious/VeriDex](https://github.com/Swapnil007-Curious/VeriDex)."],
    ["What can you do?", "capabilities", "- Answer questions on almost any topic\n- Show the sources behind my answers\n- Read a PDF you attach\n\nTry a quest to start!"],
    ["What's in your library?", "library", `My library has ${LIB.books} books: `],
    ["What can't you do?", "limits", "- No live internet\n- I can't run code\n- Double-check anything important - I can be wrong."],
    ["How do you work?", "how", "I search my library for passages that match your question"],
  ];
  it.each(cases)("%j -> %s", (q, topic, line) => {
    const { text, topics } = aboutAnswer(q, LIB);
    expect(topics).toEqual([topic]);
    expect(text.startsWith(line)).toBe(true);
  });
  it("the library line lists every subject and the real book count", () => {
    const { text } = aboutAnswer("What's in your library?", LIB);
    for (const c of manifest.collections) expect(text).toContain(c.label);
    expect(text).toContain(`${LIB.books} books`);
    expect(text.split("\n")).toHaveLength(1);
  });
  it("a combined question gets the matching lines in order, nothing else", () => {
    expect(aboutTopics("Who are you and who built you?")).toEqual(["intro", "builder"]);
    const a = aboutAnswer("Who are you and who built you?", LIB).text;
    expect(a).toBe(`${aboutAnswer("Who are you?", LIB).text}\n\nSwapnil Shukla built me.`);
    expect(aboutTopics("Introduce yourself. Who built you and what can you do?")).toEqual(["intro", "builder", "capabilities"]);
    expect(aboutTopics("what model are you? where is your code?")).toEqual(["model", "code"]);
    expect(aboutTopics("who are you, who are you")).toEqual(["intro"]);
  });
  it("the introduction volunteers nothing: under 60 words, no model, provider, repo or library stats", () => {
    const { text } = aboutAnswer("Introduce yourself", LIB);
    expect(text.split(/\s+/).length).toBeLessThan(60);
    expect(text).not.toMatch(/gpt-oss|Groq|GitHub|passages|\d+ books|20 questions|limit/i);
    expect(aboutAnswer("Introduce yourself", LIB, { dex: false }).text).toBe("Hi! I'm VeriDex. Ask me anything - science, law, code, the human body - and I'll show you where my answers come from.");
  });
  it("never describes VeriDex as ChatGPT or as made by OpenAI", () => {
    for (const [q] of cases) {
      const { text } = aboutAnswer(q, LIB);
      expect(text).not.toMatch(FALSE_SELF);
      expect(findFalseIdentity(text)).toEqual([]);
    }
  });
});

describe("local small talk", () => {
  it("greets with one of today's quests, thanks with Anytime!", () => {
    expect(smalltalkAnswer("hi", "What does Archimedes' principle state?").text).toBe("Hi! I'm VeriDex. Ask me anything, or try one of today's quests: *What does Archimedes' principle state?*");
    expect(smalltalkAnswer("Hello!", null).text).toBe("Hi! I'm VeriDex. Ask me anything.");
    expect(smalltalkAnswer("thanks!", null).text).toBe("Anytime!");
    expect(smalltalkAnswer("ok thanks", null).kind).toBe("thanks");
    expect(smalltalkAnswer("bye", null).kind).toBe("bye");
    expect(smalltalkAnswer("cool", null).kind).toBe("ack");
  });
});

describe("the identity system prompts", () => {
  const modes: PromptMode[] = ["chat", "general", "synth", "critic", "summary"];
  it.each(modes)("%s: under 220 words, VeriDex, today's date, no training cutoff", (mode) => {
    const p = buildSystemPrompt(mode, TODAY, LIB);
    expect(p.split(/\s+/).filter(Boolean).length).toBeLessThan(220);
    expect(p).toContain("VeriDex");
    expect(p).toContain(TODAY);
    expect(p.toLowerCase()).not.toMatch(/knowledge cutoff|trained (?:up )?(?:until|to)/);
  });
  it("says who VeriDex is in one line and keeps the details for the question that asks", () => {
    const p = identityCore(TODAY, LIB);
    expect(p.startsWith("You are VeriDex, a question-answering app built by Swapnil Shukla, with a pixel robot guide called Dex.")).toBe(true);
    expect(p).toContain("describe yourself only when asked, in one or two friendly sentences");
    expect(p).toContain("Never volunteer the model, the code, library statistics or your limitations");
    expect(p).toContain("gpt-oss-120b");
    expect(p).toContain(VERIDEX_FACTS.repo);
    expect(p).toContain(`${LIB.books} books`);
    expect(p).toContain("Never call yourself ChatGPT, GPT-4, Gemini or any other company's assistant");
    expect(p).toContain("Do not state a training cutoff.");
    expect(p).not.toMatch(/20 questions|per day|passages \(/);
    expect(buildSystemPrompt("general", TODAY, LIB).endsWith(GENERAL_TAIL)).toBe(true);
    expect(GENERAL_TAIL).toContain("Do not mention yourself, your library or your sources");
    expect(verifierIdentity(TODAY).startsWith("You are VeriDex's verifier")).toBe(true);
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
    expect(out.variant).toBe("intro+builder+capabilities");
    expect(out.answer).toBe(aboutAnswer("Introduce yourself. Who built you and what can you do?", LIB).text);
    expect(out.answer).not.toContain("passages");
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
    const bodies = stub(() => "ChatGPT was created by OpenAI; VeriDex runs on an open-weight model.");
    const a = new Assistant(manifest, new FakeLibrary(NONE), shards, noUploads, "https://proxy.test");
    const out = await a.chat({ ...turn("who made chatgpt"), groundedOnly: false });
    expect(bodies).toHaveLength(1);
    expect(out.identityFix).toBeUndefined();
  });
});

describe("the identity smoke script", () => {
  it("lives at the repo root and checks the five prompts", () => {
    const src = readFileSync(new URL("../../../scripts/smoke_identity.mjs", import.meta.url), "utf8");
    for (const q of ["Introduce yourself", "Introduce yourself. Who built you and what can you do?", "Are you VeriDex?", "Are you ChatGPT?", "What model are you?", "Who created the Indian constitution?"]) expect(src).toContain(q);
    expect(src).toContain("words >= 60");
    for (const word of ["gpt-oss", "Groq", "GitHub", "passages"]) expect(src).toContain(`/${word}/i`);
    expect(src).toContain("web-static/src/identity.ts");
    expect(src).toContain("web-static/src/requests.ts");
  });
});
