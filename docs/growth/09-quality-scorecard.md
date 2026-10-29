# Quality scorecard: ten dimensions, how each is scored, and the minimum to pass

This document says how to judge **one deliverable**. The same rules apply whether the deliverable came from
Ensemblis, a general-purpose AI assistant or a person doing manual research. That is what lets the controlled
test (`10-controlled-test.md`) compare them fairly.

It contains no scores. Nothing here has been run on a real task yet. A score exists only after someone
measures it and writes it down.

**The tool:** `cd backend && npm run eval:scorecard -- …` (`backend/src/ops/scorecard.ts`). The tool only
reads: it never writes, calls a model, searches or fetches a page.

**What it does:**
- It measures everything that can be counted.
- It prints an evaluator worksheet for everything that needs judgment.
- If a dimension still needs an evaluator, it is never marked PASS.

```bash
# An Ensemblis execution (reads its result, evidence, steps and verification; needs DATABASE_URL):
npm run eval:scorecard -- --execution <executionId> --expect 20 --tester-minutes 15 --baseline-minutes 120
# A baseline saved as Markdown (the assistant's answer, the manual pack):
npm run eval:scorecard -- --file chatgpt.md --label "General-purpose AI" --expect 20
# --json for the full measurements, --out <file> to save it
```

**What the tool can parse:**
- It reads prospect rows from a Markdown table with the columns of the controlled test's output template.
- A deliverable without that table is scored as having no prospects. That is the correct score for a list
  that wasn't delivered as asked.

## The dimensions

**How to read the Method column:**
- **Automated:** the tool decides.
- **Mixed:** the tool can fail it; a named evaluator completes it.
- **Manual:** a person decides; the tool only gives context.

### 1. Task completion (Mixed)

What is measured:
- Prospects delivered against prospects requested.
- Rows with every required field (company, website, characteristics, ICP evidence, reason to contact,
  sources, confidence, missing information).
- Whether a ranking-methodology section and a strongest-prospects summary exist.
- Whether the run delivered a result at all.

Minimum to pass:
- At least **90%** of the requested prospects (18 of 20).
- At least **90%** of rows complete.
- Both sections present.
- The evaluator confirms that nothing requested is missing.

### 2. Source relevance (Manual)

What is measured: the evaluator samples 20 citations, 2 from each of 10 random rows, and marks each one
relevant or irrelevant to the statement it is attached to. The tool reports the number of distinct domains,
the share of sources actually cited and duplicate URLs, as context.

Minimum to pass: **at least 80%** of the sampled citations are relevant.

### 3. Evidence coverage (Automated)

What is measured:
- Rows that cite at least one source.
- Rows that cite the **prospect's own website**, matched by the cited URL's domain against the row's website.

Minimum to pass:
- **Every** row is sourced.
- At least **75%** of rows cite their own website.

### 4. Factual accuracy (Manual)

What is measured:
- Open every listed website. The company must exist and match the row.
- Then check 2 facts in each of 10 random rows (20 facts) against the live site or the cited source. Mark each
  correct, wrong or unverifiable.

Minimum to pass:
- **0** fabricated companies or websites.
- At least **90%** of the sampled facts correct.
- A single fabricated company or website fails the dimension.

### 5. Citation quality (Mixed)

What is measured:
- Citations to sources that don't exist.
- For Ensemblis only, the verifier's claim verdicts: supported, partially supported, unsupported, uncited.
- The evaluator opens 10 cited sources and checks that each one says what it is cited for.

Minimum to pass:
- **0** invalid citations.
- Verifier: at least **85%** of checked claims supported or partially supported, and at most **5%** unsupported.
- Spot check: at least **90%** correct.

### 6. Research coverage (Automated)

What is measured:
- External sources, split into live web and Wikipedia.
- Distinct external domains.
- For Ensemblis: research steps run on the live web, against steps that were Wikipedia-only, failed, found
  nothing or did not run.

Minimum to pass:
- **Live web search on every research step.**
- At least **10** distinct external domains, or half the requested prospects if that is more.
- Wikipedia-only research fails this dimension, whatever status the run recorded.

### 7. Uncertainty handling (Mixed)

What is measured:
- Every row states a confidence indicator and its missing information.
- A limitations or open-questions section exists.
- The tool counts "Inference:" labels and uncertainty statements.
- The evaluator rates the deliverable 1–5: are thin evidence and inference stated as such, and is no
  unsupported claim stated as fact?

Minimum to pass:
- Every row complete on both fields.
- The section present.
- An evaluator rating of at least **4/5**.

### 8. Actionability (Manual)

What is measured: the tester answers, unprompted, which prospects they would contact and what they would still
need to check first. Then they rate 1–5 how ready the deliverable is to act on.

Minimum to pass:
- A rating of at least **4/5**.
- The tester would contact **at least 5** prospects after no more than 10 minutes of extra checking each.

### 9. Reliability (Automated)

What is measured:
- The run's end state: completed, failed or cancelled.
- Its result state: verified, with warnings, partial or unverified.
- Failed steps and retries.
- Across the experiment, the share of runs that meet the minimum.

Minimum to pass:
- For one run: completed and **verified** (or verified with warnings), no failed step, at most 2 retries.
- Across the experiment: **at least 90%** of runs meet that.

### 10. Efficiency (Mixed)

What is measured:
- Wall-clock time from launch to result.
- Credits charged against the approved budget.
- The tester's active minutes against the manual arm's minutes.

Minimum to pass:
- At most **30 minutes** from launch to result.
- Within the credit budget.
- Tester time at most **50%** of the manual arm's time.

**How to treat Ensemblis's own labels:** treat a result state of *partial* or *unverified*, and a research
status of *degraded*, as facts about the run. They are not excuses: they count against reliability and research
coverage exactly as the minimums above say.

## Rules for evaluators

- **Blind the arms where possible.** Strip product names and formatting differences. Give the evaluator three
  packs labelled A, B and C. Record who evaluated what.
- **Two evaluators** score the manual dimensions independently on at least a third of the deliverables. Disagreements
  of more than one point are discussed and both scores kept. The disagreement rate is itself a result.
- **Same sample, same facts.** Where the arms list the same company, check the same facts for each.
- **No partial credit for fluency.** A confident, well-written row with a wrong website scores as wrong.
- **Write the score and the reason.** A number without a sentence is not usable later.

## Why these minimums

These minimums are set before any run, so that results cannot move them. They describe the standard at which a
founder could hand the pack to a salesperson without re-doing it. If a minimum proves wrong, change it in this
file with the reason, before the next batch. Never change it for the batch that missed it.
