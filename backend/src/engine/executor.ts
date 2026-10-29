// Step executor: runs ONE plan step with its capability's playbook.
//
//   1. Policy: every tool the capability is bound to must be granted (READ_ONLY only today).
//   2. Tools: company context, memory, document retrieval, the company website
//      and web research gather inputs; external material becomes numbered Evidence
//      with its provenance (provider, query, retrieval time and method).
//   3. Prompt: capability instructions (system) + labelled data blocks (user),
//      with the trust boundary from prompts.ts.
//   4. Model call (streamed; partial text is persisted every ~1.5s so a
//      reconnecting browser sees progress — no in-memory source of truth).
//   5. Citation hygiene: [n] outside the evidence are removed (and counted)
//      and links to unknown domains unlinked.
//
// Web research is never silent: its status (ok | degraded | no_results |
// failed | off) and the attempts behind it are stored on the step and told in
// the event log (RESEARCH_COMPLETED / RESEARCH_FAILED), naming the providers
// that actually answered. A retried step reuses its earlier research instead
// of searching (and spending search budget) again.
//
// An evidence-backed research brief (objective kind "research_brief") is
// written with BRIEF_SECTIONS, keeps external sources apart from what the
// company provided, and lists every step whose research was incomplete.

import type { CompanyContext, Evidence, ExecutionStep, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { runLLM } from "../ai/llmProvider";
import { classifyProviderError } from "../ai/errors";
import { formatCompanyProfile, getCompanyContext, retrievePassages } from "../context/service";
import { relevantMemories } from "../memory/service";
import { redact } from "../lib/log";
import { checkToolAccess, DEFAULT_TOOL_GRANTS, deniedToolsFor } from "../org/policy";
import { getCapability, getExecutive, type Capability } from "../org/registry";
import { allowedLinkDomains, buildSourcesBlock, citationRules, cleanOutputWithStats, stripPreamble } from "../research/citations";
import { research, type ResearchOutcome, type ResearchStatus, type SearchAttempt, type SearchProviderName } from "../research/sources";
import { searchEnabled } from "../research/search";
import { clip, domainOf } from "../research/text";
import { addEvidence, isExternalEvidence, loadEvidence, toPromptSources, type AddedEvidence, type EvidenceDraft } from "./evidence";
import { emitNow } from "./events";
import { block, BRIEF_SECTIONS, constraintsBlock, HONESTY_RULES, isResearchBrief, neutralize, TRUST_RULES } from "./prompts";

/** Kept for compatibility: the classification lives in ai/errors.ts. */
export { isConfigError } from "../ai/errors";

const PRIOR_STEP_CHARS = 3500;
const PRIOR_TOTAL_CHARS = 9000;
export const EVIDENCE_PROMPT_CHARS = 7000;
/** A research brief's synthesis reads more of each source (it must cite them precisely). */
export const BRIEF_EVIDENCE_PROMPT_CHARS = 10000;
/** Search attempts kept on a step / in an event (bounded JSON, never raw provider bodies). */
const STORED_ATTEMPTS = 30;
const EVENT_ATTEMPTS = 12;

export type StepErrorKind = "policy" | "model" | "config" | "quota" | "empty";

export class StepError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly kind: StepErrorKind = "model") {
    super(message);
  }
}

/**
 * A model-provider error as a StepError. Configuration problems and requests
 * too large for the model fail the same way every time, and an exhausted quota
 * won't recover within the retry window: none of them is retried.
 */
export function stepErrorFromProvider(message: string): StepError {
  const kind = classifyProviderError(message);
  if (kind === "config" || kind === "too_large") return new StepError(message, false, "config");
  if (kind === "quota") return new StepError(message, false, "quota");
  return new StepError(message, true, "model");
}

export interface StepRunInput {
  /** plan: the stored Execution.plan (its runtime stamp names the company website the run was planned with). */
  execution: { id: string; orgId: string; plan?: unknown };
  objective: {
    title: string;
    statement: string;
    contextNotes: string;
    deadline: Date | null;
    /** "research_brief" or null (decision memo). */
    kind?: string | null;
    constraints?: string | null;
  };
  criteria: { description: string }[];
  step: ExecutionStep;
  totalSteps: number;
  priorSteps: ExecutionStep[];
  /** Revision steps: the verifier's feedback. Read from step.inputs when not given. */
  revisionFeedback?: string | null;
}

