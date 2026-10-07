// Cloudflare Turnstile bot check (v3) for the guest trial and sign-up.
// Off unless TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set.
// Fails closed: if the check can't be completed, the request is rejected.

import { config } from "../config";
import { HttpError } from "../lib/http";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: string | undefined | null, ip: string | undefined): Promise<boolean> {
  if (!config.turnstile.enabled) return true;
  if (!token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch (err) {
    console.warn("[turnstile] verification failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Throws 400 "Bot check failed" unless the token verifies (always passes when Turnstile is off). */
export async function assertTurnstile(token: string | undefined | null, ip: string | undefined): Promise<void> {
  if (!(await verifyTurnstile(token, ip))) {
    throw new HttpError(400, "Bot check failed. Please complete the check again and retry.");
  }
}
