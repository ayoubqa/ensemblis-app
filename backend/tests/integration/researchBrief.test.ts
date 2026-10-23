// The research-brief vertical slice, end to end through the HTTP API and the
// worker: define a brief (deliverable, constraints, three criteria) → the
// Chief of Staff plans a web-research step → approve → research runs against
// the local search stub (tests/stubSearch.ts, Tavily wire format) → the brief
// is written, verified and measured.
//
// MOCK AI: the model is the deterministic mock provider (AI_PROVIDER=mock in
// vitest.config.ts). This proves the engine's wiring, provenance and honesty
// rules — not the quality of a real model's research. The search results are
// the stub's fixed STUB_RESULTS, not live web pages.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { mockLLM } from "../../src/ai/mockProvider";
import { getCapability } from "../../src/org/registry";
import { api, balance, createUser, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";
import { startStubSearch, STUB_RESULTS, type StubSearch } from "../stubSearch";

let stub: StubSearch;
beforeEach(async () => {
  stub = await startStubSearch();
});
afterEach(async () => {
  await stub.close();
});

type Ev = { type: string; stepId: string | null; message: string; data: Record<string, unknown> };
const events = async (executionId: string): Promise<Ev[]> =>
  (await prisma.executionEvent.findMany({ where: { executionId }, orderBy: { id: "asc" } })) as unknown as Ev[];

/** Every evidence number cited in markdown ([3], [1, 2], [2; 5], [1–3]). */
function citedNumbers(md: string): number[] {
  const out: number[] = [];
  for (const m of md.matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(/\s*[,;]\s*/)) {
      const [a, b] = part.split(/\s*[–-]\s*/).map(Number);
      if (b === undefined) out.push(a);
      else for (let x = a; x <= b; x++) out.push(x);
    }
  }
  return out;
}

/** Host names of every markdown link and autolink in the text. */
function linkDomains(md: string): string[] {
  const urls = [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g), ...md.matchAll(/<(https?:\/\/[^>\s]+)>/g)].map((m) => m[1]);
  return urls.map((u) => new URL(u).hostname.replace(/^www\./, ""));
}

const CONSTRAINTS = "EU sources only; no paid databases. Cover Germany and the Nordics.";
const CRITERIA = [
  { description: "Every key finding cites an external source" },
  { description: "Names the three largest European data center markets" },
  { description: "States the open questions and evidence gaps" },
];

