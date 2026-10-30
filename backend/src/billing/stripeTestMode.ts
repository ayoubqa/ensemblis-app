// Stripe test-mode setup and checks for monthly plans, behind `npm run ops:stripe-test` (src/ops/stripeTestMode.ts).
// Every entry point refuses a live key: this only ever touches a Stripe test-mode account or sandbox.
//
// - check: reads only. Prices match the catalogue, the webhook endpoint sends every event the app needs, the
//   Customer Portal configuration matches the app's policy.
// - setup: creates what is missing (one product and monthly EUR price per plan, a portal configuration and,
//   when asked, the webhook endpoint) and reuses what an earlier run created, so it can be run again.
// - relay: forwards this account's new events to a local API, signed with its STRIPE_WEBHOOK_SECRET, for a
//   machine Stripe can't reach (what `stripe listen` does). Local targets only.
//
// Nothing here prints a secret: the API key is never echoed, and a new endpoint's signing secret goes to a
// file created with mode 0600.

import { writeFileSync } from "node:fs";
import Stripe from "stripe";
import { config } from "../config";
import { plans, type Plan } from "./plans";
import { STRIPE_WEBHOOK_EVENTS, priceProblems } from "./subscriptions";

/** The API version the integration is tested with (stripe-node's default); new endpoints are pinned to it. */
export const TESTED_API_VERSION = "2025-02-24.acacia";
/** Marks the objects setup creates, so a second run finds and reuses them. */
const TAG = "ensemblis_plan";
const PORTAL_TAG = "ensemblis_plans_portal";

export type Level = "ok" | "fail" | "info";
export interface Finding {
  level: Level;
  what: string;
}
const ok = (what: string): Finding => ({ level: "ok", what });
const fail = (what: string): Finding => ({ level: "fail", what });
const info = (what: string): Finding => ({ level: "info", what });
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function assertTestKey(key: string): void {
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_… or rk_test_…). This tool never runs against live mode.");
  }
}

/** One lookup key per plan and amount: a price change makes setup create a new Price rather than reuse the old one. */
export const lookupKeyFor = (plan: Pick<Plan, "id" | "priceCents">) => `ensemblis_${plan.id}_monthly_eur_${plan.priceCents}`;

export const envName = (plan: Pick<Plan, "id">, kind: "PRICE" | "PRODUCT") => `STRIPE_${kind}_${plan.id.toUpperCase()}`;

/** Events the app needs that this endpoint doesn't send. */
export function missingEvents(enabled: readonly string[]): string[] {
  if (enabled.includes("*")) return [];
  return STRIPE_WEBHOOK_EVENTS.filter((e) => !enabled.includes(e));
}

/** How a portal configuration departs from the app's policy (DEPLOYMENT.md §2b, step 3). */
export function portalProblems(c: Pick<Stripe.BillingPortal.Configuration, "active" | "features">): string[] {
  const f = c.features;
  const problems: string[] = [];
  if (!c.active) problems.push("the configuration is inactive");
  if (f.subscription_update?.enabled) problems.push("plan switching is on: turn it off (Upgrade and Downgrade in Usage apply the app's policy)");
  if (f.subscription_cancel?.enabled && f.subscription_cancel.mode !== "at_period_end") problems.push("cancellation is immediate: set it to the end of the billing period");
  if (!f.payment_method_update?.enabled) problems.push("payment-method updates are off, so a customer whose payment failed can't fix their card");
  if (!f.invoice_history?.enabled) problems.push("invoice history is off");
  return problems;
}

/** The relay only delivers to this machine: re-signed events must never reach a deployed server. */
export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

const formatEur = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const productId = (p: string | Stripe.Product | Stripe.DeletedProduct) => (typeof p === "string" ? p : p.id);

async function account(stripe: Stripe): Promise<Finding> {
  try {
    const a = await stripe.accounts.retrieve();
    return info(`Stripe account ${a.id}${a.settings?.dashboard?.display_name ? ` (${a.settings.dashboard.display_name})` : ""}, test mode`);
  } catch (err) {
    return info(`test mode; the account couldn't be read (${msg(err)}), which a restricted key may not allow`);
  }
}

async function checkPrices(stripe: Stripe): Promise<Finding[]> {
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  for (const plan of plans()) {
    if (!plan.stripePriceId) {
      out.push(fail(`${plan.name}: ${envName(plan, "PRICE")} is not set`));
      continue;
    }
    const other = seen.get(plan.stripePriceId);
    if (other) out.push(fail(`${plan.name}: ${envName(plan, "PRICE")} is the same Price as ${other}`));
    seen.set(plan.stripePriceId, plan.name);
    try {
      const price = await stripe.prices.retrieve(plan.stripePriceId);
      const problems = priceProblems(plan, price);
      out.push(
        problems.length
          ? fail(`${plan.name}: ${plan.stripePriceId} doesn't match the catalogue (${problems.join(", ")}); checkout would refuse it`)
          : ok(`${plan.name}: ${plan.stripePriceId}, ${formatEur(plan.priceCents)} a month, product ${productId(price.product)}`)
      );
    } catch (err) {
      out.push(fail(`${plan.name}: ${plan.stripePriceId} can't be read (${msg(err)})`));
    }
  }
  return out;
}

