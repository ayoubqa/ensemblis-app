# Measurement — from organic visit to repeat use

Traffic is not the goal; customers are. This is the smallest setup that answers the questions that matter,
in the order they matter, without adding trackers or collecting personal data.

| Question | Source | Status |
|---|---|---|
| Which searches show our pages, and which get clicks? | Google Search Console, Bing Webmaster Tools | **Needs the founder** — verify the domain (below) |
| Which pages do visitors land on, from where? | Vercel Web Analytics (cookie-less) | **Ready, off** — enable in Vercel + one env var |
| Do Journal readers click through to the product? | `blog_cta_click`, `blog_related_click` events | **Ready, off** — fires once analytics is enabled |
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

1. Vercel → project → **Analytics** → Enable Web Analytics (check what your plan includes; custom events may
   need a paid plan — page views do not).
2. Vercel → Settings → Environment Variables: `NEXT_PUBLIC_ANALYTICS` = `vercel` (Production), redeploy.
3. **Update the Privacy Policy** before or with step 2: say that anonymous, cookie-less usage statistics are
   collected through Vercel. That is a legal text — write or approve it yourself.

Events (no personal data — paths and short labels only):

| Event | When | Properties |
|---|---|---|
| `cta_click` | a Get started link is followed | `from` (e.g. `home-hero`), `to` (`/access`, `/signup`, `/objectives/new`) |
| `access_request_click` | the request-access email is opened | `from` |
| `signup_completed` | an account is created | `invite` (`yes`/`no`), `claim` (trial converted) |
| `trial_started` | a no-account trial begins | — |
| `blog_cta_click` | the call to action under an article | `slug`, `cta` |
| `blog_related_click` | a topic "next step" link | `slug`, `to` |

What this gives you: landing pages and referrers (including search and AI assistants that pass a referrer),
and the click-through from the Journal to the product. What it does not: who the visitor is, or a join to
their later account — first-touch attribution on accounts would need a schema change and a privacy-policy
update, and is listed under later improvements.

## 3. The product funnel — works today

Run [`funnel.sql`](./funnel.sql) in Neon's SQL editor (read-only). One row per signup week:

`signups → created_objective → started_execution → completed_execution → verified_result → outcome_confirmed → came_back_another_week`

Guests are excluded. "Verified" means the verification gate passed (with or without warnings); "outcome
confirmed" means a person confirmed the measured outcome; "came back" means executions in at least two
different weeks. The query was checked against a seeded test database with a known answer.

Read it like this: the biggest drop between two adjacent columns is the next thing to fix. A good Journal
article that sends readers who never reach `verified_result` is a content–product mismatch, not a win.

## 4. What to look at weekly (15 minutes)

1. Search Console: queries and pages with impressions but low CTR (title/description work); new queries (ideas).
2. Analytics: landing pages from organic search; `blog_cta_click` per article.
3. Funnel SQL: the newest cohorts, and the largest drop.
4. Write down one decision. Measurement nobody acts on is overhead.
