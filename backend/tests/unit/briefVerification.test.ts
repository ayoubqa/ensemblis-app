// The verification gate for an evidence-backed research brief (G06, G09):
// only external sources count as support, an evidence-free brief fails, any
// unsupported cited claim fails, claims are typed by section, an uncited key
// finding is flagged, recommendations are never "supported", completeness
// follows BRIEF_SECTIONS — and decision memos keep the general rules.

import { describe, expect, it } from "vitest";
import {
  checkClaims,
  combineVerification,
  extractClaims,
  extractClaimsDetailed,
  sectionCompleteness,
  type CheckEvidence,
  type ModelAssessment,
} from "../../src/engine/verification/checks";
import { BRIEF_SECTIONS } from "../../src/engine/prompts";

const KIND = "research_brief";
const sources: CheckEvidence[] = [
  { n: 1, title: "German e-payroll rules", content: "Germany requires electronic payroll reporting for all employers from 2026. The rule covers 3.4 million employers.", external: true },
  { n: 2, title: "Payroll software market", content: "The German payroll software market was worth €1.2 billion in 2025 and grows 8% per year.", external: true },
  { n: 3, title: "Company profile (provided)", content: "Acme sells payroll software to small businesses in Austria and Germany.", external: false },
];

const model = (over: Partial<ModelAssessment> = {}): ModelAssessment => ({
  alignmentScore: 90,
  alignmentRationale: "Answers the objective.",
  criteria: [{ index: 1, status: "MET", measuredValue: null, measurement: "", explanation: "", evidence: [1] }],
  consistencyIssues: [],
  humanJudgment: [],
  ...over,
});

const FINDINGS = [
  "- Germany requires electronic payroll reporting for all employers from 2026 [1].",
  "- The German payroll software market was worth €1.2 billion in 2025 and grows 8% per year [2].",
];

/** A brief with every BRIEF_SECTIONS heading; `over` replaces a section's lines. */
function brief(over: Partial<Record<string, string[]>> = {}): string {
  const defaults: Record<string, string[]> = {
    summary: ["- Electronic payroll reporting becomes mandatory in Germany from 2026 [1]."],
    findings: FINDINGS,
    analysis: ["- Inference: mandatory reporting should raise demand for compliant payroll software."],
    uncertainty: ["- Open question: how strictly will enforcement start in the first year?"],
    gaps: ["- Search 2 of 3 returned HTTP 401, so competitor pricing was not covered."],
    recommendations: ["- Prioritise a compliant e-reporting module for the German launch."],
    criteria: ["1. Key findings cite external sources — met in Key findings."],
    next: ["- Interview three payroll bureaus within 30 days."],
  };
  const lines = ["# Brief: German payroll software"];
  for (const s of BRIEF_SECTIONS) lines.push("", `## ${s.heading}`, ...(over[s.key] ?? defaults[s.key]));
  return lines.join("\n");
}

function gate(md: string, opts: { evidence?: CheckEvidence[]; external?: number; m?: ModelAssessment | null; researchIssues?: string[]; citationsRemoved?: number } = {}) {
  const evidence = opts.evidence ?? sources;
  const claimResults = checkClaims(extractClaims(md, { brief: true }), evidence, { brief: true });
  const v = combineVerification({
    report: md,
    evidenceCount: evidence.length,
    claimResults,
    criteria: ["Key findings cite external sources"],
    model: opts.m === undefined ? model() : opts.m,
    objectiveKind: KIND,
    externalEvidenceCount: opts.external ?? evidence.filter((e) => e.external !== false).length,
    researchIssues: opts.researchIssues,
    citationsRemoved: opts.citationsRemoved,
  });
  return { v, claimResults };
}

