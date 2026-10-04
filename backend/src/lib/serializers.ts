// The single place that turns database rows into the JSON shapes defined in
// frontend/lib/api.ts. Every route goes through these so responses are
// consistent field-for-field (dates as ISO strings, money as integer cents).
// Secrets (passwordHash, systemPrompt) never leave the server.

import type { Agent, Task, TaskStep, Transaction, User, Workflow } from "@prisma/client";
import { slugify } from "../catalog/agents";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type Depth = "focused" | "standard" | "deep";
export const DEPTHS = ["focused", "standard", "deep"] as const;
export const asDepth = (d: string | null | undefined): Depth =>
  (DEPTHS as readonly string[]).includes(d ?? "") ? (d as Depth) : "standard";

export function toPublicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    company: u.company ?? null,
    role: u.role ?? null,
    accountType: u.accountType,
    builds: u.builds ?? null,
    credits: u.credits,
    createdAt: u.createdAt.toISOString(),
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export function toPublicAgent(a: Agent) {
  return {
    id: a.id,
    slug: a.slug || slugify(a.name),
    name: a.name,
    category: a.category,
    creator: a.creator,
    description: a.description,
    capabilities: a.capabilities ?? [],
    specialty: a.specialty,
    taskType: a.taskType,
    outputType: a.outputType,
    pricePerTaskCents: a.pricePerTaskCents,
    priceFromCents: a.priceFromCents,
    estMinutesLow: a.estMinutesLow,
    estMinutesHigh: a.estMinutesHigh,
    avgRunSeconds: a.avgRunSeconds,
    successRate: a.successRate,
    rating: a.rating,
    reputation: a.reputation,
    tasksCompleted: a.tasksCompleted,
    verified: a.verified,
    hue: a.hue,
    isLive: a.isLive,
    ownerId: a.ownerId,
    createdAt: a.createdAt.toISOString(),
  };
}
export type PublicAgent = ReturnType<typeof toPublicAgent>;

export function toPublicStep(s: TaskStep) {
  return {
    id: s.id,
    order: s.order,
    agentId: s.agentId,
    agentName: s.agentName,
    role: s.role,
    title: s.title,
    status: s.status,
    output: s.output,
    startedAt: iso(s.startedAt),
    completedAt: iso(s.completedAt),
  };
}

export type TaskWithRelations = Task & { agent: Agent | null; steps: TaskStep[] };

/** Prisma `include` that every task read must use so toPublicTask has what it needs. */
export const TASK_INCLUDE = {
  agent: true,
  steps: { orderBy: { order: "asc" as const } },
};

export function toPublicTask(t: TaskWithRelations) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    depth: asDepth(t.depth),
    status: t.status,
    costCents: t.costCents,
    result: t.result,
    errorMessage: t.errorMessage,
    outcome: (t.outcome as "Achieved" | "Partially" | "Not achieved" | null) ?? null,
    createdAt: t.createdAt.toISOString(),
    startedAt: iso(t.startedAt),
    completedAt: iso(t.completedAt),
    agentId: t.agentId,
    agent: t.agent ? toPublicAgent(t.agent) : null,
    steps: [...t.steps].sort((a, b) => a.order - b.order).map(toPublicStep),
  };
}

export function toPublicWorkflow(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    basedOnText: w.basedOnText,
    frequency: w.frequency as "Weekly" | "Monthly" | "Quarterly",
    depth: asDepth(w.depth),
    agentId: w.agentId,
    isActive: w.isActive,
    nextRun: iso(w.nextRun),
    lastRun: iso(w.lastRun),
    runCount: w.runCount,
    createdAt: w.createdAt.toISOString(),
  };
}

export function toPublicTransaction(t: Transaction) {
  return {
    id: t.id,
    type: t.type,
    amountCents: t.amountCents,
    description: t.description,
    taskId: t.taskId,
    createdAt: t.createdAt.toISOString(),
  };
}
