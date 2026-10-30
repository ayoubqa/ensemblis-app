# Monthly plans: Stripe test-mode validation

This is the run that must pass before `SUBSCRIPTIONS_ENABLED` is turned on in production. It checks the parts
that the automated tests can't: real Checkout, real webhook payloads, the Customer Portal and renewals
driven by test clocks. Those automated tests are `tests/integration/subscriptions.test.ts`, run against a
fake Stripe, and the opt-in browser journey, run against `scripts/stripe-stub.mjs`.

**Status: partly run (2026-10-30), see section 6.** The run was in Stripe test mode, through the Stripe connector, against account `acct_1UVzu9JxdXxCrKwI`.
- **Executed:**
  - Checkout Session creation;
  - first payment, paid and failed;
  - a €0 first invoice;
  - upgrade, paid and declined;
  - downgrade and keep;
  - cancel and keep;
  - portal configuration and session.

  The app's handling of Stripe's real answers was replayed in `tests/integration/stripeTestModeReplay.test.ts`.
- **Not executed:**
  - renewals (the connector can't advance test clocks);
  - the hosted Checkout and portal pages;
  - real webhook delivery;
  - the app talking to Stripe itself (the dev environment still can't reach `api.stripe.com`).

## Ground rules

- **Mode:** use **test mode only**. Use a `sk_test_…` key, or a restricted `rk_test_…` key with the
  permissions listed below.
  - The tool (`npm run ops:stripe-test`) refuses any other key.
  - The webhook answers 400 to an event whose mode doesn't match its key.
- **Secrets:** put keys in the environment's secret settings, never in chat, tickets or commits. The tool never
  prints a key, and a new webhook signing secret is written to a file with mode 600.
- **Environment:** run this on a **non-production** environment, either staging or a local machine. Production keeps
  `SUBSCRIPTIONS_ENABLED` unset, so plans stay hidden there and nothing in this run changes production.
- **Accounts:** use a fresh app account for each journey below. One account holds at most one plan.

## 1. What has to exist

### Stripe test-mode objects

| Object | Exact configuration | Created by |
|---|---|---|
| Product + Price, Starter | Recurring, **monthly**, **EUR**, **€29.00** (2900). Lookup key `ensemblis_starter_monthly_eur_2900` | `setup`, or the Dashboard |
| Product + Price, Growth | Recurring, monthly, EUR, **€99.00** (9900). Lookup key `ensemblis_growth_monthly_eur_9900` | `setup`, or the Dashboard |
| Product + Price, Business | Recurring, monthly, EUR, **€299.00** (29900). Lookup key `ensemblis_business_monthly_eur_29900` | `setup`, or the Dashboard |
| Webhook endpoint (staging only) | `https://<staging-api>/api/billing/stripe/webhook`, API version `2025-02-24.acacia`, with the 13 events below | `setup --webhook-url`, or the Dashboard |
| Customer Portal configuration | Payment-method updates **on**; invoice history **on**; cancellation **at period end** (or off); plan switching (subscription update) **off** | `setup` (a separate configuration; the default one is left alone) |
| Failed-payment settings | Settings → Billing → Subscriptions and emails: a retry schedule, and **"cancel the subscription"** when retries run out | Dashboard only (no API) |
| Test clocks | Created during the renewal tests (section 4) | Dashboard |

The amounts are the catalogue's (`backend/src/config.ts`, overridable with `PLAN_*_PRICE_CENTS`).
Checkout refuses any Price that differs in amount, currency, interval or (when `STRIPE_PRODUCT_*` is set)
product.

**The webhook endpoint must send these events.** This is the list `STRIPE_WEBHOOK_EVENTS` in
`backend/src/billing/subscriptions.ts`. Credit packs use the `checkout.session` ones.

```
checkout.session.completed            customer.subscription.created
checkout.session.async_payment_succeeded  customer.subscription.updated
checkout.session.async_payment_failed customer.subscription.deleted
checkout.session.expired              customer.subscription.paused
invoice.paid                          customer.subscription.resumed
invoice.payment_failed                customer.subscription.pending_update_applied
                                      customer.subscription.pending_update_expired
```

### Restricted key permissions (optional)

If you use an `rk_test_` key instead of `sk_test_`, give it:
- **Write:** Checkout Sessions, Customers, Subscriptions, Customer portal, Products, Prices, Webhook endpoints;
- **Read:** Invoices, Events.

`setup` alone needs Products, Prices, Webhook endpoints and Customer portal. The API needs the rest.

### Environment variables

| Variable | API | Worker | Frontend | Value for this run |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | ✔ | – | – | `sk_test_…` / `rk_test_…` (secret) |
| `STRIPE_WEBHOOK_SECRET` | ✔ | – | – | `whsec_…` of the staging endpoint, or any `whsec_…` value on a local machine using the relay (secret) |
| `SUBSCRIPTIONS_ENABLED` | ✔ | – | – | `true` (staging/local only) |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_BUSINESS` | ✔ | – | – | the three `price_…` IDs |
| `STRIPE_PRODUCT_STARTER`, `…_GROWTH`, `…_BUSINESS` | ✔ (optional) | – | – | the three `prod_…` IDs (checkout then also checks the product) |
| `STRIPE_PORTAL_CONFIGURATION_ID` | ✔ (optional) | – | – | the `bpc_…` ID from `setup`; unset uses the account's default portal configuration |
| `APP_URL` | ✔ | ✔ | – | the frontend URL; Checkout and the portal return there |
| `SUBSCRIPTION_PAST_DUE_ACCESS` | ✔ | ✔ | – | `keep` (default) or `revoke`; **same value on both** |
| `PLAN_*_PRICE_CENTS`, `PLAN_*_CREDITS` | ✔ | – | – | only if you change the catalogue |
| `PLAN_*_RUNS_PER_DAY`, `MAX_TASKS_PER_USER_PER_DAY` | ✔ | ✔ | – | only if you change them; **same values on both** |
| `RATE_LIMIT_CHECKOUT_PER_MIN` | ✔ | – | – | default 10 |

- **Worker:** it never calls Stripe. It applies plan limits from the subscription rows (plan id and status)
  that the API keeps in sync, and expires ended allowances. That is why it needs no Stripe key and no Price IDs.
- **Frontend:** it needs nothing new; it reads `GET /api/config`.

## 2. Pick a route

- **A. Staging, recommended before production.** Use a deployed API with a public URL. Stripe delivers
  webhooks to the endpoint, so this also proves the endpoint's configuration and signing secret.
- **B. Local machine.** Stripe can't reach `localhost`, so `npm run ops:stripe-test -- relay` forwards the
  account's events to the local API, signed with its `STRIPE_WEBHOOK_SECRET`, like `stripe listen`.
  - This proves the app's handling of real Stripe events.
  - It doesn't prove a real endpoint's configuration: run `check --webhook-url` against staging before production.

On either route, the machine needs outbound HTTPS to `api.stripe.com`. The browser also needs
`checkout.stripe.com` and `billing.stripe.com`.

## 3. Configure and check

Run these from `backend/`, with the test key and the variables above in the environment.

| # | Step | Expected |
|---|---|---|
| C1 | `npm run ops:stripe-test -- check` | Exit 1 with **✘** lines naming what is missing (expected before setup). It prints the test-mode account ID: confirm it is the right sandbox. |
| C2 | `npm run ops:stripe-test -- setup` (route A: add `--webhook-url https://<staging-api>/api/billing/stripe/webhook --secret-file ./whsec.txt`) | The products, prices and portal configuration are created, and the `STRIPE_PRICE_*`, `STRIPE_PRODUCT_*` and `STRIPE_PORTAL_CONFIGURATION_ID` lines are printed. Route A also creates the endpoint and saves its secret to `whsec.txt` (mode 600). The secret is never printed. A second run reuses everything. |
| C3 | Set the printed IDs, `STRIPE_WEBHOOK_SECRET` (from the file) and `SUBSCRIPTIONS_ENABLED=true` on the API; set the Dashboard failed-payment settings; restart. Delete `whsec.txt` once its value is stored. | The API boot log has no `subscription` warnings. |
| C4 | `npm run ops:stripe-test -- check` (route A: add `--webhook-url …`) | Every line **✔**: three prices at €29/€99/€299 a month, the endpoint sends every event, the portal matches the policy. Exit 0. |
| C5 | `GET <api>/api/config` | `subscriptionsEnabled: true`; three plans, each `available: true`, with the amounts and credits above. No `price_`/`prod_` IDs in the response. |
| C6 | Route B only: `npm run ops:stripe-test -- relay` in a second terminal | `Relaying test-mode events to http://localhost:4000/…`. Keep it running for section 4. |

## 4. Journeys

Use these test cards, with any future expiry, any CVC and any postcode:

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0025 0000 3155` | requires 3-D Secure authentication |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 0341` | can be saved, but charges to it fail (for failed renewals and upgrades) |

**Checking the database.** "Ledger" means the account's `Transaction` rows. "Plan row" means its latest
`Subscription` row. Useful queries (staging database):

```sql
SELECT "createdAt", reason, amount, "allowanceCents", "idempotencyKey" FROM "Transaction"
  WHERE "userId" = (SELECT id FROM "User" WHERE email = '<email>') ORDER BY "createdAt";
SELECT "planId", status, "allowanceCredits", "currentPeriodEnd", "cancelAtPeriodEnd", "nextPlanId"
  FROM "Subscription" WHERE "walletUserId" = (SELECT id FROM "User" WHERE email = '<email>') ORDER BY "createdAt" DESC LIMIT 1;
```

| # | Journey | Expected |
|---|---|---|
| J1 | New account → /pricing → **Starter** → pay with `4242…` | Stripe's hosted Checkout shows €29.00 a month. Back on Usage it says "Confirming your payment with Stripe…", then "Your Starter plan is active: 3,000 credits added."<br>**Ledger:** one `subscription_allowance` row of +3000 with key `allowance:in_…`.<br>**Plan row:** `active`, `allowanceCredits` 3000.<br>**Stripe:** the subscription is active and the invoice paid €29.00. |
| J2 | Redeliver J1's events. Route A: Dashboard → Webhooks → the `invoice.paid` event → Resend. Route B: restart the relay with `--since-minutes 30`. | Each redelivery gets 200, and there is **no second grant** (the ledger is unchanged). |
| J3 | New account → Growth → `4000 0025 0000 3155` → complete 3-D Secure | As J1, with 15,000 credits and €99.00. |
| J4 | New account → Starter → `4000 0000 0000 0002` | Checkout shows the decline; no subscription, no credits. Leave the page: within an hour the link expires (`checkout.session.expired`) and the plan row is `checkout_expired`. |
| J5 | J1's account → Usage → Cancel → confirm | "Your plan won't renew."; status shows "Ends on <date>; it won't renew."<br>**Stripe:** `cancel_at_period_end: true`.<br>The credits stay.<br>Then **Keep** → "Your Starter plan will renew." and Stripe `cancel_at_period_end: false`. |
| J6 | J1's account → Upgrade to **Growth** | Stripe charges a prorated invoice (≈ €70 × the share of the month left).<br>**Usage:** Growth.<br>**Ledger:** +(12,000 × share left) as `subscription_allowance` with its own `allowance:in_…` key, never a second 15,000.<br>**Daily limit:** 15 executions per person. |
| J7 | J6's account → Manage billing → make `4000 0000 0000 0341` the default card → Upgrade to **Business** | 402: "Your card couldn't be charged for the upgrade to Business, so your plan hasn't changed…".<br>**Stripe:** the subscription keeps the Growth price (the pending update isn't applied).<br>**Ledger:** no extra credits.<br>Checkout saves the first card on the subscription itself. If Stripe still charges that card, set `0341` on the subscription in the Dashboard. |
| J8 | An account on Growth with a working card → Downgrade to **Starter** | "Changes to Starter at the next renewal (<date>)."<br>**Stripe:** the subscription item is now on the Starter price, with no invoice and no credit (`proration_behavior: none`). The upcoming invoice is €29.00.<br>**App:** Growth and its allowance and limits stay until the renewal.<br>**Keep Growth** puts the Growth price back, again without proration. |
| J9 | Any plan account → **Manage billing** | It opens `billing.stripe.com` with update card and invoice history, **no plan switching**, and cancellation at period end.<br>Cancelling there → back on Usage: "Ends on <date>" (via `customer.subscription.updated`).<br>"Return" lands on `/usage?portal=return`. |
| J10 | **Renewal (paid).** Dashboard → Billing → Test clocks → New simulation, then add a customer with the test account's email. Copy its `cus_…`.<br>On staging, **before** subscribing: `UPDATE "User" SET "stripeCustomerId" = 'cus_…' WHERE email = '<email>'` (the app reuses an existing customer).<br>Subscribe to Starter with `4242…`, spend some credits (run an execution), then advance the clock by 1 month + 2 hours. | **Stripe:** a `subscription_cycle` invoice paid €29.00.<br>**Ledger:** `allowance_expired` for what was left of the first month, then `subscription_allowance` +3000 for the new invoice.<br>**Plan row:** the new `currentPeriodEnd`.<br>Purchased or starting credits are untouched. |
| J11 | **Renewal (failed).** On J10's clock: portal → make `4000 0000 0000 0341` the default, then advance 1 month + 2 hours | `invoice.payment_failed`.<br>**Status:** `past_due`. Usage: "Your last payment failed. No new plan credits are added until it is paid…".<br>**Ledger:** no grant; the previous month's unused allowance expires at its period end (`allowance_expired`).<br>**Limits:** still the plan's (`keep`). |
| J12 | Fix J11: portal → card `4242…` as default → in Stripe, pay the open invoice (or advance to the next retry) | `invoice.paid` → the allowance is granted once; the status is `active`. |
| J13 | **Retries exhausted.** On a fresh clock account in J11's state, advance past the last retry | `customer.subscription.deleted`. The plan row ends ("Ended on <date>."). The prepaid limits apply. Plan credits expire at the period end (the maintenance sweep writes `allowance_expired`). |
| J14 | **Cancel → period end.** J5's account (cancelled, not kept), on a test clock as in J10, advanced past the period end | The subscription is deleted at the period end, and the remaining allowance is expired once. |
| J15 | **Credit pack still works.** /billing → buy a credit pack with `4242…` | Credits are added once (`stripe_purchase`), and no plan row changes. Packs and plans don't trigger each other. |
| J16 | **Team join rule.** A plan account opens a team invite link | 409: "You have the Starter plan on your own account… Cancel your plan in Usage first, then join the team." After cancelling, joining works. |

## 5. Safety checks against the real endpoint

| # | Check | Expected |
|---|---|---|
| X1 | `curl -X POST <api>/api/billing/stripe/webhook -H 'Content-Type: application/json' -H 'Stripe-Signature: t=1,v1=bad' -d '{}'` | 400; nothing processed |
| X2 | Temporarily set `STRIPE_PRICE_STARTER` to the Growth price ID → restart → choose Starter | 503 "This plan can't be bought right now. Please try again later." The log has `subscription.price_mismatch`. Restore it afterwards. |
| X3 | After the journeys, wait for the hourly ledger check (it also runs on the first maintenance pass after a restart) | No `ledger.allowance_mismatch` and no `stripe.webhook_failed` in the logs |
| X4 | Search the logs for `stripe.webhook_mode_mismatch`, `subscription.stripe_failed`, `subscription.invoice_nothing_paid` | None, unless a step above provoked one |

Two cases are covered only by the automated tests; they would need a live event or an invalid configuration
to reproduce for real:
- a live-mode event reaching a test-mode server (400);
- an invoice for a Price missing from the catalogue (500 until the configuration is fixed, then granted once on Stripe's retry).

## 6. Results

### Run of 2026-10-30

**Account:** `acct_1UVzu9JxdXxCrKwI` ("Ensemblis"). Every object has `livemode: false`. The account was empty
before the run.

**How Stripe was reached: route C, the Stripe connector.** This is neither route A nor route B. The
development container still had no Stripe key, and its proxy refused `CONNECT api.stripe.com:443` with 403. So
`npm run ops:stripe-test` could not run there: `check` exited 1 at the key guard. Stripe was driven through the
Stripe connector instead.

**What differs from what the app would do itself:**
- **API version.** The connector uses API version 2026-09-30, and the account's events are
  `2026-09-30.endive`. The app's SDK pins `2025-02-24.acacia`.
- **Billing mode.** Subscriptions the connector created are in `billing_mode: flexible`. The app's own
  Checkout, on `acacia`, would create classic-mode subscriptions.
- **Subscriptions came from the API, not Checkout.** They were created with `pm_card_visa` or
  `pm_card_chargeCustomerFail`, plus the metadata the app's checkout sets. The hosted Checkout page was not
  completed.
- **No webhook delivery.** There was no webhook endpoint. Instead, each Stripe answer and object was
  replayed through the real app code. That code ran against a local database, with real signature
  verification, and each request the app makes was compared with what was sent to Stripe
  (`tests/integration/stripeTestModeReplay.test.ts`, fixtures in `tests/fixtures/stripeTestMode20261030.ts`).

**Resources created** (test mode):

| Object | ID |
|---|---|
| Starter | `prod_VXNMzvj2CHfuuc` / `price_1UWIcSJxdXxCrKwILcllRFti` |
| Growth | `prod_VXNNeqOkk2DZVn` / `price_1UWIcYJxdXxCrKwIY8krK6sJ` |
| Business | `prod_VXNNMSOGYSjBiH` / `price_1UWIccJxdXxCrKwIoWAA5D9s` |
| Portal configuration | `bpc_1UWIcnJxdXxCrKwIinWcLLzZ` (it became the account default, being the account's first) |
| Test clock | `clock_1UWIdyJxdXxCrKwIAk0mkzip` |
| Coupon | `YO5vWS9G` (J7 only) |

Also created: test customers `ensemblis-test+…@example.com`. No webhook endpoint was created.

The products and prices follow `setup`'s conventions (lookup keys, `ensemblis_plan` metadata), so a later
`setup` reuses them.

**Results.** PASS: executed and matched the expectation. PARTIAL: some steps executed, the rest not.
NOT RUN: not executed. Nothing executed failed. One defect was found from the real data and fixed
(see the note after the table).

| # | Result | Evidence / notes |
|---|---|---|
| C1 | NOT RUN as written; PARTIAL by the connector | `npm run ops:stripe-test -- check` exited 1: no test key in the container. Read through the connector instead: no products, prices, webhook endpoints, portal configurations or customers. |
| C2 | NOT RUN as written; PASS by the connector | Same objects `setup` would make (table above). There is no webhook endpoint (no public URL). |
| C3 | NOT RUN | No API was configured with these IDs: there is no key in any app environment. |
| C4 | PARTIAL | The `check` logic, run on the real price and portal objects (replay test), passes: €29/€99/€299, EUR, monthly, active; portal policy met. The webhook endpoint was not checked: none exists. |
| C5–C6 | NOT RUN | Needs an API with the test key (C5) or Stripe network access for the relay (C6). |
| J1 | PASS (Stripe and app replay); hosted Checkout page NOT RUN | **Checkout Session** `cs_test_a1LRDs9…`: Stripe accepted the app's exact parameters (subscription mode, the Price, metadata on the session and the subscription, the return URLs, 1-hour expiry), with €29.00 EUR due. It was left to expire.<br>**Subscription** `sub_1UWIfkJxdXxCrKwIAk8SgdTr` is active. Invoice `in_1UWIfkJxdXxCrKwILPCOrLRW` (`subscription_create`) is paid, €29.00.<br>**Replay:** +3,000 credits under key `allowance:in_1UWIfk…`, row active, period 30 Oct–29 Nov. |
| J2 | PASS (replay); real redelivery NOT RUN | Redelivering the same event, and a second event for the same invoice, granted nothing more (2 grants in total), and the ledger reconciliation was clean. Stripe's own retry could not be exercised without an endpoint. |
| J3 | NOT RUN | 3-D Secure needs the hosted Checkout page in a browser. |
| J4 | PASS (Stripe and app replay); Checkout decline screen NOT RUN | Subscription `sub_1UWIinJxdXxCrKwIoFrzEPsk` is `incomplete`. Invoice `in_1UWIinJxdXxCrKwIlMKIw4wN` is `open`, `amount_paid` 0, one attempt; `invoice.payment_failed` was emitted.<br>**Replay:** status incomplete, "Payment failed (attempt 1)" shown, no credits. |
| J5 | PASS (Stripe and app replay) | `sub_1UWIiAJxdXxCrKwIN2cnD9DD`: cancel sets `cancel_at_period_end` and `cancel_at` = period end. Stripe also sets `canceled_at` immediately; the app doesn't treat that as ended (`endedAt` stays null). Keep clears all three. |
| J6 | PASS (Stripe and app replay) | Upgrade invoice `in_1UWIh5JxdXxCrKwIqq0MV0fi` (`subscription_update`) paid **€70.00**: −€29.00 unused Starter, +€99.00 Growth, both whole-period prorations. The update applied at once (`pending_update` null).<br>**Replay:** the app sent `always_invoice` + `pending_if_incomplete`, then granted **+12,000** (balance 15,000, never a second full allowance). |
| J7 | PASS (Stripe and app replay), by a different path | Card tokens are switched off on this account (end of life), so the "switch to `0341` in the portal" step was replaced:<br>- customer `cus_VXNU5uWoZ2tshZ` uses `pm_card_chargeCustomerFail`, plus a 100% first-month coupon;<br>- its first invoice `in_1UWIjTJxdXxCrKwIETAqNCdS` is "paid" with **€0**, and the replay granted **nothing** for it;<br>- the upgrade answered **200 with `pending_update` set** (items unchanged, expiry about 23h), and invoice `in_1UWIjnJxdXxCrKwIw7JbIRX6` is open, €99.00 due.<br>**Replay:** the app answers **402** "couldn't be charged… plan hasn't changed", and plan and credits are unchanged.<br>Stripe will retry that invoice (`next_payment_attempt` is set). A later success was not tested. |
| J8 | PASS (Stripe and app replay) | Downgrade with `proration_behavior: none`: the price changed, no invoice was created and the period is unchanged. The replay keeps Growth with `nextPlanId` Starter. Keep restores the Growth price, again with no invoice. |
| J9 | PARTIAL | The portal configuration matches the policy (plan switching off, cancel at period end, card updates, invoices). A session `bps_1UWIm3JxdXxCrKwIYDYTR2D4` was created with the fixed return URL. The hosted portal page was NOT RUN. |
| J10–J14 | NOT RUN | The connector can create test clocks but not advance them. J1's subscription is on `clock_1UWIdyJxdXxCrKwIAk0mkzip`, ready to advance from the Dashboard.<br>The app expires allowances by its own clock, not the test clock, so period-end expiry (J13, J14) won't show on a clock run. |
| J15 | NOT RUN | Not attempted (credit packs are unchanged by this PR). |
| J16 | n/a for Stripe | App rule; covered by `subscriptions.test.ts`. |
| X1–X4 | NOT RUN against a real endpoint | Covered by the automated tests: bad signature, Price mismatch (`priceProblems` also passes on the real prices), reconciliation. |

**Defect found from the real data, and fixed.**
- **What:** in the newer API layout, an invoice line's proration flag is at
  `parent.subscription_item_details.proration`; `line.proration` is absent. The app read only
  `line.proration`, so a renewal invoice that also carried proration lines could have taken a proration line
  as the period line, and granted that plan.
- **Production impact:** none today. The SDK pins `acacia`, where the flag is at the top level.
- **Fix:** `isProration()` reads both places, like the other layout fallbacks in `billing/subscriptions.ts`.
- **Test:** a regression test fails without the fix.

**Observations to decide on** (account settings, not app defects):
- **Adaptive Pricing** is on, so Checkout may show local-currency prices to customers outside the EU.
- **Dynamic payment methods** are on: card, Klarna, Link, Amazon Pay, Satispay.
- **Webhook API version:** the account's default is `2026-09-30.endive`. A webhook endpoint created in the
  Dashboard gets that version. That's fine for the app, which re-reads objects through its pinned SDK;
  pinning `2025-02-24.acacia` on the endpoint (as `setup` does) keeps payloads and re-reads the same.

**To finish the run:**
- The renewals (J10–J14): advance `clock_1UWIdyJxdXxCrKwIAk0mkzip` in the Dashboard. I can read the results through the connector.
- The hosted pages (J1 payment, J3, J4 decline screen, J9 portal): need a browser that can reach `checkout.stripe.com` / `billing.stripe.com`.
- A real delivery (J2 and route A): needs an API with the test key, plus either an endpoint or the relay.

**Exit criteria.** Every row passes, on route A at least once. Only then does production get plans, and that
is a separate, explicit decision covering:
- live products and prices (created in live mode, with the same amounts);
- a live webhook endpoint and secret;
- live keys on the API;
- `SUBSCRIPTIONS_ENABLED=true`.
