// The optional premium model route (e.g. GPT-5.5) over the real wire, against
// two local OpenAI-compatible stubs: one standing in for the premium endpoint,
// one for the standard (fallback) endpoint. No network, no paid calls.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { openaiRequestBody, runLLM } from "../../src/ai/llmProvider";
import { premiumConfigWarnings, premiumRouteFor, premiumStatus, resetPremiumStateForTests } from "../../src/ai/premium";
// @ts-expect-error — a plain ESM script without type declarations
import { startOpenAIStub } from "../../scripts/openai-stub.mjs";

interface Stub {
  port: number;
  calls: () => number;
  requests: () => Record<string, unknown>[];
  push: (...steps: Record<string, unknown>[]) => void;
  clear: () => void;
  close: () => Promise<void>;
}

const ENV_KEYS = [
  "AI_PROVIDER",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_FAST_MODEL",
  "OPENAI_REASONING_EFFORT",
  "PREMIUM_MODEL",
  "PREMIUM_API_KEY",
  "PREMIUM_BASE_URL",
  "PREMIUM_REASONING_EFFORT",
  "PREMIUM_PURPOSES",
  "PREMIUM_DAILY_BUDGET_EUR",
  "PROVIDER_PRICING",
  "LLM_TIMEOUT_MS",
] as const;
const saved: Record<string, string | undefined> = {};
let premium: Stub;
let standard: Stub;
let n = 0;
let premiumModel = "";
let standardModel = "";

const PRICES = (model: string) =>
  JSON.stringify({ models: { [model]: { inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30, currency: "USD" }, std: { inputPerMTok: 0.15, outputPerMTok: 0.6, currency: "USD" } }, fx: { USD: 0.9 } });

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  premium = (await startOpenAIStub(0, { script: [], reply: () => "Premium answer, long enough to be a real reply." })) as Stub;
  standard = (await startOpenAIStub(0, { script: [], reply: () => "Standard answer, long enough to be a real reply." })) as Stub;
});
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await premium.close();
  await standard.close();
});

let premiumBefore = 0;
let standardBefore = 0;
beforeEach(() => {
  resetPremiumStateForTests();
  // Unique model names per test, so each test's usage rows can be found.
  premiumModel = `premium-${++n}`;
  standardModel = `std-${n}`;
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${standard.port}/v1`;
  process.env.OPENAI_API_KEY = "gsk_TESTKEY1234567890";
  process.env.OPENAI_MODEL = standardModel;
  process.env.OPENAI_FAST_MODEL = standardModel;
  process.env.PREMIUM_MODEL = premiumModel;
  process.env.PREMIUM_API_KEY = "sk-test-premium";
  process.env.PREMIUM_BASE_URL = `http://127.0.0.1:${premium.port}/v1`;
  process.env.PROVIDER_PRICING = PRICES(premiumModel);
  for (const k of ["OPENAI_REASONING_EFFORT", "PREMIUM_REASONING_EFFORT", "PREMIUM_PURPOSES", "PREMIUM_DAILY_BUDGET_EUR", "LLM_TIMEOUT_MS"]) delete process.env[k];
  premiumBefore = premium.calls();
  standardBefore = standard.calls();
});
afterEach(() => {
  premium.clear();
  standard.clear();
});

const premiumCalls = () => premium.calls() - premiumBefore;
const standardCalls = () => standard.calls() - standardBefore;