/** What a step's web research did (null when the step ran no research). */
export interface StepResearchSummary {
  status: ResearchStatus;
  /** Providers that actually answered, in first-use order. */
  providersUsed: SearchProviderName[];
  queries: string[];
  /** External (web / Wikipedia) evidence rows this call created. */
  externalNew: number;
  /** Why the status isn't "ok" (short, redacted), or null. */
  reason: string | null;
  /** True when an earlier attempt's research was reused instead of searching again. */
  reused: boolean;
}

export interface StepRunOutput {
  output: string;
  summary: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** True when the token counts are estimates (the provider reported no usage). */
  tokensEstimated: boolean;
  /** Invalid [n] citations removed from the model's output (each number, range or reference line counts once). */
  citationsRemoved: number;
  research: StepResearchSummary | null;
  /** Only the evidence rows this call created (rows reused from earlier steps or attempts are not included). */
  newEvidence: AddedEvidence[];
}

/** The shape stored in ExecutionStep.research (no secrets, no raw provider bodies). */
export interface StoredResearch {
  status: ResearchStatus;
  reason: string | null;
  backend: ResearchOutcome["backend"];
  providersUsed: SearchProviderName[];
  queries: string[];
  queryWriter: ResearchOutcome["queryWriter"];
  attempts: SearchAttempt[];
  externalNew: number;
  at: string;
}

// ---------------------------------------------------------------- revision inputs

export interface RevisionInputs {
  /** The verifier's findings (and a person's guidance) the revision must address. */
  feedback: string[];
  /** Run one round of web research before rewriting (an insufficient-evidence failure). */
  research: boolean;
}

/**
 * Reads a revision step's `inputs`: the legacy string[] of feedback, or
 * `{ feedback: string[], research: true }`. An array may also carry a
 * `{ research: true }` element.
 */
export function readRevisionInputs(inputs: unknown): RevisionInputs {
  const strings = (xs: unknown[]) => xs.filter((x): x is string => typeof x === "string" && !!x.trim());
  if (Array.isArray(inputs)) {
    const research = inputs.some((x) => !!x && typeof x === "object" && (x as { research?: unknown }).research === true);
    return { feedback: strings(inputs), research };
  }
  if (inputs && typeof inputs === "object") {
    const o = inputs as { feedback?: unknown; research?: unknown };
    return { feedback: Array.isArray(o.feedback) ? strings(o.feedback) : typeof o.feedback === "string" ? [o.feedback] : [], research: o.research === true };
  }
  return { feedback: [], research: false };
}

// ---------------------------------------------------------------- prompt

export function stepSystemPrompt(cap: Capability, opts: { revision: boolean; brief?: boolean }): string {
  const exec = getExecutive(cap.executive);
  const isSynthesis = cap.kind === "synthesis";
  const out: string[] = [
    `You are the ${cap.specialist} on the ${exec?.title ?? "AI"} team at Ensemblis, an AI organization executing a business objective for a client company.`,
    `Capability: ${cap.name} (v${cap.version})`,
    cap.description,
    "",
    "## Methodology",
    ...cap.methodology.map((m, i) => `${i + 1}. ${m}`),
    "",
    "## Output",
  ];
  if (isSynthesis && opts.brief) {
    out.push(
      "Produce the evidence-backed research brief the client will read — it must stand on its own.",
      "Start with a `#` title, then exactly these `##` sections, in this order:",
      ...BRIEF_SECTIONS.map((s) => `- \`## ${s.heading}\`: ${s.instruction}`),
      "",
      "## Brief rules",
      "- Key findings cite ONLY the external sources the assignment lists (web and Wikipedia). Company context, company documents and the company website are what the client told us, not external evidence: never present them as findings — refer to them only as company-provided context, under Analysis & inference or Recommendations.",
      '- Keep source-backed statements, inference, uncertainty and recommendations apart. A sentence that goes beyond what its source says belongs under Analysis & inference and starts with "Inference:".',
      "- When external evidence is thin, old or contradictory, say so under Uncertainties & open questions. When there is little or none, say plainly that the brief is limited — never fill the gap with unsourced facts.",
      "- Under Evidence gaps, list every step the assignment reports as skipped or with incomplete research.",
      "- Integrate every earlier step and apply its corrections; keep each [n] next to the claim it supports. Under ~1,400 words."
    );
    if (opts.revision) {
      out.push(
        "This is a REVISION: the verifier rejected parts of the previous brief. Fix every issue in <revision_feedback>; remove or qualify any claim the evidence does not support; use the new sources the assignment lists where they support a claim. Return the FULL revised brief with every section."
      );
    }
  } else if (isSynthesis) {
    out.push(
      "Produce the final result the client will read — it must stand on its own.",
      "Start with a `#` title, then these sections in order: `## Executive summary` (4–6 bullets that answer the objective), `## Findings`, `## Recommendation`, " +
        "`## Success criteria` (one numbered line per criterion: how the result meets it), `## Limitations & uncertainty`, `## Next steps`.",
      "Integrate every earlier step; apply corrections; keep [n] citations next to the claims they support. Under ~1,400 words.",
      "Under `## Limitations & uncertainty`, name every step the assignment reports as skipped or with incomplete research: never present that work as done."
    );
    if (opts.revision) {
      out.push("This is a REVISION: the verifier rejected parts of the previous result. Fix every issue in <revision_feedback>; remove or qualify any claim the evidence does not support. Return the FULL revised result.");
    }
  } else {
    out.push(`Write these sections as \`##\` headings: ${cap.deliverable.join(", ")}. Be specific and decision-useful. Under ~900 words. Do not write the final report.`);
    if (opts.brief) {
      out.push(
        'This work feeds an evidence-backed research brief: cite an external source [n] for every fact, start your own reasoning with "Inference:", and say what the evidence does not cover. Company context is background, not evidence for external facts.'
      );
    }
  }
  out.push("", TRUST_RULES, "", HONESTY_RULES);
  return out.join("\n");
}

