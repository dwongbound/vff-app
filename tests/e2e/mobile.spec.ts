// Phone-width pass over the app's responsive branches: the bottom tab bar
// replaces the top strip, the reservation list replaces the month grid, and
// the "+" FAB is how you book. Runs on real device presets (see
// playwright.config.ts projects) rather than a narrow desktop window.
import { expect, test } from "@playwright/test";
import {
  clearCheckoutDrafts,
  clearOpenSessions,
  expectFormsFitTouchScreen,
  expectStatusPagesReadable,
  openPostflightSection,
  signIn,
  swipeLeft,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("phones get the bottom tab bar, not the desktop strip", async ({ page }) => {
  // Short labels in the floating pill.
  await expect(page.getByRole("link", { name: "Reserve" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log" })).toBeVisible();
  // The desktop-only "New" button is hidden at this width.
  await expect(
    page.getByRole("button", { name: "New", exact: true })
  ).toBeHidden();
});

test("the schedule is a list, and the + button opens the booking sheet", async ({
  page,
}) => {
  // The month grid's weekday header never renders on a phone.
  await expect(page.getByText("Sun", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "New reservation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Start", { exact: true })).toBeVisible();
});

test("phones keep the native date picker instead of the custom popover", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New reservation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // No custom calendar button: on a touch device the OS picker is the better
  // control, so DateTimeField leaves the native one alone.
  await expect(
    page.getByRole("button", { name: "Open calendar for Start" })
  ).toBeHidden();
  // …and the field itself is still a real datetime input.
  await expect(page.getByLabel("Start", { exact: true })).toHaveAttribute("type", "datetime-local");
});

test("tabs are reachable from the bottom bar", async ({ page }) => {
  // The three checkouts share one tab in the pill — there isn't room for
  // seven — so Preflight is a tap INTO that group, not a tab of its own.
  // Tapping the group opens a sheet above the bar.
  await page.getByRole("button", { name: "Checks" }).click();
  await page.getByRole("link", { name: "Preflight" }).click();
  await expect(
    page.getByRole("heading", { name: "Preflight", exact: true })
  ).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.getByRole("heading", { name: "Flight log" })).toBeVisible({
    timeout: 60_000,
  });

  // Tools is a group too, and its sheet is the only way to its pages down here.
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("link", { name: "Weight & Balance" }).click();
  await expect(
    page.getByRole("heading", { name: "Weight & Balance", exact: true })
  ).toBeVisible({ timeout: 60_000 });
});

test("weight & balance stacks into one column on a phone", async ({ page }) => {
  await page.goto("/tools/weight-balance");
  await expect(
    page.getByRole("heading", { name: "Weight & Balance", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // The two-column layout collapses below `lg`, so the form and the verdict
  // are both in the same column — and nothing may push the page sideways. The
  // envelope chart is the risk: it's a fixed-viewBox SVG.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflows).toBe(false);

  await page.getByLabel("Pilot", { exact: true }).fill("170");
  await expect(page.getByText("Within limits", { exact: true })).toBeVisible();
});

// The landing fee on a phone. Worth its own leg rather than trusting the
// desktop run: this is webkit, the box is prefilled by a React effect watching
// another field, and the post-flight form is the one members really do fill in
// one-handed standing at the tail.
test("the landing fee prefills on a phone, and can be typed over", async ({
  page,
}) => {
  await clearCheckoutDrafts(page);
  await page.goto("/postflight");
  await openPostflightSection(page, /The flight/);
  const main = page.getByRole("main");

  const fee = main.getByLabel("Landing fee");
  await expect(fee).toHaveValue("", { timeout: 60_000 });

  await main.getByLabel("To", { exact: true }).fill("KTOA");
  await expect(fee).toHaveValue("6.00");

  await fee.fill("9.00");
  await main.getByLabel("To", { exact: true }).fill("KTOA");
  await expect(fee).toHaveValue("9.00");
});

// The turn-off card renders through CheckoutList now, like the other two, so on
// a phone it must COLLAPSE the same way — this is the regression that would
// show up as a wall of 21 rows between the meters and the file button.
test("the turn-off card collapses into sections on a phone", async ({ page }) => {
  await clearCheckoutDrafts(page);
  await page.goto("/postflight");
  const main = page.getByRole("main");

  const shutdown = main.getByRole("button", { name: /Shutdown.*\d+\/\d+$/ });
  await expect(shutdown).toBeVisible({ timeout: 60_000 });

  // Collapsed sections render no items at all, so the shutdown rows are absent
  // until the header is tapped.
  await expect(main.getByRole("button", { name: /^Master switch/ })).toHaveCount(0);
  await shutdown.click();
  await expect(main.getByRole("button", { name: /^Master switch/ })).toBeVisible();
});

// ── Quick Log on a phone ────────────────────────────────────────────────────
//
// This one earns phone coverage more than anything else in the app: it is
// FOR the phone. The moment it's wanted is a member standing at the tail with
// four numbers in their head, and the desktop suite can't tell us the pill
// reaches it or that the form is usable at 402px.
test("Quick Log is reachable from the pill and files from a phone", async ({
  page,
}) => {
  // A tab of its own rather than buried in a group sheet: there is no rail
  // down here to pin it under, so it stays the last pill tab.
  const tab = page.getByRole("link", { name: "Quick" });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(
    page.getByRole("heading", { name: "Quick Log", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  const main = page.getByRole("main");
  // The start box FOLLOWS the best reading the app knows — the open flight,
  // then today's preflight walk, then the last filed flight — until it's typed
  // in, and those answers arrive at different moments. Read it only once the
  // page has stopped asking, or the box can change under the test after it
  // has read it (and the flight files with a different span than it typed).
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  await page.waitForLoadState("networkidle");
  const start = Number(await tachStart.inputValue());

  // The meter boxes stack rather than sitting two-up, so all four are
  // reachable without a horizontal scroll.
  await expect(main).toBeVisible();
  await main.getByLabel("Tach end", { exact: true }).fill((start + 0.8).toFixed(1));
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA");

  const [posted] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST"
    ),
    main.getByRole("button", { name: /^File/ }).click(),
  ]);
  const flight = (await posted.json()) as { landings: number; arrival: string | null };
  expect(flight.landings).toBe(1);
  expect(flight.arrival).toBe("KTOA");
  await expect(main.getByText(/Filed 0\.8 hours/)).toBeVisible();
});

// The control that decides whether somebody is reimbursed has to be tappable
// on the device they'll actually use, not just present in the DOM.
test("the fuel card toggle works with a finger", async ({ page }) => {
  await page.goto("/quick-log");
  const main = page.getByRole("main");

  await main.getByRole("button", { name: /Fuel & oil/ }).click();
  const toggle = main.getByRole("switch", { name: /club's card/i });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.tap();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

// A vertical scroll that drifts sideways used to drag the whole page off to one
// side. The content column can't scroll horizontally at all now; tab changes
// are SwipePager's job, and it never moves the page (see lib/swipe.ts).
test("the page can't be pushed sideways", async ({ page }) => {
  await page.goto("/postflight");
  // The shell renders once sign-in is confirmed, not with the first byte.
  const column = page.locator("#app-scroll");
  await expect(column).toBeVisible();
  expect(await column.evaluate((el) => getComputedStyle(el).overflowX)).toBe("hidden");
});

// The offline strip has to stay out of the way on the screen it matters most
// on: one line, whatever it's saying. See lib/offline.ts.
test("a flight filed offline shows one short line, then sends itself", async ({
  page,
  context,
}) => {
  await clearOpenSessions(page);
  await page.goto("/quick-log");
  const main = page.getByRole("main");
  // The start box FOLLOWS the best reading the app knows — the open flight,
  // then today's preflight walk, then the last filed flight — until it's typed
  // in, and those answers arrive at different moments. Read it only once the
  // page has stopped asking, or the box can change under the test after it
  // has read it (and the flight files with a different span than it typed).
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  await page.waitForLoadState("networkidle");
  const start = Number(await tachStart.inputValue());
  await main.getByLabel("Tach end", { exact: true }).fill((start + 0.4).toFixed(1));
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA");

  await context.setOffline(true);
  try {
    await main.getByRole("button", { name: /^File/ }).tap();
    const strip = main.getByText("1 flight waiting for signal");
    await expect(strip).toBeVisible();
    // One line of text-xs plus its padding — a wrapped strip would be ~40px.
    const box = await strip.boundingBox();
    expect(box!.height).toBeLessThan(24);

    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST" && r.status() < 300,
      { timeout: 45_000 }
    );
    await context.setOffline(false);
    await sent;
    await expect(strip).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test("Finances on a phone is a list, not a table, and nothing scrolls sideways", async ({
  page,
}) => {
  await page.goto("/finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });

  // The five-column table only exists from `sm` up; a phone gets stacked lines.
  await expect(main.getByRole("table")).toHaveCount(0);
  const dues = main.getByRole("listitem").filter({ hasText: "Monthly membership" }).first();
  await expect(dues).toBeVisible();
  await expect(dues.getByText("$250.00")).toBeVisible();

  // The three views fit across the width as equal segments.
  for (const view of ["Me", "Club (by person)", "Club (by month)"]) {
    await expect(main.getByRole("button", { name: view, exact: true })).toBeVisible();
  }
  await main.getByRole("button", { name: "Club (by person)", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Club balance" })).toBeVisible();

  // Nothing on the page is wider than the phone — and if something is, name it.
  const { overflow, culprits } = await page.evaluate(() => {
    const scroller = document.getElementById("app-scroll")!;
    const edge = scroller.getBoundingClientRect().right;
    const culprits = [...scroller.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > edge + 0.5)
      // Innermost offenders only: a parent widened by its child adds nothing.
      .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
      .slice(0, 5)
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">${(el.textContent ?? "").slice(0, 40)}`);
    return { overflow: scroller.scrollWidth - scroller.clientWidth, culprits };
  });
  expect(overflow, culprits.join("\n")).toBeLessThanOrEqual(0);

  // The dashed + panel opens the add-money sheet.
  await main.getByRole("button", { name: "Add money", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("group", { name: "What kind of money" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
});

test("double-tap zoom is off, but pinch-zoom is left alone", async ({ page }) => {
  // `manipulation` = pan + pinch-zoom, no double-tap zoom, on every element
  // (touch-action isn't inherited, so the root alone wouldn't reach inside
  // the app's scroller).
  for (const selector of ["html", "#app-scroll", "main button", "main"]) {
    const value = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(value, selector).toBe("manipulation");
  }
  // And it's done without locking the viewport's scale, which would also
  // kill pinch-zoom for anyone who needs it to read the page.
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport ?? "").not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/);
});

test("no field zooms the page on focus, and no form is wider than the screen", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await expectFormsFitTouchScreen(page);
});

test("a full sideways pull changes tab on a phone", async ({ page }) => {
  // The positive half of the tablet test in ipad.spec.ts: the same gesture
  // that must do nothing on an iPad does change tab here — so that test can't
  // pass just because the simulated swipe never worked.
  await expect(page.getByRole("main")).toBeVisible();
  const before = new URL(page.url()).pathname;
  await swipeLeft(page);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).not.toBe(before);
});

test("every group menu on the pill stays on the screen, even over the first tab", async ({
  page,
}) => {
  // Centred over its tab, the Status sheet (the pill's FIRST tab) used to
  // hang half off the left edge. useKeepInViewport nudges it back in.
  const width = page.viewportSize()!.width;
  for (const group of ["Status", "Checks", "Tools"]) {
    await page.getByRole("button", { name: group, exact: true }).click();
    const sheet = page.getByRole("menu");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.x, `${group} sheet's left edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${group} sheet's right edge`).toBeLessThanOrEqual(width);
    // Close it again before the next one.
    await page.getByRole("button", { name: group, exact: true }).click();
    await expect(sheet).toBeHidden();
  }
});

test("an open group menu freezes the page, and a tap outside only closes it", async ({
  page,
}) => {
  await page.goto("/reservations");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Reservations", exact: true })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Checks", exact: true }).click();
  const sheet = page.getByRole("menu");
  await expect(sheet).toBeVisible();

  // The page underneath can't scroll while it's open.
  const overflow = () =>
    page.evaluate(() => getComputedStyle(document.getElementById("app-scroll")!).overflowY);
  expect(await overflow()).toBe("hidden");

  // A tap on the page — right where a booking control sits — closes the sheet
  // and does nothing else: same page, no dialog.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 2, viewport.height / 3);
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/reservations/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await overflow()).not.toBe("hidden");
});

test("Finances fits a phone: title and Export share a row, the balance reads on one line", async ({
  page,
}) => {
  await page.goto("/finances");
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { name: "Finances", exact: true });
  await expect(heading).toBeVisible({ timeout: 60_000 });
  // No subtitle under the title any more.
  await expect(main.getByText(/every month/)).toHaveCount(0);

  // Export sits on the title's row, at the right.
  const exportButton = main.getByRole("button", { name: "Export", exact: true });
  const title = (await heading.boundingBox())!;
  const exp = (await exportButton.boundingBox())!;
  expect(Math.abs(exp.y + exp.height / 2 - (title.y + title.height / 2))).toBeLessThan(12);
  expect(exp.x).toBeGreaterThan(title.x + title.width);

  // The switch is worded short: Unpaid / All.
  await expect(main.getByText("Unpaid", { exact: true })).toBeVisible();
  await expect(main.getByText("All", { exact: true })).toBeVisible();

  // The verdict and the amount share one line.
  const verdict = main.locator("[data-tone]");
  const [words, amount] = await Promise.all([
    verdict.locator("p").first().boundingBox(),
    verdict.locator("p").last().boundingBox(),
  ]);
  expect(Math.abs(words!.y + words!.height - (amount!.y + amount!.height))).toBeLessThan(10);

  // And nothing on the page is wider than the phone.
  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById("app-scroll")!;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the flight log fits a phone: three stats in a row, + Add flight at the right", async ({
  page,
}) => {
  await page.goto("/log");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Flight log" })).toBeVisible({
    timeout: 60_000,
  });

  // Three stat tiles on ONE row, not two and one.
  const tiles = main.getByText(/^(Hours this year|Flights|Landings)$/);
  await expect(tiles).toHaveCount(3);
  const tops = await tiles.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().top))
  );
  expect(new Set(tops).size).toBe(1);

  // "+ Add flight" is the primary (orange) button, at the far right of its row.
  const add = main.getByRole("button", { name: "Add flight" }).first();
  await expect(add).toHaveClass(/bg-indigo-600/);
  const mainBox = (await main.boundingBox())!;
  const addBox = (await add.boundingBox())!;
  expect(mainBox.x + mainBox.width - (addBox.x + addBox.width)).toBeLessThan(24);

  // Currency is one line — a verdict — with the rest behind the (i).
  await expect(main.getByRole("heading", { name: "Landing currency" })).toBeVisible();
  await expect(main.getByText(/^(Current|Not current)$/)).toBeVisible();
  await expect(main.getByText(/Day: \d+\/3 landings/)).toHaveCount(0);

  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById("app-scroll")!;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});


test("My plane fits a phone: no value runs over its label, no table scrolls sideways", async ({
  page,
}) => {
  await page.goto("/tools/my-plane");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "My plane", exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // Nothing wider than the phone — the page, or any of the three tables.
  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById("app-scroll")!;
    const tables = [...document.querySelectorAll("main .overflow-x-auto")].map(
      (box) => box.scrollWidth - box.clientWidth
    );
    return Math.max(scroller.scrollWidth - scroller.clientWidth, ...tables);
  });
  expect(overflow).toBeLessThanOrEqual(0);

  // In every figure row the value stays INSIDE the row, the name keeps a
  // usable width, and the two don't overlap. (The bug this guards: a long
  // value refused to shrink, crushed the name to a 0px column and ran past
  // the card's edge — which a plain overlap test misses, because a 0px-wide
  // name overlaps nothing.)
  const collisions = await page.evaluate(() => {
    const bad: string[] = [];
    for (const row of document.querySelectorAll("main ul > li")) {
      if (row.children.length < 2) continue;
      const r = row.getBoundingClientRect();
      const a = row.children[0].getBoundingClientRect();
      const b = row.children[row.children.length - 1].getBoundingClientRect();
      const name = (row.textContent ?? "").slice(0, 40);
      if (b.right > r.right + 1 || b.left < r.left - 1) bad.push(`value outside row: ${name}`);
      if (a.width < 80) bad.push(`name crushed to ${Math.round(a.width)}px: ${name}`);
      const overlap =
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      if (overlap) bad.push(`overlap: ${name}`);
    }
    return bad;
  });
  expect(collisions).toEqual([]);

  // And a figure's (i) sits on the line where its name ENDS, not on a line of
  // its own: the marker's vertical centre lies within the name's last line.
  const strays = await page.evaluate(() => {
    const bad: string[] = [];
    for (const marker of document.querySelectorAll('main li p button[aria-label^="Why:"]')) {
      const p = marker.closest("p")!;
      const lines = p.getClientRects();
      const last = [...lines].pop() ?? p.getBoundingClientRect();
      const m = marker.getBoundingClientRect();
      const centre = m.top + m.height / 2;
      const range = document.createRange();
      range.selectNodeContents(p);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const lastLine = rects.length ? rects[rects.length - 1] : last;
      if (centre < lastLine.top - 4 || centre > lastLine.bottom + 4) {
        bad.push(marker.getAttribute("aria-label") ?? "?");
      }
    }
    return bad;
  });
  expect(strays).toEqual([]);
});

/** The content column's left and right edges (main, inside its padding). */
async function contentEdges(page: import("@playwright/test").Page) {
  return page.getByRole("main").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return {
      left: box.left + parseFloat(css.paddingLeft),
      right: box.right - parseFloat(css.paddingRight),
    };
  });
}

test("Quick Log's File button runs the full width on a phone", async ({ page }) => {
  await page.goto("/quick-log");
  const file = page.getByRole("main").getByRole("button", { name: "File", exact: true });
  await expect(file).toBeVisible({ timeout: 60_000 });
  const edges = await contentEdges(page);
  const box = (await file.boundingBox())!;
  expect(Math.abs(box.x - edges.left)).toBeLessThan(2);
  expect(Math.abs(box.x + box.width - edges.right)).toBeLessThan(2);
});

test("Plane Status is readable at this width", async ({ page }) => {
  test.setTimeout(180_000);
  await expectStatusPagesReadable(page, "iphone");
});
