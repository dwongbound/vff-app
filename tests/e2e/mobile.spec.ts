// Phone-width pass over the app's responsive branches: the bottom tab bar
// replaces the top strip, the reservation list replaces the month grid, and
// the "+" FAB is how you book. Runs on real device presets (see
// playwright.config.ts projects) rather than a narrow desktop window.
import { expect, test } from "@playwright/test";
import { clearCheckoutDrafts, clearOpenSessions, openPostflightSection, signIn } from "./helpers";

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
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
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
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
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
