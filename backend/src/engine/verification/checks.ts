// Deterministic verification checks. Pure functions — unit tested.
//
// These do not ask a model whether the result is good. They test things that
// can be checked mechanically:
//   - claim support: for every claim that cites [n], do the cited evidence
//     texts actually contain the claim's figures and key terms?
//   - uncited specifics: numeric claims with no citation and no "(estimate)";
//   - citation integrity: citations point at evidence that exists;
//   - completeness: the required sections are present;
//   - criteria coverage: each success criterion is addressed (term overlap).
// A model assessment (assessor.ts) adds judgement on alignment, criteria and
// consistency, but it can never mark a claim "supported": only the evidence match can.

import type { ClaimStatus, VerificationStatus } from "@prisma/client";
import { terms } from "../../context/retrieval";

export const VERIFIER_VERSION = "verifier/1.0.0";

// ---------------------------------------------------------------- claims

export interface Claim {
  text: string;
  citations: number[];
  numbers: string[];
  isEstimate: boolean;
}

const CITE_RE = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g;

export function parseCitations(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(CITE_RE)) {
    for (const part of m[1].split(/\s*,\s*/)) {
      const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 20; n++) out.add(n);
      } else out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Numeric tokens normalised for matching: "1,200" → "1200", "12.5%" → "12.5", "€4.5bn" → "4.5". */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  const cleaned = text.replace(CITE_RE, " ");
  // Units may follow a figure ("4.5bn", "34%", "2,450 MW"); a figure glued to a preceding letter ("v2", "Q3") is not one.
  for (const m of cleaned.matchAll(/(?<![\w.])(\d{1,3}(?:[ ,]\d{3})+|\d+(?:\.\d+)?)(?![\d])/g)) {
    const n = m[1].replace(/[ ,]/g, "");
    if (/^\d$/.test(n)) continue; // single digits ("3 markets", list numbers) are too ambiguous to check
    out.add(n.replace(/\.0+$/, ""));
  }
  return [...out];
}

function stripMarkdown(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences / bullets / table rows that cite evidence or state specific figures. Code is ignored. */
export function extractClaims(md: string, max = 30): Claim[] {
  const noCode = md.replace(/```[\s\S]*?(```|$)/g, "").replace(/`[^`\n]+`/g, "");
  const units: string[] = [];
  for (const line of noCode.split("\n")) {
    const l = line.trim();
    if (!l || /^#/.test(l) || /^\|?\s*:?-{3,}/.test(l)) continue;
    if (l.startsWith("|")) {
      units.push(l.replace(/\|/g, " "));
      continue;
    }
    const body = l.replace(/^([-*+]|\d+[.)])\s+/, "");
    // Split prose into sentences, keeping citations attached to the sentence they follow.
    for (const s of body.split(/(?<=[.!?](?:\s*\[\d[^\]]*\])*)\s+(?=[A-Z0-9€$"“(])/)) units.push(s);
  }
  const claims: Claim[] = [];
  for (const u of units) {
    const text = stripMarkdown(u);
    if (text.length < 20) continue;
    const citations = parseCitations(text);
    const numbers = extractNumbers(text);
    const isEstimate = /\b(estimate[ds]?|est\.|approximately|roughly|assum(e|ed|ption))\b/i.test(text);
    if (!citations.length && !numbers.length) continue;
    claims.push({ text: text.replace(CITE_RE, "").replace(/\s+/g, " ").trim(), citations, numbers, isEstimate });
    if (claims.length >= max) break;
  }
  return claims;
}

export interface ClaimResult {
  claim: string;
  status: ClaimStatus;
  evidenceNs: number[];
  supportScore: number;
  note: string;
}

/** How well `evidenceText` supports a claim: 0–1, plus which numbers were found. */
export function supportScore(claim: Claim, evidenceText: string): { score: number; numbersFound: number } {
  const ev = evidenceText.toLowerCase().replace(/(\d)[ ,](?=\d{3}\b)/g, "$1");
  const claimTerms = [...new Set(terms(claim.text))].filter((t) => !/^\d+$/.test(t));
  const evTerms = new Set(terms(ev));
  const overlap = claimTerms.length ? claimTerms.filter((t) => evTerms.has(t)).length / claimTerms.length : 0;
  const numbersFound = claim.numbers.filter((n) => new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?![\\d])`).test(ev)).length;
  const numberRatio = claim.numbers.length ? numbersFound / claim.numbers.length : overlap;
  return { score: Math.round((0.6 * overlap + 0.4 * numberRatio) * 100) / 100, numbersFound };
}

