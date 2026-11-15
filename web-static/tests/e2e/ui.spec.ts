// Veridex with the LLM proxy mocked (page.route; nothing calls the real Worker): one assistant
// over the whole library. Covers the general-knowledge path (rendered in full), the merged
// grounded path with citation chips, the evidence inventory and Verify, Grounded only with its
// dominant-library profile and the no-evidence game-over card, Stop and limit errors, uploads,
// stored chats with Undo, share links, the palette, settings, the game layer (level-up, trophies,
// storage blocked), reduced motion, 360 px, the Content-Security-Policy, questions about Veridex
// answered locally, and voice (Web Speech APIs mocked: speak, auto-send, read aloud, no support).

import type { ConsoleMessage, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ask, makePdf, mockProxy, mockSpeech, speechState, waitReady } from "./helpers.ts";

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

async function ready(page: Page): Promise<void> {
  await waitReady(page);
  await expect(page.locator("#load-lib")).toHaveClass(/is-ready/, { timeout: 120_000 });
}

const GENERAL = [
  "**Big-O** describes how running time grows. For example `for x in xs` is $O(n)$.",
  "",
  "A second paragraph explains the idea [C1] in more detail, with enough words to wrap onto more than one line in the dialogue box.",
  "",
  "- first point",
  "- second point",
  "",
  "```python",
  "print(1)",
  "```",
  "",
  "The last paragraph closes the answer.",
].join("\n");

test("a general-knowledge reply streams in full, with its badge and no passages or citations", async ({ page }) => {
  const problems = watchConsole(page);
  const calls = await mockProxy(page, () => GENERAL);
  await page.goto("./");
  await ready(page);
  await ask(page, "write a haiku about my cat's birthday party");
  const reply = page.locator(".msg.assistant").last();
  await expect(reply.locator(".badge-general")).toHaveText("General knowledge");
  await expect(reply.locator(".result-line")).toHaveText("General knowledge — not from the library");
  await expect(reply.locator(".answer strong")).toHaveText("Big-O");
  await expect(reply.locator(".answer")).toContainText("The last paragraph closes the answer.");
  await expect(reply.locator(".answer")).toContainText("second point");
  expect(await reply.locator(".answer p").count()).toBeGreaterThanOrEqual(3);
  await expect(reply.locator(".answer")).not.toContainText("[C1]");
  await expect(reply.locator(".md-pre .md-lang")).toHaveText("python");
  await expect(reply.locator(".katex").first()).toBeVisible(); // KaTeX was loaded on demand
  const box = await reply.locator(".answer").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200); // the whole answer, not one line
  expect(calls).toHaveLength(1);
  expect(calls[0]?.mode).toBe("chat");
  expect(calls[0]?.body.passages).toBeUndefined();
  expect(calls[0]?.body.collection).toBeUndefined();
  await expect(reply.locator(".notice")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a grounded answer cites the merged library; invalid labels go; chips link to inventory cards; Verify stamps PARTIAL", async ({ page }) => {
  const problems = watchConsole(page);
  const calls = await mockProxy(page, (body) => {
    if (body.mode === "critic") return JSON.stringify({ verdict: "accept", unsupported_sentences: [], feedback: "" });
    return "Rebasing replays your commits on top of another branch [C1]. It rewrites history [C9].";
  });
  await page.goto("./");
  await ready(page);
  await ask(page, "What does git rebase do?");
  const reply = page.locator(".msg.assistant").last();
  await expect(reply.locator(".badge-grounded")).toHaveText("Grounded");
  await expect(reply.locator(".result-line")).toHaveText("Answered from the library (1 source)");
  await expect(reply.locator(".answer")).not.toContainText("[C9]");
  await expect(reply.locator(".answer .cite-inline")).toHaveText("C1");
  await expect(reply.locator(".trace .trace-step")).toHaveCount(4); // Embed, Search, Draft, Verify
  await expect(reply.locator('.trace-step[data-status="done"]')).toHaveCount(3);
  const sent = calls[0]?.body as { passages: { label: string; heading: string }[]; collection: { label: string } };
  expect(sent.passages[0]?.label).toBe("C1");
  expect(sent.passages[0]?.heading).toContain("Rebas");
  expect(sent.collection.label).toContain("Computer Science, AI & Coding");
  // the evidence panel opened by itself on desktop; the chip links to its inventory card
  const evidence = page.locator("#evidence");
  await expect(evidence).toBeVisible();
  const card = evidence.locator('.source-card[data-label="C1"]');
  await expect(card.locator(".tag")).toHaveText("CS & AI");
  await reply.locator(".answer .cite-inline").hover();
  await expect(card).toHaveClass(/is-linked/);
  await reply.locator(".src-chip").first().click();
  await expect(evidence.locator(".source-card.is-open .source-excerpt")).not.toBeEmpty();
  await expect(card.locator(".score-num")).toContainText(/cos 0\.\d{3} · \+0\.\d{3}/);
  await page.click("#evidence-close");
  await expect(evidence).toBeHidden();
  await reply.getByRole("button", { name: "Verify this answer against its sources" }).click();
  await expect(reply.locator(".stamp")).toHaveAttribute("data-verdict", "partial");
  await expect(reply.locator(".stamp-detail")).toHaveText("1/2 sentences backed");
  expect(calls.map((c) => c.mode)).toEqual(["chat", "critic"]);
  await expect(page.locator("#xp-text")).toHaveText("15 / 50 XP"); // +10 answer, +5 Verify, no bonus
  expect(problems).toEqual([]);
});

