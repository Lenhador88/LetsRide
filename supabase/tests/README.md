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

### The two undeployed migrations

**The suite models the database that actually runs**, so `run.sh` skips `023` and
`025` by default: both are written, both are deliberately not applied to the
hosted project, and a suite asserting a schema production does not have is worse
than no suite. Their assertions run on demand:

```bash
PENDING=023     npm test   # applies 023, skips 025
PENDING=025     npm test   # applies 025, skips 023
PENDING=023+025 npm test   # applies BOTH — the state that will actually ship
```

Each runs *instead of* `rls_test.sql`, because **`025` revokes the column SELECT
that ~20 of `rls_test.sql`'s own `003`/`012` assertions read directly**, so that
file cannot pass with `025` applied. When `025` lands with its code repair those
assertions move to the accessor and `rls_test_pending_025.sql` merges back in.

Each pending suite fails without its migration — checked, not assumed — so
neither is a placeholder.

**Two things here changed on 2026-08-05 and are worth knowing before reading
older notes.**

`021` used to be on this list. It was `021_profile_column_privileges.sql` and
held two things that must be applied on opposite sides of the code deploy: the
own-row functions, and the revoke. New code against a database without
`my_onboarding_state()` bounces every rider at the route guard; old code against
the revoke breaks four live paths. Split, `021_onboarding_state_accessors.sql` is
purely additive and applied — so its assertions live in `rls_test.sql` like any
other shipped migration — and only the revoke stays pending, as `025`.

And there used to be no mode applying both, because "`023` requires two stamps
that `021` removes the only client path to setting". `021`'s `accept_terms()` and
`complete_onboarding(text)` resolved that by giving the database the write path,
so `PENDING=023+025` now exists and walks a rider from two NULL stamps to a
published postcard.

**When you add an assertion, the question is which migration it constrains, not
which file you happened to be reading.** Behaviour of the three functions is
mainline; anything of the form `has_column_privilege(...) = false` is pending
on `025`.

## Files

| File | Purpose |
|---|---|
| `harness.sql` | Stand-in for Supabase: `auth.users`, `auth.uid()`, the `anon`/`authenticated`/`auth_admin` roles, their default grants, and the assertion helpers |
| `seed.sql` | Fixtures: three onboarded riders, two riders mid-onboarding, a private club with a member, a public club, a club-only ride, a public ride |
| `rls_test.sql` | The assertions, against the deployed schema — including `021`'s three own-row functions, which are applied |
| `rls_test_pending_023.sql` | Assertions for `023`, written and not deployed. Models `023` *without* the revoke, so its stamp refusals are `23514` |
| `rls_test_pending_025.sql` | Assertions for `025`, likewise. Only what the revoke changes; the functions' behaviour is mainline |
| `rls_test_pending_023_025.sql` | The pair applied together — the shipping state. Walks the whole rider path, and asserts the refusals that move from `23514` to `42501` |
| `run.sh` | Applies everything in order and runs one of the four suites |

Each pending suite adds fixture riders of its own rather than extending
`seed.sql`, so no expected value in `rls_test.sql` moves. `rls_test.sql`'s own
`021` section does the same and rolls them back, which is why it sits at the end
of the file.

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
