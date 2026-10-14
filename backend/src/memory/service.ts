// Business memory: what Ensemblis learns from operations (preferences,
// decisions, lessons, constraints) — distinct from Company Context, which is
// stable information the organization enters.
//
// Controls:
//   - only ACTIVE memories are ever given to agents;
//   - learned memories go through assessMemory(): low-risk preferences/lessons
//     become ACTIVE, everything consequential, ambiguous or sensitive waits
//     for a person (PENDING_CONFIRMATION);
//   - people can review, edit, confirm, archive and delete every item;
//   - bounded: at most MAX_PER_EXECUTION learned per execution, MAX_ACTIVE per org.

import type { MemoryItem, MemoryKind, MemoryStatus } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { terms } from "../context/retrieval";
import { assessMemory } from "./sensitivity";

export const MAX_PER_EXECUTION = 3;
export const MAX_ACTIVE = 200;
export const MEMORY_KINDS: MemoryKind[] = ["PREFERENCE", "DECISION", "LESSON", "CONSTRAINT", "FACT"];

export function toPublicMemory(m: MemoryItem) {
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    content: m.content,
    rationale: m.rationale,
    sensitive: m.sensitive,
    source: m.source as "execution" | "user",
    sourceExecutionId: m.sourceExecutionId,
    confirmedAt: m.confirmedAt?.toISOString() ?? null,
    lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listMemories(orgId: string, status?: MemoryStatus) {
  return prisma.memoryItem.findMany({
    where: { orgId, ...(status ? { status } : { status: { not: "ARCHIVED" } }) },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
}

async function ownMemory(orgId: string, id: string) {
  const m = await prisma.memoryItem.findFirst({ where: { id, orgId } });
  if (!m) throw new HttpError(404, "Memory not found");
  return m;
}

/** A memory a person wrote is confirmed by definition. */
export async function createMemory(orgId: string, userId: string, input: { kind: MemoryKind; content: string }) {
  const active = await prisma.memoryItem.count({ where: { orgId, status: "ACTIVE" } });
  if (active >= MAX_ACTIVE) throw new HttpError(409, `Your organization can keep ${MAX_ACTIVE} active memories. Archive some first.`);
  const sensitive = assessMemory(input.kind, input.content).sensitive;
  return prisma.memoryItem.create({
    data: {
      orgId,
      kind: input.kind,
      status: "ACTIVE",
      content: input.content,
      sensitive,
      source: "user",
      createdById: userId,
      confirmedById: userId,
      confirmedAt: new Date(),
    },
  });
}

export async function updateMemory(orgId: string, userId: string, id: string, patch: { content?: string; kind?: MemoryKind; status?: MemoryStatus }) {
  const m = await ownMemory(orgId, id);
  const confirming = patch.status === "ACTIVE" && m.status !== "ACTIVE";
  return prisma.memoryItem.update({
    where: { id: m.id },
    data: {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(confirming ? { confirmedById: userId, confirmedAt: new Date() } : {}),
    },
  });
}

export async function deleteMemory(orgId: string, id: string) {
  const removed = await prisma.memoryItem.deleteMany({ where: { id, orgId } });
  if (removed.count === 0) throw new HttpError(404, "Memory not found");
}

/** ACTIVE memories most relevant to `query` (all of them when there are few). Marks them used. */
export async function relevantMemories(orgId: string, query: string, k = 6): Promise<MemoryItem[]> {
  const all = await prisma.memoryItem.findMany({ where: { orgId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: MAX_ACTIVE });
  if (!all.length) return [];
  const q = new Set(terms(query));
  const ranked = all
    .map((m) => {
      const t = terms(m.content);
      const overlap = t.filter((w) => q.has(w)).length;
      // Preferences and constraints apply broadly: keep them in the running even without overlap.
      const base = m.kind === "PREFERENCE" || m.kind === "CONSTRAINT" ? 0.5 : 0;
      return { m, s: overlap + base };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m);
  if (ranked.length) {
    await prisma.memoryItem.updateMany({ where: { id: { in: ranked.map((m) => m.id) } }, data: { lastUsedAt: new Date() } });
  }
  return ranked;
}

const norm = (s: string) => terms(s).sort().join(" ");

function similar(a: string, b: string): boolean {
  const A = new Set(terms(a));
  const B = new Set(terms(b));
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.7 || norm(a) === norm(b);
}

export interface ProposedMemory {
  kind: MemoryKind;
  content: string;
  rationale: string;
  sensitive: boolean;
}

/** Stores learned memories (after de-duplication and the sensitivity gate). Returns what was stored. */
export async function recordLearnedMemories(orgId: string, executionId: string, proposals: ProposedMemory[]): Promise<MemoryItem[]> {
  const existing = await prisma.memoryItem.findMany({ where: { orgId, status: { not: "ARCHIVED" } }, select: { content: true } });
  const activeCount = await prisma.memoryItem.count({ where: { orgId, status: "ACTIVE" } });
  const stored: MemoryItem[] = [];
  for (const p of proposals.slice(0, MAX_PER_EXECUTION)) {
    const content = p.content.trim().replace(/\s+/g, " ").slice(0, 600);
    if (content.length < 12) continue;
    if (existing.some((e) => similar(e.content, content)) || stored.some((s) => similar(s.content, content))) continue;
    const a = assessMemory(p.kind, content, p.sensitive);
    const status: MemoryStatus = a.status === "ACTIVE" && activeCount + stored.length >= MAX_ACTIVE ? "PENDING_CONFIRMATION" : a.status;
    stored.push(
      await prisma.memoryItem.create({
        data: {
          orgId,
          kind: p.kind,
          status,
          content,
          rationale: [p.rationale.trim().slice(0, 300), ...(status === "PENDING_CONFIRMATION" ? [`Needs confirmation: ${a.reasons.join("; ")}`] : [])]
            .filter(Boolean)
            .join(" — "),
          sensitive: a.sensitive,
          source: "execution",
          sourceExecutionId: executionId,
        },
      })
    );
  }
  return stored;
}
