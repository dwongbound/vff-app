# VFF app — quick map

Dense index so you can jump straight to files without searching. The README is
the human-facing setup guide; this file is the "where is it" lookup.

## Stack (verified against package.json)

Next **16** (App Router) · React **19** · TypeScript **6** · Tailwind **4**
(`@tailwindcss/postcss`) · NextAuth 4 (credentials + optional Google) · Prisma
**7** (`prisma-client` generator → `lib/generated/prisma`, imported via
`lib/prisma.ts`) · PostgreSQL · Vitest (unit) · Playwright (e2e) · Docker.

## Commands

- Dev (docker): `docker compose --profile dev up` → `http://localhost:3000`
- Dev (host): `npm run dev` (loads `env/dev.env`)
- Unit: `npm run test:unit` · E2E: `npm run test:e2e` (needs `db-test` up).
  Three e2e projects, one per layout: `desktop` (1280), `ipad` (834 — the
  narrowest width that still gets the rail, so the tightest content column) and
  `iphone` (402 — bottom pill + the narrow page branches). `tour.spec.ts` runs
  in all three; everything else is scoped by `testMatch`/`testIgnore`.
  One project: `npx playwright test --project=ipad`.
  They are NOT all the same browser engine: desktop is Chromium, but the iPad
  and iPhone presets are Safari device profiles and run on **webkit**. CI runs
  the three as parallel matrix jobs, each installing only its own engine.
- Everything in containers: `docker compose --profile test up --abort-on-container-exit`
- `npm run typecheck` · `db:push` · `db:seed` · `db:studio` ·
  `db:migrate -- --name <change>` (writes `prisma/migrations/`, which is what
  production applies — see the schema-change gotcha).
- Image: `docker build --build-arg COMMIT_SHA=$(git rev-parse HEAD) -t vff-app .`
  CI builds and pushes the same image to `ghcr.io/<owner>/vff-app` on green main.
- Env: templates in `env.example/`, real values in gitignored `env/{dev,test,prod}.env`.
- No Node on the host? Run any of these through
  `docker run --rm -e DATABASE_URL=… -v "$PWD":/app -w /app node:24 sh -c "…"`.

## Data model (`prisma/schema.prisma`)

- **User** — email doubles as username; `isAdmin` is club-wide (first account
  created gets it, see `app/api/signup`; after that admins promote each other
  from the Members tab). Pilot paperwork (`certificate`, `medicalExpiresOn`,
  `flightReviewOn`) is informational and stays private to the member — the
  roster API never selects it. `clubMember` is the OTHER half of "what is this
  person to the club": it says they FLY here, as opposed to only teaching here.
  Independent of the INSTRUCTOR position on purpose — a club CFI who also rents
  the airplane is both, a visiting instructor is only the office — and it's
  what gates booking and the Finances tab (`reservation:book` /
  `finance:read-own` in `lib/positions.ts`). Admin-only, from the same Members
  tab; defaults true, which is what every pre-instructor account was.
- **Aircraft** — tail number, model, `hourlyRateCents`, `fuelCapacityGal`,
  `homeBase`, plus `lastTach`/`lastHobbs` advanced by each filed flight.
  Everything else is keyed by aircraft, so a second airplane is a row.
  Weight & balance splits in two: `wbProfile` names a profile in
  `lib/weightBalance.ts` (the TYPE's stations + CG envelope, code because the
  airframe's design doesn't change), while `emptyWeightLbs` /
  `emptyMomentLbIn` / `weighedOn` are THIS airframe's basis off its latest
  signed W&B revision — which changes with every radio swap, so it's columns.
  Either half missing ⇒ the tool declines rather than assuming an airplane.
- **Reservation** — `startsAt`/`endsAt`, `purpose`, `status`. Overlap enforced
  in the API via `lib/reservations.ts`; cancel = `CANCELED`, never deleted.
  `instructorId` is the CFI a lesson is booked with — only ever set when
  `purpose` is TRAINING, and the API NULLS IT OUT for every other purpose
  rather than leaving a stale name on a booking that changed.
- **Flight** — tach/Hobbs in-out, landings, route, fuel/oil, `landingFeeCents`,
  `tiedDown`, `cabinClean`. `reservationId` is `@unique` (one filed flight per booking).
  `turnoffAnswers` + `turnoffCheckoutVersion` hold the TURN-OFF checkout
  (`TURNOFF_CHECKOUT`), and `tiedDown`/`cabinClean` are DERIVED from it in the
  API (`derivePutAway`) whenever it's been answered — they mean "confirmed",
  not "a toggle nobody moved".
- **Servicing** — fuel or oil put IN, with no flight attached. The post-flight
  form still records what went in after a flight (on `Flight`); this is the
  before-you-fly / nobody-flew-today case, which previously had nowhere to go,
  so it went unrecorded. `paidPersonally` is the club sheet's "Fuel Purchase
  Personal Card" column, and it's the only thing that decides whether a
  FUEL_CREDIT is written (`servicingCredit` → `syncServicingCharges`). Never
  touches the tach: no flight happened.
- **MaintenanceItem** — what the airplane is DUE for: the annual, the 50-hour
  oil change, the pitot-static and transponder checks, the ELT. Transcribed
  from the club's own spreadsheet, whose ten columns are arithmetic on FOUR
  stored facts — `intervalHours`/`intervalMonths` (either may be null; the
  tighter one wins) and `lastDoneTach`/`lastDoneOn`. Everything else (hours
  remaining, days remaining, tach due, date due, which item is next) is derived
  in `lib/maintenance.ts`, because a stored countdown is wrong by one the
  morning after it's written. `requiredByReg` is the sheet's own column and is
  the whole difference between "overdue" and "grounded": only a legally
  required item stops dispatch.
- **Squawk** — ONE status enum, the club's own sheet vocabulary:
  `NEW | REVIEWED_OK_TO_FLY | REVIEWED_IN_WORK | REVIEWED_GROUNDED | CLOSED`.
  There is deliberately no separate `severity`: "reviewed, aircraft grounded"
  is triage state and dispatch impact at once, and holding it as two columns
  gave the club two sources of truth for "can it fly". Members FILE squawks
  from the checkouts (always lands at `NEW`, status is not readable off the
  POST body); everything else — status, wording, closing — needs
  `squawk:manage`. `REVIEWED_GROUNDED` ⇒ app-wide red banner (Navbar) + the
  Status tab's "do not fly" card; `REVIEWED_IN_WORK` ⇒ an amber "in
  maintenance" card that is explicitly NOT a grounding.
