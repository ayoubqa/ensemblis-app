# Ensemblis Phase 4: from AI research tool to business execution platform

Audit, strategy and architecture. Written 29 October 2026 against `main` at `0bc65cb` (PR #13 merged).

**Evidence labels used throughout**
- **[R]** Verified in this repository (file named).
- **[P]** Verified on production by the read-only *Production smoke* workflow (29 Oct 2026).
- **[E]** External research. Mostly secondary sources; the vendors' own pages could not be opened from this
  environment, so check each figure before relying on it.
- **[H]** Hypothesis. My own reasoning, not evidence.

Nothing here claims demand, quality or willingness to pay: none of those has been measured yet.

## The short version

1. **The engine is real; the evidence and the proof are not.**
   - Real today:
     - an objective becomes a priced plan;
     - the plan is approved;
     - the steps run;
     - sources are numbered;
     - the result is verified;
     - the report is exported;
     - credits are charged and refunded [R].
   - Missing:
     - Production searches Wikipedia only [P].
     - The real-model smoke test has never run [R].
     - No real task has been scored [R: the `real-model-smoke` workflow has 0 runs].
2. **Model cost is not the business risk; value is.**
   - At the [E] prices below, a typical run's variable model and search cost is between about €0.05 (Groq
     gpt-oss) and about €1.50 (a frontier model).
   - The same run is priced at 850–1,450 credits (€8.50–14.50 list value) [R].
   - Margins survive any sensible model choice. Whether anyone pays is unknown.
3. **Differentiation comes from depth in one workflow, not more capabilities.**
   - Ensemblis already has the pieces a chat assistant lacks: a plan with a cost first, explicit criteria,
     numbered evidence, verification, an audit trail and reruns [R].
   - It does not yet do any single job better than a €20/month assistant. Nobody has shown that it does.
4. **Recommended first workflow: verified account research for one defined ICP.**
   - It returns a ranked list of target companies, each checked against its own website, with the reason to
     contact and what remains unknown.
   - Gate the investment on the controlled test (`docs/growth/10-controlled-test.md`).
   - Fallback: recurring competitor monitoring.
5. **Build the smallest things that make that workflow trustworthy and measurable, before subscriptions.**
   - Build the entitlement model so Stripe slots in later. Do not ship plans before one workflow shows value.

## Decisions I need from you

| # | Decision | My recommendation | Why it needs you |
|---|---|---|---|
| 1 | Paid usage for validation: a Tavily key on Render, one real-model smoke run, the controlled test, and a small model benchmark | Approve. The search and model cost of all four is estimated in single-digit euros [H]; the real cost is people's time. | It spends money and changes a production secret. |
| 2 | What happens to PRs #4–#7 (credit economics, a premium model route, step deliverable checks, validation metrics and "useful?" feedback, beta hardening) | Rebase and land the parts validation needs (#6 feedback and metrics, #7 token budget). Fold #4's premium route into the model-route design (§D) instead of merging it as is. | Your standing instruction is not to merge #4–#7. |
| 3 | First workflow | Verified account research (§C), confirmed or rejected by the controlled test | Product direction |
| 4 | Stage 5 scope | Option 2 now (model routes + offline benchmark harness: no spend, no production behaviour change). Option 1 after the controlled test. Entitlements after validation. See §H. | Engineering time and direction |
| 5 | Plan prices (€29 / €99 / €299) | Treat them as test prices. Don't publish them until at least 5 validation participants accept a concrete price. | Pricing is your call |

## A. Current product and architecture

### What the product can do today

