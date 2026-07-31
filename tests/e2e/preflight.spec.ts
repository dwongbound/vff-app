import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the checklist tracks progress and gates sign-off", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");

  // Nothing checked yet: sign-off is unavailable and the page says what's next.
  const signOff = page.getByRole("button", { name: "Sign off preflight" });
  await expect(signOff).toBeDisabled();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();

  // Check off the whole first section in one tap; the counter follows.
  await page.getByRole("button", { name: "Check all in section" }).click();
  await expect(page.getByText(/^\d+ of \d+ checked$/)).toBeVisible();

  // Still incomplete → still gated.
  await expect(signOff).toBeDisabled();
});

test("a squawk raised on the walkaround is filed with the preflight", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await page.getByRole("button", { name: "Report a squawk" }).click();
  await page.getByLabel("What's wrong?").fill("Nav light flickering");
  await page.getByRole("button", { name: "Add squawk" }).click();

  await expect(page.getByText("Nav light flickering")).toBeVisible();

  // Saving partial progress is allowed and files the squawk with it.
  await page.getByRole("button", { name: "Check all in section" }).first().click();
  await page.getByRole("button", { name: "Save progress" }).click();
  await expect(page.getByText(/Progress saved/)).toBeVisible({ timeout: 60_000 });

  // It now shows in the airplane's open-squawk list on the log tab.
  await gotoTab(page, "/log", "Flight log");
  await expect(page.getByText("Nav light flickering")).toBeVisible();
});

test("filing a flight adds it to the log and advances the tach", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");

  // Tach start prefills from the airplane; fly 1.5 hours.
  const tachStart = await page.getByLabel("Tach start").inputValue();
  const end = (Number(tachStart) + 1.5).toFixed(1);
  await page.getByLabel("Tach end").fill(end);
  await page.getByLabel("Landings", { exact: true }).fill("2");
  await page.getByLabel("Night landings").fill("1");

  await expect(page.getByText("1.5 hr")).toBeVisible();

  await page.getByRole("button", { name: "File this flight" }).click();
  await expect(page.getByText(/Filed 1.5 hours/)).toBeVisible({ timeout: 60_000 });

  await gotoTab(page, "/log", "Flight log");
  await expect(page.getByText("1.5").first()).toBeVisible();
  // The night landing lands in the currency card, not just the log line.
  await expect(page.getByText(/Night: [1-9]\d*\/3 full-stop/)).toBeVisible();
});

test("an impossible meter reading is caught before it can be filed", async ({
  page,
}) => {
  await gotoTab(page, "/postflight", "Post-flight");
  const tachStart = await page.getByLabel("Tach start").inputValue();
  await page.getByLabel("Tach end").fill((Number(tachStart) - 5).toFixed(1));

  await expect(page.getByText(/lower than tach start/)).toBeVisible();
  await expect(page.getByRole("button", { name: "File this flight" })).toBeDisabled();
});
