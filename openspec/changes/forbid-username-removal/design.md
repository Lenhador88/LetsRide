# Design — a username cannot be removed once it is set

## Context

See `proposal.md` §Why for the defect and its measurements. What matters for the design is the
shape of the code that has to change, which is narrower than it looks.

`public.enforce_onboarding_completion()` is a **security invoker** trigger function
(`prosecdef = false`, measured) hung off `public.profiles` twice — `BEFORE INSERT FOR EACH ROW`
and `BEFORE UPDATE FOR EACH ROW`. Neither trigger is column-scoped: `pg_get_triggerdef` reports a
bare `BEFORE UPDATE ON public.profiles`, **not** `BEFORE UPDATE OF terms_accepted_at, …`. That is
load-bearing and was checked rather than assumed — a column-scoped trigger would never fire for a
username-only PATCH and the whole approach would be silently dead.

Its UPDATE path today, in order:

1. `if current_user <> 'authenticated' then return new; end if;` — the seed, the signup trigger,
   `service_role` and any dashboard repair pass straight through. `033`'s comment calls this "what
   keeps this fixable from the dashboard".
2. `if tg_op = 'INSERT' then … return new; end if;`
3. the `terms_accepted_at` arm — one-way if already set, server-timed on first acceptance.
4. `if old.onboarding_completed_at is not null then new.onboarding_completed_at := old…; return new; end if;`
5. the completion guard, for the not-yet-completed case.

**Step 4 is an early return, and it is why the defect exists.** For every rider the defect
actually harms — one who has finished onboarding — the function returns at step 4 having examined
`username` exactly never.

The three surrounding facts that constrain the options:

- `setUsername` (`src/lib/actions/onboarding.ts:37`) writes the column directly:
  `.from('profiles').update({ username: parsed.data }).eq('id', user.id)`. It is the only writer
  of `username` in `src/`, and it depends on the column grant `025` re-granted.
- `complete_onboarding()` and `accept_terms()` are `security definer`, so `current_user` inside
  them is the owner and step 1 short-circuits. `complete_onboarding` already restates `003`'s and
  `023`'s guards in its own body for precisely this reason, with the measurement recorded in its
  comments.
- `profiles` carries no DELETE policy, but `authenticated` holds a table-level DELETE **grant**.
  A rider's own `delete` therefore affects 0 rows — proved in the rolled-back probe — but the
  refusal rests on policy absence rather than grant absence.

## Goals / Non-Goals

**Goals:**

- Close the live hole with a change that has **no deployment ordering constraint** — appliable to
  DEV and PROD at any moment, before or after any code deploy, in either order.
- Keep the rule in **one place**, next to the rule it is a sibling of.
- Preserve the operator escape hatch, so this fix cannot become the reason a stranded rider is
  unrepairable.
- Leave the rename question (Q1) genuinely open, rather than deciding it by omission.

**Non-Goals:**

- Deciding whether renames are a product feature.
- Building any UI. There is no screen to change; `profileEditSchema` already excludes `username`.
- Hardening `profiles` generally. The DELETE grant is noted, asserted, and left.

## Decisions

### D1 — Guard inside the trigger (option 2), not a revoke (option 1) and not a CHECK (option 3)

**Chosen: option 2.**

```sql
if old.username is not null then
  new.username := coalesce(new.username, old.username);
end if;
```

inserted into the UPDATE path **above** step 4's early return.

**Why not option 1 — revoke the column grant, route writes through a `security definer`
`set_username()` RPC, as `025` did for the onboarding stamps.** This is the most
architecturally consistent option and it loses on three counts, the first of which is decisive:

1. **The revoke does not close the hole; it relocates the write.** An RPC declared
   `set_username(p_username text)` can be called with NULL like anything else. What actually
   forbids removal is a guard *inside* the new function — which is the same guard as option 2,
   reached by a longer road. Option 1 is therefore "option 2's rule, plus a channel change", and
   the channel change is where all of its cost lives.
2. **It is a two-phase deployment, and this repo has been burned by exactly that.** `setUsername`
   writes the column directly today, so the revoke must land **after** the replacement code
   deploys. `CLAUDE.md` §Supabase Rules records `021` being split for this reason and calls
   applying `025` early "an instant outage". Option 1 needs an additive `038` (create the RPC,
   grant EXECUTE), a Vercel deploy, then a destructive `039` (revoke UPDATE on the column) —
   with a window in between during which both paths are live. Against that, option 2 is one file
   with no window at all.
3. **It costs a rewrite of the one action that works, and an advisor.** `setUsername`'s `23505`
   and `23514` branches would have to survive the move through an RPC's error surface;
   `rls_test.sql:378` (`username is still writable — onboarding step 2 is an ordinary UPDATE`)
   inverts; and a seventh `authenticated_security_definer_function_executable` WARN appears in a
   table `CLAUDE.md` maintains precisely so an unexpected advisor is visible.

