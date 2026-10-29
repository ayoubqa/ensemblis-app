import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeMarkdown, readingMinutes, slugify } from "./markdown";
import { validatePost, validateCollection, type Post } from "./validate";
import { blogMode, postState, readContent, relatedPosts, splitFrontmatter, staticSlugs, visiblePost, visiblePosts, REGISTRIES } from "./posts";
import { blogPostingJsonLd, rssFeed } from "./seo";
import { ctaFor } from "./cta";
import { resolveSiteUrl, PRIMARY_ORIGIN } from "@/lib/site";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const BODY = `## What it is\n\n${words(400)}\n\n## How to measure it\n\n${words(100)}\n`;

const base = {
  title: "What generative engine optimization is",
  summary: "A practical definition of generative engine optimization, how it differs from SEO, and what it cannot promise.",
  status: "published",
  publishedAt: "2026-11-02",
  author: "ensemblis-editorial",
  category: "ai-search",
  tags: ["geo", "ai-search"],
  sources: [{ title: "GEO: Generative Engine Optimization", url: "https://arxiv.org/abs/2311.09735", accessed: "2026-10-28" }],
  approvedBy: "A. Editor",
  factCheckedAt: "2026-10-30",
};

const check = (fm: Record<string, unknown>, body = BODY, slug = "what-is-geo") => validatePost(slug, fm, body, REGISTRIES);
const post = (over: Partial<Post> & { slug: string }): Post => {
  const r = check({ ...base, ...over }, BODY, over.slug);
  if (!r.post) throw new Error(r.errors.join("; "));
  return { ...r.post, ...over };
};

describe("markdown", () => {
  it("gives headings stable, de-duplicated ids and reports them for the table of contents", () => {
    const a = analyzeMarkdown("## What is GEO?\n\ntext\n\n### Café & co.\n\n## What is GEO?\n\n#### Deep\n");
    expect(a.headings).toEqual([
      { depth: 2, text: "What is GEO?", id: "what-is-geo" },
      { depth: 3, text: "Café & co.", id: "cafe-co" },
      { depth: 2, text: "What is GEO?", id: "what-is-geo-2" },
      { depth: 4, text: "Deep", id: "deep" },
    ]);
  });
  it("turns [!TYPE] blockquotes into callouts, counts words outside code, images and footnotes", () => {
    const a = analyzeMarkdown("> [!DEFINITION]\n> GEO is a thing.\n\nOne two three.\n\n```\ncode words here\n```\n\n![A chart](/x.png)\n\nText[^1]\n\n[^1]: A source.\n");
    expect(a.callouts).toBe(1);
    expect(a.images).toEqual([{ url: "/x.png", alt: "A chart" }]);
    expect(a.footnotes).toBe(1);
    expect(a.words).toBeGreaterThanOrEqual(8);
    expect(a.words).toBeLessThan(14); // code block words are not counted
  });
  it("a callout marker alone on its line before a list leaves no empty paragraph", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ArticleBody } = await import("@/components/blog/ArticleBody");
    const html = renderToStaticMarkup(createElement(ArticleBody, { markdown: "> [!METHOD]\n> 1. First\n> 2. Second\n" }));
    expect(html).toContain('<aside class="callout" data-callout="method" data-label="Method">');
    expect(html).not.toMatch(/<p><\/p>/);
    expect(html).toContain("<li>First</li>");
  });

  it("slugifies and estimates reading time", () => {
    expect(slugify("  How AI Overviews pick sources — 2026 ")).toBe("how-ai-overviews-pick-sources-2026");
    expect(slugify("???")).toBe("section");
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(2300)).toBe(10);
  });
});

