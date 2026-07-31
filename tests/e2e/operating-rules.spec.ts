// The club's operating rules (VFF-OR-A) where a member meets them: the
// solo-or-instructor verdict on the preflight tab, the (i) explanations on
// every checklist step, and the full reference table on the flight log.
import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the preflight tab answers solo-or-instructor, with the matching minimums", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await expect(page.getByText("Can you fly today?")).toBeVisible();
  // The verdict is one of exactly two answers — which one depends on what the
  // log holds at this point in the run, so assert the shape, then drive a
  // deterministic one below.
  await expect(
    page.getByText(
      /(Cleared to fly solo or as PIC by day\.|You need an approved flight instructor)/
    )
  ).toBeVisible();

  // The seeded admin has no declared total time, so the tighter column applies:
  // 2 hours of fuel reserve, 10 sm visibility.
  await expect(page.getByText("Building time (solo or PIC)")).toBeVisible();
  await expect(page.getByText("2 h", { exact: true })).toBeVisible();
  await expect(page.getByText("10 sm", { exact: true })).toBeVisible();

  await expect(page.getByText(/Catalina Island Airport \(KAVX\)/)).toBeVisible();
  await expect(page.getByText(/cancel with no penalty/)).toBeVisible();
});

test("three landings today clears the member for solo", async ({ page }) => {
  // File a flight with the three landings the rules ask for. Dated today, it
  // satisfies both the 30- and 90-day windows whatever else is in the log.
  await gotoTab(page, "/postflight", "Post-flight");
  const tachStart = await page.getByLabel("Tach start").inputValue();
  await page.getByLabel("Tach end").fill((Number(tachStart) + 0.9).toFixed(1));
  await page.getByLabel("Landings", { exact: true }).fill("3");
  await page.getByRole("button", { name: "File this flight" }).click();
  await expect(page.getByText(/Filed 0.9 hours/)).toBeVisible({ timeout: 60_000 });

  await gotoTab(page, "/preflight", "Preflight");
  await expect(page.getByText("Cleared to fly solo or as PIC by day.")).toBeVisible();

  // Night is answered separately, and those landings weren't full-stop night
  // ones — so it still points at an instructor.
  await expect(page.getByText(/Night: instructor required/)).toBeVisible();
});

test("the flight log states the same verdict next to the counts", async ({ page }) => {
  await gotoTab(page, "/log", "Flight log");

  await expect(page.getByText("Your landing currency")).toBeVisible();
  await expect(page.getByText(/Day: \d+\/3 landings/)).toBeVisible();
  await expect(page.getByText(/Night: \d+\/3 full-stop/)).toBeVisible();
  await expect(
    page.getByText(
      /(You're current to fly solo or as PIC by day\.|Not current for solo by day)/
    )
  ).toBeVisible();
});

test("every checklist step can explain itself", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");

  // I'M SAFE is the first section, open by default.
  const fatigue = page.getByRole("button", { name: "Why: Fatigue" });
  await expect(fatigue).toBeVisible();

  await fatigue.click();
  await expect(page.getByRole("tooltip")).toContainText(/Tired flying/);

  // Asking why must not tick the item off — that's the whole reason the (i)
  // isn't nested inside the row's button. (Anchored on "checked" because the
  // verdict card also says "0 of 3 full-stop night landings".)
  await expect(page.getByText(/^0 of \d+ checked$/)).toBeVisible();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
});

test("the flight log carries the full rules table", async ({ page }) => {
  await gotoTab(page, "/log", "Flight log");

  // The reference table is collapsed until asked for.
  await expect(page.getByText("Maximum offshore distance")).toBeHidden();
  await page.getByRole("button", { name: /Operating rules/ }).click();
  await expect(page.getByText("Maximum offshore distance").first()).toBeVisible();
  await expect(page.getByText(/10 sm \(unless on a flight plan/).first()).toBeVisible();
});
