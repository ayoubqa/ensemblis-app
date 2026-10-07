// End-to-end suite: drives the real frontend against the real API + a separate
// worker process (backend/scripts/e2e-stack.mjs), with the deterministic mock
// AI provider and a throwaway database (ensemblis_e2e, reset on every run).
//
//   cd backend && npm run build && cd ../frontend && npm run e2e
//
// Needs a local Postgres (see docker-compose.yml). Chromium is taken from
// PLAYWRIGHT_BROWSERS_PATH when set (pre-installed in Claude Code cloud
// containers); otherwise run `npx playwright install chromium` once.
import { defineConfig, devices } from "@playwright/test";

const WEB = "http://localhost:3100";
const API = "http://localhost:4100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node scripts/e2e-stack.mjs",
      cwd: "../backend",
      url: `${API}/health/live`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npx next build && npx next start -p 3100",
      url: WEB,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
