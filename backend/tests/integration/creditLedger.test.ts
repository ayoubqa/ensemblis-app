// The credit ledger: legacy balances, grants, reconciliation, duplicate and
// concurrent spending, refunds, partial work, insufficient credits, the token
// ceiling, and read-time conversion of text stored in the former euro format.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { debitWallet } from "../../src/lib/wallet";
import { reconcileWallets, recordUnrecordedOpeningBalances } from "../../src/lib/ledger";
import { refundExecution } from "../../src/engine/billing";
import { minimumPlanCost } from "../../src/engine/budget";
import { api, balance, createUser, defineObjective, fillContext, getExecution, runWorker } from "../helpers";

const OPENING_SQL = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261023120100_ledger_opening_balances/migration.sql"), "utf8");

async function ledger(userId: string) {
  return prisma.transaction.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

/** Every row's balanceAfter (when recorded) equals the running sum of the ledger up to it. */
function expectRunningBalances(rows: { amountCents: number; balanceAfter: number | null }[]) {
  let running = 0;
  for (const r of rows) {
    running += r.amountCents;
    if (r.balanceAfter !== null) expect(r.balanceAfter).toBe(running);
  }
}

describe("credit ledger", () => {
  it("opening-balance migration: records each legacy balance difference once, changes no balance, and is idempotent", async () => {
    const fresh = await createUser({ credits: 3000 }); // starting credits that were never recorded
    const spent = await createUser({ credits: 1850 }); // started with 3000, then one legacy charge
    await prisma.transaction.create({ data: { userId: spent.user.id, type: "TASK_CHARGE", amountCents: -1150, description: "Execution: legacy" } });
    const empty = await createUser({ credits: 0 });
    const recorded = await createUser({ credits: 500 }); // already fully in the ledger
    await prisma.transaction.create({ data: { userId: recorded.user.id, type: "TOP_UP", amountCents: 500, description: "Demo credit top-up (€5.00)" } });
    expect((await reconcileWallets()).mismatchCount).toBe(2);

    await prisma.$executeRawUnsafe(OPENING_SQL);
    await prisma.$executeRawUnsafe(OPENING_SQL); // a second run changes nothing

    const opening = await prisma.transaction.findMany({ where: { reason: "opening_balance" }, orderBy: { amountCents: "asc" } });
    expect(opening.map((t) => [t.userId, t.amountCents, t.type])).toEqual([
      [fresh.user.id, 3000, "ADJUSTMENT"],
      [spent.user.id, 3000, "ADJUSTMENT"],
    ]);
    expect(opening.every((t) => t.idempotencyKey === `opening:${t.userId}` && t.balanceAfter === null)).toBe(true);
    // Balances are untouched; every wallet now reconciles.
    expect([await balance(fresh.user.id), await balance(spent.user.id), await balance(empty.user.id), await balance(recorded.user.id)]).toEqual([3000, 1850, 0, 500]);
    expect(await reconcileWallets()).toMatchObject({ checked: 4, mismatchCount: 0 });
    // The opening row sorts first (dated at account creation), so the running balance stays meaningful.
    expect((await ledger(spent.user.id)).map((t) => t.amountCents)).toEqual([3000, -1150]);
  });

  it("the hourly repair only records accounts with a balance and no ledger row at all", async () => {
    const unrecorded = await createUser({ credits: 3000 });
    const diverged = await createUser({ credits: 900 });
    await prisma.transaction.create({ data: { userId: diverged.user.id, type: "TOP_UP", amountCents: 100, description: "x" } });
    expect(await recordUnrecordedOpeningBalances()).toBe(1);
    expect(await recordUnrecordedOpeningBalances()).toBe(0);
    const r = await reconcileWallets();
    // The diverged wallet is reported, never silently "fixed".
    expect(r.mismatches).toEqual([{ walletUserId: diverged.user.id, balance: 900, ledgerSum: 100 }]);
    expect((await ledger(unrecorded.user.id)).map((t) => t.reason)).toEqual(["opening_balance"]);
  });

  it("sign-up and the guest trial record their starting credits as GRANT rows", async () => {
    const res = await api()
      .post("/api/auth/signup")
      .send({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery-7", acceptedTerms: true, company: "Acme" })
      .expect(201);
    const ada = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(ada.credits).toBe(config.startingCreditsCents);
    expect((await ledger(ada.id)).map((t) => [t.type, t.reason, t.amountCents, t.balanceAfter])).toEqual([["GRANT", "signup_grant", config.startingCreditsCents, config.startingCreditsCents]]);
    expect(res.body.user.credits).toBe(config.startingCreditsCents);

    const guest = await api().post("/api/guest/start").send({ acceptedTerms: true }).expect(201);
    const g = await prisma.user.findUniqueOrThrow({ where: { id: guest.body.user.id } });
    expect((await ledger(g.id)).map((t) => [t.type, t.reason, t.amountCents])).toEqual([["GRANT", "guest_trial_grant", config.guest.creditsCents]]);
    expect((await reconcileWallets()).mismatchCount).toBe(0);
  });

  it("a full execution keeps the ledger reconciled, with the balance after every movement", async () => {
    await api().post("/api/auth/signup").send({ name: "Bo", email: "bo@example.com", password: "correct-horse-battery-7", acceptedTerms: true, company: "Acme" }).expect(201);
    const bo = await prisma.user.findUniqueOrThrow({ where: { email: "bo@example.com" } });
    const auth = (await api().post("/api/auth/login").send({ email: "bo@example.com", password: "correct-horse-battery-7" }).expect(200)).body.token;
    const h = { Authorization: `Bearer ${auth}` };
    await fillContext(h);
    const { executionId } = await defineObjective(h, { autonomy: "AUTO_WITHIN_BUDGET" });
    await runWorker();
    const ex = await getExecution(h, executionId);
    expect(ex.status).toBe("COMPLETED");
    const rows = await ledger(bo.id);
    expect(rows.map((t) => [t.type, t.reason])).toEqual([
      ["GRANT", "signup_grant"],
      ["TASK_CHARGE", "execution_charge"],
    ]);
    expect(rows[1]).toMatchObject({ amountCents: -ex.costCents, executionId, idempotencyKey: `charge:${executionId}` });
    expectRunningBalances(rows);
    expect(rows[1].balanceAfter).toBe(await balance(bo.id));
    expect((await reconcileWallets()).mismatchCount).toBe(0);
    // The public ledger shows the reason and the balance after each row.
    const tx = (await api().get("/api/billing").set(h).expect(200)).body.transactions;
    expect(tx[0]).toMatchObject({ type: "TASK_CHARGE", reason: "execution_charge", balanceAfter: rows[1].balanceAfter });
  });

  it("duplicate approvals sent at once start and charge the execution exactly once", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker();
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    const results = await Promise.all([1, 2, 3].map(() => api().post(`/api/approvals/${a.id}/approve`).set(auth).send({})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const charges = await prisma.transaction.findMany({ where: { userId: user.id, type: "TASK_CHARGE" } });
    expect(charges).toHaveLength(1);
    expect(charges[0].idempotencyKey).toBe(`charge:${executionId}`);
    expect(await balance(user.id)).toBe(5000 - charges[0].amountCents * -1);
  });

  it("an idempotency key applies a debit once, even when the same request runs twice at the same time", async () => {
    const { user } = await createUser({ credits: 1000 });
    const wallet = { walletUserId: user.id, teamId: null, via: "self" as const };
    const debit = () => prisma.$transaction((tx) => debitWallet(tx, { wallet, actorUserId: user.id, amountCents: 300, description: "t", idempotencyKey: "charge:test-1" }));
    const first = await debit();
    const again = await debit();
    expect(first).toEqual({ applied: true, balanceAfter: 700 });
    expect(again).toEqual({ applied: false, balanceAfter: 700 });
    const racing = await Promise.allSettled([1, 2].map(() => prisma.$transaction((tx) => debitWallet(tx, { wallet, actorUserId: user.id, amountCents: 100, description: "t", idempotencyKey: "charge:test-2" }))));
    // One applies; the other either sees it or loses on the unique key — never a second debit.
    expect(racing.filter((r) => r.status === "fulfilled" && r.value.applied)).toHaveLength(1);
    expect(await balance(user.id)).toBe(600);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(2);
  });

  it("parallel spending can't overdraw: some debits are refused with 402, the balance never goes negative", async () => {
    const { user } = await createUser({ credits: 1000 });
    const wallet = { walletUserId: user.id, teamId: null, via: "self" as const };
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => prisma.$transaction((tx) => debitWallet(tx, { wallet, actorUserId: user.id, amountCents: 300, description: `t${i}` }))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    const refused = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(refused).toHaveLength(2);
    expect(refused.every((x) => x.reason.status === 402 && /Not enough credits: this needs 300 credits and your balance is 100 credits/.test(x.reason.message))).toBe(true);
    expect(await balance(user.id)).toBe(100);
    const rows = await ledger(user.id);
    expect(rows.map((t) => t.balanceAfter).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([700, 400, 100]);
  });

  it("refunds carry an explicit reason, are capped at the charge, and record the balance after", async () => {
    const { user } = await createUser({ credits: 0 });
    const org = await prisma.organization.create({ data: { ownerId: user.id, name: "Org" } });
    const objective = await prisma.objective.create({ data: { orgId: org.id, title: "t", statement: "s", budgetCents: 1000 } });
    const ex = await prisma.execution.create({ data: { orgId: org.id, objectiveId: objective.id, costCents: 1150, walletUserId: user.id, chargedAt: new Date(), status: "RUNNING" } });
    expect(await prisma.$transaction((tx) => refundExecution(tx, ex.id, 250, "step_skipped", "skipped step “Competitor scan”"))).toBe(250);
    expect(await prisma.$transaction((tx) => refundExecution(tx, ex.id, 150, "verification_unavailable"))).toBe(150);
    expect(await prisma.$transaction((tx) => refundExecution(tx, ex.id, 5000, "execution_failed"))).toBe(750);
    expect(await prisma.$transaction((tx) => refundExecution(tx, ex.id, 100, "execution_cancelled"))).toBe(0); // nothing left
    const rows = await ledger(user.id);
    expect(rows.map((t) => [t.type, t.reason, t.amountCents, t.balanceAfter])).toEqual([
      ["REFUND", "step_skipped", 250, 250],
      ["REFUND", "verification_unavailable", 150, 400],
      ["REFUND", "execution_failed", 750, 1150],
    ]);
    expect(rows[0].description).toBe("Refund: skipped step “Competitor scan”");
    expect(rows[1].description).toBe("Verification fee refunded: the result could not be verified");
    expect((await prisma.execution.findUniqueOrThrow({ where: { id: ex.id } })).refundedCents).toBe(1150);
  });

  it("a wallet that can't afford the cheapest plan is refused before any model call", async () => {
    expect(minimumPlanCost()).toBe(800);
    const { auth } = await createUser({ credits: 799 });
    await fillContext(auth);
    const r = await api()
      .post("/api/objectives")
      .set(auth)
      .send({ statement: "Analyze the European market for our liquid-cooling product.", successCriteria: [{ description: "Recommend 3 markets" }] })
      .expect(402);
    expect(r.body.error).toBe("Not enough credits to plan this objective: the smallest possible plan costs 800 credits and your balance is 799 credits. Add credits in Usage first.");
    expect(await prisma.execution.count()).toBe(0);
    expect(await prisma.usageEvent.count({ where: { kind: "llm" } })).toBe(0);
    // A draft costs nothing and is still allowed; planning it is refused the same way.
    const draft = await api().post("/api/objectives").set(auth).send({ statement: "Analyze the European market for our liquid-cooling product.", draft: true }).expect(201);
    await api().post(`/api/objectives/${draft.body.objective.id}/plan`).set(auth).expect(402);
  });

  it("an execution that reaches the token ceiling stops before its next step and is refunded", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth);
    await runWorker(); // planned, waiting for approval
    const before = config.maxTokensPerExecution;
    config.maxTokensPerExecution = 10_000;
    try {
      // Model calls already used past the ceiling (e.g. a runaway revision).
      await prisma.usageEvent.create({ data: { kind: "llm", provider: "mock", model: "mock", tokensIn: 9_000, tokensOut: 2_000, executionId } });
      const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
      await api().post(`/api/approvals/${a.id}/approve`).set(auth).send({}).expect(200);
      await runWorker();
    } finally {
      config.maxTokensPerExecution = before;
    }
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    // The planner's own call counts too: the reported figure is everything the execution used.
    const used = await prisma.usageEvent.aggregate({ where: { executionId, kind: "llm" }, _sum: { tokensIn: true, tokensOut: true } });
    const total = (used._sum.tokensIn ?? 0) + (used._sum.tokensOut ?? 0);
    expect(total).toBeGreaterThanOrEqual(11_000);
    expect(ex.errorMessage).toBe(`Stopped at the safety limit: this execution used ${total.toLocaleString("en-US")} model tokens (limit 10,000). Its credits are refunded.`);
    expect(ex.steps.every((s: { status: string }) => s.status !== "COMPLETED")).toBe(true);
    expect(ex.refundedCents).toBe(ex.costCents);
    expect(await balance(user.id)).toBe(5000);
    const reasons = (await ledger(user.id)).map((t) => t.reason);
    expect(reasons).toEqual(["execution_charge", "execution_failed"]);
  });

  it("system text stored in the former euro format is shown in credits; quoted user text is untouched", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const { executionId } = await defineObjective(auth, { title: "Grow revenue by €20.00 per seat" });
    await runWorker();
    const approval = await prisma.approval.findFirstOrThrow({ where: { executionId } });
    await prisma.approval.update({
      where: { id: approval.id },
      data: {
        title: "Approve €11.50 for “Grow revenue by €20.00 per seat”",
        reason: "The estimated cost (€11.50) is above your organization's approval threshold (€10.00).",
        recommendation: "Approve only if the result is worth €11.50; otherwise reject and narrow the objective or raise its budget.",
      },
    });
    await prisma.executionEvent.create({
      data: { executionId, orgId: approval.orgId, type: "FUNDS_REFUNDED", actor: "system", message: "€2.50 refunded for “Pricing at €4.50 per user”, which was skipped", data: { amountCents: 250 } },
    });
    const [a] = (await api().get("/api/approvals").set(auth).expect(200)).body.approvals;
    expect(a.title).toBe("Approve 1,150 credits for “Grow revenue by €20.00 per seat”");
    expect(a.reason).toBe("The estimated cost (1,150 credits) is above your organization's approval threshold (1,000 credits).");
    expect(a.recommendation).toBe("Approve only if the result is worth 1,150 credits; otherwise reject and narrow the objective or raise its budget.");
    const ex = await getExecution(auth, executionId);
    const refundEvent = ex.events.find((e: { type: string }) => e.type === "FUNDS_REFUNDED");
    expect(refundEvent.message).toBe("250 credits refunded for “Pricing at €4.50 per user”, which was skipped");
    const planned = ex.events.find((e: { type: string }) => e.type === "OBJECTIVE_PLANNED");
    expect(planned.message).toMatch(/estimated 1,150 credits$/);
  });
});
