// v3 attachments: client material for a task, uploaded BEFORE the task is
// created (then passed as attachmentIds to POST /api/tasks).
//   POST   /api/attachments       {kind, name, text} — text extracted in the browser
//   POST   /api/attachments/link  {url}              — the page is fetched server-side (SSRF-safe)
//   DELETE /api/attachments/:id                     — only while not yet attached to a task
// Signed-in, non-guest users only. Mounted in index.ts with its own 400kb
// JSON body limit.

import { Router } from "express";
import { z } from "zod";
import { AuthedRequest, requireAuth } from "../auth/middleware";
import { config } from "../config";
import { prisma } from "../db";
import { ah, HttpError, parse } from "../lib/http";
import { limiter } from "../lib/rateLimits";
import { toPublicAttachment } from "../lib/serializers";
import { startOfTodayUTC } from "../lib/usage";
import { fetchUrl, FetchUrlError } from "../research/fetchUrl";
import { cleanText, collapse, truncateChars } from "../research/text";

const router = Router();

/** Attachments a user may create per UTC day. */
export const ATTACHMENTS_PER_DAY = 30;

const linkLimiter = limiter(60_000, 10, "You're adding links too quickly. Please wait a minute and try again.");

// Creations per user today, kept in memory as well as counted in the database,
// so deleting attachments can't be used to get around the daily cap.
const createdToday = new Map<string, { day: string; count: number }>();
function bumpMemoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const cur = createdToday.get(userId);
  const next = cur && cur.day === day ? { day, count: cur.count + 1 } : { day, count: 1 };
  createdToday.set(userId, next);
  if (createdToday.size > 10_000) {
    for (const [k, v] of createdToday) if (v.day !== day) createdToday.delete(k);
  }
  return next.count;
}
function memoryCount(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  const cur = createdToday.get(userId);
  return cur && cur.day === day ? cur.count : 0;
}

/** 401 / 403 for guests / 429 over the daily cap. */
async function assertCanAttach(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true } });
  if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
  if (user.isGuest) throw new HttpError(403, "Create a free account to attach files and links.");
  if (config.attachments.maxPerTask <= 0) throw new HttpError(403, "Attachments are turned off on this server.");
  const inDb = await prisma.taskAttachment.count({ where: { userId, createdAt: { gte: startOfTodayUTC() } } });
  if (Math.max(inDb, memoryCount(userId)) >= ATTACHMENTS_PER_DAY) {
    throw new HttpError(429, `You can add up to ${ATTACHMENTS_PER_DAY} attachments per day. Please try again tomorrow.`);
  }
}

/** Cleans extracted text for storage: no NUL/control characters, trimmed, capped at maxChars. */
export function sanitizeAttachmentText(raw: string, maxChars = config.attachments.maxChars): string {
  return truncateChars(cleanText(raw).trim(), maxChars).trim();
}

function sanitizeName(raw: string): string {
  return truncateChars(collapse(raw), 200).trim();
}

const fileSchema = z.object({
  kind: z.enum(["pdf", "csv", "xlsx", "docx", "txt", "md"], {
    errorMap: () => ({ message: "kind must be one of pdf, csv, xlsx, docx, txt, md" }),
  }),
  name: z.string({ required_error: "name is required" }).max(200, "File name is too long (max 200 characters)"),
  text: z.string({ required_error: "text is required" }),
});

router.post(
  "/",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const body = parse(fileSchema, req.body);
    const name = sanitizeName(body.name);
    if (!name) throw new HttpError(400, "name: File name is required");
    const text = sanitizeAttachmentText(body.text);
    if (!text) throw new HttpError(400, "We couldn't find any readable text in this file.");
    await assertCanAttach(req.userId!);
    bumpMemoryCount(req.userId!);
    const attachment = await prisma.taskAttachment.create({
      data: { userId: req.userId!, kind: body.kind, name, url: null, charCount: text.length, text },
    });
    res.status(201).json({ attachment: toPublicAttachment(attachment) });
  })
);

const linkSchema = z.object({
  url: z.string({ required_error: "url is required" }).trim().min(1, "Enter a web address").max(2048, "That web address is too long"),
});

router.post(
  "/link",
  requireAuth,
  linkLimiter,
  ah<AuthedRequest>(async (req, res) => {
    const { url } = parse(linkSchema, req.body);
    await assertCanAttach(req.userId!);
    // Counts even when the fetch fails: each attempt makes an outbound request.
    bumpMemoryCount(req.userId!);
    let page;
    try {
      page = await fetchUrl(url);
    } catch (err) {
      if (err instanceof FetchUrlError) throw new HttpError(400, err.message);
      console.error("[attachments] link fetch failed:", err);
      throw new HttpError(400, "We couldn't fetch that page. Try again, or paste the text as a file instead.");
    }
    const text = sanitizeAttachmentText(page.text);
    if (!text) throw new HttpError(400, "We couldn't find any readable text on that page. Paste the text as a file instead.");
    const name = sanitizeName(page.title) || sanitizeName(new URL(page.finalUrl).hostname) || "Linked page";
    const attachment = await prisma.taskAttachment.create({
      data: { userId: req.userId!, kind: "url", name, url: page.finalUrl, charCount: text.length, text },
    });
    res.status(201).json({ attachment: toPublicAttachment(attachment) });
  })
);

router.delete(
  "/:id",
  requireAuth,
  ah<AuthedRequest>(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { isGuest: true } });
    if (!user) throw new HttpError(401, "This account no longer exists. Please sign in again.");
    if (user.isGuest) throw new HttpError(403, "Create a free account to attach files and links.");
    const att = await prisma.taskAttachment.findFirst({
      where: { id: req.params.id, userId: req.userId },
      select: { id: true, taskId: true },
    });
    if (!att) throw new HttpError(404, "Attachment not found");
    if (att.taskId) throw new HttpError(409, "This attachment is already part of a task and can't be removed.");
    // Guarded delete: never removes one that got attached in the meantime.
    const removed = await prisma.taskAttachment.deleteMany({ where: { id: att.id, userId: req.userId, taskId: null } });
    if (removed.count === 0) throw new HttpError(409, "This attachment is already part of a task and can't be removed.");
    res.json({ ok: true });
  })
);

export default router;
