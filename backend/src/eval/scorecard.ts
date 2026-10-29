// Quality scorecard for one deliverable: an Ensemblis result or a baseline (a general-purpose
// assistant's answer, a manually researched pack), scored the same way so the controlled test
// can compare them (docs/growth/10-controlled-test.md).
//
// Pure: no database, no network, no model. It measures what can be counted — prospect rows and
// their fields, sources, citations, domains, the verifier's claim verdicts, research status,
// time and credits — and never judges quality. Dimensions that need judgment (relevance,
// accuracy, actionability) come back "needs_manual" with the method a named evaluator follows;
// a dimension is never "pass" while a human part of it is outstanding.
// Dimensions and thresholds: docs/growth/09-quality-scorecard.md.

export const SCORECARD_VERSION = "scorecard/1.0.0";

export type ClaimVerdict = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "UNCITED" | "ESTIMATE";

export interface ScoreSource {
  /** Citation number, when the deliverable cites sources as [n]. */
  n?: number;
  url: string | null;
  title?: string;
  /** WEB | WIKIPEDIA | COMPANY_CONTEXT | WEBSITE | DOCUMENT (Ensemblis evidence kinds). */
  kind?: string;
  provider?: string | null;
}

export interface ScoreStep {
  title: string;
  status: string;
  researchStatus: string | null;
  /** Search providers that answered this step (tavily | wikipedia). */
  providers: string[];
  /** Times the step was attempted (1 = first try). */
  attempts: number;
}

export interface ScoreRun {
  status: string;
  resultState: string | null;
  verificationStatus: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  creditsCharged: number;
  creditsRefunded: number;
  /** The objective's approved credit limit. */
  creditBudget: number | null;
  steps: ScoreStep[];
  /** The latest verification round's claim verdicts. */
  claims: ClaimVerdict[];
  /** The run used the mock model or a search stub (TAVILY_BASE_URL): its output is not evidence of real behaviour. */
  mockAI?: boolean;
  stubSearch?: boolean;
}

export interface ScorecardInput {
  /** Which arm produced it: "Ensemblis", "General-purpose AI", "Manual research". */
  label: string;
  markdown: string;
  /** What [n] refers to (Ensemblis evidence). Baselines usually cite URLs inline instead. */
  sources?: ScoreSource[];
  /** The Ensemblis execution behind the deliverable (absent for baselines). */
  run?: ScoreRun | null;
  /** Prospects the task asked for (the controlled test asks for 20). */
  expectedProspects?: number;
  /** Active minutes the tester spent (measured by the facilitator), and the manual arm's minutes. */
  testerMinutes?: number | null;
  manualBaselineMinutes?: number | null;
}

// ---------------------------------------------------------------- thresholds (09-quality-scorecard.md)

export const THRESHOLDS = {
  /** Share of the requested prospects delivered, and of delivered rows with every required field. */
  deliveredShare: 0.9,
  completeRowShare: 0.9,
  /** Share of rows citing at least one source, and citing the prospect's own website. */
  sourcedRowShare: 1,
  ownSiteRowShare: 0.75,
  /** Verifier: SUPPORTED or PARTIALLY_SUPPORTED among checked claims; UNSUPPORTED at most. */
  supportedClaimShare: 0.85,
  unsupportedClaimShare: 0.05,
  /** Distinct external domains, at least (or half the requested prospects, whichever is more). */
  minDistinctDomains: 10,
  /** Wall-clock minutes from launch to result, at most. */
  maxWallMinutes: 30,
  /** Tester active time as a share of the manual arm's time, at most. */
  maxTesterTimeShare: 0.5,
  /** Step retries in one run, at most. */
  maxRetries: 2,
} as const;

// ---------------------------------------------------------------- parsing

