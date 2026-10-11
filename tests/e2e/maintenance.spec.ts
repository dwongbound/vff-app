import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Who may keep the maintenance sheet.
//
// The club has no Maintenance Officer: the SAFETY OFFICER keeps the sheet as
// well as triaging squawks (one office for "can it fly"), and admins can too.
// Everyone else reads it — "the annual is due next week" isn't privileged —
// and is told who to ask.
//
// Cast (prisma/seed.ts): sam@ is the Safety Officer, alex@ a plain member.
const SAFETY_OFFICER = "sam@vffclub.test";
const PLAIN_MEMBER = "alex@vffclub.test";

test("a plain member reads the sheet and is told who to ask", async ({ page }) => {
  await signIn(page, PLAIN_MEMBER);
  await page.goto("/status/maintenance");
  const main = page.getByRole("main");

  await expect(
    main.getByText("Ask the Safety Officer to make changes to maintenance.")
  ).toBeVisible({ timeout: 60_000 });
  await expect(main.getByRole("button", { name: "Add item" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Mark done" })).toHaveCount(0);

  // And the server holds the line, not just the page.
  const aircraft = await page.request.get("/api/aircraft").then((r) => r.json());
  const refused = await page.request.post("/api/maintenance", {
    data: { aircraftId: aircraft[0].id, label: "Nice try", category: "INSPECTION" },
  });
  expect(refused.status()).toBe(403);
});

test("the Safety Officer keeps the sheet — the old Maintenance Officer's job", async ({
  page,
}) => {
  await signIn(page, SAFETY_OFFICER);
  await page.goto("/status/maintenance");
  const main = page.getByRole("main");

  await expect(main.getByRole("button", { name: "Add item" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(main.getByRole("button", { name: "Mark done" }).first()).toBeVisible();
  await expect(main.getByText(/Ask the Safety Officer/)).toHaveCount(0);

  // A real write goes through, and is tidied away again.
  const aircraft = await page.request.get("/api/aircraft").then((r) => r.json());
  const made = await page.request.post("/api/maintenance", {
    data: {
      aircraftId: aircraft[0].id,
      label: `E2E check ${Date.now()}`,
      category: "INSPECTION",
      intervalMonths: 12,
    },
  });
  expect(made.ok()).toBe(true);
  const { id } = await made.json();
  const removed = await page.request.delete(`/api/maintenance/${id}`);
  expect(removed.ok()).toBe(true);
});

test("the roster offers no Maintenance Officer any more", async ({ page }) => {
  // Signed in as the admin, who can assign offices.
  await signIn(page);
  await page.goto("/members");
  const main = page.getByRole("main");
  await expect(main.getByText("Safety Officer").first()).toBeVisible({ timeout: 60_000 });
  await expect(main.getByText("Maintenance Officer")).toHaveCount(0);
});