- **Checkout** — one run of ONE of the airplane's cards. `kind` is
  `PREFLIGHT | RUNWAY` (the third, TURNOFF, lives on Flight — it belongs to
  that flight, not to a standalone row). `answers` JSON `{ itemId: true }`
  against `lib/checkouts.ts` + `checkoutVersion` (per-kind: PREFLIGHT is at 7,
  continuing the old checklist's v3; RUNWAY at 3; TURNOFF at 4);
  `completedAt` = signed off. Photos and squawks point at `checkoutId`.
- **Flight** also carries `nightLandings` (full-stop, for currency) and
  `withInstructor` (selects the third column of the operating rules);
  **User** carries self-declared `totalTimeHours`.
- **Flight**'s instructor endorsement — `instructorId` (who is to sign),
  `signedById`/`signedAt` (who did, and when), `editedAt` (when the entry's
  CONTENT last changed). Copied off the booking when a flight is filed against
  a TRAINING reservation, settable by hand for a lesson never booked in the
  app. `editedAt` exists rather than reusing `updatedAt` because signing is
  itself a write — see the gotcha.
- **SignupCode** — the club's front door. `code` (stored normalised),
  `kind` (`MEMBER | INSTRUCTOR`), `active`, `uses`/`lastUsedAt`. Reusable;
  retired by clearing `active`, and DELETE is refused once it has let anyone in
  so the record of how they joined survives.
- **Photo** — storage `key` + metadata; `flightId` / `squawkId` / `preflightId`.
- **Position** (enum on `User.positions`) — club offices. Powers live in
  `lib/positions.ts`, never inline in a route. `INSTRUCTOR` (CFI) is in here
  too: not an elected office, but handed out by an admin from the same roster
  screen and carrying a capability (`flight:sign`).
- **RecurringCharge** — the RULE for a standing monthly charge (dues). Editing
  it never restates months already billed.
- **Charge** — one statement line, positive = owed, negative = credit. Kinds:
  `DUES | FLIGHT | FUEL_CREDIT | ONE_OFF | LANDING_FEE` (the last appended, the
  safe kind of enum change).
  `paidAt`/`paidById` is SETTLED and is deliberately not `voided`: a voided
  line should never have stood, a paid one stood and has been met, so paying
  leaves the month's totals alone and only moves `outstandingCents`. `period`
  is stored ("YYYY-MM") rather than derived, so correcting a date can't silently
  move money between settled months. Two unique indexes make the derived kinds
  idempotent — `(memberId, recurringChargeId, period)` and `(flightId, kind)` —
  and rely on Postgres treating NULLs as distinct, which leaves hand-entered
  lines free to repeat.

## Pages (`app/*/page.tsx`)

`login` · `status` (+ `status/squawks`) · `preflight` · `runway` ·
`postflight` · `servicing` (Checkouts › Add Fuel) · `tools/weight-balance` ·
`log` · `reservations` · `members` ·
`finances` · `profile` ·
`settings` (org settings, admin-only, reached from the avatar menu — the fleet,
then the sign-up code lists).
An instructor-only account gets Plane Status, the checkouts, Tools and the
flight log, a READ-ONLY reservations calendar (no New, no per-day "+", every
booking opens the read-only view the modal already had for somebody else's),
and no Finances at all.
`tools/` is a nav GROUP with one entry today — planning arithmetic isn't only
W&B, and promoting a leaf to a group later moves a link people have learned.
Weight & Balance stores nothing: a W&B is true of one load on one day, so the
page is pure calculator over the aircraft's stored basis.
Plane Status › Overview also carries the MAINTENANCE sheet (`MaintenancePanel`),
below the day-to-day panels: anything that stops a flight is already a banner at
the top, so what's left there is reference.
`status/layout.tsx` owns the tail-number header, the dispatch banner
(inspection run out ▸ grounded ▸ in-maintenance, in that priority — the first is `grounding()` over the maintenance sheet, which is also what the Airworthy badge reads) and the Overview/Squawks sub-tab
bar — all three are true of the AIRPLANE rather than of a view, so both child
tabs get them. Sub-tabs rather than rail entries: the rail lists places you go
during a flying day, and Navbar's `isActive` uses `startsWith`, so
`/status/squawks` keeps the Status entry lit for free. `preflight` and `runway` are the two before-the-
flight checkouts — separate pages with separate sign-offs, because they're
walked at different times and an interrupted member must never re-tick the
airplane. Both AUTOSAVE (no Save button — see `lib/checkoutDraft.ts`), so their
one remaining submit means exactly one thing: this walk is done and I'm putting
my name to it. The button says **Complete** and is NEVER disabled by the state
of the card: a member who genuinely can't answer an item — a check this airframe
doesn't allow, a fault already squawked — must still be able to file the walk
they DID do, so an incomplete card is confirmed in a modal
(`CompleteCheckoutButton`) rather than met with a button that won't press and no
explanation. Completing one card opens the NEXT: preflight → `/runway` →
`/postflight`, because the walk ends at the cabin door, the runway card starts
in the seat, and the flight ends at the form. The runway
page carries no "preflight done today" banner: the card's own `start.preflight`
row is the app's answer to that and can't be scrolled past. The turn-off
checkout is a card on `postflight`, and that page AUTOSAVES too (device only —
see `lib/postflightDraft.ts`).
`layout.tsx` = pre-hydration theme script + `AppShell`; `AppShell` = top bar +
nav rail + content column + swipe pager, and is a CLIENT component only because
the column reserves the rail's width (`md:pl-60`) and `/login` — which has no
rail — must not. `providers.tsx` = session/loading/aircraft/me. There is NO
`app/loading.tsx`: a route-level splash is a second `LoadingScreen` stacked on
the provider's overlay, and the swap restarts the animation. `LoadingProvider`
owns the only splash in the app.
`/` redirects to `/reservations` (next.config.js).

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `signup`, `me` (GET/PATCH). Signup needs one of
  the club's codes; the code's LIST decides the account (member vs CFI), so an
  applicant never picks. The ONE exception is the very first account at a fresh
  install — nobody could have issued a code yet — and that one becomes admin.
- `signup-codes` (GET/POST, admin) · `signup-codes/[id]` (PATCH to retire /
  relabel, DELETE only while `uses` is 0). The code STRING is deliberately not
  editable: somebody is holding a slip of paper with it on.
- `checkouts` (GET `?kind=PREFLIGHT|RUNWAY`, POST; `complete:true` with items
  still unticked is ALLOWED, but only with `acknowledgeIncomplete:true` — the
  member's own call, made in a modal that names what's missing, and without the
  flag it's still a 400 so a stale client can't file a half-walked card by
  accident. The answers column records exactly which items were left, so
  "completed" never means more than it should). An
  unrecognised `kind` is a 400, never a silent "show me everything".
  Two housekeeping rules ride on this route, and they exist because the pages
  AUTOSAVE: an open run is now created a couple of seconds after the first tick
  rather than by someone pressing a button, so unclaimed ones would pile up
  forever. POSTing a PARTIAL run retires any the caller already had open on
  that card (`supersedeOpenRuns`), which is the "at most one open run per
  member per airplane per card" invariant `resolveResume` leans on; and
  `?mine=1&open=1` — the resume query — sweeps the caller's runs left idle
  past `ABANDONED_DRAFT_DAYS` (`sweepAbandonedRuns`). Both live in
  `lib/checkoutCleanup.ts`. Sweeping inside a read is the same deliberate
  pattern as finances materialising dues: the read happens exactly when the
  answer matters, so the club needs no cron. `?open=1` also orders by
  `updatedAt`, not `createdAt` — with `limit=1` you want the run you last
  touched, not the one you started first.
- `members` (GET roster, any member) · `members/[id]` (PATCH `isAdmin`,
  `positions` and/or `clubMember`, admin; 409 if it would leave the club with
  no admin, and 409 on un-membering an admin. There is no matching "last
  Finance Officer" rule — admins can already do the job).
- `aircraft` (GET all + open squawks, POST admin) · `aircraft/[id]` (PATCH,
  admin — includes renaming the tail number and the W&B basis; an unknown
  `wbProfile` is a 400, since a stored typo reads later as "this airplane has
  no W&B data" and looks like a bug in the tool. ONE exception: `hourlyRateCents`
  is also writable with `finance:manage`, since the rate is the club's price
  rather than a fact about the airframe. An officer sending any other field
  gets a 403 instead of a silent partial write).
- `finances` (needs `finance:read-own`, so an instructor-only account gets a
  403 rather than an empty month. GET one month's statements — your own, or
  everyone's with `&all=1` and `finance:read-all`. Reading a month is what materialises its
  dues, idempotently, which is why the club needs no cron).
- `finances/charges` (POST one-off, `finance:manage`) · `finances/charges/[id]`
  (PATCH to void/restore/amend, or `{ paid }` to tick a line off as settled;
  DELETE only for hand-entered lines, and the UI confirms it in a dialog).
- `finances/recurring` (GET/POST) · `finances/recurring/[id]` (PATCH, DELETE —
  refuses once it has billed anyone; deactivate instead).
- `reservations` (GET window, POST — needs `reservation:book`, and resolves the
  TRAINING instructor) · `reservations/[id]` (PATCH, DELETE=cancel). The
  instructor is re-resolved on every PATCH against the purpose the booking will
  HAVE, not the one it had.
- `flights` (GET `?instructing=1` for the lessons you're the CFI on, POST —
  also advances the aircraft's meters; both routes read `turnoffAnswers` and
  re-derive the put-away flags) · `flights/[id]` (PATCH stamps `editedAt`) ·
  `flights/[id]/sign` (POST/DELETE — the instructor's endorsement, its own
  route so a signature can never be confused with an edit).
- `maintenance` (POST) · `maintenance/[id]` (PATCH/DELETE) — all three need
  `maintenance:manage`. There is deliberately NO GET: the sheet rides on
  `GET /api/aircraft` beside the open squawks (`AIRCRAFT_INCLUDE` in
  `lib/aircraft.ts`), so every page already holds it and there is one answer to
  "is anything overdue". The common write is PATCH `{ lastDoneTach, lastDoneOn }`
  — the shop handed it back, restart both clocks.
- `squawks` (GET `?status=open|closed|all|<STATUS>`, POST — POST ignores any
  status in the body) · `squawks/[id]` (PATCH; the WHOLE route needs
  `squawk:manage`, wording included, because the description is what the next
  pilot reads to decide whether to fly).
- `servicing` (GET window, POST — one fill-up, no flight; refuses a row that
  records nothing at all, since "something happened but not what" is worse
  than no row).
- `photos` (POST multipart) · `photos/[id]` (GET streams bytes, DELETE). Both
  503 with the reason when `storageStatus()` says photos aren't configured,
  rather than 500ing out of `getStorage()`'s throw — nothing is broken, the
  feature is off.

## lib (pure logic, unit-tested where noted)

- `reservations.ts` — `overlaps` (half-open, so back-to-back bookings are
  legal), `findConflict`, `validateReservation`, `upcoming`/`past`. ✅tested
- `hours.ts` — tach/Hobbs math, `validateMeters` (catches the mis-read meter),
  totals, cost, formatting. ✅tested
- `checkoutDraft.ts` — a half-walked card, kept on the device it's being walked
  on. The checkouts AUTOSAVE: there is no Save button any more, because a button
  you have to remember to press while holding a dipstick is one that doesn't get
  pressed, and closing the tab used to throw the walk away. Two stores answer
  two questions — localStorage answers "is my work safe right now" without a
  network, the `Checkout` row answers "can I finish this on the iPad". The
  device is therefore allowed to be AHEAD of the server, and `resolveResume` is
  the rule that reconciles them: NEWEST WINS, a tie goes to the device (the
  sync had just landed, so they agree anyway, and it keeps the rule off
  phone-vs-server clock skew), and the server's row id is adopted either way so
  one walk can't fork into two rows. `parseDraft` DISCARDS rather than repairs —
  wrong card version above all, since item ids survive a rewording by design,
  which is exactly why the version is the thing that has to match. Plus
  `pruneDrafts` (bounded storage, by age only, so a shared clubhouse iPad never
  eats a walk somebody else has in progress), `draftHasProgress` (which ignores
  items the APP answers, or merely opening the runway page would autosave a
  draft for a member who has done nothing) and `savedAgo`. Nothing here touches
  `window`: every entry point takes its store, which is what makes it testable
  under vitest's node environment. ✅tested
- `postflightDraft.ts` — the same promise for the POST-FLIGHT form, which is
  filled in standing at the tail and used to lose everything if you walked away.
  ONE store rather than two, and that's the whole difference: a post-flight
  entry has no server row to sync to, because the turn-off answers belong to a
  `Flight` that doesn't exist until the form is filed — so the bar says "on this
  device" and means it. Keeps the form's fields as the STRINGS the inputs hold
  (a half-typed "150" on its way to 1506.1 is a state you're entitled to walk
  away from) plus the turn-off ticks and which meter boxes were hand-edited.
  Does NOT keep files: photos are `File` handles that don't survive a reload, so
  a squawk's TEXT is kept and `hadPhotos` records that pictures were attached,
  which is what lets the bar say "attach those again" instead of leaving the
  member to assume. Swept by the same `pruneDrafts` at the same age — the key
  prefixes live together in `checkoutDraft.ts` for exactly that reason. ✅tested
- `checkoutCleanup.ts` — the db half of the above. See the `checkouts` API
  bullet: `supersedeOpenRuns` + `sweepAbandonedRuns`, sharing
  `ABANDONED_DRAFT_DAYS` with the device's own sweep so the two stores can't
  disagree about which walks are dead.
- `checkouts.ts` — the three checkouts, transcribed item-for-item off
  N8318B's two laminated cards, every item with a `why` for the (i) popover.
  `PREFLIGHT_CHECKOUT` = I'M SAFE + homework + consumables + cockpit + the walk
  (left wing → nose → right wing → fuselage/empennage) + the club's closing
  360 (`walkaround` — step back from it, the only section with no list, for
  the whole-airplane problems you can't see with your nose against a bracket)
  + standard briefing;
  `RUNWAY_CHECKOUT` = passengers → before start → pre-lube → start → runup →
  pre-takeoff + 5 Ps; `TURNOFF_CHECKOUT` = after landing / shutdown / outside
  parking, answered on the post-flight form. Every helper takes a
  `CheckoutKind`: `parseAnswers`, `countChecked`, `isComplete`, `missingItems`,
  `totalItems`; plus `derivePutAway`. A SECTION may be `optional` (the
  cold-start pre-lube) and so may an ITEM (the card's IFR-only VOR/GPS line):
  stored when ticked, never counted toward sign-off. Items the club adds to the
  cards are flagged `club: true` and render a "club" chip. Three are whole
  SECTIONS (I'M SAFE, the 5 Ps, the closing walkaround) and seven are single
  lines inside a card's own section (the open-squawks review, the tach/Hobbs
  reading, the tail controls moving freely, the starter crank at the end of the
  cold-start pre-lube, the CO detector ON before the start and OFF after the
  master, the cabin clean-out); a test asserts nothing else creeps in. Two of the airplane's own lines are deliberately NOT transcriptions any
  more: both brake items dropped "pads", because N8318B wears wheel fairings and
  a card asking for a check nobody can make is a line that gets ticked anyway. Two
  more rules about FIELDS: a `defaultNow` time field opens at the club's
  current clock via `initialValues` (a default, never a stamp — and it does NOT
  tick its item, because opening a page confirms nothing), and the fuel dip is
  recorded per WING, with `deriveFuelOil` summing the two into the
  `fuelOnBoardGal` column. ✅tested
- `inflightReference.ts` — the card's takeoff/climb/cruise/descent phases and
  the KTOA (Zamperini Field, the club's home) frequency block, as read-only data. Deliberately NOT checkout items:
  nothing ticked in the air, nothing blocking a sign-off. Airspeeds are MPH.
  Rendered at the foot of the RUNWAY page (it's the next thing you read).
- `weightBalance.ts` — the loading stations and CG envelope as data, plus the
  sum. Arms are RECOVERED from the POH's own worked example (p.38) rather than
  guessed: oil −20, front seats 36, fuel 48, rear seats 70, baggage 95, each
  dividing out to a round station, which is the check that they were read
  right. `computeWeightBalance` (lines + totals + CG + what's wrong with it),
  `stationHeadroom` ("how much more fits here", against gross / either CG
  limit / the station's placard — the question people ask after "am I legal"),
  `withStationEmptied` for the landing check (tanks at 48 in are aft of the
  loaded CG, so every flight drifts FORWARD as it burns), `envelopePolygon`.
  The forward CG limit is modelled as its strictest, gross-weight value at all
  weights, so the tool can only ever be conservative about a light nose-heavy
  load. Oil defaults to 0 because a modern basic empty weight already includes
  it and re-entering it double-counts 15 lb at the nose. ✅tested
- `maintenance.ts` — the club's maintenance sheet as arithmetic. `dueAtTach`,
  `dueOn` (calendar months to the END of the month, reusing `calendarMonthsFrom`
  — 8 Jul + 12 months is 31 Jul, not 8 Jul), `hoursRemaining`, `daysRemaining`,
  `maintenanceDue` (state + which clock is binding + whether it grounds),
  `byUrgency`/`nextDue`/`grounding`. Two rules run through it: the TIGHTER
  interval wins, and the two clocks are compared in units of "about to be due"
  (`urgency` = remaining ÷ the DUE_SOON threshold) — raw hours against raw days
  would rank an annual with 300 days left above an oil change with 3 hours left.
  Hours are a spent budget (0 left ⇒ overdue); a calendar month is good THROUGH
  its last day (0 days left ⇒ due today, still legal). ✅tested
- `operatingRules.ts` — VFF-OR-A as data: `pilotTier`, `ruleFor`,
  `landingCurrency`, `hoursInLastYear`, the mnemonics. ✅tested
- `members.ts` — `MEMBER_SELECT` (roster columns; deliberately no paperwork)
  and `adminChangeError`, whose one rule is "never demote the last admin". ✅tested
- `signupCodes.ts` — the front door as rules: `normalizeCode` (upper, space-free
  — a code gets read down a phone), `signupCodeError`, `accountFromCodeKind`
  (the ONE place a code's list maps to what the account is),
  `signupCodeRequired` (the fresh-install exception) and `redemptionError`,
  which gives an unknown and a retired code the SAME message so a stranger who
  guesses a real one isn't told they guessed right. ✅tested
- `flightSignature.ts` — what an instructor's endorsement means:
  `signatureState` (`NOT_APPLICABLE | AWAITING | SIGNED | SIGNED_THEN_EDITED`),
  `isAwaitingSignatureFrom`, `signatureError`/`unsignError`. Accepts a flight
  in either spelling (`instructorId` on a row, `instructor` on the wire) so one
  rule set serves the route and the pages. The narrow rule is the point: the
  instructor NAMED on the entry signs it and nobody else — not another CFI, not
  an admin. That is the single deliberate exception to "admins can do
  anything", because a signature anyone could apply isn't a signature. ✅tested
- `instructors.ts` — the db half of the above: `resolveInstructor` /
  `resolveBookingInstructor`, which refuse a member who isn't a CFI rather than
  silently dropping the name. In `lib/` because three routes need it and a
  `route.ts` may only export Next's own handlers.
- `squawks.ts` — the status vocabulary and, more importantly, what each value
  MEANS: `isOpen` (everything but CLOSED — note `REVIEWED_OK_TO_FLY` is
  reviewed, not fixed, so it stays on the list), `isGrounding`,
  `isInMaintenance`, `isAwaitingReview`, plus `SQUAWK_TRIAGE_ORDER`. That last
  one exists because Postgres sorts an enum in DECLARATION order, which would
  bury the grounded squawks at the bottom of every list. Nothing outside this
  file may switch on a status string. ✅tested
- `positions.ts` — club offices and what each may do. The ONLY place an office
  maps to a capability; routes ask `can(user, "finance:manage")`, never "is
  this person the Finance Officer". **Admins hold every capability implicitly**,
  so the club is never blocked by one member being away. FINANCE_OFFICER holds
  `finance:read-all` + `finance:manage`; SAFETY_OFFICER holds
  `squawk:manage`; MAINTENANCE_OFFICER holds `maintenance:manage` (the write
  side of the due list — reading it is open to every member, because "the annual
  is out next week" is not privileged); INSTRUCTOR holds `flight:sign`. MEMBERSHIP (rather than any
  office) carries `reservation:book` + `finance:read-own`, which is what an
  instructor-only account lacks — `Principal.clubMember` is optional and absent
  means TRUE, so every caller predating instructor accounts still behaves.
  `isInstructor()` is the one place a position is tested DIRECTLY, and the
  exception proves the rule: "who are the club's CFIs" is a roster question, and
  `can(user, "flight:sign")` would put every admin in the instructor picker.
  Adding a power is: name the capability, list it under an office, check it with
  `can()`. ✅tested
- `finance.ts` — the books as arithmetic: periods ("YYYY-MM", local month),
  `totals` (credits are stored NEGATIVE so a balance is one addition; `paidCents`
  and `outstandingCents` come off the same lines, so a settled month still
  reports what it cost),
  `flightCharge`/`fuelCredit`, `ruleAppliesTo`/`membersBilledBy`,
  money parsing/formatting. ✅tested
- `landingFees.ts` — what a field charges to land: the fee TABLE (KTOA $6) and
  `landingFeeFor` / `landingFeeInputFor`. Only a DEFAULT — what the club bills is
  `Flight.landingFeeCents`, the figure the pilot left in the box, because rates
  change and fees get waived. Per FLIGHT, not per landing: eight touch-and-goes
  is one visit to one desk. ✅tested
- `ledger.ts` — the db half. `syncFlightCharges` rebuilds a flight's two derived
  lines on every file/correct (skipping any an officer has voided);
  `ensureRecurringCharges` materialises a month's dues, idempotent via the
  unique index, never for a future month.
- `aircraft.ts` — `normalizeTailNumber` (upper-case, space-free),
  `tailNumberError`, `modelError`. ✅tested
- `offline.ts` — the difference between a card the club REFUSED and one that
  never reached it. `completionOutcome` sorts a `sendJson` result into
  `filed | unsent | refused`, keying on `status === null` (the fetch threw, so
  the server can hold no opinion) rather than on the prose of an error message;
  `unsentNotice` is the copy for the `unsent` case, in two versions because the
  useful sentence changes the moment signal returns and the member is not
  looking at the screen when it does. Neither version says "error": the walk is
  whole and on the device, and the only missing ingredient is signal. ✅tested
- `dates.ts` — formatting, `toLocalInputValue`, `calendarMonthsFrom`.
- `constants.ts` — club name, purposes/severities + tones, policy limits.
- `auth.ts` — `authOptions`, `getSessionUser()`, `getAdminUser()` (re-reads db).
- `serialize.ts` — row → wire shapes; `types.ts` — the `Api*` interfaces.
- `storage/` — `index.ts` (driver choice + `photoKey` + `storageStatus`),
  `local.ts`, `s3.ts` (SigV4 by hand, no AWS SDK). `storageStatus(env)` is pure
  and is the SINGLE source of truth for "can this deployment do photos": local
  (the default) always can, s3 can once its three vars are set, and
  `STORAGE_DRIVER=none` switches it off. `getStorage()` is built on it, which
  is what stops the UI's "(no image support)" and the upload route's refusal
  from ever disagreeing. ✅tested
- `api.ts` — `fetchJson`/`fetchJsonArray`/`sendJson` client helpers.
- `theme.ts` (light/dark/system) · `navDirection.ts` (swipe slide direction).

## Components

The flight log no longer carries a squawk panel: Plane Status › Squawks is the
one sheet, and two lists of the same rows meant two places to look and two to be
out of date. A squawk still appears in the log where it BELONGS to something —
on the entry it came from, in the detail modal — and links through with
`/status/squawks#<id>`, which that page scrolls to and rings. The Navbar's
grounded banner points there too.
`FlightDetailModal` reads in two modes: VIEW (the record) and EDIT (the
correction), gated on `canEdit` — your own entry or an admin, the same rule
PATCH enforces. Same modal rather than a separate screen, because a correction
is made while looking at the thing that's wrong. Delete is `danger` red and
hides while editing. Est. cost carries an (i) that writes the sum out, and it
exists because the headline and the money round differently: the title says
"1.2 hours" while the bill is 1.19 tach hr × the rate, plus any landing fee.

The flight log's Club/Mine switch changes what the page is about, not just the
rows, and it OPENS on Mine (the same way Finances opens on your own statement): Club = the airplane (hours this month, club totals, everyone's flights,
squawks); Mine = your flying (your totals + landing currency, with the
operating rules as a popover opened from that currency card). For an
instructor-only account that second tab is **Teaching** instead: they have no
flying of their own here, so it lists the lessons they're named on and leads
with what's awaiting their signature. A CFI who is ALSO a member keeps the
ordinary Mine — they have flying to look at.

Feature: `AppShell` (the frame: top bar + rail + content column), `Navbar` (a
full-width top bar — club name at the left, then airplane chip /
replay-the-tour / settings gear / profile menu along the right — with a fixed
LEFT-hand rail hanging BELOW it from `md` up, holding only the vertical tabs
with Checkouts expanding inline; below `md`, the rail is replaced by the
floating bottom pill, whose group sheet opens ABOVE THE TAB it belongs to
rather than centred on the pill — a menu is the answer to the thing you just
touched, and on a five-tab bar "centred" is a different tab entirely),
`SwipePager`/`SwipeProvider`
(phone tab swipe), `LoadingProvider` (one shared splash), `AuthGate`,
`MeProvider`, `AircraftProvider` (fleet + grounded state, refetches on
sign-in), `ReservationCalendar` (desktop month grid), `ReservationList`
(phone), `ReservationModal`, `FlightDetailModal`, `FlightEntryModal` (add a flight to
the log by hand — the flight that never got filed at the time, so it asks for
no turn-off checkout: those ticks mean "I confirmed this at the airplane" and
there is no honest way to answer them a fortnight later), `MaintenancePanel` (Plane Status' maintenance sheet: the next-due strip, a
countdown bar per clock, and — with `maintenance:manage` — Mark done / Edit /
Add), `CheckoutDraftBar` +
`useCheckoutDraft` (autosave: everything about the SAVED STATE of a walk, and
the only place Reset lives. It renders INSIDE `CheckoutList`'s sticky bar, as
that component's `status` slot — how far down the card you are and whether that
work is kept are one glance, in the one strip that follows you down the card.
The old objection to putting it there was Reset: it destroys a walk, and the
sticky bar is parked under a member's thumb for the whole card. Answered rather
than dropped — Reset is ghost weight at the bar's far edge and still confirms in
a modal that says what goes. It absorbed the old `ResumedRun` banner as one of
its states, and that one is a GREETING: "picking up where you left off" gives
way to the ordinary saved line on the first tick, or a permanent amber
two-liner would tax the height of every screen of the card),
`PostflightDraftBar` +
`usePostflightDraft` (the same, for the post-flight form — deliberately NOT
CheckoutDraftBar, which has a whole vocabulary for the gap between the device
and the server that would be a lie here),
`usePrefetchRoutes` (the checkouts run in a fixed order with a FLIGHT in the
middle of it, so each card pulls the ones downstream into the router cache while
the clubhouse wifi is still in reach — preflight fetches `/runway` and
`/postflight`, runway fetches `/postflight`. What it buys is that the
client-side navigation at the end of a card needs no network; what it can't buy
is a hard reload, which still fetches the document — see the offline gotcha),
`useOnline` (`navigator.onLine` plus its two events, and it is only ever allowed
to EXPLAIN a failure that already happened, never to stop a request being tried:
it reports a network interface, not reachability, so a captive-portal wifi reads
as online),
`CheckoutList` (the collapsible
section renderer shared by the preflight and runway pages — one section open at
a time, sticky progress bar showing WHICH STEP you're on and your place in that
section (scrolled into a 15-item section with its header off screen, a bare
percentage tells you neither), with a segmented gauge whose segments are as wide
as their sections are long AND are buttons that jump to their section — it's the
one control on screen the whole way down the card, so the obvious thing for it
to do when tapped is take you there (which is also why the bar is no longer
`aria-hidden`: you can't hide a row of buttons from a keyboard); it is deliberately not a `role="status"` live region
— that would re-announce the whole thing on every tap — "next section"
affordance, and opening a section
scrolls it to the top of the column so it can't expand below the fold. It opens
on section one EXCEPT when a walk is resumed (`resumed`, flipped by the page when
`draft.resume` lands): coming back mid-card it opens the first section with
required work left in it, since on a resumed card section one is usually the
finished one. Once only — after that the accordion is the member's. Three
optional props: `hints` puts a muted note under a FIELD — the preflight page
uses it for "last recorded 6 qts on Tue by Alex Rivera" under the oil box, a hint and
never a prefill — `derived` marks an ITEM the app answers for itself, and `itemNotes` puts a
TONED live note under one, optionally with a link out (rendered OUTSIDE the tick
button — an `<a>` inside it is the same invalid nesting as the (i)). The
open-squawks line is what both exist for: with nothing open it's `derived`
(green, ticked by the app, untappable — there is no list to read), and otherwise
it's a note counting them — "3 open squawks — 1 being worked, 1 not yet
reviewed" — plus a link to `/status/squawks` for the wording. RED IS RESERVED
FOR GROUNDED there; in-work and untriaged are amber, because "reviewed — in
work" is a flyable airplane and painting it like a grounding teaches members to
read past the colour that stops a flight. With anything open the item is still
TICKED by the pilot: the app knows the list, it can't know you read it),
`TurnoffCheckout`
(a THIN WRAPPER over `CheckoutList` — all three cards now share one layout,
because a member meets the turn-off card minutes after walking the other two and
a checklist that changes shape between screens has to be re-learned each time.
It used to render flat; consistency beat the "you're working down a list you've
just done" argument. The one difference it keeps is `sticky={false}`: this card
is a section of a longer form, so a pinned bar would follow the member down past
the meters and the servicing fields still counting turn-off items), `InflightReference`
(collapsed card at the foot of the runway page), `WeightBalanceChart` (the CG
envelope as inline SVG — plotted against CG in INCHES rather than the POH's
moment axis so the limits can be checked against the printed numbers by eye,
with takeoff and landing both marked and the axes stretching to contain a load
that falls outside), `SquawkPanel`,
`SquawkDraftModal`, `SignupCodesPanel` (org settings' two code lists, side by
side because which list a code is on is the only thing about it that matters
when you read it out), `PhotoUploader`, `Logo`, `GuidedTour` (first-run walkthrough
that SPOTLIGHTS live nav controls — each step names `data-tour` keys, the nav
stamps them on both the rail and the pill via `tourKey`, and the tour takes
whichever copy is on screen and measures it; a step whose keys match nothing
visible falls back to a centred card), `OperatingRules`
(`MyLimitsCard` on preflight — COLLAPSED to its verdict by default, because it
sits above the card the member came to walk; the solo-or-instructor banner is on
it at every state, the minimums and the reasoning are behind the disclosure / `RulesModal` off the log's currency card /
`GumpsCard`).
Primitives in `components/common/`: `Badge Banner Button Card ChipSelect
DateTimeField Dropdown InfoTip Input Modal Select Textarea LoadingDots
LoadingScreen`. Prefer extending these. `Input` DEFAULTS `inputMode` to
"decimal" for `type="number"`, so a numeric field opens the number pad on a
phone without every call site remembering to say so; a field that counts things
(landings) still passes `inputMode="numeric"` for a pad with no decimal point.
`DateTimeField` = native picker on
touch, themed popover on desktop; `InfoTip` = the (i) marker (hover opens,
click pins); `ChipSelect` = a select whose options are COLOURED CHIPS, for the
small vocabularies where the colour is half the meaning (the squawk status
picker). Native `<select>` is still right for everything else — reach for this
only when the options carry tones. Not built on `Dropdown`, which opens on
hover: brushing past a control that changes a stored value shouldn't open it.

## Gotchas

- **A schema change now needs a migration.** Dev still uses `db push` (fast,
  no migration written), but every deployed environment's schema is whatever
  `prisma/migrations/` says — push-only changes reach dev and never reach prod,
  and the symptom is a deploy that boots clean then 500s on the one query
  touching the unmigrated column. Run `npm run db:migrate -- --name <change>`
  and commit the result. CI's `migrations` job replays the directory into a
  shadow database and diffs it against `schema.prisma`, so drift fails the
  build rather than the deploy.
- **There are TWO deployment targets and they apply migrations differently.**
  The Docker image runs `prisma migrate deploy` from its CMD, so a container
  migrates itself on boot. **Vercel — which is what actually serves
  vardafreeflyers.com — never runs that CMD**, and its build was
  `prisma generate && next build`, which touches no database. Both Neon
  databases therefore sat at ZERO of six migrations while looking perfectly
  deployed: the build passed, the site came up, static pages rendered, and
  every request reaching Postgres 500'd with an EMPTY body (an unhandled
  throw, not one of a route's own JSON errors — that empty `Content-Length: 0`
  is the tell, and `/api/signup` failing that way looks like a broken sign-up
  form rather than a schema-less database). Fixed by `scripts/vercel-build.sh`
  via the `vercel-build` npm script, which npm prefers over `build` on Vercel.
  Two things about it are load-bearing: it gates on `VERCEL_GIT_COMMIT_REF`
  so only `main` and `staging` (the two branches that own a database) migrate
  and a PR preview never mutates a shared schema, and it only runs at all
  while the Vercel project's **Build Command is left on its default** — an
  explicit Build Command in the dashboard overrides package.json and silently
  restores the original bug.
- **Only `main` and `staging` deploy to Vercel; everything else is off.**
  `vercel.json` sets `git.deploymentEnabled` to `false` for `*` and `**` and
  back to `true` for those two branches — Vercel resolves a branch matching
  several rules by deploying if ANY match is `true`, so listing the two by name
  is what re-enables them. Both wildcards are listed on purpose: minimatch's
  `*` does not cross a `/`, so `*` alone would let a `feature/x` branch through.
  This is what stops a push to `dev` (and every PR preview) from building.
  It is deliberately the same `main | staging` gate `scripts/vercel-build.sh`
  already applies to migrations — those two branches are the only ones that own
  a database, and now the only ones that deploy. The file sets ONLY `git`:
  adding a `buildCommand` here would override package.json and silently stop
  `vercel-build` running, which is the migration bug described below.

- **`output: "standalone"` is for Docker only and must stay OFF on Vercel.**
  Vercel does its own file tracing and ends every build by reading
  `.next/next-server.js.nft.json`; standalone output writes the traced tree
  into `.next/standalone` and never emits that manifest, so the build gets all
  the way through "Finalizing page optimization" and then dies inside Vercel's
  `onBuildComplete` with a bare `ENOENT: … next-server.js.nft.json` — an error
  about a file the app never mentions, from a step the app doesn't run.
  `next.config.js` therefore spreads the option in only when `VERCEL` is unset
  (Vercel sets `VERCEL=1` in every build environment), which leaves the
  Dockerfile's `COPY /app/.next/standalone` exactly as it was.
- To apply migrations to a Neon database BY HAND (recovery, or a database that
  predates the above), don't use compose — its `env_file` would override
  `DATABASE_URL` with the dev one. Pass it explicitly, and don't mount the
  host's `node_modules`: its Prisma engines are darwin binaries and the
  container is linux.

  ```sh
  DB=$(grep '^DATABASE_URL=' env/prod.env | cut -d= -f2-)   # or env/staging.env
  docker run --rm -e DATABASE_URL="$DB" \
    -v "$PWD/prisma":/work/prisma \
    -v "$PWD/prisma.config.ts":/work/prisma.config.ts \
    -w /work node:24 sh -c '
      echo "{\"type\":\"module\"}" > package.json &&
      npm i --no-audit --no-fund prisma@7.9.1 tsx &&
      npx prisma migrate deploy'
  ```

  The `package.json` with `"type": "module"` and the LOCAL prisma install are
  both required: `prisma.config.ts` is ESM and does
  `import { env } from "prisma/config"`, which Node resolves from the config
  file's own directory — the same constraint the Dockerfile satisfies by
  putting the config beside `/prisma-cli`. `migrate status` in place of
  `migrate deploy` is the read-only version, and is how you check an
  environment without writing to it.
- The Dockerfile is multi-stage and ships Next's `output: "standalone"` bundle
  (~1.5GB → ~420MB, 140MB compressed) because the image is now PULLED by the
  server rather than built there. Three things about it are load-bearing:
  `.next/static` is not part of Next's trace and needs its own COPY; the
  Prisma CLI is installed on its own under `/prisma-cli` (it's a
  devDependency, so the standalone bundle has none of it); and
  `prisma.config.ts` has to sit BESIDE that CLI, because it does
  `import { env } from "prisma/config"` and Node resolves that from the config
  file's own directory — left in `/app` every boot dies with "Cannot find
  module 'prisma/config'".
- **The home-screen icon is a different file from the favicon, on purpose.**
  `app/icon.svg` draws its own disc on a transparent field, which is right for
  a tab strip and wrong for a phone: iOS composites transparency onto BLACK and
  rounds the corners itself, Android masks to the launcher's silhouette — so
  the disc installs as a circle inside a circle with black corners behind it.
  `public/icons/icon-square.svg` is the same two bands with the disc clip and
  the rim taken away, bleeding to all four edges of an opaque white square. It
  is the SOURCE; what phones install is `app/apple-icon.png` (180px, which the
  App Router turns into the `apple-touch-icon` link) and
  `public/icons/icon-{192,512}.png` (what `app/manifest.ts` points at). Those
  PNGs are COMMITTED, and re-rasterising them by hand after a change to the
  mark is the price: nothing in `next build` rasterises an SVG, and a phone
  installing the site needs bytes at a stable URL. The recipe is in a comment
  at the top of the square SVG. iOS ignores an SVG apple-touch-icon completely
  and falls back to a SCREENSHOT of the page, which is the symptom to
  recognise. The mark now lives in THREE files (favicon,
  `components/Logo.tsx`, square) — change one, change all three.
- **There is a `public/` now, and Next's standalone output does not trace it.**
  It holds the manifest's icons and nothing else so far. The Dockerfile needs
  its own `COPY /app/public ./public` beside the `.next/static` one for exactly
  the same reason; miss it and the app boots fine while "Add to Home Screen"
  404s on its icon.
- `npm ci` and `next build` both need `DATABASE_URL` set even though neither
  opens a connection: `postinstall` runs `prisma generate`, which loads
  `prisma.config.ts`, which resolves `env("DATABASE_URL")` eagerly. The
  Dockerfile and CI both pass a placeholder. The REAL url is runtime-only —
  baking one into the image would be a bug.
- `.dockerignore` excludes `.git`, so `next.config.js` can't read the commit
  sha for the login screen's build stamp inside a container. It's handed in as
  the `COMMIT_SHA` build arg (CI passes `github.sha`); unset just renders the
  stamp bare.
- **Stay on TypeScript 6.** TS 7 (the Go port) does not expose the compiler API
  Next 16 needs, so `next dev`/`next build` die with "TypeScript 7.x does not
  provide the compiler API required by Next.js". `tsc --noEmit` passes on its
  own, so `npm run typecheck` will NOT catch this — only a real build does.
- `.gitignore` patterns without a leading slash match at every depth: a bare
  `storage/` (for local photo uploads) also swallowed `lib/storage/`, so the
  module was never committed and CI failed with "Cannot find module
  './storage'". It's `/storage/` for exactly that reason.
- `postcss` and `sharp` are pinned through `overrides` in package.json: Next
  depends on versions with open advisories, and `npm audit fix` "solves" it by
  proposing a downgrade to Next 9. `next/image` is unused here (photos stream
  through `/api/photos/[id]`), so the sharp override costs nothing.
- `InfoTip` closes when its marker actually MOVES, not on any scroll event.
  Scroll events keep arriving for a frame or two after scrolling stops, so the
  old "hide on any scroll" closed the bubble the instant it opened whenever
  opening it had itself caused a scroll — a tap on a half-off-screen (i), and
  every Playwright `click()`, which scrolls into view first.
- The e2e suite runs against `next dev`, whose dev overlay renders a floating
  `<nextjs-portal>` indicator that eats pointer events over its corner of the
  viewport — right on top of the phone bottom tab bar, so every mobile tab tap
  fails with "`<nextjs-portal>` … intercepts pointer events". `next.config.js`
  sets `devIndicators: false` when `E2E=1`, which the `e2e:server` script sets.
- Only Next's own exports (GET, POST, `dynamic`, …) may leave a `route.ts`;
  a shared const like `MEMBER_SELECT` has to live in `lib/`, or the generated
  route types fail the build.
- "Checkout" means two unrelated things in this codebase and both are correct
  aviation English: `lib/checkouts.ts` is a walkthrough of one of the
  airplane's cards, while `CHECKOUT_AIRPORTS` in `lib/operatingRules.ts` is a
  pilot being signed off to fly into Catalina or Big Bear. Don't merge them.
- **`Flight.editedAt` is not `updatedAt`, and the difference is the whole
  feature.** An instructor's signature is only worth something if it names a
  version, so the flight log compares `signedAt` against when the entry was
  last CORRECTED. Signing is itself a write, so Prisma's `updatedAt` lands a
  hair after `signedAt` on every signed flight — using it would report
  "signed, then edited" for all of them, forever. `editedAt` is stamped only by
  PATCH /api/flights/[id] (the fields a reader would call the log entry); the
  sign route deliberately touches neither it nor the pilot's own columns. A
  unit test pins the same-instant case.
- An edit after a signature does NOT clear it. The endorsement was really
  given; it just no longer covers what's on screen, and the log says so
  (`SIGNED_THEN_EDITED`) rather than quietly erasing it.
- **Requiring a sign-up code has to exempt the first account**, or a fresh
  install is a club nobody can get into: there is no admin yet, so there is
  nobody who could have issued a code. `signupCodeRequired(memberCount)` is
  that rule, and it's why the seed also creates one code per list — a seeded
  club has members, so it would otherwise be closed.
- Adding a value to the `Position` enum is the SAFE kind of enum change (append
  only — Postgres sorts an enum by declaration order, and renumbering the
  existing values is the destructive case the squawk-status gotcha describes).
  It still needs a written migration like anything else.
- `capabilitiesFor` now reads `Principal.clubMember`, which is OPTIONAL and
  absent-means-true. That's deliberate compatibility — every account predating
  instructor accounts is a flying member — but it means a caller that simply
  forgets to select the column gets the permissive answer. `getSessionUser()`
  and `/api/me` both select it.
- The Weight & Balance tool OPENS its fuel box at the last preflight dip rather
  than at full tanks, and deliberately does NOT do the same for oil: N8318B's
  basis is a modern basic empty weight that already includes its 8 quarts, so
  entering the dipstick reading again would double-count 15 lb at the furthest
  forward station. The recorded oil is shown UNDER the box instead.
  An UNFILED dip beats a filed one: the page reads this member's own PREFLIGHT
  draft off `localStorage` (`readDraft` + `deriveFuelOil`) and prefers it to
  anything `/api/checkouts` returns, because the half-walked card in somebody's
  pocket is today's tanks while a filed preflight is some previous flight's.
  That's the case `checkoutDraft.ts` letting the device run AHEAD of the server
  is for. The note under the box always says which it is, since the whole risk
  is a number nobody knows the age of. The preflight card links here from its
  own W&B item (`CheckoutItem.link`), which is the walk that makes this happen.
- Nothing in the nav carries a permanent tint any more. Reservations used to,
  as the app's call to action, and it competed with the one mark that actually
  changes — which tab you're on.
- The UI calls `/settings` **Club settings**; an empty fleet tells members to
  ask an admin to add an airplane there rather than naming a shell command
  nobody reading the page can run.
- The nav is filtered per viewer (`navFor` in Navbar), and the flattened route
  list the SWIPE PAGER walks is derived from the filtered nav — so a hidden tab
  is hidden from the gesture too. While `me` is still loading the full nav is
  shown: a tab that appears a beat late is a flicker, but one that's briefly
  there and then vanishes reads as a bug.
- The squawk status picker is a `ChipSelect`, not a `<select>` — so e2e drives
  it as a BUTTON that opens a listbox (`getByRole("button", { name: /^Status/ })`
  then `getByRole("option", …)`), never `selectOption`. Its accessible name is
  "Status" followed by the current value, which is why specs match on the
  prefix.
- **The app degrades offline; it is NOT an offline app, and the line between
  those runs through the service worker it doesn't have.** What works with no
  signal: every tick (localStorage, synchronously), and a client-side
  navigation to a card that was prefetched while there still was signal
  (`usePrefetchRoutes`). What does not: a HARD RELOAD, because the document
  itself still comes off the network and there is nowhere else for it to come
  from — so an airplane out of range is one pull-to-refresh away from a blank
  page, with the drafts intact underneath it. The pages' own API reads fail too,
  but degrade quietly: `fetchJsonArray` returns `[]`, so the card renders
  without being able to say what the last recorded oil was. Adding a service
  worker is what would move this line; until then don't describe the checkouts
  as working offline without saying which half.
- **A failed Complete is two different things and the pages must not merge
  them.** `completionOutcome` (lib/offline.ts) splits them: a REFUSAL is the
  server's own message and belongs in the red error slot, while UNSENT — the
  fetch never got a reply — is not an error at all and gets an amber notice
  saying the walk is safe on the device and to press Complete again. Both paths
  call `draft.thaw()`, which is what makes the retry work: autosave comes back
  on, the card on screen is untouched, and Complete is still the button. The
  taxi & runway card is the one where UNSENT is the ORDINARY case — it ends at
  the hold-short line, well past the clubhouse wifi. Deliberately no auto-retry
  on the `online` event: a member who kept ticking after the failed press would
  have a half-edited card filed out from under them.
- **The checkout pages autosave, so every e2e spec that ticks anything leaves a
  booby trap for the next one.** A resumed half-ticked card turns "Check all"
  into "Clear" and makes a bare `0 of N checked` assertion fail for reasons
  that have nothing to do with the test. `clearCheckoutDrafts(page)` in
  `tests/e2e/helpers.ts` is the fix (it sweeps the post-flight family too) and belongs in the `beforeEach` of any spec
  that walks a card. It has to clear BOTH stores: clearing only localStorage
  leaves the server's copy to be resumed, and clearing only the server leaves
  the device's — which wins a tie anyway. The symptom when it's missing is not
  an obviously stale tick: a section that is ALREADY complete offers "Clear"
  rather than "Check all", so the spec waits ninety seconds for a button that
  will never appear.
- **The other half of that trap: ticking is instant, syncing is not.** A spec
  that ticks something and then navigates tears the page down with the sync
  still in flight (`page.goto` destroys the JS context and the request with it),
  and what goes missing is whatever rides on that sync — a squawk, most
  importantly. `waitForCheckoutSaved(page)` is the barrier. It works because the
  draft bar deliberately distinguishes "Saved … on this device · syncing to the
  club" from "Saved · just now", and only the second means the server has it —
  the bar must never say "Saved" for a write that hasn't happened, or it stops
  being something a member (or a test) can believe. An earlier version said
  "Saved just now" the instant the tick hit localStorage, and a spec asserting
  on `/^Saved/` passed while the squawk it was testing was silently dropped.
- Scope page-content assertions in e2e to `getByRole("main")`. The rail, the
  bottom pill and GuidedTour's spotlight all render their own copies of nav
  controls, so a bare `getByRole("button", { name: "New" })` is a strict-mode
  violation on a good day and a false pass on a bad one. GuidedTour is also why
  a spec that SIGNS UP a new account has to `dismissTour` exactly like
  `signIn` does — a brand-new account has `tourSeenAt: null`.
- Renaming a checkout ITEM ID is a history rewrite, not a refactor: rows store
  the ids, and `parseAnswers` silently drops any it doesn't recognise, so a
  rename turns old runs into blank ones. Reusing an id for the SAME physical
  check reworded is fine (bump the checkout's `version`); reusing one for a
  DIFFERENT check is what must never happen. REORDERING items needs no bump at
  all — answers are keyed by id, not position — and a bump would be actively
  wrong there, since `parseDraft` discards on a version mismatch and every
  half-walked card in the club would be thrown away for a cosmetic move.
- The checkout rename (`preflight_checks` → `checkouts`, `checklistVersion` →
  `checkoutVersion`, `Flight.secureAnswers` → `turnoffAnswers`,
  `preflightId` → `checkoutId`) went through `db push`, which for a rename is a
  DROP + ADD. Any database predating it needs `db:push` + `db:seed`, and the
  app container restarted afterwards — see the next gotcha for why.
- **Changing an enum's VALUES needs a hand-written migration, and `db push`
  can't do it at all.** Both the generated migration and `db push` emit
  `ALTER COLUMN status TYPE X_new USING (status::text::X_new)`, which aborts
  with `invalid input value for enum` the moment ONE existing row holds a value
  the new enum lacks — and `--accept-data-loss` does not help, because this is
  an invalid cast rather than data loss. Write the `USING` clause yourself with
  a `CASE` that maps every old value (see
  `20260807000000_squawk_status_vocabulary`, which maps
  severity/status → the single squawk status and deliberately sends
  `GROUNDING` to `REVIEWED_GROUNDED` first so a grounded airplane can't quietly
  come back on the line). Then apply the SQL to your dev db by hand — dev uses
  `db push`, which never reads `prisma/migrations/`.
- Deployed environments apply `prisma/migrations/` (Docker at boot, Vercel in
  `scripts/vercel-build.sh` — see the two-targets gotcha above) while dev uses
  `db push`, so a schema change with no migration builds, tests and runs
  locally and then simply never reaches production. The CI
  `migrations` job is what catches it: `prisma migrate diff --from-migrations
  … --to-schema … --exit-code` must say "No difference detected".
- `prisma db push` REFUSES a destructive change without `--accept-data-loss`,
  and the dev container runs it on boot — so before that flag was added to the
  dev profile, any renamed column made `vff-app-vff-app-dev-1` exit(1) and
  boot-loop with "You are about to drop the `x` table, which is not empty".
  Both the dev and test profiles now pass it; `db:push` run by hand from the
  host still doesn't, which is the right default for a database you care about.
  Production never uses push at all — it goes through `db:migrate:deploy:prod`.
- **`prisma generate` does not reach a running `next dev`.** After a schema
  change, the dev server keeps serving the client it imported at boot, and every
  query touching a new column dies with "Unknown field `x` for select statement
  on model `User`" — a 500 that looks like an auth bug, because `/api/me`
  failing is what signs you out. `db push` + `generate` is not enough; restart
  the app container.
- `LoadingProvider` owns the ONLY splash. On the FIRST boot (and on /login) it
  takes the whole window at z-50, above the navbar — there is nothing behind it
  worth seeing, and chrome framing an empty hole reads as a half-drawn app.
  Every later load is a navigation between pages you can already see, so it
  covers only the CONTENT COLUMN rather than the window — `top: var(--app-header-h)` + `md:left-60`,
  the same two measurements the rail uses, with `/login` excepted the way
  AppShell excepts it. `LoadingScreen` is therefore `absolute inset-0` and
  fills whatever box it's given; centred in the window it sits 7.5rem left of
  the space it covers. Two more rules keep it from flashing:
  reports are ref-counted (during a route change the incoming page registers
  before the outgoing one unregisters, so a plain boolean blinks off between
  them), and `usePageLoading` reports in a LAYOUT effect — a normal effect gives
  the page one painted frame of its empty state before the overlay covers it.
  `AuthGate` reports through the same hook instead of rendering its own screen.
- The nav rail's `w-60` and `AppShell`'s `md:pl-60` are one measurement in two
  places — change one and pages run under the rail. The breakpoint is `md`
  (768px = the narrowest iPad), not the `sm` most of the app uses: tablets get
  the desktop layout, only phones fall back to the bottom pill.
- `--app-header-h` is load-bearing in THREE places now: the reservation
  calendar's height, preflight's sticky section header, and the rail's own
  `top`. The rail hangs below the top bar rather than beside it, so it offsets
  itself by the same live measurement — which is why a banner appearing pushes
  the rail down in step with the page instead of leaving a seam.
- The app is written entirely in `indigo-*` classes; `tailwind.config.ts`
  remaps that palette to the club's Cessna orange. Don't add literal oranges.
- **Overpass is self-hosted (`app/fonts/`) so its vertical metrics can be
  overridden, and that override is load-bearing.** As shipped, the face puts
  0.183em of air above a capital and 0.383em below the baseline, so glyphs ride
  0.100em ABOVE the middle of their own line box — and nothing in CSS moves
  them back, since half-leading is added equally top and bottom. `items-center`
  then centres the box with the text sitting high inside it, which is how ONE
  font swap knocked the nav tab labels, every Badge, the avatar initial and
  every icon-beside-a-label out of true at once (1.5px at `text-sm`).
  `app/layout.tsx` restates ascent/descent to 98.3%/28.3% — cap-to-baseline
  centring, with the SUM held at the original 1.266em so line boxes keep their
  exact height and nothing reflows. Don't "fix" a centring complaint with a
  per-component nudge (`-mt-px`, `translate-y`) — that's this, and it's global.
  Swapping the sans face means recomputing the pair: ascent =
  (asc + desc + capHeight) / 2, descent = the remainder.
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
- **The three e2e projects are not all Chromium, and CI has to install the right
  engine for each.** `devices["Desktop Chrome"]` is chromium, but
  `devices["iPad Pro 11"]` and `devices["iPhone 16 Pro"]` are Safari device
  profiles whose `defaultBrowserType` is **webkit**. CI installed only chromium
  for a long time and every ipad/iphone test died with "Executable doesn't exist
  at …/webkit-NNNN/pw_run.sh" — invisible locally, because a dev machine has all
  the engines from its first `playwright install`. Webkit is also the RIGHT
  engine rather than a chore: an iPhone member is on Safari, and a phone-shaped
  Chromium would miss exactly the bugs those legs exist to catch. The e2e job is
  a matrix over the three projects (`fail-fast: false`, its own Postgres service
  per leg, artifact names suffixed per leg), so they run in parallel and one
  shape failing still reports the others.
- Two e2e traps specific to `CheckoutList`. A SECTION header's accessible name
  starts with its number badge and ends with its count ("3 Consumables … 0/6"),
  so `{ name: /^Consumables/ }` matches nothing and a bare `"Consumables"`
  also matches the "Next: Consumables →" affordance — target headers with
  `/Consumables.*\d+\/\d+$/`. An ITEM row is the opposite: anchor it with `^`,
  or the `(i)` beside it ("Why: <label>") matches too.
- `await locator.isVisible()` is a ONE-SHOT check with no auto-wait, so using
  it to decide whether to click something that appears after a React re-render
  silently skips it. That's how a spec walking the preflight card quietly
  missed the 15-item cockpit section and failed 30 seconds later on a sign-off
  button that stayed disabled. Use `await expect(x).toBeVisible()` and then
  click. Better still, don't drive another page's whole UI to set up a
  precondition — `page.request.post` shares the browser's cookies, so a
  signed-off checkout is one API call (see `runway.spec.ts`).
- `getByLabel` matches substrings: "Landings" also hits "Night landings", and
  "Start" hits "Open calendar for Start". Specs use `{ exact: true }`.
- CI lives in `.github/workflows/ci.yml` and materialises `env/test.env`
  itself, since the e2e harness loads that file rather than process env.
- `prisma/seed.ts`'s `FLIGHT_LOG` is REAL data — N8318B's log transcribed from
  the club's Google Sheet on 8 Aug 2026. Two things in it look like typos and
  are not: the tach doesn't chain at 1489 → 1489.98 or 1499.42 → 1499.49, and
  one row has no date (it's placed by its tach, and says so in its notes).
  Don't "fix" them — a gap in the log is exactly what the app is for. Landings,
  Hobbs, routes and oil are absent from the sheet and are therefore absent
  here; `lastHobbs` is null for the same reason.
- **The seeded ROSTER, by contrast, is fiction, and has to stay that way.** The
  sheet's PIC column names real club members, and demo data has no business
  carrying their names, emails or phone numbers into every dev database and CI
  log — so `MEMBERS` is eight invented people (555-01xx numbers, the block
  reserved for fiction) and the real log rows are attributed to them. The seed
  also DELETES the old real-named accounts (`RETIRED_DEMO_EMAILS`), which
  cascades their demo history away so the guarded blocks rebuild it under the
  invented roster. Everything around `FLIGHT_LOG` — `EARLIER_FLIGHTS` (the year
  before the sheet, chaining exactly into its opening 1488.0),
  `RECENT_FLIGHTS`, the squawks, checkouts, servicing and bookings — is
  invented too, and exists so every tab has something to show.
- The seed deliberately leaves NO squawk at `REVIEWED_GROUNDED`: that value
  stops the whole club with an app-wide banner and a "do not fly" card, and a
  demo database that opens with the airplane down teaches the wrong first
  lesson. It also leaves the admin's `totalTimeHours` null, which is what puts
  them in the tighter "building time" column of the operating rules —
  `operating-rules.spec.ts` asserts exactly that.
- Every seeded member has `tourSeenAt: null`, so `GuidedTour` opens for all of
  them — and its scrim swallows clicks. `signIn` in `tests/e2e/helpers.ts`
  calls `dismissTour` for exactly that reason; without it a spec fails on
  "intercepts pointer events" somewhere unrelated to what it was testing.
- Killing a `docker compose --profile test run` leaves the container up and a
  stale Next dev lock inside the `test-next` volume, so every later run dies
  with "Another next dev server is already running". Clean up with
  `docker ps -aq --filter name=vff-app-vff-app-test | xargs -r docker rm -f`
  then `docker volume rm vff-app_test-next`.
- The session cookie is renamed (`lib/authCookies.ts`) because cookies are
  scoped to a host, not a port, and every local app would otherwise share
  NextAuth's default name. `proxy.ts` must be given the same config — it reads
  the token itself, and with the default name it bounces every signed-in
  member straight back to /login.