/** Required columns of a prospect table and the header words that identify them. */
export const PROSPECT_FIELDS = {
  company: /\b(company|organi[sz]ation|prospect|account|business)\b/,
  website: /\b(website|site|url|domain|web)\b/,
  characteristics: /\b(characteristics?|profile|size|industry|sector|location|description|about)\b/,
  evidence: /\b(evidence|icp|fit|match)\b/,
  reason: /\b(reason|why|angle|trigger|hook)\b/,
  sources: /\b(sources?|citations?|references?)\b/,
  confidence: /\b(confidence)\b/,
  missing: /\b(missing|unknown|to confirm|gaps?|open)\b/,
} as const;
export type ProspectField = keyof typeof PROSPECT_FIELDS;
const FIELD_ORDER = Object.keys(PROSPECT_FIELDS) as ProspectField[];

export interface ProspectRow {
  company: string;
  /** The prospect's website domain (no www.), when the row gives one. */
  domain: string | null;
  citations: number[];
  /** Domains of every URL in the row and of every source it cites. */
  sourceDomains: string[];
  ownSiteSource: boolean;
  /** Required fields that are missing or empty. */
  missingFields: ProspectField[];
}

const URL_RE = /https?:\/\/[^\s)<>\]|"'`]+/gi;
const DOMAIN_RE = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/i;
const EMPTY_CELL = /^(?:|-|—|–|n\/?a|tbd|\?)$/i;

export function domainOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let host: string | null = null;
  try {
    host = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname;
  } catch {
    host = DOMAIN_RE.exec(t)?.[1] ?? null;
  }
  if (!host || !host.includes(".")) return null;
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** Same site: equal, or one is a subdomain of the other (shop.acme.com and acme.com). */
const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/** [1], [1, 3], [2–4] → 1, 3, 2, 3, 4 (ranges capped at 20 numbers). */
export function citationsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(\d{1,3}(?:\s*(?:[,;]|[-–])\s*\d{1,3})*)\]/g)) {
    for (const part of m[1].split(/\s*[,;]\s*/)) {
      const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])];
        for (let n = a; n <= b && n - a < 20; n++) out.push(n);
      } else if (/^\d+$/.test(part)) out.push(Number(part));
    }
  }
  return out;
}

export const urlsIn = (text: string): string[] => [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ""));

const plainText = (cell: string) =>
  cell
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

interface Table {
  header: string[];
  rows: string[][];
}

function tablesIn(md: string): Table[] {
  const lines = md.split("\n");
  const out: Table[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map((h) => plainText(h).toLowerCase());
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push(splitRow(lines[j]));
    out.push({ header, rows });
    i = j - 1;
  }
  return out;
}

/** Column index per required field (the first header that matches; company and website are never shared). */
function columnsOf(header: string[]): Partial<Record<ProspectField, number>> {
  const cols: Partial<Record<ProspectField, number>> = {};
  const used = new Set<number>();
  // Specific fields first, so "Reason to contact" isn't taken for the company and "ICP fit evidence" for sources.
  for (const f of ["confidence", "missing", "sources", "website", "reason", "evidence", "characteristics", "company"] as ProspectField[]) {
    const i = header.findIndex((h, k) => !used.has(k) && PROSPECT_FIELDS[f].test(h));
    if (i >= 0) {
      cols[f] = i;
      used.add(i);
    }
  }
  return cols;
}

