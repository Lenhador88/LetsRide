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

# Escape hatch for a migration that is written but deliberately not deployed:
# the suite must model the database that actually runs, and a suite testing a
# schema production does not have is worse than no suite. Add an entry only
# alongside a decision not to deploy, and remove it in the change that does.
#
# Two entries today, both written and both deliberately unapplied:
#
#   023  gates participation on a consent stamp all four live riders have NULL.
#        It needs the consent prompt (task 2.3) to ship first.
#   025  removes a grant proxy.ts, getMyProfile, setLocation and signUp all
#        depend on. It needs its code repair deployed first; see its header.
#
# **021 is NOT one of them any more, and that is the point of the split.** It was
# `021_profile_column_privileges.sql` and held both the own-row functions and the
# revoke. Those two have to be applied on opposite sides of the code deploy — new
# code against a database with no `my_onboarding_state()` bounces every rider at
# the route guard; old code against the revoke breaks four live paths — so one
# file could not be applied in either order. Split, 021 is purely additive and is
# applied, so it belongs in the default chain like any other migration. Only the
# revoke stays pending, as 025.
#
# The pending assertions live in rls_test_pending_023.sql,
# rls_test_pending_025.sql and rls_test_pending_023_025.sql:
#
#   PENDING=023     npm test    # applies 023, skips 025
#   PENDING=025     npm test    # applies 025, skips 023
#   PENDING=023+025 npm test    # applies BOTH — the state that will actually ship
#
# Each runs INSTEAD of rls_test.sql, because 025 revokes the column SELECT that
# ~20 of rls_test.sql's 003/012 stamp assertions read directly as the caller.
# That is the one reason these files exist; 021's own assertions moved into
# rls_test.sql when it stopped being pending.
#
# **There used to be no mode applying both, and this note records why there now
# is.** The objection was that "023 requires two stamps that 021 removes the only
# client path to setting", so together they made the wizard a dead end. 021's
# `accept_terms()` and `complete_onboarding(text)` resolved it by giving the
# database that path. PENDING=023+025 is the proof: a rider with NULL stamps
# consents, finishes the wizard and posts.
#
# Keep all three. The two solo modes are what say which migration owns which
# rule; the combined one is what says they compose.
SKIP_ALL_PENDING="023_participation_gate.sql 025_profile_column_privileges.sql"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS-$SKIP_ALL_PENDING}"
SUITE="$DIR/rls_test.sql"

case "${PENDING-}" in
  023)     SKIP_MIGRATIONS="025_profile_column_privileges.sql"; SUITE="$DIR/rls_test_pending_023.sql" ;;
  025)     SKIP_MIGRATIONS="023_participation_gate.sql";        SUITE="$DIR/rls_test_pending_025.sql" ;;
  023+025) SKIP_MIGRATIONS="";                                  SUITE="$DIR/rls_test_pending_023_025.sql" ;;
  "")      ;;
  *)       echo "PENDING must be 023, 025 or 023+025 (see the pending suites' headers)" >&2; exit 2 ;;
esac

for migration in "$MIGRATIONS"/*.sql; do
  name="$(basename "$migration")"
  case " $SKIP_MIGRATIONS " in
    *" $name "*)
      echo "  skipping $name (written, not deployed)"
      continue
      ;;
  esac
  echo "  applying $name"
  run_on "$TEST_DB" -f "$migration" >/dev/null
done

run_on "$TEST_DB" -f "$DIR/seed.sql" >/dev/null
run_on "$TEST_DB" -f "$SUITE"
