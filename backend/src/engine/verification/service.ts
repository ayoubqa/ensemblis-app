// Runs the verification gate for an execution's current result and persists
// it (Verification + ClaimCheck rows). The caller (engine/machine.ts) decides
// what a FAIL means: one automatic revision, then an exception for a person;
// and what an UNVERIFIED round means: one delayed re-verify, then an exception.
//
// Inputs beyond the result itself: the evidence (only web and Wikipedia
// sources are external evidence), what each step's web research did, and how
// many invented citations were removed from the final text. The verifier's
// provider/model and, when it could not run, the reason are stored with the
// round; so are each claim's type and best-matching evidence sentence.

import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { redact } from "../../lib/log";
import { getCapability } from "../../org/registry";
import { clip } from "../../research/text";
import { isExternalEvidence, loadEvidence } from "../evidence";
import { applyCriteriaRules } from "../outcome";
import { isResearchBrief } from "../prompts";
import { assessResult } from "./assessor";
import { checkClaimSupport } from "./claimCheck";
import { checkClaims, citationCheck, combineVerification, extractClaimsDetailed, VERIFIER_VERSION, type CombinedVerification, type ModelAssessment } from "./checks";

export interface VerificationRun extends CombinedVerification {
  verificationId: string;
  round: number;
  /** The model assessment as stored (after the research-brief criterion rules), or null. */
  model: ModelAssessment | null;
  method: "deterministic+model" | "deterministic";
  modelProvider: string | null;
  modelName: string | null;
  /** Why the AI assessment could not run (redacted), or null. */
  assessorError: string | null;
}

const RESEARCH_ISSUE: Record<string, string> = {
  failed: "failed, so no external sources were retrieved",
  no_results: "returned no usable sources",
  off: "did not run (web search is off on this server)",
};

/** One line per step whose web research failed, found nothing or did not run, and per skipped work step. */
export async function researchIssuesFor(executionId: string): Promise<string[]> {
  const steps = await prisma.executionStep.findMany({
    where: { executionId },
    orderBy: { order: "asc" },
    select: { title: true, kind: true, status: true, researchStatus: true, research: true },
  });
  const out: string[] = [];
  for (const s of steps) {
    if (s.status === "SKIPPED") {
      if (s.kind === "work") out.push(`“${s.title}” was skipped, so its work is missing from the result.`);
      continue;
    }
    const issue = s.researchStatus ? RESEARCH_ISSUE[s.researchStatus] : undefined;
    if (!issue) continue;
    const reason = s.research && typeof s.research === "object" ? (s.research as { reason?: unknown }).reason : null;
    out.push(`web research in “${s.title}” ${issue}${typeof reason === "string" && reason.trim() ? ` (${clip(redact(reason.trim()), 160)})` : ""}.`);
  }
  return out;
}