/** The prospect table: the one with a company column and the most rows. */
export function parseProspects(md: string, sources: ScoreSource[] = []): ProspectRow[] {
  const byN = new Map(sources.filter((s) => s.n != null).map((s) => [s.n as number, s]));
  const candidates = tablesIn(md)
    .map((t) => ({ t, cols: columnsOf(t.header) }))
    .filter((c) => c.cols.company != null)
    .sort((a, b) => b.t.rows.length - a.t.rows.length);
  const best = candidates[0];
  if (!best) return [];
  const { t, cols } = best;
  return t.rows
    .filter((r) => r.some((c) => c && !EMPTY_CELL.test(plainText(c))))
    .map((r) => {
      const cell = (f: ProspectField) => (cols[f] != null ? r[cols[f] as number] ?? "" : "");
      const all = r.join(" | ");
      const citations = [...new Set(citationsIn(all))];
      const websiteCell = cell("website");
      const domain = domainOf(urlsIn(websiteCell)[0] ?? plainText(websiteCell));
      // Every URL outside the website column is a source — the prospect's homepage cited as a source included.
      const otherCells = r.filter((_, k) => k !== cols.website).join(" | ");
      const sourceDomains = [
        ...new Set(
          [...urlsIn(otherCells), ...citations.map((n) => byN.get(n)?.url ?? null)]
            .map(domainOf)
            .filter((d): d is string => !!d)
        ),
      ];
      const missingFields = FIELD_ORDER.filter((f) => {
        if (f === "sources") return !citations.length && !urlsIn(cell("sources")).length && EMPTY_CELL.test(plainText(cell("sources")));
        return cols[f] == null || EMPTY_CELL.test(plainText(cell(f)));
      });
      return {
        company: plainText(cell("company")),
        domain,
        citations,
        sourceDomains,
        ownSiteSource: !!domain && sourceDomains.some((d) => sameSite(d, domain)),
        missingFields,
      };
    });
}

// ---------------------------------------------------------------- metrics

const EXTERNAL_KINDS = new Set(["WEB", "WIKIPEDIA"]);
const isExternal = (s: ScoreSource) => (s.kind ? EXTERNAL_KINDS.has(s.kind.toUpperCase()) : !!s.url);
const isLiveWeb = (s: ScoreSource) => s.provider === "tavily" || (s.kind?.toUpperCase() === "WEB" && s.provider !== "wikipedia");
const share = (num: number, den: number) => (den ? num / den : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface ScorecardMetrics {
  words: number;
  prospects: {
    expected: number | null;
    delivered: number;
    complete: number;
    sourced: number;
    ownSite: number;
    duplicates: string[];
    missingFieldCounts: Partial<Record<ProspectField, number>>;
  };
  citations: { used: number[]; invalid: number[] };
  sources: {
    listed: number;
    external: number;
    liveWeb: number;
    wikipedia: number;
    distinctDomains: number;
    duplicateUrls: number;
    externalCited: number;
  };
  sections: { methodology: boolean; summary: boolean; limitations: boolean };
  uncertainty: { inferenceLabels: number; uncertaintyStatements: number };
  run: null | {
    wallMinutes: number | null;
    creditsNet: number;
    creditBudget: number | null;
    researchSteps: number;
    liveWebSteps: number;
    wikipediaOnlySteps: number;
    incompleteResearchSteps: number;
    failedSteps: number;
    retries: number;
    claims: Record<ClaimVerdict, number>;
  };
}

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
const normName = (s: string) => s.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|sarl|sas|bv|plc|co|corp|limited)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");

