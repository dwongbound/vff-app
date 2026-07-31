# VFF app — quick map

Dense index so you can jump straight to files without searching. The README is
the human-facing setup guide; this file is the "where is it" lookup.

## Stack (verified against package.json)

Next **16** (App Router) · React **19** · TypeScript **6** · Tailwind **4**
(`@tailwindcss/postcss`) · NextAuth 4 (credentials + optional Google) · Prisma
**7** (`prisma-client` generator → `lib/generated/prisma`, imported via
`lib/prisma.ts`) · PostgreSQL · Vitest (unit) · Playwright (e2e) · Docker.

## Commands

- Dev (docker): `docker compose --profile dev up` → http://localhost:3000
- Dev (host): `npm run dev` (loads `env/dev.env`)
- Unit: `npm run test:unit` · E2E: `npm run test:e2e` (needs `db-test` up)
- Everything in containers: `docker compose --profile test up --abort-on-container-exit`
- `npm run typecheck` · `db:push` · `db:seed` · `db:studio`
- Env: templates in `env.example/`, real values in gitignored `env/{dev,test,prod}.env`.
- No Node on the host? Run any of these through
  `docker run --rm -e DATABASE_URL=… -v "$PWD":/app -w /app node:24 sh -c "…"`.

## Data model (`prisma/schema.prisma`)

- **User** — email doubles as username; `isAdmin` is club-wide (first account
  created gets it, see `app/api/signup`). Pilot paperwork (`certificate`,
  `medicalExpiresOn`, `flightReviewOn`) is informational.
- **Aircraft** — tail number, model, `hourlyRateCents`, `fuelCapacityGal`,
  `homeBase`, plus `lastTach`/`lastHobbs` advanced by each filed flight.
  Everything else is keyed by aircraft, so a second airplane is a row.
- **Reservation** — `startsAt`/`endsAt`, `purpose`, `status`. Overlap enforced
  in the API via `lib/reservations.ts`; cancel = `CANCELED`, never deleted.
- **Flight** — tach/Hobbs in-out, landings, route, fuel/oil, `tiedDown`,
  `cabinClean`. `reservationId` is `@unique` (one filed flight per booking).
- **Squawk** — severity `NOTE|MONITOR|GROUNDING`, status `OPEN|RESOLVED`.
  Open GROUNDING ⇒ app-wide red banner (Navbar). Admin-only sign-off.
- **PreflightCheck** — `answers` JSON `{ itemId: true }` against
  `lib/checklist.ts` + `checklistVersion` (v2 = I'M SAFE + 5 Ps sections);
  `completedAt` = signed off.
- **Flight** also carries `nightLandings` (full-stop, for currency) and
  `withInstructor` (selects the third column of the operating rules);
  **User** carries self-declared `totalTimeHours`.
- **Photo** — storage `key` + metadata; `flightId` / `squawkId` / `preflightId`.

## Pages (`app/*/page.tsx`)

`login` · `preflight` · `postflight` · `log` · `reservations` · `profile`.
`layout.tsx` = pre-hydration theme script + nav + swipe pager;
`loading.tsx` = the airplane splash; `providers.tsx` = session/loading/aircraft/me.
`/` redirects to `/reservations` (next.config.js).

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `signup` (first account ⇒ admin), `me` (GET/PATCH).
- `aircraft` (GET all + open squawks) · `aircraft/[id]` (PATCH, admin).
- `reservations` (GET window, POST) · `reservations/[id]` (PATCH, DELETE=cancel).
- `flights` (GET, POST — also advances the aircraft's meters) · `flights/[id]`.
- `preflight` (GET recent, POST; `complete:true` requires every item ticked).
- `squawks` (GET, POST) · `squawks/[id]` (PATCH; status change = admin only).
- `photos` (POST multipart) · `photos/[id]` (GET streams bytes, DELETE).

## lib (pure logic, unit-tested where noted)

- `reservations.ts` — `overlaps` (half-open, so back-to-back bookings are
  legal), `findConflict`, `validateReservation`, `upcoming`/`past`. ✅tested
- `hours.ts` — tach/Hobbs math, `validateMeters` (catches the mis-read meter),
  totals, cost, formatting. ✅tested
- `checklist.ts` — I'M SAFE + the 172 walkaround + 5 Ps, every item with a
  `why` for the (i) popover; `parseAnswers`/`isComplete`. ✅tested
- `operatingRules.ts` — VFF-OR-A as data: `pilotTier`, `ruleFor`,
  `landingCurrency`, `hoursInLastYear`, the mnemonics. ✅tested
- `dates.ts` — formatting, `toLocalInputValue`, `calendarMonthsFrom`.
- `constants.ts` — club name, purposes/severities + tones, policy limits.
- `auth.ts` — `authOptions`, `getSessionUser()`, `getAdminUser()` (re-reads db).
- `serialize.ts` — row → wire shapes; `types.ts` — the `Api*` interfaces.
- `storage/` — `index.ts` (driver choice + `photoKey`), `local.ts`, `s3.ts`
  (SigV4 by hand, no AWS SDK).
- `api.ts` — `fetchJson`/`fetchJsonArray`/`sendJson` client helpers.
- `theme.ts` (light/dark/system) · `navDirection.ts` (swipe slide direction).

## Components

Feature: `Navbar` (top strip + phone bottom bar), `SwipePager`/`SwipeProvider`
(phone tab swipe), `LoadingProvider` (one shared splash), `AuthGate`,
`MeProvider`, `AircraftProvider` (fleet + grounded state, refetches on
sign-in), `ReservationCalendar` (desktop month grid), `ReservationList`
(phone), `ReservationModal`, `FlightDetailModal`, `SquawkPanel`,
`SquawkDraftModal`, `PhotoUploader`, `Logo`, `OperatingRules`
(`MyLimitsCard` on preflight / `RulesReference` on the log / `GumpsCard`).
Primitives in `components/common/`: `Badge Banner Button Card DateTimeField
Dropdown InfoTip Input Modal Select Textarea LoadingDots LoadingScreen`.
Prefer extending these. `DateTimeField` = native picker on touch, themed
popover on desktop; `InfoTip` = the (i) marker (hover opens, click pins).

## Gotchas

- The app is written entirely in `indigo-*` classes; `tailwind.config.ts`
  remaps that palette to the club's Cessna orange. Don't add literal oranges.
- `Button` sets `inline-flex`; adding a `hidden sm:inline-flex` class to it is
  a stylesheet-order coin flip. Hide with a wrapper `<div className="hidden
  sm:block">`.
- Hints/errors live OUTSIDE the `<label>` in `Input`/`Textarea` — inside, they
  become part of the field's accessible name.
- The login page gates its submit buttons on a `ready` flag: pre-hydration
  clicks otherwise do a native GET submit and wipe the form. E2E waits on that
  same "enabled" signal as its hydration marker (`tests/e2e/helpers.ts`).
- Photos are uploaded AFTER their subject row exists (`PhotoUploader` holds
  `File[]`; the page calls `uploadPhotos()` with the new id).
- The Playwright image tag in `docker-compose.yml` must match the pinned
  `@playwright/test` version.
- `getByLabel` matches substrings: "Landings" also hits "Night landings", and
  "Start" hits "Open calendar for Start". Specs use `{ exact: true }`.
- CI lives in `.github/workflows/ci.yml` and materialises `env/test.env`
  itself, since the e2e harness loads that file rather than process env.
