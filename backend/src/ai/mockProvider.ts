// Deterministic scripted model for local development and automated tests
// (AI_PROVIDER=mock). The server refuses to start with it in production
// (config.ts) and the UI labels it "Mock AI (development/testing only)".
//
// It answers by `purpose` and works only from what is in the prompt: step
// outputs quote the evidence the prompt actually contains, with that
// evidence's [n] number, so the verifier's evidence checks run against real
// text instead of being rigged to pass.
//
// A research brief's synthesis (its system prompt lists `## Key findings`)
// gets every BRIEF_SECTIONS heading: findings that repeat the external
// sources' own sentences with their [n], labelled inference, uncertainty and
// the evidence gaps the assignment reports. Without external sources it says
// so instead of inventing findings. Everything is deterministic.

import type { LLMOptions } from "./llmProvider";
import { BRIEF_SECTIONS } from "../engine/prompts";

function block(text: string, tag: string): string {
  // The tag name must end at a space or ">": <evidence> is not <evidence_index>.
  const m = new RegExp(`<${tag}(?=[\\s>])[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(text);
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

/** Citation numbers in a text: [3], [1, 4], [2; 5], [2–4]. */
function citedNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g)) {
    for (const part of m[1].split(/[,;]/)) {
      const [a, b] = part.split(/[–-]/).map((x) => Number(x.trim()));
      if (!Number.isFinite(a)) continue;
      if (Number.isFinite(b) && b >= a && b - a <= 50) for (let k = a; k <= b; k++) out.add(k);
      else out.add(a);
    }
  }
  return [...out];
}

/** Source numbers listed in any evidence block (`[n] title` lines in <evidence…>, e.g. <evidence> or <evidence_index>). */
function evidenceNumbers(user: string): number[] {
  const out = new Set<number>();
  for (const m of user.matchAll(/<(evidence[a-z_]*)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    for (const l of m[2].matchAll(/^\s*(?:[-*]\s*)?\[(\d{1,3})\]/gm)) out.add(Number(l[1]));
  }
  return [...out].sort((a, b) => a - b);
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

/** The assignment's list of external sources ("External sources you may cite as findings …: [2], [3]."), or null when absent. */
function externalSourceNumbers(user: string): number[] | null {
  const line = /External sources you may cite as findings[^:\n]*:([^\n]*)/.exec(block(user, "assignment"))?.[1];
  return line === undefined ? null : citedNumbers(line);
}

/** The assignment's "Research that is incomplete" lines. */
function incompleteResearch(user: string): string[] {
  const lines = block(user, "assignment").split("\n");
  const start = lines.findIndex((l) => /^Research that is incomplete \(/.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^-\s+(.+)$/.exec(l.trim());
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

function briefReport(user: string): string {
  const all = sourcesOf(user);
  const listed = externalSourceNumbers(user);
  // Only external (web / Wikipedia) sources become findings; company-provided material never does.
  const external = listed ? all.filter((s) => listed.includes(s.n)) : all.filter((s) => / — [a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.title));
  const hasCompany = all.some((s) => !external.includes(s));
  const facts = external.slice(0, 6).map((s) => `- ${s.firstSentence} [${s.n}]`);
  const criteria = criteriaOf(user);
  const gaps = incompleteResearch(user);
  const heading = (key: string) => `## ${BRIEF_SECTIONS.find((s) => s.key === key)!.heading}`;
  const sections: Record<string, string[]> = {
    summary: external.length
      ? ["- This brief answers the objective from the external sources cited below.", ...facts.slice(0, 2)]
      : ["- No external sources were available, so this brief has no source-backed findings; treat it as a limited, preliminary view."],
    findings: external.length ? facts : ["- No external source was gathered for this brief, so there are no source-backed findings to report."],
    analysis: [
      external.length
        ? "- Inference: the findings above point in a consistent direction, but they rest on a small set of search extracts and should be read as indicative rather than conclusive."
        : "- Inference: without external evidence, any conclusion here would be a judgement rather than a finding.",
      ...(hasCompany ? ["- Inference: read against the company-provided context, the findings suggest where the client's position is strongest; this is a judgement, not a sourced fact."] : []),
    ],
    uncertainty: [
      "- Uncertain: the sources are search extracts; their full context, methodology and publication dates were not reviewed.",
      "- Open question: which of these findings still hold for the client's own situation and timeline?",
    ],
    gaps: [
      ...gaps.map((g) => `- ${g}`),
      ...(external.length ? ["- The brief relies on search snippets rather than full documents."] : ["- No external evidence was gathered for this brief."]),
    ],
    recommendations: [
      "- Act only on the key findings that are cited above, and confirm the open questions before committing resources.",
      "- Treat the inferences as hypotheses to test, not as established facts.",
    ],
    criteria: criteria.length ? criteria.map((c, i) => `${i + 1}. ${c} — addressed in the key findings and recommendations above.`) : ["- Addressed above."],
    next: ["- Review the brief with the team and close the evidence gaps listed above."],
  };
  const out = [`# ${titleOf(user)}`];
  for (const s of BRIEF_SECTIONS) out.push("", heading(s.key), ...(sections[s.key] ?? ["- (none)"]));
  return out.join("\n");
}

function stepReport(system: string, user: string): string {
  if (/## Key findings/.test(system)) return briefReport(user);
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

/** A research brief's plan: framing → Business Research (searches the web) → synthesis. */
function briefPlan(title: string, criteria: string[]): string {
  return JSON.stringify({
    title,
    objective: `Deliver an evidence-backed research brief: ${title}`,
    successCriteria: criteria.length
      ? []
      : [
          { description: "Every key finding cites an external source", kind: "qualitative" },
          { description: "Evidence gaps and open questions are stated", kind: "qualitative" },
          { description: "Recommendations follow from the findings", kind: "qualitative" },
        ],
    assumptions: ["The company context on file is current."],
    missingInformation: [],
    steps: [
      {
        id: "s1",
        title: "Frame the research questions",
        executive: "chief_of_staff",
        capability: "objective_framing",
        purpose: "Restate the objective as the questions the brief must answer, with the relevant company context.",
        inputs: ["Objective", "Company context"],
        outputs: ["Research questions"],
        verification: ["Questions follow from the objective"],
        dependsOn: [],
      },
      {
        id: "s2",
        title: "Research the questions from external sources",
        executive: "chief_of_staff",
        capability: "business_research",
        purpose: "Answer each research question with cited findings from external sources, and record the evidence gaps.",
        inputs: ["Research questions"],
        outputs: ["Cited findings", "Evidence gaps"],
        verification: ["Every finding cites an external source"],
        dependsOn: ["s1"],
      },
      {
        id: "s3",
        title: "Write the research brief",
        executive: "chief_of_staff",
        capability: "cross_functional_synthesis",
        purpose: "Write the evidence-backed brief against the success criteria.",
        inputs: ["All findings"],
        outputs: ["Research brief"],
        verification: ["Covers every success criterion", "Findings are cited"],
        dependsOn: ["s1", "s2"],
      },
    ],
    estimatedManualHours: 8,
    risks: ["Public sources may be incomplete or out of date."],
  });
}

export function mockLLM(system: string, user: string, opts: LLMOptions): string {
  switch (opts.purpose) {
    case "plan": {
      const title = titleOf(user);
      const criteria = criteriaOf(user);
      if (/evidence-backed research brief/i.test(system)) return briefPlan(title, criteria);
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
      // Evidence refs per criterion: the sources the result cites that the prompt lists (none when it lists none).
      const known = evidenceNumbers(user);
      const cited = known.length ? citedNumbers(block(user, "result")).filter((n) => known.includes(n)).slice(0, 3) : [];
      return JSON.stringify({
        objectiveAlignment: { score: 86, rationale: "The result answers the objective with a ranked recommendation." },
        criteria: criteria.map((c, i) => ({
          index: i + 1,
          status: "MET",
          measuredValue: null,
          measurement: "Addressed in the result",
          explanation: `The result addresses: ${c}`,
          ...(known.length ? { evidence: cited } : {}),
        })),
        consistencyIssues: [],
        humanJudgment: ["Confirm the recommendation fits current priorities."],
      });
    }
    case "verify_claims": {
      // "Supported" for each claim listed in <claims> ("N. claim text [n]"), quoting the first cited
      // source's own sentence from <evidence>. A model verdict never upgrades the lexical check.
      const sources = sourcesOf(user);
      const claims = block(user, "claims")
        .split("\n")
        .map((l) => /^\s*(?:[-*]\s*)?(?:claim\s*)?\(?\[?(\d{1,3})[\].):]\s+(.+)$/i.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => {
          const cite = citedNumbers(m[2]).map((n) => sources.find((s) => s.n === n)).find((s) => !!s);
          return { index: Number(m[1]), verdict: "supported", quote: cite?.firstSentence ?? "" };
        });
      return JSON.stringify({ claims });
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
      const line = (/"""\n?([\s\S]*?)\n?"""/.exec(user)?.[1] ?? "").trim().split("\n")[0].replace(/[.!?]+$/, "");
      const t = (line.length > 90 ? `${line.slice(0, 88).replace(/\s+\S*$/, "")}…` : line) || "Objective";
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
