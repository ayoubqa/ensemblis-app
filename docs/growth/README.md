# Website & growth

| Document | What it is |
|---|---|
| [01-audit.md](./01-audit.md) | What was wrong with the public site, by business impact, and what we decided |
| [02-editorial-plan.md](./02-editorial-plan.md) | The first 30 days of the Journal: six sections, three editorial layers, 16 articles |
| [03-publishing.md](./03-publishing.md) | How to write, review, schedule and publish an article |
| [04-measurement.md](./04-measurement.md) | Search Console, analytics (off by default), events, the product funnel |
| [funnel.sql](./funnel.sql) | Read-only activation funnel query for Neon |
| [05-next-steps.md](./05-next-steps.md) | What the founder needs to do, what comes next, and what not to build yet |
| [06-customer-hypotheses.md](./06-customer-hypotheses.md) | Two customer segments as hypotheses, one marketing asset, and the fastest way to learn |

Code map: public pages in `frontend/app/{page,use-cases,pricing,access,blog}`, shared facts in
`frontend/lib/offer.ts` (mirrors the backend price list; test-enforced), the Journal engine in
`frontend/lib/blog/`, the visual system in `frontend/app/styles/site.css` and `frontend/lib/trace.ts`.
