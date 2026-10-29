// Analytics wiring, end to end — opt-in, because analytics is off in normal builds:
//
//   NEXT_PUBLIC_ANALYTICS=vercel npx playwright test e2e/analytics.spec.ts
//
// Records every call the site makes to Vercel's va("event", …) queue (kept in sessionStorage so it survives page
// loads) and checks names, properties and that nothing personal is sent. It proves what the site SENDS; whether
// Vercel RECEIVES it can only be checked on a Vercel deployment (docs/growth/04-measurement.md).
import { expect, test, type Page } from "@playwright/test";
import { isPublic, readContent } from "../lib/blog/posts";
import { uniqueEmail } from "./helpers";

test.skip(process.env.NEXT_PUBLIC_ANALYTICS !== "vercel", "analytics is off in this build (set NEXT_PUBLIC_ANALYTICS=vercel)");

type Recorded = { name: string; data?: Record<string, unknown> };

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const rec = (...args: unknown[]) => {
      try {
        const log = JSON.parse(sessionStorage.getItem("__va") || "[]");
        log.push(args[1]);
        sessionStorage.setItem("__va", JSON.stringify(log));
      } catch {
        /* storage unavailable */
      }
    };
    Object.defineProperty(window, "va", { get: () => rec, set: () => {}, configurable: true });
  });
});

const events = (page: Page): Promise<Recorded[]> => page.evaluate(() => JSON.parse(sessionStorage.getItem("__va") || "[]"));

test("the header's Get started and a sign-up are reported, with nothing personal", async ({ page }) => {
  const email = uniqueEmail("analytics");
  await page.goto("/");
  await page.locator("header").getByRole("link", { name: "Get started" }).click();
  await page.waitForURL(/\/(signup|access)$/);
  expect(await events(page)).toContainEqual({ name: "cta_click", data: { from: "header", to: new URL(page.url()).pathname } });

  if (new URL(page.url()).pathname === "/signup") {
    await page.getByLabel("Your name").fill("Analytics Tester");
    await page.getByLabel("Company").fill("Example Co");
    await page.getByLabel("Work email").fill(email);
    await page.locator("#su-password").fill("correct-horse-battery-1");
    await page.locator("#su-terms").check();
    await page.getByTestId("signup-submit").click();
    await page.waitForURL("**/context");
    expect((await events(page)).map((e) => e.name)).toContain("signup_completed");
  }

  const sent = JSON.stringify(await events(page));
  for (const secret of [email, "Analytics Tester", "Example Co", "correct-horse"]) expect(sent).not.toContain(secret);
  for (const e of await events(page)) expect(Object.keys(e.data ?? {}).length).toBeLessThanOrEqual(2);
});

const article = readContent().posts.find((p) => isPublic(p));

test("an article reports read-to-the-end and its call to action", async ({ page }) => {
  test.skip(!article, "no published article in this build");
  await page.goto(`/blog/${article!.slug}`);
  await page.locator(".ed-read-end").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await events(page)).map((e) => e.name)).toContain("article_read_complete");
  const cta = page.locator(".ed-cta a");
  if (await cta.count()) {
    await cta.click();
    await expect.poll(async () => (await events(page)).map((e) => e.name)).toContain("blog_cta_click");
  }
});
