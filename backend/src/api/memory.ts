// /api/memory — review, edit, confirm, archive and delete what Ensemblis learned. Org-scoped.

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { ah, parse } from "../lib/http";
import { cleanText } from "../research/text";
import { requireOrg, type OrgRequest } from "../org/organization";
import { createMemory, deleteMemory, listMemories, MEMORY_KINDS, toPublicMemory, updateMemory } from "../memory/service";

const router = Router();
router.use(requireAuth, requireOrg);

const kind = z.enum(MEMORY_KINDS as [string, ...string[]]) as z.ZodType<(typeof MEMORY_KINDS)[number]>;
const content = z
  .string()
  .transform((s) => cleanText(s).trim())
  .pipe(z.string().min(5, "Write the memory in a sentence").max(600));

router.get(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["ACTIVE", "PENDING_CONFIRMATION", "ARCHIVED"]).optional() }), req.query);
    res.json({ memories: (await listMemories(req.org!.orgId, status)).map(toPublicMemory) });
  })
);

router.post(
  "/",
  ah<OrgRequest>(async (req, res) => {
    const body = parse(z.object({ kind, content }), req.body);
    res.status(201).json({ memory: toPublicMemory(await createMemory(req.org!.orgId, req.userId!, body)) });
  })
);

router.patch(
  "/:id",
  ah<OrgRequest>(async (req, res) => {
    const body = parse(z.object({ kind: kind.optional(), content: content.optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }).strict(), req.body ?? {});
    res.json({ memory: toPublicMemory(await updateMemory(req.org!.orgId, req.userId!, req.params.id, body)) });
  })
);

router.delete(
  "/:id",
  ah<OrgRequest>(async (req, res) => {
    await deleteMemory(req.org!.orgId, req.params.id);
    res.json({ ok: true });
  })
);

export default router;
