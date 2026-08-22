// Tools › Weight & Balance, from the rail to the verdict.
//
// The numbers asserted here are N8318B's real ones: empty weight 1353.48 lb at
// 38.72 in, off its 27 Nov 2021 Weight/Balance & Equipment List Revision, and
// the stations transcribed from the 1958 owner's manual. That's deliberate —
// the arithmetic is unit-tested in tests/unit/weightBalance.test.ts, so what
// these specs are for is proving the page is wired to the AIRPLANE'S OWN
// basis rather than to a plausible-looking default.
import { expect, test } from "@playwright/test";
import {
  TAIL_NUMBER,
  clearCheckoutDrafts,
  gotoTab,
  signIn,
  waitForCheckoutSaved,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // This page now READS the preflight draft (see the fuel test at the foot of
  // the file), so a half-walked card left behind by another spec would decide
  // what the fuel box opens at here.
  await clearCheckoutDrafts(page);
});

test("the rail's Tools group opens onto Weight & Balance", async ({ page }) => {
  // The group starts collapsed — it isn't the page you're on — so this also
  // checks that the sub-list expands rather than only that the route exists.
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("link", { name: "Weight & Balance" }).click();

  await expect(
    page.getByRole("heading", { name: "Weight & Balance", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`${TAIL_NUMBER} — Cessna 172`)).toBeVisible();
});

test("it starts from the airplane's own weighing, not a default", async ({ page }) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

  // Straight off the signed sheet: 1353.48 lb, arm 38.72, useful load 846.51.
  await expect(page.getByText("1,353.5 lb at 38.72 in")).toBeVisible();
  await expect(page.getByText("846.5 lb")).toBeVisible();
  await expect(page.getByText("2,200 lb (normal category)")).toBeVisible();
  await expect(page.getByText("35 to 45.5 in aft of datum")).toBeVisible();
  // A basis with no date is how a superseded one goes unnoticed, so the date
  // is on the page next to the result.
  await expect(page.getByText("November 27, 2021")).toBeVisible();

  // Fuel opens at what the airplane was last DIPPED to, not at "full": the
  // seeded preflight recorded a part-full airplane, and a form that opened at
  // 37 would plan a flight 100 lb heavy unless somebody remembered to correct
  // it. The reading is attributed on the page, because it's a measurement.
  const fuel = page.getByLabel("Fuel", { exact: true });
  await expect(fuel).not.toHaveValue("");
  await expect(fuel).not.toHaveValue("37");
  await expect(page.getByText(/gal from .*preflight/)).toBeVisible();

  // Oil still starts EMPTY, and the recorded dipstick reading is shown beside
  // the box rather than typed into it: this airframe's basis is a modern basic
  // empty weight that already includes its oil, so entering it again would
  // double-count 15 lb at the furthest forward station on the airplane.
  await expect(page.getByLabel("Engine oil", { exact: true })).toHaveValue("0");
  await expect(page.getByText(/qt on the dipstick/)).toBeVisible();
});

test("a normal two-up load is within limits, at takeoff and on landing", async ({
  page,
}) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

  // Full tanks, stated rather than assumed: the box now opens at whatever the
  // last preflight dipped, so a test about the arithmetic has to fix it.
  await page.getByLabel("Fuel", { exact: true }).fill("37");
  await page.getByLabel("Pilot", { exact: true }).fill("170");
  await page.getByLabel("Front passenger", { exact: true }).fill("150");
  await page.getByLabel("Baggage", { exact: true }).fill("20");

  // 1353.48 + 170 + 150 + 20 + 222 = 1915.48 lb; moment 76,482.81 → CG 39.93.
  // `exact` on the badge: "within limits" also appears mid-sentence in the
  // landing line below, and that sentence is a different claim.
  await expect(page.getByText("Within limits", { exact: true })).toBeVisible();
  // The totals show up twice — once as the headline figure, once at the foot
  // of the working — which is the point of showing the working.
  await expect(page.getByText("1,915.5").first()).toBeVisible();
  await expect(page.getByText("39.93", { exact: true }).first()).toBeVisible();
  // Gross minus that: what's left to play with.
  await expect(page.getByText("284.5").first()).toBeVisible();
  await expect(page.getByText(/also within limits/)).toBeVisible();

  // The working is shown, not just the verdict: the fuel line is the one that
  // proves gallons were converted (37 gal → 222.0 lb at arm 48).
  await expect(page.getByText("(37 gal)")).toBeVisible();
  await expect(page.getByText("222.0")).toBeVisible();
});

test("it answers how much more each station will take", async ({ page }) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

  // Full tanks, stated rather than assumed: the box now opens at whatever the
  // last preflight dipped, so a test about the arithmetic has to fix it.
  await page.getByLabel("Fuel", { exact: true }).fill("37");
  await page.getByLabel("Pilot", { exact: true }).fill("170");
  await page.getByLabel("Front passenger", { exact: true }).fill("150");
  await page.getByLabel("Baggage", { exact: true }).fill("20");

  // The front seat is at 36 in, inside both CG limits, so only gross can stop
  // it — 2200 − 1915.48. Four stations share that answer at this load (both
  // front seats, and both rear ones where gross bites before the aft limit),
  // so the assertion is on the row rather than on the number alone.
  // Anchored regex, not a bare string: Playwright's `hasText` matches
  // substrings case-insensitively, and "baggage" also appears in the
  // utility-category note further down the page.
  const roomFor = (station: RegExp) =>
    page.getByRole("listitem").filter({ hasText: station });
  await expect(roomFor(/^Front passenger/)).toContainText("+284.5 lb");
  await expect(roomFor(/^Front passenger/)).toContainText("gross weight");

  // Baggage has 100 lb of its 120 lb placard left, and here the placard is
  // what binds before the CG does.
  await expect(roomFor(/^Baggage/)).toContainText("+100.0 lb");
  await expect(roomFor(/^Baggage/)).toContainText("the station's own limit");
});

