// The article store: Markdown files in content/blog/<slug>.md, read on the server (build time, and on
// revalidation so scheduled articles go live without a deploy). Server-only: never import from a client
// component.
//
// Who sees what:
//   public  (production, `next start`)  only `published` articles whose publishedAt has passed.
//   preview (next dev, Vercel preview deployments, BLOG_PREVIEW=1)  every article, labelled with its state,
//           never indexable — this is how an editor reviews a draft before approving it.
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { AUTHORS } from "./authors";
import { CTAS } from "./cta";
import { CATEGORIES } from "./taxonomy";
import { validateCollection, validatePost, type Post } from "./validate";

export type { Post } from "./validate";
export type PostState = "draft" | "review" | "scheduled" | "published";
export type BlogMode = "public" | "preview";

/** A category page is indexable (and in the sitemap) once it holds this many public articles. */
export const INDEXABLE_CATEGORY_MIN = 3;

export const CONTENT_DIR = path.join(process.cwd(), "content", "blog");

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(source: string): { data: unknown; body: string } {
  const m = FRONTMATTER.exec(source);
  if (!m) return { data: null, body: source };
  return { data: parseYaml(m[1]), body: source.slice(m[0].length) };
}

export const REGISTRIES = { categories: CATEGORIES.map((c) => c.key), authors: Object.keys(AUTHORS), ctas: Object.keys(CTAS) };

export interface LoadReport {
  posts: Post[];
  errors: string[];
  warnings: string[];
}

/** Reads and checks every article. Files starting with "_" and README.md are ignored (templates, docs). */
export function readContent(dir = CONTENT_DIR): LoadReport {
  const report: LoadReport = { posts: [], errors: [], warnings: [] };
  if (!fs.existsSync(dir)) return report;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
    .sort();
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    let parsed: { data: unknown; body: string };
    try {
      parsed = splitFrontmatter(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      report.errors.push(`${file}: frontmatter is not valid YAML (${err instanceof Error ? err.message.split("\n")[0] : err})`);
      continue;
    }
    if (parsed.data === null) {
      report.errors.push(`${file}: missing frontmatter (--- … --- at the top)`);
      continue;
    }
    const r = validatePost(slug, parsed.data, parsed.body, REGISTRIES);
    report.errors.push(...r.errors.map((e) => `${file}: ${e}`));
    report.warnings.push(...r.warnings.map((w) => `${file}: ${w}`));
    if (r.post) report.posts.push(r.post);
  }
  report.errors.push(...validateCollection(report.posts));
  return report;
}

let cache: Post[] | null = null;

/** Every article, checked. Throws on any error so a broken article fails the build instead of deploying. */
export function allPosts(): Post[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const r = readContent();
  if (r.errors.length) throw new Error(`content/blog has ${r.errors.length} problem(s):\n- ${r.errors.join("\n- ")}`);
  cache = r.posts;
  return r.posts;
}

export function blogMode(env: Record<string, string | undefined> = process.env): BlogMode {
  if (env.BLOG_PREVIEW === "1" || env.VERCEL_ENV === "preview" || env.NODE_ENV === "development") return "preview";
  return "public";
}

export function postState(post: Pick<Post, "status" | "publishedAt">, now: Date = new Date()): PostState {
  if (post.status !== "published") return post.status;
  return post.publishedAt && Date.parse(post.publishedAt) <= now.getTime() ? "published" : "scheduled";
}

export const isPublic = (post: Pick<Post, "status" | "publishedAt">, now: Date = new Date()) => postState(post, now) === "published";

/** Newest first; undated drafts after dated articles, by title. */
export function sortPosts(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const da = a.publishedAt ? Date.parse(a.publishedAt) : -Infinity;
    const db = b.publishedAt ? Date.parse(b.publishedAt) : -Infinity;
    return db - da || a.title.localeCompare(b.title);
  });
}

export function visiblePosts(posts: Post[] = allPosts(), mode: BlogMode = blogMode(), now: Date = new Date()): Post[] {
  return sortPosts(mode === "preview" ? posts : posts.filter((p) => isPublic(p, now)));
}

export function visiblePost(slug: string, posts: Post[] = allPosts(), mode: BlogMode = blogMode(), now: Date = new Date()): Post | null {
  return visiblePosts(posts, mode, now).find((p) => p.slug === slug) ?? null;
}

/**
 * Slugs to pre-render. Public mode includes scheduled articles so that, once their date passes,
 * revalidation can publish them without a deploy (until then the page answers 404).
 */
export function staticSlugs(posts: Post[] = allPosts(), mode: BlogMode = blogMode()): string[] {
  return (mode === "preview" ? posts : posts.filter((p) => p.status === "published")).map((p) => p.slug);
}

/** Up to `n` related articles from `pool`: listed `related` first, then by shared category and tags. */
export function relatedPosts(post: Post, pool: Post[], n = 3): Post[] {
  const others = pool.filter((p) => p.slug !== post.slug);
  const score = (p: Post) => {
    const listed = post.related.indexOf(p.slug);
    if (listed >= 0) return 1000 - listed;
    return (p.category === post.category ? 3 : 0) + p.tags.filter((t) => post.tags.includes(t)).length;
  };
  return others
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (Date.parse(b.p.publishedAt ?? "") || 0) - (Date.parse(a.p.publishedAt ?? "") || 0))
    .slice(0, n)
    .map((x) => x.p);
}

export function postsInCategory(category: string, posts: Post[]): Post[] {
  return posts.filter((p) => p.category === category);
}

/** The newest date the article changed (for sitemaps and dateModified). */
export const lastModified = (p: Post) => p.updatedAt ?? p.publishedAt ?? null;

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
