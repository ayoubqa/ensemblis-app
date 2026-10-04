// Every deployment knob in one place. All values come from environment
// variables (see .env.example) and have safe defaults, so a fresh checkout
// runs locally without setting any of them.

import "dotenv/config";

function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[config] Ignoring invalid ${name}="${raw}" — using ${fallback}`);
    return fallback;
  }
  return Math.floor(n);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export const isProduction = process.env.NODE_ENV === "production";

export const config = {
  demoMode: bool("DEMO_MODE", false),

  // Sign-up
  signupInviteCode: process.env.SIGNUP_INVITE_CODE?.trim() || "",
  startingCreditsCents: int("STARTING_CREDITS_CENTS", 10000),

  // Demo credit top-ups (no real payments)
  topupEnabled: bool("DEMO_TOPUP_ENABLED", true),
  topupMaxCents: int("DEMO_TOPUP_MAX_CENTS", 5000),

  // Daily task caps — the "kill switch" protecting the AI bill. Every task run
  // (create, retry, workflow run, scheduled run) counts once.
  maxTasksPerUserPerDay: int("MAX_TASKS_PER_USER_PER_DAY", 10),
  maxTasksPerDayGlobal: int("MAX_TASKS_PER_DAY_GLOBAL", 300),

  maxDescriptionLength: int("MAX_DESCRIPTION_LENGTH", 4000, 10),

  // Per-IP rate limits
  rateLimits: {
    globalPer15Min: int("RATE_LIMIT_GLOBAL_PER_15MIN", 600, 1),
    signupPerHour: int("RATE_LIMIT_SIGNUP_PER_HOUR", 5, 1),
    loginPer15Min: int("RATE_LIMIT_LOGIN_PER_15MIN", 20, 1),
    estimatePerMin: int("RATE_LIMIT_ESTIMATE_PER_MIN", 40, 1),
    taskRunsPerMin: int("RATE_LIMIT_TASK_RUNS_PER_MIN", 10, 1),
  },

  // Number of reverse proxies in front of the app (Render = 1), so rate
  // limits see the real client IP.
  trustProxy: int("TRUST_PROXY", 1),

  // Exact origins, comma-separated; trailing slashes are ignored.
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
};

const INSECURE_SECRETS = new Set(["", "change-me-to-a-long-random-string", "dev-secret-change-me", "changeme", "secret"]);

/**
 * In production, refuse to start with settings that would be unsafe or can't
 * work. Returns the list of problems (empty = OK).
 */
export function productionConfigProblems(): string[] {
  if (!isProduction) return [];
  const problems: string[] = [];
  const secret = process.env.JWT_SECRET?.trim() ?? "";
  if (INSECURE_SECRETS.has(secret) || secret.length < 16) {
    problems.push("JWT_SECRET is missing, a placeholder, or shorter than 16 characters. Set it to a long random string.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    problems.push("DATABASE_URL is missing. Set it to your Postgres connection string (Neon: include ?sslmode=require).");
  }
  return problems;
}

/** Non-fatal production warnings, logged on boot. */
export function productionConfigWarnings(): string[] {
  if (!isProduction) return [];
  const warnings: string[] = [];
  const provider = (process.env.AI_PROVIDER || "ollama").toLowerCase();
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    warnings.push("AI_PROVIDER=openai but OPENAI_API_KEY is not set — every task will fail (and be refunded) until you add it.");
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    warnings.push("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set — every task will fail until you add it.");
  }
  if (provider === "ollama") {
    warnings.push("AI_PROVIDER=ollama in production: a hosted server usually can't reach an Ollama instance. Use AI_PROVIDER=openai.");
  }
  if (!process.env.CORS_ORIGIN) {
    warnings.push("CORS_ORIGIN is not set — only http://localhost:3000 may call this API, so your deployed frontend will be blocked.");
  }
  return warnings;
}