describe("validatePost", () => {
  it("accepts a complete published article", () => {
    const r = check(base);
    expect(r.errors).toEqual([]);
    expect(r.post).toMatchObject({ slug: "what-is-geo", status: "published", readingMinutes: 2, description: base.summary });
    expect(r.post?.headings.map((h) => h.id)).toEqual(["what-it-is", "how-to-measure-it"]);
  });

  it("refuses to publish without a human approval, a fact-check date, sources and a date", () => {
    const { approvedBy, factCheckedAt, sources, publishedAt, ...bare } = base;
    void approvedBy, factCheckedAt, sources, publishedAt;
    const r = check(bare);
    expect(r.post).toBeNull();
    expect(r.errors.join("\n")).toMatch(/needs approvedBy/);
    expect(r.errors.join("\n")).toMatch(/needs factCheckedAt/);
    expect(r.errors.join("\n")).toMatch(/list the sources/);
    expect(r.errors.join("\n")).toMatch(/needs publishedAt/);
  });

  it("lets drafts and reviews be incomplete (warnings, not errors)", () => {
    const r = check({ title: base.title, summary: base.summary, status: "review", author: base.author, category: base.category }, "## Short\n\nA short draft.\n");
    expect(r.errors).toEqual([]);
    expect(r.warnings.join("\n")).toMatch(/list the sources/);
    expect(r.warnings.join("\n")).toMatch(/very short/);
  });

  it("rejects unknown registries, bad dates, unsafe URLs and missing alt text", () => {
    const r = check(
      {
        ...base,
        author: "ghost-writer",
        category: "crypto",
        cta: "buy-now",
        publishedAt: "next tuesday",
        canonical: "http://example.com/x",
        image: { src: "javascript:alert(1)", alt: "" },
        sources: [{ title: "", url: "http://insecure.example", accessed: "yesterday" }],
      },
      `## A\n\n${words(400)}\n\n![](/img.png)\n\n[preview](https://ensemblis-app-git-x.vercel.app/blog)\n`
    );
    const all = r.errors.join("\n");
    for (const m of [/author "ghost-writer"/, /category "crypto"/, /cta "buy-now"/, /publishedAt "next tuesday"/, /canonical must be/, /image.src/, /image.alt/, /sources\[0\] needs a title/, /sources\[0\].url/, /sources\[0\].accessed/, /has no alt text/, /non-public host/]) {
      expect(all).toMatch(m);
    }
  });

  it("keeps the title as the only h1, flags reserved slugs, skipped heading levels and typos in keys", () => {
    const r = check({ ...base, titel: "typo" }, `# Second title\n\n## A\n\n#### Skipped\n\n${words(400)}`, "category");
    expect(r.errors.join("\n")).toMatch(/only h1/);
    expect(r.errors.join("\n")).toMatch(/reserved/);
    expect(r.warnings.join("\n")).toMatch(/unknown frontmatter key "titel"/);
    expect(r.warnings.join("\n")).toMatch(/skips a level/);
  });

  it("checks that related articles exist", () => {
    const a = post({ slug: "a", related: ["b", "missing"] });
    const b = post({ slug: "b" });
    expect(validateCollection([a, b])).toEqual(['a: related article "missing" does not exist']);
  });
});