describe("research brief: evidence requirements", () => {
  it("passes a complete brief whose findings are backed by external sources", () => {
    const { v, claimResults } = gate(brief());
    expect(claimResults.filter((c) => c.claimType === "source").every((c) => c.status === "SUPPORTED")).toBe(true);
    expect(v.status).toBe("PASS");
    expect(v.hasUnsupported).toBe(false);
  });

  it("a brief with zero external evidence FAILs with 'Insufficient evidence' — even with a perfect model verdict", () => {
    const companyOnly = sources.filter((s) => s.external === false);
    const md = brief({ findings: ["- Acme sells payroll software to small businesses in Austria and Germany [3]."], summary: ["- Acme sells payroll software in Germany [3]."] });
    const { v } = gate(md, { evidence: companyOnly, external: 0, m: model({ alignmentScore: 100 }) });
    expect(v.status).toBe("FAIL");
    expect(v.checks.find((c) => c.key === "citation_support")).toMatchObject({ status: "fail", score: 0 });
    expect(v.failures.join(" ")).toMatch(/Insufficient evidence: no external sources were retrieved during this execution/);
    expect(v.insufficientEvidence).toBe(true);
    expect(v.needsResearch).toBe(true);
  });

  it("no external evidence FAILs even when the AI verifier is unavailable (never UNVERIFIED or a pass)", () => {
    const { v } = gate(brief({ findings: ["- No external source was gathered, so there are no findings to report."], summary: ["- Nothing was found."] }), { evidence: [], external: 0, m: null });
    expect(v.status).toBe("FAIL");
    expect(v.failures[0]).toMatch(/Insufficient evidence/);
  });

  it("citations only to company context are 'provided context', not external support", () => {
    const md = brief({
      summary: ["- Acme sells payroll software to small businesses in Austria and Germany [3]."],
      findings: ["- Acme sells payroll software to small businesses in Austria and Germany [3]."],
    });
    const { v, claimResults } = gate(md);
    const provided = claimResults.filter((c) => c.evidenceNs.join() === "3");
    expect(provided.length).toBeGreaterThan(0);
    for (const c of provided) {
      expect(c.providedOnly).toBe(true);
      expect(c.status).not.toBe("SUPPORTED");
      expect(c.note).toMatch(/^Provided context only/);
    }
    // External sources exist, but nothing in the brief rests on them.
    expect(v.status).toBe("FAIL");
    expect(v.checks.find((c) => c.key === "citation_support")!.detail).toMatch(/Insufficient evidence: no finding in the brief is backed by one of the 2 external sources/);
    expect(v.checks.find((c) => c.key === "citation_support")!.detail).toMatch(/only on company-provided context/);
  });

  it("a mix of external findings and provided context passes only with a warning", () => {
    const md = brief({ summary: ["- Acme sells payroll software to small businesses in Austria and Germany [3]."] });
    const { v } = gate(md);
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.warnings.join(" ")).toMatch(/rests only on company-provided context/);
  });

  it("one UNSUPPORTED cited claim FAILs the brief, with that claim in the failures (revision feedback)", () => {
    const md = brief({ findings: [...FINDINGS, "- Payroll bureaus in Spain charge €9 per payslip on average [1]."] });
    const { v, claimResults } = gate(md);
    const bad = claimResults.find((c) => /Spain/.test(c.claim))!;
    expect(bad.status).toBe("UNSUPPORTED");
    expect(v.status).toBe("FAIL");
    expect(v.failures.some((f) => f.startsWith("Unsupported claim:") && /Spain charge €9 per payslip/.test(f))).toBe(true);
    expect(v.needsResearch).toBe(true);
    expect(v.insufficientEvidence).toBe(false);
  });

  it("the same unsupported claim in a decision memo only warns (general rules unchanged)", () => {
    const memo = "# R\n\n## Executive summary\n" + [...FINDINGS, "- Payroll bureaus in Spain charge €9 per payslip on average [1]."].join("\n") + "\n\n## Recommendation\n- Go.\n\n## Limitations\n- Some.\n\n## Next steps\n- Go.\n";
    const v = combineVerification({ report: memo, evidenceCount: 3, claimResults: checkClaims(extractClaims(memo), sources), criteria: ["c"], model: model() });
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.failures).toEqual([]);
  });

  it("research that failed and invented citations that were removed are warnings on a brief", () => {
    const { v } = gate(brief(), { researchIssues: ["web research in “Desk research” failed, so no external sources were retrieved."], citationsRemoved: 2 });
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.warnings.join(" ")).toMatch(/Research: web research in “Desk research” failed/);
    expect(v.warnings.join(" ")).toMatch(/2 invented citations were removed/);
  });
});

