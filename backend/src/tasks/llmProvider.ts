// A tiny abstraction so the orchestrator doesn't care which model actually
// writes the report. Three providers are wired up:
//
//   - "ollama"    (default locally, free): a local open-source model via Ollama.
//                 No account, no payment, nothing leaves your machine.
//   - "openai"    (hosted, has free tiers): any OpenAI-compatible Chat
//                 Completions API. Defaults target Groq's free plan
//                 (Llama 3.3 70B). Use this for a public deployment — a hosted
//                 server can't reach the Ollama on your laptop.
//   - "anthropic" (paid): the real Claude API.
//
// Switch between them with AI_PROVIDER in backend/.env — no code changes.
//
// Every call, whatever the provider, goes through one process-wide
// concurrency limiter (MAX_CONCURRENT_LLM) so a burst of tasks queues up
// instead of tripping a free tier's rate limits, and has a timeout
// (LLM_TIMEOUT_MS).

import Anthropic from "@anthropic-ai/sdk";

export interface LLMResult {
  text: string;
}

type Provider = "ollama" | "openai" | "anthropic";

function currentProvider(): Provider {
  const p = (process.env.AI_PROVIDER || "ollama").trim().toLowerCase();
  if (p === "ollama" || p === "openai" || p === "anthropic") return p;
  throw new Error(`Unknown AI_PROVIDER "${p}" — use "ollama", "openai" or "anthropic"`);
}

/** Per-call deadline. Local CPU models are slow, so Ollama gets a longer default. */
function timeoutMs(provider: Provider): number {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return provider === "ollama" ? 600_000 : 120_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && ["AbortError", "TimeoutError"].includes((err as { name?: string }).name ?? "");
}

const timeoutError = (ms: number) =>
  new Error(`The AI model took too long to respond (over ${Math.round(ms / 1000)}s). Please try again.`);

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

let limiter: Semaphore | null = null;
function getLimiter(): Semaphore {
  if (!limiter) {
    const n = Number(process.env.MAX_CONCURRENT_LLM);
    limiter = new Semaphore(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function runWithOllama(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
  // llama3.2 is small and fast enough to run on a laptop CPU. Swap in a
  // bigger pulled model (e.g. llama3.1, mistral) via OLLAMA_MODEL if your
  // machine can handle it and you want better output quality.
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  const ms = timeoutMs("ollama");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ms),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    if (isAbort(err)) throw timeoutError(ms);
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? Start it with \`ollama serve\` ` +
        `(or just open the Ollama app), and make sure you've run \`ollama pull ${model}\` at least once. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${body.slice(0, 300) || res.statusText}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content;
  if (!text) throw new Error("Ollama returned an empty response");
  return { text };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (Groq by default)
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_OPENAI_MODEL = "llama-3.3-70b-versatile";
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

async function runWithOpenAI(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "The AI provider isn't configured: OPENAI_API_KEY is missing on the server. " +
        "(Owner: add your Groq/OpenAI-compatible API key to the backend's environment variables.)"
    );
  }
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS) || 4096;
  const ms = timeoutMs("openai");
  const deadline = Date.now() + ms;

  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(ms);

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(remaining),
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.5,
        }),
      });
    } catch (err) {
      if (isAbort(err)) throw timeoutError(ms);
      throw new Error(`Could not reach the AI provider at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
      const text = data?.choices?.[0]?.message?.content;
      if (!text || !text.trim()) throw new Error("The AI model returned an empty response");
      return { text };
    }

    const body = (await res.text().catch(() => "")).slice(0, 300);

    if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
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
      throw new Error("This request is too large for the AI model's free-tier limits. Try a shorter brief or a lighter depth.");
    }
    if (res.status === 404) {
      throw new Error(`The AI provider doesn't recognise the model "${model}" (check OPENAI_MODEL). ${body}`.trim());
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

async function runWithAnthropic(systemPrompt: string, userContent: string): Promise<LLMResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("The AI provider isn't configured: ANTHROPIC_API_KEY is missing on the server.");
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs("anthropic"), maxRetries: 2 });
  // Defaults to Haiku — the cheapest current model. Bump via CLAUDE_MODEL
  // once quality matters more than cost.
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return { text };
}

// ---------------------------------------------------------------------------

export async function runLLM(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const provider = currentProvider();
  return getLimiter().run(() => {
    if (provider === "anthropic") return runWithAnthropic(systemPrompt, userContent);
    if (provider === "openai") return runWithOpenAI(systemPrompt, userContent);
    return runWithOllama(systemPrompt, userContent);
  });
}

const MODEL_LABELS: Record<string, string> = {
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
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
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const modelLabel = MODEL_LABELS[model] ?? model;
  const base = (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).toLowerCase();
  if (base.includes("groq.com")) return `Groq (${modelLabel})`;
  if (base.includes("api.openai.com")) return `OpenAI (${modelLabel})`;
  if (base.includes("openrouter.ai")) return `OpenRouter (${modelLabel})`;
  return modelLabel;
}