export function checkClaims(claims: Claim[], evidence: { n: number; content: string; title: string }[]): ClaimResult[] {
  const byN = new Map(evidence.map((e) => [e.n, e]));
  return claims.map((c) => {
    if (!c.citations.length) {
      return c.isEstimate
        ? { claim: c.text, status: "ESTIMATE" as const, evidenceNs: [], supportScore: 0, note: "Labelled as an estimate." }
        : { claim: c.text, status: "UNCITED" as const, evidenceNs: [], supportScore: 0, note: "Specific figure with no citation and not labelled as an estimate." };
    }
    const cited = c.citations.map((n) => byN.get(n)).filter((e): e is NonNullable<typeof e> => !!e);
    if (!cited.length) {
      return { claim: c.text, status: "UNSUPPORTED" as const, evidenceNs: c.citations, supportScore: 0, note: "Cites evidence that does not exist." };
    }
    const { score, numbersFound } = supportScore(c, cited.map((e) => `${e.title}\n${e.content}`).join("\n"));
    const allNumbers = numbersFound === c.numbers.length;
    let status: ClaimStatus;
    let note: string;
    if (score >= 0.5 && allNumbers) {
      status = "SUPPORTED";
      note = "The cited evidence contains the claim's key terms" + (c.numbers.length ? " and figures." : ".");
    } else if (score >= 0.25 || numbersFound > 0) {
      status = "PARTIALLY_SUPPORTED";
      note = !allNumbers ? `${c.numbers.length - numbersFound} of ${c.numbers.length} figure(s) not found in the cited evidence.` : "Only part of the claim appears in the cited evidence.";
    } else {
      status = "UNSUPPORTED";
      note = "The cited evidence does not contain this claim.";
    }
    return { claim: c.text, status, evidenceNs: cited.map((e) => e.n), supportScore: score, note };
  });
}

// ---------------------------------------------------------------- structure

