# Ensemblis frontend guide

The handbook for page teams. The look and feel comes from `design/prototype.html`. Its CSS has been ported **verbatim** into `app/globals.css`, so the prototype's markup and class names give you pixel parity. Open the prototype view function for your page (`vDash`, `vTasks`, `vAgent`, …), copy its markup into JSX (`class` → `className`, inline `style="a:b"` → `style={{ a: "b" }}`), and swap the hard-coded data for `lib/api.ts` calls.

Use **`/styleguide`** to see every component and class rendered live, in both themes.

---

## 1. Ground rules

| Rule | How |
|---|---|
| Use the prototype class names | `card`, `btn p`, `tag ok`, `stat`, `kv`, `wrap`, `grid g3`, … (see §3). Use Tailwind only for one-off layout (`flex`, `gap-*`, `mt-*`). Tailwind **preflight is off**, so the prototype reset is in charge. |
| Money is integer **cents** | Always render money with `eur(cents)` → `€25`, `€12.50`, `€2,840`. Never divide by 100 by hand. Static marketing numbers in `lib/data.ts` are whole euros. |
| Private pages | Wrap them in `<RequireAuth>` (it shows a skeleton, then redirects to `/login?next=…`). |
| After spending/earning credits | Every API call that changes the balance returns `user`, so call `setUser(user)` from `useAuth()` and the header pill updates. |
| Feedback | Use `useToast()` and never `alert()`. Confirmations go in a `<Modal>`. |
| Links | Use `ROUTES` from `lib/routes.ts` and `next/link`. Don't hard-code paths. |
| Client vs server | Pages that use hooks, `api.*`, or `useAuth` need `"use client"`. A page that exports `metadata` must be a server component that renders a client child (see `app/styleguide/`). |
| Layout | The root layout already renders the Header, `<main id="main" class="fade-in">`, Footer, mobile bottom nav, toasts and command palette. **Don't** render a footer or header in your page. Start with `<div className="wrap">` (1120px) or `<div className="narrow">` (760px). |
| Theme | Both themes come from CSS variables, so never hard-code colors. Use `var(--ink)`, `var(--muted)`, `var(--accent)`, … Wrap a section in `.dk` to force the dark palette (hero, CTA band). |
| A11y | Clickable cards should be `<Link className="card acard">` or `<button className="card opt">`, not a `div` with `onClick`. Icon-only buttons need `aria-label`. |

---

## 2. Routes (`lib/routes.ts`)

```ts
ROUTES.home "/"            ROUTES.newTask "/new"           ROUTES.tasks "/tasks"        ROUTES.task(id) "/tasks/:id"
ROUTES.agents "/agents"    ROUTES.agent(slug) "/agents/:slug"                            ROUTES.dashboard "/dashboard"
ROUTES.workflows           ROUTES.workforce                ROUTES.billing               ROUTES.settings  (profile = "/settings#profile")
ROUTES.developers "/developers"   ROUTES.publish "/developers/publish"   ROUTES.devDashboard "/dashboard/developer"   ROUTES.economics
ROUTES.network  ROUTES.pricing  ROUTES.changelog  ROUTES.brand  ROUTES.login  ROUTES.signup  ROUTES.howItWorks "/#how"
loginUrl(next?)  signupUrl("company" | "developer", next?)  safeNext(next, fallback)   // validate ?next= before redirecting
```

The header, footer, palette, bottom nav and `g`-shortcuts already link to all of these. Build your pages at these paths. The home page needs a section with `id="how"`, and Settings needs one with `id="profile"`.

---

## 3. CSS classes (all from the prototype)

**Layout:** `wrap` (max 1120px, 24px gutters, 16px under 560px) · `narrow` (760px) · `row` (flex, center, gap 12) · `between` · `wrapflex` · `sp` (flex:1 spacer) · `grid` + `g2 g3 g4 g5 g6` (collapse at 860/560px; add `keep2` to keep 2 columns on phones) · `stack` (16px vertical rhythm) · `rel` · `hideM` (hidden <860) · `hideS` (hidden <560) · `no-print`

