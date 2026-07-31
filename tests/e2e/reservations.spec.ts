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

  await page.getByLabel("Start").fill(local(start));
  await page.getByLabel("End").fill(local(end));
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
  await page.getByLabel("Start").fill(local(start));
  await page.getByLabel("End").fill(local(end));
  await page.getByRole("button", { name: "Book it" }).click();

  await expect(page.getByText(new RegExp(`already has ${TAIL_NUMBER}`))).toBeVisible();
});
