// Article authors. Only real identities belong here. A person's entry needs their real name and a bio they
// approved; it is then published as schema.org Person. Until a person signs an article, articles are
// attributed to the editorial team (an Organization in structured data) — never to an invented persona.

export interface Author {
  key: string;
  name: string;
  kind: "person" | "organization";
  /** Shown under the article and on the hub. Must be true; no inflated credentials. */
  bio: string;
  /** Optional profile links (LinkedIn, personal site) — person authors only, published as sameAs. */
  sameAs?: string[];
  /** Optional role/title, person authors only. */
  role?: string;
}

export const AUTHORS: Record<string, Author> = {
  "ensemblis-editorial": {
    key: "ensemblis-editorial",
    name: "Ensemblis Editorial",
    kind: "organization",
    bio: "Articles are prepared by the team that builds Ensemblis. Drafts may be produced with AI assistance; every published article is checked against the sources it lists and approved by a person before it goes live.",
  },
};

export const authorByKey = (key: string): Author | undefined => AUTHORS[key];
