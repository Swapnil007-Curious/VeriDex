// Who Veridex is, in one place: the facts (also shown in the About view), the identity system
// prompts the Worker puts first in every model request, the routing of meta questions ("who are
// you?", "thanks") away from retrieval, the answers to them (rendered here, with no model call),
// and the safety net that catches a model reply describing itself as another assistant.
// The Worker cannot take prompt text from the browser, so scripts/export-identity.mjs writes the
// prompts below into deploy/worker/src/identity.ts; tests fail when the two drift.

// No value imports: scripts/export-identity.mjs and scripts/smoke_identity.mjs load this file with
// plain Node (type stripping).
import type { Manifest } from "./types.ts";

export const VERIDEX_FACTS = {
  name: "Veridex",
  tagline: "Ask anything. Every answer verified.",
  builtBy: "Swapnil (GitHub: Swapnil007-Curious)",
  github: "https://github.com/Swapnil007-Curious",
  project: "an independent student research project",
  /** The model named in deploy/worker/wrangler.jsonc (LLM_MODEL "openai/gpt-oss-120b"; a test checks it). */
  model: "gpt-oss-120b",
  provider: "Groq",
  capabilities: [
    "answers questions on any topic",
    "searches its library of textbooks and statutes first",
    "cites the exact passages (C1, C2, …)",
    "checks each sentence against the sources (Verify)",
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
  return [...VERIDEX_FACTS.limitations, `rate limited: ${l.per10min} questions per 10 minutes, ${l.perDay} per day`];
}

const n = (x: number): string => x.toLocaleString("en-US");
const cap = (s: string): string => `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`;

// ------------------------------------------------------------------ the Worker's identity prompts

/** The identity that opens every chat and synthesizer request (under 220 words; {{today}} in the Worker). */
export function identityCore(today: string, library: LibraryFacts): string {
  const f = VERIDEX_FACTS;
  return [
    `You are ${f.name}, ${f.project} by ${f.builtBy}: an app built around ${f.model}, an open-weight language model served through ${f.provider} via a proxy.`,
    `Library: ${n(library.books)} books, ${n(library.passages)} passages (${library.subjects.join("; ")}).`,
    `${f.name} ${f.capabilities.join("; ")}.`,
    `Limits: ${limitationsText().join("; ")}.`,
    `Never call yourself ChatGPT, GPT-4, Gemini or any other company's assistant, or claim to be made by OpenAI or another lab. Asked which model powers you: ${f.name} runs on the open-weight model ${f.model}, served via ${f.provider} (OpenAI released its weights; ${f.name} is not an OpenAI product). Do not state a training cutoff. Today is ${today}; use it when time matters.`,
  ].join("\n");
}

/** Added for a chat answer with no library evidence. */
export const GENERAL_TAIL = "Answer the question directly and concisely; do not add a capabilities list or a self-description unless asked.";

/** Added when the browser retries a reply that described itself as another assistant. */
export const IDENTITY_REMINDER =
  "Important: your previous reply wrongly described itself as another assistant. You are Veridex. Do not introduce or describe yourself unless the user asks; never say you are ChatGPT or any other company's assistant, never say you were made by OpenAI, and do not mention a training cutoff.";

/** The short identity of the critic (Verify, Grounded only); its JSON contract follows unchanged. */
export function verifierIdentity(today: string): string {
  return `You are Veridex's verifier: you check answers for Veridex, an app built around the open-weight model ${VERIDEX_FACTS.model}. Follow the instructions below exactly and reply only with the JSON they describe. Today is ${today}.`;
}

/** The short identity of the history summarizer. */
export function noteTakerIdentity(today: string): string {
  return `You are Veridex's note-taker: you summarise the conversation so far for Veridex, an app built around the open-weight model ${VERIDEX_FACTS.model}. Today is ${today}.`;
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
    "// Veridex's identity for the Worker: the first system message of every upstream call.",
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

// each pattern is matched against a whole clause (a meta question is short and addressed to the
// assistant); "you" / "your" / "veridex" is what separates it from a topic question
const ABOUT: RegExp[] = [
  /^(?:hi |hello |hey )?(?:so )?who are you(?: really| exactly| actually)?$/,
  /^(?:please )?(?:can you |could you )?introduce yourself(?: please)?$/,
  /^(?:please )?(?:can you |could you )?tell me (?:a bit |a little )?about (?:yourself|you|veridex)(?: please)?$/,
  /^(?:so )?what are you(?: exactly| really)?$/,
  /^(?:what's|who's) veridex$/,
  /^are you (?:veridex|chatgpt|gpt(?: ?\w{1,3})?|gemini|openai|an? (?:ai|bot|chatbot|robot|human|person|llm)|human|real)$/,
  /^is this (?:veridex|chatgpt)$/,
  /^who (?:built|made|created|developed|designed|trained|programmed|owns|runs|wrote) (?:you|veridex|this (?:app|site|bot|assistant))$/,
  /^who's (?:your|veridex's) (?:creator|maker|developer|author|owner)$/,
  /^what can (?:you|veridex) do$/,
  /^what do you do$/,
  /^what are (?:your|veridex's) (?:capabilities|limitations|limits|features|abilities)$/,
  /^(?:what|which) (?:ai |language )?(?:model|llm) (?:are you|is this|do you use|are you using|powers you|runs you|is behind you|is veridex)$/,
  /^(?:what|which) model$/,
  /^are you (?:using|running on|based on|powered by) (?:chatgpt|gpt(?: ?\w{1,3})?|gemini|openai|a model|an llm)$/,
  /^how do (?:you|veridex) work$/,
  /^how does veridex work$/,
  /^what's in (?:your|veridex's|the) library$/,
  /^what (?:books|documents|sources|subjects) (?:do you have|are in your library|do you know|can you search)$/,
  /^what's your library$/,
  /^tell me about your library$/,
];

function clauses(question: string): string[] {
  return question
    .split(/[.?!;,\n]+|\s+and\s+|\s+also\s+/i)
    .map(normalize)
    .filter(Boolean);
}

function clauseIntent(q: string): Intent {
  if (SMALLTALK.test(q)) return "smalltalk";
  if (ABOUT.some((re) => re.test(q))) return "about";
  return "normal";
}

/**
 * Route a message: "about" Veridex, "smalltalk", or a "normal" question for retrieval. A message
 * of several clauses ("Introduce yourself. Who built you and what can you do?") is about Veridex
 * only when every clause is about Veridex or small talk; anything else goes to retrieval.
 */
export function classifyIntent(question: string): Intent {
  const parts = clauses(question);
  if (!parts.length) return "normal";
  const kinds = parts.map(clauseIntent);
  if (kinds.some((k) => k === "normal")) return "normal";
  return kinds.includes("about") ? "about" : "smalltalk";
}

// ------------------------------------------------------------------ local answers (no model call)

export type AboutVariant = "intro" | "veridex" | "other-assistant" | "model" | "library" | "how";

/** Which about-answer fits the question. */
export function aboutVariant(question: string): AboutVariant {
  const q = clauses(question).join(" ");
  if (/\b(?:are you|is this)\b.*\b(?:chatgpt|gpt|gemini|openai|llama|bard|copilot)\b/.test(q)) return "other-assistant";
  if (/\b(?:are you|is this) veridex\b/.test(q) && !/\b(?:who|what|how)\b/.test(q)) return "veridex";
  if (/\b(?:model|llm)\b|\b(?:powered by|running on|based on)\b/.test(q) && !/\b(?:who built|who made|introduce)\b/.test(q)) return "model";
  if (/\b(?:library|books|documents|sources|subjects)\b/.test(q) && !/\b(?:introduce|who are)\b/.test(q)) return "library";
  if (/\bhow (?:do|does) (?:you|veridex) work\b/.test(q)) return "how";
  return "intro";
}

function capabilityList(): string[] {
  return VERIDEX_FACTS.capabilities.map((c) => `- ${cap(c)}`);
}

function limitList(): string[] {
  return limitationsText().map((c) => `- ${cap(c)}`);
}

/** The answer to a question about Veridex, rendered from the facts (Markdown). */
export function aboutAnswer(question: string, library: LibraryFacts): { text: string; variant: AboutVariant } {
  const f = VERIDEX_FACTS;
  const who = `${f.project} built by Swapnil (GitHub: [Swapnil007-Curious](${f.github}))`;
  const engine = `I run on **${f.model}**, an open-weight language model, served through ${f.provider} via a small proxy. OpenAI released that model's weights openly, but ${f.name} itself is not an OpenAI product: the library search, citations, verification and this interface are ${f.name}'s own.`;
  const libLine = `My library holds **${n(library.books)} books and ${n(library.passages)} passages**: ${library.subjects.join("; ")}.`;
  const variant = aboutVariant(question);
  let text: string;
  switch (variant) {
    case "other-assistant":
      text = [`No, I'm **${f.name}**, not ChatGPT or any other company's assistant. I'm ${who}.`, "", engine, "", libLine, "", "Ask me anything: I search the library first and cite the exact passages I use."].join("\n");
      break;
    case "veridex":
      text = [`Yes, I'm **${f.name}**, ${who}.`, "", libLine, "I search it first, cite the exact passages, and can check each sentence against them when you press Verify.", "", engine].join("\n");
      break;
    case "model":
      text = [engine, "", "Retrieval runs in your browser: a small embedding model searches the library here, and only the passages that match your question are sent with it."].join("\n");
      break;
    case "library":
      text = [
        `My library holds **${n(library.books)} books and ${n(library.passages)} passages**, searched together for every question:`,
        "",
        ...library.collections.map((c) => `- **${c.label}**: ${n(c.books)} ${c.books === 1 ? "book" : "books"}, ${n(c.passages)} passages`),
        "",
        "You can also add your own PDFs; they are read and indexed in your browser and never uploaded. The About & sources view lists every title and its licence.",
      ].join("\n");
      break;
    case "how":
      text = [
        "Four steps for every question:",
        "",
        "1. **Embed:** your question becomes a vector, in your browser.",
        `2. **Search:** I score all ${n(library.passages)} passages; only those that clear their library's threshold count as evidence.`,
        `3. **Draft:** ${f.model} writes the answer and cites the passages it uses (C1, C2, …). With no evidence I answer from general knowledge and say so.`,
        "4. **Verify:** guards and a critic check each sentence against the cited passages. In Grounded only mode that happens for every answer.",
        "",
        "Open How it works for the details.",
      ].join("\n");
      break;
    default:
      text = [
        `Hi! I'm **${f.name}**, ${who}. I answer questions from a library of open textbooks and Indian statutes and show you exactly where each answer comes from.`,
        "",
        engine,
        "",
        libLine,
        "",
        "**What I can do**",
        ...capabilityList(),
        "",
        "**My limits**",
        ...limitList(),
        "",
        "Ask me anything, or try one of today's quests.",
      ].join("\n");
  }
  return { text, variant };
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
    greeting: `Hi! I'm Veridex. Ask me anything${suggestion ? `, or try one of today's quests: *${suggestion}*` : "."}`,
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

export const IDENTITY_NOTE = "(Veridex removed an incorrect self-description.)";

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
