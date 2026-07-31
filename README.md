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

The club's operating rules (**VFF-OR-A**) are built in rather than filed away:
the preflight tab shows the column that applies to *you* today, every checklist
step has an (i) explaining what it catches and why, and the flight log carries
the full table plus what the club's log says about your landing currency. See
"Operating rules" below.

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

Which column applies comes from two numbers:

- **Total time** — self-declared on the profile, because the club can't see a
  member's logbook.
- **Hours in the last 12 months** — computed from this club's flight log.

Both must clear the gate (over 200 h total *and* 50 h recent) for the standard
column; anything else gets the tighter one, and a flight logged as flown with
an approved instructor uses the third. Landing currency is likewise presented
as "what the club log shows", never as a verdict — hours flown elsewhere are
invisible to it.

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
