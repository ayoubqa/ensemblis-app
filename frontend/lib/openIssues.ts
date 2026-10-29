// The console's honest reading of an execution, as pure functions (no React, no fetch):
// - collectOpenIssues(): every unresolved item in one list — failed or warning checks,
//   claims the evidence doesn't support, criteria not met or not assessed, items that need
//   human judgment, the plan's open questions, research that failed and the reasons the
//   result is not plainly verified. Empty only when every one of those sources is empty.
// - resultStateOf() / usedMockAI(): the result state and the mock flag, with a fallback for
//   an API that predates them (the frontend and the API deploy separately).
// - listedResultState() / unfinishedStep() / verificationStopped(): what a list row says about a
//   result, and how a step or the verification gate reads once a run ended without finishing it.
// - modelEndpointTag() / endpointNote() / listedEndpointTag(): a test stub or local model endpoint,
//   or a custom search endpoint, as recorded with the execution.
// - researchNotice(): whether web research ran and how it went, for the Evidence panel.

import type {
  Evidence,
  ExceptionItem,
  ExecutionEndpoints,
  ExecutionStatus,
  ExecutionStep,
  OutcomeMeasurement,
  PlanInfo,
  ResultState,
  SearchAttempt,
  SuccessCriterion,
  Verification,
  VerificationStatus,
} from "./api";

export type OpenIssueKind = "exception" | "result" | "research" | "check" | "claim" | "criterion" | "judgment" | "question";
export type OpenIssueSeverity = "bad" | "warn" | "info";

export interface OpenIssue {
  kind: OpenIssueKind;
  severity: OpenIssueSeverity;
  title: string;
  detail?: string;
  /** In-page anchor of the section that holds the item. */
  href: string;
}

export interface OpenIssuesInput {
  verification?: (Pick<Verification, "checks" | "claims" | "humanJudgment"> & Partial<Pick<Verification, "criteria">>) | null;
  measurements?: Pick<OutcomeMeasurement, "criterionId" | "result" | "measurement" | "explanation">[];
  criteria?: Pick<SuccessCriterion, "id" | "description">[];
  plan?: Pick<PlanInfo, "missingInformation"> | null;
  steps?: (Pick<ExecutionStep, "title" | "status"> & Partial<Pick<ExecutionStep, "researchStatus" | "research">>)[];
  resultState?: ResultState | null;
  resultReasons?: string[];
  exceptions?: Pick<ExceptionItem, "status" | "title">[];
}

/** Where each kind of item is shown on the console. */
export const ISSUE_SECTION: Record<OpenIssueKind, string> = {
  exception: "#cs-attention",
  result: "#cs-execution",
  research: "#evidence",
  check: "#verification",
  claim: "#verification-claims",
  criterion: "#outcome",
  judgment: "#verification",
  question: "#cs-plan",
};

export const ISSUE_GROUP_TITLE: Record<OpenIssueKind, string> = {
  exception: "Needs your decision",
  result: "Why the result is not plainly verified",
  research: "Research",
  check: "Verification checks",
  claim: "Claims the evidence doesn't support",
  criterion: "Success criteria",
  judgment: "Needs human judgment",
  question: "Open questions from the plan",
};

const ORDER: OpenIssueKind[] = ["exception", "result", "research", "check", "claim", "criterion", "judgment", "question"];

const clip = (s: string, max = 180) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const provider = (p: string) => (p === "tavily" ? "Tavily" : p === "wikipedia" ? "Wikipedia" : p);

/** "Tavily: HTTP 401 · Wikipedia: no results" — one entry per provider and failure. */
export function failedSearchSummary(attempts: NonNullable<ExecutionStep["research"]>["attempts"]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const a of attempts) {
    if (a.ok) continue;
    const why = a.httpStatus ? `HTTP ${a.httpStatus}` : a.error ? clip(a.error, 90) : "failed";
    const key = `${a.provider}\u0000${why}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${provider(a.provider)}: ${why}`);
  }
  return parts.join(" · ");
}

const RESEARCH_TITLE: Record<string, { title: (step: string) => string; severity: OpenIssueSeverity }> = {
  failed: { title: (s) => `Web research failed in ${s}: no external sources were retrieved`, severity: "bad" },
  no_results: { title: (s) => `Web research in ${s} returned no usable sources`, severity: "warn" },
  off: { title: (s) => `Web search is off on this server, so ${s} ran without web research`, severity: "warn" },
  degraded: { title: (s) => `Web research in ${s} was degraded: a fallback search provider was used`, severity: "warn" },
};

const named = (title: string | null | undefined) => (title?.trim() ? `"${title.trim()}"` : "a step");

