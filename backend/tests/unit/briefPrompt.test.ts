// The research-brief deliverable (G09): the synthesis prompt asks for every
// BRIEF_SECTIONS heading in order and keeps external sources apart from
// company-provided material; the mock writes a brief that only cites sources
// that exist, with findings in the sources' own words, and stays deterministic.
import { describe, expect, it } from "vitest";
import type { Evidence, ExecutionStep } from "@prisma/client";
import { mockLLM } from "../../src/ai/mockProvider";
import { BRIEF_EVIDENCE_PROMPT_CHARS, EVIDENCE_PROMPT_CHARS, readRevisionInputs, stepSystemPrompt, stepUserPrompt, type StepRunInput } from "../../src/engine/executor";
import { normalizePlan, planSchema, plannerPrompt } from "../../src/engine/planner";
import { BRIEF_SECTIONS, briefSectionFor, isResearchBrief } from "../../src/engine/prompts";
import { isExternalEvidence } from "../../src/engine/evidence";
import { parseStructured } from "../../src/ai/json";
import { getCapability, searchesWeb } from "../../src/org/registry";

const synthesis = getCapability("cross_functional_synthesis")!;
const research = getCapability("business_research")!;

const ev = (n: number, kind: string, title: string, content: string, domain: string | null = null): Evidence =>
  ({ id: `e${n}`, n, kind, title, content, domain, url: domain ? `https://${domain}/page-${n}` : null, excerpt: content.slice(0, 200), stepId: "s2" }) as unknown as Evidence;

const EVIDENCE: Evidence[] = [
  ev(1, "COMPANY_CONTEXT", "Company profile (Company Context)", "Company: Skyhop\nWhat the company does: drone delivery software for pharmacies."),
  ev(2, "WEB", "EU drone rules explained", "The EU drone regulation applies to all commercial operators since 31 December 2020. Operators must register in their member state.", "easa.example.eu"),
  ev(3, "WIKIPEDIA", "Drone delivery", "Drone delivery is the use of unmanned aerial vehicles to transport packages. Several pilots run in Ireland and Finland.", "en.wikipedia.org"),
  ev(4, "DOCUMENT", "pricing.md (company document)", "Our per-delivery price is 4 euros."),
];

const fakeStep = (extra: Partial<ExecutionStep> = {}): ExecutionStep =>
  ({
    id: "step-synth",
    key: "s3",
    order: 2,
    title: "Write the research brief",
    purpose: "Write the evidence-backed brief.",
    outputs: ["Research brief"],
    verification: ["Findings are cited"],
    kind: "work",
    inputs: [],
    attempts: 1,
    researchStatus: null,
    research: null,
    ...extra,
  }) as unknown as ExecutionStep;

const runInput = (extra: Partial<StepRunInput["objective"]> = {}): StepRunInput => ({
  execution: { id: "x", orgId: "o" },
  objective: {
    title: "EU drone delivery regulation",
    statement: "Brief us on how EU regulation affects commercial drone delivery.",
    contextNotes: "",
    deadline: null,
    kind: "research_brief",
    constraints: "Only EU rules; ignore the UK.",
    ...extra,
  },
  criteria: [{ description: "Covers the EU registration rules" }, { description: "States the open questions" }],
  step: fakeStep(),
  totalSteps: 3,
  priorSteps: [],
});

const INCOMPLETE = ["“Research the market”: web research failed."];
const briefUser = (evidence = EVIDENCE) =>
  stepUserPrompt({ input: runInput(), cap: synthesis, companyProfile: "What the company does: drone delivery software.", memories: [], evidence, brief: { incomplete: INCOMPLETE, newSources: null } });

