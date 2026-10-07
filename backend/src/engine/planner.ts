// The Chief of Staff planner: objective + context → a validated, structured plan.
//
// The model proposes a plan as JSON; nothing it writes is trusted as-is:
//   - parsed and validated with zod (planSchema);
//   - normalised against the AI Team registry (normalizePlan): unknown
//     capabilities are dropped, executives are corrected to the capability's
//     owner, step ids are re-issued, dependencies may only point backwards
//     (so the plan is always a DAG), the plan always starts with Objective
//     Planning and ends with one Cross-functional Synthesis, and is capped;
//   - tools are never chosen by the model — they come from each capability's
//     registry entry and are enforced by org/policy.ts.
// When the model is unavailable or its output is unusable, a deterministic
// playbook plan is used instead (fallbackPlan) and labelled as such.

import { z } from "zod";
import { runLLM } from "../ai/llmProvider";
import { parseStructured } from "../ai/json";
import {
  CAPABILITIES,
  EXECUTIVES,
  FRAMING_CAPABILITY,
  SYNTHESIS_CAPABILITY,
  VERIFICATION_COST_CENTS,
  getCapability,
  type ExecutiveKey,
} from "../org/registry";
import { terms } from "../context/retrieval";
import { clip } from "../research/text";
import { block, TRUST_RULES } from "./prompts";

export const PLANNER_VERSION = "chief-of-staff-planner/1.0.0";
export const MAX_STEPS = 7;
const MAX_WORK_STEPS = MAX_STEPS - 2;

// ---------------------------------------------------------------- contract

const criterionSchema = z.object({
  description: z.string().min(3).max(300),
  kind: z.enum(["qualitative", "quantitative"]).catch("qualitative"),
  targetValue: z.number().finite().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
});

const stepSchema = z.object({
  id: z.string().min(1).max(20),
  title: z.string().min(3).max(140),
  executive: z.string().max(40),
  capability: z.string().max(60),
  purpose: z.string().min(5).max(800),
  inputs: z.array(z.string().max(200)).max(8).catch([]).default([]),
  outputs: z.array(z.string().max(200)).max(8).catch([]).default([]),
  verification: z.array(z.string().max(200)).max(6).catch([]).default([]),
  dependsOn: z.array(z.string().max(20)).max(8).catch([]).default([]),
});

export const planSchema = z.object({
  title: z.string().min(3).max(140),
  objective: z.string().min(5).max(800),
  successCriteria: z.array(criterionSchema).max(6).catch([]).default([]),
  assumptions: z.array(z.string().max(300)).max(8).catch([]).default([]),
  missingInformation: z
    .array(z.object({ question: z.string().min(5).max(300), whyItMatters: z.string().max(300).default(""), blocking: z.boolean().default(false) }))
    .max(3)
    .catch([])
    .default([]),
  steps: z.array(stepSchema).min(1).max(12),
  estimatedManualHours: z.number().min(0).max(2000).nullable().optional(),
  risks: z.array(z.string().max(300)).max(6).catch([]).default([]),
});
export type RawPlan = z.infer<typeof planSchema>;

export interface PlannedStep {
  key: string;
  title: string;
  executive: ExecutiveKey;
  capability: string;
  capabilityVersion: string;
  agent: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  verification: string[];
  dependsOn: string[];
  costCents: number;
}

export interface PlannedCriterion {
  description: string;
  kind: "qualitative" | "quantitative";
  targetValue: number | null;
  unit: string | null;
}

export interface Plan {
  title: string;
  objective: string;
  successCriteria: PlannedCriterion[];
  assumptions: string[];
  missingInformation: { question: string; whyItMatters: string; blocking: boolean }[];
  steps: PlannedStep[];
  estimatedManualHours: number | null;
  risks: string[];
  estimatedCostCents: number;
  source: "planner" | "fallback";
  version: string;
  /** Adjustments made while normalising the model's plan (shown for transparency). */
  notes: string[];
}

export interface PlannerInput {
  title: string;
  statement: string;
  contextNotes: string;
  deadline: Date | null;
  budgetCents: number;
  criteria: { description: string }[];
  companyProfile: string;
  memories: string[];
  documentTitles: string[];
  executionId?: string;
  /** True once a person answered (or waived) the Chief of Staff's questions: never block again. */
  questionsSettled: boolean;
}

// ---------------------------------------------------------------- normalisation

function stepFor(capabilityKey: string, fields: Partial<PlannedStep> & { title: string; purpose: string }): PlannedStep {
  const cap = getCapability(capabilityKey)!;
  return {
    key: "",
    executive: cap.executive,
    capability: cap.key,
    capabilityVersion: cap.version,
    agent: cap.specialist,
    inputs: [],
    outputs: [...cap.deliverable],
    verification: [...cap.verificationFocus],
    dependsOn: [],
    costCents: cap.costCents,
    ...fields,
  };
}

