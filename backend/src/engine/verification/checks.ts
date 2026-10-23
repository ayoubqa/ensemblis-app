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
// The model claim check (claimCheck.ts) may only downgrade a claim.
//
// An evidence-backed research brief (objective kind "research_brief") is held
// to a stricter bar: it is checked against BRIEF_SECTIONS, its sentences are
// typed by section (source / inference / uncertainty / recommendation), an
// uncited Key finding is flagged, only external sources (web, Wikipedia)
// count as support, a brief without external evidence fails, and any
// unsupported cited claim fails the gate. Other objectives keep the rules above.
//
// When the AI verifier could not run, the result is UNVERIFIED unless a
// deterministic check already failed: never "passed with warnings".

import type { ClaimStatus, VerificationStatus } from "@prisma/client";
import { terms } from "../../context/retrieval";
import { BRIEF_SECTIONS, briefSectionFor, isResearchBrief, type BriefClaimType } from "../prompts";

export const VERIFIER_VERSION = "verifier/1.1.0";

/** Claims checked per result (the rest are counted in the warnings). */
export const CLAIM_CAP = 30;
export const BRIEF_CLAIM_CAP = 40;

// ---------------------------------------------------------------- claims

export interface Claim {
  text: string;
  citations: number[];
  numbers: string[];
  isEstimate: boolean;
  /** Research briefs: what kind of statement it is (by section, or by an "Inference:" style label). null otherwise. */
  claimType?: BriefClaimType | null;
  /** Research briefs: the BRIEF_SECTIONS key of the section it appears in (null before / outside a known section). */
  section?: string | null;
}

const CITE_RE = /\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g;

