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
#   021  removes a grant proxy.ts, getMyProfile, setLocation and signUp all
#        depend on. It needs its code repair in the same change; see its header.
#   023  gates participation on a consent stamp all four live riders have NULL.
#        It needs the consent prompt (task 2.3) to ship first.
#
# Their assertions live in rls_test_pending_021.sql and rls_test_pending_023.sql:
#
#   PENDING=021 npm test    # applies 021, skips 023
#   PENDING=023 npm test    # applies 023, skips 021
#
# Each runs INSTEAD of rls_test.sql, and there is deliberately no mode applying
# both. Two reasons, both recorded in those files' headers: 021 revokes the
# column SELECT that ~20 of rls_test.sql's 003/012 assertions read, and 021 and
# 023 cannot both hold as drafted — 023 requires two stamps that 021 removes the
# only client path to setting.
SKIP_ALL_PENDING="021_profile_column_privileges.sql 023_participation_gate.sql"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS-$SKIP_ALL_PENDING}"
SUITE="$DIR/rls_test.sql"

case "${PENDING-}" in
  021) SKIP_MIGRATIONS="023_participation_gate.sql";        SUITE="$DIR/rls_test_pending_021.sql" ;;
  023) SKIP_MIGRATIONS="021_profile_column_privileges.sql"; SUITE="$DIR/rls_test_pending_023.sql" ;;
  "")  ;;
  *)   echo "PENDING must be 021 or 023 (never both — see the pending suites' headers)" >&2; exit 2 ;;
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
