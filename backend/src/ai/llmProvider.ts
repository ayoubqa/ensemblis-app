// A tiny abstraction so the orchestrator doesn't care which model actually
// writes the report. Three providers are wired up:
//
//   - "ollama"    (default locally, free): a local open-source model via Ollama.
//                 No account, no payment, nothing leaves your machine.
//   - "openai"    (hosted, has free tiers): any OpenAI-compatible Chat
//                 Completions API. Defaults target Groq's free plan
//                 (GPT-OSS 120B). Use this for a public deployment — a hosted
//                 server can't reach the Ollama on your laptop.
//   - "anthropic" (paid): the real Claude API.
//
// Switch between them with AI_PROVIDER in backend/.env — no code changes.
// A fourth value, "mock", is a deterministic scripted provider for local
// development and automated tests only; the server refuses to start with it in
// production (config.ts).
//
// v3: every call STREAMS. Pass `onDelta` to receive text as it is generated
// (the orchestrator shows it live in the UI). `model: "fast"` picks a smaller,
// cheaper model for small JSON jobs (search queries, clarifying questions).
// Every call is metered with recordUsage (owner dashboard).
//
// Every call, whatever the provider, goes through a process-wide concurrency
// limiter (MAX_CONCURRENT_LLM, one pool for the main model and one for the
// fast model) so a burst of tasks queues up instead of tripping a free tier's
// rate limits, and has a timeout (LLM_TIMEOUT_MS).
//
// Provider failures are thrown as readable messages that ai/errors.ts
// classifies (config / quota / rate_limit / too_large / transient). Error
// text never carries API keys (redacted) or the provider's base URL. Token
// counts the provider did not report are estimates, and say so
// (LLMResult.tokensEstimated, UsageEvent.estimated).

import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "../lib/usage";
import { log, redact } from "../lib/log";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OPENAI_BASE_URL, mockAIForbidden, modelEndpoint, type ModelEndpoint } from "../config";
import { mockLLM } from "./mockProvider";

export type Provider = "ollama" | "openai" | "anthropic" | "mock";
export type ModelTier = "main" | "fast";
/** What a call is for — used for metering, logs and (in tests) the mock provider. Never sent to the model. */
export type LLMPurpose = "plan" | "queries" | "step" | "verify" | "verify_claims" | "memory" | "suggest" | "other";

export interface LLMOptions {
  /** Called with each new piece of text as it streams in. Errors thrown by it are ignored. */
  onDelta?: (text: string) => void;
  /** "main" (default) = the configured model; "fast" = a smaller model for quick JSON jobs. */
  model?: ModelTier;
  /** Links the usage event to a legacy task (owner dashboard). */
  taskId?: string | null;
  /** Links the usage event to an objective execution. */
  executionId?: string | null;
  /** What the call is for (metering / logs / mock provider). */
  purpose?: LLMPurpose;
  /** Output token cap for this call (defaults: OPENAI_MAX_TOKENS / 4096 for Claude). */
  maxTokens?: number;
  /** Sampling temperature (default 0.5). */
  temperature?: number;
  /** Optional shorter deadline for this call, in ms (never longer than LLM_TIMEOUT_MS). */
  timeoutMs?: number;
}

export interface LLMResult {
  text: string;
  provider: Provider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** True when the provider stopped at the output-token limit: the text is cut off. */
  truncated?: boolean;
  /**
   * True when tokensIn/tokensOut are a ≈4 chars/token estimate rather than the
   * provider's own count: the provider sent no usage, or the reply came from
   * the mock/test handler.
   */
  tokensEstimated: boolean;
}

export function currentProvider(): Provider {
  const p = (process.env.AI_PROVIDER || "ollama").trim().toLowerCase();
  if (p === "ollama" || p === "openai" || p === "anthropic") return p;
  if (p === "mock") {
    if (mockAIForbidden()) throw new Error('AI_PROVIDER="mock" is for development and tests only');
    return p;
  }
  throw new Error(`Unknown AI_PROVIDER "${p}" — use "ollama", "openai" or "anthropic"`);
}

// ---------------------------------------------------------------------------
// Test hook: replaces every provider with a scripted handler (unit/integration tests).
// ---------------------------------------------------------------------------

/** Test/mock handler: returns the reply text, or { text, truncated } to simulate a reply cut off at the token limit. */
export type LLMHandler = (systemPrompt: string, userContent: string, opts: LLMOptions) => Promise<string | HandlerReply> | string | HandlerReply;
export type HandlerReply = { text: string; truncated?: boolean };
let testHandler: LLMHandler | null = null;

