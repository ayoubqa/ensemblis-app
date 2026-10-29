# Measurement — from organic visit to repeat use

Traffic is not the goal; customers are. This is the smallest setup that answers the questions that matter,
in the order they matter, without adding trackers or collecting personal data.

| Question | Source | Status |
|---|---|---|
| Which searches show our pages, and which get clicks? | Google Search Console, Bing Webmaster Tools | **Needs the founder** — verify the domain (below) |
| Which pages do visitors land on, from where? | Vercel Web Analytics (cookie-less) | **Ready, off** — enable in Vercel + one env var |
| Do Journal readers read to the end? | `article_read_complete` | **Ready, off** — verified locally (below) |
| Do Journal readers click through to the product? | `blog_cta_click`, `blog_related_click`, and `cta_click` from the header | **Ready, off** — verified locally (below) |
| Do visitors start, request access, sign up? | `cta_click`, `access_request_click`, `signup_completed`, `trial_started` | **Ready, off** |
| Do new users reach a verified result, and come back? | The product database (SQL below) | **Works today**, read-only |

## 1. Search Console and Bing Webmaster Tools (founder, ~10 minutes)

Preferred: verify the **domain property** `getensemblis.com` in Search Console through a DNS TXT record
at your domain registrar (covers `www`, the bare domain and every path). Then submit
`https://www.getensemblis.com/sitemap.xml`. Do the same in Bing Webmaster Tools (it can import from Search Console).

If DNS isn't possible, use the HTML-tag method: put the token in Vercel as
`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (and `NEXT_PUBLIC_BING_SITE_VERIFICATION` for Bing) and redeploy;
the site adds the meta tags (`app/layout.tsx`). These tokens are public by design.

Both tools have begun reporting some activity from AI features; check their current help pages for what is
included. Nothing in our setup depends on it.

## 2. Web analytics — off until you decide (founder)

`lib/analytics.ts` is an adapter that does nothing unless `NEXT_PUBLIC_ANALYTICS=vercel` is set at build time.

To turn it on:

1. Vercel → project → **Analytics** → Enable Web Analytics. **Check your plan:** Vercel's documentation says
   custom events (everything in the table below) are recorded on the Pro and Enterprise plans only, with at
   most 2 properties per event on Pro. On Hobby you get page views and referrers, not these events. Our events
   are capped at 2 properties in code (`MAX_EVENT_PROPS` in `lib/analytics.ts`).
2. Vercel → Settings → Environment Variables: `NEXT_PUBLIC_ANALYTICS` = `vercel` (Production), redeploy.
3. **Update the Privacy Policy** before or with step 2: say that anonymous, cookie-less usage statistics are
   collected through Vercel. That is a legal text — write or approve it yourself.

Events (no personal data — paths and short labels only):

| Event | When | Properties |
|---|---|---|
| `cta_click` | a Get started link is followed — page sections, the header button and the mobile bottom bar | `from` (e.g. `home-hero`, `header`, `bottom-nav`), `to` (`/access`, `/signup`, `/objectives/new`) |
| `access_request_click` | the request-access email is opened | `from` |
| `signup_completed` | an account is created | `invite` (`yes`/`no`), `claim` (trial converted) |
| `trial_started` | a no-account trial begins | — |
| `blog_cta_click` | the call to action under an article | `slug`, `cta` |
| `blog_related_click` | a section's "next step" link under an article | `slug`, `to` |
| `article_read_complete` | the end of an article's text scrolls into view (once per page view) | `slug`, `layer` |

What this gives you: landing pages and referrers (including search and AI assistants that pass a referrer),
and the click-through from the Journal to the product. What it does not: who the visitor is, or a join to
their later account — first-touch attribution on accounts would need a schema change and a privacy-policy
update, and is listed under later improvements.

### Verified locally (29 October 2026) — and what that does not prove

A production build with `NEXT_PUBLIC_ANALYTICS=vercel` was driven by a browser script that records every call
the site makes to Vercel's `va("event", …)` queue. Results:

| Action | Event recorded |
|---|---|
| Request access by email (on /access) | `access_request_click {from: "access-page"}` |
| Scrolled to the end of an article | `article_read_complete {slug, layer: "problem"}` |
| End-of-article call to action | `blog_cta_click {slug, cta: "use-cases"}` |
| Section next step under "Read next" | `blog_related_click {slug, to: "/use-cases#marketing"}` |
| Sign-up with an invite | `signup_completed {invite: "yes", claim: false}` |
| Header "Get started" | **none at first** — fixed: the header and mobile bottom-bar buttons now send `cta_click`; re-checked after the fix: `cta_click {from: "header", to: "/access"}` |

No event contained an email, name, company, password or invite code. The same check is in the repository as an
opt-in end-to-end test (analytics is off in normal builds):
`cd frontend && NEXT_PUBLIC_ANALYTICS=vercel npx playwright test e2e/analytics.spec.ts`.

**Not verified:** that Vercel receives and stores these events. The Vercel script only exists on a Vercel
deployment (locally `/_vercel/insights/script.js` is a 404), and the project's plan is unknown. After enabling:
open the site on the production URL, click "Get started" and an article's call to action, then check Vercel →
Analytics → Events within a few minutes. If nothing appears, check the plan first.

## 3. The product funnel — works today

Run [`funnel.sql`](./funnel.sql) in Neon's SQL editor (read-only). One row per signup week:

`signups → created_objective → started_execution → completed_execution → verified_result → outcome_confirmed → came_back_another_week`

Guests are excluded. "Verified" means the verification gate passed (with or without warnings); "outcome
confirmed" means a person confirmed the measured outcome; "came back" means executions in at least two
different weeks. The query was checked against a seeded test database with a known answer.

Read it like this: the biggest drop between two adjacent columns is the next thing to fix. A good Journal
article that sends readers who never reach `verified_result` is a content–product mismatch, not a win.

## What these numbers cannot tell you

- **Whether a reader became a customer.** Site events and accounts are not joined (by design — no personal
  data in analytics). You can compare volumes week by week, not follow a person.
- **Anything about small numbers.** In the first weeks, a handful of visits per article make rates meaningless;
  read them as counts, and talk to the people behind them.
- **Why.** Events say what happened. Only conversations with users say why — see `06-customer-hypotheses.md`.

## The smallest experiment worth running

For four weeks, end every problem-solving article with the same offer — "send us a real question and we'll run
it with you" (the concierge run in `06-customer-hypotheses.md`) — and count, per article: `article_read_complete`,
`blog_cta_click`, access requests that mention the article, and how many of those reach a verified result in
the funnel SQL. Ten conversations will teach more than the dashboard; the dashboard tells you which articles
earned them.

## 4. What to look at weekly (15 minutes)

1. Search Console: queries and pages with impressions but low CTR (title/description work); new queries (ideas).
2. Analytics: landing pages from organic search; `blog_cta_click` per article.
3. Funnel SQL: the newest cohorts, and the largest drop.
4. Write down one decision. Measurement nobody acts on is overhead.
