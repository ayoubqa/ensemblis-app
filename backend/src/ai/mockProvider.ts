// Deterministic scripted model for local development and automated tests
// (AI_PROVIDER=mock). The server refuses to start with it in production
// (config.ts) and the UI labels it "Mock AI (development/testing only)".
//
// It answers by `purpose` and works only from what is in the prompt: step
// outputs quote the evidence the prompt actually contains, with that
// evidence's [n] number, so the verifier's evidence checks run against real
// text instead of being rigged to pass.

import type { LLMOptions } from "./llmProvider";

function block(text: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(text);
  return m ? m[1].trim() : "";
}

function titleOf(user: string): string {
  const obj = block(user, "objective");
  const t = /Title:\s*(.+)/.exec(obj)?.[1]?.trim();
  return (t || obj.split("\n")[0] || "Objective").slice(0, 100);
}

function criteriaOf(user: string): string[] {
  return block(user, "success_criteria")
    .split("\n")
    .map((l) => /^\s*\d+\.\s*(.+)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => !!x);
}

interface MockSource {
  n: number;
  title: string;
  firstSentence: string;
}

function sourcesOf(user: string): MockSource[] {
  const ev = block(user, "evidence");
  const out: MockSource[] = [];
  const lines = ev.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[(\d+)\]\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    const content = (lines[i + 1] ?? "").trim();
    const sentence = (/^(.+?[.!?])(\s|$)/.exec(content)?.[1] ?? content).replace(/\[[^\]]*\]/g, "").trim();
    if (sentence.length > 10) out.push({ n: Number(m[1]), title: m[2], firstSentence: sentence.slice(0, 220) });
  }
  return out;
}

function stepReport(system: string, user: string): string {
  const sources = sourcesOf(user);
  const isSynthesis = /Capability: Cross-functional Synthesis/.test(system) || /Capability: .*Synthesis/.test(system);
  const title = titleOf(user);
  const facts = sources.length
    ? sources.slice(0, 6).map((s) => `- ${s.firstSentence} [${s.n}]`)
    : ["- No external evidence was available for this step; the points below are reasoned estimates (estimate)."];
  const criteria = criteriaOf(user);
  if (!isSynthesis) {
    return [
      `## Findings`,
      ...facts,
      "",
      `## Analysis`,
      `- The evidence above is the basis for the assessment of "${title}".`,
      `- Where figures are not in the evidence they are treated as estimates (estimate).`,
      "",
      `## Gaps`,
      `- Figures not covered by the evidence should be confirmed before acting.`,
    ].join("\n");
  }
  return [
    `# ${title}`,
    "",
    "## Executive summary",
    `- This result answers the objective "${title}" using the team's research and analysis.`,
    ...facts.slice(0, 3),
    "",
    "## Findings",
    ...facts,
    "",
    "## Recommendation",
    `- Prioritise the options best supported by the evidence above, in the order listed.`,
    "",
    "## Success criteria",
    ...(criteria.length ? criteria.map((c, i) => `${i + 1}. ${c} — addressed in the findings and recommendation above.`) : ["- Addressed above."]),
    "",
    "## Limitations & uncertainty",
    "- Evidence comes from the sources listed; anything not cited is an estimate (estimate) and should be verified.",
    "",
    "## Next steps",
    "- Review the recommendation with the team and confirm the open assumptions.",
  ].join("\n");
}

export function mockLLM(system: string, user: string, opts: LLMOptions): string {
  switch (opts.purpose) {
    case "plan": {
      const title = titleOf(user);
      const criteria = criteriaOf(user);
      return JSON.stringify({
        title,
        objective: `Deliver: ${title}`,
        successCriteria: criteria.length
          ? []
          : [
              { description: "The result gives a clear, ranked recommendation", kind: "qualitative" },
              { description: "Key claims are supported by cited evidence", kind: "qualitative" },
              { description: "Risks and next steps are stated", kind: "qualitative" },
            ],
        assumptions: ["The company context on file is current."],
        missingInformation: [],
        steps: [
          {
            id: "s1",
            title: "Frame the objective with company context",
            executive: "chief_of_staff",
            capability: "objective_framing",
            purpose: "Restate the objective and extract the relevant company context.",
            inputs: ["Objective", "Company context"],
            outputs: ["Objective framing"],
            verification: ["Context is drawn from the company profile"],
            dependsOn: [],
          },
          {
            id: "s2",
            title: "Research the market",
            executive: "marketing",
            capability: "market_research",
            purpose: "Collect cited facts about the markets in scope.",
            inputs: ["Objective framing"],
            outputs: ["Market facts"],
            verification: ["Figures are cited"],
            dependsOn: ["s1"],
          },
          {
            id: "s3",
            title: "Analyse competitors",
            executive: "marketing",
            capability: "competitor_analysis",
            purpose: "Compare the relevant competitors.",
            inputs: ["Market facts"],
            outputs: ["Competitor comparison"],
            verification: ["Competitor facts are cited"],
            dependsOn: ["s2"],
          },
          {
            id: "s4",
            title: "Synthesise the recommendation",
            executive: "chief_of_staff",
            capability: "cross_functional_synthesis",
            purpose: "Produce the final recommendation against the success criteria.",
            inputs: ["All findings"],
            outputs: ["Final result"],
            verification: ["Covers every success criterion"],
            dependsOn: ["s1", "s2", "s3"],
          },
        ],
        estimatedManualHours: 12,
        risks: ["Public data may lag the market."],
      });
    }
    case "queries": {
      const t = titleOf(user).replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
      return JSON.stringify({ queries: [t, `${t} market size`, `${t} competitors`].map((q) => q.slice(0, 120)) });
    }
    case "verify": {
      const criteria = criteriaOf(user);
      return JSON.stringify({
        objectiveAlignment: { score: 86, rationale: "The result answers the objective with a ranked recommendation." },
        criteria: criteria.map((c, i) => ({
          index: i + 1,
          status: "MET",
          measuredValue: null,
          measurement: "Addressed in the result",
          explanation: `The result addresses: ${c}`,
        })),
        consistencyIssues: [],
        humanJudgment: ["Confirm the recommendation fits current priorities."],
      });
    }
    case "memory":
      return JSON.stringify({
        memories: [
          {
            kind: "PREFERENCE",
            content: "Present recommendations as a ranked list with a one-line rationale for each option.",
            rationale: "The objective asked for a ranked recommendation.",
            sensitivity: "low",
          },
        ],
      });
    case "suggest": {
      const t = (/"""\n?([\s\S]*?)\n?"""/.exec(user)?.[1] ?? "").trim().split("\n")[0].slice(0, 80) || "Objective";
      return JSON.stringify({
        title: t.charAt(0).toUpperCase() + t.slice(1),
        criteria: [
          { description: "A clear, ranked recommendation is delivered", kind: "qualitative" },
          { description: "Every key claim is supported by cited evidence", kind: "qualitative" },
          { description: "Risks and next steps are listed", kind: "qualitative" },
        ],
        questions: [],
      });
    }
    case "step":
      return stepReport(system, user);
    default:
      return "OK";
  }
}
