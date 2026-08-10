// Tools › Weight & Balance, from the rail to the verdict.
//
// The numbers asserted here are N8318B's real ones: empty weight 1353.48 lb at
// 38.72 in, off its 27 Nov 2021 Weight/Balance & Equipment List Revision, and
// the stations transcribed from the 1958 owner's manual. That's deliberate —
// the arithmetic is unit-tested in tests/unit/weightBalance.test.ts, so what
// these specs are for is proving the page is wired to the AIRPLANE'S OWN
// basis rather than to a plausible-looking default.
import { expect, test } from "@playwright/test";
import { TAIL_NUMBER, gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
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

  // Fuel starts full and oil starts empty — entering oil on top of a modern
  // basic empty weight would double-count 15 lb at the nose.
  await expect(page.getByLabel("Fuel", { exact: true })).toHaveValue("37");
  await expect(page.getByLabel("Engine oil", { exact: true })).toHaveValue("0");
});

test("a normal two-up load is within limits, at takeoff and on landing", async ({
  page,
}) => {
  await gotoTab(page, "/tools/weight-balance", "Weight & Balance");

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

  await page.getByLabel("Pilot", { exact: true }).fill("200");
  await page.getByLabel("Front passenger", { exact: true }).fill("200");
  await page.getByLabel("Rear left", { exact: true }).fill("180");
  await page.getByLabel("Rear right", { exact: true }).fill("180");

  await expect(page.getByText("Out of limits", { exact: true })).toBeVisible();
  await expect(page.getByText(/Over gross weight by/)).toBeVisible();
  // The spare-capacity figure flips to "Over by" rather than going negative.
  await expect(page.getByText("Over by")).toBeVisible();
});

test("Org settings holds the basis, and echoes back the arm as a check", async ({
  page,
}) => {
  await gotoTab(page, "/settings", "Org settings");

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
