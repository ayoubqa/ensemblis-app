# Validation plan — 15 to 20 real tasks

**The question:** can Ensemblis reliably produce a business outcome that people value, act on, return for and pay
for? The software runs end to end; that is not in doubt. What is in doubt is whether its output on **real
questions, with the production model and live web search**, clears each of five layers. Each layer has its own
evidence and its own bar:

| Layer | The question | Evidence that counts | Evidence that doesn't |
|---|---|---|---|
| 1. Technical functionality | Does a run finish, honestly labelled, without an operator stepping in? | Run states and failure rate from the product | "It worked when I tried it" |
| 2. Research quality | Is the deliverable accurate, sourced and complete? | The scorecard (`09-quality-scorecard.md`), scored by an evaluator who isn't the participant | The verifier's own score on its own |
| 3. User-perceived value | Does the participant act on it? | A specific action named, and taken by day 7 | Praise, "interesting", "impressive" |
| 4. Repeat usage | Do they come back without being asked? | A second objective within 14 days with no prompt | A second run during the session |
| 5. Willingness to pay | Will they commit money or something costly? | A payment or a signed pre-order. Weaker: booking the next task on their own problem | "I would pay for this" with nothing at stake |

Nothing here has been run, and no number below is a result. The controlled test (`10-controlled-test.md`) comes
first, because one task run three ways can rule out problems that 20 tasks would only blur.

## Gates before the first session

1. **Live web search is on in production.**
   - Set `TAVILY_API_KEY` on the Render API service.
   - Raise `SEARCH_DAILY_BUDGET` to about 60 on session days.
   - Confirm with the *Production smoke* workflow: "web search uses the live provider".
   - Wikipedia-only research is now marked *degraded* everywhere, and running the experiment on it would
     measure the fallback.
2. **The real-model smoke has passed once** (`DEPLOYMENT.md` §5a: *Actions → Real-model smoke*, scenarios `E,A,D`).
   It has never run. Until it passes, nobody has seen the production model and real search work together.
3. **The controlled test is done and read** (`10-controlled-test.md`). Its outcome decides whether lead-list tasks
   are included (below).
4. **Cost measurement is on.**
   - Set `PROVIDER_PRICING` with prices from the providers' current pages, so the owner dashboard shows the
     variable cost per task.
   - Without it, cost is "unpriced", never guessed.
5. **Budget approved.** About 850–1,450 credits per task, so 17,000–29,000 credits for 20 tasks, granted as test
   balances. Credits here are not revenue. The variable model and search cost is measured on the first three
   tasks, then extrapolated. Stop if the approved ceiling is reached.
6. **Consent text agreed.** Tell participants:
   - their question runs on Ensemblis;
   - what is stored;
   - that the result is theirs and is not published without written permission;
   - that the session is observed.

## Who

- **15–20 participants**: 8–10 early-stage B2B founders (Segment A) and 7–10 people from small agencies or
  independent consultancies (Segment B), per `06-customer-hypotheses.md`.
- Recruit from the founder's network and communities. No paid acquisition.
- Exclude anyone who has already seen the product's output, and anyone who can't be critical of it (close
  friends, investors).
- **Each brings one real problem** that has a decision attached and a deadline within about two weeks. A test
  prompt we wrote doesn't count.
- **Facilitator:** the founder, or someone briefed. **Evaluator:** someone who is neither the participant nor the
  builder, plus a second evaluator on at least a third of the tasks.

## Which problems

| Use case | Share | Notes |
|---|---|---|
| Competitor analysis, market research, research brief | ~50% | The core claim: evidence-backed research with verification |
| Account or customer research | ~25% | Bounded scope, easy to check |
| Lead lists / prospects | 0–25% | **Only if the controlled test passed** (or after the scoped lead-list change). Otherwise the result is already known. |
| Something else they bring (pricing, vendors, process) | the rest | Tests the breadth claim |

## What each participant provides

Before seeing any output, record these in the facilitator sheet:

1. **The decision and its deadline.** "Which two markets to enter next quarter" is a decision. "Learn about
   markets" is not.
2. **The objective, in their own words.** Typed into the define page by them, not by the facilitator.
3. **3–5 success criteria that can be checked**, entered by hand. Ensemblis verifies against the criteria it is
   given, so a vague criterion passes vague work.
4. **Company Context**: the five fields, filled in by them.
5. **Constraints and budget.** Default 2,000 credits.
6. **The counterfactual, asked first:** what would you do without this tool? Who would do it, how long would it
   take, and what would it cost? Ask this **before** they see a result, so the answer isn't anchored by it.

## Session (30–45 minutes)

1. The participant defines the objective. The facilitator **doesn't help** unless they are stuck for more than
   2 minutes, and notes every point of confusion verbatim.
