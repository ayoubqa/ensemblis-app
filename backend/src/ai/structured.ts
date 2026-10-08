// One structured model call with a single repair attempt. Real models
// sometimes return output that is truncated (a reasoning model spending its
// token budget) or not quite the requested JSON. Instead of giving up on the
// first reply, the model is asked once more — told what was wrong, with a
// larger output budget — and the reply is validated again. Never throws.

import type { ZodType, ZodTypeDef } from "zod";
import { runLLM, type LLMOptions } from "./llmProvider";
import { parseStructured } from "./json";
import { log } from "../lib/log";

export type StructuredRun<T> = { ok: true; data: T; attempts: number; firstError?: string } | { ok: false; error: string; attempts: number };

export async function runStructured<T>(
  system: string,
  user: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  opts: LLMOptions & { maxTokens: number }
): Promise<StructuredRun<T>> {
  let first: string;
  try {
    const { text } = await runLLM(system, user, opts);
    const parsed = parseStructured(text, schema);
    if (parsed.ok) return { ok: true, data: parsed.data, attempts: 1 };
    first = parsed.error;
  } catch (err) {
    // Provider errors (auth, quota, timeout) are not output problems: don't spend a second call.
    return { ok: false, error: err instanceof Error ? err.message : String(err), attempts: 1 };
  }
  log.warn("llm.structured_retry", { purpose: opts.purpose, executionId: opts.executionId ?? undefined, error: first });
  const repair = `${user}\n\n<previous_reply_problem trust="internal">\nYour previous reply could not be used: ${first}.\nReply again with ONLY the complete JSON object in the required shape — no prose, no code fences, nothing after the closing brace. Keep text fields short.\n</previous_reply_problem>`;
  try {
    const { text } = await runLLM(system, repair, { ...opts, maxTokens: Math.min(8192, Math.round(opts.maxTokens * 1.5)) });
    const parsed = parseStructured(text, schema);
    if (parsed.ok) return { ok: true, data: parsed.data, attempts: 2, firstError: first };
    return { ok: false, error: `${parsed.error} (after one retry; first reply: ${first})`, attempts: 2 };
  } catch (err) {
    return { ok: false, error: `${err instanceof Error ? err.message : String(err)} (retry after: ${first})`, attempts: 2 };
  }
}
