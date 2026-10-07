import { describe, expect, it } from "vitest";
import { api, approvePending, balance, createUser, defineObjective, getExecution, runWorker, scriptLLM, fillContext } from "../helpers";

describe("exceptions", () => {
  it("asks for missing company information before planning spends anything, then re-plans with the answer", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    // Company Context is empty and the objective is about "our" product.
    const { executionId, objectiveId } = await defineObjective(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.costCents).toBe(0);
    const exc = (await api().get("/api/exceptions").set(auth).expect(200)).body.exceptions[0];
    expect(exc).toMatchObject({ kind: "MISSING_INFORMATION", objectiveId, actions: ["provide_info", "proceed", "cancel"] });
    expect(exc.questions[0].question).toMatch(/What does your company sell/);
    expect(exc.whatHappened).toMatch(/missing/i);

    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "provide_info" }).expect(400);
    await api()
      .post(`/api/exceptions/${exc.id}/resolve`)
      .set(auth)
      .send({ action: "provide_info", response: "We sell direct-to-chip liquid cooling racks to colocation providers." })
      .expect(200);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("WAITING_FOR_APPROVAL");
    const obj = (await api().get(`/api/objectives/${objectiveId}`).set(auth).expect(200)).body.objective;
    expect(obj.contextNotes).toMatch(/direct-to-chip liquid cooling/);
    await approvePending(auth);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    // The answer became evidence the team could cite.
    expect(ex.evidence.some((e: { kind: string }) => e.kind === "COMPANY_CONTEXT")).toBe(true);
    expect(await balance(user.id)).toBe(5000 - ex.costCents);
  });

  it("'proceed' continues with stated assumptions and never blocks on the same questions again", async () => {
    const { auth } = await createUser();
    const { executionId } = await defineObjective(auth);
    await runWorker();
    const exc = (await getExecution(auth, executionId)).exceptions[0];
    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "proceed" }).expect(200);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("WAITING_FOR_APPROVAL");
    expect(ex.plan.assumptions.some((a: string) => /Open question/.test(a))).toBe(true);
  });

  it("a result that fails verification is revised once automatically, then escalated; accepting it completes with a qualified outcome", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    // Every result cites evidence that doesn't contain its claims; the verifier finds it off-target.
    scriptLLM((system, _user, opts) => {
      if (opts.purpose === "step" && /Synthesis/.test(system)) {
        return [
          "# Expansion recommendation",
          "## Executive summary",
          "- Spain has 9,999 MW of capacity and grows 77% per year [1].",
          "- Italy's market is worth €123 billion [1].",
          "- Portugal has 5,555 operators [1].",
          "## Recommendation",
          "- Enter Spain first.",
        ].join("\n");
      }
      if (opts.purpose === "verify") {
        return JSON.stringify({ objectiveAlignment: { score: 30, rationale: "Does not rank three markets." }, criteria: [{ index: 1, status: "NOT_MET", measuredValue: 1, measurement: "1 market", explanation: "Only one market recommended." }], consistencyIssues: [], humanJudgment: [] });
      }
      return undefined;
    });
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.revisionCount).toBe(1);
    expect(ex.steps.some((s: { kind: string; status: string }) => s.kind === "revision" && s.status === "COMPLETED")).toBe(true);
    const types = ex.events.map((e: { type: string }) => e.type);
    expect(types.filter((t: string) => t === "VERIFICATION_COMPLETED")).toHaveLength(2);
    expect(types).toContain("REVISION_REQUESTED");
    expect(ex.verification.status).toBe("FAIL");
    expect(ex.verification.claims.filter((c: { status: string }) => c.status === "UNSUPPORTED").length).toBeGreaterThanOrEqual(2);
    const exc = ex.exceptions.find((x: { status: string }) => x.status === "OPEN");
    expect(exc.kind).toBe("VERIFICATION_FAILED");
    expect(exc.actions).toEqual(["accept", "retry", "cancel"]);

    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "accept" }).expect(200);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.verificationStatus).toBe("FAIL"); // never relabelled as passed
    expect(ex.outcomeStatus).toBe("NOT_ACHIEVED");
    expect(ex.measurements[0]).toMatchObject({ result: "NOT_MET", method: "deterministic" });
  });

  it("cancelling after a failed verification refunds everything", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((system, _u, opts) => {
      if (opts.purpose === "step" && /Synthesis/.test(system)) return "# X\n\nNothing useful.";
      if (opts.purpose === "verify") return JSON.stringify({ objectiveAlignment: { score: 10, rationale: "Empty." }, criteria: [], consistencyIssues: [], humanJudgment: [] });
      return undefined;
    });
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const exc = ex.exceptions.find((x: { status: string }) => x.status === "OPEN");
    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "cancel" }).expect(200);
    expect(await balance(user.id)).toBe(5000);
  });
});
