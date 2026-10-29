// The scripted mock model must never serve production — not even when
// NODE_ENV was forgotten on a hosting platform.
import { afterEach, describe, expect, it } from "vitest";
import { config, mockAIForbidden, productionConfigProblems, productionConfigWarnings } from "../../src/config";
import { aiConfigProblem, currentProvider, describeModel, setLLMHandlerForTests } from "../../src/ai/llmProvider";
import { classifyProviderError } from "../../src/ai/errors";
import { publicConfig } from "../../src/public/config";

const KEYS = ["RENDER", "AI_PROVIDER", "JWT_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "OPENAI_FAST_MODEL", "OPENAI_BASE_URL", "CLAUDE_MODEL", "TAVILY_BASE_URL", "E2E_STUB"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const savedSearch = { ...config.search };
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  Object.assign(config.search, savedSearch);
  setLLMHandlerForTests(null);
});

describe("mock AI guard", () => {
  it("allows the mock in local development and tests", () => {
    delete process.env.RENDER;
    process.env.AI_PROVIDER = "mock";
    expect(mockAIForbidden()).toBe(false);
    expect(currentProvider()).toBe("mock");
  });

  it("refuses the mock on Render even without NODE_ENV=production", () => {
    process.env.RENDER = "true";
    process.env.AI_PROVIDER = "mock";
    expect(mockAIForbidden()).toBe(true);
    expect(productionConfigProblems().join(" ")).toMatch(/AI_PROVIDER="mock"/);
    expect(() => currentProvider()).toThrow(/development and tests only/);
  });

  it("on a host without NODE_ENV, the API still refuses a missing JWT_SECRET (the worker doesn't need one)", () => {
    process.env.RENDER = "true";
    process.env.AI_PROVIDER = "openai";
    delete process.env.JWT_SECRET;
    expect(productionConfigProblems("api").join(" ")).toMatch(/JWT_SECRET/);
    expect(productionConfigProblems("worker").join(" ")).not.toMatch(/JWT_SECRET/);
  });

  it("warns in production when TAVILY_BASE_URL sends web search to a stub or proxy (naming only its host)", () => {
    process.env.RENDER = "true";
    process.env.AI_PROVIDER = "openai";
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "tvly-test";
    process.env.TAVILY_BASE_URL = "http://user:pw@127.0.0.1:4198/";
    const warning = productionConfigWarnings().find((w) => w.startsWith("TAVILY_BASE_URL"));
    expect(warning).toMatch(/^TAVILY_BASE_URL is set \(127\.0\.0\.1:4198\): web search goes there instead of the public Tavily API/);
    expect(warning).not.toMatch(/user|pw@/);
    // A stub stack (scripts/e2e-stack.mjs, E2E_STUB=1) still starts: a warning, never a refusal.
    process.env.E2E_STUB = "1";
    expect(productionConfigWarnings().join(" ")).toMatch(/E2E_STUB=1/);
    expect(productionConfigProblems().join(" ")).not.toMatch(/TAVILY/);
    process.env.TAVILY_BASE_URL = "https://api.tavily.com";
    expect(productionConfigWarnings().join(" ")).not.toMatch(/TAVILY_BASE_URL/);
    delete process.env.RENDER;
    process.env.TAVILY_BASE_URL = "http://127.0.0.1:4198";
    expect(productionConfigWarnings()).toEqual([]);
  });

  it("warns in production when web research is Wikipedia only (no TAVILY_API_KEY), naming the fix but no secret", () => {
    process.env.RENDER = "true";
    process.env.AI_PROVIDER = "openai";
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "";
    const warning = productionConfigWarnings().find((w) => w.startsWith("Web research uses Wikipedia only"));
    expect(warning).toMatch(/TAVILY_API_KEY is not set.*Set TAVILY_API_KEY on the API service/);
    config.search.provider = "wikipedia";
    expect(productionConfigWarnings().join(" ")).toMatch(/Wikipedia only \(SEARCH_PROVIDER=wikipedia\)/);
    config.search.provider = "tavily";
    config.search.tavilyApiKey = "tvly-test";
    expect(productionConfigWarnings().join(" ")).not.toMatch(/Wikipedia only/);
    config.search.provider = "off";
    expect(productionConfigWarnings().join(" ")).not.toMatch(/Wikipedia only/);
  });
});

describe("aiConfigProblem", () => {
  it("is null when calls can be attempted (mock in tests, a provider with its key)", () => {
    delete process.env.RENDER;
    process.env.AI_PROVIDER = "mock";
    expect(aiConfigProblem()).toBeNull();
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "gsk_test";
    expect(aiConfigProblem()).toBeNull();
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(aiConfigProblem()).toBeNull();
  });

  it("names a missing key, an unknown provider and the mock where it is forbidden — as config errors", () => {
    delete process.env.RENDER;
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(aiConfigProblem()).toMatch(/OPENAI_API_KEY is missing/);
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiConfigProblem()).toMatch(/ANTHROPIC_API_KEY is missing/);
    process.env.AI_PROVIDER = "gemini";
    expect(aiConfigProblem()).toMatch(/Unknown AI_PROVIDER "gemini"/);
    process.env.RENDER = "true";
    process.env.AI_PROVIDER = "mock";
    expect(aiConfigProblem()).toMatch(/development and tests only/);
    expect(classifyProviderError(aiConfigProblem())).toBe("config");
  });

  it("GET /api/config reports it without any secret", () => {
    delete process.env.RENDER;
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(publicConfig()).toMatchObject({ aiConfigured: false, aiProblem: expect.stringMatching(/OPENAI_API_KEY is missing/), mockAI: false });
    process.env.OPENAI_API_KEY = "gsk_SECRETCANARY1234567890";
    const cfg = publicConfig();
    expect(cfg).toMatchObject({ aiConfigured: true, aiProblem: null });
    expect(JSON.stringify(cfg)).not.toMatch(/SECRETCANARY/);
  });
});

describe("describeModel", () => {
  it("reports the provider and model a call would use", () => {
    delete process.env.RENDER;
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "openai/gpt-oss-120b";
    delete process.env.OPENAI_FAST_MODEL;
    delete process.env.OPENAI_BASE_URL;
    expect(describeModel("main")).toEqual({ provider: "openai", model: "openai/gpt-oss-120b" });
    expect(describeModel("fast")).toEqual({ provider: "openai", model: "openai/gpt-oss-20b" });
    process.env.AI_PROVIDER = "anthropic";
    process.env.CLAUDE_MODEL = "claude-haiku-4-5-20251001";
    expect(describeModel()).toEqual({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    process.env.AI_PROVIDER = "mock";
    expect(describeModel()).toEqual({ provider: "mock", model: "mock" });
    process.env.AI_PROVIDER = "gemini";
    expect(describeModel()).toEqual({ provider: "unconfigured", model: "none" });
  });

  it("a test handler counts as the mock", () => {
    process.env.AI_PROVIDER = "openai";
    setLLMHandlerForTests(() => "x");
    expect(describeModel()).toEqual({ provider: "mock", model: "mock" });
  });
});
