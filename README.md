# VFF Flying Club

Reserve the club's Cessna 172, run the preflight checklist, and file the
flight log — on a phone at the tiedown or on a laptop at home.

Four tabs, in the order a flight actually happens:

| Tab              | What it's for                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| **Preflight**    | I'M SAFE, the POH walkaround, and the 5 Ps — tappable, with squawks and photos |
| **Post-flight**  | Tach/Hobbs in-out, landings, fuel, oil, put-away — one line of the club log   |
| **Flight Log**   | Every flight flown, totals, landing currency, the squawk list and the rules   |
| **Reservations** | Month calendar on desktop; upcoming list + a "+" button on phones             |

Light and dark themes follow the OS by default. On phones the nav collapses to
a floating bottom bar and you can swipe left/right between tabs.

The club's operating rules (**VFF-OR-A**) are built in rather than filed away.
The preflight tab answers the question they exist to answer — *can you fly this
today, solo or with an instructor?* — from your own flight log, then lists the
minimums that come with that answer. Every checklist step has an (i) explaining
what it catches and why. See "Operating rules" below.

## Stack

Next **16** (App Router) · React **19** · TypeScript **6** · Tailwind **4**
(`@tailwindcss/postcss`) · NextAuth 4 (credentials + optional Google) · Prisma
**7** (`prisma-client` generator → `lib/generated/prisma`, imported via
`lib/prisma.ts`) · PostgreSQL · Vitest (unit) · Playwright (e2e) · Docker.

## Getting started

You need Docker. Node on the host is optional — everything runs in containers.

```bash
cp env.example/dev.env  env/dev.env      # env/ is gitignored
cp env.example/test.env env/test.env
docker compose --profile dev up          # → http://localhost:3000
```

That boots Postgres, installs deps, pushes the schema, seeds demo data, and
starts the dev server. Sign in with the seeded admin
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, default
`admin@vffclub.test` / `flyvff123`). The demo members share that password.

Prefer running the app on your host? Start only the database and use npm:

```bash
docker compose --profile dev up -d db-dev
npm install && npm run dev
```

### Commands

- `npm run dev` — dev server (loads `env/dev.env`)
- `npm run typecheck`
- `npm run test:unit` (`vitest run`) · watch: `test:unit:watch`
- `npm run test:e2e` — needs the test db (`docker compose --profile test up -d db-test`)
- `docker compose --profile test up --abort-on-container-exit` — unit + e2e in one shot
- `npm run db:push` · `db:seed` · `db:studio`

`docker compose --profile prod up -d --build` runs the built image against a
persistent database; fill `env/prod.env` first.

> The Playwright image tag in `docker-compose.yml` must match the
> `@playwright/test` version in `package.json` (pinned exactly for that
> reason) — the image only ships the browsers its own version expects.

## Operating rules

`lib/operatingRules.ts` encodes VFF-OR-A as data: both experience columns, the
instructor column, the airports needing a checkout (KAVX, KL35), and the
I'M SAFE / 5 Ps / GUMPS mnemonics. Nothing in the app relaxes a limit — where
the club defers to the FARs it says so, and the printed rule that a lower
personal or FAA minimum always wins is quoted on the page.

**The verdict.** `soloEligibility()` decides whether a member may fly solo or
as PIC today, and says why not when the answer is no:

1. **Which column applies** — over 200 h total *and* 50 h in the last 12 months
   gets the club's standard minimums; anything less gets the tighter set. Total
   time is self-declared on the profile (the club can't see a logbook); the
   recent hours come from this club's flight log.
2. **Are they current** — 3 landings inside that column's window (90 days on
   the standard column, 30 on the tighter one). Night is answered separately
   and counts only full-stop landings.

Failing the currency check doesn't ground anyone: the rules' third column is
"fly with an approved flight instructor", and that's what the app tells them —
along with the exact shortfall ("1 of 3 landings in the last 30 days").

Two honest limits, stated on the page itself: only flights logged in this app
count, so a member who flies elsewhere should talk to the Safety Officer; and
IFR currency is self-assessed, because the log doesn't record approaches.

When the Safety Officer revises the rules, edit that one file and bump
`RULES_REVISION`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, every PR, and on
demand:

- **Typecheck & unit tests** — `tsc --noEmit` then `vitest run`.
- **End-to-end** — a real Postgres service, `prisma db push`, then the full
  Playwright suite across the desktop and both phone projects. The report is
  uploaded as an artifact when something fails.

## Setting the club up

1. Sign up. **The first account created becomes the club admin** (a fresh
   install has nobody to grant it).
2. Change the airplane: the seed creates one from `SEED_TAIL_NUMBER`. Edit the
   tail number, model, hourly rate, fuel capacity and home base — either in
   `prisma/seed.ts` before seeding, or later via
   `PATCH /api/aircraft/[id]` as an admin.
3. Everything is keyed by aircraft, so adding a second airplane later is a
   row, not a migration. With more than one, the navbar's tail-number chip
   becomes a picker.

Admins can also resolve squawks and edit or cancel anyone's booking; members
own only their own rows.

## Data model (`prisma/schema.prisma`)

- **Aircraft** — tail number, model, rate, fuel capacity, plus `lastTach` /
  `lastHobbs`, which each filed flight advances so the next pilot's post-flight
  form pre-fills.
- **Reservation** — one airplane, one time block. Overlap is rejected by the
  API (`lib/reservations.ts`) rather than a db constraint so the message can
  name who has the airplane. Cancelling marks `CANCELED`, never deletes.
- **Flight** — the post-flight entry and one line of the log: tach/Hobbs in-out,
  landings, route, fuel, oil, put-away flags. Optionally closes out a
  Reservation (one flight per booking).
- **Squawk** — anything wrong with the airplane: `NOTE` / `MONITOR` /
  `GROUNDING`, `OPEN` until an admin signs it off. An open `GROUNDING` squawk
  puts a red banner across the whole app.
- **PreflightCheck** — one run of the checklist. Answers are a
  `{ itemId: boolean }` JSON map against `lib/checklist.ts`, so editing the
  checklist is a code change (bump `CHECKLIST_VERSION`), not a migration.
- **Photo** — index row for one image. Bytes live in object storage; served
  through `/api/photos/[id]` behind the session check.

## Photo storage

`STORAGE_DRIVER` picks the backend (`lib/storage/`):

- **`local`** (default) — writes to `STORAGE_LOCAL_DIR` (`storage/photos`).
  Zero config, used by dev and the e2e suite. In production it only survives if
  that path is a persistent volume (the prod compose service mounts one).
- **`s3`** — any S3-compatible bucket: **Cloudflare R2** (recommended),
  AWS S3, Backblaze B2, MinIO. Requests are SigV4-signed with `node:crypto`
  and plain `fetch`, so there's no AWS SDK in the bundle.

**Recommendation: Cloudflare R2.** S3-compatible, no egress fees (this app
streams every image through the server, so egress is the cost that would
actually bite), ~$0.015/GB-month, and a free tier that a flying club will
never exceed. Set up:

1. Cloudflare dashboard → R2 → create a bucket (keep it **private**).
2. Create an R2 API token with Object Read & Write for that bucket.
3. Fill in `env/prod.env`:

   ```
   STORAGE_DRIVER=s3
   S3_BUCKET=vff-photos
   S3_REGION=auto
   S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```

Nothing else changes: photos are always read back through `/api/photos/[id]`,
which checks the session first, so the bucket never needs to be public and no
signed URLs leak into the client.

## Gotchas

- Reservation times are stored as UTC instants and rendered in the server's
  zone — set `APP_TZ` (Vercel reserves `TZ`; `instrumentation.ts` copies it
  across at startup). Keep the app and db containers on the same zone.
- The Prisma client is **generated into the repo** (`lib/generated/prisma`).
  After schema changes, regenerate; import from `@/lib/prisma`, never
  `@prisma/client`. `prisma generate` runs on `postinstall` and needs
  `DATABASE_URL` in the environment.
- `tests/e2e/global-setup.ts` force-resets and reseeds the test database on
  every e2e run.
- Two display utilities on one element (`inline-flex` from `Button` plus a
  `hidden` class) are decided by stylesheet order, not by you — hide with a
  wrapper element instead.
