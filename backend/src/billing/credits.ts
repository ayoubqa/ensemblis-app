// Ensemblis credits: the customer-facing unit for balances, budgets, estimates,
// charges and refunds.
//
// Storage: every wallet and price integer (User.credits and the historical
// "*Cents" columns: Transaction.amountCents, Execution.costCents, budgetCents…)
// IS a number of credits. Before credits existed these integers were shown as
// euro cents of demo/credit value, so at CREDITS_PER_EUR = 100 the conversion is
// exact (1 stored unit = 1 credit = €0.01 of credit value) and no balance is
// rewritten. CREDITS_PER_EUR only values credits for internal accounting and
// pricing; it is not a token count, and real-money prices (credit packs) stay
// in euros.

import { config } from "../config";

/** 1150 -> "1,150 credits", 1 -> "1 credit", -50 -> "−50 credits". */
export function formatCredits(n: number): string {
  const v = Math.round(Number(n) || 0);
  const abs = Math.abs(v).toLocaleString("en-US");
  return `${v < 0 ? "−" : ""}${abs} ${Math.abs(v) === 1 ? "credit" : "credits"}`;
}

/** Internal euro value of `credits`, in euro cents (fractional when CREDITS_PER_EUR isn't a divisor of 100). Never shown to customers. */
export function creditValueEurCents(credits: number): number {
  return (credits * 100) / config.creditsPerEur;
}

/**
 * ValueRecord.unit for amounts of credits (metric "execution_cost").
 * Rows written before the credits release say "eur_cents": the integer is the
 * same (credits were issued 1:1 with euro cents), so readers treat both units
 * as credits and no stored row is rewritten.
 */
export const CREDITS_UNIT = "credits";
export const LEGACY_CREDITS_UNITS: readonly string[] = ["eur_cents"];

/** Machine-readable reason on every ledger row (Transaction.reason). */
export const LEDGER_REASONS = {
  execution_charge: "Execution charged at its planned estimate",
  step_skipped: "Refund for a step that was skipped",
  execution_failed: "Refund of an execution that failed",
  execution_cancelled: "Refund for work that didn't run",
  verification_unavailable: "Verification fee refunded: the result could not be verified",
  legacy_task_charge: "Report charge (earlier version)",
  legacy_task_refund: "Report refund (earlier version)",
  demo_top_up: "Demo credits added (no real money)",
  stripe_purchase: "Credit pack purchased",
  signup_grant: "Starting credits for a new account",
  guest_trial_grant: "Trial credits for a guest account",
  opening_balance: "Opening balance carried over when the credit ledger was introduced",
} as const;
export type LedgerReason = keyof typeof LEDGER_REASONS;

/** The backend's former euro format: `€${(cents / 100).toFixed(2)}` — no thousands separator, always 2 decimals. */
const LEGACY_EUR = /€(\d+)\.(\d{2})(?!\d)/g;

/**
 * Rewrites euro amounts in SYSTEM-GENERATED text stored before credits existed
 * ("€11.50 charged …") as credits ("1,150 credits charged …"). Exact: the
 * integer is the same one the ledger holds. Only for text this server wrote;
 * never for user or model text.
 */
export function legacyEurToCredits(text: string): string {
  return text.replace(LEGACY_EUR, (_m, euros: string, cents: string) => formatCredits(Number(euros) * 100 + Number(cents)));
}

/**
 * Same, but only before the first opening quote “ — the part this server wrote
 * in messages like `€11.50 refunded for “<step title>”` or
 * `Approve €11.50 for “<objective title>”`. The quoted user text is untouched.
 */
export function legacyEurToCreditsBeforeQuote(text: string): string {
  const i = text.indexOf("“");
  if (i < 0) return legacyEurToCredits(text);
  return legacyEurToCredits(text.slice(0, i)) + text.slice(i);
}
