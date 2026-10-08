import { expect, test, type Page } from "@playwright/test";
import { clearOpenSessions, gotoTab, signIn } from "./helpers";

// The club's books, end to end.
//
// This is the one tab where a bug costs somebody money, and it was the only
// feature-sized page with no e2e coverage at all — the unit tests prove the
// arithmetic in lib/finance.ts, but nothing proved that reading the books
// materialises dues, that an officer's one-off line reaches the member it
// names, or that voiding leaves the trail behind instead of deleting it.
//
// The page is every month at once now — newest first, sticky month headers,
// older months loaded as you scroll — with three views: Mine, Club (by
// person) and Club (by month). Every change to a line (Paid, Void, the trash
// can) goes through a confirmation dialog first.
//
// Cast (from prisma/seed.ts):
//   admin@vffclub.test  — club admin, holds every capability implicitly
//   robin@vffclub.test  — Finance Officer, the office that owns this tab
//   alex@vffclub.test   — plain member, sees only their own statement
//
// Assertions are scoped to <main>: the rail and the bottom pill both render
// their own "Finances" control, so an unscoped match is a strict-mode
// violation on a good day and a false pass on a bad one.

/** "October 2026" — how a month header reads, `monthsAgo` before this one. */
function monthName(monthsAgo = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" }
  );
}

/** Local noon on the 10th, `monthsAgo` back — inside that month in any TZ. */
function dayIn(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 10);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-10T12:00:00`;
}

/** A label nobody else's line will carry, so retries never collide. */
function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}`;
}

async function memberId(page: Page, name: string): Promise<string> {
  const roster = await page.request.get("/api/members").then((r) => r.json());
  const found = roster.find((m: { name: string }) => m.name === name);
  if (!found) throw new Error(`No member named ${name}`);
  return found.id;
}

/** Add a one-off through the API (the signed-in caller must hold finance:manage). */
async function addCharge(
  page: Page,
  body: Record<string, unknown>
): Promise<{ id: string; member: { name: string } | null; period: string }> {
  const res = await page.request.post("/api/finances/charges", { data: body });
  expect(res.status()).toBe(201);
  return res.json();
}

function figureLine(page: Page, label: string) {
  return page
    .getByRole("main")
    .getByRole("heading", { name: label, exact: true })
    .locator("xpath=following-sibling::p[1]");
}

/** The figure in the club summary card under the given label, in cents. */
async function figure(page: Page, label: string): Promise<number> {
  const text = await figureLine(page, label).locator("span").first().innerText();
  return Math.round(Number(text.replace(/[^0-9.-]/g, "")) * 100);
}

/**
 * The bracket beside the club balance, signed from the club's side: "(missing
 * $40.00)" = +4000, "(owes $40.00)" = -4000, none = 0.
 */
async function unsettled(page: Page): Promise<number> {
  const text = await figureLine(page, "Club balance").innerText();
  const match = text.match(/\((missing|owes) \$([\d,.]+)\)/);
  if (!match) return 0;
  const cents = Math.round(Number(match[2].replace(/,/g, "")) * 100);
  return match[1] === "owes" ? -cents : cents;
}

async function openView(page: Page, view: "Mine" | "Club (by person)" | "Club (by month)") {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: view, exact: true }).click();
  await expect(main.getByRole("button", { name: view, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
}

test("a member's statement materialises this month's dues on first read", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  // A plain member gets their own books and no club view.
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Club (by person)" })).toBeHidden();
  await expect(main.getByRole("button", { name: "Club (by month)" })).toBeHidden();

  // Nothing schedules dues — reading the books is what writes them, which is
  // why the club needs no cron. The seed backdates the $250 rule to the 1st of
  // the current month, so it must be on this statement.
  await expect(main.getByRole("heading", { name: monthName() })).toBeVisible();
  const row = main.getByRole("row").filter({ hasText: "Monthly membership" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Dues")).toBeVisible();
  await expect(row.getByText("$250.00").first()).toBeVisible();
});

test("reading the books twice does not bill them twice", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await expect(
    main.getByRole("row").filter({ hasText: "Monthly membership" })
  ).toHaveCount(1);

  // The unique index on (memberId, recurringChargeId, period) is what makes
  // this idempotent; a second read must find the line, not add one.
  await page.reload();
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    main.getByRole("row").filter({ hasText: "Monthly membership" })
  ).toHaveCount(1);
});

test("a plain member cannot add charges, for a member or for the club", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();
  await expect(main.getByRole("button", { name: "One Off" })).toBeHidden();
  await expect(main.getByRole("button", { name: "Recurring" })).toBeHidden();
  // No line actions on a member's own statement either.
  await expect(main.getByRole("button", { name: "Void" })).toHaveCount(0);

  // And not through the API either — the button being absent is a UI courtesy,
  // `finance:manage` is the actual rule.
  const res = await page.request.post("/api/finances/charges", {
    data: { memberId: "anyone", description: "Nice try", amountDollars: 10 },
  });
  expect(res.status()).toBe(403);
  const club = await page.request.post("/api/finances/charges", {
    data: { club: true, description: "Nice try", amountDollars: 10 },
  });
  expect(club.status()).toBe(403);
});

