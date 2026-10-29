# Ensemblis

Product: "The AI operating layer for business." A person describes an outcome. Ensemblis then:
1. plans it, with a cost in credits;
2. gets approval;
3. runs read-only research and analysis steps;
4. numbers every source;
5. verifies the result;
6. reports with its limitations stated.

## Layout

- `backend/`: Express + Prisma + TypeScript. Deployed on Render (`ensemblis-api`, free plan; the worker is
  embedded in the API process). Database: Neon Postgres.
- `frontend/`: Next.js 14 app router. Deployed on Vercel (`www.getensemblis.com`). Pages live in `app/`,
  the Journal in `content/blog/`.
- `docs/`:
  - `DEPLOYMENT.md` (repo root): every environment variable, the runbook, the live smoke test.
  - `docs/growth/`: website, measurement, validation plan, quality scorecard (09), controlled test (10).
  - `docs/product/`: Phase 4 strategy, `metrics.sql`.

## Where things are (backend/src)

| Concern | Files |
|---|---|
| Execution state machine (planning → approval → steps → verification → outcome) | `engine/machine.ts`, `lifecycle.ts`, `queue.ts`, `worker.ts`, `recovery.ts` |
| Planner (plan = registry capabilities; playbook fallback) | `engine/planner.ts`, `org/registry.ts` (18 capabilities, credit prices) |
| Step execution, evidence, citations | `engine/executor.ts`, `evidence.ts`, `research/citations.ts` |
| Web research | `research/search.ts` (Tavily → Wikipedia fallback), `sources.ts` (status ok / degraded / no_results / failed / off) |
| Verification and result state | `engine/verification/*` (deterministic checks plus a model check that can only downgrade), `resultState.ts` |
| Models | `ai/llmProvider.ts`: `runLLM()` is the only entry point. `AI_PROVIDER` is openai (Groq in production) / anthropic / ollama / mock. Tiers: main / fast. Every call is metered. |
| Credits and money | `engine/billing.ts` (charge at start, refunds), `lib/wallet.ts` (ledger), `billing/credits.ts`, `billing/pricing.ts` (`PROVIDER_PRICING`), `billing/economics.ts` |
| Spend guards | `engine/budget.ts` (token ceiling, affordability), `engine/costGuard.ts` (monetary limit per run), `lib/usageLimits.ts` (runs per user per day) |
| Context, memory, recurring work | `context/service.ts`, `memory/service.ts`, `workflows/*` |
| Quality tooling | `eval/scorecard.ts` + `ops/scorecard.ts` (`npm run eval:scorecard`), `scripts/real-model-smoke.mjs` |

## Commands

```bash
# Backend. Tests need local Postgres; in a cloud container run `service postgresql start` first.
cd backend && npx tsc --noEmit && npm run lint && npx vitest run   # full suite, about 5 minutes
npx vitest run tests/integration/costGuard.test.ts                 # one file
# Frontend
cd frontend && npm run lint && npm run typecheck && npx vitest run && npm run content:check
CI=true npm run e2e && CI=true npm run e2e:prod-like               # Playwright against the mock stack (it builds the backend)
cd backend && npm run check:worker-restart                         # real process kill during an execution
```

**Never run two backend vitest processes at once.** They share `ensemblis_test` and truncate it between tests, so
failures from a concurrent run are not real.

## Rules that hold in every task

- **Honesty over appearance.**
  - Show these states to the user; never hide them: mock model, test-stub or custom endpoint, Wikipedia-only
    ("degraded") research, partial, unverified.
  - Never mark something verified, passed or achieved without the check having run.
- **Costs come from `PROVIDER_PRICING` and are never guessed.**
  - An unpriced event stays null.
  - Customer-facing text never shows provider costs, keys, HTTP errors or environment variable names.
- **Credits are whole units** stored in the historical `*Cents` columns (100 credits = €1 list value).
  - One ledger: `Transaction`, with `reason`, `balanceAfter` and `idempotencyKey`. Don't add a second ledger.
- **No paid API calls in development or tests.**
  - Use the mock provider, `scriptLLM()`, and `tests/stubSearch.ts` / `scripts/search-stub.mjs`.
  - The real-model smoke workflow spends money: run it only with the owner's approval.
- **Never:**
  - print, commit or log secrets;
  - change `SIGNUP_INVITE_CODE` or invite-only sign-up;
  - run destructive migrations (additive and nullable only);
  - merge PRs #4–#7 without the owner's decision. That stack is unmerged, conflicts in `index.ts` and
    `config.ts`, and contains the premium route, step checks, feedback and the daily token budget.
- **Releases:**
  - PR to `main` with a **merge commit**. CI must be green, including the *Production smoke* baseline.
  - Vercel deploys every push to `main`. Render deploys the API when `backend/` changes.
  - The post-merge smoke waits for the site's `ensemblis-release` meta tag and the API's `/health/live` `release`.
  - Merging a PR cancels any in-progress `main` smoke run (concurrency group), so let a running one finish first.
- **Production is read-only to us.** Use the *Production smoke* workflow (public endpoints only). The sandbox
  can't reach getensemblis.com or onrender.com directly.

## Writing style for docs, PRs, commits

Plain, specific, honest. Say what was verified and where: production, CI or local.
- Label hypotheses as hypotheses.
- Counts, not rates, for small samples.
- Commit trailers per the session's attribution rules.