**"Most architecturally consistent" is not a trump card here, and this is the case that shows
why.** `025`'s revoke earned its complexity because the columns behind it needed *server-owned
logic* the client must never hold — a server-generated timestamp, a one-way stamp, a consent
version. `username` has no such logic today: the value is the rider's, the format is a CHECK, the
uniqueness is an index, and the only rule missing is "do not remove it". A revoke buys a channel
for logic that does not exist yet.

**The day it does exist, option 1 becomes right** — a rename flow with a conflict path, a rate
limit, a name-history row and a cache invalidation story is exactly the server-owned logic that
justifies an RPC. Recorded under §Follow-ups with a trigger rather than filed as a vague
improvement.

**Why not option 3 — a CHECK such as `onboarding_completed_at is null or username is not null`.**
It is the cheapest to read and it fails on the thing this repo values most, in two ways:

1. **A CHECK constrains every role, including the ones that have to be able to fix things.** The
   trigger's `current_user <> 'authenticated'` gate is deliberate and documented; a CHECK has no
   such gate and cannot be given one. An operator could no longer clear a username from the
   dashboard to free a name, `service_role` could not either, and any future
   anonymise-instead-of-delete variant of account deletion would be pre-refused by a constraint
   written for a different purpose. The proposal's own §Negative cases require the deletion path
   to stay intact; option 3 is the only one of the three that puts it at risk.
2. **It constrains state, so it can only express the weaker rule.** A CHECK cannot read `old`,
   so it cannot say "was set, is now NULL" — only "is complete and NULL". That leaves the
   mid-wizard rider (username chosen, step 2 not submitted) able to null their name, which is the
   route by which a taken name could be freed and re-taken. Option 2's `old.username is not null`
   covers it in the same clause.

It would also split "a username may not disappear" across a CHECK and a trigger, conditioned
differently — the two-places-one-rule drift this repo keeps recording as a root cause.

Its one genuine advantage: pre-flight is clean on both databases (0 violating rows, measured), so
it *would* add without a `NOT VALID` dance. That is a reason it is not disqualified, not a reason
it wins.

### D2 — Coerce, do not raise

`new.username := coalesce(new.username, old.username)` silently keeps the old value. The
alternative is `raise exception … using errcode = 'check_violation'`.

**Chosen: coerce**, for three reasons:

- **It matches the sibling rule two lines above.** `012` handles an attempt to withdraw consent by
  re-pinning `old.terms_accepted_at`, not by raising. A function whose two one-way rules behave
  differently is a function whose next reader has to check which is which.
- **Nothing legitimate sends NULL**, so nobody needs the error message. `setUsername` sends a
  Zod-parsed non-empty string; `updateProfile` does not name the column at all. The only sender of
  NULL is someone hand-composing a PATCH, and they are not reading our error strings.
- **Raising makes a multi-column write fail on a field it did not mean to change.** A future
  action that PATCHes several profile columns from a form model containing `username: null` would
  get a hard failure on an unrelated save. Coercion degrades to a no-op.

**The cost, stated because it is real:** the attacker's request returns 200 and looks like it
worked. That is acceptable here — a caller who checks the response sees the unchanged username,
and PostgREST with `return=representation` shows it — but it means **the assertions must check the
stored value, not an error code.** An assertion written as `assert_rejected(… '23514' …)` would
fail against a correct implementation, which is why Q2 is recorded in the proposal rather than
left to a reviewer's expectation.

### D3 — Key on `old.username`, not on `old.onboarding_completed_at`

`old.username is not null` is shorter, stronger, and independent of onboarding state. It closes
the mid-wizard case D1 notes option 3 cannot reach, and it keeps the requirement statable in five
words — *"once set, never unset"* — which is the form that survives being restated in a migration
header, a test label and a spec.

The alternative reading ("only once onboarded") is what the defect report literally asks for. It
is a strict subset. Nothing in the app clears a username at any point, so the stronger rule breaks
no caller, and the narrower one would leave a hole that needs its own change later.

### D4 — Placement above the early return, and the trap that makes it worth a decision

The guard must be inserted **after** the `current_user` gate and the `tg_op = 'INSERT'` branch,
and **before** `if old.onboarding_completed_at is not null then … return new`.

Placed after that early return it is dead code for every already-onboarded rider — which is the
entire population the change exists to protect — and it would still pass a suite that only tested
a mid-wizard fixture. This is the single most likely way to ship a green, useless fix, so the
task list requires an assertion using an **onboarded** fixture specifically.

### D5 — `CREATE OR REPLACE FUNCTION`, not new triggers

Both triggers already point at the function by name, so replacing the body is enough. Recreating
the triggers would churn `pg_trigger` for nothing and risks a window in which the table has no
BEFORE trigger at all. The migration touches no policy, grant, column or constraint — which is
what makes it inert with respect to everything else in the chain.

### D6 — The security definer gap is documented, not closed

