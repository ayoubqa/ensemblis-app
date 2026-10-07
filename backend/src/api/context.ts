// /api/context — Company Context (profile, website, documents). Org-scoped.
// Mounted in index.ts with a larger JSON body limit (documents carry text).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRegistered } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { limiter } from "../lib/rateLimits";
import { requireOrg, type OrgRequest } from "../org/organization";
import {
  addLinkDocument,
  addTextDocument,
  contextCompleteness,
  deleteDocument,
  getCompanyContext,
  MAX_CONTEXT_DOCUMENTS,
  PROFILE_FIELDS,
  refreshWebsite,
  toPublicDocument,
  updateCompanyContext,
} from "../context/service";

const router = Router();
router.use(requireAuth, requireOrg);
const fetchLimiter = limiter(60_000, 6, "You're fetching pages too quickly. Please wait a minute.");
const uploadLimiter = limiter(60_000, 20, "You're adding documents too quickly. Please wait a minute.");

async function contextPayload(orgId: string) {
  const ctx = await getCompanyContext(orgId);
  const docs = await prisma.contextDocument.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, name: true, url: true, charCount: true, createdAt: true },
  });
  return {
    context: {
      companyName: ctx.companyName,
      description: ctx.description,
      products: ctx.products,
      businessModel: ctx.businessModel,
      customers: ctx.customers,
      markets: ctx.markets,
      goals: ctx.goals,
      website: ctx.website,
      websiteFetchedAt: ctx.websiteFetchedAt?.toISOString() ?? null,
      websiteChars: ctx.websiteSummary.length,
      updatedAt: ctx.updatedAt.toISOString(),
    },
    completeness: contextCompleteness(ctx),
    documents: docs.map(toPublicDocument),
    maxDocuments: MAX_CONTEXT_DOCUMENTS,
  };
}

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    res.json(await contextPayload(req.org!.orgId));
  })
);

const profileSchema = z.object(Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, z.string().max(f.max * 2).optional()]))).strict();

router.put(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const patch = parse(profileSchema, req.body ?? {});
    await updateCompanyContext(req.org!.orgId, req.userId!, patch as Record<string, string>);
    res.json(await contextPayload(req.org!.orgId));
  })
);

router.post(
  "/website/refresh",
  fetchLimiter,
  ah<OrgRequest>(async (req, res) => {
    await refreshWebsite(req.org!.orgId);
    res.json(await contextPayload(req.org!.orgId));
  })
);

const docSchema = z.object({
  kind: z.enum(["pdf", "csv", "xlsx", "docx", "txt", "md"], { errorMap: () => ({ message: "kind must be one of pdf, csv, xlsx, docx, txt, md" }) }),
  name: z.string({ required_error: "name is required" }).max(200, "File name is too long"),
  text: z.string({ required_error: "text is required" }),
});

router.post(
  "/documents",
  requireRegistered("add company documents"),
  uploadLimiter,
  ah<OrgRequest>(async (req, res) => {
    const body = parse(docSchema, req.body);
    const doc = await addTextDocument(req.org!.orgId, req.userId!, body);
    res.status(201).json({ document: toPublicDocument(doc), ...(await contextPayload(req.org!.orgId)) });
  })
);

router.post(
  "/documents/link",
  requireRegistered("add company documents"),
  fetchLimiter,
  ah<OrgRequest>(async (req, res) => {
    const { url } = parse(z.object({ url: z.string().trim().min(1, "Enter a web address").max(2048) }), req.body);
    const doc = await addLinkDocument(req.org!.orgId, req.userId!, url);
    res.status(201).json({ document: toPublicDocument(doc), ...(await contextPayload(req.org!.orgId)) });
  })
);

router.delete(
  "/documents/:id",
  ah<OrgRequest>(async (req, res) => {
    await deleteDocument(req.org!.orgId, req.params.id);
    res.json(await contextPayload(req.org!.orgId));
  })
);

export default router;