function priorWorkBlock(prior: ExecutionStep[]): string {
  let budget = PRIOR_TOTAL_CHARS;
  const blocks: string[] = [];
  for (let i = prior.length - 1; i >= 0; i--) {
    const p = prior[i];
    const allowance = Math.max(700, Math.min(PRIOR_STEP_CHARS, budget));
    const body = clip(p.output ?? "", allowance, "\n[… truncated …]");
    budget -= body.length;
    blocks.unshift(`## ${p.key} — ${p.title} (${p.agent})\n${body}`);
  }
  return blocks.join("\n\n---\n\n");
}

/** Research-brief context for a step prompt. */
export interface BriefContext {
  /** Steps of this execution that were skipped or whose research wasn't ok (one line each; synthesis only). */
  incomplete: string[];
  /** Revision research: evidence numbers it added, or null when no research ran for this step. */
  newSources: number[] | null;
}

const refs = (ns: number[]) => ns.map((n) => `[${n}]`).join(", ");

export function stepUserPrompt(args: {
  input: StepRunInput;
  cap: Capability;
  companyProfile: string;
  memories: string[];
  evidence: Evidence[];
  /** Set for a research brief. */
  brief?: BriefContext | null;
  /** Any other objective's synthesis: steps that were skipped or whose research wasn't ok (a brief's are in `brief`). */
  incomplete?: string[] | null;
}): string {
  const { input, cap, companyProfile, memories, evidence, brief } = args;
  const { objective, criteria, step, totalSteps } = input;
  const isSynthesis = cap.kind === "synthesis";
  const parts: string[] = [];
  parts.push(block("objective", `Title: ${objective.title}${brief ? "\nDeliverable: research brief (evidence-backed)" : ""}\n\n${clip(objective.statement, 4000)}`, "user-instruction"));
  parts.push(block("success_criteria", criteria.length ? criteria.map((c, i) => `${i + 1}. ${c.description}`).join("\n") : "(none)", "user-instruction"));
  const constraints = constraintsBlock(objective.constraints);
  if (constraints) parts.push(constraints);
  const notes = [
    objective.deadline ? `Deadline: ${objective.deadline.toISOString().slice(0, 10)}` : "",
    objective.contextNotes.trim() ? `Notes for this objective:\n${clip(objective.contextNotes, 3000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (cap.tools.includes("company_context")) {
    parts.push(block("company_context", [companyProfile || "(No company context on file.)", notes].filter(Boolean).join("\n\n"), "user-provided"));
  } else if (notes) {
    parts.push(block("context_notes", notes, "user-provided"));
  }
  if (cap.tools.includes("memory") && memories.length) parts.push(block("memory", memories.map((m) => `- ${m}`).join("\n"), "internal"));
  if (input.priorSteps.length) parts.push(block("prior_work", priorWorkBlock(input.priorSteps), "internal"));
  if (evidence.length) parts.push(evidenceBlock(evidence, brief && isSynthesis ? BRIEF_EVIDENCE_PROMPT_CHARS : EVIDENCE_PROMPT_CHARS));
  if (input.revisionFeedback) parts.push(block("revision_feedback", input.revisionFeedback, "internal"));

  // The assignment mixes planner-written text (title, purpose, outputs) and stored step titles —
  // neutralised one by one — with Ensemblis' own instructions, which must keep the tag names and
  // source markers they refer to.
  const n = neutralize;
  const briefLines: string[] = [];
  if (brief && isSynthesis) {
    const external = evidence.filter((e) => isExternalEvidence(e.kind)).map((e) => e.n);
    const internal = evidence.filter((e) => !isExternalEvidence(e.kind)).map((e) => e.n);
    briefLines.push(
      external.length
        ? `External sources you may cite as findings (web and Wikipedia): ${refs(external)}.`
        : "External sources you may cite as findings (web and Wikipedia): none. No external evidence was gathered, so this brief has no source-backed findings: say so plainly in the Executive summary and Key findings.",
      ...(internal.length ? [`Company-provided material (company context, documents, website) — not external evidence: ${refs(internal)}.`] : []),
      ...(brief.incomplete.length
        ? ["Research that is incomplete (list each under Evidence gaps):", ...brief.incomplete.map((l) => `- ${n(l)}`)]
        : ["Research that is incomplete: none."])
    );
    if (brief.newSources) {
      briefLines.push(brief.newSources.length ? `New sources gathered for this revision: ${refs(brief.newSources)}.` : "The extra research for this revision found no new sources.");
    }
  } else if (isSynthesis && args.incomplete?.length) {
    briefLines.push("Work that is missing or incomplete (name each under Limitations & uncertainty):", ...args.incomplete.map((l) => `- ${n(l)}`));
  }
  const outputs = (step.outputs as string[]) ?? [];
  const checks = (step.verification as string[]) ?? [];
  const assignment = [
    `Step ${step.order + 1} of ${totalSteps}: ${n(step.title)}`,
    `Purpose: ${n(step.purpose)}`,
    outputs.length ? `Expected outputs: ${n(outputs.join("; "))}` : "",
    checks.length ? `The verifier will check: ${n(checks.join("; "))}` : "",
    constraints ? "Respect every item in <constraints>." : "",
    ...briefLines,
    citationRules(evidence.length),
  ]
    .filter(Boolean)
    .join("\n");
  parts.push(block("assignment", assignment, undefined, true));
  return parts.join("\n\n");
}

/** The numbered evidence block: each source's text is neutralised, then wrapped with the source markers. */
export function evidenceBlock(evidence: Evidence[], budget = EVIDENCE_PROMPT_CHARS): string {
  const sources = toPromptSources(evidence).map((s) => ({ ...s, title: neutralize(s.title), content: neutralize(s.content) }));
  return block("evidence", buildSourcesBlock(sources, budget), "untrusted", true);
}

/** First readable line of an output, for timelines and dashboards. */
export function summarize(md: string, max = 240): string {
  for (const raw of md.split("\n")) {
    if (/^\s*#/.test(raw) || /^\s*\|?\s*-{3,}/.test(raw)) continue;
    const line = raw
      .replace(/^\s*([-*+]|\d+[.)]|>)\s+/, "")
      .replace(/\s*\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g, "")
      .replace(/[*_`|]/g, "")
      .trim();
    if (line.length >= 25) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return "";
}