export function estimateCost(steps: { capability: string }[]): number {
  return steps.reduce((n, s) => n + (getCapability(s.capability)?.costCents ?? 0), 0) + VERIFICATION_COST_CENTS;
}

/** Validates a raw (model) plan against the registry and the plan invariants. */
export function normalizePlan(raw: RawPlan, input: Pick<PlannerInput, "title" | "statement" | "criteria">): Plan {
  const notes: string[] = [];
  const idMap = new Map<string, string>();
  const work: { step: PlannedStep; deps: string[] }[] = [];
  let framing: { step: PlannedStep; deps: string[] } | null = null;
  let synthesis: { step: PlannedStep; deps: string[] } | null = null;

  for (const s of raw.steps) {
    const cap = getCapability(s.capability.trim());
    if (!cap) {
      notes.push(`Dropped step "${s.title}": unknown capability "${s.capability}".`);
      continue;
    }
    if (s.executive !== cap.executive) {
      if (s.executive) notes.push(`"${s.title}" was assigned to ${cap.executive.replace(/_/g, " ")} (the owner of ${cap.name}).`);
    }
    const step = stepFor(cap.key, {
      title: s.title.trim(),
      purpose: s.purpose.trim(),
      inputs: s.inputs,
      outputs: s.outputs.length ? s.outputs : [...cap.deliverable],
      verification: s.verification.length ? s.verification : [...cap.verificationFocus],
    });
    const entry = { step, deps: s.dependsOn, rawId: s.id };
    if (cap.key === FRAMING_CAPABILITY) {
      if (!framing) framing = entry;
      idMap.set(s.id, "__framing");
      continue;
    }
    if (cap.key === SYNTHESIS_CAPABILITY) {
      if (synthesis) notes.push("Only one synthesis step is kept (the last one).");
      synthesis = entry;
      idMap.set(s.id, "__synthesis");
      continue;
    }
    if (work.length >= MAX_WORK_STEPS) {
      notes.push(`Dropped step "${s.title}": plans are capped at ${MAX_STEPS} steps.`);
      continue;
    }
    idMap.set(s.id, `__work${work.length}`);
    work.push(entry);
  }

  if (!work.length) {
    const fb = pickWorkCapabilities(`${input.title} ${input.statement}`, 1)[0];
    const cap = getCapability(fb)!;
    notes.push(`The plan had no research or analysis step; added ${cap.name}.`);
    work.push({ step: stepFor(fb, { title: cap.name, purpose: `${cap.description} Focus on: ${clip(input.title, 160)}.` }), deps: [] });
  }
  if (!framing) {
    notes.push("Added Objective Planning as the first step.");
    framing = {
      step: stepFor(FRAMING_CAPABILITY, { title: "Frame the objective with company context", purpose: "Restate the objective and extract the company context that matters for it." }),
      deps: [],
    };
  }
  if (!synthesis) {
    notes.push("Added Cross-functional Synthesis as the final step.");
    synthesis = {
      step: stepFor(SYNTHESIS_CAPABILITY, { title: "Synthesise the result", purpose: "Integrate the team's work into one result that answers the objective and each success criterion." }),
      deps: [],
    };
  }

  // Final order: framing, work…, synthesis. Ids are re-issued s1..sN.
  const ordered = [framing, ...work, synthesis];
  const placeholderToKey = new Map<string, string>();
  ordered.forEach((e, i) => {
    e.step.key = `s${i + 1}`;
    placeholderToKey.set(i === 0 ? "__framing" : i === ordered.length - 1 ? "__synthesis" : `__work${i - 1}`, e.step.key);
  });
  ordered.forEach((e, i) => {
    if (i === 0) {
      e.step.dependsOn = [];
      return;
    }
    if (i === ordered.length - 1) {
      e.step.dependsOn = ordered.slice(0, i).map((x) => x.step.key); // synthesis reads everything
      return;
    }
    const deps = new Set<string>();
    for (const d of e.deps) {
      const key = placeholderToKey.get(idMap.get(d) ?? "");
      // Only earlier steps: forward or self references are dropped, so the plan can't contain a cycle.
      if (key && Number(key.slice(1)) < i + 1) deps.add(key);
    }
    deps.add("s1"); // every work step builds on the framing
    e.step.dependsOn = [...deps].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  });
  const steps = ordered.map((e) => e.step);

  const userCriteria = input.criteria.filter((c) => c.description.trim());
  const successCriteria: PlannedCriterion[] = userCriteria.length
    ? []
    : raw.successCriteria.slice(0, 5).map((c) => ({
        description: c.description.trim(),
        kind: c.kind,
        targetValue: c.targetValue ?? null,
        unit: c.unit ?? null,
      }));

  return {
    title: raw.title.trim() || input.title,
    objective: raw.objective.trim(),
    successCriteria,
    assumptions: raw.assumptions.map((a) => a.trim()).filter(Boolean),
    missingInformation: raw.missingInformation,
    steps,
    estimatedManualHours: raw.estimatedManualHours ?? null,
    risks: raw.risks,
    estimatedCostCents: estimateCost(steps),
    source: "planner",
    version: PLANNER_VERSION,
    notes,
  };
}

