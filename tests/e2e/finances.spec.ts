import { expect, test } from "@playwright/test";
import { clearOpenSessions, gotoTab, signIn } from "./helpers";

// The club's books, end to end.
//
// This is the one tab where a bug costs somebody money, and it was the only
// feature-sized page with no e2e coverage at all — the unit tests prove the
// arithmetic in lib/finance.ts, but nothing proved that reading a month
// materialises its dues, that an officer's one-off line reaches the member it
// names, or that voiding leaves the trail behind instead of deleting it.
//
// Cast (from prisma/seed.ts):
//   admin@vffclub.test  — club admin, holds every capability implicitly
//   robin@vffclub.test  — Finance Officer, the office that owns this tab
//   alex@vffclub.test   — plain member, sees only their own statement
//
// Assertions are scoped to <main>: the rail and the bottom pill both render
// their own "Finances" control, so an unscoped match is a strict-mode
// violation on a good day and a false pass on a bad one.

test("a member's statement materialises this month's dues on first read", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  // A plain member gets their own statement and no club view.
  await expect(main.getByRole("heading", { name: "Your charges" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Club", exact: true })).toBeHidden();

  // Nothing schedules dues — reading the month is what writes them, which is
  // why the club needs no cron. The seed backdates the $250 rule to the 1st of
  // the current month, so it must be on this statement.
  const row = main.getByRole("row").filter({ hasText: "Monthly membership" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Dues")).toBeVisible();
  await expect(row.getByText("$250.00")).toBeVisible();
});

test("reading the same month twice does not bill it twice", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await expect(
    main.getByRole("row").filter({ hasText: "Monthly membership" })
  ).toHaveCount(1);

  // The unique index on (memberId, recurringChargeId, period) is what makes
  // this idempotent; a second read must find the line, not add one.
  await page.reload();
  await expect(main.getByRole("heading", { name: "Your charges" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    main.getByRole("row").filter({ hasText: "Monthly membership" })
  ).toHaveCount(1);
});

test("a plain member cannot add charges", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: "One Off" })).toBeHidden();
  await expect(main.getByRole("button", { name: "Recurring" })).toBeHidden();

  // And not through the API either — the button being absent is a UI courtesy,
  // `finance:manage` is the actual rule.
  const res = await page.request.post("/api/finances/charges", {
    data: { memberId: "anyone", description: "Nice try", amountDollars: 10 },
  });
  expect(res.status()).toBe(403);
});

test("the Finance Officer charges a member, and it lands on their statement", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await main.getByRole("button", { name: "One Off" }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Charge a member")).toBeVisible();
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill("Headset replacement");
  await modal.getByLabel("Amount", { exact: true }).fill("42.50");
  await modal.getByRole("button", { name: "Add charge" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // The officer reads the club-wide view, so the line shows under its member.
  await main.getByRole("button", { name: "Club", exact: true }).click();
  const statement = main
    .locator("table")
    .filter({ hasText: "Headset replacement" });
  await expect(statement.getByText("$42.50")).toBeVisible({ timeout: 30_000 });

  // And the member sees it on their own statement, positive = they owe it.
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const mine = page.getByRole("main");
  const row = mine.getByRole("row").filter({ hasText: "Headset replacement" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("$42.50")).toBeVisible();
});

test("a credit is stored negative and reads as money owed back", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await main.getByRole("button", { name: "One Off" }).click();

  const modal = page.getByRole("dialog");
  // The direction toggle owns the sign — the amount field stays positive, so a
  // typo can't turn a refund into a charge.
  await modal.getByRole("button", { name: /^Credit/ }).click();
  await expect(modal.getByText("Credit a member")).toBeVisible();
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill("Fuel receipt — Tacoma");
  await modal.getByLabel("Amount", { exact: true }).fill("60.00");
  await modal.getByRole("button", { name: "Add credit" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const row = page
    .getByRole("main")
    .getByRole("row")
    .filter({ hasText: "Fuel receipt — Tacoma" });
  await expect(row.getByText("-$60.00")).toBeVisible({ timeout: 30_000 });
});

test("voiding a line strikes it through rather than deleting it", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await main.getByRole("button", { name: "One Off" }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill("Charged in error");
  await modal.getByLabel("Amount", { exact: true }).fill("15.00");
  await modal.getByRole("button", { name: "Add charge" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await main.getByRole("button", { name: "Club", exact: true }).click();
  const row = main.getByRole("row").filter({ hasText: "Charged in error" });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: "Void" }).click();

  // The line stays on the statement — the trail of what was charged and unwound
  // is the point, so a void is not a delete.
  await expect(row.getByText("voided")).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();

  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row.getByRole("button", { name: "Void" })).toBeVisible({
    timeout: 30_000,
  });
});

// A tach span no seeded flight comes near: the log is real club history, all of
// it short local hops, so a 7.3-hour entry can't collide with one of theirs and
// the amounts below are unambiguous in the UI.
const E2E_NOTE = "ledger e2e";
const HOURLY_CENTS = 13_500; // the seeded rate, $135.00/hr

test("filing a flight bills the tach hours and credits the fuel", async ({
  page,
}) => {
  await signIn(page);

  // Filed through the API rather than the post-flight form: this test is about
  // the ledger, and driving another page's whole UI to set up a precondition is
  // how a spec ends up failing for reasons that have nothing to do with it.
  // page.request shares the browser's cookies, so this is the signed-in admin.
  const aircraft = await page.request.get("/api/aircraft").then((r) => r.json());

  // Clear anything a previous attempt filed. Playwright retries this spec, and
  // without this each attempt would add another flight — and another pair of
  // ledger lines — to the same statement.
  const existing = await page.request
    .get("/api/flights?limit=500")
    .then((r) => r.json());
  for (const flight of existing) {
    if (flight.notes === E2E_NOTE) {
      await page.request.delete(`/api/flights/${flight.id}`);
    }
  }

  // An open session left by an earlier spec would be FINISHED by this POST
  // rather than a fresh row being filed — same numbers, different id, and a
  // test that reads as flaky. See clearOpenSessions.
  await clearOpenSessions(page);

  const filed = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft[0].id,
      tachStart: 2000,
      tachEnd: 2007.3, // 7.3 tach hr × $135.00 = $985.50
      landings: 1,
      fuelAddedGal: 20,
      fuelCostDollars: 88.4,
      notes: E2E_NOTE,
    },
  });
  expect(filed.ok()).toBeTruthy();
  const flightId = (await filed.json()).id;

  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");

  const hours = main.getByRole("row").filter({ hasText: "Flight time" });
  await expect(hours.getByText("$985.50")).toBeVisible({ timeout: 30_000 });

  // Fuel the pilot bought is money the club owes back, so it's stored negative.
  const fuel = main.getByRole("row").filter({ hasText: "Fuel credit" });
  await expect(fuel.getByText("-$88.40")).toBeVisible();

  /** This flight's own ledger lines, straight from the statement API. */
  async function chargesForFlight() {
    const statement = await page.request
      .get("/api/finances")
      .then((r) => r.json());
    return statement.statements
      .flatMap((s: { charges: unknown[] }) => s.charges)
      .filter((c: { flightId: string | null }) => c.flightId === flightId);
  }

  // Exactly one of each kind — the unique index on (flightId, kind) is what
  // guarantees it, and it's the reason correcting a flight can't double-bill.
  const lines = await chargesForFlight();
  expect(
    lines.map((c: { kind: string; amountCents: number }) => [
      c.kind,
      c.amountCents,
    ])
  ).toEqual(
    expect.arrayContaining([
      ["FLIGHT", Math.round(7.3 * HOURLY_CENTS)],
      ["FUEL_CREDIT", -8_840],
    ])
  );
  expect(lines).toHaveLength(2);

  // Correcting the flight REBUILDS its lines rather than adding a second pair.
  const patched = await page.request.patch(`/api/flights/${flightId}`, {
    data: { tachEnd: 2005.5 }, // now 5.5 hr = $742.50
  });
  expect(patched.ok()).toBeTruthy();

  const rebuilt = await chargesForFlight();
  expect(rebuilt).toHaveLength(2);
  expect(
    rebuilt.find((c: { kind: string }) => c.kind === "FLIGHT").amountCents
  ).toBe(Math.round(5.5 * HOURLY_CENTS));

  await page.reload();
  await expect(main.getByRole("heading", { name: "Your charges" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(hours.getByText("$742.50")).toBeVisible({ timeout: 30_000 });
  await expect(hours.getByText("$985.50")).toBeHidden();
});