export function parseCitations(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(CITE_RE)) {
    for (const part of m[1].split(/\s*[,;]\s*/)) {
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

const DURATION_UNITS = "(?:second|minute|hour|day|week|month|quarter|year)s?";
function isDuration(text: string, n: string): boolean {
  return new RegExp(`(?<![\\d.])${n}(?:[\\s-]+${DURATION_UNITS}\\b)`, "i").test(text.replace(/(\d)[ ,](?=\d{3}\b)/g, "$1"));
}

function stripMarkdown(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A sentence's own label, which overrides its section's type ("Inference: …", "Open question: …"). */
// A label ends with ":" or a spaced dash ("Inference — …"), so "Action-oriented …" is not one.
const LABEL_END = String.raw`\s*(?::|\s[—–-])\s*`;
const LABELS: { re: RegExp; type: BriefClaimType }[] = [
  { re: new RegExp(`^(?:inferences?|inferred|implications?)${LABEL_END}`, "i"), type: "inference" },
  { re: new RegExp(`^(?:uncertain(?:ty)?|uncertainties|open questions?|unknowns?|unclear|caveats?|limitations?)${LABEL_END}`, "i"), type: "uncertainty" },
  { re: new RegExp(`^(?:recommendations?|recommend(?:ed)?|actions?|next steps?)${LABEL_END}`, "i"), type: "recommendation" },
];

function labelOf(text: string): BriefClaimType | null {
  return LABELS.find((l) => l.re.test(text))?.type ?? null;
}

/** The claim text without its "Inference:" style label (the label is never in the evidence). */
function withoutLabel(text: string): string {
  for (const l of LABELS) if (l.re.test(text)) return text.replace(l.re, "");
  return text;
}

const ESTIMATE_RE = /\b(estimate[ds]?|est\.|approximately|roughly|assum(e|ed|ption)|unverified|unconfirmed)\b/i;

export interface ExtractOptions {
  /** Section-aware extraction for an evidence-backed research brief. */
  brief?: boolean;
  /** Claims kept (default CLAIM_CAP, BRIEF_CLAIM_CAP for a brief). */
  max?: number;
}

interface Unit {
  raw: string;
  section: string | null;
  sectionType: BriefClaimType | null;
  /** The label of the line it came from (applies to every sentence of that line). */
  label: BriefClaimType | null;
  tableHeader: boolean;
}

/**
 * Sentences / bullets / table rows that cite evidence or state specific figures (code is ignored),
 * plus the number of claims beyond the cap that were not kept.
 *
 * For a research brief the extraction knows the BRIEF_SECTIONS: every claim gets a claimType from its
 * section (or its own "Inference:" / "Open question:" label); an uncited declarative sentence under Key
 * findings becomes a claim (UNCITED) because findings must cite an external source; and uncited figures
 * in recommendation and uncertainty sentences are plans or unknowns, not facts, so they are not claims.
 */
export function extractClaimsDetailed(md: string, opts: ExtractOptions = {}): { claims: Claim[]; dropped: number } {
  const brief = !!opts.brief;
  const max = opts.max ?? (brief ? BRIEF_CLAIM_CAP : CLAIM_CAP);
  const noCode = md.replace(/```[\s\S]*?(```|$)/g, "").replace(/`[^`\n]+`/g, "");
  const lines = noCode.split("\n");
  const units: Unit[] = [];
  let section: string | null = null;
  let sectionType: BriefClaimType | null = null;
  const isSeparator = (l: string) => /^\|?\s*:?-{3,}/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^#/.test(l)) {
      if (brief && /^##\s/.test(l)) {
        const s = briefSectionFor(l);
        section = s?.key ?? null;
        sectionType = s?.claimType ?? null;
      }
      continue;
    }
    if (isSeparator(l)) continue;
    if (l.startsWith("|")) {
      const next = (lines[i + 1] ?? "").trim();
      units.push({ raw: l.replace(/\|/g, " "), section, sectionType, label: null, tableHeader: isSeparator(next) });
      continue;
    }
    const body = l.replace(/^([-*+]|\d+[.)])\s+/, "");
    const label = brief ? labelOf(stripMarkdown(body)) : null;
    // Split prose into sentences, keeping citations attached to the sentence they follow.
    for (const s of body.split(/(?<=[.!?](?:\s*\[\d[^\]]*\])*)\s+(?=[A-Z0-9€$"“(])/)) units.push({ raw: s, section, sectionType, label, tableHeader: false });
  }
  const claims: Claim[] = [];
  let dropped = 0;
  for (const u of units) {
    const text = stripMarkdown(u.raw);
    if (text.length < 20) continue;
    const citations = parseCitations(text);
    // Durations ("within 30 days", "a 12-month pilot") are plan details, not figures to source.
    const figures = extractNumbers(text).filter((n) => !isDuration(text, n));
    // A year in an uncited sentence is a date in a plan ("by 2027"); in a cited claim it is checked against the evidence.
    const uncitedFigures = figures.filter((n) => !/^(19|20)\d{2}$/.test(n));
    const isEstimate = ESTIMATE_RE.test(text);
    const claimType: BriefClaimType | null = brief ? (u.label ?? u.sectionType ?? "source") : null;
    let keep: boolean;
    if (citations.length) keep = true;
    else if (!brief) keep = uncitedFigures.length > 0;
    else if (claimType === "recommendation" || claimType === "uncertainty") keep = false;
    else if (uncitedFigures.length) keep = !u.tableHeader;
    // Key findings must cite an external source: an uncited declarative sentence there is flagged.
    // (Questions and lead-ins ending with ":" are not statements.)
    else keep = u.section === "findings" && claimType === "source" && !u.tableHeader && !/[?:]\s*$/.test(text);
    if (!keep) continue;
    if (claims.length >= max) {
      dropped++;
      continue;
    }
    claims.push({
      text: text.replace(CITE_RE, "").replace(/\s+/g, " ").trim(),
      citations,
      numbers: citations.length ? figures : uncitedFigures,
      isEstimate,
      ...(brief ? { claimType, section: u.section } : {}),
    });
  }
  return { claims, dropped };
}

/** Sentences / bullets / table rows that cite evidence or state specific figures. Code is ignored. */
export function extractClaims(md: string, opts: number | ExtractOptions = {}): Claim[] {
  return extractClaimsDetailed(md, typeof opts === "number" ? { max: opts } : opts).claims;
}

export interface ClaimResult {
  claim: string;
  status: ClaimStatus;
  evidenceNs: number[];
  supportScore: number;
  note: string;
  /** Research briefs: source | inference | uncertainty | recommendation (null otherwise). */
  claimType: BriefClaimType | null;
  /** The cited evidence sentence that best matches the claim (deterministic), or null. */
  quote: string | null;
  /** Every cited source is company-provided (company context, a document, the website): not external support. */
  providedOnly?: boolean;
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

const QUOTE_CHARS = 300;

/** The sentence of the cited evidence that shares the most terms and figures with the claim (null when none shares any). */
export function bestQuote(claim: Claim, contents: string[]): string | null {
  const claimTerms = [...new Set(terms(withoutLabel(claim.text)))].filter((t) => !/^\d+$/.test(t));
  if (!claimTerms.length && !claim.numbers.length) return null;
  let best: { s: string; score: number } | null = null;
  for (const content of contents) {
    for (const raw of content.split(/(?<=[.!?])\s+|\n+/)) {
      const s = raw.replace(/\s+/g, " ").trim();
      if (s.length < 12) continue;
      const have = new Set(terms(s));
      const shared = claimTerms.filter((t) => have.has(t)).length;
      const norm = s.replace(/(\d)[ ,](?=\d{3}\b)/g, "$1");
      const figures = claim.numbers.filter((n) => new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?![\\d])`).test(norm)).length;
      const score = shared + 2 * figures;
      if (score > 0 && (!best || score > best.score)) best = { s, score };
    }
  }
  if (!best) return null;
  return best.s.length > QUOTE_CHARS ? `${best.s.slice(0, QUOTE_CHARS - 1).trimEnd()}…` : best.s;
}

