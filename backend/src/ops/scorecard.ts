// Operator tool: the quality scorecard (eval/scorecard.ts) for one deliverable. Read-only — it
// never writes to the database, calls a model, searches or fetches a page.
//
//   An Ensemblis execution (needs DATABASE_URL; reads the result, evidence, steps and verification):
//     npm run eval:scorecard -- --execution <executionId> --expect 20 [--tester-minutes 14 --baseline-minutes 120]
//   A baseline deliverable (a general-purpose assistant's answer or a manual pack, saved as Markdown):
//     npm run eval:scorecard -- --file answer.md --label "General-purpose AI" --expect 20
//
// Prints the scorecard as Markdown; --json prints the full measurements instead; --out <path> writes it.
// docs/growth/09-quality-scorecard.md explains every dimension and threshold.

import fs from "node:fs";
import { deriveResultState } from "../engine/resultState";
import { renderScorecard, scorecard, type ClaimVerdict, type ScorecardInput, type ScoreRun } from "../eval/scorecard";

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "true";
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

const num = (v: string | undefined) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const searchEndpoints = (research: unknown): unknown[] => {
  const attempts = research && typeof research === "object" ? (research as { attempts?: unknown }).attempts : null;
  return Array.isArray(attempts) ? attempts.map((a) => (a && typeof a === "object" ? (a as { endpoint?: unknown }).endpoint : null)) : [];
};
const providersOf = (research: unknown): string[] => {
  const r = research && typeof research === "object" ? (research as { providersUsed?: unknown; providers?: unknown }) : null;
  const list = r ? r.providersUsed ?? r.providers : null;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
};

async function fromExecution(id: string): Promise<Omit<ScorecardInput, "label" | "expectedProspects" | "testerMinutes" | "manualBaselineMinutes">> {
  const { prisma } = await import("../db");
  try {
    const ex = await prisma.execution.findUnique({
      where: { id },
      include: {
        objective: { select: { kind: true, budgetCents: true } },
        steps: { orderBy: { order: "asc" }, select: { title: true, kind: true, status: true, researchStatus: true, research: true, attempts: true, provider: true } },
        evidence: { orderBy: { n: "asc" }, select: { n: true, kind: true, url: true, title: true, provider: true } },
        verifications: { orderBy: { round: "desc" }, take: 1, include: { claims: { select: { status: true } } } },
      },
    });
    if (!ex) throw new Error(`No execution ${id}.`);
    const { state } = deriveResultState({ status: ex.status, verificationStatus: ex.verificationStatus, steps: ex.steps, objectiveKind: ex.objective.kind });
    const run: ScoreRun = {
      status: ex.status,
      resultState: state,
      verificationStatus: ex.verificationStatus,
      createdAt: ex.createdAt.toISOString(),
      startedAt: ex.startedAt?.toISOString() ?? null,
      completedAt: ex.completedAt?.toISOString() ?? null,
      creditsCharged: ex.costCents,
      creditsRefunded: ex.refundedCents,
      creditBudget: ex.objective.budgetCents,
      steps: ex.steps.map((s) => ({ title: s.title, status: s.status, researchStatus: s.researchStatus, providers: providersOf(s.research), attempts: s.attempts })),
      claims: (ex.verifications[0]?.claims ?? []).map((c) => c.status as ClaimVerdict),
      mockAI: ex.steps.some((s) => s.provider === "mock"),
      stubSearch: ex.steps.some((s) => searchEndpoints(s.research).includes("custom")),
    };
    return {
      markdown: ex.result ?? "",
      sources: ex.evidence.map((e) => ({ n: e.n, kind: e.kind, url: e.url, title: e.title, provider: e.provider })),
      run,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.execution && !a.file) {
    throw new Error("Usage: npm run eval:scorecard -- (--execution <id> | --file <deliverable.md> [--sources <sources.json>]) [--label <arm>] [--expect 20] [--tester-minutes N] [--baseline-minutes N] [--json] [--out <path>]");
  }
  const base = a.execution
    ? await fromExecution(a.execution)
    : { markdown: fs.readFileSync(a.file, "utf8"), sources: a.sources ? JSON.parse(fs.readFileSync(a.sources, "utf8")) : [], run: null };
  const card = scorecard({
    ...base,
    label: a.label && a.label !== "true" ? a.label : a.execution ? "Ensemblis" : a.file,
    expectedProspects: num(a.expect) ?? undefined,
    testerMinutes: num(a["tester-minutes"]),
    manualBaselineMinutes: num(a["baseline-minutes"]),
  });
  const text = a.json ? JSON.stringify(card, null, 2) : renderScorecard(card);
  if (a.out) {
    fs.writeFileSync(a.out, `${text}\n`);
    console.log(`Wrote ${a.out}`);
  } else console.log(text);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
