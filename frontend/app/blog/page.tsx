import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, PostItem, StateBadge, accentOf } from "@/components/blog/Parts";
import { Icon } from "@/components/Icon";
import { CATEGORIES } from "@/lib/blog/taxonomy";
import { blogMode, postsInCategory, visiblePosts } from "@/lib/blog/posts";
import { BLOG, blogJsonLd, categoryPath } from "@/lib/blog/seo";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/site";

// Re-checked hourly so a scheduled article appears without a deploy.
export const revalidate = 3600;

export function generateMetadata(): Metadata {
  const live = visiblePosts().length > 0;
  return {
    ...pageMetadata({ title: BLOG.title, description: BLOG.description, path: BLOG.path, absoluteTitle: true }),
    alternates: { canonical: BLOG.path, types: { "application/rss+xml": BLOG.feedPath } },
    // An empty hub is a thin page: it stays out of search until the first article is published.
    ...(live && blogMode() === "public" ? {} : { robots: { index: false, follow: true } }),
  };
}

export default function BlogHome() {
  const mode = blogMode();
  const posts = visiblePosts();
  const lead = posts.find((p) => p.featured) ?? posts[0];
  const rest = posts.filter((p) => p !== lead);
  const topics = CATEGORIES.map((c) => ({ c, posts: postsInCategory(c.key, posts) }));

  return (
    <div className="ed">
      <JsonLd data={[blogJsonLd(posts), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: BLOG.name, path: BLOG.path }])]} />
      <header className="ed-hub-head dk">
        <div className="wrap">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Journal" }]} />
          <p className="st-kicker">
            <span className="st-node" aria-hidden="true" />
            Ensemblis Journal
          </p>
          <h1 className="ed-hub-title">How businesses get found — and how to know what&apos;s true.</h1>
          <p className="ed-hub-lead">
            Sourced, practical writing on search and AI answers: generative engine optimization without the myths, how to measure visibility
            honestly, and how to use AI for research you can verify.
          </p>
          <ul className="ed-topics" aria-label="Topics">
            {topics.map(({ c, posts: inTopic }) => (
              <li key={c.key} style={{ "--cat": accentOf(c.key) } as React.CSSProperties}>
                {inTopic.length ? <Link href={categoryPath(c.key)}>{c.name}</Link> : <span>{c.name}</span>}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="wrap ed-hub">
        {mode === "preview" && (
          <p className="ed-preview-note" role="note">
            <Icon name="info" size={14} /> Preview: drafts, reviews and scheduled articles are shown here and are never indexed. The public Journal shows
            only published articles.
          </p>
        )}

        {lead ? (
          <>
            <section aria-labelledby="ed-latest">
              <h2 id="ed-latest" className="ed-sec-h">
                {lead.featured ? "Featured" : "Latest"}
              </h2>
              <PostItem post={lead} size="lead" preview={mode === "preview"} />
            </section>
            {rest.length > 0 && (
              <section aria-labelledby="ed-more">
                <h2 id="ed-more" className="ed-sec-h">
                  More from the Journal
                </h2>
                <div className="ed-list">
                  {rest.map((p) => (
                    <PostItem key={p.slug} post={p} preview={mode === "preview"} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="ed-empty" aria-labelledby="ed-empty-h">
            <h2 id="ed-empty-h">The first articles are in editorial review.</h2>
            <p>
              Every article is checked against its sources and approved by a person before it is published. Follow the{" "}
              <a href={BLOG.feedPath}>RSS feed</a> to get them as they go live, or read{" "}
              <Link href={BLOG.standardsPath}>how we write and check them</Link>.
            </p>
          </section>
        )}

        <section aria-labelledby="ed-topics-h" className="ed-topic-grid">
          <h2 id="ed-topics-h" className="ed-sec-h">
            What we write about
          </h2>
          <ul>
            {topics.map(({ c, posts: inTopic }) => (
              <li key={c.key} style={{ "--cat": accentOf(c.key) } as React.CSSProperties}>
                <h3>{inTopic.length ? <Link href={categoryPath(c.key)}>{c.name}</Link> : c.name}</h3>
                <p>{c.description}</p>
                <p className="ed-topic-count">
                  {inTopic.length ? `${inTopic.length} article${inTopic.length === 1 ? "" : "s"}` : "First articles coming"}
                  {mode === "preview" && inTopic.some((p) => p.status !== "published") && (
                    <>
                      {" · "}
                      {inTopic.filter((p) => p.status !== "published").map((p) => (
                        <StateBadge key={p.slug} post={p} />
                      ))}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <aside className="ed-standards" aria-labelledby="ed-std-h">
          <h2 id="ed-std-h">How we write</h2>
          <p>
            Claims link to their sources. Each article lists what it relies on and when it was checked, says what is fact, estimate or opinion,
            and is approved by a person before publication. Drafts may be prepared with AI assistance — that is never a reason to skip the checks.
          </p>
          <p className="ed-std-links">
            <Link href={BLOG.standardsPath}>Editorial standards</Link>
            <a href={BLOG.feedPath}>
              <Icon name="rss" size={14} /> RSS feed
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