/** Tests only: route every runLLM call through `handler` (null restores the configured provider). */
export function setLLMHandlerForTests(handler: LLMHandler | null): void {
  testHandler = handler;
}

/** Per-call deadline. Local CPU models are slow, so Ollama gets a longer default. */
function timeoutMs(provider: Provider, override?: number): number {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  const base = Number.isFinite(n) && n > 0 ? n : provider === "ollama" ? 600_000 : 120_000;
  return override && override > 0 ? Math.min(base, override) : base;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && ["AbortError", "TimeoutError"].includes((err as { name?: string }).name ?? "");
}

const timeoutError = (ms: number) =>
  new Error(`The AI model took too long to respond (over ${Math.round(ms / 1000)}s). Please try again.`);

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Rough token estimate (≈4 chars/token) used only when a provider reports no usage. */
const approxTokens = (s: string) => Math.ceil(s.length / 4);

// ---------------------------------------------------------------------------
// Concurrency limiter (shared by all providers)
// ---------------------------------------------------------------------------

export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      // Hand the slot straight to the next waiter (active stays the same).
      if (next) next();
      else this.active--;
    }
  }

  get inFlight() {
    return this.active;
  }
  get queued() {
    return this.waiters.length;
  }
}

// Separate pools so a quick "fast" call (e.g. clarifying questions while a
// visitor waits) never queues behind minutes-long report steps. On Groq the
// two models also have separate rate limits.
const limiters: Partial<Record<ModelTier, Semaphore>> = {};
function getLimiter(tier: ModelTier): Semaphore {
  let l = limiters[tier];
  if (!l) {
    const n = Number(process.env.MAX_CONCURRENT_LLM);
    l = new Semaphore(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2);
    limiters[tier] = l;
  }
  return l;
}

/** Calls currently waiting for a free slot of this tier (lets optional work back off under load). */
export function llmQueueLength(tier: ModelTier): number {
  return getLimiter(tier).queued;
}

// ---------------------------------------------------------------------------
// Stream parsers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Incremental Server-Sent Events parser. Feed it decoded text in arbitrary
 * chunks; it calls `onData` once per complete event with the event's `data`
 * (multiple data lines joined by "\n"). Comments (": …") and other fields are
 * ignored.
 */
export class SSEParser {
  private buf = "";
  private data: string[] = [];
  constructor(private readonly onData: (data: string) => void) {}

  push(text: string): void {
    this.buf += text;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.line(line);
    }
  }

  /** Flushes a trailing line / pending event when the stream ends. */
  end(): void {
    if (this.buf) {
      const line = this.buf.endsWith("\r") ? this.buf.slice(0, -1) : this.buf;
      this.buf = "";
      this.line(line);
    }
    this.dispatch();
  }

  private line(line: string): void {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return; // event:, id:, retry: are not needed here
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.data.push(value);
  }

  private dispatch(): void {
    if (!this.data.length) return;
    const payload = this.data.join("\n");
    this.data = [];
    this.onData(payload);
  }
}

/** Incremental newline-delimited JSON parser (Ollama). Calls `onLine` per non-empty line. */
export class NDJSONParser {
  private buf = "";
  constructor(private readonly onLine: (line: string) => void) {}

  push(text: string): void {
    this.buf += text;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.onLine(line);
    }
  }

  end(): void {
    const line = this.buf.trim();
    this.buf = "";
    if (line) this.onLine(line);
  }
}

/** Reads a fetch body as text chunks, decoding UTF-8 safely across chunk boundaries. */
async function readTextStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        const text = decoder.decode(value, { stream: true });
        if (text) onText(text);
      }
    }
    const rest = decoder.decode();
    if (rest) onText(rest);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** Accumulates streamed text and forwards each delta to the caller. */
class TextSink {
  text = "";
  emitted = false;
  constructor(private readonly onDelta?: (text: string) => void) {}
  add(delta: string) {
    if (!delta) return;
    this.text += delta;
    this.emitted = true;
    if (this.onDelta) {
      try {
        this.onDelta(delta);
      } catch {
        /* a broken listener must not break the model call */
      }
    }
  }
}

/** An error that stops the retry loop immediately. */
class FatalLLMError extends Error {}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