export function measure(input: ScorecardInput): ScorecardMetrics {
  const md = input.markdown ?? "";
  const sources = input.sources ?? [];
  const rows = parseProspects(md, sources);
  const used = [...new Set(citationsIn(md))].sort((a, b) => a - b);
  const known = new Set(sources.map((s) => s.n).filter((n): n is number => n != null));
  const external = sources.filter(isExternal);
  // A baseline lists its sources inline: its URLs are its external sources.
  const inlineUrls = urlsIn(md);
  const externalUrls = external.length ? external.map((s) => s.url).filter((u): u is string => !!u) : inlineUrls;
  const domains = new Set(externalUrls.map(domainOf).filter((d): d is string => !!d));
  const seenUrl = new Set<string>();
  let duplicateUrls = 0;
  for (const u of external.length ? externalUrls : [...new Set(inlineUrls)]) {
    const k = normUrl(u);
    if (seenUrl.has(k)) duplicateUrls++;
    seenUrl.add(k);
  }
  const seenCompany = new Map<string, string>();
  const duplicates: string[] = [];
  for (const r of rows) {
    for (const key of [r.domain ? `d:${r.domain}` : null, normName(r.company) ? `n:${normName(r.company)}` : null]) {
      if (!key) continue;
      if (seenCompany.has(key)) {
        duplicates.push(r.company || (r.domain ?? "?"));
        break;
      }
      seenCompany.set(key, r.company);
    }
  }
  const missingFieldCounts: Partial<Record<ProspectField, number>> = {};
  for (const r of rows) for (const f of r.missingFields) missingFieldCounts[f] = (missingFieldCounts[f] ?? 0) + 1;

  let run: ScorecardMetrics["run"] = null;
  if (input.run) {
    const r = input.run;
    const start = Date.parse(r.startedAt ?? r.createdAt ?? "");
    const end = Date.parse(r.completedAt ?? "");
    const researched = r.steps.filter((s) => s.status !== "SKIPPED" && s.researchStatus);
    const claims = { SUPPORTED: 0, PARTIALLY_SUPPORTED: 0, UNSUPPORTED: 0, UNCITED: 0, ESTIMATE: 0 } as Record<ClaimVerdict, number>;
    for (const c of r.claims) if (c in claims) claims[c]++;
    run = {
      wallMinutes: Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round(((end - start) / 60_000) * 10) / 10 : null,
      creditsNet: Math.max(0, r.creditsCharged - r.creditsRefunded),
      creditBudget: r.creditBudget,
      researchSteps: researched.length,
      liveWebSteps: researched.filter((s) => s.providers.includes("tavily")).length,
      wikipediaOnlySteps: researched.filter((s) => s.providers.length > 0 && s.providers.every((p) => p === "wikipedia")).length,
      incompleteResearchSteps: researched.filter((s) => ["failed", "no_results", "off"].includes(s.researchStatus as string)).length,
      failedSteps: r.steps.filter((s) => s.status === "FAILED").length,
      retries: r.steps.reduce((n, s) => n + Math.max(0, s.attempts - 1), 0),
      claims,
    };
  }

  return {
    words: md.split(/\s+/).filter(Boolean).length,
    prospects: {
      expected: input.expectedProspects ?? null,
      delivered: rows.length,
      complete: rows.filter((r) => !r.missingFields.length).length,
      sourced: rows.filter((r) => r.citations.length || r.sourceDomains.length).length,
      ownSite: rows.filter((r) => r.ownSiteSource).length,
      duplicates,
      missingFieldCounts,
    },
    citations: { used, invalid: sources.length ? used.filter((n) => !known.has(n)) : [] },
    sources: {
      listed: sources.length,
      external: external.length || new Set(inlineUrls.map(normUrl)).size,
      liveWeb: external.length ? external.filter(isLiveWeb).length : new Set(inlineUrls.map(normUrl)).size,
      wikipedia: external.length ? external.filter((s) => s.provider === "wikipedia" || s.kind?.toUpperCase() === "WIKIPEDIA").length : inlineUrls.filter((u) => /wikipedia\.org/i.test(u)).length,
      distinctDomains: domains.size,
      duplicateUrls,
      externalCited: external.filter((s) => s.n != null && used.includes(s.n)).length,
    },
    sections: {
      // "Success criteria" and "Executive summary" are not a ranking method or a strongest-prospects summary.
      methodology: /^#{1,4}\s.*\b(method|methodology|ranking|scoring)\b/im.test(md),
      summary: /^#{1,4}\s.*\b(strongest|top \d+|top prospects|best prospects|shortlist)\b/im.test(md),
      limitations: /^#{1,4}\s.*\b(limitations?|uncertaint|evidence gaps?|open questions?|what to confirm|caveats?)\b/im.test(md),
    },
    uncertainty: {
      inferenceLabels: (md.match(/\bInference:/g) ?? []).length,
      uncertaintyStatements: (
        md.match(/\b(uncertain(?:ty)?|unclear|unknown|not (?:confirmed|verified|found)|unverified|could not (?:find|confirm|verify)|no (?:public )?evidence|assum(?:e|ed|ption)|estimated?|likely|may be)\b/gi) ?? []
      ).length,
    },
    run,
  };
}

