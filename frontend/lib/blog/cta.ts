// The one call to action at the end of an article, chosen per article by the reader's likely next step
// (frontmatter `cta`), or by category when unset. Every promise here must be true of the product today:
// Ensemblis researches and analyses with cited evidence and a verification gate. It does NOT measure
// visibility in AI answer engines — no CTA may suggest it does.

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

export const DEFAULT_CTA_BY_CATEGORY: Record<string, string> = {
  "ai-search": "use-cases",
  measurement: "how-it-works",
  "seo-strategy": "use-cases",
  "ai-for-business": "research-brief",
};

export function ctaFor(post: { cta?: string; category: string }): Cta {
  return CTAS[post.cta ?? ""] ?? CTAS[DEFAULT_CTA_BY_CATEGORY[post.category] ?? "how-it-works"] ?? CTAS["how-it-works"];
}
