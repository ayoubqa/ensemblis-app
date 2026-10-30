import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, productionConfigWarnings } from "../../src/config";
import { STRIPE_WEBHOOK_EVENTS } from "../../src/billing/subscriptions";
import {
  TESTED_API_VERSION,
  assertTestKey,
  checkTestMode,
  isLocalUrl,
  lookupKeyFor,
  missingEvents,
  portalProblems,
  relayOnce,
  setupTestMode,
  type RelayState,
} from "../../src/billing/stripeTestMode";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The slice of a Stripe test-mode account the tool touches, in memory. Counts every call. */
function fakeAccount() {
  const prices: any[] = [];
  const products: any[] = [];
  const endpoints: any[] = [];
  const portals: any[] = [];
  const events: any[] = [];
  let calls = 0;
  let n = 0;
  const id = (p: string) => `${p}_${++n}`;
  const call = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A) => {
    calls++;
    return Promise.resolve(fn(...a));
  };
  const stripe = {
    accounts: { retrieve: call(() => ({ id: "acct_test123", settings: { dashboard: { display_name: "Ensemblis test" } } })) },
    prices: {
      retrieve: call((pid: string) => {
        const p = prices.find((x) => x.id === pid);
        if (!p) throw new Error(`No such price: '${pid}'`);
        return p;
      }),
      list: call((q: any) => ({ data: prices.filter((p) => q.lookup_keys.includes(p.lookup_key) && p.active === q.active), has_more: false })),
      create: call((q: any) => {
        if (q.transfer_lookup_key) for (const p of prices) if (p.lookup_key === q.lookup_key) p.lookup_key = null;
        const p = { id: id("price"), active: true, currency: q.currency, unit_amount: q.unit_amount, type: "recurring", recurring: { interval: q.recurring.interval, interval_count: q.recurring.interval_count ?? 1 }, product: q.product, lookup_key: q.lookup_key, metadata: q.metadata };
        prices.push(p);
        return p;
      }),
    },
    products: {
      list: call(() => ({ data: products.filter((p) => p.active), has_more: false })),
      create: call((q: any) => {
        const p = { id: id("prod"), active: true, ...q };
        products.push(p);
        return p;
      }),
    },
    webhookEndpoints: {
      list: call(() => ({ data: endpoints, has_more: false })),
      create: call((q: any) => {
        const e = { id: id("we"), status: "enabled", secret: "whsec_shown_once_SECRET", ...q };
        endpoints.push(e);
        return e;
      }),
      update: call((eid: string, q: any) => {
        const e = endpoints.find((x) => x.id === eid);
        e.enabled_events = q.enabled_events;
        if (q.disabled === false) e.status = "enabled";
        return e;
      }),
    },
    billingPortal: {
      configurations: {
        list: call((q: any = {}) => ({ data: portals.filter((c) => (q.is_default === undefined || c.is_default === q.is_default) && (q.active === undefined || c.active === q.active)), has_more: false })),
        retrieve: call((cid: string) => {
          const c = portals.find((x) => x.id === cid);
          if (!c) throw new Error(`No such configuration: '${cid}'`);
          return c;
        }),
        create: call((q: any) => {
          const c = { id: id("bpc"), active: true, is_default: false, ...q };
          portals.push(c);
          return c;
        }),
      },
    },
    events: {
      list: call((q: any) => ({ data: events.filter((e) => e.created >= q.created.gte && q.types.includes(e.type)).sort((a, b) => b.created - a.created), has_more: false })),
    },
  };
  return { stripe: stripe as unknown as Stripe, prices, products, endpoints, portals, events, calls: () => calls };
}

const saved = {
  secretKey: config.stripe.secretKey,
  webhookSecret: config.stripe.webhookSecret,
  portal: config.subscriptions.portalConfigurationId,
  plans: config.subscriptions.plans.map((p) => ({ ...p })),
};
beforeEach(() => {
  config.stripe.secretKey = "sk_test_fake_not_used";
  config.stripe.webhookSecret = "whsec_local_test_secret";
  config.subscriptions.portalConfigurationId = "";
  for (const p of config.subscriptions.plans) Object.assign(p, { stripePriceId: "", stripeProductId: "" });
});
afterEach(() => {
  config.stripe.secretKey = saved.secretKey;
  config.stripe.webhookSecret = saved.webhookSecret;
  config.subscriptions.portalConfigurationId = saved.portal;
  config.subscriptions.plans.forEach((p, i) => Object.assign(p, saved.plans[i]));
});

