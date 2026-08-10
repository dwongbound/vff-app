import { expect, test } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the preflight checkout tracks progress and gates sign-off", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");

  // Nothing checked yet: sign-off is unavailable and the page says what's next.
  const signOff = page.getByRole("button", { name: "Sign off" });
  await expect(signOff).toBeDisabled();
  await expect(page.getByText(/items left, starting with/)).toBeVisible();

  // Check off the whole first section in one tap; the counter follows.
  await page.getByRole("button", { name: "Check all" }).click();
  await expect(page.getByText(/^\d+ of \d+ checked$/)).toBeVisible();

  // Still incomplete → still gated.
  await expect(signOff).toBeDisabled();
});

test("a squawk raised on the walk is filed with the checkout", async ({
  page,
}) => {
  await gotoTab(page, "/preflight", "Preflight");

  await page.getByRole("button", { name: "Report" }).click();
  await page.getByLabel("What's wrong?").fill("Nav light flickering");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText("Nav light flickering")).toBeVisible();

  // Saving partial progress is allowed and files the squawk with it.
  await page.getByRole("button", { name: "Check all" }).first().click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Progress saved/)).toBeVisible({ timeout: 60_000 });

  // It now shows in the airplane's open-squawk list on the log tab.
  await gotoTab(page, "/log", "Flight log");
  await expect(page.getByText("Nav light flickering")).toBeVisible();
});

test("filing a flight adds it to the log and advances the tach", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");

  // Tach start prefills from the airplane; fly 1.5 hours.
  const tachStart = await page.getByLabel("Tach start").inputValue();
  const end = (Number(tachStart) + 1.5).toFixed(1);
  await page.getByLabel("Tach end").fill(end);
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
  await modal.getByLabel("From", { exact: true }).fill("KBFI");
  await modal.getByLabel("To", { exact: true }).fill("KWVI");

  // The same arithmetic the log will show, before you commit to it.
  await expect(modal.getByText("2.3 tach hours")).toBeVisible();

  await modal.getByRole("button", { name: "Add to log" }).click();
  await expect(modal).toBeHidden({ timeout: 60_000 });

  // …and it's a log line like any other, meters advanced with it.
  await expect(page.getByText("KBFI → KWVI").first()).toBeVisible({
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
