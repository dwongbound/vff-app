import { expect, test } from "@playwright/test";
import {
  clearCheckoutDrafts,
  gotoTab,
  openMeters,
  openPostflightSection,
  signIn,
  waitForCheckoutSaved,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // The cards autosave now, so every spec in this file would otherwise inherit
  // the previous one's half-ticked walk. See the helper.
  await clearCheckoutDrafts(page);
});

test("the preflight checkout tracks progress and asks before filing a partial card", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  // Nothing checked yet. Complete is still pressable — a member who genuinely
  // can't answer an item must be able to file the walk they DID do — and the
  // page says what's outstanding.
  const complete = page.getByRole("button", { name: "Complete", exact: true });
  await expect(complete).toBeEnabled();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();

  // Check off the whole first section in one tap; the counter follows.
  await page.getByRole("button", { name: "Check all" }).click();
  await expect(page.getByText(/Step \d+ of \d+ · \d+ of \d+ checked/)).toBeVisible();

  // Still incomplete, so pressing it asks rather than files: the modal NAMES
  // what isn't ticked, which is the whole point of asking.
  await complete.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/aren't ticked/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Complete anyway" })).toBeVisible();

  // Backing out changes nothing.
  await dialog.getByRole("button", { name: "Keep checking" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();
});

// The sticky bar's job is "where am I", which on a card walked one-handed is a
// different question from "how much is left" — scrolled into the middle of a
// 15-item section, a bare percentage tells you neither which section you're in
// nor how close you are to the end of it.
test("the sticky bar names the section you're on and your place in it", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");

  // Opens on section one of the card, with nothing ticked.
  await expect(main.getByText(/^Step 1 of \d+ · 0 of \d+ checked$/)).toBeVisible();

  // Move to a named section and the bar follows the member, not the scroll.
  await main.getByRole("button", { name: /Consumables.*\d+\/\d+$/ }).click();
  const stepLine = main.getByText(/^Step \d+ of \d+ · \d+ of \d+ checked$/);
  await expect(stepLine).toBeVisible();
  await expect(main.getByText(/^Step 1 of/)).toHaveCount(0);

  // Ticking inside that section moves the section's own count, which is the
  // "how far down THIS list" half of the question.
  const before = await stepLine.textContent();
  await main.getByRole("button", { name: "Check all" }).click();
  await expect(stepLine).not.toHaveText(before!);
  await expect(main.getByText("Ready to sign off")).toHaveCount(0);
});

test("a squawk raised on the walk is filed with the checkout", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await page.getByRole("button", { name: "Report" }).click();
  await page.getByLabel("What's wrong?").fill("Nav light flickering");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText("Nav light flickering")).toBeVisible();

  // No Save button any more: ticking anything starts the walk saving by itself,
  // and the first sync is what files the squawk. That timing is the point — a
  // walk that finds something wrong often ends with nobody flying, so a squawk
  // that waited for a sign-off would be a squawk nobody ever read.
  await page.getByRole("button", { name: "Check all" }).first().click();
  // Wait for the walk to reach the SERVER before navigating: the squawk is
  // filed on that first sync, and `page.goto` below would tear the page down
  // with the request still in flight.
  await waitForCheckoutSaved(page);
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/squawks?status=open&limit=50");
        const rows = res.ok() ? ((await res.json()) as { title: string }[]) : [];
        return rows.some((s) => s.title === "Nav light flickering");
      },
      { timeout: 60_000 }
    )
    .toBe(true);

  // It now shows on the airplane's squawk sheet. That's Plane Status › Squawks
  // and nowhere else: the flight log used to carry a second copy of this list
  // under its Club half, and two lists of the same rows meant two places to
  // look and two places to be out of date.
  await page.goto("/status/squawks");
  await expect(
    page.getByRole("main").getByText("Nav light flickering")
  ).toBeVisible({ timeout: 60_000 });
});

test("filing a flight adds it to the log and advances the tach", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");

  // Tach start prefills from the airplane; fly 1.5 hours.
  //
  // Two decimals, because a tach reading has two: the club's own log records
  // 1489.98 and 1499.42, and the seeded airplane is currently sitting on
  // 1507.05. Rounding the END to one place turns "fly 1.5 hours" into 1.55 and
  // the page — correctly — says 1.6, which is a test asserting its own
  // arithmetic rather than the app's.
  // The form's groups collapse now — one accordion across the whole page.
  await openMeters(page);
  const tachStart = await page.getByLabel("Tach start").inputValue();
  const end = (Number(tachStart) + 1.5).toFixed(2);
  await page.getByLabel("Tach end").fill(end);
  await openPostflightSection(page, /The flight/);
  await page.getByLabel("Landings", { exact: true }).fill("2");
  await page.getByLabel("Night landings").fill("1");

  await expect(page.getByText("1.5 hr")).toBeVisible();

  await page.getByRole("button", { name: "File" }).click();
  await expect(page.getByText(/Filed 1.5 hours/)).toBeVisible({ timeout: 60_000 });

  await gotoTab(page, "/log", "Flight log");
  await expect(page.getByText("1.5").first()).toBeVisible();
  // The night landing lands in the currency card, not just the log line — and
  // currency is a "Mine" question, so it lives on that half of the switch.
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(page.getByText(/Night: [1-9]\d*\/3 full-stop/)).toBeVisible();
});

