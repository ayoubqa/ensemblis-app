// Task classification and team planning — the server-side port of the
// prototype's `classify`, `titleFor`, `reqCaps`, `teamFor`, `price` and
// `estTime` (frontend/design/prototype.html).
//
// This module is pure (no database access) so it can be unit-checked with
// `npx tsx scripts/sanity-classify.ts`. The caller passes the list of live
// agents; see estimate.ts for the DB-backed wrapper.

import { PIPELINE } from "../catalog/agents";

export type Depth = "focused" | "standard" | "deep";

export const DEPTH: Record<Depth, { multiplier: number; label: string }> = {
  focused: { multiplier: 0.75, label: "Focused" },
  standard: { multiplier: 1, label: "Standard" },
  deep: { multiplier: 1.5, label: "Deep" },
};

/** The minimum an agent needs for routing. Prisma's Agent row satisfies this. */
export interface ClassifierAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  specialty: string;
  taskType: string;
  pricePerTaskCents: number;
  estMinutesLow: number;
  estMinutesHigh: number;
  rating: number;
  successRate: number;
}

export type StepRole = "Research" | "Analysis" | "Verification" | "Report";

export interface PlannedStep<A> {
  agent: A;
  role: StepRole;
  title: string;
}

export interface Classification<A> {
  title: string;
  category: string;
  depth: Depth;
  leadAgent: A;
  alternatives: A[];
  team: PlannedStep<A>[];
  capabilities: string[];
  costCents: number;
  estMinutesLow: number;
  estMinutesHigh: number;
  manualHoursEstimate: number;
}

// Keyword routing, in priority order (first match wins) — mirrors the
// prototype's `classify`, with a few extra rules for agents it never routed to.
const RULES: { re: RegExp; agent: string; multi?: boolean }[] = [
  { re: /market.entry|go.to.market|expansion strategy|enter(ing)? the .* market/, agent: "Enterprise Intelligence Agent", multi: true },
  { re: /market research|market siz|size the market|size of the market|\btam\b|demand for|segment(s|ation)? (of|in) the/, agent: "Market Research Agent" },
  { re: /code review|review (our|my|the) (code|codebase|repo)|codebase|\brepo\b|repository|pull request|security (review|audit)|vulnerab|refactor|technical debt/, agent: "Code Review Agent" },
  { re: /\bmonitor|\btrack (competitor|brand|mention|pric)|mentions\b|digest/, agent: "Competitor Monitor" },
  { re: /competit|rival/, agent: "Competitive Intelligence Agent" },
  { re: /account (brief|research|plan)|stakeholder map|buying signal|before (the|my|our) (call|meeting)/, agent: "Sales Research Agent" },
  { re: /\bleads?\b|prospect|\bicp\b|outbound list/, agent: "Lead Research Agent" },
  // Campaign/content before finance: "a campaign with a €40k budget" is marketing work.
  { re: /campaign|content (plan|strategy|calendar)|\bcontent\b|blog|newsletter|social media|launch plan|marketing plan/, agent: "Content Strategist" },
  { re: /financ|revenue|churn|budget|cash ?flow|\bcash\b|p&l|profit|margin|forecast|burn|runway|balance sheet|ebitda/, agent: "Financial Analyst" },
  { re: /\bseo\b|\baio\b|search rank|visibility|organic traffic|keywords?/, agent: "SEO/AIO Analyst" },
  { re: /legal|contract|regulat|compliance|gdpr|statute|case law|lawsuit|licen[cs]e terms/, agent: "Legal Research Assistant" },
  { re: /process|operations|workflow|vendor|onboarding|invoice|procurement|runbook|automat/, agent: "Operations Automation Agent" },
  { re: /\bdeck\b|slides|presentation|pitch/, agent: "Presentation Builder" },
  { re: /dataset|\bcsv\b|spreadsheet|data analy|analy[sz]e (the|our|my) data|statistic|dashboard/, agent: "Data Analysis Agent" },
  { re: /support|ticket|customer (complaint|email|inquir)/, agent: "Customer Support Agent" },
  { re: /user research|feedback|interview|reviews|product (research|opportunit|roadmap)|feature/, agent: "Product Research Agent" },
  { re: /research|summari[sz]|brief|overview|landscape/, agent: "Research Analyst" },
];
const DEFAULT_LEAD = "Research Analyst";

// How long a competent human would take for a standard-depth version, in hours.
const MANUAL_HOURS: Record<string, number> = {
  "Competitive Intelligence Agent": 16,
  "Lead Research Agent": 20,
  "Financial Analyst": 12,
  "Content Strategist": 10,
  "Sales Research Agent": 4,
  "Customer Support Agent": 3,
  "Data Analysis Agent": 10,
  "Competitor Monitor": 4,
  "Product Research Agent": 14,
  "SEO/AIO Analyst": 10,
  "Legal Research Assistant": 12,
  "Presentation Builder": 6,
  "Research Analyst": 6,
  "Enterprise Intelligence Agent": 24,
  "Code Review Agent": 8,
  "Operations Automation Agent": 12,
  "Research Agent": 5,
  "Verification Agent": 2,
  "Report Agent": 3,
  "Market Research Agent": 14,
};

