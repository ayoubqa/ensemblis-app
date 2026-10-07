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
| Verification gate | `engine/verification/*` | Deterministic claim ↔ evidence matching, citation checks, completeness and criteria coverage, plus a model assessment. PASS / PASS_WITH_WARNINGS / FAIL with a score; FAIL triggers one automatic revision, then an exception. An LLM agreeing is never enough on its own. |
| Outcome & value | `engine/outcome.ts` | Per-criterion measurement (deterministic where a numeric target exists), overall ACHIEVED / PARTIALLY / NOT / UNKNOWN, user confirmation, and value records (cost, criteria met, cycle time; time saved only as a labelled estimate). |
| Memory | `memory/*`, `engine/learning.ts` | Learnings proposed after each execution; low-risk preferences are active, anything sensitive waits for confirmation. Review, edit, delete. |
| Live updates | `api/stream.ts`, `frontend/lib/stream.ts` | SSE tail of the persistent `ExecutionEvent` log, resumable from the last event id. |
| Billing | `engine/billing.ts`, `lib/wallet.ts`, `billing/*` | EUR wallet, atomic debit at execution start inside the same transaction as the status change, capped refunds, idempotent Stripe webhooks. |
| Tenancy | `org/organization.ts` | Every objective, execution, document and memory item belongs to an Organization (derived from the existing Team/wallet model). |

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

# end to end — real browser, real API, separate worker, mock AI
cd backend && npm run build && cd ../frontend && npm run e2e
```

What the suites cover: the full objective lifecycle; step retries, exhausted
retries → exception → retry without double charge; config errors; crash
mid-step with lease recovery and fencing; dead jobs; orphan and stall
recovery; approval policy, budget threshold, insufficient funds, concurrent
approvals; missing information → answer → re-plan; verification failure →
automatic revision → exception → accept/retry/cancel; cancel refunds;
organization isolation (API and browser); wallet atomicity, refund caps and
Stripe idempotency; email verification and admin gating; SSE resume; legacy
report sharing; and in the browser: sign up → context → define → plan →
approve → refresh mid-execution → verified result → evidence → outcome →
public link → sharing off, plus the exception and cancel/refund paths.

CI (`.github/workflows/ci.yml`) runs backend lint, typecheck, a schema ↔
migrations drift check, tests and build; frontend lint, typecheck, unit tests
and build; then the Playwright suite.

---

## Deploying

| Piece | Host |
|---|---|
| Database | Managed Postgres, e.g. [Neon](https://neon.tech) (direct, non-pooled URL with `?sslmode=require`) |
| API + worker | [Render](https://render.com) via `render.yaml`, or any Docker host via `backend/Dockerfile` |
| AI model | Groq free tier (`AI_PROVIDER=openai`) or any supported provider |
| Frontend | [Vercel](https://vercel.com) (root directory `frontend`) |

**Render.** New → Blueprint → this repo. It creates `ensemblis-api` (web) and
`ensemblis-worker` (background worker) sharing the `ensemblis-shared` env
group, and asks for `DATABASE_URL`, `CORS_ORIGIN`, `APP_URL`, `OPENAI_API_KEY`
and the optional keys. The API start command is `npm run start:render`:
`dist/ops/migrate.js` (apply pending migrations; a database created by v3's
`prisma db push` is first marked as baseline `0_init`, no data touched) then
the server. **`prisma db push` is no longer used anywhere.** Background workers
need a paid plan; on the free plan delete the worker service and set
`EMBEDDED_WORKER=true` on the API.

**Docker.** One image: the default command migrates then serves the API; run
the worker with `node dist/worker.js`.

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
`TAVILY_API_KEY` (web search; otherwise Wikipedia, or `SEARCH_PROVIDER=off`),
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