// ---------------------------------------------------------------- research

/** An earlier attempt's research is reused when it found something or the searches worked. */
const REUSABLE_RESEARCH = new Set<string>(["ok", "degraded", "no_results"]);
const PROVIDER_LABEL: Record<SearchProviderName, string> = { tavily: "the web (Tavily)", wikipedia: "Wikipedia" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function readStoredResearch(json: unknown): Partial<StoredResearch> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return {
    reason: typeof o.reason === "string" ? o.reason : null,
    providersUsed: strs(o.providersUsed ?? o.providers)?.filter((p): p is SearchProviderName => p === "tavily" || p === "wikipedia"),
    queries: strs(o.queries),
  };
}

function compactAttempts(attempts: SearchAttempt[], max: number): SearchAttempt[] {
  return attempts.slice(0, max).map((a) => ({ ...a, error: a.error ? clip(redact(a.error), 200) : null }));
}

async function emitResearchOutcome(input: StepRunInput, r: ResearchOutcome, newSources: number): Promise<void> {
  const { execution, step } = input;
  const where = r.providersUsed.map((p) => PROVIDER_LABEL[p]).join(" and ") || "the web";
  const queries = plural(r.queries.length, "query", "queries");
  const data = {
    status: r.status,
    providers: r.providersUsed,
    queries: r.queries,
    attempts: compactAttempts(r.attempts, EVENT_ATTEMPTS),
    reason: r.reason,
    newSources,
  } as unknown as Prisma.InputJsonValue;
  const base = { executionId: execution.id, orgId: execution.orgId, stepId: step.id, actor: step.executive, data };
  if (r.status === "ok" || r.status === "degraded" || r.status === "no_results") {
    const found =
      r.status === "no_results"
        ? "and found nothing"
        : `(${queries}): ${newSources ? plural(newSources, "new source", "new sources") : "no new sources (the results were already collected)"}`;
    const lead = r.status === "no_results" ? `${step.agent} searched ${where} (${queries}) ${found}` : `${step.agent} searched ${where} ${found}`;
    await emitNow({ ...base, type: "RESEARCH_COMPLETED", message: r.status === "degraded" && r.reason ? `${lead}. ${r.reason}` : lead });
    return;
  }
  await emitNow({
    ...base,
    type: "RESEARCH_FAILED",
    message:
      r.status === "off"
        ? `Web research didn't run for “${step.title}”: web search is off on this server`
        : `Web research failed for “${step.title}”: ${r.reason ?? "no search succeeded"}`,
  });
}