// ---------------------------------------------------------------- dimensions

export type DimensionKey =
  | "task_completion"
  | "source_relevance"
  | "evidence_coverage"
  | "factual_accuracy"
  | "citation_quality"
  | "research_coverage"
  | "uncertainty_handling"
  | "actionability"
  | "reliability"
  | "efficiency";

export type DimensionStatus = "pass" | "fail" | "needs_manual" | "not_measurable";

export interface DimensionResult {
  key: DimensionKey;
  name: string;
  method: "automated" | "manual" | "mixed";
  threshold: string;
  measured: string[];
  /** Automated checks that failed (a mixed dimension fails on these before any manual review). */
  failures: string[];
  status: DimensionStatus;
  /** What the evaluator does for the manual part. */
  manual?: string;
}

export interface Scorecard {
  version: string;
  label: string;
  /** Why this scorecard is not evidence of real behaviour (mock model, stub search), if it isn't. */
  warnings: string[];
  metrics: ScorecardMetrics;
  dimensions: DimensionResult[];
}

const RELIABLE_STATES = new Set(["verified", "verified_with_warnings"]);

function dim(
  key: DimensionKey,
  name: string,
  method: DimensionResult["method"],
  threshold: string,
  measured: string[],
  failures: string[],
  manual?: string,
  measurable = true
): DimensionResult {
  const status: DimensionStatus = !measurable ? "not_measurable" : failures.length ? "fail" : method === "automated" ? "pass" : "needs_manual";
  return { key, name, method, threshold, measured, failures, status, ...(manual ? { manual } : {}) };
}

