# Enforce ride capacity — a join gate in the database, not a count in the client

> Linear **PD-174**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*

## Why

**`rides.max_riders` has existed since `001` and nothing has ever counted against it.** `018`
bounds what can be *stored* — `max_riders is null or between 1 and 999` — and says so in its own
header: *"This bounds what can be stored, and nothing else."* No CHECK, no trigger and no policy
limits `ride_members` by it. Verified against the whole applied chain on a scratch database
2026-08-18; re-derive rather than trusting this paragraph:

```sql
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.ride_members'::regclass and not tgisinternal order by tgname;
-- enforce_participation_gate (023, BEFORE INSERT), notify_ride_joined (055/060, AFTER INSERT)
```

So an organizer types a number, the form validates it, the database stores it, and it means
nothing. Three consequences, all live today:

- **A ride can be over-subscribed without limit.** Twenty riders can join a ride capped at six.
- **The column reads as a promise in four places** — `CreateRideForm`, `EditRideForm`,
  `rideSchema`, and the ride's own row — and is kept in none.
- **`RIDE_CREW_LIMIT = 200` exists because of it.** `src/lib/data/rides.ts` caps the crew read at
  200 rows *"not because a motorcycle ride has 200 riders"* but because roster size is unbounded
  by construction.

**Why it needs a proposal rather than a ticket:** the obvious implementation is wrong in three
independent ways, and each failure is silent.

> **The check must be in the database, the count must run privileged, and the write it gates is a
> *new seat* rather than a row.**

- **A check-then-insert in `setRideAttendance` races.** Two riders reading `crew = cap - 1` in
  the same instant both write. This is the defect the issue names, and it is not fixable in the
  client: `CLAUDE.md` — *"No new integrity rule may live only in a Zod schema"* — and the client
  owns the mutation path, so a rule a rider can decline is not a rule.
- **A count taken under the joining rider's own RLS reads short by exactly the number of blocks.**
  `009` put `private.is_blocked` on the `ride_members` SELECT policy itself. Measured on the
  applied chain, one block in place, same ride: **4 rows as the table owner, 3 as the joining
  rider.** A `security invoker` count therefore admits one extra rider per block, silently.
- **PostgREST's upsert makes a repeat RSVP look exactly like a join.** `048` had to grant UPDATE
  on `ride_id` because `ON CONFLICT DO UPDATE`'s SET list carries every payload column, and a
  BEFORE INSERT trigger fires on an upsert that resolves to an UPDATE. A naive
  `count(*) >= max_riders` therefore **freezes every existing crew member's RSVP on a full ride** —
  a worse bug than the one being fixed. Measured; see `design.md` §D4.

## What Changes

### One trigger, on `ride_members`, `BEFORE INSERT OR UPDATE`

`private.enforce_ride_capacity()`, `security definer`, fired by a trigger named
`enforce_ride_capacity` on `public.ride_members`. It refuses a write that would take a **new
seat** on a ride whose crew already fills its cap.

**Four decisions, settled by the product owner before this proposal was written.** Each is
restated with its reasoning because the reasoning is what a later reader needs; none is reopened
here.

1. **The cap counts every `ride_members` row for the ride — `going` and `maybe` alike.**
   *"On this ride"* already means exactly *"holds a `ride_members` row of either status"*
   everywhere else in the schema: `private.is_ride_crew` (`034`), the ride-chat audience,
   `036`/`060`'s fan-out, and `isRideCrew` in `src/lib/data/rides.ts`. A `going`-only cap would
   put a second definition of *on this ride* in one schema, and would let a rider surrender their
   seat by switching to `Maybe` with no way back.
2. **It is a JOIN GATE, not an invariant over the row set.** The rule is *"you may not take a new
   seat on a ride whose crew already fills its cap"*, never *"crew size ≤ `max_riders` at all
   times"*. **An over-subscribed ride is a legal state**, and this changes what the assertions
   look like: nothing anywhere asserts `count(*) <= max_riders`.
3. **Lowering the cap below the current crew size is allowed and evicts nobody.** Existing rows
   stand; no further riders join until the crew drops below the cap. Refusing the organizer's edit
   was the alternative and is rejected: an organizer who realises 20 is too many must be able to
   stop further joins, and silently evicting riders is far worse than a temporarily
   over-subscribed ride.
4. **`max_riders IS NULL` means no cap** — unchanged, and the state every existing ride is in.

### The refusal is a contract, because the client matches on it