**Type:** `serif` · `muted` · `small` (13) · `tiny` (12) · `eyebrow` (UPPERCASE label) · `newh` (big Sora heading) · `pagehead` (h1 + p) · `sect` + `sect h2` · `hero` · `hx` / `hx-badge` / `hero-dk` (dark hero with grid) · `cta-band` · `step-n` (numbered circle)

**Buttons:** `btn` · `btn p` (primary) · `btn lg` / `btn sm` · `btn bad` · `btn ghost` · `btn block` · `[disabled]` · `aria-busy="true"` (spinner) · `ibtn` (36px icon button) · `chip` / `chip on` · `askbar` (+ `.ph`) · `thumb`

**Tags and badges:** `tag` (accent) · `tag ok|warn|bad|gray` · `credpill` · `demob` · `pulse` (live dot) · `dot` (unread dot) · `srcchip` · `kbd` · `conf` (+ `i.on`, `.m` medium) · `dots`

**Cards:** `card` · `card tight` · `card flat` · `acard` (agent card, hover lift, `.stats` row) · `catcard` · `role` / `role hl` (+ `.ico`) · `opt` / `opt sel` (selectable) · `pick` (chosen) · `dcard` (gradient demo card) · `notice` · `contrast` · `mini` · `mrow` / `mrow best` · `lane` (list row) · `bcell` / `sw` (brand cells and swatches)

**Data:** `stat` (b = value, span = label, em = green delta) · `kv` · `tw` + `table` (`th`, `td`, `tr-click`) · `hbar` (+ `.b > i`) · `progress > i` · `meter > i` · `split` (revenue split bar) · `rng` / `rrow` (price ranges) · `av` / `av lg` (use `<Avatar>`) · `seatstack` · `stars` · `rating`

**Forms:** `label.l` · `input.f` / `textarea.f` / `select.f` (focus ring, custom chevron, `aria-invalid="true"` turns red) · `hint` · `err` · `brief` (hero task box: `label`, `textarea`, `.foot`, `.route`) · `details.det`

**Flows and steps:** `flow` (use `<Flow>`) · `chk` (checklist: `li.done` / `li.doing`, `.ic`, `.stt`) · `onb` / `onb done` · `wiz` + `wsteps` + `wstep on|done` · `hwtabs` (how-it-works pills) · `stagebar` + `stg on|done` · `dpanel` · `orch` (`.node q|m|w|d|out`, `.agents`, `.conn act`, `.pb`, `.loop`) · `ready` · `plan` / `pstep` / `pn` / `pconn` / `pcard` · `chain` + `cchip` (`bad`, `big`, `ac`) · `pipe` / `pnode` / `parrow` · `ticker-wrap` · `caret` (blinking cursor) · `examples`

**Report:** `report` (200px TOC + content) · `toc` · `rsec` · `claim` · `vrow` · `tlog` · `prose` (markdown from the API, rendered with `react-markdown` inside `className="prose max-w-none"`)

**Overlays and motion:** `scrim` / `modal` / `modal wide` (use `<Modal>`) · `toast` (use `useToast`) · `menu` · `sk` (skeleton) · `spin` · `reveal` (one-shot fade-up) · `fade-in` · `confetti` · `dk` (force dark palette)

**Tokens:** `--bg --surface --surface2 --ink --muted --line --line2 --accent --accent-ink --accent-soft --cyan --ok(-soft) --warn(-soft) --bad(-soft) --shadow --serif --sans --star`. These are also available as Tailwind colors (`text-muted`, `bg-surface`, `border-line`, …).

---

## 4. Components (`@/components` or `@/components/<File>`)

```tsx
import { Avatar, Modal, useToast, StatusTag, RequireAuth } from "@/components";
```

### Brand and icons
| Component | Props | Notes |
|---|---|---|
| `Icon` | `name: IconName, size?, className?, label?, strokeWidth?` | All prototype `IC` icons plus extras (`sun monitor keyboard info alert trash edit play pause copy ext filter down up dots mail wallet chart file zap menu`). Decorative unless you pass `label`. |
| `Mark` | `size=26, mono?` | The "E" mark. |
| `Lockup` | `size=26, mono?` | Mark plus "Ensemblis" wordmark. |
| `Logo` | `href="/"` | Header logo link. |

