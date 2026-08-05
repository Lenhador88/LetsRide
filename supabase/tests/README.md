# RLS policy tests

Every table in this project relies on Row Level Security for access control, so
a wrong policy is a data leak rather than a broken page. This suite runs the
real migration chain against a scratch Postgres database and asserts what each
role can and cannot reach.

## Running locally

Needs a Postgres server and `psql`. Point the standard `PG*` variables at it:

```bash
npm test                                  # localhost:5432, user postgres
PGHOST=/tmp PGPORT=5433 npm test          # a socket-based local instance
```

The runner drops and recreates `letsride_test`, applies `harness.sql`, then
every file in `../migrations` in filename order, then `seed.sql`, then
`rls_test.sql`. New migrations are picked up automatically — there is no list to
keep in sync.

CI runs the same script against `postgres:17`, matching the Supabase project's
major version.

## Files

| File | Purpose |
|---|---|
| `harness.sql` | Stand-in for Supabase: `auth.users`, `auth.uid()`, the `anon`/`authenticated`/`auth_admin` roles, their default grants, and the assertion helpers |
| `seed.sql` | Fixtures: three onboarded riders, two riders mid-onboarding, a private club with a member, a public club, a club-only ride, a public ride |
| `rls_test.sql` | The assertions |
| `run.sh` | Applies everything in order and runs the suite |

## Writing assertions

`assert_eq(actual, expected, label)`, `assert_denied(sql, label)`,
`assert_rejected(sql, sqlstate, label)` and `assert_allowed(sql, label)` all raise
on failure, and `psql -v ON_ERROR_STOP=1` turns that into a non-zero exit.
`assert_allowed` unwinds its own write, so it leaves nothing behind for later
assertions.

`assert_denied` recognises only an RLS refusal (`42501`). Constraints and trigger
guards refuse with `23514` / `23505`, so those use `assert_rejected`, which names
the expected SQLSTATE — "rejected by the charset check" and "rejected as a
duplicate" are different claims and a test that accepted any error would blur
them.

Switch identity with `set_config('test.uid', '<uuid>', false)`; the harness's
`auth.uid()` reads it. The suite runs as the `authenticated` role and asserts
that up front — running as superuser would bypass RLS and pass while testing
nothing.

## What this suite cannot catch

It runs against plain Postgres, not Supabase, so anything that depends on the
hosted environment is invisible to it. That gap is not theoretical: migration
`003` revoked `EXECUTE` from `PUBLIC`, passed locally, and left the function
callable in production, because Supabase *also* grants `anon` and
`authenticated` explicitly and an explicit grant needs an explicit revoke.

`harness.sql` now reproduces those grants, and dropping migration `004` makes
this suite fail — so that specific bug is covered. But the general class is not.
For changes touching roles, grants, or exposed endpoints, also check the live
project:

```
mcp__Supabase__get_advisors(project_id, type: "security")
```

Treat a green suite as evidence about policy *logic*, not about the deployed
environment.

## Writing assertions — the statement has to match what PostgREST emits

Every assertion in this suite is **hand-written SQL standing in for a statement the app
sends through PostgREST.** When an action's write is a plain insert, update or delete, the
two are the same and nothing can go wrong. When it is anything else, they diverge, and a
green suite can sit on top of a feature that has never worked.

That is not hypothetical. `addCountry` used supabase-js `upsert`, which without
`ignoreDuplicates` sends `Prefer: resolution=merge-duplicates` and becomes
`ON CONFLICT DO UPDATE`. Postgres checks UPDATE privilege when it **plans** that statement,
not when a row actually conflicts — and `014` grants no UPDATE on `profile_countries` by
design. So every insert failed `42501`, including the first. The assertion covering it
issued a plain `insert`, passed, and proved nothing about the code path in production.

So: **write the emitted form.** `upsert` → `on conflict ... do nothing` or `do update`,
whichever the client actually sends. And where the shape encodes a decision — as
"no UPDATE grant, so the client must pass `ignoreDuplicates`" does — add the negative
assertion that fails if someone repairs it in the wrong direction, by granting the
privilege instead of changing the call.
