#!/usr/bin/env bash
# Proves `supabase/seeds/development.sql` still works against the current
# migration chain — and that its production guard still refuses.
#
# ## Why this is a gate rather than a thing someone remembers to run
#
# The seed is the only SQL in this repo that runs *by hand, occasionally*.
# Everything else is exercised continuously: the chain by run.sh on every
# supabase/** PR, the app by tsc and Vitest. So the seed is the one file that
# rots without anyone finding out, and the moment it is discovered broken is the
# worst possible one — somebody standing up DEV, under time pressure, believing
# the file works because it worked last time.
#
# The specific rot: a later migration adds a NOT NULL column to `rides`, or
# tightens a CHECK, or renames something. Nothing fails. `npm test` stays green,
# because the RLS suite has its own fixtures and never touches this file.
#
# ## What it checks, and why the guard test is not optional
#
#   1. The seed applies to a database built from the full chain.
#   2. Re-running it resets rather than appends.
#   3. It REFUSES once a non-seed account exists, and destroys nothing when it
#      refuses.
#
# (3) is the one that would otherwise be assumed. A guard that has quietly
# stopped matching passes for ever and looks exactly like a correct guard —
# the same reasoning src/__tests__/no-service-role-key.test.ts gives for
# proving its own detector still fires. Verifying it only in the direction
# where it should pass verifies nothing.
#
#   PGPASSWORD=postgres ./scripts/db/check-seed.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/supabase/seeds/development.sql"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
TEST_DB="${SEED_TEST_DB:-letsride_seed_test}"
export PGHOST PGPORT PGUSER

run_on() { psql -v ON_ERROR_STOP=1 -q -d "$1" "${@:2}"; }

cleanup() { run_on postgres -c "drop database if exists $TEST_DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Resetting $TEST_DB on $PGHOST:$PGPORT"
run_on postgres -c "drop database if exists $TEST_DB;" >/dev/null
run_on postgres -c "create database $TEST_DB;" >/dev/null

run_on "$TEST_DB" -f "$ROOT/supabase/tests/harness.sql" >/dev/null

for migration in "$MIGRATIONS"/*.sql; do
  run_on "$TEST_DB" -f "$migration" >/dev/null
done
echo "  chain applied ($(ls "$MIGRATIONS"/*.sql | wc -l | tr -d ' ') migrations)"

# The harness models auth.users as the three columns RLS cares about — id,
# email, raw_user_meta_data — because that is all a policy ever reads. The seed
# writes what GoTrue actually stores, so the rest is added here rather than in
# harness.sql: this is a property of the seed's environment, not of the policy
# suite, and widening the shared harness for one caller is how a test fixture
# stops resembling production.
#
# The token columns default to '' and never NULL for the reason the seed itself
# gives: GoTrue scans them into non-nullable Go strings.
run_on "$TEST_DB" >/dev/null <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud text,
  add column if not exists role text,
  add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists raw_app_meta_data jsonb default '{}'::jsonb,
  add column if not exists confirmation_token text not null default '',
  add column if not exists recovery_token text not null default '',
  add column if not exists email_change_token_new text not null default '',
  add column if not exists email_change text not null default '',
  add column if not exists email_change_token_current text not null default '',
  add column if not exists phone_change text not null default '',
  add column if not exists phone_change_token text not null default '',
  add column if not exists reauthentication_token text not null default '';
SQL

# ---------------------------------------------------------------------------
# 1. It applies
# ---------------------------------------------------------------------------
run_on "$TEST_DB" -v seed_password='check-seed-not-a-real-password' -f "$SEED" >/dev/null
echo "  seed applied"

counts() {
  run_on "$TEST_DB" -At -c "select
    (select count(*) from auth.users) || '/' ||
    (select count(*) from public.clubs) || '/' ||
    (select count(*) from public.rides) || '/' ||
    (select count(*) from public.postcards);"
}

FIRST="$(counts)"
if [ "$FIRST" = "0/0/0/0" ]; then
  echo "FAIL: the seed inserted nothing." >&2
  exit 1
fi
echo "  rows (users/clubs/rides/postcards): $FIRST"

# ---------------------------------------------------------------------------
# 2. It resets rather than appends
# ---------------------------------------------------------------------------
run_on "$TEST_DB" -v seed_password='check-seed-not-a-real-password' -f "$SEED" >/dev/null
SECOND="$(counts)"
if [ "$FIRST" != "$SECOND" ]; then
  echo "FAIL: not idempotent — $FIRST then $SECOND. The seed is appending." >&2
  exit 1
fi
echo "  idempotent on re-run"

# ---------------------------------------------------------------------------
# 3. The guard refuses, and destroys nothing while refusing
# ---------------------------------------------------------------------------
run_on "$TEST_DB" -c "insert into auth.users (id, email, aud, role)
  values ('99999999-9999-4999-8999-999999999999', 'someone@example.com', 'authenticated', 'authenticated');" >/dev/null

if run_on "$TEST_DB" -v seed_password='check-seed-not-a-real-password' -f "$SEED" >/dev/null 2>&1; then
  echo "FAIL: the seed ran against a database holding a non-seed account." >&2
  echo "      That guard is the only thing standing between this file and production." >&2
  exit 1
fi
echo "  refuses once a non-seed account exists"

AFTER="$(counts)"
EXPECTED_AFTER="$(( ${FIRST%%/*} + 1 ))/${FIRST#*/}"
if [ "$AFTER" != "$EXPECTED_AFTER" ]; then
  echo "FAIL: the refused run changed the database — $EXPECTED_AFTER expected, $AFTER found." >&2
  echo "      The guard must abort before the delete, not after it." >&2
  exit 1
fi
echo "  refused run left the database untouched"

echo
echo "Development seed OK."
