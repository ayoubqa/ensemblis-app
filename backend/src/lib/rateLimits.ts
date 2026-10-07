// Per-IP rate limits (in memory — fine for a single server instance).
// Limits are configured in src/config.ts / .env.example.

import rateLimit from "express-rate-limit";
import { config } from "../config";
import { clientIpKey } from "./clientIp";

/** Per-client limiter keyed on the real client IP (lib/clientIp.ts; IPv6 grouped by /64). */
export function limiter(windowMs: number, limit: number, error: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => clientIpKey(req),
    handler: (_req, res) => {
      res.status(429).json({ error });
    },
  });
}

const MIN = 60_000;
const r = config.rateLimits;

export const globalLimiter = limiter(15 * MIN, r.globalPer15Min, "Too many requests from your network. Please slow down and try again in a few minutes.");

export const signupLimiter = limiter(60 * MIN, r.signupPerHour, "Too many sign-ups from your network. Please try again in an hour.");

export const loginLimiter = limiter(15 * MIN, r.loginPer15Min, "Too many sign-in attempts. Please wait 15 minutes and try again.");

export const estimateLimiter = limiter(MIN, r.estimatePerMin, "You're requesting estimates too quickly. Please wait a minute and try again.");

/** Shared bucket for everything that starts an AI run: create, retry, workflow run, test run. */
export const taskRunLimiter = limiter(MIN, r.taskRunsPerMin, "You're starting tasks too quickly. Please wait a minute and try again.");

// v3
export const forgotPasswordLimiter = limiter(60 * MIN, 5, "Too many password reset requests from your network. Please try again in an hour.");

export const resetPasswordLimiter = limiter(15 * MIN, 20, "Too many attempts. Please wait 15 minutes and try again.");

/** Burst guard in front of the per-IP-per-day guest trial limit (which lives in the database). */
export const guestStartLimiter = limiter(60 * MIN, 10, "Too many trial requests from your network. Please try again in an hour.");

export const checkoutLimiter = limiter(MIN, 10, "Too many checkout attempts. Please wait a minute and try again.");

export const teamJoinLimiter = limiter(15 * MIN, 30, "Too many attempts. Please wait 15 minutes and try again.");
