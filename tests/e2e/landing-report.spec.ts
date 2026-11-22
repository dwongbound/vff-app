// The club's landings by airport, month by month — what a landing-fee
// reimbursement claim is made from. A flight that lists where it landed is
// counted at those fields; the Flight log's Club view opens it from the
// Landings tile, a bar per airport, and exports it.
import { expect, test } from "@playwright/test";
import { clearOpenSessions, gotoTab, openPostflightSection, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // A POST with a session open FINISHES it rather than filing a new row.
  await clearOpenSessions(page);
});

test("a flight's listed airports land in this month's report", async ({ page }) => {
  const fleet = await page.request.get("/api/aircraft");
  const [aircraft] = (await fleet.json()) as { id: string; lastTach: number }[];

  const before = await page.request.get("/api/reports/landings?months=1");
  const countAt = (body: { months: { airports: { airport: string; landings: number }[] }[] }, code: string) =>
    body.months[0]?.airports.find((a) => a.airport === code)?.landings ?? 0;
  const beforeBody = await before.json();

  const res = await page.request.post("/api/flights", {
    data: {
      standalone: true,
      aircraftId: aircraft.id,
      flownOn: new Date().toISOString(),
      tachStart: aircraft.lastTach,
      tachEnd: Number((aircraft.lastTach + 1).toFixed(2)),
      // The count is taken off the list, whatever `landings` says.
      landings: 1,
      landingAirports: ["ktoa", "KWHP", "KTOA"],
    },
  });
  expect(res.ok()).toBe(true);
  const filed = (await res.json()) as {
    landings: number;
    arrival: string | null;
    landingAirports: string[];
  };
  expect(filed.landings).toBe(3);
  expect(filed.arrival).toBe("KTOA");
  expect(filed.landingAirports).toEqual(["KTOA", "KWHP", "KTOA"]);

  const after = await (await page.request.get("/api/reports/landings?months=1")).json();
  expect(countAt(after, "KWHP")).toBe(countAt(beforeBody, "KWHP") + 1);
  expect(countAt(after, "KTOA")).toBe(countAt(beforeBody, "KTOA") + 2);

  // On the page: the Club view's Landings tile opens the report, this month,
  // a line for KWHP.
  await gotoTab(page, "/log", "Flight log");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Club", exact: true }).click();
  await main.getByRole("button", { name: /^Landings \/ month/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Landings by airport" })).toBeVisible();
  const card = dialog.getByRole("list", { name: /^Landings in / });
  await expect(card).toBeVisible();
  await expect(card.getByText("KWHP", { exact: true })).toBeVisible();

  // Export hands over the spreadsheet for the claim.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/landings-by-airport.*\.xlsx$/);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("a listed airport that isn't one is refused, naming it", async ({ page }) => {
  const fleet = await page.request.get("/api/aircraft");
  const [aircraft] = (await fleet.json()) as { id: string; lastTach: number }[];
  const res = await page.request.post("/api/flights", {
    data: {
      standalone: true,
      aircraftId: aircraft.id,
      tachStart: aircraft.lastTach,
      tachEnd: Number((aircraft.lastTach + 0.5).toFixed(2)),
      landingAirports: ["KTOA", "practice area"],
    },
  });
  expect(res.status()).toBe(400);
  expect(((await res.json()) as { error: string }).error).toMatch(/PRACTICE/);
});

test("the post-flight form's Landed at line fills in Landings and To", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");
  const main = page.getByRole("main");
  await openPostflightSection(page, /The flight/);
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA, KSMO, KTOA");
  await expect(main.getByLabel("Landings", { exact: true })).toHaveValue("3");
  await expect(main.getByLabel("To", { exact: true })).toHaveValue("KTOA");
  await expect(main.getByText("3 landings · ends at KTOA")).toBeVisible();
});
