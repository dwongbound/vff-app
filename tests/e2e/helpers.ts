// Shared e2e helpers. Playwright loads env/test.env (see playwright.config.ts
// and the test:e2e script), so these read the same seed credentials the app
// server was started with.
import { Locator, Page, expect } from "@playwright/test";

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@vffclub.test";
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "flyvff123";
export const TAIL_NUMBER = process.env.SEED_TAIL_NUMBER ?? "N8318B";

/** Sign in through the real form and wait for the app to land on a tab. */
export async function signIn(
  page: Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD
) {
  await page.goto("/login");
  // Wait for hydration before typing: the login page renders on the server,
  // and React resets its controlled inputs when it takes over — so anything
  // typed before that moment silently disappears. The submit button is
  // disabled until the page is interactive (see app/login/page.tsx), which
  // makes "enabled" a reliable hydration signal.
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await submit.click();
  // The splash covers the app until AuthGate's /api/me probe resolves, so wait
  // for real page content rather than just the URL.
  await expect(
    page.getByRole("heading", { name: "Reservations", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await dismissTour(page);
}

/**
 * Close the first-run GuidedTour if it's up.
 *
 * Every seeded member has `tourSeenAt: null`, so the tour opens for all of
 * them — and it's a Modal, whose full-screen scrim swallows every click
 * underneath it. Without this, any spec that so much as taps a button after
 * signing in fails with "…bg-black/50 intercepts pointer events" rather than
 * anything to do with what it was testing.
 */
export async function dismissTour(page: Page) {
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  // Short timeout: a member who has already seen it never gets the dialog, and
  // that's a pass, not a wait.
  if (!(await skip.isVisible({ timeout: 5_000 }).catch(() => false))) return;

  // Skipping hides the tour immediately and PATCHes /api/me afterwards. Wait
  // for that write, not just for the card to go: a spec that navigates in
  // between can be served `tourSeenAt: null` again on the next page, and the
  // tour reappears mid-test to swallow a click that has nothing to do with it.
  const patched = page
    .waitForResponse(
      (r) =>
        r.url().includes("/api/me") &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 30_000 }
    )
    .catch(() => undefined);
  await skip.click();
  await expect(skip).toBeHidden({ timeout: 10_000 });
  await patched;
}

/**
 * Start the checkout pages from a clean card.
 *
 * The checkouts autosave: ticking anything writes a draft to the device and,
 * a couple of seconds later, an open Checkout row. Both are picked up on the
 * next visit — which is the feature, and which makes every spec that touches a
 * checkout leave a booby trap for the next one. A card that resumes half-ticked
 * turns "Check all" into "Clear" and makes a bare `0 of N checked` assertion
 * fail for reasons that have nothing to do with what's being tested.
 *
 * So specs that walk a card call this first. Both stores have to go: clearing
 * only localStorage leaves the server's copy to be resumed, and clearing only
 * the server leaves the device's, which wins the tie anyway.
 *
 * `page.request` shares the browser's cookies, so this is the signed-in
 * member's own drafts — the same ones the DELETE route will allow.
 */
export async function clearCheckoutDrafts(page: Page) {
  // Open flight SESSIONS go too. It stretches this helper's name, and it's the
  // same stretch that already sends it after the post-flight draft family: what
  // a spec needs before it walks a card is "none of my own half-finished flying
  // is lying around", and a signed-off preflight now leaves an unfiled log entry
  // as surely as a half-ticked card leaves a draft. Splitting them would mean
  // every spec remembering two calls that are never wanted apart.
  await clearOpenSessions(page);

  const response = await page.request.get(
    "/api/checkouts?mine=1&open=1&limit=100"
  );
  if (response.ok()) {
    for (const run of (await response.json()) as { id: string }[]) {
      await page.request.delete(`/api/checkouts/${run.id}`);
    }
  }

  // Needs a document on the origin to reach its localStorage; signIn leaves us
  // on /reservations, which is the same one.
  //
  // Both draft families: the post-flight form autosaves to the device too (see
  // lib/postflightDraft.ts), and a spec that fills half of it in leaves the
  // next one opening a form with somebody else's tach reading in it.
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (
        key.startsWith("vff:checkout-draft:") ||
        key.startsWith("vff:postflight-draft:")
      ) {
        window.localStorage.removeItem(key);
      }
    }
  });
}

