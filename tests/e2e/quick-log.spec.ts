import { expect, test } from "@playwright/test";
import { clearOpenSessions, signIn } from "./helpers";

// Quick Log — the four-numbers path into the flight log.
//
// Named to sort after `postflight.spec.ts` and before `runway.spec.ts`, which
// is fine on both sides: this spec never signs off a preflight card, so the
// runway spec's "the airplane has NOT been walked today" assertion is
// untouched. See the e2e ordering gotcha in CLAUDE.md.
//
// `clearOpenSessions` in the beforeEach is the precondition that matters here:
// filing with a session open FINISHES that entry rather than inserting one,
// which is correct behaviour and the wrong starting point for a test about
// what a fresh file does.
test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearOpenSessions(page);
  await page.goto("/quick-log");
});

test("files a flight from four numbers, and counts the airports as landings", async ({
  page,
}) => {
  const main = page.getByRole("main");

  // The start meters prefill from the last filed flight, and the hint says so
  // by NAME — an anonymous number is one you can't decide whether to trust.
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  // Wait for the page to stop asking: the start box follows the best reading
  // the app knows, and a late answer (today's preflight walk) can change it
  // after it's been read. See the same note in mobile.spec.ts.
  await page.waitForLoadState("networkidle");
  const start = Number(await tachStart.inputValue());

  await main.getByLabel("Tach end", { exact: true }).fill(String(start + 1.2));
  // Three landings at two fields — the count comes off the LIST, and the
  // repeat is counted rather than collapsed.
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA, KSMO, KTOA");
  await expect(main.getByText("3 landings · ends at KTOA")).toBeVisible();

  // Read the id off the POST rather than off "the newest flight" — see the
  // incomplete test below. `?limit=1` hands back whichever the list sorts
  // first, and by the time the whole suite has run that is another spec's
  // flight, filed on the same day.
  const [posted] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST"
    ),
    main.getByRole("button", { name: "File", exact: true }).click(),
  ]);
  await expect(main.getByText(/Filed 1\.2 hours/)).toBeVisible();

  const flight = (await posted.json()) as {
    landings: number;
    arrival: string | null;
    route: string | null;
    tachEnd: number | null;
    filedAt: string | null;
  };
  expect(flight.landings).toBe(3);
  expect(flight.arrival).toBe("KTOA");
  expect(flight.route).toBe("KTOA → KSMO → KTOA");
  expect(flight.filedAt).not.toBeNull();
});

// The whole point of allowing this: a member who never got the shutdown
// reading should still be able to record that the flight happened, because a
// row with a gap is a better record than no row. It bills nothing until the
// number arrives, and the log has to make it findable so it does.
test("files an incomplete entry with no tach end, and the log flags it", async ({
  page,
}) => {
  const main = page.getByRole("main");

  // The button is never disabled by a missing reading, and it always says
  // "File" — the missing reading is explained in a confirmation instead, the
  // same bargain the checkout pages' Complete button strikes.
  // Same wait: the incomplete case still needs the START prefill to have
  // landed, or the entry files with both meters missing and the badge below
  // reads "Needs tach start & tach end".
  await expect(main.getByLabel("Tach start", { exact: true })).not.toHaveValue("");
  const file = main.getByRole("button", { name: "File", exact: true });
  await expect(file).toBeEnabled();
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA");

  // It asks first, and says what the gap means and how to close it.
  await file.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("File without a tach end?")).toBeVisible();
  await expect(dialog.getByText(/Needs tach end/)).toBeVisible();
  await expect(dialog.getByText(/open the entry in the Flight log/)).toBeVisible();
  // "Keep editing" changes nothing.
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await file.click();

  // Read the id off the POST rather than off "the newest flight": several
  // specs file on the same day against one database, and `?limit=1` hands
  // back whichever the list happens to sort first — which is how this
  // assertion first passed against another test's flight.
  const [posted] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST"
    ),
    dialog.getByRole("button", { name: "File anyway" }).click(),
  ]);
  const flight = (await posted.json()) as {
    id: string;
    tachEnd: number | null;
    filedAt: string | null;
  };

  // The confirmation, specifically — "marked incomplete" alone also matches
  // the hint beside the button, which is on screen before anything is filed.
  await expect(main.getByText(/^Filed on .* with no tach end/)).toBeVisible();
  // FILED with a gap — not left open. An entry stuck open would say the
  // airplane never came back.
  expect(flight.tachEnd).toBeNull();
  expect(flight.filedAt).not.toBeNull();

  // And it is findable: an entry nobody can see is one nobody fixes.
  await page.goto("/log");
  await expect(
    page.getByRole("main").getByText("Needs tach end").first()
  ).toBeVisible();
});

// A missing number is filed; a WRONG one is refused. Tach end below tach start
// is a misread meter, and filing it would put a false figure in the log rather
// than an honest gap.
test("still refuses a tach end below the start", async ({ page }) => {
  const main = page.getByRole("main");
  // Wait for the prefill to land before reading it. Without this the box is
  // still empty, `Number("")` is 0, and the test types a NEGATIVE tach end
  // into a `min="0"` field — which the browser drops, so nothing is wrong and
  // no error appears. The failure looks like the validation is broken.
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  // Wait for the page to stop asking: the start box follows the best reading
  // the app knows, and a late answer (today's preflight walk) can change it
  // after it's been read. See the same note in mobile.spec.ts.
  await page.waitForLoadState("networkidle");
  const start = Number(await tachStart.inputValue());
  await main.getByLabel("Tach end", { exact: true }).fill(String(start - 5));

  await expect(main.getByText(/lower than tach start/)).toBeVisible();
  await expect(main.getByRole("button", { name: /^File/ })).toBeDisabled();
});