describe("research brief: claims by section", () => {
  it("types every claim by its section, and by an 'Inference:' / 'Open question:' label", () => {
    const md = brief({
      summary: ["- Germany requires electronic payroll reporting for all employers from 2026 [1]."],
      analysis: ["- Mandatory reporting means about 3.4 million employers need compliant software [1].", "- Inference: demand for compliant software will rise in 2026 [2]."],
      uncertainty: ["- Open question: the 8% growth may slow after the mandate [2]."],
      recommendations: ["- Prioritise Germany, the market worth €1.2 billion in 2025 [2]."],
      findings: [...FINDINGS, "- Inference: the mandate will favour vendors with e-reporting [1]."],
    });
    const claims = extractClaims(md, { brief: true });
    const typeOf = (re: RegExp) => claims.find((c) => re.test(c.text))!.claimType;
    expect(typeOf(/^Germany requires/)).toBe("source");
    expect(claims.find((c) => /^Germany requires/.test(c.text))!.section).toBe("summary");
    expect(typeOf(/^Mandatory reporting means/)).toBe("inference");
    expect(typeOf(/^Inference: demand/)).toBe("inference");
    expect(typeOf(/^Open question/)).toBe("uncertainty");
    expect(typeOf(/^Prioritise Germany/)).toBe("recommendation");
    // A labelled inference inside Key findings is an inference, not a finding.
    expect(typeOf(/^Inference: the mandate/)).toBe("inference");
  });

  it("an uncited declarative sentence under Key findings is UNCITED; questions and lead-ins are not claims", () => {
    const md = brief({
      findings: [...FINDINGS, "- Competitor Lohnfix is the clear market leader in German SME payroll.", "- What will the regulator do next?", "The sources agree on the following:"],
    });
    const r = checkClaims(extractClaims(md, { brief: true }), sources, { brief: true });
    const leader = r.find((c) => /Lohnfix/.test(c.claim))!;
    expect(leader).toMatchObject({ status: "UNCITED", claimType: "source" });
    expect(leader.note).toMatch(/must cite the external source/);
    expect(r.some((c) => /regulator do next|agree on the following/.test(c.claim))).toBe(false);
    const { v } = gate(md);
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.hasUnsupported).toBe(true);
  });

  it("uncited sentences outside Key findings are not flagged, and gap / recommendation figures are not facts", () => {
    const claims = extractClaims(brief(), { brief: true });
    // "Search 2 of 3 returned HTTP 401 …" (Evidence gaps) and "within 30 days" (Next steps) are not claims.
    expect(claims.some((c) => /HTTP 401|Interview three/.test(c.text))).toBe(false);
    expect(claims.some((c) => /Inference: mandatory reporting/.test(c.text))).toBe(false);
  });

  it("a recommendation is never SUPPORTED, even when its cited source contains it", () => {
    const md = brief({ recommendations: ["- Germany requires electronic payroll reporting for all employers from 2026 [1]."] });
    const r = checkClaims(extractClaims(md, { brief: true }), sources, { brief: true });
    const rec = r.find((c) => c.claimType === "recommendation")!;
    expect(rec.status).toBe("PARTIALLY_SUPPORTED");
    expect(rec.note).toMatch(/A recommendation is a judgement, never a sourced fact/);
    // The same sentence as a finding is supported.
    expect(r.find((c) => c.claimType === "source" && /Germany requires/.test(c.claim))!.status).toBe("SUPPORTED");
  });

  it("caps claims at 40 for a brief and counts the rest", () => {
    const many = Array.from({ length: 45 }, (_, i) => `- Germany requires electronic payroll reporting from 2026 for group ${i + 10} [1].`);
    const { claims, dropped } = extractClaimsDetailed(brief({ findings: many }), { brief: true });
    expect(claims).toHaveLength(40);
    expect(dropped).toBeGreaterThanOrEqual(6);
  });
});