export interface CheckEvidence {
  n: number;
  content: string;
  title: string;
  /** False for company-provided material (company context, documents, the company website). Default: external. */
  external?: boolean;
}

const NOT_A_FACT: Partial<Record<BriefClaimType, string>> = {
  recommendation: "A recommendation is a judgement, never a sourced fact",
  uncertainty: "An uncertainty or open question is not a sourced fact",
  inference: "An inference goes beyond what the sources state",
};

export function checkClaims(claims: Claim[], evidence: CheckEvidence[], opts: { brief?: boolean } = {}): ClaimResult[] {
  const byN = new Map(evidence.map((e) => [e.n, e]));
  return claims.map((c) => {
    const claimType = c.claimType ?? null;
    if (!c.citations.length) {
      if (c.isEstimate) return { claim: c.text, status: "ESTIMATE" as const, evidenceNs: [], supportScore: 0, note: "Labelled as an estimate.", claimType, quote: null };
      const note = c.numbers.length
        ? "Specific figure with no citation and not labelled as an estimate."
        : "A key finding with no citation: every finding must cite the external source that states it.";
      return { claim: c.text, status: "UNCITED" as const, evidenceNs: [], supportScore: 0, note, claimType, quote: null };
    }
    const cited = c.citations.map((n) => byN.get(n)).filter((e): e is NonNullable<typeof e> => !!e);
    if (!cited.length) {
      return { claim: c.text, status: "UNSUPPORTED" as const, evidenceNs: c.citations, supportScore: 0, note: "Cites evidence that does not exist.", claimType, quote: null };
    }
    const scored = { ...c, text: withoutLabel(c.text) };
    const { score, numbersFound } = supportScore(scored, cited.map((e) => `${e.title}\n${e.content}`).join("\n"));
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
    const quote = status === "UNSUPPORTED" ? null : bestQuote(c, cited.map((e) => e.content));
    const providedOnly = cited.every((e) => e.external === false);
    if (opts.brief) {
      // Only a source statement backed by an external source can be SUPPORTED.
      const notFact = claimType && claimType !== "source" ? NOT_A_FACT[claimType] : undefined;
      if (status === "SUPPORTED" && notFact) {
        status = "PARTIALLY_SUPPORTED";
        note = `${notFact}: the cited evidence contains its premise, not the conclusion.`;
      }
      if (providedOnly) {
        if (status === "SUPPORTED") status = "PARTIALLY_SUPPORTED";
        note = `Provided context only: the cited material came from the company, not from an external source. ${note}`;
      }
    }
    return { claim: c.text, status, evidenceNs: cited.map((e) => e.n), supportScore: score, note, claimType, quote, ...(opts.brief ? { providedOnly } : {}) };
  });
}

