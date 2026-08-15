// The squawk lifecycle, which is the app's one piece of genuinely safety-
// relevant behaviour.
//
// The shape to protect: a member REPORTS, the Safety Officer RULES. Filing a
// squawk can't ground the airplane by itself (that used to be a severity the
// reporter picked); grounding is a status only `squawk:manage` can set, and it
// has to stop the whole club until it's cleared.
//
// Two things every test here has to respect, both learned the hard way:
//
//   • Titles are prefixed "E2E " so they can't collide with the seeded squawk
//     ("Right brake feels soft"), which `.first()` would otherwise match — and
//     which the seed leaves at REVIEWED_IN_WORK, not New.
//   • The seed is reset once per RUN, not per test, so anything that changes a
//     squawk's status must put it back — otherwise a retry re-runs against an
//     airplane the previous attempt left grounded, and so does every test after
//     it. Each test also files its own uniquely-titled squawk rather than
//     reusing a seeded one.
//   • "Do not fly" appears TWICE on a grounded page — once in the Status
//     layout's card and once in the navbar banner ("…Do not fly until it's
//     signed off"). Assertions here name the role, not the bare text.
import { expect, test, type Page } from "@playwright/test";
import {
  clearCheckoutDrafts,
  gotoTab,
  signIn,
  waitForCheckoutSaved,
} from "./helpers";

/** A seeded member with no admin flag and no office. */
const PLAIN_MEMBER = "alex@vffclub.test";

/** The Status layout's dispatch card, as opposed to the navbar banner. */
const doNotFlyCard = (page: Page) =>
  page.getByRole("heading", { name: /Do not fly/ });
const inMaintenanceCard = (page: Page) =>
  page.getByRole("heading", { name: /In maintenance/ });
/** The app-wide banner, which only the navbar renders. */
const groundedBanner = (page: Page) => page.getByText(/is grounded:/);

/** File a squawk from the preflight checkout, the way a member actually does. */
async function fileSquawk(page: Page, title: string) {
  // Start from a clean card. These specs share one database and the checkouts
  // autosave, so an earlier call's ticks are still on the airplane — and a
  // section that is ALREADY complete offers "Clear", not "Check all", so the
  // click below waits 90 seconds for a button that will never appear. Must run
  // before navigating: once the page has loaded it has already seeded React
  // from the stored draft, and clearing storage then changes nothing on screen.
  await clearCheckoutDrafts(page);
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: "Report" }).click();
  await page.getByLabel("What's wrong?").fill(title);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Check all" }).first().click();
  // Autosave files it: the ticks reach the device instantly and the club's
  // server a couple of seconds later, and the squawk goes up with that first
  // sync. There is no Save button to press any more — so wait for the SERVER
  // to have it, or the caller's next navigation kills the request mid-flight.
  await waitForCheckoutSaved(page);
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/squawks?status=open&limit=50");
        const rows = res.ok() ? ((await res.json()) as { title: string }[]) : [];
        return rows.some((s) => s.title === title);
      },
      { timeout: 60_000 }
    )
    .toBe(true);
}

/**
 * The Squawks-tab row for one squawk.
 *
 * Scoped to the named list on purpose: when the airplane is grounded, the
 * Status LAYOUT also renders an <li> per grounded squawk in its "do not fly"
 * card, and a bare `locator("li").first()` matches that one — which has no
 * status picker, so every triage step silently times out.
 */
function rowFor(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Squawks" })
    .getByRole("listitem")
    .filter({ hasText: title })
    .first();
}

/**
 * The status control on one row.
 *
 * It is a chip picker rather than a native <select> (the five statuses are a
 * dispatch decision, and rendering "okay to fly" and "grounded" in identical
 * grey buries that) — so it's a BUTTON that opens a listbox, not a combobox.
 * Named "Status" followed by the current value, which is why this matches on
 * the prefix: the whole point of the control is that the rest of the name
 * changes.
 */
const statusPicker = (row: ReturnType<typeof rowFor>) =>
  row.getByRole("button", { name: /^Status/ });

/** `label` matches the option's visible chip text, e.g. /aircraft grounded/. */
async function setStatus(page: Page, title: string, label: RegExp) {
  await page.goto("/status/squawks");
  const row = rowFor(page, title);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await statusPicker(row).click();
  // Scoped to this row: every open picker on the page renders its own listbox.
  await row.getByRole("option", { name: label }).click();
}

test("a member files a squawk as New and cannot triage it", async ({ page }) => {
  await signIn(page, PLAIN_MEMBER);
  await fileSquawk(page, "E2E left tyre wearing unevenly");

  await page.goto("/status/squawks");
  const row = rowFor(page, "E2E left tyre wearing unevenly");
  await expect(row).toBeVisible({ timeout: 60_000 });
  // Filed as New, and this member gets no way to change that. A plain member's
  // row has no status picker, so the badge is the only "New" in it.
  await expect(row.getByText("New")).toBeVisible();
  await expect(page.getByText(/Read-only/)).toBeVisible();
  await expect(statusPicker(row)).toHaveCount(0);
});

