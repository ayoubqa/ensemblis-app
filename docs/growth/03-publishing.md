# Publishing on the Ensemblis Journal

The Journal is a folder of Markdown files — `frontend/content/blog/<slug>.md` — rendered by the website. No CMS,
no database, no paid service: an article is a file, a review is a pull request, publishing is a merge.

## The workflow

| State | `status:` | Who sees it | How it gets there |
|---|---|---|---|
| Draft | `draft` | Only previews | Anyone (or a future automated drafter) opens a pull request with the file |
| In review | `review` | Only previews | The author asks for review |
| Scheduled | `published` + future `publishedAt` | Only previews until the date | A person approves with a future date |
| Published | `published` + past `publishedAt` | Everyone | A person approves and merges |

**Previews:** every pull request gets a Vercel preview deployment. There, drafts and reviews render with a
yellow "not public" bar and are never indexable. That preview URL is the review copy. Locally, `npm run dev`
shows them too (`BLOG_PREVIEW=1` forces it in a production build).

**Publishing requires a person.** The site refuses to build a `published` article without `approvedBy`
(who approved it) and `factCheckedAt` (when its facts were last checked), sources (or a stated reason
it has none), alt text on every image, and enough substance to be worth indexing. Generated text is never
published just because it exists.

**Scheduling:** set `status: published` with a future `publishedAt` and merge. The article goes live on the
first hourly revalidation after its date — no deploy needed — and joins the sitemap, the RSS feed and the
hub at the same time. A date without a time means 00:00 UTC; add a time and zone for precision
(`2026-11-04T09:00:00+01:00`). Batch-approving the week's articles on Monday is the intended rhythm.

## Writing an article

Copy `frontend/content/blog/_template.md` (files starting with `_` are ignored) to `<slug>.md`. The file name
is the URL: lower-case words joined by hyphens, short and stable. Fill the frontmatter:

| Field | Required | Notes |
|---|---|---|
| `title` | yes | 10–110 characters. The page's only `h1`. |
| `seoTitle` | if the title is over 70 characters | What search results show. |
| `summary` | yes | 50–320 characters: the dek under the title and the default meta description. |
| `description` | no | Meta description if the summary is too long (50–170). |
| `status` | yes | `draft`, `review` or `published`. |
| `publishedAt` | to publish | `YYYY-MM-DD` or a date-time. |
| `updatedAt` | no | Only for a meaningful change in substance. |
| `author` | yes | A key in `lib/blog/authors.ts`. Add real people there — never invented ones. |
| `category` | yes | `ai-search`, `measurement`, `seo-strategy` or `ai-for-business` (`lib/blog/taxonomy.ts`). |
| `tags` | no | Up to ~8; used only to pick related articles (tags have no pages). |
| `cta` | no | `research-brief`, `use-cases`, `how-it-works` or `pricing` — the reader's next step. Default by category. |
| `related` | no | Slugs to suggest first under "Read next". |
| `sources` | to publish | Each: `title`, `url` (https), `publisher`, `accessed` (the date someone opened it), optional `note`. |
| `noSourcesReason` | instead of sources | E.g. an opinion piece. |
| `approvedBy`, `factCheckedAt` | to publish | Filled by the approving editor. |
| `image` | no | `{ src, alt }`; otherwise a generated trace cover is used. |
| `featured` | no | Leads the hub. |
| `canonical` | rare | Only if the article first appeared elsewhere. |
| `editorNotes` | no | For reviewers; never rendered. |

Body: GitHub-flavoured Markdown. Start sections at `##`. Use footnotes for citations — `text.[^key]` and
`[^key]: Source, [link](https://…)` — they render as `[1]`-style markers like the product's evidence numbers.
Callouts: a blockquote starting with `[!DEFINITION]`, `[!KEY]`, `[!NOTE]`, `[!CAUTION]`, `[!EXAMPLE]` or
`[!METHOD]`. Images go in `frontend/public/blog/<slug>/` and are referenced as `/blog/<slug>/file.svg`
with alt text and an optional caption: `![What it shows](/blog/slug/chart.svg "Caption")`. Link to our own
pages with relative links (`/use-cases`), never with the domain.

Check locally: `cd frontend && npm run content:check` (the same checks run in CI on every pull request).

## Before approving — the editor's checklist

- Does it answer a real question for a reader we want as a customer? Is that reader clear?
- Is every important claim supported by a source you opened yourself, and dated?
- Are facts, estimates and opinions labelled? Hypothetical numbers marked as such?
- Is it distinct from what we already published (no near-duplicates chasing the same query)?
- Does it say anything about Ensemblis that isn't true today? (It must not.)
- Do the internal links help, and is the call to action the reader's natural next step?
- Would you be comfortable if a competitor fact-checked it line by line?

Then set `approvedBy`, `factCheckedAt` and `publishedAt`, change `status` to `published`, and merge.

## Corrections and updates

Fix typos silently. For a substantive change, set `updatedAt` and, for a correction of fact, add a short
note at the end of the article saying what changed. Re-check `accessed` dates on time-sensitive articles
(AI search products change monthly) at least every quarter.

## Later: where automation plugs in

Every step below can be automated without changing the site, because the contract is the file format and
`lib/blog/validate.ts` (pure, reusable):

1. Topic discovery → a draft entry in the editorial plan.
2. Research and source gathering → `sources` with `accessed` dates.
3. Outline and draft → a `status: draft` file in a pull request.
4. Checks → `validatePost` plus originality and link checks in CI.
5. Internal links and metadata → suggested in the pull request.
6. Review → a person, on the preview deployment. **This step is never automated:** `approvedBy` is a
   person's name, and the build refuses `published` without it.
7. Publish → merge; scheduling handles the date.
8. Measure → Search Console and the funnel query; update or retire articles that don't earn their place.

Build steps 1–5 only after the manual workflow has run for a few weeks and its bottleneck is known.
