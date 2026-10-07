// Evidence: the information that supports an execution's outputs and claims.
// Numbered [n] per execution (1, 2, 3 … across all steps) so every step and
// the final result cite the same numbers, and the UI / exports / public share
// pages render them with the existing citation components.
//
// `content` keeps the bounded text agents read; the verifier checks claims
// against it. `excerpt` is what people see.

import type { Evidence, EvidenceKind, Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { PromptSource } from "../research/citations";
import { collapse, domainOf, normalizeUrl, truncateChars } from "../research/text";

export const EVIDENCE_CONTENT_CHARS = 2400;
const EXCERPT_CHARS = 500;

export interface EvidenceDraft {
  kind: EvidenceKind;
  title: string;
  url?: string | null;
  content: string;
  publishedAt?: string | null;
}

/**
 * Adds evidence to an execution, numbering it after what already exists.
 * A URL (or document title) already collected in this execution is reused,
 * not duplicated. Returns the rows in the order of `drafts`, deduplicated.
 */
export async function addEvidence(args: { executionId: string; orgId: string; stepId: string | null; drafts: EvidenceDraft[] }): Promise<Evidence[]> {
  if (!args.drafts.length) return [];
  return prisma.$transaction(async (tx) => {
    // Serialise numbering per execution (steps of one execution never run concurrently, but be safe).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"evidence:" + args.executionId}))`;
    const existing = await tx.evidence.findMany({ where: { executionId: args.executionId }, orderBy: { n: "asc" } });
    const keyOf = (kind: string, url: string | null | undefined, title: string) => (url ? `u:${normalizeUrl(url)}` : `t:${kind}:${title.toLowerCase()}`);
    const byKey = new Map(existing.map((e) => [keyOf(e.kind, e.url, e.title), e]));
    let next = existing.reduce((m, e) => Math.max(m, e.n), 0) + 1;
    const out: Evidence[] = [];
    for (const d of args.drafts) {
      const title = truncateChars(collapse(d.title) || "Untitled source", 200);
      const content = truncateChars(d.content.trim(), EVIDENCE_CONTENT_CHARS);
      if (!content) continue;
      const key = keyOf(d.kind, d.url, title);
      const found = byKey.get(key);
      if (found) {
        if (!out.includes(found)) out.push(found);
        continue;
      }
      const row = await tx.evidence.create({
        data: {
          orgId: args.orgId,
          executionId: args.executionId,
          stepId: args.stepId,
          n: next++,
          kind: d.kind,
          title,
          url: d.url ?? null,
          domain: domainOf(d.url),
          excerpt: truncateChars(collapse(content), EXCERPT_CHARS),
          content,
          publishedAt: d.publishedAt ?? null,
        },
      });
      byKey.set(key, row);
      out.push(row);
    }
    return out;
  });
}

export function loadEvidence(executionId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<Evidence[]> {
  return db.evidence.findMany({ where: { executionId }, orderBy: { n: "asc" } });
}

export function toPromptSources(evidence: Evidence[]): PromptSource[] {
  return evidence.map((e) => ({ n: e.n, kind: e.kind, title: e.title, domain: e.domain, url: e.url, content: e.content }));
}

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  WEB: "Web source",
  WIKIPEDIA: "Wikipedia",
  DOCUMENT: "Company document",
  COMPANY_CONTEXT: "Company context",
  WEBSITE: "Company website",
  CALCULATION: "Calculation",
  TOOL_OUTPUT: "Tool output",
  ARTIFACT: "Execution artifact",
};

/** The shape the report components already render ([n] citations). Upload/document text stays private on public pages. */
export function toPublicEvidence(e: Evidence, opts: { publicView?: boolean } = {}) {
  const privateKind = e.kind === "DOCUMENT" || e.kind === "COMPANY_CONTEXT";
  return {
    id: e.id,
    n: e.n,
    kind: e.kind,
    // Legacy TaskSource-compatible kind for the citation components.
    sourceKind: (e.kind === "WIKIPEDIA" ? "wikipedia" : e.kind === "WEB" || e.kind === "WEBSITE" ? "web" : "upload") as "web" | "wikipedia" | "upload",
    title: e.title,
    url: e.url,
    domain: e.domain,
    snippet: opts.publicView && privateKind ? "" : e.excerpt,
    publishedAt: e.publishedAt,
    stepId: e.stepId,
    createdAt: e.createdAt.toISOString(),
  };
}