/** The text of one `## heading` section. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const rest = md.slice(start + heading.length + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}
const citations = (md: string) => [...md.matchAll(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g)].flatMap((m) => m[1].split(/[,;–-]/).map((x) => Number(x.trim())));

describe("BRIEF_SECTIONS", () => {
  it("is the ordered brief contract, with a claim type and a heading matcher per section", () => {
    expect(BRIEF_SECTIONS.map((s) => s.heading)).toEqual([
      "Executive summary",
      "Key findings",
      "Analysis & inference",
      "Uncertainties & open questions",
      "Evidence gaps",
      "Recommendations",
      "Success criteria",
      "Next steps",
    ]);
    expect(BRIEF_SECTIONS.filter((s) => s.critical).map((s) => s.key)).toEqual(["summary", "findings", "recommendations"]);
    expect(Object.fromEntries(BRIEF_SECTIONS.map((s) => [s.key, s.claimType]))).toMatchObject({ findings: "source", analysis: "inference", uncertainty: "uncertainty", gaps: "uncertainty", recommendations: "recommendation", next: "recommendation" });
    for (const s of BRIEF_SECTIONS) expect(briefSectionFor(`## ${s.heading}`)?.key).toBe(s.key);
    expect(briefSectionFor("## Findings")?.key).toBe("findings");
    expect(briefSectionFor("Key findings")).toBeNull();
    expect(isResearchBrief("research_brief")).toBe(true);
    expect(isResearchBrief(null)).toBe(false);
    expect(isExternalEvidence("WEB") && isExternalEvidence("WIKIPEDIA")).toBe(true);
    expect(["COMPANY_CONTEXT", "DOCUMENT", "WEBSITE", "CALCULATION"].some(isExternalEvidence)).toBe(false);
  });
});

describe("the brief synthesis prompt", () => {
  it("lists every BRIEF_SECTIONS heading, in order", () => {
    const system = stepSystemPrompt(synthesis, { revision: false, brief: true });
    const positions = BRIEF_SECTIONS.map((s) => system.indexOf(`## ${s.heading}`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(system).toMatch(/never present them as findings/);
    expect(system).toMatch(/starts with "Inference:"/);
    expect(system).toMatch(/Under Evidence gaps, list every step the assignment reports as skipped or with incomplete research/);
    expect(stepSystemPrompt(synthesis, { revision: true, brief: true })).toMatch(/REVISION: the verifier rejected parts of the previous brief/);
  });

  it("leaves the decision memo and work-step prompts on their own formats", () => {
    const memo = stepSystemPrompt(synthesis, { revision: false });
    expect(memo).not.toMatch(/## Key findings/);
    expect(memo).toMatch(/`## Recommendation`/);
    const work = stepSystemPrompt(research, { revision: false, brief: true });
    expect(work).not.toMatch(/## Key findings/);
    expect(work).toMatch(/feeds an evidence-backed research brief/);
    expect(stepSystemPrompt(research, { revision: false })).not.toMatch(/research brief/);
  });

  it("separates external sources from company material, lists incomplete research and passes the constraints", () => {
    const user = briefUser();
    expect(user).toMatch(/External sources you may cite as findings \(web and Wikipedia\): \[2\], \[3\]\./);
    expect(user).toMatch(/Company-provided material \(company context, documents, website\) — not external evidence: \[1\], \[4\]\./);
    expect(user).toMatch(/Research that is incomplete \(list each under Evidence gaps\):\n- “Research the market”: web research failed\./);
    expect(user).toMatch(/<constraints trust="user-instruction">\nOnly EU rules; ignore the UK\.\n<\/constraints>/);
    expect(user).toMatch(/Respect every item in <constraints>\./);
    expect(user).toMatch(/Deliverable: research brief \(evidence-backed\)/);
    const none = stepUserPrompt({ input: runInput(), cap: synthesis, companyProfile: "", memories: [], evidence: [EVIDENCE[0]], brief: { incomplete: [], newSources: null } });
    expect(none).toMatch(/External sources you may cite as findings \(web and Wikipedia\): none\./);
    expect(none).toMatch(/Research that is incomplete: none\./);
  });

  it("a revision with research lists the new sources", () => {
    const user = stepUserPrompt({ input: runInput(), cap: synthesis, companyProfile: "", memories: [], evidence: EVIDENCE, brief: { incomplete: [], newSources: [3] } });
    expect(user).toMatch(/New sources gathered for this revision: \[3\]\./);
    const empty = stepUserPrompt({ input: runInput(), cap: synthesis, companyProfile: "", memories: [], evidence: EVIDENCE, brief: { incomplete: [], newSources: [] } });
    expect(empty).toMatch(/The extra research for this revision found no new sources\./);
  });

  it("gives a brief's synthesis a larger evidence budget than other steps", () => {
    const long = [2, 3, 4].map((n) => ev(n, "WEB", `Source ${n}`, `${"Long sentence about drone rules. ".repeat(200)}`, `s${n}.example.org`));
    const evidenceChars = (u: string) => (/<evidence[^>]*>([\s\S]*?)<\/evidence>/.exec(u)?.[1] ?? "").length;
    const b = evidenceChars(stepUserPrompt({ input: runInput(), cap: synthesis, companyProfile: "", memories: [], evidence: long, brief: { incomplete: [], newSources: null } }));
    const memo = evidenceChars(stepUserPrompt({ input: runInput({ kind: null }), cap: synthesis, companyProfile: "", memories: [], evidence: long }));
    expect(memo).toBeLessThanOrEqual(EVIDENCE_PROMPT_CHARS + 200);
    expect(b).toBeGreaterThan(EVIDENCE_PROMPT_CHARS + 1000);
    expect(b).toBeLessThanOrEqual(BRIEF_EVIDENCE_PROMPT_CHARS + 200);
  });

  it("a decision memo gets no brief lines and no constraints block when there are none", () => {
    const user = stepUserPrompt({ input: runInput({ kind: null, constraints: null }), cap: synthesis, companyProfile: "", memories: [], evidence: EVIDENCE });
    expect(user).not.toMatch(/External sources you may cite|Deliverable: research brief|<constraints|Respect every item/);
  });
});

describe("revision inputs", () => {
  it("reads the legacy feedback list and the research flag", () => {
    expect(readRevisionInputs(["Fix claim 2", "Cite more"])).toEqual({ feedback: ["Fix claim 2", "Cite more"], research: false });
    expect(readRevisionInputs({ feedback: ["Insufficient evidence"], research: true })).toEqual({ feedback: ["Insufficient evidence"], research: true });
    expect(readRevisionInputs(["Insufficient evidence", { research: true }])).toEqual({ feedback: ["Insufficient evidence"], research: true });
    expect(readRevisionInputs(null)).toEqual({ feedback: [], research: false });
  });
});

describe("the mock brief", () => {
  const system = stepSystemPrompt(synthesis, { revision: false, brief: true });
  const out = mockLLM(system, briefUser(), { purpose: "step" });

  it("contains every BRIEF_SECTIONS heading, in order", () => {
    expect(out).toMatch(/^# EU drone delivery regulation/);
    const headings = out.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual(BRIEF_SECTIONS.map((s) => `## ${s.heading}`));
  });

  it("only cites sources the prompt contains, and Key findings only cites external ones", () => {
    const cited = citations(out);
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect([1, 2, 3, 4]).toContain(n);
    expect(new Set(citations(section(out, "Key findings")))).toEqual(new Set([2, 3]));
    // Company-provided material is never cited as a finding (or anywhere in the mock brief).
    expect(cited).not.toContain(1);
    expect(cited).not.toContain(4);
  });

  it("writes Key findings in the sources' own words", () => {
    const findings = section(out, "Key findings")
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(findings).toHaveLength(2);
    for (const line of findings) {
      const n = citations(line)[0];
      const sentence = line.replace(/^- /, "").replace(/\s*\[\d+\]\s*$/, "");
      expect(EVIDENCE.find((e) => e.n === n)!.content).toContain(sentence);
    }
  });

  it("labels inference and uncertainty, and reports the incomplete research as an evidence gap", () => {
    expect(section(out, "Analysis & inference")).toMatch(/^- Inference: /m);
    expect(section(out, "Uncertainties & open questions")).toMatch(/Uncertain:|Open question:/);
    expect(section(out, "Evidence gaps")).toContain(INCOMPLETE[0]);
    expect(section(out, "Success criteria")).toMatch(/^1\. Covers the EU registration rules/m);
  });

  it("says plainly when there is no external evidence instead of inventing findings", () => {
    const thin = mockLLM(system, briefUser([EVIDENCE[0], EVIDENCE[3]]), { purpose: "step" });
    expect(thin.split("\n").filter((l) => l.startsWith("## "))).toEqual(BRIEF_SECTIONS.map((s) => `## ${s.heading}`));
    expect(citations(thin)).toEqual([]);
    expect(section(thin, "Key findings")).toMatch(/no source-backed findings/);
    expect(section(thin, "Evidence gaps")).toMatch(/No external evidence was gathered/);
  });

  it("is deterministic", () => {
    expect(mockLLM(system, briefUser(), { purpose: "step" })).toBe(out);
  });

  it("plans a brief as framing → Business Research → synthesis", () => {
    const p = plannerPrompt({
      title: "EU drone delivery regulation",
      statement: "Brief us on how EU regulation affects commercial drone delivery.",
      contextNotes: "",
      deadline: null,
      budgetCents: 5000,
      criteria: [],
      companyProfile: "",
      memories: [],
      documentTitles: [],
      questionsSettled: false,
      kind: "research_brief",
    });
    const parsed = parseStructured(mockLLM(p.system, p.user, { purpose: "plan" }), planSchema);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = normalizePlan(parsed.data, { title: "x", statement: "y", criteria: [], kind: "research_brief" });
    expect(plan.steps.map((s) => s.capability)).toEqual(["objective_framing", "business_research", "cross_functional_synthesis"]);
    expect(plan.steps.some((s) => searchesWeb(getCapability(s.capability)))).toBe(true);
  });
});

describe("the mock verifier", () => {
  const criteria = "<success_criteria>\n1. Covers the EU registration rules\n2. States the open questions\n</success_criteria>";
  const result = "<result>\n# Brief\n- Operators must register [2]. Pilots run in Finland [3; 9].\n</result>";

  it("links each criterion to the cited sources the prompt lists", () => {
    const index = "<evidence_index trust=\"internal\">\n[2] EU drone rules explained — easa.example.eu\n[3] Drone delivery — en.wikipedia.org\n</evidence_index>";
    const a = JSON.parse(mockLLM("You are the verification lead", [criteria, result, index].join("\n\n"), { purpose: "verify" }));
    expect(a.criteria.map((c: { evidence: number[] }) => c.evidence)).toEqual([
      [2, 3],
      [2, 3],
    ]);
    const noIndex = JSON.parse(mockLLM("You are the verification lead", [criteria, result].join("\n\n"), { purpose: "verify" }));
    expect(noIndex.criteria[0]).not.toHaveProperty("evidence");
  });

  it("answers claim checks with 'supported' and the cited source's own sentence", () => {
    const user = [
      "<claims>\n1. Operators must register in their member state [2]\n2. Pilots run in Ireland and Finland [3]\n3. An uncited claim\n</claims>",
      `<evidence trust="untrusted">\n=== BEGIN SOURCES ===\n[2] EU drone rules explained — easa.example.eu\n${EVIDENCE[1].content}\n\n[3] Drone delivery — en.wikipedia.org\n${EVIDENCE[2].content}\n=== END SOURCES ===\n</evidence>`,
    ].join("\n\n");
    const r = JSON.parse(mockLLM("You check whether cited sources support claims", user, { purpose: "verify_claims" }));
    expect(r.claims).toEqual([
      { index: 1, verdict: "supported", quote: "The EU drone regulation applies to all commercial operators since 31 December 2020." },
      { index: 2, verdict: "supported", quote: "Drone delivery is the use of unmanned aerial vehicles to transport packages." },
      { index: 3, verdict: "supported", quote: "" },
    ]);
    expect(JSON.parse(mockLLM("You check whether cited sources support claims", "no claims here", { purpose: "verify_claims" }))).toEqual({ claims: [] });
  });
});
