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

### The three undeployed migrations, and the one that is not skipped

**The suite models the database that actually runs**, so `run.sh` skips `021`
and `023` by default: both are written, both are deliberately not applied to the
hosted project, and a suite asserting a schema production does not have is worse
than no suite. Their assertions run on demand:

```bash
PENDING=021 npm test   # applies 021, skips 023, runs rls_test_pending_021.sql
PENDING=023 npm test   # applies 023, skips 021, runs rls_test_pending_023.sql
```

Each runs *instead of* `rls_test.sql`, and there is no mode that applies both.
Two reasons, both of which are findings rather than inconveniences:

- `021` revokes the column SELECT that ~20 of `rls_test.sql`'s own `003`/`012`
  assertions read directly, so that file cannot pass with `021` applied.
- **`021` and `023` cannot both hold as drafted.** `023` refuses every write from
  a rider whose two stamps are unset; `021` removes the only path by which a
  client ever sets either. Together, no rider can ever qualify.

Both suites fail without their migration — checked, not assumed — so neither is
a placeholder.

**`024` is the third undeployed migration, and it is deliberately NOT skipped —
so for one column the sentence above is currently false.** `rls_test.sql`
asserts `profiles.avatar_url` and `clubs.avatar_url` are absent while the hosted
project still has both. That is the intended state rather than drift: unlike
`021`/`023` there is no unresolved decision behind `024`, only an ordering one.
Its code repair is backward-compatible — every changed select was probed against
the live schema and is valid before the drop — so the sequence is **merge and
deploy the code, then apply `024`**. The reverse is an instant outage on `main`.

The cost of that choice is worth naming: **nothing goes red if `024` is never
applied.** The code works either way, CI is green, and this suite is green. The
only signal is item 2 of *Do this first* in `docs/HANDOFF.md`. Delete these two
paragraphs in the change that applies it.

## Files

| File | Purpose |
|---|---|
| `harness.sql` | Stand-in for Supabase: `auth.users`, `auth.uid()`, the `anon`/`authenticated`/`auth_admin` roles, their default grants, and the assertion helpers |
| `seed.sql` | Fixtures: three onboarded riders, two riders mid-onboarding, a private club with a member, a public club, a club-only ride, a public ride |
| `rls_test.sql` | The assertions, against the deployed schema **plus `024`** — see the note above |
| `rls_test_pending_021.sql` | Assertions for `021`, which is written and not deployed |
| `rls_test_pending_023.sql` | Assertions for `023`, likewise. Adds three riders of its own so no expected value in `rls_test.sql` moves |
| `run.sh` | Applies everything in order and runs one of the three suites |

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