function ollamaModel(tier: ModelTier): string {
  // llama3.2 is small and fast enough to run on a laptop CPU. Swap in a
  // bigger pulled model (e.g. llama3.1, mistral) via OLLAMA_MODEL if your
  // machine can handle it and you want better output quality.
  const main = process.env.OLLAMA_MODEL?.trim() || "llama3.2";
  return tier === "fast" ? process.env.OLLAMA_FAST_MODEL?.trim() || main : main;
}

async function runWithOllama(systemPrompt: string, userContent: string, opts: LLMOptions, sink: TextSink): Promise<LLMResult> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const model = ollamaModel(opts.model ?? "main");
  const ms = timeoutMs("ollama", opts.timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ms),
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        options: {
          // Ollama's default context window (2–4k tokens) silently truncates our prompts from the start,
          // dropping the system rules and the objective. llama3.2 supports far more.
          num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 16384,
          ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        },
      }),
    });
  } catch (err) {
    if (isAbort(err)) throw timeoutError(ms);
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? Start it with \`ollama serve\` ` +
        `(or just open the Ollama app), and make sure you've run \`ollama pull ${model}\` at least once. ` +
        `Original error: ${errMsg(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${redact(body.slice(0, 300)) || res.statusText}`);
  }
  if (!res.body) throw new Error("Ollama returned an empty response");

  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let truncated = false;
  const parser = new NDJSONParser((line) => {
    let obj: {
      message?: { content?: unknown };
      error?: unknown;
      done?: boolean;
      done_reason?: unknown;
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    try {
      obj = JSON.parse(line);
    } catch {
      return; // ignore a malformed line
    }
    if (obj.error) throw new Error(`Ollama error: ${redact(String(obj.error)).slice(0, 300)}`);
    if (typeof obj.message?.content === "string") sink.add(obj.message.content);
    if (typeof obj.prompt_eval_count === "number") tokensIn = obj.prompt_eval_count;
    if (typeof obj.eval_count === "number") tokensOut = obj.eval_count;
    if (obj.done_reason === "length") truncated = true;
  });

  try {
    await readTextStream(res.body, (t) => parser.push(t));
    parser.end();
  } catch (err) {
    if (isAbort(err)) throw timeoutError(ms);
    throw err;
  }

  if (!sink.text.trim()) throw new Error("Ollama returned an empty response");
  return {
    text: sink.text,
    provider: "ollama",
    model,
    tokensIn: tokensIn ?? approxTokens(systemPrompt + userContent),
    tokensOut: tokensOut ?? approxTokens(sink.text),
    truncated,
    tokensEstimated: tokensIn === null || tokensOut === null,
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (Groq by default)
// ---------------------------------------------------------------------------

// Groq retired llama-3.3-70b-versatile on 2026-08-16; gpt-oss-120b is its recommended replacement.
const DEFAULT_OPENAI_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GROQ_FAST_MODEL = "openai/gpt-oss-20b";
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 20_000;
// 500 is included: a single internal error at the provider is usually a blip,
// and failing here sends the planner to its fallback plan and the verifier to "unavailable".
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Parses a Retry-After header (seconds or HTTP date) into ms, or null. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/** "Please try again in 7m12.5s" (Groq / OpenAI rate-limit bodies) → ms, or null. */
export function waitFromErrorBody(body: string): number | null {
  const m = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(body);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const ms = (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000;
  return Number.isFinite(ms) ? Math.round(ms) : null;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const hinted = parseRetryAfter(retryAfter);
  const base = hinted ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 500); // 1s, 2s, 4s (+ jitter)
  return Math.min(base, MAX_RETRY_WAIT_MS);
}

function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes >= 120 ? `~${Math.round(minutes / 60)} h` : `~${minutes} min`;
}

/** The readable message for an exhausted quota (classified "quota" by ai/errors.ts). */
export function quotaExhaustedMessage(waitMs: number | null, envHint = "the AI provider account"): string {
  const when = waitMs !== null && waitMs > 0 ? ` — retry after ${formatWait(waitMs)}` : "";
  return `The AI provider's quota is exhausted for now${when}. (Owner: check the usage limits and credits of ${envHint}.)`;
}

/** The readable message for short-term throttling that outlasted the retries (classified "rate_limit"). */
const RATE_LIMITED_MESSAGE = "AI rate limit reached: the AI provider is throttling requests right now. Please try again in a minute.";

const TOO_LARGE_MESSAGE =
  "This request is too large for the AI model's limits (provider request-size cap). Shorten the objective, context notes or documents, or use a model with a higher limit.";

/** A 429 body that means "quota", not "slow down": exhausted credits or a per-day window. */
const QUOTA_BODY_RE = /insufficient_quota|exceeded your current quota|credit balance|tokens per day|requests per day|\((?:TPD|RPD)\)/i;

/** The provider's own error message from a JSON error body (or the raw text), redacted and short. */
function providerDetail(body: string, max = 200): string {
  let detail = body;
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? j.detail;
    if (typeof m === "string" && m.trim()) detail = m;
  } catch {
    /* not JSON */
  }
  detail = redact(detail.replace(/\s+/g, " ").trim());
  return detail.length > max ? `${detail.slice(0, max - 1)}…` : detail;
}

