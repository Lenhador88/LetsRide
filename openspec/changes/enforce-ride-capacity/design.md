# Design — enforcing `max_riders`

## Context

See `proposal.md` §Why for the motivation and the four settled decisions. What this file adds is
the mechanism, and it exists because **every one of the four wrong implementations is silent**:
the racing count admits an extra rider under load, the unprivileged count admits one per block,
the naive predicate freezes a full ride's existing crew, and the column-scoped trigger looks
tighter than it is while doing nothing.

Everything below was exercised against the **full applied migration chain** on Postgres 16
(`supabase/tests/harness.sql` plus all 62 files, on a scratch database, 2026-08-18) rather than
reasoned about. Where a paragraph says *measured*, it means that.

The state that shapes the design:

| Fact | Where it comes from |
|---|---|
| `ride_members` is keyed `(ride_id, user_id)`, `status in ('going','maybe')`, FK to `rides` `on delete cascade` | `001` |
| Its SELECT policy carries `private.is_blocked`, so the roster is per-viewer | `009` |
| Its UPDATE policy is `auth.uid() = user_id` with **no** `EXISTS` against `rides` — which is covered anyway, because Postgres applies the SELECT policy to an UPDATE's new row (measured; `proposal.md`) | `008` |
| `authenticated` holds INSERT and UPDATE on `(ride_id, user_id, status)` — `ride_id` deliberately, for the upsert | `048` |
| Two triggers already: `enforce_participation_gate` (BEFORE INSERT, `when current_user = 'authenticated'`), `notify_ride_joined` (AFTER INSERT) | `023`, `055`/`060` |
| `rides.max_riders` is `int null`, bounded 1..999 | `001`, `018` |

## Goals / Non-Goals

**Goals**

- One mechanism that binds every path a `ride_members` row can arrive by, including PostgREST's
  upsert and a bare `update … set ride_id = …`.
- A refusal the client can tell apart from `018`'s, `023`'s and row security's.
- Concurrent joins for the last seat serialised, without serialising anything else.

**Non-Goals**

- Restating the visibility conjunct on the `ride_members` UPDATE policy. Measured as already
  covered by the SELECT policy — see `proposal.md`; a second copy of an enforced rule is a defect
  in itself.
- Any change to `rides`: no CHECK, no trigger, no new column. Lowering the cap is unconstrained by
  decision 3.
- Any UI. The design draws no capacity affordance; verified against the snapshot.

## Decisions

### D1 — A BEFORE trigger, not a policy `WITH CHECK`

A `WITH CHECK` conjunct calling a privileged counter is the obvious alternative and it loses on
four counts:

1. **It raises `42501`**, which `023` already rejected for this exact class of rule: it is
   indistinguishable from an ordinary row-security denial, so the client cannot tell "full" from
   "gone" and an assertion accepting it passes when the wrong rule fired.
2. **It would need writing twice**, into the INSERT policy and the UPDATE policy, because the
   UPDATE path is a real bypass (`048` grants `ride_id`).
3. **It cannot take a lock.** Serialising the last seat needs a row lock on the parent (D5), and a
   policy predicate is not the place to acquire one.
4. **`023` set the precedent** on this table for exactly this kind of rule, and a second mechanism
   for a neighbouring rule is how one of them goes stale.

### D2 — `before insert or update`, with the seat test inside the function

**Not `before insert or update of ride_id`.** `update of <col>` fires whenever the column appears
in the SET list, and PostgREST's `ON CONFLICT DO UPDATE` SET list carries `ride_id` on **every**
RSVP — that is precisely why `048` had to grant UPDATE on it. So the column-scoped form fires on
exactly the same set of statements as the unscoped one while reading as though it were narrower.
The intent belongs in the body:

```
if tg_op = 'UPDATE' and new.ride_id is not distinct from old.ride_id then
  return new;   -- no new seat: a status change, or the upsert's own rewrite
end if;
```

### D3 — The gated event is a **new seat**, defined as a `(ride_id, user_id)` pair that did not exist

Two readings were on the table and the difference is not cosmetic.