### Identity and status
| Component | Props |
|---|---|
| `Avatar` | `name, hue? (Agent.hue; defaults to a hash), size? "xs"\|"sm"\|"md"\|"lg", round?` |
| `AvatarStack` | `names: string[], max=3` |
| `VerifiedTag` | `verified: boolean, compact?`: compact is just the green shield |
| `StatusTag` | `status: TaskStatus, label?`: PLANNING/RUNNING get a live pulse |
| `StepStatusTag` | `status: TaskStep["status"]` → Queued / Working / Done / Failed |
| `OutcomeTag` | `outcome: Outcome \| null` |
| `Tag` | `variant? "accent"\|"ok"\|"warn"\|"bad"\|"gray", icon?` |
| `Rating` | `value, outOf?` → ★ 4.8 |
| `Stars` | `value, onChange?` (interactive 1–5 radio group; read-only without `onChange`) |

```tsx
<div className="row">
  <Avatar name={agent.name} hue={agent.hue} />
  <div className="sp"><b>{agent.name}</b><div className="tiny muted">by {agent.creator}</div></div>
  <VerifiedTag verified={agent.verified} compact />
</div>
<StatusTag status={task.status} />
```

### Layout and content
| Component | Props |
|---|---|
| `PageHead` | `title, sub?, eyebrow?, tag?, actions?, center?`: `.pagehead`. With `actions` it lays them out on the right. |
| `Flow` | `step: 0–4`: Describe → Plan → Execute → Verify → Deliver |
| `Tabs` | `tabs: (string \| {id,label,count?})[], value, onChange, label?`: arrow keys work; render the panel yourself (`role="tabpanel" aria-labelledby={"tab-"+id}`) |
| `ChipGroup` | `options, value, onChange`: single-select `.chip` filter row |
| `EmptyState` | `icon?, title, children?, action? (node \| {label, href? \| onClick?, icon?}), card=true` |
| `Stat` | `value, label, delta?` |
| `KV` | `k, children`: strings and numbers render bold |
| `ProgressBar` | `value 0–100, label?` (animated width) |
| `Meter` | `value, width?` |
| `Skeleton` / `SkeletonText` / `SkeletonCard` / `PageSkeleton` | loading placeholders |
| `CountUp` | `to, decimals?, prefix?, suffix?, duration?`: counts up when scrolled into view; server-renders the final value |
| `Reveal` | `as?, delay?, className?`: fades in on scroll; content already on screen is never hidden |
| `Kbd` | keyboard key chip |

```tsx
<PageHead title="Task history" sub="Everything you've asked for, with results, cost and outcomes."
  actions={<Link className="btn p" href={ROUTES.newTask}><Icon name="plus" />New task</Link>} />
<div className="grid g4 keep2">
  <Stat value={<CountUp to={2481} />} label="tasks completed" />
  <Stat value={eur(billing.monthSpendCents)} label="this month" />
</div>
```

### Charts (pure SVG; work in server components)
| Component | Props |
|---|---|
| `LineChart` | `values: number[], height=180, min=0, label?, xLabels?, format?` (prototype `lineChart`; `format` adds hover titles) |
| `Sparkline` | `values, width=96, height=28, color?` |
| `PerfGraph` | `rows: [taskType, agentName, pct][], leftLabel?, rightLabel?`: the Agent Performance Graph |
| `HBar` | `label, value, max=100, display?, labelWidth?` |

```tsx
<LineChart values={stats.monthly.map(m => m.revenueCents / 100)} xLabels={stats.monthly.map(m => m.month)} height={140} label="Revenue" format={v => eur(v * 100)} />
```

### Overlays
| API | Usage |
|---|---|
| `Modal` | `open, onClose, title?, ariaLabel?, wide?, showClose?, top?, className?, initialFocus?, dismissible=true`. It portals to `<body>`, traps focus, closes on Esc or a scrim click, and restores focus. Put `data-autofocus` on the element that should get focus first. |
| `useToast()` | `toast("Saved")`, `toast.error("Couldn't reach the server")`, `toast.info("Copied", { icon: "copy", action: { label: "Undo", onClick } })` |
| `confetti()` | from `@/lib/confetti` (or `@/components`). It does nothing for reduced-motion users. Call it when a task completes. |
| `useShell()` | `openPalette()`, `openShortcuts()`, `openRoleSelect({ role?, next? })`, `closeAll()` |
| `RoleSelectModal` / `RolePicker` | The prototype's "I need work done / I build agents" flow, which routes to `/signup?type=company\|developer[&next=]`. `openRoleSelect()` opens it globally. Use `RolePicker` (just the two cards) inline on `/signup` when `type` is missing. |