/** Invented citations removed from the current result: STEP_COMPLETED data of the latest synthesis or revision step. */
export async function citationsRemovedFor(executionId: string): Promise<number> {
  const steps = await prisma.executionStep.findMany({ where: { executionId, status: "COMPLETED" }, orderBy: { order: "desc" }, select: { id: true, capability: true } });
  const last = steps.find((s) => getCapability(s.capability)?.kind === "synthesis");
  if (!last) return 0;
  const event = await prisma.executionEvent.findFirst({ where: { executionId, stepId: last.id, type: "STEP_COMPLETED" }, orderBy: { id: "desc" }, select: { data: true } });
  const n = Number((event?.data as { citationsRemoved?: unknown } | null)?.citationsRemoved);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function verifyExecution(executionId: string): Promise<VerificationRun> {
  const ex = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
    include: { objective: { include: { criteria: { orderBy: { order: "asc" } } } } },
  });
  const report = ex.result ?? "";
  const objectiveKind = ex.objective.kind ?? null;
  const brief = isResearchBrief(objectiveKind);
  const evidence = await loadEvidence(executionId);
  const externalEvidenceCount = evidence.filter((e) => isExternalEvidence(e.kind)).length;

  // 1. Deterministic claim checks, then the model's downgrade-only support check.
  const extracted = extractClaimsDetailed(report, { brief });
  const notes: string[] = [];
  if (extracted.dropped) notes.push(`${extracted.dropped} more claim${extracted.dropped === 1 ? " was" : "s were"} not checked (the check covers the first ${extracted.claims.length}).`);
  let claimResults = checkClaims(
    extracted.claims,
    evidence.map((e) => ({ n: e.n, title: e.title, content: e.content, external: isExternalEvidence(e.kind) })),
    { brief }
  );
  if (report.trim()) {
    const support = await checkClaimSupport({ executionId, claims: claimResults, evidence });
    claimResults = support.results;
    if (support.warning) notes.push(support.warning);
  }

  // 2. What the research and the final step left behind.
  const [researchIssues, citationsRemoved] = await Promise.all([researchIssuesFor(executionId), citationsRemovedFor(executionId)]);

  // 3. The AI assessment (alignment, per-criterion verdicts with evidence refs, consistency).
  const criteria = ex.objective.criteria;
  const assessed = report.trim()
    ? await assessResult({
        executionId,
        objectiveTitle: ex.objective.title,
        statement: ex.objective.statement,
        criteria: criteria.map((c) => ({ description: c.description, targetValue: c.targetValue, unit: c.unit })),
        report,
        claimResults,
        evidence: evidence.map((e) => ({ n: e.n, kind: e.kind, title: e.title })),
      })
    : null;
  const descriptions = criteria.map((c) => c.description);
  const citation = citationCheck(claimResults, evidence.length, { brief, externalEvidenceCount });
  const supportEvidence = [
    ...new Set(claimResults.filter((c) => (c.status === "SUPPORTED" || c.status === "PARTIALLY_SUPPORTED") && !c.providedOnly).flatMap((c) => c.evidenceNs)),
  ];
  const model = applyCriteriaRules(assessed?.assessment ?? null, { objectiveKind, criteria: descriptions, citationSupport: citation.status, supportEvidence });
  const assessorError = assessed ? assessed.error : null;

  const combined = combineVerification({
    report,
    evidenceCount: evidence.length,
    claimResults,
    criteria: descriptions,
    model,
    objectiveKind,
    externalEvidenceCount,
    researchIssues,
    citationsRemoved,
    notes,
  });
  if (!model && assessorError) combined.warnings.push(`The AI verifier could not run: ${clip(assessorError, 240)}`);
  const method = model ? ("deterministic+model" as const) : ("deterministic" as const);
  const modelProvider = assessed?.provider ?? null;
  const modelName = assessed?.model ?? null;
  const round = (await prisma.verification.count({ where: { executionId } })) + 1;
  const v = await prisma.$transaction(async (tx) => {
    const row = await tx.verification.create({
      data: {
        executionId,
        round,
        status: combined.status,
        score: combined.score,
        checks: combined.checks as unknown as Prisma.InputJsonValue,
        summary: combined.summary,
        warnings: combined.warnings.slice(0, 20),
        humanJudgment: combined.humanJudgment.slice(0, 10),
        // Stored after the brief criterion rules (and with criteria[].evidence), so the API shows what was measured.
        assessment: (model ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        method,
        version: VERIFIER_VERSION,
        modelProvider,
        modelName,
        assessorError: assessorError ? clip(redact(assessorError), 1000) : null,
        claims: {
          create: claimResults.map((c, i) => ({
            order: i,
            claim: c.claim.slice(0, 2000),
            status: c.status,
            evidenceNs: c.evidenceNs,
            supportScore: c.supportScore,
            note: c.note.slice(0, 1000),
            claimType: c.claimType,
            quote: c.quote ? c.quote.slice(0, 1000) : null,
          })),
        },
      },
    });
    await tx.execution.update({ where: { id: executionId }, data: { verificationStatus: combined.status, verificationScore: combined.score } });
    return row;
  });
  return { ...combined, verificationId: v.id, round, model, method, modelProvider, modelName, assessorError };
}