// Curated "also a good fit" peers (prototype `alts`), shown before fuzzy matches.
const RELATED: Record<string, string[]> = {
  "Competitive Intelligence Agent": ["Research Analyst", "Enterprise Intelligence Agent", "Competitor Monitor"],
  "Lead Research Agent": ["Sales Research Agent", "Market Research Agent"],
  "Financial Analyst": ["Data Analysis Agent", "Enterprise Intelligence Agent"],
  "Content Strategist": ["SEO/AIO Analyst", "Presentation Builder", "Product Research Agent"],
  "Sales Research Agent": ["Lead Research Agent", "Competitive Intelligence Agent"],
  "Customer Support Agent": ["Operations Automation Agent", "Product Research Agent"],
  "Data Analysis Agent": ["Financial Analyst", "Research Analyst"],
  "Competitor Monitor": ["Competitive Intelligence Agent", "SEO/AIO Analyst"],
  "Product Research Agent": ["Data Analysis Agent", "Market Research Agent"],
  "SEO/AIO Analyst": ["Content Strategist", "Competitor Monitor"],
  "Legal Research Assistant": ["Research Analyst", "Operations Automation Agent"],
  "Presentation Builder": ["Content Strategist", "Research Analyst"],
  "Research Analyst": ["Market Research Agent", "Competitive Intelligence Agent", "Enterprise Intelligence Agent"],
  "Enterprise Intelligence Agent": ["Market Research Agent", "Competitive Intelligence Agent", "Research Analyst"],
  "Code Review Agent": ["Operations Automation Agent", "Data Analysis Agent"],
  "Operations Automation Agent": ["Code Review Agent", "Customer Support Agent"],
  "Market Research Agent": ["Enterprise Intelligence Agent", "Research Analyst", "Competitive Intelligence Agent"],
};

const MULTI_BASE_CENTS = 4200; // prototype: multi-stage strategy work starts at €42
const MIN_COST_CENTS = 500; // €5
const MAX_COST_CENTS = 8000; // €80

export function titleFor(text: string): string {
  // Answers to clarifying questions (appended by /new as "\n\nClarifications:\n- Q: … A: …")
  // belong to the brief, not the title.
  const cleaned = text
    .split(/\n\s*Clarifications:\n/)[0]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(hi|hello|hey)[,!.]?\s+/i, "")
    .replace(/^(i need|i want|i'd like|i would like|we need|we want|please|can you|could you|help me|help us)( to)?\s+/i, "")
    .replace(/^(build|create|make|write|give|prepare|draft) (me|us)\s+/i, "$1 ")
    .replace(/^(a|an)\s+/i, "")
    .replace(/[.!?]+$/, "");
  const short = cleaned.length > 64 ? cleaned.slice(0, 62).replace(/\s+\S*$/, "") + "…" : cleaned;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : "New task";
}

// Words too generic to signal fit between a brief and an agent profile.
const STOPWORDS = new Set(
  "with from that this these those your their them they what which when where into over about than then also have need want would could should please make build create find give write prepare draft help plan plans review reviews analysis analyze analyse analyzes research report reports data based across using more most best each other some very much many work done".split(" ")
);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9&]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );

/**
 * Relevance of an agent to a description (and optionally to the chosen lead).
 * 0 means "no evidence of fit"; quality (rating/success) only breaks ties.
 */
function relevance(text: string, a: ClassifierAgent, lead?: ClassifierAgent): number {
  const want = tokens(text);
  const have = tokens([a.name, a.description, a.specialty, a.taskType, ...a.capabilities].join(" "));
  let score = 0;
  want.forEach((w) => {
    if (have.has(w)) score += 3;
  });
  if (lead) {
    if (a.category === lead.category) score += 4;
    if (a.taskType === lead.taskType) score += 4;
    score += a.capabilities.filter((c) => lead.capabilities.includes(c)).length * 2;
  }
  return score;
}
const quality = (a: ClassifierAgent) => a.rating + a.successRate / 100;

const PIPELINE_NAMES = new Set<string>([PIPELINE.research, PIPELINE.verification, PIPELINE.report]);

