// Market-validation metrics (operators only) and the customer's "was this useful?" answer.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

async function completedRun(auth: Record<string, string>) {
  await fillContext(auth);
  const { executionId } = await defineObjective(auth, { autonomy: "AUTO_WITHIN_BUDGET" });
  await runWorker();
  return executionId;
}

describe("validation metrics", () => {
  it("follow customers from sign-up to a verified result and repeat use, with feedback — operators left out", async () => {
    // An operator's own test run never counts.
    const owner = await createUser({ email: "owner@example.com", verified: true, credits: 5000 });
    await completedRun(owner.auth);

    const a = await createUser({ email: "a@example.com", verified: true, credits: 5000 });
    await createUser({ email: "b@example.com", verified: true }); // signs up, does nothing
    await createUser({ email: "guest@example.com", isGuest: true });
    const first = await completedRun(a.auth);
    const ex = await getExecution(a.auth, first);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.feedback).toBeNull();

    // Feedback: one answer per execution, the latest wins; only the org's own executions; only once finished.
    await api().post(`/api/executions/${first}/feedback`).set(a.auth).send({ useful: false }).expect(200);
    const fb = (await api().post(`/api/executions/${first}/feedback`).set(a.auth).send({ useful: true, comment: "Saved me a day of desk research." }).expect(200)).body.feedback;
    expect(fb).toMatchObject({ useful: true, comment: "Saved me a day of desk research." });
    expect((await getExecution(a.auth, first)).feedback).toMatchObject({ useful: true });
    await api().post(`/api/executions/${first}/feedback`).set(owner.auth).send({ useful: false }).expect(404);
    // Answers sent at the same time still leave one answer.
    await Promise.all([true, false, true, false].map((useful) => api().post(`/api/executions/${first}/feedback`).set(a.auth).send({ useful }).expect(200)));
    expect(await prisma.valueRecord.count({ where: { executionId: first, metric: "feedback_useful" } })).toBe(1);
    await api().post(`/api/executions/${first}/feedback`).set(a.auth).send({ useful: true, comment: "Saved me a day of desk research." }).expect(200);
    await api().post(`/api/executions/${first}/feedback`).set(a.auth).send({ useful: true, comment: "x".repeat(501) }).expect(400);

    // A second run on another day (moved back a day) and one before the period: repeat and returning use.
    const second = await completedRun(a.auth);
    await prisma.execution.update({ where: { id: second }, data: { createdAt: new Date(Date.now() - 24 * 3600_000) } });

    const m = (await api().get("/api/admin/validation?days=30").set(owner.auth).expect(200)).body;
    expect(m.excludedOperatorAccounts).toBe(1);
    expect(m.activation).toMatchObject({ signups: 2, definedObjective: 1, ranExecution: 1, completedResult: 1, cameBack: 1 });
    expect(m.activation.rates.definedObjective).toBe(50);
    // "Verified" is the result state (a PASS on incomplete work is "partial", not verified).
    expect(m.activation.verifiedResult).toBe(["verified", "verified_with_warnings"].includes(ex.resultState) ? 1 : 0);
    expect(m.resultStates[ex.resultState]).toBeGreaterThanOrEqual(1);
    expect(m.activation.medianHoursToFirstResult).toBeGreaterThanOrEqual(0);
    expect(m.guestTrials).toBe(1);
    expect(m.executions).toMatchObject({ started: 2, completed: 2, failed: 0, completionRate: 100 });
    expect(Object.values(m.resultStates as Record<string, number>).reduce((n, v) => n + v, 0)).toBe(2);
    expect(m.credits.consumedNet).toBeGreaterThan(0);
    expect(m.repeat).toMatchObject({ activeAccounts: 1, ranOnSeveralDays: 1, returningAccounts: 0 });
    expect(m.feedback).toMatchObject({ responses: 1, useful: 1, notUseful: 0, usefulRate: 100 });
    expect(m.feedback.recentComments).toEqual([{ at: expect.any(String), useful: true, comment: "Saved me a day of desk research." }]);
    // No objective, plan or result text anywhere in the metrics.
    expect(JSON.stringify(m)).not.toMatch(/liquid-cooling|European market/i);

    await prisma.execution.update({ where: { id: second }, data: { createdAt: new Date(Date.now() - 40 * 24 * 3600_000) } });
    const later = (await api().get("/api/admin/validation?days=30").set(owner.auth).expect(200)).body;
    expect(later.repeat).toMatchObject({ activeAccounts: 1, returningAccounts: 1 });
  });

  it("feedback waits for the execution to finish; the metrics are operator-only", async () => {
    const a = await createUser({ verified: true, credits: 5000 });
    await fillContext(a.auth);
    const { executionId } = await defineObjective(a.auth); // waits for plan approval
    await runWorker();
    await api().post(`/api/executions/${executionId}/feedback`).set(a.auth).send({ useful: true }).expect(409);
    await api().get("/api/admin/validation").set(a.auth).expect(403);
    const owner = await createUser({ email: "owner@example.com", verified: true });
    await api().get("/api/admin/validation?days=0").set(owner.auth).expect(400);
  });
});
