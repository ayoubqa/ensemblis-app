// Static marketing / illustrative content, copied faithfully from the
// prototype (design/prototype.html). Real product data (agents, tasks,
// billing…) always comes from lib/api.ts — never from here.
// Amounts in this file are WHOLE EUROS unless the name ends in `Cents`.

// ---------- Categories ----------
export const CATS = [
  "Research",
  "Marketing",
  "Sales",
  "Finance",
  "Development",
  "Operations",
  "Legal",
  "Design",
  "Customer Support",
  "Data",
  "Product",
  "Business Intelligence",
] as const;

/** The 7 top-level filter groups used on Explore. */
export const CATS7 = ["Research", "Sales", "Marketing", "Finance", "Development", "Operations", "Data"] as const;

/** Category → top-level group (prototype GRP). */
export const CAT_GROUP: Record<string, string> = {
  Research: "Research",
  "Business Intelligence": "Research",
  Product: "Research",
  Legal: "Research",
  Sales: "Sales",
  Marketing: "Marketing",
  Design: "Marketing",
  Finance: "Finance",
  Development: "Development",
  Operations: "Operations",
  "Customer Support": "Operations",
  Data: "Data",
};
export const catGroup = (c: string) => CAT_GROUP[c] || c;

// ---------- Hero / new task ----------
export const HERO = {
  badge: "The marketplace for AI work",
  title: "AI agents that do the work.",
  sub: "Describe the outcome you need. Ensemblis finds, coordinates, and manages the AI agents required to get it done.",
  placeholder: "Analyze the top 20 competitors in the European data center cooling market...",
  privacy: "Your task description is used only to complete this task — never sold, never used to train outside models.",
  emptyHint: "Describe the work in plain language. Ensemblis plans the rest.",
};

export const DEMO = "I need a competitive analysis of the top 20 liquid cooling companies in Europe for an investment thesis.";
export const DEMO2 = "Analyze the top 20 competitors in the European data center cooling market.";

export const EXAMPLES = [
  "Research my competitors",
  "Find 100 qualified leads",
  "Analyze my financial data",
  "Create a market-entry strategy",
  "Monitor my brand",
  "Build a marketing campaign",
] as const;

/** Example chip → full task text. */
export const EX_FULL: Record<string, string> = {
  "Research my competitors": DEMO,
  "Find 100 qualified leads": "Find 100 qualified leads at Series A DevOps companies in the DACH region.",
  "Analyze my financial data": "Analyze our last 8 quarters of revenue and churn data and explain what changed.",
  "Create a market-entry strategy": "Build me a market-entry strategy for launching a B2B analytics product in Germany.",
  "Monitor my brand": "Monitor mentions of my brand and top three competitors weekly and send a digest.",
  "Build a marketing campaign": "Build a Q4 marketing campaign plan for a B2B SaaS launch with a €40k budget.",
};

/** "New task" page type chips (prototype TYPES). */
export const TASK_TYPES: { label: string; text: string }[] = [
  { label: "Research", text: "Research the current state of solid-state battery manufacturing in Europe and summarize the main players and timelines." },
  { label: "Competitive Intelligence", text: "Analyze the top 20 competitors in the European data center cooling market and create a comparison of their products, pricing, positioning, and target customers." },
  { label: "Lead Generation", text: "Find 100 qualified leads at Series A DevOps companies in the DACH region." },
  { label: "Market Analysis", text: "Size the market for B2B analytics software in Germany and identify the three most attractive segments." },
  { label: "Marketing", text: "Build a Q4 marketing campaign plan for a B2B SaaS launch with a €40k budget." },
  { label: "Data Analysis", text: "Analyze our last 8 quarters of revenue and churn data and explain what changed." },
  { label: "Finance", text: "Review our FY2026 budget against actuals and flag the three largest variances with likely causes." },
  { label: "Operations", text: "Map our vendor onboarding process and produce an automated runbook with owners." },
];

/** Hero social-proof ticker: "{who} just received {what} · {ago}" */
export const TICKER: { who: string; what: string; ago: string }[] = [
  { who: "A climate-tech team in Berlin", what: "a competitive analysis", ago: "2m ago" },
  { who: "A Series B SaaS company in Amsterdam", what: "100 qualified leads", ago: "4m ago" },
  { who: "A fintech team in Madrid", what: "a market-entry strategy", ago: "1m ago" },
  { who: "An ops team in Dublin", what: "an automated onboarding runbook", ago: "6m ago" },
  { who: "A DTC brand in Paris", what: "a Q4 marketing plan", ago: "3m ago" },
  { who: "A healthtech company in Stockholm", what: "a financial variance analysis", ago: "5m ago" },
  { who: "A dev team in Lisbon", what: "a security code review", ago: "1m ago" },
  { who: "A logistics company in Warsaw", what: "a vendor comparison runbook", ago: "7m ago" },
];

