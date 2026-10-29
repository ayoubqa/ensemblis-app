// Article schema and checks. Pure (no fs), so the same rules run in the site build, in CI
// (lib/blog/content.spec.ts) and — later — in any automated drafting pipeline.
//
// Errors stop the build: a broken article never deploys. Rules that only matter at publication
// (sources, approval, alt text…) are errors for `published` and warnings for drafts and reviews.
import { analyzeMarkdown, readingMinutes, type Heading, type MarkdownAnalysis } from "./markdown";
import { NO_CTA } from "./cta";
import { DEFAULT_LAYER, LAYERS, type Layer } from "./taxonomy";

export type PostStatus = "draft" | "review" | "published";
export const STATUSES: readonly PostStatus[] = ["draft", "review", "published"];
/** Slugs that collide with routes under /blog. */
export const RESERVED_SLUGS = ["category", "feed.xml", "feed", "editorial-standards", "page", "tag", "search", "index", "readme"];

export interface PostSource {
  title: string;
  url: string;
  publisher?: string;
  /** When the editor last opened and checked this source (YYYY-MM-DD). */
  accessed: string;
  note?: string;
}

export interface Post {
  slug: string;
  title: string;
  summary: string;
  status: PostStatus;
  /** ISO date or date-time; required once published. A future date schedules the article. */
  publishedAt: string | null;
  updatedAt: string | null;
  author: string;
  category: string;
  /** Why the article exists: discovery, problem-solving or product-led (see taxonomy.ts). */
  layer: Layer;
  tags: string[];
  seoTitle: string | null;
  description: string;
  canonical: string | null;
  image: { src: string; alt: string } | null;
  featured: boolean;
  related: string[];
  sources: PostSource[];
  noSourcesReason: string | null;
  /** An explicit call to action, "none", or null to let the layer and section decide. */
  cta: string | null;
  /** Who approved publication, and when the facts were last checked (YYYY-MM-DD). */
  approvedBy: string | null;
  factCheckedAt: string | null;
  body: string;
  headings: Heading[];
  words: number;
  readingMinutes: number;
}

export interface Registries {
  categories: string[];
  authors: string[];
  ctas: string[];
}

export interface ValidationResult {
  post: Post | null;
  errors: string[];
  warnings: string[];
}