/** A short, URL-free reason for a failed fetch (e.g. ECONNREFUSED, UND_ERR_SOCKET). */
function networkReason(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = typeof e?.cause?.code === "string" ? e.cause.code : typeof e?.code === "string" ? e.code : "";
  return code || "network error";
}

function openaiBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const isGroq = (baseUrl: string) => {
  const h = hostOf(baseUrl);
  return h === "groq.com" || h.endsWith(".groq.com");
};

/** The model name used for a tier (exported for GET /api/config labels and tests). */
export function openaiModel(tier: ModelTier): string {
  const main = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  if (tier === "main") return main;
  const fast = process.env.OPENAI_FAST_MODEL?.trim();
  if (fast) return fast;
  return isGroq(openaiBaseUrl()) ? DEFAULT_GROQ_FAST_MODEL : main;
}

/** OpenAI-hosted reasoning models (o-series, gpt-5) reject `max_tokens` and any non-default temperature. */
export function isOpenAIReasoningModel(baseUrl: string, model: string): boolean {
  return hostOf(baseUrl) === "api.openai.com" && /^(o\d|gpt-5)/i.test(model);
}

/** The Chat Completions request body (exported for unit tests). */
export function openaiRequestBody(a: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: string;
}): Record<string, unknown> {
  const reasoningModel = isOpenAIReasoningModel(a.baseUrl, a.model);
  // Only api.openai.com is known to accept stream_options; other compatible
  // providers may reject unknown fields (Groq reports usage in x_groq anyway).
  const includeUsage = hostOf(a.baseUrl) === "api.openai.com";
  return {
    model: a.model,
    messages: [
      { role: "system", content: a.system },
      { role: "user", content: a.user },
    ],
    ...(reasoningModel ? { max_completion_tokens: a.maxTokens } : { max_tokens: a.maxTokens, temperature: a.temperature ?? 0.5 }),
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    // "low" | "medium" | "high" — only sent when set, since non-reasoning models reject it.
    ...(a.reasoningEffort ? { reasoning_effort: a.reasoningEffort } : {}),
  };
}

