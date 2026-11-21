// Who VeriDex is, in one place: the facts (also shown in the About view), the identity system
// prompts the Worker puts first in every model request, the routing of meta questions ("who are
// you?", "thanks") away from retrieval, the answers to them (rendered here, with no model call),
// and the safety net that catches a model reply describing itself as another assistant.
// The Worker cannot take prompt text from the browser, so scripts/export-identity.mjs writes the
// prompts below into deploy/worker/src/identity.ts; tests fail when the two drift.

// No value imports: scripts/export-identity.mjs and scripts/smoke_identity.mjs load this file with
// plain Node (type stripping).
import type { Manifest } from "./types.ts";

export const VERIDEX_FACTS = {
  name: "VeriDex",
  tagline: "Ask anything. Every answer verified.",
  builtBy: "Swapnil Shukla (GitHub: Swapnil007-Curious)",
  builder: "Swapnil Shukla",
  github: "https://github.com/Swapnil007-Curious",
  repo: "https://github.com/Swapnil007-Curious/agentic-rag",
  project: "an independent student research project",
  /** The model named in deploy/worker/wrangler.jsonc (LLM_MODEL "openai/gpt-oss-120b"; a test checks it). */
  model: "gpt-oss-120b",
  provider: "Groq",
  capabilities: [
    "answers questions on any topic",
    "searches its library of textbooks and statutes first",
    "cites the exact passages (C1, C2, …)",
    "checks each sentence's citation and numbers against the sources (Verify)",
    "says so when the library lacks evidence",
    "Grounded only mode answers strictly from the library or abstains",
    "reads PDFs you attach, inside your browser",
    "keeps chat history only in this browser",
  ],
  /** The per-visitor limits in deploy/worker/wrangler.jsonc (LIMIT_PER_10MIN, LIMIT_PER_DAY; a test checks them). */
  limits: { per10min: 20, perDay: 200 },
  limitations: [
    "no live web access",
    "cannot run code",
    "general-knowledge answers are not verified and may be wrong",
    "not legal or medical advice",
  ],
} as const;

export interface LibraryTotals {
  books: number;
  passages: number;
  libraries: number;
}

/** Unique documents and passages across every collection (from the manifest, never hard-coded). */
export function libraryTotals(manifest: Pick<Manifest, "collections">): LibraryTotals {
  const docs = new Set<string>();
  let passages = 0;
  for (const c of manifest.collections) {
    for (const s of c.sources) docs.add(s.doc_id);
    passages += c.count;
  }
  return { books: docs.size, passages, libraries: manifest.collections.length };
}

export interface LibraryFacts {
  subjects: string[];
  books: number;
  passages: number;
  collections: { label: string; books: number; passages: number }[];
}

/** Subjects, books and passages from the index metadata. */
export function libraryFacts(manifest: Pick<Manifest, "collections">): LibraryFacts {
  const t = libraryTotals(manifest);
  return {
    subjects: manifest.collections.map((c) => c.label),
    books: t.books,
    passages: t.passages,
    collections: manifest.collections.map((c) => ({ label: c.label, books: c.sources.length, passages: c.count })),
  };
}

export function limitationsText(): string[] {
  const l = VERIDEX_FACTS.limits;
  return [...VERIDEX_FACTS.limitations, `rate limited: ${l.per10min} requests per 10 minutes and ${l.perDay} per day (a Grounded only answer uses up to four, Verify one)`];
}

const n = (x: number): string => x.toLocaleString("en-US");

// ------------------------------------------------------------------ the Worker's identity prompts

/**
 * The identity that opens every chat and synthesizer request (under 220 words; {{today}} in the
 * Worker). Need-to-know: the facts are there for the question that asks for one, never to be
 * volunteered, and a self-description stays at one or two sentences.
 */
export function identityCore(today: string, library: LibraryFacts): string {
  const f = VERIDEX_FACTS;
  return [
    `You are ${f.name}, a question-answering app built by ${f.builder}, with a pixel robot guide called Dex. You answer from a library of open textbooks and Indian statutes when it has evidence, and from general knowledge otherwise.`,
    `Need to know: describe yourself only when asked, in one or two friendly sentences. Never volunteer the model, the code, library statistics or your limitations; give one only when the user asks for that specific detail. Facts for those questions: model: the open-weight ${f.model}, served through ${f.provider}, with ${f.name}'s own search and fact-checking on top; code: ${f.repo}; library: ${n(library.books)} books (${library.subjects.join("; ")}); limits: no live internet, cannot run code, can be wrong.`,
    `Never call yourself ChatGPT, GPT-4, Gemini or any other company's assistant, or claim to be made by OpenAI or another lab (OpenAI released ${f.model}'s weights; ${f.name} is not an OpenAI product). Do not state a training cutoff. Today is ${today}; use it when time matters.`,
  ].join("\n");
}