// ---------------------------------------------------------------- structure

export const REQUIRED_SECTIONS: { key: string; label: string; re: RegExp; critical: boolean }[] = [
  { key: "summary", label: "Executive summary", re: /^##\s+.*(summary|overview|answer)/im, critical: true },
  { key: "recommendation", label: "Recommendation", re: /^##\s+.*(recommend|decision|conclusion|result)/im, critical: true },
  { key: "limitations", label: "Limitations & uncertainty", re: /^##\s+.*(limitation|uncertain|caveat|risk|assumption)/im, critical: false },
  { key: "next", label: "Next steps", re: /^##\s+.*(next step|action)/im, critical: false },
];

/** The sections a result is checked against: BRIEF_SECTIONS for a research brief, REQUIRED_SECTIONS otherwise. */
export function requiredSections(opts: { brief?: boolean } = {}): { key: string; label: string; re: RegExp; critical: boolean }[] {
  return opts.brief ? BRIEF_SECTIONS.map((s) => ({ key: s.key, label: s.heading, re: s.re, critical: s.critical })) : REQUIRED_SECTIONS;
}

export function sectionCompleteness(md: string, opts: { brief?: boolean } = {}): { present: string[]; missing: { label: string; critical: boolean }[] } {
  const present: string[] = [];
  const missing: { label: string; critical: boolean }[] = [];
  for (const s of requiredSections(opts)) {
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
  /** Evidence numbers [n] the verdict relies on (only numbers that exist in the execution). */
  evidence?: number[];
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
  /** Every evidence row of the execution (any kind). */
  evidenceCount: number;
  claimResults: ClaimResult[];
  criteria: string[];
  model: ModelAssessment | null;
  /** Objective.kind: "research_brief" applies the brief rules; anything else keeps the general rules. */
  objectiveKind?: string | null;
  /** External evidence (web, Wikipedia) retrieved in this execution. Defaults to evidenceCount. */
  externalEvidenceCount?: number;
  /**
   * Research that failed, returned nothing or did not run, and skipped work steps (service.ts researchIssuesFor).
   * A brief warns on each; any other objective warns on the skipped steps (SKIPPED_STEP_ISSUE).
   */
  researchIssues?: string[];
  /** Research briefs: invented [n] citations removed from the result before it was saved (a warning). */
  citationsRemoved?: number;
  /** Extra notes for the warnings (claims beyond the cap, a claim check that could not run). */
  notes?: string[];
}

export interface CombinedVerification {
  status: VerificationStatus;
  score: number;
  checks: CheckResult[];
  warnings: string[];
  humanJudgment: string[];
  summary: string;
  failures: string[]; // reasons for FAIL, used as revision feedback
  /** Research briefs: no external evidence supports the brief (no external source retrieved, or none cited). */
  insufficientEvidence: boolean;
  /** A research brief's FAIL that one more round of research could fix (insufficient evidence or unsupported claims). */
  needsResearch: boolean;
  /** Some claim is UNSUPPORTED or UNCITED. */
  hasUnsupported: boolean;
}

/** Prefix of the citation-support detail when a brief has no external evidence (also starts the revision feedback). */
export const INSUFFICIENT_EVIDENCE = "Insufficient evidence";

export function citationCheck(claims: ClaimResult[], evidenceCount: number, opts: { brief?: boolean; externalEvidenceCount?: number } = {}): CheckResult {
  const label = "Evidence support";
  if (opts.brief) return briefCitationCheck(claims, opts.externalEvidenceCount ?? evidenceCount);
  const cited = claims.filter((c) => c.evidenceNs.length || c.status === "UNSUPPORTED");
  const uncited = claims.filter((c) => c.status === "UNCITED").length;
  const supported = cited.filter((c) => c.status === "SUPPORTED").length;
  const partial = cited.filter((c) => c.status === "PARTIALLY_SUPPORTED").length;
  const unsupported = cited.filter((c) => c.status === "UNSUPPORTED").length;
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

/**
 * A research brief's evidence check. Only source statements backed by external sources count as
 * support; claims resting on company-provided material are noted, not counted. Fails when no external
 * source was retrieved or cited, or when any cited claim is unsupported.
 */
function briefCitationCheck(claims: ClaimResult[], externalEvidenceCount: number): CheckResult {
  const label = "Evidence support";
  const cited = claims.filter((c) => c.evidenceNs.length || c.status === "UNSUPPORTED");
  const unsupported = cited.filter((c) => c.status === "UNSUPPORTED").length;
  const uncited = claims.filter((c) => c.status === "UNCITED").length;
  const provided = cited.filter((c) => c.providedOnly && c.status !== "UNSUPPORTED").length;
  // Statements of fact that cite at least one external source.
  const factual = cited.filter((c) => (c.claimType ?? "source") === "source" && !c.providedOnly && c.status !== "UNSUPPORTED");
  const factualAll = factual.length + cited.filter((c) => (c.claimType ?? "source") === "source" && c.status === "UNSUPPORTED").length;
  if (externalEvidenceCount === 0) {
    return {
      key: "citation_support",
      label,
      status: "fail",
      score: 0,
      detail: `${INSUFFICIENT_EVIDENCE}: no external sources were retrieved during this execution, so no finding could be checked against an external source.`,
    };
  }
  if (!factual.length) {
    return {
      key: "citation_support",
      label,
      status: "fail",
      score: 0,
      detail:
        `${INSUFFICIENT_EVIDENCE}: no finding in the brief is backed by one of the ${externalEvidenceCount} external source${externalEvidenceCount === 1 ? "" : "s"} retrieved` +
        (unsupported ? `; ${unsupported} cited claim${unsupported === 1 ? " was" : "s were"} not found in the cited evidence` : "") +
        (provided ? `; ${provided} rest${provided === 1 ? "s" : ""} only on company-provided context` : "") +
        ".",
    };
  }
  const supported = factual.filter((c) => c.status === "SUPPORTED").length;
  const partial = factual.filter((c) => c.status === "PARTIALLY_SUPPORTED").length;
  const ratio = (supported + 0.5 * partial) / Math.max(1, factualAll);
  const score = Math.max(0, Math.round(ratio * 100 - Math.min(20, uncited * 4)));
  const detail =
    `${supported} of ${factualAll} cited finding${factualAll === 1 ? "" : "s"} matched an external source` +
    (partial ? `, ${partial} partially` : "") +
    (unsupported ? `; ${unsupported} cited claim${unsupported === 1 ? " was" : "s were"} not found in the cited evidence` : "") +
    (provided ? `; ${provided} claim${provided === 1 ? " rests" : "s rest"} only on company-provided context (not external evidence)` : "") +
    (uncited ? `; ${uncited} statement${uncited === 1 ? "" : "s"} of fact uncited` : "") +
    ".";
  const status: CheckStatus = unsupported > 0 || (factualAll >= 3 && ratio < 0.4) ? "fail" : ratio < 0.75 || uncited > 0 || provided > 0 ? "warn" : "pass";
  return { key: "citation_support", label, status, score, detail };
}

/** A researchIssues line for a skipped work step: `“<title>” was skipped, …` (research lines start "web research in"). */
export const SKIPPED_STEP_ISSUE = /^“[\s\S]+” was skipped\b/;

export function combineVerification(input: CombineInput): CombinedVerification {
  const brief = isResearchBrief(input.objectiveKind);
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
  const citation = citationCheck(input.claimResults, input.evidenceCount, { brief, externalEvidenceCount: input.externalEvidenceCount });
  checks.push(citation);

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

  // 4. Completeness (deterministic): BRIEF_SECTIONS for a research brief.
  const sections = requiredSections({ brief });
  const sec = sectionCompleteness(input.report, { brief });
  const criticalMissing = sec.missing.filter((m) => m.critical);
  const empty = input.report.trim().length < 120;
  checks.push({
    key: "completeness",
    label: "Completeness",
    status: empty || criticalMissing.length ? "fail" : sec.missing.length ? "warn" : "pass",
    score: empty ? 0 : Math.round((sec.present.length / sections.length) * 100),
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
  const unsupportedClaims = input.claimResults.filter((r) => r.status === "UNSUPPORTED");
  for (const c of unsupportedClaims.slice(0, 5)) {
    warnings.push(`Unsupported claim: "${c.claim.slice(0, 140)}"`);
    // A brief fails on any unsupported cited claim; elsewhere it is feedback when the gate already failed.
    if (brief || failures.length) failures.push(`Unsupported claim: "${c.claim.slice(0, 140)}" — ${c.note}`);
  }

  // Warnings that only a brief is judged on (research that didn't deliver, removed invented citations).
  const briefWarnings: string[] = [];
  if (brief) {
    for (const issue of (input.researchIssues ?? []).slice(0, 8)) briefWarnings.push(`Research: ${issue}`);
    const removed = input.citationsRemoved ?? 0;
    if (removed > 0) {
      briefWarnings.push(`${removed} invented citation${removed === 1 ? " was" : "s were"} removed from the brief because ${removed === 1 ? "it" : "they"} pointed at no collected source.`);
    }
  }
  // A skipped work step leaves its work out of the result, whatever the objective: never a plain PASS (a brief warns above).
  const skippedWarnings = brief ? [] : (input.researchIssues ?? []).filter((i) => SKIPPED_STEP_ISSUE.test(i)).slice(0, 8);
  const notes = (input.notes ?? []).filter((n) => n.trim());
  warnings.push(...briefWarnings, ...skippedWarnings, ...notes);

  const assessed = checks.filter((c) => c.score !== null);
  const totalW = assessed.reduce((n, c) => n + WEIGHTS[c.key], 0);
  const score = totalW ? Math.round(assessed.reduce((n, c) => n + (c.score ?? 0) * WEIGHTS[c.key], 0) / totalW) : 0;
  const anyFail = checks.some((c) => c.status === "fail") || (brief && unsupportedClaims.length > 0);
  const anySoft =
    checks.some((c) => c.status === "warn" || c.status === "not_assessed") || skippedWarnings.length > 0 || (brief && (briefWarnings.length > 0 || notes.length > 0));
  // Without the AI verifier the result is not verified, unless a deterministic check already failed it.
  const status: VerificationStatus = anyFail ? "FAIL" : !input.model ? "UNVERIFIED" : anySoft ? "PASS_WITH_WARNINGS" : "PASS";
  const humanJudgment = [...(input.model?.humanJudgment ?? [])];
  if (!input.model) humanJudgment.push("The AI verifier was unavailable: review whether the result meets each success criterion.");
  const summary =
    status === "PASS"
      ? `Passed all checks (score ${score}/100).`
      : status === "PASS_WITH_WARNINGS"
        ? `Passed with ${warnings.length || "some"} warning${warnings.length === 1 ? "" : "s"} (score ${score}/100).`
        : status === "UNVERIFIED"
          ? `Not verified: the AI verifier could not run, so objective alignment, success criteria and consistency were not assessed (deterministic checks: score ${score}/100).`
          : `Failed: ${failures[0] ?? "the result did not meet the bar"} (score ${score}/100).`;
  const insufficientEvidence = brief && citation.status === "fail" && citation.detail.startsWith(INSUFFICIENT_EVIDENCE);
  const hasUnsupported = input.claimResults.some((r) => r.status === "UNSUPPORTED" || r.status === "UNCITED");
  const needsResearch = brief && status === "FAIL" && (insufficientEvidence || unsupportedClaims.length > 0);
  return { status, score, checks, warnings, humanJudgment, summary, failures, insufficientEvidence, needsResearch, hasUnsupported };
}
