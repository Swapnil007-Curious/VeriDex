// Screenshots of the arcade intro and the floating Dex for docs/screenshots/ (1366x768, 1440x900
// and iPhone 14; Night and Day): the boot screen, the logo with Dex and PRESS START, the app with
// Large Dex at home, Dex dragged to the top-right with his bubble flipped to the left, the short
// reply to "Introduce yourself", and the open drawer on the phone. Nothing here calls the Worker
// (the introduction is answered in the browser).

import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ask, waitReady } from "../e2e/helpers.ts";

const OUT = join(process.cwd(), "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });
const THEMES = (process.env.SHOTS_THEMES ?? "dark,light").split(",") as ("dark" | "light")[];

for (const theme of THEMES) {
  test(`intro and Dex (${theme})`, async ({ page }, info) => {
    const device = info.project.name;
    const phone = device === "iphone14";
    const shot = (name: string): Promise<Buffer> => page.screenshot({ path: join(OUT, `${name}-${device}-${theme === "dark" ? "night" : "day"}.png`) });
    await page.addInitScript((t) => {
      if (!localStorage.getItem("ragsys.static.prefs.v1")) localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ theme: t }));
      Math.random = () => 0; // the same drag line ("Wheee!") and star field every run
    }, theme);

    // the boot screen, with the real library bar
    await page.goto("./");
    await expect(page.locator(".intro")).toBeVisible();
    await expect(page.locator(".ib-bar")).toBeAttached({ timeout: 4000 });
    await page.waitForTimeout(250);
    await shot("intro-boot");

    // the logo, Dex and PRESS START (the blink held on its visible half)
    await expect(page.locator(".intro")).toHaveAttribute("data-stage", "press", { timeout: 6000 });
    // (set through the CSSOM: the site's Content-Security-Policy rightly refuses an injected style tag)
    await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>(".intro-start");
      if (b) Object.assign(b.style, { animation: "none", opacity: "1", outline: "none" });
    });
    await page.waitForTimeout(400);
    await shot("intro-press");

    // START: the app, Dex Large at home
    await page.keyboard.press("Enter");
    await expect(page.locator(".intro")).toHaveCount(0, { timeout: 3000 });
    await waitReady(page);
    await expect(page.locator("#load-lib")).toHaveClass(/is-ready/, { timeout: 180_000 });
    await expect.poll(() => page.locator("#dex").getAttribute("data-moving"), { timeout: 5000 }).toBeNull();
    await page.waitForTimeout(600);
    await shot("app-dex");

    // dragged to the top-right: the bubble flips to his left
    const grab = await page.evaluate(() => {
      const rects = [...document.querySelectorAll<SVGRectElement>("#dex svg g:not([display]) rect")].map((r) => r.getBoundingClientRect()).filter((b) => b.width >= 12);
      const b = rects[Math.floor(rects.length / 2)] as DOMRect;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    const vw = page.viewportSize()?.width ?? 1366;
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 10, grab.y - 10, { steps: 2 });
    await page.mouse.move(vw - 40, 60, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => page.locator("#dex").getAttribute("data-moving"), { timeout: 5000 }).toBeNull();
    await expect(page.locator("#dex-bubble")).toHaveAttribute("data-side", "left");
    await page.waitForTimeout(150);
    await shot("dex-dragged");

    // home again, then the short reply to "Introduce yourself"
    await page.focus("#dex");
    await page.keyboard.press("Home");
    await expect.poll(() => page.locator("#dex").getAttribute("data-moving"), { timeout: 5000 }).toBeNull();
    await ask(page, "Introduce yourself");
    await expect(page.locator(".msg.assistant .answer")).toContainText("Hi! I'm Veridex");
    await page.waitForTimeout(700);
    await shot("intro-answer");

    // the open drawer on the phone
    if (phone) {
      await page.click("#open-rail");
      await expect(page.locator("#rail")).toHaveClass(/\bopen\b/);
      await page.waitForTimeout(600);
      await shot("drawer");
      await page.keyboard.press("Escape");
    }
  });
}
