// Static product copy. No metrics, no activity, no testimonials live here:
// everything numeric the UI shows comes from the API (lib/api.ts).

/** Example objectives a person can start from (they are suggestions, not past work). */
export const EXAMPLE_OBJECTIVES: { label: string; statement: string; criteria: string[] }[] = [
  {
    label: "European expansion",
    statement: "Analyze the European market for our product and recommend the three highest-potential markets for expansion next year.",
    criteria: ["Recommend 3 markets, ranked with a rationale", "Each recommendation is supported by cited evidence", "Entry risks are stated for each market"],
  },
  {
    label: "Competitor landscape",
    statement: "Map our 10 most relevant competitors and show where we can win against each of them.",
    criteria: ["Cover 10 competitors", "A comparison table of offers, pricing signals and positioning", "One clear opening per competitor"],
  },
  {
    label: "Pipeline briefing",
    statement: "Prepare a briefing on the sales opportunities most likely to close this quarter and what would move them forward.",
    criteria: ["Opportunities ranked by likelihood", "A next action for each", "Risks to the forecast are stated"],
  },
  {
    label: "Unit economics review",
    statement: "Review our unit economics and identify the three levers that would most improve payback time.",
    criteria: ["Current CAC, LTV and payback are shown with formulas", "3 levers, ranked by impact", "Assumptions are labelled"],
  },
  {
    label: "Process bottlenecks",
    statement: "Map our customer onboarding process, find the main bottlenecks and propose a better workflow.",
    criteria: ["Current process mapped with owners", "Top bottlenecks identified", "A target workflow with metrics"],
  },
];

/** The outcome loop, in the order Ensemblis runs it (landing page + empty states). */
export const LOOP: { key: string; title: string; body: string }[] = [
  { key: "objective", title: "Objective", body: "You describe the business result you need, how success is judged, a deadline and a budget." },
  { key: "plan", title: "Plan", body: "The Chief of Staff turns it into a short plan and assigns each step to the executive who owns that capability." },
  { key: "approve", title: "Approve", body: "You review the plan and the cost. Nothing runs or is charged before that — unless you allow it within a budget." },
  { key: "execute", title: "Execute", body: "Specialists research and analyse with read-only tools. Every source becomes numbered evidence." },
  { key: "verify", title: "Verify", body: "A verification gate checks claims against the evidence, coverage of each success criterion, completeness and consistency." },
  { key: "outcome", title: "Outcome", body: "You get the result, the evidence behind it, and whether each success criterion was met." },
];

export const FREQ_PER = { Weekly: "week", Monthly: "month", Quarterly: "quarter" } as const;

/** Only used as a fallback until /api/config answers. */
export const STARTING_CREDITS_CENTS = 0;
