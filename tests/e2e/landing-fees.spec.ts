// Landing fees, end to end: the box that fills itself in, and the statement
// line it becomes.
//
// The unit tests (tests/unit/landingFees.test.ts) already pin the arithmetic
// and the wire format. What they cannot check is the thing this feature
// actually is: a number that appears in a form because of what you typed in a
// DIFFERENT field, survives the trip through the API, and lands on somebody's
// bill. Each of those hops is where it would break.
import { expect, test } from "@playwright/test";
import {
  clearCheckoutDrafts,
  gotoTab,
  openPostflightSection,
  signIn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // The post-flight form autosaves, so a previous spec's half-filled entry
  // would otherwise arrive with its own landing fee already in the box.
  await clearCheckoutDrafts(page);
});

test("the fee fills itself in from where you landed, and clears again", async ({
  page,
}) => {
  await gotoTab(page, "/postflight", "Post-flight");
  // Route and fee live in "The flight", which is collapsed until it's opened —
  // the page is one accordion across the turn-off card and the form.
  await openPostflightSection(page, /The flight/);
  const main = page.getByRole("main");
  const fee = main.getByLabel("Landing fee");

  // Nothing typed yet: no destination, so no fee to prefill.
  await expect(fee).toHaveValue("");

  // The club's home field charges $6, and the box says so without being asked.
  await main.getByLabel("To", { exact: true }).fill("KTOA");
  await expect(fee).toHaveValue("6.00");

  // Retyping the destination has to CLEAR it, not leave the home field's fee
  // sitting there to be billed for a trip that ended somewhere else. This is
  // the half that would silently overcharge if it regressed.
  await main.getByLabel("To", { exact: true }).fill("KCMA");
  await expect(fee).toHaveValue("");

  // Lower case is what a phone keyboard actually produces.
  await main.getByLabel("To", { exact: true }).fill("ktoa");
  await expect(fee).toHaveValue("6.00");
});

test("a fee the pilot types over is the one that gets billed", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");
  await openPostflightSection(page, /The flight/);
  const main = page.getByRole("main");

  await main.getByLabel("To", { exact: true }).fill("KTOA");
  const fee = main.getByLabel("Landing fee");
  await expect(fee).toHaveValue("6.00");

  // The desk charged something else. Once the member has typed here, the box
  // stops following the airport — otherwise editing the route afterwards would
  // quietly throw their correction away.
  await fee.fill("12.50");
  await main.getByLabel("To", { exact: true }).fill("KTOA");
  await expect(fee).toHaveValue("12.50");
});

test("the fee reaches the statement as its own line", async ({ page }) => {
  // Filed through the API rather than by driving the whole post-flight form:
  // `page.request` shares the browser's cookies, and what this test is about is
  // the fee's trip to the books, not the form (covered above).
  const fleet = await page.request.get("/api/aircraft");
  const [aircraft] = (await fleet.json()) as { id: string; lastTach: number }[];
  const tachStart = aircraft.lastTach;

  const filed = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft.id,
      flownOn: new Date().toISOString(),
      tachStart,
      tachEnd: Number((tachStart + 1).toFixed(2)),
      // Eight landings, ONE fee. A pattern session is one visit to one desk,
      // and a change that multiplied the fee by the landings count would bill
      // this member $48 — this is the assertion that catches it.
      landings: 8,
      departure: "KTOA",
      arrival: "KTOA",
      landingFeeDollars: 6,
    },
  });
  expect(filed.ok()).toBe(true);
  const flight = (await filed.json()) as { id: string; landingFeeCents: number };
  expect(flight.landingFeeCents).toBe(600);

  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");
  const line = main.getByText("Landing fee — KTOA").first();
  await expect(line).toBeVisible({ timeout: 60_000 });
  await expect(main.getByText("$6.00").first()).toBeVisible();

  // Clean up after ourselves: this suite shares one database, and a stray
  // flight moves the airplane's tach for every spec that runs after it.
  await page.request.delete(`/api/flights/${flight.id}`);
});
