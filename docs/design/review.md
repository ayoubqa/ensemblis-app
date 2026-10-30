# Site and product redesign: journeys, discoverability checklist and validation

This document goes with `direction.md`. It records three things:
- the journeys the redesign serves;
- what each public page now carries for search engines and AI answer engines;
- how the work was checked.

Everything below was measured on a local production build (`next build && next start`) against the local mock
stack. None of it was checked on the live site: this branch is not deployed.

## What changed

**Implemented on this branch**

- **Navigation.**
  - Signed-out desktop shows **Product** (`/how-it-works`), **Use cases**, **Pricing** and **Blog**, then Log in and
    Get started.
  - On phones these sit in a Menu sheet in the header, with Home, Get started and Log in.
  - Visitors no longer get the app's bottom tab bar. Signed-in navigation is unchanged.
  - The footer always links Blog and Product.
- **Homepage**, rebuilt as "the working paper":
  - an Ink hero with a labelled example brief that hangs into the page;
  - the six steps from request to result, with the three steps that are yours marked;
  - two real product screenshots, recaptured in the new theme and labelled as test data;
  - what a brief contains;
  - use cases as an editorial list;
  - when to use something else;
  - pricing and beta access, from the live configuration;
  - eleven questions, also emitted as FAQPage JSON-LD;
  - a closing call to action.
  - Down from 9,383 px to 7,412 px on desktop, and from 15,170 px to 10,983 px on a phone.
- **Blog hub.**
  - A real, light reading page with the topics, how articles are written and checked, and links to the product.
  - It stays `noindex` and out of the sitemap until an article is published. No draft titles appear.
  - "Journal" is now "Blog" everywhere a reader sees it.
- **Design system.**
  - Light is the default theme; dark stays available in the product.
  - Schibsted Grotesk for interface and headlines; Newsreader for the document voice; Inter only for the wordmark.
  - Sentence-case labels everywhere: no tracked capitals, no monospace labels, no arrows in buttons, no glows or dot
    grids.
  - Redundant eyebrows were removed from page heads.
- **Product screens.**
  - Aligned through the tokens: define, approval, console, verification, usage, in light and dark.
  - Amounts and times render with the face's default figures, because its tabular figures widened the comma.
  - No business logic, API contract, permission or credit rule changed.
- **SEO and GEO.**
  - Titles and descriptions now fit result snippets.
  - WebPage JSON-LD was added to Use cases and Pricing.
  - The homepage FAQ no longer names a third-party product.
  - A new FAQ answer says what happens when research can't find enough. It matches what the product does: the step is
    marked, the issue is listed, and the synthesis must name it under its limitations.
- **Accessibility.**
  - The loading placeholder and two labelled groups gained valid roles.
  - Blog-note links now pass contrast.
- **Performance.** Newsreader is no longer preloaded, and dead rules were removed:
  - `site.css`: 2,797 to 1,895 lines.
  - `marketing.css`: 1,837 to 1,395 lines.
  - Two unused components were deleted.

**Recommended, not implemented**

- Publish the first reviewed article. It turns the blog hub indexable and adds BlogPosting data automatically.
- Turn on live web search in production before showing research screenshots that mention web sources. Today's
  screenshots show the approval card and the verification gate only.
- Lengthen the Terms description (51 characters). It was left alone because the legal wording is not part of this
  redesign.

**Future concepts** (need backend work; not built and not shown as built)

- A no-account demo for visitors: the guest trial exists in code, and is off while access is invite-only.
- Objective templates beyond today's example chips.
- Subscription plans: credits are the only pricing that exists.
- Email notifications when a result is ready: email is off in production.
- CRM or analytics connectors: Ensemblis is read-only and has none.

## Journeys

### A visitor

| Step | Where | What answers it |
|---|---|---|
| Discover | Search, a shared link, the blog | Unique titles and descriptions; Blog in the navigation; the hub links to the product |
| Understand | Homepage hero | One sentence of definition next to an example brief: objective, criteria measured, cited findings, a stated limitation, the cost approved first |
| See it work | `#how`, Product page | Six steps with the three that are yours marked; two real screenshots, labelled as test data |
| Find their use case | `#use-cases`, Use cases page | Four teams, each with an example objective and its success criteria |
| Check availability and cost | Hero note, `#pricing`, Pricing page | "Private beta: request access, or use your invite code"; credits per objective; beta facts read from the live configuration |
| Decide it fits | `#fit`, Questions | When to use Ensemblis, and when to use something else |
| Next step | Get started, everywhere | Goes to `/access` while sign-up needs an invite, to `/signup` when it doesn't; never a dead end |

### A first-time user (the journey the product supports today)

1. **Access:** `/access`, then `/signup` with an invite code.
2. **Context:** Company Context. It can be skipped; without it, the Chief of Staff asks for missing information as an
   exception.
3. **Describe the objective:** `/objectives/new`, with the outcome, deliverable, constraints, success criteria (with
   suggestions), deadline, budget and autonomy.
4. **Plan and cost:** the approval card shows the steps, the cost and a recommendation.
5. **Approve.**
6. **Progress:** the console's lifecycle bar, the live steps and the Now panel.
7. **Findings, evidence, limitations:** the report, numbered evidence, the verification gate, open issues and
   limitations.
8. **Feedback or repeat:** "Your judgment" on the outcome, a new attempt, sharing and export, and recurring objectives.

### A returning user

