// Structured data and feeds for the blog. Everything here mirrors what the page shows: the same title,
// dates, author and sources. No ratings, view counts or invented authors.
import { SITE, absoluteUrl } from "@/lib/site";
import { authorByKey } from "./authors";
import { categoryByKey } from "./taxonomy";
import type { Post } from "./validate";

export const BLOG = {
  path: "/blog",
  name: "Ensemblis Journal",
  title: "Ensemblis Journal — practical, sourced writing on AI, strategy and growth",
  description:
    "Sourced, practical writing for people who run businesses: AI and agents at work, strategy, marketing and growth, search and AI discovery, sales and operations.",
  feedPath: "/blog/feed.xml",
  standardsPath: "/blog/editorial-standards",
} as const;

export const postPath = (slug: string) => `${BLOG.path}/${slug}`;
export const categoryPath = (key: string) => `${BLOG.path}/category/${key}`;

function authorJsonLd(key: string) {
  const a = authorByKey(key);
  if (!a) return { "@id": `${SITE.url}/#organization` };
  if (a.kind === "person") {
    return { "@type": "Person", name: a.name, ...(a.role ? { jobTitle: a.role } : {}), ...(a.sameAs?.length ? { sameAs: a.sameAs } : {}) };
  }
  return { "@type": "Organization", name: a.name, url: absoluteUrl(BLOG.standardsPath), parentOrganization: { "@id": `${SITE.url}/#organization` } };
}

export function blogPostingJsonLd(post: Post) {
  const url = absoluteUrl(postPath(post.slug));
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    mainEntityOfPage: url,
    url,
    headline: post.title.slice(0, 110),
    description: post.description,
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt ?? post.publishedAt ? { dateModified: post.updatedAt ?? post.publishedAt } : {}),
    author: authorJsonLd(post.author),
    publisher: { "@id": `${SITE.url}/#organization` },
    image: post.image ? (post.image.src.startsWith("/") ? absoluteUrl(post.image.src) : post.image.src) : absoluteUrl(`${postPath(post.slug)}/opengraph-image`),
    articleSection: categoryByKey(post.category)?.name,
    ...(post.tags.length ? { keywords: post.tags.join(", ") } : {}),
    wordCount: post.words,
    inLanguage: "en",
    isPartOf: { "@type": "Blog", "@id": `${absoluteUrl(BLOG.path)}#blog`, name: BLOG.name },
    ...(post.sources.length
      ? { citation: post.sources.map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url, ...(s.publisher ? { publisher: { "@type": "Organization", name: s.publisher } } : {}) })) }
      : {}),
  };
}

export function blogJsonLd(posts: Post[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${absoluteUrl(BLOG.path)}#blog`,
    name: BLOG.name,
    description: BLOG.description,
    url: absoluteUrl(BLOG.path),
    inLanguage: "en",
    publisher: { "@id": `${SITE.url}/#organization` },
    blogPost: posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.title.slice(0, 110),
      url: absoluteUrl(postPath(p.slug)),
      ...(p.publishedAt ? { datePublished: p.publishedAt } : {}),
    })),
  };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** RSS 2.0 of the given (already public) posts. */
export function rssFeed(posts: Post[], now: Date = new Date()): string {
  const items = posts
    .slice(0, 50)
    .map((p) => {
      const url = absoluteUrl(postPath(p.slug));
      const category = categoryByKey(p.category)?.name;
      return [
        "    <item>",
        `      <title>${xml(p.title)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <description>${xml(p.summary)}</description>`,
        p.publishedAt ? `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : "",
        category ? `      <category>${xml(category)}</category>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(BLOG.name)}</title>
    <link>${xml(absoluteUrl(BLOG.path))}</link>
    <description>${xml(BLOG.description)}</description>
    <language>en</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    <atom:link href="${xml(absoluteUrl(BLOG.feedPath))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}
