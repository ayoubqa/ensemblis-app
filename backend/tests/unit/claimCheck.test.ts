// The model claim-support check (G15) is downgrade-only: "contradicted" and
// "not_found" make a claim UNSUPPORTED, "partial" turns SUPPORTED into
// PARTIALLY_SUPPORTED, "supported" never upgrades anything, and when the call
// fails the text-match results stand with a warning that says so.

import { afterEach, describe, expect, it } from "vitest";
import { setLLMHandlerForTests, type LLMOptions } from "../../src/ai/llmProvider";
import { CLAIM_CHECK_MAX, CLAIM_CHECK_PROMPT_PREFIX, CLAIM_WINDOW_CHARS, checkClaimSupport, TEXT_MATCH_ONLY, type ClaimCheckSource } from "../../src/engine/verification/claimCheck";
import { checkClaims, extractClaims, type ClaimResult } from "../../src/engine/verification/checks";

afterEach(() => setLLMHandlerForTests(null));

const evidence: ClaimCheckSource[] = [
  {
    n: 1,
    kind: "WEB",
    title: "EU data centers 2027",
    domain: "example.org",
    url: "https://example.org/dc",
    content: "Germany is the largest European data center market with 2,450 MW of operational capacity in 2025.",
  },
  { n: 2, kind: "WEB", title: "Nordics", domain: "nordic.example", url: "https://nordic.example/c", content: "Nordic operators report liquid cooling adoption of 34% in new builds." },
];
const lexical = (md: string): ClaimResult[] => checkClaims(extractClaims(md), evidence);

/** Replies to the verify_claims call with `verdicts` and records what it was sent. */
function scriptVerdicts(verdicts: { index: number; verdict: string; quote?: string }[]) {
  const seen: { system: string; user: string; opts: LLMOptions }[] = [];
  setLLMHandlerForTests(async (system, user, opts) => {
    seen.push({ system, user, opts });
    return JSON.stringify({ claims: verdicts });
  });
  return seen;
}

