// Landing-page and /how-it-works copy. Every product claim here is true of the
// running product (checked against backend/src): capability names mirror
// backend/src/org/registry.ts, verification checks mirror
// backend/src/engine/verification/checks.ts, Company Context fields mirror
// app/context/page.tsx. No metrics, customers, testimonials or integrations
// exist, so none appear. Examples are labelled as examples wherever shown.
import type { IconName } from "@/components/Icon";

/** The product story, in the order Ensemblis runs it. */
export const STORY: { key: string; title: string; body: string }[] = [
  { key: "objective", title: "Business objective", body: "You describe the result you need, how success will be judged, a deadline and a budget." },
  { key: "cos", title: "Chief of Staff", body: "Frames the objective with your Company Context and decides what work it takes." },
  { key: "plan", title: "Plan", body: "A short plan: each step assigned to the executive who owns that capability, with an estimated cost." },
  { key: "approval", title: "Approval", body: "You approve the plan and its cost — or let it start automatically within a budget you set." },
  { key: "team", title: "AI Team", body: "Executives for Marketing, Sales, Finance and Operations, each with specialist capabilities." },
  { key: "execution", title: "Execution", body: "Specialists research and analyse with read-only tools. You can watch each step as it happens." },
  { key: "verification", title: "Verification", body: "A gate checks claims, success criteria, completeness and consistency before anything is called done." },
  { key: "evidence", title: "Evidence", body: "Every source becomes numbered evidence, cited where it supports a conclusion." },
  { key: "outcome", title: "Outcome", body: "Each success criterion is measured: met, partially met or not met." },
  { key: "memory", title: "Memory", body: "What was learned is proposed for your organization's memory, so the next objective starts smarter." },
];

/** The five moves of "How it works" (landing #how). */
export const HOW: { n: string; title: string; body: string; status: string }[] = [
  {
    n: "01",
    title: "Describe the outcome",
    body: "State the business result you need in plain language — plus how success will be judged, a deadline and a budget.",
    status: "Objective",
  },
  {
    n: "02",
    title: "Ensemblis builds the plan",
    body: "The Chief of Staff frames it with your Company Context, writes a short plan, assigns each step to an owner and shows the estimated cost.",
    status: "Planned",
  },
  {
    n: "03",
    title: "Your AI Team executes",
    body: "After your approval — or automatically within your budget — specialists research and analyse with read-only tools.",
    status: "Executing",
  },
  {
    n: "04",
    title: "The work is verified",
    body: "Claims are checked against the evidence and every success criterion is assessed. What fails is revised or escalated to you.",
    status: "Verifying",
  },
  {
    n: "05",
    title: "You get the outcome",
    body: "The result, the evidence behind it and a measurement of each success criterion — with learnings kept for next time.",
    status: "Completed",
  },
];

/** Tool categories (generic — no vendor names or logos). */
export const TOOLS: { label: string; icon: IconName }[] = [
  { label: "CRM", icon: "user" },
  { label: "Project management", icon: "list" },
  { label: "Spreadsheets", icon: "chart" },
  { label: "Analytics", icon: "layers" },
  { label: "Communication", icon: "mail" },
  { label: "Knowledge base", icon: "file" },
];

export const MANUAL_WORK = ["Moving information", "Researching", "Analysing", "Preparing reports", "Repeating it next month"];

/** The AI Team, exactly as defined in backend/src/org/registry.ts. */
export const CHIEF_OF_STAFF = {
  title: "Chief of Staff",
  role: "Coordinates the outcome",
  capabilities: ["Objective Planning", "Cross-functional Synthesis"],
};
export const DEPARTMENTS: { key: string; name: string; title: string; icon: IconName; capabilities: string[] }[] = [
  { key: "marketing", name: "Marketing", title: "Head of Marketing", icon: "globe", capabilities: ["Market Research", "Competitor Analysis", "Customer / ICP Analysis", "Positioning Analysis"] },
  { key: "sales", name: "Sales", title: "Head of Sales", icon: "zap", capabilities: ["Account Research", "Lead Research", "Sales Opportunity Analysis"] },
  { key: "finance", name: "Finance", title: "Head of Finance", icon: "eur", capabilities: ["Financial Analysis", "Scenario Analysis", "Unit Economics"] },
  { key: "operations", name: "Operations", title: "Head of Operations", icon: "settings", capabilities: ["Process Analysis", "Operational Research", "Workflow Analysis"] },
];

