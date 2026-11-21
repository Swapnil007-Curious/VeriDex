import { defineConfig, devices } from "@playwright/test";

// Latency measurements for the paper (tests/perf): a production build served by a plain static
// server on this machine (tests/perf/serve.mjs), the LLM proxy never called. Writes
// ../paper/data/web_latency.json.
const base = "/agentic-rag/";
const port = 4175;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/perf",
  timeout: 900_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `${origin}${base}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite build --logLevel warn && node tests/perf/serve.mjs dist-perf ${port}`,
    env: { BASE_PATH: base, VITE_WORKER_URL: "https://proxy.test.invalid", OUT_DIR: "dist-perf" },
    url: `${origin}${base}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