A `security definer` function writing `username` would bypass this guard, because `current_user`
is the owner and step 1 returns early. No such function exists (`accept_terms`,
`complete_onboarding` and `my_onboarding_state` are the three that touch `profiles`; none writes
`username`), so there is nothing to close today.

Closing it speculatively would mean deleting the `current_user` gate, which would break the seed,
the signup trigger and the dashboard repair path — trading a hypothetical for three real
capabilities. The spec states the gap as a scenario instead, so the next author of a definer
function inherits it as a stated rule rather than as an assumption, exactly as
`complete_onboarding` inherited `003`'s.

## Risks / Trade-offs

- **The guard is placed below the early return and silently protects nobody** → the highest-value
  assertion in the task list uses an already-onboarded fixture, and the migration header names the
  ordering as load-bearing. D4.
- **A reviewer expects a `23514` and reads the assertions as wrong** → D2 states the contract as
  stored state; Q2 is on the record in the proposal.
- **A future `security definer` function nulls a username** → D6; stated as a spec scenario.
- **A future permissive DELETE policy on `profiles` reopens the same invisibility by another
  route** → asserted now (0 rows deleted by a rider's own `delete`), revoke proposed separately.
- **The rename question is answered by default rather than by decision** → Q1 is explicit that the
  default is "unchanged behaviour", that renames are unbuilt and unsurfaced, and that forbidding
  them later is one `if` in the same branch.
- **PROD's queue holds a deliberately-held-back `036`** → not a technical risk but a sequencing
  decision; Q3, owner's call, with a recommended default and the independence argument stated.

## Migration Plan

1. Write `supabase/migrations/038_username_is_not_removable.sql`. Header states: the defect and
   its reproduction, why the guard sits above the early return, why coerce rather than raise, that
   `service_role` and `postgres` deliberately pass through, and the PROD ordering deviation.
2. Add the assertions to `supabase/tests/rls_test.sql` and run
   `PGPASSWORD=postgres npm test` — the whole chain applies by filename, so `038` runs after
   `036` and `037` locally regardless of what any hosted project has.
3. **Re-run the pre-flight** (`select count(*) from profiles where onboarding_completed_at is not
   null and username is null`) against each database immediately before applying to it. It is 0 on
   both today; if it is not 0 at apply time, an operator sets a username on that row first. **The
   migration must not invent one** — same rule as `023` and consent.
4. Apply to DEV (`fpmrimzxadewsaiwpsel`). Verify: the probe that reproduced the defect now leaves
   the username unchanged; onboarding step 1 still works end to end; `complete_onboarding` still
   stamps.
5. Check security advisors on DEV. Expect **no new finding** — the change adds no
   `security definer` function and no policy. A new advisor means something other than this was
   applied.
6. PROD: **await Q3.** The recommended default is to apply `038` ahead of `036` and `037`, out of
   filename order, on the independence argument in `proposal.md` §Deployment ordering. Record the
   deviation in `docs/ENVIRONMENTS.md` so the next `db:drift` reading is not a surprise.

**Rollback** is `CREATE OR REPLACE` of the previous function body — recoverable from
`033_restore_function_comments.sql` and the current `pg_get_functiondef` output, which is captured
in this change's notes. No data is written, so nothing needs undoing beyond the body.

## Follow-ups

Each is filed rather than folded in, per `CLAUDE.md` §Working Principles.

**A) Revoke the unused `DELETE` grant on `public.profiles` from `authenticated`.**

> **Recommendation** 6/10 — a grant with no policy behind it is a hole waiting for someone to add
> the policy; the assertion this change adds detects it but does not prevent it
> **Complexity** 2/10 — one `revoke`, one assertion; nothing in `src/` deletes a profile row
> **Urgency** 2/10 — inert today (0 rows affected, measured); rises the moment anyone writes a
> DELETE policy on `profiles` for any reason
> **This session** N — unrelated to the username rule, and bundling a grant change into a trigger
> change makes both harder to review and to roll back

**B) Route username writes through a `set_username()` RPC and revoke the column grant.**

> **Recommendation** 4/10 now, 8/10 once a rename flow is on the roadmap — the channel is only
> worth its cost when there is server-owned logic to put in it
> **Complexity** 6/10 — two migrations with a deploy between them, a rewritten `setUsername`,
> a reworked error surface, an inverted assertion and a new advisor
> **Urgency** 1/10 — nothing forces it; the trigger holds the rule meanwhile. Trigger: the day a
> rename flow, a name-history table or a rename rate limit is specified
> **This session** N — two-phase by construction, so it cannot land in one PR safely

**C) Give the rider a repair path for the state this defect could already have produced.**

> **Recommendation** 3/10 — the population is provably empty on both databases today, so this
> builds a rollout for nobody
> **Complexity** 5/10 — the guard has to distinguish "never had a username" from "had one and
> lost it", which means reading a stamp the client cannot see
> **Urgency** 1/10 — rises only if the pre-flight ever returns a non-zero row
> **This session** N — speculative; the pre-flight in step 3 is what would justify it
