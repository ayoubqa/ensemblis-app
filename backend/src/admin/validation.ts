// Market-validation metrics for the owner dashboard (operators only).
//
// Derived from the records the product already keeps (accounts, objectives,
// executions, steps, exceptions, the credit ledger, usage events, value
// records): no tracking pixels, no new event stream, and no prompt or result
// text. The only free text returned is what customers typed into the feedback
// box for us. Operator accounts (ADMIN_EMAILS) are left out, so test runs
// don't count as customer usage.
//
//   activation  people who signed up in the period → defined an objective
//               → ran an execution → got a completed result → got a verified
//               result → came back (executions on two or more days)
//   usage       executions in the period by end state, result state, outcome
//               (the AI's measurement and a person's confirmation), credits
//               consumed and variable cost, failures by kind
//   repeat      accounts active in the period that ran on several days, and
//               returning accounts (they had run before the period)
//   feedback    "was this useful?" answers on results (ValueRecord metric
//               feedback_useful) and the latest comments

import { prisma } from "../db";
import { config } from "../config";
import { billable, costRowsWhere, summarizeCosts } from "../billing/economics";
import { deriveResultState, RESULT_STATES, type ResultState } from "../engine/resultState";
import { FEEDBACK_METRIC } from "../engine/serialize";

const MAX_EXECUTIONS = 5000;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Organizations owned by operator accounts (ADMIN_EMAILS): excluded from every figure. */
async function operatorOrgIds(): Promise<string[]> {
  if (!config.adminEmails.length) return [];
  const orgs = await prisma.organization.findMany({ where: { owner: { email: { in: config.adminEmails } } }, select: { id: true } });
  return orgs.map((o) => o.id);
}

