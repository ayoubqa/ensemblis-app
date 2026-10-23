// A test stub or a local model endpoint is never presented as a hosted model: the endpoint is
// classified (hosted / local / stub), labelled, warned about in production and stamped on each
// plan, and an execution's endpoints come from what was stored with it — never the current config.
import { afterEach, describe, expect, it } from "vitest";
import { isLocalHost, modelEndpoint, productionConfigProblems, productionConfigWarnings } from "../../src/config";
import { aiProviderLabel, currentModelEndpoint, setLLMHandlerForTests } from "../../src/ai/llmProvider";
import { publicConfig } from "../../src/public/config";
import { endpointsOf } from "../../src/engine/serialize";

const KEYS = ["RENDER", "AI_PROVIDER", "AI_PROVIDER_LABEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "ANTHROPIC_BASE_URL", "OLLAMA_BASE_URL", "E2E_STUB"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setLLMHandlerForTests(null);
});

function openai(base?: string, stub = false) {
  delete process.env.RENDER;
  delete process.env.AI_PROVIDER_LABEL;
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "gsk_test";
  process.env.OPENAI_MODEL = "openai/gpt-oss-120b";
  if (base) process.env.OPENAI_BASE_URL = base;
  else delete process.env.OPENAI_BASE_URL;
  if (stub) process.env.E2E_STUB = "1";
  else delete process.env.E2E_STUB;
}