/**
 * Delete any flight SESSION this member has open.
 *
 * The other half of `clearCheckoutDrafts`, and it exists for the same reason:
 * signing off a preflight card now OPENS a log entry, so a spec that walks a
 * card leaves an unfiled flight behind it. The next spec's post-flight submit
 * would then FINISH that entry rather than create one — which is correct
 * behaviour and the wrong precondition, since the two specs are about different
 * flights and only one row would exist for them.
 *
 * Deleting rather than filing: an open session left by a spec is a walk nobody
 * flew, and filing it would put a flight with no end reading into the log every
 * other spec then has to reason about.
 *
 * Belongs in the `beforeEach` of any spec that completes a checkout or files a
 * flight — which, between them, is most of them.
 */
export async function clearOpenSessions(page: Page) {
  const response = await page.request.get("/api/flights?mine=1&open=1&limit=100");
  if (!response.ok()) return;
  for (const flight of (await response.json()) as { id: string }[]) {
    await page.request.delete(`/api/flights/${flight.id}`);
  }
}

/**
 * Wait until the checkout on screen has reached the club's SERVER, not just the
 * device.
 *
 * Autosave writes localStorage synchronously and syncs on a debounce, so a spec
 * that ticks something and immediately navigates tears the page down with the
 * sync still pending — `page.goto` destroys the JS context and the request with
 * it. The symptom is not a failing save assertion (the device write already
 * succeeded) but something downstream going missing, which is a horrible thing
 * to debug.
 *
 * The draft bar distinguishes the two states deliberately: "Saved … on this
 * device · syncing to the club" until the row exists, "Saved · just now" once it
 * does. That second one is the only text that means the server has it.
 */
export async function waitForCheckoutSaved(page: Page) {
  await expect(page.getByRole("main").getByRole("status")).toHaveText(/^Saved · /, {
    timeout: 60_000,
  });
}

