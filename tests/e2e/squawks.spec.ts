// The squawk lifecycle, which is the app's one piece of genuinely safety-
// relevant behaviour: a grounding squawk has to stop the whole club, and only
// an admin sign-off may clear it.
import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("a grounding squawk warns the whole club until an admin signs it off", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await page.getByRole("button", { name: "Report a squawk" }).click();
  await page.getByLabel("What's wrong?").fill("Vacuum pump failed");
  await page.getByLabel("Severity").selectOption("GROUNDING");
  // The form spells out what grounding actually means before you commit to it.
  await expect(page.getByText(/grounds the airplane for everyone/)).toBeVisible();
  await page.getByRole("button", { name: "Add squawk" }).click();

  await page.getByRole("button", { name: "Check all in section" }).first().click();
  await page.getByRole("button", { name: "Save progress" }).click();
  await expect(page.getByText(/Progress saved/)).toBeVisible({ timeout: 60_000 });

  // The banner is app-wide, not page-local.
  const banner = page.getByText(/is grounded:/);
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await gotoTab(page, "/reservations", "Reservations");
  await expect(page.getByText(/is grounded:/)).toBeVisible();

  // Sign it off as the (seeded) admin.
  await gotoTab(page, "/log", "Flight log");
  const squawkRow = page
    .locator("li")
    .filter({ hasText: "Vacuum pump failed" })
    .first();
  await squawkRow.getByRole("button", { name: "Sign off" }).click();
  await page.getByLabel("How was it fixed?").fill("New pump installed");
  await page.getByRole("button", { name: "Confirm" }).click();

  // Cleared: the squawk drops off the open list and the banner goes with it.
  await expect(
    page.locator("li").filter({ hasText: "Vacuum pump failed" })
  ).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/is grounded:/)).toBeHidden();
});
