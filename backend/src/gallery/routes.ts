// Public gallery of example and featured reports (v3).
// GET /api/gallery        -> { items } (no `content`)
// GET /api/gallery/:slug  -> { item } (with `content`)

import { Router } from "express";
import { prisma } from "../db";
import { ah, HttpError } from "../lib/http";
import { GALLERY_LIST_SELECT, toPublicGalleryItem, toPublicGalleryListItem } from "../lib/serializers";

const router = Router();

const CACHE = "public, max-age=60, stale-while-revalidate=600";

export async function listPublishedGallery() {
  const rows = await prisma.galleryItem.findMany({
    where: { isPublished: true },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    select: GALLERY_LIST_SELECT,
  });
  return rows.map(toPublicGalleryListItem);
}

router.get(
  "/",
  ah(async (_req, res) => {
    const items = await listPublishedGallery();
    res.set("Cache-Control", CACHE);
    res.json({ items });
  })
);

router.get(
  "/:slug",
  ah(async (req, res) => {
    const slug = req.params.slug;
    if (!/^[a-z0-9-]{1,140}$/i.test(slug)) throw new HttpError(404, "Example not found");
    const item = await prisma.galleryItem.findFirst({ where: { slug, isPublished: true } });
    if (!item) throw new HttpError(404, "Example not found");
    res.set("Cache-Control", CACHE);
    res.json({ item: toPublicGalleryItem(item, true) });
  })
);

export default router;
