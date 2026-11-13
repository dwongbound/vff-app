// The flight log shows BOTH meters: tach hours (what the club bills on) and
// Hobbs hours (the elapsed time a pilot logs), on every row and on the hours
// tile at the top.
//
// The flight is filed by hand (`standalone`, dated long ago) WITHOUT Hobbs and
// the Hobbs readings are added by PATCH, because only a POST moves the
// airplane's meters: seeded N8318B has no `lastHobbs`, and filing one here
// would become every later spec's Hobbs prefill. The tach span sits below the
// airplane's current reading for the same reason. The row is deleted after.
import { expect, test } from "@playwright/test";
import { clearOpenSessions, gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearOpenSessions(page);
});

test("each log row shows tach and Hobbs hours, and the tile totals both", async ({
  page,
}) => {
  const fleet = await page.request.get("/api/aircraft");
  const [aircraft] = (await fleet.json()) as { id: string }[];
  const filed = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft.id,
      standalone: true,
      flownOn: new Date(new Date().getFullYear(), 0, 2, 12).toISOString(),
      tachStart: 1300,
      tachEnd: 1301.2,
      landings: 2,
      departure: "KTOA",
      arrival: "KTOA",
    },
  });
  expect(filed.ok()).toBe(true);
  const { id } = (await filed.json()) as { id: string };
  const patched = await page.request.patch(`/api/flights/${id}`, {
    data: { hobbsStart: 1300.5, hobbsEnd: 1302.2 },
  });
  expect(patched.ok()).toBe(true);

  try {
    await gotoTab(page, "/log", "Flight log");
    const main = page.getByRole("main");

    // The row carries both figures, each named, and landings moved into the
    // subline beside the weekday.
    const row = main
      .getByRole("button")
      .filter({ hasText: /1\.2\s*tach/ })
      .filter({ hasText: /1\.7\s*Hobbs/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("2 landings");

    // Hobbs is the headline, tach under it — on the row and on the tile
    // (Mine opens on "Hours this year").
    const figures = await row.locator(".tabular").allTextContents();
    expect(figures.slice(-2)).toEqual(["1.7Hobbs", "1.2tach"]);
    const tile = main.getByText("Hours this year", { exact: true }).locator("..");
    await expect(tile).toContainText(/\d+\.\d\s*Hobbs\s*\d+\.\d tach/);

    // The entry's own title leads with Hobbs too.
    await row.click();
    await expect(page.getByRole("dialog")).toContainText("1.7 hours");
  } finally {
    await page.request.delete(`/api/flights/${id}`);
  }
});