export async function validationMetrics(days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const excluded = await operatorOrgIds();
  const notOperator = excluded.length ? { notIn: excluded } : undefined;

  // ---------------------------------------------------------------- activation (signup cohort)
  // People who signed up in the period (not guests, not operators); their activity is what they started
  // themselves (objectives they created, and those objectives' executions), so team members count too.
  const cohort = await prisma.user.findMany({
    where: { createdAt: { gte: since }, isGuest: false, ...(config.adminEmails.length ? { email: { notIn: config.adminEmails } } : {}) },
    select: { id: true, createdAt: true },
  });
  const cohortIds = cohort.map((u) => u.id);
  const [cohortObjectives, cohortExecutions] = cohortIds.length
    ? await Promise.all([
        prisma.objective.groupBy({ by: ["createdById"], where: { createdById: { in: cohortIds } }, _count: { _all: true } }),
        prisma.execution.findMany({
          where: { objective: { createdById: { in: cohortIds } } },
          select: {
            status: true,
            verificationStatus: true,
            createdAt: true,
            completedAt: true,
            objective: { select: { kind: true, createdById: true } },
            steps: { select: { kind: true, status: true, researchStatus: true, title: true } },
          },
          take: MAX_EXECUTIONS,
        }),
      ])
    : [[], []];
  const created = new Map(cohort.map((u) => [u.id, u.createdAt]));
  const ran = new Set<string>();
  const completed = new Set<string>();
  const verified = new Set<string>();
  const runDays = new Map<string, Set<string>>();
  const firstResult = new Map<string, number>();
  for (const e of cohortExecutions) {
    const who = e.objective.createdById;
    if (!who) continue;
    ran.add(who);
    runDays.set(who, (runDays.get(who) ?? new Set()).add(dayOf(e.createdAt)));
    if (e.status !== "COMPLETED") continue;
    completed.add(who);
    const state = deriveResultState({ status: e.status, verificationStatus: e.verificationStatus, steps: e.steps, objectiveKind: e.objective.kind }).state;
    if (state === "verified" || state === "verified_with_warnings") verified.add(who);
    const at = e.completedAt?.getTime();
    if (at != null) firstResult.set(who, Math.min(firstResult.get(who) ?? Infinity, at));
  }
  const hoursToFirstResult = [...firstResult].map(([who, at]) => (at - (created.get(who)?.getTime() ?? at)) / 3600_000);
  const signups = cohort.length;
  const cameBack = [...runDays.values()].filter((d) => d.size >= 2).length;
  const medianHours = median(hoursToFirstResult);
  const activation = {
    signups,
    definedObjective: cohortObjectives.length,
    ranExecution: ran.size,
    completedResult: completed.size,
    verifiedResult: verified.size,
    cameBack,
    rates: {
      definedObjective: rate(cohortObjectives.length, signups),
      completedResult: rate(completed.size, signups),
      verifiedResult: rate(verified.size, signups),
      cameBack: rate(cameBack, signups),
    },
    medianHoursToFirstResult: medianHours == null ? null : Math.round(medianHours * 10) / 10,
  };
  const guests = await prisma.user.count({ where: { isGuest: true, createdAt: { gte: since } } });

  // ---------------------------------------------------------------- usage in the period
  const executions = await prisma.execution.findMany({
    where: { createdAt: { gte: since }, ...(notOperator ? { orgId: notOperator } : {}) },
    select: {
      id: true,
      orgId: true,
      status: true,
      verificationStatus: true,
      outcomeStatus: true,
      confirmedOutcomeStatus: true,
      costCents: true,
      refundedCents: true,
      createdAt: true,
      objective: { select: { kind: true } },
      steps: { select: { kind: true, status: true, researchStatus: true, title: true } },
    },
    take: MAX_EXECUTIONS,
  });
  const ids = executions.map((e) => e.id);
  const byStatus = (s: string) => executions.filter((e) => e.status === s).length;
  const resultStates = Object.fromEntries(RESULT_STATES.map((s) => [s, 0])) as Record<ResultState, number>;
  for (const e of executions) resultStates[deriveResultState({ status: e.status, verificationStatus: e.verificationStatus, steps: e.steps, objectiveKind: e.objective?.kind }).state]++;
  const done = executions.filter((e) => e.status === "COMPLETED");
  const confirmed = done.filter((e) => e.confirmedOutcomeStatus);
  const count = <T extends string>(xs: (T | null)[], keys: readonly T[]) => Object.fromEntries(keys.map((k) => [k, xs.filter((x) => x === k).length])) as Record<T, number>;
  const OUTCOMES = ["ACHIEVED", "PARTIALLY_ACHIEVED", "NOT_ACHIEVED", "UNKNOWN"] as const;
  const net = executions.reduce((n, e) => n + Math.max(0, e.costCents - e.refundedCents), 0);
  const cost = summarizeCosts(ids.length ? billable(await costRowsWhere({ executionId: { in: ids } })) : []);
  const [exceptions, stepFailures] = ids.length
    ? await Promise.all([
        prisma.exception.groupBy({ by: ["kind"], where: { executionId: { in: ids } }, _count: { _all: true } }),
        prisma.executionStep.count({ where: { executionId: { in: ids }, status: "FAILED" } }),
      ])
    : [[], 0];

  // ---------------------------------------------------------------- repeat usage
  const activeOrgs = new Map<string, Set<string>>();
  for (const e of executions) activeOrgs.set(e.orgId, (activeOrgs.get(e.orgId) ?? new Set()).add(dayOf(e.createdAt)));
  const returning = activeOrgs.size
    ? await prisma.execution.groupBy({ by: ["orgId"], where: { orgId: { in: [...activeOrgs.keys()] }, createdAt: { lt: since } } })
    : [];

  // ---------------------------------------------------------------- feedback
  const feedback = await prisma.valueRecord.findMany({
    where: { metric: FEEDBACK_METRIC, createdAt: { gte: since }, ...(notOperator ? { orgId: notOperator } : {}) },
    select: { value: true, note: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const useful = feedback.filter((f) => f.value >= 1).length;

  return {
    days,
    since: since.toISOString(),
    excludedOperatorAccounts: excluded.length,
    activation,
    guestTrials: guests,
    executions: {
      started: executions.length,
      completed: done.length,
      failed: byStatus("FAILED"),
      cancelled: byStatus("CANCELLED"),
      blocked: byStatus("BLOCKED"),
      inProgress: executions.length - done.length - byStatus("FAILED") - byStatus("CANCELLED") - byStatus("BLOCKED"),
      completionRate: rate(done.length, executions.length),
    },
    resultStates,
    outcomes: {
      measured: count(done.map((e) => e.outcomeStatus), OUTCOMES),
      confirmedByPerson: confirmed.length,
      confirmed: count(confirmed.map((e) => e.confirmedOutcomeStatus), OUTCOMES),
      /** Share of confirmations that agree with the AI's measurement. */
      agreementRate: rate(confirmed.filter((e) => e.confirmedOutcomeStatus === e.outcomeStatus).length, confirmed.length),
    },
    credits: { consumedNet: net, perCompletedExecution: done.length ? Math.round(net / done.length) : null },
    variableCost: { eurMicros: cost.eurMicros, complete: cost.complete, perCompletedExecutionEurMicros: done.length && cost.complete ? Math.round(cost.eurMicros / done.length) : null },
    failures: {
      executionsFailed: byStatus("FAILED"),
      stepFailures,
      exceptionsByKind: Object.fromEntries(exceptions.map((x) => [x.kind, x._count._all])),
    },
    repeat: {
      activeAccounts: activeOrgs.size,
      ranOnSeveralDays: [...activeOrgs.values()].filter((d) => d.size >= 2).length,
      returningAccounts: returning.length,
    },
    feedback: {
      responses: feedback.length,
      useful,
      notUseful: feedback.length - useful,
      usefulRate: rate(useful, feedback.length),
      /** Latest comments customers wrote for us (no objective or result text). */
      recentComments: feedback.filter((f) => f.note.trim()).slice(0, 10).map((f) => ({ at: f.createdAt.toISOString(), useful: f.value >= 1, comment: f.note.slice(0, 500) })),
    },
  };
}
