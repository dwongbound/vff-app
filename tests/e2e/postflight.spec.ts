// The post-flight form: the entry a member fills in standing at the tail.
//
// Two things get covered here that nothing else does. First, the form SURVIVES
// being left — it autosaves to the device, which it did not used to, and the
// bug that prompted it was a member walking away to push the airplane back and
// returning to a blank form. Second, the meter card FILLS ITSELF from the
// turn-off checkout above it, so the readings are typed once rather than twice.
//
// Filing a flight lives in preflight.spec.ts, with the rest of the "does it
// reach the log" story.
import { expect, test, type Page } from "@playwright/test";
import { clearCheckoutDrafts, gotoTab, signIn } from "./helpers";

/** A meter box's reading as a NUMBER — see the mirroring test for why. */
async function meterValue(page: Page, label: string): Promise<number> {
  return Number(await page.getByLabel(label).inputValue());
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // The form autosaves to the device now, so without this each spec inherits
  // the last one's half-filled entry. See the helper.
  await clearCheckoutDrafts(page);
});

test("the entry survives leaving the page and coming back", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");
  const main = page.getByRole("main");

  // An untouched form says what WILL happen and offers nothing to reset —
  // there is nothing yet to throw away.
  await expect(main.getByText(/saves itself on this device/i)).toBeVisible();
  await expect(main.getByRole("button", { name: "Reset" })).toHaveCount(0);

  const tachStart = await page.getByLabel("Tach start").inputValue();
  const end = (Number(tachStart) + 1.3).toFixed(1);
  await page.getByLabel("Tach end").fill(end);
  await page.getByLabel("Landings", { exact: true }).fill("4");
  await page.getByLabel("Route").fill("KTOA → KCMA → KTOA");

  // Saved on the device, and it says so rather than implying a sync it can't
  // do — this form has no server row to sync to until it's filed.
  await expect(main.getByRole("status")).toHaveText(/on this device/, {
    timeout: 30_000,
  });

  // Walk away — a real navigation, not a reload — and come back.
  await gotoTab(page, "/log", "Flight log");
  await gotoTab(page, "/postflight", "Post-flight");

  await expect(page.getByLabel("Tach end")).toHaveValue(end);
  await expect(page.getByLabel("Landings", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Route")).toHaveValue("KTOA → KCMA → KTOA");
  // …and the form SAYS why it's already filled in, rather than leaving the
  // member wondering whose numbers these are.
  await expect(main.getByRole("status")).toHaveText(/Picking up where you left off/);
});

test("resetting the entry clears it, and it stays cleared", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");
  const main = page.getByRole("main");

  await page.getByLabel("Route").fill("somewhere I did not go");
  await expect(main.getByRole("status")).toBeVisible({ timeout: 30_000 });

  await main.getByRole("button", { name: "Reset" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/can't be undone/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Reset entry" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByLabel("Route")).toHaveValue("");

  // And it stays gone: a reset that only cleared the screen would come back
  // from the device on the next visit.
  await gotoTab(page, "/log", "Flight log");
  await gotoTab(page, "/postflight", "Post-flight");
  await expect(page.getByLabel("Route")).toHaveValue("");
  await expect(main.getByText(/saves itself on this device/i)).toBeVisible();
});

// The readings are on the panel in front of you once, so they get typed once.
// The turn-off card's shutdown item is where they're read; the meter card below
// is where they're USED, and it fills itself from that card.
test("the meter card fills itself from the turn-off checkout", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");

  const tachStart = await page.getByLabel("Tach start").inputValue();
  const tach = (Number(tachStart) + 2.1).toFixed(1);

  // Type into the CHECKOUT's boxes, not the meter card's. By FIELD ID rather
  // than by label: a checkout field's name runs its unit straight on ("Tach(hrs)"
  // — the gap is a CSS margin, and JSX drops the newline between them), and a
  // looser /^Tach/ would also catch "Tach start" and "Tach end" on this page.
  // The ids are the storage keys, so they're the most stable handle there is.
  const cardTach = page.locator('[id="shutdown.tach.hours"]');
  const cardHobbs = page.locator('[id="shutdown.tach.hobbs"]');
  await cardTach.fill(tach);
  await cardHobbs.fill("742.6");

  // The whole reading arrives, not just its first keystroke — this mirrors
  // continuously rather than filling an empty box once, which is what made an
  // earlier version show "1" under a checklist reading 1506.1.
  //
  // Compared as NUMBERS, not strings: the checkout field stores a number, so a
  // reading typed as "1508.0" arrives here as "1508". Same reading, different
  // spelling, and it's the reading this test is about.
  await expect.poll(() => meterValue(page, "Tach end")).toBe(Number(tach));
  await expect.poll(() => meterValue(page, "Hobbs end")).toBe(742.6);

  // A correction made in the meter card wins and STOPS following the card:
  // it's the member overriding what was read, which is the whole reason the
  // boxes stay editable.
  const corrected = (Number(tach) + 0.4).toFixed(1);
  await page.getByLabel("Tach end").fill(corrected);
  await cardTach.fill((Number(tach) + 0.9).toFixed(1));
  await expect.poll(() => meterValue(page, "Tach end")).toBe(Number(corrected));
});
