// When the Chief of Staff lacks information it stops with an exception instead
// of guessing; the user answers, planning resumes, and the plan waits for
// approval. Cancelling mid-run refunds the work that didn't run.
import { expect, test } from "@playwright/test";
import { defineObjective, expectStatus, signUpViaUI, uniqueEmail } from "./helpers";

test("missing information → exception → answer → resume → approve → cancel with refund", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await signUpViaUI(page, { name: "Sam Rivera", company: "", email: uniqueEmail("exc") });

  // No Company Context on file + an objective about "our" business → the Chief of Staff asks.
  await defineObjective(page, "Find the best channel partners for our product in France and rank the top five");
  await expectStatus(page, "BLOCKED");
  const exception = page.getByTestId("exception-card");
  await expect(exception).toBeVisible();
  await expect(exception.getByText("What happened")).toBeVisible();
  await exception.getByLabel("Your answer").fill(
    "We sell an inventory forecasting SaaS for mid-size retailers. Customers are heads of supply chain. We sell direct in Spain today."
  );
  await exception.getByRole("button", { name: "Send answer" }).click();

  // Planning resumes with the answer and waits for approval.
  await expectStatus(page, "WAITING_FOR_APPROVAL");
  await expect(page.getByTestId("exception-card")).toHaveCount(0);

  // The Exception Center keeps the resolved record.
  await page.goto("/exceptions");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(/Resolved \(provide info\)/)).toBeVisible();
  await page.goBack();

  await page.getByTestId("approval-card").getByRole("button", { name: /^Approve/ }).click();
  await expectStatus(page, /RUNNING|VERIFYING/, 30_000);
  await page.getByRole("button", { name: "Cancel execution" }).click();
  await expectStatus(page, "CANCELLED");

  // The charge and its refund are both on the Usage page.
  await page.goto("/usage");
  await expect(page.getByText("Refund").first()).toBeVisible();
  await expect(page.getByText("Execution").first()).toBeVisible();
});
