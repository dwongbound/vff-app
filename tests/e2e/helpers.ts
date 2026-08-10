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

/** Go to a tab and wait for its heading (the splash fades out first). */
export async function gotoTab(page: Page, href: string, heading: string) {
  await page.goto(href);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({
    timeout: 60_000,
  });
}
