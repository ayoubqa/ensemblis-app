// Real Stripe responses from the test-mode validation run of 2026-10-30
// (docs/billing/stripe-test-mode-validation.md, section 6). Account acct_1UVzu9JxdXxCrKwI, livemode false.
//
// They were made through the Stripe connector, whose API version is 2026-09-30, so they have the newer
// layout:
// - the period is on the subscription item;
// - the invoice's subscription is under parent.subscription_details;
// - a line's price is under pricing.price_details;
// - a line's proration flag is under parent.subscription_item_details.
// The app's SDK is pinned to 2025-02-24.acacia; these exercise its fallbacks for the newer layout, with
// real values.
//
// Trimmed to the fields the app reads, plus identifiers. Values are unchanged, and hosted invoice and PDF
// URLs are dropped. The metadata values fixture_row_* / fixture_wallet_* were placeholders set when the
// objects were created; the replay test swaps in the ids of the rows it creates.

const PRICE = {
  starter: "price_1UWIcSJxdXxCrKwILcllRFti",
  growth: "price_1UWIcYJxdXxCrKwIY8krK6sJ",
  business: "price_1UWIccJxdXxCrKwIoWAA5D9s",
} as const;
export const REAL_PRICE_IDS = PRICE;

const price = (id: string, product: string, unitAmount: number, lookupKey: string, plan: string) => ({
  id,
  object: "price",
  active: true,
  currency: "eur",
  livemode: false,
  lookup_key: lookupKey,
  metadata: { ensemblis_plan: plan },
  product,
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  type: "recurring",
  unit_amount: unitAmount,
});
export const prices = {
  [PRICE.starter]: price(PRICE.starter, "prod_VXNMzvj2CHfuuc", 2900, "ensemblis_starter_monthly_eur_2900", "starter"),
  [PRICE.growth]: price(PRICE.growth, "prod_VXNNeqOkk2DZVn", 9900, "ensemblis_growth_monthly_eur_9900", "growth"),
  [PRICE.business]: price(PRICE.business, "prod_VXNNMSOGYSjBiH", 29900, "ensemblis_business_monthly_eur_29900", "business"),
};

/** The portal configuration created for the run (it became the account default: the account had none). */
export const portalConfiguration = {
  id: "bpc_1UWIcnJxdXxCrKwIinWcLLzZ",
  object: "billing_portal.configuration",
  active: true,
  is_default: true,
  livemode: false,
  metadata: { ensemblis_plans_portal: "1" },
  features: {
    customer_update: { allowed_updates: ["email", "address"], enabled: true },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true, payment_method_configuration: null },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
    subscription_pause: { enabled: false },
    subscription_update: { enabled: false, proration_behavior: "none", default_allowed_updates: [] },
  },
};

/** The Checkout Session created with exactly the parameters the app sends (it was left to expire). */
export const checkoutSession = {
  id: "cs_test_a1LRDs9zOFrs8BDuTeo5mQ4vGkGMPxhn2voeYL84AXYeETlTnjmjGMJSrc",
  object: "checkout.session",
  amount_total: 2900,
  currency: "eur",
  customer: "cus_VXNPE14fLErSW8",
  client_reference_id: "fixture_row_co",
  expires_at: 1793381400,
  livemode: false,
  metadata: { kind: "subscription", planId: "starter", subscriptionRowId: "fixture_row_co", walletUserId: "fixture_wallet_co" },
  mode: "subscription",
  payment_status: "unpaid",
  status: "open",
  subscription: null,
  success_url: "http://localhost:3000/usage?subscription=success",
  cancel_url: "http://localhost:3000/pricing?subscription=cancelled",
  url: "https://checkout.stripe.com/c/pay/cs_test_a1LRDs9zOFrs8BDuTeo5mQ4vGkGMPxhn2voeYL84AXYeETlTnjmjGMJSrc",
};