/**
 * One round of web research for a step: searches, stores the new sources with
 * their provenance, records the outcome on the step (fenced on the attempt) and
 * in the event log. A retried step reuses its earlier research.
 */
async function researchForStep(
  input: StepRunInput,
  req: { topic: string; brief: string; queryCount: number; maxResults: number }
): Promise<{ created: AddedEvidence[]; summary: StepResearchSummary }> {
  const { execution, step } = input;
  const all = await loadEvidence(execution.id);
  const mine = all.filter((e) => e.stepId === step.id && isExternalEvidence(e.kind));
  // What an earlier attempt recorded, read from the database (the caller's step row can predate it).
  const current = await prisma.executionStep.findUnique({ where: { id: step.id }, select: { researchStatus: true, research: true } });
  const prior = current?.researchStatus ?? step.researchStatus ?? null;
  const priorResearch = current ? current.research : step.research;

  // Reused: research that worked (or found sources), and "off" while search is still off (nothing would change).
  // A "failed" search is tried again: no search succeeded, so none is repeated.
  if (mine.length || (prior && REUSABLE_RESEARCH.has(prior)) || (prior === "off" && !searchEnabled())) {
    // A retry or resume of this step: reuse what the earlier attempt found — no new searches, no duplicate sources.
    const stored = readStoredResearch(priorResearch);
    let status = (prior ?? "degraded") as ResearchStatus;
    let reason = stored.reason ?? null;
    if (!prior) {
      // Sources were stored but the attempt was interrupted before its search details were recorded.
      status = "degraded";
      reason = "Sources from an interrupted earlier attempt were reused; that attempt's search details were not recorded.";
      await prisma.executionStep.updateMany({
        where: { id: step.id, attempts: step.attempts },
        data: { researchStatus: status, research: { status, reason, providersUsed: [...new Set(mine.map((e) => e.provider).filter(Boolean))], queries: [], attempts: [] } },
      });
    }
    return {
      created: [],
      summary: {
        status,
        providersUsed: stored.providersUsed ?? ([...new Set(mine.map((e) => e.provider).filter((p) => p === "tavily" || p === "wikipedia"))] as SearchProviderName[]),
        queries: stored.queries ?? [],
        externalNew: 0,
        reason,
        reused: true,
      },
    };
  }

  if (searchEnabled()) {
    // Which provider answers is only known afterwards (RESEARCH_COMPLETED names it).
    await emitNow({
      executionId: execution.id,
      orgId: execution.orgId,
      stepId: step.id,
      type: "RESEARCH_STARTED",
      actor: step.executive,
      message: `${step.agent} started web research`,
      data: { queryCount: req.queryCount },
    });
  }
  const r = await research({
    topic: req.topic,
    brief: req.brief,
    queryCount: req.queryCount,
    maxResults: req.maxResults,
    executionId: execution.id,
    seenUrls: all.map((e) => e.url).filter((u): u is string => !!u),
  });
  const retrievedAt = new Date();
  const rows = r.results.length
    ? await addEvidence({
        executionId: execution.id,
        orgId: execution.orgId,
        stepId: step.id,
        drafts: r.results.map((x) => ({
          kind: x.kind === "wikipedia" ? "WIKIPEDIA" : "WEB",
          title: x.title,
          url: x.url,
          content: x.content,
          publishedAt: x.publishedAt,
          provider: x.provider,
          query: x.query,
          retrievedAt,
          retrieval: "search_snippet",
        })),
      })
    : [];
  const created = rows.filter((e) => e.created);
  const stored: StoredResearch = {
    status: r.status,
    reason: r.reason,
    backend: r.backend,
    providersUsed: r.providersUsed,
    queries: r.queries,
    queryWriter: r.queryWriter,
    attempts: compactAttempts(r.attempts, STORED_ATTEMPTS),
    externalNew: created.length,
    at: retrievedAt.toISOString(),
  };
  // Fenced on the attempt: a re-claimed run of this step owns the record otherwise.
  await prisma.executionStep.updateMany({
    where: { id: step.id, attempts: step.attempts },
    data: { researchStatus: r.status, research: stored as unknown as Prisma.InputJsonValue },
  });
  await emitResearchOutcome(input, r, created.length);
  return {
    created,
    summary: { status: r.status, providersUsed: r.providersUsed, queries: r.queries, externalNew: created.length, reason: r.reason, reused: false },
  };
}

