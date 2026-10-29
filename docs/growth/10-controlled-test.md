# Controlled test: 20 qualified prospects and a source-backed outreach research pack

This test is designed and has not been run. It runs one well-defined task three ways and scores each output
with the same scorecard (`09-quality-scorecard.md`):

- **A:** Ensemblis.
- **B:** a general-purpose AI assistant.
- **C:** a person doing manual research.

It answers one question before the wider experiment (`07-validation-plan.md`): on a task where a wrong
fact costs the user credibility, does Ensemblis give a result that is more trustworthy and cheaper in human
time than the alternatives?

**Boundaries:**
- Nothing in this test contacts a prospect, sends an email or collects personal contact details. The deliverable
  is research only.
- No company names, facts or signals are invented in this document or in the evaluation. Every value comes
  from an arm's output, and every check is against a live source.

## 1. The task, exactly as every arm receives it

> **Identify 20 qualified business prospects for the target customer profile below, verify the relevant company
> information, rank them against the explicit criteria, and prepare a source-backed outreach research pack.**
>
> *Seller:* {SELLER — what we sell, to whom, at what price band, with what proof}.
> *Target profile:* {ICP}. *Exclude:* {DISQUALIFIERS}. *Buyer role (role only — no names or contact details):* {ROLE}.
> *Ranking criteria:* {CRITERIA AND WEIGHTS}. *Evidence standard:* {STANDARD}.
>
> Deliver Markdown with these sections:
> 1. **Ranking methodology:** how each criterion was scored, and its weight.
> 2. **Prospects:** one table, one row per prospect, ranked, with the columns
>    `Rank | Company | Website | Characteristics | ICP match evidence | Reason to contact | Sources | Confidence | Missing information`.
>    Each row cites at least one source. Write the confidence as High, Medium or Low, with a reason. The Missing
>    information column says what could not be confirmed.
> 3. **Strongest prospects:** the five strongest and why.
> 4. **Limitations:** what the research could not establish.
>
> Do not include personal names, email addresses or phone numbers. Do not guess. If something can't be
> confirmed from a source, say so in *Missing information*.

The fixed table is what lets `npm run eval:scorecard` score all three arms the same way.

**Success criteria for arm A, entered by hand.** Don't accept suggested criteria here. Ensemblis verifies a result
against the criteria it is given, and a generic criterion such as "a clear, ranked recommendation is delivered"
can pass a pack with 6 prospects. In the local walkthrough the suggested criteria were exactly that generic,
although that was the mock model. Enter these four:

1. 20 prospects that match the target profile, ranked by the weighted criteria.
2. Every prospect has its website, characteristics, ICP match evidence, a reason to contact, sources, a
   confidence level and its missing information.
3. Each prospect's existence, size and services are cited to its own website or the official register.
4. No personal names, email addresses or phone numbers appear.

## 2. Inputs the test needs, and the defaults proposed

These are the inputs the task cannot run without. The defaults are **assumptions**, chosen so that the result is
both checkable and useful to Ensemblis itself. Replace any of them before the run. Once the run starts, they are
fixed.

