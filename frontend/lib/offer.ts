// What Ensemblis does today and what it costs — the single source for /use-cases, /pricing and the homepage.
// Mirrors backend/src/org/registry.ts (names, descriptions, deliverables, costs) and engine/budget.ts (plans
// have 3–7 steps: one planning step, 1–5 work steps, one synthesis step, plus the verification fee).
// lib/offer.spec.ts fails CI if this drifts from the backend, so the public pricing can't silently go stale.

export type Team = "chief_of_staff" | "marketing" | "sales" | "finance" | "operations";

export interface Capability {
  key: string;
  name: string;
  team: Team;
  kind: "framing" | "synthesis" | "research" | "analysis";
  costCredits: number;
  description: string;
  /** Sections the output must contain (the verifier checks for them). */
  deliverable: string[];
  /** Searches the public web for evidence (else it works from your documents and Company Context). */
  web: boolean;
}

export const CAPABILITIES: Capability[] = [
  { key: "objective_framing", name: "Objective Planning", team: "chief_of_staff", kind: "framing", costCredits: 100, web: false, description: "Frames the objective against the company's context: what is being decided, for whom, under which constraints.", deliverable: ["Objective framing", "Relevant company context", "Assumptions", "Evaluation lens for the team"] },
  { key: "cross_functional_synthesis", name: "Cross-functional Synthesis", team: "chief_of_staff", kind: "synthesis", costCredits: 300, web: false, description: "Integrates the team's work into one decision-ready result that answers the objective and each success criterion.", deliverable: ["Executive summary", "Findings", "Recommendation", "Success criteria", "Limitations & uncertainty", "Next steps"] },
  { key: "business_research", name: "Business Research", team: "chief_of_staff", kind: "research", costCredits: 300, web: true, description: "Researches an open business question from external sources: regulation, trends, adoption, policy or an industry overview.", deliverable: ["Research questions", "Cited findings", "Evidence gaps", "Open questions"] },
  { key: "market_research", name: "Market Research", team: "marketing", kind: "research", costCredits: 300, web: true, description: "Researches markets, segments, size, growth, demand drivers and regulation.", deliverable: ["Markets in scope", "Market facts (cited)", "Comparison table", "Gaps in the evidence"] },
  { key: "competitor_analysis", name: "Competitor Analysis", team: "marketing", kind: "research", costCredits: 300, web: true, description: "Maps competitors, their offers, pricing signals, positioning and strengths/weaknesses.", deliverable: ["Competitor set", "Competitor comparison table", "Openings and threats"] },
  { key: "icp_analysis", name: "Customer / ICP Analysis", team: "marketing", kind: "analysis", costCredits: 250, web: true, description: "Defines and tests the ideal customer profile, buyer roles, needs and buying triggers.", deliverable: ["ICP definition", "Segments ranked", "Buyer roles and triggers"] },
  { key: "positioning_analysis", name: "Positioning Analysis", team: "marketing", kind: "analysis", costCredits: 250, web: true, description: "Assesses positioning and messaging against customers and competitors.", deliverable: ["Current positioning", "Gaps", "Positioning options"] },
  { key: "account_research", name: "Account Research", team: "sales", kind: "research", costCredits: 300, web: true, description: "Researches target accounts: business, priorities, recent events and likely needs.", deliverable: ["Account profiles", "Likely needs", "Conversation angles"] },
  { key: "lead_research", name: "Lead Research", team: "sales", kind: "research", costCredits: 300, web: true, description: "Identifies organizations that match the ICP and explains why each fits.", deliverable: ["Search criteria", "Lead list with fit rationale", "What to confirm before outreach"] },
  { key: "opportunity_analysis", name: "Sales Opportunity Analysis", team: "sales", kind: "analysis", costCredits: 250, web: true, description: "Evaluates revenue opportunities, go-to-market motions and their requirements.", deliverable: ["Opportunities", "Assessment table", "Recommended motion"] },
  { key: "financial_analysis", name: "Financial Analysis", team: "finance", kind: "analysis", costCredits: 250, web: true, description: "Analyses financial performance, drivers, variances and financial implications of a decision.", deliverable: ["Key figures", "Drivers and variances", "Financial implications"] },
  { key: "scenario_analysis", name: "Scenario Analysis", team: "finance", kind: "analysis", costCredits: 250, web: false, description: "Builds base/upside/downside scenarios with explicit assumptions.", deliverable: ["Scenarios and assumptions", "Outcomes table", "Sensitivities"] },
  { key: "unit_economics", name: "Unit Economics", team: "finance", kind: "analysis", costCredits: 250, web: true, description: "Analyses CAC, LTV, payback, contribution margin and pricing implications.", deliverable: ["Unit metrics", "Benchmarks", "Improvement levers"] },
  { key: "process_analysis", name: "Process Analysis", team: "operations", kind: "analysis", costCredits: 250, web: false, description: "Maps a process, its owners, bottlenecks and failure points.", deliverable: ["Process map", "Bottlenecks", "Improvements"] },
  { key: "operational_research", name: "Operational Research", team: "operations", kind: "research", costCredits: 300, web: true, description: "Researches vendors, tools, practices and operational benchmarks.", deliverable: ["Options", "Comparison table", "Validation checklist"] },
  { key: "workflow_analysis", name: "Workflow Analysis", team: "operations", kind: "analysis", costCredits: 250, web: false, description: "Designs a target workflow or runbook with owners, controls and metrics.", deliverable: ["Target workflow", "Controls and metrics", "Implementation needs"] },
];

