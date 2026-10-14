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

## 1. Brand system

The official **Ensemblis Brand + Creative Web Pack** is the source of truth: *The AI operating layer for business — Describe the outcome. We do the work.*

| What | Where |
|---|---|
| Logo | `components/Logo.tsx` (`Logo`, `Lockup`, `Mark`) renders the official raster mark from `public/brand/` (exact files + proportional resizes, see `public/brand/README.md`). Never redraw, recolour or recreate it. Favicons: `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`. |
| Colour | `app/styles/tokens.css` is the only place colours are defined: official palette as `--ens-*`, semantic tokens (`--bg --surface --surface2 --surface3 --ink --ink-strong --muted --subtle --line --line2 --field-line --accent --accent-fill --accent-ink --accent-soft --accent-line --ok/--warn/--bad (+ -soft) --shadow --focus`). Dark navy is the default theme; `.dk` / `.lt` force a palette on a section. Derived shades exist only where an official colour fails WCAG AA (e.g. filled buttons use `--accent-fill` #0F6BF0 = 4.8:1 with white). Never hard-code hex in components. |
| Type | Inter (variable), self-hosted via `next/font/local` (`app/fonts.ts`). `--display` for headings (`--serif` is the legacy alias). |
| CSS | `app/globals.css` (legacy prototype classes, being retired) → `app/styles/tokens.css` → `app/styles/components.css` (shared classes: `.btn .card .tag .chip .f .tabs table .pagehead .eyebrow .modal .toast .empty`) → one partial per area, each with its own class prefix: `shell.css` (`sh-`), `marketing.css` (`mk-`), `workspace.css` (`ws-`), `console.css` (`cs-`), `operations.css` (`op-`), `auth.css` (`au-`). |
| Motion | Subtle and purposeful (live progress, status changes). `prefers-reduced-motion` disables animation globally (`tokens.css`). |

## 2. Ground rules

| Rule | How |
|---|---|
| Money is integer **cents** | Render with `eur(cents)` (`€25`, `€12.50`). Never divide by 100 by hand. |
| No fake numbers | Never show invented metrics, activity, customers, logos, testimonials, integrations or ROI. Estimates are labelled as estimates (e.g. "planner estimate"). Illustrations on marketing pages are labelled "illustration / example — not a real execution". |
| Private pages | Wrap in `<RequireAuth>`. A 401 from any call clears the session and the auth context redirects (see `UNAUTHORIZED_EVENT` in `lib/api.ts`). Private routes are `noindex` via `lib/indexing.json` (headers in `next.config.js`, `app/robots.ts`); give them a title with `privateMetadata(title)` from `lib/site.ts` in a route `layout.tsx`. |
| Public pages | `pageMetadata({ title, description, path })` from `lib/site.ts` (canonical, Open Graph, X), one `<h1>`, truthful JSON-LD via `components/JsonLd.tsx`. Add indexable pages to `lib/indexing.json` (sitemap). |
| Balance changes | Calls that change the balance return `user`; call `setUser(user)` or `refresh()` from `useAuth()`. |
| Attention badges | After approving/rejecting/resolving, call `refreshAttention()` so the header/bottom-bar badges update (one shared poll in `components/Shell.tsx`). |
| Feedback | `useToast()`; never `alert()`. Destructive confirmations go in a `<Modal>` (the console uses `window.confirm` only for cancel). |
| Links | `ROUTES` from `lib/routes.ts` + `next/link`. Validate `?next=` with `safeNext()`. |
| A11y | Clickable cards are links or buttons; icon-only buttons need `aria-label`; forms use `label.l` + `input.f`, `aria-invalid`, inline errors via `aria-describedby`, and `aria-busy` on submit buttons; AA contrast with the token text colours. |
| Test hooks | Key elements carry `data-testid` (see §7). Keep them when refactoring — the E2E suite depends on them. |

## 3. Information architecture (`lib/routes.ts`)

Signed in, desktop: **Home** (`/dashboard`, the Chief of Staff) · **Objectives** · **AI Team** · **Company Context** · **Reports**, with **Approvals** and **Exceptions** always visible as live-count controls; **Usage** via the balance pill and the account panel (which also holds Recurring objectives, Organization members, Settings, Operations for admins, theme and shortcuts). Phones: bottom bar Home · Objectives · Define · Attention · More (a sheet reaching every other page). Signed out: How it works, Log in, Get started.

| Route | Page |
|---|---|
| `/` | Landing: the Ensemblis story in eleven sections (`#how`, `#trust` anchors) + FAQ |
| `/how-it-works` | Public product walkthrough (indexable) |
| `/dashboard` | Home — the Chief of Staff: what needs you, what's running, recent outcomes, activity |
| `/objectives` | Objective list (groups: all, in progress, needs attention, completed, drafts, failed & cancelled, earlier reports) |
| `/objectives/new` | Define an outcome (statement, success criteria + suggestions, deadline, budget, context notes, autonomy) |
| `/objectives/:id` | Objective console: lifecycle, plan, approvals, live execution (SSE), verification, report, evidence, outcome, learnings, activity, attempts |
| `/reports` | Reports: completed outcomes (verified deliverables) + earlier reports |
| `/ai-team` | The AI organization: Chief of Staff, executives, versioned capabilities, tools |
| `/context` | Company Context (profile, website, documents) and Memory (`#memory`) |
| `/approvals`, `/exceptions` | Approval Center, Exception Center |
| `/usage` | Balance, spend per objective, transactions, top-ups/checkout |
| `/routines` | Recurring objectives |
| `/team` | Organization members & invites (`ROUTES.members`) |
| `/settings` | Profile, email verification, password, organization policy (owner), appearance, notifications |
| `/tasks/:id` | Earlier report (pre-v4, read-only); `/tasks` → `/objectives?group=earlier` |
| `/r/:token` | Public shared result (execution) or earlier report — `noindex` |
| `/admin` | Operations console (verified `ADMIN_EMAILS` only) |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/join/:token`, `/privacy`, `/terms` | Account flows and legal |

Retired marketplace URLs (`/agents`, `/developers`, `/pricing`, …) redirect to `/` (`next.config.js`).

---

## 4. Live execution

`app/objectives/[id]/_components/useObjectiveLive.ts` loads the objective, then opens `openExecutionStream()` (`lib/stream.ts`): a `fetch()`-based SSE reader (the token goes in the `Authorization` header, never the URL) that tails the persistent `ExecutionEvent` log from the last seen id. On disconnect it reconnects with `?after=<last id>`, so a refresh or network blip never loses or duplicates events; if streaming fails it falls back to polling. `step-progress` messages carry a step's partial output while it is being written.

---

## 5. Components (`@/components`, `@/components/ops`, `@/components/report`)

| Component | Use |
|---|---|
| `StatusTag`, `StepStatusTag`, `OutcomeTag`, `VerificationTag`, `CriterionTag`, `ClaimTag`, `RiskTag`, `Tag` | Status vocabulary (`components/Tags.tsx`; `statusLabel`, `outcomeLabel`, `isLiveStatus`) |
| `ApprovalCard`, `ExceptionCard`, `EventFeed`, `ExecBadge`, `Section`, `Money` | Operations building blocks (`components/ops.tsx`) used by the console, briefing and centers |
| `ReportView`, `ExportMenu` | Markdown result with `[n]` citation chips, TOC, sources panel; PDF/Word/Markdown export |
| `PageHead`, `Tabs`, `EmptyState`, `Flow` (Objective → Plan → Approve → Execute → Verify → Outcome), `ProgressBar`, `Skeleton*`, `KV`, `Stat` | Layout (`components/UI.tsx`) |
| `Modal`, `useToast`, `useShell` | Overlays |
| `LineChart`, `Sparkline`, `HBar` | SVG charts (operations console only — real data) |
| `Header` (nav + Approvals/Exceptions live counts via the shared `useAttention`), `BottomNav` (+ More sheet), `Footer`, `CommandPalette`, `DemoBanner`, `GuestBanner` | Shell — already mounted by `app/layout.tsx` |
| `components/marketing/Visuals.tsx` | Marketing illustrations (operating layer, org chart, execution trace, evidence layer…) — HTML/CSS/SVG, labelled as illustrations |

Keyboard (signed in): ⌘K / Ctrl K or `/` palette · `?` shortcuts · `N` define an outcome · `G` then `H`/`D` Home, `O` objectives, `T` AI Team, `C` Company Context, `P` Reports, `A` approvals, `E` exceptions, `U` usage, `R` recurring, `S` settings. Single-key shortcuts can be switched off on the shortcuts sheet (WCAG 2.1.4).

---

## 6. Helpers

- `lib/format.ts`: `eur`, `num`, `pct`, `relativeTime`, `shortDate`, `longDate`, `dateTime`, `duration`, `plural(n, word, pluralWord?)`, `firstName`, `greeting`
- `lib/hooks.ts`: `usePolling` (pauses in hidden tabs; return `false` to stop), `useKeyboardShortcut`, `useLocalStorage`, `useDebounced`, `useIsMobile`, …
- `lib/extract.ts`: in-browser text extraction for Company Context documents (PDF, DOCX, XLSX, CSV, text)
- `lib/data.ts`: static copy only — `EXAMPLE_OBJECTIVES` (starting points on the define page), `LOOP` (how-it-works steps), `FREQ_PER`

---

## 7. Tests

```bash
npm run lint && npm run typecheck
npm test                 # vitest: SSE parser + resume, redirect safety, status vocabulary, markdown/citations
npm run e2e              # Playwright, needs backend built (cd ../backend && npm run build) and local Postgres
npm run e2e:prod-like    # same suite with NODE_ENV=production and the OpenAI-compatible provider against a local stub
E2E_TOUR=1 npm run e2e -- tour   # optional: screenshots of every main screen (desktop, tablet, phone; dark + light) in test-results/tour/, fails on horizontal overflow
node scripts/render-og.mjs       # re-render the Open Graph image (public/brand/og-image.png)
```

The E2E stack (`backend/scripts/e2e-stack.mjs`) resets the `ensemblis_e2e` database, starts the API with the embedded worker off plus a separate worker process, and uses the mock AI provider with simulated latency (web search off). Test ids used: `signup-submit`, `save-context`, `objective-statement`, `suggest-criteria`, `criterion-input`, `submit-objective`, `objective-console`, `execution-status` (`data-status`, `data-verification`), `plan-step` (`data-status`), `approval-card`, `exception-card`, `live-card`, `verification-check`, `evidence-list`, `outcome-panel`, `share-link`, `shared-report`, `briefing`, `objective-list`, `balance`.