export function scorecard(input: ScorecardInput): Scorecard {
  const m = measure(input);
  const p = m.prospects;
  const expected = p.expected ?? p.delivered;
  const d: DimensionResult[] = [];
  const minDomains = Math.max(THRESHOLDS.minDistinctDomains, Math.ceil(expected / 2));

  // 1. Task completion
  {
    const f: string[] = [];
    if (share(p.delivered, expected) < THRESHOLDS.deliveredShare || !p.delivered) f.push(`${p.delivered}/${expected} prospects delivered (needs ≥ ${pct(THRESHOLDS.deliveredShare)})`);
    if (p.delivered && share(p.complete, p.delivered) < THRESHOLDS.completeRowShare) f.push(`${p.complete}/${p.delivered} rows have every required field (needs ≥ ${pct(THRESHOLDS.completeRowShare)})`);
    if (!m.sections.methodology) f.push("no ranking methodology section");
    if (!m.sections.summary) f.push("no summary of the strongest prospects");
    if (input.run && !["verified", "verified_with_warnings", "partial", "unverified", "accepted_failed_verification"].includes(input.run.resultState ?? "")) {
      f.push(`the run did not deliver a result (state ${input.run.resultState ?? "unknown"})`);
    }
    const missing = Object.entries(p.missingFieldCounts).map(([k, n]) => `${k} missing in ${n}`);
    d.push(
      dim(
        "task_completion",
        "Task completion",
        "mixed",
        `≥ ${pct(THRESHOLDS.deliveredShare)} of the requested prospects, ≥ ${pct(THRESHOLDS.completeRowShare)} of rows with every required field, methodology and summary present; evaluator confirms nothing requested is missing`,
        [`${p.delivered}/${expected} prospects`, `${p.complete} complete rows`, ...(missing.length ? [missing.join(", ")] : []), `methodology ${m.sections.methodology ? "yes" : "no"}`, `summary ${m.sections.summary ? "yes" : "no"}`],
        f,
        "Read the brief and the deliverable side by side; list anything requested that is absent or only gestured at."
      )
    );
  }

  // 2. Source relevance (judgment; the counts are context)
  d.push(
    dim(
      "source_relevance",
      "Source relevance",
      "manual",
      "≥ 80% of sampled citations point to a source about that prospect (or its market) that supports the cited statement",
      [`${m.sources.distinctDomains} distinct external domains`, `${m.sources.externalCited}/${m.sources.external} external sources cited`, `${m.sources.duplicateUrls} duplicate URLs`],
      [],
      "Sample 20 citations (2 from each of 10 random rows). Mark each relevant / irrelevant to the statement it is attached to; relevance = relevant ÷ sampled."
    )
  );

  // 3. Evidence coverage
  {
    const f: string[] = [];
    if (!p.delivered) f.push("no prospect rows found");
    else {
      if (share(p.sourced, p.delivered) < THRESHOLDS.sourcedRowShare) f.push(`${p.delivered - p.sourced} prospect rows cite no source`);
      if (share(p.ownSite, p.delivered) < THRESHOLDS.ownSiteRowShare) f.push(`${p.ownSite}/${p.delivered} rows cite the prospect's own website (needs ≥ ${pct(THRESHOLDS.ownSiteRowShare)})`);
    }
    d.push(
      dim(
        "evidence_coverage",
        "Evidence coverage",
        "automated",
        `every prospect row cites ≥ 1 source; ≥ ${pct(THRESHOLDS.ownSiteRowShare)} cite the prospect's own website`,
        [`${p.sourced}/${p.delivered} rows sourced`, `${p.ownSite}/${p.delivered} rows cite their own website`],
        f
      )
    );
  }

  // 4. Factual accuracy (judgment)
  d.push(
    dim(
      "factual_accuracy",
      "Factual accuracy",
      "manual",
      "0 fabricated companies or websites; ≥ 90% of sampled facts correct",
      [`${p.delivered} companies, ${p.delivered - (p.missingFieldCounts.website ?? 0)} with a website`],
      [],
      "Open every listed website: the company must exist and match the row. Then check 2 facts per row for 10 random rows (20 facts) against the live site or the cited source: correct / wrong / unverifiable. Any fabricated company or website fails the dimension."
    )
  );

  // 5. Citation quality
  {
    const f: string[] = [];
    if (m.citations.invalid.length) f.push(`citations to sources that don't exist: ${m.citations.invalid.map((n) => `[${n}]`).join(", ")}`);
    const measured = [`${m.citations.used.length} sources cited`, `${m.citations.invalid.length} invalid citations`];
    if (m.run) {
      const c = m.run.claims;
      const checked = c.SUPPORTED + c.PARTIALLY_SUPPORTED + c.UNSUPPORTED + c.UNCITED;
      measured.push(`verifier: ${c.SUPPORTED} supported, ${c.PARTIALLY_SUPPORTED} partial, ${c.UNSUPPORTED} unsupported, ${c.UNCITED} uncited (of ${checked})`);
      if (checked && share(c.SUPPORTED + c.PARTIALLY_SUPPORTED, checked) < THRESHOLDS.supportedClaimShare) f.push(`${pct(share(c.SUPPORTED + c.PARTIALLY_SUPPORTED, checked))} of checked claims supported (needs ≥ ${pct(THRESHOLDS.supportedClaimShare)})`);
      if (checked && share(c.UNSUPPORTED, checked) > THRESHOLDS.unsupportedClaimShare) f.push(`${pct(share(c.UNSUPPORTED, checked))} of checked claims unsupported (allowed ≤ ${pct(THRESHOLDS.unsupportedClaimShare)})`);
    }
    if (!m.citations.used.length && !urlsIn(input.markdown).length) f.push("nothing is cited");
    d.push(
      dim(
        "citation_quality",
        "Citation quality",
        "mixed",
        `0 citations to non-existent sources; verifier ≥ ${pct(THRESHOLDS.supportedClaimShare)} supported, ≤ ${pct(THRESHOLDS.unsupportedClaimShare)} unsupported (Ensemblis); evaluator: ≥ 90% of 10 spot-checked citations say what they are cited for`,
        measured,
        f,
        "Open 10 cited sources (the same for every arm's equivalent claims where possible) and mark whether the source states what it is cited for."
      )
    );
  }

  // 6. Research coverage
  {
    const f: string[] = [];
    if (m.sources.distinctDomains < minDomains) f.push(`${m.sources.distinctDomains} distinct external domains (needs ≥ ${minDomains})`);
    const measured = [`${m.sources.external} external sources (${m.sources.liveWeb} live web, ${m.sources.wikipedia} Wikipedia)`, `${m.sources.distinctDomains} distinct domains`];
    if (m.run) {
      measured.push(`${m.run.liveWebSteps}/${m.run.researchSteps} research steps on the live web`);
      if (m.run.wikipediaOnlySteps) f.push(`${m.run.wikipediaOnlySteps} research step(s) had Wikipedia only (no live web search)`);
      if (m.run.incompleteResearchSteps) f.push(`${m.run.incompleteResearchSteps} research step(s) failed, found nothing or did not run`);
      if (!m.run.researchSteps) f.push("no web research ran");
    }
    d.push(dim("research_coverage", "Research coverage", "automated", `live web search on every research step; ≥ ${minDomains} distinct external domains`, measured, f));
  }

  // 7. Uncertainty handling
  {
    const f: string[] = [];
    if (!p.delivered) f.push("no prospect rows to state confidence or missing information for");
    if ((p.missingFieldCounts.confidence ?? 0) > 0) f.push(`${p.missingFieldCounts.confidence} rows without a confidence indicator`);
    if ((p.missingFieldCounts.missing ?? 0) > 0) f.push(`${p.missingFieldCounts.missing} rows without missing information stated`);
    if (!m.sections.limitations) f.push("no limitations / open questions section");
    d.push(
      dim(
        "uncertainty_handling",
        "Uncertainty handling",
        "mixed",
        "every row has a confidence indicator and its missing information; a limitations section; evaluator rates ≥ 4/5",
        [`${m.uncertainty.inferenceLabels} "Inference:" labels`, `${m.uncertainty.uncertaintyStatements} uncertainty statements`, `limitations section ${m.sections.limitations ? "yes" : "no"}`],
        f,
        "Rate 1–5: thin or missing evidence is said plainly; inference is labelled as inference; no unsupported claim is stated as fact."
      )
    );
  }

  // 8. Actionability (the tester's judgment)
  d.push(
    dim(
      "actionability",
      "Actionability",
      "manual",
      "tester rates ≥ 4/5, and would contact ≥ 5 of the prospects after ≤ 10 minutes of extra checking each",
      [`${p.delivered} prospects ranked`],
      [],
      "Ask the tester (without prompting): which prospects would you contact, and what would you still need to check first? Then: 1–5, how ready is this to act on?"
    )
  );

  // 9. Reliability (one run; the experiment aggregates the failure rate across runs)
  {
    const f: string[] = [];
    const measured: string[] = [];
    if (m.run && input.run) {
      measured.push(`status ${input.run.status}, result ${input.run.resultState ?? "—"}`, `${m.run.failedSteps} failed steps`, `${m.run.retries} retries`);
      if (input.run.status !== "COMPLETED") f.push(`the run ended ${input.run.status}`);
      else if (!RELIABLE_STATES.has(input.run.resultState ?? "")) f.push(`result state ${input.run.resultState ?? "unknown"} (needs verified or verified with warnings)`);
      if (m.run.failedSteps) f.push(`${m.run.failedSteps} step(s) failed`);
      if (m.run.retries > THRESHOLDS.maxRetries) f.push(`${m.run.retries} step retries (allowed ≤ ${THRESHOLDS.maxRetries})`);
    }
    d.push(
      dim(
        "reliability",
        "Reliability",
        "automated",
        `the run completes and is verified (or verified with warnings) with no failed step and ≤ ${THRESHOLDS.maxRetries} retries; across the experiment ≥ 90% of runs do`,
        measured,
        f,
        undefined,
        !!m.run
      )
    );
  }

  // 10. Efficiency
  {
    const f: string[] = [];
    const measured: string[] = [];
    let needsManual = true;
    if (m.run) {
      measured.push(`${m.run.wallMinutes ?? "?"} min wall-clock`, `${m.run.creditsNet} credits${m.run.creditBudget ? ` of a ${m.run.creditBudget} budget` : ""}`);
      if (m.run.wallMinutes != null && m.run.wallMinutes > THRESHOLDS.maxWallMinutes) f.push(`${m.run.wallMinutes} min from launch to result (allowed ≤ ${THRESHOLDS.maxWallMinutes})`);
      if (m.run.creditBudget && m.run.creditsNet > m.run.creditBudget) f.push("spent more credits than the approved budget");
    }
    if (input.testerMinutes != null) {
      measured.push(`${input.testerMinutes} min tester time`);
      if (input.manualBaselineMinutes) {
        needsManual = false;
        const ratio = input.testerMinutes / input.manualBaselineMinutes;
        measured.push(`${pct(ratio)} of the manual arm's ${input.manualBaselineMinutes} min`);
        if (ratio > THRESHOLDS.maxTesterTimeShare) f.push(`tester time is ${pct(ratio)} of manual research (allowed ≤ ${pct(THRESHOLDS.maxTesterTimeShare)})`);
      }
    }
    d.push(
      dim(
        "efficiency",
        "Efficiency",
        needsManual ? "mixed" : "automated",
        `≤ ${THRESHOLDS.maxWallMinutes} min from launch to result, within the credit budget; tester active time ≤ ${pct(THRESHOLDS.maxTesterTimeShare)} of the manual arm's`,
        measured,
        f,
        needsManual ? "Record the tester's active minutes (writing the brief, answering questions, reviewing) and the manual arm's total minutes." : undefined
      )
    );
  }

  const warnings: string[] = [];
  if (input.run?.mockAI) warnings.push("This run used the mock AI provider: its output is a placeholder, not evidence of how Ensemblis performs.");
  if (input.run?.stubSearch) warnings.push("This run's web search went to a custom endpoint (TAVILY_BASE_URL), not the public Tavily API: its sources are not live results.");
  return { version: SCORECARD_VERSION, label: input.label, warnings, metrics: m, dimensions: d };
}

