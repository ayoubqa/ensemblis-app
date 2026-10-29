# Next steps

## Essential before launch (founder — each takes minutes)

1. **Set `NEXT_PUBLIC_CONTACT_EMAIL` in Vercel (Production) and redeploy.** It powers the request-access email,
   the corrections address and the legal pages; sign-up is invite-only, so without it a visitor without a code
   has no way in. *Could not be checked from here.* How to verify after deploying:
   - open `/access` signed out: it must show **"Request access by email"** and the address with **Copy address**
     — not "Online requests aren't open yet";
   - open `/privacy` and `/terms`: no "(set NEXT_PUBLIC_CONTACT_EMAIL)" placeholder;
   - a production build without it now prints a warning in the Vercel build log ("NEXT_PUBLIC_CONTACT_EMAIL is
     not set for this production build").
2. **Approve or edit the three articles in review** (`frontend/content/blog/*.md`): open every source, confirm
   the facts (each article's `editorNotes` lists what was and wasn't confirmed), then set `approvedBy`,
   `factCheckedAt`, `publishedAt` and `status: published`. Until one is published, the Journal stays out of the
   menu and out of search — by design.
3. **Verify the domain in Google Search Console and Bing Webmaster Tools** and submit the sitemap
   (`04-measurement.md` §1).
4. **Check the canonical host on a deployed preview:** `curl -s https://<preview>/pricing | grep canonical` should
   show `https://www.getensemblis.com/pricing`. If you ever move the site, set `NEXT_PUBLIC_SITE_URL`.
5. **Review the wording decisions that are yours:** the homepage title, the "Not yet a fit" list, the editorial
   standards, the ™ on the AI Performance Funnel, and two new lines — "Invites are sent by email, with a code to
   create your account" on `/access` (no response time is promised; add one only if you will keep it) and the
   captions on the product screenshots (real interface, test data).

## Learn whether people will use and pay (weeks 1–4)

The plan is in [`06-customer-hypotheses.md`](./06-customer-hypotheses.md): 15–20 concierge runs on production
with founders and small agencies, three questions afterwards, and a decision bar set in advance. It is also the
first check of output quality with the real model, and it produces the genuine examples articles #12 and #16 need.

## Important for early growth (weeks 1–6)

- **Run two real executions for the product-led articles (#12, #16)** with the production model and real web search,
  and publish them as genuine examples. The homepage now shows two screenshots of the real interface, captioned
  as test data; replace them with a real run you're happy to show, using the same captions minus "test data".
- **Decide on analytics** (`04-measurement.md` §2): one env var plus a Privacy Policy update you write or approve.
  **Check the Vercel plan first:** custom events (Journal → product clicks, read-to-the-end, sign-ups) are
  recorded on Pro and above only; Hobby records page views.
- **The research-brief template** (`06-customer-hypotheses.md`): one page, free, linked from article #3 once
  it is approved.
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
- **An "AI visibility tracker" feature.** Tempting given the Journal's search topics, but it is a different product.
  Validate demand through the Journal first (articles #2, #7, #10 measure interest) before building anything.
- **Segment landing pages, paid acquisition, or features aimed at the "deep research" objection** — until the
  concierge runs show which segment returns and where the output is actually better or worse.
