// The runway checkout — its own page and its own sign-off, so the thing worth
// covering is that it's genuinely separate from the preflight one: reachable
// on its own, gated on its own items, and not sharing progress with the walk.
import { expect, test } from "@playwright/test";
import { allItemIds } from "@/lib/checkouts";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the runway checkout gates its own sign-off", async ({ page }) => {
  await gotoTab(page, "/runway", "Runway");

  const signOff = page.getByRole("button", { name: "Sign off" });
  await expect(signOff).toBeDisabled();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();

  // The card's first section is Passengers, not the walkaround.
  await expect(page.getByText("Before anyone gets in")).toBeVisible();

  await page.getByRole("button", { name: "Check all" }).click();
  await expect(page.getByText(/^\d+ of \d+ checked$/)).toBeVisible();
  await expect(signOff).toBeDisabled();
});

test("the two checkouts keep their own progress", async ({ page }) => {
  // Tick the whole first section of the preflight checkout…
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: "Check all" }).click();
  const preflightCount = await page.getByText(/^\d+ of \d+ checked$/).innerText();

  // …then the runway page counts against its own, different denominator.
  // (Not "0 of N": "Preflight — complete" answers itself from the database,
  // so the runway card legitimately starts at 1 once the airplane has been
  // walked today — see the derived-row tests below.)
  await gotoTab(page, "/runway", "Runway");
  const runwayCount = await page.getByText(/^\d+ of \d+ checked$/).innerText();
  const denominator = (count: string) => count.split(" of ")[1];
  expect(denominator(runwayCount)).not.toBe(denominator(preflightCount));
});

// "Preflight — complete" is the one row on any card the pilot cannot answer.
// The app already knows whether the airplane was walked, so the row reports
// that fact — and refuses to be told otherwise.
test("the preflight row cannot be ticked without a signed-off preflight", async ({
  page,
}) => {
  await gotoTab(page, "/runway", "Runway");
  await page.getByRole("button", { name: /Before starting engine.*\d+\/\d+$/ }).click();

  const row = page.getByRole("button", { name: /^Preflight — complete/ });
  await expect(row).toBeDisabled();
  await expect(
    page.getByText(/No preflight (checkout has been )?signed off/).first()
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Walk the preflight/ })).toBeVisible();

  // Not even the section's own bulk tick gets around it: everything else in
  // the section goes green and this one stays red.
  const before = await page.getByText(/^\d+ of \d+ checked$/).innerText();
  await page.getByRole("button", { name: "Check all" }).click();
  const after = await page.getByText(/^\d+ of \d+ checked$/).innerText();
  expect(after).not.toBe(before);
  await expect(row).toHaveAttribute("aria-pressed", "false");
});

test("signing off the preflight ticks the row for you", async ({ page }) => {
  await gotoTab(page, "/runway", "Runway");

  // The precondition — a signed-off preflight — is established through the
  // API rather than by walking all ten sections in the UI. Walking the card is
  // preflight.spec's subject; this test's subject is the one row that reads
  // the result, and driving 80 ticks to get there makes it fail for reasons
  // that have nothing to do with what it checks.
  const [aircraft] = await (await page.request.get("/api/aircraft")).json();
  const answers = Object.fromEntries(allItemIds("PREFLIGHT").map((id) => [id, true]));
  const filed = await page.request.post("/api/checkouts", {
    data: { aircraftId: aircraft.id, kind: "PREFLIGHT", answers, complete: true },
  });
  expect(filed.ok()).toBeTruthy();

  // …and the runway card's first item is now answered, without being touched.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Runway", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Before starting engine.*\d+\/\d+$/ }).click();

  const row = page.getByRole("button", { name: /^Preflight — complete/ });
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeDisabled();
  await expect(page.getByText(/Signed off today by/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Walk the preflight/ })).toHaveCount(0);
});

test("the runway page says whether the airplane has been walked today", async ({
  page,
}) => {
  await gotoTab(page, "/runway", "Runway");
  await expect(
    page.getByText(/(No p|P)reflight checkout (signed off today|done today)/)
  ).toBeVisible();
});