test("an impossible meter reading is caught before it can be filed", async ({
  page,
}) => {
  await gotoTab(page, "/postflight", "Post-flight");
  await openMeters(page);
  const tachStart = await page.getByLabel("Tach start").inputValue();
  await page.getByLabel("Tach end").fill((Number(tachStart) - 5).toFixed(1));

  await expect(page.getByText(/lower than tach start/)).toBeVisible();
  await expect(page.getByRole("button", { name: "File" })).toBeDisabled();
});

// The consumables the club actually records, and the two it decided not to.
test("fuel is dipped a wing at a time, and the tires record nothing", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: /Consumables.*\d+\/\d+$/ }).click();

  // Anchored regex, not `exact`: a field's accessible name carries its unit,
  // so this box is called "Left wing (gal)" — see CheckoutFields.
  const left = page.getByLabel(/^Left wing/);
  const right = page.getByLabel(/^Right wing/);
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  // The pre-v6 single total is gone, and so are the tire gauge boxes.
  await expect(page.getByLabel(/^Fuel on board/)).toHaveCount(0);
  await expect(page.getByLabel(/^Nose/)).toHaveCount(0);
  await expect(page.getByLabel(/^Mains/)).toHaveCount(0);
  await expect(page.getByText("Tire pressure — nose 26 psi, mains 23 psi")).toBeVisible();

  // Recording a reading ticks the item it sits on — one tank is enough.
  await left.fill("17.5");
  await expect(
    page.getByRole("button", { name: /^Dip fuel tanks/ })
  ).toHaveAttribute("aria-pressed", "true");

  // The two wings total into the airplane's fuel on the "what you found" card.
  await right.fill("17");
  await expect(page.getByText(/34\.5/).first()).toBeVisible();
});

// The card asks whether the load fits; the app can already work that out. The
// link is on the row that asks, rather than left to a member to remember which
// tab the calculator was on.
test("the weight and balance item links out to the tool", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /Homework.*\d+\/\d+$/ }).click();

  // Anchored, or the (i) beside it ("Why: Weight and balance …") matches too.
  const row = main.getByRole("button", { name: /^Weight and balance/ });
  await expect(row).toHaveAttribute("aria-pressed", "false");

  // Beside the tick, not part of it: the app can compute the numbers, it can't
  // know you looked at them, so following the link ticks nothing.
  const link = main.getByRole("link", { name: /Run the numbers/ });
  await expect(link).toBeVisible();
  await link.click();

  await expect(
    page.getByRole("heading", { name: "Weight & Balance", exact: true })
  ).toBeVisible({ timeout: 60_000 });
});

// A club addition, and the only section on the card with no list: the step
// back at the end that catches the whole-airplane problems.
test("the walk ends with a 360 around the airplane", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");

  const walkaround = page.getByRole("button", { name: /Walkaround.*\d+\/\d+$/ });
  await expect(walkaround).toBeVisible();
  await walkaround.click();
  await expect(
    page.getByText("Full 360 — anything that looks wrong")
  ).toBeVisible();
  await expect(page.getByText(/Ground underneath/)).toBeVisible();
});

test("the time box opens at the current time, and can be typed over", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: /Cockpit.*\d+\/\d+$/ }).click();

  const time = page.getByLabel("Time", { exact: true });
  const item = page.getByRole("button", { name: /^Time — recorded/ });

  // Pre-filled with a real clock reading rather than left blank…
  await expect(time).toHaveValue(/^\d{2}:\d{2}$/);
  // …but pre-filling is NOT an answer: nobody confirmed anything by opening a
  // page, so the item it sits on is still unticked.
  await expect(item).toHaveAttribute("aria-pressed", "false");

  // It's a default, not a stamp — the pilot's own value wins, and typing one
  // does tick the item, the same as any other reading on a card.
  await time.fill("06:15");
  await expect(time).toHaveValue("06:15");
  await expect(item).toHaveAttribute("aria-pressed", "true");
});

