// Every deployment knob in one place. All values come from environment
// variables (see .env.example) and have safe defaults, so a fresh checkout
// runs locally without setting any of them.

import "dotenv/config";
import { isIP } from "node:net";
import { isPublicAddress } from "./research/netGuard";
import { describeCorsIssues, parseCorsOrigins } from "./lib/corsOrigins";

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

/** Like int(), for amounts with decimals (euros, shares). */
function decimal(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[config] Ignoring invalid ${name}="${raw}" — using ${fallback}`);
    return fallback;
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export const isProduction = process.env.NODE_ENV === "production";

/**
 * The mock model is refused in production AND on any hosting platform, so a
 * forgotten NODE_ENV can't ship scripted output (Render sets RENDER=true on
 * every service; Fly, Railway and Heroku-style hosts set their own markers).
 */
export function mockAIForbidden(): boolean {
  return isProduction || !!(process.env.RENDER || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.DYNO);
}

// Entries that cannot be a browser origin (e.g. `https//www.example.com`, a wildcard) are ignored and reported on boot
// (corsConfigWarnings), instead of sitting in the list where they could never match.
const corsParsed = parseCorsOrigins(process.env.CORS_ORIGIN);
const corsOrigins = corsParsed.origins;

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

  // Ensemblis credits. Balances and prices are stored as whole credits (the
  // historical "*Cents" columns). CREDITS_PER_EUR only values a credit for
  // internal accounting and pricing: at the default 100, 1 credit = €0.01 of
  // credit value, the rate every existing balance was issued at. It is not a
  // token count. See billing/credits.ts.
  creditsPerEur: int("CREDITS_PER_EUR", 100, 1),
  // Runaway guard: an execution whose model calls have used this many tokens
  // stops (and is refunded like any failed execution). 0 = off.
  maxTokensPerExecution: int("MAX_TOKENS_PER_EXECUTION", 600_000, 0),
  // Monetary guard (engine/costGuard.ts): an execution's provider cost — model calls and paid searches,
  // at PROVIDER_PRICING prices — may not exceed the smaller of these limits; it stops before the step that
  // would go over and is refunded. Inactive while PROVIDER_PRICING is unset (warned on boot). 0 = that limit is off.
  costGuard: {
    maxEur: decimal("MAX_COST_PER_EXECUTION_EUR", 0, 0),
    // Share of the execution's price (its credits, at CREDITS_PER_EUR) that provider cost may use.
    maxShareOfPrice: decimal("MAX_COST_SHARE_OF_PRICE", 0.3, 0),
    // Conservative input size assumed for each model call still to come (output is assumed at the model's cap).
    estimatedInputTokensPerCall: int("COST_ESTIMATE_INPUT_TOKENS", 16_000, 1_000),
    // What a run does when part of its cost can't be priced (a model, a paid search or an exchange rate is missing
    // from PROVIDER_PRICING): "stop" (default) stops it before spending more and refunds it; "allow" lets it go on,
    // checking only the part that is priced. Anything other than "allow" means "stop".
    unpriced: (process.env.COST_GUARD_UNPRICED?.trim().toLowerCase() === "allow" ? "allow" : "stop") as "stop" | "allow",
  },

  // Daily task caps — the "kill switch" protecting the AI bill. Every task run
  // (create, retry, workflow run, scheduled run) counts once.
  maxTasksPerUserPerDay: int("MAX_TASKS_PER_USER_PER_DAY", 10),
  maxTasksPerDayGlobal: int("MAX_TASKS_PER_DAY_GLOBAL", 300),

  // Planning caps. Planning (and re-planning) calls the main model before anything is charged, so
  // it has its own limits — otherwise free sign-ups or guests could drain the AI quota for everyone.
  planning: {
    perOrgPerDay: int("MAX_PLANS_PER_ORG_PER_DAY", Math.max(10, 4 * int("MAX_TASKS_PER_USER_PER_DAY", 10)), 1),
    perGuestPerDay: int("MAX_PLANS_PER_GUEST_PER_DAY", 3, 1),
    globalPerDay: int("MAX_PLANS_PER_DAY_GLOBAL", Math.max(50, 4 * int("MAX_TASKS_PER_DAY_GLOBAL", 300)), 1),
    concurrentPerOrg: int("MAX_CONCURRENT_PLANNING_PER_ORG", 3, 1),
  },

  maxDescriptionLength: int("MAX_DESCRIPTION_LENGTH", 4000, 10),

  // Per-IP rate limits
  rateLimits: {
    globalPer15Min: int("RATE_LIMIT_GLOBAL_PER_15MIN", 600, 1),
    signupPerHour: int("RATE_LIMIT_SIGNUP_PER_HOUR", 5, 1),
    loginPer15Min: int("RATE_LIMIT_LOGIN_PER_15MIN", 20, 1),
    estimatePerMin: int("RATE_LIMIT_ESTIMATE_PER_MIN", 40, 1),
    taskRunsPerMin: int("RATE_LIMIT_TASK_RUNS_PER_MIN", 10, 1),
    // Checkout and plan-management requests (credit packs and subscriptions) per minute.
    checkoutPerMin: int("RATE_LIMIT_CHECKOUT_PER_MIN", 10, 1),
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

  // Exact origins (scheme://host[:port]), comma-separated; normalised and validated by lib/corsOrigins.ts.
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
    // Tests and the E2E stub stack only (scripts/stripe-stub.mjs): send Stripe API calls to a local stub.
    apiBase: process.env.STRIPE_API_BASE?.trim() || "",
    get enabled() {
      return !!(this.secretKey && this.webhookSecret);
    },
  },
  // Monthly subscriptions (billing/plans.ts, billing/subscriptions.ts): Stripe Checkout in subscription mode.
  // Off unless SUBSCRIPTIONS_ENABLED=true AND Stripe is configured AND the plan has a Stripe Price ID. Prices
  // and allowances are proposals: change them here (or with the env vars), never in the frontend. The Stripe
  // Price must charge exactly priceCents in EUR per month — checkout refuses a mismatch.
  subscriptions: {
    enabled: bool("SUBSCRIPTIONS_ENABLED", false),
    // While a renewal payment is failing (Stripe "past_due", retries still running): keep the plan's limits
    // ("keep", default) or fall back to the prepaid limits ("revoke"). No new allowance is granted either way.
    pastDueAccess: (process.env.SUBSCRIPTION_PAST_DUE_ACCESS?.trim().toLowerCase() === "revoke" ? "revoke" : "keep") as "keep" | "revoke",
    // Optional Customer Portal configuration (bpc_...). Unset: the Stripe account's default portal configuration.
    portalConfigurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || "",
    plans: [
      {
        id: "starter",
        name: "Starter",
        priceCents: int("PLAN_STARTER_PRICE_CENTS", 2900, 100),
        monthlyCredits: int("PLAN_STARTER_CREDITS", 3000, 1),
        runsPerDay: int("PLAN_STARTER_RUNS_PER_DAY", 5, 1),
        stripePriceId: process.env.STRIPE_PRICE_STARTER?.trim() || "",
        stripeProductId: process.env.STRIPE_PRODUCT_STARTER?.trim() || "",
      },
      {
        id: "growth",
        name: "Growth",
        priceCents: int("PLAN_GROWTH_PRICE_CENTS", 9900, 100),
        monthlyCredits: int("PLAN_GROWTH_CREDITS", 15000, 1),
        runsPerDay: int("PLAN_GROWTH_RUNS_PER_DAY", 15, 1),
        stripePriceId: process.env.STRIPE_PRICE_GROWTH?.trim() || "",
        stripeProductId: process.env.STRIPE_PRODUCT_GROWTH?.trim() || "",
      },
      {
        id: "business",
        name: "Business",
        priceCents: int("PLAN_BUSINESS_PRICE_CENTS", 29900, 100),
        monthlyCredits: int("PLAN_BUSINESS_CREDITS", 60000, 1),
        runsPerDay: int("PLAN_BUSINESS_RUNS_PER_DAY", 40, 1),
        stripePriceId: process.env.STRIPE_PRICE_BUSINESS?.trim() || "",
        stripeProductId: process.env.STRIPE_PRODUCT_BUSINESS?.trim() || "",
      },
    ],
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

export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

/**
 * TAVILY_BASE_URL (no trailing slash) when it points web search somewhere other than the public
 * Tavily API — a test stub or a proxy — else null. The label for it is research/search.ts searchProviderLabel.
 */
export function customTavilyBaseUrl(): string | null {
  const url = (process.env.TAVILY_BASE_URL?.trim() || "").replace(/\/+$/, "");
  return url && url.toLowerCase() !== DEFAULT_TAVILY_BASE_URL ? url : null;
}

/** Names that resolve only on this machine or a private network. */
const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

/**
 * True for a host on this machine or a private network: an IP literal outside public unicast space
 * (loopback, private, link-local, ULA…), a loopback/internal name (also with a trailing dot) or a
 * single-label name such as a Docker service ("ollama"). A hostname is never resolved here.
 */
export function isLocalHost(hostname: string): boolean {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return !isPublicAddress(literal);
  const host = literal.replace(/\.+$/, "");
  return !host.includes(".") || LOCAL_NAME.test(host);
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** The public model APIs this server knows (llmProvider aiProviderLabel names them). */
const PUBLIC_MODEL_HOSTS = new Set(["api.groq.com", "api.openai.com", "openrouter.ai", "api.anthropic.com"]);

/** Where model calls go: a hosted API, an endpoint on this machine or a private network, or a test stub. */
export type ModelEndpoint = "hosted" | "local" | "stub";

/**
 * Where the configured AI provider's calls go, with the endpoint's host (never its path or
 * credentials); null for the mock and an unknown provider.
 *   stub    E2E_STUB=1 and an OpenAI-compatible or Anthropic base URL that is not a known public
 *           model API: the stub stack (scripts/e2e-stack.mjs PROD_LIKE=1) — not a real model;
 *   local   a host on this machine or a private network: self-hosted or a test endpoint, possibly a real model;
 *   hosted  anything else.
 */
export function modelEndpoint(): { kind: ModelEndpoint; host: string } | null {
  const provider = (process.env.AI_PROVIDER || "ollama").trim().toLowerCase();
  const raw =
    provider === "openai"
      ? process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL
      : provider === "anthropic"
        ? process.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL // the Anthropic SDK reads ANTHROPIC_BASE_URL itself
        : provider === "ollama"
          ? process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL
          : null;
  if (!raw) return null;
  let url: URL | null = null;
  try {
    url = new URL(raw.trim());
  } catch {
    /* unparseable: calls fail anyway */
  }
  const host = url?.host ?? "";
  if (provider !== "ollama" && process.env.E2E_STUB === "1" && !PUBLIC_MODEL_HOSTS.has(url?.hostname.toLowerCase() ?? "")) return { kind: "stub", host };
  return { kind: url && isLocalHost(url.hostname) ? "local" : "hosted", host };
}

const INSECURE_SECRETS = new Set(["", "change-me-to-a-long-random-string", "dev-secret-change-me", "changeme", "secret"]);

/**
 * In production, refuse to start with settings that would be unsafe or can't
 * work. Returns the list of problems (empty = OK).
 */
export function productionConfigProblems(role: "api" | "worker" = "api"): string[] {
  const problems: string[] = [];
  // Production, or a hosting platform with NODE_ENV forgotten: the same checks apply.
  if (!mockAIForbidden()) return problems;
  if ((process.env.AI_PROVIDER || "").trim().toLowerCase() === "mock") {
    problems.push('AI_PROVIDER="mock" is a scripted provider for development and tests only. Use "openai", "anthropic" or "ollama".');
  }
  // The worker never signs or verifies sessions; the API must not fall back to the public dev secret.
  const secret = process.env.JWT_SECRET?.trim() ?? "";
  if (role === "api" && (INSECURE_SECRETS.has(secret) || secret.length < 16)) {
    problems.push("JWT_SECRET is missing, a placeholder, or shorter than 16 characters. Set it to a long random string.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    problems.push("DATABASE_URL is missing. Set it to your Postgres connection string (Neon: include ?sslmode=require).");
  }
  return problems;
}

/** Problems with the CORS_ORIGIN value (ignored or adjusted entries), in every environment. Logged on API boot. */
export function corsConfigWarnings(): string[] {
  return describeCorsIssues(corsParsed);
}

/** Non-fatal production warnings, logged on boot. */
export function productionConfigWarnings(role: "api" | "worker" = "api"): string[] {
  if (!mockAIForbidden()) return [];
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
  // A stub or local model endpoint is labelled as such in the UI; a warning only, so the stub stack (E2E_STUB=1) still starts.
  const model = provider === "ollama" ? null : modelEndpoint();
  const baseVar = provider === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL";
  if (model?.kind === "stub") {
    warnings.push(`${baseVar} points at a test stub (${model.host || "an unparseable URL"}, E2E_STUB=1): its output is not a real model's, and the UI labels it a test stub endpoint. Unset E2E_STUB and ${baseVar} in production.`);
  } else if (model?.kind === "local") {
    warnings.push(`${baseVar} is on this machine or a private network (${model.host}): the UI labels it a local model endpoint. Fine for a self-hosted model; if it is a test stub, unset it in production.`);
  }
  const tavilyBase = customTavilyBaseUrl();
  if (tavilyBase && config.search.provider === "tavily" && config.search.tavilyApiKey) {
    let host = "an unparseable URL";
    try {
      host = new URL(tavilyBase).host;
    } catch {
      /* keep the generic wording */
    }
    warnings.push(
      `TAVILY_BASE_URL is set (${host}): web search goes there instead of the public Tavily API, and the UI labels it a custom search endpoint. ` +
        `It is meant for tests${process.env.E2E_STUB === "1" ? " (E2E_STUB=1: this is a stub stack)" : ""}; unset it in production.`
    );
  }
  if (config.search.provider === "wikipedia" || (config.search.provider === "tavily" && !config.search.tavilyApiKey)) {
    warnings.push(
      `Web research uses Wikipedia only (${config.search.provider === "wikipedia" ? "SEARCH_PROVIDER=wikipedia" : "TAVILY_API_KEY is not set"}): research steps get encyclopedia summaries, not current web pages, and are marked degraded. Set TAVILY_API_KEY on the API service for live web search.`
    );
  }
  if (config.stripe.apiBase) {
    warnings.push("STRIPE_API_BASE is set: Stripe API calls go to a local stub, not Stripe. It is for tests and the E2E stack; unset it in production.");
  }
  // Stripe calls and webhooks happen on the API only: the worker needs no Stripe settings.
  if (role === "api" && config.subscriptions.enabled) {
    if (!config.stripe.enabled) {
      warnings.push("SUBSCRIPTIONS_ENABLED=true but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing: plans are shown as not available.");
    } else {
      const missing = config.subscriptions.plans.filter((p) => !p.stripePriceId).map((p) => `STRIPE_PRICE_${p.id.toUpperCase()}`);
      if (missing.length) warnings.push(`Subscriptions are on but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set: ${missing.length === 1 ? "that plan is" : "those plans are"} shown as not available.`);
      if (/^(sk|rk)_live_/.test(config.stripe.secretKey)) {
        warnings.push("Subscriptions are on with a LIVE Stripe key: checkout charges real cards every month. Make sure this is intended.");
      }
    }
  }
  if (config.creditsPerEur !== 100) {
    warnings.push(
      `CREDITS_PER_EUR=${config.creditsPerEur}: existing balances were issued at 100 credits per €1, so internal accounting now values each of those credits at €${(1 / config.creditsPerEur).toFixed(4)} instead of €0.0100. Stored balances are unchanged.`
    );
  }
  if (config.adminEmails.length && !config.email.enabled) {
    warnings.push("ADMIN_EMAILS is set but email isn't configured: admins must verify their address, so the owner dashboard stays locked until RESEND_API_KEY and EMAIL_FROM are set (or the address is verified with `npm run ops:verify-email`).");
  }
  if (role === "api" && !process.env.CORS_ORIGIN) {
    warnings.push("CORS_ORIGIN is not set — only http://localhost:3000 may call this API, so your deployed frontend will be blocked.");
  }
  // The worker has no CORS_ORIGIN to fall back on, and it sends most execution emails.
  if (config.email.enabled && !process.env.APP_URL?.trim() && (role === "worker" || !process.env.CORS_ORIGIN)) {
    warnings.push(`APP_URL is not set — links in emails point to ${config.appUrl}. Set it to the frontend URL (the same value on the API and the worker).`);
  }
  return warnings;
}
