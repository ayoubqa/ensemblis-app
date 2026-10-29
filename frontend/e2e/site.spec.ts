// The public website against a production build (`next build && next start`, no preview flag):
// unpublished articles never leak, the invite-only journey has no dead end, and SEO plumbing is intact.
// Reads content/blog itself, so it stays right as articles are added, reviewed and published.
import { expect, test } from "@playwright/test";
import { isPublic, readContent } from "../lib/blog/posts";
import { signUpViaUI, uniqueEmail } from "./helpers";

const content = readContent();
const publicPosts = content.posts.filter((p) => isPublic(p));
const hiddenPosts = content.posts.filter((p) => !isPublic(p));

test.describe("Journal: only published articles are public", () => {
  test("content/blog is valid", () => {
    expect(content.errors).toEqual([]);
  });

  test("drafts, reviews and scheduled articles answer 404 and appear nowhere public", async ({ page, request }) => {
    for (const p of hiddenPosts) {
      const res = await request.get(`/blog/${p.slug}`);
      expect(res.status(), p.slug).toBe(404);
      const og = await request.get(`/blog/${p.slug}/opengraph-image`);
      expect(og.status(), `${p.slug} share image`).toBe(404);
    }
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const feed = await (await request.get("/blog/feed.xml")).text();
    await page.goto("/blog");
    const hub = await page.content();
    for (const p of hiddenPosts) {
      expect(sitemap, p.slug).not.toContain(`/blog/${p.slug}`);
      expect(feed, p.slug).not.toContain(`/blog/${p.slug}`);
      expect(hub, p.slug).not.toContain(p.title);
    }
    // The public hub never shows preview labels or the preview notice.
    await expect(page.locator(".ed-state, .ed-preview-note, .ed-preview-bar")).toHaveCount(0);
  });

  test("published articles are in the sitemap and the feed; an empty Journal stays out of search and the menu", async ({ page, request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const feed = await request.get("/blog/feed.xml");
    expect(feed.headers()["content-type"]).toContain("application/rss+xml");
    const feedText = await feed.text();
    for (const p of publicPosts) {
      expect(sitemap).toContain(`/blog/${p.slug}`);
      expect(feedText).toContain(`/blog/${p.slug}`);
    }
    await page.goto("/blog");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null);
    const nav = page.getByRole("navigation", { name: "Main" });
    if (publicPosts.length) {
      expect(robots ?? "").not.toContain("noindex");
      await expect(nav.getByRole("link", { name: "Journal" })).toBeVisible();
    } else {
      expect(robots).toContain("noindex");
      await expect(page.getByRole("heading", { name: /first articles are in editorial review/i })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Journal" })).toHaveCount(0);
    }
  });
});

test.describe("Get started never dead-ends", () => {
  test("invite-only: every start link leads to /access, which offers both paths", async ({ page }) => {
    // Simulate production's invite-only sign-up on the config the page reads.
    await page.route("**/api/config", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ response: res, json: { ...json, inviteRequired: true, guestTrialEnabled: false } });
    });
    await page.goto("/");
    const hero = page.locator(".st-hero");
    await expect(hero.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/access");
    await expect(page.getByRole("banner").getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/access");
    await hero.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/access$/);
    await expect(page.getByRole("heading", { name: "Have an invite code?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /No code yet\? Request access/ })).toBeVisible();
    await page.getByRole("link", { name: "Sign up with an invite code" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/access");
  });

  test("open sign-up: start links go straight to /signup", async ({ page }) => {
    await page.route("**/api/config", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), inviteRequired: false } });
    });
    await page.goto("/pricing");
    await expect(page.locator(".st-page-head").getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
  });
});

test.describe("First run", () => {
  test("a new account can skip Company Context and go straight to its first outcome", async ({ page }) => {
    await signUpViaUI(page, { name: "Kai First", company: "First Run Ltd", email: uniqueEmail("firstrun") });
    const note = page.getByTestId("context-first-run");
    await expect(note).toBeVisible();
    await expect(note).toContainText("Optional");
    await note.getByTestId("context-skip").click();
    await expect(page).toHaveURL(/\/objectives\/new$/);
  });
});

test.describe("Public pages: content and SEO plumbing", () => {
  for (const path of ["/", "/use-cases", "/pricing", "/access", "/how-it-works", "/blog", "/blog/editorial-standards"]) {
    test(`${path}: one h1, a canonical URL, images with alt text`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical).toMatch(new RegExp(`^https?://[^/]+${path === "/" ? "/?$" : path.replace(/\//g, "\\/") + "$"}`));
      for (const img of await page.locator("main img, .st img, .ed img").all()) {
        expect(await img.getAttribute("alt"), await img.getAttribute("src") ?? "img").not.toBeNull();
      }
    });
  }

  test("the homepage FAQ in structured data matches the questions on the page", async ({ page }) => {
    await page.goto("/");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const faq = blocks.map((b) => JSON.parse(b)).flat().find((d) => d["@type"] === "FAQPage");
    const visible = await page.locator(".st-faq summary h3").allTextContents();
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(visible);
  });

  test("pricing shows the real price list and the plan range", async ({ page }) => {
    await page.goto("/pricing");
    const list = page.getByRole("region", { name: "Price list" });
    await expect(list.getByRole("rowheader", { name: "Market Research" })).toBeVisible();
    await expect(list.getByRole("row", { name: /Verification gate/ })).toContainText("150");
    await expect(page.getByRole("heading", { level: 2, name: /800–2,050 credits per objective/ })).toBeVisible();
  });

  test("the pricing estimator adds up from the price list and never exceeds a plan's five work steps", async ({ page }) => {
    await page.goto("/pricing");
    const total = page.getByTestId("estimate-total");
    await expect(total).toHaveText("1,400"); // "Market entry" = the worked example: 100 + 300 + 300 + 250 + 300 + 150
    await page.getByRole("button", { name: "Competitor scan" }).click();
    await expect(total).toHaveText("850"); // 100 + 300 + 300 + 150
    for (const name of ["Market Research", "Account Research", "Lead Research", "Process Analysis"]) await page.getByLabel(name).check();
    await expect(page.getByLabel("Unit Economics")).toBeDisabled(); // five work steps chosen: the maximum a plan has
    await expect(page.locator(".st-est-note")).toContainText("exact total before anything runs");
  });

  test("robots.txt still keeps the app out of search and points to the sitemap", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    for (const p of ["/dashboard", "/objectives", "/settings", "/admin"]) expect(robots).toContain(`Disallow: ${p}`);
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const p of ["/pricing", "/use-cases", "/access"]) expect(sitemap).toContain(`${p}</loc>`);
  });
});
