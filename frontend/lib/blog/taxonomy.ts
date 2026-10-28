// The editorial taxonomy. Deliberately small: four categories that each map to a question our readers
// actually have and to a part of the product they can try. A category page is only indexable once it holds
// enough published articles to be useful on its own (see INDEXABLE_CATEGORY_MIN in posts.ts).
// Tags exist on articles for related-article matching only; they have no pages (no thin archives).

export interface Category {
  key: string;
  name: string;
  /** One sentence for the category page, its meta description and the hub. */
  description: string;
  /** What a reader of this category can do next in the product (a public page). */
  next: { href: string; label: string };
}

export const CATEGORIES: readonly Category[] = [
  {
    key: "ai-search",
    name: "AI Search & GEO",
    description:
      "How AI answer engines find, select and cite sources — and what that means for how a business publishes. Generative engine optimization without the myths.",
    next: { href: "/use-cases#marketing", label: "Research how your market is described, with cited sources" },
  },
  {
    key: "measurement",
    name: "Measurement",
    description:
      "Measuring visibility in search and AI answers: definitions, sampling, metrics and their limits — so decisions rest on numbers you can defend.",
    next: { href: "/how-it-works#verification", label: "See how Ensemblis checks claims against evidence" },
  },
  {
    key: "seo-strategy",
    name: "SEO & Content Strategy",
    description: "Search strategy for small teams: topical authority, content quality, internal linking and choosing what to publish next.",
    next: { href: "/use-cases#marketing", label: "Delegate competitor and positioning research" },
  },
  {
    key: "ai-for-business",
    name: "AI for Business Work",
    description:
      "Using AI for real business research and analysis — responsibly: evidence, verification, cost control and knowing when not to trust the output.",
    next: { href: "/how-it-works", label: "How Ensemblis plans, runs and verifies business work" },
  },
];

export const categoryByKey = (key: string): Category | undefined => CATEGORIES.find((c) => c.key === key);
