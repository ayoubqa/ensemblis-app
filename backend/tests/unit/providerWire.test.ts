// The OpenAI-compatible provider over the real wire, against a local stub
// (scripts/openai-stub.mjs) on 127.0.0.1: retries, fail-fast quota and auth
// errors, truncation, and honest token counts (estimated only when the
// provider sends no usage).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { classifyProviderError, isConfigError } from "../../src/ai/errors";
import { openaiRequestBody, runLLM } from "../../src/ai/llmProvider";
// @ts-expect-error — a plain ESM script without type declarations
import { startOpenAIStub } from "../../scripts/openai-stub.mjs";

interface StubStep {
  status?: number;
  retryAfter?: string | number;
  body?: unknown;
  text?: string;
  hangMs?: number;
  resetConnection?: boolean;
  closeMidStream?: boolean;
  finish?: string;
  noUsage?: boolean;
}
interface Stub {
  port: number;
  calls: () => number;
  requests: () => Record<string, unknown>[];
  push: (...steps: StubStep[]) => void;
  clear: () => void;
  close: () => Promise<void>;
}

const ENV_KEYS = ["AI_PROVIDER", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_FAST_MODEL", "OPENAI_REASONING_EFFORT", "LLM_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};
let stub: Stub;
let model = "";
let n = 0;

const REPLY = "A short answer from the stub, long enough to be a real reply.";

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  stub = (await startOpenAIStub(0, { script: [], reply: () => REPLY })) as Stub;
});
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await stub.close();
});

let callsBefore = 0;
beforeEach(() => {
  // A unique model name per test, so the usage rows of each test can be found.
  model = `stub-model-${++n}`;
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.OPENAI_API_KEY = "gsk_TESTKEY1234567890";
  process.env.OPENAI_MODEL = model;
  process.env.OPENAI_FAST_MODEL = model;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.LLM_TIMEOUT_MS;
  callsBefore = stub.calls();
});
afterEach(() => {
  // Leftover scripted steps must not leak into the next test.
  stub.clear();
});

const callsMade = () => stub.calls() - callsBefore;

async function usageRows(expected: number) {
  // recordUsage is fire-and-forget: wait for the rows to land.
  for (let i = 0; i < 50; i++) {
    const rows = await prisma.usageEvent.findMany({ where: { kind: "llm", model }, orderBy: { createdAt: "asc" } });
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  return prisma.usageEvent.findMany({ where: { kind: "llm", model }, orderBy: { createdAt: "asc" } });
}

async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to fail");
}

