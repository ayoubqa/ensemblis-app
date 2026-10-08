import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../src/index";
import { prisma } from "../src/db";
import { signToken } from "../src/auth/middleware";
import { drain } from "../src/engine/worker";

export const api = () => request(app);

let n = 0;
export async function createUser(opts: { email?: string; name?: string; credits?: number; company?: string; isGuest?: boolean; verified?: boolean } = {}) {
  n++;
  const passwordHash = await bcrypt.hash("password123", 4);
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `user${n}-${Date.now()}@example.com`,
      passwordHash,
      name: opts.name ?? `User ${n}`,
      company: opts.company ?? "",
      credits: opts.credits ?? 5000,
      isGuest: opts.isGuest ?? false,
      emailVerifiedAt: opts.verified ? new Date() : null,
    },
  });
  return { user, token: signToken(user.id, passwordHash), auth: { Authorization: `Bearer ${signToken(user.id, passwordHash)}` } };
}

/** Runs every queued job (including delayed retries) until the queue is idle. */
export async function runWorker(maxJobs = 200) {
  return drain({ includeDelayed: true, maxJobs });
}

export async function fillContext(auth: Record<string, string>) {
  await api()
    .put("/api/context")
    .set(auth)
    .send({
      companyName: "Coolstack",
      description: "Coolstack makes liquid-cooling systems for data centers.",
      products: "Direct-to-chip liquid cooling racks and coolant distribution units.",
      customers: "Colocation providers and hyperscale data-center operators.",
      markets: "Germany and the Netherlands today.",
      goals: "Expand to two more European markets in 2027.",
    })
    .expect(200);
}

import { setLLMHandlerForTests, type HandlerReply, type LLMOptions } from "../src/ai/llmProvider";
import { mockLLM } from "../src/ai/mockProvider";

/** Scripts the model: `override` may answer a call (return a string / throw) or return undefined to fall back to the mock. */
export function scriptLLM(override: (system: string, user: string, opts: LLMOptions) => string | HandlerReply | undefined | Promise<string | HandlerReply | undefined>) {
  setLLMHandlerForTests(async (system, user, opts) => {
    const r = await override(system, user, opts);
    return r ?? mockLLM(system, user, opts);
  });
}

/** Creates an objective through the API and returns ids. */
export async function defineObjective(auth: Record<string, string>, body: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/objectives")
    .set(auth)
    .send({
      statement: "Analyze the European market for our liquid-cooling product and recommend the three highest-potential markets for expansion.",
      successCriteria: [{ description: "Recommend 3 markets, ranked" }],
      budgetCents: 3000,
      ...body,
    })
    .expect(201);
  return { objectiveId: res.body.objective.id as string, executionId: res.body.executionId as string };
}

export async function getExecution(auth: Record<string, string>, executionId: string) {
  return (await api().get(`/api/executions/${executionId}`).set(auth).expect(200)).body.execution;
}

export async function approvePending(auth: Record<string, string>) {
  const list = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
  for (const a of list) await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
  return list.length;
}

export async function balance(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { credits: true } })).credits;
}
