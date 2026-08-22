// One flight, one log entry — from the preflight card to the post-flight form.
//
// NAMED TO SORT AFTER `runway.spec.ts`, and that is load-bearing rather than
// cosmetic. Playwright runs the suite serially against ONE database, in
// filename order. This file signs off a preflight card, and a sign-off is
// permanent by design — `DELETE /api/checkouts/[id]` refuses a completed run,
// because it is the airplane's record of what was walked and by whom — so
// there is no cleanup that can undo it. Meanwhile `runway.spec.ts` has a test
// whose whole subject is what the runway card says when the airplane has NOT
// been walked today, and the page asks that question of the AIRPLANE
// (`?kind=PREFLIGHT`, no `mine=1`): any member's walk counts, so running this
// file as a different pilot doesn't help either. The two are simply
// incompatible on a shared database unless this one goes second.
// Anything else that completes a preflight belongs after `runway.spec.ts` too.
//
// The behaviour under test is that a checkout WRITES TO THE FLIGHT LOG. Signing
// off the preflight opens the log entry with the meters that walk read; the
// runway card joins the same entry; the post-flight form finishes it. What
// must never happen is three records of one flight, or two.
//
// Driven through the API for the walking of the cards and through the UI for
// the parts a member actually reads, which is the split runway.spec.ts already
// uses: `page.request` shares the browser's cookies, so a signed-off checkout
// is one call rather than forty clicks, and the clicks are spent on the screens
// this feature changed.
import { expect, test, type Page } from "@playwright/test";
import {
  clearCheckoutDrafts,
  clearOpenSessions,
  gotoTab,
  openMeters,
  signIn,
} from "./helpers";

/**
 * Flown by Sam, an ordinary flying member, rather than by the admin every other
 * spec signs in as.
 *
 * Not for isolation — the file-order note above is what keeps this spec out of
 * `runway.spec.ts`'s way, and no choice of member would have. It's for
 * COVERAGE: admins hold every capability implicitly (lib/positions.ts), so a
 * feature exercised only as the admin has never been shown to work for the
 * people who actually use it. Sam has no office that matters here.
 */
const PILOT = "sam@vffclub.test";

interface Aircraft {
  id: string;
  tailNumber: string;
  lastTach: number | null;
}

async function fleet(page: Page): Promise<Aircraft> {
  const res = await page.request.get("/api/aircraft");
  const [first] = (await res.json()) as Aircraft[];
  return first;
}

/** My open session, or null. The same query the post-flight form makes. */
async function openSession(page: Page) {
  const res = await page.request.get("/api/flights?mine=1&open=1&limit=1");
  const rows = (await res.json()) as { id: string; tachStart: number | null }[];
  return rows[0] ?? null;
}

/**
 * Sign off a card with every item ticked, and the readings given.
 *
 * `acknowledgeIncomplete` is passed because a card posted straight to the API
 * has no modal to confirm in — the values here are what the walk recorded, not
 * a claim that every box was ticked.
 */
