// The page behind an open overlay stays put.
//
// The bug: Modal froze <body>, but <body> never scrolls here — `#app-scroll`
// does (lib/appScroll.ts) — so with any modal or menu open, the wheel still
// slid the page around underneath it. These scroll with the real wheel, over
// the backdrop and over the menu, and check the page didn't move; then that it
// scrolls again once the overlay is gone.
import { expect, test, type Page } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const scroller = (page: Page) => page.locator("#app-scroll");
const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);

/** Park the page partway down, so a frozen page could visibly move either way. */
async function scrollPartway(page: Page) {
  await scroller(page).evaluate((el) => el.scrollTo(0, 200));
  await expect.poll(() => scrollTop(page)).toBe(200);
}

/** Wheel at (x, y) and give the browser a moment to have moved anything. */
async function wheelAt(page: Page, x: number, y: number, dy = 400) {
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(300);
}

test("a modal freezes the page behind it, and lets go when it closes", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  await scrollPartway(page);

  // Incomplete, so Complete asks in a ConfirmModal.
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Keep checking" })).toBeVisible();
  await expect(scroller(page)).toHaveCSS("overflow-y", "hidden");
  // Wherever opening it left the page (it may bring the first unticked item
  // into view), that's where the page stays.
  const frozenAt = await scrollTop(page);

  // Over the backdrop (the top-left corner, clear of the card) and over the
  // card itself, both ways: neither moves the page.
  await wheelAt(page, 10, 300);
  await wheelAt(page, 640, 400, -400);
  expect(await scrollTop(page)).toBe(frozenAt);

  await dialog.getByRole("button", { name: "Keep checking" }).click();
  await expect(dialog).toBeHidden();
  await expect(scroller(page)).toHaveCSS("overflow-y", "auto");
  await wheelAt(page, 640, 400, -400);
  expect(await scrollTop(page)).toBeLessThan(frozenAt);
});

test("an open menu freezes the page too", async ({ page }) => {
  await gotoTab(page, "/preflight", "Preflight");
  await scrollPartway(page);

  // The settings menu is a Dropdown; clicking latches it open.
  await page.getByRole("button", { name: "Settings" }).click();
  const theme = page.getByRole("button", { name: /Select theme/ });
  await expect(theme).toBeVisible();
  await expect(scroller(page)).toHaveCSS("overflow-y", "hidden");

  const box = (await theme.boundingBox())!;
  await wheelAt(page, box.x + box.width / 2, box.y + box.height / 2);
  await wheelAt(page, 640, 500);
  expect(await scrollTop(page)).toBe(200);

  await page.keyboard.press("Escape");
  await expect(theme).toBeHidden();
  await expect(scroller(page)).toHaveCSS("overflow-y", "auto");
});
