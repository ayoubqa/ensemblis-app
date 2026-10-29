# Next steps

## Essential before launch (founder — each takes minutes)

1. **Set `NEXT_PUBLIC_CONTACT_EMAIL` in Vercel (Production) and redeploy.** It powers the request-access email,
   the corrections address and the legal pages. Without it, `/access` says requests aren't open online, and the
   Privacy Policy and Terms show a visible placeholder instead of an address. *Could not be checked from here.*
2. **Approve or edit the two drafted articles** (`frontend/content/blog/*.md`, status `review`): open every
   source, confirm the quoted facts, replace the secondary coverage of the SparkToro study with the original,
   then set `approvedBy`, `factCheckedAt`, `publishedAt` and `status: published`. Until one is published, the
   Journal stays out of the menu and out of search — by design.
3. **Verify the domain in Google Search Console and Bing Webmaster Tools** and submit the sitemap
   (`04-measurement.md` §1).
4. **Check the canonical host on a deployed preview:** `curl -s https://<preview>/pricing | grep canonical` should
   show `https://www.getensemblis.com/pricing`. If you ever move the site, set `NEXT_PUBLIC_SITE_URL`.
5. **Review four wording decisions that are yours:** the homepage title ("Business research and analysis you can
   verify" instead of "The AI operating layer for business" — the vision line is kept in the definition), the
   "Not yet a fit" list, the editorial standards (`/blog/editorial-standards`, including "no sponsored articles"),
   and the ™ on the AI Performance Funnel.

## Important for early growth (weeks 1–6)

- **Run two real executions for the product-led articles (#8, #16)** with the production model and real web search,
  and publish them as genuine examples — the single biggest credibility upgrade available. Until then every
  product visual is labelled as an illustration.
- **Decide on analytics** (`04-measurement.md` §2): enabling Vercel Web Analytics needs one env var plus a
  Privacy Policy update you write or approve.
- **Redirect `ensemblis-app.vercel.app` to `www.getensemblis.com`** in Vercel's domain settings (keep
  `CORS_ORIGIN` listing both while sessions migrate). Canonical tags already point search engines to the
  custom domain; the redirect also moves people.
- **Founder byline.** Add yourself to `frontend/lib/blog/authors.ts` (real name, an approved bio, LinkedIn) and
  sign the pillar articles; named, accountable authors are worth more to readers than a team label.
- **An About page** with who runs Ensemblis, where, and how to reach you — the privacy policy already states the
  operator is an individual in Spain. Needs your words, not ours.
- **Paid plans:** when you decide prices, `/pricing` already renders credit packs from the server config
  (`paymentsEnabled` + `creditPacks`) — no page redesign needed.
- **Merge the product-funnel instrumentation in PR #6** when its stack is ready, or keep using `funnel.sql`.

## Later improvements

- First-touch attribution on accounts (landing page and referrer saved with the signup) — needs a small
  schema change and a Privacy Policy update; worth it once there is steady traffic.
- A stored request-access form with an owner-dashboard list, instead of email — when email volume makes
  the inbox a bottleneck.
- Per-use-case landing pages (e.g. `/use-cases/competitor-analysis`) once Search Console shows which
  intents bring visitors who activate.
- Automate research and drafting steps 1–5 of the publishing pipeline (`03-publishing.md`) after a few weeks of
  the manual workflow show where the time goes. Approval stays human.
- Light theme review of the new public pages (they follow the theme tokens; the default dark theme was the
  focus of this pass).

## Not yet — and why

- **A CMS or a database for articles.** Markdown in pull requests already gives drafts, review on previews,
  history and rollback for free. Revisit only if non-technical writers join.
- **Tag pages and author archives.** With a handful of articles they are thin pages that compete with the
  articles themselves.
- **A newsletter signup.** There is no collection or sending mechanism yet; the RSS feed covers early readers.
  Add one only with a real provider and a privacy update.
- **`llms.txt` and other unproven "GEO" files.** Not a standard; no evidence they affect inclusion. Our
  editorial standards say we don't sell what isn't shown to work — that applies to our own site too.
- **An "AI visibility tracker" feature.** Tempting given the Journal's topics, but it is a different product.
  Validate demand through the Journal first (articles #2, #6, #7 measure interest) before building anything.
