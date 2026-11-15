// The floating Dex (Large, x7): dragged 1:1, thrown with momentum to an edge, snapped to an edge
// within 48 px, remembered after a reload, moved with the arrow keys, sent home with a double-click,
// kept off the composer's send button, and a plain click still starts voice. Pointer input goes to
// his painted pixels only, so every press here lands on a pixel of the sprite.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { mockSpeech, waitReady } from "./helpers.ts";

test.use({ dex: true, viewport: { width: 1280, height: 800 } });

const MARGIN = 12;
const SIZE = 224;

async function pos(page: Page): Promise<{ x: number; y: number }> {
  await expect.poll(() => page.locator("#dex").getAttribute("data-moving"), { timeout: 5000 }).toBeNull();
  const x = Number(await page.locator("#dex").getAttribute("data-x"));
  const y = Number(await page.locator("#dex").getAttribute("data-y"));
  return { x, y };
}

/** A point on one of his painted pixels (the middle of the visor frame). */
async function grabPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll<SVGRectElement>("#dex svg g:not([display]) rect")].map((r) => r.getBoundingClientRect()).filter((b) => b.width >= 20);
    const b = rects[Math.floor(rects.length / 2)] as DOMRect;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

/** Drag from his grab point to a spot, slowly (no momentum): moves, then a pause before the release. */
async function dragTo(page: Page, to: { x: number; y: number }): Promise<void> {
  const from = await grabPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(200); // the velocity history (100 ms) empties: a drop, not a throw
  await page.mouse.up();
}

async function open(page: Page): Promise<{ x: number; y: number }> {
  await page.goto("./");
  await waitReady(page);
  await expect(page.locator("#dex svg")).toHaveAttribute("width", String(SIZE));
  return pos(page);
}

test("he starts at home above the composer, Large (x7), as a focusable button with a spoken label", async ({ page }) => {
  const home = await open(page);
  const composer = (await page.locator("#composer").boundingBox()) as { x: number; y: number; width: number; height: number };
  expect(home.x).toBe(Math.round(composer.x));
  expect(home.y + SIZE).toBeLessThanOrEqual(Math.round(composer.y));
  await expect(page.locator("#dex")).toHaveAttribute("aria-label", "Dex, your guide. Press Enter to talk, arrow keys to move");
});

test("a drag moves him 1:1 and does not start voice; a click does", async ({ page }) => {
  await mockSpeech(page);
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem("ragsys.static.prefs.v1") ?? "{}");
    localStorage.setItem("ragsys.static.prefs.v1", JSON.stringify({ ...prefs, voiceNotice: true }));
  });
  const home = await open(page);
  const grab = await grabPoint(page);
  const offset = { x: grab.x - home.x, y: grab.y - home.y };
  await dragTo(page, { x: 640, y: 300 });
  const p = await pos(page);
  expect(p.x).toBeCloseTo(640 - offset.x, -1);
  expect(p.y).toBeCloseTo(300 - offset.y, -1);
  await page.waitForTimeout(400);
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "false");
  const g = await grabPoint(page);
  await page.mouse.click(g.x, g.y);
  await expect(page.locator("#mic-btn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dex")).toHaveAttribute("data-dex-state", "listening");
});

test("a throw carries momentum to the edge he was thrown at", async ({ page }) => {
  await open(page);
  await dragTo(page, { x: 500, y: 300 });
  await pos(page);
  const g = await grabPoint(page);
  // a fast flick to the right, a frame apart, timed inside the page so test-runner latency cannot
  // stretch it past the 100 ms velocity window
  await page.evaluate(async ({ x, y }) => {
    const el = document.getElementById("dex") as HTMLElement;
    const send = (type: string, cx: number): boolean => el.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 9, button: 0, bubbles: true }));
    send("pointerdown", x);
    for (const dx of [30, 120, 210, 300]) {
      await new Promise((r) => setTimeout(r, 12));
      send("pointermove", x + dx);
    }
    send("pointerup", x + 300);
  }, g);
  const p = await pos(page);
  expect(p.x).toBe(1280 - MARGIN - SIZE);
});

test("dropped near an edge he snaps onto it; the spot survives a reload", async ({ page }) => {
  const home = await open(page);
  const grab = await grabPoint(page);
  const offset = { x: grab.x - home.x, y: grab.y - home.y };
  await dragTo(page, { x: MARGIN + 30 + offset.x, y: 250 + offset.y });
  const p = await pos(page);
  expect(p.x).toBe(MARGIN);
  await page.reload();
  await waitReady(page);
  const again = await pos(page);
  expect(Math.abs(again.x - p.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(again.y - p.y)).toBeLessThanOrEqual(1);
});

test("arrow keys move him 16 px (Shift 64 px), Home sends him home, a double-click too", async ({ page }) => {
  const home = await open(page);
  await page.focus("#dex");
  await page.keyboard.press("ArrowUp");
  expect(await pos(page)).toEqual({ x: home.x, y: home.y - 16 });
  await page.keyboard.press("Shift+ArrowRight");
  expect(await pos(page)).toEqual({ x: home.x + 64, y: home.y - 16 });
  await page.keyboard.press("Home");
  expect(await pos(page)).toEqual(home);
  await dragTo(page, { x: 900, y: 200 });
  expect((await pos(page)).x).not.toBe(home.x);
  const g = await grabPoint(page);
  await page.mouse.dblclick(g.x, g.y);
  expect(await pos(page)).toEqual(home);
});

test("dropped on the composer he moves above it and never covers the send button", async ({ page }) => {
  await open(page);
  const send = (await page.locator("#send-btn").boundingBox()) as { x: number; y: number; width: number; height: number };
  await dragTo(page, { x: send.x + send.width / 2, y: send.y + send.height / 2 });
  const p = await pos(page);
  const composer = (await page.locator("#composer").boundingBox()) as { y: number };
  expect(p.y + SIZE).toBeLessThanOrEqual(Math.round(composer.y));
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("#send-btn") !== null, { x: send.x + send.width / 2, y: send.y + send.height / 2 });
  expect(top).toBe(true);
});