describe("claim-support check (downgrade-only)", () => {
  it("lexical matching alone is fooled by a subject swap (the reason for this check)", () => {
    expect(lexical("France is the largest European data center market [1].")[0].status).toBe("SUPPORTED");
  });

  it("a 'contradicted' verdict downgrades a lexically SUPPORTED claim to UNSUPPORTED", async () => {
    const claims = lexical("- France is the largest European data center market [1].\n- Nordic operators report liquid cooling adoption of 34% in new builds [2].");
    expect(claims.map((c) => c.status)).toEqual(["SUPPORTED", "SUPPORTED"]);
    const seen = scriptVerdicts([
      { index: 1, verdict: "contradicted", quote: "Germany is the largest European data center market with 2,450 MW of operational capacity in 2025." },
      { index: 2, verdict: "supported" },
    ]);
    const run = await checkClaimSupport({ executionId: null, claims, evidence });
    expect(run).toMatchObject({ ran: true, checked: 2, downgraded: 1, warning: null });
    expect(run.results[0]).toMatchObject({ status: "UNSUPPORTED", evidenceNs: [1] });
    expect(run.results[0].note).toMatch(/contradicts this claim/);
    expect(run.results[0].quote).toMatch(/^Germany is the largest/);
    expect(run.results[1].status).toBe("SUPPORTED");
    // The input is not mutated.
    expect(claims[0].status).toBe("SUPPORTED");
    // The call: one batched structured request, routed by its system prompt prefix.
    expect(seen).toHaveLength(1);
    expect(seen[0].system.startsWith("You check whether cited sources support claims")).toBe(true);
    expect(CLAIM_CHECK_PROMPT_PREFIX).toBe("You check whether cited sources support claims");
    expect(seen[0].opts.purpose).toBe("verify_claims");
    expect(seen[0].user).toMatch(/<claims trust="untrusted">\n1\. France is the largest European data center market \.? ?\[1\]\n2\. Nordic operators/);
    expect(seen[0].user).toMatch(/<evidence trust="untrusted">\n=== BEGIN SOURCES ===\n\[1\] EU data centers 2027 — example\.org\nGermany is the largest/);
  });

  it("'not_found' downgrades too; 'partial' turns SUPPORTED into PARTIALLY_SUPPORTED", async () => {
    const claims = lexical("- Germany is the largest European data center market [1].\n- Nordic operators report liquid cooling adoption of 34% in new builds [2].");
    scriptVerdicts([
      { index: 1, verdict: "partial" },
      { index: 2, verdict: "Not found" },
    ]);
    const run = await checkClaimSupport({ executionId: null, claims, evidence });
    expect(run.results.map((c) => c.status)).toEqual(["PARTIALLY_SUPPORTED", "UNSUPPORTED"]);
    expect(run.downgraded).toBe(2);
  });

  it("a 'supported' verdict never upgrades a partly supported claim", async () => {
    const claims = lexical("- Germany has 9,999 MW of capacity [1].");
    expect(claims[0].status).toBe("PARTIALLY_SUPPORTED");
    scriptVerdicts([{ index: 1, verdict: "supported", quote: "Germany has 9,999 MW." }]);
    const run = await checkClaimSupport({ executionId: null, claims, evidence });
    expect(run.results[0].status).toBe("PARTIALLY_SUPPORTED");
    expect(run.downgraded).toBe(0);
    // A quote that isn't in the cited extract is not kept.
    expect(run.results[0].quote).not.toBe("Germany has 9,999 MW.");
  });

  it("a provider failure keeps the text-match results and adds a warning", async () => {
    const claims = lexical("- Germany is the largest European data center market [1].");
    setLLMHandlerForTests(async () => {
      throw new Error("The AI provider is having problems right now (HTTP 503). Bearer gsk_abcdefghijklmnopqrst");
    });
    const run = await checkClaimSupport({ executionId: null, claims, evidence });
    expect(run.ran).toBe(false);
    expect(run.results).toEqual(claims);
    expect(run.warning).toMatch(new RegExp(`^${TEXT_MATCH_ONLY}: the AI claim check could not run \\(.*HTTP 503`));
    expect(run.warning).not.toMatch(/gsk_abcdefghijklmnopqrst/);
  });

  it("an unusable reply also keeps the text-match results, with the warning", async () => {
    const claims = lexical("- Germany is the largest European data center market [1].");
    setLLMHandlerForTests(async () => "Looks fine to me.");
    const run = await checkClaimSupport({ executionId: null, claims, evidence });
    expect(run.results[0].status).toBe("SUPPORTED");
    expect(run.warning).toMatch(/^Claim support checked by text match only/);
  });

  it("makes no call when no claim is supported by the text match", async () => {
    let calls = 0;
    setLLMHandlerForTests(async () => {
      calls++;
      return "{}";
    });
    const run = await checkClaimSupport({ executionId: null, claims: lexical("- Spain will grow 77% next year.\n- Italy is worth €123 billion [1]."), evidence });
    expect(calls).toBe(0);
    expect(run).toMatchObject({ ran: false, checked: 0, warning: null });
  });

  it("checks at most 20 claims per call, each with at most a 1,200-character window of its sources", async () => {
    const long = "Filler sentence about something else entirely. ".repeat(80);
    const big: ClaimCheckSource[] = [{ ...evidence[0], content: `${long}Germany is the largest European data center market with 2,450 MW of operational capacity in 2025. ${long}` }];
    const md = Array.from({ length: 25 }, () => "- Germany is the largest European data center market [1].").join("\n");
    const claims = checkClaims(extractClaims(md), big);
    expect(claims.filter((c) => c.status === "SUPPORTED").length).toBe(25);
    const seen = scriptVerdicts([]);
    const run = await checkClaimSupport({ executionId: null, claims, evidence: big });
    const lines = /<claims[^>]*>\n([\s\S]*?)\n<\/claims>/.exec(seen[0].user)![1].split("\n");
    expect(lines).toHaveLength(CLAIM_CHECK_MAX);
    const extract = /\[1\] EU data centers 2027 — example\.org\n([\s\S]*?)\n=== END SOURCES ===/.exec(seen[0].user)![1];
    expect(extract.length).toBeLessThanOrEqual(CLAIM_WINDOW_CHARS + 2);
    expect(extract).toMatch(/Germany is the largest European data center market with 2,450 MW/);
    // Nothing answered: every claim keeps its text-match status, and the warnings say so.
    expect(run.results.map((c) => c.status)).toEqual(claims.map((c) => c.status));
    expect(run.warning).toMatch(/text match only for 20 claims the AI claim check did not answer/);
    expect(run.warning).toMatch(/text match only for 5 more claims/);
  });
});
