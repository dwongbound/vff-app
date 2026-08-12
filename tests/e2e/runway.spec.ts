// The runway checkout — its own page and its own sign-off, so the thing worth
// covering is that it's genuinely separate from the preflight one: reachable
// on its own, gated on its own items, and not sharing progress with the walk.
import { expect, test } from "@playwright/test";
import { allItemIds } from "@/lib/checkouts";
import { clearCheckoutDrafts, gotoTab, signIn } from "./helpers";

/** The sticky bar's overall line — "Step 3 of 7 · 12 of 41 checked". */
const STEP_LINE = /^Step \d+ of \d+ · \d+ of \d+ checked$/;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // The cards autosave, so without this each spec inherits the last one's
  // half-ticked walk. See the helper.
  await clearCheckoutDrafts(page);
});

test("the runway checkout asks before filing a partial card", async ({ page }) => {
  await gotoTab(page, "/runway", "Runway");

  // `exact`: the card's own "Preflight — complete" row is a button too, and
  // Playwright matches accessible names by SUBSTRING unless told otherwise.
  const complete = page.getByRole("button", { name: "Complete", exact: true });
  await expect(complete).toBeEnabled();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();

  // The card's first section is Passengers, not the walkaround.
  await expect(page.getByText("Before anyone gets in")).toBeVisible();

  await page.getByRole("button", { name: "Check all" }).click();
  await expect(page.getByText(STEP_LINE)).toBeVisible();

  // Still incomplete → the confirm modal, not a filed run.
  await complete.click();
  await expect(page.getByRole("dialog").getByText(/aren't ticked/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Keep checking" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

// "Preflight — complete" is answered by the app, so it's already ticked before
// anyone touches this page. That must not count as work: autosaving there would
// create a draft — and a server row — for a member who has done nothing but
// open a tab.
test("merely opening the runway card saves nothing", async ({ page }) => {
  await gotoTab(page, "/runway", "Runway");

  await expect(page.getByRole("main").getByText(/progress saves automatically/i)).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Reset" })).toHaveCount(0);

  // Give any debounce a chance to fire before checking the server stayed clean.
  await page.waitForTimeout(5_000);
  const open = await page.request.get("/api/checkouts?mine=1&open=1&kind=RUNWAY&limit=10");
  expect(await open.json()).toEqual([]);
});

test("the two checkouts keep their own progress", async ({ page }) => {
  // Tick the whole first section of the preflight checkout…
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: "Check all" }).click();
  const preflightCount = await page.getByText(STEP_LINE).innerText();

  // …then the runway page counts against its own, different denominator.
  // (Not "0 of N": "Preflight — complete" answers itself from the database,
  // so the runway card legitimately starts at 1 once the airplane has been
  // walked today — see the derived-row tests below.)
  await gotoTab(page, "/runway", "Runway");
  const runwayCount = await page.getByText(STEP_LINE).innerText();
  const denominator = (count: string) => count.split(" of ")[2];
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
    page.getByText(/No preflight (checkout has been )?completed/).first()
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Walk the preflight/ })).toBeVisible();

  // Not even the section's own bulk tick gets around it: everything else in
  // the section goes green and this one stays red.
  const before = await page.getByText(STEP_LINE).innerText();
  await page.getByRole("button", { name: "Check all" }).click();
  const after = await page.getByText(STEP_LINE).innerText();
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
  await expect(page.getByText(/Completed today by/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Walk the preflight/ })).toHaveCount(0);
});

// The banner this used to assert on ("Preflight checkout done today …") is
// gone: it said the same thing as the card's own "Preflight — complete" row a
// few inches below it, and the row is the copy that can't be scrolled past.
// The two tests above cover both halves of that row, satisfied and not.


// The server's half of "Complete" — the UI asks in a modal, and this is what
// the answer travels as. Last in the file on purpose: it files a completed
// runway run, and the tests above are about a day with none.
test("an incomplete card is filed only when the member confirms it", async ({
  page,
}) => {
  await gotoTab(page, "/runway", "Runway");
  const [aircraft] = await (await page.request.get("/api/aircraft")).json();

  // Nothing ticked and no acknowledgement: refused, so a stale client can't
  // file a half-walked card as done by accident.
  const refused = await page.request.post("/api/checkouts", {
    data: { aircraftId: aircraft.id, kind: "RUNWAY", answers: {}, complete: true },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toMatch(/has to be confirmed/i);

  // With it: filed as it stands. The answers column records what was left, so
  // "completed" still doesn't claim the items were ticked.
  const filed = await page.request.post("/api/checkouts", {
    data: {
      aircraftId: aircraft.id,
      kind: "RUNWAY",
      answers: {},
      complete: true,
      acknowledgeIncomplete: true,
    },
  });
  expect(filed.ok()).toBeTruthy();
  const run = await filed.json();
  expect(run.completedAt).toBeTruthy();
  expect(run.answers).toEqual({});
});
