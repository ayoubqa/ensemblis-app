// The one call to action at the end of an article, chosen per article by the reader's likely next step
// (frontmatter `cta`), or by editorial layer and section when unset — and sometimes none at all. Every
// promise here must be true of the product today: Ensemblis researches and analyses with cited evidence and
// a verification gate. It does NOT measure visibility in AI answer engines — no CTA may suggest it does.

export interface Cta {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  label: string;
  /** "start" links go to the access/sign-up path chosen at runtime (StartLink). */
  kind: "page" | "start";
}

export const CTAS: Record<string, Cta> = {
  "research-brief": {
    key: "research-brief",
    eyebrow: "Try it on your own question",
    title: "Get a research brief with numbered, cited sources",
    body: "Describe the question and how you'll judge the answer. Ensemblis plans the research, shows the cost before anything runs, and checks every claim against its evidence before calling it done.",
    href: "/signup",
    label: "Get started",
    kind: "start",
  },
  "use-cases": {
    key: "use-cases",
    eyebrow: "What you can delegate",
    title: "Market, competitor and customer research — verified",
    body: "See the research and analysis jobs Ensemblis takes on today, what each delivers, and what it costs in credits.",
    href: "/use-cases",
    label: "Explore use cases",
    kind: "page",
  },
  "how-it-works": {
    key: "how-it-works",
    eyebrow: "Behind the result",
    title: "How Ensemblis plans, runs and verifies the work",
    body: "Approval before anything is spent, read-only tools, numbered evidence and a verification gate — the full walkthrough.",
    href: "/how-it-works",
    label: "Read the walkthrough",
    kind: "page",
  },
  pricing: {
    key: "pricing",
    eyebrow: "Cost, up front",
    title: "Know what a piece of work costs before it runs",
    body: "Every plan shows its cost in credits before you approve it; work that fails or never starts is refunded automatically.",
    href: "/pricing",
    label: "See pricing",
    kind: "page",
  },
};

/** The soft next step for a problem-solving article, by section. */
export const DEFAULT_CTA_BY_CATEGORY: Record<string, string> = {
  "ai-at-work": "how-it-works",
  strategy: "use-cases",
  "marketing-growth": "use-cases",
  "ai-search": "use-cases",
  "sales-customers": "use-cases",
  operations: "pricing",
};

/** Frontmatter value that removes the call to action from an article. */
export const NO_CTA = "none";

/**
 * The article's call to action, or null for none. An explicit `cta` always wins (`none` removes it);
 * otherwise the editorial layer decides: discovery articles carry no product CTA, product articles invite
 * the reader to try it, and problem-solving articles get their section's soft next step.
 */
export function ctaFor(post: { cta?: string | null; category: string; layer?: string | null }): Cta | null {
  if (post.cta === NO_CTA) return null;
  if (post.cta && CTAS[post.cta]) return CTAS[post.cta];
  if (post.layer === "discovery") return null;
  if (post.layer === "product") return CTAS["research-brief"];
  return CTAS[DEFAULT_CTA_BY_CATEGORY[post.category] ?? "how-it-works"] ?? CTAS["how-it-works"];
}
