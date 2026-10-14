// What kind of problem a model-provider error is, from its message alone.
//
// Errors cross several boundaries as plain text (StepError messages, saved
// step errors, exception text), so the classification works on messages:
// the readable ones llmProvider.ts throws, and the raw shapes providers and
// SDKs produce (OpenAI, Groq, the Anthropic SDK's "401 {json}" messages).
//
//   config     — operator configuration: missing/invalid key, unknown model,
//                unknown or forbidden AI_PROVIDER. No retry can fix it.
//   quota      — the account's quota/credits are exhausted, or a long quota
//                window (per-day limits, a long Retry-After). Retrying soon is pointless.
//   rate_limit — short-term throttling; a later retry usually works.
//   too_large  — the request exceeds the model's size limits; the same prompt fails every time.
//   transient  — timeouts, connection problems, provider 5xx/overload.
//   unknown    — anything else.

export type ProviderErrorKind = "config" | "quota" | "rate_limit" | "too_large" | "transient" | "unknown";

const CONFIG_RE = new RegExp(
  [
    "isn't configured",
    "rejected the server's API key",
    "doesn't recognise the model",
    "AI_PROVIDER",
    "authentication_error",
    "permission_error",
    "invalid_api_key",
    "invalid x-api-key",
    "invalid api key",
    "incorrect api key",
    "api key not valid",
    "model_not_found",
    "not_found_error",
    "does not exist or you do not have access",
    "^\\s*40[134]\\b",
  ].join("|"),
  "i"
);

const TOO_LARGE_RE = new RegExp(
  [
    "too large for the AI model",
    "request too large",
    "request_too_large",
    "context_length_exceeded",
    "maximum context length",
    "prompt is too long",
    "reduce the length of the messages",
    "reduce your message size",
    "^\\s*413\\b",
  ].join("|"),
  "i"
);

const QUOTA_RE = new RegExp(
  [
    "quota",
    "insufficient_quota",
    "credit balance",
    "out of credits",
    "spend limit",
    "tokens per day",
    "requests per day",
    "\\((?:TPD|RPD)\\)",
  ].join("|"),
  "i"
);

const RATE_LIMIT_RE = /rate[ _-]?limit|too many requests|^\s*429\b/i;

const TRANSIENT_RE = new RegExp(
  [
    "took too long",
    "timed? ?out",
    "timeout",
    "having problems right now",
    "could not reach",
    "interrupted mid-response",
    "connection error",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "socket hang up",
    "fetch failed",
    "overloaded",
    "service unavailable",
    "bad gateway",
    "internal server error",
    "^\\s*5\\d\\d\\b",
  ].join("|"),
  "i"
);

/** Classifies a provider error message (or an Error). Precedence: config, too_large, quota, rate_limit, transient. */
export function classifyProviderError(message: unknown): ProviderErrorKind {
  const m = typeof message === "string" ? message : message instanceof Error ? message.message : String(message ?? "");
  if (!m.trim()) return "unknown";
  if (CONFIG_RE.test(m)) return "config";
  // Before rate limits: Groq reports an over-size request as a 413 "rate_limit_exceeded".
  if (TOO_LARGE_RE.test(m)) return "too_large";
  // Before rate limits: per-day limits and exhausted credits come back as 429s too.
  // ("billing" alone is not a marker: Groq appends an upgrade link to every rate-limit message.)
  if (QUOTA_RE.test(m)) return "quota";
  if (RATE_LIMIT_RE.test(m)) return "rate_limit";
  if (TRANSIENT_RE.test(m)) return "transient";
  return "unknown";
}

/**
 * Errors no retry can fix (operator configuration). A request too large for
 * the model counts: the same prompt is rejected every time.
 */
export function isConfigError(message: string): boolean {
  const kind = classifyProviderError(message);
  return kind === "config" || kind === "too_large";
}
