import { visiblePosts } from "@/lib/blog/posts";
import { rssFeed } from "@/lib/blog/seo";

// Public articles only (never drafts or scheduled ones), refreshed hourly with the rest of the blog.
export const revalidate = 3600;

export function GET() {
  return new Response(rssFeed(visiblePosts(undefined, "public")), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
