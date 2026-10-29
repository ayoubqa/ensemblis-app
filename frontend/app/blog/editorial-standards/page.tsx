import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/blog/Parts";
import { CONTACT_EMAIL, mailto } from "@/lib/contact";
import { BLOG } from "@/lib/blog/seo";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Editorial standards · Blog",
  description: "How the Ensemblis Blog sources, checks, labels and corrects its articles — including how AI assistance is used and reviewed.",
  path: BLOG.standardsPath,
});

export default function EditorialStandards() {
  const report = mailto("Correction: Ensemblis Blog", "Article URL:\n\nWhat is wrong, and the source that shows it:\n");
  return (
    <div className="ed">
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Blog", path: BLOG.path }, { name: "Editorial standards", path: BLOG.standardsPath }])} />
      <header className="ed-hub-head bl-head">
        <div className="wrap">
          <Breadcrumbs items={[{ name: "Blog", href: BLOG.path }, { name: "Editorial standards" }]} />
          <h1 className="ed-hub-title">Editorial standards</h1>
          <p className="ed-hub-lead">
            The blog exists to be useful and correct. These are the rules every article follows — several of them are enforced by the publishing
            system itself, which refuses to publish an article that breaks them.
          </p>
        </div>
      </header>
      <div className="wrap">
        <div className="ed-prose ed-standards-body">
          <h2 id="sources">Sources</h2>
          <p>
            A factual claim that is not common knowledge links to its source. We prefer primary sources: official documentation, the original paper,
            the original dataset. Every article lists the sources it relies on with the date someone last opened and checked each one. For fast-moving
            topics — AI search products change monthly — that date matters, and we say so in the text.
          </p>
          <h2 id="labels">Facts, estimates and opinions</h2>
          <p>
            We keep them apart and say which is which. Hypothetical numbers in examples are labelled as hypothetical. When we cite a study, we say who
            ran it, how, and what its limits are — including when the authors sell a product related to the result.
          </p>
          <h2 id="ai">AI assistance and human approval</h2>
          <p>
            Drafts may be prepared with AI assistance, including our own product. That changes nothing about the standard: before an article is
            published, a person reviews it, opens and checks its sources, and approves it. Each article shows who approved it and when its facts were
            last checked. An article without that approval cannot be published.
          </p>
          <h2 id="frameworks">Our own frameworks</h2>
          <p>
            When we propose a way of measuring or thinking about something — such as the AI Performance Funnel — we say that it is a proposal, define
            every term, state its assumptions and limits, and do not present it as an industry standard or as independently validated.
          </p>
          <h2 id="no-promises">What we will not do</h2>
          <ul>
            <li>Invent statistics, quotes, case studies, testimonials or credentials.</li>
            <li>Promise rankings, traffic, or inclusion in AI-generated answers. Nobody outside the search and AI companies can.</li>
            <li>Publish sponsored articles or paid placements.</li>
            <li>Describe a feature of Ensemblis that does not exist. When we mention our product, it is because it does the thing described.</li>
          </ul>
          <h2 id="updates">Updates and corrections</h2>
          <p>
            An article shows an <em>Updated</em> date only for a meaningful change to its substance, not for typo fixes. When we correct an error of
            fact, the article says what changed.{" "}
            {report && CONTACT_EMAIL ? (
              <>
                Found an error? <a href={report}>Write to {CONTACT_EMAIL}</a> with the article and the source that shows it.
              </>
            ) : (
              <>Found an error? Tell us through the contact address in our <Link href="/privacy">privacy policy</Link>.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
