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

  await page.getByRole("button", { name: "Save" }).click();
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

// TapWorship's two calendar answers, on the profile: do I want invites at all,
// and which calendar do they go to. The test server has no Google client, so
// the picker isn't offered and the address box is the way to answer.
test("calendar invites can be switched off and pointed at another calendar", async ({ page }) => {
  await gotoTab(page, "/profile", "Your profile");
  const card = page.getByTestId("calendar-invites");
  const toggle = card.getByRole("button", { name: "Send me calendar invites for my bookings" });

  // On by default, which is what the app did before the switch existed.
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Choose from my calendars" })).toHaveCount(0);

  await toggle.click();
  await expect(card.getByText(/You won.t be invited/)).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 60_000 });

  // Back on, with invites sent to a secondary calendar's own address.
  await toggle.click();
  const address = card.getByLabel("Send invites to");
  await address.fill("abc123@group.calendar.google.com");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(address).toHaveValue("abc123@group.calendar.google.com");

  // Something that isn't an address is refused, and says why.
  await address.fill("not an address");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("The invite address has to be an email address.")).toBeVisible();

  // Blank goes back to the account email, and leaves nothing saved.
  await address.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
});
