// The quality scorecard counts what can be counted and never scores judgment: a dimension that
// needs an evaluator is never "pass", and Wikipedia-only research never counts as web coverage.
import { describe, expect, it } from "vitest";
import { citationsIn, domainOf, measure, parseProspects, renderScorecard, scorecard, THRESHOLDS, type ScoreRun, type ScoreSource } from "../../src/eval/scorecard";

const HEADER = "| Rank | Company | Website | Characteristics | ICP match evidence | Reason to contact | Sources | Confidence | Missing information |\n|---|---|---|---|---|---|---|---|---|";

/** n prospect rows; row i cites [i] (its own site) and [100] (a directory). */
function deliverable(n: number, row: (i: number) => string = (i) => `| ${i} | Firm ${i} | https://www.firm${i}.example | 40 staff, Lyon | Runs field teams [${i}] | Hiring ops lead [${i}] | [${i}], [100] | Medium | Budget owner |`) {
  return [
    "# Prospect research pack",
    "## Ranking methodology",
    "Scored on fit (50%), timing (30%), reachability (20%).",
    "## Prospects",
    HEADER,
    ...Array.from({ length: n }, (_, k) => row(k + 1)),
    "## Strongest prospects",
    "Firm 1 and Firm 2 [1][2].",
    "## Limitations & uncertainty",
    "Inference: headcounts are estimated from job posts; budgets are unknown.",
  ].join("\n");
}

const ownSites = (n: number): ScoreSource[] => [
  ...Array.from({ length: n }, (_, k) => ({ n: k + 1, kind: "WEB", provider: "tavily", url: `https://firm${k + 1}.example/about`, title: `Firm ${k + 1}` })),
  { n: 100, kind: "WEB", provider: "tavily", url: "https://directory.example.org/list", title: "Directory" },
];

const run = (over: Partial<ScoreRun> = {}): ScoreRun => ({
  status: "COMPLETED",
  resultState: "verified",
  verificationStatus: "PASS",
  createdAt: "2026-10-29T10:00:00Z",
  startedAt: "2026-10-29T10:01:00Z",
  completedAt: "2026-10-29T10:13:00Z",
  creditsCharged: 1150,
  creditsRefunded: 0,
  creditBudget: 2000,
  steps: [
    { title: "Frame", status: "COMPLETED", researchStatus: null, providers: [], attempts: 1 },
    { title: "Find leads", status: "COMPLETED", researchStatus: "ok", providers: ["tavily"], attempts: 1 },
    { title: "Synthesis", status: "COMPLETED", researchStatus: null, providers: [], attempts: 1 },
  ],
  claims: [...Array(18).fill("SUPPORTED"), "PARTIALLY_SUPPORTED", "ESTIMATE"],
  ...over,
});

const byKey = (card: ReturnType<typeof scorecard>) => Object.fromEntries(card.dimensions.map((d) => [d.key, d]));

describe("parsing", () => {
  it("reads citations, ranges and domains", () => {
    expect(citationsIn("a [1] b [2, 4] c [5–7] d [x] [2025]")).toEqual([1, 2, 4, 5, 6, 7]);
    expect(domainOf("https://www.Acme.co.uk/about")).toBe("acme.co.uk");
    expect(domainOf("acme.io")).toBe("acme.io");
    expect(domainOf("—")).toBeNull();
  });

  it("finds the prospect table and each row's own-site evidence through its citations", () => {
    const rows = parseProspects(deliverable(3), ownSites(3));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ company: "Firm 1", domain: "firm1.example", citations: [1, 100], ownSiteSource: true, missingFields: [] });
    expect(rows[0].sourceDomains).toEqual(["firm1.example", "directory.example.org"]);
  });

  it("a baseline's inline URLs count as its sources; the website column itself does not", () => {
    const md = deliverable(2, (i) => `| ${i} | Firm ${i} | firm${i}.example | 40 staff | Fit | Reason | https://news.example.com/f${i} | High | — |`);
    const rows = parseProspects(md);
    expect(rows[0]).toMatchObject({ domain: "firm1.example", sourceDomains: ["news.example.com"], ownSiteSource: false, missingFields: ["missing"] });
    // The homepage itself, cited in the sources column, is own-site evidence.
    const homepage = parseProspects(deliverable(1, () => "| 1 | Firm 1 | https://firm1.example | x | fit | why | https://firm1.example | High | x |"));
    expect(homepage[0]).toMatchObject({ sourceDomains: ["firm1.example"], ownSiteSource: true });
  });
});