test("Grounded only uses the dominant library's profile and stamps VERIFIED; with no evidence it shows the game-over card without a model call", async ({ page }) => {
  const calls = await mockProxy(page, (body) => {
    if (body.mode === "critic") return JSON.stringify({ verdict: "accept", unsupported_sentences: [], feedback: "" });
    if (body.mode === "synth") {
      const passages = body.passages as { text: string }[];
      return JSON.stringify({ abstain: false, answer: `${passages[0]?.text.split(".")[0] ?? "x"} [C1].`, citations: ["C1"] });
    }
    return "A general answer.";
  });
  await page.goto("./");
  await ready(page);
  await page.click('label[for="grounded-only"]');
  await expect(page.locator("#grounded-only")).toBeChecked();
  await ask(page, "Who can file a complaint before a District Commission?");
  const reply = page.locator(".msg.assistant").last();
  await expect(reply.locator(".stamp")).toHaveAttribute("data-verdict", "supported");
  await expect(reply.locator(".stamp")).toHaveText("Verified");
  await expect(reply.locator(".trace .trace-step")).toHaveCount(5); // Embed, Search, Synth, Guards, Critic
  expect(calls.map((c) => c.mode)).toEqual(["synth", "critic"]);
  expect(calls[0]?.body.profile).toBe("consumer_law");
  await expect(reply.locator(".notice")).toHaveText("Not legal advice.");
  await ask(page, "What is the capital of France?");
  const over = page.locator(".msg.assistant").last().locator(".over");
  await expect(over.locator(".over-title")).toHaveText("Not enough evidence in the library");
  await expect(over.locator(".stamp")).toHaveText("No evidence");
  await expect(page.locator('.msg.assistant .trace-step[data-status="skipped"]').last()).toBeVisible();
  expect(calls).toHaveLength(2); // no model call for the abstention
  await over.getByRole("button", { name: /Switch to Chat/ }).click();
  await expect(page.locator("#mode-chat")).toBeChecked();
  await expect(page.locator(".msg.assistant").last().locator(".badge-general")).toBeVisible();
  expect(calls.map((c) => c.mode)).toEqual(["synth", "critic", "chat"]);
});

