// The photo round trip: pick an image in the post-flight form, and it should
// come back out of storage on the flight-log entry. This is the only test that
// exercises lib/storage end to end (upload → row → authed read), so it's worth
// having even though it's the slowest spec here.
import { expect, test } from "@playwright/test";
import {
  gotoTab,
  openMeters,
  openPostflightSection,
  settledTachStart,
  signIn,
} from "./helpers";

// A real 2×2 PNG, hand-assembled so the suite doesn't need a fixture file on
// disk (and so the bytes are small enough to be free).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z4AAT" +
    "AxIYFQwuoQBAB6uAQ/2Ci4dAAAAAElFTkSuQmCC",
  "base64"
);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("a photo attached to a flight comes back on the log entry", async ({ page }) => {
  await gotoTab(page, "/postflight", "Post-flight");

  await openMeters(page);
  const tachStart = await settledTachStart(page);
  await page.getByLabel("Tach end").fill((Number(tachStart) + 1.2).toFixed(1));

  // The uploader lives in Servicing, which is its own collapsed section now.
  await openPostflightSection(page, /Servicing/);
  // The uploader holds the file locally and only sends it once the flight row
  // exists — see components/PhotoUploader.tsx.
  await page.locator('input[type="file"]').setInputFiles({
    name: "hobbs.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("img", { name: "hobbs.png" })).toBeVisible();

  await page.getByRole("button", { name: "File" }).click();
  await expect(page.getByText(/Filed 1.2 hours/)).toBeVisible({ timeout: 60_000 });

  // Open the newest entry in the log and confirm the image actually loads
  // through /api/photos/[id] rather than 404ing.
  await gotoTab(page, "/log", "Flight log");
  await page.getByRole("button", { name: /1\.2/ }).first().click();

  const photo = page.getByRole("img", { name: "Flight photo" }).first();
  await expect(photo).toBeVisible();
  // Decoded pixels, not just an <img> tag: naturalWidth stays 0 if the route
  // 404s or hands back something that isn't an image. It's polled because the
  // element renders before the bytes arrive.
  await expect
    .poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
});

test("photo bytes are only served to signed-in members", async ({ page, browser }) => {
  // Grab a photo id the signed-in session can see. The test above files a
  // flight with one, so SOME entry carries a photo — found by its count rather
  // than by position: several specs file flights on the same day, so "the
  // newest" isn't reliably the one with the photo, and this test used to
  // quietly SKIP when it guessed wrong (which is how it went missing from a
  // sharded run). List rows only count photos, so the photo itself comes off
  // that entry's full record.
  const rows = (await page.request
    .get("/api/flights?limit=50")
    .then((r) => r.json())) as { id: string; photoCount: number }[];
  const withPhoto = rows.find((row) => row.photoCount > 0);
  expect(withPhoto, "an entry with the photo the test above attached").toBeTruthy();
  const flight = (await page.request
    .get(`/api/flights/${withPhoto!.id}`)
    .then((r) => r.json())) as { photos: { id: string }[] };
  expect(flight.photos.length).toBeGreaterThan(0);

  const url = `/api/photos/${flight.photos[0].id}`;
  expect((await page.request.get(url)).status()).toBe(200);

  // …and confirm the same URL without the session cookie is turned away.
  const anonymous = await browser.newContext();
  const res = await anonymous.request.get(`http://localhost:3100${url}`);
  expect(res.status()).toBe(401);
  await anonymous.close();
});
