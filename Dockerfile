# Production image, built in stages so the thing we ship carries only what it
# runs. The old single-stage image kept dev dependencies and the whole source
# tree (~1.5GB); this one ships Next's traced standalone bundle plus the Prisma
# CLI, and lands around 250MB.
#
#   deps       — full install (dev deps included; the build needs them)
#   builder    — prisma generate + next build
#   prisma-cli — JUST the Prisma CLI, for `migrate deploy` at boot
#   runner     — the shipped image
#
# Build:  docker build --build-arg COMMIT_SHA=$(git rev-parse HEAD) -t vff-app .

# ---- deps -------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# prisma/ and prisma.config.ts are copied alongside the manifests because
# package.json's postinstall runs `prisma generate`, which needs the schema on
# disk. Code changes still hit the cached install.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which loads prisma.config.ts, which
# resolves env("DATABASE_URL") eagerly — so the variable has to exist even
# though generate never opens a connection. CI does the same thing.
RUN DATABASE_URL="postgresql://unused:unused@localhost:5432/unused" npm ci

# ---- builder ----------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The login screen stamps the build with the commit sha. .dockerignore excludes
# .git, so next.config.js cannot shell out to git in here — the sha is passed
# in instead. Empty is fine: the stamp just renders without it.
ARG COMMIT_SHA=""
ENV COMMIT_SHA=$COMMIT_SHA

# `npm run build` is `prisma generate && next build`. Same placeholder as the
# deps stage: generate reads the variable, nothing connects. The real
# DATABASE_URL arrives as runtime env — baking one in would be a bug.
RUN DATABASE_URL="postgresql://unused:unused@localhost:5432/unused" npm run build

# ---- prisma-cli -------------------------------------------------------------
# `migrate deploy` needs the Prisma CLI and its schema engine, which the
# standalone bundle deliberately does not carry (prisma is a devDependency).
# Installed on its own so it stays out of the app's node_modules, and pinned to
# whatever package.json asks for so the two can't drift.
FROM node:24-alpine AS prisma-cli
WORKDIR /prisma-cli
COPY package.json /tmp/app-package.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/app-package.json').devDependencies.prisma")" \
  && npm init -y > /dev/null \
  && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}"

# ---- runner -----------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Reservation times are stored as UTC instants but rendered/parsed against the
# club's local zone (see lib/dates.ts). Set it here so hosts that build straight
# from this Dockerfile still get the right zone; override via platform env vars.
ENV TZ=America/Los_Angeles
ENV PORT=3000
# server.js binds HOSTNAME; the default would listen on localhost only, which
# from outside the container looks like a dead port.
ENV HOSTNAME=0.0.0.0

# Next's traced bundle: server.js + the minimal node_modules it actually needs.
# .next/static is NOT part of the trace and has to come across separately.
# (There is no public/ in this repo — add a COPY for it if one ever appears.)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# The CLI and its inputs live together under /prisma-cli, deliberately NOT in
# /app: prisma.config.ts does `import { env } from "prisma/config"`, and Node
# resolves that from the config file's own directory. Left in /app it would
# look in the standalone bundle's node_modules, which has no prisma CLI, and
# every boot would die with "Cannot find module 'prisma/config'".
#
# schema.prisma carries no datasource url — prisma.config.ts supplies it from
# DATABASE_URL at runtime.
COPY --from=prisma-cli /prisma-cli /prisma-cli
COPY --from=builder /app/prisma /prisma-cli/prisma
COPY --from=builder /app/prisma.config.ts /prisma-cli/prisma.config.ts

# Created (and owned) before the volume mounts over it: Docker copies the
# image's ownership onto a fresh named volume, and without this the volume
# arrives root-owned and STORAGE_DRIVER=local uploads fail with EACCES.
RUN mkdir -p /app/storage/photos && chown -R node:node /app/storage

# Run as the node user rather than root. The app writes nothing else to its own
# filesystem.
USER node

EXPOSE 3000

# `migrate deploy` applies committed migrations (prisma/migrations/) without
# prompting, and is a no-op once they're applied — safe on every boot. It exits
# non-zero on failure, so a bad migration stops the container instead of
# serving an app against a half-built schema.
# The subshell keeps the cd local: prisma.config.ts resolves its `schema` path
# relative to the working directory, and server.js still starts from /app.
CMD ["sh", "-c", "(cd /prisma-cli && ./node_modules/.bin/prisma migrate deploy) && node server.js"]
