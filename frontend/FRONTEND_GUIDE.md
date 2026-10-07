# Ensemblis frontend guide

Next.js 14 (App Router) + plain CSS classes in `app/globals.css` (Tailwind is available for one-off layout; its preflight is off). Every page talks to the backend through `lib/api.ts`.

The product vocabulary is fixed — use it in every string:

| Say | Not |
|---|---|
| Objective, outcome, success criteria | task, brief, job |
| Plan, step, execution, attempt | run (except "Run again"), pipeline |
| Chief of Staff, AI Team, executive, specialist, capability | agent, bot, marketplace, hire |
| Evidence, verification, claim | sources-only, "verified" (unless the verification gate passed) |
| Approval, exception | confirm dialog, error |
| Usage, spend, balance, budget | credits, purchase agents |
| Organization, members | team (except in the `team` model/API) |

---

## 1. Ground rules

| Rule | How |
|---|---|
| Money is integer **cents** | Render with `eur(cents)` (`€25`, `€12.50`). Never divide by 100 by hand. |
| No fake numbers | Never show invented metrics, activity or ROI. Estimates are labelled as estimates (e.g. "planner estimate"). Illustrations on marketing pages are labelled "example, not a real run". |
| Private pages | Wrap in `<RequireAuth>`. A 401 from any call clears the session and the auth context redirects (see `UNAUTHORIZED_EVENT` in `lib/api.ts`). |
| Balance changes | Calls that change the balance return `user`; call `setUser(user)` or `refresh()` from `useAuth()`. |
| Attention badges | After approving/rejecting/resolving, call `refreshAttention()` so the header badges update. |
| Feedback | `useToast()`; never `alert()`. Destructive confirmations go in a `<Modal>` (the console uses `window.confirm` only for cancel). |
| Links | `ROUTES` from `lib/routes.ts` + `next/link`. Validate `?next=` with `safeNext()`. |
| Theme | Dark is the default; colors come from CSS variables (`--bg --surface --surface2 --ink --muted --line --accent --ok --warn --bad` and `-soft` variants). Never hard-code colors. `.dk` forces the dark palette on a section. |
| A11y | Clickable cards are links or buttons; icon-only buttons need `aria-label`; forms use `label.l` + `input.f`, `aria-invalid`, `.err`, and `aria-busy` on submit buttons. |
| Test hooks | Key elements carry `data-testid` (see §6). Keep them when refactoring — the E2E suite depends on them. |

---

## 2. Information architecture (`lib/routes.ts`)