describe("isLocalHost", () => {
  it("is true for loopback, private, link-local and ULA addresses, internal names and single-label names", () => {
    for (const h of ["127.0.0.1", "127.8.9.10", "0.0.0.0", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.20", "169.254.169.254", "100.64.0.1"]) {
      expect(isLocalHost(h), h).toBe(true);
    }
    for (const h of ["[::1]", "::1", "[fd12:3456::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]"]) expect(isLocalHost(h), h).toBe(true);
    for (const h of ["localhost", "localhost.", "api.localhost", "gpu-box.local", "llm.internal", "model.corp.internal.", "nas.lan", "box.home.arpa", "ollama", ""]) {
      expect(isLocalHost(h), h).toBe(true);
    }
  });

  it("is false for public names and public unicast addresses", () => {
    for (const h of ["api.groq.com", "api.openai.com", "example.com.", "8.8.8.8", "[2606:4700:4700::1111]", "172.32.0.1", "11.0.0.1"]) expect(isLocalHost(h), h).toBe(false);
  });
});

describe("modelEndpoint", () => {
  it("hosted: the default Groq API, OpenAI, a hosted Anthropic", () => {
    openai();
    expect(modelEndpoint()).toEqual({ kind: "hosted", host: "api.groq.com" });
    openai("https://api.openai.com/v1/");
    expect(modelEndpoint()).toEqual({ kind: "hosted", host: "api.openai.com" });
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_BASE_URL;
    expect(modelEndpoint()).toEqual({ kind: "hosted", host: "api.anthropic.com" });
  });

  it("local: a base URL on this machine or a private network (possibly a real model, never called mock)", () => {
    openai("http://127.0.0.1:4100/v1");
    expect(modelEndpoint()).toEqual({ kind: "local", host: "127.0.0.1:4100" });
    openai("http://[fd00::5]:8000/v1");
    expect(modelEndpoint()).toEqual({ kind: "local", host: "[fd00::5]:8000" });
    openai("http://gpu-box.local:8000/v1");
    expect(modelEndpoint()?.kind).toBe("local");
    openai("http://vllm:8000/v1");
    expect(modelEndpoint()?.kind).toBe("local");
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_BASE_URL = "http://10.0.0.7:8080";
    expect(modelEndpoint()).toEqual({ kind: "local", host: "10.0.0.7:8080" });
    process.env.AI_PROVIDER = "ollama";
    delete process.env.OLLAMA_BASE_URL;
    expect(modelEndpoint()).toEqual({ kind: "local", host: "localhost:11434" });
  });

  it("stub: E2E_STUB=1 with a base URL that is not a known public model API (scripts/e2e-stack.mjs PROD_LIKE=1)", () => {
    openai("http://127.0.0.1:4199/v1", true);
    expect(modelEndpoint()).toEqual({ kind: "stub", host: "127.0.0.1:4199" });
    openai("https://stub.example.com/v1", true);
    expect(modelEndpoint()?.kind).toBe("stub");
    // E2E_STUB=1 does not make the real public APIs a stub, and Ollama is never one.
    openai(undefined, true);
    expect(modelEndpoint()?.kind).toBe("hosted");
    openai("https://api.openai.com/v1", true);
    expect(modelEndpoint()?.kind).toBe("hosted");
    process.env.AI_PROVIDER = "ollama";
    expect(modelEndpoint()?.kind).toBe("local");
  });

  it("null for the mock and an unknown provider", () => {
    process.env.AI_PROVIDER = "mock";
    expect(modelEndpoint()).toBeNull();
    process.env.AI_PROVIDER = "gemini";
    expect(modelEndpoint()).toBeNull();
  });

  it("currentModelEndpoint (stamped on plans) is null when the mock or a test handler answers", () => {
    openai("http://127.0.0.1:4199/v1", true);
    expect(currentModelEndpoint()).toBe("stub");
    setLLMHandlerForTests(() => "x");
    expect(currentModelEndpoint()).toBeNull();
    setLLMHandlerForTests(null);
    process.env.AI_PROVIDER = "mock";
    expect(currentModelEndpoint()).toBeNull();
  });
});

describe("labels and warnings", () => {
  it("aiProviderLabel names a stub or local endpoint (also with AI_PROVIDER_LABEL); a hosted one is unchanged", () => {
    openai();
    expect(aiProviderLabel()).toBe("Groq (GPT-OSS 120B)");
    openai("http://127.0.0.1:4199/v1", true);
    expect(aiProviderLabel()).toBe("Test stub endpoint (E2E_STUB=1) — GPT-OSS 120B, not a real model");
    openai("http://192.168.1.20:8000/v1");
    expect(aiProviderLabel()).toBe("Local model endpoint (192.168.1.20:8000) — GPT-OSS 120B");
    process.env.AI_PROVIDER_LABEL = "Acme GPT";
    expect(aiProviderLabel()).toBe("Local model endpoint (192.168.1.20:8000) — Acme GPT");
    process.env.AI_PROVIDER = "ollama";
    delete process.env.AI_PROVIDER_LABEL;
    delete process.env.OLLAMA_BASE_URL;
    expect(aiProviderLabel()).toBe("Local model endpoint (localhost:11434) — Ollama");
    process.env.AI_PROVIDER = "mock";
    expect(aiProviderLabel()).toBe("Mock AI (development/testing only)");
  });

  it("GET /api/config aiEndpoint: hosted, local or stub (the mock counts as a stub); never the host", () => {
    openai();
    expect(publicConfig().aiEndpoint).toBe("hosted");
    openai("http://user:pw@10.0.0.5:8000/v1");
    const cfg = publicConfig();
    expect(cfg.aiEndpoint).toBe("local");
    expect(JSON.stringify(cfg)).not.toMatch(/user:pw|pw@/);
    openai("http://127.0.0.1:4199/v1", true);
    expect(publicConfig().aiEndpoint).toBe("stub");
    process.env.AI_PROVIDER = "mock";
    expect(publicConfig()).toMatchObject({ mockAI: true, aiEndpoint: "stub" });
  });

  it("production warns (never refuses) about a stub or local model endpoint, naming only its host", () => {
    openai("http://user:pw@127.0.0.1:4199/v1/secret-path", true);
    process.env.RENDER = "true";
    const stub = productionConfigWarnings().find((w) => w.startsWith("OPENAI_BASE_URL"));
    expect(stub).toMatch(/^OPENAI_BASE_URL points at a test stub \(127\.0\.0\.1:4199, E2E_STUB=1\): its output is not a real model's/);
    expect(stub).not.toMatch(/user|pw@|secret-path/);
    expect(productionConfigProblems().join(" ")).not.toMatch(/OPENAI_BASE_URL|E2E_STUB/);
    delete process.env.E2E_STUB;
    expect(productionConfigWarnings().find((w) => w.startsWith("OPENAI_BASE_URL"))).toMatch(/^OPENAI_BASE_URL is on this machine or a private network \(127\.0\.0\.1:4199\)/);
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    expect(productionConfigWarnings().join(" ")).not.toMatch(/OPENAI_BASE_URL/);
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_BASE_URL = "http://10.0.0.7:8080";
    expect(productionConfigWarnings().join(" ")).toMatch(/ANTHROPIC_BASE_URL is on this machine or a private network \(10\.0\.0\.7:8080\)/);
    delete process.env.RENDER;
    expect(productionConfigWarnings()).toEqual([]);
  });
});

describe("endpointsOf (what an execution ran on)", () => {
  const plan = (runtime?: object) => ({ title: "Plan", steps: [], ...(runtime ? { runtime } : {}) });
  const research = (...endpoints: (string | undefined)[]) => ({
    status: "ok",
    attempts: endpoints.map((endpoint, i) => ({ query: `q${i}`, provider: "tavily", ok: !!endpoint, ...(endpoint ? { endpoint } : {}) })),
  });

  it("model comes from the plan's runtime stamp", () => {
    expect(endpointsOf({ plan: plan({ modelEndpoint: "stub", searchEndpoint: null }), steps: [] })).toEqual({ model: "stub", search: null });
    expect(endpointsOf({ plan: plan({ modelEndpoint: "local", searchEndpoint: "public" }), steps: [] }).model).toBe("local");
    expect(endpointsOf({ plan: plan({ modelEndpoint: null, searchEndpoint: null }), steps: [] }).model).toBeNull();
    expect(endpointsOf({ plan: plan({ modelEndpoint: "bogus" }), steps: [] }).model).toBeNull();
  });

  it("search comes from the attempts: custom wins, public otherwise, null when no search call was made", () => {
    const runtime = { modelEndpoint: "hosted", searchEndpoint: "public" };
    expect(endpointsOf({ plan: plan(runtime), steps: [{ researchStatus: "ok", research: research("custom") }] }).search).toBe("custom");
    // The attempts are the record: a stub call counts even if planning saw the public API.
    expect(endpointsOf({ plan: plan(runtime), steps: [{ researchStatus: "degraded", research: research("public", "custom") }] }).search).toBe("custom");
    expect(endpointsOf({ plan: plan(runtime), steps: [{ researchStatus: "ok", research: research("public", "public") }] }).search).toBe("public");
    // Only skipped providers (no request), or research that never ran: not used.
    expect(endpointsOf({ plan: plan(runtime), steps: [{ researchStatus: "failed", research: research(undefined) }] }).search).toBeNull();
    expect(endpointsOf({ plan: plan(runtime), steps: [{ researchStatus: "off", research: { status: "off", attempts: [] } }, { researchStatus: null }] }).search).toBeNull();
  });

  it("sources reused from an interrupted attempt (no attempts recorded) fall back to the plan's stamp", () => {
    const steps = [{ researchStatus: "degraded", research: { status: "degraded", attempts: [] } }];
    expect(endpointsOf({ plan: plan({ modelEndpoint: null, searchEndpoint: "custom" }), steps }).search).toBe("custom");
    expect(endpointsOf({ plan: plan({ modelEndpoint: null, searchEndpoint: "public" }), steps }).search).toBe("public");
  });

  it("legacy executions (no runtime stamp, no attempt markers) are unknown: null, never guessed from the current config", () => {
    const legacy = { plan: plan(), steps: [{ researchStatus: "ok", research: { status: "ok", attempts: [{ query: "q", provider: "tavily", ok: true }] } }] };
    expect(endpointsOf(legacy)).toEqual({ model: null, search: null });
    expect(endpointsOf({ plan: null })).toEqual({ model: null, search: null });
    expect(endpointsOf({ plan: "junk", steps: [{ research: "junk" }, { research: { attempts: "junk" } }] })).toEqual({ model: null, search: null });
  });
});