describe("research brief (mock AI, stub search)", () => {
  it("plans web research, keeps provenance, maps every citation, verifies per criterion and reports usage honestly", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);

    // Capture the planner's prompt: the constraints must reach it (the mock model answers).
    // The brief synthesis is the mock's brief plus one cited recommendation (scripted), so the
    // verifier has a recommendation claim to type: the mock writes its recommendations uncited.
    const planPrompts: { system: string; user: string }[] = [];
    const synthesisPrompts: string[] = [];
    scriptLLM((system, userPrompt, opts) => {
      if (opts.purpose === "plan") planPrompts.push({ system, user: userPrompt });
      if (opts.purpose === "step" && /Produce the evidence-backed research brief/.test(system)) {
        synthesisPrompts.push(userPrompt);
        const brief = mockLLM(system, userPrompt, opts);
        const firstFinding = /## Key findings\n- [^\n]*?\[(\d+)\]/.exec(brief)?.[1];
        if (!firstFinding) return brief;
        return brief.replace(
          "## Recommendations\n",
          `## Recommendations\n- Recommendation: prioritise Germany first, as the largest European data center market [${firstFinding}].\n`
        );
      }
      return undefined;
    });

    const created = await api()
      .post("/api/objectives")
      .set(auth)
      .send({
        statement: "Brief: the European data center market for liquid cooling — where demand is growing and what constrains it.",
        kind: "research_brief",
        constraints: CONSTRAINTS,
        successCriteria: CRITERIA,
        budgetCents: 3000,
      })
      .expect(201);
    expect(created.body.objective).toMatchObject({ kind: "research_brief", constraints: CONSTRAINTS });
    const executionId = created.body.executionId as string;

    // Planning (one worker tick), then the plan waits for approval: nothing is charged yet.
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("WAITING_FOR_APPROVAL");
    expect(ex.costCents).toBe(0);
    expect(ex.plan.blocked ?? null).toBeNull();
    expect(ex.plan.source).toBe("planner");
    expect(planPrompts).toHaveLength(1);
    expect(planPrompts[0].user).toContain('<constraints trust="user-instruction">');
    expect(planPrompts[0].user).toContain(CONSTRAINTS);
    expect(planPrompts[0].system).toMatch(/Respect every item in <constraints>/);
    expect(planPrompts[0].system).toMatch(/evidence-backed research brief/);
    // The plan includes a step whose capability searches the web.
    const webSteps = ex.steps.filter((s: { capability: string }) => getCapability(s.capability)?.tools.includes("web_research") && getCapability(s.capability)?.kind !== "synthesis");
    expect(webSteps.length).toBeGreaterThanOrEqual(1);

    const approvals = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    expect(approvals).toHaveLength(1);
    await api().post(`/api/approvals/${approvals[0].id}/approve`).set(auth).send({}).expect(200);
    await runWorker();

    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(await balance(user.id)).toBe(5000 - ex.costCents + ex.refundedCents);

    // Research: the web step recorded an ok research run with the provider that answered.
    const researched = ex.steps.filter((s: { researchStatus: string | null }) => s.researchStatus);
    expect(researched.length).toBeGreaterThanOrEqual(1);
    for (const s of researched) {
      expect(s.researchStatus).toBe("ok");
      expect(s.research.providers).toEqual(["tavily"]);
      expect(s.research.queries.length).toBeGreaterThan(0);
    }
    const evs = await events(executionId);
    const done = evs.filter((e) => e.type === "RESEARCH_COMPLETED");
    expect(done.length).toBe(researched.length);
    expect(done[0].data.providers).toEqual(["tavily"]);
    expect((done[0].data.queries as string[]).length).toBeGreaterThan(0);
    expect(evs.some((e) => e.type === "RESEARCH_FAILED")).toBe(false);
    expect(stub.tavilyCalls()).toBe((done[0].data.queries as string[]).length);

    // Evidence: the external rows are exactly the stub's results, with provenance.
    const rows = await prisma.evidence.findMany({ where: { executionId }, orderBy: { n: "asc" } });
    const web = rows.filter((e) => e.kind === "WEB");
    const sortByUrl = <T extends { url: string | null }>(xs: T[]) => [...xs].sort((a, b) => String(a.url).localeCompare(String(b.url)));
    expect(sortByUrl(web).map((e) => ({ url: e.url, title: e.title, excerpt: e.excerpt }))).toEqual(
      sortByUrl(STUB_RESULTS).map((r) => ({ url: r.url, title: r.title, excerpt: r.content }))
    );
    for (const e of web) {
      expect(e.provider).toBe("tavily");
      expect(e.query).toBeTruthy();
      expect(e.retrievedAt).toBeInstanceOf(Date);
      expect(e.retrieval).toBe("search_snippet");
    }
    expect(rows.map((e) => e.n)).toEqual(rows.map((_, i) => i + 1));
    // One SOURCE_FOUND per created row, never for a reused one.
    const found = evs.filter((e) => e.type === "SOURCE_FOUND");
    expect(found.map((e) => e.data.n)).toEqual(rows.map((e) => e.n));
    // The API exposes the same provenance (never the stored content).
    const apiWeb = ex.evidence.find((e: { kind: string }) => e.kind === "WEB");
    expect(apiWeb).toMatchObject({ provider: "tavily", retrieval: "search_snippet" });
    expect(apiWeb.query).toBeTruthy();
    expect(apiWeb.retrievedAt).toEqual(expect.any(String));
    expect(apiWeb).not.toHaveProperty("content");

    // Citations: every [n] in the brief maps to this execution's evidence; every link is on an evidence domain.
    const result = ex.result as string;
    expect(result).toMatch(/^# /);
    expect(result).toMatch(/## Key findings/);
    const ns = new Set(rows.map((e) => e.n));
    const cited = citedNumbers(result);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter((n) => !ns.has(n))).toEqual([]);
    const domains = new Set(rows.map((e) => e.domain).filter((d): d is string => !!d).map((d) => d.replace(/^www\./, "")));
    expect(linkDomains(result).filter((d) => !domains.has(d))).toEqual([]);

    // Verification: typed claims, the verifier's provenance, per-criterion verdicts with evidence.
    const v = await prisma.verification.findFirstOrThrow({ where: { executionId }, orderBy: { round: "desc" }, include: { claims: true } });
    expect(v.modelProvider).toBe("mock");
    expect(v.method).toBe("deterministic+model");
    const types = new Set(v.claims.map((c) => c.claimType));
    expect(types.has("source")).toBe(true);
    expect(types.has("recommendation")).toBe(true);
    expect(v.claims.filter((c) => c.status === "SUPPORTED" && !c.evidenceNs.length)).toEqual([]);
    // A recommendation goes beyond what its source says: it is never "supported", even when it cites one.
    const rec = v.claims.find((c) => c.claimType === "recommendation")!;
    expect(rec.evidenceNs.length).toBeGreaterThan(0);
    expect(rec.status).not.toBe("SUPPORTED");
    expect(ex.verification.claims.some((c: { claimType: string | null }) => c.claimType === "source")).toBe(true);
    // The synthesis was told which [n] are external sources.
    expect(synthesisPrompts.at(-1)).toMatch(/External sources you may cite as findings \(web and Wikipedia\): \[\d+\]/);
    expect(synthesisPrompts.at(-1)).toContain(CONSTRAINTS);
    expect(ex.verification.criteria).toHaveLength(CRITERIA.length);
    for (const c of ex.verification.criteria) for (const n of c.evidence) expect(ns.has(n)).toBe(true);

    // Outcome: one measurement per criterion, each linked only to evidence that exists.
    expect(ex.measurements).toHaveLength(CRITERIA.length);
    for (const m of ex.measurements) for (const n of m.evidenceNs) expect(ns.has(n)).toBe(true);

    // The result state is its own axis, separate from the AI-measured outcome.
    expect(["verified", "verified_with_warnings"]).toContain(ex.resultState);
    expect(ex.resultState).toBe(ex.verification.status === "PASS" ? "verified" : "verified_with_warnings");
    expect(["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED", "UNKNOWN"]).toContain(ex.outcomeStatus);
    if (ex.verification.status !== "PASS") expect(ex.outcomeStatus).not.toBe("ACHIEVED");
    expect(ex.confirmedOutcomeStatus).toBeNull();

    // Honest labels: this ran on the mock model, whose token counts are estimates.
    expect(ex.usedMockAI).toBe(true);
    for (const s of ex.steps) expect(s.tokensEstimated).toBe(true);
    expect(ex.usage.calls).toBeGreaterThan(0);
    expect(ex.usage.estimated).toBe(true);
    expect(ex.usage.byPurpose.map((g: { purpose: string }) => g.purpose)).toEqual(expect.arrayContaining(["plan", "queries", "step", "verify"]));
    expect(ex.usage.byPurpose.every((g: { provider: string }) => g.provider === "mock")).toBe(true);
    expect(ex.usage.searches).toEqual([{ provider: "tavily", calls: stub.tavilyCalls(), failed: 0 }]);

    // The public report keeps the mock label and the result state.
    const share = await api().post(`/api/executions/${executionId}/share`).set(auth).send({ enabled: true }).expect(200);
    const pub = (await api().get(`/api/public/reports/${share.body.shareToken}`).expect(200)).body.report;
    expect(pub.usedMockAI).toBe(true);
    expect(pub.resultState).toBe(ex.resultState);
    expect(pub.result).toBe(result);
  });
});
