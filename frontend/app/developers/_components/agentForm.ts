/** Delivery windows offered in the wizard (prototype: '2–4 min' … '12–20 min'). */
export const TIME_WINDOWS: [number, number][] = [
  [2, 4],
  [4, 8],
  [8, 12],
  [12, 20],
  [20, 30],
];

export const OUTPUT_TYPES = ["PDF report", "Report", "Spreadsheet", "Document", "Memo", "Slide deck", "Digest", "Report + charts", "Briefs"];

export const TASK_TYPES = ["Competitive Intelligence", "Market Research", "Due Diligence", "Lead Research", "Pricing Analysis", "Data Analysis", "Code Review"];

export interface AgentDraft {
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  specialty: string;
  taskType: string;
  outputType: string;
  systemPrompt: string;
  priceEuros: string; // kept as text while editing
  estMinutesLow: number;
  estMinutesHigh: number;
}

/** A solid starting system prompt built from the draft's own fields. */
export function promptTemplate(d: Pick<AgentDraft, "name" | "specialty" | "capabilities" | "outputType" | "taskType">): string {
  const caps = d.capabilities.length ? d.capabilities.map((c) => `- ${c}`).join("\n") : "- (add your capabilities)";
  return `You are ${d.name || "a specialist agent"}, an expert in ${d.specialty || "your field"}.

You run as one step inside an Ensemblis task. You receive the customer's request and the outputs of earlier steps.

What you do:
${caps}

How you work:
1. Restate the objective and the scope in one or two sentences.
2. Work through the request methodically. Prefer primary sources and name them.
3. Separate facts from estimates, and say how confident you are in each key claim.
4. Flag anything you could not verify instead of guessing.

Output: a ${d.outputType || "structured report"} in Markdown with a short executive summary first, then clear sections, tables where they help, and a "Sources & assumptions" section at the end.

Style: concise, specific and professional. No filler. Never invent data, names or citations.`;
}

/** Strings that look like credentials — the "Safety checks" step refuses them. */
export function findSecret(s: string): string | null {
  const m = s.match(/\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,})\b/);
  return m ? m[1].slice(0, 6) + "…" : null;
}

export function parsePriceCents(euros: string): number | null {
  const n = Number(String(euros).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
