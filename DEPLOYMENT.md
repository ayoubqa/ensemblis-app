# Deploying Ensemblis v4 (outcome execution system)

Production today runs **v3** from `main` (`a1684bb`): one Render web service
(`ensemblis-api`) whose start command runs `prisma db push`, a Neon Postgres
database, and the Next.js frontend on Vercel. v4 is the branch
`ensemblis-outcome-execution-system`.

What changes at deploy time:

| | v3 (now) | v4 |
|---|---|---|
| Schema changes | `prisma db push` at every boot | `prisma migrate deploy` at boot (`dist/ops/migrate.js`); never `db push` |
| Execution | in the API process | durable Postgres job queue; the worker runs **inside the API process** (`EMBEDDED_WORKER=true`, free plan) or as a separate paid **`ensemblis-worker`** service (§1) |
| AI | Groq `openai/gpt-oss-120b` | same provider and keys |
| Admin (`/admin`) | `ADMIN_EMAILS` match | `ADMIN_EMAILS` match **and a verified email** |

The v4 migration is purely additive (new tables, nullable columns, no drops,
no rewrites). It was verified on a database created by v3's own `db push`:
users, password hashes, balances, transactions, teams, tasks/reports and share
tokens survive unchanged, and the schema ends with zero drift.

---

## 1. The worker plan (and check the database plan)

Render background workers are **not available on the free plan**, so
`render.yaml` defines **no** separate worker: `ensemblis-api` (free) runs the
worker inside its own process (`EMBEDDED_WORKER="true"`), and the Blueprint
sync creates nothing billable.

- **What this means:** executions pause while a free instance sleeps (about 15
  minutes without traffic) and recovery resumes them when it wakes; recurring
  objectives and the hourly guest cleanup also run only while it is awake; the
  database can idle. Workable for a demo or a small controlled rollout, not
  for real customers.
- **To get an always-on worker** (paid): change **`render.yaml`** in a merge (a
  dashboard edit is overwritten by the next Blueprint sync): add a
  `type: worker` service named `ensemblis-worker` (`plan: starter`, build
  `npm ci --include=dev && npm run build`, start `npm run start:worker`) with
  the same environment as `ensemblis-api`, and set `EMBEDDED_WORKER` back to
  `"false"`.
  - An always-on worker polls the database every second, so a Neon database
    **never scales to zero** (≈730 compute-hours a month). On Neon's Free plan
    that can exhaust the monthly compute allowance and suspend the database —
    move Neon to a paid plan first.

## 2. Environment checklist (names only — never commit values)

`ensemblis-api` keeps every service-level variable v3 had — `JWT_SECRET` and
`IP_HASH_SALT` keep their existing generated values, so nobody is logged out.
With the embedded worker there is a single service, so every variable is set
once, on `ensemblis-api`. If you later add a standalone `ensemblis-worker`
(§1), the settings both services read must stay identical (`AI_PROVIDER`,
`OPENAI_*`, `MAX_CONCURRENT_LLM`, `LLM_TIMEOUT_MS`, `MAX_TASKS_PER_*`,
`SEARCH_DAILY_BUDGET`, `GUEST_MAX_TASKS`, `GUEST_RETENTION_DAYS`).

Entered in the dashboard (`sync: false`) on `ensemblis-api`. The Worker column
applies only if you add a standalone worker:

| Variable | API | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✔ | ✔ | Neon **direct** (non-pooled) URL with `?sslmode=require`; same value on both. If you must use the pooled (`-pooler`) URL here, also set `DIRECT_URL` |
| `DIRECT_URL` | ✔ | – | optional: the **direct** (non-pooled) Neon URL, used only by the boot-time migration step (`dist/ops/migrate.js`). Needed whenever `DATABASE_URL` is a pooler; see §8 |
| `OPENAI_API_KEY` | ✔ | ✔ | Groq key (the worker makes almost all model calls) |
| `APP_URL` | ✔ | ✔ | frontend URL, no trailing slash — used in email and share links |
| `CORS_ORIGIN` | ✔ | – | every origin the frontend is served from, exact `https://host` form, comma-separated, e.g. `https://www.example.com,https://example.com,https://<project>.vercel.app` (`www` and the bare domain are different origins; no wildcards, no spaces; malformed entries are ignored and logged on start) |
| `ADMIN_EMAILS` | ✔ | – | operators; must also verify their email (see §6) |
| `TAVILY_API_KEY` | ✔ | ✔ | web search — **required for research briefs, lead lists and any web-research step**; without it search falls back to Wikipedia only: the define page warns "Limited evidence", every research step is recorded `degraded`, the result's Evidence panel and Limitations say only encyclopedia summaries were available, and the API logs a boot warning |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✔ | ✔ | optional email: verification, notifications, password reset |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✔ | – | optional real payments (credit packs; also required for monthly plans) |
| `SUBSCRIPTIONS_ENABLED`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_BUSINESS` | ✔ | – | optional monthly plans (off by default); see §2b. Optional `STRIPE_PRODUCT_*`, `STRIPE_PORTAL_CONFIGURATION_ID`. The worker never calls Stripe and needs none of these |
| `SUBSCRIPTION_PAST_DUE_ACCESS`, `PLAN_*_RUNS_PER_DAY` | ✔ | ✔ | only if changed from the defaults (`keep`; 5/15/40): the worker applies plan limits when executions start, so keep the **same values on both** |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | ✔ | – | optional bot check |
| `SIGNUP_INVITE_CODE` | ✔ | – | optional invite-only sign-up |

Set by `render.yaml`: `NODE_VERSION=22`, `NODE_ENV=production`,
`AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_FAST_MODEL`,
`OPENAI_REASONING_EFFORT=low`, `OPENAI_MAX_TOKENS`, `MAX_CONCURRENT_LLM`,
`EMBEDDED_WORKER=true` (the API runs the worker; `WORKER_CONCURRENCY` defaults to 2), cost caps and
guest-trial settings. v3-only variables left on the API (`FOLLOWUP_COST_CENTS`,
`CLARIFY_ENABLED`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_CHARS`,
`DEV_TEST_RUNS_PER_DAY`) are ignored and can be deleted.

