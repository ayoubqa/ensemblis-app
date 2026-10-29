# Validation plan — 15 to 20 real tasks

The open question is not whether the software runs (it does, end to end, on the test provider) but whether its
output on **real questions, with the production model and live web search**, is good enough that people act on it,
come back and pay. This plan answers that with the smallest experiment that can. Nothing here has been run yet;
no result below is real until someone records it.

## Before the first session

- **Live web search must be on.** On 29 October 2026 production searched Wikipedia only (the live provider wasn't
  configured). Running the experiment like that would measure the fallback, not the product. Fix it first, and
  confirm with the *Production smoke* workflow.

## Design

- **15–20 tasks**, each a real question from a real person (founders and small agencies, per
  `06-customer-hypotheses.md`), run on production. Not test prompts we write ourselves.
- **Mix:** about half competitor or market research, a quarter account or customer research, a quarter something
  else they bring (pricing, process, vendors). Record which use case each one is.
- **Same session format:** a 30-minute call; they write the objective and criteria; they watch the plan and its
  cost; the founder notes what confused them. Afterwards, the questions below.
- **Budget:** decide a ceiling in credits and model cost before starting (the pricing page's estimator gives
  800–2,050 credits per task; the owner dashboard shows the variable cost actually incurred). Stop if it is reached.
- **Consent:** tell participants their question runs on Ensemblis, what is stored, and that results are not shared.
  Don't publish anything from a session without written permission.

## What to record per task

### Technical — from the product (owner dashboard, `funnel.sql`)
| Measure | Where |
|---|---|
| Completed? Verification verdict and score | Objective console |
| Credits charged; variable model and search cost | Usage, owner dashboard (economics) |
| Wall-clock time from approval to result | Execution timeline |
| Exceptions raised, and why | Exceptions |
| Sources cited; claims flagged unsupported or uncited | Verification panel |

### Quality — scored by the participant **and** independently by the founder (1–5 each, with a sentence why)
| Dimension | The question to answer |
|---|---|
| Accuracy | Of the 3–5 claims the conclusion rests on, are they true? (Open the sources — check 3 in the Journal's five checks.) |
| Source quality | Primary and current, or secondary, stale or weak? |
| Relevance | Does it answer the question asked, not a nearby one? |
| Completeness | What would a competent analyst have added? |
| Verification quality | Did the verification catch what the person caught? Did it pass anything it shouldn't have? |

Record disagreements between the participant's and the founder's scores — they are the most informative rows.

### Business — from the participant, in their words
| Measure | The question |
|---|---|
| Time saved | "How long would this have taken you, and who would have done it?" |
| Willingness to act | "Will you act on this? What would stop you?" |
| Willingness to pay | "Would you pay [a price you choose before the session] for the next one?" — a yes, a no, or a counter-offer |
| Repeat use | Do they run a second objective on their own within 14 days? (`funnel.sql`, `came_back_another_week`) |

Don't count clicks or completions as value. A completed, verified task the person won't act on is a failure.

## Reading the results

Decide the bar **before** the first session. A reasonable starting point:

- **Quality gate:** median accuracy ≥ 4 and no task with a fabricated source that verification passed. If this fails,
  stop marketing and fix output quality first — nothing else matters until it passes.
- **Value signal:** at least half say they will act on the result.
- **Payment signal:** several accept the stated price or counter with a concrete one.
- **Retention signal:** some come back unprompted within two weeks.

Write the decision down after the last session: which segment and use case to lead with, what to fix, and the
price to test next. Then update the homepage, the editorial plan and the pricing page from evidence, not hope.

## What this cannot tell you

- Whether the result holds at scale or for strangers who never spoke to the founder (concierge sessions are
  friendlier than real use).
- Long-run retention or churn.
- Exact unit economics at volume — only the variable cost per task in this sample.
