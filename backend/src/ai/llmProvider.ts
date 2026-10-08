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

import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "../lib/usage";
import { log } from "../lib/log";
import { mockAIForbidden } from "../config";
import { mockLLM } from "./mockProvider";

export type Provider = "ollama" | "openai" | "anthropic" | "mock";
export type ModelTier = "main" | "fast";
/** What a call is for — used for metering, logs and (in tests) the mock provider. Never sent to the model. */
export type LLMPurpose = "plan" | "queries" | "step" | "verify" | "memory" | "suggest" | "other";

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
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
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
    throw new Error(`Ollama returned ${res.status}: ${body.slice(0, 300) || res.statusText}`);
  }
  if (!res.body) throw new Error("Ollama returned an empty response");

  let tokensIn = 0;
  let tokensOut = 0;
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
    if (obj.error) throw new Error(`Ollama error: ${String(obj.error).slice(0, 300)}`);
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
  return { text: sink.text, provider: "ollama", model, tokensIn, tokensOut, truncated };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (Groq by default)
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
// Groq retired llama-3.3-70b-versatile on 2026-08-16; gpt-oss-120b is its recommended replacement.
const DEFAULT_OPENAI_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GROQ_FAST_MODEL = "openai/gpt-oss-20b";
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 20_000;
const RETRYABLE = new Set([429, 502, 503, 504]);

/** Parses a Retry-After header (seconds or HTTP date) into ms, or null. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const hinted = parseRetryAfter(retryAfter);
  const base = hinted ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 500); // 1s, 2s, 4s (+ jitter)
  return Math.min(base, MAX_RETRY_WAIT_MS);
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
    throw new FatalLLMError(`The AI provider reported an error mid-response: ${m.slice(0, 300)}`);
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
  // "low" | "medium" | "high" — only sent when set, since non-reasoning models reject it.
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim() || "";
  // Only api.openai.com is known to accept stream_options; other compatible
  // providers may reject unknown fields (Groq reports usage in x_groq anyway).
  const includeUsage = hostOf(baseUrl) === "api.openai.com";
  const ms = timeoutMs("openai", opts.timeoutMs);
  const deadline = Date.now() + ms;

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(ms);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
        signal: AbortSignal.timeout(remaining),
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: opts.temperature ?? 0.5,
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }),
      });
    } catch (err) {
      if (isAbort(err)) throw timeoutError(ms);
      throw new Error(`Could not reach the AI provider at ${baseUrl}: ${errMsg(err)}`);
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
            console.warn(`[llm] stream interrupted before any output (${errMsg(err)}) — retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`);
            await sleep(wait);
            continue;
          }
        }
        throw new Error(`The connection to the AI provider was interrupted mid-response (${errMsg(err)}). Please try again.`);
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
      };
    }

    const body = (await res.text().catch(() => "")).slice(0, 300);

    // A 429 whose Retry-After is longer than we'd wait (a per-minute/day quota window) fails now
    // instead of burning the remaining retries on requests the provider will reject.
    const hintedWait = parseRetryAfter(res.headers.get("retry-after"));
    const longQuotaWait = res.status === 429 && hintedWait !== null && hintedWait > MAX_RETRY_WAIT_MS;
    if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES && !sink.emitted && !longQuotaWait) {
      const wait = backoffMs(attempt, res.headers.get("retry-after"));
      if (Date.now() + wait < deadline) {
        console.warn(`[llm] ${res.status} from AI provider — retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`);
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
    if (res.status === 429) {
      throw new Error("AI rate limit reached: the free AI quota is used up for now — try again later.");
    }
    if (res.status === 413) {
      throw new Error("This request is too large for the AI model's limits (provider request-size cap). Shorten the objective, context notes or documents, or use a model with a higher limit.");
    }
    if (res.status === 404) {
      throw new Error(`The AI provider doesn't recognise the model "${model}" (check OPENAI_MODEL / OPENAI_FAST_MODEL). ${body}`.trim());
    }
    if (res.status >= 500) {
      throw new Error(`The AI provider is having problems right now (HTTP ${res.status}). Please try again later.`);
    }
    throw new Error(`The AI provider returned HTTP ${res.status}: ${body || res.statusText}`);
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
    return {
      text,
      provider: "anthropic",
      model,
      tokensIn: message.usage?.input_tokens ?? approxTokens(systemPrompt + userContent),
      tokensOut: message.usage?.output_tokens ?? approxTokens(text),
      truncated: message.stop_reason === "max_tokens",
    };
  } catch (err) {
    if (timedOut || isAbort(err)) throw timeoutError(ms);
    throw err;
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
  return { text, provider, model: "mock", tokensIn: approxTokens(systemPrompt + userContent), tokensOut: approxTokens(text), truncated };
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
      log.info("llm.call", { ...meta, model: result.model, latencyMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut });
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
      }).catch(() => undefined);
      return { ...result, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      log.warn("llm.call_failed", { ...meta, model: modelFor(provider, tier), latencyMs, error: err instanceof Error ? err.message : String(err) });
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
      }).catch(() => undefined);
      throw err;
    }
  });
}

const MODEL_LABELS: Record<string, string> = {
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
};

/** Human-readable provider name for GET /api/config, e.g. "Groq (Llama 3.3 70B)". */
export function aiProviderLabel(): string {
  if (process.env.AI_PROVIDER_LABEL?.trim()) return process.env.AI_PROVIDER_LABEL.trim();
  let provider: Provider;
  try {
    provider = currentProvider();
  } catch {
    return "Unconfigured";
  }
  if (provider === "anthropic") return "Claude";
  if (provider === "ollama") return "Local model (Ollama)";
  if (provider === "mock") return "Mock AI (development/testing only)";
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const modelLabel = MODEL_LABELS[model] ?? model;
  const base = (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).toLowerCase();
  if (base.includes("groq.com")) return `Groq (${modelLabel})`;
  if (base.includes("api.openai.com")) return `OpenAI (${modelLabel})`;
  if (base.includes("openrouter.ai")) return `OpenRouter (${modelLabel})`;
  return modelLabel;
}
