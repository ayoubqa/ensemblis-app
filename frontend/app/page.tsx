import { JsonLd } from "@/components/JsonLd";
import { FAQ } from "./_home/content";
import { Home } from "./_home/Home";
import { SITE, faqJsonLd, organizationJsonLd, pageMetadata, softwareApplicationJsonLd, webPageJsonLd, websiteJsonLd } from "@/lib/site";

const TITLE = `${SITE.name} — The AI operating layer for business`;
const DESCRIPTION =
  "Describe the outcome. We do the work. Ensemblis turns business objectives into planned, executed and verified work: a Chief of Staff plans it, an AI Team executes it, and every result is checked against evidence and your success criteria.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/", absoluteTitle: true });

export default function HomePage() {
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
      <Home />
    </>
  );
}