/** Depth options (multiplier on price; `time` null = use the agent's estimate). */
export const DEPTH = {
  focused: { m: 0.75, label: "Focused", time: "6–9 min", sources: 28 },
  standard: { m: 1, label: "Standard", time: null as string | null, sources: 47 },
  deep: { m: 1.5, label: "Deep", time: "14–20 min", sources: 80 },
} as const;

// ---------- Home page sections ----------
/** "Today" chain (last item rendered as .cchip.bad) */
export const TODAY_CHAIN = ["Find a tool", "Choose an agent", "Configure it", "Connect data", "Run it", "Fix the result"];

/** .contrast cards: [label, traditional, Ensemblis] */
export const CONTRASTS: { label: string; before: string; after: string }[] = [
  { label: "Traditional software", before: "Find the right tool.", after: "Describe the work." },
  { label: "Traditional AI marketplace", before: "Choose an agent.", after: "Tell us the outcome." },
  { label: "Traditional automation", before: "Configure the workflow.", after: "We coordinate the work." },
];

/** Live demo stage bar (.stagebar) */
export const STAGES = ["User task", "Understanding", "Agent matching", "Execution", "Verification", "Result"] as const;

/** Default agents in the orchestration (.orch) demo. */
export const ORCH_AGENTS: [string, string][] = [
  ["Research Agent", "Collects and reads sources"],
  ["Data Analysis Agent", "Structures and compares figures"],
  ["Competitive Intelligence Agent", "Maps market positioning"],
];

/** "Specialists in an ensemble" looping orchestration. */
export const ENSEMBLE = {
  title: "Specialists in an ensemble.",
  body: "Real work rarely fits one agent. Ensemblis splits it across specialists, coordinates the handoffs, and reassembles the result into a single deliverable.",
  points: [
    "Each agent is chosen for the step it performs best",
    "Handoffs and intermediate results are checked automatically",
    "You get one job, one price, one outcome",
  ],
  task: "Assess whether to enter the German market",
  agents: [
    ["Research Agent", "Collects sources"],
    ["Data Agent", "Structures figures"],
    ["Analysis Agent", "Draws conclusions"],
    ["Verification Agent", "Checks every claim"],
  ] as [string, string][],
  out: "One final outcome",
  outDesc: "A verified strategy report",
};

/** How it works — 5 steps (.hwtabs). `visual` holds the data for the right-hand mini card. */
export const HOW_IT_WORKS = [
  {
    title: "Describe",
    body: "Say what you need in plain language. There is nothing to configure and no agent to choose.",
    visual: { kind: "describe" as const, label: "What do you need done?", text: "Analyze the top 20 competitors in the European data center cooling market" },
  },
  {
    title: "Match",
    body: "Ensemblis reads the task, works out the capabilities it requires, and selects agents using their performance on similar work.",
    visual: {
      kind: "match" as const,
      rows: [
        { name: "Research Agent", meta: "96.8% success · 2,481 tasks", best: true },
        { name: "Data Analysis Agent", meta: "96.0% success · 2,954 tasks", best: false },
        { name: "Competitive Intelligence Agent", meta: "95.8% success · 1,187 tasks", best: false },
      ],
    },
  },
  {
    title: "Execute",
    body: "Selected agents work in coordination. Ensemblis manages handoffs, retries and progress.",
    visual: {
      kind: "execute" as const,
      rows: [
        { name: "Research Agent", pct: 80 },
        { name: "Data Analysis Agent", pct: 55 },
        { name: "Competitive Intelligence Agent", pct: 30 },
      ],
    },
  },
  {
    title: "Verify",
    body: "Before delivery, Ensemblis checks sources, cross-checks figures and confirms the requirements were met.",
    visual: { kind: "verify" as const, rows: ["Sources checked: 14 of 14", "Figures cross-checked: 42", "Requirements met: 6 of 6"] },
  },
  {
    title: "Deliver",
    body: "You receive the finished work, ready to use, and tell us whether it achieved what you needed.",
    visual: { kind: "deliver" as const, title: "Competitive analysis", meta: "20 companies · 10 sections · 14 sources", question: "Did this achieve what you needed?" },
  },
];

