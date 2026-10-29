#!/usr/bin/env node
// Read-only browser check of the live public site (Playwright, Chromium): pages render without JavaScript errors,
// the pricing estimator responds, the access and sign-up paths are there, and phone layouts don't scroll sideways.
// Never signs in, submits a form, creates an account or spends credits.
//
//   SITE=https://www.getensemblis.com node frontend/scripts/smoke-production-browser.mjs
// Runs after the HTTP checks in .github/workflows/production-smoke.yml (docs/growth/08-release.md).
import { chromium } from "@playwright/test";

const SITE = (process.env.SITE || "https://www.getensemblis.com").replace(/\/+$/, "");
const results = [];
const record = (ok, name, detail = "") => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();

async function visit(path, size, check) {
  const ctx = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  const label = `${path} @${size.width}px`;
  try {
    const res = await page.goto(`${SITE}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
    if (!res || res.status() !== 200) {
      record(false, `${label} loads`, `HTTP ${res?.status()}`);
      return;
    }
    await check(page, label);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    record(overflow <= 1, `${label} has no sideways scroll`, overflow > 1 ? `${overflow}px wider than the screen` : "");
    record(errors.length === 0, `${label} runs without JavaScript errors`, errors.slice(0, 3).join(" | "));
  } catch (e) {
    record(false, `${label}`, String(e).slice(0, 200));
  } finally {
    await ctx.close();
  }
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

for (const size of [DESKTOP, PHONE]) {
  await visit("/", size, async (page, label) => {
    const h1 = (await page.locator("h1").first().textContent())?.trim() ?? "";
    record(h1.startsWith("Describe the outcome"), `${label} headline`, h1.slice(0, 60));
    const start = await page.locator('a:has-text("Get started")').first().getAttribute("href");
    record(["/access", "/signup"].includes(start ?? ""), `${label} Get started leads to access or sign-up`, start ?? "missing");
    record((await page.locator("#compare").count()) === 1, `${label} shows when to use a general assistant instead`);
  });

  await visit("/pricing", size, async (page, label) => {
    const total = page.getByTestId("estimate-total");
    const before = (await total.textContent())?.trim();
    record(before === "1,400", `${label} estimator starts at the worked example`, before ?? "missing");
    await page.getByRole("button", { name: "Competitor scan" }).click();
    const after = (await total.textContent())?.trim();
    record(after === "850", `${label} estimator responds`, after ?? "missing");
  });

  await visit("/access", size, async (page, label) => {
    record(await page.getByRole("link", { name: /Request access by email/ }).isVisible(), `${label} request-access button`);
    record(await page.getByRole("link", { name: "Sign up with an invite code" }).isVisible(), `${label} invite path`);
  });
}

await visit("/signup", DESKTOP, async (page, label) => {
  record(await page.getByTestId("signup-submit").isVisible(), `${label} sign-up form renders (not submitted)`);
  record((await page.locator('a[href="/access"]').count()) > 0, `${label} links to request access`);
});
await visit("/login", DESKTOP, async (page, label) => {
  record(await page.locator('input[type="password"]').first().isVisible(), `${label} sign-in form renders (not submitted)`);
});
await visit("/blog", DESKTOP, async (page, label) => {
  record((await page.locator("h1").count()) === 1, `${label} Journal renders`);
});
await visit("/how-it-works", DESKTOP, async (page, label) => {
  record((await page.locator("h1").count()) === 1, `${label} renders`);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
