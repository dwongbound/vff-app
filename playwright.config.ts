// E2E config. Prereq: the test db must be running —
//   docker compose --profile test up -d db-test
// Then: npm run test:e2e
// (Or run the whole suite in docker: docker compose --profile test up.)
//
// global-setup resets + reseeds the db, and the webServer block boots the
// app on port 3100 with env/test.env automatically.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Tests share one database, so run serially to keep state predictable.
  fullyParallel: false,
  workers: 1,
  // Retry rather than fail the suite on a transient miss under container load;
  // a genuinely broken test still fails all its attempts.
  retries: 2,
  // The suite runs against `next dev`, which compiles each route the first
  // time a test visits it — in a container that can take longer than the 30s
  // default before the page even renders. Generous per-test and per-assertion
  // budgets keep a cold compile from being reported as a broken app.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  // Three projects, one per shape the app takes:
  //
  //   desktop (1280) — nav rail, month grid, top bar; the roomy case
  //   ipad (834)     — the SAME desktop layout, at the narrowest width that
  //                    gets it. The rail costs a fixed 15rem, so this is where
  //                    the content column is thinnest and a page is likeliest
  //                    to overflow or run under the rail.
  //   iphone (402)   — below `md`: the bottom pill replaces the rail, and the
  //                    pages switch to their narrow forms (reservation list
  //                    instead of the grid, the "+" FAB, native date pickers)
  //
  // Each project runs the specs written for its shape: `mobile.spec.ts` covers
  // the narrow branches, `ipad.spec.ts` covers the desktop layout under
  // pressure, and everything else assumes a comfortable desktop.
  //
  // They are not all the same ENGINE, which matters when installing browsers:
  // "Desktop Chrome" is Chromium, but Playwright's iPad and iPhone descriptors
  // are Safari device profiles and default to WEBKIT. That's deliberate — an
  // iPhone member really is on Safari — but it means `playwright install
  // chromium` alone leaves two thirds of the suite with nothing to launch. CI
  // installs one engine per leg; see the e2e matrix in .github/workflows/ci.yml.
  //
  // `tour.spec.ts` is the exception — it runs in ALL THREE. The guided tour
  // measures live nav elements to place its highlight, so it's the one feature
  // whose correctness is a function of the layout, and a desktop-only check
  // would pass while the phone highlight pointed at nothing.
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /(mobile|ipad)\.spec\.ts/,
    },
    {
      name: "ipad",
      use: { ...devices["iPad Pro 11"] },
      testMatch: /(ipad|tour)\.spec\.ts/,
    },
    {
      name: "iphone",
      use: { ...devices["iPhone 16 Pro"] },
      testMatch: /(mobile|tour)\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