Vercel (frontend): `NEXT_PUBLIC_API_URL` (the API's `https://…onrender.com`
URL, no trailing slash) and `NEXT_PUBLIC_CONTACT_EMAIL`. Optional:
`NEXT_PUBLIC_SITE_URL` (the public origin, e.g. `https://ensemblis.app`, no
trailing slash) for canonical URLs, `sitemap.xml`, `robots.txt` and Open Graph
links — when unset, the build uses Vercel's `VERCEL_PROJECT_PRODUCTION_URL`
(the project's production domain). `NEXT_PUBLIC_*` values are baked in at build
time: redeploy the frontend after changing them.

Research and verification settings (same value on the API **and** the worker;
defaults shown — none needs setting for a normal deploy):

| Variable | Default | What it does |
|---|---|---|
| `SEARCH_PROVIDER` | `tavily` when `TAVILY_API_KEY` is set, else `wikipedia` | `tavily` \| `wikipedia` \| `off`. Tavily without a key becomes Wikipedia — never silently: Wikipedia-only research is recorded `degraded` (not `ok`), the define page and the result say the evidence is encyclopedia summaries, and the API logs a boot warning; `off` blocks research briefs at planning (`PROVIDER_UNAVAILABLE`, nothing charged). |
| `SEARCH_DAILY_BUDGET` | `30` | Successful Tavily calls per UTC day, server-wide (failed calls no longer count). A research step makes 3 searches and other web steps 2 each (plus 2 when a brief's one automatic revision researches again), so a brief typically uses 3–9 and 30 allows only a few briefs a day: raise it (e.g. `200`) for demos and the live smoke. When it is spent, searches fall back to Wikipedia and the research is recorded as `degraded`. |
| `VERIFY_RETRY_DELAY_MS` | `60000` | When the AI verifier can't run (key, quota, timeout, unusable reply) the result is **not verified** (`UNVERIFIED`): it is checked again once after this pause, then handed to a person as "The result could not be verified" (accept / retry / cancel). Accepting keeps it `UNVERIFIED`, the outcome `UNKNOWN`, and refunds the verification fee. |
| `TAVILY_BASE_URL` | `https://api.tavily.com` | **Tests only** (points search at a local stub). Never set it in production: results that used it carry a "Custom search endpoint" notice and the API logs a production warning at boot. |

Credits and cost accounting (API only; defaults shown — none needs setting for a normal deploy):

| Variable | Default | What it does |
|---|---|---|
| `CREDITS_PER_EUR` | `100` | Internal value of a credit (1 credit = €0.01 at the default) for accounting and pricing. Balances are stored as whole credits and are **not** rewritten when it changes; every existing balance was issued at 100 per €1, so changing it revalues them internally (the API logs a warning). Leave it at 100 unless you deliberately re-denominate. |
| `MAX_TOKENS_PER_EXECUTION` | `600000` | Runaway guard: an execution whose model calls have used this many tokens stops before its next step (or verification) and fails, which refunds its credits. `0` turns it off. A normal execution uses well under 100,000. |
| `PROVIDER_PRICING` | unset | JSON price table for **internal** cost accounting (owner dashboard, `/api/admin/economics`): per-million-token prices per model, per-call prices per paid tool, and exchange rates to EUR — e.g. `{"models":{"openai/gpt-oss-120b":{"inputPerMTok":…,"outputPerMTok":…,"currency":"USD"}},"tools":{"search:tavily":{"perCall":…,"currency":"USD"}},"fx":{"USD":…}}`. Take the numbers from the providers' current price pages. Unset or invalid: usage is still recorded, but costs stay unpriced (never guessed). |

**Credits.** Customers see balances, budgets, estimates, charges and refunds in
credits. No balance is converted: the stored integer was already one cent of
credit value, so at 100 credits per €1 a €30.00 balance is shown as 3,000
credits. The migration `20261023120100_ledger_opening_balances` records, once
per wallet, any balance that earlier releases never wrote to the ledger (the
starting credits) as an "opening balance" row, so every balance equals the sum
of its ledger rows; the owner dashboard and an hourly check (`ledger.mismatch`
in the logs) report any wallet that doesn't. Planning now needs at least the
cheapest plan's credits (800); below that, defining an objective returns 402
before any model call.

Model-layer behaviour to know: HTTP 500 and connection errors from the AI
provider are now retried like 502/503/504; an exhausted quota (OpenAI
`insufficient_quota`, a long `Retry-After`, Anthropic credit errors) is *not*
retried and says "The AI provider's quota is exhausted for now — retry after
~N min"; a missing or rejected key blocks planning before anything is charged.

An `OPENAI_BASE_URL` on a loopback, private or `.local`/`.internal` host is
labelled "Local model endpoint" on every result it produced (with `E2E_STUB=1`:
"Test stub endpoint — not a real model") and logs a production warning.

`AI_PROVIDER=mock` cannot run in production: the API and worker refuse to
start with it when `NODE_ENV=production` **or** on Render (`RENDER` is set) —
and on Render the API also refuses a missing or placeholder `JWT_SECRET` even
if `NODE_ENV` was forgotten. The provider refuses the mock again at call time.

### 2b. Monthly plans (Stripe Billing)

Plans are **off** until `SUBSCRIPTIONS_ENABLED=true`, Stripe is configured and each plan has a Stripe Price
ID. While off, the pricing page shows no plans and nothing below runs. Set this up in **Stripe test mode**
first; switching to live keys is a separate, deliberate step.

**Catalogue (one place: `backend/src/config.ts` → `subscriptions.plans`, read by `billing/plans.ts`).**
The defaults are proposals and can be changed with environment variables. The frontend shows what
`GET /api/config` returns.

| Plan | Price | Monthly credits | Executions per person per day | Env overrides |
|---|---|---|---|---|
| Starter | €29 | 3,000 | 5 | `PLAN_STARTER_PRICE_CENTS`, `PLAN_STARTER_CREDITS`, `PLAN_STARTER_RUNS_PER_DAY` |
| Growth | €99 | 15,000 | 15 | `PLAN_GROWTH_…` |
| Business | €299 | 60,000 | 40 | `PLAN_BUSINESS_…` |

The daily limit is never below `MAX_TASKS_PER_USER_PER_DAY`. Server-wide caps, the credit check and the
execution cost guards apply to every plan.

**Stripe setup (test mode).**
1. Products → create one product per plan with a **recurring monthly EUR price** of exactly the amount above.
   Checkout refuses a Price whose amount, currency or interval differs from the catalogue, and logs
   `subscription.price_mismatch`. Put the IDs in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH` and
   `STRIPE_PRICE_BUSINESS`. Optionally also set `STRIPE_PRODUCT_*`, which checkout then also checks.
2. Developers → Webhooks: use the same endpoint as credit packs, `https://<api>/api/billing/stripe/webhook`.
   Add the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `customer.subscription.pending_update_applied`,
   `customer.subscription.pending_update_expired`, `invoice.paid` and `invoice.payment_failed`.
   - That list is `STRIPE_WEBHOOK_EVENTS` in `backend/src/billing/subscriptions.ts`.
   - Its signing secret is `STRIPE_WEBHOOK_SECRET`.
   - The handler re-reads every object through the API, so the endpoint's API version doesn't matter.
     `2025-02-24.acacia`, the SDK's version, is the one tested.
   - An event from the other mode (a live event on a test key, or the reverse) is answered 400 and ignored,
     so a test endpoint and a live endpoint can't cross.
3. Settings → Billing → Customer portal:
   - enable payment-method updates, invoice history and "cancel at end of billing period";
   - leave plan switching **off**, because the app's Upgrade and Downgrade buttons apply the policy below.
   - Optionally put a specific configuration in `STRIPE_PORTAL_CONFIGURATION_ID`.
4. Settings → Subscriptions and emails → failed payments: choose the retry schedule, and what happens when
   retries are exhausted ("cancel the subscription" is the simplest).
5. Set `SUBSCRIPTIONS_ENABLED=true` and the Stripe values on the **API**, then redeploy.
   - The worker needs none of them. Only `SUBSCRIPTION_PAST_DUE_ACCESS` and `PLAN_*_RUNS_PER_DAY`, if
     changed, must match the API.
   - The boot log warns about a missing Price ID, or a live key with plans on.
   - Check `GET /api/config`: `subscriptionsEnabled: true`, and every plan `available: true`.
6. Run the whole test-mode validation in
   [`docs/billing/stripe-test-mode-validation.md`](docs/billing/stripe-test-mode-validation.md) on a
   non-production environment, and record the results there. It covers checkout with 3-D Secure and a
   declined card, redelivery, cancel and keep, upgrade (paid and declined), downgrade, the portal, and
   renewals on test clocks (paid, failed, recovered, retries exhausted).
   - `npm run ops:stripe-test -- setup` (backend) creates or reuses the test-mode products, prices, portal
     configuration and optionally the endpoint. It refuses live keys.
   - `npm run ops:stripe-test -- check` verifies them against the catalogue.
   - Production keeps `SUBSCRIPTIONS_ENABLED` unset until that run has passed.

**What the app does (policies).**

| Situation | Behaviour |
|---|---|
| Checkout | Server-side Checkout Session in `subscription` mode for the catalogue's Price. The client sends only a plan id. Redirect URLs are fixed: `/usage?subscription=success` and `/pricing?subscription=cancelled`. One open checkout per account; asking again reuses it. Accounts that already have a plan get 409. |
| Returning from Stripe | Nothing is granted. Usage polls until the server has the paid subscription, otherwise it says the payment is still being confirmed. |
| First invoice paid (`invoice.paid`) | The plan's monthly credits are granted once per invoice (ledger key `allowance:<invoiceId>`), and the plan's limits apply. An invoice "paid" with nothing charged (a trial or a 100% coupon set up in Stripe) grants no credits; the event is logged as `subscription.invoice_nothing_paid`. |
| Renewal paid | Unused plan credits from the last period expire (`allowance_expired`), then the new allowance is granted. |
| Payment failed | No new allowance. The status becomes `past_due` and Usage asks the customer to update their card. The plan's limits stay while Stripe retries (`SUBSCRIPTION_PAST_DUE_ACCESS=keep`; `revoke` drops them). Other credits stay usable. |
| Cancel | At the end of the paid period. Plan credits already paid for stay usable until that period ends. No refund, no extra grant. Immediate cancellation isn't offered in the app; if it is done in Stripe, the paid allowance still runs to its period end. |
| Upgrade | Immediate. Stripe charges the prorated difference, and the change applies only if that payment succeeds (`pending_if_incomplete`). When it is paid, credits are added: the difference × the share of the period left. Never a second full allowance. |
| Downgrade | From the next renewal. The current plan and allowance stay until then, and the change can be undone. |
| Plan credits vs other credits | One balance (`User.credits`). The unused allowance is tracked on the subscription; plan credits are spent first. Bought, starting and demo credits never expire. A refund puts plan credits back while their period lasts. After it ends, they are refunded and expire at once (two ledger rows). |
| Webhooks | Signature verified on the raw body; an event from the other Stripe mode is answered 400. Duplicates are skipped (`StripeEvent`) and every handler is idempotent. Objects are re-read from Stripe, and an older read never overwrites a newer one. A processing error answers 500, so Stripe retries. Credit-pack sessions (`payment` mode) and subscriptions never trigger each other's credits. |
| Invoice for an unknown Price | Answered 500 and logged (`subscription.invoice_unknown_price`, `stripe.webhook_failed`), so nothing is granted and Stripe keeps retrying. Fix the `STRIPE_PRICE_*` setting; the next retry grants the allowance once. |
| Changing a plan's price | The app knows one Price per plan, the one in `STRIPE_PRICE_*`. Existing subscriptions stay on their old Price. **Before** pointing `STRIPE_PRICE_*` at a new Price, move them to it in Stripe (with no proration, it applies from their next renewal); otherwise their renewals hit the row above. Keeping old customers on an old price isn't supported yet. |
| Stripe unavailable | Checkout, cancel, keep and plan changes answer 503 with "try again". Nothing changes on either side until a retry succeeds (`subscription.stripe_failed` in the log). |
| Joining a team | A team member spends the team's credits, so an account with a renewing plan can't join a team (409) until it cancels the plan; the paid month still runs out. Joining also closes the account's open plan checkout links. |
| Reconciliation | The hourly ledger check also compares every subscription's unused allowance with its ledger rows (`ledger.allowance_mismatch`). |

**Not covered by the app (do these in Stripe, deliberately):**
- refunding a subscription payment, which doesn't remove the granted credits;
- disputes;
- tax collection (Stripe Tax is not enabled);
- coupons (Checkout doesn't accept promotion codes).

**Local and E2E testing without Stripe.** `E2E_STRIPE=1 npm run e2e -- subscription` (frontend) runs the
whole journey in a browser against `backend/scripts/stripe-stub.mjs`. That is a local stand-in for the API calls
used, plus a labelled test checkout page. It signs webhooks like Stripe. It is not Stripe: it proves the app's
side of the integration, not Stripe's behaviour.

## 3. Before merging: rehearse on a copy of production (recommended, ~10 min)

1. In Neon, create a **branch** of the production database (e.g. `pre-v4`).
   This is also your backup: the branch keeps the exact pre-v4 state.
2. Point a local checkout at that branch and run the migration and checks:

   ```bash
   git checkout ensemblis-outcome-execution-system
   cd backend && npm ci && npm run build
   DATABASE_URL="<neon pre-v4 branch URL>" node dist/ops/migrate.js
   # expect: "database state: legacy-db-push" → baseline 0_init → apply 20261007120000_outcome_execution_system
   #         and 20261008090000_planning_quota_indexes
   DATABASE_URL="<neon pre-v4 branch URL>" npx prisma migrate diff \
     --from-url "<neon pre-v4 branch URL>" --to-schema-datamodel prisma/schema.prisma --exit-code
   # expect: "No difference detected."
   ```
3. Optionally run the API against the branch (`DATABASE_URL=… NODE_ENV=development
   JWT_SECRET=<prod value> npm start`) and log in with a real account: balance,
   reports and share links should be unchanged.
4. Run the real-model smoke test with the production model and real web search (§5a).

Never point `npm run smoke:real` or any test at the production URL: they
reset their database (the scripts refuse names without `smoke`/`test`).

## 4. Deploy

0. **First, remove `db push` from production (a v3 deploy, no behaviour change).**
   Fast-forward `main` to `v3-rollback-safe` (v3 + "don't run `prisma db push`
   at boot") and let Render deploy it:

   ```bash
   git fetch origin && git checkout main && git merge --ff-only origin/v3-rollback-safe && git push origin main
   ```

   Why: if the first v4 API deploy fails *after* its migration ran, Render keeps
   the old v3 instance serving. A v3 instance that still runs `db push` would
   fail on its next restart or cold start (free instances sleep after 15
   minutes) — an outage. With this step, every v3 instance boots without
   touching the schema. (`v3-rollback-safe` is already part of the v4 branch,
   so step 1 stays a clean fast-forward.)
1. Merge `ensemblis-outcome-execution-system` into `main` (via a pull request,
   with CI green).
2. Render (Blueprint auto-sync on `main`):
   - `ensemblis-api` builds and starts with `npm run start:render` =
     `node dist/ops/migrate.js && node dist/index.js`. The first boot baselines
     the existing schema and applies the additive migration, then serves.
   - No separate worker service is created: after the migration the API process
     starts the worker itself (log line `worker.started`). With a standalone
     `ensemblis-worker` (§1), fill in its `sync: false` variables (§2) when
     Render asks and make sure it is **running**; it logs
     `worker.waiting_for_migrations` until the API has migrated, then starts
     (it gives up and restarts after 10 minutes if the API's migration fails).
   - Check `https://<api>/health` → `{"ok":true,"db":"ok","queue":{…}}`.
3. Vercel builds `main` and promotes it to production.

Deploy order caveat: Render and Vercel build in parallel. For a minute or two
the new frontend may talk to the old API (or the reverse). Nothing is lost,
but pages can error until both are live — deploy at a quiet time.

## 5. After deploy: smoke test (use a throwaway account, no real business data)

1. Landing page loads; sign up a new test account.
2. Email verification link arrives (if Resend is configured) and works.
3. Company Context: fill three fields, save.
4. Define an outcome → the Chief of Staff plans it (Groq) → approve.
5. Watch it execute; refresh the page mid-run; it resumes live.
6. Completed: verification score, evidence, outcome per criterion.
7. Usage shows one charge (and refunds if anything failed).
8. Share → open the `/r/<token>` link in a private window → then stop sharing.
9. A second test account cannot open the first account's objective URL.
10. `/health` shows `queue.deadLast24h: 0` and a small `oldestQueuedSeconds`.
11. Public pages: `/robots.txt` and `/sitemap.xml` list the production origin
    (only `/`, `/how-it-works`, `/privacy`, `/terms` are indexable); the page
    source of `/` has a canonical link and an `og:image`; a signed-in page such
    as `/dashboard` answers with `X-Robots-Tag: noindex, nofollow`.

12. A **research brief** (Define → Deliverable: *Research brief
    (evidence-backed)*) plans a web-research step, shows its sources with
    provider, query and retrieval time, and ends with a result state
    (verified / verified with warnings / partial / not verified / accepted
    without passing verification) shown separately from the AI-assessed
    outcome. See the live procedure below.

### 5a. Live smoke with a real model and real web search (release evidence)

Every automated suite in this repository runs on the **mock** model and a
**stub** search (or the Groq-format stub in `e2e:prod-like`). The only check
of real Groq/Anthropic output and real Tavily results is this live smoke. It
**has not been run from the development sandbox** (no network access to
api.groq.com, api.tavily.com or en.wikipedia.org, and no keys there) — run it
from GitHub Actions or a machine with network access, and never record it as
done before it has run. It spends real tokens and searches (≈ two objectives).

**A. Automated (preferred)**

1. In GitHub → *Settings → Secrets and variables → Actions*, add
   `SMOKE_OPENAI_API_KEY` (Groq) and `SMOKE_TAVILY_API_KEY`. (Optional:
   `SMOKE_ANTHROPIC_API_KEY`; variables `SMOKE_OPENAI_BASE_URL`,
   `SMOKE_OPENAI_MODEL`, `SMOKE_OPENAI_FAST_MODEL`.) Without the Tavily secret,
   scenario E is reported **SKIPPED**, never passed.
2. *Actions → Real-model smoke → Run workflow*: provider `openai`, scenarios
   `E,A,D` (the default `E,A,B,C,D` adds the missing-information and
   cross-functional checks), e_expect `run`, full off. Download the
   `real-model-smoke-report` artifact.
   GitHub offers *Run workflow* only once `.github/workflows/real-model-smoke.yml`
   is on the default branch (`main`), i.e. after #1 is merged; until then use
   step 3. Scenario E and the `e_expect` input live in this branch's version of
   the file, so before this branch is merged pick it under *Use workflow from*.
3. Or locally (needs Postgres with a database named `ensemblis_smoke`):

   ```bash
   cd backend && npm ci && npm run build
   AI_PROVIDER=openai OPENAI_API_KEY=<groq key> OPENAI_REASONING_EFFORT=low \
   TAVILY_API_KEY=<tavily key> SEARCH_DAILY_BUDGET=200 \
   SMOKE_DATABASE_URL=postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_smoke \
   SMOKE_SCENARIOS=E,A,D npm run smoke:real
   ```

Scenario E (research brief) hard checks — any failure exits 1:

- the planner's plan is used (`planSource=planner`), and a web-research step
  has research status `ok` or `degraded`;
- a `RESEARCH_COMPLETED` event names provider `tavily` and lists its queries;
- at least 3 WEB evidence rows, each with url, title, excerpt, provider, query
  and retrieval time;
- every `[n]` in the brief maps to this execution's evidence, and every link
  is on an evidence domain;
- every claim has a claim type, and no claim is SUPPORTED without evidence;
- verification method `deterministic+model` with the verifier's provider and
  model recorded;
- one outcome measurement per success criterion, citing only existing evidence;
- the result state and the AI-assessed outcome are both reported, separately,
  and agree with the verdict;
- step token counts were reported by the provider (`tokensEstimated=false` —
  Groq sends `x_groq.usage`), and usage by purpose is present;
- the instruction planted in a company document (a canary) is absent;
- no piece of any API key appears in events, step errors, exceptions, the
  result or the public report.

How to read the report: a scenario is **PASS** only when every hard check
passed on a real model with real search. It can also read **SKIPPED** (search
off), **UNVERIFIED** (the AI verifier could not run — an honest state, reported
but not counted as passed), **VERIFICATION FAILED** (the stricter brief gate
failed the result after its one automatic revision; the smoke accepts it so the
outcome is recorded, and it stays failed), **SELF-TEST** (mock model),
**LOCAL MODEL ENDPOINT** (`OPENAI_BASE_URL` on the same machine, possibly a
stub) or **STUB SEARCH** (`TAVILY_BASE_URL` set). The report also lists model
calls and tokens by purpose and web searches by provider (ok / failed, first
errors).

Negative live checks — one run each, with scenarios `E` only. In the workflow
pick `e_expect` = `neg-a-model-key`, `neg-b-search-key` or `neg-c-search-off`
(it swaps in the invalid key or turns search off for that run); locally set the
variables below:

| Run | Local settings | Expected |
|---|---|---|
| (a) rejected model key | `OPENAI_API_KEY=gsk_invalid SMOKE_E_EXPECT=blocked` | BLOCKED at planning with `PROVIDER_UNAVAILABLE`, `costCents=0`, no `FUNDS_CHARGED` |
| (b) rejected search key | `TAVILY_API_KEY=tvly-invalid SMOKE_E_EXPECT=degraded` | attempts show Tavily 401 and the Wikipedia fallback, research `degraded`, and the brief is not labelled verified unless external evidence exists |
| (c) search off | `SEARCH_PROVIDER=off SMOKE_E_EXPECT=blocked` | the brief is blocked before any charge |

Settings that matter for these runs (see the table in §2): `SEARCH_DAILY_BUDGET`
(the workflow sets `200`; the default `30` can run out mid-smoke, which turns
research `degraded`), and `VERIFY_RETRY_DELAY_MS` (default `60000`: when the AI
verifier can't run, the smoke waits through one re-check before it reports the
result as **UNVERIFIED**).

The script logic was exercised offline only, against local stubs: with the
mock model, E was reported SKIPPED with search off and SELF-TEST with the
search stub (`scripts/search-stub.mjs`); against the Groq-format stub
(`scripts/openai-stub.mjs`) plus the search stub it was reported LOCAL MODEL
ENDPOINT; negative check (a) (the stub answering 401) and (c) behaved as
expected. (b) needs the real Wikipedia API, so it has not been exercised.
None of that is evidence of real-model behaviour.

**B. UI walkthrough with real keys** (covers "launched from the UI")

1. Start the API, the worker and the frontend with the env above:
   `cd backend && EMBEDDED_WORKER=false npm run dev`, `npm run dev:worker`, and
   `cd frontend && NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev`.
2. Sign up, fill in Company Context, open **/objectives/new**.
3. Choose *Research brief (evidence-backed)*, enter an objective (e.g. "Brief:
   regulatory and competitive landscape for B2B payroll software in
   Germany"), constraints ("EU sources only; no paid databases") and three
   success criteria.
4. Launch, approve the plan using only the keyboard (Tab to *Approve*, Enter),
   and wait for a terminal state.
5. Screenshot at 1280px and 390px: the plan with progress; the step rows
   (provider · model · tokens · latency, research badge); evidence (provider,
   query, retrieved); verification (per criterion with evidence chips, claim
   types); Open issues; Usage; the header state tags.
6. Export a PDF and check it carries the result-state label.

Evidence to keep (commit or attach as release evidence once it exists):
`smoke-results/<timestamp>.json` and `.md` (the workflow artifact); `GET
/api/executions/:id` JSON for the E run; its UsageEvent rows
(`SELECT kind, provider, model, purpose, "tokensIn", "tokensOut", "latencyMs", ok, estimated FROM "UsageEvent" WHERE "executionId" = '…'`);
the screenshot set; and the exception rows and wallet transactions of the
negative runs.

## 6. Operators

`/admin` requires an address in `ADMIN_EMAILS` **and** a verified email. If
email (Resend) is not configured, verify an operator once against the
production database from a local checkout:

```bash
cd backend && DATABASE_URL="<production URL>" npm run ops:verify-email -- you@example.com
```

## 7. Rollback (application only — the database stays)

The migration is additive, so rolling back never touches the database. But
**do not redeploy v3 as it was**: v3's start command runs `prisma db push`,
which refuses to start against the v4 schema (outage) — or, if the new tables
happen to be empty, silently drops them while the migration history still
says they exist, which breaks the next v4 deploy.

Use the prepared branch **`v3-rollback-safe`** (v3 + one change: no `db push`
at boot). It was tested against a v4-migrated database: logins, balances,
reports, share links, sign-ups, teams and guest cleanup all work.

1. Vercel: *Deployments* → the last v3 production deployment → **Instant Rollback**.
2. Render `ensemblis-worker`, if you added a standalone one: **Suspend** it (it
   only processes v4 executions). With the embedded worker there is nothing to
   suspend: step 3 replaces the API process, and v3 runs no worker.
3. Render `ensemblis-api`: *Settings* → *Build & Deploy* → **Branch** =
   `v3-rollback-safe` → *Manual Deploy* → *Deploy latest commit*.
   (If the service is Blueprint-managed and the setting is locked, change the
   start command instead to `node dist/seed.js && node dist/index.js` and
   redeploy commit `a1684bb`.)
4. Check `/health` and log in with an existing account.

To roll forward again, set the branch back to `main` (and resume the standalone
worker, if you have one); `migrate.js` sees the migrations already applied and
starts immediately.

v4 data created before a rollback (objectives, executions, company context)
stays in its tables, invisible to v3, and reappears after rolling forward.

**Before rolling back past "real execution v1"** (migration
`20261014120000_real_execution_v1`) — to an earlier v4 build or to v3: that
release added two enum values, `VerificationStatus.UNVERIFIED` and
`ExceptionKind.PROVIDER_UNAVAILABLE`. An older Prisma client throws when it
reads a row that uses them, so map those rows to values the old build knows
first (Postgres can't drop enum values; the unused values are harmless). Keep
the ids so the honest states can be restored when you roll forward:

```sql
-- before the rollback
CREATE TABLE IF NOT EXISTS "_rollback_v1_unverified" AS SELECT id FROM "Verification" WHERE status = 'UNVERIFIED';
CREATE TABLE IF NOT EXISTS "_rollback_v1_unverified_exec" AS SELECT id FROM "Execution" WHERE "verificationStatus" = 'UNVERIFIED';
CREATE TABLE IF NOT EXISTS "_rollback_v1_provider_unavailable" AS SELECT id FROM "Exception" WHERE kind = 'PROVIDER_UNAVAILABLE';
UPDATE "Verification" SET status = 'PASS_WITH_WARNINGS' WHERE status = 'UNVERIFIED';
UPDATE "Execution" SET "verificationStatus" = 'PASS_WITH_WARNINGS' WHERE "verificationStatus" = 'UNVERIFIED';
UPDATE "Exception" SET kind = 'STEP_FAILED' WHERE kind = 'PROVIDER_UNAVAILABLE';

-- after rolling forward again
UPDATE "Verification" SET status = 'UNVERIFIED' WHERE id IN (SELECT id FROM "_rollback_v1_unverified");
UPDATE "Execution" SET "verificationStatus" = 'UNVERIFIED' WHERE id IN (SELECT id FROM "_rollback_v1_unverified_exec");
UPDATE "Exception" SET kind = 'PROVIDER_UNAVAILABLE' WHERE id IN (SELECT id FROM "_rollback_v1_provider_unavailable");
DROP TABLE "_rollback_v1_unverified", "_rollback_v1_unverified_exec", "_rollback_v1_provider_unavailable";
```

While rolled back, the old build shows those results as "verified with
warnings" although they were never verified — tell affected users, or roll
forward promptly. The other v1 columns are nullable additions the old build
ignores. The follow-up migration `20261015120000_backfill_confirmed_outcome` is
data only (it copies earlier human confirmations into `confirmedOutcomeStatus`,
idempotently) and needs nothing on rollback.

**Rolling back past the credits release** (`20261023120000_credit_ledger`):
it added two `TransactionType` values, `GRANT` (starting credits) and
`ADJUSTMENT` (opening balances). An older build's Prisma client throws when it
reads those rows (Usage, billing summary), so move them aside first. They are
ledger rows only: balances live in `"User"."credits"` and are unaffected.

```sql
-- before the rollback
CREATE TABLE IF NOT EXISTS "_rollback_credits_tx" AS SELECT * FROM "Transaction" WHERE type IN ('GRANT', 'ADJUSTMENT');
DELETE FROM "Transaction" WHERE type IN ('GRANT', 'ADJUSTMENT');

-- after rolling forward again
INSERT INTO "Transaction" SELECT * FROM "_rollback_credits_tx" ON CONFLICT DO NOTHING;
DROP TABLE "_rollback_credits_tx";
-- then run the statement in prisma/migrations/20261023120100_ledger_opening_balances/migration.sql
-- once more (idempotent): it records the starting credits of accounts created while rolled back.
```

The other credits columns (`reason`, `balanceAfter`, `idempotencyKey`, the
`UsageEvent` cost fields) are nullable additions an older build ignores.

## 8. If the migration step fails at boot

`dist/ops/migrate.js` handles the known states itself: a database created by
`db push` (baselined), one with a stray `prisma migrate dev` history,
a migration recorded as failed by an interrupted deploy (Prisma applies each
migration in a transaction, so it is marked rolled back and retried once), and
two instances booting at once. It refuses — with instructions — only when the
schema can't be identified (v4 tables without any migration history). Its log
lines start with `[migrate]`. Legacy v3 tasks still running at deploy time are
left alone for 15 minutes (a v3 instance may still finish them), then failed
and refunded.

**Nothing to apply = no lock.** On every boot the migrator reads
`_prisma_migrations`. If every migration in this release is already recorded as
applied, it logs `no pending migrations — skipping prisma migrate deploy` and
starts the API without running `prisma migrate deploy` at all. Restarts,
environment-variable changes and code-only deploys therefore never depend on
Prisma's migration lock. When something *is* pending, `migrate deploy` runs
with its lock exactly as before (the lock is never disabled).

### Deploy fails with `P1002` ("Timed out trying to acquire a postgres advisory lock")

`prisma migrate deploy` takes a session-level Postgres advisory lock (key
`72707369`) and gives up after 10 seconds (a fixed Prisma limit). It means some
other session holds that lock, or the connection cannot hold one reliably.

What the migrator does about it: if migrations are pending it retries a lock
timeout or a dropped connection (`MIGRATE_MAX_ATTEMPTS`, default 5;
`MIGRATE_RETRY_DELAY_MS`, default 10000, growing per attempt), re-reading what is
still pending before each try. After the last attempt it exits 1 with a message,
so **the new version does not replace the running one** (Render keeps serving the
previous instance; environment-variable changes only take effect after a deploy
succeeds).

What to check and set, in this order:

1. **Use a direct connection for migrations.** On Neon, `DATABASE_URL` hosts that
   contain `-pooler` go through PgBouncer in transaction mode, which does not keep
   session-level locks reliably. In Neon: *Connect* → turn **Connection pooling
   off** → copy that string (it has the same user and password; the host has no
   `-pooler` — removing `-pooler` from the pooled host name gives the same address). Add it in Render as `DIRECT_URL` (keep `DATABASE_URL` as it is, or
   replace it with the same direct string). The `[migrate]` log then says
   `connecting with DIRECT_URL`; a pooled connection logs a `WARNING` instead.
   Copy it from the **same Neon branch and database** as `DATABASE_URL` (not the
   backup branch): the migrator refuses a `DIRECT_URL` whose host (ignoring `-pooler`)
   or database name differs, because it would migrate a database the app does not use.
2. **Look for a holder** (read-only; run in Neon's SQL editor):
   ```sql
   SELECT a.pid, a.state, a.application_name, now() - a.state_change AS in_state_for, left(a.query, 80) AS query
   FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
   WHERE l.locktype = 'advisory' AND l.objid = 72707369 AND l.granted;
   ```
   No rows: nothing holds it now — redeploy. A row: the holder is another running
   deploy (wait for it to finish) or a session left over from an earlier one. Do
   not terminate a session unless you know it is stale and no deploy is running;
   a Neon compute that has auto-suspended drops all sessions by itself.
3. **One deploy at a time.** Changing an environment variable in Render starts a
   deploy; two edits in quick succession start two. Wait for the first to finish.

## 9. Recovery checks you can run anytime

### Login or sign-up says "Can't reach the Ensemblis server"

That message means the browser's request failed **before any response arrived** — a wrong password, a
rejected invite code or a server error each show their own message instead. `/health` staying green says
nothing about it: it is not a cross-origin browser call. When the page can tell that the server *is*
answering (a simple request to `/health/live` succeeds) it says "The Ensemblis server is running but
didn't accept the request from this site (…)" instead, which points straight at `CORS_ORIGIN`. Open the
browser's developer tools (F12) on the failing page, try again, and read the **Console**:

| The console says | Cause | Fix |
|---|---|---|
| `Access to fetch at '…' from origin 'https://www.example.com' has been blocked by CORS policy` | The API's `CORS_ORIGIN` doesn't list the exact origin the site is served from (a new custom domain, or `www` vs the bare domain — they are different origins). The login `POST` never reaches the API; only the preflight does. The API log shows `cors.origin_rejected` with the origin. | Render → `ensemblis-api` → Environment → `CORS_ORIGIN`: add every origin, comma-separated, e.g. `https://www.example.com,https://example.com,https://<project>.vercel.app` (scheme and host only, no path, no spaces, no `*`). Save. **The change only takes effect when the deploy it starts succeeds** — if that deploy fails (see §8, P1002) the old value keeps running. Also set `APP_URL` to the one address people should land on (emails and share links use it). |
| *(API log, no browser symptom)* `[config] WARNING: CORS_ORIGIN entry "https//www.example.com" is IGNORED: not a valid origin … Did you mean "https://www.example.com"?` | One entry is malformed (here the colon after `https` is missing) and can never match, so that site is blocked while the others work. The API ignores such entries, and wildcards, and says so on every start. | Correct that entry in `CORS_ORIGIN` exactly as the log suggests. |
| `net::ERR_CONNECTION_REFUSED` to `http://localhost:4000/…`, or the page itself says the server address "was not set when the site was built" | `NEXT_PUBLIC_API_URL` was empty for that Vercel build, so the site calls localhost. It is baked in at build time. | Vercel → Settings → Environment Variables: set `NEXT_PUBLIC_API_URL` (Production) to the API's `https://…onrender.com` address, no trailing slash, then **redeploy** (a new build, not just a restart). |
| `Mixed Content` / "insecure (http://) server address" | `NEXT_PUBLIC_API_URL` starts with `http://`. | Use the `https://` address and redeploy. |
| `net::ERR_NAME_NOT_RESOLVED` or a timeout on the API host | The API address is misspelt, or the Render free instance is still waking (allow a minute and retry). | Check `NEXT_PUBLIC_API_URL` against the Render service URL. |

The API logs every origin it refuses once (`cors.origin_rejected`) and lists the allowed origins at start
(`api.listening` → `corsOrigins`), so Render's log answers "does the site's request even get in?".


```bash
cd backend && npm run build
npm run check:worker-restart   # kills the worker mid-step (SIGKILL and SIGTERM) and checks recovery
```
