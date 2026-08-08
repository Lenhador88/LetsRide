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

In this container `psql` needs the password in the environment, or it prompts
and the suite looks broken rather than uncredentialed:

```bash
PGPASSWORD=postgres npm test
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # the assertion count
```

The runner drops and recreates `letsride_test`, applies `harness.sql`, then
every file in `../migrations` in filename order, then `seed.sql`, then
`rls_test.sql`. New migrations are picked up automatically — there is no list to
keep in sync.

CI runs the same script against `postgres:17`, matching the Supabase project's
major version.

### There is one suite and one mode, and nothing is skipped

**The suite models the database that actually runs.** It is the whole chain:
`SKIP_ALL_PENDING` in `run.sh` is empty, so every migration applies here exactly
as it applies on the hosted project. **Derive the pair rather than reading one
here** — this line carried `27 rows against 27 files` from 2026-08-06 until
2026-08-08, false from about `028` onward, and a fresh number restarts that
clock:

```bash
ls supabase/migrations/*.sql | wc -l     # files
# vs list_migrations against the hosted project — DEV, then PROD
```

Note the two hosted projects disagree by design; `docs/ENVIRONMENTS.md` is the
contract. Check that rather than trust this line —
`list_migrations` against `ls ../migrations/`.

**There used to be three extra modes and three extra suite files**, and the
reason they are gone is worth stating once so they are not rebuilt out of habit.
`023` and `025` were held back for a deploy ordering, so `run.sh` skipped them
and `PENDING=023`, `PENDING=025` and `PENDING=023+025` each ran a separate file
*instead of* `rls_test.sql`. That was correct while it was true. It stopped being
true the moment both applied, and then it inverted: the default `npm test` was
quietly asserting a schema two migrations behind production, and **nothing went
red to say so** — all four modes stayed green. The skip mechanism is the one
piece of this suite that can fail silently, which is why it now defaults to empty
and `PENDING` exits with an error instead of being ignored.

The three files were folded into `rls_test.sql` on 2026-08-06 and deleted. Their
content lives in three places: the `025` grant assertions and the stamp denials
near the top (in the `003`/`012` section they replaced), `021`'s three functions
in the `021` section, and the participation gate in a `023` section of its own at
the end.

**When you add an assertion, the question is which migration it constrains, not
which section you happened to be reading.** The three still have separate
identities — `021` gave the wizard a write path, `025` took the client's own path
away, `023` gates participation on the result — even though one `npm test` run
now exercises all three together.

### The one thing that made the fold non-mechanical

`025` revokes the column SELECT and UPDATE that ~20 of `rls_test.sql`'s `003` and
`012` assertions used directly as the caller — they wrote `terms_accepted_at` and
`onboarding_completed_at` and read them back to check the trigger's logic. Those
statements are now refused **at the GRANT, before the trigger is entered**, so
the refusal is unconditional rather than value-dependent: `assert_rejected
('23514', ...)` became `assert_denied(...)`.

The rules themselves did not go away, they moved. `complete_onboarding()` and
`accept_terms()` are the only remaining path to either column, and they restate
every invariant in their own bodies — because a `security definer` function runs
as its owner and the trigger's `current_user <> 'authenticated'` guard
short-circuits for it. So the repointed assertions drive the rules through the
RPCs and read the stamps back through `my_onboarding_state()`.

Two consequences to know before adding an assertion here:

- **A rule that no role can reach is not assertable, and should not be faked.**
  With `025` applied, `enforce_onboarding_completion()`'s completion and
  first-consent branches are unreachable: `authenticated` holds no grant on
  either column, and every other role returns early on the function's own guard.
  The only branches still live are the two `new.<stamp> := old.<stamp>` re-pins
  an ordinary profile edit takes, and those *are* asserted. The rest is defence
  in depth against a future re-grant, and the honest assertion for it is that the
  grant is absent.
- **Assert a grant fact once.** `has_column_privilege(...) = false` and friends
  live in one block, next to the denials they explain. They used to be stated
  twice under two framings — once as "025 took it away", once as "021 has not
  taken it away yet" — which was right while the two migrations straddled a
  deploy and is a drift hazard now that they do not.

## Files

| File | Purpose |
|---|---|
| `harness.sql` | Stand-in for Supabase: `auth.users`, `auth.uid()`, the `anon`/`authenticated`/`auth_admin` roles, their default grants, and the assertion helpers |
| `seed.sql` | Fixtures: three onboarded riders, two riders mid-onboarding, a private club with a member, a public club, a club-only ride, a public ride |
| `rls_test.sql` | Every assertion, against the whole applied chain |
| `run.sh` | Applies everything in order and runs the suite |

### Sections that add their own fixtures must also own them

The `021` and `023` sections both add riders of their own rather than extending
`seed.sql`, and both roll them back, so not one expected value earlier in the
file moves. That is why they sit at the end.

`023`'s section also seeds **a postcard of its own**, and the reason is a trap
worth knowing about: `rls_test.sql` is one long transaction and earlier sections
mutate the seed for real. The `011` cascade block deletes `postcards ...00e1`
outside any savepoint, to prove its comments, hides and reports go with it. The
pending suite these assertions came from ran *instead of* this file and so still
had that row; folded in, the comment, like and report assertions pointed at a
postcard that no longer existed and were refused by RLS — which reads exactly
like a policy bug and is not one. **If an assertion near the end of this file
fails on a fixture, check whether an earlier section deleted it before you go
looking at a policy.**

## Writing assertions

`assert_eq(actual, expected, label)`, `assert_denied(sql, label)`,
`assert_rejected(sql, sqlstate, label)` and `assert_allowed(sql, label)` all raise
on failure, and `psql -v ON_ERROR_STOP=1` turns that into a non-zero exit.
`assert_allowed` unwinds its own write, so it leaves nothing behind for later
assertions.

`assert_denied` recognises `42501`, `insufficient_privilege`. Constraints and
trigger guards refuse with `23514` / `23505`, so those use `assert_rejected`,
which names the expected SQLSTATE — "rejected by the charset check" and
"rejected as a duplicate" are different claims and a test that accepted any
error would blur them.

**`42501` is two different refusals wearing one SQLSTATE**, and since `025` this
suite asserts both: a *policy* refusing a row, and a *grant* refusing a column.
They fire at different times — the grant is checked when the statement is
planned, against the columns named in `SELECT`/`SET`, which is before any RLS
predicate and long before a `BEFORE` trigger. That ordering is why the stamp
assertions changed helper rather than changing expectation: the same statement
that used to reach `003`'s guard and come back `23514` now never gets that far.
When you write a `42501` assertion, say in its label which of the two you mean —
"refused before the trigger ever runs" and "no row matched the policy" are
different claims about different code.

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
