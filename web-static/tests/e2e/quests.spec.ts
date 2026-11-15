// Every daily-quest question must be answerable from its own library: with the real embedding model
// and the published indexes, the best passage (by margin) comes from the quest's library and clears
// that library's threshold (margin >= 0).

import { expect, test } from "./fixtures.ts";
import { QUEST_POOL } from "../../src/game/quests.ts";
import { waitReady } from "./helpers.ts";

test("every quest in the pool has evidence from its own library (margin >= 0)", async ({ page }) => {
  await page.goto("./");
  await waitReady(page);
  const rows: string[] = [];
  const misses: string[] = [];
  for (const q of QUEST_POOL) {
    const hits: { source: string; score: number; margin: number }[] = await page.evaluate(async (text) => {
      const hook = (window as unknown as { __ragsysTest: { margins(q: string): Promise<{ source: string; score: number; margin: number }[]> } }).__ragsysTest;
      return hook.margins(text);
    }, q.q);
    const best = [...hits].sort((a, b) => b.margin - a.margin)[0];
    rows.push(`${q.id} ${best?.source} ${best?.margin.toFixed(3)}`);
    if (!best || best.margin < 0 || best.source !== q.subject) misses.push(`${q.id}: ${q.q} (best ${best?.source} ${best?.margin.toFixed(3)})`);
  }
  console.log(rows.join("\n"));
  expect(misses, misses.join("\n")).toEqual([]);
});
