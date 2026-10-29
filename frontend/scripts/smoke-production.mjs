#!/usr/bin/env node
// Read-only production smoke check for the public site and the API — no sign-in, no writes, no paid calls.
//
//   node frontend/scripts/smoke-production.mjs
//   SITE=https://www.getensemblis.com API=https://ensemblis-api.onrender.com EXPECT_RELEASE=<sha> WAIT_SECONDS=900 node …
//   EXPECT_API_RELEASE=<sha of the last commit that changed backend/>: also wait for Render to run it (a WARN if it doesn't).
//
// FAIL (exit 1) = a safety gate or a regression: an unpublished article reachable, a wrong canonical, the API down,
// CORS refusing the site, sign-up no longer invite-only, the AI provider not configured.
// WARN = configuration a person must fix but that breaks nothing new (e.g. no contact address for access requests).
// Prints only flags and statuses — never a secret (the API's /api/config is public and contains none).
// Runs in .github/workflows/production-smoke.yml; see docs/growth/08-release.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = (process.env.SITE || "https://www.getensemblis.com").replace(/\/+$/, "");
const API = (process.env.API || "https://ensemblis-api.onrender.com").replace(/\/+$/, "");
const EXPECT_RELEASE = (process.env.EXPECT_RELEASE || "").trim().slice(0, 7);
const EXPECT_API_RELEASE = (process.env.EXPECT_API_RELEASE || "").trim().slice(0, 7);
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 0);
const EXPECT_INVITE = process.env.EXPECT_INVITE !== "0";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(here, "..", "content", "blog");