- Log in to Home, the Chief of Staff's briefing: what needs you, what's running and recent outcomes.
- The Approvals and Exceptions counts stay visible in the header on desktop. On phones they sit under Attention in the
  bottom bar.

## Discoverability, page by page

✓ checked on the local build · ✗ failed · — not applicable · ? not verifiable locally

| Page | Title / description fit | Canonical | Open Graph | One H1 | JSON-LD | In sitemap | Indexable |
|---|---|---|---|---|---|---|---|
| `/` | ✓ / ✓ (151) | ✓ | ✓ | ✓ | Organization, WebSite, SoftwareApplication, WebPage, FAQPage | ✓ | ✓ |
| `/how-it-works` | ✓ / ✓ (157) | ✓ | ✓ | ✓ | WebPage, BreadcrumbList | ✓ | ✓ |
| `/use-cases` | ✓ / ✓ (153) | ✓ | ✓ | ✓ | WebPage, BreadcrumbList | ✓ | ✓ |
| `/pricing` | ✓ / ✓ (148) | ✓ | ✓ | ✓ | WebPage, BreadcrumbList, FAQPage | ✓ | ✓ |
| `/access` | ✓ / ✓ | ✓ | ✓ | ✓ | BreadcrumbList | ✓ | ✓ |
| `/blog` | ✓ / ✓ | ✓ | ✓ | ✓ | Blog, BreadcrumbList | — while empty | `noindex, follow` while empty, by design |
| `/blog/editorial-standards` | ✓ / ✓ | ✓ | ✓ | ✓ | BreadcrumbList | ✓ | ✓ |
| `/blog/<article>` | ? | ? | ? | ? | BlogPosting (unit-tested) | ? | No article is published, so none is public |
| `/blog/category/<topic>` | — | — | — | — | — | Not until 3 articles | Not public yet |
| `/privacy` | ✓ / ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| `/terms` | ✓ / ✗ short (51) | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Sign-in, sign-up, app | — | — | — | — | — | Never | `noindex`; app paths also disallowed in robots.txt |

**Also checked:**
- Every internal link from the public pages resolves (12 of 12).
- No duplicate titles or descriptions.
- Every image has alt text.
- `lang="en"` is set.
- Every sitemap URL returns 200 and is indexable.
- Thirteen private routes and three auth routes are all `noindex`.

**Structured data:**
- Every JSON-LD block on the public pages parses.
- Each block carries the fields its type needs. Breadcrumb positions and absolute URLs are correct, and every FAQ entry
  has a question and an answer.
- No block contains ratings, reviews, offers or prices, because none exist.
- An end-to-end test checks that the homepage's FAQPage matches the visible questions exactly.

**Not verified:**
- Google's Rich Results Test and Schema.org's validator are external tools and were not run.
- SoftwareApplication without `offers` or `aggregateRating` is valid schema.org, but is not eligible for Google's
  software rich result. That is the honest state.

**GEO and AIO:**
- The entity definition appears verbatim in the hero, the FAQ and the JSON-LD.
- Terms are consistent: objective, plan, credits, verification, brief.
- Claims are checkable against the product.
- There is no keyword stuffing and no empty FAQ.
- Nothing here guarantees that an AI system will cite the site.

## Validation

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit tests (vitest) | 146 of 146 |
| End-to-end (Playwright, mock stack) | 22 passed, 4 opt-in skipped (analytics needs an analytics build; the visual tour needs `E2E_TOUR=1`) |
| End-to-end, prod-like provider | 22 passed, 4 skipped |
| New tests | Desktop navigation (Product, Use cases, Pricing and Blog lead to real pages; Blog marked current; footer link); phone menu (every destination, no tab bar for visitors) |
| Production smoke script | Updated: checks Blog in the desktop navigation and the phone menu, and the `#fit` section. These checks run once a release is expected (`EXPECT_RELEASE`: a push to `main`, or a manual run given a commit). On a pull request the live site is still the previous release, so they are listed as skipped. Not run against this branch in production: it is not deployed |
| axe-core, WCAG 2.1 A and AA | 0 violations on 34 scans: 10 public pages at 1440 and 390 px, the open phone menu, and 7 product screens in light and dark |
| Keyboard | Menu reachable by Tab, opens on Enter, keeps focus inside, closes on Escape and returns focus; visible focus ring on every header control |
| Reduced motion | The brief's load sequence is off under `prefers-reduced-motion`, and the brief shows complete |

**Lighthouse** (phone, simulated slow 4G, best of two runs, local build):

| Page | Performance (`main` → branch) | LCP | Page weight |
|---|---|---|---|
| `/` | 85 → 85 | 4.3 → 3.9 s | 470 → 429 KiB |
| `/blog` | 87 → 90 | 4.1 → 3.6 s | 472 → 364 KiB |
| `/pricing` | 87 → 90 | 4.1 → 3.5 s | 464 → 382 KiB |
| `/use-cases` | 87 → 87 | 4.1 → 3.8 s | |
| `/how-it-works` | 86 → 89 | 4.2 → 3.6 s | |

- Accessibility and best practices are 100 on every page; best practices was 96 on `main`.
- Cumulative layout shift is 0 (0.001 on `main`).
- The blog's SEO score is 66 only because the empty hub is `noindex` on purpose.
- Desktop performance is 99 on every page.
- These are lab numbers. Field data (Core Web Vitals from real visitors) exists only after deployment.
