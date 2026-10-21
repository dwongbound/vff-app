import { expect, test } from "@playwright/test";
import { signIn, TAIL_NUMBER } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("the desktop layout shows the month calendar", async ({ page }) => {
  await expect(page.getByText("Sun", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  // The seed books the admin tomorrow, so the "your next flight" card is
  // there. (We don't assert on a specific calendar cell: the seed's offsets
  // are relative to the run date, so a booking can land in the next month.)
  await expect(page.getByText("Your next flight")).toBeVisible();
});

test("booking the airplane, then cancelling it", async ({ page }) => {
  await page.getByRole("button", { name: "New", exact: true }).click();

  // Two days out at 13:00–15:00, which the seed leaves free.
  const start = new Date();
  start.setDate(start.getDate() + 3);
  start.setHours(13, 0, 0, 0);
  const end = new Date(start);
  end.setHours(15);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;

  await page.getByLabel("Start", { exact: true }).fill(local(start));
  await page.getByLabel("End", { exact: true }).fill(local(end));
  await page.getByLabel("Notes (optional)").fill("E2E booking");
  await page.getByRole("button", { name: "Book", exact: true }).click();

  // It shows up as "your next flight" or on the grid as a You chip.
  await expect(page.getByRole("button", { name: /You/ }).first()).toBeVisible();

  // Reopen it: the footer is Delete · Export 📅 (named "Export .ics") · Save — no Close (the ✕
  // in the header closes it).
  await page.getByRole("button", { name: /You/ }).first().click();
  const dialog = page.getByRole("dialog");
  // The ✕ is labelled "Close" for screen readers; it must be the only one.
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toHaveCount(1);

  // The .ics keeps the tail number in capitals.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Export .ics" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${TAIL_NUMBER}-\\d{4}-\\d{2}-\\d{2}\\.ics$`));
  const fs = await import("node:fs/promises");
  const ics = (await fs.readFile(await download.path())).toString("utf8");
  expect(ics).toContain(`SUMMARY:${TAIL_NUMBER}`);

  // Delete — two taps, because it's destructive.
  await dialog.getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
});

test("only the booking's owner (or an admin) can delete it, and delete really deletes", async ({
  page,
}) => {
  const aircraft = await page.request.get("/api/aircraft").then((r) => r.json());
  // Robin books a slot well clear of the seed's.
  await signIn(page, "robin@vffclub.test");
  const start = new Date();
  start.setDate(start.getDate() + 5);
  start.setHours(6, 0, 0, 0);
  const end = new Date(start);
  end.setHours(7);
  const made = await page.request.post("/api/reservations", {
    data: {
      aircraftId: aircraft[0].id,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      purpose: "LOCAL",
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();

  // Alex can't delete it — not through the API, whatever the UI shows.
  await signIn(page, "alex@vffclub.test");
  const refused = await page.request.delete(`/api/reservations/${id}`);
  expect(refused.status()).toBe(403);

  // The admin can, and the row is GONE — a second delete finds nothing.
  await signIn(page);
  const removed = await page.request.delete(`/api/reservations/${id}`);
  expect(removed.ok()).toBe(true);
  const again = await page.request.delete(`/api/reservations/${id}`);
  expect(again.status()).toBe(404);
});

test("desktop gets the themed calendar popover, and picking a day fills the field", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New", exact: true }).click();

  // The custom picker only exists where there's a fine pointer — see
  // components/common/DateTimeField.tsx.
  await page.getByRole("button", { name: "Open calendar for Start" }).click();
  const calendar = page.getByRole("dialog", { name: "Start calendar picker" });
  await expect(calendar).toBeVisible();

  // Pick a day and a time from the popover rather than typing. Page forward a
  // month first: the field's `min` is today, so mid-month days are disabled
  // whenever the suite happens to run late in a month.
  const before = await page.getByLabel("Start", { exact: true }).inputValue();
  await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("button", { name: "15", exact: true }).click();
  await calendar.getByRole("button", { name: /10:00/ }).first().click();

  const after = await page.getByLabel("Start", { exact: true }).inputValue();
  expect(after).not.toBe(before);
  expect(after).toMatch(/-15T10:00$/);
  // Picking a time closes the popover.
  await expect(calendar).toBeHidden();
});

test("a double booking is rejected with a useful message", async ({ page }) => {
  // The seed puts a maintenance block on the airplane; book straight over it.
  const start = new Date();
  start.setDate(start.getDate() + 9);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Start", { exact: true }).fill(local(start));
  await page.getByLabel("End", { exact: true }).fill(local(end));
  await page.getByRole("button", { name: "Book", exact: true }).click();

  await expect(page.getByText(new RegExp(`already has ${TAIL_NUMBER}`))).toBeVisible();
});

test("Training (Solo) can be booked, with no instructor to pick", async ({ page }) => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const purpose = dialog.getByLabel("Purpose");
  await purpose.selectOption("TRAINING");
  await expect(dialog.getByLabel("Instructor (optional)")).toBeVisible();
  // A solo is training with nobody beside you, so there's no CFI to name.
  await purpose.selectOption({ label: "Training (Solo)" });
  await expect(dialog.getByLabel("Instructor (optional)")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
});

test("past bookings stay on the desktop calendar, a month back as well", async ({ page }) => {
  const [aircraft] = await page.request.get("/api/aircraft").then((r) => r.json());
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  const rows = (await page.request
    .get(
      `/api/reservations?aircraftId=${aircraft.id}&from=${from.toISOString()}&to=${now.toISOString()}`
    )
    .then((r) => r.json())) as { startsAt: string; endsAt: string }[];
  // The seed's lesson three days ago is one of these.
  const past = rows.find((r) => new Date(r.endsAt) < now);
  expect(past).toBeTruthy();

  // Step back to the month it was in (usually this one), and it's drawn there,
  // dimmed as done but still a booking you can open.
  const when = new Date(past!.startsAt);
  const back =
    (now.getFullYear() - when.getFullYear()) * 12 + (now.getMonth() - when.getMonth());
  const main = page.getByRole("main");
  for (let i = 0; i < back; i++) {
    await main.getByRole("button", { name: "Previous month" }).click();
  }
  const dimmed = main.locator("button.opacity-50");
  await expect(dimmed.first()).toBeVisible();
  await dimmed.first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();

  // And a month further back asks the server for that month too.
  const fetched = page.waitForRequest((r) => {
    if (!r.url().includes("/api/reservations?")) return false;
    const asked = new Date(new URL(r.url()).searchParams.get("from")!);
    return asked < new Date(when.getFullYear(), when.getMonth(), 1);
  });
  await main.getByRole("button", { name: "Previous month" }).click();
  await fetched;
});
