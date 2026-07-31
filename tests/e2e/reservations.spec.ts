import { expect, test } from "@playwright/test";
import { signIn, TAIL_NUMBER } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the desktop layout shows the month calendar", async ({ page }) => {
  await expect(page.getByText("Sun", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  // The seed books the admin tomorrow, so the "your next flight" card is
  // there. (We don't assert on a specific calendar cell: the seed's offsets
  // are relative to the run date, so a booking can land in the next month.)
  await expect(page.getByText("Your next flight")).toBeVisible();
});

test("booking the airplane, then cancelling it", async ({ page }) => {
  await page.getByRole("button", { name: "Book the airplane", exact: true }).click();

  // Two days out at 13:00–15:00, which the seed leaves free.
  const start = new Date();
  start.setDate(start.getDate() + 3);
  start.setHours(13, 0, 0, 0);
  const end = new Date(start);
  end.setHours(15);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;

  await page.getByLabel("Start", { exact: true }).fill(local(start));
  await page.getByLabel("End", { exact: true }).fill(local(end));
  await page.getByLabel("Notes (optional)").fill("E2E booking");
  await page.getByRole("button", { name: "Book it" }).click();

  // It shows up as "your next flight" or on the grid as a You chip.
  await expect(page.getByRole("button", { name: /You/ }).first()).toBeVisible();

  // Reopen it and cancel — two taps, because it's destructive.
  await page.getByRole("button", { name: /You/ }).first().click();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("desktop gets the themed calendar popover, and picking a day fills the field", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Book the airplane", exact: true }).click();

  // The custom picker only exists where there's a fine pointer — see
  // components/common/DateTimeField.tsx.
  await page.getByRole("button", { name: "Open calendar for Start" }).click();
  const calendar = page.getByRole("dialog", { name: "Start calendar picker" });
  await expect(calendar).toBeVisible();

  // Pick a day and a time from the popover rather than typing. Page forward a
  // month first: the field's `min` is today, so mid-month days are disabled
  // whenever the suite happens to run late in a month.
  const before = await page.getByLabel("Start", { exact: true }).inputValue();
  await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("button", { name: "15", exact: true }).click();
  await calendar.getByRole("button", { name: /10:00/ }).first().click();

  const after = await page.getByLabel("Start", { exact: true }).inputValue();
  expect(after).not.toBe(before);
  expect(after).toMatch(/-15T10:00$/);
  // Picking a time closes the popover.
  await expect(calendar).toBeHidden();
});

test("a double booking is rejected with a useful message", async ({ page }) => {
  // The seed puts a maintenance block on the airplane; book straight over it.
  const start = new Date();
  start.setDate(start.getDate() + 9);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;

  await page.getByRole("button", { name: "Book the airplane", exact: true }).click();
  await page.getByLabel("Start", { exact: true }).fill(local(start));
  await page.getByLabel("End", { exact: true }).fill(local(end));
  await page.getByRole("button", { name: "Book it" }).click();

  await expect(page.getByText(new RegExp(`already has ${TAIL_NUMBER}`))).toBeVisible();
});
