#!/usr/bin/env bash
# Applies the harness, every migration in order, and the fixtures to a scratch
# database, then runs the policy suite against it. Migrations are picked up from
# the directory rather than listed here, so a new one is covered automatically.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$DIR/../migrations" && pwd)"

# Refused before anything is dropped or created. PENDING selected one of three
# alternative suite files while 023 and 025 were held back; both are applied and
# their assertions are in rls_test.sql. Silently ignoring it would run the right
# suite for the wrong reason, which is the failure this whole change was about.
if [ -n "${PENDING-}" ]; then
  echo "PENDING is gone: 023 and 025 are applied and their assertions live in rls_test.sql. Run 'npm test'." >&2
  exit 2
fi

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
# **It is empty, and that is the correct state.** `list_migrations` reads 27 rows
# against 27 files — zero drift — so the whole chain applies here exactly as it
# applies on the hosted project. Nothing is skipped and nothing should be.
#
# 023 and 025 were the last two entries, and both came out on 2026-08-06 when
# they were applied. The machinery went with them, and the reason is worth
# stating once so it is not rebuilt out of habit: it existed *only* to keep this
# suite honest while those two were held back, and an entry that outlives its
# migration inverts its own purpose — the default suite silently starts modelling
# a database two migrations behind production, and nothing goes red to say so.
#
# There used to be three extra modes — `PENDING=023`, `PENDING=025` and
# `PENDING=023+025` — each running a separate suite file INSTEAD of rls_test.sql,
# because 025 revokes the column SELECT that ~20 of rls_test.sql's 003/012 stamp
# assertions read directly as the caller. Those assertions now go through
# `my_onboarding_state()`, `accept_terms()` and `complete_onboarding()`, so there
# is one suite again and it covers the whole chain. The three
# `rls_test_pending_*.sql` files were folded into rls_test.sql and deleted.
#
# If a future migration genuinely has to be held back, put its filename here and
# say why — one line per entry, with the condition that removes it.
SKIP_ALL_PENDING=""
SKIP_MIGRATIONS="${SKIP_MIGRATIONS-$SKIP_ALL_PENDING}"
SUITE="$DIR/rls_test.sql"

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
