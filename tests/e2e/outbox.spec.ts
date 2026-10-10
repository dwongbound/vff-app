import { expect, test } from "@playwright/test";
import { clearOpenSessions, signIn } from "./helpers";

// The outbox — a submission made with no signal is kept on the device and
// sent by the app itself once there is some. See lib/outbox.ts.
//
// Driven through Quick Log because it's the shortest real filing in the app,
// and it never signs off a checkout card, so it can sort anywhere without
// disturbing the runway spec (see the e2e ordering gotcha in CLAUDE.md).
//
// The browser is genuinely offline here (`context.setOffline`), so the POST
// fails exactly as it does on a ramp, rather than a mocked route pretending
// to. There's no service worker under `next dev` — this is the outbox alone.
test.beforeEach(async ({ page }) => {
  await signIn(page);
  // A file with a session open FINISHES that entry rather than inserting one.
  await clearOpenSessions(page);
  await page.goto("/quick-log");
});

test.afterEach(async ({ context }) => {
  await context.setOffline(false);
});

test("a flight filed with no signal waits on the device, then sends itself", async ({
  page,
  context,
}) => {
  const main = page.getByRole("main");
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  const start = Number(await tachStart.inputValue());
  await main.getByLabel("Tach end", { exact: true }).fill((start + 0.7).toFixed(1));
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA");

  await context.setOffline(true);
  await main.getByRole("button", { name: "File flight" }).click();

  // Not an error: the page says it's kept, and the strip says it's waiting.
  await expect(main.getByText(/^Saved offline/)).toBeVisible();
  await expect(main.getByText("1 flight waiting for signal")).toBeVisible();
  await expect(main.getByText(/Could not|went wrong/i)).toHaveCount(0);

  // Signal back. The outbox sends on the `online` event, or on its own tick.
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/flights") &&
      r.request().method() === "POST" &&
      r.status() < 300,
    { timeout: 45_000 }
  );
  await context.setOffline(false);
  const response = await sent;
  const flight = (await response.json()) as { id: string; tachEnd: number | null };
  expect(flight.tachEnd).toBeCloseTo(start + 0.7, 1);

  // And the strip clears once the club has it.
  await expect(main.getByText(/waiting for signal/)).toHaveCount(0);

  // The same request again — the lost-reply case — gets the SAME flight back
  // rather than a second one. That's the idempotency key doing its job.
  const body = JSON.parse(response.request().postData() ?? "{}");
  expect(typeof body.requestId).toBe("string");
  const replay = await page.request.post("/api/flights", { data: body });
  expect(replay.status()).toBe(200);
  expect(((await replay.json()) as { id: string }).id).toBe(flight.id);
});

// The server's half, for the two other kinds of record the outbox files. The
// lost-reply case is the same request arriving twice; each must come back as
// the row the first one wrote, not a second row.
test("a squawk or a sign-off sent twice is filed once", async ({ page }) => {
  const aircraft = (await (await page.request.get("/api/aircraft")).json()) as { id: string }[];
  const aircraftId = aircraft[0].id;

  const squawk = {
    aircraftId,
    title: `E2E replayed squawk ${Date.now()}`,
    requestId: crypto.randomUUID(),
  };
  const first = await page.request.post("/api/squawks", { data: squawk });
  const again = await page.request.post("/api/squawks", { data: squawk });
  expect(first.status()).toBe(201);
  expect(again.status()).toBe(200);
  const squawkId = ((await first.json()) as { id: string }).id;
  expect(((await again.json()) as { id: string }).id).toBe(squawkId);

  // A RUNWAY card rather than a preflight: signing off a preflight here would
  // break runway.spec's "not walked today" precondition (see CLAUDE.md).
  const signOff = {
    aircraftId,
    kind: "RUNWAY",
    answers: {},
    complete: true,
    acknowledgeIncomplete: true,
    requestId: crypto.randomUUID(),
  };
  const signed = await page.request.post("/api/checkouts", { data: signOff });
  const resigned = await page.request.post("/api/checkouts", { data: signOff });
  expect(signed.status()).toBe(201);
  expect(resigned.status()).toBe(200);
  expect(((await resigned.json()) as { id: string }).id).toBe(
    ((await signed.json()) as { id: string }).id
  );

  // Tidy up: the sign-off opened a flight session, and the squawk is open.
  await clearOpenSessions(page);
  await page.request.patch(`/api/squawks/${squawkId}`, { data: { status: "CLOSED" } });
});
