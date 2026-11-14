// The bodies of the requests the app sends to the Worker, in one place (the engine and
// scripts/smoke_identity.mjs both build them here). Every body carries the visitor's local date for
// the identity prompt; a chat body can ask once for the stronger identity reminder. No prompt text
// is ever sent: the Worker builds the prompts. No value imports: plain Node loads this file.

import type { ProxyPassage, ProxyRequest } from "./api.ts";
import type { Turn } from "./history.ts";

export interface ChatBodyInput {
  turns: readonly Turn[];
  today: string;
  maxChars?: number;
  passages?: readonly ProxyPassage[];
  summary?: string | null;
  collection?: { label: string; notice: string } | null;
  reminder?: boolean;
}

export function chatBody(i: ChatBodyInput): ProxyRequest {
  const max = i.maxChars ?? 4000;
  return {
    mode: "chat",
    today: i.today,
    messages: i.turns.map((t) => ({ role: t.role, content: t.content.slice(0, max) })),
    ...(i.passages?.length ? { passages: [...i.passages] } : {}),
    ...(i.summary ? { summary: i.summary.slice(0, 4000) } : {}),
    ...(i.collection ? { collection: i.collection } : {}),
    ...(i.reminder ? { identity_reminder: true } : {}),
  };
}

export function summaryBody(today: string, transcript: string, previous: string): ProxyRequest {
  return { mode: "summary", today, ...(previous ? { previous_summary: previous.slice(0, 4000) } : {}), transcript };
}

export function synthBody(today: string, profile: string, r: { question: string; passages: ProxyPassage[]; revision?: { previous: string; problems: string[]; new_labels: string[] } }): ProxyRequest {
  return { mode: "synth", today, profile, ...r };
}

export function criticBody(today: string, profile: string, question: string, passages: ProxyPassage[], answer: string): ProxyRequest {
  return { mode: "critic", today, profile, question, passages, answer };
}