async function checkWebhooks(stripe: Stripe, webhookUrl?: string): Promise<Finding[]> {
  const out: Finding[] = [];
  out.push(
    /^whsec_/.test(config.stripe.webhookSecret)
      ? ok("STRIPE_WEBHOOK_SECRET is set (Stripe can't show whether it matches: the end-to-end checkout proves it)")
      : fail("STRIPE_WEBHOOK_SECRET is not set (whsec_…)")
  );
  const { data: endpoints } = await stripe.webhookEndpoints.list({ limit: 100 });
  const relevant = webhookUrl ? endpoints.filter((e) => e.url === webhookUrl) : endpoints;
  if (webhookUrl && !relevant.length) out.push(fail(`no webhook endpoint for ${webhookUrl}`));
  if (!webhookUrl && !relevant.length) out.push(info("no webhook endpoint (fine on a local machine using the relay)"));
  for (const e of relevant) {
    const missing = missingEvents(e.enabled_events);
    if (e.status !== "enabled") out.push(fail(`endpoint ${e.url} is ${e.status}`));
    out.push(missing.length ? fail(`endpoint ${e.url} doesn't send: ${missing.join(", ")}`) : ok(`endpoint ${e.url} sends every event the app needs (API version ${e.api_version ?? "account default"})`));
  }
  return out;
}

async function checkPortal(stripe: Stripe): Promise<Finding[]> {
  let c: Stripe.BillingPortal.Configuration | undefined;
  const id = config.subscriptions.portalConfigurationId;
  try {
    c = id ? await stripe.billingPortal.configurations.retrieve(id) : (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0];
  } catch (err) {
    return [fail(`portal configuration ${id || "(default)"} can't be read (${msg(err)})`)];
  }
  if (!c) return [fail("the Customer Portal has no configuration in test mode: run setup, or save it once in Settings → Billing → Customer portal")];
  const problems = portalProblems(c);
  const name = id ? `portal configuration ${c.id}` : `default portal configuration ${c.id}`;
  return problems.length ? [fail(`${name}: ${problems.join("; ")}`)] : [ok(`${name} matches the app's policy`)];
}

/** Read-only: what a test-mode run needs, and what is wrong with it. */
export async function checkTestMode(stripe: Stripe, opts: { webhookUrl?: string } = {}): Promise<Finding[]> {
  assertTestKey(config.stripe.secretKey);
  return [
    await account(stripe),
    config.subscriptions.enabled ? ok("SUBSCRIPTIONS_ENABLED is on") : info("SUBSCRIPTIONS_ENABLED is off: plans stay hidden until it is on"),
    info(`checkout returns to ${config.appUrl}/usage and ${config.appUrl}/pricing (APP_URL)`),
    ...(await checkPrices(stripe)),
    ...(await checkWebhooks(stripe, opts.webhookUrl)),
    ...(await checkPortal(stripe)),
  ];
}

async function ensurePrice(stripe: Stripe, plan: Plan, out: Finding[]): Promise<Stripe.Price> {
  const key = lookupKeyFor(plan);
  const existing = (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
  if (existing && !priceProblems({ ...plan, stripeProductId: "" }, existing).length) {
    out.push(ok(`${plan.name}: reusing ${existing.id}`));
    return existing;
  }
  const products = (await stripe.products.list({ active: true, limit: 100 })).data;
  const product =
    products.find((p) => p.metadata?.[TAG] === plan.id) ??
    (await stripe.products.create({ name: `Ensemblis ${plan.name}`, metadata: { [TAG]: plan.id } }));
  const price = await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: plan.priceCents,
    recurring: { interval: "month", interval_count: 1 },
    lookup_key: key,
    transfer_lookup_key: true,
    nickname: `${plan.name} monthly`,
    metadata: { [TAG]: plan.id },
  });
  out.push(ok(`${plan.name}: created ${price.id} (${formatEur(plan.priceCents)} a month) on ${product.id}`));
  return price;
}

async function ensurePortal(stripe: Stripe, out: Finding[]): Promise<string> {
  const { data } = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const mine = data.find((c) => c.metadata?.[PORTAL_TAG] === "1" && !portalProblems(c).length);
  if (mine) {
    out.push(ok(`portal: reusing ${mine.id}`));
    return mine.id;
  }
  // Stripe wants public https links; leave them out for a local APP_URL.
  const site = /^https:\/\//.test(config.appUrl) ? config.appUrl : "";
  const c = await stripe.billingPortal.configurations.create({
    business_profile: site ? { privacy_policy_url: `${site}/privacy`, terms_of_service_url: `${site}/terms` } : {},
    ...(site ? { default_return_url: `${site}/usage` } : {}),
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: false },
    },
    metadata: { [PORTAL_TAG]: "1" },
  });
  out.push(ok(`portal: created ${c.id} (plan switching off, cancellation at period end; not made the default)`));
  return c.id;
}