// The whole point of the change: the walk survives losing the page, and nobody
// had to press anything for that to be true. Before this there was a Save
// button, and closing the tab without pressing it threw the walk away.
test("a walk saves itself and comes back after a reload", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");

  // An untouched card says what WILL happen rather than showing a control, and
  // offers nothing to reset — there is nothing yet to throw away.
  await expect(main.getByText(/progress saves automatically/i)).toBeVisible();
  await expect(main.getByRole("button", { name: "Reset" })).toHaveCount(0);

  // Section one, complete. (The card opens on it, so "Check all" fills it.)
  await main.getByRole("button", { name: "Check all" }).click();
  const step = main.getByText(/^Step \d+ of \d+ · \d+ of \d+ checked$/);
  const tally = (await step.textContent())!.split("·")[1].trim();
  await waitForCheckoutSaved(page);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Preflight", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // The ticks are back, the count matches, and the page SAYS why they're
  // already ticked — a half-ticked card with no explanation is one a careful
  // member re-walks from scratch, which is the thing saving was meant to avoid.
  // Scoped to main: LoadingScreen is a `role="status"` too ("Loading…"), and
  // on a fresh reload the splash can still be up when this first evaluates.
  await expect(main.getByRole("status")).toHaveText(/Picking up where you left off/);
  await expect(step).toHaveText(new RegExp(`· ${tally}$`));

  // …and it opens where the WORK is, not where the card starts. Section one is
  // finished, so coming back to it would make the member's first act scrolling
  // past their own ticks to find the place they got to.
  await expect(step).toHaveText(/^Step 2 of /);
});

// Reset is destructive and irreversible, so it asks — and taking the "no" has
// to actually mean no.
test("reset confirms first, and backing out changes nothing", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");

  await main.getByRole("button", { name: "Check all" }).click();
  const step = main.getByText(/^Step \d+ of \d+ · \d+ of \d+ checked$/);
  const ticked = await step.textContent();
  await waitForCheckoutSaved(page);

  await main.getByRole("button", { name: "Reset" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/can't be undone/i)).toBeVisible();

  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await expect(step).toHaveText(ticked!);
});

test("reset clears the walk on the device and on the server", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  const main = page.getByRole("main");

  await main.getByRole("button", { name: "Check all" }).click();
  await waitForCheckoutSaved(page);

  await main.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset checkout" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

  // Back to a blank card, opened at section one.
  await expect(main.getByText(/^Step 1 of \d+ · 0 of \d+ checked$/)).toBeVisible();
  await expect(main.getByText(/progress saves automatically/i)).toBeVisible();

  // And it STAYS gone: a reset that only cleared the screen would come back on
  // the next load from whichever copy it missed.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Preflight", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await expect(main.getByText(/^Step 1 of \d+ · 0 of \d+ checked$/)).toBeVisible();
  await expect(page.getByText(/Picking up where you left off/)).toHaveCount(0);

  // The server's copy went too — nothing left for anyone to resume.
  const open = await page.request.get("/api/checkouts?mine=1&open=1&kind=PREFLIGHT&limit=10");
  expect(await open.json()).toEqual([]);
});

// The other way a flight gets into the log: typed in from the paper one,
// weeks later. Deliberately not the Post-flight form — see FlightEntryModal.
test("a flight can be added to the log by hand", async ({ page }) => {
  await gotoTab(page, "/log", "Flight log");
  await page.getByRole("button", { name: "Add flight" }).first().click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText(/for a flight that was never filed/)).toBeVisible();

  // Tach start prefills from the airplane, so only the end reading is needed.
  const tachStart = await modal.getByLabel("Tach start").inputValue();
  expect(tachStart).not.toBe("");
  await modal.getByLabel("Tach end").fill((Number(tachStart) + 2.3).toFixed(1));
  await modal.getByLabel("Landings", { exact: true }).fill("4");
  await modal.getByLabel("From", { exact: true }).fill("KTOA");
  await modal.getByLabel("To", { exact: true }).fill("KCMA");

  // The same arithmetic the log will show, before you commit to it.
  await expect(modal.getByText("2.3 tach hours")).toBeVisible();

  await modal.getByRole("button", { name: "Add to log" }).click();
  await expect(modal).toBeHidden({ timeout: 60_000 });

  // …and it's a log line like any other, meters advanced with it.
  await expect(page.getByText("KTOA → KCMA").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(`tach ${(Number(tachStart) + 2.3).toFixed(1)}`)
  ).toBeVisible();
});

// The mis-read meter is the error this form exists to catch, and it has to be
// caught before the entry is written rather than after.
test("a backwards tach reading is refused in the add-flight modal", async ({
  page,
}) => {
  await gotoTab(page, "/log", "Flight log");
  await page.getByRole("button", { name: "Add flight" }).first().click();

  const modal = page.getByRole("dialog");
  const tachStart = await modal.getByLabel("Tach start").inputValue();
  await modal.getByLabel("Tach end").fill((Number(tachStart) - 3).toFixed(1));

  await expect(modal.getByText(/lower than tach start/)).toBeVisible();
  await expect(modal.getByRole("button", { name: "Add to log" })).toBeDisabled();
});
