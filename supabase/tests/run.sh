#!/usr/bin/env bash
# Applies the harness, every migration in order, and the fixtures to a scratch
# database, then runs the policy suite against it. Migrations are picked up from
# the directory rather than listed here, so a new one is covered automatically.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$DIR/../migrations" && pwd)"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
TEST_DB="${TEST_DB:-letsride_test}"
export PGHOST PGPORT PGUSER

run_on() {
  psql -v ON_ERROR_STOP=1 -q -d "$1" "${@:2}"
}

echo "Resetting $TEST_DB on $PGHOST:$PGPORT"
run_on postgres -c "drop database if exists $TEST_DB;" >/dev/null
run_on postgres -c "create database $TEST_DB;" >/dev/null

run_on "$TEST_DB" -f "$DIR/harness.sql" >/dev/null

# The full migration chain applies, always. This used to have an escape hatch
# here — SKIP_MIGRATIONS and a PENDING mode — for 023 and 025, which were
# written and deliberately not deployed for several weeks: 023 gated
# participation on a consent stamp all four live riders had NULL, and 025
# removed a grant proxy.ts, getMyProfile, setLocation and signUp all depended
# on, pending its code repair. Both are applied to the hosted project now — 27
# rows against 27 files, zero drift — so the mechanism that once kept this
# suite honest about a database that did not yet exist would now do the
# opposite: model a chain with two migrations missing that the real database
# has. Their assertions moved into rls_test.sql itself.
SUITE="$DIR/rls_test.sql"

for migration in "$MIGRATIONS"/*.sql; do
  name="$(basename "$migration")"
  echo "  applying $name"
  run_on "$TEST_DB" -f "$migration" >/dev/null
done

run_on "$TEST_DB" -f "$DIR/seed.sql" >/dev/null
run_on "$TEST_DB" -f "$SUITE"
