// The theme submenu, which is the app's only fly-out menu.
//
// The bug this guards against: the list was positioned with a MARGIN, so the
// 4px between the "Select theme" row and the list belonged to neither of them.
// Sliding the pointer across meant being briefly over nothing, `mouseleave`
// fired, and the list disappeared on the way to it — the menu was literally
// unreachable by hover.
//
// Reproducing it needs the mouse to TRAVEL. `hover()` and `click()` jump
// straight to the target and would skip the dead zone entirely, so this walks
// `mouse.move(..., { steps })` across the gap the way a hand does.
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the theme list survives the trip from its row to the list", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings" }).hover();

  const row = page.getByRole("button", { name: /Select theme/ });
  await expect(row).toBeVisible({ timeout: 30_000 });

  const rowBox = (await row.boundingBox())!;
  // Start in the middle of the row…
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);

  const dark = page.getByRole("button", { name: "Dark", exact: true });
  await expect(dark).toBeVisible();

  // …then walk right, THROUGH the gap, into the list. Every intermediate
  // position is a real mousemove, which is what makes this a regression test
  // rather than a click.
  const darkBox = (await dark.boundingBox())!;
  await page.mouse.move(
    darkBox.x + darkBox.width / 2,
    darkBox.y + darkBox.height / 2,
    { steps: 25 }
  );

  // The list is still there after the journey — this is the assertion that
  // failed before the fix.
  await expect(dark).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();

  // And the choice actually applied.
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("a theme choice sticks across a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).hover();
  await page.getByRole("button", { name: /Select theme/ }).hover();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // Stored client-side and re-applied before hydration (see the theme script
  // in app/layout.tsx), so it must survive a full page load.
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
