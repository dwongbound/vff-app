// Phone-width pass over the app's responsive branches: the bottom tab bar
// replaces the top strip, the reservation list replaces the month grid, and
// the "+" FAB is how you book. Runs on real device presets (see
// playwright.config.ts projects) rather than a narrow desktop window.
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("phones get the bottom tab bar, not the desktop strip", async ({ page }) => {
  // Short labels in the floating pill.
  await expect(page.getByRole("link", { name: "Reserve" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log" })).toBeVisible();
  // The desktop-only "Book the airplane" button is hidden at this width.
  await expect(
    page.getByRole("button", { name: "Book the airplane", exact: true })
  ).toBeHidden();
});

test("the schedule is a list, and the + button opens the booking sheet", async ({
  page,
}) => {
  // The month grid's weekday header never renders on a phone.
  await expect(page.getByText("Sun", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "New reservation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Start", { exact: true })).toBeVisible();
});

test("phones keep the native date picker instead of the custom popover", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New reservation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // No custom calendar button: on a touch device the OS picker is the better
  // control, so DateTimeField leaves the native one alone.
  await expect(
    page.getByRole("button", { name: "Open calendar for Start" })
  ).toBeHidden();
  // …and the field itself is still a real datetime input.
  await expect(page.getByLabel("Start", { exact: true })).toHaveAttribute("type", "datetime-local");
});

test("tabs are reachable from the bottom bar", async ({ page }) => {
  await page.getByRole("link", { name: "Preflight" }).click();
  await expect(
    page.getByRole("heading", { name: "Preflight", exact: true })
  ).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByRole("heading", { name: "Flight log" })).toBeVisible({
    timeout: 60_000,
  });
});
