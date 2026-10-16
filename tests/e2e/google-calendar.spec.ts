// Club settings › Google Calendar, as far as e2e can take it without Google.
//
// The test server has no GOOGLE_CLIENT_ID/SECRET, so this covers what has to
// hold BEFORE anyone connects: the panel says why it's off, and the routes
// refuse anyone who isn't an admin and refuse linking a calendar with nothing
// connected. The sync itself is pure rules (tests/unit/calendarEvents.test.ts)
// plus Google's API, which isn't something to call from CI.
import { expect, test } from "@playwright/test";
import { signIn, TAIL_NUMBER } from "./helpers";

test("Club settings explains that Google isn't set up on this server", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Google Calendar" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(main.getByText(/Google isn.t set up on this server/)).toBeVisible();
  // Nothing to connect to, so no Connect button.
  await expect(main.getByRole("link", { name: "Connect Google" })).toHaveCount(0);
});

test("the calendar routes are admin-only, and linking needs a connection", async ({ page }) => {
  // A member who isn't an admin can't read the settings or start a connect.
  await signIn(page, "alex@vffclub.test");
  expect((await page.request.get("/api/calendar")).status()).toBe(403);
  const connect = await page.request.get("/api/calendar/connect", { maxRedirects: 0 });
  expect(connect.status()).toBe(307);
  expect(connect.headers()["location"]).toContain("/settings?calendar=error");

  // An admin with nothing connected can't link an airplane to a calendar.
  await page.context().clearCookies();
  await signIn(page);
  const status = await (await page.request.get("/api/calendar")).json();
  expect(status.configured).toBe(false);
  expect(status.connection).toBeNull();
  const airplane = status.aircraft.find(
    (a: { tailNumber: string }) => a.tailNumber === TAIL_NUMBER
  );
  const link = await page.request.put(`/api/calendar/aircraft/${airplane.id}`, {
    data: { calendarId: "someone@group.calendar.google.com" },
  });
  expect(link.status()).toBe(403);
  expect((await link.json()).error).toMatch(/Connect a Google account first/);
});
