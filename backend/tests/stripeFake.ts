// A stateful stand-in for the Stripe API, for tests only: no network, no keys. It keeps customers, prices,
// Checkout Sessions, subscriptions and invoices in memory, answers the calls billing/*.ts makes, and builds
// the events Stripe would send. Events are signed with the real SDK (Stripe.webhooks), so the webhook's
// signature check is the real one.
import Stripe from "stripe";
import request from "supertest";
import { app } from "../src/index";

export const WEBHOOK_SECRET = "whsec_test_subscriptions";
export const PRICE_IDS = { starter: "price_test_starter", growth: "price_test_growth", business: "price_test_business" } as const;
export const PRICE_CENTS = { starter: 2900, growth: 9900, business: 29900 } as const;

const DAY = 86_400;
let seq = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;
const now = () => Math.floor(Date.now() / 1000);

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class FakeStripe {
  readonly client: Stripe;
  readonly calls: { method: string; args: unknown[] }[] = [];
  prices = new Map<string, Obj>();
  sessions = new Map<string, Obj>();
  subscriptions = new Map<string, Obj>();
  invoices = new Map<string, Obj>();
  customers = new Map<string, Obj>();
  /** Set to make the next call of that method throw (e.g. "checkout.sessions.create"). */
  failNext = new Set<string>();
  /** The default card fails (upgrade payments end up pending). */
  cardDeclines = false;
  private idem = new Map<string, unknown>();

  constructor() {
    const real = new Stripe("sk_test_fake_not_used");
    for (const [plan, price] of Object.entries(PRICE_IDS)) {
      this.prices.set(price, { id: price, object: "price", active: true, currency: "eur", unit_amount: PRICE_CENTS[plan as keyof typeof PRICE_CENTS], type: "recurring", recurring: { interval: "month", interval_count: 1 }, product: `prod_${plan}` });
    }
    const wrap = <A extends unknown[], R>(method: string, fn: (...a: A) => R) => async (...a: A) => {
      this.calls.push({ method, args: a });
      if (this.failNext.delete(method)) throw new Error(`simulated ${method} failure`);
      const opts = a[a.length - 1] as { idempotencyKey?: string } | undefined;
      const key = opts && typeof opts === "object" && "idempotencyKey" in opts ? `${method}:${opts.idempotencyKey}` : null;
      if (key && this.idem.has(key)) return this.idem.get(key) as R;
      const r = fn(...a);
      if (key) this.idem.set(key, r);
      return r;
    };
    const c = real as unknown as Obj;
    c.customers = { create: wrap("customers.create", (p: Obj) => this.put(this.customers, { id: id("cus"), object: "customer", ...p })) };
    c.prices = { retrieve: wrap("prices.retrieve", (pid: string) => this.get(this.prices, pid)) };
    c.checkout = {
      sessions: {
        create: wrap("checkout.sessions.create", (p: Obj) => {
          const sid = id("cs_test");
          return this.put(this.sessions, { id: sid, object: "checkout.session", status: "open", payment_status: "unpaid", url: `https://checkout.stripe.test/${sid}`, subscription: null, ...p });
        }),
        expire: wrap("checkout.sessions.expire", (sid: string) => {
          const s = this.get(this.sessions, sid);
          if (s.status !== "open") throw new Error("session is not open");
          s.status = "expired";
          return s;
        }),
      },
    };
    c.subscriptions = {
      retrieve: wrap("subscriptions.retrieve", (sid: string) => structuredClone(this.get(this.subscriptions, sid))),
      update: wrap("subscriptions.update", (sid: string, p: Obj) => structuredClone(this.updateSubscription(sid, p))),
    };
    c.invoices = { retrieve: wrap("invoices.retrieve", (iid: string) => structuredClone(this.get(this.invoices, iid))) };
    c.billingPortal = { sessions: { create: wrap("billingPortal.sessions.create", (p: Obj) => ({ id: id("bps"), object: "billing_portal.session", url: `https://billing.stripe.test/${p.customer}`, ...p })) } };
    this.client = real;
  }

  private put(m: Map<string, Obj>, o: Obj) {
    m.set(o.id, o);
    return o;
  }
  private get(m: Map<string, Obj>, key: string) {
    const o = m.get(key);
    if (!o) throw Object.assign(new Error(`No such object: ${key}`), { statusCode: 404 });
    return o;
  }

  // ------------------------------------------------------------------ what a customer or Stripe does

  /** The customer pays on the hosted page: subscription + first invoice, paid. Returns Stripe's events. */
  completeCheckout(sessionId: string, opts: { paid?: boolean } = {}): Obj[] {
    const s = this.get(this.sessions, sessionId);
    const price = s.line_items[0].price as string;
    const start = now();
    const sub = this.put(this.subscriptions, {
      id: id("sub"),
      object: "subscription",
      customer: s.customer,
      status: opts.paid === false ? "incomplete" : "active",
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      current_period_start: start,
      current_period_end: start + 30 * DAY,
      metadata: { ...(s.subscription_data?.metadata ?? {}) },
      items: { object: "list", data: [{ id: id("si"), object: "subscription_item", price: this.get(this.prices, price) }] },
      pending_update: null,
    });
    s.status = "complete";
    s.payment_status = opts.paid === false ? "unpaid" : "paid";
    s.subscription = sub.id;
    const inv = this.invoice(sub, "subscription_create", [{ price, amount: this.get(this.prices, price).unit_amount, start, end: start + 30 * DAY, proration: false }], opts.paid !== false);
    return [
      this.event("checkout.session.completed", s),
      this.event("customer.subscription.created", sub),
      this.event(opts.paid === false ? "invoice.payment_failed" : "invoice.paid", inv),
    ];
  }

  /** Stripe bills the next period: paid (active) or failed (past_due). */
  renew(subId: string, opts: { paid: boolean }): { events: Obj[]; invoice: Obj } {
    const sub = this.get(this.subscriptions, subId);
    const start = sub.current_period_end;
    sub.current_period_start = start;
    sub.current_period_end = start + 30 * DAY;
    sub.status = opts.paid ? "active" : "past_due";
    const price = sub.items.data[0].price;
    const inv = this.invoice(sub, "subscription_cycle", [{ price: price.id, amount: price.unit_amount, start, end: start + 30 * DAY, proration: false }], opts.paid);
    return { invoice: inv, events: [this.event(opts.paid ? "invoice.paid" : "invoice.payment_failed", inv), this.event("customer.subscription.updated", sub)] };
  }

  /** A failed renewal invoice that Stripe later collects. */
  payInvoice(invoiceId: string): Obj[] {
    const inv = this.get(this.invoices, invoiceId);
    inv.status = "paid";
    inv.amount_paid = inv.amount_due;
    const sub = this.get(this.subscriptions, inv.subscription);
    sub.status = "active";
    return [this.event("invoice.paid", inv), this.event("customer.subscription.updated", sub)];
  }

  /** The subscription ends (period over after a cancellation, or retries exhausted). */
  end(subId: string): Obj[] {
    const sub = this.get(this.subscriptions, subId);
    sub.status = "canceled";
    sub.ended_at = now();
    sub.canceled_at = sub.canceled_at ?? now();
    return [this.event("customer.subscription.deleted", sub)];
  }

  /** Events produced by the last upgrade (the paid prorated invoice). */
  upgradeEvents: Obj[] = [];

  private updateSubscription(subId: string, p: Obj): Obj {
    const sub = this.get(this.subscriptions, subId);
    if ("cancel_at_period_end" in p) {
      sub.cancel_at_period_end = !!p.cancel_at_period_end;
      sub.canceled_at = p.cancel_at_period_end ? now() : null;
    }
    if (p.items) {
      const newPrice = this.get(this.prices, p.items[0].price);
      const oldPrice = sub.items.data[0].price;
      if (p.proration_behavior === "always_invoice") {
        if (this.cardDeclines && p.payment_behavior === "pending_if_incomplete") {
          sub.pending_update = { subscription_items: [{ price: newPrice.id }] };
          return sub;
        }
        const t = now();
        const share = (sub.current_period_end - t) / (sub.current_period_end - sub.current_period_start);
        sub.items.data[0].price = newPrice;
        const inv = this.invoice(
          sub,
          "subscription_update",
          [
            { price: oldPrice.id, amount: -Math.round(oldPrice.unit_amount * share), start: t, end: sub.current_period_end, proration: true },
            { price: newPrice.id, amount: Math.round(newPrice.unit_amount * share), start: t, end: sub.current_period_end, proration: true },
          ],
          true
        );
        this.upgradeEvents = [this.event("customer.subscription.updated", sub), this.event("invoice.paid", inv)];
      } else {
        sub.items.data[0].price = newPrice; // proration "none": billed from the next renewal
      }
    }
    return sub;
  }

  private invoice(sub: Obj, reason: string, lines: { price: string; amount: number; start: number; end: number; proration: boolean }[], paid: boolean): Obj {
    const total = lines.reduce((n, l) => n + l.amount, 0);
    return this.put(this.invoices, {
      id: id("in"),
      object: "invoice",
      subscription: sub.id,
      customer: sub.customer,
      billing_reason: reason,
      status: paid ? "paid" : "open",
      amount_due: total,
      amount_paid: paid ? total : 0,
      attempt_count: 1,
      lines: { object: "list", data: lines.map((l) => ({ id: id("il"), object: "line_item", amount: l.amount, price: this.get(this.prices, l.price), proration: l.proration, period: { start: l.start, end: l.end } })) },
    });
  }

  event(type: string, object: Obj, eventId = id("evt")): Obj {
    return { id: eventId, object: "event", type, created: now(), api_version: "2025-02-24.acacia", livemode: false, data: { object: structuredClone(object) } };
  }
}

/** Delivers an event to the real webhook endpoint, signed like Stripe signs it (or with a wrong secret). */
export async function deliver(event: Obj, opts: { secret?: string } = {}) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET });
  return request(app).post("/api/billing/stripe/webhook").set("Content-Type", "application/json").set("Stripe-Signature", header).send(payload);
}

export async function deliverAll(events: Obj[]) {
  for (const e of events) {
    const r = await deliver(e);
    if (r.status !== 200) throw new Error(`webhook ${e.type} answered ${r.status}: ${JSON.stringify(r.body)}`);
  }
}