// The one control that decides whether a member gets paid back, so it is
// pinned: visible without having to type a cost first (it used to be revealed
// by the cost box and people couldn't find it), defaulting to the member's own
// card, and actually reaching the server.
test("the card toggle is visible up front and decides the reimbursement", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /Fuel & oil/ }).click();

  const toggle = main.getByRole("switch", { name: /club's card/i });
  await expect(toggle).toBeVisible();
  // Defaults to the member's own card — the safe direction, the one that
  // cannot quietly swallow money somebody is owed.
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await main.getByLabel("Fuel added", { exact: true }).fill("20");
  await main.getByLabel("Price per gallon", { exact: true }).fill("6.99");
  // The total is worked out on the page as the member types, and it's the
  // same sum the server stores and would credit.
  await expect(main.getByText("= $139.80 total")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await expect(main.getByLabel("Tach start", { exact: true })).not.toHaveValue("");
  // No tach end is typed here, so File asks first — this test is about the
  // card toggle, so it answers "File anyway".
  await main.getByRole("button", { name: "File", exact: true }).click();
  const [posted] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST"
    ),
    page.getByRole("dialog").getByRole("button", { name: "File anyway" }).click(),
  ]);
  const flight = (await posted.json()) as {
    fuelPricePerGalCents: number | null;
    fuelCostCents: number | null;
    fuelPaidPersonally: boolean;
  };
  expect(flight.fuelPricePerGalCents).toBe(699);
  expect(flight.fuelCostCents).toBe(13_980);
  expect(flight.fuelPaidPersonally).toBe(false);

  // The club buying its own fuel owes nobody anything, so no credit is written.
  const charges = await page.request.get("/api/finances");
  const body = (await charges.json()) as {
    statements: { charges: { kind: string; amountCents: number }[] }[];
  };
  const credits = body.statements
    .flatMap((st) => st.charges)
    .filter((c) => c.kind === "FUEL_CREDIT" && c.amountCents === -12_000);
  expect(credits).toHaveLength(0);
});

// Typed at the tail, it's the form a member walks away from mid-way — to check
// the log, to answer a message. What they typed must still be there.
test("what's typed is kept on the device across tabs, until it's filed or discarded", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const tachStart = main.getByLabel("Tach start", { exact: true });
  await expect(tachStart).not.toHaveValue("");
  const end = (Number(await tachStart.inputValue()) + 0.6).toFixed(1);
  await main.getByLabel("Tach end", { exact: true }).fill(end);
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA, KSMO");
  await expect(main.getByText(/Saved on this device/)).toBeVisible();

  // Off to another tab and back: still there.
  await page.goto("/log");
  await expect(page.getByRole("main").getByRole("heading", { name: "Flight log" })).toBeVisible();
  await page.goto("/quick-log");
  await expect(main.getByLabel("Tach end", { exact: true })).toHaveValue(end, {
    timeout: 30_000,
  });
  await expect(main.getByLabel("Landed at", { exact: true })).toHaveValue("KTOA, KSMO");

  // A full reload too.
  await page.reload();
  await expect(main.getByLabel("Tach end", { exact: true })).toHaveValue(end, {
    timeout: 30_000,
  });

  // Discard empties what the member typed, and the draft with it.
  await main.getByRole("button", { name: "Discard" }).click();
  await expect(main.getByLabel("Tach end", { exact: true })).toHaveValue("");
  await expect(main.getByText(/Saved on this device/)).toHaveCount(0);
  await page.reload();
  await expect(main.getByLabel("Landed at", { exact: true })).toHaveValue("", {
    timeout: 30_000,
  });

  // And filing clears it: type again, file, come back to an empty form.
  await main.getByLabel("Tach end", { exact: true }).fill(end);
  await main.getByLabel("Landed at", { exact: true }).fill("KTOA");
  const [posted] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/flights") && r.request().method() === "POST"
    ),
    main.getByRole("button", { name: "File", exact: true }).click(),
  ]);
  const { id } = (await posted.json()) as { id: string };
  await expect(main.getByText(/^Filed /)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(main.getByLabel("Landed at", { exact: true })).toHaveValue("", {
    timeout: 30_000,
  });
  await expect(main.getByText(/Saved on this device/)).toHaveCount(0);

  // Tidy up: a stray flight moves the airplane's tach for every later spec.
  await page.request.delete(`/api/flights/${id}`);
});

/** The content column's left and right edges (main, inside its padding). */
async function contentEdges(page: import("@playwright/test").Page) {
  return page.getByRole("main").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return {
      left: box.left + parseFloat(css.paddingLeft),
      right: box.right - parseFloat(css.paddingRight),
    };
  });
}

test("on a computer, File sits at the right of the form", async ({ page }) => {
  const file = page.getByRole("main").getByRole("button", { name: "File", exact: true });
  await expect(file).toBeVisible({ timeout: 60_000 });
  const edges = await contentEdges(page);
  const box = (await file.boundingBox())!;
  // Flush right, and a button's width rather than the column's.
  expect(Math.abs(box.x + box.width - edges.right)).toBeLessThan(2);
  expect(box.width).toBeLessThan((edges.right - edges.left) / 3);
});
