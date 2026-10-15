// Structured logging. One JSON object per line in production (Render's log
// search can filter on fields such as executionId, orgId, stepId), compact
// "event key=value" lines in development, silent in tests unless LOG_LEVEL is set.
//
// Callers log identifiers, sizes, timings and error messages — never prompts,
// reports or document text. As a safety net, string fields are truncated and
// anything that looks like an API key or bearer token is redacted.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_FIELD_CHARS = 300;

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase() as Level;
  if (raw in ORDER) return ORDER[raw];
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return ORDER.error + 1; // silent
  return ORDER.info;
}

// Provider keys: Anthropic (sk-ant-…), OpenAI (sk-…, sk-proj-…), Groq (gsk_…), Tavily (tvly-…).
const KEY_RE = /\b(sk-ant-|sk-|gsk_|tvly-)[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
// Keys passed as query parameters (…?api_key=…&key=…).
const QUERY_KEY_RE = /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"'<>]+/gi;

/**
 * Masks anything that looks like a provider API key or a bearer token. Used on
 * every log field and on error text before it is stored or shown to users
 * (step errors, exceptions, usage events). Idempotent.
 */
export function redact(s: string): string {
  if (!s) return s;
  return s.replace(KEY_RE, "$1[redacted]").replace(BEARER_RE, "$1[redacted]").replace(QUERY_KEY_RE, "$1[redacted]");
}

function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      const r = redact(v);
      out[k] = r.length > MAX_FIELD_CHARS ? `${r.slice(0, MAX_FIELD_CHARS)}…` : r;
    } else if (v instanceof Error) out[k] = redact(v.message).slice(0, MAX_FIELD_CHARS);
    else out[k] = v;
  }
  return out;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < threshold()) return;
  const data = clean(fields);
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    stream.write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }) + "\n");
  } else {
    const kv = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    stream.write(`[${level}] ${event}${kv ? " " + kv : ""}\n`);
  }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
