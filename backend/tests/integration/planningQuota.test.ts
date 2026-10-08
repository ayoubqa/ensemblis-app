// Planning calls the main model before anything is charged, so it has its own
// caps: free sign-ups and guests must not be able to drain the AI quota or
// stall the shared queue for everyone else.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, createUser, fillContext, runWorker } from "../helpers";

const objective = (i: number) => ({ statement: `Map the top competitors in segment number ${i} for our product`, budgetCents: 3000 });

describe("planning quota", () => {
  it("at most 3 objectives are planned at once per organization", async () => {
    const { auth } = await createUser();
    await fillContext(auth);
    for (let i = 0; i < 3; i++) await api().post("/api/objectives").set(auth).send(objective(i)).expect(201);
    const r = await api().post("/api/objectives").set(auth).send(objective(4)).expect(429);
    expect(r.body.error).toMatch(/already planning 3 objectives/);
    // Drafts don't plan, so they are never blocked.
    await api().post("/api/objectives").set(auth).send({ ...objective(5), draft: true }).expect(201);
    await runWorker();
    await api().post("/api/objectives").set(auth).send(objective(6)).expect(201);
  });

  it("a guest trial can plan only a few times a day", async () => {
    const { auth } = await createUser({ isGuest: true });
    await fillContext(auth).catch(() => undefined); // guests may not edit context; planning still works
    for (let i = 0; i < 3; i++) {
      await api().post("/api/objectives").set(auth).send(objective(i)).expect(201);
      await runWorker();
    }
    const r = await api().post("/api/objectives").set(auth).send(objective(9)).expect(429);
    expect(r.body.error).toMatch(/today's limit of 3 plans/);
  });

  it("a re-plan that would exceed the cap leaves the exception open (nothing half-applied)", async () => {
    const { auth, user } = await createUser({ isGuest: true });
    // Empty company context + "our" → the Chief of Staff blocks with a question.
    const { body } = await api().post("/api/objectives").set(auth).send({ statement: "Find the best channel partners for our product in France", budgetCents: 3000 }).expect(201);
    await runWorker();
    // Use up the guest's remaining planning allowance.
    for (let i = 0; i < 2; i++) {
      await api().post("/api/objectives").set(auth).send(objective(i)).expect(201);
      await runWorker();
    }
    const exc = await prisma.exception.findFirstOrThrow({ where: { objectiveId: body.objective.id, status: "OPEN" } });
    await api().post(`/api/exceptions/${exc.id}/resolve`).set(auth).send({ action: "provide_info", response: "We sell inventory software to grocery chains." }).expect(429);
    expect((await prisma.exception.findUniqueOrThrow({ where: { id: exc.id } })).status).toBe("OPEN");
    expect(user.isGuest).toBe(true);
  });
});
