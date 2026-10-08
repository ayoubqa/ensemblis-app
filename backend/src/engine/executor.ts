// Step executor: runs ONE plan step with its capability's playbook.
//
//   1. Policy: every tool the capability is bound to must be granted (READ_ONLY only today).
//   2. Tools: company context, memory, document retrieval, the company website
//      and web research gather inputs; external material becomes numbered Evidence.
//   3. Prompt: capability instructions (system) + labelled data blocks (user),
//      with the trust boundary from prompts.ts.
//   4. Model call (streamed; partial text is persisted every ~1.5s so a
//      reconnecting browser sees progress — no in-memory source of truth).
//   5. Citation hygiene: [n] outside the evidence are removed and links to
//      unknown domains unlinked.

import type { Evidence, ExecutionStep } from "@prisma/client";
import { prisma } from "../db";
import { runLLM } from "../ai/llmProvider";
import { formatCompanyProfile, getCompanyContext, retrievePassages } from "../context/service";
import { relevantMemories } from "../memory/service";
import { DEFAULT_TOOL_GRANTS, deniedToolsFor } from "../org/policy";
import { getCapability, getExecutive, type Capability } from "../org/registry";
import { allowedLinkDomains, buildSourcesBlock, citationRules, cleanOutput, stripPreamble } from "../research/citations";
import { research } from "../research/sources";
import { searchEnabled } from "../research/search";
import { clip, domainOf } from "../research/text";
import { addEvidence, loadEvidence, toPromptSources, type EvidenceDraft } from "./evidence";
import { emitNow } from "./events";
import { block, HONESTY_RULES, neutralize, TRUST_RULES } from "./prompts";

const PRIOR_STEP_CHARS = 3500;
const PRIOR_TOTAL_CHARS = 9000;
export const EVIDENCE_PROMPT_CHARS = 7000;

export class StepError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly kind: "policy" | "model" | "config" | "empty" = "model") {
    super(message);
  }
}

/** Errors no retry can fix (operator configuration). */
export function isConfigError(message: string): boolean {
  // "too large for the AI model": the same prompt is rejected every time (provider request-size limit).
  return /isn't configured|rejected the server's API key|doesn't recognise the model|AI_PROVIDER|too large for the AI model/i.test(message);
}

export interface StepRunInput {
  execution: { id: string; orgId: string };
  objective: { title: string; statement: string; contextNotes: string; deadline: Date | null };
  criteria: { description: string }[];
  step: ExecutionStep;
  totalSteps: number;
  priorSteps: ExecutionStep[];
  revisionFeedback?: string | null;
}

export interface StepRunOutput {
  output: string;
  summary: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  newEvidence: Evidence[];
}

// ---------------------------------------------------------------- prompt

