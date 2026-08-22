// Correcting a flight-log entry from the detail modal.
//
// The point of the feature is that a correction is made while LOOKING at the
// thing that's wrong, so the test drives it the same way: open an entry, press
// Edit, change a number, press Save, and check the club's record moved — both
// on screen and in the books, because a corrected tach re-bills the flight.
import { expect, test } from "@playwright/test";
import { clearOpenSessions, gotoTab, signIn } from "./helpers";

/** File a flight of our own to correct, and hand back its id. */
async function seedFlight(page: import("@playwright/test").Page) {
  const fleet = await page.request.get("/api/aircraft");
  const [aircraft] = (await fleet.json()) as { id: string; lastTach: number }[];
  const tachStart = aircraft.lastTach;
  const res = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft.id,
      flownOn: new Date().toISOString(),
      tachStart,
      tachEnd: Number((tachStart + 1).toFixed(2)),
      landings: 1,
      departure: "KTOA",
      arrival: "KTOA",
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string; tachStart: number; tachEnd: number };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // An earlier spec's preflight walk leaves an open session, and POSTing a
  // flight would FINISH that one rather than file a new row. See the helper.
  await clearOpenSessions(page);
});

test("a member can correct their own entry, and the log says it was edited", async ({
  page,
}) => {
  const flight = await seedFlight(page);

  await gotoTab(page, "/log", "Flight log");
  // The newest entry is ours — the log opens on Mine and sorts newest first.
  await page.getByRole("main").getByRole("button").filter({ hasText: "KTOA" }).first().click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText("never edited")).toBeVisible();

  await modal.getByRole("button", { name: "Edit" }).click();

  // Every field is live now, and Edit has become Save.
  const landings = modal.getByLabel("Landings", { exact: true });
  await expect(landings).toBeVisible();
  await landings.fill("3");
  await expect(modal.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await modal.getByRole("button", { name: "Save" }).click();

  // Back to the record, showing the correction and stamped as edited. The
  // stamp is what an instructor's signature gets compared against, so it
  // matters that saving sets it.
  await expect(modal.getByText("last edited")).toBeVisible({ timeout: 60_000 });
  await expect(modal.getByText("Landings")).toBeVisible();

  const after = await page.request.get(`/api/flights/${flight.id}`);
  expect(((await after.json()) as { landings: number }).landings).toBe(3);

  await page.request.delete(`/api/flights/${flight.id}`);
});

test("cancelling an edit changes nothing", async ({ page }) => {
  const flight = await seedFlight(page);

  await gotoTab(page, "/log", "Flight log");
  await page.getByRole("main").getByRole("button").filter({ hasText: "KTOA" }).first().click();

  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Edit" }).click();
  await modal.getByLabel("Landings", { exact: true }).fill("9");
  await modal.getByRole("button", { name: "Cancel" }).click();

  // Straight back to the record, and the entry was never touched.
  await expect(modal.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(modal.getByText("never edited")).toBeVisible();

  const after = await page.request.get(`/api/flights/${flight.id}`);
  expect(((await after.json()) as { landings: number }).landings).toBe(1);

  await page.request.delete(`/api/flights/${flight.id}`);
});

test("the estimated cost explains its own arithmetic", async ({ page }) => {
  const flight = await seedFlight(page);

  await gotoTab(page, "/log", "Flight log");
  await page.getByRole("main").getByRole("button").filter({ hasText: "KTOA" }).first().click();

  const modal = page.getByRole("dialog");
  // The (i) beside Est. cost. It exists because the heading rounds to a tenth
  // while the bill is computed on the hundredth, so a member checking the
  // multiplication finds a figure that looks wrong until they read this.
  await modal.getByRole("button", { name: /How Est\. cost is worked out/i }).click();
  await expect(page.getByText(/tach hr ×/)).toBeVisible();
  await expect(page.getByText("Total")).toBeVisible();

  await page.request.delete(`/api/flights/${flight.id}`);
});
