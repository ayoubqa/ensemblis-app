// The scripted mock model must never serve production — not even when
// NODE_ENV was forgotten on a hosting platform.
import { afterEach, describe, expect, it } from "vitest";
import { mockAIForbidden, productionConfigProblems } from "../../src/config";
import { currentProvider } from "../../src/ai/llmProvider";

const saved = { RENDER: process.env.RENDER, AI_PROVIDER: process.env.AI_PROVIDER };
afterEach(() => {
  if (saved.RENDER === undefined) delete process.env.RENDER;
  else process.env.RENDER = saved.RENDER;
  process.env.AI_PROVIDER = saved.AI_PROVIDER;
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
});
