// The editorial taxonomy: six sections of a business publication, not a keyword list. Each one maps to a
// question our readers have in their work — and, where it is honest to say so, to a part of the product
// they can try. A category page is only indexable once it holds enough published articles to be useful on
// its own (see INDEXABLE_CATEGORY_MIN in posts.ts).
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
    key: "ai-at-work",
    name: "AI at Work",
    description:
      "Putting AI and agents to work on real business tasks: what they do well, where they fail, how to check their output and what it really costs.",
    next: { href: "/how-it-works", label: "See how Ensemblis plans, runs and verifies business work" },
  },
  {
    key: "strategy",
    name: "Strategy & Company Building",
    description:
      "Strategy, management and entrepreneurship for small teams: choosing markets, setting objectives and deciding well with incomplete information.",
    next: { href: "/use-cases#marketing", label: "Research a market or competitor before you decide" },
  },
  {
    key: "marketing-growth",
    name: "Marketing & Growth",
    description:
      "Positioning, messaging, content and growth for businesses with small teams — what works, how to tell, and what to stop doing.",
    next: { href: "/use-cases#marketing", label: "Delegate competitor and positioning research" },
  },
  {
    key: "ai-search",
    name: "Search & AI Discovery",
    description:
      "How buyers find businesses through search engines and AI answers: SEO, generative engine optimization and measuring visibility — without the myths.",
    next: { href: "/use-cases#marketing", label: "Research how your market is described, with cited sources" },
  },
  {
    key: "sales-customers",
    name: "Sales & Customers",
    description:
      "Understanding buyers and selling to them: customer research, ideal customer profiles, discovery and the questions prospects actually ask.",
    next: { href: "/use-cases#sales", label: "Research target accounts with a reason for each" },
  },
  {
    key: "operations",
    name: "Operations & Automation",
    description:
      "Running the business: processes, automation, tools and the economics of delegating work — to people or to software.",
    next: { href: "/use-cases#operations", label: "Map a process or compare vendors, with evidence" },
  },
];

export const categoryByKey = (key: string): Category | undefined => CATEGORIES.find((c) => c.key === key);

/**
 * Editorial layers: why an article exists. Most of the blog is written for readers who may never buy
 * anything — that is the point of a publication.
 * - discovery: broad ideas and analysis; no product call to action unless the editor sets one.
 * - problem: practical help with a problem our readers have; a soft, relevant next step.
 * - product: shows how a job is done with Ensemblis; the call to action is to try it.
 */
export type Layer = "discovery" | "problem" | "product";
export const LAYERS: readonly Layer[] = ["discovery", "problem", "product"];
export const DEFAULT_LAYER: Layer = "problem";

/** Shown on every article card and header, so readers always know when an article is about our product. */
export const LAYER_LABEL: Record<Layer, string> = {
  discovery: "Ideas",
  problem: "How-to",
  product: "In practice, with Ensemblis",
};