async function usage(model: string, expected: number) {
  // recordUsage is fire-and-forget: wait for the rows to land.
  for (let i = 0; i < 50; i++) {
    const rows = await prisma.usageEvent.findMany({ where: { kind: "llm", model }, orderBy: { createdAt: "asc" } });
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  return prisma.usageEvent.findMany({ where: { kind: "llm", model } });
}

describe("the premium model route", () => {
  it("is off unless a model and its key are configured: every call uses the standard model", async () => {
    delete process.env.PREMIUM_API_KEY;
    const r = await runLLM("sys", "user", { purpose: "step" });
    expect(r.model).toBe(standardModel);
    expect([premiumCalls(), standardCalls()]).toEqual([0, 1]);
    expect(premiumConfigWarnings()).toEqual([expect.stringMatching(/PREMIUM_API_KEY is not/)]);
  });

  it("serves main-tier plan/step/verify calls, records their priced cost, and leaves fast and other calls on the standard model", async () => {
    const step = await runLLM("sys", "user", { purpose: "step", executionId: null });
    expect(step.model).toBe(premiumModel);
    const body = premium.requests().at(-1)!;
    expect(body.model).toBe(premiumModel);
    expect(body.reasoning_effort).toBe("low"); // cost-conscious default

    const fast = await runLLM("sys", "user", { purpose: "queries", model: "fast" });
    expect(fast.model).toBe(standardModel);
    const suggest = await runLLM("sys", "user", { purpose: "suggest" });
    expect(suggest.model).toBe(standardModel);
    expect([premiumCalls(), standardCalls()]).toEqual([1, 2]);

    const [row] = await usage(premiumModel, 1);
    expect(row).toMatchObject({ ok: true, estimated: false, costCurrency: "USD", costSource: "computed" });
    expect(row.costMicros).toBe(row.tokensIn * 5 + row.tokensOut * 30);
  });

  it("falls back to the standard model in the same call when the premium endpoint rejects the key, then pauses the route", async () => {
    premium.push({ status: 401, body: { error: { message: "Incorrect API key provided" } } });
    const r = await runLLM("sys", "user", { purpose: "step" });
    expect(r.model).toBe(standardModel);
    expect(r.text).toMatch(/^Standard answer/);
    expect([premiumCalls(), standardCalls()]).toEqual([1, 1]);
    const [failed] = await usage(premiumModel, 1);
    expect(failed).toMatchObject({ ok: false, estimated: true, costMicros: null });
    expect(failed.error).toMatch(/PREMIUM_API_KEY/);
    // Paused: the next call goes straight to the standard model.
    await runLLM("sys", "user", { purpose: "step" });
    expect([premiumCalls(), standardCalls()]).toEqual([1, 2]);
    expect(await premiumStatus()).toMatchObject({ configured: true, pausedFor: "config" });
  });

  it("falls back on an unknown model, a 5xx and a rate limit", async () => {
    premium.push({ status: 404, body: { error: { message: "The model does not exist", code: "model_not_found" } } });
    expect((await runLLM("sys", "user", { purpose: "plan" })).model).toBe(standardModel);
    resetPremiumStateForTests();
    premium.push({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    process.env.LLM_TIMEOUT_MS = "4000";
    expect((await runLLM("sys", "user", { purpose: "verify" })).model).toBe(standardModel);
    resetPremiumStateForTests();
    premium.clear();
    premium.push(...Array.from({ length: 6 }, () => ({ status: 429, retryAfter: 0, body: { error: { message: "Rate limit reached" } } })));
    expect((await runLLM("sys", "user", { purpose: "step" })).model).toBe(standardModel);
    expect(await premiumStatus()).toMatchObject({ pausedFor: "rate_limit" });
  });

  it("does not fall back once output has reached the caller (no duplicated live text), nor for a request too large for any model", async () => {
    premium.push({ closeMidStream: true });
    const live: string[] = [];
    await expect(runLLM("sys", "user", { purpose: "step", onDelta: (t) => live.push(t) })).rejects.toThrow(/interrupted mid-response/);
    expect(standardCalls()).toBe(0);
    const [failed] = await usage(premiumModel, 1);
    expect(failed.ok).toBe(false); // recorded against the model that failed

    premium.push({ status: 413, body: { error: { message: "Request too large" } } });
    await expect(runLLM("sys", "user", { purpose: "step" })).rejects.toThrow();
    expect(standardCalls()).toBe(0);
  });

  it("stays off without a price (the daily budget can't be enforced) and once today's budget is spent", async () => {
    process.env.PROVIDER_PRICING = JSON.stringify({ models: {}, fx: { USD: 0.9 } });
    expect(await premiumRouteFor("step", "main")).toEqual({ use: false, reason: "unpriced" });
    expect(premiumConfigWarnings()).toEqual([expect.stringMatching(/no price in PROVIDER_PRICING/)]);

    process.env.PROVIDER_PRICING = PRICES(premiumModel);
    process.env.PREMIUM_DAILY_BUDGET_EUR = "1";
    // €0.90 already spent today (1,000,000 USD micros at 0.9).
    await prisma.usageEvent.create({ data: { kind: "llm", provider: "openai", model: premiumModel, tokensIn: 1, tokensOut: 1, ok: true, costMicros: 1_000_000, costCurrency: "USD", costSource: "computed" } });
    expect((await premiumRouteFor("step", "main")).use).toBe(true);
    resetPremiumStateForTests();
    await prisma.usageEvent.create({ data: { kind: "llm", provider: "openai", model: premiumModel, tokensIn: 1, tokensOut: 1, ok: true, costMicros: 200_000, costCurrency: "USD", costSource: "computed" } });
    expect(await premiumRouteFor("step", "main")).toEqual({ use: false, reason: "daily budget reached" });
    const r = await runLLM("sys", "user", { purpose: "step" });
    expect(r.model).toBe(standardModel);
    expect(premiumCalls()).toBe(0);

    process.env.PREMIUM_DAILY_BUDGET_EUR = "0";
    expect(await premiumRouteFor("step", "main")).toEqual({ use: false, reason: "budget 0" });
  });

  it("serves only the purposes it is configured for", async () => {
    process.env.PREMIUM_PURPOSES = "verify";
    expect((await premiumRouteFor("step", "main")).use).toBe(false);
    expect((await premiumRouteFor("verify", "main")).use).toBe(true);
  });

  it("sends GPT-5-family requests to api.openai.com in the reasoning-model shape", () => {
    const body = openaiRequestBody({ baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", system: "s", user: "u", maxTokens: 4000, temperature: 0.5, reasoningEffort: "low" });
    expect(body).toMatchObject({ model: "gpt-5.5", max_completion_tokens: 4000, reasoning_effort: "low", stream: true, stream_options: { include_usage: true } });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });
});
