import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { ArticleBody } from "@/components/blog/ArticleBody";
import { ArticleCta, ShareLinks } from "@/components/blog/ArticleCta";
import { Breadcrumbs, CategoryLabel, Meta, PostItem, StateBadge, Toc, TracePlate, accentOf } from "@/components/blog/Parts";
import { TrackedLink } from "@/components/site/TrackedLink";
import { authorByKey } from "@/lib/blog/authors";
import { ctaFor } from "@/lib/blog/cta";
import { blogMode, formatDate, postState, relatedPosts, staticSlugs, visiblePost, visiblePosts } from "@/lib/blog/posts";
import { BLOG, blogPostingJsonLd, categoryPath, postPath } from "@/lib/blog/seo";
import { categoryByKey } from "@/lib/blog/taxonomy";
import { SITE, absoluteUrl, breadcrumbJsonLd } from "@/lib/site";

// Scheduled articles are pre-rendered as 404 and go live on the first revalidation after their date.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return staticSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = visiblePost(params.slug);
  if (!post) return { title: "Article not found", robots: { index: false, follow: false } };
  const path = postPath(post.slug);
  const title = post.seoTitle ?? post.title;
  const indexable = blogMode() === "public" && postState(post) === "published";
  const category = categoryByKey(post.category)?.name;
  return {
    title,
    description: post.description,
    alternates: { canonical: post.canonical ?? path, types: { "application/rss+xml": BLOG.feedPath } },
    openGraph: {
      type: "article",
      title,
      description: post.description,
      url: path,
      siteName: SITE.name,
      locale: "en_US",
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      ...(post.updatedAt ? { modifiedTime: post.updatedAt } : {}),
      ...(category ? { section: category } : {}),
      tags: post.tags,
      ...(post.image ? { images: [{ url: post.image.src, alt: post.image.alt }] } : {}),
    },
    twitter: { card: "summary_large_image", title, description: post.description },
    ...(indexable ? {} : { robots: { index: false, follow: false } }),
  };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const post = visiblePost(params.slug);
  if (!post) notFound();
  const mode = blogMode();
  const state = postState(post);
  const category = categoryByKey(post.category);
  const author = authorByKey(post.author);
  const related = relatedPosts(post, visiblePosts());
  const url = absoluteUrl(postPath(post.slug));
  const cta = ctaFor({ cta: post.cta ?? undefined, category: post.category });

  return (
    <article className="ed ed-article" aria-labelledby="ed-title">
      {state === "published" && (
        <JsonLd
          data={[
            blogPostingJsonLd(post),
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Journal", path: BLOG.path },
              ...(category ? [{ name: category.name, path: categoryPath(category.key) }] : []),
              { name: post.title, path: postPath(post.slug) },
            ]),
          ]}
        />
      )}
      {mode === "preview" && state !== "published" && (
        <p className="ed-preview-bar" role="note">
          <StateBadge post={post} /> This article is not public. It is visible here because this is a preview, and it is never indexed.
        </p>
      )}

      <header className="ed-art-head dk" style={{ "--cat": accentOf(post.category) } as React.CSSProperties}>
        <div className="ed-art-plate" aria-hidden="true">
          <TracePlate seed={post.slug} accent={accentOf(post.category)} />
        </div>
        <div className="wrap ed-art-head-in">
          <Breadcrumbs items={[{ name: "Journal", href: BLOG.path }, ...(category ? [{ name: category.name, href: categoryPath(category.key) }] : []), { name: post.title }]} />
          <p className="ed-item-top">
            <CategoryLabel category={post.category} />
          </p>
          <h1 id="ed-title" className="ed-art-title">
            {post.title}
          </h1>
          <p className="ed-art-dek">{post.summary}</p>
          <Meta post={post} />
        </div>
      </header>

      <div className="wrap ed-art-grid">
        <aside className="ed-art-side">
          <Toc headings={post.headings} />
        </aside>

        <div className="ed-art-main">
          <ArticleBody markdown={post.body} />

          {post.sources.length > 0 && (
            <section className="ed-sources" aria-labelledby="ed-sources-h">
              <h2 id="ed-sources-h">Sources</h2>
              <ol>
                {post.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noopener">
                      {s.title}
                    </a>
                    {s.publisher && <span className="ed-src-pub"> — {s.publisher}</span>}
                    <span className="ed-src-date"> Checked {formatDate(s.accessed)}.</span>
                    {s.note && <span className="ed-src-note"> {s.note}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="ed-provenance" aria-labelledby="ed-prov-h">
            <h2 id="ed-prov-h">How this article was checked</h2>
            <p>
              {post.factCheckedAt ? <>Facts and sources last checked on {formatDate(post.factCheckedAt)}. </> : <>Not yet fact-checked. </>}
              {post.approvedBy ? <>Approved for publication by {post.approvedBy}. </> : <>Not yet approved for publication. </>}
              {post.noSourcesReason && <>No external sources: {post.noSourcesReason} </>}
              Read our <Link href={BLOG.standardsPath}>editorial standards</Link>, including how to report an error.
            </p>
          </section>

          {author && (
            <section className="ed-author" aria-label="About the author">
              <p className="ed-author-name">{author.name}</p>
              <p>{author.bio}</p>
            </section>
          )}

          <ShareLinks url={url} title={post.title} />
          <ArticleCta cta={cta} slug={post.slug} />
        </div>
      </div>

      {related.length > 0 && (
        <section className="ed-related wrap" aria-labelledby="ed-related-h">
          <h2 id="ed-related-h" className="ed-sec-h">
            Read next
          </h2>
          <div className="ed-list ed-list-3">
            {related.map((p) => (
              <PostItem key={p.slug} post={p} preview={mode === "preview"} />
            ))}
          </div>
          {category && (
            <p className="ed-related-more">
              <TrackedLink href={category.next.href} event="blog_related_click" props={{ slug: post.slug, to: category.next.href }} className="st-textlink">
                {category.next.label} →
              </TrackedLink>
            </p>
          )}
        </section>
      )}
    </article>
  );
}
