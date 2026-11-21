// The arcade intro: it reaches PRESS START in about 3 s (a modal dialog headed "VeriDex", focus on
// PRESS START), any key skips to PRESS START and the next press enters the app, the SKIP button
// works, it plays once per browser session, Settings can turn it off or replay it, reduced motion
// gets the logo and PRESS START with a short fade, and nothing ever asks for fullscreen.

import { expect, test } from "./fixtures.ts";
import { waitReady } from "./helpers.ts";

test.use({ intro: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __fullscreen: number }).__fullscreen = 0;
    Element.prototype.requestFullscreen = function () {
      (window as unknown as { __fullscreen: number }).__fullscreen++;
      return Promise.resolve();
    };
  });
});

test("the sequence reaches PRESS START; Enter starts the app, which is ready at once", async ({ page }) => {
  await page.goto("./");
  const intro = page.locator(".intro");
  await expect(intro).toBeVisible();
  await expect(intro).toHaveAttribute("role", "dialog");
  await expect(intro).toHaveAttribute("aria-modal", "true");
  await expect(page.getByRole("heading", { name: "VeriDex", level: 1 }).first()).toBeAttached();
  await expect(page.locator(".intro-boot")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".intro-boot")).toContainText("VERIDEX OS v1.0");
  await expect(intro).toHaveAttribute("data-stage", "press", { timeout: 6000 });
  await expect(page.locator(".intro-start")).toBeFocused();
  await expect(page.locator(".intro-start")).toContainText("PRESS START");
  await expect(page.locator(".intro-bubble")).toHaveText("Ready, player one?");
  await expect(page.locator(".intro-row")).toContainText("© VeriDex");
  await expect(page.locator("#app")).toHaveAttribute("inert", "");
  await page.keyboard.press("Enter");
  await expect(intro).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator("#app")).not.toHaveAttribute("inert", "");
  await page.locator("#composer-input").fill("typing works");
  await expect(page.locator("#composer-input")).toHaveValue("typing works");
  expect(await page.evaluate(() => (window as unknown as { __fullscreen: number }).__fullscreen)).toBe(0);
});

test("any key skips to PRESS START and a second press enters; SKIP does the same; it plays once per session", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".intro")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.locator(".intro")).toHaveAttribute("data-stage", "press", { timeout: 1000 });
  await page.keyboard.press("x");
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 3000 });
  await page.reload();
  await waitReady(page);
  await page.waitForTimeout(800);
  await expect(page.locator(".intro")).toHaveCount(0);
  await expect(page.locator("#intro-cover")).toHaveCount(0);
  // Settings: replay it now, and SKIP works
  await page.click("#settings-btn");
  await page.click("#set-intro-replay");
  await expect(page.locator(".intro")).toBeVisible();
  await page.click(".intro-skip");
  await expect(page.locator(".intro")).toHaveAttribute("data-stage", "press");
  await page.click(".intro-start");
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 3000 });
});

test("Settings > Play intro off: a new session opens straight into the app", async ({ page, context }) => {
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem("ragsys.static.prefs.v1") ?? "{}");
    localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ ...prefs, intro: false }));
  });
  await page.goto("./");
  await waitReady(page);
  await page.waitForTimeout(600);
  await expect(page.locator(".intro")).toHaveCount(0);
  void context;
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the logo and PRESS START, no boot text or CRT, then a short fade into the app", async ({ page }) => {
    await page.goto("./");
    const intro = page.locator(".intro");
    await expect(intro).toHaveClass(/\bstill\b/);
    await expect(intro).toHaveAttribute("data-stage", "press", { timeout: 1500 });
    await expect(page.locator(".intro-boot")).toBeHidden();
    await expect(page.locator(".intro-logo svg")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(intro).toHaveClass(/\bfading\b/);
    await expect(intro).toHaveCount(0, { timeout: 1500 });
  });
});
