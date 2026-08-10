import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/reservations");
  await expect(page).toHaveURL(/\/login/);
});

test("a member can sign in and reach the schedule", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/reservations/);
  // The rail's top level, in flight order. The two GROUPS (Plane Status,
  // Checkouts) are collapsed here on purpose — a rail sub-list only expands
  // for the group you're actually in, and this lands on Reservations.
  for (const tab of ["Flight Log", "Reservations", "Finances"]) {
    await expect(page.getByRole("link", { name: tab })).toBeVisible();
  }
  for (const group of ["Plane Status", "Checkouts"]) {
    await expect(page.getByRole("button", { name: group })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Preflight" })).toBeHidden();

  // Expanding one reveals its children.
  await page.getByRole("button", { name: "Checkouts" }).click();
  await expect(page.getByRole("link", { name: "Preflight" })).toBeVisible();
});

test("a bad password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@vffclub.test");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong email or password.")).toBeVisible();
});

// Sign-up needs one of the club's codes now — this is a private club, and an
// open form on a public URL puts anyone who finds it in the members list.
// Which code decides what kind of account you get, and that half is covered in
// instructors.spec.ts; here it's just "the door still opens with a key".
test("signing up with a club code creates an account and lands in the app", async ({
  page,
}) => {
  const email = `member-${Date.now()}@vffclub.test`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("Sign-up code").fill("VFF-MEMBER");
  await page.getByLabel("Name").fill("New Member");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("skyhawk172");
  await page.getByLabel("Confirm password").fill("skyhawk172");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible({
    timeout: 60_000,
  });
});

test("signing up without a code is refused", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill("Uninvited");
  await page.getByLabel("Email").fill(`nobody-${Date.now()}@vffclub.test`);
  await page.getByLabel("Password", { exact: true }).fill("skyhawk172");
  await page.getByLabel("Confirm password").fill("skyhawk172");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText(/sign-up code is required/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