test("it catches the load that is legal on the scales but too far aft", async ({
  page,
}) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

  // Two big people in the back, a light pilot, bags behind them: 2165 lb, so
  // under gross — and a CG of 46.85 in, well aft of the limit. This is exactly
  // the load a "does it weigh too much" check waves straight through.
  await page.getByLabel("Fuel", { exact: true }).fill("37");
  await page.getByLabel("Pilot", { exact: true }).fill("130");
  await page.getByLabel("Rear left", { exact: true }).fill("200");
  await page.getByLabel("Rear right", { exact: true }).fill("200");
  await page.getByLabel("Baggage", { exact: true }).fill("60");

  await expect(page.getByText("Out of limits", { exact: true })).toBeVisible();
  await expect(page.getByText(/aft of the 45.5 in limit/)).toBeVisible();
  await expect(page.getByText(/Move weight forward/)).toBeVisible();

  // Nothing more fits anywhere while it's out of limits.
  await expect(page.getByText("+0.0 lb").first()).toBeVisible();

  // And taking the bags out of the back fixes it.
  await page.getByLabel("Baggage", { exact: true }).fill("0");
  await page.getByLabel("Rear right", { exact: true }).fill("0");
  await expect(page.getByText("Within limits", { exact: true })).toBeVisible();
});

test("it catches an over-gross load", async ({ page }) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

  await page.getByLabel("Fuel", { exact: true }).fill("37");
  await page.getByLabel("Pilot", { exact: true }).fill("200");
  await page.getByLabel("Front passenger", { exact: true }).fill("200");
  await page.getByLabel("Rear left", { exact: true }).fill("180");
  await page.getByLabel("Rear right", { exact: true }).fill("180");

  await expect(page.getByText("Out of limits", { exact: true })).toBeVisible();
  await expect(page.getByText(/Over gross weight by/)).toBeVisible();
  // The spare-capacity figure flips to "Over by" rather than going negative.
  await expect(page.getByText("Over by")).toBeVisible();
});

// The dip in your pocket beats the dip on file. The sequence this exists for is
// somebody dipping both wings, tapping the card's own link through to here to
// see whether the load fits, and being shown last week's fuel — a number they'd
// have to NOTICE was wrong before it planned them a flight at the wrong weight.
test("the fuel box takes a dip that hasn't been filed over the last one that was", async ({
  page,
}) => {
  // What the last FILED preflight leaves in the box, for contrast.
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");
  const fuel = page.getByLabel("Fuel", { exact: true });
  const filed = await fuel.inputValue();
  await expect(page.getByText(/gal from .+preflight,/)).toBeVisible();

  // Dip both wings on the card and walk away without signing it off. Recording
  // a reading ticks the item it sits on, which is what starts the autosave.
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /Consumables.*\d+\/\d+$/ }).click();
  await main.getByLabel(/^Left wing/).fill("9");
  await main.getByLabel(/^Right wing/).fill("8.5");
  await waitForCheckoutSaved(page);

  // Then take the SERVER's copy of that walk away, so the only place the dip
  // still exists is this device. Without this the assertions below would pass
  // on a page that had simply refetched an open run from /api/checkouts, and
  // the thing being tested — that the device is allowed to be AHEAD of the
  // club, which is what lib/checkoutDraft.ts is for — would go unchecked.
  const open = await page.request.get("/api/checkouts?mine=1&open=1&limit=100");
  for (const run of (await open.json()) as { id: string }[]) {
    await page.request.delete(`/api/checkouts/${run.id}`);
  }

  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");
  // 9 + 8.5, summed the same way the Status tab's fuel meter sums them.
  expect(filed).not.toBe("17.5");
  await expect(fuel).toHaveValue("17.5");

  // And it says WHICH reading it is. The whole risk of a prefilled number is
  // not knowing how old it is, so an unfiled one has to name itself.
  await expect(page.getByText(/preflight in progress/)).toBeVisible();
  await expect(page.getByText(/not filed yet/)).toBeVisible();

  // Put the device back as it was: this draft would otherwise decide what the
  // next spec's fuel box opens at.
  await clearCheckoutDrafts(page);
});

test("Club settings holds the basis, and echoes back the arm as a check", async ({
  page,
}) => {
  await gotoTab(page, "/settings", "Club settings");

  await expect(page.getByLabel("Empty weight")).toHaveValue("1353.48");
  await expect(page.getByLabel("Empty moment")).toHaveValue("52406.81");
  await expect(page.getByLabel("Type profile")).toHaveValue("c172-1958");
  // The sheet prints an arm of 38.7200476; if a digit went in wrong, this is
  // where it shows up.
  await expect(page.getByText(/arm of 38.72 in/)).toBeVisible();

  // A save round-trip has to keep the W&B fields — they ride along with every
  // other aircraft edit, so dropping them would silently blank the tool.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });

  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");
  await expect(page.getByText("1,353.5 lb at 38.72 in")).toBeVisible();
});
