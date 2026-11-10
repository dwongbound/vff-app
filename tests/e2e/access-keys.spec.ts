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
