# Releasing website changes

How a website change goes from a pull request to production, what is checked on the way, and how to undo it.
The backend has its own runbook in `DEPLOYMENT.md`; this covers the public site and the Journal.

## How a release happens

1. **Pull request to `main`.** CI runs backend and frontend checks plus the end-to-end suites
   (`.github/workflows/ci.yml`); Vercel builds a preview of the branch.
2. **Production baseline.** The *Production smoke* workflow (`.github/workflows/production-smoke.yml`) runs on the
   pull request and checks production **as it is now** — so problems that already exist are known before the merge.
3. **Merge with a merge commit** (not squash), which keeps branch history intact for anything stacked on it.
4. **Vercel deploys `main` to production.** A merge on GitHub is not a deployment: wait for it.
5. **Post-deployment check.** The same workflow runs on the push to `main`: it waits until production serves that
   commit (the `<meta name="ensemblis-release">` tag carries the short commit SHA), then runs every check against it.
   It also waits for the API to run the last commit that changed `backend/` (Render deploys the API only when
   `backend/` changes; `/health/live` reports `release` from `RENDER_GIT_COMMIT`). If the API is still on an older
   commit after the wait, that is a warning to check the Render deploy, not a failure of the website release.

## What the production smoke check verifies (read-only)

| Check | Fails the run when |
|---|---|
| Home, pricing, use cases load with the right content and canonical URL on `https://www.getensemblis.com` | a page errors or its canonical points elsewhere |
| Every article that isn't published (per `frontend/content/blog`) answers 404, with its share image, and is absent from the sitemap and RSS feed | anything unpublished is reachable — e.g. `BLOG_PREVIEW` set in production |
| Sitemap and robots.txt | missing, or the app isn't disallowed |
| API liveness, database readiness | the API or its database is down |
| CORS from the site to the API | `CORS_ORIGIN` doesn't allow `https://www.getensemblis.com` |
| Sign-up policy | sign-up is no longer invite-only |
| AI provider | not configured, or the mock provider is active |

Then a **browser check** (`frontend/scripts/smoke-production-browser.mjs`, Chromium) opens the home, pricing and
access pages at desktop and phone widths, plus sign-up, sign-in, the Journal and How it works. It fails on any
JavaScript error, an estimator that doesn't respond, a missing request-access or invite path, or a page that scrolls
sideways on a phone. It never submits a form.

The HTTP check **warns** (without failing) when `NEXT_PUBLIC_CONTACT_EMAIL` is missing (no way to request access; placeholders
on the legal pages) or when web search falls back from the live provider. It never signs in, writes, runs a task or
prints a secret: everything it reads is public (`/api/config` contains flags and limits only).

Run it by hand: Actions → *Production smoke* → Run workflow, or locally with
`SITE=https://www.getensemblis.com API=https://ensemblis-api.onrender.com node frontend/scripts/smoke-production.mjs`.

## Rolling back

- **Fastest:** Vercel → project → Deployments → the previous production deployment → *Promote to Production*
  (instant; no rebuild). Use it for anything visibly broken.
- **In Git:** `git revert -m 1 <merge commit>` on a branch, pull request, merge — production redeploys without the
  change. Use it once the instant rollback has stopped the harm, so `main` matches what is live.
- Website releases carry no database migrations, so a rollback never needs one.

## Before every website release

- `cd frontend && npm run lint && npm run typecheck && npm test && npm run content:check`
- `cd backend && npm run build && cd ../frontend && CI=true npm run e2e && CI=true npm run e2e:prod-like`
- `git diff --check` and a scan of the diff for secrets
- On the Vercel preview: the changed pages render; review articles show their "preview" label
- After the merge: the *Production smoke* run on `main` is green