/** Performance section stats (.stat + CountUp) */
export const PERF_STATS = [
  { to: 2481, decimals: 0, suffix: "", label: "tasks completed" },
  { to: 96.8, decimals: 1, suffix: "%", label: "successful" },
  { text: "8m 42s", label: "average execution" },
  { to: 82, decimals: 0, suffix: "%", label: "repeat usage" },
] as const;

/** Agent Performance Graph example rows: [task type, agent, success %, tasks] */
export const PERF_GRAPH: [string, string, number, string][] = [
  ["Competitive analysis", "Competitive Intelligence Agent", 96.8, "2,481"],
  ["Lead sourcing", "Lead Research Agent", 94.2, "3,912"],
  ["Financial review", "Financial Analyst", 95.1, "1,764"],
  ["Deck building", "Presentation Builder", 93.1, "3,348"],
];

/** "Find the intelligence required for the work" category cards (prototype CATW). */
export const CATEGORY_WORK: { title: string; desc: string; meta: string; example: string }[] = [
  { title: "Research", desc: "Competitive analyses, market sizing, due diligence", meta: "Sourced report in ~10 min", example: EX_FULL["Research my competitors"] },
  { title: "Sales", desc: "Qualified lead lists, account briefs, outreach research", meta: "100 leads in ~14 min", example: EX_FULL["Find 100 qualified leads"] },
  { title: "Marketing", desc: "Campaign plans, content strategy, search visibility audits", meta: "Campaign plan in ~8 min", example: EX_FULL["Build a marketing campaign"] },
  { title: "Finance", desc: "Variance analysis, forecasts, board-ready KPI packs", meta: "Analysis in ~11 min", example: EX_FULL["Analyze my financial data"] },
  { title: "Development", desc: "Code reviews, security checks, migration plans", meta: "Review in ~10 min", example: "Review our checkout service repo for security and performance issues and propose fixes." },
  { title: "Operations", desc: "Process design, vendor comparisons, runbooks", meta: "Runbook in ~10 min", example: "Map our vendor onboarding process and produce an automated runbook with owners." },
];

/** Developer teaser on home: example stats. */
export const DEV_TEASER_STATS: [string, string][] = [
  ["318", "Tasks"],
  ["€2,840", "Revenue"],
  ["97.1%", "Success rate"],
  ["76%", "Repeat usage"],
];

/** "An economy of AI work" role cards [icon, title, sub] — last one is highlighted (.role.hl). */
export const ECONOMY_ROLES: [string, string, string][] = [
  ["user", "Businesses", "create demand"],
  ["code", "Developers", "create intelligence"],
  ["spark", "Agents", "execute work"],
  ["layers", "Ensemblis", "connects the system"],
];

// ---------- Network page ----------
export const NETWORK_LATER: [string, string][] = [
  ["Agent identity", "Portable, verifiable identity for every agent and creator."],
  ["Agent reputation", "Performance history that follows an agent anywhere."],
  ["Escrow", "Funds held until the outcome is confirmed."],
  ["Agent-to-agent payments", "Agents pay each other for sub-tasks automatically."],
  ["Developer rewards", "Incentives tied to measured performance."],
  ["Collateral", "Creators back their agents with a stake."],
  ["Governance", "Community input on standards and policy."],
];

/** Multi-agent pipeline (.pipe / .pnode): role → agent name */
export const PIPE: { role: string; agent: string }[] = [
  { role: "Research Agent", agent: "Competitive Intelligence Agent" },
  { role: "Data Analysis Agent", agent: "Data Analysis Agent" },
  { role: "Strategy Agent", agent: "Enterprise Intelligence Agent" },
  { role: "Report Agent", agent: "Presentation Builder" },
];