const item = (id: string, sub: string, priceId: keyof typeof prices, start: number, end: number) => ({
  id,
  object: "subscription_item",
  current_period_start: start,
  current_period_end: end,
  price: prices[priceId],
  quantity: 1,
  subscription: sub,
});
const subscription = (o: {
  id: string;
  customer: string;
  status: string;
  metadata: Record<string, string>;
  item: ReturnType<typeof item>;
  latest_invoice: string;
  test_clock?: string | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  pending_update?: unknown;
}) => ({
  id: o.id,
  object: "subscription",
  billing_mode: { type: "flexible" },
  cancel_at: o.cancel_at ?? null,
  cancel_at_period_end: o.cancel_at_period_end ?? false,
  canceled_at: o.canceled_at ?? null,
  currency: "eur",
  customer: o.customer,
  ended_at: null,
  items: { object: "list", data: [o.item], has_more: false },
  latest_invoice: o.latest_invoice,
  livemode: false,
  metadata: o.metadata,
  pending_update: o.pending_update ?? null,
  status: o.status,
  test_clock: o.test_clock ?? null,
});

const line = (o: { id: string; invoice: string; amount: number; description: string; price: string; product: string; proration: boolean; sub: string; si: string; start: number; end: number }) => ({
  id: o.id,
  object: "line_item",
  amount: o.amount,
  currency: "eur",
  description: o.description,
  invoice: o.invoice,
  livemode: false,
  parent: { type: "subscription_item_details", subscription_item_details: { proration: o.proration, subscription: o.sub, subscription_item: o.si } },
  period: { start: o.start, end: o.end },
  pricing: { type: "price_details", price_details: { price: o.price, product: o.product } },
  quantity: 1,
});
const invoice = (o: {
  id: string;
  customer: string;
  sub: string;
  subMetadata: Record<string, string>;
  billing_reason: string;
  status: string;
  amount_due: number;
  amount_paid: number;
  attempt_count: number;
  total: number;
  lines: ReturnType<typeof line>[];
  next_payment_attempt?: number | null;
}) => ({
  id: o.id,
  object: "invoice",
  amount_due: o.amount_due,
  amount_paid: o.amount_paid,
  amount_remaining: o.amount_due - o.amount_paid,
  attempt_count: o.attempt_count,
  billing_reason: o.billing_reason,
  currency: "eur",
  customer: o.customer,
  lines: { object: "list", data: o.lines, has_more: false },
  livemode: false,
  next_payment_attempt: o.next_payment_attempt ?? null,
  parent: { type: "subscription_details", subscription_details: { metadata: o.subMetadata, subscription: o.sub } },
  status: o.status,
  total: o.total,
});

// ---------------------------------------------------------------- J1 / J6 / J8: one subscription, on a test clock
// Starter paid, then upgraded to Growth (€70.00 prorated), then downgraded to Starter (no proration), then kept.
const J1 = { customer: "cus_VXNO8hiPlJg4QX", sub: "sub_1UWIfkJxdXxCrKwIAk8SgdTr", si: "si_VXNQHAgJlXbKoo", start: 1793377800, end: 1796056200, clock: "clock_1UWIdyJxdXxCrKwIAk0mkzip" };
const j1Meta = { kind: "subscription", planId: "starter", subscriptionRowId: "fixture_row_j1", walletUserId: "fixture_wallet_j1" };
export const j1Customer = { id: J1.customer, object: "customer", email: "ensemblis-test+j1@example.com", livemode: false, metadata: { walletUserId: "fixture_wallet_j1" }, test_clock: J1.clock };
const j1Sub = (priceId: keyof typeof prices, latest: string) =>
  subscription({ id: J1.sub, customer: J1.customer, status: "active", metadata: j1Meta, item: item(J1.si, J1.sub, priceId, J1.start, J1.end), latest_invoice: latest, test_clock: J1.clock });