const KNOWN_KEYS = new Set([
  "title", "summary", "status", "publishedAt", "updatedAt", "author", "category", "tags", "seoTitle", "description",
  "canonical", "image", "featured", "related", "sources", "noSourcesReason", "cta", "layer", "approvedBy", "factCheckedAt", "editorNotes",
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const isValidDate = (s: unknown): s is string => typeof s === "string" && DATETIME.test(s) && !Number.isNaN(Date.parse(s));

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isHttps = (u: string) => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

export function validatePost(slug: string, data: unknown, body: string, reg: Registries, analysis: MarkdownAnalysis = analyzeMarkdown(body)): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;

  const status = str(fm.status) as PostStatus;
  const published = status === "published";
  /** An error for published articles, a warning before that. */
  const atPublish = (msg: string) => (published ? errors : warnings).push(msg);

  if (!SLUG.test(slug)) errors.push(`file name "${slug}" is not a valid slug (lower-case words joined by hyphens)`);
  if (RESERVED_SLUGS.includes(slug)) errors.push(`slug "${slug}" is reserved by a /blog route`);
  for (const k of Object.keys(fm)) if (!KNOWN_KEYS.has(k)) warnings.push(`unknown frontmatter key "${k}" (typo?)`);

  const title = str(fm.title);
  if (title.length < 10 || title.length > 110) errors.push(`title must be 10–110 characters (is ${title.length})`);
  const summary = str(fm.summary);
  if (summary.length < 50 || summary.length > 320) errors.push(`summary must be 50–320 characters (is ${summary.length})`);
  if (!STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);

  const author = str(fm.author);
  if (!reg.authors.includes(author)) errors.push(`author "${author}" is not in lib/blog/authors.ts`);
  const category = str(fm.category);
  if (!reg.categories.includes(category)) errors.push(`category "${category}" is not in lib/blog/taxonomy.ts`);
  const cta = fm.cta === undefined ? null : str(fm.cta);
  if (cta !== null && cta !== NO_CTA && !reg.ctas.includes(cta)) errors.push(`cta "${cta}" is not in lib/blog/cta.ts (or "${NO_CTA}")`);
  const layer = (fm.layer === undefined ? DEFAULT_LAYER : str(fm.layer)) as Layer;
  if (!LAYERS.includes(layer)) errors.push(`layer must be one of ${LAYERS.join(", ")}`);

  const publishedAt = fm.publishedAt === undefined || fm.publishedAt === null ? null : String(fm.publishedAt).trim();
  if (publishedAt !== null && !isValidDate(publishedAt)) errors.push(`publishedAt "${publishedAt}" is not an ISO date (YYYY-MM-DD or date-time)`);
  if (published && !publishedAt) errors.push("a published article needs publishedAt");
  const updatedAt = fm.updatedAt === undefined || fm.updatedAt === null ? null : String(fm.updatedAt).trim();
  if (updatedAt !== null && !isValidDate(updatedAt)) errors.push(`updatedAt "${updatedAt}" is not an ISO date`);
  if (updatedAt && publishedAt && isValidDate(updatedAt) && isValidDate(publishedAt) && Date.parse(updatedAt) < Date.parse(publishedAt)) {
    errors.push("updatedAt is before publishedAt");
  }

  const tags = Array.isArray(fm.tags) ? fm.tags.map((t) => str(t)) : fm.tags === undefined ? [] : null;
  if (tags === null || tags.some((t) => !SLUG.test(t))) errors.push("tags must be a list of lower-case-hyphenated words");
  if (tags && tags.length > 8) warnings.push("more than 8 tags: tags are for matching related articles, keep the few that matter");

  const seoTitle = fm.seoTitle === undefined ? null : str(fm.seoTitle);
  if (seoTitle !== null && (seoTitle.length < 10 || seoTitle.length > 70)) errors.push(`seoTitle must be 10–70 characters (is ${seoTitle.length})`);
  if (seoTitle === null && title.length > 70) warnings.push("title is over 70 characters; add a shorter seoTitle for search results");
  const description = fm.description === undefined ? summary : str(fm.description);
  if (description.length < 50 || description.length > 170) {
    (fm.description === undefined ? warnings : errors).push(
      `${fm.description === undefined ? "summary (used as meta description)" : "description"} should be 50–170 characters (is ${description.length})`
    );
  }

  const canonical = fm.canonical === undefined ? null : str(fm.canonical);
  if (canonical !== null && !isHttps(canonical)) errors.push("canonical must be an absolute https URL");

  let image: Post["image"] = null;
  if (fm.image !== undefined) {
    const im = fm.image as Record<string, unknown>;
    const src = str(im?.src);
    const alt = str(im?.alt);
    if (!src || !(src.startsWith("/") || isHttps(src))) errors.push("image.src must be a site path (/blog/…) or an https URL");
    if (!alt) errors.push("image.alt is required (describe what the image shows)");
    image = { src, alt };
  }

  const featured = fm.featured === undefined ? false : fm.featured === true;
  if (fm.featured !== undefined && typeof fm.featured !== "boolean") errors.push("featured must be true or false");
  const related = Array.isArray(fm.related) ? fm.related.map((r) => str(r)) : [];
  if (fm.related !== undefined && !Array.isArray(fm.related)) errors.push("related must be a list of slugs");

  const sources: PostSource[] = [];
  if (fm.sources !== undefined && !Array.isArray(fm.sources)) errors.push("sources must be a list");
  for (const [i, raw] of (Array.isArray(fm.sources) ? fm.sources : []).entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const src: PostSource = { title: str(s.title), url: str(s.url), accessed: str(s.accessed), ...(s.publisher ? { publisher: str(s.publisher) } : {}), ...(s.note ? { note: str(s.note) } : {}) };
    if (!src.title) errors.push(`sources[${i}] needs a title`);
    if (!isHttps(src.url)) errors.push(`sources[${i}].url must be an https URL`);
    if (!DATE.test(src.accessed)) errors.push(`sources[${i}].accessed must be the date the source was checked (YYYY-MM-DD)`);
    sources.push(src);
  }
  const noSourcesReason = fm.noSourcesReason === undefined ? null : str(fm.noSourcesReason);
  if (!sources.length && !noSourcesReason) atPublish("list the sources the article relies on (sources), or say why it has none (noSourcesReason)");

  const approvedBy = fm.approvedBy === undefined ? null : str(fm.approvedBy);
  const factCheckedAt = fm.factCheckedAt === undefined ? null : String(fm.factCheckedAt).trim();
  if (published && !approvedBy) errors.push("a published article needs approvedBy: the person who reviewed and approved it");
  if (factCheckedAt !== null && !DATE.test(factCheckedAt)) errors.push("factCheckedAt must be YYYY-MM-DD");
  if (published && !factCheckedAt) errors.push("a published article needs factCheckedAt: when its facts were last checked");

  // Body
  if (!body.trim()) errors.push("the article body is empty");
  if (analysis.h1Count) errors.push("do not use '# ' headings in the body: the title is the page's only h1 (start sections at '## ')");
  for (let i = 1; i < analysis.headings.length; i++) {
    if (analysis.headings[i].depth > analysis.headings[i - 1].depth + 1) warnings.push(`heading "${analysis.headings[i].text}" skips a level`);
  }
  if (analysis.words < 300) atPublish(`the article is very short (${analysis.words} words): thin pages don't help readers or search`);
  for (const im of analysis.images) if (!im.alt) atPublish(`image ${im.url} has no alt text`);
  for (const l of analysis.links) {
    if (/^https?:\/\/(localhost|127\.|[^/]*\.vercel\.app)/i.test(l)) atPublish(`link to a non-public host: ${l}`);
    else if (/^https?:\/\/(www\.)?getensemblis\.com/i.test(l)) warnings.push(`use a relative link for our own pages: ${l}`);
    else if (/^http:\/\//i.test(l)) warnings.push(`insecure http link: ${l}`);
  }

  if (errors.length) return { post: null, errors, warnings };
  return {
    post: {
      slug,
      title,
      summary,
      status,
      publishedAt,
      updatedAt,
      author,
      category,
      layer,
      tags: tags ?? [],
      seoTitle,
      description,
      canonical,
      image,
      featured,
      related,
      sources,
      noSourcesReason,
      cta,
      approvedBy,
      factCheckedAt,
      body,
      headings: analysis.headings,
      words: analysis.words,
      readingMinutes: readingMinutes(analysis.words),
    },
    errors,
    warnings,
  };
}

/**
 * Rules that span articles: every `related` slug exists. (A related article that isn't public yet is fine:
 * pages only ever show related articles the reader can open.)
 */
export function validateCollection(posts: Post[]): string[] {
  const slugs = new Set(posts.map((p) => p.slug));
  return posts.flatMap((p) => p.related.filter((r) => !slugs.has(r)).map((r) => `${p.slug}: related article "${r}" does not exist`));
}
