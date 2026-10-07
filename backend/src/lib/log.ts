// Structured logging. One JSON object per line in production (Render's log
// search can filter on fields such as executionId, orgId, stepId), compact
// "event key=value" lines in development, silent in tests unless LOG_LEVEL is set.
//
// Callers log identifiers, sizes, timings and error messages — never prompts,
// reports or document text. As a safety net, string fields are truncated.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_FIELD_CHARS = 300;

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase() as Level;
  if (raw in ORDER) return ORDER[raw];
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return ORDER.error + 1; // silent
  return ORDER.info;
}

function clean(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === "string") out[k] = v.length > MAX_FIELD_CHARS ? `${v.slice(0, MAX_FIELD_CHARS)}…` : v;
    else if (v instanceof Error) out[k] = v.message.slice(0, MAX_FIELD_CHARS);
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
