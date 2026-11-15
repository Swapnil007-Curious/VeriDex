import { defineConfig, devices } from "@playwright/test";

// Screenshots for docs/screenshots/ (tests/shots): the production build served by vite preview,
// with the LLM proxy replaced by a local mock server that really streams (tests/shots/mock-worker.ts;
// the site config allows http://localhost proxies). Desktop at 1440x900, a laptop at 1366x768 (the
// intro and Dex shots) and an iPhone 14 (Chromium with the device's viewport, scale and user agent).
const base = "/agentic-rag/";
const port = 4175;
const origin = `http://localhost:${port}`;
export const MOCK_WORKER_PORT = 8787;

const iphone = devices["iPhone 14"];

export default defineConfig({
  testDir: "tests/shots",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `${origin}${base}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } }, testMatch: /intro\.spec\.ts/ },
    { name: "iphone14", use: { ...iphone, defaultBrowserType: "chromium", browserName: "chromium" } },
  ],
  webServer: {
    command: `npx vite build --logLevel warn && npx vite preview --port ${port} --strictPort`,
    env: { BASE_PATH: base, VITE_WORKER_URL: `http://localhost:${MOCK_WORKER_PORT}`, OUT_DIR: "dist-shots" },
    url: `${origin}${base}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
