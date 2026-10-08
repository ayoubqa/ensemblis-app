// Site identity, canonical URLs and metadata helpers (server-safe: no "use client").
// Copy here is the single source for positioning, used by metadata, Open Graph,
// JSON-LD and the visible entity definitions — keep them identical (GEO/AIO).
import type { Metadata } from "next";

/** Absolute site origin for canonical URLs, sitemap and Open Graph. */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  // Vercel exposes the production domain at build time (no protocol).
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "Ensemblis",
  url: resolveSiteUrl(),
  positioning: "The AI operating layer for business.",
  promise: "Describe the outcome. We do the work.",
  /** The entity definition. Used verbatim on the page, in metadata and in JSON-LD. */
  definition: "Ensemblis is an AI operating layer for business that turns business objectives into planned, executed and verified work.",
  supporting:
    "Ensemblis turns business objectives into planned, executed and verified work through an AI organization built around your company context.",
  description:
    "Ensemblis is the AI operating layer for business. Describe the outcome: a Chief of Staff plans it, an AI Team executes it, and the result is verified against evidence and your success criteria.",
  locale: "en",
} as const;

export const absoluteUrl = (path = "/") => `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;

/** Metadata for an indexable public page: unique title + description, canonical, Open Graph, X. */
export function pageMetadata({ title, description, path, absoluteTitle = false }: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE.name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { title: fullTitle, description, url: path, siteName: SITE.name, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: fullTitle, description },
  };
}

/** Private / per-user pages: a title, never indexed. */
export function privateMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

// ---------------------------------------------------------------- JSON-LD (truthful only)
// No ratings, reviews, prices, customer counts or awards — none exist.

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE.url}/#organization`,
    name: SITE.name,
    url: SITE.url,
    logo: absoluteUrl("/brand/ensemblis-app-icon-512.png"),
    description: SITE.definition,
    slogan: SITE.promise,
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    inLanguage: "en",
    publisher: { "@id": `${SITE.url}/#organization` },
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE.url}/#software`,
    name: SITE.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE.url,
    description: SITE.definition,
    publisher: { "@id": `${SITE.url}/#organization` },
    featureList: [
      "Plan business objectives with a Chief of Staff",
      "Approve plans and budgets before work runs",
      "Execute with an AI Team of executives and specialist capabilities",
      "Verify results against cited evidence and success criteria",
      "Measure the outcome per success criterion",
      "Company Context and organizational memory",
    ],
  };
}

export function webPageJsonLd({ path, name, description }: { path: string; name: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${absoluteUrl(path)}#webpage`,
    url: absoluteUrl(path),
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": `${SITE.url}/#website` },
    about: { "@id": `${SITE.url}/#software` },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

/** FAQPage — only for questions that are visibly answered on the same page. */
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
