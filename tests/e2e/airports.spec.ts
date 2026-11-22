// Club settings › Airports: the landing-fee table the flight forms prefill
// from. It starts with KTOA at $6; an admin adds, re-prices and deletes rows,
// and a member can read it but not change it.
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // A previous run that failed half-way may have left the test airport.
  await page.request.delete("/api/airports/KZZZ");
});

test("an admin adds an airport, changes its fee and deletes it", async ({ page }) => {
  await page.goto("/settings");
  const main = page.getByRole("region", { name: "Airports" });
  await expect(main).toBeVisible({ timeout: 60_000 });

  // The club's home field is there from the start, at $6.
  const list = main.getByRole("list", { name: "Airports" });
  await expect(list.getByLabel("KTOA landing fee")).toHaveValue("6.00");

  // Add one.
  await main.getByRole("button", { name: "Add airport" }).click();
  await main.getByLabel("Airport", { exact: true }).fill("kzzz");
  await main.getByLabel("Landing fee", { exact: true }).fill("12");
  await main.getByRole("button", { name: "Add", exact: true }).click();
  const fee = list.getByLabel("KZZZ landing fee");
  await expect(fee).toHaveValue("12.00");

  // Re-price it: Save appears once the box differs.
  await fee.fill("15.50");
  await list.getByRole("button", { name: "Save" }).click();
  // Saved: the button goes once the box matches what's stored again.
  await expect(list.getByRole("button", { name: "Save" })).toHaveCount(0);
  const rows = (await (await page.request.get("/api/airports")).json()) as {
    code: string;
    landingFeeCents: number | null;
  }[];
  expect(rows.find((r) => r.code === "KZZZ")?.landingFeeCents).toBe(1550);

  // And delete it.
  await list.getByRole("button", { name: "Delete KZZZ" }).click();
  await expect(list.getByLabel("KZZZ landing fee")).toHaveCount(0);
});

test("the API refuses a bad code, a duplicate and a negative fee", async ({ page }) => {
  const bad = await page.request.post("/api/airports", {
    data: { code: "practice area", landingFeeDollars: "5" },
  });
  expect(bad.status()).toBe(400);
  const dup = await page.request.post("/api/airports", {
    data: { code: "KTOA", landingFeeDollars: "6" },
  });
  expect(dup.status()).toBe(409);
  const negative = await page.request.post("/api/airports", {
    data: { code: "KZZZ", landingFeeDollars: "-3" },
  });
  expect(negative.status()).toBe(400);
});

test("a member reads the fees but can't change them", async ({ page }) => {
  await signIn(page, "alex@vffclub.test");
  const read = await page.request.get("/api/airports");
  expect(read.ok()).toBe(true);
  const rows = (await read.json()) as { code: string; landingFeeCents: number | null }[];
  expect(rows.find((r) => r.code === "KTOA")?.landingFeeCents).toBe(600);
  expect(
    (await page.request.patch("/api/airports/KTOA", { data: { landingFeeDollars: "0" } })).status()
  ).toBe(403);
  expect((await page.request.delete("/api/airports/KTOA")).status()).toBe(403);
});