`errcode = 'check_violation'` (**23514**) with the message **`this ride is full`**. Both halves
are part of the contract:

- **23514 rather than 42501**, for `023`'s reason — *"42501 is indistinguishable from an ordinary
  RLS denial"*, so an assertion accepting it would pass when the wrong rule fired.
- **Matched on code *and* message**, because `018`'s CHECKs and `023`'s gate raise the same
  SQLSTATE on the same statement. This is the pattern `createRide` already uses for `022`'s
  `private club cannot be public` branch, and it is the reason the message text is specified here
  rather than left to the migration author.

### `setRideAttendance` gains one branch and no UI

```ts
if (error?.code === '23514' && error.message.includes('this ride is full')) {
  return { error: 'This ride is full.' }
}
```

`RideAttendanceBar` already renders an action error in an unconditional `role="status"` region and
already rolls its optimistic pill back on failure, so **no component changes**. It also
invalidates on this refusal, which it does not do for any other — a capacity refusal is proof the
cached crew is stale.

**The design draws no capacity affordance at all**, and that is stated rather than assumed:
`npm run figma -- text "Rides / View ride / Ride - Ride plan (Details)" --all` and the same for
`Ride - Crew (Riders)` contain no seats-remaining count, no "Ride is full" state, and no disabled
`Yes!`. The Crew screen draws `Going (7)` and `May be going (3)` and nothing else. **A rider
learns a ride is full by trying to join it.** That gap is honest and is the follow-up, not this
change — and any future affordance needs a *privileged* count, because the roster the client
already embeds is filtered per-viewer and would disagree with the cap by the number of blocks.

### What is deliberately not built

| Out of scope | Why |
|---|---|
| Any "Ride is full" UI, seats-remaining count, or disabled RSVP control | Undesigned. Needs a count no screen currently reads, and a per-viewer count would be wrong — see above |
| A waitlist | No table, no design, no product decision. A refused join leaves no trace at all |
| A `ride_full` notification to the organizer | A notification for a non-event, and it would tell an organizer that a *specific* rider tried and failed to join |
| Fixing the `ride_members` UPDATE policy's missing `EXISTS` | A pre-existing hole this change *found*; owner is triaging it separately. See below |
| Capping `club_members` | Clubs have no capacity column and no design that draws one |
| Backfilling or repairing existing over-subscribed rides | Decision 2 makes them legal. Nothing is rewritten |

### A pre-existing hole this change found, does not fix, and files

**The `ride_members` UPDATE policy has no `EXISTS` against `rides`, while the INSERT policy does.**
Measured, not read off a file:

```
UPDATE  "Users can update their own ride status"  using (auth.uid() = user_id)
                                                  with check (auth.uid() = user_id)
INSERT  "Users can join visible rides"            with check (auth.uid() = user_id
                                                    and exists (select 1 from rides r where …))
```

`048` grants `authenticated` UPDATE on `(ride_id, user_id, status)`, so a rider can
`update ride_members set ride_id = <another ride>` and move their seat onto a ride they **cannot
see** — a private club's ride they were never in. That is a visibility hole, it predates this
change, and it is the owner's to triage.

**This change does bind that statement for capacity** — the trigger fires on an UPDATE that
changes `ride_id`, so a seat cannot be moved into a full ride (measured: `23514 / this ride is
full`). Without that, the cap would be one statement away from being bypassed. Fixing the
visibility half is explicitly not attempted here.

## Capabilities

### New Capabilities

- **`ride-capacity`** — the rider-facing contract: what "full" means and what it counts, which
  writes take a seat and which do not, every role's reach (organizer, crew member, club member,
  non-member, blocked rider, signed-out visitor), the seven screen states, the refusal contract,
  concurrency, what frees a seat, and the surfaces this change deliberately does not build.
  Split from `ride-lifecycle` (in flight, `add-ride-club-edit-delete`) on purpose: that capability
  is about *the organizer editing or deleting the ride*, and this one is about *another rider
  being refused a seat*. They meet at exactly one point — lowering the cap — which is stated in
  both directions here and in neither there.

### Modified Capabilities