/** Added for a chat answer with no library evidence (the interface labels it; the answer does not). */
export const GENERAL_TAIL =
  "Answer the question directly and concisely. Do not mention yourself, your library or your sources, and do not add a capabilities list, unless the user asks.";

/** Added when the browser retries a reply that described itself as another assistant. */
export const IDENTITY_REMINDER =
  "Important: your previous reply wrongly described itself as another assistant. You are VeriDex. Do not introduce or describe yourself unless the user asks; never say you are ChatGPT or any other company's assistant, never say you were made by OpenAI, and do not mention a training cutoff.";

/** The short identity of the critic (Verify, Grounded only); its JSON contract follows unchanged. */
export function verifierIdentity(today: string): string {
  return `You are VeriDex's verifier: you check answers for VeriDex, an app built around the open-weight model ${VERIDEX_FACTS.model}. Follow the instructions below exactly and reply only with the JSON they describe. Today is ${today}.`;
}

/** The short identity of the history summarizer. */
export function noteTakerIdentity(today: string): string {
  return `You are VeriDex's note-taker: you summarise the conversation so far for VeriDex, an app built around the open-weight model ${VERIDEX_FACTS.model}. Today is ${today}.`;
}

export type PromptMode = "chat" | "general" | "synth" | "critic" | "summary";

/** The identity system prompt of each kind of model request (the Worker appends the mode's own rules). */
export function buildSystemPrompt(mode: PromptMode, today: string, library: LibraryFacts): string {
  if (mode === "critic") return verifierIdentity(today);
  if (mode === "summary") return noteTakerIdentity(today);
  const core = identityCore(today, library);
  return mode === "general" ? `${core}\n${GENERAL_TAIL}` : core;
}

/** The source of deploy/worker/src/identity.ts (scripts/export-identity.mjs writes it). */
export function workerIdentitySource(library: LibraryFacts): string {
  const q = (s: string): string => JSON.stringify(s);
  return [
    "// VeriDex's identity for the Worker: the first system message of every upstream call.",
    "// Generated from web-static/src/identity.ts by web-static/scripts/export-identity.mjs; do not",
    "// edit by hand (web-static/tests/unit/identity.test.ts fails when the two drift). {{today}} is",
    "// replaced with the request's date.",
    "",
    `export const VERIDEX_MODEL = ${q(VERIDEX_FACTS.model)};`,
    "",
    "/** The identity that opens every chat and synthesizer request. */",
    `export const VERIDEX_SYSTEM = ${q(identityCore("{{today}}", library))};`,
    "",
    "/** Added to a chat request without library passages (a general-knowledge answer). */",
    `export const VERIDEX_GENERAL = ${q(GENERAL_TAIL)};`,
    "",
    "/** Added when the browser retries a reply that described itself as another assistant. */",
    `export const VERIDEX_REMINDER = ${q(IDENTITY_REMINDER)};`,
    "",
    "/** The critic's short variant (Verify, Grounded only); its JSON contract follows unchanged. */",
    `export const VERIDEX_VERIFIER = ${q(verifierIdentity("{{today}}"))};`,
    "",
    "/** The history summarizer's short variant. */",
    `export const VERIDEX_NOTE_TAKER = ${q(noteTakerIdentity("{{today}}"))};`,
    "",
  ].join("\n");
}

/** The visitor's local date, YYYY-MM-DD. */
export function localToday(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ meta questions

export type Intent = "about" | "smalltalk" | "normal";

/** Lower case, common typos and shorthand mended, punctuation dropped, spaces collapsed. */
function normalize(q: string): string {
  return ` ${q.toLowerCase()} `
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\b(veridx|verdex|veridix|veredex|veridexx)\b/g, "veridex")
    .replace(/\b(chat ?gtp|chat ?gpt|chatgbt|chatgp)\b/g, "chatgpt")
    .replace(/\bwh?o+\b/g, "who")
    .replace(/\bwhats\b/g, "what's")
    .replace(/\bwhat is\b/g, "what's")
    .replace(/\b(u|yu|yuo)\b/g, "you")
    .replace(/\bur\b/g, "your")
    .replace(/\br\b/g, "are")
    .replace(/\byourslef\b|\byourelf\b/g, "yourself")
    .replace(/\s+/g, " ")
    .trim();
}

