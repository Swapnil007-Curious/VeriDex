// The menu at every common width: from 1100 px the rail is docked and there is no menu button;
// below it the top bar's menu button opens the rail as a drawer (spring in from the left, a scrim,
// focus moved in and trapped, the page behind inert and not scrolling) that Esc, the scrim and a
// swipe to the left close, returning focus to the button. A rail collapsed on a wide screen opens
// as the same drawer, and a collapse saved by an earlier visit no longer puts 1366 px into the
// compact layout (the bug behind "the menu button does nothing").

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { waitReady } from "./helpers.ts";

const WIDTHS = [390, 768, 1024, 1280, 1366, 1440, 1920];

async function openDrawer(page: Page): Promise<void> {
  await page.click("#open-rail");
  await expect(page.locator("#rail")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#open-rail")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#scrim")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById("rail")?.getBoundingClientRect().left ?? -1))).toBe(0);
}

async function expectClosed(page: Page): Promise<void> {
  await expect(page.locator("#rail")).not.toHaveClass(/\bopen\b/);
  await expect(page.locator("#open-rail")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#main")).not.toHaveAttribute("inert", "");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("drawer-open"))).toBe(false);
}

async function checkDrawer(page: Page): Promise<void> {
  await openDrawer(page);
  // focus is inside the drawer and stays there; the page behind is inert and does not scroll
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("#rail")))).toBe(true);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#rail")))).toBe(true);
  await expect(page.locator("#main")).toHaveAttribute("inert", "");
  expect(await page.evaluate(() => document.documentElement.classList.contains("drawer-open"))).toBe(true);
  for (const name of ["player", "new-chat", "hist-heading", "pdf-heading", "settings-btn"]) await expect(page.locator(`#${name}`)).toBeVisible();
  // Esc closes and focus returns to the menu button
  await page.keyboard.press("Escape");
  await expectClosed(page);
  await expect(page.locator("#open-rail")).toBeFocused();
  // the scrim closes it
  await openDrawer(page);
  const w = page.viewportSize()?.width ?? 0;
  await page.mouse.click(w - 12, 400);
  await expectClosed(page);
  // a swipe to the left closes it
  await openDrawer(page);
  await page.mouse.move(200, 420);
  await page.mouse.down();
  for (const x of [180, 140, 90, 40]) {
    await page.mouse.move(x, 420, { steps: 2 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expectClosed(page);
}

for (const width of WIDTHS) {
  test(`${width} px: ${width >= 1100 ? "the rail is docked" : "the menu button opens and closes the drawer"}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 800 });
    await page.goto("./");
    await waitReady(page);
    if (width >= 1100) {
      await expect(page.locator("#open-rail")).toBeHidden();
      await expect(page.locator("#rail")).toBeVisible();
      await expect(page.locator("#new-chat")).toBeInViewport();
      expect(await page.evaluate(() => Math.round(document.getElementById("main")?.getBoundingClientRect().left ?? 0))).toBeGreaterThanOrEqual(272);
    } else {
      await expect(page.locator("#open-rail")).toBeVisible();
      await expect(page.locator("#open-rail")).toHaveAttribute("aria-controls", "rail");
      await expect(page.locator("#new-chat")).not.toBeInViewport();
      await checkDrawer(page);
    }
  });
}

test("1366 px: a rail collapsed in an earlier visit is docked again; collapsed now, the menu button opens it as a drawer", async ({ page }) => {
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem("ragsys.static.prefs.v1") ?? "{}");
    localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ ...prefs, railCollapsed: true }));
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("./");
  await waitReady(page);
  await expect(page.locator("#app")).toHaveAttribute("data-rail", "open");
  await expect(page.locator("#open-rail")).toBeHidden();
  await page.click("#rail-collapse");
  await expect(page.locator("#app")).toHaveAttribute("data-rail", "collapsed");
  await expect(page.locator("#open-rail")).toBeVisible();
  await checkDrawer(page);
});