```tsx
const [open, setOpen] = useState(false);
<Modal open={open} onClose={() => setOpen(false)} title="Delete this workflow?">
  <p className="muted small" style={{ margin: "6px 0 16px" }}>This can't be undone.</p>
  <div className="row">
    <button className="btn" onClick={() => setOpen(false)}>Keep workflow</button>
    <button className="btn bad" onClick={remove}>Delete workflow</button>
  </div>
</Modal>
```

### Shell (already mounted by `app/layout.tsx`; don't render these again)
`Header` (public vs signed-in nav, ⌘K, notifications, credits pill, account menu), `BottomNav` (mobile), `Footer`, `CommandPalette`, `ShortcutsModal`, `ThemeSwitch` (you can reuse it on Settings), `PageTransition`.
- **Notifications** come from `api.listTasks()` (polled every 30s): completed, failed and refunded tasks plus in-progress ones. Read state is kept per user in localStorage. `useNotifications(enabled, userId)` is exported if you need it.
- **Keyboard:** ⌘K / Ctrl K / `/` palette · `?` shortcuts · `N` new task · `G` then `D` dashboard, `T` my work, `A` agents, `N` network, `H` home, `W` workflows, `B` billing, `S` settings · Esc closes. Shortcuts are ignored while typing. For a page-level shortcut use `useKeyboardShortcut("mod+enter", submit, { allowInInputs: true })`.

### Auth
```tsx
"use client";
import { RequireAuth } from "@/components";
import { useAuth } from "@/lib/auth-context";

export default function Page() {
  return <RequireAuth><Billing /></RequireAuth>;                    // accountType="DEVELOPER" to restrict
}
function Billing() {
  const { user, setUser } = useAuth();                               // user is non-null inside RequireAuth
  const topUp = async () => { const r = await api.topUp(2000); setUser(r.user); toast(`${eur(2000)} added`); };
}
```
`useAuth()` returns `{ user: User | null, loading, signIn(token, user), signOut(), refresh(), setUser(u | fn), setCredits(cents) }`. Login and signup pages call `signIn(token, user)` and then `router.push(safeNext(params.get("next")))`.

---

## 5. Helpers

**`lib/format.ts`:** `eur(cents)` · `eurSigned(cents)` (+€10 / −€25) · `eurWhole(euros)` · `num(n)` (2,481) · `pct(n)` (96.8%, null → —) · `relativeTime(iso)` (just now / 2m ago / 3h ago / Yesterday / Sep 25) · `dayLabel(iso)` (Today / Yesterday / Sep 25) · `shortDate` · `longDate` · `dateTime` · `duration(seconds)` (8m 42s) · `durationBetween(start, end?)` · `minutesRange(8, 12)` (8–12 min) · `initials(name)` · `plural(3, "task")` · `firstName(name)` · `greeting()` (Good morning)

**`lib/hooks.ts`:** `usePolling(fn, ms, { enabled, immediate })` (pauses in hidden tabs; return `false` to stop, e.g. when a task finishes) · `useKeyboardShortcut(keys, handler, opts)` · `useLocalStorage(key, initial)` (safe in private mode) · `useMediaQuery(q)` · `useIsMobile()` (<860px) · `useReducedMotion()` · `useOnClickOutside(refs, fn)` · `useInView()` · `useMounted()` · `useDebounced(value, ms)`

```tsx
usePolling(async () => {
  const { task } = await api.getTask(id); setTask(task);
  if (task.status === "COMPLETED") confetti();
  return task.status === "RUNNING" || task.status === "PLANNING";   // false stops polling
}, 2000);
```

**`lib/utils.ts`:** `cx(...classes)` · `seeded(seed, n, base, vr)` (illustrative chart series) · `hueFrom(str)` · `fuzzyScore(q, text)` · `isTypingTarget(el)` · `storage.get/set` (safe localStorage) · `prefersReducedMotion()`

