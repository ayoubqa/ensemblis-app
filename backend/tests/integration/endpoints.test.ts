// What an execution ran on is stored with it and serialized from that record — the plan's runtime
// stamp and each search attempt's endpoint — never from the server's current configuration. Home's
// recent outcomes say what the lists say (partial result, mock output, a person's confirmation),
// and the incomplete-work notes a synthesis reads (and may copy into the result) carry no provider detail.
//
// MOCK AI (AI_PROVIDER=mock): the steps run on the mock model; search goes to the local stub
// (tests/stubSearch.ts), which is exactly what endpoints.search "custom" must say.
import { afterEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/db";
import { incompleteResearchNotes } from "../../src/engine/executor";
import { api, createUser, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";
import { startStubSearch, type StubSearch } from "../stubSearch";

let stub: StubSearch | null = null;
afterEach(async () => {
  await stub?.close();
  stub = null;
});

const STATEMENT = "Brief: the European data center market for liquid cooling — where demand is growing and what constrains it.";
const MEMO = "Analyze the European market for our liquid-cooling product and recommend the three highest-potential markets for expansion.";

async function run(auth: Record<string, string>, body: Record<string, unknown>) {
  const res = await api()
    .post("/api/objectives")
    .set(auth)
    .send({ successCriteria: [{ description: "Recommend 3 markets, ranked" }], budgetCents: 3000, autonomy: "AUTO_WITHIN_BUDGET", ...body })
    .expect(201);
  await runWorker();
  return { objectiveId: res.body.objective.id as string, executionId: res.body.executionId as string };
}

/** What every serialized form of the execution says about its endpoints. */
async function endpointsEverywhere(auth: Record<string, string>, objectiveId: string, executionId: string, shareToken: string) {
  const list = (await api().get("/api/objectives").set(auth).expect(200)).body.objectives.find((o: { id: string }) => o.id === objectiveId);
  const detail = (await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body;
  const report = (await api().get(`/api/public/reports/${shareToken}`).expect(200)).body.report;
  const home = (await api().get("/api/dashboard").set(auth).expect(200)).body.recentOutcomes.find((r: { executionId: string }) => r.executionId === executionId);
  return {
    execution: (await getExecution(auth, executionId)).endpoints,
    list: list.latestExecution.endpoints,
    detailSummary: detail.executions[0].endpoints,
    detail: detail.execution.endpoints,
    report: report.endpoints,
    home: home.endpoints,
  };
}

describe("execution endpoints", () => {
  it("a run against the search stub says search 'custom' everywhere, and keeps saying it once the server is reconfigured; a pre-stamp execution says null", async () => {
    stub = await startStubSearch();
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { objectiveId, executionId } = await run(auth, { statement: STATEMENT, kind: "research_brief" });
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.usedMockAI).toBe(true);

    // Stored with the execution: the plan's stamp (mock model: no model endpoint) and each attempt's endpoint.
    const row = await prisma.execution.findUniqueOrThrow({ where: { id: executionId }, include: { steps: true } });
    expect((row.plan as { runtime?: unknown }).runtime).toEqual({ modelEndpoint: null, searchEndpoint: "custom" });
    const attempts = row.steps.flatMap((s) => ((s.research as { attempts?: { endpoint?: string }[] } | null)?.attempts ?? []));
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((a) => a.endpoint === "custom")).toBe(true);

    const shareToken = (await api().post(`/api/executions/${executionId}/share`).set(auth).send({ enabled: true }).expect(200)).body.shareToken as string;
    const custom = { model: null, search: "custom" };
    expect(await endpointsEverywhere(auth, objectiveId, executionId, shareToken)).toEqual({ execution: custom, list: custom, detailSummary: custom, detail: custom, report: custom, home: custom });

    // The server now searches the public API (or not at all): the execution still says what it ran on.
    await stub.close();
    stub = null;
    expect((await getExecution(auth, executionId)).endpoints).toEqual(custom);

    // An execution recorded before endpoints existed: no runtime stamp, no attempt markers — unknown, never guessed.
    const { runtime: _runtime, ...legacyPlan } = row.plan as Record<string, unknown>;
    await prisma.execution.update({ where: { id: executionId }, data: { plan: legacyPlan as Prisma.InputJsonValue } });
    for (const s of row.steps) {
      const r = s.research as { attempts?: Record<string, unknown>[] } | null;
      if (!r?.attempts) continue;
      const stripped = { ...r, attempts: r.attempts.map(({ endpoint: _e, ...a }) => a) };
      await prisma.executionStep.update({ where: { id: s.id }, data: { research: stripped as Prisma.InputJsonValue } });
    }
    const unknown = { model: null, search: null };
    expect(await endpointsEverywhere(auth, objectiveId, executionId, shareToken)).toEqual({ execution: unknown, list: unknown, detailSummary: unknown, detail: unknown, report: unknown, home: unknown });
  });
});

describe("Home's recent outcomes and the incomplete-work notes", () => {
  it("a memo whose research failed is a partial mock result on Home, and its synthesis is told so without provider detail", async () => {
    stub = await startStubSearch({ status: 401, wikipedia: 503 });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const synthesis: string[] = [];
    scriptLLM((system, user, opts) => {
      if (opts.purpose === "step" && /^You are the Synthesis Lead on/.test(system)) synthesis.push(user);
      return undefined;
    });
    const { executionId } = await run(auth, { statement: MEMO });
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.resultState).toBe("partial");
    // The owner's console keeps the full reason in the step's research record.
    const failed = ex.steps.find((s: { researchStatus: string | null }) => s.researchStatus === "failed");
    expect(failed).toBeTruthy();
    expect(failed.research.attempts.some((a: { httpStatus: number | null }) => a.httpStatus === 401)).toBe(true);

    // The synthesis (and any revision) reads one provider-free line per incomplete step; a brief's wording is the same.
    const lines = synthesis.flatMap((p) => p.split("\n").filter((l) => l.startsWith("- “")));
    expect(synthesis.length).toBeGreaterThan(0);
    expect(lines).toContain(`- “${failed.title}”: web research failed.`);
    const notes = [...(await incompleteResearchNotes(executionId)), ...(await incompleteResearchNotes(executionId, undefined, "result"))];
    expect(notes).toContain(`“${failed.title}”: web research failed.`);
    for (const l of [...lines, ...notes]) expect(l).not.toMatch(/tavily|wikipedia|http|\b40[13]\b|\b50\d\b|api key|SEARCH_|TAVILY_|budget|quota|skipped for/i);

    let home = (await api().get("/api/dashboard").set(auth).expect(200)).body.recentOutcomes[0];
    expect(home).toMatchObject({ executionId, resultState: "partial", usedMockAI: true, outcomeConfirmed: false, endpoints: { model: null, search: "custom" } });

    // A confirmation recorded before confirmedOutcomeStatus existed (outcomeConfirmedAt only) counts as confirmed.
    await prisma.execution.update({ where: { id: executionId }, data: { outcomeStatus: "NOT_ACHIEVED", confirmedOutcomeStatus: null, outcomeConfirmedAt: new Date() } });
    home = (await api().get("/api/dashboard").set(auth).expect(200)).body.recentOutcomes[0];
    expect(home).toMatchObject({ outcomeStatus: "NOT_ACHIEVED", outcomeConfirmed: true });
  });

  it("Home's result state is the execution's, and the mock label follows what the steps and the verifier ran on", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await run(auth, { statement: MEMO });
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    let home = (await api().get("/api/dashboard").set(auth).expect(200)).body.recentOutcomes[0];
    expect(home.resultState).toBe(ex.resultState);
    expect(home.usedMockAI).toBe(true);
    // Search is off in this suite: no search call, so no search endpoint.
    expect(home.endpoints).toEqual({ model: null, search: null });

    // usedMockAI comes from what the steps and the verifier ran on.
    await prisma.executionStep.updateMany({ where: { executionId }, data: { provider: "openai" } });
    await prisma.verification.updateMany({ where: { executionId }, data: { modelProvider: "openai" } });
    home = (await api().get("/api/dashboard").set(auth).expect(200)).body.recentOutcomes[0];
    expect(home.usedMockAI).toBe(false);
  });
});
