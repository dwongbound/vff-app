// The club's operating rules (VFF-OR-A) where a member meets them: their own
// limits on the preflight tab, the (i) explanations on every checklist step,
// and the full reference table on the flight log.
import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the preflight tab shows the limits that apply to this member", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await expect(page.getByText("Your limits today")).toBeVisible();
  // The seeded admin has no declared total time, so they're on the tighter
  // column: 2 hours of fuel reserve, 10 sm visibility.
  await expect(page.getByText("Building time (solo or PIC)")).toBeVisible();
  await expect(page.getByText("2 h", { exact: true })).toBeVisible();
  await expect(page.getByText("10 sm", { exact: true })).toBeVisible();

  // The airports needing a checkout, and the club's cancellation policy.
  await expect(page.getByText(/Catalina Island Airport \(KAVX\)/)).toBeVisible();
  await expect(page.getByText(/cancel with no penalty/)).toBeVisible();
});

test("declaring enough experience moves the member to the standard column", async ({
  page,
}) => {
  await gotoTab(page, "/profile", "Your profile");
  await page.getByLabel("Total flight time").fill("450");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });

  // Total time alone isn't enough — the rules also want 50 hours in the last
  // 12 months, and the seeded log doesn't have them.
  await gotoTab(page, "/preflight", "Preflight");
  await expect(page.getByText("Building time (solo or PIC)")).toBeVisible();
  await expect(page.getByText(/450.0 h total/)).toBeVisible();

  // Put it back so the rest of the suite sees the seeded state.
  await gotoTab(page, "/profile", "Your profile");
  await page.getByLabel("Total flight time").fill("");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });
});

test("every checklist step can explain itself", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");

  // I'M SAFE is the first section, open by default.
  const fatigue = page.getByRole("button", { name: "Why: Fatigue" });
  await expect(fatigue).toBeVisible();

  await fatigue.click();
  await expect(page.getByRole("tooltip")).toContainText(/Tired flying/);

  // Asking why must not tick the item off — that's the whole reason the (i)
  // isn't nested inside the row's button.
  await expect(page.getByText("0 of", { exact: false })).toBeVisible();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
});

test("the flight log carries the full rules table and landing currency", async ({
  page,
}) => {
  await gotoTab(page, "/log", "Flight log");

  await expect(page.getByText("Your landing currency")).toBeVisible();
  await expect(page.getByText(/Day: \d+\/3 landings/)).toBeVisible();
  await expect(page.getByText(/Night: \d+\/3 full-stop/)).toBeVisible();

  // The reference table is collapsed until asked for.
  await expect(page.getByText("Maximum offshore distance")).toBeHidden();
  await page.getByRole("button", { name: /Operating rules/ }).click();
  await expect(page.getByText("Maximum offshore distance").first()).toBeVisible();
  await expect(page.getByText(/10 sm \(unless on a flight plan/).first()).toBeVisible();
});