const results = [];
const record = (level, name, detail = "") => {
  results.push({ level, name, detail });
  console.log(`${level.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const pass = (n, d) => record("PASS", n, d);
const warn = (n, d) => record("WARN", n, d);
const fail = (n, d) => record("FAIL", n, d);

async function get(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(90_000), ...init, headers: { "user-agent": "ensemblis-smoke/1", ...(init.headers || {}) } });
      const text = await res.text();
      return { status: res.status, headers: res.headers, text, url: res.url };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 5000 * (i + 1))); // a sleeping free-tier API can take a while to wake
    }
  }
  return { status: 0, headers: new Headers(), text: "", error: String(last) };
}

const canonicalOf = (html) => /<link[^>]+rel="canonical"[^>]*href="([^"]+)"/i.exec(html)?.[1] ?? /<link[^>]+href="([^"]+)"[^>]*rel="canonical"/i.exec(html)?.[1] ?? null;
const releaseOf = (html) => /<meta[^>]+name="ensemblis-release"[^>]*content="([^"]*)"/i.exec(html)?.[1] ?? null;

/** Articles in the repository that must NOT be reachable: anything not published, or scheduled for later. */
function unpublishedSlugs() {
  const now = Date.now();
  return fs
    .readdirSync(CONTENT)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md")
    .map((f) => {
      const raw = fs.readFileSync(path.join(CONTENT, f), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
      const status = /^status:\s*["']?(\w+)/m.exec(fm)?.[1];
      const at = /^publishedAt:\s*["']?([^"'\n]+)/m.exec(fm)?.[1];
      const isPublic = status === "published" && !!at && Date.parse(at) <= now;
      return { slug: f.replace(/\.md$/, ""), isPublic };
    })
    .filter((p) => !p.isPublic)
    .map((p) => p.slug);
}

async function waitForRelease() {
  if (!EXPECT_RELEASE) return;
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  for (;;) {
    const home = await get(`${SITE}/?smoke=${Date.now()}`, { headers: { "cache-control": "no-cache" } }, 1);
    const live = releaseOf(home.text);
    if (live && live.startsWith(EXPECT_RELEASE)) return pass("expected release is live", `release ${live}`);
    if (Date.now() > deadline) return fail("expected release is live", `still serving ${live ?? "a build without a release marker"} after ${WAIT_SECONDS}s`);
    console.log(`....  waiting for release ${EXPECT_RELEASE} (live: ${live ?? "none"})`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

async function site() {
  for (const [p, mustContain] of [
    ["/", "Describe the outcome"],
    ["/pricing", "credits per objective"],
    ["/use-cases", "What you can hand off"],
  ]) {
    const r = await get(`${SITE}${p}`);
    if (r.status !== 200) {
      fail(`${p} loads`, `HTTP ${r.status}${r.error ? ` (${r.error})` : ""}`);
      continue;
    }
    const canonical = canonicalOf(r.text);
    const expected = `${SITE}${p === "/" ? "" : p}`;
    if (canonical && canonical.replace(/\/$/, "") === expected) pass(`${p} canonical`, canonical);
    else fail(`${p} canonical`, `expected ${expected}, got ${canonical}`);
    if (r.text.includes(mustContain)) pass(`${p} content`);
    else fail(`${p} content`, `missing "${mustContain}"`);
  }

  const access = await get(`${SITE}/access`);
  if (access.status !== 200) fail("/access loads", `HTTP ${access.status}`);
  else if (access.text.includes("Request access by email")) pass("/access offers a way to request access (contact address configured)");
  else if (access.text.includes("Online requests aren")) warn("/access offers a way to request access", "NEXT_PUBLIC_CONTACT_EMAIL is not set: visitors without an invite code cannot ask for one");
  else warn("/access request path", "neither the request button nor the 'not open' notice was found");

  const privacy = await get(`${SITE}/privacy`);
  if (privacy.status !== 200) fail("/privacy loads", `HTTP ${privacy.status}`);
  else if (privacy.text.includes("set NEXT_PUBLIC_CONTACT_EMAIL")) warn("/privacy names a contact address", "placeholder shown: NEXT_PUBLIC_CONTACT_EMAIL is not set");
  else pass("/privacy names a contact address");

  // Publication safeguard: nothing unpublished is reachable or listed. (Also proves BLOG_PREVIEW is off in production.)
  const hidden = unpublishedSlugs();
  const [sitemap, feed, robots] = await Promise.all([get(`${SITE}/sitemap.xml`), get(`${SITE}/blog/feed.xml`), get(`${SITE}/robots.txt`)]);
  for (const slug of hidden) {
    const page = await get(`${SITE}/blog/${slug}`, {}, 2);
    if (page.status === 404) pass(`unpublished article is not public: ${slug}`);
    else fail(`unpublished article is not public: ${slug}`, `HTTP ${page.status} — check BLOG_PREVIEW and the article's status`);
    const og = await get(`${SITE}/blog/${slug}/opengraph-image`, {}, 2);
    if (og.status === 404) pass(`its share image is not public: ${slug}`);
    else fail(`its share image is not public: ${slug}`, `HTTP ${og.status}`);
    if (sitemap.text.includes(`/blog/${slug}<`)) fail(`sitemap excludes ${slug}`);
    if (feed.status === 200 && feed.text.includes(`/blog/${slug}<`)) fail(`feed excludes ${slug}`);
  }
  if (sitemap.status === 200 && sitemap.text.includes(`${SITE}/pricing<`)) pass("sitemap lists the public pages on the canonical host");
  else fail("sitemap", `HTTP ${sitemap.status}, or /pricing missing on ${SITE}`);
  if (robots.status === 200 && /Disallow: \/dashboard/.test(robots.text) && /Sitemap: /.test(robots.text)) pass("robots.txt keeps the app out of search and points to the sitemap");
  else fail("robots.txt", `HTTP ${robots.status}`);
}

const apiReleaseOf = (text) => {
  try {
    const r = JSON.parse(text).release;
    return typeof r === "string" && r ? r : null;
  } catch {
    return null;
  }
};

