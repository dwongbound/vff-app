// Shared e2e helpers. Playwright loads env/test.env (see playwright.config.ts
// and the test:e2e script), so these read the same seed credentials the app
// server was started with.
import { Page, expect } from "@playwright/test";

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
