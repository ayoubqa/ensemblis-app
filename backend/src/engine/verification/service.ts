// Runs the verification gate for an execution's current result and persists
// it (Verification + ClaimCheck rows). The caller (engine/machine.ts) decides
// what a FAIL means: one automatic revision, then an exception for a person.

import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { loadEvidence } from "../evidence";
import { assessResult } from "./assessor";
import { checkClaims, combineVerification, extractClaims, VERIFIER_VERSION, type CombinedVerification, type ModelAssessment } from "./checks";

export interface VerificationRun extends CombinedVerification {
  verificationId: string;
  round: number;
  model: ModelAssessment | null;
}

export async function verifyExecution(executionId: string): Promise<VerificationRun> {
  const ex = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
    include: { objective: { include: { criteria: { orderBy: { order: "asc" } } } } },
  });
  const report = ex.result ?? "";
  const evidence = await loadEvidence(executionId);
  const claimResults = checkClaims(extractClaims(report), evidence);
  const criteria = ex.objective.criteria;
  const model = report.trim()
    ? await assessResult({
        executionId,
        objectiveTitle: ex.objective.title,
        statement: ex.objective.statement,
        criteria: criteria.map((c) => ({ description: c.description, targetValue: c.targetValue, unit: c.unit })),
        report,
        claimResults,
      })
    : null;
  const combined = combineVerification({
    report,
    evidenceCount: evidence.length,
    claimResults,
    criteria: criteria.map((c) => c.description),
    model,
  });
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
        assessment: (model ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        method: model ? "deterministic+model" : "deterministic",
        version: VERIFIER_VERSION,
        claims: {
          create: claimResults.map((c, i) => ({
            order: i,
            claim: c.claim.slice(0, 2000),
            status: c.status,
            evidenceNs: c.evidenceNs,
            supportScore: c.supportScore,
            note: c.note,
          })),
        },
      },
    });
    await tx.execution.update({ where: { id: executionId }, data: { verificationStatus: combined.status, verificationScore: combined.score } });
    return row;
  });
  return { ...combined, verificationId: v.id, round, model };
}
