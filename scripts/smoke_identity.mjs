// Identity smoke test for Veridex. It checks the five prompts below the way the app handles them:
// a question about Veridex is answered by the app's local renderer (web-static/src/identity.ts:
// classifyIntent + aboutAnswer, no network), and any other question goes to the REAL Worker
// through the app's own request builder (web-static/src/requests.ts). Only the last prompt uses
// the network, so it spends one request of the free quota; the test suites never run this file.
//
// Fails when any reply claims to be ChatGPT or made by OpenAI, when one of the first three does not
// say "Veridex", or when "Introduce yourself" is not need-to-know: 60 words or more, or it mentions
// gpt-oss, Groq, GitHub or passages.
//
// Run from the repo root:  node scripts/smoke_identity.mjs   (or in web-static/: npm run smoke:identity)
// Needs Node 22.18 or later (it loads the app's TypeScript modules directly). The Worker URL comes
// from VERIDEX_WORKER_URL, else web-static/site.config.json's workerUrl.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node ${process.versions.node}: this script needs Node 22.18 or later.`);
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(repo, "web-static");
const { aboutAnswer, classifyIntent, findFalseIdentity, libraryFacts, localToday } = await import(pathToFileURL(join(web, "src", "identity.ts")).href); // web-static/src/identity.ts
const { chatBody } = await import(pathToFileURL(join(web, "src", "requests.ts")).href); // web-static/src/requests.ts

const site = JSON.parse(await readFile(join(web, "site.config.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(web, "public", "data", "manifest.json"), "utf8"));
const url = (process.env.VERIDEX_WORKER_URL || site.workerUrl || "").replace(/\/+$/, "");

const PROMPTS = [
  { text: "Introduce yourself", needsName: true, brief: true },
  { text: "Introduce yourself. Who built you and what can you do?", needsName: true },
  { text: "Are you Veridex?", needsName: true },
  { text: "Are you ChatGPT?", needsName: true },
  { text: "What model are you?", needsName: false },
  { text: "Who created the Indian constitution?", needsName: false },
];
const FORBIDDEN = [/I'm ChatGPT/i, /I am ChatGPT/i, /created by OpenAI/i, /developed by OpenAI/i];
/** Details an introduction must not volunteer. */
const NOT_IN_INTRO = [/gpt-oss/i, /Groq/i, /GitHub/i, /passages/i];

/** One chat request to the Worker, built exactly as the app builds it; returns the streamed reply. */
async function askWorker(text) {
  if (!url) throw new Error("no Worker URL: set VERIDEX_WORKER_URL or workerUrl in web-static/site.config.json");
  const body = chatBody({ turns: [{ role: "user", content: text }], today: localToday() });
  const res = await fetch(`${url}/chat`, {
    method: "POST",
    // a development origin, which the Worker always allows
    headers: { "content-type": "application/json", origin: "http://localhost:4173" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  let out = "";
  let buf = "";
  const decoder = new TextDecoder();
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        out += JSON.parse(data).choices?.[0]?.delta?.content ?? "";
      } catch {
        /* a keep-alive or a non-JSON line */
      }
    }
  }
  return out;
}

let failed = false;
for (const p of PROMPTS) {
  const intent = classifyIntent(p.text);
  let reply;
  let route;
  try {
    if (intent === "about") {
      route = "local renderer";
      reply = aboutAnswer(p.text, libraryFacts(manifest)).text;
    } else {
      route = `Worker (${intent})`;
      reply = await askWorker(p.text);
    }
  } catch (err) {
    console.log(`FAIL  ${p.text}\n      ${err instanceof Error ? err.message : err}`);
    failed = true;
    continue;
  }
  const problems = [];
  for (const re of FORBIDDEN) if (re.test(reply)) problems.push(`contains ${re}`);
  if (findFalseIdentity(reply).length) problems.push("false self-description");
  if (p.needsName && !/Veridex/.test(reply)) problems.push('does not say "Veridex"');
  if (p.brief) {
    const words = reply.split(/\s+/).filter(Boolean).length;
    if (words >= 60) problems.push(`${words} words (60 or more)`);
    for (const re of NOT_IN_INTRO) if (re.test(reply)) problems.push(`mentions ${re}`);
  }
  failed ||= problems.length > 0;
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${p.text}  [${route}]${problems.length ? `  (${problems.join("; ")})` : ""}`);
  console.log(`      ${reply.replace(/\s+/g, " ").trim().slice(0, 240)}`);
}
console.log(failed ? "\nidentity smoke test FAILED" : "\nidentity smoke test passed");
process.exit(failed ? 1 : 0);