- **`database-enforced-integrity`** — one requirement **MODIFIED** and two **ADDED**.
  - **MODIFIED: `Storage object ownership SHALL remain database-enforced`.** Not for anything to
    do with Storage: the standing spec files the scenario *"Unenforced capacity is recorded, not
    silently assumed"* under it, and that scenario says *"nothing SHALL claim it is enforced: no
    policy, trigger or constraint limits `ride_members` by it"*. This change makes that false, so
    the scenario is **superseded and removed**, and the requirement is otherwise restated
    verbatim. **Two other active changes claim this same requirement and both carry that scenario
    forward — see the coordination banner in the delta. Whichever archives after this one
    reinstates a spec asserting the cap is not enforced.**
  - **ADDED: `A gate that counts rows the caller cannot see SHALL count them through a privileged
    path`.** Measured at 4-vs-3 above, and it generalises past capacity to every future
    count-and-refuse rule on a table carrying a block predicate.
  - **ADDED: `A BEFORE trigger's refusal SHALL be treated as reachable by callers the policy would
    have refused`.** Measured on Postgres 16 (`design.md` §D6): a BEFORE INSERT trigger runs
    **before** the RLS `WITH CHECK`, so anything it discloses is disclosed to riders RLS was going
    to refuse. `023` has this shape already and leaks nothing by it; this change is the first that
    does, and the disclosure is one bit, stated and accepted.

### Read and NOT modified — a claim, not an omission

- **`ride-chat`** — read in full, unchanged. Its audience *is* the crew this change counts, so a
  refused join is also a chat that never opens; no requirement moves.
- **`event-fanout-integrity`** — unchanged. `notify_ride_joined` is `AFTER INSERT`, so a refused
  join notifies nobody, by construction rather than by a new rule.
- **`client-render-shell`** and **`client-cache-invalidation`** — the RSVP refusal is bound by
  requirements both files already carry (*Permission-denied and empty SHALL be told apart where
  the rider can act on the difference*, *Stale data SHALL be bounded and visible*), each already
  claimed by `add-account-deletion`. A second claimant buys a merge conflict and no clarity, so
  the state and invalidation rules live inside `ride-capacity` instead.

> **Collision check — one collision, and it is on the MODIFIED requirement.** Re-derive rather
> than trust it: `grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive`.
> Measured 2026-08-18: `Storage object ownership SHALL remain database-enforced` is claimed by
> `add-account-deletion` **and** `add-ride-map-tiles`, both of which already carry their own
> two-way coordination banners — this change makes it three. Neither ADDED requirement above has
> any claimant. No in-flight change touches `ride-capacity`, which is new.

## Impact

**Database.** One migration, **`063_ride_capacity_is_enforced.sql`** — `062` is the highest file
and no in-flight proposal claims `063` (`grep -rhno "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/`).
Re-derive the number from `ls supabase/migrations/` against `list_migrations` at write time;
`CLAUDE.md` warns this exact claim has been wrong in both directions.

**It hangs a trigger off an already-shipped write path, so it carries `036`'s gate.** From the
moment it applies, every RSVP, every join and every ride creation runs new code inside the
rider's own transaction, and **a trigger that raises takes that rider's write down with it**.
`tasks.md` §3 is the hand-exercise step on DEV inside a rolled-back transaction, and it is a gate
rather than a courtesy.

**Nothing else in the schema changes.** No column, no policy, no grant, no index — the count is
served by `ride_members_pkey`, whose leading column is `ride_id`.

**Advisors: expect no new one.** The function lives in `private` and holds no EXECUTE for a
client role, which is how `023`'s gate and `060`'s fan-out avoid the
`authenticated_security_definer_function_executable` family. Re-derive with `get_advisors(security)`
after applying; a new WARN means the function landed in `public` or the revoke did not.

**Code.** One branch in `setRideAttendance` and one comment removal — its docstring currently
states as fact that *"`max_riders` is not enforced, here or anywhere"*. Three more docstrings say
the same and become wrong on apply: `src/lib/validation/rides.ts`, `src/lib/data/rides.ts`
(twice — `RIDE_CREW_LIMIT` and `getRideCrew`) and `src/lib/data/profile.ts`. They are listed
individually in `tasks.md` because a stale comment claiming a rule does not exist is worse than
no comment.

**`src/types/index.ts` needs no change.** `max_riders` is already on all three ride row types and
"full" is derived rather than stored — nothing in this spec adds a field to a type.

**No new runtime dependency.** Nine before, nine after —
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `supabase/tests/rls_test.sql` gains a section; `openspec/config.yaml` requires it and
`tasks.md` §4 names all nine assertions individually rather than as "update the suite". One of
them — the blocked-pair count — must be written as a **refusal under `set role authenticated`
with a block in place**, because the suite runs as the table owner elsewhere and an owner-role
count cannot tell a definer from an invoker. That is `031`'s lesson applied to a count instead of
a grant.