**The reading adopted:** a write is gated only if no row already exists for
`(new.ride_id, new.user_id)`. On an INSERT that is an `exists` probe; on an UPDATE it is D2's
`ride_id` comparison.

**The reading rejected:** count the crew excluding the writer's own row and refuse at
`count >= max_riders`. It is correct for a plain join, correct for a repeat RSVP on a ride at
exactly its cap — and **wrong on an over-subscribed ride**, which decision 3 makes an ordinary
state rather than an exotic one. Measured, cap lowered from 20 to 2 with 3 crew rows:

```
others (excluding the writer) = 2   cap = 2   would_refuse = t
```

So an organizer who lowers the cap freezes the RSVP of every rider already on the ride — the
`ride-capacity` requirement *An existing crew member's RSVP change is never refused for capacity*
exists to fail that implementation. The adopted reading admits it, measured on the same state.

### D4 — Why the upsert makes this subtle at all

`setRideAttendance` writes through `.upsert(..., { onConflict: 'ride_id,user_id' })`. A
`BEFORE INSERT` trigger **fires on an upsert even when the statement resolves to an UPDATE** —
the INSERT path is attempted first, so the BEFORE INSERT trigger runs, and only then does the
conflict resolve and the BEFORE UPDATE trigger run. A reader who assumes BEFORE INSERT means "a
genuine insert" writes the freezing bug in D3 without ever seeing a join fail.

This is why the seat test is an `exists` probe on INSERT rather than an assumption that no row is
there.

### D5 — Serialising the last seat: `for no key update` on the parent `rides` row

A count in a trigger is not by itself serialised: two concurrent transactions each see
`crew = cap − 1` and both commit. The fix is to take a row lock on the **parent** before counting,
so the second transaction waits and then counts the first one's row:

```
select r.max_riders into cap from public.rides r where r.id = new.ride_id for no key update;
```

- **`for no key update`, not `for update`.** `FOR UPDATE` conflicts with `FOR KEY SHARE`, which is
  the lock every foreign-key check takes on `rides` — so a join would block, and be blocked by,
  every insert into `ride_messages`, `ride_map_render_attempts` and `postcards` on the same ride.
  `FOR NO KEY UPDATE` conflicts with itself, which is all the serialisation this needs.
- **Ordering is safe.** The BEFORE trigger takes the parent lock *before* the FK's own
  `FOR KEY SHARE` on the same row, which is taken as an after-statement constraint check in the
  same transaction — so there is no upgrade race between the two, and a reviewer should not
  "fix" the order.
- **It does conflict with an organizer's ride edit**, which also takes `FOR NO KEY UPDATE` on the
  row. Both transactions are single-statement and short; a join and a rename briefly serialise.
  Accepted, and stated so it is not read later as a deadlock.
- **Rejected: `pg_advisory_xact_lock(hashtext(ride_id::text))`.** It avoids touching `rides` at
  all, and it is opaque, collides across unrelated rides at 64 bits of hash, and cannot be seen in
  `pg_locks` by anyone debugging a wait.
- **Rejected: `serializable` isolation.** Not ours to choose — PostgREST decides the isolation
  level for the rider's transaction.

### D6 — The trigger runs before row security, and the one bit that leaks

Measured, on a table with a `with check (false)` policy and a raising `BEFORE INSERT` trigger,
inserting as `authenticated`:

```
ERR sqlstate=23514 msg=BEFORE TRIGGER RAN FIRST
```

So the capacity refusal reaches riders the `ride_members` INSERT policy was about to refuse: a
rider who has left the private club owning a ride, or who is blocked by its organizer, learns
*full* rather than *denied*, for a ride whose UUID they must already hold. One bit, about a ride
they could once see, not enumerable (ids are UUIDs and the read is refused).

**Two ways to close it, both rejected for now:**

- **Make it an `AFTER` constraint trigger.** Fires after the `WITH CHECK`, so row security refuses
  first and nothing leaks. It works — the parent lock still serialises, the test becomes
  `count(*) > cap` because the row is already in — but it puts the capacity rule on a different
  timing from the participation gate beside it, for one bit.