test("Stop ends a reply; a rate limit shows a countdown and keeps the question in the composer", async ({ page }) => {
  let mode: "slow" | "busy" | "rate" = "slow";
  await mockProxy(page, async () => {
    if (mode === "slow") {
      await new Promise((r) => setTimeout(r, 4000));
      return "late reply";
    }
    if (mode === "busy") return { status: 429, json: { error: "busy", message: "The assistant is busy right now. Please try again in a minute.", retry_after: 60 } } as never;
    return { status: 429, json: { error: "rate_limited", message: "You have sent many messages in a short time.", retry_after: 125 } } as never;
  });
  await page.goto("./");
  await ready(page);
  await ask(page, "tell me a long story about dragons");
  await expect(page.locator("#stop-btn")).toBeVisible();
  await page.click("#stop-btn");
  await expect(page.locator("#stop-btn")).toBeHidden();
  await expect(page.locator(".msg.assistant .error-card")).toHaveCount(0);
  mode = "busy";
  await ask(page, "another question about dragons");
  await expect(page.locator(".msg.assistant").last().locator(".error-box")).toHaveText("The answer service is busy.");
  await expect(page.locator(".msg.assistant").last().locator(".error-detail")).toContainText(/Try again in 00:5\d/);
  await expect(page.locator("#composer-input")).toHaveValue("another question about dragons");
  mode = "rate";
  await page.fill("#composer-input", "");
  await ask(page, "and one more about dragons");
  const last = page.locator(".msg.assistant").last();
  await expect(last.locator(".error-box")).toHaveText("Limit reached: 20 requests per 10 minutes, 200 per day.");
  await expect(last.locator(".error-detail")).toContainText(/Try again in 02:0\d/);
  await expect(page.locator("#composer-input")).toHaveValue("and one more about dragons");
  expect(await page.locator(".msg.user").count()).toBe(2); // the failed exchange is replaced, never duplicated
  await expect(page.locator("#xp-text")).toHaveText("0 / 50 XP"); // errors give no XP
});

