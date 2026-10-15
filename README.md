# Ensemblis

**The AI operating layer for business. Describe the outcome. We do the work.**

You define a business objective and what success looks like. A Chief of Staff
plans it, assigns the steps to an AI organization (Heads of Marketing, Sales,
Finance and Operations and their specialists), runs the work, checks the result
against evidence and your success criteria, and tells you whether the objective
was achieved — with every claim traceable to a source.

```
BUSINESS OBJECTIVE → Chief of Staff → AI Team → PLAN → (approval) → EXECUTION
  → VERIFICATION → EVIDENCE → MEASURED OUTCOME → MEMORY
```

Safety by design: the AI Team only **reads, researches, analyses, drafts and
recommends**. It never sends email, publishes, changes external systems or
spends money on its own. Executions are charged only after you approve the plan
(or automatically, within a budget and approval threshold you set), and work
that fails or never runs is refunded.

```
ensemblis-app/
  backend/     Express + TypeScript + Prisma + Postgres: API, execution engine, worker
  frontend/    Next.js 14 (App Router)
  docker-compose.yml     local Postgres
  render.yaml            production blueprint: API + worker
  .github/workflows/ci.yml
```

---

## How it works

| Piece | Where | What it does |
|---|---|---|
| Objectives | `backend/src/engine/objectives.ts`, `api/objectives.ts` | Statement, success criteria (yours, or proposed and editable), deadline, budget, autonomy (`REVIEW_PLAN` / `AUTO_WITHIN_BUDGET`), context notes. |
| Chief of Staff planner | `engine/planner.ts` | One model call returning strict JSON (zod-validated), normalised against the registry (unknown capabilities dropped, framing first, synthesis last, ≤ 7 steps, deterministic cost). A labelled keyword fallback plan when the model output is unusable. Asks instead of guessing when company information is missing. No tool access. |
| AI Team registry | `org/registry.ts`, `org/tools.ts`, `org/policy.ts` | Executives → versioned capabilities → specialists, each with a tool allow-list. Every tool today is `READ_ONLY`; `WRITE`, `EXTERNAL_ACTION`, `FINANCIAL` and `DESTRUCTIVE` are modelled and denied by default. |
| Execution state machine | `engine/machine.ts`, `engine/lifecycle.ts` | `PLANNING → WAITING_FOR_APPROVAL → RUNNING → VERIFYING → COMPLETED`, plus `BLOCKED`, `FAILED`, `CANCELLED`. Guarded transitions, step fencing, bounded retries with back-off, then an exception for a person. |
| Durable queue + worker | `engine/queue.ts`, `engine/worker.ts`, `src/worker.ts` | Postgres `Job` table (`FOR UPDATE SKIP LOCKED`, leases, heartbeats, dead-lettering). Runs embedded in the API in development or as a separate process in production. |
| Recovery | `engine/recovery.ts` | Orphaned executions are re-enqueued, stalled ones failed and refunded, waits expire; nothing stays `RUNNING` forever. |
| Evidence & trust boundary | `engine/evidence.ts`, `engine/prompts.ts`, `engine/executor.ts` | Company context, document passages, website and web results become numbered `Evidence`. Untrusted content is fenced and neutralised in prompts; documents can't override instructions. |
| Verification gate | `engine/verification/*` | Deterministic claim ↔ evidence matching, citation checks, completeness and criteria coverage, an AI claim-support check (it can only downgrade), plus a model assessment per criterion with the evidence it relied on. PASS / PASS_WITH_WARNINGS / FAIL with a score, or UNVERIFIED when the AI verifier could not run (never shown as passed). FAIL triggers one automatic revision, then an exception. An LLM agreeing is never enough on its own. |
| Outcome & value | `engine/outcome.ts` | Per-criterion measurement (deterministic where a numeric target exists), overall ACHIEVED / PARTIALLY / NOT / UNKNOWN, user confirmation, and value records (cost, criteria met, cycle time; time saved only as a labelled estimate). |
| Memory | `memory/*`, `engine/learning.ts` | Learnings proposed after each execution; low-risk preferences are active, anything sensitive waits for confirmation. Review, edit, delete. |
| Live updates | `api/stream.ts`, `frontend/lib/stream.ts` | SSE tail of the persistent `ExecutionEvent` log, resumable from the last event id. |
| Billing | `engine/billing.ts`, `lib/wallet.ts`, `billing/*` | EUR wallet, atomic debit at execution start inside the same transaction as the status change, capped refunds, idempotent Stripe webhooks. |
| Tenancy | `org/organization.ts` | Every objective, execution, document and memory item belongs to an Organization (derived from the existing Team/wallet model). |