describe("research brief: completeness", () => {
  it("uses BRIEF_SECTIONS: every heading present passes", () => {
    const sec = sectionCompleteness(brief(), { brief: true });
    expect(sec.missing).toEqual([]);
    expect(sec.present).toEqual(BRIEF_SECTIONS.map((s) => s.heading));
  });

  it("a brief missing Key findings fails completeness; one missing Evidence gaps only warns", () => {
    const noFindings = brief().replace(/## Key findings[\s\S]*?(?=\n## )/, "");
    const sec = sectionCompleteness(noFindings, { brief: true });
    expect(sec.missing).toContainEqual({ label: "Key findings", critical: true });
    expect(gate(noFindings).v.checks.find((c) => c.key === "completeness")!.status).toBe("fail");

    const noGaps = brief().replace(/## Evidence gaps[\s\S]*?(?=\n## )/, "");
    const check = gate(noGaps).v.checks.find((c) => c.key === "completeness")!;
    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/Missing: Evidence gaps/);
  });

  it("a decision memo is still checked against the memo sections", () => {
    const memo = "# R\n\n## Executive summary\n- x\n\n## Recommendation\n- y\n\n## Limitations & uncertainty\n- z\n\n## Next steps\n- w\n";
    expect(sectionCompleteness(memo).missing).toEqual([]);
    expect(sectionCompleteness(memo, { brief: true }).missing.map((m) => m.label)).toContain("Key findings");
  });
});

describe("decision memos keep the general rules", () => {
  const evidence = [
    { n: 1, title: "EU data centers 2027", content: "Germany is the largest European data center market with 2,450 MW of operational capacity in 2025." },
    { n: 2, title: "Nordics", content: "Nordic operators report liquid cooling adoption of 34% in new builds." },
  ];
  const memo = (body: string) => `# Result\n\n## Executive summary\n${body}\n\n## Recommendation\n- Do it.\n\n## Limitations & uncertainty\n- Some.\n\n## Next steps\n- Go.\n`;
  const m: ModelAssessment = { alignmentScore: 90, alignmentRationale: "ok", criteria: [{ index: 1, status: "MET", measuredValue: null, measurement: "", explanation: "" }], consistencyIssues: [], humanJudgment: [] };

  it("extraction, claim checks and the verdict are the same as before for a memo", () => {
    const md = memo("- Germany is the largest market with 2,450 MW of capacity [1].\n- Competitor Acme is the clear market leader in Nordic colocation.\n- Spain will grow 77% next year.");
    const claims = extractClaims(md);
    expect(claims.map((c) => c.text)).toEqual(["Germany is the largest market with 2,450 MW of capacity .", "Spain will grow 77% next year."]);
    expect(claims.every((c) => c.claimType === undefined)).toBe(true);
    expect(extractClaims(md, 30)).toEqual(claims);
    const r = checkClaims(claims, evidence);
    expect(r.map((x) => [x.status, x.claimType])).toEqual([
      ["SUPPORTED", null],
      ["UNCITED", null],
    ]);
    const base = { report: md, evidenceCount: 2, claimResults: r, criteria: ["Recommend markets"], model: m };
    const before = combineVerification(base);
    // Brief-only inputs change nothing for a memo.
    const withExtras = combineVerification({ ...base, objectiveKind: null, externalEvidenceCount: 0, researchIssues: ["web research in “X” failed."], citationsRemoved: 3 });
    expect(withExtras).toEqual(before);
    expect(before.status).toBe("PASS");
    expect(before.insufficientEvidence).toBe(false);
    expect(before.needsResearch).toBe(false);
  });

  it("a memo without any evidence still only warns", () => {
    const v = combineVerification({ report: memo("- We should enter Germany."), evidenceCount: 0, claimResults: [], criteria: [], model: m, objectiveKind: null, externalEvidenceCount: 0 });
    expect(v.status).toBe("PASS_WITH_WARNINGS");
    expect(v.checks.find((c) => c.key === "citation_support")!.detail).toMatch(/No external evidence/);
  });
});
