import { afterEach, describe, expect, it, vi } from "vitest";

type W = { vaq?: unknown[]; va?: unknown };
const g = globalThis as unknown as { window?: W };

describe("analytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete g.window;
  });

  it("does nothing unless a provider is configured at build time", async () => {
    g.window = {};
    const { track } = await import("./analytics");
    track("cta_click", { from: "home-hero", to: "/access" });
    expect(g.window.vaq).toBeUndefined();
  });

  it("queues Vercel events in the script's format, with at most the two properties Vercel records", async () => {
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS", "vercel");
    g.window = {};
    const { track } = await import("./analytics");
    track("article_read_complete", { slug: "what-is-geo", layer: "problem", extra: "dropped" });
    expect(g.window.vaq).toEqual([["event", { name: "article_read_complete", data: { slug: "what-is-geo", layer: "problem" } }]]);
  });
});