/** Puts setup's output in the config, as an operator would in the environment. */
function apply(env: Record<string, string>) {
  for (const p of config.subscriptions.plans) {
    p.stripePriceId = env[`STRIPE_PRICE_${p.id.toUpperCase()}`];
    p.stripeProductId = env[`STRIPE_PRODUCT_${p.id.toUpperCase()}`];
  }
  config.subscriptions.portalConfigurationId = env.STRIPE_PORTAL_CONFIGURATION_ID;
}
const fails = (findings: { level: string; what: string }[]) => findings.filter((f) => f.level === "fail").map((f) => f.what);
const URL = "https://staging.example.com/api/billing/stripe/webhook";

describe("Stripe test-mode tool", () => {
  it("only accepts test-mode keys, and refuses before calling Stripe", async () => {
    for (const k of ["sk_test_abc", "rk_test_abc"]) expect(() => assertTestKey(k)).not.toThrow();
    for (const k of ["sk_live_abc", "rk_live_abc", "pk_test_abc", ""]) expect(() => assertTestKey(k)).toThrow(/test-mode key/);
    const acct = fakeAccount();
    config.stripe.secretKey = "sk_live_not_real";
    await expect(checkTestMode(acct.stripe)).rejects.toThrow(/never runs against live mode/);
    await expect(setupTestMode(acct.stripe)).rejects.toThrow(/never runs against live mode/);
    await expect(relayOnce(acct.stripe, { since: 0, done: new Set(), attempts: new Map() }, { to: "http://localhost:4000/x", secret: "whsec_x" })).rejects.toThrow(/live mode/);
    expect(acct.calls()).toBe(0);
  });

  it("setup creates one monthly EUR price per plan and a portal configuration that matches the policy, and reuses them on a rerun", async () => {
    const acct = fakeAccount();
    const first = await setupTestMode(acct.stripe);
    expect(fails(first.findings)).toEqual([]);
    expect(acct.prices.map((p) => [p.unit_amount, p.currency, p.recurring.interval, p.lookup_key])).toEqual([
      [2900, "eur", "month", "ensemblis_starter_monthly_eur_2900"],
      [9900, "eur", "month", "ensemblis_growth_monthly_eur_9900"],
      [29900, "eur", "month", "ensemblis_business_monthly_eur_29900"],
    ]);
    expect(acct.products).toHaveLength(3);
    expect(acct.portals).toHaveLength(1);
    expect(portalProblems(acct.portals[0])).toEqual([]);
    expect(acct.portals[0].features.subscription_update.enabled).toBe(false);
    expect(acct.portals[0].features.subscription_cancel.mode).toBe("at_period_end");
    expect(Object.keys(first.env).sort()).toEqual(["STRIPE_PORTAL_CONFIGURATION_ID", "STRIPE_PRICE_BUSINESS", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_STARTER", "STRIPE_PRODUCT_BUSINESS", "STRIPE_PRODUCT_GROWTH", "STRIPE_PRODUCT_STARTER"]);

    const second = await setupTestMode(acct.stripe);
    expect(second.env).toEqual(first.env);
    expect([acct.prices.length, acct.products.length, acct.portals.length]).toEqual([3, 3, 1]);
  });

  it("a changed catalogue amount gets a new Price on the same product (amounts are immutable in Stripe)", async () => {
    const acct = fakeAccount();
    const before = (await setupTestMode(acct.stripe)).env;
    config.subscriptions.plans.find((p) => p.id === "starter")!.priceCents = 3900;
    const after = (await setupTestMode(acct.stripe)).env;
    expect(after.STRIPE_PRICE_STARTER).not.toBe(before.STRIPE_PRICE_STARTER);
    expect(after.STRIPE_PRODUCT_STARTER).toBe(before.STRIPE_PRODUCT_STARTER);
    expect(after.STRIPE_PRICE_GROWTH).toBe(before.STRIPE_PRICE_GROWTH);
    expect(acct.prices.find((p) => p.id === after.STRIPE_PRICE_STARTER)).toMatchObject({ unit_amount: 3900, lookup_key: lookupKeyFor({ id: "starter", priceCents: 3900 }) });
  });

  it("creates the webhook endpoint only when its signing secret can be saved, to a 0600 file, never in the output", async () => {
    const acct = fakeAccount();
    const refused = await setupTestMode(acct.stripe, { webhookUrl: URL });
    expect(fails(refused.findings).join()).toMatch(/--secret-file/);
    expect(acct.endpoints).toHaveLength(0);

    const file = join(mkdtempSync(join(tmpdir(), "stripe-test-")), "whsec");
    const made = await setupTestMode(acct.stripe, { webhookUrl: URL, secretFile: file });
    expect(fails(made.findings)).toEqual([]);
    expect(acct.endpoints).toHaveLength(1);
    expect(acct.endpoints[0]).toMatchObject({ url: URL, api_version: TESTED_API_VERSION });
    expect([...acct.endpoints[0].enabled_events].sort()).toEqual([...STRIPE_WEBHOOK_EVENTS].sort());
    expect(readFileSync(file, "utf8").trim()).toBe("whsec_shown_once_SECRET");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(made)).not.toContain("whsec_shown_once_SECRET");

    const again = await setupTestMode(acct.stripe, { webhookUrl: URL, secretFile: file });
    expect(fails(again.findings)).toEqual([]);
    expect(acct.endpoints).toHaveLength(1);
  });

  it("setup adds missing events to an existing endpoint and re-enables it", async () => {
    const acct = fakeAccount();
    acct.endpoints.push({ id: "we_old", url: URL, status: "disabled", enabled_events: ["checkout.session.completed", "charge.refunded"], api_version: null });
    await setupTestMode(acct.stripe, { webhookUrl: URL });
    expect(acct.endpoints[0].status).toBe("enabled");
    expect(missingEvents(acct.endpoints[0].enabled_events)).toEqual([]);
    expect(acct.endpoints[0].enabled_events).toContain("charge.refunded"); // kept
  });

  it("check passes on what setup made and names each problem otherwise", async () => {
    const acct = fakeAccount();
    const file = join(mkdtempSync(join(tmpdir(), "stripe-test-")), "whsec");
    const { env } = await setupTestMode(acct.stripe, { webhookUrl: URL, secretFile: file });
    apply(env);
    expect(fails(await checkTestMode(acct.stripe, { webhookUrl: URL }))).toEqual([]);

    config.subscriptions.plans.find((p) => p.id === "growth")!.priceCents = 10900; // catalogue and Stripe disagree
    config.subscriptions.plans.find((p) => p.id === "business")!.stripePriceId = ""; // not configured
    acct.endpoints[0].enabled_events = acct.endpoints[0].enabled_events.filter((e: string) => e !== "invoice.paid");
    acct.portals[0].features.subscription_update = { enabled: true };
    config.stripe.webhookSecret = "";
    const problems = fails(await checkTestMode(acct.stripe, { webhookUrl: URL }));
    expect(problems).toEqual([
      expect.stringMatching(/^Growth: price_\w+ doesn't match the catalogue \(amount 9900 instead of 10900\)/),
      "Business: STRIPE_PRICE_BUSINESS is not set",
      "STRIPE_WEBHOOK_SECRET is not set (whsec_…)",
      `endpoint ${URL} doesn't send: invoice.paid`,
      expect.stringMatching(/plan switching is on/),
    ]);
    expect(fails(await checkTestMode(acct.stripe, { webhookUrl: "https://other.example.com/hook" }))).toContain("no webhook endpoint for https://other.example.com/hook");
  });

  it("check reports a missing portal configuration and a price shared by two plans", async () => {
    const acct = fakeAccount();
    const { env } = await setupTestMode(acct.stripe);
    apply({ ...env, STRIPE_PRICE_GROWTH: env.STRIPE_PRICE_STARTER, STRIPE_PORTAL_CONFIGURATION_ID: "" });
    acct.portals.length = 0;
    const problems = fails(await checkTestMode(acct.stripe));
    expect(problems).toContain("Growth: STRIPE_PRICE_GROWTH is the same Price as Starter");
    expect(problems.join()).toMatch(/no configuration in test mode/);
  });

  it("portal policy: immediate cancellation, no card updates or no invoices are problems; no cancellation at all is fine", () => {
    const base = { active: true, features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: "at_period_end" }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } } as any;
    expect(portalProblems(base)).toEqual([]);
    expect(portalProblems({ ...base, features: { ...base.features, subscription_cancel: { enabled: false, mode: "immediately" } } })).toEqual([]);
    expect(portalProblems({ ...base, features: { ...base.features, subscription_cancel: { enabled: true, mode: "immediately" } } })).toEqual([expect.stringMatching(/immediate/)]);
    expect(portalProblems({ active: false, features: { ...base.features, payment_method_update: { enabled: false }, invoice_history: { enabled: false } } })).toHaveLength(3);
  });

  it("relay delivers new events oldest first, signed for the local endpoint, once; it retries 5xx and refuses remote targets", async () => {
    expect(isLocalUrl("http://localhost:4000/a")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:4000/a")).toBe(true);
    expect(isLocalUrl("https://api.ensemblis.com/a")).toBe(false);
    const acct = fakeAccount();
    await expect(relayOnce(acct.stripe, { since: 0, done: new Set(), attempts: new Map() }, { to: "https://api.ensemblis.com/api/billing/stripe/webhook", secret: "whsec_x" })).rejects.toThrow(/only delivers to this machine/);

    acct.events.push(
      { id: "evt_old", type: "invoice.paid", created: 50, livemode: false, data: { object: {} } },
      { id: "evt_2", type: "invoice.paid", created: 120, livemode: false, data: { object: {} } },
      { id: "evt_1", type: "customer.subscription.created", created: 110, livemode: false, data: { object: {} } },
      { id: "evt_ignored", type: "charge.succeeded", created: 130, livemode: false, data: { object: {} } }
    );
    const received: string[] = [];
    let answer = 200;
    const post = async (_url: string, body: string, signature: string) => {
      const e = Stripe.webhooks.constructEvent(body, signature, "whsec_local_test_secret"); // a real signature check
      received.push(e.id);
      return e.id === "evt_2" ? answer : 200;
    };
    const state: RelayState = { since: 100, done: new Set(), attempts: new Map() };
    const opts = { to: "http://localhost:4000/api/billing/stripe/webhook", secret: config.stripe.webhookSecret, post };
    answer = 500;
    expect((await relayOnce(acct.stripe, state, opts)).map((r) => [r.id, r.status])).toEqual([["evt_1", 200], ["evt_2", 500]]);
    answer = 200;
    expect((await relayOnce(acct.stripe, state, opts)).map((r) => r.id)).toEqual(["evt_2"]); // retried, evt_1 not resent
    expect(await relayOnce(acct.stripe, state, opts)).toEqual([]);
    expect(received).toEqual(["evt_1", "evt_2", "evt_2"]);

    acct.events.push({ id: "evt_3", type: "invoice.paid", created: 140, livemode: false, data: { object: {} } });
    const failing = { ...opts, post: async () => 503 };
    for (let i = 0; i < 5; i++) await relayOnce(acct.stripe, state, failing);
    expect(state.done.has("evt_3")).toBe(true); // gave up after 5 attempts
    expect(await relayOnce(acct.stripe, state, failing)).toEqual([]);
  });

  it("plan configuration warnings are for the API only: the worker needs no Stripe settings", () => {
    const enabled = config.subscriptions.enabled;
    const key = config.stripe.secretKey;
    const render = process.env.RENDER;
    try {
      process.env.RENDER = "true"; // warnings are only produced on a hosted server
      config.subscriptions.enabled = true;
      config.stripe.secretKey = "";
      const plansWarning = (w: string) => /SUBSCRIPTIONS_ENABLED|Subscriptions are on/.test(w);
      expect(productionConfigWarnings("api").some(plansWarning)).toBe(true);
      expect(productionConfigWarnings("worker").some(plansWarning)).toBe(false);
    } finally {
      if (render === undefined) delete process.env.RENDER;
      else process.env.RENDER = render;
      config.subscriptions.enabled = enabled;
      config.stripe.secretKey = key;
    }
  });
});
