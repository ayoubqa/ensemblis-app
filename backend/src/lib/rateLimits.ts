// Per-IP rate limits (in memory — fine for a single server instance).
// Limits are configured in src/config.ts / .env.example.

import rateLimit from "express-rate-limit";
import { config } from "../config";

function limiter(windowMs: number, limit: number, error: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
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

/** Shared bucket for everything that starts an AI run: create, retry, workflow run. */
export const taskRunLimiter = limiter(MIN, r.taskRunsPerMin, "You're starting tasks too quickly. Please wait a minute and try again.");
