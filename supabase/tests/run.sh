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

# Migrations written but deliberately not deployed. The suite must model the
# database that actually runs, so these are skipped rather than applied — a
# suite that tests a schema production does not have is worse than no suite.
# Remove an entry here in the same change that deploys it.
#
#   003_onboarding.sql — drops profiles.full_name, which 10 files still
#   reference. Ships with the login epic as one coordinated change.
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-003_onboarding.sql}"

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
run_on "$TEST_DB" -f "$DIR/rls_test.sql"