describe("visibility", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const pub = post({ slug: "pub", publishedAt: "2026-11-01" });
  const later = post({ slug: "later", publishedAt: "2026-11-20T09:00:00+01:00" });
  const review = post({ slug: "review", status: "review", publishedAt: null });
  const draft = post({ slug: "draft", status: "draft", publishedAt: null });
  const all = [pub, later, review, draft];

  it("knows each article's state, scheduling included", () => {
    expect([pub, later, review, draft].map((p) => postState(p, now))).toEqual(["published", "scheduled", "review", "draft"]);
    expect(postState(later, new Date("2026-11-21T00:00:00Z"))).toBe("published");
  });

  it("public mode shows only published articles whose date has passed — drafts, reviews and scheduled never leak", () => {
    expect(visiblePosts(all, "public", now).map((p) => p.slug)).toEqual(["pub"]);
    for (const slug of ["later", "review", "draft"]) expect(visiblePost(slug, all, "public", now)).toBeNull();
    // scheduled articles are pre-rendered (as 404 until their date), drafts and reviews are not
    expect(staticSlugs(all, "public").sort()).toEqual(["later", "pub"]);
  });

  it("preview mode shows everything, newest first, undated drafts last", () => {
    expect(visiblePosts(all, "preview", now).map((p) => p.slug)).toEqual(["later", "pub", "review", "draft"]);
  });

  it("previews only where nobody but the team looks", () => {
    expect(blogMode({ NODE_ENV: "production" })).toBe("public");
    expect(blogMode({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe("public");
    expect(blogMode({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe("preview");
    expect(blogMode({ NODE_ENV: "development" })).toBe("preview");
    expect(blogMode({ NODE_ENV: "production", BLOG_PREVIEW: "1" })).toBe("preview");
  });
});

describe("related articles and calls to action", () => {
  it("prefers listed related articles, then category and shared tags; never the article itself", () => {
    const main = post({ slug: "main", related: ["listed"], tags: ["geo", "measurement"] });
    const listed = post({ slug: "listed", category: "ai-for-business", tags: [] });
    const sameCat = post({ slug: "same-cat", tags: [] });
    const tagged = post({ slug: "tagged", category: "measurement", tags: ["measurement"] });
    const unrelated = post({ slug: "unrelated", category: "seo-strategy", tags: ["links"] });
    expect(relatedPosts(main, [main, unrelated, tagged, sameCat, listed]).map((p) => p.slug)).toEqual(["listed", "same-cat", "tagged"]);
  });
  it("chooses the article's CTA, else the category default", () => {
    expect(ctaFor({ cta: "pricing", category: "ai-search" }).key).toBe("pricing");
    expect(ctaFor({ category: "ai-for-business" }).key).toBe("research-brief");
    expect(ctaFor({ cta: "nonsense", category: "unknown" }).key).toBe("how-it-works");
  });
});

describe("structured data and feed", () => {
  it("BlogPosting mirrors the page: dates, organization author, sources as citations", () => {
    const p = post({ slug: "what-is-geo", updatedAt: "2026-11-05" });
    const ld = blogPostingJsonLd(p);
    expect(ld).toMatchObject({ "@type": "BlogPosting", headline: p.title, datePublished: "2026-11-02", dateModified: "2026-11-05", articleSection: "AI Search & GEO", wordCount: p.words });
    expect(ld.author).toMatchObject({ "@type": "Organization", name: "Ensemblis Editorial" });
    expect(ld.citation).toEqual([{ "@type": "CreativeWork", name: base.sources[0].title, url: base.sources[0].url }]);
    expect(JSON.stringify(ld)).not.toMatch(/rating|review/i);
  });
  it("RSS escapes text and lists only what it is given", () => {
    const p = post({ slug: "x", title: "Tags & <angles> in \"titles\"" });
    const xml = rssFeed([p], new Date("2026-11-10T00:00:00Z"));
    expect(xml).toContain("<title>Tags &amp; &lt;angles&gt; in &quot;titles&quot;</title>");
    expect(xml).toContain("/blog/x</link>");
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });
});

describe("content files", () => {
  let dir = "";
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  it("reads frontmatter + Markdown, ignores templates and READMEs, and reports broken files instead of skipping them", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-"));
    const fm = (o: Record<string, unknown>) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n`;
    fs.writeFileSync(path.join(dir, "good-one.md"), fm(base) + BODY);
    fs.writeFileSync(path.join(dir, "_template.md"), "not an article");
    fs.writeFileSync(path.join(dir, "README.md"), "# docs");
    fs.writeFileSync(path.join(dir, "no-frontmatter.md"), "## Just text\n");
    fs.writeFileSync(path.join(dir, "bad-yaml.md"), "---\ntitle: [unclosed\n---\nbody");
    const r = readContent(dir);
    expect(r.posts.map((p) => p.slug)).toEqual(["good-one"]);
    expect(r.errors.join("\n")).toMatch(/no-frontmatter.md: missing frontmatter/);
    expect(r.errors.join("\n")).toMatch(/bad-yaml.md: frontmatter is not valid YAML/);
  });

  it("keeps dates as strings (no YAML timestamp coercion)", () => {
    expect(splitFrontmatter("---\npublishedAt: 2026-11-02\n---\nx").data).toEqual({ publishedAt: "2026-11-02" });
  });
});

describe("canonical origin", () => {
  it("uses the primary domain on Vercel (production and previews), an explicit override anywhere, localhost otherwise", () => {
    expect(resolveSiteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "getensemblis.com" })).toBe(PRIMARY_ORIGIN);
    expect(resolveSiteUrl({ VERCEL_ENV: "preview" })).toBe("https://www.getensemblis.com");
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com/", VERCEL_ENV: "production" })).toBe("https://example.com");
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
  });
});
