// Checkouts › Add Fuel — servicing filed on its own, with no flight attached.
//
// The thing worth covering is that it's genuinely independent: it reaches the
// airplane without a flight, it doesn't touch the log or the tach, and it
// answers the question the post-flight form can't — whose card paid, which is
// what decides whether anyone is owed money.
import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("Add Fuel lives with the checkouts and files without a flight", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Checkouts" }).click();
  await page.getByRole("link", { name: "Add Fuel" }).click();
  await expect(
    page.getByRole("heading", { name: "Add Fuel", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // Nothing to record yet, so there's nothing to file.
  const record = page.getByRole("button", { name: "Record", exact: true });
  await expect(record).toBeDisabled();
  await expect(page.getByText(/Enter some fuel, some oil, or what it cost/)).toBeVisible();

  await page.getByLabel("Fuel added").fill("18.4");
  await page.getByLabel("Cost", { exact: true }).fill("131.24");
  await expect(record).toBeEnabled();
  await record.click();

  // Filed on the member's own card by default, so the club owes them for it.
  await expect(page.getByText(/credited back to you/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("18.4 gal").first()).toBeVisible();
  await expect(page.getByText("own card").first()).toBeVisible();
});

test("the club's own card records the fuel without owing anybody", async ({
  page,
}) => {
  await gotoTab(page, "/servicing", "Add Fuel");

  await page.getByLabel("Fuel added").fill("12");
  await page.getByLabel("Cost", { exact: true }).fill("84.00");
  await page.getByRole("radio", { name: /The club's card/ }).check();
  await page.getByRole("button", { name: "Record", exact: true }).click();

  // Recorded, but the confirmation deliberately promises nothing back.
  await expect(page.getByText("Recorded.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("club card").first()).toBeVisible();
});

test("a fill-up is not a flight", async ({ page }) => {
  // The tach the airplane is at before anything is recorded.
  await gotoTab(page, "/log", "Flight log");
  const tachBefore = await page.getByText(/tach \d/).innerText();
  const flightsBefore = await page
    .getByRole("listitem")
    .filter({ hasText: /tach/ })
    .count();

  await gotoTab(page, "/servicing", "Add Fuel");
  await page.getByLabel("Oil added").fill("1");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  // `exact`, not /^Recorded/: the club-card radio's own description starts
  // "Recorded, but nobody is owed anything", so the loose match is ambiguous
  // with the confirmation banner. Oil with no cost is the plain confirmation.
  await expect(page.getByText("Recorded.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // No hours were flown, so the log and the meters are exactly where they were.
  await gotoTab(page, "/log", "Flight log");
  await expect(page.getByText(/tach \d/)).toHaveText(tachBefore);
  await expect(
    page.getByRole("listitem").filter({ hasText: /tach/ })
  ).toHaveCount(flightsBefore);
});