| # | Input | Why it's needed | Proposed default (**assumption**) |
|---|---|---|---|
| I1 | Seller and offer | "Reason to contact" means nothing without it | **A1:** Ensemblis: business research objectives run by an AI team. A plan and a cost come first; every claim is numbered to a source and verified. Invite-only beta. |
| I2 | Target profile (ICP) | Defines "qualified" | **A2:** Independent marketing, growth or strategy agencies and consultancies in the **United Kingdom** with **2–25 people**, that sell market research, competitor analysis or positioning work to **B2B** clients. Segment B in `06-customer-hypotheses.md`. |
| I3 | Disqualifiers | Prevents easy false positives | **A3:** More than 50 staff; owned by a large holding network; performance-ads-only shops; no working website; existing Ensemblis users or contacts. |
| I4 | Buyer role | Makes the "reason to contact" concrete without personal data | **A4:** Founder, managing director or head of strategy, **as a role only**. |
| I5 | Ranking criteria and weights | Makes the ranking checkable | **A5:** Profile fit 40%; research-heavy services 30%; a dated timing signal in the last 12 months (a hire, a launch, a new service, a published report) 20%; evidence quality 10%. Each scored 1–5, then weighted. |
| I6 | Evidence standard | Separates "verified" from "found" | **A6:** Existence, size and services come from the company's **own website** (its about, team or services pages), or from the official company register (Companies House for the UK). A timing signal needs a **dated** source no older than 12 months. Directories and listicles may *suggest* a prospect but don't verify one. |
| I7 | Language and geography of sources | Keeps verification tractable | **A7:** English-language sources; UK companies only. |
| I8 | Budget and deadline | Bounds cost and makes efficiency measurable | **A8:** Ensemblis: at most **2,000 credits**, one run, autonomy "review the plan". Assistant: one prompt plus at most one "complete the missing fields" follow-up. Manual arm: a **3-hour** time box. |
| I9 | Evaluators | Independence | **A9:** One evaluator who did not run any arm, plus a second for at least a third of the rows. Neither is the person who built the product, if that can be arranged. If it can't, say so in the results. |
| I10 | Output template | Comparability | The table in §1. |

## 3. The three arms

| Arm | Who runs it | How | Recorded |
|---|---|---|---|
| **A: Ensemblis** | A tester on production, from a fresh account in the same organisation setup | The §1 text as the objective, deliverable "decision memo" (lead research is planned from it). Company Context filled with the seller description (I1). Approve the plan; no edits to it. | Execution ID; plan and its cost; wall-clock time; tester active minutes; credits; result state; verification verdict |
| **B: General-purpose AI** | The same tester, another day, or a second tester | One named tool and tier with web access (record which, e.g. its research mode), the same §1 text, one follow-up allowed | Tool, tier, date; the full answer saved as Markdown; active minutes; subscription cost per month |
| **C: Manual research** | A person who is neither the evaluator nor the tester of A | Web search, company websites, the official register; the §1 template; 3-hour time box | Minutes spent; the pack as Markdown |

**Ordering and contamination:**
- Run C first, or by a different person, so the manual researcher never sees A's or B's output.
- Run A and B on the same day so the web is the same.
- Don't re-run an arm to get a better answer. If an arm fails technically, record the failure, then allow one
  re-run and label it as one.

## 4. Preconditions: the test is void without them

1. **Live web search is on in production.**
   - `TAVILY_API_KEY` is set on the Render API service.
   - The *Production smoke* workflow shows "web search uses the live provider".
   - On the day, `SEARCH_DAILY_BUDGET` is high enough: at least 30 left. One run uses 3–8 searches.
   - Running A on the Wikipedia fallback measures the fallback, not the product. The research would now show as
     *degraded*, and the scorecard fails *research coverage* for it.
2. The real-model smoke (`DEPLOYMENT.md` §5a) has passed at least once, so a bad key or a broken model isn't
   discovered during the test.
3. The founder has approved the spend: about 1,150–1,450 credits from a test balance, plus the variable model
   and search cost (§7).

## 5. Procedure

1. **Freeze** the inputs in §2. Write the defaults or replacements into the run log.
2. **Arm C** produces its pack. Record the minutes.
3. **Arms A and B** run. The facilitator records active minutes: from opening the tool to accepting the final
   output, excluding waiting time. Wall-clock time is recorded separately.
4. **Export:**
   - A: the console's Markdown download, plus its execution ID.
   - B: the answer pasted into a `.md` file, without edits.
   - C: as written.
5. **Score the automated part:**
   - `npm run eval:scorecard -- --execution <id> --expect 20 --tester-minutes <A's minutes> --baseline-minutes <C's minutes>`
     for A.
   - `--file <pack>.md --label <arm> --expect 20` for B and C.
6. **Blind the packs.** Strip product names and styling, and relabel them X, Y and Z. Then the evaluators complete
   the manual worksheet the scorecard prints.
7. **Ask the tester for actionability**, using the scorecard's wording, before telling them which pack is which.
8. **Record everything** in one sheet, one row per arm. Keep every scorecard output and evaluator note.