export function stepSystemPrompt(cap: Capability, opts: { revision: boolean }): string {
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
  if (isSynthesis) {
    out.push(
      "Produce the final result the client will read — it must stand on its own.",
      "Start with a `#` title, then these sections in order: `## Executive summary` (4–6 bullets that answer the objective), `## Findings`, `## Recommendation`, " +
        "`## Success criteria` (one numbered line per criterion: how the result meets it), `## Limitations & uncertainty`, `## Next steps`.",
      "Integrate every earlier step; apply corrections; keep [n] citations next to the claims they support. Under ~1,400 words."
    );
    if (opts.revision) {
      out.push("This is a REVISION: the verifier rejected parts of the previous result. Fix every issue in <revision_feedback>; remove or qualify any claim the evidence does not support. Return the FULL revised result.");
    }
  } else {
    out.push(`Write these sections as \`##\` headings: ${cap.deliverable.join(", ")}. Be specific and decision-useful. Under ~900 words. Do not write the final report.`);
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

export function stepUserPrompt(args: {
  input: StepRunInput;
  cap: Capability;
  companyProfile: string;
  memories: string[];
  evidence: Evidence[];
}): string {
  const { input, cap, companyProfile, memories, evidence } = args;
  const { objective, criteria, step, totalSteps } = input;
  const parts: string[] = [];
  parts.push(block("objective", `Title: ${objective.title}\n\n${clip(objective.statement, 4000)}`, "user-instruction"));
  parts.push(block("success_criteria", criteria.length ? criteria.map((c, i) => `${i + 1}. ${c.description}`).join("\n") : "(none)", "user-instruction"));
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
  if (evidence.length) parts.push(evidenceBlock(evidence));
  if (input.revisionFeedback) parts.push(block("revision_feedback", input.revisionFeedback, "internal"));
  parts.push(
    block(
      "assignment",
      [
        `Step ${step.order + 1} of ${totalSteps}: ${step.title}`,
        `Purpose: ${step.purpose}`,
        (step.outputs as string[]).length ? `Expected outputs: ${(step.outputs as string[]).join("; ")}` : "",
        (step.verification as string[]).length ? `The verifier will check: ${(step.verification as string[]).join("; ")}` : "",
        citationRules(evidence.length),
      ]
        .filter(Boolean)
        .join("\n")
    )
  );
  return parts.join("\n\n");
}

/** The numbered evidence block: each source's text is neutralised, then wrapped with the source markers. */
export function evidenceBlock(evidence: Evidence[]): string {
  const sources = toPromptSources(evidence).map((s) => ({ ...s, title: neutralize(s.title), content: neutralize(s.content) }));
  return block("evidence", buildSourcesBlock(sources, EVIDENCE_PROMPT_CHARS), "untrusted", true);
}

/** First readable line of an output, for timelines and dashboards. */
export function summarize(md: string, max = 240): string {
  for (const raw of md.split("\n")) {
    if (/^\s*#/.test(raw) || /^\s*\|?\s*-{3,}/.test(raw)) continue;
    const line = raw
      .replace(/^\s*([-*+]|\d+[.)]|>)\s+/, "")
      .replace(/\s*\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, "")
      .replace(/[*_`|]/g, "")
      .trim();
    if (line.length >= 25) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return "";
}

// ---------------------------------------------------------------- tools

async function gatherEvidence(input: StepRunInput, cap: Capability, companyProfile: string, ctx: { website: string; websiteSummary: string }): Promise<Evidence[]> {
  const { execution, step, objective } = input;
  const drafts: EvidenceDraft[] = [];
  const query = `${objective.title} ${objective.statement} ${step.title} ${step.purpose}`;

  if (cap.tools.includes("company_context") && (companyProfile || objective.contextNotes.trim())) {
    drafts.push({
      kind: "COMPANY_CONTEXT",
      title: "Company profile (Company Context)",
      content: [companyProfile, objective.contextNotes.trim() ? `Notes for this objective: ${objective.contextNotes.trim()}` : ""].filter(Boolean).join("\n"),
    });
  }
  if (cap.tools.includes("website") && ctx.websiteSummary) {
    drafts.push({ kind: "WEBSITE", title: `${domainOf(ctx.website) ?? "Company"} — company website`, url: ctx.website, content: ctx.websiteSummary });
  }
  if (cap.tools.includes("documents")) {
    const passages = await retrievePassages(execution.orgId, query, cap.kind === "framing" ? 4 : 3);
    for (const p of passages) drafts.push({ kind: "DOCUMENT", title: `${p.docName}${p.url ? "" : " (company document)"}`, url: p.url, content: p.text });
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
  let found = drafts.length ? await addEvidence({ executionId: execution.id, orgId: execution.orgId, stepId: step.id, drafts }) : [];

  if (cap.tools.includes("web_research") && cap.kind !== "synthesis" && searchEnabled()) {
    const queryCount = cap.kind === "research" ? 3 : 2;
    const existing = await loadEvidence(execution.id);
    await emitNow({
      executionId: execution.id,
      orgId: execution.orgId,
      stepId: step.id,
      type: "RESEARCH_STARTED",
      actor: step.executive,
      message: `${step.agent} started web research`,
    });
    const r = await research({
      topic: `${objective.title} — ${step.title}`,
      brief: `${objective.statement}\n\nThis step: ${step.purpose}`,
      queryCount,
      maxResults: cap.kind === "research" ? 6 : 4,
      executionId: execution.id,
      seenUrls: existing.map((e) => e.url).filter((u): u is string => !!u),
    });
    if (r.queries.length) {
      await emitNow({
        executionId: execution.id,
        orgId: execution.orgId,
        stepId: step.id,
        type: "RESEARCH_STARTED",
        actor: step.executive,
        message: `Searching ${r.backend === "tavily" ? "the web" : "Wikipedia"}: ${r.queries.join(" · ")}`.slice(0, 480),
        data: { backend: r.backend, queries: r.queries, queryWriter: r.queryWriter },
      });
    }
    const web = await addEvidence({
      executionId: execution.id,
      orgId: execution.orgId,
      stepId: step.id,
      drafts: r.results.map((x) => ({ kind: x.kind === "wikipedia" ? "WIKIPEDIA" : "WEB", title: x.title, url: x.url, content: x.content, publishedAt: x.publishedAt })),
    });
    found = [...found, ...web];
  }
  for (const e of found.filter((x) => x.stepId === step.id)) {
    await emitNow({
      executionId: execution.id,
      orgId: execution.orgId,
      stepId: step.id,
      type: "SOURCE_FOUND",
      actor: step.executive,
      message: `[${e.n}] ${e.title}${e.domain ? ` — ${e.domain}` : ""}`,
      data: { n: e.n, kind: e.kind, domain: e.domain, url: e.url },
    });
  }
  return found;
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

  const newEvidence = await gatherEvidence(input, cap, companyProfile, ctx);
  const evidence = await loadEvidence(input.execution.id);

  const system = stepSystemPrompt(cap, { revision: input.step.kind === "revision" });
  const user = stepUserPrompt({ input, cap, companyProfile, memories, evidence });
  const partial = partialWriter(input.step.id, input.step.attempts);

  let result;
  try {
    result = await runLLM(system, user, {
      model: "main",
      purpose: "step",
      executionId: input.execution.id,
      onDelta: (d) => partial.push(d),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new StepError(message, !isConfigError(message), isConfigError(message) ? "config" : "model");
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
  const allowed = allowedLinkDomains(`${input.objective.statement} ${input.objective.contextNotes} ${ctx.website}`, evidence);
  const raw = cap.kind === "synthesis" ? stripPreamble(result.text.trim()) : result.text;
  const output = cleanOutput(raw, evidence.length, allowed);
  if (!output) throw new StepError(`${cap.specialist} returned an empty response`, true, "empty");

  return {
    output,
    summary: summarize(cap.kind === "synthesis" ? output.replace(/^#\s.*$/m, "") : output),
    provider: result.provider,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
    newEvidence,
  };
}