- **Defer inside the trigger when the writer cannot read the ride** — `private.can_read_ride`
  (`060`) exists and is textually pinned to the `rides` SELECT policy. Rejected because it fails
  in the wrong direction: if the restatement ever drifts *permissive-to-restrictive*, the capacity
  check is skipped and the write proceeds — and on the UPDATE path, where the policy has no
  `EXISTS`, that means an uncapped join into a ride the rider cannot see. A guard whose drift mode
  is "the cap stops applying" is worse than the bit it hides. It also makes this change depend on
  `060`, which is on DEV and not yet on PROD.

Recorded as **Q1** below rather than silently settled: the owner may prefer the `AFTER` variant,
and the swap is contained to the migration.

### D7 — `private.enforce_ride_capacity()`, `security definer`, no client EXECUTE

- **`security definer`** is the requirement, not the style: `009`'s block predicate on the
  `ride_members` SELECT policy makes an invoker count short by the writer's blocks. Measured 4
  versus 3 on the same ride with one block in place.
- **In `private`**, following `private.notify_ride_joined` (`060`) rather than `023`'s
  `public.enforce_participation_gate` — PostgREST publishes `public` and does not publish
  `private`, so the schema does the revoking. `revoke all … from public, anon, authenticated`
  anyway, per `005`'s rule, which is also what keeps the security-advisor count where it is.
- **`set search_path = ''`** and fully-qualified names throughout, like every definer function in
  this chain.

### D8 — Trigger name `enforce_ride_capacity`, and the ordering is load-bearing

Postgres fires same-timing triggers in **name order**. `enforce_participation_gate` sorts before
`enforce_ride_capacity`, so an un-onboarded rider joining a full ride is told about onboarding,
not about capacity. Measured on the applied chain with a NULL-stamped profile:

```
refused by: 23514 / complete onboarding and accept the terms before writing to ride_members
```

Both raise `23514`, which is why the client matches on **code and message** (D9) and why a name
sorting the other way would silently change which message a rider sees.

### D9 — The refusal contract: `23514` plus the literal message `this ride is full`

