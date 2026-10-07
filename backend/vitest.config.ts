import { defineConfig } from "vitest/config";

// Tests run against a real Postgres (TEST_DATABASE_URL, default: local
// ensemblis_test). globalSetup re-applies every migration from scratch, so the
// migrations themselves are tested on each run.
const testDb = process.env.TEST_DATABASE_URL || "postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_test?schema=public";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false, // one shared database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDb,
      JWT_SECRET: "test-secret-0123456789abcdef",
      AI_PROVIDER: "mock",
      SEARCH_PROVIDER: "off",
      ENSEMBLIS_NO_AUTOSTART: "1",
      EMBEDDED_WORKER: "false",
      DISABLE_SCHEDULER: "true",
      STEP_RETRY_DELAYS_MS: "0,0,0",
      MAX_TASKS_PER_USER_PER_DAY: "50",
      MAX_TASKS_PER_DAY_GLOBAL: "500",
      RATE_LIMIT_TASK_RUNS_PER_MIN: "1000",
      RATE_LIMIT_SIGNUP_PER_HOUR: "1000",
      RATE_LIMIT_LOGIN_PER_15MIN: "1000",
      RATE_LIMIT_GLOBAL_PER_15MIN: "100000",
      STARTING_CREDITS_CENTS: "5000",
      ADMIN_EMAILS: "owner@example.com",
    },
  },
});
