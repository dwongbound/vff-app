// Tablet-width pass. An iPad gets the DESKTOP layout — the nav rail, the month
// grid, the top bar — not the phone's bottom pill.
//
// It has its own project because "desktop" is a range, not a width, and the
// narrowest iPad (768px) is where that range starts. The rail costs a fixed
// 15rem, so this is the width at which the content column is thinnest and a
// page is likeliest to overflow or collide with the rail. Desktop Chrome at
// 1280 would never catch it.
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("an iPad navigates by the rail, not a bottom pill", async ({ page }) => {
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.getByRole("link", { name: "Flight Log" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reservations" })).toBeVisible();

  // The phone pill and its short labels never render at this width.
  await expect(page.getByRole("link", { name: "Reserve" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Checks" })).toBeHidden();
});

test("the pages are the wide ones", async ({ page }) => {
  // The month grid, not the phone's reservation list.
  await expect(page.getByText("Sun", { exact: true })).toBeVisible();
  // The real button rather than the phone's floating "+".
  await expect(
    page.getByRole("button", { name: "New", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New reservation" })
  ).toBeHidden();
});

test("the top bar carries the club, the tour and the settings", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replay the guided tour" })
  ).toBeVisible();
});

test("the rail expands only the group you're in", async ({ page }) => {
  // Landed on Reservations, so both groups start collapsed — the rail shows
  // where you can go, not every page in the app.
  await expect(page.getByRole("link", { name: "Preflight" })).toBeHidden();

  await page.getByRole("button", { name: "Checkouts" }).click();
  await page.getByRole("link", { name: "Preflight" }).click();
  await expect(
    page.getByRole("heading", { name: "Preflight", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // Now that Preflight IS the page, its group stays open on its own and the
  // other group stays shut.
  await expect(page.getByRole("link", { name: "Taxi & Runway" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Squawks" })).toBeHidden();
});

test("the content column clears the rail", async ({ page }) => {
  // The tightest width the desktop layout ever runs at: nothing in the page
  // may sit underneath the fixed rail.
  const rail = await page.locator("aside").boundingBox();
  const heading = await page
    .getByRole("heading", { name: "Reservations", exact: true })
    .boundingBox();
  expect(rail).not.toBeNull();
  expect(heading).not.toBeNull();
  expect(heading!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width);
});

test("double-tap zoom is off on a tablet too, pinch-zoom kept", async ({ page }) => {
  for (const selector of ["html", "#app-scroll", "main"]) {
    const value = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(value, selector).toBe("manipulation");
  }
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport ?? "").not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/);
});

test("Finances keeps its table on a tablet, with the + panel above it", async ({ page }) => {
  await page.goto("/finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(main.getByRole("table").first()).toBeVisible();
  await expect(main.getByRole("button", { name: "Add money", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById("app-scroll")!;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