**`lib/theme.tsx`:** `useTheme()` → `{ theme: "light"|"dark"|"system", resolved, setTheme, toggle }`. `<html data-theme>` always holds the resolved theme, so Tailwind `dark:` works.

---

## 6. Static content (`lib/data.ts`)

Copied from the prototype. Use it for marketing pages and illustrative sections only. Real data comes from the API.

`HERO` · `DEMO`, `DEMO2` · `EXAMPLES` + `EX_FULL` (chip → full task text) · `TASK_TYPES` (new-task chips) · `TICKER` · `DEPTH` · `TODAY_CHAIN` · `CONTRASTS` · `STAGES` · `ORCH_AGENTS` · `ENSEMBLE` (looping orchestration copy) · `HOW_IT_WORKS` (5 steps with structured visuals: `describe / match / execute / verify / deliver`) · `PERF_STATS` · `PERF_GRAPH` · `CATEGORY_WORK` (CATW) · `DEV_TEASER_STATS` · `ECONOMY_ROLES` · `NETWORK_LATER` · `PIPE` · `COMPANIES` · `CLAIMS` · `SOURCE_TYPES` · `RUN_STEPS` · `RUN_FEED` · `FEEDBACK_REASONS` · `FAILED_CRITERIA` · `PUBLISH_STEPS` · `REVENUE_STREAMS` · `PLATFORM_FEE_PERCENT` (20) · `PRICING_PLANS` · `PRICING_FAQS` · `CHANGELOG` · `BRAND_SWATCHES` · `DEMO_MODE_POINTS` · `STARTING_CREDITS_CENTS` (10000) · `ONBOARDING_STEPS` · `CATS` · `CATS7` · `CAT_GROUP` / `catGroup()` · `FREQ_PER`

---

## 7. Recipes

**Agent card (Explore grid)**
```tsx
<Link href={ROUTES.agent(a.slug)} className="card acard">
  <div className="row"><Avatar name={a.name} hue={a.hue} />
    <div className="sp"><b>{a.name}</b><div className="tiny muted">by {a.creator}</div></div>
    <VerifiedTag verified={a.verified} compact /></div>
  <p className="small muted" style={{ minHeight: 40 }}>{a.description}</p>
  <div className="row wrapflex" style={{ gap: 6 }}>{a.capabilities.slice(0, 3).map(c => <span key={c} className="chip" style={{ padding: "2px 9px", fontSize: 12 }}>{c}</span>)}</div>
  <div className="stats"><span><b>{pct(a.successRate)}</b> success</span><span><b>{num(a.tasksCompleted)}</b> tasks</span><span><b>{duration(a.avgRunSeconds)}</b> avg</span></div>
  <div className="row between small"><span className="muted">Typical <b style={{ color: "var(--ink)" }}>{eur(a.pricePerTaskCents)}</b></span><span className="btn sm">View agent</span></div>
</Link>
```
While loading, render `SkeletonCard` six times inside `grid g3`.

**Spending credits:** `const { task, user } = await api.createTask({...}); setUser(user); router.push(ROUTES.task(task.id));` On an `ApiError` with status 402/400, show `toast.error(err.message)`.

**Error handling:** every `api.*` call throws `ApiError` (`.status`, `.message`). Status `0` means the backend is unreachable. Show an inline `.notice` or `toast.error(e.message)`.

**Forms:** use `<label className="l" htmlFor>` with `<input className="f">`, set `aria-invalid` on the input and show an `.err` line, and put `aria-busy={saving}` on the submit button.

---

## 8. Notes
- Fonts (Manrope and Sora) load from Google Fonts in `app/layout.tsx`. Offline sandboxes fall back to system fonts, and the build may log a harmless "Host not in allowlist" font-inlining warning.
- Reduced motion: every animation collapses (prototype rule), and `confetti`, `CountUp` and `Reveal` opt out.
- `prefers-color-scheme` plus a stored preference: a tiny inline script sets `data-theme` before paint, so the theme never flashes.
- Breakpoints match the prototype: 860px (tablet: the nav collapses into the bottom bar) and 560px (phone). The Tailwind `sm` and `md` screens are remapped to 561px and 861px to match.
