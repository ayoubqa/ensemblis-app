// Memory writer: after an execution completes, the fast model proposes at most
// a few durable learnings (validated JSON). They pass through the memory
// service's de-duplication and sensitivity gate (memory/sensitivity.ts):
// low-risk preferences/lessons are remembered, the rest waits for a person.
// The writer may only learn what the organization explicitly showed — never
// preferences inferred from Ensemblis' own output.

import { z } from "zod";
import { runLLM } from "../ai/llmProvider";
import { parseStructured } from "../ai/json";
import { listOf, looseEnum, text } from "../ai/lenient";
import { recordLearnedMemories, type ProposedMemory } from "../memory/service";
import { clip } from "../research/text";
import { block, TRUST_RULES } from "./prompts";

// One bad item (wrong case, too long) drops only that item. Memory text is never cut short —
// a truncated statement could be remembered as something it doesn't say.
const schema = z.object({
  memories: listOf(
    z.object({
      kind: looseEnum<"PREFERENCE" | "DECISION" | "LESSON" | "CONSTRAINT" | "FACT">(["PREFERENCE", "DECISION", "LESSON", "CONSTRAINT", "FACT"]),
      content: z.string().trim().min(12).max(400),
      rationale: text(300).default(""),
      sensitivity: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["low", "high"])).catch("high"),
    }),
    5
  ).default([]),
});

export async function learnFromExecution(args: {
  executionId: string;
  orgId: string;
  objectiveTitle: string;
  statement: string;
  contextNotes: string;
  outcomeSummary: string;
}) {
  const system = [
    "You maintain the operational memory of an AI organization. You propose at most 3 durable learnings that will help future objectives for the same company. Reply with ONE JSON object only.",
    TRUST_RULES,
    "## Rules",
    "- Learn ONLY from what the organization explicitly stated in <objective> or <context_notes>: format preferences, recurring constraints, decisions they made, lessons about their business.",
    "- Never infer preferences from the AI's own output. Never store personal data, credentials, or one-off details of this objective.",
    "- kind: PREFERENCE | DECISION | LESSON | CONSTRAINT | FACT. sensitivity: \"high\" for anything about people, money, legal or confidential matters.",
    "- If there is nothing durable to learn, return {\"memories\": []}.",
    'JSON: {"memories": [{"kind": str, "content": str, "rationale": str, "sensitivity": "low"|"high"}]}',
  ].join("\n");
  const user = [
    block("objective", `Title: ${args.objectiveTitle}\n\n${clip(args.statement, 3000)}`, "user-instruction"),
    block("context_notes", args.contextNotes.trim() || "(none)", "user-provided"),
    block("result", args.outcomeSummary, "internal"),
  ].join("\n\n");
  try {
    const { text } = await runLLM(system, user, { model: "fast", purpose: "memory", executionId: args.executionId, temperature: 0, maxTokens: 1500, timeoutMs: 45_000 });
    const parsed = parseStructured(text, schema);
    if (!parsed.ok) return [];
    const proposals: ProposedMemory[] = parsed.data.memories.map((m) => ({ kind: m.kind, content: m.content, rationale: m.rationale, sensitive: m.sensitivity === "high" }));
    return await recordLearnedMemories(args.orgId, args.executionId, proposals);
  } catch {
    return [];
  }
}