async function completeCard(
  page: Page,
  aircraftId: string,
  kind: "PREFLIGHT" | "RUNWAY",
  values: Record<string, number | string>
) {
  const res = await page.request.post("/api/checkouts", {
    data: {
      aircraftId,
      kind,
      answers: {},
      values,
      complete: true,
      acknowledgeIncomplete: true,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; flightId: string | null };
}

test.beforeEach(async ({ page }) => {
  await signIn(page, PILOT);
  await clearCheckoutDrafts(page);
});

test("the preflight opens the log entry and the post-flight form finishes it", async ({
  page,
}) => {
  const aircraft = await fleet(page);
  const tachStart = Number(((aircraft.lastTach ?? 1000) + 0.1).toFixed(2));

  // Nothing of mine is out.
  expect(await openSession(page)).toBeNull();

  // The walk. Its meter line is what opens the entry.
  const preflight = await completeCard(page, aircraft.id, "PREFLIGHT", {
    "cockpit.meters.tach": tachStart,
    "cockpit.time.at": "09:15",
  });
  expect(preflight.flightId).not.toBeNull();

  const session = await openSession(page);
  expect(session).not.toBeNull();
  expect(session!.id).toBe(preflight.flightId);
  expect(session!.tachStart).toBe(tachStart);

  // The runway card joins THAT entry rather than opening another.
  const runway = await completeCard(page, aircraft.id, "RUNWAY", {
    "starting.timer.at": "09:41",
  });
  expect(runway.flightId).toBe(preflight.flightId);

  // The log shows it as unfinished, with no hours claimed for it.
  await gotoTab(page, "/log", "Flight log");
  const main = page.getByRole("main");
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(main.getByText("In progress").first()).toBeVisible({
    timeout: 60_000,
  });

  // And the post-flight form knows it's here to finish something.
  await gotoTab(page, "/postflight", "Post-flight");
  await expect(main.getByText(/Closing out the flight you opened/)).toBeVisible();

  // The start reading is the one the walk wrote, not a guess off the airplane.
  await openMeters(page);
  await expect(page.getByLabel("Tach start")).toHaveValue(String(tachStart));
  await expect(page.getByText(/from the flight you opened at the airplane/)).toBeVisible();

  // 1.4 rather than a rounder figure on purpose: `photos.spec.ts` finds its own
  // freshly filed entry by looking for a row reading 1.2, and a second 1.2-hour
  // flight sitting above it in the log breaks that spec rather than this one.
  // The suite shares one database, so an hours figure is effectively a name.
  await page.getByLabel("Tach end").fill((tachStart + 1.4).toFixed(2));
  await page.getByRole("button", { name: "File" }).click();
  await expect(page.getByText(/Filed 1.4 hours/)).toBeVisible({ timeout: 60_000 });

  // One row, not two: the session is closed and nothing of mine is open.
  expect(await openSession(page)).toBeNull();
  const filed = await page.request.get(`/api/flights/${preflight.flightId}`);
  const entry = (await filed.json()) as {
    filedAt: string | null;
    tachStart: number;
    tachEnd: number;
  };
  expect(entry.filedAt).not.toBeNull();
  expect(entry.tachStart).toBe(tachStart);
  expect(entry.tachEnd).toBe(Number((tachStart + 1.4).toFixed(2)));
});

test("the runway card opens an entry on its own when the preflight was skipped", async ({
  page,
}) => {
  const aircraft = await fleet(page);

  const runway = await completeCard(page, aircraft.id, "RUNWAY", {
    "starting.timer.at": "14:02",
  });
  expect(runway.flightId).not.toBeNull();

  const session = await openSession(page);
  expect(session!.id).toBe(runway.flightId);
  // No preflight walked, so no start meters — which is exactly what the log
  // should say rather than borrowing the airplane's last reading.
  expect(session!.tachStart).toBeNull();
});

test("a flight can be closed out with no start reading at all", async ({ page }) => {
  await clearOpenSessions(page);
  const aircraft = await fleet(page);
  const end = Number(((aircraft.lastTach ?? 1000) + 2).toFixed(2));

  await gotoTab(page, "/postflight", "Post-flight");
  await openMeters(page);
  // The box prefills from the airplane; clearing it is the member saying they
  // don't know where this flight began.
  await page.getByLabel("Tach start").fill("");
  await page.getByLabel("Tach end").fill(String(end));

  const file = page.getByRole("button", { name: "File" });
  await expect(file).toBeEnabled();
  await file.click();
  await expect(page.getByText(/no start reading/)).toBeVisible({ timeout: 60_000 });

  // It's in the log, as a row with a gap rather than as no row.
  //
  // Found by its END reading rather than by position: other specs file flights
  // dated today too, and `flownOn` for this one is local MIDDAY (the date
  // input's convention) while an API-filed flight carries the actual clock —
  // so "the newest row" is whichever spec ran last, not this one.
  const res = await page.request.get("/api/flights?mine=1&limit=50");
  const rows = (await res.json()) as {
    tachStart: number | null;
    tachEnd: number | null;
    filedAt: string | null;
  }[];
  const filed = rows.find((f) => f.tachEnd === end);
  expect(filed).toBeDefined();
  expect(filed!.tachStart).toBeNull();
  expect(filed!.filedAt).not.toBeNull();
});

test("a pilot writes up their own flight, and it survives a reload", async ({
  page,
}) => {
  await clearOpenSessions(page);
  const aircraft = await fleet(page);
  const tachStart = Number(((aircraft.lastTach ?? 1000) + 0.1).toFixed(2));

  // A field nothing else in the suite flies to, so the row can be picked out of
  // the log by name. Position won't do it — several specs file flights dated
  // today, and which one sorts first depends on which ran last.
  const MARKER = "KWJF";
  const filed = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft.id,
      flownOn: new Date().toISOString(),
      tachStart,
      tachEnd: Number((tachStart + 1).toFixed(2)),
      landings: 1,
      departure: "KTOA",
      arrival: MARKER,
      notes: "Write-up spec.",
    },
  });
  expect(filed.ok()).toBeTruthy();
  const flightId = (await filed.json()).id as string;

  // Clicking the row is how a member gets here, and the row opening the entry
  // is part of what's being relied on.
  await gotoTab(page, "/log", "Flight log");
  const main = page.getByRole("main");
  await main.getByRole("button").filter({ hasText: MARKER }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  await dialog.getByRole("button", { name: "Edit" }).click();
  const log = dialog.getByLabel("Log");
  await log.fill("Steep turns and stalls.\n\n- Left turn was better\n- Watch the ball");
  await dialog.getByRole("button", { name: "Save" }).click();

  // Rendered, not shown as markup: the bullets are a real list.
  await expect(dialog.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByText("Left turn was better")).toBeVisible();

  // And it's on the entry, not just on the screen.
  const reread = await page.request.get(`/api/flights/${flightId}`);
  expect((await reread.json()).logEntry).toContain("Left turn was better");
});
