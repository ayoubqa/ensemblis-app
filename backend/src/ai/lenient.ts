// Tolerant zod building blocks for model output. Real models (gpt-oss,
// Claude, small local models) routinely write a rationale longer than asked,
// send numbers as strings ("85"), vary enum case ("met"), or get one list item
// wrong. Rejecting the whole answer for that throws away a good plan or
// assessment, so these helpers repair the harmless deviations — trim to the
// limit, coerce, normalise case, drop the one bad item — and still reject
// anything structurally wrong.

import { z, type ZodTypeAny } from "zod";

/** A string trimmed and cut to `max` (never rejected for length); numbers are accepted as text. */
export function text(max: number, min = 0) {
  return z.preprocess((v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().slice(0, max) : v), z.string().min(min));
}

/** A finite number; numeric strings such as "85", "85/100" or "12 hours" are accepted. */
export function num() {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""));
    return m ? Number(m[0]) : v;
  }, z.number().finite());
}

/** An enum matched case-insensitively ("met", "Partially met" → PARTIALLY_MET). */
export function looseEnum<T extends string>(values: [T, ...T[]]): z.ZodEffects<z.ZodEnum<[T, ...T[]]>, T, unknown> {
  return z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/[\s-]+/g, "_") : v), z.enum(values));
}

/** A boolean; "true"/"yes" and "false"/"no" strings are accepted. */
export function bool() {
  return z.preprocess((v) => (typeof v === "string" ? /^(true|yes)$/i.test(v.trim()) : v), z.boolean());
}

/** A list that keeps the valid items (up to `max`) and drops the rest; a non-array becomes []. */
export function listOf<S extends ZodTypeAny>(item: S, max: number) {
  return z.preprocess((v) => {
    if (!Array.isArray(v)) return [];
    return v.filter((x) => item.safeParse(x).success).slice(0, max);
  }, z.array(item));
}

/** A list of short strings: non-strings dropped, each trimmed to `maxLen`, empties removed. */
export function strList(maxItems: number, maxLen: number) {
  return z.preprocess((v) => {
    if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [v.trim().slice(0, maxLen)] : [];
    return v
      .map((x) => (typeof x === "number" ? String(x) : x))
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim().slice(0, maxLen))
      .slice(0, maxItems);
  }, z.array(z.string()));
}