// ---------------------------------------------------------------- deterministic fallback

/** Up to `n` work capabilities whose keywords best match the text (never framing/synthesis). */
export function pickWorkCapabilities(text: string, n: number): string[] {
  const t = ` ${terms(text).join(" ")} `;
  const scored = CAPABILITIES.filter((c) => c.keywords.length)
    .map((c) => ({ key: c.key, kind: c.kind, score: c.keywords.reduce((s, k) => s + (t.includes(` ${k} `) ? 2 : t.includes(k) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  // Prefer one research capability first (evidence), then analysis.
  const research = scored.find((x) => x.kind === "research");
  if (research) picked.push(research.key);
  for (const x of scored) {
    if (picked.length >= n) break;
    if (!picked.includes(x.key)) picked.push(x.key);
  }
  if (!picked.length) picked.push("operational_research");
  return picked.slice(0, n);
}

export const DEFAULT_CRITERIA: PlannedCriterion[] = [
  { description: "The result answers the objective directly, with a clear recommendation", kind: "qualitative", targetValue: null, unit: null },
  { description: "Key claims are supported by cited evidence", kind: "qualitative", targetValue: null, unit: null },
  { description: "Assumptions, risks and next steps are stated", kind: "qualitative", targetValue: null, unit: null },
];

export function fallbackPlan(input: Pick<PlannerInput, "title" | "statement" | "criteria">, reason: string): Plan {
  const work = pickWorkCapabilities(`${input.title} ${input.statement}`, 2);
  const steps: PlannedStep[] = [
    stepFor(FRAMING_CAPABILITY, { title: "Frame the objective with company context", purpose: "Restate the objective and extract the company context that matters for it." }),
    ...work.map((k) => {
      const cap = getCapability(k)!;
      return stepFor(k, { title: cap.name, purpose: `${cap.description} Apply it to: ${clip(input.title, 200)}.` });
    }),
    stepFor(SYNTHESIS_CAPABILITY, { title: "Synthesise the result", purpose: "Integrate the team's work into one result that answers the objective and each success criterion." }),
  ];
  steps.forEach((s, i) => {
    s.key = `s${i + 1}`;
    s.dependsOn = i === 0 ? [] : i === steps.length - 1 ? steps.slice(0, i).map((x) => x.key) : ["s1"];
  });
  return {
    title: input.title,
    objective: input.statement.slice(0, 800),
    successCriteria: input.criteria.length ? [] : DEFAULT_CRITERIA,
    assumptions: [],
    missingInformation: [],
    steps,
    estimatedManualHours: null,
    risks: [],
    estimatedCostCents: estimateCost(steps),
    source: "fallback",
    version: PLANNER_VERSION,
    notes: [`Planned with the standard playbook: ${reason}`],
  };
}

// ---------------------------------------------------------------- deterministic context guard

const SELF_REFERENCE = /\b(our|my|we|us|we're|ours)\b/i;

/**
 * A blocking question the Chief of Staff must ask regardless of the model:
 * the objective is about "our" business but the organization has told
 * Ensemblis nothing about it.
 */
export function contextGapQuestion(input: Pick<PlannerInput, "statement" | "contextNotes" | "companyProfile">) {
  const knowsBusiness = /What the company does:|Products & services:|Customers \/ ICP:/.test(input.companyProfile);
  if (knowsBusiness || input.contextNotes.trim().length >= 40) return null;
  if (!SELF_REFERENCE.test(input.statement)) return null;
  return {
    question: "What does your company sell, and to whom? (One or two sentences on the product and the target customers is enough.)",
    whyItMatters: "The objective refers to your business, but your Company Context is empty — without it the team would be guessing.",
    blocking: true,
  };
}

// ---------------------------------------------------------------- the planner

function plannerPrompt(input: PlannerInput): { system: string; user: string } {
  const exec = EXECUTIVES.map((e) => {
    const caps = CAPABILITIES.filter((c) => c.executive === e.key)
      .map((c) => `  - ${c.key} (${c.kind}): ${c.name} — ${c.description}`)
      .join("\n");
    return `${e.key} — ${e.title}: ${e.mandate}\n${caps}`;
  }).join("\n");

  const system = [
    "You are the Chief of Staff of an AI organization that executes business objectives. You turn an objective into a short, executable plan and assign each step to the executive who owns the capability.",
    "Reply with ONE JSON object only — no prose, no markdown fences.",
    TRUST_RULES,
    "## Planning rules",
    `- 3 to ${MAX_STEPS} steps. The first step uses capability "${FRAMING_CAPABILITY}". The last step uses "${SYNTHESIS_CAPABILITY}". Between them, pick the research and analysis capabilities the objective genuinely needs (usually 1–3).`,
    "- Use ONLY capability keys from <capabilities>. Do not invent capabilities, tools or actions. Steps only research, analyse, draft and recommend — they never send, publish, buy or change external systems.",
    '- Step ids are "s1", "s2", … in order. dependsOn lists earlier step ids only.',
    "- Each step: a specific title, the purpose (what this step must establish for THIS objective), inputs, outputs and what the verifier should check.",
    "- If the user gave success criteria, do not replace them (return successCriteria: []). Otherwise propose 2–4 measurable criteria; use kind \"quantitative\" with targetValue/unit when the objective implies a number (e.g. \"three markets\" → 3, \"markets\").",
    "- missingInformation: only information that is absent from the objective AND the company context and would materially change the result. Mark blocking=true only if the result would be meaningless without it.",
    "- estimatedManualHours: honest estimate of how long a competent analyst would need.",
    'JSON shape: {"title": str, "objective": str, "successCriteria": [{"description": str, "kind": "qualitative"|"quantitative", "targetValue": number|null, "unit": str|null}], "assumptions": [str], "missingInformation": [{"question": str, "whyItMatters": str, "blocking": bool}], "steps": [{"id": str, "title": str, "executive": str, "capability": str, "purpose": str, "inputs": [str], "outputs": [str], "verification": [str], "dependsOn": [str]}], "estimatedManualHours": number, "risks": [str]}',
  ].join("\n");

  const criteria = input.criteria.length ? input.criteria.map((c, i) => `${i + 1}. ${c.description}`).join("\n") : "(none given — propose them)";
  const parts = [
    block("objective", `Title: ${input.title}\n\n${clip(input.statement, 4000)}`, "user-instruction"),
    block("success_criteria", criteria, "user-instruction"),
    block(
      "context_notes",
      [
        input.deadline ? `Deadline: ${input.deadline.toISOString().slice(0, 10)}` : "Deadline: none",
        `Execution budget: €${(input.budgetCents / 100).toFixed(2)}`,
        input.contextNotes.trim() ? `Notes from the organization:\n${clip(input.contextNotes, 3000)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "user-provided"
    ),
    block("company_context", input.companyProfile || "(The organization has not filled in its company context yet.)", "user-provided"),
    block("memory", input.memories.length ? input.memories.map((m) => `- ${m}`).join("\n") : "(none)", "internal"),
    block("documents", input.documentTitles.length ? input.documentTitles.map((t) => `- ${t}`).join("\n") : "(none)", "untrusted"),
    block("capabilities", exec),
  ];
  return { system, user: parts.join("\n\n") };
}

/** Plans an objective. Never throws: falls back to the playbook plan. */
export async function planObjective(input: PlannerInput): Promise<Plan> {
  let plan: Plan;
  try {
    const { system, user } = plannerPrompt(input);
    const { text } = await runLLM(system, user, {
      model: "main",
      purpose: "plan",
      executionId: input.executionId ?? null,
      temperature: 0.2,
      maxTokens: 4096,
    });
    const parsed = parseStructured(text, planSchema);
    plan = parsed.ok ? normalizePlan(parsed.data, input) : fallbackPlan(input, `the AI planner's output was not a valid plan (${parsed.error}).`);
  } catch (err) {
    plan = fallbackPlan(input, `the AI planner was unavailable (${err instanceof Error ? err.message : "unknown error"}).`);
  }
  const gap = contextGapQuestion(input);
  if (gap && !plan.missingInformation.some((q) => q.blocking)) plan.missingInformation = [gap, ...plan.missingInformation].slice(0, 3);
  if (input.questionsSettled) {
    // Questions were answered or waived: anything still open becomes an assumption, never a block.
    for (const q of plan.missingInformation) plan.assumptions.push(`Open question carried as an assumption: ${q.question}`);
    plan.missingInformation = [];
  }
  return plan;
}
