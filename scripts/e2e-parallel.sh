#!/usr/bin/env bash
# Run the e2e suite as N parallel shards, each in its own Docker stack.
#
#   scripts/e2e-parallel.sh            # 3 shards, every project
#   scripts/e2e-parallel.sh 4          # 4 shards
#   scripts/e2e-parallel.sh 3 --project=desktop   # extra args go to playwright
#
# Why shards and not Playwright workers: the specs share ONE database within a
# run and some depend on order (see CLAUDE.md — runway.spec asserts nobody has
# walked a preflight yet today), so `workers: 1` stays. A SHARD is different:
# it is a whole second copy of the world — its own Postgres (reset and seeded
# by global-setup), its own `next dev`, its own browser — running a slice of
# the spec FILES in their usual order. Ordering still holds inside a shard,
# and shards can't see each other's data at all.
#
# Costs: the first run of each shard installs node_modules into its own volume
# (later runs reuse it), and N shards means N dev servers and N browsers at
# once — about 1.5 GB of memory each — and they compete for Docker's CPUs.
# The speed-up is bounded by Docker Desktop's allowance (Settings → Resources),
# not the Mac's: at 4 CPUs, three shards each compiling with `next dev` barely
# beat one. Give Docker ~2 CPUs per shard.
set -uo pipefail

SHARDS="${1:-3}"
shift || true
EXTRA_ARGS="$*"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/test-results/shards"
mkdir -p "$LOGS"

compose() {
  docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker/compose.e2e-shard.yml" \
    -p "vff-e2e-$1" --profile test "${@:2}"
}

# ── Phase 1: prepare, once ──────────────────────────────────────────────────
#
# Each shard has its OWN node_modules volume, but the source tree is SHARED —
# and installing runs `prisma generate` (postinstall), which writes the client
# into lib/generated in that shared tree. Three shards doing it at once
# collided and one died before running a test. So: install into every volume
# (in parallel — separate volumes) with scripts OFF, then generate exactly
# once. An install is skipped when package-lock.json hasn't changed since the
# volume was last filled, which is what makes a second run start in seconds.
echo "Preparing $SHARDS shards (dependencies, then the Prisma client once)…"
install_pids=()
for i in $(seq 1 "$SHARDS"); do
  compose "$i" run --rm --no-deps vff-app-test sh -c '
    sum=$(sha1sum package-lock.json | cut -d" " -f1)
    if [ "$(cat node_modules/.vff-lock 2>/dev/null)" != "$sum" ]; then
      npm ci --ignore-scripts --no-audit --no-fund && echo "$sum" > node_modules/.vff-lock
    fi
  ' >"$LOGS/shard-$i.log" 2>&1 &
  install_pids+=($!)
done
for pid in "${install_pids[@]}"; do
  wait "$pid" || { echo "Installing dependencies failed — see test-results/shards/"; exit 1; }
done
compose 1 run --rm --no-deps vff-app-test sh -c "npx prisma generate" >>"$LOGS/shard-1.log" 2>&1 \
  || { echo "prisma generate failed — see test-results/shards/shard-1.log"; exit 1; }

# ── Phase 2: run the shards in parallel ─────────────────────────────────────
echo "Running the e2e suite as $SHARDS parallel shards — logs in test-results/shards/"
start=$(date +%s)
pids=()
for i in $(seq 1 "$SHARDS"); do
  (
    # Each shard writes its traces and screenshots to its OWN output folder:
    # the source tree is shared, and Playwright empties its output folder at
    # the start of a run, so a common one would delete another shard's
    # failure evidence mid-run. (`db push` doesn't generate in Prisma 7, so
    # nothing here writes to the shared tree.)
    compose "$i" run --rm vff-app-test sh -c "
      npx prisma db push --accept-data-loss &&
      npx playwright test --shard=$i/$SHARDS --output=test-results/shard-$i --reporter=line $EXTRA_ARGS
    " >>"$LOGS/shard-$i.log" 2>&1
    status=$?
    compose "$i" down >/dev/null 2>&1
    exit $status
  ) &
  pids+=($!)
done
failed=0
for i in $(seq 1 "$SHARDS"); do
  if wait "${pids[$((i - 1))]}"; then
    result="ok"
  else
    result="FAILED"
    failed=1
  fi
  summary=$(grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" "$LOGS/shard-$i.log" | tr -s ' ' | tr '\n' ' ')
  echo "  shard $i/$SHARDS: $result — ${summary:-no summary (see the log)}"
done

echo "Done in $(( $(date +%s) - start ))s."
if [ "$failed" -ne 0 ]; then
  echo "Failures — read test-results/shards/shard-N.log, traces in test-results/shard-N/."
  exit 1
fi
