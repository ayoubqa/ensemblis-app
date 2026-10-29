// The public use-case and pricing pages must say exactly what the backend does and charges.
// This reads backend/src/org/registry.ts as text (the frontend can't import backend code) and compares.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, CREDITS_PER_EUR, EXAMPLE_PLAN, EXAMPLE_PLAN_TOTAL, PLAN_COST, STEP_PRICES, USE_CASES, VERIFICATION_CREDITS, capabilitiesFor } from "./offer";

const backend = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../backend/src", rel), "utf8");
const registry = backend("org/registry.ts");

const parsed = [
  ...registry.matchAll(
    /key: "([a-z_]+)",\s*name: "([^"]+)",\s*executive: "([a-z_]+)",[\s\S]*?kind: "([a-z]+)",[\s\S]*?description: "([^"]+)",[\s\S]*?deliverable: \[([^\]]*)\],\s*tools: \[([^\]]*)\][\s\S]*?costCents: (\d+)/g
  ),
].map(([, key, name, team, kind, description, deliverable, tools, cost]) => ({
  key,
  name,
  team,
  kind,
  description,
  deliverable: [...deliverable.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  web: /"web_research"/.test(tools),
  costCredits: Number(cost),
}));

describe("lib/offer mirrors the backend", () => {
  it("has every capability with the same name, team, kind, description, deliverable, web use and cost", () => {
    expect(parsed.length).toBeGreaterThan(10);
    expect(CAPABILITIES).toEqual(parsed);
  });

  it("uses the backend's verification fee, credits-per-euro default and plan size", () => {
    expect(registry).toMatch(new RegExp(`VERIFICATION_COST_CENTS = ${VERIFICATION_CREDITS};`));
    expect(backend("config.ts")).toMatch(new RegExp(`creditsPerEur: int\\("CREDITS_PER_EUR", ${CREDITS_PER_EUR}`));
    expect(backend("engine/budget.ts")).toMatch(/plans have 3 to 7 steps/);
  });

  it("computes the plan cost range the planner can actually produce", () => {
    // planning 100 + one 250-credit step + synthesis 300 + verification 150; planning + five 300-credit steps + synthesis + verification
    expect(PLAN_COST).toEqual({ min: 800, max: 2050 });
    expect(STEP_PRICES).toEqual({ planning: 100, synthesis: 300, work: { min: 250, max: 300 } });
    expect(EXAMPLE_PLAN_TOTAL).toBe(1400);
    for (const s of EXAMPLE_PLAN) expect(CAPABILITIES.some((c) => c.key === s.key), s.key).toBe(true);
  });

  it("only advertises use cases whose teams have capabilities", () => {
    for (const u of USE_CASES) expect(capabilitiesFor(u.team).length, u.id).toBeGreaterThan(0);
  });
});