test("an uploaded PDF is indexed in the browser and searched with the library; non-PDFs are refused", async ({ page }) => {
  const calls = await mockProxy(page, () => "The station recorded 4.2 centimetres per day [C1].");
  await page.goto("./");
  await ready(page);
  await page.setInputFiles("#file-input", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("plain text") });
  await expect(page.locator("#upload-text")).toHaveText("Only PDF files can be uploaded.");
  const pdf = makePdf([
    ["Zorblat Field Station Report", "1 Introduction", "The Zorblat field station was founded in 2019 on the northern ridge.", "It monitors glacier melt with twelve automatic sensors."],
    ["2 Findings", "In July 2023 the Zorblat station recorded an average melt rate of 4.2 centimetres per day.", "The highest daily melt was 7.9 centimetres."],
  ]);
  await page.setInputFiles("#file-input", { name: "zorblat report.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.locator("#upload-text")).toContainText("is ready", { timeout: 120_000 });
  await expect(page.locator("#upload-list .upload-item")).toContainText("zorblat report.pdf");
  await expect(page.locator(".trophy-toast")).toContainText("Bookworm");
  await ask(page, "What melt rate did the Zorblat station record in July 2023?");
  const reply = page.locator(".msg.assistant").last();
  await expect(reply.locator(".result-line")).toHaveText("Answered from the library (1 source)");
  await expect(reply.locator(".src-chip")).toContainText("zorblat report.pdf");
  const passages = calls[0]?.body.passages as { heading: string; text: string }[];
  expect(passages.some((p) => p.text.includes("4.2 centimetres"))).toBe(true);
  expect(passages[0]?.heading).toContain("zorblat report");
  await expect(page.locator("#evidence .source-card .tag").first()).toHaveText("Your PDF");
});

test("chats persist and can be deleted with Undo; the page works at 360 px; the CSP allows only the proxy", async ({ page }) => {
  await mockProxy(page, () => "A short answer.");
  await page.goto("./");
  await ready(page);
  await ask(page, "Remember this conversation please");
  await expect(page.locator(".msg.assistant .msg-actions")).toBeVisible();
  await page.reload();
  await waitReady(page);
  await expect(page.locator("#conv-list .conv-open")).toHaveText(["Remember this conversation please"]);
  await page.locator("#conv-list .conv-del").first().click({ force: true });
  await expect(page.locator("#conv-list .conv-open")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#conv-list .conv-open")).toHaveText(["Remember this conversation please"]);
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.click("#open-rail");
  await expect(page.locator("#rail")).toHaveClass(/open/);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("connect-src 'self' https://proxy.test.invalid");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
});

test("a share link pre-fills the composer without sending; there is no collection picker anywhere", async ({ page }) => {
  const calls = await mockProxy(page, () => "never called");
  await page.goto("./?q=What%20does%20Article%2021%20protect%3F&c=indian_law");
  await waitReady(page);
  await expect(page.locator("#composer-input")).toHaveValue("What does Article 21 protect?");
  expect(new URL(page.url()).search).toBe("");
  await page.waitForTimeout(500);
  expect(calls).toHaveLength(0);
  expect(await page.locator(".msg").count()).toBe(0);
  await expect(page.locator("#collection-pill, #rail-collections, #tiles")).toHaveCount(0);
  await expect(page.locator("#stat-line")).toHaveText(/^1 assistant · \d+ books · [\d,]+ passages$/);
  await expect(page.locator(".quest")).toHaveCount(3);
});

test("the palette opens with Ctrl+K and has no collections; settings switch text, CRT and game effects; reduced motion sets the class", async ({ page }) => {
  await page.goto("./");
  await waitReady(page);
  await page.keyboard.press("Control+k");
  const palette = page.locator("dialog.palette");
  await expect(palette).toBeVisible();
  expect(await palette.locator(".palette-group").allTextContents()).not.toContain("Collections");
  await page.keyboard.type("settings");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  const settings = page.locator("#settings");
  await expect(settings).toBeVisible();
  await settings.locator('label[for="set-clean"]').click();
  await expect(page.locator("html")).toHaveClass(/clean-text/);
  await settings.locator('label[for="set-crt"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-crt", "off");
  await settings.locator('label[for="set-game"]').click();
  await expect(page.locator("#player")).toBeHidden();
  await settings.locator('label[for="set-day"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.reload();
  await waitReady(page);
  await expect(page.locator("html")).toHaveClass(/clean-text/); // remembered
  await expect(page.locator("html")).toHaveClass(/game-off/);
  await expect(page.locator("html")).not.toHaveClass(/reduce-motion/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveClass(/reduce-motion/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).not.toHaveClass(/reduce-motion/);
});

test("game: crossing a level threshold shows the level-up banner and trophies; the Achievements view lists them", async ({ page }) => {
  await mockProxy(page, () => "A short answer about nothing in particular.");
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("veridex.game.v1", JSON.stringify({ v: 1, xp: 45 }));
      sessionStorage.setItem("seeded", "1");
    }
  });
  await page.goto("./");
  await ready(page);
  await ask(page, "tell me something cheerful about rainy days");
  await expect(page.locator(".levelup-card")).toContainText("LV 2 · APPRENTICE");
  await expect(page.locator(".trophy-toast")).toContainText("First question");
  await expect(page.locator("#live")).toContainText(/Level up|Answer finished/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".levelup-card")).toHaveCount(0);
  await expect(page.locator("#lv-badge")).toHaveText("LV 2");
  await page.click("#ach-btn");
  const view = page.locator("dialog.achievements");
  await expect(view.locator(".trophy.is-unlocked")).toHaveCount(1);
  await expect(view.locator(".trophy.is-unlocked .trophy-name")).toHaveText("First question");
  await expect(view.locator(".trophy")).toHaveCount(8);
});

test("storage blocked: the app answers and the game runs in memory", async ({ page }) => {
  await mockProxy(page, () => "An answer while storage is blocked.");
  await page.addInitScript(() => {
    const fail = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", { get: fail, configurable: true });
    Object.defineProperty(window, "sessionStorage", { get: fail, configurable: true });
  });
  await page.goto("./");
  await ready(page);
  await expect(page.locator("#storage-note")).toBeVisible();
  await ask(page, "tell me something cheerful about sunny days");
  await expect(page.locator(".msg.assistant .msg-actions")).toBeVisible();
  await expect(page.locator("#xp-text")).toHaveText("10 / 50 XP");
});

test("questions about Veridex get short, plain replies from Dex: no request, no trace, badge or footer", async ({ page }) => {
  const calls = await mockProxy(page, () => "I am ChatGPT, made by OpenAI.");
  await page.goto("./");
  await ready(page);
  await ask(page, "Are you Veridex?");
  const reply = page.locator(".msg.assistant").last();
  await expect(reply.locator(".answer")).toHaveText("Yep, I'm Veridex!");
  await expect(reply.locator(".trace")).toHaveCount(0);
  await expect(reply.locator(".badge")).toHaveCount(0);
  await expect(reply.locator(".result-line")).toHaveCount(0);
  await expect(page.locator("#xp-text")).toHaveText("10 / 50 XP"); // XP like any answer
  await ask(page, "Introduce yourself");
  const intro = page.locator(".msg.assistant").last().locator(".answer");
  await expect(intro).toContainText("Hi! I'm Veridex");
  const text = (await intro.textContent()) ?? "";
  expect(text.split(/\s+/).length).toBeLessThan(60);
  expect(text).not.toMatch(/gpt-oss|Groq|GitHub|passages/);
  await ask(page, "Who are you and who built you?");
  await expect(page.locator(".msg.assistant").last().locator(".answer")).toContainText("Swapnil built me.");
  await ask(page, "What model are you?");
  await expect(page.locator(".msg.assistant").last().locator(".answer")).toHaveText("I'm powered by an open-weight language model (gpt-oss-120b), with my own search and fact-checking on top.");
  await ask(page, "thanks!");
  await expect(page.locator(".msg.assistant").last().locator(".answer")).toHaveText("Anytime!");
  expect(calls).toHaveLength(0); // nothing reached the proxy
});

test.describe("voice with Dex on screen", () => {
  test.use({ dex: true });
  test("voice: the one-time note, listening with a meter, auto-send after a pause, the reply read aloud; Esc stops it", async ({ page }) => {
  const problems = watchConsole(page);
  const calls = await mockProxy(page, () => "Here is a short answer. It has two sentences.");
  await mockSpeech(page);
  await page.goto("./");
  await ready(page);
  await expect(page.locator("#mic-btn")).toBeVisible();
  await expect(page.locator("#dex svg")).toHaveAttribute("aria-hidden", "true");
  await page.click("#mic-btn");
  const note = page.locator("#voice-notice");
  await expect(note).toBeVisible();
  await expect(note).toContainText("in Chrome, audio is processed by Google");
  await page.click("#vn-ok");
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#voice-overlay")).toBeVisible();
  await expect(page.locator("#voice-meter i")).toHaveCount(16);
  await expect(page.locator("#dex")).toHaveAttribute("data-dex-state", "listening");
  await page.evaluate(() => (window as unknown as { __speech: { say(f: string, i?: string): void } }).__speech.say("Write a short poem", " about rain"));
  await expect(page.locator("#vo-final")).toHaveText("Write a short poem");
  await expect(page.locator("#vo-interim")).toHaveText("about rain");
  await page.evaluate(() => (window as unknown as { __speech: { say(f: string): void } }).__speech.say("about rain"));
  // 1.2 s later it is sent as a question
  await expect(page.locator(".msg.user .bubble-user").first()).toHaveText("Write a short poem about rain", { timeout: 5000 });
  await expect(page.locator(".msg.assistant .msg-actions")).toBeVisible({ timeout: 60_000 });
  expect(calls[0]?.body.mode).toBe("chat");
  // a spoken question is answered aloud, sentence by sentence
  await expect.poll(async () => (await speechState(page)).spoken).toEqual(["Here is a short answer."]);
  const speak = page.locator(".speak-btn");
  await expect(speak).toHaveText("Stop");
  await expect(speak).toHaveAttribute("aria-label", "Stop reading the answer");
  await page.keyboard.press("Escape");
  await expect(speak).toHaveText("Speak");
  await expect(speak).toHaveAttribute("aria-label", "Read the answer aloud");
  expect((await speechState(page)).cancels).toBeGreaterThan(0);
  // Speak reads it again; a new question stops the reading
  await speak.click();
  await expect(speak).toHaveText("Stop");
  await ask(page, "thanks");
  await expect(page.locator(".msg.assistant").first().locator(".speak-btn")).toHaveText("Speak");
  expect(problems).toEqual([]);
});

});

test("voice: Ctrl+M toggles listening, a blocked microphone explains itself, and a browser without speech hides the mic", async ({ page, browser }) => {
  await mockSpeech(page);
  await page.addInitScript(() => localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ voiceNotice: true, dex: false })));
  await page.goto("./");
  await waitReady(page);
  await page.keyboard.press("Control+m");
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (window as unknown as { __speech: { error(c: string): void } }).__speech.error("not-allowed"));
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".toast")).toContainText("The microphone is blocked");
  await page.keyboard.press("Control+m");
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+m");
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "false");

  const bare = await browser.newPage();
  await bare.addInitScript(() => sessionStorage.setItem("veridex.intro.v1", "1"));
  await mockSpeech(bare, { input: false, output: false });
  await bare.goto("./");
  await waitReady(bare);
  await expect(bare.locator("#mic-btn")).toBeHidden();
  await expect(bare.locator("#hf-btn")).toBeHidden();
  await bare.click("#settings-btn");
  await expect(bare.locator("#voice-unsupported")).toContainText("Chrome, Edge and Safari");
  await expect(bare.locator("#set-autosend")).toBeHidden();
  await expect(bare.locator("#set-voice")).toBeHidden();
  await bare.close();
});
