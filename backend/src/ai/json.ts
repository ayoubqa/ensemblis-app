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
          const slice = raw.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            try {
              return JSON.parse(withoutTrailingCommas(slice)); // a common real-model slip: {"a": 1,}
            } catch {
              break; // try the next "{"
            }
          }
        }
      }
    }
    start = raw.indexOf("{", start + 1);
  }
  return null;
}

/** Removes commas that directly precede } or ] (outside strings). */
export function withoutTrailingCommas(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      if (json[j] === "}" || json[j] === "]") continue;
    }
    out += ch;
  }
  return out;
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
