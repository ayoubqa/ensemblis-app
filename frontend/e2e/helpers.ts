import { expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const API = "http://localhost:4100";

let n = 0;
export function uniqueEmail(tag: string): string {
  n += 1;
  return `e2e-${tag}-${Date.now().toString(36)}-${n}@example.com`;
}

/** Sign up through the real UI. Lands on Company Context (the first-run step). */
export async function signUpViaUI(page: Page, opts: { name: string; company: string; email: string; password?: string }) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(opts.name);
  await page.getByLabel("Company").fill(opts.company);
  await page.getByLabel("Work email").fill(opts.email);
  await page.locator("#su-password").fill(opts.password ?? "correct-horse-battery-1");
  await page.locator("#su-terms").check();
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/context");
}

/** Create an account straight through the API and sign this browser context in. */
export async function signUpViaAPI(request: APIRequestContext, context: BrowserContext, opts: { name: string; email: string }) {
  const res = await request.post(`${API}/api/auth/signup`, {
    data: { name: opts.name, email: opts.email, password: "correct-horse-battery-2", acceptedTerms: true, accountType: "COMPANY" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { token } = (await res.json()) as { token: string };
  await context.addInitScript((t) => window.localStorage.setItem("ensemblis_token", t), token);
  return token;
}

/** The console exposes the current execution status as data-status. */
export async function expectStatus(page: Page, status: string | RegExp, timeout = 60_000) {
  await expect(page.getByTestId("execution-status")).toHaveAttribute("data-status", status, { timeout });
}

/** The stack is production-like (npm run e2e:prod-like): the OpenAI-compatible provider code against a local stub — still not a real model. */
export const PROD_LIKE = process.env.PROD_LIKE === "1";

/**
 * Keyboard navigation: presses Tab (or Shift+Tab) until `target` has focus — as a keyboard user would.
 * Fails when it isn't reachable within `max` presses (i.e. it isn't in the tab order).
 */
export async function tabTo(page: Page, target: Locator, opts: { max?: number; back?: boolean } = {}) {
  const max = opts.max ?? 120;
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(opts.back ? "Shift+Tab" : "Tab");
  }
  await expect(target, `not reachable with ${opts.back ? "Shift+" : ""}Tab within ${max} presses`).toBeFocused();
}

/** Fills the Company Context form with a short, realistic profile and saves it. */
export async function fillCompanyContext(page: Page) {
  await page.getByLabel("What the company does").fill(
    "Northwind Cooling builds liquid cooling systems for high-density data centers. Our systems cut cooling energy use by 30% compared with air cooling."
  );
  await page.getByLabel("Customers / ICP").fill("Colocation operators and hyperscale data center builders in Europe. Heads of facilities decide.");
  await page.getByLabel("Markets & geographies").fill("We sell in Germany today. We want to expand to two more European markets in 2027.");
  await page.getByLabel("Business goals").fill("Reach 40 enterprise customers in Europe by the end of 2027.");
  await page.getByTestId("save-context").click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
}

/** Horizontal overflow of the current page in px (0 = none). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

export async function defineObjective(page: Page, statement: string, opts: { suggest?: boolean } = {}) {
  await page.goto("/objectives/new");
  // A fresh define page starts empty: no example statement or criteria pre-filled.
  await expect(page.getByTestId("objective-statement")).toHaveValue("");
  await expect(page.getByTestId("criterion-input")).toHaveCount(0);
  await page.getByTestId("objective-statement").fill(statement);
  if (opts.suggest) {
    await page.getByTestId("suggest-criteria").click();
    await expect(page.getByTestId("criterion-input").first()).toBeVisible();
  }
  await page.getByTestId("submit-objective").click();
  await page.waitForURL(/\/objectives\/(?!new)[^/]+$/);
  await expect(page.getByTestId("objective-console")).toBeVisible();
}
