# Website audit — October 2026

Scope: the public website on `main` (`f7c92f7`): `/`, `/how-it-works`, `/signup`, `/login`, `/privacy`, `/terms`,
navigation, metadata, sitemap/robots, structured data. **Method:** code review plus a local production
build rendered in Chromium at 1440 px and 390 px, against the local API configured invite-only like
production. **Not verified:** the live site — this environment's network policy blocks
`www.getensemblis.com`, `ensemblis-app.vercel.app` and `ensemblis-api.onrender.com`, so live
environment values (e.g. whether `NEXT_PUBLIC_CONTACT_EMAIL` is set) are unknown.

## What is already good (keep)

- **Honest copy.** Every product claim is checked against the backend; no fake metrics,
  customers, logos or testimonials; illustrations are labelled as examples.
- **Solid SEO base.** Unique titles/descriptions, canonical URLs, a sitemap and robots file driven by
  one indexing list, `noindex` headers on every signed-in and token page, truthful JSON-LD
  (Organization, WebSite, SoftwareApplication, FAQPage).
- **Accessible foundations.** Skip link, semantic landmarks, AA-checked palette, visible focus,
  reduced-motion handling, a design-token system with light and dark themes.
- **A real product with real trust mechanics:** cost shown before work runs, approval gate,
  read-only tools, a verification gate, cited evidence, automatic refunds for work that never ran.

## Findings, by business impact

| # | Finding | Impact | Effort | Risk |
|---|---|---|---|---|
| B1 | **Dead end for every new visitor.** Production requires an invite code (`SIGNUP_INVITE_CODE`), which also switches the no-account trial off. Every "Define an outcome / Get started" button leads to a form that says "Access is invite-only for now. Your code came with your invitation" — and there is no way to ask for one. | Critical | S | Low |
| B2 | **No pricing anywhere.** `/pricing` redirects to the homepage (a leftover from an earlier product). Credits, the free beta balance, per-step costs, refunds and payment status are explained only inside the app. A buyer's first question goes unanswered. | High | M | Low |
| B3 | **The homepage explains the architecture, not the value.** 11 sections (11,351 px desktop / 17,953 px mobile) about the "operating layer", "Chief of Staff", "AI Team" org chart and "the shift". What you actually get (a cited, verified decision document), for which jobs, at what cost, appears late or not at all. | High | M | Low |
| B4 | **No audience or limits stated up front.** "Businesses that want AI to execute work" is everyone. The honest boundaries (read-only, research and analysis, not live system actions) are buried in an FAQ. | Medium | S | Low |
| B5 | **No proof of output.** The only product visuals are diagrams. A visitor never sees what a finished result looks like. | High | M | Low — must stay labelled as an example until a real execution can be shown |
| B6 | **Thin navigation.** Signed-out header: one link ("How it works"). No use cases, pricing or blog; the footer repeats it. | Medium | S | Low |
| B7 | **Unknown company identity.** The privacy policy says the operator is an individual in Spain, and the contact address comes from `NEXT_PUBLIC_CONTACT_EMAIL`. If that variable is unset, the public legal pages show a "set NEXT_PUBLIC_CONTACT_EMAIL" placeholder. | Medium | S (founder) | Low |

### UX and design

| # | Finding | Impact | Effort |
|---|---|---|---|
| D1 | The visual language is a competent but familiar "dark navy SaaS" template: blue gradient headline, rounded cards on alternating dark/light bands, card diagrams on every section. Nothing is ownable. | Medium | M |
| D2 | Length and repetition: the lifecycle is explained four times (hero diagram, "How it works", "Execution", FAQ flow). | Medium | S |
| D3 | Mobile: the hero illustration is taller than a phone screen; the app-style bottom bar covers content on marketing pages. | Low | S |
| D4 | No editorial design system (long-form typography, tables, citations) for publishing. | High for the blog | M |

### SEO, GEO and content

| # | Finding | Impact | Effort |
|---|---|---|---|
| S1 | **Canonical host risk.** `SITE.url` falls back to Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel documents as the *shortest* production domain — likely `getensemblis.com`, not the primary `www.getensemblis.com`. If so, every canonical, sitemap entry and Open Graph URL points at a redirecting host. | High | S |
| S2 | **No content to rank.** Four indexable pages; no blog, no use-case pages, no topical cluster. | High | L |
| S3 | No per-page Open Graph images; one generic image for every URL. | Low | S |
| S4 | No Search Console / Bing Webmaster verification hook; no way to see queries and impressions. | Medium | S (founder) |
| S5 | No measurement: no web analytics, no landing-page attribution, no event tracking. The product funnel (signup → first objective → completion) exists only in an unmerged branch (PR #6). | High | M |
| S6 | Content–product fit: SEO/GEO topics attract marketers, but the product does research and analysis — it does not measure AI-search visibility. Content must link to what the product really does (research with cited evidence) and never imply a GEO-tracking feature. | Strategic | — |

## Decisions taken from this audit

1. Replace the dead end with an **access path**: invite holders sign up; everyone else can request
   access (by email to the operator's address) and sees exactly what the beta includes.
2. Add a **pricing page** generated from the real configuration and the real cost table (test-enforced
   to match the backend).
3. **Rebuild the homepage around the buyer's five questions** — what it is, who it is for, what you
   get, why trust it, what to do next — and move the architecture walkthrough to `/how-it-works`.
4. Add **use-case pages** that the blog can link to honestly.
5. Build the **blog hub** with a file-based publishing system (draft → review → published, scheduled
   dates, validation in CI) and editorial typography.
6. Fix the **canonical host**, add per-article Open Graph images, BlogPosting/Breadcrumb JSON-LD, RSS,
   and search-console verification hooks.
7. Add an **analytics adapter that does nothing until the founder enables a provider**, plus the
   read-only SQL that measures the product funnel today.
