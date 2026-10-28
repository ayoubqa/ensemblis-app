import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, PostItem, accentOf } from "@/components/blog/Parts";
import { TrackedLink } from "@/components/site/TrackedLink";
import { CATEGORIES, categoryByKey } from "@/lib/blog/taxonomy";
import { INDEXABLE_CATEGORY_MIN, blogMode, postsInCategory, visiblePosts } from "@/lib/blog/posts";
import { BLOG, categoryPath } from "@/lib/blog/seo";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/site";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.key }));
}

export function generateMetadata({ params }: { params: { category: string } }): Metadata {
  const c = categoryByKey(params.category);
  if (!c) return { title: "Not found", robots: { index: false, follow: false } };
  const count = postsInCategory(c.key, visiblePosts()).length;
  return {
    ...pageMetadata({ title: `${c.name} — Ensemblis Journal`, description: c.description, path: categoryPath(c.key) }),
    alternates: { canonical: categoryPath(c.key), types: { "application/rss+xml": BLOG.feedPath } },
    // A topic page with one or two articles adds nothing the articles don't: indexable from INDEXABLE_CATEGORY_MIN.
    ...(count >= INDEXABLE_CATEGORY_MIN && blogMode() === "public" ? {} : { robots: { index: false, follow: true } }),
  };
}

export default function CategoryPage({ params }: { params: { category: string } }) {
  const c = categoryByKey(params.category);
  if (!c) notFound();
  const mode = blogMode();
  const posts = postsInCategory(c.key, visiblePosts());
  // An empty topic is not a page.
  if (!posts.length) notFound();

  return (
    <div className="ed">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Journal", path: BLOG.path }, { name: c.name, path: categoryPath(c.key) }])} />
      <header className="ed-hub-head ed-cat-head dk" style={{ "--cat": accentOf(c.key) } as React.CSSProperties}>
        <div className="wrap">
          <Breadcrumbs items={[{ name: "Journal", href: BLOG.path }, { name: c.name }]} />
          <p className="st-kicker">
            <span className="st-node" aria-hidden="true" />
            Topic
          </p>
          <h1 className="ed-hub-title">{c.name}</h1>
          <p className="ed-hub-lead">{c.description}</p>
        </div>
      </header>
      <div className="wrap ed-hub">
        <div className="ed-list">
          {posts.map((p, i) => (
            <PostItem key={p.slug} post={p} preview={mode === "preview"} headingLevel={2} size={i === 0 ? "lead" : "row"} />
          ))}
        </div>
        <p className="ed-related-more">
          <TrackedLink href={c.next.href} event="blog_related_click" props={{ slug: `category:${c.key}`, to: c.next.href }} className="st-textlink">
            {c.next.label} →
          </TrackedLink>
        </p>
      </div>
    </div>
  );
}
