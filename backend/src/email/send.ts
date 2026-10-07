// Transactional email via Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
// Off (a quiet no-op) unless RESEND_API_KEY and EMAIL_FROM are both set.
// Never throws: an email problem must never break a request or a task run.

import { config } from "../config";
import { recordUsage } from "../lib/usage";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// RESEND_BASE_URL is only for pointing tests at a local stub; production uses the real API.
const RESEND_URL = `${(process.env.RESEND_BASE_URL?.trim() || "https://api.resend.com").replace(/\/+$/, "")}/emails`;
const TIMEOUT_MS = 10_000;

/** Sends one email. Resolves true when Resend accepted it, false otherwise (incl. when email is off). */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (!config.email.enabled) return false;
  let ok = false;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    ok = res.ok;
    if (!ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.warn(`[email] Resend rejected "${msg.subject}" (HTTP ${res.status}): ${detail}`);
    }
  } catch (err) {
    console.warn(`[email] could not send "${msg.subject}":`, err instanceof Error ? err.message : err);
  }
  await recordUsage({ kind: "email", provider: "resend", ok });
  return ok;
}
