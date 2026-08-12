#!/bin/sh
# Vercel's build, which is NOT the same build as everyone else's.
#
# The Docker image applies `prisma migrate deploy` from its CMD (see the
# Dockerfile), so a container boots itself onto the current schema. Vercel
# never runs that CMD — it runs a build and then serves the output — so
# nothing in the Vercel path was applying migrations at all. The symptom is
# nasty precisely because the build and the deploy both succeed: the site
# comes up, static pages render, and then every request that touches the
# database 500s with an empty body. That is how both Neon databases sat at
# zero of six migrations while looking deployed.
#
# npm runs this script instead of `build` when it exists, which is Vercel's
# documented behaviour — as long as the project's Build Command is left on its
# default. An explicit Build Command in the dashboard overrides package.json
# entirely and this file would silently never run.
set -e

# Only the two branches that own a real database migrate. Vercel scopes env
# vars per environment, so a preview build for some PR branch may well be
# holding staging's (or worse, production's) DATABASE_URL — and a half-finished
# migration from a branch nobody has merged is not something a shared database
# should be finding out about. main and staging are the only refs whose schema
# is supposed to be the deployed schema.
case "$VERCEL_GIT_COMMIT_REF" in
  main | staging)
    echo "vercel-build: '$VERCEL_GIT_COMMIT_REF' owns a database — applying migrations."
    prisma migrate deploy
    ;;
  *)
    echo "vercel-build: '${VERCEL_GIT_COMMIT_REF:-<no branch>}' is not main or staging — skipping migrations."
    ;;
esac

# The ordinary build, reused rather than restated so there is one definition of
# what building this app means.
npm run build
