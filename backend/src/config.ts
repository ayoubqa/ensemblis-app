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

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const searchProvider = ((): "tavily" | "wikipedia" | "off" => {
  const raw = process.env.SEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === "tavily" || raw === "wikipedia" || raw === "off") return raw;
  return process.env.TAVILY_API_KEY?.trim() ? "tavily" : "wikipedia";
})();

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

  // Number of reverse proxies in front of the app, so `req.ip` is the client.
  trustProxy: int("TRUST_PROXY", 1),

  // Headers (lower-case, tried in order) that carry the real client IP, set by
  // the platform's edge and NOT forgeable by the client. Render puts several
  // proxies in front of the app and only appends to X-Forwarded-For, so with
  // TRUST_PROXY=1 `req.ip` is a shared proxy address — every visitor would
  // share one rate-limit / guest-trial bucket. Render is fronted by Cloudflare,
  // which sets CF-Connecting-IP / True-Client-IP itself. Default: those two on
  // Render (the RENDER env var is set there), none elsewhere. "none" = off.
  clientIpHeaders: ((): string[] => {
    const raw = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
    if (raw === "none" || raw === "off" || raw === "false") return [];
    if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
    return process.env.RENDER ? ["cf-connecting-ip", "true-client-ip"] : [];
  })(),

  // Exact origins, comma-separated; trailing slashes are ignored.
  corsOrigins,

  // ---------------------------------------------------------------- v3
  // Public URL of the frontend, used in emails, share links and Stripe redirects.
  appUrl: (process.env.APP_URL?.trim() || corsOrigins[0] || "http://localhost:3000").replace(/\/+$/, ""),

  // Emails allowed to open the owner dashboard (comma-separated, case-insensitive).
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Web research. Default: Tavily when a key is set, otherwise keyless Wikipedia.
  search: {
    provider: searchProvider,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || "",
    // Max search API calls per UTC day across the server (Tavily free = 1,000/month ≈ 30/day).
    dailyBudget: int("SEARCH_DAILY_BUDGET", 30),
  },

  // Transactional email via Resend (https://resend.com). Off unless both are set.
  email: {
    resendApiKey: process.env.RESEND_API_KEY?.trim() || "",
    from: process.env.EMAIL_FROM?.trim() || "", // e.g. "Ensemblis <hello@yourdomain.com>"
    get enabled() {
      return !!(this.resendApiKey && this.from);
    },
  },

  // Real payments via Stripe Checkout. Off unless both are set. Use test keys first.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || "",
    get enabled() {
      return !!(this.secretKey && this.webhookSecret);
    },
  },
  creditPacks: [
    { id: "starter", label: "Starter", priceCents: 1000, credits: 1000 },
    { id: "growth", label: "Growth", priceCents: 2500, credits: 2750, popular: true },
    { id: "scale", label: "Scale", priceCents: 5000, credits: 6000 },
  ] as { id: string; label: string; priceCents: number; credits: number; popular?: boolean }[],

  // "Try without signing up"
  guest: {
    enabled: bool("GUEST_TRIAL_ENABLED", true),
    creditsCents: int("GUEST_CREDITS_CENTS", 5000),
    maxTasks: int("GUEST_MAX_TASKS", 1, 1), // total task runs a guest account may start
    perIpPerDay: int("GUEST_TRIALS_PER_IP_PER_DAY", 2, 1),
    globalPerDay: int("GUEST_TRIALS_PER_DAY", 30, 0),
    retentionDays: int("GUEST_RETENTION_DAYS", 7, 1), // unclaimed guest accounts are deleted after this
  },

  // Cloudflare Turnstile bot check for guest trial + sign-up. Off unless both are set.
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() || "",
    secretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || "",
    get enabled() {
      return !!(this.siteKey && this.secretKey);
    },
  },

  followupCostCents: int("FOLLOWUP_COST_CENTS", 200),
  clarifyEnabled: bool("CLARIFY_ENABLED", true),
  attachments: {
    maxPerTask: int("MAX_ATTACHMENTS", 3, 0),
    maxChars: int("MAX_ATTACHMENT_CHARS", 40000, 1000),
  },
  devTestRunsPerDay: int("DEV_TEST_RUNS_PER_DAY", 3),
  // Salt for hashing IPs (guest-trial limits). Never store raw IPs.
  ipHashSalt: process.env.IP_HASH_SALT?.trim() || process.env.JWT_SECRET?.trim() || "dev-ip-salt",
};

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && config.adminEmails.includes(email.trim().toLowerCase());
}

/** Human-readable web research provider, shown in the UI and owner dashboard. */
export function searchProviderLabel(): string {
  if (config.search.provider === "tavily") return "Tavily web search";
  if (config.search.provider === "wikipedia") return "Wikipedia";
  return "Off";
}

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
