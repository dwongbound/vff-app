// CFIs: the sign-up codes that create them, the reduced app they get, and the
// signature they put on a lesson's flight-log entry.
//
// The seed provides everything these lean on (prisma/seed.ts):
//   • Priya Raman — an INSTRUCTOR who is NOT a club member, so she's the
//     restricted account in its pure form.
//   • Two sign-up codes, VFF-MEMBER and VFF-CFI.
//   • One flown lesson filed against a TRAINING booking with Priya on it,
//     unsigned — the row her queue exists for.
//
// Two habits from the rest of the suite apply here as well: the seed is reset
// once per RUN, so anything that changes shared state puts it back; and setup
// that isn't what the test is about goes through `page.request` rather than by
// driving another page's UI (see runway.spec.ts).
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, dismissTour, gotoTab, signIn } from "./helpers";

const INSTRUCTOR_EMAIL = "priya@vffclub.test";
const INSTRUCTOR_NAME = "Priya Raman";
/** A seeded member with no admin flag and no office. */
const PLAIN_MEMBER = "alex@vffclub.test";
/** The member the seeded lesson was flown by. */
const STUDENT = "jamie@vffclub.test";

const MEMBER_CODE = "VFF-MEMBER";
const CFI_CODE = "VFF-CFI";

/** Unique per run, so a retry can't collide with the account it just made. */
const freshEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@vffclub.test`;

/**
 * The page's own content column.
 *
 * Assertions about what a page offers are scoped to this rather than to the
 * whole document: the nav rail, the bottom pill and GuidedTour's spotlight all
 * render their own copies of controls, and a bare `getByRole("button", …)`
 * picks those up too — which is a strict-mode violation on a good day and a
 * false pass on a bad one.
 */
const content = (page: Page) => page.getByRole("main");

/**
 * Create an account through the real sign-up form.
 *
 * Returns the error the form showed, or null when it went through — the
 * refusal cases are half of what this file is testing, so the failure path is
 * a return value rather than a thrown assertion.
 */
async function signUp(
  page: Page,
  { code, email }: { code: string; email: string }
): Promise<string | null> {
  await page.goto("/login");
  const signUpLink = page.getByRole("button", { name: "Sign up", exact: true });
  await expect(signUpLink).toBeEnabled({ timeout: 60_000 });
  await signUpLink.click();

  await page.getByLabel("Sign-up code").fill(code);
  await page.getByLabel("Name", { exact: true }).fill("E2E Newcomer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Confirm password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Creating account|Sign up/ }).click();

  // Either the app lands (the sign-up worked and auto-signed us in) or the
  // form shows why it didn't. Race them rather than waiting for one and
  // timing out on the other.
  const landed = page
    .getByRole("heading", { name: "Reservations", exact: true })
    .waitFor({ timeout: 30_000 })
    .then(() => null as string | null)
    .catch(() => undefined);
  const refused = page
    .locator("p.text-red-600")
    .first()
    .textContent({ timeout: 30_000 })
    .catch(() => undefined);

  const outcome = await Promise.race([landed, refused]);
  // A brand-new account has `tourSeenAt: null`, so GuidedTour opens over the
  // app it just landed in — and it SPOTLIGHTS live controls by rendering its
  // own copy of them, which turns every `getByRole("button", …)` below into a
  // strict-mode violation. Same reason `signIn` does this (see helpers.ts).
  if (outcome == null) await dismissTour(page);
  return outcome ?? null;
}

test.describe("sign-up codes", () => {
  test("a code is required, and a wrong one is refused", async ({ page }) => {
    // The club already has members, so the bootstrap exception doesn't apply.
    const noCode = await signUp(page, { code: "", email: freshEmail("nocode") });
    expect(noCode).toMatch(/sign-up code is required/i);

    const wrongCode = await signUp(page, {
      code: "NOT-A-REAL-CODE",
      email: freshEmail("wrong"),
    });
    expect(wrongCode).toMatch(/isn't valid/i);
  });

  test("the member code creates a flying member", async ({ page }) => {
    expect(
      await signUp(page, { code: MEMBER_CODE, email: freshEmail("member") })
    ).toBeNull();

    // A flying member gets the whole app: the booking button and Finances.
    await expect(
      content(page).getByRole("button", { name: "New" })
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator("aside").getByRole("link", { name: "Finances" })
    ).toBeVisible();
  });

  test("the instructor code creates a CFI who can't book or see money", async ({
    page,
  }) => {
    // Case and spacing don't matter — the code gets read down a phone.
    expect(
      await signUp(page, { code: " vff-cfi ", email: freshEmail("cfi") })
    ).toBeNull();

    await expect(
      page.getByRole("heading", { name: "Reservations", exact: true })
    ).toBeVisible({ timeout: 60_000 });

    // Read-only calendar: no "New", no per-day "+", and the filter offers
    // "Teaching" rather than "Mine" (they have no bookings of their own).
    await expect(content(page).getByRole("button", { name: "New" })).toHaveCount(0);
    await expect(
      content(page).getByRole("button", { name: /^Book the airplane on/ })
    ).toHaveCount(0);
    await expect(
      content(page).getByRole("button", { name: "Teaching" })
    ).toBeVisible();

    // No Finances tab, in either navigation.
    await expect(
      page.locator("aside").getByRole("link", { name: "Finances" })
    ).toHaveCount(0);

    // …and the URL agrees with the nav rather than the tab merely being hidden.
    const refused = await page.request.get("/api/finances");
    expect(refused.status()).toBe(403);
  });
});

test.describe("what a CFI account can reach", () => {
  test("keeps the airplane, the checkouts, the tools and the log", async ({
    page,
  }) => {
    await signIn(page, INSTRUCTOR_EMAIL);
    const rail = page.locator("aside");

    // Groups are buttons in the rail (they expand a sub-list); leaves are links.
    await expect(rail.getByRole("button", { name: /Plane Status/ })).toBeVisible();
    await expect(rail.getByRole("button", { name: /Checkouts/ })).toBeVisible();
    await expect(rail.getByRole("button", { name: /Tools/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Flight Log" })).toBeVisible();
    // The one tab an instructor-only account doesn't get.
    await expect(rail.getByRole("link", { name: "Finances" })).toHaveCount(0);
  });

  test("is refused a booking even if it asks the API directly", async ({
    page,
  }) => {
    await signIn(page, INSTRUCTOR_EMAIL);
    // The calendar hides its controls; this is the control.
    const aircraft = await (await page.request.get("/api/aircraft")).json();
    const refused = await page.request.post("/api/reservations", {
      data: {
        aircraftId: aircraft[0].id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        purpose: "LOCAL",
      },
    });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toMatch(/teaches here rather than flying here/i);
  });
});

test.describe("naming a CFI on a lesson", () => {
  test("the instructor picker appears only for training", async ({ page }) => {
    await signIn(page, PLAIN_MEMBER);
    await gotoTab(page, "/reservations", "Reservations");
    await content(page).getByRole("button", { name: "New" }).click();

    // A local flight has no instructor field at all.
    await expect(page.getByLabel("Instructor (optional)")).toHaveCount(0);

    await page.getByLabel("Purpose").selectOption("TRAINING");
    const picker = page.getByLabel("Instructor (optional)");
    await expect(picker).toBeVisible();
    // The club's CFIs, and nobody else — the seeded admin is not one.
    await expect(picker.getByRole("option", { name: INSTRUCTOR_NAME })).toHaveCount(1);
    await expect(picker.getByRole("option", { name: "Club Admin" })).toHaveCount(0);

    // Switching back to a non-lesson takes the field away with it.
    await page.getByLabel("Purpose").selectOption("LOCAL");
    await expect(page.getByLabel("Instructor (optional)")).toHaveCount(0);
  });

  test("a booked instructor is refused if they aren't one", async ({ page }) => {
    await signIn(page, PLAIN_MEMBER);
    const aircraft = await (await page.request.get("/api/aircraft")).json();
    const members = await (await page.request.get("/api/members")).json();
    const notACfi = members.find(
      (m: { positions: string[] }) => !m.positions.includes("INSTRUCTOR")
    );

    const refused = await page.request.post("/api/reservations", {
      data: {
        aircraftId: aircraft[0].id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        purpose: "TRAINING",
        instructorId: notACfi.id,
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toMatch(/isn't a flight instructor/i);
  });
});

test.describe("signing a flight-log entry", () => {
  /** The seeded lesson, which starts every run unsigned. */
  async function seededLesson(page: Page) {
    const aircraft = await (await page.request.get("/api/aircraft")).json();
    const flights = await (
      await page.request.get(`/api/flights?aircraftId=${aircraft[0].id}&limit=300`)
    ).json();
    const lesson = flights.find(
      (f: { instructor: { name: string } | null }) =>
        f.instructor?.name === INSTRUCTOR_NAME
    );
    expect(lesson, "the seed should provide one unsigned lesson").toBeTruthy();
    return lesson;
  }

  test("the CFI's Teaching tab is their signature queue", async ({ page }) => {
    await signIn(page, INSTRUCTOR_EMAIL);
    await gotoTab(page, "/log", "Flight log");

    // For an instructor the switch is Club / Teaching, not Club / Mine.
    await page.getByRole("button", { name: "Teaching" }).click();
    // By ROLE: the stat tile above says "Awaiting your signature" too.
    await expect(
      page.getByRole("heading", { name: /awaiting your signature/i })
    ).toBeVisible({ timeout: 60_000 });
    // Their own flying isn't the subject here, so the landing-currency card —
    // a pilot's question — is not on this tab.
    await expect(page.getByText("Your landing currency")).toHaveCount(0);
  });

  test("only the named instructor may sign, and the date is recorded", async ({
    page,
  }) => {
    // Somebody else's signature is refused, admin or not.
    await signIn(page);
    const lesson = await seededLesson(page);
    const asAdmin = await page.request.post(`/api/flights/${lesson.id}/sign`);
    expect(asAdmin.status()).toBe(403);
    expect(await asAdmin.text()).toMatch(/only the instructor named/i);

    // The CFI signs it from the log, the way they really would.
    await signIn(page, INSTRUCTOR_EMAIL);
    await gotoTab(page, "/log", "Flight log");
    await page.getByRole("button", { name: "Teaching" }).click();

    const row = page.getByRole("listitem").filter({ hasText: "Awaiting signature" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole("button").first().click();

    try {
      await page.getByRole("button", { name: "Sign this entry" }).click();
      // Scoped to the modal: the list row behind it carries the same chip.
      await expect(
        page.getByRole("dialog").getByText("Signed", { exact: true })
      ).toBeVisible({ timeout: 30_000 });

      // The date is stored, not just a flag — that's the whole point of the
      // signature, and it's what an edit gets compared against.
      const signed = await seededLesson(page);
      expect(signed.signedAt).toBeTruthy();
      expect(signed.signedBy.name).toBe(INSTRUCTOR_NAME);
    } finally {
      // Put the lesson back so a retry (and every later test) starts unsigned.
      await page.request.delete(`/api/flights/${lesson.id}/sign`);
    }
  });

  test("an entry edited after signing says so", async ({ page }) => {
    await signIn(page, INSTRUCTOR_EMAIL);
    const lesson = await seededLesson(page);
    await page.request.post(`/api/flights/${lesson.id}/sign`);

    try {
      // The student corrects their own entry AFTER the CFI signed it. Not an
      // error — but the signature covers a different version now.
      await signIn(page, STUDENT);
      const corrected = await page.request.patch(`/api/flights/${lesson.id}`, {
        data: { notes: "Nine in the pattern, not eight." },
      });
      expect(corrected.ok()).toBeTruthy();

      await gotoTab(page, "/log", "Flight log");
      const row = page
        .getByRole("listitem")
        .filter({ hasText: "Signed, then edited" })
        .first();
      await expect(row).toBeVisible({ timeout: 60_000 });

      await row.getByRole("button").first().click();
      await expect(page.getByText(/after it was signed/i)).toBeVisible();
      // And the entry carries its own last-edited stamp to compare.
      await expect(page.getByText(/last edited/i)).toBeVisible();
    } finally {
      await signIn(page, INSTRUCTOR_EMAIL);
      await page.request.delete(`/api/flights/${lesson.id}/sign`);
    }
  });
});

test.describe("admin controls", () => {
  test("only an admin can make a CFI a flying member", async ({ page }) => {
    await signIn(page);
    await gotoTab(page, "/members", "Members");

    // Scoped to her row on purpose: the sign-up tests above create instructor
    // accounts of their own, so this badge is not unique on the page.
    const row = page
      .locator("div")
      .filter({ hasText: INSTRUCTOR_NAME })
      .filter({ has: page.getByRole("button", { name: /^Set roles for/ }) })
      .last();
    await expect(row.getByText("Teaches here only")).toBeVisible();

    await page
      .getByRole("button", { name: `Set roles for ${INSTRUCTOR_NAME}` })
      .click();
    const membership = page.getByRole("button", {
      name: /Flying member of the club/,
    });
    await expect(membership).toHaveAttribute("aria-pressed", "false");

    try {
      await membership.click();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(row.getByText("Teaches here only")).toBeHidden({
        timeout: 30_000,
      });

      // Which is the whole difference: she can book now.
      await signIn(page, INSTRUCTOR_EMAIL);
      await expect(
        content(page).getByRole("button", { name: "New" })
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      // Back to a visiting instructor, or later runs start from the wrong club.
      await signIn(page);
      const members = await (await page.request.get("/api/members")).json();
      const cfi = members.find((m: { name: string }) => m.name === INSTRUCTOR_NAME);
      await page.request.patch(`/api/members/${cfi.id}`, {
        data: { clubMember: false },
      });
    }
  });

  test("a plain member sees no sign-up codes", async ({ page }) => {
    await signIn(page, PLAIN_MEMBER);
    await page.goto("/settings");
    await expect(page.getByText(/Only club admins can change/)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("New account codes")).toHaveCount(0);

    const refused = await page.request.get("/api/signup-codes");
    expect(refused.status()).toBe(403);
  });

  test("an admin can add and retire a code", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page.getByText("New account codes")).toBeVisible({
      timeout: 60_000,
    });

    // Both lists are on screen, separately, because which one a code is on is
    // the only thing about it that matters when you read it out.
    await expect(page.getByText("Member codes")).toBeVisible();
    await expect(page.getByText("Instructor (CFI) codes")).toBeVisible();

    const code = `E2E-${Date.now()}`;
    await page.getByRole("button", { name: /Add a member code/i }).click();
    // Only one add-form is ever open, so the field is unique once it is. It
    // needs `exact` all the same: "Code" otherwise matches every "Retire code
    // …" button's aria-label too.
    const field = page.getByLabel("Code", { exact: true });
    await expect(field).toBeVisible();
    await field.fill(code);
    await page.getByRole("button", { name: "Create code" }).click();

    await expect(page.getByText(code)).toBeVisible({ timeout: 30_000 });

    // Retiring closes it without deleting the record of it.
    await page.getByRole("button", { name: `Retire code ${code}` }).click();
    await expect(
      page.getByRole("button", { name: `Reopen code ${code}` })
    ).toBeVisible({ timeout: 30_000 });

    // A retired code no longer lets anyone in.
    expect(await signUp(page, { code, email: freshEmail("retired") })).toMatch(
      /isn't valid/i
    );
  });
});