| Route | Page |
|---|---|
| `/` | Landing (hero, how it works `#how`, AI organization, trust `#trust`) |
| `/dashboard` | Chief of Staff briefing: what needs attention, what's running, recent outcomes, latest activity |
| `/objectives` | Objective list (tabs: all, in progress, needs attention, completed, drafts, failed & cancelled, earlier reports) |
| `/objectives/new` | Define an outcome (statement, success criteria + suggestions, deadline, budget, autonomy, context notes) |
| `/objectives/:id` | Objective console: plan, approvals, live execution (SSE), verification, result, evidence, outcome, learnings, activity, attempts |
| `/ai-team` | The AI organization: executives, versioned capabilities, specialists, tool permissions |
| `/context` | Company Context (profile, website, documents) and Memory (`#memory`) |
| `/approvals`, `/exceptions` | Approval Center, Exception Center |
| `/usage` | Balance, spend per objective, transactions, top-ups/checkout |
| `/routines` | Recurring objectives |
| `/team` | Organization members & invites (`ROUTES.members`) |
| `/settings` | Profile, email verification, password, organization policy (owner), appearance, notifications |
| `/tasks/:id` | Read-only earlier report (pre-v4); `/tasks` → `/objectives?group=earlier` |
| `/r/:token` | Public shared result (execution) or earlier report |
| `/admin` | Operations console (verified `ADMIN_EMAILS` only) |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/join/:token`, `/privacy`, `/terms` | Account flows and legal |

Retired marketplace URLs (`/agents`, `/developers`, `/pricing`, …) redirect to `/` (`next.config.js`).

---

## 3. Live execution

`app/objectives/[id]/_components/useObjectiveLive.ts` loads the objective, then opens `openExecutionStream()` (`lib/stream.ts`): a `fetch()`-based SSE reader (the token goes in the `Authorization` header, never the URL) that tails the persistent `ExecutionEvent` log from the last seen id. On disconnect it reconnects with `?after=<last id>`, so a refresh or network blip never loses or duplicates events; if streaming fails it falls back to polling. `step-progress` messages carry a step's partial output while it is being written.

---

## 4. Components (`@/components`, `@/components/ops`, `@/components/report`)

| Component | Use |
|---|---|
| `StatusTag`, `StepStatusTag`, `OutcomeTag`, `VerificationTag`, `CriterionTag`, `ClaimTag`, `RiskTag`, `Tag` | Status vocabulary (`components/Tags.tsx`; `statusLabel`, `outcomeLabel`, `isLiveStatus`) |
| `ApprovalCard`, `ExceptionCard`, `EventFeed`, `ExecBadge`, `Section`, `Money` | Operations building blocks (`components/ops.tsx`) used by the console, briefing and centers |
| `ReportView`, `ExportMenu` | Markdown result with `[n]` citation chips, TOC, sources panel; PDF/Word/Markdown export |
| `PageHead`, `Tabs`, `EmptyState`, `Flow` (Objective → Plan → Approve → Execute → Verify → Outcome), `ProgressBar`, `Skeleton*`, `KV`, `Stat` | Layout (`components/UI.tsx`) |
| `Modal`, `useToast`, `useShell` | Overlays |
| `LineChart`, `Sparkline`, `HBar` | SVG charts (operations console only — real data) |
| `Header` (nav + Approvals/Exceptions badges via `useAttention`), `BottomNav`, `Footer`, `CommandPalette`, `DemoBanner`, `GuestBanner` | Shell — already mounted by `app/layout.tsx` |

Keyboard: ⌘K / Ctrl K palette · `?` shortcuts · `N` define an outcome · `G` then `D` dashboard, `O` objectives, `T` AI Team, `C` context, `A` approvals, `E` exceptions, `U` usage, `R` recurring, `S` settings, `H` home.

---

## 5. Helpers

- `lib/format.ts`: `eur`, `num`, `pct`, `relativeTime`, `shortDate`, `longDate`, `dateTime`, `duration`, `plural(n, word, pluralWord?)`, `firstName`, `greeting`
- `lib/hooks.ts`: `usePolling` (pauses in hidden tabs; return `false` to stop), `useKeyboardShortcut`, `useLocalStorage`, `useDebounced`, `useIsMobile`, …
- `lib/extract.ts`: in-browser text extraction for Company Context documents (PDF, DOCX, XLSX, CSV, text)
- `lib/data.ts`: static copy only — `EXAMPLE_OBJECTIVES` (starting points on the define page), `LOOP` (how-it-works steps), `FREQ_PER`

---

## 6. Tests

```bash
npm run lint && npm run typecheck
npm test                 # vitest: SSE parser + resume, redirect safety, status vocabulary, markdown/citations
npm run e2e              # Playwright, needs backend built (cd ../backend && npm run build) and local Postgres
E2E_TOUR=1 npm run e2e -- tour   # optional: screenshots of every main screen in test-results/tour/
```

The E2E stack (`backend/scripts/e2e-stack.mjs`) resets the `ensemblis_e2e` database, starts the API with the embedded worker off plus a separate worker process, and uses the mock AI provider with simulated latency (web search off). Test ids used: `signup-submit`, `save-context`, `objective-statement`, `suggest-criteria`, `criterion-input`, `submit-objective`, `objective-console`, `execution-status` (`data-status`, `data-verification`), `plan-step` (`data-status`), `approval-card`, `exception-card`, `live-card`, `verification-check`, `evidence-list`, `outcome-panel`, `share-link`, `shared-report`, `briefing`, `objective-list`, `balance`.
