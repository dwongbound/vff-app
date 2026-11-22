import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, gotoTab, signIn, TAIL_NUMBER } from "./helpers";

// The roster and the club-admin flag that hangs off it. The seed creates one
// admin ("Club Admin") plus the demo roster, so there is always somebody to
// promote and always a second admin standing between us and the last-admin
// guard. Alex Rivera is the roster's plain member — no flag, no office — which
// is why the promotion tests pick on them.

test("the roster lists the club and marks its admins", async ({ page }) => {
  await signIn(page);
  await gotoTab(page, "/members", "Members");

  await expect(page.getByText("Alex Rivera", { exact: true })).toBeVisible();
  await expect(page.getByText("Sam Okafor", { exact: true })).toBeVisible();
  // The signed-in member is called out so you can find yourself in the list.
  await expect(page.getByText("You", { exact: true })).toBeVisible();
});

test("an admin can hand out the admin flag and take it back", async ({ page }) => {
  await signIn(page);
  await gotoTab(page, "/members", "Members");

  const promote = page.getByRole("button", { name: "Make Alex Rivera an admin" });
  await expect(promote).toBeVisible();
  await promote.click();

  // The list re-sorts admins to the top, so wait on the button flipping rather
  // than on the row staying put.
  const demote = page.getByRole("button", {
    name: "Remove admin from Alex Rivera",
  });
  await expect(demote).toBeVisible({ timeout: 30_000 });

  await demote.click();
  await expect(
    page.getByRole("button", { name: "Make Alex Rivera an admin" })
  ).toBeVisible({ timeout: 30_000 });
});

test("a member without the flag can read the roster but not change it", async ({
  page,
}) => {
  await signIn(page, "alex@vffclub.test");
  await gotoTab(page, "/members", "Members");

  await expect(page.getByText("Sam Okafor", { exact: true })).toBeVisible();
  // No role controls at all for a plain member.
  await expect(
    page.getByRole("button", { name: /Make .* an admin/ })
  ).toHaveCount(0);
});

// Removing a member is a SOFT delete: the row stays for their flights and
// statement lines to point at, and the person stops signing in and leaves the
// roster. A fresh account is made for it, because removal can't be undone
// from the app and the seeded roster is what every other spec relies on.
test("an admin can remove a member, who then can't sign in", async ({ page }) => {
  const email = `e2e-removed-${Date.now()}@vffclub.test`;
  const name = `E2E Leaver ${Date.now()}`;
  const made = await page.request.post("/api/signup", {
    data: { code: "VFF-MEMBER", name, email, password: ADMIN_PASSWORD },
  });
  expect(made.ok()).toBe(true);

  await signIn(page);
  await gotoTab(page, "/members", "Members");
  const main = page.getByRole("main");
  await expect(main.getByText(name, { exact: true })).toBeVisible();

  // No Remove on your own row: the server refuses it too.
  await expect(
    main.getByRole("button", { name: "Remove Club Admin from the club" })
  ).toHaveCount(0);

  await main.getByRole("button", { name: `Remove ${name} from the club` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Their flights stay in the log");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(main.getByText(name, { exact: true })).toHaveCount(0);

  // Off the roster the API serves to every picker, too.
  const roster = await (await page.request.get("/api/members")).json();
  expect(roster.some((m: { name: string }) => m.name === name)).toBe(false);

  // Nobody can remove themselves, and signing up again with the address is
  // refused with a reason rather than a bare "already an account".
  const me = await (await page.request.get("/api/me")).json();
  const self = await page.request.delete(`/api/members/${me.id}`);
  expect(self.status()).toBe(409);
  const again = await page.request.post("/api/signup", {
    data: { code: "VFF-MEMBER", name, email, password: ADMIN_PASSWORD },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toMatch(/removed from the club/);

  // The removed member's password no longer gets them in.
  await page.context().clearCookies();
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await submit.click();
  await expect(page.getByText("Wrong email or password.")).toBeVisible({ timeout: 30_000 });
});

test("org settings edits the fleet, and only admins get in", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Club settings", exact: true })
  ).toBeVisible({ timeout: 60_000 });

  // The seeded airplane is there, and its tail number is editable.
  const tail = page.getByLabel("Tail number", { exact: true });
  await expect(tail).toHaveValue(TAIL_NUMBER);
});

test("a plain member is refused org settings", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  await page.goto("/settings");

  await expect(page.getByText(/Only club admins can change/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByLabel("Tail number", { exact: true })).toHaveCount(0);
});
