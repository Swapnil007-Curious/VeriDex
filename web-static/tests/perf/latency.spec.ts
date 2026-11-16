// Latency of the deployed web pipeline's browser stages, for the paper (Section 6, Figure 4).
// Runs against a production build served locally by tests/perf/serve.mjs (uncompressed, no
// network throttling; playwright.perf.config.ts); the LLM proxy is
// routed to a 503 and never reached. Measures
//   * cold load: a fresh browser context (empty HTTP cache and Cache API) from navigation until
//     the model and all five indexes are ready, and the bytes received;
//   * warm load: a reload in the same context (model and indexes from the Cache API);
//   * per question: query embedding alone (embedQueries) and embedding + int8 search over all five
//     collections (the app's search call, top 5 per collection); search = the difference.
// The questions are the DEV questions of the two evaluated collections (split rule of
// src/ragsys/eval/split.py). Output: ../paper/data/web_latency.json.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const OUT = resolve(repo, "paper/data/web_latency.json");
const QUESTION_FILES = [
  resolve(repo, "data/eval/questions.jsonl"),
  resolve(repo, "collections/cs_ai/eval/questions.jsonl"),
];
const WARMUP = 3;

function isDev(id: string): boolean {
  const h = createHash("sha256").update(`split-v1:${id}`).digest("hex");
  return parseInt(h.slice(0, 8), 16) / 2 ** 32 < 0.3;
}

function devQuestions(): string[] {
  const out: string[] = [];
  for (const file of QUESTION_FILES) {
    for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const q = JSON.parse(line) as { id: string; question: string };
      if (isDev(q.id)) out.push(q.question);
    }
  }
  return out;
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return s[lo]! + (s[hi]! - s[lo]!) * (k - lo);
}

function summary(xs: number[]): { n: number; p50: number; p95: number; mean: number } {
  return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}

async function blockProxy(page: Page): Promise<void> {
  await page.route("https://proxy.test.invalid/**", (route) => route.fulfill({ status: 503, body: "" }));
}

async function loadUntilReady(page: Page): Promise<number> {
  const t0 = Date.now();
  await page.goto("./");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true", undefined, { timeout: 600_000 });
  await expect(page.locator("#load-lib")).toHaveClass(/is-ready/, { timeout: 600_000 });
  return Date.now() - t0;
}

test("browser-stage latency of the deployed pipeline", async ({ browser }) => {
  const questions = devQuestions();
  expect(questions.length).toBeGreaterThan(20);

  // cold load: a new context has an empty cache
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("veridex.intro.v1", "1");
      localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ dex: false }));
    } catch {
      /* ignore */
    }
  });
  await blockProxy(page);
  let bytes = 0;
  page.on("response", async (r) => {
    try {
      const len = Number(r.headers()["content-length"] ?? NaN);
      bytes += Number.isFinite(len) ? len : (await r.body()).length;
    } catch {
      /* redirects and aborted responses have no body */
    }
  });
  const coldMs = await loadUntilReady(page);
  const coldBytes = bytes;
  const warmMs = await loadUntilReady(page);

  // per question
  const embed: number[] = [];
  const embedSearch: number[] = [];
  const run = async (q: string): Promise<[number, number]> =>
    page.evaluate(async (text) => {
      const hook = (window as unknown as { __ragsysTest: { embedQueries(q: string[]): Promise<number[][]>; margins(q: string): Promise<unknown> } }).__ragsysTest;
      const t0 = performance.now();
      await hook.embedQueries([text]);
      const t1 = performance.now();
      await hook.margins(text);
      const t2 = performance.now();
      return [t1 - t0, t2 - t1] as [number, number];
    }, q);
  for (const q of questions.slice(0, WARMUP)) await run(q);
  for (const q of questions) {
    const [e, es] = await run(q);
    embed.push(e);
    embedSearch.push(es);
  }
  const search = embedSearch.map((v, i) => Math.max(0, v - embed[i]!));

  const result = {
    created_utc: new Date().toISOString(),
    what: "browser stages of the deployed web pipeline (production build served uncompressed by a local static server; no network throttling; LLM proxy not called)",
    browser: `${browser.browserType().name()} ${browser.version()} (Playwright, headless)`,
    cpu: cpus()[0]?.model ?? "unknown",
    logical_cpus: cpus().length,
    ram_gb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    n_questions: questions.length,
    warmup_questions: WARMUP,
    question_source: "DEV questions of consumer_law and cs_ai (split rule of src/ragsys/eval/split.py)",
    cold_load_ms: coldMs,
    cold_load_bytes_received: coldBytes,
    warm_load_ms: warmMs,
    embed_ms: summary(embed),
    search_ms: summary(search),
    embed_plus_search_ms: summary(embedSearch),
    note: "search_ms = (embed + search over all five int8 indexes, top 5 per collection) - (embed alone), per question; passage-text shard fetches are not included",
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  await ctx.close();
});
