// The reference flow, end to end through the HTTP API and the worker:
// define an objective → Chief of Staff plans → approve → AI Team executes →
// verification → outcome → evidence → share publicly.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, createUser, fillContext, runWorker } from "../helpers";
import { startStubSearch } from "../stubSearch";

let stub: Awaited<ReturnType<typeof startStubSearch>>;
beforeEach(async () => {
  stub = await startStubSearch();
});
afterEach(async () => {
  await stub.close();
});

describe("objective → plan → approve → execute → verify → outcome", () => {
  it("delivers a verified, evidenced outcome and charges the wallet once", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);

    const created = await api()
      .post("/api/objectives")
      .set(auth)
      .send({
        statement: "Analyze the European market for our liquid-cooling product and recommend the three highest-potential markets for expansion.",
        successCriteria: [{ description: "Recommend 3 markets, ranked" }, { description: "Each recommendation cites evidence" }],
        budgetCents: 3000,
      })
      .expect(201);
    const objectiveId = created.body.objective.id;
    expect(created.body.objective.status).toBe("PLANNING");
    expect(created.body.objective.criteria[0]).toMatchObject({ kind: "quantitative", targetValue: 3, unit: "markets" });

    // The Chief of Staff plans (one worker tick), then waits for approval (default autonomy).
    await runWorker();
    let detail = (await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body;
    expect(detail.objective.status).toBe("WAITING_FOR_APPROVAL");
    const ex = detail.execution;
    expect(ex.status).toBe("WAITING_FOR_APPROVAL");
    expect(ex.plan.source).toBe("planner");
    expect(ex.steps[0].capability).toBe("objective_framing");
    expect(ex.steps[ex.steps.length - 1].capability).toBe("cross_functional_synthesis");
    expect(ex.steps.every((s: { status: string }) => s.status === "PENDING")).toBe(true);
    expect(ex.costCents).toBe(0); // nothing charged before approval
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(5000);

    const approvals = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ kind: "PLAN", objectiveId, costCents: ex.estimatedCostCents });

    await api().post(`/api/approvals/${approvals[0].id}/approve`).set(auth).send({}).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credits).toBe(5000 - ex.estimatedCostCents);

    await runWorker();
    detail = (await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body;
    const done = detail.execution;
    expect(done.status).toBe("COMPLETED");
    expect(detail.objective.status).toBe("COMPLETED");
    expect(done.steps.every((s: { status: string }) => s.status === "COMPLETED")).toBe(true);
    expect(done.result).toMatch(/^# /);

    // Evidence: company context + web sources, numbered 1..N.
    expect(done.evidence.length).toBeGreaterThanOrEqual(3);
    expect(done.evidence.map((e: { n: number }) => e.n)).toEqual(done.evidence.map((_: unknown, i: number) => i + 1));
    expect(done.evidence.some((e: { kind: string }) => e.kind === "WEB")).toBe(true);
    expect(stub.calls()).toBeGreaterThan(0);

    // Verification is structured and backed by evidence matches.
    expect(["PASS", "PASS_WITH_WARNINGS"]).toContain(done.verification.status);
    expect(done.verification.checks.map((c: { key: string }) => c.key)).toEqual(
      expect.arrayContaining(["objective_alignment", "citation_support", "criteria_coverage", "completeness", "consistency"])
    );
    expect(done.verification.claims.some((c: { status: string }) => c.status === "SUPPORTED")).toBe(true);

    // Outcome measured against each criterion.
    expect(done.outcomeStatus).toBe("ACHIEVED");
    expect(done.measurements).toHaveLength(2);

    // Event log tells the story in order.
    const types = done.events.map((e: { type: string }) => e.type);
    for (const t of ["OBJECTIVE_CREATED", "OBJECTIVE_PLANNED", "APPROVAL_REQUESTED", "APPROVAL_GRANTED", "EXECUTION_STARTED", "STEP_STARTED", "SOURCE_FOUND", "STEP_COMPLETED", "VERIFICATION_STARTED", "VERIFICATION_COMPLETED", "OUTCOME_MEASURED", "EXECUTION_COMPLETED"]) {
      expect(types).toContain(t);
    }
    expect(types.indexOf("APPROVAL_GRANTED")).toBeLessThan(types.indexOf("STEP_STARTED"));
    expect(types.lastIndexOf("EXECUTION_COMPLETED")).toBe(types.length - 1);

    // One charge, no refund.
    const txs = await prisma.transaction.findMany({ where: { executionId: done.id } });
    expect(txs.map((t) => [t.type, t.amountCents])).toEqual([["TASK_CHARGE", -done.estimatedCostCents]]);

    // Memory learned (low-risk preference → active).
    const memories = (await api().get("/api/memory").set(auth).expect(200)).body.memories;
    expect(memories.some((m: { status: string; kind: string }) => m.kind === "PREFERENCE" && m.status === "ACTIVE")).toBe(true);

    // Share publicly → /r/<token> works without auth; document text stays private.
    const share = await api().post(`/api/executions/${done.id}/share`).set(auth).send({ enabled: true }).expect(200);
    const pub = (await api().get(`/api/public/reports/${share.body.shareToken}`).expect(200)).body.report;
    expect(pub.kind).toBe("execution");
    expect(pub.result).toBe(done.result);
    expect(pub.objective.criteria).toHaveLength(2);
    expect(pub.verification.status).toBe(done.verification.status);
    const ctxSource = pub.sources.find((s: { title: string }) => s.title.startsWith("Company profile"));
    expect(ctxSource.snippet).toBe("");
    await api().post(`/api/executions/${done.id}/share`).set(auth).send({ enabled: false }).expect(200);
    await api().get(`/api/public/reports/${share.body.shareToken}`).expect(404);
  });
});
