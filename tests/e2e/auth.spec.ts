import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/reservations");
  await expect(page).toHaveURL(/\/login/);
});

test("a member can sign in and reach the schedule", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/reservations/);
  // The four tabs, in flight order.
  for (const tab of ["Preflight", "Post-flight", "Flight Log", "Reservations"]) {
    await expect(page.getByRole("link", { name: tab })).toBeVisible();
  }
});

test("a bad password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@vffclub.test");
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong email or password.")).toBeVisible();
});

test("signing up creates an account and lands in the app", async ({ page }) => {
  const email = `member-${Date.now()}@vffclub.test`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill("New Member");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("skyhawk172");
  await page.getByLabel("Confirm password").fill("skyhawk172");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Reservations" })).toBeVisible({
    timeout: 60_000,
  });
});
