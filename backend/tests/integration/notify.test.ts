import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { onAttentionNeeded } from "../../src/lib/notify";
import { api, createUser, defineObjective, fillContext } from "../helpers";

const saved = { ...config.email };
afterEach(() => {
  config.email.resendApiKey = saved.resendApiKey;
  config.email.from = saved.from;
  vi.restoreAllMocks();
});

describe("execution emails", () => {
  it("stop once the person who started the execution has left the organization", async () => {
    config.email.resendApiKey = "re_test";
    config.email.from = "Ensemblis <test@example.com>";
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String((init as RequestInit).body)).to[0]);
      return new Response("{}", { status: 200 });
    });

    const owner = await createUser({ name: "Olivia Owner", credits: 5000 });
    await fillContext(owner.auth);
    await api().post("/api/team").set(owner.auth).send({ name: "Coolstack" }).expect(201);
    const invite = (await api().post("/api/team/invites").set(owner.auth).expect(201)).body.invite;
    const member = await createUser({ name: "Max Member", email: "max@example.com", credits: 0 });
    await api().post("/api/team/join").set(member.auth).send({ token: invite.token }).expect(200);
    const { executionId } = await defineObjective(member.auth);

    await onAttentionNeeded(executionId, "A plan is waiting for approval", "detail");
    expect(sent).toEqual(["max@example.com"]);

    await api().post("/api/team/leave").set(member.auth).expect(200);
    await onAttentionNeeded(executionId, "A plan is waiting for approval", "detail");
    expect(sent).toEqual(["max@example.com"]);
  });
});