export const REQUIRED_SECTIONS: { key: string; label: string; re: RegExp; critical: boolean }[] = [
  { key: "summary", label: "Executive summary", re: /^##\s+.*(summary|overview|answer)/im, critical: true },
  { key: "recommendation", label: "Recommendation", re: /^##\s+.*(recommend|decision|conclusion|result)/im, critical: true },
  { key: "limitations", label: "Limitations & uncertainty", re: /^##\s+.*(limitation|uncertain|caveat|risk|assumption)/im, critical: false },
  { key: "next", label: "Next steps", re: /^##\s+.*(next step|action)/im, critical: false },
];

export function sectionCompleteness(md: string): { present: string[]; missing: { label: string; critical: boolean }[] } {
  const present: string[] = [];
  const missing: { label: string; critical: boolean }[] = [];
  for (const s of REQUIRED_SECTIONS) {
    if (s.re.test(md)) present.push(s.label);
    else missing.push({ label: s.label, critical: s.critical });
  }
  return { present, missing };
}

/** Share (0–1) of each criterion's key terms that appear in the result. */
export function criteriaKeywordCoverage(md: string, criteria: string[]): number[] {
  const have = new Set(terms(md));
  return criteria.map((c) => {
    const t = [...new Set(terms(c))];
    if (!t.length) return 1;
    return Math.round((t.filter((w) => have.has(w)).length / t.length) * 100) / 100;
  });
}

// ---------------------------------------------------------------- combination

export type CheckStatus = "pass" | "warn" | "fail" | "not_assessed";

export interface CheckResult {
  key: "objective_alignment" | "citation_support" | "criteria_coverage" | "completeness" | "consistency";
  label: string;
  status: CheckStatus;
  score: number | null; // 0–100, null when not assessed
  detail: string;
}

const WEIGHTS: Record<CheckResult["key"], number> = {
  objective_alignment: 25,
  citation_support: 25,
  criteria_coverage: 25,
  completeness: 15,
  consistency: 10,
};

export interface CriterionAssessment {
  index: number; // 1-based
  status: "MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";
  measuredValue: number | null;
  measurement: string;
  explanation: string;
}

export interface ModelAssessment {
  alignmentScore: number;
  alignmentRationale: string;
  criteria: CriterionAssessment[];
  consistencyIssues: string[];
  humanJudgment: string[];
}

export interface CombineInput {
  report: string;
  evidenceCount: number;
  claimResults: ClaimResult[];
  criteria: string[];
  model: ModelAssessment | null;
}

export interface CombinedVerification {
  status: VerificationStatus;
  score: number;
  checks: CheckResult[];
  warnings: string[];
  humanJudgment: string[];
  summary: string;
  failures: string[]; // reasons for FAIL, used as revision feedback
}

export function citationCheck(claims: ClaimResult[], evidenceCount: number): CheckResult {
  const cited = claims.filter((c) => c.evidenceNs.length || c.status === "UNSUPPORTED");
  const uncited = claims.filter((c) => c.status === "UNCITED").length;
  const supported = cited.filter((c) => c.status === "SUPPORTED").length;
  const partial = cited.filter((c) => c.status === "PARTIALLY_SUPPORTED").length;
  const unsupported = cited.filter((c) => c.status === "UNSUPPORTED").length;
  const label = "Evidence support";
  if (evidenceCount === 0) {
    return {
      key: "citation_support",
      label,
      status: "warn",
      score: 50,
      detail: "No external evidence was available for this execution, so its claims could not be checked against sources.",
    };
  }
  if (!cited.length) {
    return { key: "citation_support", label, status: "warn", score: 40, detail: "The result does not cite any of the collected evidence." };
  }
  const ratio = (supported + 0.5 * partial) / cited.length;
  const score = Math.max(0, Math.round(ratio * 100 - Math.min(20, uncited * 4)));
  const detail =
    `${supported} of ${cited.length} cited claim${cited.length === 1 ? "" : "s"} matched their evidence` +
    (partial ? `, ${partial} partially` : "") +
    (unsupported ? `, ${unsupported} not found in the cited evidence` : "") +
    (uncited ? `; ${uncited} specific figure${uncited === 1 ? "" : "s"} uncited` : "") +
    ".";
  const status: CheckStatus = cited.length >= 3 && ratio < 0.4 ? "fail" : ratio < 0.75 || uncited > 3 || unsupported > 0 ? "warn" : "pass";
  return { key: "citation_support", label, status, score, detail };
}

export function combineVerification(input: CombineInput): CombinedVerification {
  const checks: CheckResult[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  // 1. Objective alignment (model judgement).
  if (input.model) {
    const s = Math.max(0, Math.min(100, Math.round(input.model.alignmentScore)));
    checks.push({
      key: "objective_alignment",
      label: "Objective alignment",
      status: s < 50 ? "fail" : s < 75 ? "warn" : "pass",
      score: s,
      detail: input.model.alignmentRationale || `Assessed alignment ${s}/100.`,
    });
  } else {
    checks.push({ key: "objective_alignment", label: "Objective alignment", status: "not_assessed", score: null, detail: "The AI verifier was unavailable; alignment was not assessed." });
  }

  // 2. Evidence support (deterministic).
  checks.push(citationCheck(input.claimResults, input.evidenceCount));

  // 3. Success criteria coverage: model statuses when available, otherwise term coverage.
  if (input.criteria.length) {
    let ratio: number;
    let detail: string;
    if (input.model && input.model.criteria.length) {
      const byIdx = new Map(input.model.criteria.map((c) => [c.index, c.status]));
      const vals = input.criteria.map((_, i) => byIdx.get(i + 1) ?? "UNKNOWN");
      const met = vals.filter((v) => v === "MET").length;
      const part = vals.filter((v) => v === "PARTIALLY_MET").length;
      ratio = (met + 0.5 * part) / input.criteria.length;
      detail = `${met} of ${input.criteria.length} criteria met${part ? `, ${part} partially` : ""}.`;
    } else {
      const cov = criteriaKeywordCoverage(input.report, input.criteria);
      ratio = cov.filter((c) => c >= 0.5).length / input.criteria.length;
      detail = `${cov.filter((c) => c >= 0.5).length} of ${input.criteria.length} criteria addressed (term coverage; not judged by the AI verifier).`;
    }
    checks.push({
      key: "criteria_coverage",
      label: "Success criteria coverage",
      status: ratio < 0.4 ? "fail" : ratio < 0.8 ? "warn" : "pass",
      score: Math.round(ratio * 100),
      detail,
    });
  }

  // 4. Completeness (deterministic).
  const sec = sectionCompleteness(input.report);
  const criticalMissing = sec.missing.filter((m) => m.critical);
  const empty = input.report.trim().length < 120;
  checks.push({
    key: "completeness",
    label: "Completeness",
    status: empty || criticalMissing.length ? "fail" : sec.missing.length ? "warn" : "pass",
    score: empty ? 0 : Math.round((sec.present.length / REQUIRED_SECTIONS.length) * 100),
    detail: empty ? "The result is empty or too short." : sec.missing.length ? `Missing: ${sec.missing.map((m) => m.label).join(", ")}.` : "All required sections are present.",
  });

  // 5. Consistency (model judgement).
  if (input.model) {
    const n = input.model.consistencyIssues.length;
    checks.push({
      key: "consistency",
      label: "Internal consistency",
      status: n >= 3 ? "fail" : n > 0 ? "warn" : "pass",
      score: Math.max(0, 100 - n * 25),
      detail: n ? input.model.consistencyIssues.join(" ") : "No contradictions found.",
    });
  } else {
    checks.push({ key: "consistency", label: "Internal consistency", status: "not_assessed", score: null, detail: "The AI verifier was unavailable; consistency was not assessed." });
  }

  for (const c of checks) {
    if (c.status === "fail") failures.push(`${c.label}: ${c.detail}`);
    if (c.status === "warn") warnings.push(`${c.label}: ${c.detail}`);
  }
  for (const c of input.claimResults.filter((r) => r.status === "UNSUPPORTED").slice(0, 5)) {
    warnings.push(`Unsupported claim: "${c.claim.slice(0, 140)}"`);
    if (failures.length) failures.push(`Unsupported claim: "${c.claim.slice(0, 140)}" — ${c.note}`);
  }

  const assessed = checks.filter((c) => c.score !== null);
  const totalW = assessed.reduce((n, c) => n + WEIGHTS[c.key], 0);
  const score = totalW ? Math.round(assessed.reduce((n, c) => n + (c.score ?? 0) * WEIGHTS[c.key], 0) / totalW) : 0;
  const anyFail = checks.some((c) => c.status === "fail");
  const anySoft = checks.some((c) => c.status === "warn" || c.status === "not_assessed");
  const status: VerificationStatus = anyFail ? "FAIL" : anySoft ? "PASS_WITH_WARNINGS" : "PASS";
  const humanJudgment = [...(input.model?.humanJudgment ?? [])];
  if (!input.model) humanJudgment.push("The AI verifier was unavailable: review whether the result meets each success criterion.");
  const summary =
    status === "PASS"
      ? `Passed all checks (score ${score}/100).`
      : status === "PASS_WITH_WARNINGS"
        ? `Passed with ${warnings.length || "some"} warning${warnings.length === 1 ? "" : "s"} (score ${score}/100).`
        : `Failed: ${failures[0] ?? "the result did not meet the bar"} (score ${score}/100).`;
  return { status, score, checks, warnings, humanJudgment, summary, failures };
}
