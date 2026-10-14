// Earlier (v1–v3) reports stay readable and shareable at their /r/<token> URLs.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { api, createUser } from "../helpers";

describe("legacy reports", () => {
  it("lists, opens and shares an earlier report; the public link keeps working", async () => {
    const { auth, user } = await createUser();
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        title: "Old competitive analysis",
        description: "private brief",
        status: "COMPLETED",
        result: "# Old report\n\nBody [1]",
        completedAt: new Date(),
        shareToken: "legacy_token_abcdefghijklmnop",
        sources: { create: [{ n: 1, kind: "upload", title: "deck.pdf", snippet: "private text" }] },
      },
    });
    const list = (await api().get("/api/tasks?limit=10").set(auth).expect(200)).body;
    expect(list.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);
    expect(list.nextCursor).toBeNull();
    expect((await api().get(`/api/tasks/${task.id}`).set(auth).expect(200)).body.task.result).toMatch(/Old report/);

    const pub = (await api().get("/api/public/reports/legacy_token_abcdefghijklmnop").expect(200)).body.report;
    expect(pub).toMatchObject({ kind: "task", title: "Old competitive analysis", result: "# Old report\n\nBody [1]" });
    expect(pub.sources[0].snippet).toBe(""); // uploaded file text stays private
    expect(JSON.stringify(pub)).not.toContain("private brief");

    await api().post(`/api/tasks/${task.id}/share`).set(auth).send({ enabled: false }).expect(200);
    await api().get("/api/public/reports/legacy_token_abcdefghijklmnop").expect(404);
    const again = (await api().post(`/api/tasks/${task.id}/share`).set(auth).send({ enabled: true }).expect(200)).body.task.shareToken;
    expect(again).not.toBe("legacy_token_abcdefghijklmnop");
    await api().get(`/api/public/reports/${again}`).expect(200);

    const other = await createUser();
    await api().get(`/api/tasks/${task.id}`).set(other.auth).expect(404);
  });

  it("marketplace endpoints are retired", async () => {
    const { auth } = await createUser();
    await api().get("/api/agents").expect(404);
    await api().get("/api/stats").expect(404);
    await api().post("/api/tasks").set(auth).send({ description: "x" }).expect(404);
  });
});
