// Screenshots of the real app states for docs/screenshots/ (desktop 1440x900 and iPhone 14, Night
// and Day). The LLM proxy is a local mock (mock-worker.ts) that streams with real pauses; nothing
// calls the real Worker. The Web Speech APIs and the microphone are mocked (mockSpeech): the
// listening shot feeds the recognizer a transcript, the speaking shot holds the synthesizer on the
// second sentence so its highlight shows. The level-up shot sets the stored XP just below a level threshold before
// asking, so the real level-up path runs. Run: npm run shots (SHOTS_THEMES=dark limits the themes).

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ask, mockSpeech, waitReady } from "../e2e/helpers.ts";
import { MOCK_WORKER_PORT } from "../../playwright.shots.config.ts";
import { startMockWorker, type MockWorker } from "./mock-worker.ts";

const OUT = join(process.cwd(), "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

let worker: MockWorker;
test.beforeAll(async () => {
  worker = await startMockWorker(MOCK_WORKER_PORT);
});
test.afterAll(async () => {
  await worker.close();
});

const THEMES = (process.env.SHOTS_THEMES ?? "dark,light").split(",") as ("dark" | "light")[];

async function newQuest(page: Page): Promise<void> {
  const mobile = (page.viewportSize()?.width ?? 1440) < 1100;
  if (mobile) {
    await page.click("#open-rail");
    await page.waitForTimeout(450);
  }
  await page.click("#new-chat");
  await page.waitForTimeout(450);
}

async function answered(page: Page): Promise<void> {
  await expect(page.locator(".msg.assistant").last().locator(".msg-actions")).toBeVisible({ timeout: 90_000 });
}

for (const theme of THEMES) {
  test.describe(theme, () => {
    test(`states (${theme})`, async ({ page }, info) => {
      const device = info.project.name;
      const mobile = device !== "desktop";
      const shot = (name: string): Promise<Buffer> => page.screenshot({ path: join(OUT, `${name}-${device}-${theme === "dark" ? "night" : "day"}.png`) });
      await page.addInitScript((t) => {
        if (!localStorage.getItem("ragsys.static.prefs.v1")) localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ theme: t, voiceNotice: true }));
        sessionStorage.setItem("veridex.intro.v1", "1"); // the intro has its own shots (intro.spec.ts)
      }, theme);
      await mockSpeech(page);
      const speech = (fn: string, ...args: string[]): Promise<void> =>
        page.evaluate(([f, a]) => (window as unknown as { __speech: Record<string, (...x: string[]) => void> }).__speech[f as string]?.(...(a as string[])), [fn, args] as const);
      worker.setMode("answer");
      await page.goto("./");
      await waitReady(page);
      await expect(page.locator("#load-lib")).toHaveClass(/is-ready/, { timeout: 180_000 });
      await page.waitForTimeout(500);
      await shot("title");

      // voice: Dex listens, the transcript fills the composer (live guess dimmed), the meter moves
      await page.click("#mic-btn");
      await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "true");
      await speech("say", "What does the Consumer Protection Act say", " about refunds");
      await page.waitForTimeout(500);
      await shot("listening");
      await page.keyboard.press("Escape");
      await page.fill("#composer-input", "");

      // a daily quest: the first answer unlocks FIRST QUESTION (toast) and pays quest XP
      await page.locator(".quest").first().click();
      await answered(page);
      await expect(page.locator(".trophy-toast")).toBeVisible();
      await page.waitForTimeout(450);
      await shot("achievement-toast");
      await page.waitForTimeout(4200);
      await newQuest(page);
      await shot("quests");

      // thinking: Dex scans while the library is searched and the draft is requested
      worker.setMode("wait");
      await ask(page, "What is the doctrine of basic structure in the Indian constitution?");
      await expect(page.locator('.msg.assistant .trace-step[data-stage="draft"]')).toHaveAttribute("data-status", "active", { timeout: 90_000 });
      await page.waitForTimeout(300);
      await shot("thinking");
      worker.setMode("answer");
      await answered(page);
      await newQuest(page);

      // streaming mid-answer: the mock pauses after the first words
      worker.setMode("stall");
      await ask(page, "What does git rebase do, and when is it dangerous?");
      await expect(page.locator(".msg.assistant .answer .caret")).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(900);
      await shot("streaming");
      worker.setMode("answer");
      await answered(page);

      // a verified answer with the evidence panel (sheet on the phone)
      await newQuest(page);
      await ask(page, "How does a convolutional layer differ from a fully connected layer?");
      await answered(page);
      await page.getByRole("button", { name: "Verify this answer against its sources" }).first().click();
      await expect(page.locator(".msg.assistant .stamp")).toHaveAttribute("data-verdict", "supported", { timeout: 60_000 });
      await page.waitForTimeout(250);
      await shot("happy");
      if (mobile) await page.getByRole("button", { name: "Show the evidence panel" }).first().click();
      else if (!(await page.locator("#evidence").isVisible())) await page.getByRole("button", { name: "Show the evidence panel" }).first().click();
      await page.waitForTimeout(4600); // let the trophy toast leave the panel header
      await shot("verified-evidence");
      await page.click("#evidence-close");
      await page.waitForTimeout(500);

      // a general-knowledge answer (no passage clears its library's bar)
      await newQuest(page);
      await ask(page, "Write a short poem about the sea at night.");
      await answered(page);
      await expect(page.locator(".msg.assistant .badge-general")).toBeVisible();
      await page.waitForTimeout(600);
      await shot("general");

      // speaking: the answer read aloud, the sentence being read underlined, Dex talking
      await page.locator(".speak-btn").last().click();
      await expect(page.locator(".speak-btn").last()).toHaveText("Stop");
      await page.waitForTimeout(200);
      await speech("next");
      await page.waitForTimeout(400);
      await shot("speaking");
      await page.keyboard.press("Escape");

      // Grounded only with no evidence: the calm game-over card (no model call)
      await newQuest(page);
      await page.click('label[for="grounded-only"]');
      await ask(page, "What is the capital of France?");
      await expect(page.locator(".over")).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(700);
      await shot("abstain");

      // rate limit
      worker.setMode("rate");
      await page.click('label[for="mode-chat"]');
      await ask(page, "Who can file a complaint before a District Commission?");
      await expect(page.locator(".error-card")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await shot("rate-limit");
      worker.setMode("answer");

      // level up: stored XP just below the next threshold, then a real answer
      await page.evaluate(() => {
        const key = "veridex.game.v1";
        const s = JSON.parse(localStorage.getItem(key) ?? "{}");
        const t = [0, 50, 150, 300, 500, 800, 1200];
        const next = t.find((x) => x > (s.xp ?? 0)) ?? 1700;
        s.xp = next - 5;
        localStorage.setItem(key, JSON.stringify(s));
      });
      await page.reload();
      await waitReady(page);
      await expect(page.locator("#load-lib")).toHaveClass(/is-ready/, { timeout: 180_000 });
      await newQuest(page);
      await ask(page, "What is the difference between a list and a tuple in Python?");
      await expect(page.locator(".levelup-card")).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(500);
      await shot("level-up");
      await page.keyboard.press("Escape");

      // Achievements view
      if (mobile) {
        await page.click("#open-rail");
        await page.waitForTimeout(450);
      }
      await page.click("#ach-btn");
      await expect(page.locator("dialog.achievements")).toBeVisible();
      await page.waitForTimeout(400);
      await shot("achievements");
      await page.keyboard.press("Escape");

      // Settings
      await page.click(mobile ? "#settings-top" : "#settings-btn");
      await expect(page.locator("#settings")).toBeVisible();
      await page.waitForTimeout(300);
      await shot("settings");
      await page.evaluate(() => document.getElementById("set-voice-heading")?.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(200);
      await shot("settings-voice");
      await page.keyboard.press("Escape");

      // command palette
      await page.keyboard.press("Control+k");
      await expect(page.locator("dialog.palette")).toBeVisible();
      await page.keyboard.type("quest");
      await page.waitForTimeout(400);
      await shot("palette");
      await page.keyboard.press("Escape");
    });
  });
}
