// The single place that turns database rows into the JSON shapes defined in
// frontend/lib/api.ts. Every route goes through these so responses are
// consistent field-for-field (dates as ISO strings, money as integer cents).
// Secrets (passwordHash, systemPrompt, attachment text, IP hashes) never leave
// the server.

import type {
  Agent,
  GalleryItem,
  Prisma,
  PrismaClient,
  TaskRevision,
  TaskSource,
  TaskStep,
  Transaction,
  User,
  Workflow,
} from "@prisma/client";
import { slugify } from "./slug";
import { isAdminEmail } from "../config";
import { prisma } from "../db";
import { HttpError } from "./http";
import { spendableBalance } from "./wallet";

type Db = PrismaClient | Prisma.TransactionClient;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type Depth = "focused" | "standard" | "deep";
export const DEPTHS = ["focused", "standard", "deep"] as const;
export const asDepth = (d: string | null | undefined): Depth =>
  (DEPTHS as readonly string[]).includes(d ?? "") ? (d as Depth) : "standard";

/** Base fields only. Routes must respond with `loadPublicUser` (full v3 shape). */
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

/**
 * Loads a user and returns the full public v3 shape (frontend `User`): team,
 * spendable balance (the team wallet when in a team), isAdmin, isGuest.
 * Every route that responds with `{ user }` uses this.
 * Throws 401 when the account no longer exists (e.g. an expired guest trial),
 * so the frontend drops the stale session.
 */
export async function loadPublicUser(userId: string, db: Db = prisma) {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: { teamMembership: { include: { team: { select: { id: true, name: true } } } } },
  });
  if (!u) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  const wallet = await spendableBalance(userId, db);
  const m = u.teamMembership;
  return {
    ...toPublicUser(u),
    credits: wallet.credits,
    isGuest: u.isGuest,
    // Admin needs BOTH an ADMIN_EMAILS match and a verified address: without
    // verification anyone could sign up with an admin's (unregistered) email.
    isAdmin: !u.isGuest && !!u.emailVerifiedAt && isAdminEmail(u.email),
    emailVerified: !!u.emailVerifiedAt,
    emailOnTaskDone: u.emailOnTaskDone,
    team: m ? { id: m.team.id, name: m.team.name, role: m.role } : null,
    walletOwner: wallet.walletOwner,
  };
}
export type PublicUser = Awaited<ReturnType<typeof loadPublicUser>>;

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
    liveOutput: null as string | null, // legacy field; live output now lives on execution steps
  };
}

export type SourceKind = "web" | "wikipedia" | "link" | "upload";
const SOURCE_KINDS: readonly string[] = ["web", "wikipedia", "link", "upload"];
const asSourceKind = (k: string): SourceKind => (SOURCE_KINDS.includes(k) ? (k as SourceKind) : "web");

export interface PublicSource {
  n: number;
  kind: SourceKind;
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
}

export function toPublicSource(s: Pick<TaskSource, "n" | "kind" | "title" | "url" | "domain" | "snippet" | "publishedAt">): PublicSource {
  return {
    n: s.n,
    kind: asSourceKind(s.kind),
    title: s.title,
    url: s.url ?? null,
    domain: s.domain ?? null,
    snippet: s.snippet,
    publishedAt: s.publishedAt ?? null,
  };
}

/**
 * A source as shown to the PUBLIC (shared /r/<token> links, gallery): the
 * snippet of a client's uploaded file is its private extracted text, so it is
 * dropped (the source stays listed so [n] citations still resolve).
 */
export function toSharedSource(s: Pick<TaskSource, "n" | "kind" | "title" | "url" | "domain" | "snippet" | "publishedAt">): PublicSource {
  const p = toPublicSource(s);
  return p.kind === "upload" ? { ...p, snippet: "" } : p;
}

