// Personal access keys: a member makes one on their profile, an assistant
// reads the club through it (GET /api/agent, and /api/mcp as an MCP server),
// and revoking it shuts that off at once.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoTab, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

/** One MCP JSON-RPC call through the key. */
async function mcp(request: APIRequestContext, key: string, method: string, params?: object) {
  return request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${key}` },
    data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
  });
}

test("a key reads the club read-only, and stops the moment it's revoked", async ({ page, playwright }) => {
  await gotoTab(page, "/profile", "Your profile");
  const card = page.getByTestId("access-keys");
  await card.getByLabel("Name for a new key").fill("Jarvis e2e");
  await card.getByRole("button", { name: "Create key" }).click();

  // Shown once, in full.
  const shown = card.getByTestId("new-access-key");
  await expect(shown).toHaveText(/^vff_\S{40,}$/, { timeout: 60_000 });
  const key = (await shown.textContent())!.trim();
  await card.getByRole("button", { name: "Close", exact: true }).click();
  await expect(shown).toHaveCount(0);
  // Listed by name, with no part of the key on screen.
  await expect(card.getByText("Jarvis e2e")).toBeVisible();
  await expect(card.getByText(/never used/).first()).toBeVisible();
  await expect(card.getByText(key.slice(0, 10))).toHaveCount(0);

  // A fresh context: no session cookie, only the key.
  const outside = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await outside.get("/api/agent")).status()).toBe(401);

  const snapshot = await outside.get("/api/agent", { headers: { Authorization: `Bearer ${key}` } });
  expect(snapshot.status()).toBe(200);
  const body = await snapshot.json();
  expect(body.member.email).toBe("admin@vffclub.test");
  expect(body.aircraft.map((a: { tailNumber: string }) => a.tailNumber)).toContain("N8318B");
  expect(body.flying).toHaveProperty("landingCurrency");
  expect(body.money).toHaveProperty("outstandingDollars");

  // The same data as MCP tools.
  const init = await (await mcp(outside, key, "initialize", { protocolVersion: "2025-06-18" })).json();
  expect(init.result.serverInfo.name).toBe("vff-app");
  const list = await (await mcp(outside, key, "tools/list")).json();
  expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("get_aircraft_status");
  const call = await (await mcp(outside, key, "tools/call", { name: "get_aircraft_status" })).json();
  expect(call.result.isError).toBe(false);
  expect(JSON.parse(call.result.content[0].text)[0].tailNumber).toBe("N8318B");

  // A signed-in browser session is NOT a key: the route takes keys only.
  expect((await page.request.get("/api/agent")).status()).toBe(401);

  // Revoke from the profile.
  await card.getByRole("button", { name: "Revoke" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Revoke "Jarvis e2e"\?/)).toBeVisible();
  await dialog.getByRole("button", { name: "Revoke" }).click();
  await expect(card.getByText("Jarvis e2e")).toHaveCount(0);

  expect((await outside.get("/api/agent", { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(401);
  expect((await mcp(outside, key, "tools/list")).status()).toBe(401);
  await outside.dispose();
});

/** A tool's result: its parsed JSON, or the error text the model would read. */
async function tool(request: APIRequestContext, key: string, name: string, args: object = {}) {
  const res = await mcp(request, key, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { protocolError: body.error.message as string };
  const text = body.result.content[0].text as string;
  return body.result.isError ? { toolError: text } : { data: JSON.parse(text) };
}

test("a key made to book and file can book and cancel through MCP; a read-only one can't", async ({
  page,
  playwright,
}) => {
  await gotoTab(page, "/profile", "Your profile");
  const card = page.getByTestId("access-keys");
  await card.getByLabel("Also let this key book, cancel my bookings and file my flights").check();
  await card.getByLabel("Name for a new key").fill("Jarvis writes e2e");
  await card.getByRole("button", { name: "Create key" }).click();
  const shown = card.getByTestId("new-access-key");
  await expect(shown).toHaveText(/^vff_\S{40,}$/, { timeout: 60_000 });
  const key = (await shown.textContent())!.trim();
  await card.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card.getByText(/^Can book and file · /).first()).toBeVisible();
  // The box goes back to off for the next key.
  await expect(card.getByLabel("Also let this key book, cancel my bookings and file my flights")).not.toBeChecked();

  // And a read-only one, straight through the API.
  const made = await page.request.post("/api/access-keys", { data: { name: "Reader e2e" } });
  expect(made.status()).toBe(201);
  const reader = (await made.json()) as { key: string; canWrite: boolean };
  expect(reader.canWrite).toBe(false);

  const outside = await playwright.request.newContext({ baseURL: "http://localhost:3100" });

  const writerTools = (await (await mcp(outside, key, "tools/list")).json()).result.tools.map(
    (t: { name: string }) => t.name
  );
  expect(writerTools).toEqual(expect.arrayContaining(["book_airplane", "update_booking", "cancel_booking", "file_flight", "update_flight"]));
  const readerTools = (await (await mcp(outside, reader.key, "tools/list")).json()).result.tools.map(
    (t: { name: string }) => t.name
  );
  expect(readerTools).not.toContain("book_airplane");
  expect(await tool(outside, reader.key, "book_airplane", {})).toHaveProperty("protocolError");
  // Nor can a read-only key reach the booking route directly.
  const direct = await outside.post("/api/reservations", {
    headers: { Authorization: `Bearer ${reader.key}` },
    data: {},
  });
  expect(direct.status()).toBe(401);

  // Book an early-morning hour ~20 days out, in CLUB time.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    new Date(Date.now() + 20 * 86_400_000)
  );
  const booked = await tool(outside, key, "book_airplane", {
    startsAt: `${day}T05:00`,
    endsAt: `${day}T06:00`,
    notes: "booked by e2e through MCP",
  });
  expect(booked).toHaveProperty("data.booked", true);
  const bookingId = (booked as { data: { bookingId: string } }).data.bookingId;

  // The same hour again is the app's own conflict check, read back as words.
  const clash = await tool(outside, key, "book_airplane", { startsAt: `${day}T05:30`, endsAt: `${day}T06:30` });
  expect(clash).toHaveProperty("toolError");

  const listed = await tool(outside, key, "get_bookings");
  const mine = (listed as { data: { bookings: { id: string; yours: boolean }[] } }).data.bookings.find(
    (b) => b.id === bookingId
  );
  expect(mine?.yours).toBe(true);

  // Moving it an hour later and changing the notes is the app's own edit.
  const moved = await tool(outside, key, "update_booking", {
    bookingId,
    startsAt: `${day}T06:00`,
    endsAt: `${day}T07:00`,
    notes: "moved by e2e through MCP",
  });
  expect(moved).toHaveProperty("data.updated", true);
  expect(moved).toHaveProperty("data.notes", "moved by e2e through MCP");
  const relisted = await tool(outside, key, "get_bookings");
  const movedRow = (relisted as { data: { bookings: { id: string; startsAt: string }[] } }).data.bookings.find(
    (b) => b.id === bookingId
  );
  expect(new Date(movedRow!.startsAt).getTime()).toBe(
    new Date((booked as { data: { startsAt: string } }).data.startsAt).getTime() + 3_600_000
  );
  // A read-only key can't reach the edit routes directly either.
  const directEdit = await outside.patch(`/api/reservations/${bookingId}`, {
    headers: { Authorization: `Bearer ${reader.key}` },
    data: { notes: "nope" },
  });
  expect(directEdit.status()).toBe(401);

  expect(await tool(outside, key, "cancel_booking", { bookingId })).toEqual({
    data: { cancelled: true, bookingId },
  });
  const after = await tool(outside, key, "get_bookings");
  expect((after as { data: { bookings: { id: string }[] } }).data.bookings.map((b) => b.id)).not.toContain(
    bookingId
  );

  // Filing goes through the app's own meter check: a tach that runs backwards
  // is refused, and nothing is written (a real filing would move N8318B's
  // meters under every later spec).
  const backwards = await tool(outside, key, "file_flight", { tachStart: 9000, tachEnd: 8999 });
  expect(backwards).toHaveProperty("toolError");

  // Corrections name the entry by the id get_my_flying gives; one that isn't
  // there is the route's own 404, read back as words. (No real entry is
  // edited: that re-bills it and marks a signed lesson as edited.)
  const flying = (await tool(outside, key, "get_my_flying")) as {
    data: { recentFlights: { id: string }[] };
  };
  for (const f of flying.data.recentFlights) expect(f.id).toEqual(expect.any(String));
  expect(await tool(outside, key, "update_flight", { flightId: "no-such-flight", notes: "x" })).toHaveProperty(
    "toolError"
  );
  const directFix = await outside.patch("/api/flights/no-such-flight", {
    headers: { Authorization: `Bearer ${reader.key}` },
    data: { notes: "nope" },
  });
  expect(directFix.status()).toBe(401);

  await outside.dispose();
  // Tidy up: revoke both, so later runs start from an empty card.
  for (const k of (await (await page.request.get("/api/access-keys")).json()) as { id: string }[]) {
    await page.request.delete(`/api/access-keys/${k.id}`);
  }
});