export const j1 = {
  created: j1Sub(PRICE.starter, "in_1UWIfkJxdXxCrKwILPCOrLRW"),
  upgraded: j1Sub(PRICE.growth, "in_1UWIh5JxdXxCrKwIqq0MV0fi"),
  downgraded: j1Sub(PRICE.starter, "in_1UWIh5JxdXxCrKwIqq0MV0fi"),
  kept: j1Sub(PRICE.growth, "in_1UWIh5JxdXxCrKwIqq0MV0fi"),
  firstInvoice: invoice({
    id: "in_1UWIfkJxdXxCrKwILPCOrLRW",
    customer: J1.customer,
    sub: J1.sub,
    subMetadata: j1Meta,
    billing_reason: "subscription_create",
    status: "paid",
    amount_due: 2900,
    amount_paid: 2900,
    attempt_count: 1,
    total: 2900,
    lines: [line({ id: "il_1UWIgmJxdXxCrKwIbVoNHeTJ", invoice: "in_1UWIfkJxdXxCrKwILPCOrLRW", amount: 2900, description: "1 × Ensemblis Starter (at €29.00 / month)", price: PRICE.starter, product: "prod_VXNMzvj2CHfuuc", proration: false, sub: J1.sub, si: J1.si, start: J1.start, end: J1.end })],
  }),
  upgradeInvoice: invoice({
    id: "in_1UWIh5JxdXxCrKwIqq0MV0fi",
    customer: J1.customer,
    sub: J1.sub,
    subMetadata: j1Meta,
    billing_reason: "subscription_update",
    status: "paid",
    amount_due: 7000,
    amount_paid: 7000,
    attempt_count: 1,
    total: 7000,
    lines: [
      line({ id: "il_1UWIgmJxdXxCrKwIva2XRPh4", invoice: "in_1UWIh5JxdXxCrKwIqq0MV0fi", amount: -2900, description: "Unused time on Ensemblis Starter after 30 Oct 2026", price: PRICE.starter, product: "prod_VXNMzvj2CHfuuc", proration: true, sub: J1.sub, si: J1.si, start: J1.start, end: J1.end }),
      line({ id: "il_1UWIgnJxdXxCrKwITFGYJj2z", invoice: "in_1UWIh5JxdXxCrKwIqq0MV0fi", amount: 9900, description: "Remaining time on Ensemblis Growth after 30 Oct 2026", price: PRICE.growth, product: "prod_VXNNeqOkk2DZVn", proration: true, sub: J1.sub, si: J1.si, start: J1.start, end: J1.end }),
    ],
  }),
};

// ---------------------------------------------------------------- J4: first payment fails (card attaches, charges fail)
const J4 = { customer: "cus_VXNTHA33GDxxQF", sub: "sub_1UWIinJxdXxCrKwIoFrzEPsk", si: "si_VXNTZYdVFbNdJ9", start: 1793377925, end: 1796056325 };
const j4Meta = { kind: "subscription", planId: "starter", subscriptionRowId: "fixture_row_j4", walletUserId: "fixture_wallet_j4" };
export const j4 = {
  customer: J4.customer,
  created: subscription({ id: J4.sub, customer: J4.customer, status: "incomplete", metadata: j4Meta, item: item(J4.si, J4.sub, PRICE.starter, J4.start, J4.end), latest_invoice: "in_1UWIinJxdXxCrKwIlMKIw4wN" }),
  invoice: invoice({
    id: "in_1UWIinJxdXxCrKwIlMKIw4wN",
    customer: J4.customer,
    sub: J4.sub,
    subMetadata: j4Meta,
    billing_reason: "subscription_create",
    status: "open",
    amount_due: 2900,
    amount_paid: 0,
    attempt_count: 1,
    total: 2900,
    lines: [line({ id: "il_1UWIinJxdXxCrKwIgLlcNRar", invoice: "in_1UWIinJxdXxCrKwIlMKIw4wN", amount: 2900, description: "1 × Ensemblis Starter (at €29.00 / month)", price: PRICE.starter, product: "prod_VXNMzvj2CHfuuc", proration: false, sub: J4.sub, si: J4.si, start: J4.start, end: J4.end })],
  }),
};

// ---------------------------------------------------------------- J5: cancel at period end, then keep
const J5 = { customer: "cus_VXNSfSY4G47JLO", sub: "sub_1UWIiAJxdXxCrKwIN2cnD9DD", si: "si_VXNTUKTx7wcMXe", start: 1793377885, end: 1796056285 };
const j5Meta = { kind: "subscription", planId: "starter", subscriptionRowId: "fixture_row_j7", walletUserId: "fixture_wallet_j7" };
const j5Sub = (cancel: { cancel_at_period_end: boolean; cancel_at: number | null; canceled_at: number | null }) =>
  subscription({ id: J5.sub, customer: J5.customer, status: "active", metadata: j5Meta, item: item(J5.si, J5.sub, PRICE.starter, J5.start, J5.end), latest_invoice: "in_1UWIiAJxdXxCrKwIwq9Q2eiZ", ...cancel });
