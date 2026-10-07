import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

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

export async function defineObjective(page: Page, statement: string, opts: { suggest?: boolean } = {}) {
  await page.goto("/objectives/new");
  await page.getByTestId("objective-statement").fill(statement);
  if (opts.suggest) {
    await page.getByTestId("suggest-criteria").click();
    await expect(page.getByTestId("criterion-input").first()).toBeVisible();
  }
  await page.getByTestId("submit-objective").click();
  await page.waitForURL(/\/objectives\/(?!new)[^/]+$/);
  await expect(page.getByTestId("objective-console")).toBeVisible();
}
