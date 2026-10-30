// A local stand-in for the parts of the Stripe API that Ensemblis subscriptions use, for the Playwright E2E
// stack (scripts/e2e-stack.mjs with E2E_STRIPE=1) and manual runs without network access or Stripe keys.
// It is a STUB: no card is charged, nothing reaches Stripe, and its "hosted checkout" page says so.
//
//   node scripts/stripe-stub.mjs [port] [webhookUrl] [webhookSecret]
//
// The API reaches it through STRIPE_API_BASE=http://127.0.0.1:<port> (billing/stripeClient.ts). It answers:
//   POST /v1/customers, GET /v1/prices/:id, POST /v1/checkout/sessions, POST /v1/checkout/sessions/:id/expire,
//   GET|POST /v1/subscriptions/:id, GET /v1/invoices/:id, POST /v1/billing_portal/sessions
// and serves the pages a customer would see at Stripe:
//   GET /checkout/:id (Pay / Cancel), GET /portal/:customer (Return to Ensemblis).
// Paying sends the events Stripe would send (checkout.session.completed, customer.subscription.created,
// invoice.paid) to the webhook URL, signed with the webhook secret exactly as Stripe signs them, so the
// API's real signature check and handlers run. Test controls: POST /__stub/renew/:subscription?paid=0|1.

import http from "node:http";
import crypto from "node:crypto";

const DAY = 86_400;
const PRICES = {
  price_stub_starter: { cents: Number(process.env.PLAN_STARTER_PRICE_CENTS) || 2900, name: "Starter" },
  price_stub_growth: { cents: Number(process.env.PLAN_GROWTH_PRICE_CENTS) || 9900, name: "Growth" },
  price_stub_business: { cents: Number(process.env.PLAN_BUSINESS_PRICE_CENTS) || 29900, name: "Business" },
};
export const STUB_PRICE_IDS = { starter: "price_stub_starter", growth: "price_stub_growth", business: "price_stub_business" };

