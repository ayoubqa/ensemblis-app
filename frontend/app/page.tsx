import { JsonLd } from "@/components/JsonLd";
import { FAQ } from "./_home/content";
import { Home } from "./_home/Home";
import { visiblePosts } from "@/lib/blog/posts";
import { SITE, faqJsonLd, organizationJsonLd, pageMetadata, softwareApplicationJsonLd, webPageJsonLd, websiteJsonLd } from "@/lib/site";

const TITLE = `${SITE.name} — Business research and analysis you can verify`;
const DESCRIPTION =
  "Describe the outcome. We do the work. Ensemblis plans business research and analysis, shows the cost before anything runs, and checks every claim against cited evidence and your success criteria.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/", absoluteTitle: true });

// Re-checked hourly: the "From the Journal" row appears once an article is published.
export const revalidate = 3600;

export default function HomePage() {
  const latest = visiblePosts(undefined, "public").slice(0, 3);
  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd(),
          websiteJsonLd(),
          softwareApplicationJsonLd(),
          webPageJsonLd({ path: "/", name: TITLE, description: DESCRIPTION }),
          faqJsonLd(FAQ),
        ]}
      />
      <Home latest={latest} />
    </>
  );
}
