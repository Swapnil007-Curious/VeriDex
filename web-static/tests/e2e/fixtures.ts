// The browser tests' page fixture: the arcade intro is skipped (as on any later visit in a session)
// unless a test opts in with test.use({ intro: true }), and Dex is hidden unless test.use({ dex:
// true }), so the large floating guide never sits over a button another test clicks.

import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ intro: boolean; dex: boolean }>({
  intro: [false, { option: true }],
  dex: [false, { option: true }],
  page: async ({ page, intro, dex }, use) => {
    await page.addInitScript(
      ({ intro: playIntro, dex: showDex }) => {
        try {
          if (!playIntro) sessionStorage.setItem("veridex.intro.v1", "1");
          const key = "ragsys.static.prefs.v1";
          const prefs = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
          if (!showDex && prefs.dex === undefined) localStorage.setItem(key, JSON.stringify({ ...prefs, dex: false }));
        } catch {
          /* storage blocked in this test: the defaults apply */
        }
      },
      { intro, dex },
    );
    await use(page);
  },
});

export { expect };