`018`'s CHECKs and `023`'s gate both raise `23514` on this table, so the code alone is not an
identity. `createRide` already matches code-plus-message for `022`'s `private club cannot be
public`; this is the same shape, and the message is therefore **part of the contract** and
asserted in the suite. A named CHECK constraint would have produced `violates check constraint
"…"` instead, which is why this is a `raise` rather than a constraint.

The client branch:

```ts
if (error?.code === '23514' && error.message.includes('this ride is full')) {
  return { error: 'This ride is full.' }
}
```

### D10 — No `when (current_user = 'authenticated')` clause

`023`'s gate carries one because `private.may_participate()` reads `auth.uid()`, which the table
owner does not have. The capacity count is role-independent, so the clause would only decide
*who* the rule applies to — and the answer should be everybody:

- A future privileged writer (an Edge Function with `service_role`, or
  `enforce-creator-membership`'s proposed atomic ride creation, which runs `security definer` and
  therefore as the owner) would silently bypass a role-scoped rule. The organizer exemption is
  what keeps that path working, and it works because it is a rule rather than an ordering
  accident.
- **The cost is real and belongs in the fixtures:** seeds and test fixtures inserting as the owner
  are gated too, so an over-subscribed ride can no longer be *created* directly — it has to be
  built at or under the cap and then have the cap lowered, which is decision 3's own path.
  Verified harmless today: `supabase/tests/seed.sql` sets no `max_riders` at all, and
  `supabase/seeds/development.sql`'s tightest ride is 12 against 3 crew rows.

Recorded as **Q2**: a `when` clause is one line to add later if a privileged writer ever needs the
exemption, and impossible to remove quietly once fixtures depend on it.

### D11 — The organizer exemption is a rule, not an ordering accident

`createRide` inserts the ride and then the organizer's crew row, so at `max_riders = 1` the count
is 0 and the row lands without any exemption. The exemption exists anyway because:

- The ordering is scheduled to change (`enforce-creator-membership`).
- A ride whose organizer holds no crew row is reachable today — the rollback in `createRide` runs
  in the browser and a closed tab leaves the ride behind — and without the exemption that
  organizer can never rejoin their own full ride.
- There is a race, small and real: a public ride capped at 1 is visible the instant it is
  inserted, so another rider can take the only seat before the organizer's own row lands. With the
  exemption the organizer's row still lands and the ride holds two rows against a cap of one,
  which decision 2 makes legal. Without it, `createRide` rolls the whole ride back and the
  organizer is told the ride could not be created — for a ride somebody else joined.

The exemption is `new.user_id = rides.organizer_id`, which admits at most one extra row, and only
the organizer's own: every other row a rider could write for somebody else is already refused by
`auth.uid() = user_id`.

## Risks / Trade-offs

- **A trigger on a shipped write path takes the rider's write down with it if it raises.** →
  `036`'s gate: hand-exercise a join, a re-RSVP, a leave and a ride creation on DEV inside a
  rolled-back transaction before applying (`tasks.md` §3). The function must not raise for any
  reason other than capacity — in particular a missing `rides` row is impossible (FK), and a NULL
  cap must return early before any count.
- **The parent lock serialises joins with ride edits.** → Both are single-statement transactions;
  `for no key update` rather than `for update` keeps every other child insert out of it.
- **One bit of disclosure to riders who cannot see the ride.** → D6, stated in the spec, with two
  closures costed. **Q1.**
- **The fixtures can no longer create an over-subscribed ride directly.** → D10; build it under
  the cap and lower the cap, which is what a rider's organizer does anyway.
- **Four docstrings in `src/` state as fact that capacity is unenforced.** → Listed individually
  in `tasks.md` §5. A stale comment asserting a rule does not exist is how the next session
  re-derives the gap.
- **The standing spec's capacity scenario is carried forward by two other in-flight changes.** →
  The delta's coordination banner and `tasks.md` §6. This is the one risk that outlives the
  change: whichever sibling archives last reinstates a spec that contradicts the schema.

## Migration Plan

1. Write `063_ride_capacity_is_enforced.sql` — one function, one trigger, nothing else.
   Re-derive the number from `ls supabase/migrations/` against `list_migrations`.
2. Run the RLS suite locally with the new assertions (`PGPASSWORD=postgres npm test`).
3. Hand-exercise the four write paths on DEV inside a rolled-back transaction (§3 of `tasks.md`).
4. Apply to DEV, check `get_advisors(security)` is unchanged, walk an RSVP through the app.
5. Promote to PROD in filename order with the rest of the gap, per `docs/ENVIRONMENTS.md`.

**Rollback is one statement** and leaves nothing behind:

```sql
drop trigger if exists enforce_ride_capacity on public.ride_members;
drop function if exists private.enforce_ride_capacity();
```

No data is rewritten by this change, so a rollback restores the previous behaviour exactly —
including any ride that became over-subscribed while it was off.

## Open Questions

**Q1 — Close the one-bit disclosure now, or accept it?** (D6.) *Recommended default: accept it.* Blocking: **no** — the swap is contained to the migration
and changes no requirement except the disclosure scenario. Answerable by: the product owner.

**Q2 — Should the trigger carry `when (current_user = 'authenticated')`?** (D10.) *Recommended
default: no — the rule applies to every writer.* Blocking: **no**. Answerable by: whoever writes
the migration, in consultation with the owner if a privileged writer is planned.

**Q3 — Does `max_riders` include the organizer?** Under decision 1 it does: the count is over
rows and the organizer holds one, so `max_riders = 5` means the organizer plus four. *Recommended
default: yes, as specified — the organizer is riding too.* Blocking: **no**, but it is the one
question a rider would notice, because the field's label is `Maximum riders` and nothing on the
form says whether the organizer is one of them. Answerable by: the product owner alone.

**Q4 — Should a rider whose join is refused see the cap ("This ride is full — 8 riders")?**
*Recommended default: no.* A number is a disclosure the spec currently forbids, and the design
draws no capacity string at all. Blocking: **no**. Answerable by: the designer and the product
owner, as part of the follow-up that draws a capacity affordance.
