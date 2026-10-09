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
// can, a month's "Mark all paid") happens ON THE SPOT except Delete, the one
// action with no undo and the only one that asks first.
// Money is added through ONE dashed "+" panel: a member can only claim a
// reimbursement for themselves; the Finance Officer can reimburse anyone,
// charge members (split or each), and move the club's own funds.
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

/** Open the dashed "+" panel's modal (officer label; a member's differs). */
async function openAdd(page: Page, label = "Add money") {
  await page.getByRole("main").getByRole("button", { name: label, exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  return modal;
}

/** Pick one of the officer modal's four modes. */
async function mode(modal: ReturnType<Page["getByRole"]>, name: string) {
  await modal
    .getByRole("group", { name: "What kind of money" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** This caller's ledger lines, every month, straight from the API. */
async function ledgerLines(page: Page, all = false) {
  const lines: {
    id: string;
    description: string;
    amountCents: number;
    kind: string;
    paidAt: string | null;
    member: { name: string } | null;
  }[] = [];
  let before: string | null = null;
  for (let i = 0; i < 100; i++) {
    const q: string = `${all ? "all=1&" : ""}months=24${before ? `&before=${before}` : ""}`;
    const res: { months: { charges: typeof lines }[]; nextBefore: string | null } =
      await page.request.get(`/api/finances/ledger?${q}`).then((r) => r.json());
    for (const m of res.months) lines.push(...m.charges);
    before = res.nextBefore;
    if (!before) break;
  }
  return lines;
}

async function openView(page: Page, view: "Me" | "Club (by person)" | "Club (by month)") {
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
  // There is no running-balance column any more.
  await expect(main.getByRole("columnheader", { name: "Balance" })).toHaveCount(0);
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

test("the headline is red when you owe the club and green when it owes you", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();

  const ledger = await page.request.get("/api/finances/ledger").then((r) => r.json());
  const owed = ledger.summary.members.reduce(
    (sum: number, m: { outstandingCents: number }) => sum + m.outstandingCents,
    0
  );
  const verdict = main.locator("[data-tone]");
  const tone = owed > 0 ? "owe" : owed < 0 ? "owed" : "settled";
  await expect(verdict).toHaveAttribute("data-tone", tone);
  await expect(verdict).toContainText(
    { owe: "You owe the club", owed: "The club owes you", settled: "You're all settled" }[tone]
  );

  // The colour, not just the words: red for owing, green for being owed.
  // (Checked on the class — Tailwind 4's palette is oklch, which doesn't
  // compare as RGB.)
  const words = verdict.getByText(/You owe the club|The club owes you|all settled/);
  const expected = { owe: /text-red-/, owed: /text-green-/, settled: /text-gray-/ }[tone];
  await expect(words).toHaveClass(expected);
  await expect(main.getByText(/^\$[\d,]+\.\d\d$/).first()).toHaveClass(expected);
});

test("a member can only claim a reimbursement for themselves", async ({ page }) => {
  const label = unique("Oil — 2 quarts");
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();
  // No officer tools: the panel is the claim, and lines carry no buttons.
  await expect(main.getByRole("button", { name: "Add money" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Void" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Mark all paid" })).toHaveCount(0);

  const before = (await page.request.get("/api/finances/ledger").then((r) => r.json()))
    .summary.members[0]?.outstandingCents ?? 0;

  const modal = await openAdd(page, "Claim a reimbursement");
  await expect(modal.getByRole("heading", { name: "Claim a reimbursement" })).toBeVisible();
  // One form only: no member picker, no other modes.
  await expect(modal.getByLabel("Member")).toHaveCount(0);
  await expect(modal.getByRole("group", { name: "What kind of money" })).toHaveCount(0);
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("18.40");
  await expect(modal.getByText("The club will owe you $18.40.")).toBeVisible();
  await modal.getByRole("button", { name: "Claim reimbursement" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // On their own statement, as money owed back, under its own kind.
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row.getByText("-$18.40")).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("Reimbursement")).toBeVisible();
  const after = (await page.request.get("/api/finances/ledger").then((r) => r.json()))
    .summary.members[0]?.outstandingCents ?? 0;
  expect(after).toBe(before - 1840);

  // The API holds the line, not the form.
  const forSomeoneElse = await page.request.post("/api/finances/charges", {
    data: {
      reimbursement: true,
      memberId: await memberId(page, "Robin Patel"),
      description: "Not mine",
      amountDollars: 5,
    },
  });
  expect(forSomeoneElse.status()).toBe(403);
  for (const data of [
    { memberId: "anyone", description: "Nice try", amountDollars: 10 },
    { club: true, description: "Nice try", amountDollars: 10 },
  ]) {
    const res = await page.request.post("/api/finances/charges", { data });
    expect(res.status()).toBe(403);
  }
  const split = await page.request.post("/api/finances/charges/split", {
    data: { mode: "each", description: "Nice try", amountDollars: 10 },
  });
  expect(split.status()).toBe(403);
  const paid = await page.request.post("/api/finances/charges/paid", { data: { ids: ["x"] } });
  expect(paid.status()).toBe(403);
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
  // And the summary is theirs alone: one member, and it's them.
  expect(
    page1.summary.members.every((m: { member: { name: string } }) => m.member.name === "Alex Rivera")
  ).toBe(true);
});

test("the Finance Officer charges one member, and it lands on their statement", async ({
  page,
}) => {
  const label = unique("Headset replacement");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const modal = await openAdd(page);
  await mode(modal, "Charge");
  await modal.getByRole("button", { name: "Choose people" }).click();
  await modal.getByRole("checkbox", { name: "Alex Rivera" }).check();
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Total", { exact: true }).fill("42.50");
  await expect(modal.getByText("1 person × $42.50 = $42.50.")).toBeVisible();
  await modal.getByRole("button", { name: "Charge 1 person" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // Club (by person) groups the month by member, so the line sits in Alex's card.
  await openView(page, "Club (by person)");
  const main = page.getByRole("main");
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
  const row = page.getByRole("main").getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("$42.50")).toBeVisible();
});

test("a total split between chosen members lands to the cent", async ({ page }) => {
  const label = unique("Hangar door repair");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const roster: { name: string; clubMember: boolean }[] = await page.request
    .get("/api/members")
    .then((r) => r.json());
  const three = roster
    .filter((m) => m.clubMember)
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 3);

  const modal = await openAdd(page);
  await mode(modal, "Charge");
  await modal.getByRole("button", { name: /^Split a total/ }).click();
  await modal.getByRole("button", { name: "Choose people" }).click();
  for (const name of three) await modal.getByRole("checkbox", { name }).check();
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Total", { exact: true }).fill("100");
  // The preview says where the odd cent goes before anything is written.
  await expect(
    modal.getByText("$100.00 split 3 ways: 1 × $33.34 and 2 × $33.33.")
  ).toBeVisible();
  await modal.getByRole("button", { name: "Charge 3 people" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const lines = (await ledgerLines(page, true)).filter((c) =>
    c.description.startsWith(label)
  );
  expect(lines).toHaveLength(3);
  // Each line says it's a share, and the shares add back up to the bill.
  for (const line of lines) expect(line.description).toContain("share of $100.00");
  expect(lines.reduce((sum, c) => sum + c.amountCents, 0)).toBe(10_000);
  const byName = Object.fromEntries(lines.map((c) => [c.member!.name, c.amountCents]));
  // Odd cents go to the first by name, so they're the same people every time.
  expect(byName[three[0]]).toBe(3334);
  expect(byName[three[1]]).toBe(3333);
  expect(byName[three[2]]).toBe(3333);

  for (const line of lines) await page.request.delete(`/api/finances/charges/${line.id}`);
});

test("charging everyone the same amount bills every flying member", async ({ page }) => {
  const label = unique("Fly-in lunch");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const roster: { clubMember: boolean }[] = await page.request
    .get("/api/members")
    .then((r) => r.json());
  const flying = roster.filter((m) => m.clubMember).length;

  const modal = await openAdd(page);
  await mode(modal, "Charge");
  await modal.getByRole("button", { name: /^Each pays/ }).click();
  await expect(modal.getByRole("button", { name: `Everyone (${flying})` })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Per person", { exact: true }).fill("12");
  const total = `$${(12 * flying).toFixed(2)}`;
  await expect(
    modal.getByText(`${flying} people × $12.00 = ${total}.`)
  ).toBeVisible();
  await modal.getByRole("button", { name: `Charge ${flying} people` }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const lines = (await ledgerLines(page, true)).filter((c) => c.description === label);
  expect(lines).toHaveLength(flying);
  expect(lines.every((c) => c.amountCents === 1200 && c.kind === "ONE_OFF")).toBe(true);
  // Every line is somebody's, and nobody is billed twice.
  expect(new Set(lines.map((c) => c.member!.name)).size).toBe(flying);

  for (const line of lines) await page.request.delete(`/api/finances/charges/${line.id}`);
});

test("the Finance Officer can reimburse any member", async ({ page }) => {
  const label = unique("Fuel receipt — Tacoma");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");

  const modal = await openAdd(page);
  await mode(modal, "Reimburse");
  await modal.getByLabel("Member").selectOption({ label: "Alex Rivera" });
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("60.00");
  await expect(modal.getByText("The club will owe Alex Rivera $60.00.")).toBeVisible();
  await modal.getByRole("button", { name: "Add reimbursement" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const row = page.getByRole("main").getByRole("row").filter({ hasText: label });
  await expect(row.getByText("-$60.00")).toBeVisible({ timeout: 30_000 });
});

test("the month header's + adds a line to THAT month", async ({ page }) => {
  const label = unique("Back-dated checkout fee");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  // Last month: always loaded on the first page (three months at a time).
  const section = main.getByRole("region", { name: monthName(1) });
  await section.getByRole("button", { name: `Add money in ${monthName(1)}` }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText(monthName(1))).toBeVisible();
  // The date box is bounded to the month the header named.
  const date = modal.getByLabel("Date");
  expect(await date.getAttribute("min")).toMatch(/-01$/);
  expect(await date.inputValue()).toBe(await date.getAttribute("max"));

  await mode(modal, "Charge");
  await modal.getByRole("button", { name: "Choose people" }).click();
  await modal.getByRole("checkbox", { name: "Alex Rivera" }).check();
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Total", { exact: true }).fill("12.00");
  await modal.getByRole("button", { name: "Charge 1 person" }).click();
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

  // No dialog: the row is struck through on the spot, and Paid greys out —
  // settle it OR unwind it, not both. (Wait for the save itself before the
  // reload below: the row changes before the server has it, by design.)
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/finances/charges/") && r.request().method() === "PATCH"
  );
  await row.getByRole("button", { name: "Void" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-state", "voided");
  await expect(row.getByText("voided")).toBeVisible();
  await expect(row.getByRole("button", { name: "Paid", exact: true })).toBeDisabled();

  // The line stays on the statement — the trail of what was charged and unwound
  // is the point, so a void is not a delete. And it sticks on the server.
  await page.reload();
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await openView(page, "Club (by person)");
  await expect(row).toHaveAttribute("data-state", "voided", { timeout: 30_000 });

  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row).toHaveAttribute("data-state", "open");
  await expect(row.getByRole("button", { name: "Void" })).toBeEnabled();
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

  // By month lists every member's lines together.
  await openView(page, "Club (by month)");
  const main = page.getByRole("main");
  const row = main.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("cell", { name: "Alex Rivera" })).toBeVisible();
  const owedBefore = await figure(page, "Members owe the club");
  const worthBefore = await figure(page, "Club balance");
  const missingBefore = await unsettled(page);

  // No dialog: the row turns green on the spot and Void greys out.
  await row.getByRole("button", { name: "Paid", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-state", "paid");
  await expect(row).toHaveClass(/bg-green-/);
  await expect(row.getByText(/✓ paid/)).toBeVisible();
  await expect(row.getByRole("button", { name: "Void" })).toBeDisabled();

  // The club's figures move by exactly the line, with no reload. The club's
  // worth is money that has MOVED: paying adds the line to the balance and
  // takes it out of the "missing" bracket beside it.
  await expect.poll(() => figure(page, "Members owe the club")).toBe(owedBefore - 3300);
  await expect.poll(() => figure(page, "Club balance")).toBe(worthBefore + 3300);
  await expect.poll(() => unsettled(page)).toBe(missingBefore - 3300);

  // The header filter opens on Everything; Outstanding hides what's settled…
  const filter = main.getByRole("switch", { name: "Show settled lines" });
  await expect(filter).toHaveAttribute("aria-checked", "true");
  await filter.click();
  await expect(row).toHaveCount(0);
  // …and it's still there, marked, one flip away.
  await filter.click();
  await expect(row).toHaveAttribute("data-state", "paid");

  // Paid sticks on the server.
  const stored = (await ledgerLines(page, true)).find((c) => c.description === label);
  expect(stored?.paidAt).toBeTruthy();

  await row.getByRole("button", { name: "Unpay" }).click();
  await expect(row).toHaveAttribute("data-state", "open");
  await expect(row.getByText(/✓ paid/)).toBeHidden();
  await expect.poll(() => figure(page, "Members owe the club")).toBe(owedBefore);
  await expect.poll(() => figure(page, "Club balance")).toBe(worthBefore);
  await expect.poll(() => unsettled(page)).toBe(missingBefore);
});

test("Mark all paid settles a whole month in one tap", async ({ page }) => {
  const a = unique("Month-end line A");
  const b = unique("Month-end line B");
  await signIn(page, "robin@vffclub.test");
  const alex = await memberId(page, "Alex Rivera");
  // Two months back: inside the first page, and clear of the months the
  // other specs write into.
  for (const description of [a, b]) {
    await addCharge(page, { memberId: alex, description, amountDollars: 20, incurredOn: dayIn(2) });
  }
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  const section = main.getByRole("region", { name: monthName(2) });
  await expect(section.getByRole("row").filter({ hasText: a })).toBeVisible({ timeout: 30_000 });
  const worthBefore = await figure(page, "Club balance");

  // On the spot, like a single line's Paid — no dialog.
  await section.getByRole("button", { name: "Mark all paid" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const label of [a, b]) {
    await expect(section.getByRole("row").filter({ hasText: label }).getByText(/✓ paid/)).toBeVisible();
  }
  // Nothing left open in that month, so the button goes.
  await expect(section.getByRole("button", { name: "Mark all paid" })).toHaveCount(0);
  await expect(section.getByText("$0.00 outstanding")).toBeVisible();
  // And the club's worth went up by at least the two lines we know about.
  expect(await figure(page, "Club balance")).toBeGreaterThanOrEqual(worthBefore + 4000);

  // Every line in that month is settled on the server, voided ones aside.
  const res = await page.request
    .get(`/api/finances?period=${dayIn(2).slice(0, 7)}&all=1`)
    .then((r) => r.json());
  const lines = res.statements.flatMap(
    (s: { charges: { voided: boolean; paidAt: string | null }[] }) => s.charges
  );
  expect(lines.filter((c: { voided: boolean; paidAt: string | null }) => !c.voided && !c.paidAt)).toHaveLength(0);
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

  // Every line has a trash can, derived ones included.
  const dues = main.getByRole("row").filter({ hasText: "Monthly membership" }).first();
  await expect(dues.getByRole("button", { name: "Delete" })).toBeVisible();

  // Cancelling the dialog changes nothing.
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete this line?")).toBeVisible();
  await expect(dialog.getByText("can’t be undone")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(row).toHaveCount(0);

  // Gone on the server too, not just from the screen. A reload opens on Mine.
  await page.reload();
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
    timeout: 60_000,
  });
  await openView(page, "Club (by person)");
  await expect(main.getByRole("heading", { name: "Members owe the club" })).toBeVisible();
  await expect(main.getByRole("row").filter({ hasText: label })).toHaveCount(0);
});

test("deleting a DERIVED line sticks — the month's next read doesn't rebuild it", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  // Somebody else's dues this month (the seeded rule starts this month):
  // nobody else in the suite reads them.
  const roster: { name: string; clubMember: boolean }[] = await page.request
    .get("/api/members")
    .then((r) => r.json());
  const victim = roster
    .filter((m) => m.clubMember)
    .map((m) => m.name)
    .find((n) => !["Alex Rivera", "Robin Patel", "Club Admin"].includes(n))!;

  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by month)");
  const main = page.getByRole("main");
  const section = main.getByRole("region", { name: monthName(0) });
  const row = section
    .getByRole("row")
    .filter({ hasText: victim })
    .filter({ hasText: "Monthly membership" });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  const owedBefore = await figure(page, "Members owe the club");
  const wasOpen = (await row.getAttribute("data-state")) === "open";

  await row.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  // It says why this one is different from a hand-entered line.
  await expect(dialog.getByText("won’t be rebuilt from its recurring rule")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(row).toHaveCount(0);
  if (wasOpen) {
    await expect.poll(() => figure(page, "Members owe the club")).toBe(owedBefore - 25_000);
  }

  // Reading the books is what materialises dues — and it must NOT write this
  // one back. Reload twice to be sure the read really ran.
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible({
      timeout: 60_000,
    });
  }
  await openView(page, "Club (by month)");
  await expect(main.getByRole("region", { name: monthName(0) })).toBeVisible({ timeout: 30_000 });
  await expect(row).toHaveCount(0);
  // Nor on the monthly statement API.
  const res = await page.request
    .get(`/api/finances?period=${dayIn(0).slice(0, 7)}&all=1`)
    .then((r) => r.json());
  const mine = res.statements.find(
    (st: { member: { name: string } }) => st.member.name === victim
  );
  expect(
    mine.charges.filter((c: { description: string }) => c.description === "Monthly membership")
  ).toHaveLength(0);
});

test("club funds move the club's balance on the spot, and touch no member", async ({
  page,
}) => {
  const label = unique("Annual insurance premium");
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Club balance" })).toBeVisible();
  // There is no separate "club-level" figure: a line with no member IS the
  // club's balance.
  await expect(main.getByRole("heading", { name: "Club-level lines" })).toHaveCount(0);
  const balanceBefore = await figure(page, "Club balance");
  const missingBefore = await unsettled(page);
  const owedBefore = await figure(page, "Members owe the club");

  const modal = await openAdd(page);
  await mode(modal, "Club funds");
  await modal.getByRole("button", { name: /^Money out/ }).click();
  await modal.getByLabel("What for").fill(label);
  await modal.getByLabel("Amount", { exact: true }).fill("1200");
  await expect(modal.getByText("The club balance goes down $1,200.00.")).toBeVisible();
  await modal.getByRole("button", { name: "Take from club" }).click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // Its own card, named for the club rather than for anybody.
  const card = main
    .getByRole("region", { name: monthName(0) })
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Club (no member)" }) })
    .filter({ has: page.getByRole("table") })
    .last();
  const row = card.getByRole("row").filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // Nobody to chase, so nothing to mark paid: no Paid, no Unpay, no green.
  await expect(row.getByRole("button", { name: "Paid", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Unpay" })).toHaveCount(0);
  await expect(row).toHaveAttribute("data-state", "open");

  // It counts at once: the balance drops, nothing becomes "missing", no
  // member's figure moves.
  await expect.poll(() => figure(page, "Club balance")).toBe(balanceBefore - 120_000);
  expect(await unsettled(page)).toBe(missingBefore);
  expect(await figure(page, "Members owe the club")).toBe(owedBefore);

  // Voiding takes it back out of the balance; restoring puts it back.
  await row.getByRole("button", { name: "Void" }).click();
  await expect.poll(() => figure(page, "Club balance")).toBe(balanceBefore);
  await row.getByRole("button", { name: "Restore" }).click();
  await expect.poll(() => figure(page, "Club balance")).toBe(balanceBefore - 120_000);

  // By month names it "Club" in the member column.
  await openView(page, "Club (by month)");
  const monthRow = main.getByRole("row").filter({ hasText: label });
  await expect(monthRow.getByRole("cell", { name: "Club", exact: true })).toBeVisible();
  // It isn't OUTSTANDING (nobody owes it), so the Outstanding filter hides it.
  const filter = main.getByRole("switch", { name: "Show settled lines" });
  await filter.click();
  await expect(monthRow).toHaveCount(0);
  await filter.click();

  // Deleting it — the one confirmed action — gives the balance back.
  await monthRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => figure(page, "Club balance")).toBe(balanceBefore);

  // Nobody's statement shows it.
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await expect(page.getByRole("main").getByRole("heading", { name: "Your balance" })).toBeVisible();
  await expect(page.getByRole("main").getByText(label)).toHaveCount(0);
});

test("a member chip narrows both club views to that member, with a loader while it does", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Club balance" })).toBeVisible();

  // Slow the narrowed read down so the loader is certainly on screen to see.
  await page.route("**/api/finances/ledger?*member=*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  const chip = main.getByRole("button", { name: /^Alex Rivera / });
  await chip.click();
  await expect(main.getByRole("status", { name: "Filtering" })).toBeVisible();
  await expect(main.getByRole("status", { name: "Filtering" })).toBeHidden({ timeout: 30_000 });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(main.getByRole("button", { name: "Clear filter: Alex Rivera" })).toBeVisible();

  // By person: every member card is Alex's.
  const names = await main.locator("section h3").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(["Alex Rivera"]));
  // The summary stays club-wide — it's what the chips come from.
  await expect(main.getByRole("button", { name: /^Robin Patel / })).toBeVisible();

  // By month keeps the filter: every member cell is Alex.
  await openView(page, "Club (by month)");
  await expect(main.getByRole("status", { name: "Filtering" })).toBeHidden({ timeout: 30_000 });
  const cells = main.getByRole("row").locator("td:nth-child(2)");
  await expect(cells.first()).toBeVisible();
  expect(new Set(await cells.allTextContents())).toEqual(new Set(["Alex Rivera"]));

  // Clearing it brings everyone back.
  await main.getByRole("button", { name: "Clear filter: Alex Rivera" }).click();
  await expect(main.getByRole("status", { name: "Filtering" })).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(async () => new Set(await cells.allTextContents()).size)
    .toBeGreaterThan(1);

  // And "Me" never carries a club filter.
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await openView(page, "Me");
  await openView(page, "Club (by person)");
  await expect(main.getByRole("button", { name: /^Alex Rivera / })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("money boxes carry a $ and fill in the cents; each person's share is bold", async ({
  page,
}) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const modal = await openAdd(page);
  await mode(modal, "Charge");
  // The tabs are single words.
  const tabs = modal.getByRole("group", { name: "What kind of money" }).getByRole("button");
  await expect(tabs).toHaveText(["Reimburse", "Charge", "Club funds", "Recurring"]);

  const total = modal.getByLabel("Total", { exact: true });
  await expect(modal.getByText("$", { exact: true })).toBeVisible();
  // Junk is refused as it's typed; leaving the box fills in the cents.
  await total.pressSequentially("5a9,0");
  await expect(total).toHaveValue("590");
  await modal.getByLabel("What for").click();
  await expect(total).toHaveValue("590.00");

  await modal.getByRole("button", { name: "Choose people" }).click();
  const boxes = modal.getByRole("checkbox");
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  // $590 three ways: the per-person figures are the bold ones.
  const preview = modal.getByRole("status");
  await expect(preview).toHaveText("$590.00 split 3 ways: 2 × $196.67 and 1 × $196.66.");
  await expect(preview.locator("strong")).toHaveText(["$196.67", "$196.66"]);
  await modal.getByRole("button", { name: "Cancel" }).click();
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
  const bar = current.locator("xpath=ancestor::div[contains(@class, 'sticky')][1]");
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

/**
 * Read a downloaded .xlsx as text. The app's writer is STORE-only (no
 * compression — see lib/xlsx.ts), so every cell's text sits in the file as-is
 * and a substring check is a real check of what's in the spreadsheet.
 */
async function downloadedText(download: import("@playwright/test").Download): Promise<string> {
  const path = await download.path();
  const fs = await import("node:fs/promises");
  return (await fs.readFile(path)).toString("latin1");
}

test("a member's export asks for months and kinds, and holds only their own lines", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Your balance" })).toBeVisible();

  await main.getByRole("button", { name: "Export", exact: true }).click();
  const modal = page.getByRole("dialog");
  // Defaults: all time, every kind; no People section for a member.
  await expect(modal.getByLabel("Months")).toHaveValue("all");
  for (const kind of ["Dues", "Flight time", "Reimbursement"]) {
    await expect(modal.getByRole("checkbox", { name: kind })).toBeChecked();
  }
  await expect(modal.getByText("People")).toHaveCount(0);

  await modal.getByLabel("Months").selectOption("this-month");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal.getByRole("button", { name: "Download .xlsx" }).click(),
  ]);
  const thisMonth = dayIn(0).slice(0, 7);
  expect(download.suggestedFilename()).toBe(`finances-${thisMonth}-mine.xlsx`);
  const text = await downloadedText(download);
  expect(text).toContain("Monthly membership");
  expect(text).toContain("Alex Rivera");
  expect(text).not.toContain("Robin Patel");
  await expect(modal).toBeHidden();
});

test("the Finance Officer's export narrows to chosen people and kinds", async ({ page }) => {
  await signIn(page, "robin@vffclub.test");
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by person)");
  const main = page.getByRole("main");

  await main.getByRole("button", { name: "Export", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "Everyone" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Dues only, Alex only, this month.
  await modal.getByLabel("Months").selectOption("this-month");
  await modal.getByRole("button", { name: "Clear all" }).click();
  await modal.getByRole("checkbox", { name: "Dues" }).check();
  await modal.getByRole("button", { name: "Choose people" }).click();
  await modal.getByRole("checkbox", { name: "Alex Rivera" }).check();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal.getByRole("button", { name: "Download .xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`finances-${dayIn(0).slice(0, 7)}-club.xlsx`);
  const text = await downloadedText(download);
  expect(text).toContain("Alex Rivera");
  expect(text).toContain("Dues");
  // Nobody else, and no other kind of line.
  expect(text).not.toContain("Robin Patel");
  expect(text).not.toContain("Flight time");

  // Asking for nothing is refused in the window rather than downloading an
  // empty file.
  await main.getByRole("button", { name: "Export", exact: true }).click();
  await modal.getByRole("button", { name: "Clear all" }).click();
  await modal.getByRole("button", { name: "Download .xlsx" }).click();
  await expect(modal.getByText("Pick at least one kind of line.")).toBeVisible();
  await modal.getByRole("button", { name: "Cancel" }).click();
});

test("an all-time export reads every month, not just the ones scrolled to", async ({
  page,
}) => {
  const label = unique("Ancient fee");
  await signIn(page, "robin@vffclub.test");
  // Twenty months back: far beyond the three the page loads first.
  await addCharge(page, {
    memberId: await memberId(page, "Alex Rivera"),
    description: label,
    amountDollars: 3,
    incurredOn: dayIn(20),
  });
  await gotoTab(page, "/finances", "Finances");
  await openView(page, "Club (by month)");
  const main = page.getByRole("main");
  await expect(main.getByRole("row").filter({ hasText: label })).toHaveCount(0);

  await main.getByRole("button", { name: "Export", exact: true }).click();
  const modal = page.getByRole("dialog");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal.getByRole("button", { name: "Download .xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^finances-\d{4}-\d{2}-to-\d{4}-\d{2}-club\.xlsx$/);
  expect(await downloadedText(download)).toContain(label);
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

  // Deleting a derived line tombstones it: correcting the flight again must
  // rebuild the fuel credit but NOT the deleted flight-time charge.
  const flightLine = rebuilt.find((c: { kind: string }) => c.kind === "FLIGHT");
  const deleted = await page.request.delete(`/api/finances/charges/${flightLine.id}`);
  expect(deleted.ok()).toBeTruthy();
  const again = await page.request.patch(`/api/flights/${flightId}`, {
    data: { tachEnd: 2006 },
  });
  expect(again.ok()).toBeTruthy();
  const afterDelete = await chargesForFlight();
  expect(afterDelete.map((c: { kind: string }) => c.kind)).toEqual(["FUEL_CREDIT"]);
});