const now = () => Math.floor(Date.now() / 1000);
let seq = 0;
const id = (p) => `${p}_stub${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Stripe's form encoding (a[b][0][c]=v) back into an object. */
function parseForm(body) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const path = rawKey.split(/\[|\]\[|\]/).filter((k) => k !== "");
    let cur = out;
    path.forEach((k, i) => {
      if (i === path.length - 1) cur[k] = value;
      else cur = cur[k] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}

function price(pid) {
  const p = PRICES[pid];
  if (!p) return null;
  return { id: pid, object: "price", active: true, currency: "eur", unit_amount: p.cents, type: "recurring", recurring: { interval: "month", interval_count: 1 }, product: `prod_stub_${p.name.toLowerCase()}`, nickname: p.name };
}

export async function startStripeStub(port = 4197, opts = {}) {
  const webhookUrl = opts.webhookUrl ?? process.env.STRIPE_STUB_WEBHOOK_URL;
  const secret = opts.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  const customers = new Map();
  const sessions = new Map();
  const subscriptions = new Map();
  const invoices = new Map();
  let base = "";

  const event = (type, object) => ({ id: id("evt"), object: "event", type, created: now(), api_version: "2025-02-24.acacia", livemode: false, data: { object: structuredClone(object) } });
  async function send(events) {
    for (const e of events) {
      const payload = JSON.stringify(e);
      const t = now();
      const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
      const r = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` }, body: payload });
      if (!r.ok) console.warn(`[stripe-stub] webhook ${e.type} answered ${r.status}`);
    }
  }
  function invoice(sub, reason, lines, paid) {
    const total = lines.reduce((n, l) => n + l.amount, 0);
    const inv = {
      id: id("in"),
      object: "invoice",
      subscription: sub.id,
      customer: sub.customer,
      billing_reason: reason,
      status: paid ? "paid" : "open",
      amount_due: total,
      amount_paid: paid ? total : 0,
      attempt_count: 1,
      lines: { object: "list", data: lines.map((l) => ({ id: id("il"), object: "line_item", amount: l.amount, price: price(l.price), proration: !!l.proration, period: { start: l.start, end: l.end } })) },
    };
    invoices.set(inv.id, inv);
    return inv;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = parseForm(Buffer.concat(chunks).toString());
    const json = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const notFound = () => json(404, { error: { type: "invalid_request_error", message: `No such object: ${url.pathname}` } });
    const html = (markup) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe test stub</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:440px;margin:48px auto;padding:0 16px;color:#1a1f36}
.box{border:1px solid #e3e8ee;border-radius:12px;padding:24px}.warn{background:#fff4e5;border-radius:8px;padding:10px 12px;font-size:14px}
button,a.btn{display:inline-block;margin:16px 8px 0 0;padding:10px 18px;border-radius:8px;border:0;font:inherit;cursor:pointer;text-decoration:none}
.pay{background:#635bff;color:#fff}.cancel{background:#e3e8ee;color:#1a1f36}</style><body><div class="box">${markup}</div></body></html>`);
    };
    const m = (re) => re.exec(url.pathname);
    let g;
    try {
      if (req.method === "POST" && url.pathname === "/v1/customers") {
        const c = { id: id("cus"), object: "customer", email: body.email, name: body.name, metadata: body.metadata ?? {} };
        customers.set(c.id, c);
        return json(200, c);
      }
      if (req.method === "GET" && (g = m(/^\/v1\/prices\/([^/]+)$/))) return price(g[1]) ? json(200, price(g[1])) : notFound();
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const sid = id("cs_test");
        const s = { id: sid, object: "checkout.session", status: "open", payment_status: "unpaid", url: `${base}/checkout/${sid}`, subscription: null, ...body };
        sessions.set(sid, s);
        return json(200, s);
      }
      if (req.method === "POST" && (g = m(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
        const s = sessions.get(g[1]);
        if (!s || s.status !== "open") return json(400, { error: { message: "Session is not open" } });
        s.status = "expired";
        await send([event("checkout.session.expired", s)]);
        return json(200, s);
      }
      if ((g = m(/^\/v1\/subscriptions\/([^/]+)$/))) {
        const sub = subscriptions.get(g[1]);
        if (!sub) return notFound();
        if (req.method === "POST") {
          if (body.cancel_at_period_end !== undefined) {
            sub.cancel_at_period_end = body.cancel_at_period_end === "true";
            sub.canceled_at = sub.cancel_at_period_end ? now() : null;
          }
          const newPrice = body.items?.[0]?.price;
          if (newPrice && price(newPrice)) {
            const old = sub.items.data[0].price;
            sub.items.data[0].price = price(newPrice);
            if (body.proration_behavior === "always_invoice") {
              const t = now();
              const share = (sub.current_period_end - t) / (sub.current_period_end - sub.current_period_start);
              const inv = invoice(sub, "subscription_update", [
                { price: old.id, amount: -Math.round(old.unit_amount * share), start: t, end: sub.current_period_end, proration: true },
                { price: newPrice, amount: Math.round(price(newPrice).unit_amount * share), start: t, end: sub.current_period_end, proration: true },
              ], true);
              setTimeout(() => send([event("customer.subscription.updated", sub), event("invoice.paid", inv)]), 200);
            } else {
              setTimeout(() => send([event("customer.subscription.updated", sub)]), 200);
            }
          } else {
            setTimeout(() => send([event("customer.subscription.updated", sub)]), 200);
          }
        }
        return json(200, sub);
      }
      if (req.method === "GET" && (g = m(/^\/v1\/invoices\/([^/]+)$/))) return invoices.get(g[1]) ? json(200, invoices.get(g[1])) : notFound();
      if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
        return json(200, { id: id("bps"), object: "billing_portal.session", customer: body.customer, return_url: body.return_url, url: `${base}/portal/${body.customer}?return=${encodeURIComponent(body.return_url ?? "")}` });
      }

      // ----- what the customer sees "at Stripe"
      if (req.method === "GET" && (g = m(/^\/checkout\/([^/]+)$/))) {
        const s = sessions.get(g[1]);
        if (!s) return notFound();
        const p = price(s.line_items?.[0]?.price);
        return html(`<p class="warn"><b>Stripe test stub.</b> Not a real payment: no card is charged and nothing reaches Stripe.</p>
<h1>Subscribe to Ensemblis ${p?.nickname ?? ""}</h1><p>€${((p?.unit_amount ?? 0) / 100).toFixed(2)} per month</p>
<form method="post" action="/checkout/${s.id}/pay"><button class="pay" type="submit">Pay (test)</button></form>
<form method="post" action="/checkout/${s.id}/cancel"><button class="cancel" type="submit">Cancel</button></form>`);
      }
      if (req.method === "POST" && (g = m(/^\/checkout\/([^/]+)\/(pay|cancel)$/))) {
        const s = sessions.get(g[1]);
        if (!s) return notFound();
        if (g[2] === "cancel" || s.status !== "open") {
          res.writeHead(303, { Location: s.cancel_url });
          return res.end();
        }
        const pid = s.line_items[0].price;
        const start = now();
        const sub = {
          id: id("sub"),
          object: "subscription",
          customer: s.customer,
          status: "active",
          cancel_at_period_end: false,
          canceled_at: null,
          ended_at: null,
          current_period_start: start,
          current_period_end: start + 30 * DAY,
          metadata: { ...(s.subscription_data?.metadata ?? {}) },
          items: { object: "list", data: [{ id: id("si"), object: "subscription_item", price: price(pid) }] },
          pending_update: null,
        };
        subscriptions.set(sub.id, sub);
        Object.assign(s, { status: "complete", payment_status: "paid", subscription: sub.id });
        const inv = invoice(sub, "subscription_create", [{ price: pid, amount: price(pid).unit_amount, start, end: start + 30 * DAY }], true);
        // Like Stripe: the redirect happens straight away, the webhooks arrive a moment later.
        res.writeHead(303, { Location: s.success_url });
        res.end();
        setTimeout(() => send([event("checkout.session.completed", s), event("customer.subscription.created", sub), event("invoice.paid", inv)]), 800);
        return;
      }
      if (req.method === "GET" && (g = m(/^\/portal\/([^/]+)$/))) {
        const back = url.searchParams.get("return") || "/";
        const subs = [...subscriptions.values()].filter((x) => x.customer === g[1]);
        return html(`<p class="warn"><b>Stripe test stub.</b> The real Customer Portal manages cards, invoices and cancellation.</p>
<h1>Billing</h1>${subs.map((x) => `<p>${x.items.data[0].price.nickname}: ${x.status}${x.cancel_at_period_end ? " (ends at renewal)" : ""}</p>`).join("")}
<a class="btn cancel" href="${back.replace(/"/g, "")}">Return to Ensemblis</a>`);
      }
      if (req.method === "POST" && (g = m(/^\/__stub\/renew\/([^/]+)$/))) {
        const sub = subscriptions.get(g[1]);
        if (!sub) return notFound();
        const paid = url.searchParams.get("paid") !== "0";
        const start = sub.current_period_end;
        Object.assign(sub, { current_period_start: start, current_period_end: start + 30 * DAY, status: paid ? "active" : "past_due" });
        const p = sub.items.data[0].price;
        const inv = invoice(sub, "subscription_cycle", [{ price: p.id, amount: p.unit_amount, start, end: start + 30 * DAY }], paid);
        await send([event(paid ? "invoice.paid" : "invoice.payment_failed", inv), event("customer.subscription.updated", sub)]);
        return json(200, { invoice: inv.id });
      }
      if (req.method === "GET" && url.pathname === "/__stub/subscriptions") return json(200, [...subscriptions.values()]);
      return notFound();
    } catch (err) {
      console.error("[stripe-stub]", err);
      return json(500, { error: { message: String(err) } });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 4197;
  const s = await startStripeStub(port, { webhookUrl: process.argv[3], webhookSecret: process.argv[4] });
  console.log(`[stripe-stub] listening on ${s.url}`);
}
