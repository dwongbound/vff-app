// Profile edits, and the currency badges the club actually cares about.
import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("saving a profile persists and updates the currency badges", async ({ page }) => {
  await gotoTab(page, "/profile", "Your profile");

  await page.getByLabel("Phone").fill("(555) 010-0100");
  // A review taken last month is current for 24 calendar months.
  const recent = new Date();
  recent.setMonth(recent.getMonth() - 1);
  const ymd = `${recent.getFullYear()}-${String(recent.getMonth() + 1).padStart(2, "0")}-15`;
  await page.getByLabel("Last flight review", { exact: true }).fill(ymd);

  await expect(page.getByText(/Current through/)).toBeVisible();
  await expect(page.getByText("Flight review current")).toBeVisible();

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });

  // Survives a reload — i.e. it really went to the database.
  await page.reload();
  await expect(page.getByLabel("Phone")).toHaveValue("(555) 010-0100", {
    timeout: 60_000,
  });
  await expect(page.getByText("Flight review current")).toBeVisible();
});

test("an expired flight review is called out", async ({ page }) => {
  await gotoTab(page, "/profile", "Your profile");

  await page.getByLabel("Last flight review", { exact: true }).fill("2019-03-01");
  await expect(page.getByText("Flight review due")).toBeVisible();
});
