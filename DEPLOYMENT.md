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
| `DATABASE_URL` | ✔ | ✔ | Neon **direct** (non-pooled) URL with `?sslmode=require`; same value on both |
| `OPENAI_API_KEY` | ✔ | ✔ | Groq key (the worker makes almost all model calls) |
| `APP_URL` | ✔ | ✔ | frontend URL, no trailing slash — used in email and share links |
| `CORS_ORIGIN` | ✔ | – | frontend URL(s), comma-separated |
| `ADMIN_EMAILS` | ✔ | – | operators; must also verify their email (see §6) |
| `TAVILY_API_KEY` | ✔ | ✔ | web search — **required for research briefs**; without it search falls back to Wikipedia only (briefs are labelled limited evidence) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✔ | ✔ | optional email: verification, notifications, password reset |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✔ | – | optional real payments |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | ✔ | – | optional bot check |
| `SIGNUP_INVITE_CODE` | ✔ | – | optional invite-only sign-up |
| `PREMIUM_API_KEY` | ✔ | ✔ | optional: an **OpenAI** API key (not the Groq key) for the premium model route below; empty keeps every call on Groq |

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
| `SEARCH_PROVIDER` | `tavily` when `TAVILY_API_KEY` is set, else `wikipedia` | `tavily` \| `wikipedia` \| `off`. Tavily without a key quietly becomes Wikipedia (the define page then labels a brief "limited evidence"); `off` blocks research briefs at planning (`PROVIDER_UNAVAILABLE`, nothing charged). |
| `SEARCH_DAILY_BUDGET` | `30` | Successful Tavily calls per UTC day, server-wide (failed calls no longer count). A research step makes 3 searches and other web steps 2 each (plus 2 when a brief's one automatic revision researches again), so a brief typically uses 3–9 and 30 allows only a few briefs a day: raise it (e.g. `200`) for demos and the live smoke. When it is spent, searches fall back to Wikipedia and the research is recorded as `degraded`. |
| `VERIFY_RETRY_DELAY_MS` | `60000` | When the AI verifier can't run (key, quota, timeout, unusable reply) the result is **not verified** (`UNVERIFIED`): it is checked again once after this pause, then handed to a person as "The result could not be verified" (accept / retry / cancel). Accepting keeps it `UNVERIFIED`, the outcome `UNKNOWN`, and refunds the verification fee. |
| `TAVILY_BASE_URL` | `https://api.tavily.com` | **Tests only** (points search at a local stub). Never set it in production: results that used it carry a "Custom search endpoint" notice and the API logs a production warning at boot. |

Credits and cost accounting (API only; defaults shown — none needs setting for a normal deploy):

| Variable | Default | What it does |
|---|---|---|
| `CREDITS_PER_EUR` | `100` | Internal value of a credit (1 credit = €0.01 at the default) for accounting and pricing. Balances are stored as whole credits and are **not** rewritten when it changes; every existing balance was issued at 100 per €1, so changing it revalues them internally (the API logs a warning). Leave it at 100 unless you deliberately re-denominate. |
| `MAX_TOKENS_PER_EXECUTION` | `600000` | Runaway guard: an execution whose model calls have used this many tokens stops before its next step (or verification) and fails, which refunds its credits. `0` turns it off. A normal execution uses well under 100,000. |
| `PROVIDER_PRICING` | set in `render.yaml` (checked 2026-10-23) | JSON price table for **internal** cost accounting (owner dashboard, `/api/admin/economics`): per-million-token prices per model, per-call prices per paid tool, exchange rates to EUR, plus `asOf` (the date the prices were checked; older than 90 days is flagged on the dashboard) and `sources`. Optional `fixedMonthlyEur` (e.g. `{"render":0,"neon":19}`, allocated pro rata) and `paymentFees` (`{"percent":1.5,"fixedEurCents":25}` per completed purchase) — left out, they are reported as *not configured*, never as zero. Change it in `render.yaml` (a dashboard edit is overwritten by the next Blueprint sync); take numbers only from the providers' own price pages. Unset or invalid: usage is still recorded, but costs stay unpriced (never guessed). None of the resulting figures is net profit: credit value is list price (demo credits are not revenue), and taxes and labour are never included. |

Premium model route (optional; same values on the API and a standalone worker). `render.yaml`
sets `PREMIUM_MODEL=gpt-5.5`, `PREMIUM_REASONING_EFFORT=low` and `PREMIUM_DAILY_BUDGET_EUR=2`; the
route stays **off** until `PREMIUM_API_KEY` is set:

| Variable | Default | What it does |
|---|---|---|
| `PREMIUM_MODEL` | unset (off) | Model id at the premium endpoint, served over Chat Completions. Main-tier calls for the purposes below go to it; fast-tier calls (search queries, memory, claim checks) stay on `OPENAI_MODEL`/`OPENAI_FAST_MODEL`. |
| `PREMIUM_BASE_URL` | `https://api.openai.com/v1` | The premium endpoint. |
| `PREMIUM_REASONING_EFFORT` | `low` | `none`, `low`, `medium`, `high` or `xhigh` (GPT-5.5's own default is `medium`, which spends more tokens). |
| `PREMIUM_MAX_TOKENS` | the call's own cap | Output cap per premium call (reasoning tokens count towards it). |
| `PREMIUM_PURPOSES` | `plan,step,verify` | Which calls it serves. |
| `PREMIUM_DAILY_BUDGET_EUR` | `2` | Premium spend per UTC day, summed from priced usage; once reached, every call uses the fallback until midnight UTC. `0` turns the route off. |

The fallback is the standard route (`OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`, Groq
gpt-oss-120b). A premium call that fails before any output reached the user (bad key, unknown
model, quota, rate limit, provider error, timeout) is retried on the fallback within the same call;
key, model and quota errors pause the premium route for 15 minutes, rate limits for 1 minute. The
route is used only while `PREMIUM_MODEL` has a price in `PROVIDER_PRICING` (otherwise the daily
budget can't be enforced). The owner dashboard's AI tile shows whether it is on, paused or over
budget. Whether the OpenAI account behind the key can use the model is only known after a call —
check the boot log and the dashboard after setting the key.

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


**Owner dashboard: economics and market validation.** Two internal panels (never
shown to customers; `GET /api/admin/economics` and `GET /api/admin/validation`):
unit economics (credits consumed, measured and estimated variable cost, cash
collected, fixed plans and fees when configured — none of it net profit), and
market validation for the last 30 days: people who signed up → defined an
objective → got a completed result → got a verified result → came back, plus
completion and result states, outcomes a person confirmed (and how often they
agree with the AI), credits and variable cost per completed execution, failures
by kind, repeat use and "Was this result useful?" answers with the latest
comments. It is derived from existing records (no tracking scripts, no prompt or
result text); operator accounts (`ADMIN_EMAILS`) are left out.

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

**Rolling back past the step deliverable check** (`20261024090000_step_deliverable`):
nothing to do. It adds one nullable JSON column (`ExecutionStep.deliverable`)
that an older build ignores; steps completed while rolled back simply have no
deliverable verdict ("Not checked" in the work ledger).

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

## 9. Recovery checks you can run anytime

```bash
cd backend && npm run build
npm run check:worker-restart   # kills the worker mid-step (SIGKILL and SIGTERM) and checks recovery
```