export function classifyTask<A extends ClassifierAgent>(
  description: string,
  agents: A[],
  opts: { depth?: Depth; agentId?: string } = {}
): Classification<A> {
  if (agents.length === 0) throw new Error("No live agents available");
  const depth: Depth = opts.depth ?? "standard";
  const text = description.toLowerCase();
  const byName = new Map(agents.map((a) => [a.name, a]));

  // 1. Lead agent
  let lead: A | undefined;
  let multi = false;
  if (opts.agentId) {
    lead = agents.find((a) => a.id === opts.agentId);
    if (!lead) throw new Error("Agent not found");
  } else {
    const rule = RULES.find((r) => r.re.test(text) && byName.has(r.agent));
    if (rule) {
      lead = byName.get(rule.agent);
      multi = !!rule.multi;
    } else {
      // No keyword hit: the general researcher, else the best fuzzy match
      // among non-pipeline agents.
      lead =
        byName.get(DEFAULT_LEAD) ??
        [...agents]
          .filter((a) => !PIPELINE_NAMES.has(a.name))
          .sort((x, y) => relevance(description, y) - relevance(description, x) || quality(y) - quality(x))[0] ??
        agents[0];
    }
  }
  const leadAgent = lead!;

  // 2. Team, by depth. The lead is always the specialist step; pipeline agents
  // that are missing from the DB are skipped; duplicates are removed.
  const research = byName.get(PIPELINE.research);
  const verification = byName.get(PIPELINE.verification);
  const report = byName.get(PIPELINE.report);
  const specialistTitle = `Lead the analysis: ${leadAgent.specialty || leadAgent.taskType || leadAgent.name}`;
  const plan: { agent: A | undefined; role: StepRole; title: string }[] = [];
  if (depth !== "focused") plan.push({ agent: research, role: "Research", title: "Collect sources and structure the facts" });
  plan.push({ agent: leadAgent, role: "Analysis", title: specialistTitle });
  if (depth === "deep") plan.push({ agent: verification, role: "Verification", title: "Check claims and flag anything unsupported" });
  plan.push({ agent: report, role: "Report", title: "Produce the final deliverable" });

  const team: PlannedStep<A>[] = [];
  const leadIsReport = report && leadAgent.id === report.id;
  for (const step of plan) {
    if (!step.agent) continue;
    if (step.role !== "Analysis" && step.agent.id === leadAgent.id && !(leadIsReport && step.role === "Report")) continue;
    if (step.role === "Analysis" && leadIsReport) continue; // the Report step covers it
    team.push({ agent: step.agent, role: step.role, title: step.title });
  }
  if (team.length === 0) team.push({ agent: leadAgent, role: "Report", title: "Produce the final deliverable" });

  // 3. Alternatives: up to 3 other good-fit specialists (never the pipeline agents).
  const curated = (RELATED[leadAgent.name] ?? [])
    .map((n) => byName.get(n))
    .filter((a): a is A => !!a && a.id !== leadAgent.id);
  const fuzzy = [...agents]
    .filter((a) => a.id !== leadAgent.id && !PIPELINE_NAMES.has(a.name) && !curated.includes(a))
    .map((a) => ({ a, s: relevance(description, a, leadAgent) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || quality(y.a) - quality(x.a))
    .map((x) => x.a);
  const alternatives = [...curated, ...fuzzy].slice(0, 3);

  // 4. Required capabilities (prototype `reqCaps`, depth-aware).
  let capabilities: string[];
  if (multi) {
    capabilities = ["Market research", "Data analysis", "Strategy design", "Source verification", "Report generation"];
  } else if (leadAgent.name === "Competitive Intelligence Agent") {
    capabilities = ["Web research", "Company research", "Data extraction", "Competitive analysis", "Source verification", "Report generation"];
  } else {
    capabilities = [...leadAgent.capabilities];
    if (depth !== "focused") capabilities.push("Source collection");
    capabilities.push("Source verification", "Report generation");
  }
  capabilities = [...new Set(capabilities)].slice(0, 6);

  // 5. Price (prototype `price`): lead's typical price (or the multi-stage
  // base) × depth multiplier, rounded to whole euros, clamped to €5–€80.
  const m = DEPTH[depth].multiplier;
  const base = multi ? Math.max(MULTI_BASE_CENTS, leadAgent.pricePerTaskCents) : leadAgent.pricePerTaskCents;
  const costCents = Math.min(MAX_COST_CENTS, Math.max(MIN_COST_CENTS, Math.round((base * m) / 100) * 100));

  // 6. Time (prototype `estTime`): lead's range scaled by depth.
  const baseLow = multi ? Math.max(15, leadAgent.estMinutesLow) : leadAgent.estMinutesLow;
  const baseHigh = multi ? Math.max(25, leadAgent.estMinutesHigh) : leadAgent.estMinutesHigh;
  const estMinutesLow = Math.max(2, Math.round(baseLow * m));
  const estMinutesHigh = Math.max(estMinutesLow + 1, Math.round(baseHigh * m));

  const manualBase = multi ? 32 : MANUAL_HOURS[leadAgent.name] ?? Math.max(4, Math.round(leadAgent.estMinutesHigh / 2));
  const manualHoursEstimate = Math.max(1, Math.round(manualBase * m));

  return {
    title: titleFor(description),
    category: multi ? "Strategy & Planning" : leadAgent.taskType || leadAgent.category,
    depth,
    leadAgent,
    alternatives,
    team,
    capabilities,
    costCents,
    estMinutesLow,
    estMinutesHigh,
    manualHoursEstimate,
  };
}
