import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, PostItem, StateBadge } from "@/components/blog/Parts";
import { Icon } from "@/components/Icon";
import { CATEGORIES } from "@/lib/blog/taxonomy";
import { blogMode, postsInCategory, visiblePosts } from "@/lib/blog/posts";
import { BLOG, blogJsonLd, categoryPath } from "@/lib/blog/seo";
import { ROUTES } from "@/lib/routes";
import { SITE, breadcrumbJsonLd, pageMetadata } from "@/lib/site";

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
    <div className="ed bl">
      <JsonLd data={[blogJsonLd(posts), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Blog", path: BLOG.path }])]} />
      <header className="bl-head">
        <div className="wrap">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Blog" }]} />
          <h1 className="bl-title">Practical, sourced writing for people who run businesses</h1>
          <p className="bl-lead">
            Putting AI to work, strategy and company building, marketing and growth, search and AI discovery, sales and operations. Every
            important claim links to where it comes from.
          </p>
        </div>
      </header>

      <div className="wrap ed-hub bl-body">
        {mode === "preview" && (
          <p className="ed-preview-note" role="note">
            <Icon name="info" size={14} /> Preview: drafts, reviews and scheduled articles are shown here and are never indexed. The public blog shows
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
                  More articles
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
          <section className="bl-empty" aria-labelledby="ed-empty-h">
            <h2 id="ed-empty-h">The first articles are in editorial review</h2>
            <p>
              Each one is checked against its sources and approved by a person before it is published, so nothing appears here before it is ready.
              Subscribe to the <a href={BLOG.feedPath}>RSS feed</a> to get them as they go live, or read{" "}
              <Link href={BLOG.standardsPath}>how we write and check them</Link>.
            </p>
          </section>
        )}

        <section aria-labelledby="ed-topics-h" className="bl-topics">
          <h2 id="ed-topics-h" className="ed-sec-h">
            What we write about
          </h2>
          <ul>
            {topics.map(({ c, posts: inTopic }) => (
              <li key={c.key}>
                <h3>{inTopic.length ? <Link href={categoryPath(c.key)}>{c.name}</Link> : c.name}</h3>
                <p>{c.description}</p>
                <p className="bl-count">
                  {inTopic.length ? `${inTopic.length} article${inTopic.length === 1 ? "" : "s"}` : "No articles yet"}
                  {mode === "preview" && inTopic.some((p) => p.status !== "published") && (
                    <>
                      {" "}
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

        <div className="bl-foot">
          <aside className="bl-note" aria-labelledby="ed-std-h">
            <h2 id="ed-std-h">How we write</h2>
            <p>
              Claims link to their sources. Each article lists what it relies on and when it was checked, says what is fact, estimate or opinion,
              and is approved by a person before publication. Drafts may be prepared with AI assistance; that is never a reason to skip the checks.
              Articles labelled <b>In practice, with Ensemblis</b> show our own product at work.
            </p>
            <p className="bl-links">
              <Link href={BLOG.standardsPath}>Editorial standards</Link>
              <a href={BLOG.feedPath}>
                <Icon name="rss" size={14} /> RSS feed
              </a>
            </p>
          </aside>
          <aside className="bl-note" aria-labelledby="bl-about-h">
            <h2 id="bl-about-h">About Ensemblis</h2>
            <p>{SITE.definition}</p>
            <p className="bl-links">
              <Link href={ROUTES.howItWorksPage}>How it works</Link>
              <Link href={ROUTES.useCases}>Use cases</Link>
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