async function ensureWebhook(stripe: Stripe, url: string, secretFile: string | undefined, out: Finding[], env: Record<string, string>) {
  const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((e) => e.url === url);
  if (existing) {
    const missing = missingEvents(existing.enabled_events);
    if (missing.length || existing.status !== "enabled") {
      await stripe.webhookEndpoints.update(existing.id, { enabled_events: [...new Set([...existing.enabled_events, ...missing])] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[], disabled: false });
      out.push(ok(`webhook ${existing.id}: enabled and added ${missing.length ? missing.join(", ") : "nothing"}`));
    } else {
      out.push(ok(`webhook ${existing.id}: already sends every event the app needs`));
    }
    out.push(info("its signing secret can't be read back: use the one already in STRIPE_WEBHOOK_SECRET, or reveal it in Developers → Webhooks"));
    return;
  }
  if (!secretFile) {
    out.push(fail(`no endpoint for ${url} yet: rerun with --secret-file <path> so its signing secret (shown once) can be saved`));
    return;
  }
  // Claim the file first: an endpoint whose secret couldn't be saved would be useless.
  writeFileSync(secretFile, "", { mode: 0o600, flag: "wx" });
  const e = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [...STRIPE_WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
    api_version: TESTED_API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
    description: "Ensemblis (test mode): credit packs and monthly plans",
  });
  writeFileSync(secretFile, `${e.secret ?? ""}\n`, { mode: 0o600 });
  env.STRIPE_WEBHOOK_SECRET = `(saved to ${secretFile})`;
  out.push(ok(`webhook ${e.id} created for ${url}; its signing secret is in ${secretFile} (mode 600)`));
}

/** Creates or reuses the test-mode objects. Returns the env values to set (IDs only; no secrets). */
export async function setupTestMode(stripe: Stripe, opts: { webhookUrl?: string; secretFile?: string } = {}): Promise<{ findings: Finding[]; env: Record<string, string> }> {
  assertTestKey(config.stripe.secretKey);
  const findings: Finding[] = [await account(stripe)];
  const env: Record<string, string> = {};
  for (const plan of plans()) {
    const price = await ensurePrice(stripe, plan, findings);
    env[envName(plan, "PRICE")] = price.id;
    env[envName(plan, "PRODUCT")] = productId(price.product);
  }
  env.STRIPE_PORTAL_CONFIGURATION_ID = await ensurePortal(stripe, findings);
  if (opts.webhookUrl) await ensureWebhook(stripe, opts.webhookUrl, opts.secretFile, findings, env);
  return { findings, env };
}

export interface RelayState {
  /** Unix seconds: events created before this are ignored. */
  since: number;
  /** Event ids already delivered (or given up on). */
  done: Set<string>;
  attempts: Map<string, number>;
}
const MAX_ATTEMPTS = 5;

/**
 * One relay pass: this account's new events of the types the app handles, oldest first, each signed with
 * the local STRIPE_WEBHOOK_SECRET as Stripe would sign it. A 5xx answer is retried on later passes (as Stripe
 * retries), up to MAX_ATTEMPTS.
 */
export async function relayOnce(
  stripe: Stripe,
  state: RelayState,
  opts: { to: string; secret: string; post?: (url: string, body: string, signature: string) => Promise<number> }
): Promise<{ id: string; type: string; status: number | string }[]> {
  assertTestKey(config.stripe.secretKey);
  if (!isLocalUrl(opts.to)) throw new Error(`The relay only delivers to this machine (localhost), not ${opts.to}.`);
  const post =
    opts.post ??
    (async (url: string, body: string, signature: string) =>
      (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body })).status);
  const events: Stripe.Event[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.events.list({ created: { gte: state.since }, types: [...STRIPE_WEBHOOK_EVENTS], limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    events.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  // Stripe lists newest first; deliver in the order they happened.
  const fresh = events.filter((e) => !state.done.has(e.id)).sort((a, b) => a.created - b.created);
  const results: { id: string; type: string; status: number | string }[] = [];
  for (const e of fresh) {
    const body = JSON.stringify(e);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret });
    let status: number | string;
    try {
      status = await post(opts.to, body, signature);
    } catch (err) {
      status = msg(err);
    }
    const tries = (state.attempts.get(e.id) ?? 0) + 1;
    state.attempts.set(e.id, tries);
    const retry = (typeof status !== "number" || status >= 500) && tries < MAX_ATTEMPTS;
    if (!retry) state.done.add(e.id);
    results.push({ id: e.id, type: e.type, status });
  }
  return results;
}
