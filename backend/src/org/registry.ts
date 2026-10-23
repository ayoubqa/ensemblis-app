// The AI Team: executives, the capabilities (playbooks) they own, and the
// specialist agent that implements each capability.
//
//   Chief of Staff
//   ├── Head of Marketing  → Market Research, Competitor Analysis, Customer/ICP, Positioning
//   ├── Head of Sales      → Account Research, Lead Research, Sales Opportunity Analysis
//   ├── Head of Finance    → Financial Analysis, Scenario Analysis, Unit Economics
//   └── Head of Operations → Process Analysis, Operational Research, Workflow Analysis
//
// This registry is code: every change goes through code review, and each
// capability carries a version that is stored on every execution step that
// used it. Unreviewed prompts (e.g. legacy marketplace agents in the database)
// are never used as execution logic.
//
// The structure leaves room for Executive → Department → Capability →
// Specialist → Tool: `department` is already recorded, and tools are bound per
// capability (the planner cannot grant tools).

import type { ToolKey } from "./tools";

export const REGISTRY_VERSION = "2026.10.1";

export type ExecutiveKey = "chief_of_staff" | "marketing" | "sales" | "finance" | "operations";
export type CapabilityKind = "framing" | "research" | "analysis" | "synthesis";

export interface Executive {
  key: ExecutiveKey;
  title: string;
  department: string;
  reportsTo: ExecutiveKey | null;
  mandate: string;
}

export interface Capability {
  key: string;
  name: string;
  executive: ExecutiveKey;
  version: string;
  kind: CapabilityKind;
  /** The specialist agent that implements this capability. */
  specialist: string;
  description: string;
  /** The methodology the specialist follows (part of its instructions). */
  methodology: string[];
  /** Sections the output must contain. */
  deliverable: string[];
  /** Tools bound to this capability. The planner cannot add tools. */
  tools: ToolKey[];
  /** What the verifier pays attention to for this capability's work. */
  verificationFocus: string[];
  /** Price of running this step (EUR cents), charged as part of the execution. */
  costCents: number;
  /** Used only by the deterministic fallback planner. */
  keywords: string[];
}

export const EXECUTIVES: Executive[] = [
  {
    key: "chief_of_staff",
    title: "Chief of Staff",
    department: "Office of the Chief of Staff",
    reportsTo: null,
    mandate: "Turns a business objective into a plan, assigns the work across the AI Team, and delivers one verified result.",
  },
  {
    key: "marketing",
    title: "Head of Marketing",
    department: "Marketing",
    reportsTo: "chief_of_staff",
    mandate: "Markets, competitors, customers and positioning.",
  },
  {
    key: "sales",
    title: "Head of Sales",
    department: "Sales",
    reportsTo: "chief_of_staff",
    mandate: "Accounts, leads and revenue opportunities.",
  },
  {
    key: "finance",
    title: "Head of Finance",
    department: "Finance",
    reportsTo: "chief_of_staff",
    mandate: "Financial performance, scenarios and unit economics.",
  },
  {
    key: "operations",
    title: "Head of Operations",
    department: "Operations",
    reportsTo: "chief_of_staff",
    mandate: "Processes, operational research and workflows.",
  },
];

const V1 = "1.0.0";