/** Parses a GalleryItem.sources JSON column defensively (never throws). Public: upload snippets are dropped. */
export function sourcesFromJson(value: Prisma.JsonValue): PublicSource[] {
  if (!Array.isArray(value)) return [];
  const out: PublicSource[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.n !== "number" || typeof r.title !== "string") continue;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const kind = asSourceKind(typeof r.kind === "string" ? r.kind : "web");
    out.push({
      n: r.n,
      kind,
      title: r.title,
      url: str(r.url),
      domain: str(r.domain),
      snippet: kind === "upload" ? "" : str(r.snippet) ?? "",
      publishedAt: str(r.publishedAt),
    });
  }
  return out.sort((a, b) => a.n - b.n);
}

export type AttachmentKind = "pdf" | "csv" | "xlsx" | "docx" | "txt" | "md" | "url";

/** Attachment metadata — the extracted text is never sent back. */
export function toPublicAttachment(a: { id: string; kind: string; name: string; url: string | null; charCount: number; createdAt: Date }) {
  return {
    id: a.id,
    kind: a.kind as AttachmentKind,
    name: a.name,
    url: a.url ?? null,
    charCount: a.charCount,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toPublicRevision(r: TaskRevision) {
  return {
    id: r.id,
    version: r.version,
    instruction: r.instruction,
    status: r.status,
    result: r.result,
    costCents: r.costCents,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    completedAt: iso(r.completedAt),
  };
}

/** Prisma `include` that every task read must use so toPublicTask has what it needs. */
export const TASK_INCLUDE = {
  agent: true,
  steps: { orderBy: { order: "asc" } },
  sources: { orderBy: { n: "asc" } },
  // Never load the (large, private) extracted text.
  attachments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, name: true, url: true, charCount: true, createdAt: true },
  },
  revisions: { orderBy: { version: "asc" } },
  user: { select: { id: true, name: true } },
} as const satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

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
    // v3
    sources: [...t.sources].sort((a, b) => a.n - b.n).map(toPublicSource),
    attachments: t.attachments.map(toPublicAttachment),
    revisions: [...t.revisions].sort((a, b) => a.version - b.version).map(toPublicRevision),
    shareToken: t.shareToken,
    isTest: t.isTest,
    teamId: t.teamId,
    createdBy: { id: t.user.id, name: t.user.name },
  };
}
export type PublicTask = ReturnType<typeof toPublicTask>;

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
    // v4: recurring objective settings
    successCriteria: w.successCriteria,
    budgetCents: w.budgetCents,
    autonomy: w.autonomy,
    lastObjectiveId: w.lastObjectiveId,
  };
}

/** Prisma `include` for transactions so `actor` can be serialized. */
export const TRANSACTION_INCLUDE = { actor: { select: { id: true, name: true } } } as const satisfies Prisma.TransactionInclude;

export function toPublicTransaction(t: Transaction & { actor?: { id: string; name: string } | null }) {
  return {
    id: t.id,
    type: t.type,
    amountCents: t.amountCents,
    description: t.description,
    taskId: t.taskId,
    executionId: t.executionId,
    createdAt: t.createdAt.toISOString(),
    actor: t.actor ? { id: t.actor.id, name: t.actor.name } : null,
  };
}

/** Gallery card / detail. `content` only when `withContent` (detail endpoint). */
export function toPublicGalleryItem(g: GalleryItem, withContent: boolean) {
  return {
    slug: g.slug,
    title: g.title,
    category: g.category,
    summary: g.summary,
    agentName: g.agentName,
    depth: asDepth(g.depth),
    isExample: g.isExample,
    sources: sourcesFromJson(g.sources),
    ...(withContent ? { content: g.content } : {}),
    createdAt: g.createdAt.toISOString(),
  };
}

/** Prisma `select` for gallery lists (skips the large `content` column). */
export const GALLERY_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  category: true,
  summary: true,
  agentName: true,
  depth: true,
  isExample: true,
  sources: true,
  taskId: true,
  position: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.GalleryItemSelect;

export function toPublicGalleryListItem(g: Prisma.GalleryItemGetPayload<{ select: typeof GALLERY_LIST_SELECT }>) {
  return toPublicGalleryItem({ ...g, content: "" }, false);
}
