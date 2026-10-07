import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, approvePending, balance, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

describe("approvals", () => {
  it("rejecting the plan cancels the execution and charges nothing", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId, objectiveId } = await defineObjective(auth);
    await runWorker();
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    expect(a.recommendedDecision).toBe("APPROVE");
    expect(a.reason).toMatch(/review/i);
    await api().post(`/api/approvals/${a.id}/reject`).set(auth).send({ note: "Not now" }).expect(200);
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("CANCELLED");
    expect(ex.steps.every((s: { status: string }) => s.status === "SKIPPED")).toBe(true);
    expect(await balance(user.id)).toBe(5000);
    expect((await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body.objective.status).toBe("CANCELLED");
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(409);
  });

  it("runs automatically within budget when autonomy allows it", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth, { autonomy: "AUTO_WITHIN_BUDGET", budgetCents: 3000 });
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.approvals).toHaveLength(0);
    expect(await balance(user.id)).toBe(5000 - ex.costCents);
  });

  it("asks for budget approval when the estimate exceeds the objective's budget, even on autonomy", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    const { executionId } = await defineObjective(auth, { autonomy: "AUTO_WITHIN_BUDGET", budgetCents: 500 });
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("WAITING_FOR_APPROVAL");
    expect(ex.approvals[0].kind).toBe("BUDGET");
    expect(ex.approvals[0].risk).toBe("MEDIUM");
    expect(ex.approvals[0].reason).toMatch(/above this objective's budget/);
  });

  it("an approval that the wallet can't afford stays pending (402) until funds are added", async () => {
    const { auth, user } = await createUser({ credits: 100 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    const r = await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(402);
    expect(r.body.error).toMatch(/Insufficient/);
    expect((await getExecution(auth, executionId)).status).toBe("WAITING_FOR_APPROVAL");
    expect((await api().get("/api/approvals").set(auth).expect(200)).body.approvals).toHaveLength(1);
    await prisma.user.update({ where: { id: user.id }, data: { credits: 5000 } });
    await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
    await runWorker();
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
  });

  it("an auto-start the wallet can't afford becomes an exception, resolved by Retry after a top-up", async () => {
    const { auth, user } = await createUser({ credits: 100 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth, { autonomy: "AUTO_WITHIN_BUDGET" });
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.exceptions[0].kind).toBe("INSUFFICIENT_FUNDS");
    expect(ex.costCents).toBe(0);
    await api().post(`/api/exceptions/${ex.exceptions[0].id}/resolve`).set(auth).send({ action: "retry" }).expect(402);
    await prisma.user.update({ where: { id: user.id }, data: { credits: 5000 } });
    await api().post(`/api/exceptions/${ex.exceptions[0].id}/resolve`).set(auth).send({ action: "retry" }).expect(200);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
  });

  it("concurrent approvals can't overdraw the wallet", async () => {
    const { auth, user } = await createUser({ credits: 2400 }); // enough for two €11.50 executions, not three
    await fillContext(auth);
    for (let i = 0; i < 3; i++) await defineObjective(auth);
    await runWorker();
    const approvals = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    expect(approvals).toHaveLength(3);
    const results = await Promise.all(approvals.map((a: { id: string }) => api().post(`/api/approvals/${a.id}/approve`).set(auth).send({})));
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(2);
    expect(results.filter((r) => r.status === 402)).toHaveLength(1);
    expect(await balance(user.id)).toBeGreaterThanOrEqual(0);
    expect(await balance(user.id)).toBe(2400 - ok * approvals[0].costCents);
  });

  it("a person can fix proposed success criteria before approving", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    const { objectiveId } = await defineObjective(auth, { successCriteria: [] });
    await runWorker();
    let d = (await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body;
    expect(d.objective.criteria.every((c: { source: string }) => c.source === "proposed")).toBe(true);
    d = (await api().put(`/api/objectives/${objectiveId}/criteria`).set(auth).send({ criteria: [{ description: "Rank 3 markets" }] }).expect(200)).body;
    expect(d.objective.criteria).toHaveLength(1);
    expect(d.objective.criteria[0]).toMatchObject({ source: "user", targetValue: 3 });
    await approvePending(auth);
    await runWorker();
    await api().put(`/api/objectives/${objectiveId}/criteria`).set(auth).send({ criteria: [{ description: "x y z" }] }).expect(409);
  });
});