/** Every unresolved item, grouped by kind in display order. Empty only when every source is empty. */
export function collectOpenIssues(input: OpenIssuesInput): OpenIssue[] {
  const out: OpenIssue[] = [];
  const push = (kind: OpenIssueKind, severity: OpenIssueSeverity, title: string, detail?: string | null) =>
    out.push({ kind, severity, title, ...(detail ? { detail } : {}), href: ISSUE_SECTION[kind] });

  // Decisions waiting for a person.
  for (const x of input.exceptions ?? []) if (x.status === "OPEN") push("exception", "bad", x.title);

  // Research that didn't deliver (a skipped step's research no longer matters).
  const researchSteps = new Set<string>();
  for (const s of input.steps ?? []) {
    if (s.status === "SKIPPED" || !s.researchStatus) continue;
    const m = RESEARCH_TITLE[s.researchStatus];
    if (!m) continue;
    researchSteps.add(named(s.title));
    push("research", m.severity, m.title(named(s.title)), s.research ? failedSearchSummary(s.research.attempts) || null : null);
  }

  // Why the result is not plainly verified. "Verification passed…" is a verdict, not an issue; a
  // reason about a step's research is already listed above, and "Paused…" is the open exception.
  const state = input.resultState ?? null;
  const resultSeverity: OpenIssueSeverity = state === "failed" || state === "accepted_failed_verification" ? "bad" : state === "cancelled" ? "info" : "warn";
  const hasOpenException = out.some((i) => i.kind === "exception");
  for (const r of input.resultReasons ?? []) {
    if (/^Verification passed/i.test(r)) continue;
    if (hasOpenException && /^Paused until/i.test(r)) continue;
    // A cancelled or failed run delivered no result: an older API still said each step it never
    // ran "was skipped, so the result was produced without it", which isn't true.
    if (deliveredNothing(state) && /so the result was produced without it\.?$/i.test(r)) continue;
    if (/research|web search/i.test(r) && [...researchSteps].some((t) => r.includes(t))) continue;
    push("result", resultSeverity, r);
  }

  const v = input.verification;
  if (v) {
    for (const c of v.checks) {
      if (c.status === "fail") push("check", "bad", c.label, c.detail);
      else if (c.status === "warn") push("check", "warn", c.label, c.detail);
    }
    for (const c of v.claims) {
      if (c.status === "UNSUPPORTED") push("claim", "bad", `Not found in the cited evidence: “${clip(c.claim)}”`, c.note || null);
      else if (c.status === "UNCITED") push("claim", "warn", `Uncited figure: “${clip(c.claim)}”`, c.note || null);
    }
  }

  // Criteria: the recorded outcome when there is one, otherwise the verifier's verdicts.
  const criteria = input.criteria ?? [];
  const describe = (i: number, id?: string) => {
    const c = id ? criteria.find((x) => x.id === id) : criteria[i - 1];
    const n = id ? criteria.findIndex((x) => x.id === id) + 1 : i;
    return { n: n > 0 ? n : null, text: c?.description ?? null };
  };
  const criterion = (result: string, n: number | null, text: string | null, detail: string) => {
    const label = n ? `Criterion ${n}` : "A criterion";
    const what = result === "NOT_MET" ? "not met" : result === "PARTIALLY_MET" ? "partially met" : "not assessed";
    push("criterion", result === "NOT_MET" ? "bad" : "warn", `${label} ${what}${text ? `: ${clip(text, 140)}` : ""}`, detail || null);
  };
  const measured = input.measurements ?? [];
  if (measured.length) {
    for (const m of measured) {
      if (m.result === "MET") continue;
      const d = describe(0, m.criterionId);
      criterion(m.result, d.n, d.text, [m.measurement, m.explanation].filter(Boolean).join(" — "));
    }
  } else {
    for (const c of v?.criteria ?? []) {
      if (c.status === "MET") continue;
      const d = describe(c.index);
      out.push({
        kind: "criterion",
        severity: c.status === "NOT_MET" ? "bad" : "warn",
        title: `Criterion ${c.index} ${c.status === "NOT_MET" ? "not met" : c.status === "PARTIALLY_MET" ? "partially met" : "not assessed"}${d.text ? `: ${clip(d.text, 140)}` : ""}`,
        ...([c.measurement, c.explanation].filter(Boolean).length ? { detail: [c.measurement, c.explanation].filter(Boolean).join(" — ") } : {}),
        href: "#verification-criteria",
      });
    }
  }

  for (const h of v?.humanJudgment ?? []) push("judgment", "info", h);
  for (const q of input.plan?.missingInformation ?? []) push("question", q.blocking ? "warn" : "info", q.question, q.whyItMatters || null);

  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

export interface OpenIssueGroup {
  kind: OpenIssueKind;
  title: string;
  items: OpenIssue[];
}

/** A cancelled or failed execution: it ended without delivering a result (there is no report). */
export function deliveredNothing(state: ResultState | null | undefined): boolean {
  return state === "cancelled" || state === "failed";
}

/**
 * Issues grouped by kind, in display order (empty groups left out). For an execution that
 * delivered nothing (`state` cancelled or failed), the result reasons say why there is no result.
 */
export function groupOpenIssues(issues: OpenIssue[], state?: ResultState | null): OpenIssueGroup[] {
  const title = (kind: OpenIssueKind) => (kind === "result" && deliveredNothing(state) ? "Why there is no result" : ISSUE_GROUP_TITLE[kind]);
  return ORDER.map((kind) => ({ kind, title: title(kind), items: issues.filter((i) => i.kind === kind) })).filter((g) => g.items.length);
}

// ---------------------------------------------------------------- result state + mock flag

/**
 * The execution's result state. Taken from the API (engine/resultState.ts); an API that
 * predates it gets a conservative reading from status and verification only.
 */
export function resultStateOf(ex: {
  status: ExecutionStatus;
  verificationStatus: VerificationStatus | null;
  resultState?: ResultState | null;
  steps?: Pick<ExecutionStep, "status" | "kind">[];
}): ResultState {
  if (ex.resultState) return ex.resultState;
  switch (ex.status) {
    case "BLOCKED":
      return "blocked";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "COMPLETED":
      break;
    default:
      return "in_progress";
  }
  if (ex.verificationStatus === "FAIL") return "accepted_failed_verification";
  if (ex.verificationStatus === "UNVERIFIED" || !ex.verificationStatus) return "unverified";
  if ((ex.steps ?? []).some((s) => s.kind !== "revision" && (s.status === "SKIPPED" || s.status === "FAILED"))) return "partial";
  return ex.verificationStatus === "PASS_WITH_WARNINGS" ? "verified_with_warnings" : "verified";
}

/** Result states of a finished execution that are not plainly verified. */
export const NOT_PLAINLY_VERIFIED: readonly ResultState[] = ["partial", "unverified", "accepted_failed_verification"];

/**
 * The result state a list row shows next to its outcome: that of a completed execution whose
 * result is not plainly verified (partial, not verified, accepted after failing verification,
 * verified with warnings). Null otherwise: the row's verification tag says the rest.
 */
export function listedResultState(ex: Parameters<typeof resultStateOf>[0] | null | undefined): ResultState | null {
  if (!ex || ex.status !== "COMPLETED") return null;
  const state = resultStateOf(ex);
  return state === "verified" ? null : state;
}

/** The score a result-state tag carries ("97"): none for a verification that could not run. */
export function resultScore(ex: { verificationStatus: VerificationStatus | null; verificationScore: number | null } | null | undefined): string | null {
  return ex?.verificationScore != null && ex.verificationStatus !== "UNVERIFIED" ? `${ex.verificationScore}` : null;
}

/** How a step reads when a cancelled or failed run ended without finishing it. */
export type UnfinishedStep = "not_run" | "stopped";

export const UNFINISHED_STEP: Record<UnfinishedStep, { label: string; title: string }> = {
  not_run: { label: "Not run", title: "The execution ended before this step ran." },
  stopped: { label: "Stopped", title: "The execution ended before this step finished." },
};

/**
 * A step a cancelled or failed run ended without finishing (null otherwise). Ending a run marks
 * every unfinished step SKIPPED and leaves completedAt unset: "not_run" when it never started,
 * "stopped" when it was working or waiting to retry. A person can only skip a step that failed,
 * and failing set its completedAt, so that step stays "Skipped". A completedAt older than the step's
 * latest start (or a step reset by "Retry", attempts 0) is from an earlier failure, not a finish.
 */
export function unfinishedStep(
  step: Pick<ExecutionStep, "status" | "startedAt" | "completedAt" | "attempts">,
  executionStatus: ExecutionStatus
): UnfinishedStep | null {
  if (step.status !== "SKIPPED" || (executionStatus !== "CANCELLED" && executionStatus !== "FAILED")) return null;
  const finished = !!step.completedAt && step.attempts > 0 && (!step.startedAt || Date.parse(step.completedAt) >= Date.parse(step.startedAt));
  if (finished) return null;
  return step.startedAt ? "stopped" : "not_run";
}

/**
 * The run ended (cancelled or failed) while the verification gate was working: every work step
 * finished (done, or skipped by a person) and no verification was recorded.
 */
export function verificationStopped(ex: {
  status: ExecutionStatus;
  verification?: unknown;
  steps: Pick<ExecutionStep, "status" | "kind" | "startedAt" | "completedAt" | "attempts">[];
}): boolean {
  if (ex.verification || (ex.status !== "CANCELLED" && ex.status !== "FAILED")) return false;
  const work = ex.steps.filter((s) => s.kind === "work");
  return work.length > 0 && work.every((s) => s.status === "COMPLETED" || (s.status === "SKIPPED" && !unfinishedStep(s, ex.status)));
}

/**
 * Whether this execution's output must carry the mock label: it ran on the mock provider
 * (from the API, or from its steps for an older API), or the server is on mock AI now.
 */
export function usedMockAI(ex: { usedMockAI?: boolean; steps?: Pick<ExecutionStep, "provider">[] } | null | undefined, serverMock = false): boolean {
  return serverMock || !!ex?.usedMockAI || (ex?.steps ?? []).some((s) => s.provider === "mock");
}

/** The tag on mock output, wherever it is listed. */
export const MOCK_TAG_LABEL = "Mock AI — test output";

/** The note carried by exports of mock output (replaces the default AI note). */
export const MOCK_EXPORT_NOTE = "Mock AI — test output. Generated by the mock AI provider for development and testing, not real analysis.";

// ---------------------------------------------------------------- endpoints (recorded with the execution)

/** The tag on output whose model calls went to a test stub or a local model endpoint. */
export const MODEL_ENDPOINT_TAG: Record<"stub" | "local", string> = {
  stub: "Test stub endpoint — not a real model",
  local: "Local model endpoint",
};

/** What the model endpoint tag means, in a sentence. */
export const MODEL_ENDPOINT_DETAIL: Record<"stub" | "local", string> = {
  stub: "Model calls went to a test stub endpoint: the plan and outputs are not a real model's analysis.",
  local: "Model calls went to a model on this machine or a private network: a self-hosted model, or a test endpoint.",
};

/** Said wherever an execution's web search went to TAVILY_BASE_URL (the Evidence panel sets `head` in bold). */
export const CUSTOM_SEARCH = { head: "Custom search endpoint", text: "sources come from TAVILY_BASE_URL, not the public Tavily API." };
export const CUSTOM_SEARCH_NOTE = `${CUSTOM_SEARCH.head} — ${CUSTOM_SEARCH.text}`;

type WithEndpoints = { endpoints?: ExecutionEndpoints | null } | null | undefined;

/** A stub or local model endpoint, from what the execution recorded (never the server's current setting); null otherwise. */
export function modelEndpointOf(ex: WithEndpoints): "stub" | "local" | null {
  const m = ex?.endpoints?.model;
  return m === "stub" || m === "local" ? m : null;
}

/** The model endpoint tag's text, or null for a hosted model, the mock or an execution that didn't record it. */
export function modelEndpointTag(ex: WithEndpoints): string | null {
  const m = modelEndpointOf(ex);
  return m ? MODEL_ENDPOINT_TAG[m] : null;
}

/** True when this execution's web search went to a custom TAVILY_BASE_URL (as recorded with it). */
export function usedCustomSearch(ex: WithEndpoints): boolean {
  return ex?.endpoints?.search === "custom";
}

/** The sentences exports and the shared page add for a stub or local model endpoint and a custom search endpoint; null when neither applies. */
export function endpointNote(ex: WithEndpoints): string | null {
  const tag = modelEndpointTag(ex);
  return [tag && `${tag}.`, usedCustomSearch(ex) && CUSTOM_SEARCH_NOTE].filter(Boolean).join(" ") || null;
}

/** The model endpoint tag a list row shows beside the mock tag (a stub warns, a local model is gray); null when none applies. */
export function listedEndpointTag(ex: WithEndpoints): { label: string; variant: "warn" | "gray"; detail: string } | null {
  const m = modelEndpointOf(ex);
  return m ? { label: MODEL_ENDPOINT_TAG[m], variant: m === "stub" ? "warn" : "gray", detail: MODEL_ENDPOINT_DETAIL[m] } : null;
}

// ---------------------------------------------------------------- research notice (Evidence panel)

const EXTERNAL_EVIDENCE = new Set(["WEB", "WIKIPEDIA"]);

/** "HTTP 401", or the attempt's error ("Skipped: …"), or "failed". */
const attemptFailure = (a: SearchAttempt) => (a.httpStatus ? `HTTP ${a.httpStatus}` : a.error || "failed");

/** "Tavily failed (HTTP 401)" — the first failure of each provider. */
function failedProviders(attempts: SearchAttempt[]): string[] {
  const seen = new Map<string, string>();
  for (const a of attempts) if (!a.ok && !seen.has(a.provider)) seen.set(a.provider, attemptFailure(a));
  return [...seen].map(([p, why]) => `${provider(p)} failed (${why})`);
}

export interface ResearchNotice {
  tone: "warn" | "info";
  text: string;
}

export const WIKIPEDIA_ONLY_NOTICE =
  "Only Wikipedia was searched — no live web search ran — so the external sources are encyclopedia summaries, not current web pages. Company, market and prospect facts may be missing or out of date.";

/** The sentence exports carry when a result's research was Wikipedia-only, so the limit travels with the file. */
export const WIKIPEDIA_ONLY_EXPORT_NOTE = "Evidence limit: only Wikipedia was searched (no live web search), so its external sources are encyclopedia summaries.";

/** Wikipedia alone answered this step's searches (servers without a Tavily key; recorded "ok" before they were marked degraded). */
const wikipediaOnly = (r: ExecutionStep["research"] | undefined) => !!r?.providers.length && r.providers.every((p) => p === "wikipedia");

/** Some step that wasn't skipped got its external evidence from Wikipedia alone. */
export const usedWikipediaOnly = (steps: (Pick<ExecutionStep, "status"> & Partial<Pick<ExecutionStep, "research">>)[]) =>
  steps.some((s) => s.status !== "SKIPPED" && wikipediaOnly(s.research));

/**
 * One sentence on whether web research ran and how it went, from each step's research outcome
 * (a skipped step's research no longer matters). Null when it went fine, or when nothing can be
 * said yet. `finished`: research can no longer happen in this execution.
 */
export function researchNotice(
  steps: (Pick<ExecutionStep, "title" | "status"> & Partial<Pick<ExecutionStep, "researchStatus" | "research">>)[],
  evidence: Pick<Evidence, "kind">[],
  finished: boolean
): ResearchNotice | null {
  const ran = steps.filter((s) => s.status !== "SKIPPED" && s.researchStatus);
  const external = evidence.some((e) => EXTERNAL_EVIDENCE.has(e.kind));
  const off = ran.filter((s) => s.researchStatus === "off");
  const failed = ran.filter((s) => s.researchStatus === "failed");
  const empty = ran.filter((s) => s.researchStatus === "no_results");
  const degraded = ran.filter((s) => s.researchStatus === "degraded");
  if (off.length) return { tone: "warn", text: "No web research ran: web search is off on this server." };
  if (failed.length) {
    const why = failedProviders(failed.flatMap((s) => s.research?.attempts ?? []));
    const where = failed.length === 1 ? `“${failed[0].title}”` : `${failed.length} steps`;
    return { tone: "warn", text: `Web research failed in ${where}${why.length ? ` — ${why.join(", ")}` : ""}. No external sources were retrieved there.` };
  }
  if (empty.length && !external) return { tone: "warn", text: "Search ran but returned no usable sources." };
  const encyclopediaOnly = ran.some((s) => (s.researchStatus === "degraded" || s.researchStatus === "ok") && wikipediaOnly(s.research));
  if (degraded.length) {
    const why = failedProviders(degraded.flatMap((s) => s.research?.attempts ?? []));
    if (!why.length && encyclopediaOnly) return { tone: "warn", text: WIKIPEDIA_ONLY_NOTICE };
    const providers = [...new Set(degraded.flatMap((s) => s.research?.providers ?? []))];
    const used = providers.map(provider);
    // A fallback that left only encyclopedia sources is a material limit, not a footnote.
    const tone = providers.length && providers.every((p) => p === "wikipedia") ? "warn" : "info";
    return { tone, text: `${why.length ? why.join(", ") : "A search provider failed"}${used.length ? ` — ${used.join(" and ")} used instead` : " — a fallback was used"}.` };
  }
  if (encyclopediaOnly) return { tone: "warn", text: WIKIPEDIA_ONLY_NOTICE };
  if (empty.length) return { tone: "info", text: `Search ran in ${empty.length === 1 ? "one step" : `${empty.length} steps`} without finding usable sources.` };
  // Nothing recorded a research outcome (an older execution, or a plan without research).
  if (!ran.length && !external && finished) {
    return { tone: "info", text: evidence.length ? "No web research ran in this execution: its evidence was provided, not retrieved from the web." : "No web research ran in this execution." };
  }
  return null;
}