test("the member's squawk form has no severity picker", async ({ page }) => {
  await signIn(page, PLAIN_MEMBER);
  await gotoTab(page, "/preflight", "Preflight");
  await page.getByRole("button", { name: "Report" }).click();

  await expect(page.getByLabel("Severity")).toHaveCount(0);
  await expect(page.getByText(/files as/)).toBeVisible();
});

test("Overview and Squawks are rail children of Plane Status", async ({ page }) => {
  await signIn(page);
  await gotoTab(page, "/status", "N8318B");

  // Both live in the nav rail under Plane Status, like the checkouts — NOT as
  // tabs drawn inside the page.
  const rail = page.locator("aside");
  await expect(rail.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Squawks" })).toBeVisible();

  // Overview is the default child. Named by role — "Hours flown" also appears
  // in the chart's screen-reader table caption.
  await expect(page.getByRole("heading", { name: "Hours flown" })).toBeVisible();

  await rail.getByRole("link", { name: "Squawks" }).click();
  await expect(page).toHaveURL(/\/status\/squawks/);
  // The airplane header comes from the shared layout, so it survives the hop.
  await expect(page.getByRole("heading", { name: "N8318B" })).toBeVisible();

  await rail.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/status$/);
  await expect(page.getByRole("heading", { name: "Hours flown" })).toBeVisible();
});

test("grounding a squawk stops the club until it is closed", async ({ page }) => {
  // The seeded admin holds every capability, squawk:manage included.
  await signIn(page);
  const title = "E2E vacuum pump failed";
  await fileSquawk(page, title);

  // Filing alone must NOT ground the airplane — scoped to this squawk's own
  // row rather than the global banner, so the assertion says what it means
  // even if something else on the airplane is open. Read off the picker's
  // accessible name ("Status New"), which is the current value: the chip in
  // the row's header says the same thing, so matching bare text is ambiguous.
  await page.goto("/status/squawks");
  await expect(statusPicker(rowFor(page, title))).toHaveAccessibleName(
    /^Status\s+New/,
    { timeout: 60_000 }
  );

  try {
    await setStatus(page, title, /aircraft grounded/);
    await expect(doNotFlyCard(page)).toBeVisible({ timeout: 60_000 });

    // The banner is app-wide, not page-local.
    await gotoTab(page, "/reservations", "Reservations");
    await expect(groundedBanner(page)).toBeVisible({ timeout: 60_000 });
  } finally {
    // Always put the airplane back, or every later test inherits a grounding.
    await setStatus(page, title, /^Closed/);
  }

  await expect(doNotFlyCard(page)).toBeHidden({ timeout: 60_000 });
  await expect(groundedBanner(page)).toBeHidden();
});

test("in work reads as maintenance, not as a grounding", async ({ page }) => {
  await signIn(page);
  const title = "E2E nose strut over extended";
  await fileSquawk(page, title);

  try {
    await setStatus(page, title, /in work/);

    await expect(inMaintenanceCard(page)).toBeVisible({ timeout: 60_000 });
    // The distinction that matters: the shop has it, but it isn't grounded.
    await expect(doNotFlyCard(page)).toBeHidden();
    await expect(groundedBanner(page)).toBeHidden();
  } finally {
    await setStatus(page, title, /^Closed/);
  }
});

// Filing one by hand, from the sheet itself.
//
// Every squawk used to arrive attached to a checkout or a flight, which covers
// the fault you find while walking the airplane — but not the one somebody
// notices in the clubhouse, remembers two days later, or is told about over the
// phone. Those had nowhere to go, and a fault with nowhere to go doesn't get
// written down.
test("a squawk can be filed straight from the sheet, and lands as New", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/status/squawks");

  const title = `E2E clubhouse report ${Date.now()}`;
  await page.getByRole("button", { name: "Add a squawk" }).click();
  await page.getByLabel("What's wrong?").fill(title);
  // `exact` matters: a loose "Add" also matches "Add a squawk" behind the modal.
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const row = rowFor(page, title);
  await expect(row).toBeVisible({ timeout: 60_000 });
  // Reporting is not triaging: it starts at New however it was filed, and the
  // API refuses to read a status off the body at all.
  //
  // Read off the PICKER's accessible name rather than the row's text: an
  // officer's row says "New" twice — once on the badge, once as the chip
  // picker's current value — and a bare text match is a strict-mode violation.
  await expect(statusPicker(row)).toHaveAccessibleName(/New/);
});

// Reporting is open to every member, not just the Safety Officer — the
// capability gates TRIAGE, and a member who can't report a fault is a member
// who flies with it.
test("an ordinary member can file one too, but still cannot triage it", async ({
  page,
}) => {
  await signIn(page, PLAIN_MEMBER);
  await page.goto("/status/squawks");

  const title = `E2E member report ${Date.now()}`;
  await page.getByRole("button", { name: "Add a squawk" }).click();
  await page.getByLabel("What's wrong?").fill(title);
  // `exact` matters: a loose "Add" also matches "Add a squawk" behind the modal.
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const row = rowFor(page, title);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(statusPicker(row)).toHaveCount(0);
});
