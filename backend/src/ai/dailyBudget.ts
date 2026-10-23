// Server-wide daily model-token budget (DAILY_TOKEN_BUDGET): the ceiling that
// makes the worst-case model bill for a day a known number, whatever the
// per-user, per-execution and per-plan caps multiply out to.
//
//   - New work (a plan, a new attempt, a scheduled routine) is refused while
//     today's tokens plus one execution's ceiling (MAX_TOKENS_PER_EXECUTION)
//     would pass the budget, so work that does start can normally finish.
//   - Every model call is refused once the budget itself is used up (hard
//     stop, checked before the provider is called). A running execution then
//     stops the way it does on a provider quota error: it waits for a person
//     (retry tomorrow, or cancel, which refunds the work that did not run).
//
// Tokens are counted from usage events (all calls, measured or estimated,
// failed ones included), read from the database at most every 30 seconds and
// kept current in memory in between. Several processes can each overshoot by
// the calls they make within that window.

import { prisma } from "../db";
import { config } from "../config";
import { DailyLimitError, resetsIn, startOfTodayUTC } from "../lib/usageLimits";

const REFRESH_MS = 30_000;
let used: { day: number; tokens: number; readAt: number } | null = null;

/** Tests only. */
export function resetDailyBudgetForTests(): void {
  used = null;
}

/** Model tokens used today across the server (cached; see above). */
export async function tokensUsedToday(now = Date.now()): Promise<number> {
  const day = startOfTodayUTC(new Date(now)).getTime();
  if (used && used.day === day && now - used.readAt < REFRESH_MS) return used.tokens;
  const agg = await prisma.usageEvent.aggregate({ where: { kind: "llm", createdAt: { gte: new Date(day) } }, _sum: { tokensIn: true, tokensOut: true } });
  used = { day, tokens: (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0), readAt: now };
  return used.tokens;
}

/** Adds a just-finished call (its usage row is written asynchronously). */
export function noteTokensUsed(tokens: number, now = Date.now()): void {
  if (!used || used.day !== startOfTodayUTC(new Date(now)).getTime() || !(tokens > 0)) return;
  used.tokens += tokens;
}

export const DAILY_BUDGET_MESSAGE =
  "Ensemblis has used today's AI processing quota for this server, so no new AI work can run until it resets at midnight UTC";

/** 429 for new work when the rest of today's budget can't cover one more execution. */
export async function assertDailyTokenBudgetForNewWork(): Promise<void> {
  const budget = config.dailyTokenBudget;
  if (!budget) return;
  const usedNow = await tokensUsedToday();
  const reserve = Math.min(config.maxTokensPerExecution || 0, budget);
  if (usedNow + reserve > budget) {
    throw new DailyLimitError("global", `${DAILY_BUDGET_MESSAGE} (in ${resetsIn()}). Your work and credits are kept; please try again then.`);
  }
}

/**
 * Why a model call must not run now (the budget is used up), or null. The text says "quota", so the engine
 * treats it like a provider quota error: not retried in a loop, handed to a person.
 */
export async function dailyTokenBudgetExhausted(): Promise<string | null> {
  const budget = config.dailyTokenBudget;
  if (!budget) return null;
  return (await tokensUsedToday()) >= budget ? `${DAILY_BUDGET_MESSAGE} (in ${resetsIn()}).` : null;
}