| Area | Status | Evidence |
|---|---|---|
| Objective → plan → approval → execution → verification → report | **Working** end to end on the mock model and stub search (CI and local). On production, configured with a real model; real-task quality not measured. | `engine/machine.ts`, `planner.ts`, `executor.ts`, `verification/*` [R]; e2e 20/20 [R]; `aiConfigured` on Groq GPT-OSS 120B [P] |
| AI providers | One provider per server, chosen by `AI_PROVIDER`: OpenAI-compatible (production uses Groq gpt-oss-120b, with a fast tier gpt-oss-20b), Anthropic, Ollama, and a mock. No per-task model choice, no cross-provider fallback. | `ai/llmProvider.ts` [R]; provider label [P] |
| Anthropic adapter | Exists but dated. SDK `^0.32.1`; default model `claude-haiku-4-5-20251001`. Never exercised in production. | `ai/llmProvider.ts`, `package.json` [R] |
| Structured output | Prompted JSON, validated with zod, with one repair retry. No provider-native schema mode. | `ai/structured.ts`, `ai/json.ts` [R] |
| Tool use | Tools are chosen by the capability registry and policy, never by the model, and are read-only. | `org/registry.ts`, `org/policy.ts` [R] |
| Planning | The Chief of Staff plans 3–7 steps from 18 capabilities. Framing always comes first and synthesis last. A deterministic playbook is the fallback. The plan is blocked when the provider or search is unavailable. | `engine/planner.ts` [R] |
| Web research | Tavily (`basic`, 5 results, snippets) when a key is set, otherwise Wikipedia. 2–3 queries and at most 4–6 new sources per step. Pages are not fetched. Research status is recorded honestly, and Wikipedia-only research is shown as `degraded` (PR #13). | `research/search.ts`, `sources.ts`, `executor.ts` [R]; production on Wikipedia [P] |
| Evidence and citations | Numbered evidence with provenance (provider, query, retrieval time). `[n]` citations to missing sources are removed. Links to unknown domains are unlinked. | `engine/evidence.ts`, `research/citations.ts` [R] |
| Verification | Deterministic claim and term checks; a model check that can only downgrade; per-criterion assessment; a stricter gate for research briefs. A result the verifier could not check is never labelled verified. Result state: verified / with warnings / partial / unverified / accepted-failed. | `verification/*`, `resultState.ts` [R] |
| Failure handling | Leased jobs and crash recovery (worker-restart check 15/15). Step retries. Provider errors classified as config, quota, rate limit, too large or transient. A token ceiling per execution. Exceptions handed to people. | `engine/recovery.ts`, `queue.ts`, `ai/errors.ts`, `budget.ts` [R] |
| Credits | Charged once at start, at the planned estimate, idempotently. Refunds for failure, cancellation, skipped steps and an unavailable verifier. Ledger rows record a reason and the balance after. A daily execution cap per user (production: 5/day [P]). Planning is refused when the balance can't cover the cheapest plan. | `engine/billing.ts`, `lib/wallet.ts`, `billing/credits.ts`, `lib/usageLimits.ts` [R] |
| Cost accounting | Every model and search call is recorded (`UsageEvent`). Costs come only from a configured `PROVIDER_PRICING` table and are never guessed. Owner economics show variable contribution. | `lib/usage.ts`, `billing/pricing.ts`, `economics.ts` [R]. Whether production has the price table set is unknown [—]. |
| Payments | Stripe one-time credit-pack checkout exists in code but is **off** without keys. Demo top-ups (no money). Production: payments off [P]. | `billing/stripe.ts`, `config.ts` [R] |
| Accounts | Organizations, teams with a shared wallet (the owner pays), invites, invite-only sign-up [P], guest trial, admin. | `org/`, `team/`, `guest/`, `admin/` [R] |
| Company context and memory | Profile fields, up to 25 documents, the company website; business memory with sensitivity gating and human confirmation. | `context/service.ts`, `memory/service.ts` [R] |
| Reuse | **Recurring objectives** (weekly, monthly, quarterly) create real objectives on schedule. "New attempt" re-runs an objective. **No saved on-demand templates.** | `workflows/*` [R] |
| History and output | Objective console, reports, share links, PDF/Word/Markdown export carrying the result label, usage page with every ledger row. | `frontend/app/objectives/[id]`, `components/report` [R] |
| Measurement | `funnel.sql`, the owner dashboard, the `eval:scorecard` tool (PR #13), and `docs/product/metrics.sql` (this PR). The "Was this result useful?" feedback exists only in unmerged PR #6. | [R] |
| Subscriptions and entitlements | **Not built.** No plan, period, allowance or feature gating anywhere. | [R]: searched, none found |
| Integrations (CRM, Slack, Drive) | **Not built.** | [R] |

### Real value versus UI concept

- **Real:**
  - The plan → cost → approval → evidence → verification → report loop.
  - Honest labelling (mock, stub, degraded and partial are always visible).
  - Credits and refunds.
  - Recurring objectives.
  - Exports.
- **Thin:**
  - "AI Team" executives and specialists are prompt personas over one model, not separate agents.
  - 18 capabilities share one generic executor: what differs is the methodology text and the deliverable
    headings, not the pipeline.
  - Lead research and market research run the same search loop.
- **Missing for repeatable outcomes**, ranked by how much each blocks a customer getting a trustworthy result
  twice:
  1. **Evidence quality**: Wikipedia-only search in production [P]. Snippet-only research [R]. Nothing fetches
     or verifies the pages an answer depends on (company websites, pricing pages) [R].
  2. **No measured quality** on the real model [R].
  3. **No workflow specialisation.**
     - Deliverables are memos or briefs with generic sections [R].
     - Suggested success criteria can be generic, so verification can pass work that misses the user's real
       requirement (e.g. "20 prospects"). This was observed on the mock model in the local walkthrough [R];
       real-model behaviour is untested.
  4. **No reuse for on-demand work.** The same instructions are retyped each time [R].
  5. **Measurement gaps.** The acceptance signal is only "Your judgment" on the outcome. Feedback lives in PR
     #6. Costs may be unpriced [R].
  6. **One model for everything.** The model can't be chosen by task, and a provider outage has no fallback [R].
  7. **Process debt.** Four stacked PRs (~2,470 lines), unmerged since 23 Oct [R].

## B. Differentiation opportunities, ranked

The test for each: is it **better than asking a general assistant directly**, at a cost the business model can
carry? A general assistant costs about $20–25 per user per month [E: ChatGPT Business, Perplexity Pro;
secondary sources].

| Rank | Capability | Customer problem | Why better than a chat assistant | Status [R] | Complexity | Risks | How to validate |
|---|---|---|---|---|---|---|---|
| 1 | **D + C: Verification over evidence-backed deliverables** | "I can't forward AI research without re-checking every claim." | Each claim is tied to a numbered source, unsupported claims are flagged, and the limits are stated. Assistants cite, but don't grade their own claims against the sources or hold back a result that fails. | Built. Weak while search is Wikipedia-only, and limited by snippets. | Low to finish (live search); medium for page-level checks | Verification is only as good as the evidence; false confidence | Scorecard: factual accuracy and evidence coverage against a general assistant (controlled test) |
| 2 | **E: Reusable workflows** (one job type, rerun with new inputs, recurring with "what changed") | Rebuilding the same brief weekly; inconsistent output | Same structure, criteria and sources standard every time; history across runs (no duplicate accounts; changes since last run) | Recurring exists; templates and diffs don't | Medium | Building templates nobody reuses | Repeat usage: second run of the same workflow within 14 days |
| 3 | **A: Goal → plan → criteria → completion** | "I need a result, not a conversation." | A cost before work starts, criteria checked at the end, partial results labelled partial | Built | Low (capture better criteria) | Generic criteria let weak work pass | Share of runs whose criteria the user edited or accepted; acceptance rate |
| 4 | **B: Persistent business context** | Re-explaining the company every time | Context and memory feed every run, with sensitivity gating | Built | Low | Context rot; privacy | Runs per org that use context; time to first useful result |
| 5 | **H: Measurement** (completion, quality, cost, acceptance, repeat) | Buyers need proof of value | An assistant can't report cost per completed task or the acceptance rate of your own team's results | Partial (metrics.sql, funnel.sql; feedback unmerged) | Low | Vanity metrics | Weekly review drives decisions |
| 6 | **F: Execution history and audit trail** | "What did we ask, what did it cost, what failed?" | A ledger, events and evidence per run; a basis for team use and compliance | Built | Low | Nobody reads it | Usage of history and export by paying teams |
| 7 | **G: Integrations** | Results have to land where work happens (CRM, Slack, Drive) | Assistants increasingly integrate; the value is only workflow-specific (accounts pushed to the CRM, deduplicated) | Not built | Medium–high each | A broad integration surface before proof | After validation: the CRM/CSV export is used in more than half of account-research runs |

**The smallest combination that is commercially distinct:** one workflow where:
- the context (B) defines the target;
- the plan carries explicit, checkable criteria (A);
- every item rests on live evidence checked at its source (C+D);
- the run can be repeated without duplicating earlier results (E+F);
- the outcome is measured (H).

Integrations wait for proof.

## C. Initial customer and workflow

Scores are **[H]** judgments from 1 (bad) to 5 (good). Feasibility and implementation cost are judged from the
code [R]. Willingness to pay has no direct evidence for Ensemblis: the only market signal is that adjacent tools
charge for similar work [E].

| Workflow | Pain | Frequency | Willingness to pay | Feasibility today | Competition (5 = weak) | Build cost (5 = low) | Measurable result | Total |
|---|---|---|---|---|---|---|---|---|
| **Account / prospect research and qualification** | 4 | 5 (weekly) | 4 [E: Clay Launch about $185/month, Growth about $495/month] | 2 (needs per-account verification and live search) | 2 (Clay, Apollo, assistants) | 3 | 5 (accuracy per row; meetings downstream) | **25** |
| Recurring competitor / market monitoring ("what changed") | 3 | 4 | 3 | 3 (recurring exists; needs a diff with the previous run) | 4 (assistants don't schedule, remember and diff with sources) | 3 | 3 | **23** |
| Market and competitor intelligence (one-off) | 3 | 2 | 3 | 4 | 1 (deep-research modes, $20/month) | 5 | 3 | **21** |
| Business research and decision briefs | 3 | 2 | 2 | 4 | 1 | 5 | 3 | **20** |
| Marketing research and campaign planning | 3 | 3 | 2 | 3 | 1 | 3 | 2 | **17** |
| Internal knowledge synthesis | 3 | 3 | 3 | 2 (no Drive or Notion integrations) | 2 | 2 | 2 | **17** |

**Recommendation: verified account research for one ICP, run on demand and weekly.**

- **Customer:** owners and business-development leads at small B2B agencies and consultancies (2–25 people), and
  B2B founders without a sales-research hire. This is Segment B and Segment A of `06-customer-hypotheses.md`.
  Both are hypotheses, and no interviews have been done yet.
- **Why this one:**
  - It is the most frequent job.
  - Accuracy can be measured per row, and the scorecard already does so (PR #13).
  - The value chain to revenue is the shortest: the next step is a meeting.
  - Context (the ICP and the offer) is reused on every run.
  - Ensemblis's differentiators (per-item evidence, verification, no duplicates across runs, cost per run) are
    exactly what a chat answer lacks.
- **Why not yet proven:**
  - The controlled test predicts the current pipeline fails it (6 snippets per step; no page fetch).
  - Specialised tools have proprietary data.
  - **Personal contact data is out of scope** (GDPR, trust). Ensemblis researches companies, not people.
- **Gate:** the controlled test (doc 10). If Ensemblis delivers few but accurate accounts with 0 fabrications,
  build the account-research pipeline (§H, option 1). If it fabricates, fix verification first. If a general
  assistant matches it, switch to the fallback: **recurring competitor monitoring**. That workflow plays to what
  assistants structurally lack (schedule, memory, a sourced diff with the previous run) at a lower build cost.

## D. Multi-provider AI architecture

### What exists [R]

- **`runLLM(system, user, opts)`** is already a provider-independent call:
  - text in and streamed text out, with `LLMResult` (provider, model, tokens, truncated, `tokensEstimated`,
    cached tokens, attempts);
  - timeouts and retries with backoff for 429/5xx, plus quota detection;
  - a concurrency limiter per tier;
  - error classification;
  - a `UsageEvent` per call;
  - redacted errors.
- **Callers depend on it, not on providers**: the planner, steps, verifier, claim check, query writer and memory.
- **Limitations:**
  - one provider per process (`AI_PROVIDER`);
  - tiers are only `main` / `fast`;
  - no route per purpose;
  - no fallback across providers;
  - no provider-native structured output;
  - the Anthropic adapter is out of date.
- **PR #4 (unmerged)** adds a "premium route" for OpenAI-compatible endpoints. It covers per-purpose use, a
  fallback to the standard route before any output, a pause on key/quota errors, a daily euro budget, and
  "only when priced". Those ideas are right; they should be generalised, not duplicated.

### Proposed: model routes, the smallest design that supports OpenAI and Anthropic

```ts
// ai/routes.ts — configuration, not code: MODEL_ROUTES (JSON env), validated with zod at boot.
type ProviderId = "openai" | "anthropic" | "groq" | "ollama" | "mock"; // groq = openai-compatible preset
interface ModelRoute {
  id: string;                 // "synthesis-premium", recorded on every UsageEvent and step
  provider: ProviderId;
  model: string;              // exact provider model id
  effort?: "low" | "medium" | "high"; // mapped per adapter (OpenAI reasoning_effort, Anthropic output_config.effort)
  maxOutputTokens: number;
  structured?: "native" | "prompted"; // native = provider JSON-schema mode when the adapter supports it
  dailyBudgetEur?: number;    // stops the route for the UTC day (PR #4 behaviour)
  requiresPrice: boolean;     // only used while priced in PROVIDER_PRICING
}
// Policy: purpose → primary route + optional fallback route (same or lower capability).
type Purpose = "plan" | "queries" | "step.research" | "step.analysis" | "synthesis" | "verify" | "verify_claims" | "memory" | "suggest";
interface RoutePolicy { [p: string]: { primary: string; fallback?: string } }

// Adapters keep today's contract; one file each, no framework.
interface ModelAdapter {
  run(req: { system: string; user: string; route: ModelRoute; schema?: JSONSchema; onDelta?: (t: string) => void; signal: AbortSignal }): Promise<LLMResult>;
  supportsNativeSchema: boolean;
}
```

- **Default:** with no `MODEL_ROUTES` set, the policy is built from today's env, `AI_PROVIDER` plus
  `OPENAI_MODEL` / `OPENAI_FAST_MODEL`, so behaviour is unchanged.
- **Fallback:** only when the primary fails **before any output reached the caller** (no duplicated streamed
  text), and only to a route that can serve the same purpose. Circuit breaker per route (key/quota 15 min, rate
  limit 1 min; from PR #4). Never fall back on "request too large".
- **Structured output:** pass the zod schema converted to JSON Schema to adapters that support native mode
  (OpenAI `json_schema`; Anthropic `output_config.format` [E: Claude API reference]). Otherwise keep today's
  parse-and-repair. Validation stays in our code either way.
- **Tool calling:** **keep tools under our control** (registry and policy). Model-chosen tool calls would add
  cost and nondeterminism without a demonstrated quality gain for these workflows [H]. Revisit for open-ended
  browsing only after the benchmark.
- **Keys:** environment only, one variable per provider (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GROQ_API_KEY`). Never in the database. Never in logs (`redact`). The boot warns about routes whose key is
  missing. Routes without a price are disabled when `requiresPrice` is set.
- **Observability and versioning:** `UsageEvent` gains `routeId` (one nullable column, an additive migration).
  The plan's runtime stamp records the policy version. The owner dashboard shows cost and failures by route.
- **Anthropic adapter:** upgrade `@anthropic-ai/sdk` and use current model IDs. As of the bundled Claude API
  reference (cached 6 Oct 2026), the candidates are Claude Sonnet 5.5 (`claude-sonnet-5-5`) and Claude Opus 5.5
  (`claude-opus-5-5`) for synthesis, and Claude Haiku 5.5 (`claude-haiku-5-5`) for fast jobs. Handle the
  `refusal` stop reason; adaptive thinking with `effort` replaces fixed budgets [E]. A separate, tested change.

### Model-selection policy (starting point [H]; the benchmark decides)

| Purpose | Default route | Candidates to benchmark | Why |
|---|---|---|---|
| queries, memory, suggest | fast, cheap (gpt-oss-20b on Groq) | Claude Haiku 5.5 | Short JSON jobs; latency and cost dominate |
| plan, research and analysis steps | mid (gpt-oss-120b on Groq) | Claude Sonnet 5.5 | Bulk of tokens; quality matters, but the evidence is the limit |
| **synthesis** (the customer-facing deliverable) | mid until the benchmark says otherwise | GPT-5.5, Claude Sonnet 5.5, Claude Opus 5.5 | One call per run; where quality is most visible |
| verify, verify_claims | mid | Another model family than the writer | Hypothesis: an independent family catches more errors. **Measure it; don't assume it.** |

**No ensembles.** Calling several models and merging their outputs doubles the cost, with no evidence of a
quality gain here.

### Benchmark protocol (needs your approval to spend)

- **Inputs:** 10 frozen tasks from the validation set, with the **evidence snapshot fixed** (the same sources
  for every model) so search variance is excluded.
- **Arms:** synthesis on 3–4 routes; everything else held constant.
- **Scoring:** the scorecard's automated dimensions plus a blinded evaluator on accuracy and actionability.
  Record cost and latency per task.
- **Cost estimate [H]:** about 10 tasks × 4 routes × about 15k input and 4k output tokens on the synthesis call
  only. That is about $5–10 at the [E] prices in §E, including thinking/reasoning tokens.
- **Decision rule:** pick the cheapest route within 0.5 points of the best mean quality, with zero fabrications.

## E. Three subscription plans (proposal; every number is an assumption)

Credits stay **Ensemblis usage units** (100 credits = €1 list value, `CREDITS_PER_EUR`) [R]. They are not
tokens. A typical run costs 850–1,450 credits today (fixed capability prices) [R].

| | **Starter: €29/month** | **Growth: €99/month** | **Business: €299/month** |
|---|---|---|---|
| Target customer [H] | Founder or consultant evaluating, occasional research | Small agency or sales team using one workflow weekly | Agency or team running workflows for several clients or segments |
| Included credits per month | 3,000 (about 2–3 runs) | 12,000 (about 8–12 runs) | 40,000 (about 30–40 runs) |
| Effective price per credit | €0.0097 | €0.0083 | €0.0075 |
| Top-ups (credits never expire; allowance does) | €10 per 1,000 | €9 per 1,000 | €8 per 1,000 |
| Runs per user per day (abuse guard) | 5 | 15 | 40 (one global cap exists today, 5/day in production; per-plan caps are not built) |
| Objectives, plan, approval, verification, reports, export | ✓ (**available**) | ✓ (available) | ✓ (available) |
| Company context and memory | ✓ (available) | ✓ (available) | ✓ (available) |
| Execution history | 90 days (retention rule **not built**) | 12 months (not built) | Unlimited (available today) |
| Recurring objectives | 1 (limit not built; feature available) | 10 | Unlimited |
| Saved workflow templates | 3 (**not built**) | 25 (not built) | Unlimited (not built) |
| Seats (shared wallet) | 1 | 3 | 10 (team feature available; seat limits not built) |
| Approval policies and per-user caps | Basic (available) | Available | + admin controls (partly built) |
| Integrations | — | CSV/CRM export (**not built**) | CRM sync (not built) |
| Support | Email | Email, faster | Onboarding call |
| Upgrade trigger | Allowance used for 2 months running, or a second user | More than 12 runs/month, or more than 3 seats | — |

**Rules for presenting this**
- A plan page may list only items marked available.
- "Not built" rows are internal roadmap.
- Nothing is purchasable until payments are on. Until then the app says so; it already does for credit packs [R].

**Margin check [H on usage, E on prices]**

Assumptions for one run:
- A typical 4–5-step run uses about 60–90k input and 15–20k output tokens in total. This is an estimate; replace
  it with measured `UsageEvent` totals from the first real runs.
- Search is 3–8 Tavily calls.

| Route for the whole run | Variable cost per run | Revenue per run at the Business rate (1,150 credits) | Variable margin |
|---|---|---|---|
| Groq gpt-oss-120b ($0.15 / $0.60 per million tokens; PR #4 table, checked 23 Oct) + Tavily ($0.008/call) | about €0.03–0.08 | about €8.60 | about 99% |
| Synthesis on Claude Sonnet 5.5 ($2 / $10 per million) [E] | about €0.10–0.25 | €8.60 | about 97% |
| Synthesis on GPT-5.5 ($5 / $30 per million) [E] or Claude Opus 5.5 ($4 / $20) [E] | about €0.25–0.60 | €8.60 | about 93% |
| Whole run on a frontier model, plus one revision | about €1.0–2.0 | €8.60 | about 77–88% |

**Conclusion [H]:**
- At these prices the allowance can't be "eaten" by model cost. The risks are abuse (bounded by daily caps and the
  per-execution token ceiling [R]) and fixed costs.
- Hosting, payment fees and taxes are not included [R: `EXCLUDED_COSTS`].
- The open question is whether €29–€299 buys enough value. Validation answers that, not this table.

## F. Credit accounting, cost estimation and margin protection

### Current behaviour [R] and proposed policy

| Situation | Today | Proposal |
|---|---|---|
| Task fails | Everything not yet refunded comes back (`execution_failed`) | Keep |
| Cancelled | Unrun work refunded (`execution_cancelled`) | Keep |
| Provider timeout | Step retried (bounded) at no extra charge. If the execution then fails, refund. | Keep. A route fallback (§D) runs before any failure. |
| Uses more than expected | The customer pays the planned estimate only. Ensemblis absorbs overruns up to `MAX_TOKENS_PER_EXECUTION`, past which the run fails and is refunded. | Keep fixed prices (predictability is part of the product). Review each capability's price quarterly against measured cost, using `suggestedCredits` as the floor. Alert when a capability's cost/price ratio exceeds 25%. |
| Retried by the system | Free (same execution) | Keep |
| "New attempt" by the user | A new execution, charged | Keep. Rerunning a failed verification is free only when the cause was ours (verifier unavailable → fee refunded, as today). |
| Runs out of credits during execution | **Impossible**: the full estimate is charged at start inside the status-flip transaction | Keep. Planning is refused when the balance is below the cheapest plan. |
| Monthly allowance resets | — | Unused **allowance** expires at period end (an `ALLOWANCE_EXPIRY` ledger row). **Top-up** credits don't expire. Allowance is spent first. |
| Upgrade | — | Immediate. Grant the difference between the new and old allowance for the current period, and start the new rate. |
| Downgrade | — | At period end. The allowance already granted is kept until then. |
| Payment fails (with Stripe later) | — | Status `past_due`. The allowance isn't renewed; existing credits remain usable for 7 days. |

### Entitlement model (designed; **not implemented**: it needs an additive migration and your approval)

- **Plan catalog in code** (`billing/plans.ts`), versioned:
  `{ key, monthlyCredits, maxSeats, maxRunsPerUserPerDay, maxTemplates, maxRecurring, historyDays, features: Set<Feature> }`.
  No plans in the database: changing a plan is a reviewed code change.
- **`Subscription` table**, one per paying wallet:
  - `walletUserId`, `planKey`, `status` (`active` | `past_due` | `canceled` | `internal`);
  - `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`;
  - `source` (`internal` | `stripe`), `externalId` (nullable), `allowanceRemaining`.
- **One balance, no second accounting system.** `User.credits` stays the only spendable balance [R].
  - The allowance is tracked as `allowanceRemaining`, so expiry removes only unused allowance.
  - New ledger reasons: `allowance_grant`, `allowance_expiry`, `plan_change`.
  - Existing idempotency keys (`grant:<subscriptionId>:<periodStart>`) make renewals safe to replay [R mechanism].
- **Enforcement in the backend.** One `entitlements(org)` function used at:
  - planning (runs per day);
  - template and recurring creation (limits);
  - team invites (seats);
  - history queries (retention).

  The frontend only displays what the API returns.
- **Stripe later.** `checkout.session.completed` / `invoice.paid` → grant; `customer.subscription.updated` →
  plan change; `invoice.payment_failed` → `past_due`. Handled by the existing signed-webhook pattern
  (`billing/stripe.ts` [R]); no product code changes.
- **Development mechanism** (when built):
  - `npm run ops:set-plan -- --email … --plan growth` writes `source: "internal"`, `status: "internal"`.
  - It is an operator CLI with direct database access, like `ops:verify-email` [R]. There is **no API route**.
  - The UI labels internal plans "Internal test plan", so it can't become a billing bypass.

### Cost estimation

- Keep **fixed credit prices per capability** [R], so the user sees the cost before work starts.
- Measure **actual cost per capability and per route** from `UsageEvent` (with `PROVIDER_PRICING` set) and
  review it quarterly.
- Protections:
  - **Per-run:** the token ceiling [R], the plan step cap [R], step retry limits (3 attempts) [R].
    - The ceiling is **600,000 tokens** (`MAX_TOKENS_PER_EXECUTION`) [R]. That is safe on Groq, at about €0.15
      at the ceiling.
    - On a frontier route, a run that hits it could cost about $5–7 (e.g. 450k input and 150k output tokens on
      GPT-5.5) [H on token mix, E on prices]. That is close to the run's €8.60 list value.
    - **Before any frontier route goes live, the ceiling must become a cost ceiling per run in euros**, derived
      from the route's price (e.g. at most 30% of the run's list value), not a fixed token count.
  - **Per-user:** daily runs [R].
  - **Server-wide:** the daily token budget (PR #7) and a daily € budget per route (§D).
  - **Pricing:** a capability's credit price must stay at least 4× its measured variable cost at the Business
    rate [H threshold].

## Measurement (definitions; queries in `docs/product/metrics.sql`)

| Metric | Definition | Data | Available today? |
|---|---|---|---|
| Task completion rate | completed ÷ started (started = charged) | `Execution.status`, `startedAt` | Yes (metrics.sql) |
| Verified rate | completed with PASS / PASS_WITH_WARNINGS ÷ completed | `verificationStatus` | Yes |
| Deliverable quality | Scorecard dimensions; manual ones by an evaluator | `eval:scorecard` + evaluator sheet | Tool yes; sheet manual |
| Evidence coverage | Rows or claims with a source ÷ total; live-web research steps ÷ research steps | Scorecard; `ExecutionStep.research` | Yes |
| Material factual error rate | Wrong material facts ÷ sampled facts (evaluator) | Evaluator sheet | Manual |
| Time to useful output | `startedAt` → `completedAt` (median); plus tester active minutes | `Execution`; facilitator | Yes / manual |
| Cost per completed task | Priced `UsageEvent` cost ÷ completed | `UsageEvent.costMicros` | Only with `PROVIDER_PRICING` set |
| User acceptance | Outcome confirmed achieved or partially ÷ judged | `confirmedOutcomeStatus` | Yes (weak proxy); "useful?" feedback in PR #6 |
| Repeat workflow usage | Orgs with runs in ≥ 2 weeks of a month; later, reruns of the same template | `Execution` | Yes (week-based); templates not built |
| Conversion to paid | Paying subscriptions ÷ activated orgs | Subscription + Stripe | Not built |
| Retention | Orgs active in month N that are active in N+1 | `Execution` | Yes (derivable) |
| Gross margin | (Revenue − variable cost − payment fees) ÷ revenue | Stripe + `UsageEvent` | Not until payments |

None of these says anything about product-market fit until real customers produce them. Small numbers are
counts, not rates.

## G. Roadmap

**Essential now (before or for validation)**
1. Live web search in production (`TAVILY_API_KEY`), then one real-model smoke run. *Your approval or action.*
2. The controlled test (doc 10). It decides the first workflow.
3. Measurement pieces: `metrics.sql` (this PR); land "Was this useful?" feedback from PR #6 (rebased);
   `PROVIDER_PRICING` set so cost per task is real.
4. Model routes and an offline benchmark harness (§D, §H option 2): no spend, no behaviour change. Then the
   benchmark itself once approved.

**Valuable after validation** (if the controlled test confirms the workflow)

5. **The account-research pipeline:** fetch each candidate's own site (the guarded `fetchUrl` [R]); a
   structured table deliverable; capacity for 20 rows; per-row verification.
6. **Saved workflow templates and reruns** with "no duplicates since last run" / "what changed".
7. **Entitlements and the three plans** (§E–F). Then Stripe subscriptions.
8. Model routes live with per-route budgets; the Anthropic adapter upgraded.

**Later**

9. CSV export, then CRM sync (HubSpot or Pipedrive) for the chosen customer.
10. Team administration (seat limits, roles), SSO, audit export.

**Not recommended**
- A general chat interface.
- Multi-model ensembles without benchmark evidence.
- A broad integrations catalogue.
- Model-chosen tool use for read-only research before a benchmark shows value.
- Actions with side effects (sending email, writing to a CRM automatically) before trust is measured.
- Collecting personal contact data.

## H. Implementation scope, risks, tests, next actions

### Option 2: start now (no spend, no production behaviour change). Recommended for Stage 5.

**Model routes, plus a benchmark harness that runs on stubs until approved.**
- **Files:**
  - `backend/src/ai/routes.ts` (new: schema, policy, selection, circuit breaker, budget);
  - `ai/llmProvider.ts` (dispatch by route; adapters extracted per provider);
  - `lib/usage.ts` (`routeId`);
  - `scripts/benchmark-synthesis.mjs` (frozen tasks × routes → scorecard);
  - tests.
- **Database:** one nullable column, `UsageEvent.routeId` (additive migration; safe to roll back because old
  code ignores it).
- **Behaviour:** identical when `MODEL_ROUTES` is unset. That is the default, and a test proves it.
- **Security:** keys read per provider from the environment; redaction tests extended; no key in route config.
- **Tests:**
  - route selection per purpose;
  - fallback only before output;
  - circuit breaker;
  - budget stop;
  - unset config equals today's behaviour (snapshot of request bodies against the stubs);
  - Anthropic adapter against a local stub;
  - native-schema path against a stub.
- **Deploy:** a normal PR. The migration is additive. Nothing changes until env is set.
- **Overlap:** PR #4's premium route. Decision 2 decides whether it is folded in.

### Option 1: after the controlled test (cost per run rises slightly; needs approval)

**Account research v1.**
- A new capability: per-account fetch of the candidate's own website, with existing SSRF guards [R
  `research/netGuard.ts`]; at most N fetches per run, counted as usage.
- A structured table deliverable with the template columns; list capacity raised for this capability.
- A verification check per row: the website domain must equal the cited source domain for the existence and size
  claims.
- **Files:** `org/registry.ts`, `engine/executor.ts` (a fetch tool), `research/fetchUrl.ts`, `engine/prompts.ts`,
  `verification/checks.ts`, frontend table rendering, tests.
- **Risks:** cost (fetches are free but slow); site blocking; robots and terms (respect robots.txt; no login
  pages); latency.

### Option 3: after validation and pricing approval

**Entitlements and plans** (§F). An additive migration (`Subscription`, ledger reasons), the plan catalog,
enforcement points, the ops CLI, and tests for each scenario in §F. No Stripe yet.

### What this PR delivers

- This document.
- `docs/product/metrics.sql`. Read-only; validated against local databases (it returns rows on the e2e stack's
  data).
- **No code changes. No migrations. No spend.**

### Next actions (shortest list)

1. **You:** decide 1–5 in "Decisions I need from you" (above).
2. **You:** set `TAVILY_API_KEY` on Render, or approve me preparing exact steps. Then I verify it with the
   production smoke.
3. **Me, once approved:** Option 2 as one PR (stubs only). Rebase PR #6's feedback onto main if you approve
   decision 2.
4. **Together:** run the controlled test. Its result decides Option 1, or the fallback workflow.

## External sources

- ChatGPT Business pricing (secondary): https://elephas.app/resources/chatgpt-business-pricing ,
  https://krater.ai/blog/chatgpt-pricing
- Perplexity Pro pricing (secondary): https://www.eesel.ai/blog/perplexity-pricing ,
  https://www.finout.io/blog/perplexity-pricing-in-2026
- Clay pricing (secondary): https://www.zeliq.com/blog/clay-pricing , https://crustdata.com/reviews/clay
- GPT-5.5 API pricing:
  - PR #4's table, checked on OpenAI's page on 23 Oct;
  - secondary: https://morphllm.com/openai-api-pricing .
- Claude model IDs and prices: the Claude API reference bundled with the development tooling (cached 6 Oct
  2026). Confirm on Anthropic's pricing page.
- Groq gpt-oss and Tavily prices: PR #4's `PROVIDER_PRICING` table (checked 23 Oct 2026 on the providers' own
  pages); Tavily credits per search, secondary.