interface OpenAIChunk {
  error?: { message?: unknown } | string;
  choices?: { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
  x_groq?: { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null };
}

/**
 * Applies one parsed OpenAI-compatible stream chunk. Returns usage if the
 * chunk carried it. Throws on an in-stream error object.
 */
function applyOpenAIChunk(
  obj: OpenAIChunk,
  sink: TextSink,
  state: { usage: { in: number; out: number } | null; finish: string | null }
): void {
  if (obj.error) {
    const m = typeof obj.error === "string" ? obj.error : String(obj.error.message ?? "unknown error");
    throw new FatalLLMError(`The AI provider reported an error mid-response: ${redact(m).slice(0, 300)}`);
  }
  const choice = obj.choices?.[0];
  // Only `content` is the answer. Reasoning models also stream `reasoning` /
  // `reasoning_content` — deliberately ignored.
  const piece = choice?.delta?.content ?? choice?.message?.content;
  if (typeof piece === "string") sink.add(piece);
  if (typeof choice?.finish_reason === "string") state.finish = choice.finish_reason;
  const u = obj.usage ?? obj.x_groq?.usage;
  if (u && (typeof u.prompt_tokens === "number" || typeof u.completion_tokens === "number")) {
    state.usage = {
      in: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
      out: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    };
  }
}

async function runWithOpenAI(systemPrompt: string, userContent: string, opts: LLMOptions, sink: TextSink): Promise<LLMResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "The AI provider isn't configured: OPENAI_API_KEY is missing on the server. " +
        "(Owner: add your Groq/OpenAI-compatible API key to the backend's environment variables.)"
    );
  }
  const baseUrl = openaiBaseUrl();
  const model = openaiModel(opts.model ?? "main");
  // Reasoning models (gpt-oss, o-series) spend part of this budget "thinking" before answering.
  const maxTokens = opts.maxTokens || Number(process.env.OPENAI_MAX_TOKENS) || 8192;
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim() || "";
  const requestBody = JSON.stringify(
    openaiRequestBody({ baseUrl, model, system: systemPrompt, user: userContent, maxTokens, temperature: opts.temperature, reasoningEffort })
  );
  const ms = timeoutMs("openai", opts.timeoutMs);
  const deadline = Date.now() + ms;
  const retryLog = (attempt: number, reason: string, wait: number, error?: string) =>
    log.warn("llm.retry", { provider: "openai", model, purpose: opts.purpose, executionId: opts.executionId ?? undefined, reason, error, retry: attempt + 1, of: MAX_RETRIES, waitMs: wait });

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(ms);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
        signal: AbortSignal.timeout(remaining),
        body: requestBody,
      });
    } catch (err) {
      if (isAbort(err)) throw timeoutError(ms);
      // No response yet (connection refused/reset, DNS blip): nothing has been
      // emitted, so a retry within the same deadline can't duplicate output.
      if (attempt < MAX_RETRIES) {
        const wait = backoffMs(attempt, null);
        if (Date.now() + wait < deadline) {
          retryLog(attempt, "network", wait, networkReason(err));
          await sleep(wait);
          continue;
        }
      }
      // Never echo OPENAI_BASE_URL in text users can see.
      throw new Error(`Could not reach the AI provider (${networkReason(err)}). Please try again.`);
    }

    if (res.ok) {
      const state: { usage: { in: number; out: number } | null; finish: string | null } = { usage: null, finish: null };
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      try {
        if (contentType.includes("application/json")) {
          // Provider ignored stream:true and sent a normal completion.
          const data = (await res.json().catch(() => null)) as OpenAIChunk | null;
          if (data) applyOpenAIChunk(data, sink, state);
        } else if (res.body) {
          let finished = false;
          const parser = new SSEParser((payload) => {
            if (finished) return;
            if (payload.trim() === "[DONE]") {
              finished = true;
              return;
            }
            let obj: OpenAIChunk | null = null;
            try {
              obj = JSON.parse(payload);
            } catch {
              // Non-compliant servers sometimes put several JSON objects on
              // consecutive data lines without a blank line between them.
              for (const part of payload.split("\n")) {
                if (part.trim() === "[DONE]") {
                  finished = true;
                  return;
                }
                try {
                  applyOpenAIChunk(JSON.parse(part), sink, state);
                } catch (e) {
                  if (e instanceof FatalLLMError) throw e;
                }
              }
              return;
            }
            if (obj && typeof obj === "object") applyOpenAIChunk(obj, sink, state);
          });
          await readTextStream(res.body, (t) => parser.push(t));
          parser.end();
        }
      } catch (err) {
        if (err instanceof FatalLLMError) throw err;
        if (isAbort(err)) throw timeoutError(ms);
        // The stream broke. Retry only if nothing reached the caller yet —
        // otherwise the live output would show the text twice.
        if (!sink.emitted && attempt < MAX_RETRIES) {
          const wait = backoffMs(attempt, null);
          if (Date.now() + wait < deadline) {
            retryLog(attempt, "stream_interrupted", wait, errMsg(err));
            await sleep(wait);
            continue;
          }
        }
        throw new Error(`The connection to the AI provider was interrupted mid-response (${redact(errMsg(err)).slice(0, 120)}). Please try again.`);
      }

      if (!sink.text.trim()) {
        throw new Error(
          "The AI model returned an empty response" +
            (state.finish === "length" || !reasoningEffort
              ? " (for reasoning models like gpt-oss, set OPENAI_REASONING_EFFORT=low or raise OPENAI_MAX_TOKENS)"
              : "")
        );
      }
      return {
        text: sink.text,
        provider: "openai",
        model,
        tokensIn: state.usage?.in ?? approxTokens(systemPrompt + userContent),
        tokensOut: state.usage?.out ?? approxTokens(sink.text),
        truncated: state.finish === "length",
        tokensEstimated: state.usage === null,
      };
    }

    const body = (await res.text().catch(() => "")).slice(0, 2000);
    const retryAfter = res.headers.get("retry-after");
    const hintedWait = parseRetryAfter(retryAfter);

    // A 429 that means "quota" — exhausted credits, a per-day window, or a Retry-After longer than
    // we'd wait — fails now instead of burning the remaining retries on requests the provider will reject.
    if (res.status === 429 && ((hintedWait !== null && hintedWait > MAX_RETRY_WAIT_MS) || QUOTA_BODY_RE.test(body))) {
      throw new Error(quotaExhaustedMessage(hintedWait ?? waitFromErrorBody(body), "the account behind OPENAI_API_KEY"));
    }
    if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES && !sink.emitted) {
      const wait = backoffMs(attempt, retryAfter);
      if (Date.now() + wait < deadline) {
        retryLog(attempt, `http_${res.status}`, wait);
        await sleep(wait);
        continue;
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "The AI provider rejected the server's API key (invalid or revoked). " +
          "(Owner: check OPENAI_API_KEY in the backend's environment variables.)"
      );
    }
    if (res.status === 429) throw new Error(RATE_LIMITED_MESSAGE);
    if (res.status === 413) throw new Error(TOO_LARGE_MESSAGE);
    if (res.status === 404) {
      const detail = providerDetail(body);
      throw new Error(`The AI provider doesn't recognise the model "${model}" (check OPENAI_MODEL / OPENAI_FAST_MODEL).${detail ? ` ${detail}` : ""}`);
    }
    if (res.status >= 500) {
      throw new Error(`The AI provider is having problems right now (HTTP ${res.status}). Please try again later.`);
    }
    throw new Error(`The AI provider returned HTTP ${res.status}: ${providerDetail(body) || res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function claudeModel(tier: ModelTier): string {
  // Defaults to Haiku — the cheapest current model. Bump via CLAUDE_MODEL
  // once quality matters more than cost.
  const main = process.env.CLAUDE_MODEL?.trim() || "claude-haiku-4-5-20251001";
  return tier === "fast" ? process.env.CLAUDE_FAST_MODEL?.trim() || main : main;
}

/**
 * Turns an Anthropic SDK error into the same readable, classifiable messages
 * the OpenAI-compatible path throws (exported for unit tests). SDK messages
 * look like `401 {"type":"error","error":{"type":"authentication_error",…}}`.
 */
export function mapAnthropicError(err: unknown, model: string, ms = timeoutMs("anthropic")): Error {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return timeoutError(ms);
  if (err instanceof Anthropic.APIConnectionError) return new Error("Could not reach the AI provider (connection error). Please try again.");
  const status = (err as { status?: unknown } | null)?.status;
  if (!(err instanceof Anthropic.APIError) && typeof status !== "number") return err instanceof Error ? err : new Error(String(err));
  const apiErr = err as { status?: number; message?: string; error?: unknown; headers?: Record<string, string> | null };
  const inner = (apiErr.error as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
  const detailRaw = typeof inner?.message === "string" ? inner.message : apiErr.message ?? "";
  const type = typeof inner?.type === "string" ? inner.type : "";
  const detail = redact(detailRaw.replace(/\s+/g, " ").trim()).slice(0, 200);
  const code = typeof status === "number" ? status : 0;
  if (code === 401 || code === 403 || type === "authentication_error" || type === "permission_error") {
    return new Error(
      "The AI provider rejected the server's API key (invalid or revoked, or not allowed to use this model). " +
        "(Owner: check ANTHROPIC_API_KEY in the backend's environment variables.)"
    );
  }
  if (code === 404 || type === "not_found_error") {
    return new Error(`The AI provider doesn't recognise the model "${model}" (check CLAUDE_MODEL / CLAUDE_FAST_MODEL).`);
  }
  if (code === 413 || type === "request_too_large" || /prompt is too long|too large/i.test(detailRaw)) return new Error(TOO_LARGE_MESSAGE);
  if (/credit balance|quota|spend limit|billing/i.test(detailRaw) && (code === 400 || code === 402 || code === 429)) {
    return new Error(quotaExhaustedMessage(null, "the account behind ANTHROPIC_API_KEY"));
  }
  if (code === 429 || type === "rate_limit_error") {
    const wait = parseRetryAfter(apiErr.headers?.["retry-after"] ?? null);
    if (wait !== null && wait > MAX_RETRY_WAIT_MS) return new Error(quotaExhaustedMessage(wait, "the account behind ANTHROPIC_API_KEY"));
    return new Error(RATE_LIMITED_MESSAGE);
  }
  if (code === 529 || code >= 500 || type === "overloaded_error" || type === "api_error") {
    return new Error(`The AI provider is having problems right now (HTTP ${code || "error"}). Please try again later.`);
  }
  return new Error(`The AI provider returned HTTP ${code || "error"}: ${detail || "unknown error"}`);
}

