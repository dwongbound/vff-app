// The guided tour, at every layout.
//
// This spec runs in ALL THREE projects on purpose. The tour is the one feature
// that reads the DOM's real geometry — it measures a nav control and puts a
// hole and a card next to it — so it's the thing most likely to break silently
// when the chrome moves. A desktop-only check would have said "fine" while the
// highlight sat on nothing at phone width.
//
// The assertion is deliberately about GEOMETRY rather than pixels: the hole
// must actually surround the control the step is talking about. That survives
// restyling and catches the failure that matters (highlighting the wrong thing,
// or nothing).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/** The tour card. Scoped, because the app has other dialogs and other "Next"s. */
const card = (page: Page) => page.locator('[role="dialog"]');

/** Open the tour if signing in didn't already. */
async function openTour(page: Page) {
  if (await card(page).isVisible().catch(() => false)) return;
  // The scrim covers the whole viewport, so the replay button underneath is
  // only reachable once the tour is really gone — not merely mid-fade.
  await expect(card(page)).toBeHidden();
  await page.getByRole("button", { name: "Replay the guided tour" }).click();
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * Finish the tour and wait for the "seen" write to actually land.
 *
 * GuidedTour marks itself seen optimistically — it hides on the click and
 * PATCHes /api/me afterwards, deliberately, since a lost write only costs you
 * the tour once more. A test that reloads the instant the card disappears can
 * therefore beat the write, get `tourSeenAt: null` back from the server, and
 * watch the tour reopen by itself. Waiting for the response makes the
 * "finishing sticks" assertion about persistence rather than about timing.
 */
async function finishTour(page: Page, click: () => Promise<void>) {
  const patched = page.waitForResponse(
    (r) =>
      r.url().includes("/api/me") &&
      r.request().method() === "PATCH" &&
      r.ok(),
    { timeout: 30_000 }
  );
  await click();
  await patched;
}

/** Is `inner` contained by `outer`, allowing a pixel of rounding slop? */
async function surrounds(outer: Locator, inner: Locator) {
  const o = await outer.boundingBox();
  const i = await inner.boundingBox();
  expect(o, "spotlight has no box").not.toBeNull();
  expect(i, "target has no box").not.toBeNull();
  return (
    o!.x <= i!.x + 1 &&
    o!.y <= i!.y + 1 &&
    o!.x + o!.width >= i!.x + i!.width - 1 &&
    o!.y + o!.height >= i!.y + i!.height - 1
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the tour opens, walks every step, and can be replayed", async ({ page }) => {
  await openTour(page);

  // Step through to the end. The loop is bounded so a stuck button fails here
  // rather than hanging.
  let steps = 0;
  for (; steps < 20; steps++) {
    const next = card(page).getByRole("button", { name: /^(Next|Start flying)$/ });
    if (!(await next.isVisible().catch(() => false))) break;
    const last = (await next.innerText()).trim() === "Start flying";
    if (last) {
      await finishTour(page, () => next.click());
      break;
    }
    await next.click();
  }
  expect(steps).toBeGreaterThan(4);
  await expect(card(page)).toBeHidden();

  // Finishing sticks: it doesn't come back on its own…
  await page.reload();
  await expect(card(page)).toBeHidden({ timeout: 30_000 });
  // …but the (?) brings it back.
  await openTour(page);
  await expect(card(page)).toBeVisible();
});

test("each step highlights the control it is describing", async ({ page }) => {
  await openTour(page);

  let checked = 0;
  for (let i = 0; i < 20; i++) {
    const spotlight = page.locator("[data-tour-spotlight]");
    if (await spotlight.isVisible().catch(() => false)) {
      const key = await spotlight.getAttribute("data-tour-spotlight");
      expect(key, "a spotlight with no target key").toBeTruthy();

      // Whichever copy of that control is on screen — the rail's at desktop
      // width, the pill's on a phone. Exactly one is ever visible.
      const target = page.locator(`[data-tour="${key}"]:visible`).first();
      await expect(target).toBeVisible();
      expect(
        await surrounds(spotlight, target),
        `the ${key} spotlight does not surround the ${key} control`
      ).toBe(true);
      checked++;
    }

    const next = card(page).getByRole("button", { name: /^(Next|Start flying)$/ });
    if (!(await next.isVisible().catch(() => false))) break;
    const last = (await next.innerText()).trim() === "Start flying";
    await next.click();
    // Let the measurement settle before reading the next step's geometry.
    await page.waitForTimeout(250);
    if (last) break;
  }

  // The opening and closing cards have no target; everything between does.
  expect(checked, "no step highlighted anything").toBeGreaterThanOrEqual(5);
});

test("the highlighted control is never hidden behind the card", async ({
  page,
}) => {
  await openTour(page);
  // Walk to the first spotlit step.
  for (let i = 0; i < 4; i++) {
    const spotlight = page.locator("[data-tour-spotlight]");
    if (await spotlight.isVisible().catch(() => false)) {
      const hole = await spotlight.boundingBox();
      const box = await card(page).boundingBox();
      expect(hole).not.toBeNull();
      expect(box).not.toBeNull();
      const overlaps =
        hole!.x < box!.x + box!.width &&
        hole!.x + hole!.width > box!.x &&
        hole!.y < box!.y + box!.height &&
        hole!.y + hole!.height > box!.y;
      expect(overlaps, "the card is sitting on top of its own highlight").toBe(
        false
      );
      return;
    }
    await card(page).getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(250);
  }
  throw new Error("never reached a step with a highlight");
});