// ---------------------------------------------------------------- tools

type WebsiteContext = Pick<CompanyContext, "website" | "websiteSummary"> & Partial<Pick<CompanyContext, "websiteFetchedAt">>;

async function gatherEvidence(
  input: StepRunInput,
  cap: Capability,
  companyProfile: string,
  ctx: WebsiteContext
): Promise<{ created: AddedEvidence[]; research: StepResearchSummary | null }> {
  const { execution, step, objective } = input;
  const drafts: EvidenceDraft[] = [];
  const query = `${objective.title} ${objective.statement} ${step.title} ${step.purpose}`;

  if (cap.tools.includes("company_context") && (companyProfile || objective.contextNotes.trim())) {
    drafts.push({
      kind: "COMPANY_CONTEXT",
      title: "Company profile (Company Context)",
      content: [companyProfile, objective.contextNotes.trim() ? `Notes for this objective: ${objective.contextNotes.trim()}` : ""].filter(Boolean).join("\n"),
      retrieval: "provided",
    });
  }
  if (cap.tools.includes("website") && ctx.websiteSummary) {
    drafts.push({
      kind: "WEBSITE",
      title: `${domainOf(ctx.website) ?? "Company"} — company website`,
      url: ctx.website,
      content: ctx.websiteSummary,
      retrieval: "website",
      retrievedAt: ctx.websiteFetchedAt ?? null,
    });
  }
  if (cap.tools.includes("documents")) {
    const passages = await retrievePassages(execution.orgId, query, cap.kind === "framing" ? 4 : 3);
    for (const p of passages) drafts.push({ kind: "DOCUMENT", title: `${p.docName}${p.url ? "" : " (company document)"}`, url: p.url, content: p.text, retrieval: "upload" });
    if (passages.length) {
      await emitNow({
        executionId: execution.id,
        orgId: execution.orgId,
        stepId: step.id,
        type: "CONTEXT_RETRIEVED",
        actor: step.executive,
        message: `${step.agent} retrieved ${passages.length} passage${passages.length === 1 ? "" : "s"} from company documents`,
        data: { documents: [...new Set(passages.map((p) => p.docName))] },
      });
    }
  }
  const created: AddedEvidence[] = drafts.length
    ? (await addEvidence({ executionId: execution.id, orgId: execution.orgId, stepId: step.id, drafts })).filter((e) => e.created)
    : [];

  let summary: StepResearchSummary | null = null;
  const constraints = objective.constraints?.trim() ? `\n\nConstraints: ${clip(objective.constraints.trim(), 600)}` : "";
  const revision = step.kind === "revision" ? readRevisionInputs(step.inputs) : null;
  if (cap.tools.includes("web_research") && cap.kind !== "synthesis") {
    // Called even when search is off: research() then reports "off" without any network call, and that is recorded.
    const r = await researchForStep(input, {
      topic: `${objective.title} — ${step.title}`,
      brief: `${objective.statement}\n\nThis step: ${step.purpose}${constraints}`,
      queryCount: cap.kind === "research" ? 3 : 2,
      maxResults: cap.kind === "research" ? 6 : 4,
    });
    created.push(...r.created);
    summary = r.summary;
  } else if (revision?.research && checkToolAccess("web_research", DEFAULT_TOOL_GRANTS).allowed) {
    // A revision after an insufficient-evidence failure: one more round of research on what the verifier found missing.
    const feedback = input.revisionFeedback?.trim() || revision.feedback.join("\n");
    const r = await researchForStep(input, {
      topic: objective.title,
      brief: `Verification findings this revision must address:\n${clip(feedback, 2000)}\n\nObjective: ${clip(objective.statement, 1500)}${constraints}`,
      queryCount: 2,
      maxResults: 4,
    });
    created.push(...r.created);
    summary = r.summary;
  }

  for (const e of created) {
    await emitNow({
      executionId: execution.id,
      orgId: execution.orgId,
      stepId: step.id,
      type: "SOURCE_FOUND",
      actor: step.executive,
      message: `[${e.n}] ${e.title}${e.domain ? ` — ${e.domain}` : ""}`,
      data: { n: e.n, kind: e.kind, domain: e.domain, url: e.url, provider: e.provider, query: e.query, retrieval: e.retrieval },
    });
  }
  return { created, research: summary };
}