// ---------- Sample report (data center cooling scenario) ----------
/** [name, HQ, approach, revenue €M, score, [direct-to-chip, single-phase, two-phase, heat reuse]] */
export const COMPANIES: [string, string, string, number, number, number[]][] = [
  ["Nordcool Systems", "Stockholm, SE", "Direct-to-chip", 212, 92, [1, 0, 0, 1]],
  ["Aquiline Thermal", "Rotterdam, NL", "Single-phase immersion", 168, 89, [0, 1, 0, 1]],
  ["Helix Immersion", "Munich, DE", "Two-phase immersion", 141, 86, [0, 0, 1, 0]],
  ["Cryon Data Cooling", "Zurich, CH", "Direct-to-chip", 126, 84, [1, 0, 0, 1]],
  ["Polar Loop", "Dublin, IE", "Rear-door + CDU", 103, 79, [1, 0, 0, 1]],
  ["Ferrant Cooling", "Lyon, FR", "Single-phase immersion", 88, 76, [0, 1, 0, 0]],
  ["Baltic Thermal", "Tallinn, EE", "Direct-to-chip", 64, 71, [1, 0, 0, 0]],
  ["Iberflux", "Barcelona, ES", "Two-phase immersion", 52, 68, [0, 0, 1, 1]],
  ["Alpstrom", "Vienna, AT", "Rear-door + CDU", 47, 64, [1, 0, 0, 1]],
  ["Thermaris", "Manchester, UK", "Single-phase immersion", 39, 61, [0, 1, 0, 0]],
];

export type Claim = { text: string; source: string; location: string; date: string; status: "Verified" | "Cross-referenced" | "Estimated"; confidence: 1 | 2 | 3; how: string };
export const CLAIMS: Claim[] = [
  { text: "Nordcool Systems launched a direct-to-chip platform rated for 120 kW racks in March 2026.", source: "Company website", location: "nordcool.example/newsroom", date: "Sep 2026", status: "Verified", confidence: 3, how: "Product announcement dated 12 March 2026, matched against a trade press article and the product datasheet." },
  { text: "Helix Immersion raised €48M in a Series C round in June 2026.", source: "Press release + registry filing", location: "helix-immersion.example/press", date: "Sep 2026", status: "Verified", confidence: 3, how: "Announcement confirmed by the company registry filing for the new share issue." },
  { text: "Cryon Data Cooling signed a supply agreement with a Nordic colocation operator in July 2026.", source: "Trade press", location: "dcnews.example/cryon-supply", date: "Jul 2026", status: "Verified", confidence: 3, how: "Reported by two independent trade publications, one quoting the customer." },
  { text: "Aquiline Thermal single-phase immersion systems are quoted at roughly €210–€290 per kW installed.", source: "Customer quotes (3)", location: "Customer interviews", date: "Aug 2026", status: "Cross-referenced", confidence: 2, how: "Three customer quotes with similar scope. Ranges vary with installation complexity." },
  { text: "The five largest vendors account for about half (51%) of tracked revenue.", source: "Analyst estimate from filings", location: "Derived from 14 filings", date: "Sep 2026", status: "Estimated", confidence: 2, how: "Calculated from filed accounts and triangulated estimates for private companies (±15%)." },
  { text: "Two-phase fluid standards are not finalized; a working-group draft is expected in 2027.", source: "Standards body publication", location: "dc-cooling-standards.example", date: "Aug 2026", status: "Verified", confidence: 3, how: "Stated in the working group’s published roadmap." },
];
export const SOURCE_TYPES = ["Company website", "Press release", "Regulatory filing", "Trade press", "Standards body", "Analyst report", "Customer quote"];

/** Run-page illustrative progress feed. */
export const RUN_STEPS = ["Defining research scope", "Identifying competitors", "Collecting company information", "Comparing product portfolios", "Analyzing market positioning", "Building competitive matrix", "Generating final report"];
export const RUN_FEED = [
  "Scope set: 20 companies, EU + UK, last 24 months",
  "Shortlisted 34 candidates, narrowed to 20 by revenue and focus",
  "Pulled filings, product sheets and pricing pages",
  "Cross-checking 3 revenue estimates that disagree",
  "Mapping approaches: direct-to-chip vs immersion",
  "Scoring positioning on 6 criteria",
  "Formatting report and adding source list",
];

/** Feedback form chips ("What could be improved?") */
export const FEEDBACK_REASONS = ["Too slow", "Not accurate enough", "Not detailed enough", "Too expensive", "Missing information", "Other"];

/** Failed-task criteria example */
export const FAILED_CRITERIA: [string, boolean][] = [
  ["Deck structure matches brief", true],
  ["Includes all requested sections", true],
  ["Every financial figure is sourced", false],
];

// ---------- Developers ----------
export const PUBLISH_STEPS = ["Agent name", "Description", "Capabilities", "Input requirements", "Output format", "Pricing", "Performance tests", "Publish"];

