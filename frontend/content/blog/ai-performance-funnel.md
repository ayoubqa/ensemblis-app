---
title: "The AI Performance Funnel: a proposed way to measure your brand in AI answers"
seoTitle: "AI Performance Funnel: measuring your brand in AI answers"
summary: "“Are we in ChatGPT?” is the wrong question. A proposed four-stage framework — prompt coverage, visibility, recommendation, first position — with exact definitions, a worked example, the statistics you need and its limits."
description: "A proposed framework for measuring brands in AI answers: prompt coverage, visibility, recommendation and first position, with definitions, maths and limits."
status: review
author: ensemblis-editorial
category: measurement
tags: [geo, measurement, ai-search, metrics, chatgpt-search]
cta: how-it-works
related: [what-is-generative-engine-optimization]
sources:
  - title: "AI recommendations change with nearly every query (coverage of the SparkToro and Gumshoe study)"
    url: "https://www.searchenginejournal.com/ai-recommendations-change-with-nearly-every-query-sparktoro/566242/"
    publisher: "Search Engine Journal"
    accessed: "2026-10-28"
    note: "Secondary coverage. Replace with SparkToro's own report before publishing."
  - title: "AI features and your website"
    url: "https://developers.google.com/search/docs/appearance/ai-features"
    publisher: "Google Search Central"
    accessed: "2026-10-28"
  - title: "GEO: Generative Engine Optimization (Aggarwal et al.)"
    url: "https://arxiv.org/abs/2311.09735"
    publisher: "arXiv / KDD 2024"
    accessed: "2026-10-28"
editorNotes: >
  Drafted with AI assistance on 2026-10-28. The framework (AI Performance Funnel, Recommendation Conversion) is Ensemblis's own
  proposal and is labelled as such throughout — keep it that way unless and until it is validated. All numbers in the worked example
  are hypothetical and labelled. Sources were checked through search-result excerpts only: open each before approving, and replace the
  Search Engine Journal link with SparkToro's original report. Decide whether to keep the ™ on first mention. Then set publishedAt,
  factCheckedAt and approvedBy.
---

“Are we in ChatGPT?” is the question most teams start with, and it is the wrong one. AI answers change from one run of a prompt to the next, differ between products, and depend on how a question is worded. A single screenshot that shows your brand — or doesn't — tells you very little.

This article proposes a way to measure something more useful. We call it the **AI Performance Funnel™**: four stages that separate *being mentioned* from *being recommended* from *being the first recommendation*, and one ratio — **Recommendation Conversion** — that tells you which of those is your real problem.

> [!NOTE]
> This is a proposed framework, not an industry standard, and it has not been independently validated. We publish it with its definitions, assumptions and limits so you can judge it, use it or improve it. If you find a flaw, tell us.

## The funnel at a glance

![The AI Performance Funnel with hypothetical numbers: of 200 sampled answers, 45% mention the brand, 27% recommend it and 9% name it first; recommendation conversion is 60% and first-position conversion is 33%.](/blog/ai-performance-funnel/funnel.svg "Hypothetical example: 40 prompts, each run 5 times, on one AI answer engine.")

| Stage | The question it answers | Measured as |
|---|---|---|
| **Prompt coverage** | Are we measuring the questions our buyers actually ask? | A judgement about your prompt set (see below) |
| **Visibility** | How often are we mentioned at all? | Share of sampled answers that mention you |
| **Recommendation** | How often are we suggested as an option to choose? | Share of sampled answers that recommend you |
| **First position** | How often are we the first recommendation? | Share of sampled answers that recommend you first |

Every rate shares one denominator — **all sampled answers** — so the stages are directly comparable and can only shrink as you go down.

## Definitions

Precise definitions are the whole point. Two teams that use the word “visibility” differently will reach opposite conclusions from the same data.

### The prompt set and the sample

> [!DEFINITION]
> A **prompt set** is a fixed, versioned list of questions a potential buyer might ask an AI answer engine about your category. A **sample** is each prompt run several times, on each engine you care about, with every answer recorded in full.

Run every prompt more than once. In a study by SparkToro and Gumshoe, repeated runs of the same prompt almost never produced the same list of brands — the identical list appeared fewer than one time in a hundred.[^sparktoro] Single runs measure luck.

### Prompt coverage

Prompt coverage is the share of the questions that matter to your buyers that your prompt set represents. It is not computed from AI answers; it describes the quality of your measurement. A brand can score well on a narrow, flattering prompt set and badly on the questions buyers really ask.

Build the set from evidence of real questions — sales-call notes, support tickets, Search Console queries, the comparison questions prospects send you — and record where each prompt came from. Revisit it quarterly, and never change it silently: a changed prompt set breaks comparisons over time.

### Visibility

> [!DEFINITION]
> **Visibility rate** = answers that mention your brand ÷ all sampled answers.

A mention is any reference to your brand or product by name, whatever the context — including a negative one.

### Recommendation

> [!DEFINITION]
> **Recommendation rate** = answers that recommend your brand ÷ all sampled answers.

A recommendation is an answer that presents your brand as an option the reader should choose or consider for their need — not merely a mention. Write the rule down, with examples of borderline cases (“X is popular, but…”), before anyone classifies an answer.

### First position

> [!DEFINITION]
> **First-position rate** = answers in which your brand is the first recommendation ÷ all sampled answers.