// Provider-free on purpose: the model may copy these lines into the result, which can be shared
// publicly. The reason (provider, HTTP status, budget, env var) stays in the step's research record.
const RESEARCH_STATUS_TEXT: Record<string, string> = {
  degraded: "web research was incomplete (some searches failed)",
  no_results: "web research found no usable sources",
  failed: "web research failed",
  off: "web research did not run",
};
const WIKIPEDIA_ONLY_TEXT = "only encyclopedia summaries were available, not the live web, so current company and market facts may be missing";

/** True when a step's stored research was answered by Wikipedia alone (no live web search). */
export function wikipediaOnlyResearch(json: unknown): boolean {
  const providers = readStoredResearch(json).providersUsed;
  return !!providers?.length && providers.every((p) => p === "wikipedia");
}

/** One line per step that was skipped or whose research wasn't ok (a brief's Evidence gaps, a memo's Limitations). Never the stored reason. */
export async function incompleteResearchNotes(executionId: string, exceptStepId?: string, deliverable: "brief" | "result" = "brief"): Promise<string[]> {
  const steps = await prisma.executionStep.findMany({
    where: { executionId },
    orderBy: { order: "asc" },
    select: { id: true, title: true, status: true, researchStatus: true, research: true },
  });
  const out: string[] = [];
  for (const s of steps) {
    if (s.id === exceptStepId) continue;
    if (s.status === "SKIPPED") {
      out.push(`“${s.title}” was skipped: its work is missing from this ${deliverable}.`);
    } else if (s.researchStatus && s.researchStatus !== "no_results" && s.researchStatus !== "failed" && s.researchStatus !== "off" && wikipediaOnlyResearch(s.research)) {
      // Wikipedia alone answered: recorded as "ok" by servers before this check, "degraded" since.
      out.push(`“${s.title}”: ${WIKIPEDIA_ONLY_TEXT}.`);
    } else if (s.researchStatus && s.researchStatus !== "ok") {
      out.push(`“${s.title}”: ${RESEARCH_STATUS_TEXT[s.researchStatus] ?? "web research was incomplete"}.`);
    }
  }
  return out;
}

function partialWriter(stepId: string, attempt: number) {
  let text = "";
  let last = 0;
  let inflight: Promise<unknown> | null = null;
  const write = () => {
    last = Date.now();
    inflight = prisma.executionStep
      .updateMany({ where: { id: stepId, status: "RUNNING", attempts: attempt }, data: { partialOutput: text.slice(-20000) } })
      .catch(() => undefined)
      .finally(() => (inflight = null));
  };
  return {
    push(delta: string) {
      text += delta;
      if (!inflight && Date.now() - last > 1500) write();
    },
    async done() {
      if (inflight) await inflight;
    },
  };
}