export const REVENUE_STREAMS: [string, string][] = [
  ["Marketplace fees", "A share of every completed task."],
  ["Subscriptions", "Plans for teams with volume and priority."],
  ["Enterprise plans", "SSO, audit logs, private agents, SLAs."],
  ["Premium placement", "Featured slots for verified agents."],
  ["Developer tools", "Testing, analytics and benchmarking."],
  ["Agent infrastructure & API", "Usage-based hosting and API access."],
];

/** Platform fee split used across the product (creator gets 80%). */
export const PLATFORM_FEE_PERCENT = 20;

// ---------- Pricing ----------
export type PricingPlan = { name: string; price: string; sub: string; desc: string; features: string[]; cta: string; highlight?: boolean };
export const PRICING_PLANS: PricingPlan[] = [
  { name: "Pay as you go", price: "€0", sub: "/month", desc: "Perfect for trying Ensemblis or occasional work.", features: ["Pay only for completed tasks", "Access to the full agent marketplace", "Outcome guarantee on every task", "1 user seat"], cta: "Get started" },
  { name: "Business", price: "€499", sub: "/month", desc: "For teams that run AI work every week.", features: ["Everything in Pay as you go", "Unlimited workflows & automation", "5 team seats included", "Priority agent matching", "Priority support"], cta: "Start free trial", highlight: true },
  { name: "Enterprise", price: "Custom", sub: "", desc: "For organizations with complex or high-volume needs.", features: ["Everything in Business", "Unlimited team seats", "Custom integrations & SSO", "Dedicated success manager", "Custom SLAs & invoicing"], cta: "Talk to sales" },
];
export const PRICING_FAQS: [string, string][] = [
  ["How does usage-based pricing work?", "You only pay for tasks that complete successfully. Plans add team features, automation and support on top."],
  ["What happens if a result doesn't meet the brief?", "Every task is covered by the outcome guarantee — retry, reassign or refund, no extra charge."],
  ["Can I change plans later?", "Yes. Upgrade, downgrade or cancel at any time from Settings."],
  ["Do developers pay to publish agents?", "No. Publishing is free — Ensemblis takes a share of each completed task."],
];

// ---------- Changelog ----------
export const CHANGELOG: { date: string; items: string[] }[] = [
  {
    date: "October 2026",
    items: [
      "Added Settings with an editable profile, notifications and team seats.",
      "Introduced the Agent Performance Graph — see exactly which agents are matched to which work, with hover detail.",
      "Added a command palette (⌘K) with arrow-key navigation to jump to any page, agent or action.",
      "Role-based sign-up: tell Ensemblis whether you need work done or you build agents.",
      "Notifications now reflect real activity in your account.",
    ],
  },
  {
    date: "September 2026",
    items: [
      "Workflows can now be edited and deleted from the Workflows page.",
      "Agents can be compared and swapped directly on the execution-plan screen.",
      "Added an onboarding checklist to help new accounts reach their first result faster.",
    ],
  },
  { date: "August 2026", items: ["Launched the public agent marketplace with 40+ specialized agents.", "Added demo credits so anyone can try Ensemblis without a real account."] },
  { date: "July 2026", items: ["Ensemblis public beta."] },
];

// ---------- Brand ----------
export const BRAND_SWATCHES: [string, string][] = [
  ["Deep navy", "#0B1020"],
  ["Midnight", "#080B1A"],
  ["Electric violet", "#5B3DF5"],
  ["Signal cyan", "#0FB0CB"],
  ["Mist", "#F5F6FA"],
  ["Line", "#E2E5EE"],
];

// ---------- Demo mode / onboarding ----------
export const DEMO_MODE_POINTS = [
  "No real charges — everything runs on demo credits.",
  "Illustrative AI outputs — reports use realistic but fictional data.",
  "Simulated execution — timings are shortened for the demo.",
];

/** Starting demo credits granted at signup (cents) — matches the backend default. */
export const STARTING_CREDITS_CENTS = 10000;

export const ONBOARDING_STEPS: [string, string][] = [
  ["Describe a task", "Tell Ensemblis what you need in your own words."],
  ["Review your team", "See which agents were matched and why."],
  ["Get your result", "Watch it execute, then open the finished deliverable."],
];

/** Workflow frequency → per-period word */
export const FREQ_PER = { Weekly: "week", Monthly: "month", Quarterly: "quarter" } as const;
