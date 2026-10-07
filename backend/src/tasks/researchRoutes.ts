// v3 task routes owned by the research engine, mounted at /api/tasks in
// index.ts right after tasks/routes.ts:
//   POST /clarify          — 0–3 clarifying questions for a brief (public, rate limited)
//   POST /:id/revisions    — paid follow-up refinement of a COMPLETED report
//
// Auth is applied per route (never router.use) so other /api/tasks routes
// are unaffected by this router.

import { Router } from "express";
import { z } from "zod";
import { AuthedRequest, optionalAuth, requireAuth } from "../auth/middleware";
import { config } from "../config";
import { ah, parse } from "../lib/http";
import { limiter, taskRunLimiter } from "../lib/rateLimits";
import { cleanText } from "../research/text";
import { clarifyQuestions } from "./clarify";
import { createRevision } from "./revisions";

const router = Router();

const clarifyPerMinute = limiter(60_000, 10, "You're asking for suggestions too quickly. Please wait a minute and try again.");
const clarifyPerHour = limiter(60 * 60_000, 60, "Too many suggestion requests from your network. Please try again later.");

// Server-wide daily ceiling for clarify calls (anonymous visitors can call
// this, so it must not be able to run up the AI bill). Over the cap the
// endpoint quietly returns no questions.
const clarifyDay = { day: "", count: 0 };
function clarifyBudgetLeft(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (clarifyDay.day !== today) {
    clarifyDay.day = today;
    clarifyDay.count = 0;
  }
  const cap = Math.max(200, config.maxTasksPerDayGlobal * 3);
  if (clarifyDay.count >= cap) return false;
  clarifyDay.count++;
  return true;
}

const clarifySchema = z.object({
  description: z
    .string({ required_error: "Describe the work you need done" })
    .trim()
    .min(3, "Describe the work you need done")
    .max(config.maxDescriptionLength, `Description is too long (max ${config.maxDescriptionLength} characters)`),
});

router.post(
  "/clarify",
  clarifyPerMinute,
  clarifyPerHour,
  optionalAuth,
  ah(async (req, res) => {
    const { description } = parse(clarifySchema, req.body);
    if (!config.clarifyEnabled || !clarifyBudgetLeft()) {
      res.json({ questions: [] });
      return;
    }
    const questions = await clarifyQuestions(cleanText(description));
    res.json({ questions });
  })
);

const revisionSchema = z.object({
  instruction: z
    .string({ required_error: "Describe what you'd like changed" })
    .transform((s) => cleanText(s).trim())
    .pipe(
      z
        .string()
        .min(3, "Describe what you'd like changed (at least 3 characters)")
        .max(2000, "Follow-up requests can be at most 2,000 characters")
    ),
});

router.post(
  "/:id/revisions",
  requireAuth,
  taskRunLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { instruction } = parse(revisionSchema, req.body);
    const result = await createRevision(req.userId!, req.params.id, instruction);
    res.status(201).json(result);
  })
);

export default router;
