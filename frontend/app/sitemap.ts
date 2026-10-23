import type { MetadataRoute } from "next";
import indexing from "@/lib/indexing.json";
import { absoluteUrl } from "@/lib/site";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

export default function sitemap(): MetadataRoute.Sitemap {
  return indexing.publicPages.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: p.changeFrequency as Freq, priority: p.priority }));
}
