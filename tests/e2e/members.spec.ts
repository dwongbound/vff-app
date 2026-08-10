import { expect, test } from "@playwright/test";
import { gotoTab, signIn, TAIL_NUMBER } from "./helpers";

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

test("org settings edits the fleet, and only admins get in", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Org settings", exact: true })
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