test("asking for the club's ledger without the office returns your own", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  const page1 = await page.request
    .get("/api/finances/ledger?all=1")
    .then((r) => r.json());
  // Same privacy rule as the monthly statement: not a 403, not everyone's.
  expect(page1.clubWide).toBe(false);
  const owners = new Set(
    page1.months.flatMap((m: { charges: { member: { name: string } | null }[] }) =>
      m.charges.map((c) => c.member?.name ?? "CLUB")
    )
  );
  expect([...owners].every((n) => n === "Alex Rivera")).toBe(true);
  expect(page1.summary.clubOutstandingCents).toBe(0);
});

test("the Finance Officer charges a member, and it lands on their statement", async ({
  page,
}) => {
  const label = unique("Headset replacement");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await main.getByRole("button", { name: "One Off" }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Charge a member")).toBeVisible();
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("42.50");
  await modal.getByRole("button", { name: "Add charge" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // Club (by person) groups the month by member, so the line sits in Alex's card.
  await openView(page, "Club (by person)");
  const card = main
    .getByRole("region", { name: monthName(0) })
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Alex Rivera", exact: true }) })
    .filter({ has: page.getByRole("table") })
    .last();
  await expect(card.getByRole("row").filter({ hasText: label })).toBeVisible({
    timeout: 30_000,
  });

  // And the member sees it on their own statement, positive = they owe it.
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const mine = page.getByRole("main");
  const row = mine.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("$42.50")).toBeVisible();
});

test("a credit is stored negative and reads as money owed back", async ({
  page,
}) => {
  const label = unique("Fuel receipt — Tacoma");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await main.getByRole("button", { name: "One Off" }).click();

  const modal = page.getByRole("dialog");
  // The direction toggle owns the sign — the amount field stays positive, so a
  // typo can't turn a refund into a charge.
  await modal.getByRole("button", { name: /^Credit/ }).click();
  await expect(modal.getByText("Credit a member")).toBeVisible();
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("60.00");
  await modal.getByRole("button", { name: "Add credit" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const row = page.getByRole("main").getByRole("row").filter({ hasText: label });
  await expect(row.getByText("-$60.00")).toBeVisible({ timeout: 30_000 });
});

test("the month header's button adds a line to THAT month", async ({ page }) => {
  const label = unique("Back-dated checkout fee");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  // Last month: always loaded on the first page (three months at a time).
  const section = main.getByRole("region", { name: monthName(1) });
  await section.getByRole("button", { name: "+ Charge or credit" }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText(monthName(1))).toBeVisible();
  // The date box is bounded to the month the header named.
  const date = modal.getByLabel("Date");
  const min = await date.getAttribute("min");
  const max = await date.getAttribute("max");
  expect(min).toMatch(/-01$/);
  expect(await date.inputValue()).toBe(max);

  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("12.00");
  await modal.getByRole("button", { name: "Add charge" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // It lands under last month's header, not this month's.
  await expect(section.getByRole("row").filter({ hasText: label })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    main.getByRole("region", { name: monthName(0) }).getByRole("row").filter({ hasText: label })
  ).toHaveCount(0);
});

test("voiding a line asks first, then strikes it through rather than deleting it", async ({
  page,
}) => {
  const label = unique("Charged in error");
  await signIn(page, "robin@vffclub.test");
  await addCharge(page, {
    memberId: await memberId(page, "Alex Rivera"),
    description: label,
    amountDollars: 15,
  });
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Cancelling the dialog changes nothing.
  await row.getByRole("button", { name: "Void" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Void this line?")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("voided")).toBeHidden();

  await row.getByRole("button", { name: "Void" }).click();
  await dialog.getByRole("button", { name: "Void" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // The line stays on the statement — the trail of what was charged and unwound
  // is the point, so a void is not a delete.
  await expect(row.getByText("voided")).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Restore" }).click();
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(row.getByRole("button", { name: "Void" })).toBeVisible({
    timeout: 30_000,
  });
});

test("marking a line paid takes it off the outstanding list, and can be undone", async ({
  page,
}) => {
  const label = unique("Tiedown share");
  await signIn(page, "robin@vffclub.test");
  await addCharge(page, {
    memberId: await memberId(page, "Alex Rivera"),
    description: label,
    amountDollars: 33,
  });
  await gotoTab(page, "/finances", "Finances");

  // By month opens on what's OUTSTANDING, across members.
  await openView(page, "Club (by month)");
  const main = page.getByRole("main");
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("cell", { name: "Alex Rivera" })).toBeVisible();
  const owedBefore = await figure(page, "Members owe the club");
  const worthBefore = await figure(page, "Club balance");
  const missingBefore = await unsettled(page);

  await row.getByRole("button", { name: "Paid", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Mark this line paid?")).toBeVisible();
  await dialog.getByRole("button", { name: "Mark paid" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Settled lines leave the to-chase list…
  await expect(row).toHaveCount(0);
  // …and the club's figure drops by exactly the line, with no reload.
  await expect.poll(() => figure(page, "Members owe the club")).toBe(owedBefore - 3300);
  // The club's worth is money that has MOVED: paying adds the line to the
  // balance and takes it out of the "missing" bracket beside it.
  await expect.poll(() => figure(page, "Club balance")).toBe(worthBefore + 3300);
  await expect.poll(() => unsettled(page)).toBe(missingBefore - 3300);

  // …but they're still there, marked, one toggle away.
  await main.getByRole("switch", { name: "Show settled lines" }).click();
  await expect(row.getByText(/✓ paid/)).toBeVisible();

  await row.getByRole("button", { name: "Unpay" }).click();
  await dialog.getByRole("button", { name: "Mark unpaid" }).click();
  await expect(row.getByText(/✓ paid/)).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => figure(page, "Members owe the club")).toBe(owedBefore);
  await expect.poll(() => figure(page, "Club balance")).toBe(worthBefore);
  await expect.poll(() => unsettled(page)).toBe(missingBefore);
});

test("the trash can deletes a hand-entered line after confirming", async ({ page }) => {
  const label = unique("Typo line");
  await signIn(page, "robin@vffclub.test");
  await addCharge(page, {
    memberId: await memberId(page, "Alex Rivera"),
    description: label,
    amountDollars: 9,
  });
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // Derived lines (dues) get no trash can — the API would refuse it.
  const dues = main.getByRole("row").filter({ hasText: "Monthly membership" }).first();
  await expect(dues.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await row.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete this line?")).toBeVisible();
  await expect(dialog.getByText("can’t be undone")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(row).toHaveCount(0);

  // Gone on the server too, not just from the screen.
  // A reload opens on Mine again, like every visit.
  await page.reload();
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await openView(page, "Club (by person)");
  await expect(main.getByRole("heading", { name: "Members owe the club" })).toBeVisible();
  await expect(main.getByRole("row").filter({ hasText: label })).toHaveCount(0);
});

test("a club-level line moves the club's balance without touching any member", async ({
  page,
}) => {
  const label = unique("Hangar insurance");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Club balance" })).toBeVisible();
  const clubBefore = await figure(page, "Club-level lines");
  const balanceBefore = await figure(page, "Club balance");
  const missingBefore = await unsettled(page);
  const owedBefore = await figure(page, "Members owe the club");

  await main.getByRole("button", { name: "One Off" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Member").selectOption({ label: "The club itself — no member" });
  await expect(modal.getByText("A line on the club's books")).toBeVisible();
  await modal.getByRole("button", { name: /^Credit/ }).click();
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("1200");
  await expect(modal.getByText("The club's books will show $1,200.00 the club owes.")).toBeVisible();
  await modal.getByRole("button", { name: "Add credit" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // Its own card, named for the club rather than for anybody.
  const card = main
    .getByRole("region", { name: monthName(0) })
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Club (no member)" }) })
    .filter({ has: page.getByRole("table") })
    .last();
  await expect(card.getByRole("row").filter({ hasText: label })).toBeVisible({
    timeout: 30_000,
  });

  // Unpaid, it moves the club's own figure and the bracket — the club now
  // owes $1,200 more — but not the balance: no money has moved yet. And it
  // touches no member.
  await expect.poll(() => figure(page, "Club-level lines")).toBe(clubBefore - 120_000);
  await expect.poll(() => unsettled(page)).toBe(missingBefore - 120_000);
  expect(await figure(page, "Club balance")).toBe(balanceBefore);
  expect(await figure(page, "Members owe the club")).toBe(owedBefore);

  // By month names it "Club" in the member column.
  await openView(page, "Club (by month)");
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row.getByRole("cell", { name: "Club", exact: true })).toBeVisible();

  // Paying the bill is what takes it off the club's worth, and out of the
  // bracket.
  await row.getByRole("button", { name: "Paid", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Records that the club has paid this $1,200.00.")).toBeVisible();
  await dialog.getByRole("button", { name: "Mark paid" }).click();
  await expect.poll(() => figure(page, "Club balance")).toBe(balanceBefore - 120_000);
  await expect.poll(() => unsettled(page)).toBe(missingBefore);

  // Nobody's statement shows it.
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await expect(page.getByRole("main").getByRole("heading", { name: "Your balance" })).toBeVisible();
  await expect(page.getByRole("main").getByText(label)).toHaveCount(0);
});

test("a club line has to be asked for by name", async ({ page }) => {
  await signIn(page, "robin@vffclub.test");
  // No memberId and no `club: true` is still "pick a member" — a form that
  // forgot the field must not quietly file against the club.
  const missing = await page.request.post("/api/finances/charges", {
    data: { description: "Forgot the member", amountDollars: 5 },
  });
  expect(missing.status()).toBe(400);
  const both = await page.request.post("/api/finances/charges", {
    data: {
      club: true,
      memberId: await memberId(page, "Alex Rivera"),
      description: "Both",
      amountDollars: 5,
    },
  });
  expect(both.status()).toBe(400);

  const made = await addCharge(page, {
    club: true,
    description: unique("API club line"),
    amountDollars: 5,
  });
  expect(made.member).toBeNull();
  await page.request.delete(`/api/finances/charges/${made.id}`);
});

test("older months load as you scroll, under a header that sticks", async ({ page }) => {
  const label = unique("Old annual share");
  await signIn(page, "robin@vffclub.test");
  // Eight months back: well past the first page (three months), so it can
  // only appear once the page has fetched older months on its own.
  await addCharge(page, {
    memberId: await memberId(page, "Alex Rivera"),
    description: label,
    amountDollars: 70,
    incurredOn: dayIn(8),
  });

  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();

  const header = main.getByRole("heading", { name: monthName(8), exact: true });

  // Scroll the app's one scroller (the window never moves) until it arrives.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const el = document.getElementById("app-scroll");
          el?.scrollTo(0, el.scrollHeight);
        });
        return header.count();
      },
      { timeout: 60_000 }
    )
    .toBe(1);

  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible();

  // Scroll into THIS month (with everything older loaded beneath it, so the
  // scroller has room to go): its header must be parked at the top of the
  // scroller rather than scrolled away with the rows.
  const current = main.getByRole("heading", { name: monthName(0), exact: true });
  const bar = current.locator("xpath=..");
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  const offsets = await bar.evaluate((el) => {
    const scroller = document.getElementById("app-scroll")!;
    const section = el.closest("section")!;
    scroller.scrollTop +=
      section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 60;
    return {
      scroller: scroller.getBoundingClientRect().top,
      section: section.getBoundingClientRect().top,
    };
  });
  // The section itself has scrolled up past the top…
  expect(offsets.section).toBeLessThan(offsets.scroller);
  // …and the header hasn't gone with it.
  await expect
    .poll(async () => Math.round(((await bar.boundingBox())?.y ?? -999) - offsets.scroller))
    .toBe(0);
});

test("the ledger API pages back a few months at a time until the books start", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  const first = await page.request.get("/api/finances/ledger").then((r) => r.json());
  // Newest first, three months, and the summary only on the first page.
  expect(first.months).toHaveLength(3);
  expect(first.months[0].period >= first.months[2].period).toBe(true);
  expect(first.summary).not.toBeNull();

  const seen: string[] = first.months.map((m: { period: string }) => m.period);
  let before: string | null = first.nextBefore;
  let guard = 0;
  while (before && guard++ < 100) {
    const next = await page.request
      .get(`/api/finances/ledger?before=${before}`)
      .then((r) => r.json());
    expect(next.summary).toBeNull();
    // Each page starts the month before the last one ended — no gaps, no repeats.
    expect(next.months[0].period < seen[seen.length - 1]).toBe(true);
    seen.push(...next.months.map((m: { period: string }) => m.period));
    before = next.nextBefore;
  }
  expect(before).toBeNull();
  expect(new Set(seen).size).toBe(seen.length);
});

test("Mine keeps a running balance that starts at what you owe now", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();

  const ledger = await page.request.get("/api/finances/ledger").then((r) => r.json());
  const owed = ledger.summary.members.reduce(
    (sum: number, m: { outstandingCents: number }) => sum + m.outstandingCents,
    0
  );
  const money = (cents: number) =>
    `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // The headline is what's owed across every month…
  await expect(main.getByText(money(Math.abs(owed)), { exact: true }).first()).toBeVisible();
  // …and the newest line's running balance is that same figure.
  const firstRow = main.getByRole("table").first().getByRole("row").nth(1);
  await expect(firstRow.getByRole("cell").last()).toHaveText(money(owed));
});

// A tach span no seeded flight comes near: the log is real club history, all of
// it short local hops, so a 7.3-hour entry can't collide with one of theirs and
// the amounts below are unambiguous in the UI.
const E2E_NOTE = "ledger e2e";
const HOURLY_CENTS = 13_500; // the seeded rate, $135.00/hr

test("filing a flight bills the tach hours and credits the fuel", async ({
  page,
}) => {
  await signIn(page);

  // Filed through the API rather than the post-flight form: this test is about
  // the ledger, and driving another page's whole UI to set up a precondition is
  // how a spec ends up failing for reasons that have nothing to do with it.
  // page.request shares the browser's cookies, so this is the signed-in admin.
  const aircraft = await page.request.get("/api/aircraft").then((r) => r.json());

  // Clear anything a previous attempt filed. Playwright retries this spec, and
  // without this each attempt would add another flight — and another pair of
  // ledger lines — to the same statement.
  const existing = await page.request
    .get("/api/flights?limit=500")
    .then((r) => r.json());
  for (const flight of existing) {
    if (flight.notes === E2E_NOTE) {
      await page.request.delete(`/api/flights/${flight.id}`);
    }
  }

  // An open session left by an earlier spec would be FINISHED by this POST
  // rather than a fresh row being filed — same numbers, different id, and a
  // test that reads as flaky. See clearOpenSessions.
  await clearOpenSessions(page);

  const filed = await page.request.post("/api/flights", {
    data: {
      aircraftId: aircraft[0].id,
      tachStart: 2000,
      tachEnd: 2007.3, // 7.3 tach hr × $135.00 = $985.50
      landings: 1,
      fuelAddedGal: 20,
      fuelCostDollars: 88.4,
      notes: E2E_NOTE,
    },
  });
  expect(filed.ok()).toBeTruthy();
  const flightId = (await filed.json()).id;

  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");

  const hours = main.getByRole("row").filter({ hasText: "Flight time" });
  await expect(hours.getByText("$985.50")).toBeVisible({ timeout: 30_000 });

  // Fuel the pilot bought is money the club owes back, so it's stored negative.
  const fuel = main.getByRole("row").filter({ hasText: "Fuel credit" });
  await expect(fuel.getByText("-$88.40")).toBeVisible();

  /** This flight's own ledger lines, straight from the statement API. */
  async function chargesForFlight() {
    const statement = await page.request
      .get("/api/finances")
      .then((r) => r.json());
    return statement.statements
      .flatMap((s: { charges: unknown[] }) => s.charges)
      .filter((c: { flightId: string | null }) => c.flightId === flightId);
  }

  // Exactly one of each kind — the unique index on (flightId, kind) is what
  // guarantees it, and it's the reason correcting a flight can't double-bill.
  const lines = await chargesForFlight();
  expect(
    lines.map((c: { kind: string; amountCents: number }) => [
      c.kind,
      c.amountCents,
    ])
  ).toEqual(
    expect.arrayContaining([
      ["FLIGHT", Math.round(7.3 * HOURLY_CENTS)],
      ["FUEL_CREDIT", -8_840],
    ])
  );
  expect(lines).toHaveLength(2);

  // Correcting the flight REBUILDS its lines rather than adding a second pair.
  const patched = await page.request.patch(`/api/flights/${flightId}`, {
    data: { tachEnd: 2005.5 }, // now 5.5 hr = $742.50
  });
  expect(patched.ok()).toBeTruthy();

  const rebuilt = await chargesForFlight();
  expect(rebuilt).toHaveLength(2);
  expect(
    rebuilt.find((c: { kind: string }) => c.kind === "FLIGHT").amountCents
  ).toBe(Math.round(5.5 * HOURLY_CENTS));

  await page.reload();
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(hours.getByText("$742.50")).toBeVisible({ timeout: 30_000 });
  await expect(hours.getByText("$985.50")).toBeHidden();
});