describe("scorecard", () => {
  it("a complete, live-web, verified pack passes every automated part and leaves judgment to the evaluator", () => {
    const card = scorecard({ label: "Ensemblis", markdown: deliverable(20), sources: ownSites(20), run: run(), expectedProspects: 20 });
    const d = byKey(card);
    for (const k of ["evidence_coverage", "research_coverage", "reliability"]) expect(d[k].status).toBe("pass");
    for (const k of ["task_completion", "citation_quality", "uncertainty_handling", "efficiency"]) expect(d[k].status).toBe("needs_manual");
    for (const k of ["source_relevance", "factual_accuracy", "actionability"]) expect(d[k]).toMatchObject({ method: "manual", status: "needs_manual" });
    expect(card.dimensions.every((x) => x.status !== "pass" || x.method === "automated")).toBe(true);
    expect(card.metrics.run).toMatchObject({ wallMinutes: 12, creditsNet: 1150, liveWebSteps: 1, researchSteps: 1 });
  });

  it("fails what the counts show: too few prospects, missing fields, invalid citations, duplicates", () => {
    const md = deliverable(12, (i) => `| ${i} | ${i === 12 ? "Firm 1 Ltd" : `Firm ${i}`} | ${i === 3 ? "—" : `https://firm${i}.example`} | 40 staff | Fit [${i}] | Reason | [${i}] [77] | ${i < 5 ? "" : "Low"} | x |`);
    const card = scorecard({ label: "Ensemblis", markdown: md, sources: ownSites(12), run: run(), expectedProspects: 20 });
    const d = byKey(card);
    expect(d.task_completion.status).toBe("fail");
    expect(d.task_completion.failures.join(" ")).toMatch(/12\/20 prospects delivered/);
    expect(d.citation_quality.failures.join(" ")).toMatch(/\[77\]/);
    expect(card.metrics.prospects.duplicates).toEqual(["Firm 1 Ltd"]);
    expect(d.uncertainty_handling.failures.join(" ")).toMatch(/4 rows without a confidence indicator/);
  });

  it("evidence coverage needs the prospects' own websites, not just a directory", () => {
    const md = deliverable(20, (i) => `| ${i} | Firm ${i} | https://firm${i}.example | x | fit [100] | why | [100] | Low | x |`);
    const d = byKey(scorecard({ label: "Ensemblis", markdown: md, sources: ownSites(20), run: run(), expectedProspects: 20 }));
    expect(d.evidence_coverage.status).toBe("fail");
    expect(d.evidence_coverage.failures[0]).toBe(`0/20 rows cite the prospect's own website (needs ≥ ${Math.round(THRESHOLDS.ownSiteRowShare * 100)}%)`);
  });

  it("Wikipedia-only research fails research coverage, whatever its status says", () => {
    const wiki = run({ steps: [{ title: "Find leads", status: "COMPLETED", researchStatus: "ok", providers: ["wikipedia"], attempts: 1 }] });
    const sources = ownSites(20).map((s) => ({ ...s, kind: "WIKIPEDIA", provider: "wikipedia" }));
    const d = byKey(scorecard({ label: "Ensemblis", markdown: deliverable(20), sources, run: wiki, expectedProspects: 20 }));
    expect(d.research_coverage.status).toBe("fail");
    expect(d.research_coverage.failures.join(" ")).toMatch(/Wikipedia only/);
  });

  it("a partial or unverified run is a reliability failure; too many unsupported claims fail citation quality", () => {
    const d = byKey(scorecard({ label: "Ensemblis", markdown: deliverable(20), sources: ownSites(20), run: run({ resultState: "partial", claims: ["SUPPORTED", "UNSUPPORTED", "UNSUPPORTED", "UNCITED"] }), expectedProspects: 20 }));
    expect(d.reliability.status).toBe("fail");
    expect(d.citation_quality.failures.join(" ")).toMatch(/25% of checked claims supported/);
  });

  it("efficiency compares tester time with the manual arm when both are recorded", () => {
    const d = byKey(scorecard({ label: "Ensemblis", markdown: deliverable(20), sources: ownSites(20), run: run(), expectedProspects: 20, testerMinutes: 80, manualBaselineMinutes: 120 }));
    expect(d.efficiency.status).toBe("fail");
    expect(d.efficiency.failures[0]).toMatch(/67% of manual research/);
  });

  it("a memo without a prospect table: generic headings don't pass for a method or a shortlist, and nothing is counted twice", () => {
    const memo = "# Result\n## Executive summary\n- point [1]\n## Success criteria\n1. met\n## Limitations & uncertainty\nThin.";
    const card = scorecard({ label: "Ensemblis", markdown: memo, sources: ownSites(1), run: run({ mockAI: true, stubSearch: true }), expectedProspects: 20 });
    const d = byKey(card);
    expect(card.metrics.sections).toEqual({ methodology: false, summary: false, limitations: true });
    expect(d.task_completion.failures).toEqual(["0/20 prospects delivered (needs ≥ 90%)", "no ranking methodology section", "no summary of the strongest prospects"]);
    expect(d.evidence_coverage.failures).toEqual(["no prospect rows found"]);
    expect(card.warnings.join(" ")).toMatch(/mock AI provider.*not evidence/);
    expect(renderScorecard(card)).toMatch(/> \*\*Not evidence:\*\* This run used the mock AI provider/);
    expect(scorecard({ label: "Ensemblis", markdown: memo, run: run() }).warnings).toEqual([]);
  });

  it("a baseline without a run: reliability is not measurable, the rest is scored the same way", () => {
    const md = deliverable(20, (i) => `| ${i} | Firm ${i} | https://firm${i}.example | x | fit | why | https://firm${i}.example/team https://press${i}.example.com/a | High | x |`);
    const card = scorecard({ label: "General-purpose AI", markdown: md, expectedProspects: 20 });
    const d = byKey(card);
    expect(d.reliability.status).toBe("not_measurable");
    expect(d.evidence_coverage.status).toBe("pass");
    expect(measure({ label: "x", markdown: md }).sources.distinctDomains).toBe(40);
    expect(renderScorecard(card)).toMatch(/^# Quality scorecard — General-purpose AI/);
    expect(renderScorecard(card)).toMatch(/NEEDS EVALUATOR/);
  });
});