export const j5 = {
  customer: J5.customer,
  active: j5Sub({ cancel_at_period_end: false, cancel_at: null, canceled_at: null }),
  // Stripe sets canceled_at as soon as the cancellation is scheduled; the plan still runs to cancel_at.
  cancelled: j5Sub({ cancel_at_period_end: true, cancel_at: 1796056285, canceled_at: 1793378090 }),
  kept: j5Sub({ cancel_at_period_end: false, cancel_at: null, canceled_at: null }),
};

// ---------------------------------------------------------------- J7: €0 first invoice (100% coupon), then a declined upgrade
const J7 = { customer: "cus_VXNU5uWoZ2tshZ", sub: "sub_1UWIjTJxdXxCrKwIiOtZRCRK", si: "si_VXNUPzaIO6w9V8", start: 1793377967, end: 1796056367 };
const j7Meta = { kind: "subscription", planId: "starter", subscriptionRowId: "fixture_row_j7b", walletUserId: "fixture_wallet_j7b" };
export const j7 = {
  customer: J7.customer,
  active: subscription({ id: J7.sub, customer: J7.customer, status: "active", metadata: j7Meta, item: item(J7.si, J7.sub, PRICE.starter, J7.start, J7.end), latest_invoice: "in_1UWIjTJxdXxCrKwIETAqNCdS" }),
  /** The answer to the upgrade request: 200, items unchanged, pending_update set (it expires after ~23 hours). */
  upgradeDeclined: subscription({
    id: J7.sub,
    customer: J7.customer,
    status: "active",
    metadata: j7Meta,
    item: item(J7.si, J7.sub, PRICE.starter, J7.start, J7.end),
    latest_invoice: "in_1UWIjnJxdXxCrKwIw7JbIRX6",
    pending_update: { expires_at: 1793460787, subscription_items: [{ id: J7.si, object: "subscription_item", price: { id: PRICE.growth } }] },
  }),
  zeroInvoice: invoice({
    id: "in_1UWIjTJxdXxCrKwIETAqNCdS",
    customer: J7.customer,
    sub: J7.sub,
    subMetadata: j7Meta,
    billing_reason: "subscription_create",
    status: "paid",
    amount_due: 0,
    amount_paid: 0,
    attempt_count: 0,
    total: 0,
    lines: [line({ id: "il_1UWIjTJxdXxCrKwIU5aYz6c3", invoice: "in_1UWIjTJxdXxCrKwIETAqNCdS", amount: 2900, description: "1 × Ensemblis Starter (at €29.00 / month)", price: PRICE.starter, product: "prod_VXNMzvj2CHfuuc", proration: false, sub: J7.sub, si: J7.si, start: J7.start, end: J7.end })],
  }),
  upgradeInvoice: invoice({
    id: "in_1UWIjnJxdXxCrKwIw7JbIRX6",
    customer: J7.customer,
    sub: J7.sub,
    subMetadata: j7Meta,
    billing_reason: "subscription_update",
    status: "open",
    amount_due: 9900,
    amount_paid: 0,
    attempt_count: 1,
    total: 9900,
    next_payment_attempt: 1793532247,
    lines: [
      line({ id: "il_1UWIjnJxdXxCrKwIhtSah2Vo", invoice: "in_1UWIjnJxdXxCrKwIw7JbIRX6", amount: 0, description: "Unused time on Ensemblis Starter (with 100.0% off) after 30 Oct 2026", price: PRICE.starter, product: "prod_VXNMzvj2CHfuuc", proration: true, sub: J7.sub, si: J7.si, start: 1793377987, end: J7.end }),
      line({ id: "il_1UWIjoJxdXxCrKwIeRFDviJr", invoice: "in_1UWIjnJxdXxCrKwIw7JbIRX6", amount: 9900, description: "Remaining time on Ensemblis Growth after 30 Oct 2026", price: PRICE.growth, product: "prod_VXNNeqOkk2DZVn", proration: true, sub: J7.sub, si: J7.si, start: 1793377987, end: J7.end }),
    ],
  }),
};

/** When the run happened (Stripe's clock); the replay freezes the app's clock here. */
export const RUN_TIME = new Date(1793378127 * 1000);