const SMALL_WORDS = [
  "hi+", "hello+", "hey+", "hiya", "howdy", "yo", "greetings",
  "good (?:morning|afternoon|evening|night|day)",
  "thanks?", "thank you", "thx", "ty", "cheers", "much appreciated",
  "bye", "goodbye", "good bye", "see you", "see ya", "later",
  "ok", "okay", "k", "cool", "nice", "great", "awesome", "got it", "alright",
  "how are you", "how's it going", "what's up", "sup",
].join("|");
const SMALL_TAIL = "there|veridex|dex|so much|a lot|very much|again|then|man|buddy|friend|bot";
const SMALLTALK = new RegExp(`^(?:${SMALL_WORDS})(?: (?:${SMALL_WORDS}|${SMALL_TAIL}))*$`);

/** What a question about VeriDex asks for; each topic has its own one-line answer. */
export type AboutTopic = "intro" | "identity" | "builder" | "model" | "code" | "capabilities" | "library" | "limits" | "how";

const OTHER_ASSISTANT = "chatgpt|gpt(?: ?\\w{1,3})?|gemini|bard|copilot|llama|openai|siri|alexa|bing|grok|mistral|deepseek";
const YOU = "(?:you|veridex)";

// each pattern is matched against a whole clause (a meta question is short and addressed to the
// assistant); "you" / "your" / "veridex" is what separates it from a topic question
const TOPICS: [AboutTopic, RegExp][] = [
  ["intro", /^(?:hi |hello |hey )?(?:so )?who are you(?: really| exactly| actually)?$/],
  ["intro", /^(?:hi |hello |hey )?who(?:'s| is) this$/],
  ["intro", /^(?:please )?(?:can you |could you )?introduce yourself(?: please)?$/],
  ["intro", /^(?:please )?(?:can you |could you )?tell me (?:a bit |a little )?about (?:yourself|you|veridex)(?: please)?$/],
  ["intro", /^(?:so )?what are you(?: exactly| really)?$/],
  ["intro", /^(?:what's|who's) veridex$/],
  ["identity", new RegExp(`^(?:are you|is this) (?:veridex|${OTHER_ASSISTANT}|an? (?:ai|bot|chatbot|robot|assistant|human|person|llm)|human|real|a real person)$`)],
  ["builder", new RegExp(`^who (?:built|made|created|developed|designed|trained|programmed|owns|runs|wrote) (?:${YOU}|this (?:app|site|bot|assistant))$`)],
  ["builder", /^who's (?:your|veridex's) (?:creator|maker|developer|author|owner)$/],
  ["builder", new RegExp(`^who(?:'s| is) behind ${YOU}$`)],
  ["model", /^(?:what|which) (?:ai |language )?(?:model|llm) (?:are you|is this|do you use|are you using|powers you|runs you|is behind you|is veridex)$/],
  ["model", /^(?:what|which) (?:model|llm|language model)$/],
  ["model", /^what (?:ai|kind of ai) are you$/],
  ["model", new RegExp(`^what (?:powers|runs) ${YOU}$`)],
  ["model", /^what are you (?:built|based|running) on$/],
  ["model", new RegExp(`^are you (?:using|running on|based on|powered by|built on) (?:${OTHER_ASSISTANT}|a model|an llm)$`)],
  ["code", /^where(?:'s| is) (?:your|veridex's) (?:code|source(?: code)?|repo(?:sitory)?)$/],
  ["code", new RegExp(`^(?:are you|is ${YOU}|is your code) open ?source$`)],
  ["code", new RegExp(`^(?:are you|is ${YOU}|is your code) on github$`)],
  ["code", /^(?:your |veridex's )?(?:github|source code|repo)(?: link| repo| page)?$/],
  ["code", /^(?:can i see|show me) your (?:code|source(?: code)?)$/],
  ["capabilities", new RegExp(`^what can ${YOU} do(?: for me)?$`)],
  ["capabilities", /^what do you do$/],
  ["capabilities", /^how can you help(?: me)?$/],
  ["capabilities", /^what are (?:your|veridex's) (?:capabilities|features|abilities)$/],
  ["capabilities", /^what are you (?:good at|for)$/],
  ["library", /^what's in (?:your|veridex's|the) library$/],
  ["library", /^what (?:books|documents|sources|subjects|topics) (?:do you have|are in your library|do you know|can you search|do you cover)$/],
  ["library", /^(?:what's|tell me about) your library$/],
  ["library", /^what do you know$/],
  ["library", /^what books$/],
  ["limits", new RegExp(`^what (?:can't|cannot|can not) ${YOU} do$`)],
  ["limits", /^what are (?:your|veridex's) (?:limitations|limits|weaknesses)$/],
  ["limits", /^(?:your )?limitations$/],
  ["limits", /^are you always (?:right|correct|accurate)$/],
  ["limits", /^(?:can you be wrong|do you make mistakes)$/],
  ["how", new RegExp(`^how (?:do|does) ${YOU} work$`)],
  ["how", /^how does this (?:app|site|thing) work$/],
];

function clauseTopic(q: string): AboutTopic | null {
  for (const [topic, re] of TOPICS) if (re.test(q)) return topic;
  return null;
}

function clauses(question: string): string[] {
  return question
    .split(/[.?!;,\n]+|\s+and\s+|\s+also\s+/i)
    .map(normalize)
    .filter(Boolean);
}

function clauseIntent(q: string): Intent {
  if (SMALLTALK.test(q)) return "smalltalk";
  if (clauseTopic(q)) return "about";
  return "normal";
}

/**
 * Route a message: "about" VeriDex, "smalltalk", or a "normal" question for retrieval. A message
 * of several clauses ("Introduce yourself. Who built you and what can you do?") is about VeriDex
 * only when every clause is about VeriDex or small talk; anything else goes to retrieval.
 */
export function classifyIntent(question: string): Intent {
  const parts = clauses(question);
  if (!parts.length) return "normal";
  const kinds = parts.map(clauseIntent);
  if (kinds.some((k) => k === "normal")) return "normal";
  return kinds.includes("about") ? "about" : "smalltalk";
}

// ------------------------------------------------------------------ local answers (no model call)

/** The topics a question about VeriDex asks for, in the order asked (each once). */
export function aboutTopics(question: string): AboutTopic[] {
  const topics: AboutTopic[] = [];
  for (const q of clauses(question)) {
    const t = clauseTopic(q);
    if (t && !topics.includes(t)) topics.push(t);
  }
  return topics.length ? topics : ["intro"];
}

/** "Are you X?": yes for VeriDex (or "an AI", "a bot"), no for another assistant or a person. */
function identityLine(question: string): string {
  const q = clauses(question).join(" ");
  const no = new RegExp(`\\b(?:are you|is this) (?:${OTHER_ASSISTANT}|human|real|a real person|an? (?:human|person))\\b`).test(q);
  return no ? "Nope - I'm VeriDex." : "Yep, I'm VeriDex!";
}

function listing(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The answer to a question about VeriDex: one or two friendly sentences, with a detail only when
 * it was asked for; a combined question gets the matching lines in order, nothing else. dex: Dex
 * is on screen (the introduction mentions him only then).
 */
export function aboutAnswer(question: string, library: LibraryFacts, opts: { dex?: boolean } = {}): { text: string; variant: string; topics: AboutTopic[] } {
  const f = VERIDEX_FACTS;
  const topics = aboutTopics(question);
  const line: Record<AboutTopic, () => string> = {
    intro: () =>
      opts.dex === false
        ? `Hi! I'm ${f.name}. Ask me anything - science, law, code, the human body - and I'll show you where my answers come from.`
        : `Hi! I'm ${f.name}, and this little robot is Dex, your guide. Ask me anything - science, law, code, the human body - and I'll show you where my answers come from.`,
    identity: () => identityLine(question),
    builder: () => `${f.builder} built me.`,
    model: () => `I'm powered by an open-weight language model (${f.model}), with my own search and fact-checking on top.`,
    code: () => `My code is on GitHub: [${f.repo.replace(/^https:\/\//, "")}](${f.repo}).`,
    capabilities: () => ["- Answer questions on almost any topic", "- Show the sources behind my answers", "- Read a PDF you attach", "", "Try a quest to start!"].join("\n"),
    library: () => `My library has ${n(library.books)} books: ${listing(library.subjects)}.`,
    limits: () => ["- No live internet", "- I can't run code", "- Double-check anything important - I can be wrong."].join("\n"),
    how: () => "I search my library for passages that match your question, answer from them (or from general knowledge, labelled so), and can check each sentence's citation and numbers against its source.",
  };
  return { text: topics.map((t) => line[t]()).join("\n\n"), variant: topics.join("+"), topics };
}

export type SmalltalkKind = "greeting" | "thanks" | "bye" | "ack" | "howareyou";

export function smalltalkKind(question: string): SmalltalkKind {
  const q = clauses(question).join(" ");
  if (/\b(?:thanks?|thank you|thx|ty|cheers|appreciated)\b/.test(q)) return "thanks";
  if (/\b(?:bye|goodbye|good bye|see you|see ya|later)\b/.test(q)) return "bye";
  if (/\b(?:how are you|how's it going|what's up|sup)\b/.test(q)) return "howareyou";
  if (/\b(?:hi+|hello+|hey+|hiya|howdy|yo|greetings|good (?:morning|afternoon|evening|night|day))\b/.test(q)) return "greeting";
  return "ack";
}

/** A short local reply to small talk; a greeting suggests one of today's quests. */
export function smalltalkAnswer(question: string, suggestion: string | null): { text: string; kind: SmalltalkKind } {
  const kind = smalltalkKind(question);
  const text = {
    greeting: `Hi! I'm VeriDex. Ask me anything${suggestion ? `, or try one of today's quests: *${suggestion}*` : "."}`,
    thanks: "Anytime!",
    bye: "Bye for now! Your chats stay in this browser.",
    ack: "Great! Ask me anything when you're ready.",
    howareyou: "All systems green, thanks for asking! What would you like to know?",
  }[kind];
  return { text, kind };
}

// ------------------------------------------------------------------ safety net for model replies

/**
 * Sentences in which a reply describes itself as another assistant, as made by OpenAI, or with a
 * training cutoff. First person only: "ChatGPT was created by OpenAI" in an answer about AI is fine.
 */
const FALSE_IDENTITY: RegExp[] = [
  /\b(?:I am|I['’]m|I was|I've been|my name is)\s+(?:an?\s+)?(?:ChatGPT|GPT(?:[-\s]?\d(?:\.\d)?[a-z]*)?|Gemini|Llama[\w.-]*|Bard|Copilot)\b/i,
  /\b(?:I|I['’]m|me|my)\b[^.!?\n]{0,60}\b(?:created|developed|made|trained|built|designed)\s+by\s+OpenAI\b/i,
  /\bas an? (?:AI|assistant|AI assistant|language model|large language model)\b[^.!?\n]{0,40}\b(?:created|developed|made|trained|built)\s+by\s+OpenAI\b/i,
  /\b(?:my|I have a)\s+(?:knowledge|training)(?:\s+data)?\s+(?:cut-?off|ends|goes up to|extends to|runs (?:up )?to)\b/i,
  /\bI (?:was|have been|am) trained (?:on data )?(?:up )?(?:to|until|through)\s+(?:\w+\s+)?(?:19|20)\d\d\b/i,
  /\bmy knowledge (?:is current|is up to date|only goes|stops)\b/i,
];

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Split a reply into lines of prose and fenced code blocks (code is never checked). */
function segments(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let fence: string | null = null;
  let code: string[] = [];
  for (const line of text.split("\n")) {
    const m = FENCE.exec(line);
    if (fence !== null) {
      code.push(line);
      if (m?.[1] && m[1][0] === fence[0] && m[1].length >= fence.length) {
        out.push({ text: code.join("\n"), code: true });
        code = [];
        fence = null;
      }
      continue;
    }
    if (m?.[1]) {
      fence = m[1];
      code = [line];
      continue;
    }
    out.push({ text: line, code: false });
  }
  if (code.length) out.push({ text: code.join("\n"), code: true });
  return out;
}

const SENTENCE = /[^.!?\n]+(?:[.!?]+["')\]]*|$)\s*/g;

/** The sentences of a reply that falsely describe its identity (empty when there are none). */
export function findFalseIdentity(text: string): string[] {
  const hits: string[] = [];
  for (const seg of segments(text)) {
    if (seg.code) continue;
    for (const s of seg.text.match(SENTENCE) ?? []) if (FALSE_IDENTITY.some((re) => re.test(s))) hits.push(s.trim());
  }
  return hits;
}

export const IDENTITY_NOTE = "(VeriDex removed an incorrect self-description.)";

/** The reply without its false self-descriptions, with a note saying so. */
export function stripFalseIdentity(text: string): string {
  const lines = segments(text).map((seg) => {
    if (seg.code) return seg.text;
    return (seg.text.match(SENTENCE) ?? [seg.text])
      .filter((s) => !FALSE_IDENTITY.some((re) => re.test(s)))
      .join("")
      .replace(/\s+$/, "");
  });
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return body ? `${body}\n\n${IDENTITY_NOTE}` : IDENTITY_NOTE;
}