## 6. Prediction, written before running

Reading the current pipeline suggests that Ensemblis will **not** meet the bar on this task as it stands, even
with live search. The bottlenecks are in the code:

| Limit | Where | Effect on this task |
|---|---|---|
| A lead-research step writes 3 queries, and keeps at most **6 new sources** | `backend/src/engine/executor.ts` (`gatherEvidence`), `backend/src/research/sources.ts` | 20 prospects can't each have their own source from one step. A plan with 2–3 research steps tops out around 12–18 sources. |
| Tavily `basic` depth returns **snippets** (≤ 2,000 characters), not pages | `backend/src/research/search.ts` | Snippets of listicles and directories dominate. Own-website verification (I6) rarely happens. |
| Prospect websites are **never fetched** | `fetchUrl` is used only for the user's own company website | Existence and size are not verified from the source the evidence standard requires. |
| Evidence in the prompt: 7,000 characters per work step, 10,000 for a brief's synthesis | `executor.ts` | About 1,000 characters per source at 6 sources. |
| Output length: about 900 words per work step, 1,400 for the synthesis | `stepSystemPrompt` | About 70 words per prospect for 20 prospects, which is too few for nine fields. |
| Verification checks the first **30** claims (20 by the model) | `verification/checks.ts`, `claimCheck.ts` | A 20-row pack has more. The rest are reported as "not checked", which is honest, but they are unverified. |

**Predicted:**
- Fewer than 18 prospects.
- *Evidence coverage* fails, with well under 75% of rows citing their own website.
- What is delivered is cited, and invented sources are caught.

This prediction is a hypothesis to falsify, **not a result**.

**If it holds,** the next step is a scoped change for lead lists, put to the founder for approval because it
changes cost per run:
- Per-prospect verification that fetches each candidate's website (the guarded `fetchUrl` already exists).
- More queries and results for lead research.
- A structured table output.
- A higher length limit for list deliverables.

## 7. Cost of the test, estimated

These are estimates, not quotes. Check the prices on the provider pages before approving.

- **Ensemblis credits:** a plan of framing (100), lead research (300), possibly account research (300), synthesis
  (300) and verification (150) comes to **850–1,150 credits**, or about **1,450** with one automatic revision.
  The test account's starting balance (3,000) covers it.
- **Search:** 3–8 Tavily searches per run at `basic` depth, 1 Tavily credit each. That is well inside Tavily's free
  monthly allowance (1,000 credits, per third-party summaries that could not be checked against tavily.com from
  this environment). At the commonly quoted pay-as-you-go rate (about $0.008 per credit) it is under $0.10.
- **Model:** the variable cost of one run on the production model is shown on the owner dashboard once
  `PROVIDER_PRICING` is set. No figure is quoted here because none has been measured.
- **People:** the 3-hour manual arm, about 1 hour of tester time for A and B, and about 2 hours of evaluation.
  People are the real cost of this test.

## 8. Reading the result

Decide this before running:

| Outcome | Decision |
|---|---|
| A meets ≥ 8 of 10 dimensions, beats B on factual accuracy and evidence coverage, and A's tester time ≤ 50% of C's | Lead research is a validated lead use case: include it in the 15–20-task experiment and the positioning. |
| A delivers fewer, but accurate, prospects with 0 fabrications, and fails coverage or completion as predicted | Capacity is the bottleneck, not trust. Build the scoped lead-list change (§6) before lead tasks go into the experiment. Other use cases go ahead. |
| A passes a fabricated company, website or fact through verification | Stop. Fix verification before any outreach-related use case. This outranks everything else. |
| B ≥ A on accuracy and coverage at lower human time | Differentiation on lead research isn't shown. Don't position on it. Test research briefs, where verification is the difference, or rethink the workflow. |
| C beats both A and B on accuracy, and A doesn't save ≥ 50% of C's time | The time-saving claim isn't supported for this task. |

One run per arm is a **demonstration, not a statistic**. It can rule things out (a fabrication, a structural
capacity limit), but it can't prove reliability. Reliability comes from the 15–20 tasks in `07-validation-plan.md`.