/** Which commit the API runs (RENDER_GIT_COMMIT, from /health/live). Render deploys the API only when backend/ changes. */
async function apiRelease(first) {
  let live = apiReleaseOf(first.text);
  if (!EXPECT_API_RELEASE) return pass("API release", live ?? "not reported (a build from before /health/live reported it)");
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (!(live && live.startsWith(EXPECT_API_RELEASE)) && Date.now() < deadline) {
    console.log(`....  waiting for the API to run ${EXPECT_API_RELEASE} (live: ${live ?? "not reported"})`);
    await new Promise((r) => setTimeout(r, 20_000));
    live = apiReleaseOf((await get(`${API}/health/live?smoke=${Date.now()}`, {}, 1)).text);
  }
  if (live && live.startsWith(EXPECT_API_RELEASE)) pass("API runs the expected release", live);
  else warn("API runs the expected release", `still ${live ?? "not reported"} after ${WAIT_SECONDS}s, expected ${EXPECT_API_RELEASE} — check the Render deploy (auto-deploy, build logs)`);
}

async function api() {
  const live = await get(`${API}/health/live`);
  if (live.status === 200) pass("API is up (/health/live)");
  else return fail("API is up (/health/live)", `HTTP ${live.status}${live.error ? ` (${live.error})` : ""}`);
  await apiRelease(live);

  const ready = await get(`${API}/health`);
  let health = null;
  try {
    health = JSON.parse(ready.text);
  } catch {
    /* not JSON */
  }
  if (ready.status === 200 && health?.db === "ok") (health.degraded ? warn : pass)("API database answers (/health)", health.degraded ? "queue is lagging" : "");
  else fail("API database answers (/health)", `HTTP ${ready.status}`);

  const cfg = await get(`${API}/api/config`, { headers: { origin: SITE } });
  const allowed = cfg.headers.get("access-control-allow-origin");
  if (allowed === SITE) pass("CORS allows the site", allowed);
  else fail("CORS allows the site", `access-control-allow-origin: ${allowed ?? "(none)"} — check CORS_ORIGIN on the API`);
  let c = null;
  try {
    c = JSON.parse(cfg.text);
  } catch {
    return fail("/api/config is readable", `HTTP ${cfg.status}`);
  }
  if (c.inviteRequired === EXPECT_INVITE) pass(`sign-up is ${EXPECT_INVITE ? "invite-only" : "open"} as expected`);
  else fail("sign-up policy", `inviteRequired is ${c.inviteRequired}, expected ${EXPECT_INVITE}`);
  if (c.aiConfigured && !c.mockAI) pass("AI provider configured for real work", `${c.aiProviderLabel} (${c.aiEndpoint})`);
  else fail("AI provider configured for real work", c.mockAI ? "the mock provider is active" : `not configured: ${c.aiProblem ?? "unknown"}`);
  if (c.searchEnabled && c.searchProvider === "tavily" && !c.searchCustomEndpoint) pass("web search uses the live provider", c.searchProviderLabel);
  else warn("web search provider", `${c.searchProviderLabel ?? c.searchProvider} — research steps use ${c.searchEnabled ? "a fallback or custom source" : "no web search"}`);
  pass("deployment facts (public)", `starting balance ${c.startingCreditsCents} credits · payments ${c.paymentsEnabled ? "on" : "off"} · email ${c.emailEnabled ? "on" : "off"} · ${c.maxTasksPerUserPerDay}/day`);
}

console.log(`Production smoke — site ${SITE}, API ${API}${EXPECT_RELEASE ? `, expecting release ${EXPECT_RELEASE}` : ""}\n`);
await waitForRelease();
await site();
await api();
const failed = results.filter((r) => r.level === "FAIL");
const warned = results.filter((r) => r.level === "WARN");
console.log(`\n${results.length - failed.length - warned.length} passed, ${warned.length} warnings, ${failed.length} failed`);
if (warned.length) console.log(`Needs a person:\n${warned.map((w) => `- ${w.name}: ${w.detail}`).join("\n")}`);
process.exit(failed.length ? 1 : 0);