describe("runLLM over the OpenAI-compatible wire", () => {
  it("success with x_groq usage: real token counts (not estimated), recorded with the purpose", async () => {
    const r = await runLLM("You check whether cited sources support claims.", "user text", { purpose: "verify_claims" });
    expect(r.text).toBe(REPLY);
    expect(r.provider).toBe("openai");
    expect(r.model).toBe(model);
    expect(r.tokensEstimated).toBe(false);
    expect(r.truncated).toBe(false);
    expect(callsMade()).toBe(1);
    const [row] = await usageRows(1);
    expect(row).toMatchObject({ ok: true, provider: "openai", purpose: "verify_claims", estimated: false, error: null });
    // A non-OpenAI host gets max_tokens and a temperature.
    const body = stub.requests().at(-1)!;
    expect(body).toMatchObject({ model, stream: true, temperature: 0.5 });
    expect(typeof body.max_tokens).toBe("number");
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("no usage in the stream: token counts are marked as estimates", async () => {
    stub.push({ noUsage: true });
    const r = await runLLM("system", "user", { purpose: "step" });
    expect(r.tokensEstimated).toBe(true);
    expect(r.tokensIn).toBeGreaterThan(0);
    const [row] = await usageRows(1);
    expect(row).toMatchObject({ ok: true, estimated: true, purpose: "step" });
  });

  it("finish_reason=length marks the reply as truncated", async () => {
    stub.push({ finish: "length" });
    const r = await runLLM("system", "user");
    expect(r.truncated).toBe(true);
  });

  it("retries a 503 and succeeds", async () => {
    stub.push({ status: 503, retryAfter: 0 });
    const r = await runLLM("system", "user");
    expect(r.text).toBe(REPLY);
    expect(callsMade()).toBe(2);
  });

  it("retries an HTTP 500 and succeeds (G16)", async () => {
    stub.push({ status: 500 });
    const r = await runLLM("system", "user");
    expect(r.text).toBe(REPLY);
    expect(callsMade()).toBe(2);
  });

  it("retries a connection reset before any response (G16)", async () => {
    stub.push({ resetConnection: true });
    const r = await runLLM("system", "user");
    expect(r.text).toBe(REPLY);
    expect(callsMade()).toBe(2);
  });

  it("does not retry a stream cut after text was emitted (it would duplicate live output)", async () => {
    stub.push({ closeMidStream: true });
    const err = await failure(runLLM("system", "user"));
    expect(err.message).toMatch(/interrupted mid-response/);
    expect(classifyProviderError(err.message)).toBe("transient");
    expect(callsMade()).toBe(1);
  });

  it("a 429 with Retry-After 120 fails fast as an exhausted quota", async () => {
    stub.push({ status: 429, retryAfter: 120, body: { error: { message: "Rate limit reached" } } });
    const err = await failure(runLLM("system", "user", { purpose: "plan" }));
    expect(err.message).toMatch(/quota is exhausted.*~2 min/);
    expect(err.message).not.toMatch(/free/i);
    expect(classifyProviderError(err.message)).toBe("quota");
    expect(callsMade()).toBe(1);
    const [row] = await usageRows(1);
    expect(row).toMatchObject({ ok: false, estimated: true, purpose: "plan" });
    expect(row.error).toMatch(/quota is exhausted/);
  });

  it("insufficient_quota fails fast as quota even without Retry-After", async () => {
    stub.push({ status: 429, body: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } } });
    const err = await failure(runLLM("system", "user"));
    expect(classifyProviderError(err.message)).toBe("quota");
    expect(callsMade()).toBe(1);
  });

  it("a short 429 that outlasts the retries is a rate limit, not a quota", async () => {
    stub.push(...Array.from({ length: 4 }, () => ({ status: 429, retryAfter: 0 })));
    const err = await failure(runLLM("system", "user"));
    expect(err.message).toMatch(/rate limit reached/i);
    expect(classifyProviderError(err.message)).toBe("rate_limit");
    expect(callsMade()).toBe(4);
  });

  it("a 401 is a configuration error and is not retried", async () => {
    stub.push({ status: 401, body: { error: { message: "Invalid API Key", code: "invalid_api_key" } } });
    const err = await failure(runLLM("system", "user"));
    expect(err.message).toMatch(/rejected the server's API key/);
    expect(isConfigError(err.message)).toBe(true);
    expect(classifyProviderError(err.message)).toBe("config");
    expect(callsMade()).toBe(1);
  });

  it("never echoes a key from an error body, in the error or the usage row", async () => {
    stub.push({ status: 404, body: { error: { message: "model not found for key gsk_SECRETCANARY123456789" } } });
    const err = await failure(runLLM("system", "user"));
    expect(err.message).toMatch(/doesn't recognise the model/);
    expect(err.message).not.toMatch(/SECRETCANARY/);
    const [row] = await usageRows(1);
    expect(row.error).not.toMatch(/SECRETCANARY/);
    expect(row.error).toMatch(/gsk_\[redacted\]/);
  });

  it("a provider that can't be reached gives a reason without the base URL", async () => {
    // A port that was just free: nothing listens there.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${closedPort}/v1`;
    // A deadline shorter than the first backoff: fails on the first connection error.
    const err = await failure(runLLM("system", "user", { timeoutMs: 800 }));
    expect(err.message).toMatch(/Could not reach the AI provider \(ECONNREFUSED\)/);
    expect(err.message).not.toMatch(/127\.0\.0\.1/);
    expect(classifyProviderError(err.message)).toBe("transient");
  });

  it("a provider that hangs times out within the deadline", async () => {
    stub.push({ hangMs: 1500 });
    const err = await failure(runLLM("system", "user", { timeoutMs: 300 }));
    expect(err.message).toMatch(/took too long/);
  });
});

describe("OpenAI request body", () => {
  const base = { system: "s", user: "u", maxTokens: 4000, temperature: 0.2 };
  it("OpenAI-hosted reasoning models get max_completion_tokens and no temperature", () => {
    for (const m of ["gpt-5", "gpt-5-mini", "o3-mini", "o4-mini"]) {
      const body = openaiRequestBody({ ...base, baseUrl: "https://api.openai.com/v1", model: m });
      expect(body.max_completion_tokens).toBe(4000);
      expect(body).not.toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("temperature");
      expect(body.stream_options).toEqual({ include_usage: true });
    }
  });
  it("other models and hosts keep max_tokens and the temperature", () => {
    const openai = openaiRequestBody({ ...base, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    expect(openai).toMatchObject({ max_tokens: 4000, temperature: 0.2 });
    const groq = openaiRequestBody({ ...base, baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", reasoningEffort: "low" });
    expect(groq).toMatchObject({ max_tokens: 4000, temperature: 0.2, reasoning_effort: "low" });
    expect(groq).not.toHaveProperty("stream_options");
    expect(groq).not.toHaveProperty("max_completion_tokens");
  });
});