/** Go to a tab and wait for its heading (the splash fades out first). */
export async function gotoTab(page: Page, href: string, heading: string) {
  await page.goto(href);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Open one of the post-flight page's collapsible sections.
 *
 * The whole page is one accordion now — the turn-off card's sections and the
 * form's own groups (Meter readings, The flight, Servicing, Squawks) share a
 * single "one open at a time" run, so the same component draws all of them and
 * a member meets one interface across the three checkouts rather than two.
 *
 * The consequence for tests is that a collapsed section renders NO children at
 * all, so `getByLabel("Tach end")` finds nothing until its section is open.
 * Header names start with the number badge and end with the section's meta, so
 * these match on the title alone with a regex rather than an exact string.
 *
 * Idempotent: already-open sections are left alone, because toggling one shut
 * is exactly the failure this helper exists to prevent.
 */
export async function openPostflightSection(page: Page, title: RegExp) {
  // Matched on `aria-expanded` rather than by role+name, because the sticky
  // progress gauge renders a BUTTON PER SECTION too ("Go to Shutdown — 0 of 11
  // checked") and a name regex hits that one first. Only a section header
  // carries aria-expanded, which makes it the honest handle.
  const header = page
    .getByRole("main")
    .locator("button[aria-expanded]")
    .filter({ hasText: title })
    .first();
  await expect(header).toBeVisible({ timeout: 60_000 });
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
}

/** The meters live behind "Meter readings" now — the commonest one. */
export async function openMeters(page: Page) {
  await openPostflightSection(page, /Meter readings/);
}

/**
 * A real one-finger pull from right to left across the page, as TouchEvents —
 * what SwipePager listens for. `distance` is how far the finger travels; a
 * full pull on a phone is well past `commitDistance` (40% of the width).
 */
export async function swipeLeft(page: Page, distance = 260): Promise<void> {
  await page.evaluate(async (travel) => {
    const startX = Math.min(window.innerWidth - 20, 40 + travel);
    const y = Math.round(window.innerHeight / 2);
    const target = document.elementFromPoint(startX, y) ?? document.body;
    // Plain events carrying a `touches` list rather than real TouchEvents:
    // WebKit (the iPad and iPhone projects) refuses `new Touch(...)` from
    // script. SwipePager only reads `touches[i].clientX/Y`, so this drives
    // its real listeners the same way a finger does.
    const fire = (type: string, x: number) => {
      const touch = { identifier: 1, target, clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: type === "touchend" ? [] : [touch],
      });
      Object.defineProperty(event, "changedTouches", { value: [touch] });
      target.dispatchEvent(event);
    };
    fire("touchstart", startX);
    for (let step = 1; step <= 10; step++) {
      fire("touchmove", startX - (travel * step) / 10);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    fire("touchend", startX - travel);
  }, distance);
}

/**
 * Read a form's "Tach start" box once it has SETTLED.
 *
 * The start box follows the best reading the app knows — your open flight,
 * then today's preflight walk, then the last filed flight — until it's typed
 * in, and those answers arrive at different moments. Read too early and the
 * box changes under the test afterwards, so the flight files a different span
 * than the test typed ("Filed 1.3 hours" for a 1.2 it meant). Waiting for the
 * page to stop asking is what makes the value final.
 */
export async function settledTachStart(page: Page, scope: Page | Locator = page): Promise<string> {
  const box = scope.getByLabel("Tach start", { exact: true });
  await expect(box).not.toHaveValue("");
  await page.waitForLoadState("networkidle");
  return box.inputValue();
}

/**
 * Every visible text field under 16px, described — iOS Safari zooms the whole
 * page in when one of those is focused, and leaves it zoomed. The phone and
 * tablet specs walk the pages that have fields and assert this comes back
 * empty (the rule that makes it so is in app/globals.css).
 */
export async function fieldsThatZoomOnFocus(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const NOT_TEXT = new Set(["checkbox", "radio", "file", "hidden", "range", "submit", "button", "color"]);
    return [...document.querySelectorAll<HTMLInputElement>("input, select, textarea")]
      .filter((el) => !NOT_TEXT.has(el.type))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 1 && box.height > 1;
      })
      .map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }))
      .filter(({ size }) => size < 16)
      .map(({ el, size }) => `${size}px ${el.type} ${el.id || el.name || el.getAttribute("aria-label") || ""}`);
  });
}

/**
 * Anything drawn past either edge of the window, innermost offenders only —
 * except inside a box that is MEANT to scroll sideways (a wide table). Covers
 * sheets as well as the page, which `#app-scroll`'s own scrollWidth can't:
 * a modal is outside the scroller.
 */
export async function widerThanTheScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inSideScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };
    const out = [...document.querySelectorAll("body *")].filter((el) => {
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) return false;
      return (box.right > vw + 0.5 || box.left < -0.5) && !inSideScroller(el);
    });
    return out
      .filter((el) => !out.some((other) => other !== el && el.contains(other)))
      .slice(0, 5)
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}"> ${(el.textContent ?? "").slice(0, 40)}`);
  });
}

/**
 * The touch-screen form pass shared by the phone and tablet specs: every page
 * and sheet with fields on it, checked for a field that would zoom the page on
 * focus and for anything wider than the screen. Fails naming the place and the
 * offenders, so a regression says where it is.
 */