/** The verification gate's fee per execution (backend VERIFICATION_COST_CENTS). */
export const VERIFICATION_CREDITS = 150;
/** Work steps per plan: plans have 3–7 steps = planning + 1–5 work steps + synthesis. */
export const WORK_STEPS = { min: 1, max: 5 } as const;
/** 100 credits = €1 of list value (backend CREDITS_PER_EUR). Beta credits have no monetary value. */
export const CREDITS_PER_EUR = 100;

const costOf = (kind: Capability["kind"]) => CAPABILITIES.filter((c) => c.kind === kind).map((c) => c.costCredits);
const work = CAPABILITIES.filter((c) => c.kind === "research" || c.kind === "analysis").map((c) => c.costCredits);

/** The cheapest and the most expensive plan the planner can produce, verification included. */
export const PLAN_COST = {
  min: Math.min(...costOf("framing")) + WORK_STEPS.min * Math.min(...work) + Math.min(...costOf("synthesis")) + VERIFICATION_CREDITS,
  max: Math.max(...costOf("framing")) + WORK_STEPS.max * Math.max(...work) + Math.max(...costOf("synthesis")) + VERIFICATION_CREDITS,
};

/** Price ranges per kind of step, for prose ("research and analysis steps cost 250–300 credits"). */
export const STEP_PRICES = {
  planning: Math.max(...costOf("framing")),
  synthesis: Math.max(...costOf("synthesis")),
  work: { min: Math.min(...work), max: Math.max(...work) },
};

/** The worked example used on the homepage and pricing page: a five-step plan with the evidence each step found. */
export const EXAMPLE_PLAN: { key: string; evidence: number[] }[] = [
  { key: "objective_framing", evidence: [] },
  { key: "market_research", evidence: [1, 2, 3] },
  { key: "competitor_analysis", evidence: [4, 5] },
  { key: "financial_analysis", evidence: [6] },
  { key: "cross_functional_synthesis", evidence: [] },
];
export const EXAMPLE_PLAN_TOTAL =
  EXAMPLE_PLAN.reduce((n, s) => n + (CAPABILITIES.find((c) => c.key === s.key)?.costCredits ?? 0), 0) + VERIFICATION_CREDITS;

export const TEAM_NAMES: Record<Team, string> = {
  chief_of_staff: "Chief of Staff",
  marketing: "Marketing",
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
};

export interface UseCase {
  id: string;
  team: Exclude<Team, "chief_of_staff">;
  title: string;
  /** Who usually asks for this. */
  for: string;
  intro: string;
  /** Example objectives — examples, not customer results. */
  examples: { objective: string; criteria: string[] }[];
}

export const USE_CASES: UseCase[] = [
  {
    id: "marketing",
    team: "marketing",
    title: "Market, competitor and customer research",
    for: "Founders, marketing leads and product managers deciding where to compete and how to position.",
    intro: "Size and compare markets, map competitors' offers and pricing signals, sharpen your ideal customer profile and test your positioning — every fact numbered and cited.",
    examples: [
      { objective: "Analyse the European market for our product and recommend the three highest-potential markets for expansion next year.", criteria: ["Recommend 3 markets, ranked with a rationale", "Each recommendation is supported by cited evidence", "Entry risks are stated for each market"] },
      { objective: "Map our 10 most relevant competitors and show where we can win against each of them.", criteria: ["Cover 10 competitors", "A comparison table of offers, pricing signals and positioning", "One clear opening per competitor"] },
    ],
  },
  {
    id: "sales",
    team: "sales",
    title: "Account and pipeline research",
    for: "Founders and sales teams preparing outreach or reviewing where revenue will come from.",
    intro: "Research target accounts and their priorities, build lead lists that match your ideal customer profile with a reason for each, and assess which opportunities and motions deserve your time.",
    examples: [
      { objective: "Research our five priority accounts and give us a conversation angle for each before next week's outreach.", criteria: ["A profile per account with recent events, cited", "Likely needs tied to our offer", "One conversation angle per account"] },
      { objective: "Rank the sales opportunities most likely to close this quarter and what would move each one forward.", criteria: ["Opportunities ranked by likelihood", "A next action for each", "Risks to the forecast are stated"] },
    ],
  },
  {
    id: "finance",
    team: "finance",
    title: "Financial analysis, scenarios and unit economics",
    for: "Founders and finance leads preparing a decision, a plan or a pricing change.",
    intro: "Work from your own figures (uploaded documents and Company Context) to analyse drivers, build base, upside and downside scenarios with explicit assumptions, and find the levers in your unit economics.",
    examples: [
      { objective: "Review our unit economics and identify the three levers that would most improve payback time.", criteria: ["Current CAC, LTV and payback are shown with formulas", "3 levers, ranked by impact", "Assumptions are labelled"] },
      { objective: "Model base, upside and downside scenarios for raising our prices by 15% next quarter.", criteria: ["Three scenarios with explicit assumptions", "Revenue and margin impact for each", "The assumptions the result is most sensitive to"] },
    ],
  },
  {
    id: "operations",
    team: "operations",
    title: "Process, workflow and vendor research",
    for: "Operations leads and founders fixing a bottleneck or choosing a tool or supplier.",
    intro: "Map a process and its failure points, design a better workflow with owners and metrics, or compare vendors and practices with a checklist of what to validate before you commit.",
    examples: [
      { objective: "Map our customer onboarding process, find the main bottlenecks and propose a better workflow.", criteria: ["Current process mapped with owners", "Top bottlenecks identified", "A target workflow with metrics"] },
      { objective: "Compare four help-desk tools for a 10-person support team and recommend one.", criteria: ["A comparison table of features and pricing signals", "A recommendation with its trade-offs", "What to validate in a trial"] },
    ],
  },
];

export const capabilitiesFor = (team: Team) => CAPABILITIES.filter((c) => c.team === team);
