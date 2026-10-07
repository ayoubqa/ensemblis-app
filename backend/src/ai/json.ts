// Structured model output. Models are asked for JSON, but raw model text is
// never trusted: it is extracted, parsed and validated against a zod schema,
// and callers fall back to deterministic behaviour when validation fails.

import type { ZodType, ZodTypeDef } from "zod";

/** Finds and parses the first balanced JSON object in a string (tolerates code fences / chatter), or null. */
export function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null;
  let start = raw.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(start, i + 1));
          } catch {
            break; // try the next "{"
          }
        }
      }
    }
    start = raw.indexOf("{", start + 1);
  }
  return null;
}

export type Structured<T> = { ok: true; data: T } | { ok: false; error: string };

/** Extracts + validates. Never throws. */
export function parseStructured<T>(raw: string, schema: ZodType<T, ZodTypeDef, unknown>): Structured<T> {
  const json = extractJsonObject(raw ?? "");
  if (json === null) return { ok: false, error: "no JSON object in the model output" };
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
  }
  return { ok: true, data: parsed.data };
}