/** A labelled example used by the Chief of Staff and Execution illustrations. */
export const EXAMPLE = {
  objective: "Analyze the European market for our product and recommend the three highest-potential markets for expansion.",
  criteria: ["3 markets, ranked with a rationale", "Every recommendation cites evidence", "Entry risks stated for each market"],
  plan: [
    { owner: "Chief of Staff", specialist: "Planning", step: "Frame the objective with your product, customers and goals" },
    { owner: "Marketing", specialist: "Market Research", step: "Research candidate markets: size, growth, regulation" },
    { owner: "Marketing", specialist: "Competitor Analysis", step: "Map competitors and openings in each market" },
    { owner: "Finance", specialist: "Financial Analysis", step: "Compare the economics of entering each market" },
    { owner: "Chief of Staff", specialist: "Synthesis", step: "Recommend three markets against your success criteria" },
  ],
};

/** The verification gate's checks (backend/src/engine/verification/checks.ts). */
export const VERIFICATION_CHECKS = ["Objective alignment", "Evidence support", "Success criteria coverage", "Completeness", "Internal consistency"];

export const TRUST: { icon: IconName; title: string; body: string }[] = [
  { icon: "check", title: "You approve before anything is spent", body: "Every plan arrives with its estimated cost. Execution starts only after your approval — or automatically within a budget you set." },
  { icon: "link", title: "Evidence behind every claim", body: "Web sources, your documents and your Company Context are numbered and cited, so you can see what supports each conclusion." },
  { icon: "shield", title: "A real verification gate", body: "Claims are checked against the cited evidence and every success criterion is assessed. Results that fail are revised or escalated — never quietly passed." },
  { icon: "alert", title: "Exceptions, not guesses", body: "When information is missing or a step fails, Ensemblis stops and tells you what happened, why it matters and what it needs from you." },
  { icon: "lock", title: "Read-only by design", body: "The AI Team researches, analyses, drafts and recommends. It never sends email, publishes, changes your systems or spends money on its own." },
  { icon: "redo", title: "Refunds for work that didn't run", body: "You see the cost before work starts. Work that fails or never starts is refunded automatically, and each organization's data stays isolated." },
];

/** Company Context, as captured on the Company Context page. */
export const CONTEXT_FIELDS = [
  "What the company does",
  "Products & services",
  "Business model",
  "Customers / ICP",
  "Markets & geographies",
  "Business goals",
  "Website",
  "Documents — PDF, Word, Excel, CSV and text",
];
export const MEMORY_KINDS = ["Preferences", "Decisions", "Lessons", "Constraints", "Facts"];

/** Answer vs outcome (Outcomes section). */
export const ANSWER_VS_OUTCOME: { answer: string; outcome: string }[] = [
  { answer: "A fluent paragraph", outcome: "A result framed by your objective and success criteria" },
  { answer: "Sources unclear or invented", outcome: "Numbered evidence, cited where it supports a claim" },
  { answer: "Nobody checked it", outcome: "A verification gate with every check shown" },
  { answer: "“Done” is a feeling", outcome: "Each success criterion measured: met, partially met or not met" },
  { answer: "Forgotten next time", outcome: "Learnings kept in your organization's memory" },
];

/** Visible FAQ — also emitted as FAQPage JSON-LD (only because it is shown on the page). */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Ensemblis?",
    a: "Ensemblis is an AI operating layer for business that turns business objectives into planned, executed and verified work. You describe the outcome; a Chief of Staff plans it, an AI Team executes it, and the result is verified against evidence and your success criteria.",
  },
  {
    q: "What does Ensemblis do?",
    a: "It coordinates AI-powered planning, execution, verification and evidence around business objectives — research, analysis and recommendations in marketing, sales, finance and operations — and measures whether each success criterion was met.",
  },
  {
    q: "Who is Ensemblis for?",
    a: "Ensemblis is designed for businesses that want AI to execute operational and knowledge work rather than simply provide conversational answers: founders, executives and teams who delegate research, analysis and recommendations and need to trust the result.",
  },
  {
    q: "How is Ensemblis different from an AI assistant or chatbot?",
    a: "Traditional AI assistants primarily generate responses. Ensemblis is designed around business outcomes: it plans the work, asks for your approval, executes it with an AI Team, verifies the result against evidence and measures it against your success criteria.",
  },
  {
    q: "What doesn't Ensemblis do?",
    a: "The AI Team is read-only by design. It researches, analyses, drafts and recommends; it never sends email, publishes content, changes your systems or spends money on its own. AI-generated work can contain mistakes, which is why every result comes with its evidence and a verification report.",
  },
  {
    q: "How do I stay in control?",
    a: "You set the success criteria, deadline and budget. You approve each plan and its estimated cost, or allow automatic starts within a budget and approval threshold. When information is missing or something fails, Ensemblis raises an exception instead of guessing.",
  },
  {
    q: "Is my company's data kept separate?",
    a: "Yes. Each organization's objectives, Company Context, documents and memory are isolated from every other organization, and documents are treated as data — never as instructions to the AI.",
  },
];