async function runWithAnthropic(systemPrompt: string, userContent: string, opts: LLMOptions, sink: TextSink): Promise<LLMResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("The AI provider isn't configured: ANTHROPIC_API_KEY is missing on the server.");
  }
  const ms = timeoutMs("anthropic", opts.timeoutMs);
  // The SDK retries 429/5xx itself, before any text has streamed.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: ms, maxRetries: 2 });
  const model = claudeModel(opts.model ?? "main");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    const stream = anthropic.messages.stream(
      {
        model,
        max_tokens: opts.maxTokens || 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      },
      { signal: controller.signal }
    );
    stream.on("text", (delta) => sink.add(delta));
    const message = await stream.finalMessage();
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");
    if (!text.trim()) throw new Error("The AI model returned an empty response");
    const usage = message.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
    const reported = typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number";
    return {
      text,
      provider: "anthropic",
      model,
      tokensIn: reported ? (usage!.input_tokens as number) : approxTokens(systemPrompt + userContent),
      tokensOut: reported ? (usage!.output_tokens as number) : approxTokens(text),
      truncated: message.stop_reason === "max_tokens",
      tokensEstimated: !reported,
    };
  } catch (err) {
    if (timedOut || isAbort(err) || err instanceof Anthropic.APIUserAbortError) throw timeoutError(ms);
    throw mapAnthropicError(err, model, ms);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

function modelFor(provider: Provider, tier: ModelTier): string {
  if (provider === "openai") return openaiModel(tier);
  if (provider === "anthropic") return claudeModel(tier);
  if (provider === "mock") return "mock";
  return ollamaModel(tier);
}

const MOCK_AI_DELAY_MS = Math.max(0, Math.min(60_000, Number(process.env.MOCK_AI_DELAY_MS) || 0));

async function runWithHandler(
  handler: LLMHandler,
  provider: Provider,
  systemPrompt: string,
  userContent: string,
  opts: LLMOptions,
  sink: TextSink
): Promise<LLMResult> {
  const reply = await handler(systemPrompt, userContent, opts);
  const text = typeof reply === "string" ? reply : reply.text;
  const truncated = typeof reply === "string" ? false : !!reply.truncated;
  if (!text || !text.trim()) throw new Error("The AI model returned an empty response");
  // Stream it in a few chunks so live-output code paths are exercised too.
  // MOCK_AI_DELAY_MS (mock provider only) spreads a step's output over that
  // long, so live progress and refresh-mid-run can be seen in dev and E2E.
  const delay = handler === mockLLM && opts.purpose === "step" ? MOCK_AI_DELAY_MS : 0;
  const size = Math.max(200, Math.ceil(text.length / 4));
  for (let i = 0; i < text.length; i += size) {
    sink.add(text.slice(i, i + size));
    if (delay) await new Promise((r) => setTimeout(r, delay / 4));
  }
  // The mock and test handlers report no usage: their token counts are always estimates.
  return { text, provider, model: "mock", tokensIn: approxTokens(systemPrompt + userContent), tokensOut: approxTokens(text), truncated, tokensEstimated: true };
}

/**
 * Runs one model call. Backwards compatible: `runLLM(system, user)` still
 * works. Streams internally; `opts.onDelta` receives the text as it arrives.
 */
export async function runLLM(systemPrompt: string, userContent: string, opts: LLMOptions = {}): Promise<LLMResult & { latencyMs: number }> {
  const provider = testHandler ? "mock" : currentProvider();
  const tier: ModelTier = opts.model === "fast" ? "fast" : "main";
  const sink = new TextSink(opts.onDelta);
  return getLimiter(tier).run(async () => {
    const started = Date.now();
    const meta = { provider, tier, purpose: opts.purpose ?? "other", executionId: opts.executionId ?? undefined };
    try {
      const result = testHandler
        ? await runWithHandler(testHandler, provider, systemPrompt, userContent, opts, sink)
        : provider === "mock"
          ? await runWithHandler(mockLLM, provider, systemPrompt, userContent, opts, sink)
          : provider === "anthropic"
            ? await runWithAnthropic(systemPrompt, userContent, opts, sink)
            : provider === "openai"
              ? await runWithOpenAI(systemPrompt, userContent, opts, sink)
              : await runWithOllama(systemPrompt, userContent, opts, sink);
      const latencyMs = Date.now() - started;
      log.info("llm.call", { ...meta, model: result.model, latencyMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut, tokensEstimated: result.tokensEstimated });
      void recordUsage({
        kind: "llm",
        provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        ok: true,
        taskId: opts.taskId ?? null,
        executionId: opts.executionId ?? null,
        latencyMs,
        purpose: meta.purpose,
        estimated: result.tokensEstimated,
      }).catch(() => undefined);
      return { ...result, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      log.warn("llm.call_failed", { ...meta, model: modelFor(provider, tier), latencyMs, error: message });
      // A failed call's token counts are always estimates (the provider never reported usage).
      void recordUsage({
        kind: "llm",
        provider,
        model: modelFor(provider, tier),
        tokensIn: approxTokens(systemPrompt + userContent),
        tokensOut: approxTokens(sink.text),
        ok: false,
        taskId: opts.taskId ?? null,
        executionId: opts.executionId ?? null,
        latencyMs,
        purpose: meta.purpose,
        estimated: true,
        error: message,
      }).catch(() => undefined);
      throw err;
    }
  });
}

/**
 * Why model calls cannot work with the current configuration, or null when
 * they can be attempted: an unknown AI_PROVIDER, the mock where it is
 * forbidden, or a missing API key. (Whether a present key is valid is only
 * known after a call.) The messages are the ones runLLM would throw, so
 * ai/errors.ts classifies them as "config". No secrets are included.
 */
export function aiConfigProblem(): string | null {
  let provider: Provider;
  try {
    provider = currentProvider();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    return "The AI provider isn't configured: OPENAI_API_KEY is missing on the server.";
  }
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY?.trim()) {
    return "The AI provider isn't configured: ANTHROPIC_API_KEY is missing on the server.";
  }
  return null;
}

/** The provider and model a call of this tier would use right now (as runLLM records them). */
export function describeModel(tier: ModelTier = "main"): { provider: string; model: string } {
  if (testHandler) return { provider: "mock", model: "mock" };
  try {
    const provider = currentProvider();
    return { provider, model: modelFor(provider, tier) };
  } catch {
    return { provider: "unconfigured", model: "none" };
  }
}

const MODEL_LABELS: Record<string, string> = {
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
};

function modelLabel(provider: Provider): string {
  if (process.env.AI_PROVIDER_LABEL?.trim()) return process.env.AI_PROVIDER_LABEL.trim();
  if (provider === "anthropic") return "Claude";
  if (provider === "ollama") return "Ollama";
  if (provider === "mock") return "Mock AI (development/testing only)";
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const label = MODEL_LABELS[model] ?? model;
  const base = (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).toLowerCase();
  if (base.includes("groq.com")) return `Groq (${label})`;
  if (base.includes("api.openai.com")) return `OpenAI (${label})`;
  if (base.includes("openrouter.ai")) return `OpenRouter (${label})`;
  return label;
}

/**
 * Human-readable provider name for GET /api/config, e.g. "Groq (GPT-OSS 120B)". A test stub or a
 * local endpoint says so (config.ts modelEndpoint), even with AI_PROVIDER_LABEL set.
 */
export function aiProviderLabel(): string {
  let provider: Provider;
  try {
    provider = currentProvider();
  } catch {
    return "Unconfigured";
  }
  const label = modelLabel(provider);
  const endpoint = provider === "mock" ? null : modelEndpoint();
  if (endpoint?.kind === "stub") return `Test stub endpoint (E2E_STUB=1) — ${label}, not a real model`;
  if (endpoint?.kind === "local") return `Local model endpoint (${endpoint.host}) — ${label}`;
  return label;
}

/**
 * Where this server's model calls go right now (config.ts modelEndpoint), or null when they are
 * the mock's (AI_PROVIDER=mock or a test handler). Stamped on each plan (Plan.runtime).
 */
export function currentModelEndpoint(): ModelEndpoint | null {
  return describeModel("main").provider === "mock" ? null : modelEndpoint()?.kind ?? null;
}