// ---------------------------------------------------------------- report

const STATUS_LABEL: Record<DimensionStatus, string> = { pass: "PASS", fail: "FAIL", needs_manual: "NEEDS EVALUATOR", not_measurable: "N/A" };

export function renderScorecard(card: Scorecard): string {
  const lines = [
    `# Quality scorecard — ${card.label}`,
    "",
    `${card.version}. Automated measurements only: a dimension marked NEEDS EVALUATOR has no score until a named evaluator completes its manual part. FAIL means an automated threshold was missed.`,
    "",
    ...card.warnings.map((w) => `> **Not evidence:** ${w}\n`),
    "| # | Dimension | Method | Status | Measured | Automated failures | Minimum threshold |",
    "|---|---|---|---|---|---|---|",
    ...card.dimensions.map(
      (x, i) =>
        `| ${i + 1} | ${x.name} | ${x.method} | ${STATUS_LABEL[x.status]} | ${x.measured.join("; ").replace(/\|/g, "/") || "—"} | ${x.failures.join("; ").replace(/\|/g, "/") || "—"} | ${x.threshold.replace(/\|/g, "/")} |`
    ),
    "",
    "## Evaluator worksheet",
    "",
    ...card.dimensions
      .filter((x) => x.manual)
      .flatMap((x) => [`- **${x.name}** — ${x.manual}`, "  - Evaluator: ____  Result: ____  Notes: ____"]),
    "",
  ];
  return lines.join("\n");
}
