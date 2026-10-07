// Organization isolation: nothing of one organization is readable or actionable by another.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

async function orgWithBlockedWork() {
  const a = await createUser({ credits: 5000 });
  const { executionId, objectiveId } = await defineObjective(a.auth); // empty context → MISSING_INFORMATION exception
  await runWorker();
  const ex = await getExecution(a.auth, executionId);
  const doc = await api().post("/api/context/documents").set(a.auth).send({ kind: "txt", name: "secret.txt", text: "Confidential pricing: €42 per rack." }).expect(201);
  const mem = await api().post("/api/memory").set(a.auth).send({ kind: "PREFERENCE", content: "Prefers bullet summaries." }).expect(201);
  return { a, executionId, objectiveId, exceptionId: ex.exceptions[0].id as string, documentId: doc.body.document.id as string, memoryId: mem.body.memory.id as string };
}

describe("organization isolation", () => {
  it("another organization can't read or act on anything", async () => {
    const t = await orgWithBlockedWork();
    const b = await createUser({ credits: 5000 });

    await api().get(`/api/objectives/${t.objectiveId}`).set(b.auth).expect(404);
    await api().get(`/api/executions/${t.executionId}`).set(b.auth).expect(404);
    await api().get(`/api/executions/${t.executionId}/events`).set(b.auth).expect(404);
    await api().get(`/api/executions/${t.executionId}/stream`).set(b.auth).expect(404);
    await api().post(`/api/executions/${t.executionId}/cancel`).set(b.auth).expect(404);
    await api().post(`/api/executions/${t.executionId}/share`).set(b.auth).send({ enabled: true }).expect(404);
    await api().post(`/api/objectives/${t.objectiveId}/executions`).set(b.auth).expect(404);
    await api().put(`/api/objectives/${t.objectiveId}/criteria`).set(b.auth).send({ criteria: [{ description: "hijack" }] }).expect(404);
    await api().post(`/api/exceptions/${t.exceptionId}/resolve`).set(b.auth).send({ action: "proceed" }).expect(404);
    await api().delete(`/api/context/documents/${t.documentId}`).set(b.auth).expect(404);
    await api().patch(`/api/memory/${t.memoryId}`).set(b.auth).send({ status: "ARCHIVED" }).expect(404);
    await api().delete(`/api/memory/${t.memoryId}`).set(b.auth).expect(404);

    const lists = await Promise.all([
      api().get("/api/objectives").set(b.auth),
      api().get("/api/approvals?status=ALL").set(b.auth),
      api().get("/api/exceptions?status=ALL").set(b.auth),
      api().get("/api/memory").set(b.auth),
      api().get("/api/context").set(b.auth),
      api().get("/api/dashboard").set(b.auth),
    ]);
    expect(lists[0].body.objectives).toHaveLength(0);
    expect(lists[1].body.approvals).toHaveLength(0);
    expect(lists[2].body.exceptions).toHaveLength(0);
    expect(lists[3].body.memories).toHaveLength(0);
    expect(lists[4].body.documents).toHaveLength(0);
    expect(lists[5].body.team.activity).toHaveLength(0);

    // A's data is untouched.
    expect((await prisma.exception.findUniqueOrThrow({ where: { id: t.exceptionId } })).status).toBe("OPEN");
    expect(await prisma.contextDocument.count({ where: { id: t.documentId } })).toBe(1);
  });

  it("another organization can't decide an approval", async () => {
    const a = await createUser();
    await fillContext(a.auth);
    await defineObjective(a.auth);
    await runWorker();
    const [approval] = (await api().get("/api/approvals").set(a.auth).expect(200)).body.approvals;
    const b = await createUser();
    await api().post(`/api/approvals/${approval.id}/approve`).set(b.auth).send({}).expect(404);
    await api().post(`/api/approvals/${approval.id}/reject`).set(b.auth).send({}).expect(404);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
  });

  it("team members share the owner's organization; leaving the team restores their own", async () => {
    const owner = await createUser({ name: "Olivia Owner", credits: 5000 });
    await fillContext(owner.auth);
    const { objectiveId } = await defineObjective(owner.auth);
    await api().post("/api/team").set(owner.auth).send({ name: "Coolstack" }).expect(201);
    const invite = (await api().post("/api/team/invites").set(owner.auth).expect(201)).body.invite;
    const member = await createUser({ name: "Max Member", credits: 0 });
    const own = await defineObjective(member.auth, { draft: true });
    await api().post("/api/team/join").set(member.auth).send({ token: invite.token }).expect(200);

    // The member sees the team's organization: the owner's objective and context, not their own draft.
    const mine = (await api().get("/api/objectives").set(member.auth).expect(200)).body.objectives.map((o: { id: string }) => o.id);
    expect(mine).toContain(objectiveId);
    expect(mine).not.toContain(own.objectiveId);
    expect((await api().get("/api/context").set(member.auth).expect(200)).body.context.companyName).toBe("Coolstack");
    // Members can't change organization policy.
    await api().patch("/api/org").set(member.auth).send({ approvalThresholdCents: 0 }).expect(403);

    await api().post("/api/team/leave").set(member.auth).expect(200);
    const after = (await api().get("/api/objectives").set(member.auth).expect(200)).body.objectives.map((o: { id: string }) => o.id);
    expect(after).toEqual([own.objectiveId]);
  });

  it("public share links expose only shared, completed outcomes", async () => {
    const t = await orgWithBlockedWork();
    await api().get(`/api/public/reports/${"x".repeat(32)}`).expect(404);
    await api().post(`/api/executions/${t.executionId}/share`).set(t.a.auth).send({ enabled: true }).expect(409); // not completed
  });
});
