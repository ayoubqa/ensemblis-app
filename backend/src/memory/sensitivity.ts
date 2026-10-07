// Decides whether a learned memory may be stored as ACTIVE automatically or
// must wait for a person to confirm it. Pure — unit tested.
//
// Auto-remembered (ACTIVE): low-risk operational preferences and lessons,
// e.g. "Prefers recommendations ranked with a one-line rationale".
// Needs confirmation (PENDING_CONFIRMATION): decisions, constraints and facts
// about the business (consequential if wrong), anything ambiguous, and
// anything that looks sensitive (contact details, money, credentials, people
// matters, legal/health topics).

import type { MemoryKind, MemoryStatus } from "@prisma/client";

export interface MemoryAssessment {
  status: MemoryStatus;
  sensitive: boolean;
  reasons: string[];
}

const SENSITIVE: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "contains an email address"],
  [/(\+?\d[\d\s().-]{7,}\d)/, "contains a phone-like number"],
  [/([€$£]\s?\d|\d[\d.,]*\s?(k|m|bn|million|billion|eur|usd|gbp)\b)/i, "contains a monetary amount"],
  [/\b(password|passcode|api[ _-]?key|secret|token|iban|swift|credit card|card number|ssn|social security|bank account)\b/i, "mentions credentials or financial identifiers"],
  [/\b(salary|salaries|compensation|layoff|lay off|fired|firing|termination|disciplinary|performance review)\b/i, "concerns people matters"],
  [/\b(health|medical|diagnos|pregnan|religion|ethnic|sexual orientation|criminal)\b/i, "touches special-category personal data"],
  [/\b(lawsuit|litigation|legal dispute|settlement|nda breach)\b/i, "concerns legal matters"],
];

const HEDGES = /\b(maybe|might|possibly|perhaps|unclear|not sure|probably|it seems|apparently)\b/i;

export function assessMemory(kind: MemoryKind, content: string, modelSaysSensitive = false): MemoryAssessment {
  const reasons: string[] = [];
  let sensitive = modelSaysSensitive;
  if (modelSaysSensitive) reasons.push("flagged as sensitive when it was proposed");
  for (const [re, why] of SENSITIVE) {
    if (re.test(content)) {
      sensitive = true;
      reasons.push(why);
    }
  }
  if (kind === "DECISION" || kind === "CONSTRAINT") reasons.push(`${kind.toLowerCase()}s are consequential and need confirmation`);
  if (kind === "FACT") reasons.push("business facts need confirmation before they are relied on");
  if (HEDGES.test(content)) reasons.push("the statement is ambiguous");
  if (content.length > 400) reasons.push("the statement is long; review it before it is reused");
  const auto = (kind === "PREFERENCE" || kind === "LESSON") && reasons.length === 0;
  return { status: auto ? "ACTIVE" : "PENDING_CONFIRMATION", sensitive, reasons };
}
