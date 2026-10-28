import type { MetadataRoute } from "next";
import indexing from "@/lib/indexing.json";
import { absoluteUrl } from "@/lib/site";
import { CATEGORIES } from "@/lib/blog/taxonomy";
import { INDEXABLE_CATEGORY_MIN, lastModified, postsInCategory, visiblePosts } from "@/lib/blog/posts";
import { BLOG, categoryPath, postPath } from "@/lib/blog/seo";

type Freq = MetadataRoute.Sitemap[number]["changeFrequency"];

// Re-generated hourly so a scheduled article joins the sitemap when it goes live.
export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = indexing.publicPages.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: p.changeFrequency as Freq, priority: p.priority }));
  // Public articles only — never drafts, reviews or scheduled articles (visiblePosts in "public" mode).
  const posts = visiblePosts(undefined, "public");
  if (!posts.length) return pages;
  const newest = posts.map(lastModified).filter((d): d is string => !!d).sort().pop();
  return [
    ...pages,
    { url: absoluteUrl(BLOG.path), changeFrequency: "weekly", priority: 0.7, ...(newest ? { lastModified: newest } : {}) },
    ...posts.map((p) => ({ url: absoluteUrl(postPath(p.slug)), changeFrequency: "monthly" as Freq, priority: 0.6, ...(lastModified(p) ? { lastModified: lastModified(p)! } : {}) })),
    ...CATEGORIES.filter((c) => postsInCategory(c.key, posts).length >= INDEXABLE_CATEGORY_MIN).map((c) => ({ url: absoluteUrl(categoryPath(c.key)), changeFrequency: "weekly" as Freq, priority: 0.5 })),
  ];
}