export const CAPABILITIES: Capability[] = [
  // ------------------------------------------------------------ Chief of Staff
  {
    key: "objective_framing",
    name: "Objective Planning",
    executive: "chief_of_staff",
    version: V1,
    kind: "framing",
    specialist: "Planning Analyst",
    description: "Frames the objective against the company's context: what is being decided, for whom, under which constraints.",
    methodology: [
      "Restate the objective as the business decision or result it serves.",
      "Extract only the company context that matters for this objective (product, customers/ICP, markets, constraints, goals).",
      "List the assumptions the team is working with and mark which ones need confirmation.",
      "Define the evaluation lens: the factors the rest of the team must assess, tied to the success criteria.",
    ],
    deliverable: ["Objective framing", "Relevant company context", "Assumptions", "Evaluation lens for the team"],
    tools: ["company_context", "memory", "documents", "website"],
    verificationFocus: ["Context is drawn from the company profile, not invented", "Assumptions are explicit"],
    costCents: 100,
    keywords: [],
  },
  {
    key: "cross_functional_synthesis",
    name: "Cross-functional Synthesis",
    executive: "chief_of_staff",
    version: V1,
    kind: "synthesis",
    specialist: "Synthesis Lead",
    description: "Integrates the team's work into one decision-ready result that answers the objective and each success criterion.",
    methodology: [
      "Answer the objective directly in the executive summary.",
      "Integrate the findings from every step; resolve or flag contradictions between them.",
      "Make a clear recommendation and show how it meets each success criterion.",
      "Keep every citation [n] next to the claim it supports; never add new facts without evidence.",
      "State limitations, uncertainty and what a person should verify before acting.",
    ],
    deliverable: ["Executive summary", "Findings", "Recommendation", "Success criteria", "Limitations & uncertainty", "Next steps"],
    tools: ["company_context", "memory"],
    verificationFocus: ["Answers the objective", "Covers every success criterion", "Claims carry citations"],
    costCents: 300,
    keywords: [],
  },
  // ------------------------------------------------------------ Marketing
  {
    key: "market_research",
    name: "Market Research",
    executive: "marketing",
    version: V1,
    kind: "research",
    specialist: "Market Research Analyst",
    description: "Researches markets, segments, size, growth, demand drivers and regulation.",
    methodology: [
      "Identify the candidate markets or segments in scope.",
      "Collect size, growth, demand drivers, regulation and buyer landscape for each, citing evidence [n].",
      "Separate sourced facts from estimates; mark estimates and how they were derived.",
      "Summarise attractiveness signals per market in a comparison table.",
    ],
    deliverable: ["Markets in scope", "Market facts (cited)", "Comparison table", "Gaps in the evidence"],
    tools: ["web_research", "documents", "company_context"],
    verificationFocus: ["Figures are cited or marked as estimates", "Each market in scope is covered"],
    costCents: 300,
    keywords: ["market", "markets", "expansion", "segment", "demand", "size", "tam", "country", "countries", "region", "europe", "entry"],
  },
  {
    key: "competitor_analysis",
    name: "Competitor Analysis",
    executive: "marketing",
    version: V1,
    kind: "research",
    specialist: "Competitive Intelligence Analyst",
    description: "Maps competitors, their offers, pricing signals, positioning and strengths/weaknesses.",
    methodology: [
      "Identify the relevant competitors (direct, adjacent, substitutes).",
      "For each: offer, target customer, positioning, pricing signals, strengths and weaknesses — cited [n].",
      "Compare them against the company's own position.",
      "Highlight openings and threats that matter for the objective.",
    ],
    deliverable: ["Competitor set", "Competitor comparison table", "Openings and threats"],
    tools: ["web_research", "documents", "company_context"],
    verificationFocus: ["Competitor facts are cited", "Comparison is consistent"],
    costCents: 300,
    keywords: ["competitor", "competitors", "competitive", "rival", "alternatives", "landscape"],
  },
  {
    key: "icp_analysis",
    name: "Customer / ICP Analysis",
    executive: "marketing",
    version: V1,
    kind: "analysis",
    specialist: "Customer Insights Analyst",
    description: "Defines and tests the ideal customer profile, buyer roles, needs and buying triggers.",
    methodology: [
      "Start from the company's stated customers/ICP and its evidence.",
      "Describe segments, buyer roles, jobs-to-be-done, pains and buying triggers.",
      "Rank segments by fit and accessibility, explaining the criteria.",
    ],
    deliverable: ["ICP definition", "Segments ranked", "Buyer roles and triggers"],
    tools: ["company_context", "documents", "web_research"],
    verificationFocus: ["ICP is consistent with company context", "Ranking criteria are explicit"],
    costCents: 250,
    keywords: ["icp", "customer", "customers", "persona", "buyer", "audience", "segment"],
  },
  {
    key: "positioning_analysis",
    name: "Positioning Analysis",
    executive: "marketing",
    version: V1,
    kind: "analysis",
    specialist: "Positioning Strategist",
    description: "Assesses positioning and messaging against customers and competitors.",
    methodology: [
      "Summarise the current positioning from the company context.",
      "Test it against customer needs and competitor claims.",
      "Propose positioning options with trade-offs.",
    ],
    deliverable: ["Current positioning", "Gaps", "Positioning options"],
    tools: ["company_context", "documents", "web_research"],
    verificationFocus: ["Options are tied to evidence about customers and competitors"],
    costCents: 250,
    keywords: ["positioning", "messaging", "brand", "value proposition", "differentiation"],
  },
  // ------------------------------------------------------------ Sales
  {
    key: "account_research",
    name: "Account Research",
    executive: "sales",
    version: V1,
    kind: "research",
    specialist: "Account Research Analyst",
    description: "Researches target accounts: business, priorities, recent events and likely needs.",
    methodology: [
      "Profile each account: business, scale, priorities and recent events — cited [n].",
      "Infer likely needs relevant to the company's offer; label inferences.",
      "Never invent people, emails or phone numbers.",
    ],
    deliverable: ["Account profiles", "Likely needs", "Conversation angles"],
    tools: ["web_research", "company_context"],
    verificationFocus: ["No invented contact details", "Account facts are cited"],
    costCents: 300,
    keywords: ["account", "accounts", "prospect", "meeting", "call", "stakeholder"],
  },
  {
    key: "lead_research",
    name: "Lead Research",
    executive: "sales",
    version: V1,
    kind: "research",
    specialist: "Lead Research Analyst",
    description: "Identifies organizations that match the ICP and explains why each fits.",
    methodology: [
      "Translate the ICP into searchable criteria.",
      "List matching organizations with the evidence of fit [n]; never invent personal contact details.",
      "Score fit and note what must be confirmed before outreach.",
    ],
    deliverable: ["Search criteria", "Lead list with fit rationale", "What to confirm before outreach"],
    tools: ["web_research", "company_context"],
    verificationFocus: ["Every lead has cited evidence of fit", "No invented contact details"],
    costCents: 300,
    keywords: ["lead", "leads", "prospects", "outbound", "pipeline"],
  },
  {
    key: "opportunity_analysis",
    name: "Sales Opportunity Analysis",
    executive: "sales",
    version: V1,
    kind: "analysis",
    specialist: "Sales Strategy Analyst",
    description: "Evaluates revenue opportunities, go-to-market motions and their requirements.",
    methodology: [
      "Describe the opportunity and the go-to-market motion it needs.",
      "Assess size, effort, time-to-revenue and risks, marking estimates.",
      "Compare options against the success criteria.",
    ],
    deliverable: ["Opportunities", "Assessment table", "Recommended motion"],
    tools: ["company_context", "documents", "web_research"],
    verificationFocus: ["Estimates are labelled", "Comparison uses consistent criteria"],
    costCents: 250,
    keywords: ["opportunity", "opportunities", "sales", "revenue", "go-to-market", "gtm", "channel", "partner"],
  },
  // ------------------------------------------------------------ Finance
  {
    key: "financial_analysis",
    name: "Financial Analysis",
    executive: "finance",
    version: V1,
    kind: "analysis",
    specialist: "Financial Analyst",
    description: "Analyses financial performance, drivers, variances and financial implications of a decision.",
    methodology: [
      "Use only figures from the company's documents or cited evidence; show calculations.",
      "Explain drivers and variances; separate facts from estimates.",
      "State the financial implications for the objective.",
    ],
    deliverable: ["Key figures", "Drivers and variances", "Financial implications"],
    tools: ["documents", "company_context", "web_research"],
    verificationFocus: ["Calculations are shown", "Figures are sourced"],
    costCents: 250,
    keywords: ["financial", "finance", "revenue", "budget", "cost", "costs", "margin", "profit", "cash", "forecast", "churn", "p&l"],
  },
  {
    key: "scenario_analysis",
    name: "Scenario Analysis",
    executive: "finance",
    version: V1,
    kind: "analysis",
    specialist: "Scenario Modeler",
    description: "Builds base/upside/downside scenarios with explicit assumptions.",
    methodology: [
      "Define the scenarios and their assumptions explicitly.",
      "Quantify outcomes with shown calculations; mark all assumptions as estimates.",
      "Identify the assumptions the decision is most sensitive to.",
    ],
    deliverable: ["Scenarios and assumptions", "Outcomes table", "Sensitivities"],
    tools: ["documents", "company_context"],
    verificationFocus: ["Assumptions are explicit", "Calculations are consistent"],
    costCents: 250,
    keywords: ["scenario", "scenarios", "sensitivity", "what if", "model"],
  },
  {
    key: "unit_economics",
    name: "Unit Economics",
    executive: "finance",
    version: V1,
    kind: "analysis",
    specialist: "Unit Economics Analyst",
    description: "Analyses CAC, LTV, payback, contribution margin and pricing implications.",
    methodology: [
      "Compute the unit metrics from provided data, showing formulas.",
      "Benchmark against cited evidence where available.",
      "Explain what would improve the unit economics.",
    ],
    deliverable: ["Unit metrics", "Benchmarks", "Improvement levers"],
    tools: ["documents", "company_context", "web_research"],
    verificationFocus: ["Formulas shown", "Benchmarks cited"],
    costCents: 250,
    keywords: ["unit economics", "cac", "ltv", "payback", "pricing", "contribution"],
  },
  // ------------------------------------------------------------ Operations
  {
    key: "process_analysis",
    name: "Process Analysis",
    executive: "operations",
    version: V1,
    kind: "analysis",
    specialist: "Process Analyst",
    description: "Maps a process, its owners, bottlenecks and failure points.",
    methodology: [
      "Map the process steps, owners, inputs and outputs from the provided material.",
      "Identify bottlenecks, failure points and handoff risks.",
      "Propose improvements with expected impact (marked as estimates).",
    ],
    deliverable: ["Process map", "Bottlenecks", "Improvements"],
    tools: ["documents", "company_context"],
    verificationFocus: ["Process map is grounded in provided material"],
    costCents: 250,
    keywords: ["process", "processes", "onboarding", "procurement", "handoff", "bottleneck", "sop"],
  },
  {
    key: "operational_research",
    name: "Operational Research",
    executive: "operations",
    version: V1,
    kind: "research",
    specialist: "Operations Researcher",
    description: "Researches vendors, tools, practices and operational benchmarks.",
    methodology: [
      "Identify the options (vendors, tools, practices) relevant to the objective.",
      "Compare them on cost, capability, risk and fit — cited [n].",
      "Flag what must be validated with the vendor or internally.",
    ],
    deliverable: ["Options", "Comparison table", "Validation checklist"],
    tools: ["web_research", "documents", "company_context"],
    verificationFocus: ["Vendor facts are cited"],
    costCents: 300,
    keywords: ["vendor", "vendors", "tool", "tools", "operations", "operational", "logistics", "supplier"],
  },
  {
    key: "workflow_analysis",
    name: "Workflow Analysis",
    executive: "operations",
    version: V1,
    kind: "analysis",
    specialist: "Workflow Analyst",
    description: "Designs a target workflow or runbook with owners, controls and metrics.",
    methodology: [
      "Describe the target workflow step by step with owners.",
      "Add controls, exception handling and metrics.",
      "List what is needed to implement it.",
    ],
    deliverable: ["Target workflow", "Controls and metrics", "Implementation needs"],
    tools: ["documents", "company_context"],
    verificationFocus: ["Every step has an owner", "Metrics are measurable"],
    costCents: 250,
    keywords: ["workflow", "runbook", "automation", "automate", "playbook"],
  },
];

/** Charged once per execution for the verification gate. */
export const VERIFICATION_COST_CENTS = 150;

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));
const EXEC_BY_KEY = new Map(EXECUTIVES.map((e) => [e.key, e]));

export function getCapability(key: string): Capability | undefined {
  return BY_KEY.get(key);
}

export function getExecutive(key: string): Executive | undefined {
  return EXEC_BY_KEY.get(key as ExecutiveKey);
}

export function capabilitiesOf(executive: ExecutiveKey): Capability[] {
  return CAPABILITIES.filter((c) => c.executive === executive);
}

export const FRAMING_CAPABILITY = "objective_framing";
export const SYNTHESIS_CAPABILITY = "cross_functional_synthesis";

export function isExecutiveKey(key: string): key is ExecutiveKey {
  return EXEC_BY_KEY.has(key as ExecutiveKey);
}
