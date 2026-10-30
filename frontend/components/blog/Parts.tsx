// Small server components shared by the blog pages.
import Link from "next/link";
import { authorByKey } from "@/lib/blog/authors";
import { LAYER_LABEL, categoryByKey } from "@/lib/blog/taxonomy";
import { categoryPath, postPath } from "@/lib/blog/seo";
import { formatDate, postState, type Post, type PostState } from "@/lib/blog/posts";
import type { Heading } from "@/lib/blog/markdown";
import { ACCENTS, traceSvg } from "@/lib/trace";

export const accentOf = (category: string) => ACCENTS[category] ?? ACCENTS.default;

/** The generated cover for an article (decorative). */
export function TracePlate({ seed, accent, className = "" }: { seed: string; accent?: string; className?: string }) {
  return <span className={`tp ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: traceSvg(seed, accent) }} />;
}

export function CategoryLabel({ category, link = true }: { category: string; link?: boolean }) {
  const c = categoryByKey(category);
  if (!c) return null;
  const style = { "--cat": accentOf(category) } as React.CSSProperties;
  return link ? (
    <Link href={categoryPath(c.key)} className="ed-cat" style={style}>
      {c.name}
    </Link>
  ) : (
    <span className="ed-cat" style={style}>
      {c.name}
    </span>
  );
}

const STATE_LABEL: Record<PostState, string> = { draft: "Draft", review: "In review", scheduled: "Scheduled", published: "Published" };

/** Only rendered in preview mode: what state an article is in, so nobody mistakes a draft for a live page. */
export function StateBadge({ post }: { post: Post }) {
  const s = postState(post);
  if (s === "published") return null;
  return (
    <span className={`ed-state ed-state-${s}`}>
      {STATE_LABEL[s]}
      {s === "scheduled" && post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ""}
    </span>
  );
}

export function Meta({ post }: { post: Post }) {
  const author = authorByKey(post.author);
  return (
    <p className="ed-meta">
      {author && <span>{author.name}</span>}
      {post.publishedAt && (
        <span>
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
        </span>
      )}
      {post.updatedAt && (
        <span>
          Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time>
        </span>
      )}
      <span>{post.readingMinutes} min read</span>
      <span className={`ed-layer ed-layer-${post.layer}`}>{LAYER_LABEL[post.layer]}</span>
    </p>
  );
}

/** A post in a list: typographic, with its trace plate. `size="lead"` for the featured article. */
export function PostItem({ post, size = "row", preview = false, headingLevel = 3 }: { post: Post; size?: "lead" | "row"; preview?: boolean; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  return (
    <article className={`ed-item ed-item-${size}`}>
      <Link href={postPath(post.slug)} className="ed-item-art" tabIndex={-1} aria-hidden="true">
        <TracePlate seed={post.slug} accent={accentOf(post.category)} />
      </Link>
      <div className="ed-item-text">
        <p className="ed-item-top">
          <CategoryLabel category={post.category} />
          {preview && <StateBadge post={post} />}
        </p>
        <H className="ed-item-title">
          <Link href={postPath(post.slug)}>{post.title}</Link>
        </H>
        <p className="ed-item-sum">{post.summary}</p>
        <Meta post={post} />
      </div>
    </article>
  );
}

export function Toc({ headings }: { headings: Heading[] }) {
  const items = headings.filter((h) => h.depth <= 3);
  if (items.length < 3) return null;
  return (
    <nav className="ed-toc" aria-labelledby="ed-toc-h">
      <p className="ed-toc-h" id="ed-toc-h">
        In this article
      </p>
      <ol>
        {items.map((h) => (
          <li key={h.id} className={h.depth === 3 ? "sub" : undefined}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ed-crumbs">
      <ol>
        {items.map((it, i) => (
          <li key={it.name}>
            {it.href && i < items.length - 1 ? <Link href={it.href}>{it.name}</Link> : <span aria-current="page">{it.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