Every execution also gets a **result state**, separate from the AI-assessed
outcome: `verified`, `verified_with_warnings`, `partial` (a step was skipped or
research came back incomplete), `unverified`, `accepted_failed_verification`
(a person accepted a result that failed verification), or `in_progress` /
`blocked` / `failed` / `cancelled`. An outcome the AI measured is labelled
"(AI-assessed)" until a person confirms it.

---

## Research briefs (evidence-backed)

The one business outcome that runs end to end on real research: a brief from
an objective you define.

1. **Define** (`/objectives/new`): choose *Deliverable → Research brief
   (evidence-backed)*, write the objective, optional **constraints** (e.g. "EU
   sources only; no paid databases" — passed to every prompt as instructions)
   and success criteria. Launch is disabled, with the reason, when the AI
   provider isn't configured or web search is off.
2. **Plan**: the Chief of Staff plans framing → a *Business Research* step
   (Research Analyst, web search) → the brief. If the model key is missing or
   rejected, the quota is exhausted, or search is off, planning stops with a
   *Provider unavailable* exception and **nothing is charged**; Retry plans
   again once it is fixed.
3. **Research**: the step writes search queries and runs them on Tavily
   (falling back to Wikipedia when Tavily fails or its daily budget is spent —
   recorded as `degraded`). Every attempt is recorded (provider, HTTP status,
   result count, time) and every source becomes numbered **Evidence** with its
   provider, query, retrieval time and retrieval type (`search_snippet`: the
   search result's excerpt; pages are not fetched). A retried step reuses
   research that already succeeded instead of searching again.
4. **Write**: the brief has fixed sections — executive summary, key findings,
   analysis & inference, uncertainties, evidence gaps, recommendations,
   success criteria, next steps. Citations to sources that don't exist are
   removed, and links to domains that aren't evidence are unlinked, before it
   is stored.
5. **Verify**: claims are typed (`source`, `inference`, `uncertainty`,
   `recommendation`) and checked against the cited evidence; a recommendation
   or inference is never "supported" outright. A brief with **no external
   source** fails ("Insufficient evidence") and gets one automatic revision
   that researches again; company context alone never verifies a brief. If
   the AI verifier can't run, the result is re-checked once after
   `VERIFY_RETRY_DELAY_MS`, then handed to you as "could not be verified"
   (accepting keeps it `UNVERIFIED`, the outcome `UNKNOWN`, and refunds the
   verification fee).
6. **Read the console**: the result state, research badges per step,
   evidence provenance, per-criterion verdicts with evidence chips, claim
   types, **Open issues** (pending decisions, research gaps and failed
   searches, failed checks, unsupported or uncited claims, unmet criteria,
   open questions) and **Usage** (model calls by purpose, tokens — marked
   "est." when the provider reported none — latency and web searches by
   provider). A failed research or work step can be retried, or skipped with
   *Continue without this step* (refunded; the result is then `partial`).

### What is real, what is mocked

| | In production (real keys) | In this repository's automated tests |
|---|---|---|
| Planner, step executor, verifier | the configured model (Groq / OpenAI-compatible, Anthropic, Ollama) | the deterministic **mock** model (`AI_PROVIDER=mock`), or in `e2e:prod-like` the real OpenAI-compatible provider code against a local Groq-format **stub** that replays the mock's text |
| Web search | Tavily, else Wikipedia | local **stubs** with fixed fixtures (`tests/stubSearch.ts`, `scripts/search-stub.mjs`) |
| Queue, worker, wallet, state machine, Postgres | real | real (throwaway databases) |
| Token counts | measured when the provider reports usage (Groq, OpenAI, Anthropic), otherwise estimated and labelled "est." | estimated (mock) / measured from the stub's usage (prod-like) |

Anything produced by the mock model is labelled **"Mock AI — test output"** in
the console, exports and shared reports, and the mock refuses to run in
production. Charges shown are Ensemblis prices, not what the AI provider
billed. The only check of real model output with real search is the live
smoke (`npm run smoke:real`, scenario E), which needs real keys and network
access — see [DEPLOYMENT.md §5a](DEPLOYMENT.md). Known limit: sources are
search excerpts returned by the provider (no page fetch). Result URLs on
non-public hosts (loopback, private ranges, the cloud metadata address,
`.internal`/`.local` names) or with embedded credentials are dropped, and
evidence URLs are never fetched by the server.

### Run a brief yourself

```bash
# backend/.env: a real model and real search (see backend/.env.example)
AI_PROVIDER=openai OPENAI_API_KEY=<groq key>       # or anthropic / ollama
TAVILY_API_KEY=<tavily key>                         # without it: Wikipedia only ("limited evidence")
SEARCH_DAILY_BUDGET=200                             # default 30 successful Tavily calls a day

cd backend && npm run dev                           # API + embedded worker on :4000
cd frontend && npm run dev                          # http://localhost:3000 → Define → Research brief
```

Without keys, `AI_PROVIDER=mock` runs the same flow on mock output (labelled
as such) — useful for UI work, not as evidence of research quality.

---

## Local setup

**1. Database**

```bash
docker compose up -d          # Postgres 16 on localhost:5432 (user/pass/db: ensemblis)
```

**2. Backend**

```bash
cd backend
cp .env.example .env          # set JWT_SECRET to any long random string
npm install
npm run build                 # prisma generate + tsc
npm run migrate:deploy        # applies prisma/migrations (baselines a v3 `db push` database first)
npm run dev                   # API on http://localhost:4000, worker embedded
```

AI provider (`AI_PROVIDER` in `.env`):

- `mock` — deterministic scripted output; no model needed. For UI work and tests only (refused in production, labelled "Mock AI — test output" in the UI). Add `MOCK_AI_DELAY_MS=1500` to watch executions progress.
- `ollama` (default) — a free local model: install [Ollama](https://ollama.com), `ollama pull llama3.2`.
- `openai` — any OpenAI-compatible API (defaults to Groq's free tier).
- `anthropic` — the Claude API.

To run the worker as its own process (as in production): set `EMBEDDED_WORKER=false` and run `npm run dev:worker` next to `npm run dev`.

Changing the schema: edit `prisma/schema.prisma`, then `npm run migrate:dev -- --name <change>` and commit the new folder under `prisma/migrations/`. Production applies migrations with `migrate deploy` only.

**3. Frontend**

```bash
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                   # http://localhost:3000
```

---

## Tests

```bash
# backend — real Postgres (database ensemblis_test is reset by the test run)
cd backend && npm run lint && npm run typecheck && npm test

# frontend — unit tests
cd frontend && npm run lint && npm run typecheck && npm test

# end to end — real browser, real API, separate worker, mock AI, stub web search
cd backend && npm run build && cd ../frontend && npm run e2e
# …and production-like: NODE_ENV=production, the real OpenAI-compatible provider code
# against a local stub that speaks Groq's streaming format
cd frontend && npm run e2e:prod-like

# worker crash/deploy recovery with real processes (SIGKILL and SIGTERM mid-step)
cd backend && npm run build && npm run check:worker-restart

# REAL model and REAL web search (spends tokens and searches): scenarios E,A,B,C,D
cd backend && AI_PROVIDER=openai OPENAI_API_KEY=… TAVILY_API_KEY=… npm run smoke:real
```

The mock suites prove the execution architecture; `smoke:real` (also a manual
GitHub Actions workflow, "Real-model smoke") checks the intelligence: a
research brief with real search (E: provenance, citation ↔ evidence mapping,
typed claims, per-criterion evidence, measured usage, no key leaks — reported
SKIPPED, never passed, when search is off), valid plans with real
capabilities, exceptions instead of invented facts, cross-functional staffing,
evidence-linked verification and resistance to an instruction planted in a
company document. Its report labels a mock, stub or local endpoint run as
such, and an unverified result as UNVERIFIED rather than passed.

What the suites cover: the full objective lifecycle; step retries, exhausted
retries → exception → retry without double charge; config errors; crash
mid-step with lease recovery and fencing; dead jobs; orphan and stall
recovery; approval policy, budget threshold, insufficient funds, concurrent
approvals; missing information → answer → re-plan; verification failure →
automatic revision → exception → accept/retry/cancel; cancel refunds;
organization isolation (API and browser); wallet atomicity, refund caps and
Stripe idempotency; email verification and admin gating; SSE resume; legacy
report sharing; research briefs (mock model, stub search): provenance,
citation mapping, per-criterion evidence, and every failure mode — search off,
planner key/quota errors, step quota, Tavily 401 → Wikipedia, all searches
failing, verifier unavailable, injected instructions and unsafe URLs in
results, keys in provider errors, retry without re-searching, skipping a
step; and in the browser: sign up → context → define → plan →
approve → refresh mid-execution → verified result → evidence → outcome →
public link → sharing off, a keyboard-only research brief (research badge,
evidence provenance, per-criterion verdicts, open issues, usage, mock label,
390px), plus the exception and cancel/refund paths.

CI (`.github/workflows/ci.yml`) runs backend lint, typecheck, a schema ↔
migrations drift check, tests and build; frontend lint, typecheck, unit tests
and build; then the Playwright suite.

---

## Deploying

**Production rollout, environment checklist, smoke test and rollback: see
[DEPLOYMENT.md](DEPLOYMENT.md).** Roll back only to the `v3-rollback-safe`
branch, never to v3 as it was (its boot-time `prisma db push` fails against the
v4 schema).

| Piece | Host |
|---|---|
| Database | Managed Postgres, e.g. [Neon](https://neon.tech) (direct, non-pooled URL with `?sslmode=require`) |
| API + worker | [Render](https://render.com) via `render.yaml` (worker = paid plan), or any Docker host via `backend/Dockerfile` |
| AI model | Groq free tier (`AI_PROVIDER=openai`) or any supported provider |
| Frontend | [Vercel](https://vercel.com) (root directory `frontend`) |

**Render.** New → Blueprint → this repo. It creates `ensemblis-api` (web) and
`ensemblis-worker` (background worker; settings both read are listed on each
service and must stay identical), and asks for `DATABASE_URL`, `CORS_ORIGIN`,
`APP_URL`, `OPENAI_API_KEY` and the optional keys. The API start command is `npm run start:render`:
`dist/ops/migrate.js` (apply pending migrations; a database created by v3's
`prisma db push` is first marked as baseline `0_init`, no data touched) then
the server. **`prisma db push` is no longer used anywhere.** Background workers
need a paid plan; on the free plan remove the worker service **in
`render.yaml`** and set `EMBEDDED_WORKER` to `"true"` there (a dashboard edit is
overwritten by the next Blueprint sync).

**Docker.** One image: the default command migrates then serves the API; run
the worker with `node dist/worker.js` (it waits until the API has applied the
migrations). Probe the API container at `/health`; the image has no
HEALTHCHECK because the worker serves no HTTP.

**Vercel.** Root directory `frontend`; set `NEXT_PUBLIC_API_URL` (the API URL)
and `NEXT_PUBLIC_CONTACT_EMAIL` (shown on the legal pages). Put the Vercel URL
in the API's `CORS_ORIGIN` and `APP_URL`.

**Health.** `GET /health` checks the database and reports queue depth, oldest
queued job age and dead jobs (503 when the database is unreachable).
`GET /health/live` is a plain liveness probe.

**Operators.** `ADMIN_EMAILS` lists who may open `/admin`, and the address
must also be verified (email link, or `npm run ops:verify-email -- you@example.com`
run against the production database). Signing up with a listed address grants
nothing by itself.

Optional services (all off until configured; see `backend/.env.example`):
`TAVILY_API_KEY` (web search — needed for research briefs; otherwise Wikipedia, or `SEARCH_PROVIDER=off`, which blocks briefs),
`RESEND_API_KEY` + `EMAIL_FROM` (verification, notifications, password reset),
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (real top-ups; webhook
`/api/billing/stripe/webhook`), `TURNSTILE_*` (bot check), `GUEST_*` (trial
without an account).

---

## Upgrading from v3 (task marketplace)

Nothing is deleted. Users, balances, transactions, teams, invites, tasks,
reports and share links are kept:

- The first deploy baselines the existing schema and applies one additive
  migration (new tables and nullable columns only).
- Each user gets an Organization on first use; team members share their team
  owner's organization, mirroring the existing shared-wallet rule.
- Earlier task reports are listed under **Objectives → Earlier reports**,
  read-only, and their `/r/<token>` links keep working.
- Marketplace pages and APIs (agents, developers, publishing, payouts, gallery)
  are retired; old public URLs redirect to the home page.
