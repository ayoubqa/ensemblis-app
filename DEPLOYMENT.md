# Deploying Ensemblis v4 (outcome execution system)

Production today runs **v3** from `main` (`a1684bb`): one Render web service
(`ensemblis-api`) whose start command runs `prisma db push`, a Neon Postgres
database, and the Next.js frontend on Vercel. v4 is the branch
`ensemblis-outcome-execution-system`.

What changes at deploy time:

| | v3 (now) | v4 |
|---|---|---|
| Schema changes | `prisma db push` at every boot | `prisma migrate deploy` at boot (`dist/ops/migrate.js`); never `db push` |
| Execution | in the API process | durable Postgres job queue + **`ensemblis-worker`** (separate Render service) |
| AI | Groq `openai/gpt-oss-120b` | same provider and keys |
| Admin (`/admin`) | `ADMIN_EMAILS` match | `ADMIN_EMAILS` match **and a verified email** |

The v4 migration is purely additive (new tables, nullable columns, no drops,
no rewrites). It was verified on a database created by v3's own `db push`:
users, password hashes, balances, transactions, teams, tasks/reports and share
tokens survive unchanged, and the schema ends with zero drift.

---

## 1. Decide the worker plan

Render background workers are **not available on the free plan** (`render.yaml`
uses `plan: starter` for `ensemblis-worker`).

- **Recommended:** keep `ensemblis-worker` on a paid plan. The API can sleep or
  redeploy without pausing executions.
- **Free plan only:** delete the `ensemblis-worker` block from `render.yaml`
  before merging and set `EMBEDDED_WORKER=true` on `ensemblis-api`. Executions
  then run inside the API process and pause while a free instance sleeps
  (recovery resumes them when it wakes). Workable for a demo, not for real
  customers.

## 2. Environment checklist (names only — never commit values)

Set in Render (`ensemblis-shared` group values are in `render.yaml`; the ones
below are entered in the dashboard, `sync: false`):

| Variable | API | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✔ | ✔ | Neon **direct** (non-pooled) URL with `?sslmode=require`; same value on both |
| `OPENAI_API_KEY` | ✔ | ✔ | Groq key (the worker makes almost all model calls) |
| `APP_URL` | ✔ | ✔ | frontend URL, no trailing slash — used in email and share links |
| `CORS_ORIGIN` | ✔ | – | frontend URL(s), comma-separated |
| `ADMIN_EMAILS` | ✔ | – | operators; must also verify their email (see §6) |
| `TAVILY_API_KEY` | ✔ | ✔ | optional web search (otherwise Wikipedia) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✔ | ✔ | optional email: verification, notifications, password reset |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ✔ | – | optional real payments |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | ✔ | – | optional bot check |
| `SIGNUP_INVITE_CODE` | ✔ | – | optional invite-only sign-up |

Set by `render.yaml` (check they are present after the Blueprint sync):
`NODE_ENV=production`, `AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_MODEL`,
`OPENAI_FAST_MODEL`, `OPENAI_REASONING_EFFORT=low`, `OPENAI_MAX_TOKENS`,
`MAX_CONCURRENT_LLM`, `JWT_SECRET` (generated once in the group, shared by API
and worker), `IP_HASH_SALT`, `EMBEDDED_WORKER=false` (API),
`WORKER_CONCURRENCY` (worker), cost caps and guest-trial settings.

Vercel (frontend): `NEXT_PUBLIC_API_URL` (the API's `https://…onrender.com`
URL, no trailing slash) and `NEXT_PUBLIC_CONTACT_EMAIL`. `NEXT_PUBLIC_*` values
are baked in at build time: redeploy the frontend after changing them.

`AI_PROVIDER=mock` cannot run in production: the API and worker refuse to
start with it when `NODE_ENV=production` **or** on Render (`RENDER` is set),
and the provider refuses it at call time.

## 3. Before merging: rehearse on a copy of production (recommended, ~10 min)

1. In Neon, create a **branch** of the production database (e.g. `pre-v4`).
   This is also your backup: the branch keeps the exact pre-v4 state.
2. Point a local checkout at that branch and run the migration and checks:

   ```bash
   git checkout ensemblis-outcome-execution-system
   cd backend && npm ci && npm run build
   DATABASE_URL="<neon pre-v4 branch URL>" node dist/ops/migrate.js
   # expect: "database state: legacy-db-push" → baseline 0_init → apply 20261007120000_outcome_execution_system
   DATABASE_URL="<neon pre-v4 branch URL>" npx prisma migrate diff \
     --from-url "<neon pre-v4 branch URL>" --to-schema-datamodel prisma/schema.prisma --exit-code
   # expect: "No difference detected."
   ```
3. Optionally run the API against the branch (`DATABASE_URL=… NODE_ENV=development
   JWT_SECRET=<prod value> npm start`) and log in with a real account: balance,
   reports and share links should be unchanged.
4. Run the real-model smoke test with the production model (§5).

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
   - `ensemblis-worker` is created from the Blueprint. Fill in its `sync: false`
     variables (§2) if Render asks, then make sure it is **running**.
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

Real-model check before inviting users (spends tokens, ≈ one objective):

```bash
cd backend && npm run build
AI_PROVIDER=openai OPENAI_API_KEY=<groq key> OPENAI_BASE_URL=https://api.groq.com/openai/v1 \
OPENAI_MODEL=openai/gpt-oss-120b OPENAI_FAST_MODEL=openai/gpt-oss-20b OPENAI_REASONING_EFFORT=low \
npm run smoke:real            # needs a local Postgres with a database named ensemblis_smoke
```

or run the **Real-model smoke** workflow in GitHub Actions after adding the
repository secret `SMOKE_OPENAI_API_KEY`. The report lists every check, the
plans the model produced, tokens, failures and latency.

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
2. Render `ensemblis-worker`: **Suspend** it (it only processes v4 executions).
3. Render `ensemblis-api`: *Settings* → *Build & Deploy* → **Branch** =
   `v3-rollback-safe` → *Manual Deploy* → *Deploy latest commit*.
   (If the service is Blueprint-managed and the setting is locked, change the
   start command instead to `node dist/seed.js && node dist/index.js` and
   redeploy commit `a1684bb`.)
4. Check `/health` and log in with an existing account.

To roll forward again, set the branch back to `main` and resume the worker;
`migrate.js` sees the migrations already applied and starts immediately.

v4 data created before a rollback (objectives, executions, company context)
stays in its tables, invisible to v3, and reappears after rolling forward.

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