“First” means the first brand recommended in the answer's text or list. Because positions shuffle from run to run, this is only meaningful as a rate over many answers — never as a rank you “hold”.[^sparktoro]

### Recommendation Conversion

> [!KEY]
> **Recommendation Conversion** = Recommendation rate ÷ Visibility rate — the share of the answers that mention you that also recommend you.

It is the funnel's diagnostic ratio: it separates a *visibility* problem (you are rarely mentioned) from a *preference* problem (you are mentioned but rarely recommended). A companion ratio, **First-position Conversion** = First-position rate ÷ Recommendation rate, does the same one stage lower.

## A worked example

> [!EXAMPLE]
> All numbers here are hypothetical, chosen to illustrate the arithmetic. They describe no real brand.

A company builds a prompt set of 40 buyer questions and runs each one 5 times on one answer engine: 200 answers.

- 90 answers mention the brand → **visibility 45%**
- 54 answers recommend it → **recommendation 27%**
- 18 answers recommend it first → **first position 9%**
- Recommendation Conversion = 27 ÷ 45 = **60%**; First-position Conversion = 9 ÷ 27 = **33%**

Now compare a competitor measured on the same prompts and runs: visibility 30%, recommendation 24%. Their Recommendation Conversion is 24 ÷ 30 = **80%**.

The first brand is mentioned more often; the competitor is *preferred* more often when it is mentioned. Those are different problems with different fixes, and a single “AI visibility score” would have hidden the difference.

## Reading the diagnosis

| What you see | What it suggests | Hypotheses to test |
|---|---|---|
| Low visibility | The engines rarely draw on sources that name you | Are your pages crawlable and indexed? Do the third-party sources the engines cite mention you? |
| High visibility, low Recommendation Conversion | You are known but not preferred | Do sources describe what you are best for, and for whom? Is your positioning consistent across the web? |
| High Recommendation Conversion, low First-position Conversion | You are a contender but rarely the default | What do the first-named brands have that answers cite — comparisons, reviews, specific evidence? |

These are hypotheses, not prescriptions. The funnel tells you *where* to look; it cannot tell you *why*. Test one change at a time and measure again on the same prompt set.

## How to run the measurement

> [!METHOD]
> 1. **Fix the prompt set** (30–100 prompts is a practical start) and version it.
> 2. **Choose engines and settings** and record them: product, mode, logged-in or not, location, date.
> 3. **Sample** each prompt at least 5 times per engine; store every answer verbatim.
> 4. **Classify** each answer — mention, recommendation, first recommendation — with written rules.
> 5. **Double-code** a random 10–20% of answers with a second person and check that you agree; fix the rules where you don't.
> 6. **Report rates with their uncertainty**, and keep the raw answers so anyone can audit the numbers.

### How much to trust a rate

A rate from a sample has a margin of error. A common approximation for a 95% interval around a rate *p* measured on *n* answers is:

`margin ≈ 1.96 × √( p × (1 − p) ÷ n )`

For the example's visibility of 45% on 200 answers, that is about **±7 percentage points** — so a move from 45% to 48% next month is not evidence of anything. Two cautions make the real uncertainty larger still: repeated runs of the same prompt are not independent of each other, and ratios such as Recommendation Conversion inherit the uncertainty of both their parts. More *prompts* reduce uncertainty more reliably than more runs of the same few.

## Limitations

Use the funnel with its limits in view:

- **It is unvalidated.** We have not shown that improving these rates improves pipeline or revenue. Treat it as a structured way to look, not a proven predictor.
- **Classification is judgement.** Whether an answer “recommends” you depends on rules people write and apply; that is why the method insists on written rules and double-coding.
- **Answers depend on context you don't control:** product, mode, model version, location, account history and phrasing. Google, for instance, notes that its AI features may run several related searches and that the responses and links they show will vary.[^google]
- **It ignores what is said.** A mention can be wrong or unflattering; the funnel counts it all the same. Read the answers, not just the rates.
- **It is not comparable across vendors.** Tools that report “AI visibility” use their own prompt sets and definitions. Research on generative engines defines visibility differently again — the original GEO paper measured how much of an answer drew on a source, not whether a brand was named.[^geo] Compare numbers only when the method is the same.

## What the funnel is not

It is not a ranking, a guarantee or a growth plan. It is a way to ask a better question than “are we in ChatGPT?” — *of the questions our buyers ask, how often are we mentioned, how often are we recommended, and how often are we the first choice?* — and to answer it with numbers you can defend.

## Where Ensemblis fits

Ensemblis does not run AI-visibility measurements. It is built on the same discipline this framework asks for: defined criteria before the work starts, numbered evidence for every claim, and a verification step that says what was and wasn't established. If you want that standard applied to your research and analysis, [see how Ensemblis works](/how-it-works).

[^sparktoro]: Coverage of the SparkToro and Gumshoe study on the consistency of AI brand recommendations, [Search Engine Journal](https://www.searchenginejournal.com/ai-recommendations-change-with-nearly-every-query-sparktoro/566242/). Not peer-reviewed; Gumshoe sells AI-visibility tracking.
[^google]: Google Search Central, [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features).
[^geo]: Aggarwal, P. et al. *GEO: Generative Engine Optimization.* KDD 2024. [arXiv:2311.09735](https://arxiv.org/abs/2311.09735).
