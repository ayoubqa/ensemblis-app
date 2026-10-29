import { describe, expect, it } from "vitest";
import { traceDataUri, traceNodes, traceSvg } from "./trace";

describe("trace plates", () => {
  it("are deterministic per seed and differ between seeds", () => {
    expect(traceSvg("what-is-geo")).toBe(traceSvg("what-is-geo"));
    expect(traceSvg("what-is-geo")).not.toBe(traceSvg("ai-performance-funnel"));
  });

  it("look like a plan: 5–7 steps, start and end at fixed heights, evidence numbered in order", () => {
    for (const seed of ["a", "b", "what-is-geo", "ai-performance-funnel", "x".repeat(200)]) {
      const nodes = traceNodes(seed);
      expect(nodes.length).toBeGreaterThanOrEqual(5);
      expect(nodes.length).toBeLessThanOrEqual(7);
      expect(nodes[0].evidence).toBeNull();
      expect(nodes[nodes.length - 1].evidence).toBeNull();
      const ev = nodes.map((n) => n.evidence).filter((e): e is number => e !== null);
      expect(ev).toEqual(ev.map((_, i) => i + 1));
      for (const n of nodes) expect(n.y).toBeGreaterThanOrEqual(70);
    }
  });

  it("raster (Open Graph) plates carry no SVG text, which the image renderer cannot draw", () => {
    const svg = Buffer.from(traceDataUri("ai-performance-funnel").split(",")[1], "base64").toString();
    expect(svg).not.toContain("<text");
    expect(traceSvg("ai-performance-funnel")).toContain("<text");
  });
});