2. Review the plan and its cost. Note what they expected to receive and whether the plan says so.
3. The run. Record wall-clock time and the participant's **active** minutes, excluding waiting.
4. They read the result with the evidence and verification panels. They confirm or reject the outcome with
   **"Your judgment"** on the console. That is the product's own record of perceived achievement.
5. Ask the questions below. Then export the deliverable and score it (`npm run eval:scorecard -- --execution <id>`).

## What to record per task (one row in the facilitator sheet)

### Layer 1 — technical (from the product)

| Measure | Where |
|---|---|
| End state; result state (verified, verified with warnings, partial, unverified); verification score | Console header; `eval:scorecard` |
| Research status per step: ok, degraded, failed, none; providers | Evidence panel; scorecard *research coverage* |
| Failed steps, retries, exceptions and why, operator interventions | Execution timeline; Exceptions |
| Credits charged and refunded; variable cost | Usage; owner dashboard (with `PROVIDER_PRICING`) |
| Wall-clock time; participant active minutes | Timeline; facilitator stopwatch |

### Layer 2 — research quality (independent evaluator)

The ten dimensions and their minimums in `09-quality-scorecard.md`.
- **Hard stop:** a fabricated source, company or fact that verification passed.
- Also record: any disagreement between the participant's view and the evaluator's.

### Layer 3 — value (participant, in their words, recorded verbatim)

| Question | Notes |
|---|---|
| "What will you do differently because of this, and by when?" | Code it **specific action** (names what and when), **vague intent** or **none**. Praise without an action is novelty, not value. |
| "Which part would you forward or reuse, and to whom?" | Concrete reuse is a value signal. |
| "What would you still need to check before acting?" | This is the trust gap. |
| **Day 7 follow-up:** "Did you do it? Did you use any part of it?" | Behavioural evidence. It outranks anything said in the session. |

### Layer 4 — repeat use

- A second objective **within 14 days, unprompted**. Source: `funnel.sql` (`came_back_another_week`) and the
  execution list.
- Record whether anyone reminded them. Email is off in production, so only the facilitator could have.
- A reminded return is counted separately.

### Layer 5 — willingness to pay, without leading

- **Don't** mention price before the value questions. **Never** propose a number in an open question.
- Ask, in this order:
  1. The counterfactual cost (asked before the session).
  2. After the value questions: "What would this result have been worth to you?" Open, with no number.
  3. **One fixed offer, chosen before the session and the same for everyone:** "The next one is [price]. Do
     you want to book it now?" Record yes, no, or a counter-offer.
- **Evidence strength, strongest first:**
  1. Paid. This needs a payment path, which production doesn't have yet. An invoice or a payment link outside
     the product works.
  2. A signed pre-order or a paid-pilot agreement.
  3. Booked the next task on their own problem.
  4. Stated a price.
  5. A compliment.
- Free demo top-ups in the app are **not** a payment signal.

## Decision rules (fixed before the first session)

Evaluate them per segment, then overall.

| Result | Decision |
|---|---|
| **Layer 1 fails**: fewer than 90% of runs complete without an operator, or any degradation that wasn't shown | Fix reliability before anything else. No marketing. |
| **Layer 2 hard stop**: any fabricated source, company or fact passed by verification | Stop the experiment. Fix verification. Re-run the controlled test. |
| **Layer 2 weak**: fewer than 70% of tasks meet the scorecard's minimums on factual accuracy and evidence coverage | Fix output quality on the failing use cases. Don't market them. |
| **Layers 1–2 pass, layer 3 fails**: fewer than half name a specific action, or fewer than a third have acted by day 7 | The output is correct but not decisive. **Pivot the workflow** (decision-first briefs, fewer and sharper deliverables), or the use case. |
| **Value in one segment only**: actions, returns or commitments in A but not B, or the reverse | **Pivot the customer.** Focus the site, the Journal and recruitment on that segment and its use case. |
| **Value, but active time ≥ 50% of the participant's counterfactual time** | **Pivot the workflow.** Defining the objective and its criteria is the bottleneck: add templates, or start with concierge setup. |
| **People act, but layer 2 is no better than a general assistant** (controlled test arm B ≥ A) | **Pivot positioning.** Don't sell "research". Sell what is actually different (cost before running, criteria, verification, an audit trail), or the workflow around it. |
| **Layers 1–3 pass and (≥ 5 return unprompted or ≥ 5 commit to the fixed price) in a segment** | **Invest.** Lead with that segment and use case. Put the price on the pricing page. Turn on payments (an approval decision). Write the Journal from real, permitted examples. |

Write the decision down after the last day-7 follow-up, with the counts behind it. Small numbers are counts, not
rates: "6 of 17 acted", never "35%".

## What this cannot tell you

- Whether results hold for strangers. Concierge sessions with someone watching are friendlier than real use.
- Long-run retention and churn, and unit economics at volume. Only the variable cost per task in this sample is
  measured.
- Whether a stated willingness to pay becomes revenue. Only a payment shows that.