export async function expectFormsFitTouchScreen(page: Page) {
  const problems: string[] = [];
  const check = async (where: string) => {
    for (const f of await fieldsThatZoomOnFocus(page)) problems.push(`${where}: zooms on focus — ${f}`);
    for (const w of await widerThanTheScreen(page)) problems.push(`${where}: wider than the screen — ${w}`);
  };
  const main = page.getByRole("main");

  for (const [path, ready] of [
    ["/quick-log", "File"],
    ["/profile", "Save"],
  ] as const) {
    await page.goto(path);
    await expect(main.getByRole("button", { name: ready, exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await check(path);
  }

  await page.goto("/tools/weight-balance");
  await expect(main.locator("input").first()).toBeVisible({ timeout: 60_000 });
  await check("/tools/weight-balance");

  // The card's clock field is the widest field on any card.
  await page.goto("/preflight");
  await main.getByRole("button", { name: /^\d+\s*Cockpit.*\d+\/\d+$/ }).click();
  await expect(main.locator("input[type=time]").first()).toBeVisible();
  await check("/preflight › Cockpit");

  await page.goto("/postflight");
  for (const section of [/Meter readings/, /The flight/]) {
    await openPostflightSection(page, section);
    await check(`/postflight › ${section.source}`);
  }

  // The booking sheet — the date fields that started this.
  await page.goto("/reservations");
  await page.getByRole("button", { name: /^New( reservation)?$/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Start", { exact: true })).toBeVisible();
  await check("booking sheet");
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();

  await page.goto("/log");
  await main.getByRole("button", { name: /Add flight/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await check("add-flight sheet");

  expect(problems, problems.join("\n")).toEqual([]);
}

/**
 * Rows on a list page get (nearly) the card's whole width for their text,
 * rather than a squeezed column beside a control. `rows` are the cards; the
 * first child block of each is its text.
 */
async function expectRowsNotSqueezed(rows: Locator, label: string) {
  expect(await rows.count(), `${label}: no rows to check`).toBeGreaterThan(0);
  for (const row of (await rows.all()).slice(0, 3)) {
    const rowWidth = (await row.boundingBox())!.width;
    const text = (await row.locator("p").first().boundingBox())!.width;
    expect(text, `${label}: a row's text is squeezed beside its controls`).toBeGreaterThan(
      rowWidth * 0.6
    );
  }
}

/**
 * Plane Status is readable at this width — the overview, the squawk list and
 * the maintenance sheet: nothing past the edge of the screen, and no list's
 * text crushed into a column beside its buttons or picker. Shared by the phone
 * and tablet specs; saves screenshots under test-results/ for a human to look
 * at.
 */
export async function expectStatusPagesReadable(page: Page, device: string) {
  const main = page.getByRole("main");

  await page.goto("/status");
  // The tach FIGURE, not the "Tach" label: the label is drawn under the
  // splash before the page's data has even been asked for. Then wait for the
  // splash itself to go, or the screenshot is of the splash.
  await expect(main.getByText(/^\d+\.\d\s*hrs$/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 60_000 });
  expect(await widerThanTheScreen(page)).toEqual([]);
  await page.screenshot({ path: `test-results/status-${device}.png` });

  await page.goto("/status/squawks");
  const squawks = main.locator("li[id^=squawk-]");
  await expect(squawks.first()).toBeVisible({ timeout: 60_000 });
  expect(await widerThanTheScreen(page)).toEqual([]);
  await expectRowsNotSqueezed(squawks, "squawks");
  // A squawk's details fold behind "Details" on a phone; from the iPad up
  // they're just shown, with nothing to hide them.
  if (device === "iphone") {
    await expect(squawks.getByRole("button", { name: "Details" }).first()).toBeVisible();
  } else {
    await expect(squawks.getByRole("button", { name: /^(Details|Hide)$/ })).toHaveCount(0);
  }
  await page.screenshot({ path: `test-results/squawks-${device}.png` });

  await page.goto("/status/maintenance");
  const sheet = main.locator("ul.\\@container").first();
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  expect(await widerThanTheScreen(page)).toEqual([]);
  await expectRowsNotSqueezed(sheet.locator(":scope > li"), "maintenance");
  await page.screenshot({ path: `test-results/maintenance-${device}.png` });
}