// ---------------------------------------------------------------- run

/** The company website stamped on the plan (plan.runtime.website), so the cleaner and the console's linkDomains use the same one. */
function plannedWebsite(plan: unknown): string | null {
  const runtime = plan && typeof plan === "object" ? (plan as { runtime?: unknown }).runtime : null;
  const website = runtime && typeof runtime === "object" ? (runtime as { website?: unknown }).website : undefined;
  return typeof website === "string" ? website : null;
}

export async function runStep(input: StepRunInput): Promise<StepRunOutput> {
  const cap = getCapability(input.step.capability);
  if (!cap) throw new StepError(`Unknown capability "${input.step.capability}"`, false, "policy");
  const denied = deniedToolsFor(cap.key, DEFAULT_TOOL_GRANTS);
  if (denied.length) throw new StepError(denied.map((d) => d.reason).join(" "), false, "policy");

  const ctx = await getCompanyContext(input.execution.orgId);
  const companyProfile = formatCompanyProfile(ctx);
  const memories = cap.tools.includes("memory")
    ? (await relevantMemories(input.execution.orgId, `${input.objective.title} ${input.objective.statement}`)).map((m) => `${m.kind.toLowerCase()}: ${m.content}`)
    : [];

  const isRevision = input.step.kind === "revision";
  const isSynthesis = cap.kind === "synthesis";
  const brief = isResearchBrief(input.objective.kind);
  const revisionFeedback = isRevision ? input.revisionFeedback?.trim() || readRevisionInputs(input.step.inputs).feedback.join("\n") || null : null;
  const runInput: StepRunInput = { ...input, revisionFeedback };

  const gathered = await gatherEvidence(runInput, cap, companyProfile, ctx);
  const evidence = await loadEvidence(input.execution.id);
  // Every synthesis hears which steps were skipped or researched incompletely, whatever the objective kind.
  const incomplete = isSynthesis ? await incompleteResearchNotes(input.execution.id, input.step.id, brief ? "brief" : "result") : [];
  const briefContext: BriefContext | null = brief
    ? {
        incomplete,
        // The external sources this step stored: a retry that reuses the earlier attempt's research creates none, but found them.
        newSources: isRevision && gathered.research ? evidence.filter((e) => e.stepId === input.step.id && isExternalEvidence(e.kind)).map((e) => e.n) : null,
      }
    : null;

  const system = stepSystemPrompt(cap, { revision: isRevision, brief });
  const user = stepUserPrompt({ input: runInput, cap, companyProfile, memories, evidence, brief: briefContext, incomplete: brief ? null : incomplete });
  const partial = partialWriter(input.step.id, input.step.attempts);

  let result;
  try {
    result = await runLLM(system, user, {
      model: "main",
      purpose: "step",
      executionId: input.execution.id,
      stepId: input.step.id,
      onDelta: (d) => partial.push(d),
    });
  } catch (err) {
    throw stepErrorFromProvider(redact(err instanceof Error ? err.message : "Unknown error"));
  } finally {
    await partial.done();
  }

  if (result.truncated) {
    // A report cut off mid-sentence must not be stored as a completed step (later steps would build on it).
    throw new StepError(
      `${cap.specialist}'s output was cut off at the AI model's output-token limit. (Owner: raise OPENAI_MAX_TOKENS, or keep OPENAI_REASONING_EFFORT=low for reasoning models.)`,
      true,
      "model"
    );
  }
  const allowed = allowedLinkDomains(`${input.objective.statement} ${input.objective.contextNotes} ${plannedWebsite(input.execution.plan) ?? ctx.website}`, evidence);
  const raw = isSynthesis ? stripPreamble(result.text.trim()) : result.text;
  const cleaned = cleanOutputWithStats(raw, evidence.length, allowed);
  const output = cleaned.text;
  if (!output) throw new StepError(`${cap.specialist} returned an empty response`, true, "empty");

  return {
    output,
    summary: summarize(isSynthesis ? output.replace(/^#\s.*$/m, "") : output),
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    tokensEstimated: result.tokensEstimated,
    citationsRemoved: cleaned.removedCitations,
    research: gathered.research,
    newEvidence: gathered.created,
  };
}
