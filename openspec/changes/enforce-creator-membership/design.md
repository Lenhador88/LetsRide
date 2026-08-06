# Design — creator membership as a database invariant

## Context

Everything in this table was read from the migration chain, the policy set and `src/` on
2026-08-06. Nothing here is quoted from `CLAUDE.md` or `docs/HANDOFF.md`, both of which describe
this defect and one of which describes the fix in a shape this document rejects.

| Fact | Value | How to re-derive |
|---|---|---|
| `clubs` SELECT policy | `is_public or owner_id = auth.uid() or private.is_club_member(id)` | `008:42`, unchanged since |
| `club_members` SELECT policy | club visibility **and** `user_id = auth.uid() or not is_blocked(...)` | `009:423` |
| `club_members` INSERT policy | `auth.uid() = user_id` + club public-or-owned + `role` rule | `019:59` |
| `club_members` DELETE policy | `auth.uid() = user_id` — **no owner exception** | `008:89` |
| `club_members` UPDATE policy | **none exists**, deliberately (`019` Q10) | `019:47` |
| `private.is_club_member` | membership only — **no owner arm** | `005:8` |
| `ride_members` DELETE policy | `auth.uid() = user_id` — **no organizer exception** | `008:138` |
| `ride_members` UPDATE policy | exists, own row only | `008:134` |
| `enforce_participation_gate` | 8 tables, `when (current_user = 'authenticated')` | `023` §3 |
| `clubs` UPDATE policy | `using` **and** `with check` both `auth.uid() = owner_id` | `008:54` |
| Next free migration number | **029** — `028` landed 2026-08-06 | `ls supabase/migrations/` |
| Orphan clubs / rides on the live project | **0 / 0**, measured 2026-08-06 with RLS bypassed, on 2 clubs and 3 rides — see proposal §Impact | task 0.1 (answered) |

Five facts shape everything below.

1. **PostgREST has no multi-statement transaction.** Any create that needs two rows needs either
   two round trips or one statement that fans out. There is no third option, and shrinking the
   window between two round trips is not closing it.
2. **`clubs` UPDATE carries `with check (auth.uid() = owner_id)`**, so a rider cannot transfer a
   club to anyone — not even accidentally. Ownership is immutable for `authenticated` today, which
   is why the seeding trigger fires on INSERT only and needs no UPDATE arm. `add-account-deletion`
   proposes to change that, from a privileged path; §D5 states the contract between the two.
3. **`private.is_club_member` has no owner arm.** So an orphan club's owner is a non-member for
   every purpose the schema recognises: `017` refuses them a ride in it, `009` refuses them a
   postcard to it, and for a private club `009`'s roster policy hides even the empty roster.
4. **Inside a `security definer` function `current_user` is the owner**, measured on Postgres 16 by
   `021` §3 and relied on by `023` §2. That single fact decides whether `023`'s gate fires on a
   trigger-issued insert and whether `019`'s role rule applies to it. It is the reason §D2 exists.
5. **A blocked rider does not see the owner's roster row** (`009`'s `club_members` predicate). So
   the invariant can never be asserted from a query result — see §D7, which is the trap most likely
   to produce a test that passes while enforcing nothing.

## Goals / Non-Goals

**Goals**

- The state "a club with an owner who is not a member" and "a ride whose organizer is not on its
  crew" have **no representation** — not "are unlikely", not "are cleaned up afterwards".
- The rule binds every writer: the browser, the seed, a migration, `service_role`, and the Edge
  Function `add-account-deletion` will add.
- Both create actions become one round trip, with no compensating logic in application code.
- Existing orphans are repaired, and the repair is distinguishable from `023`'s no-backfill ruling
  by a reason rather than by taste.

**Non-Goals**

- Ownership transfer, an admin role, invitations, or a club-delete / ride-cancel screen.
- Any change to a SELECT policy. The visibility layer is where this project's bugs come from and
  this change deliberately does not enter it.
- Reopening decision #1 (no anonymous access), #2 (blocking in RLS) or #8 (Supabase is the backend).
- Enforcing `max_riders`, which `database-enforced-integrity` already records as deliberately
  unenforced.

## Decisions

### D1 — A trigger, not an RPC, and this contradicts the comments both call sites carry

`createClub` and `createRide` have both said, since they were written, that *"the real fix is a
`security definer` function doing both in one statement"*. `docs/HANDOFF.md` repeats it. The
`security definer` half is right; *function the client calls* is wrong, for three reasons.

- **An RPC binds only its callers.** The publishable key ships in the bundle and PostgREST accepts
  any rider's JWT, so `insert into clubs` stays reachable whether or not an RPC exists. The orphan
  would be one hand-rolled request away forever, and the invariant would be a convention again —
  which is the exact critique `019`'s header makes of `joinClub` relying on a column default.
- **An RPC is a new surface with a new argument list.** `create_club(name, description, is_public,
  avatar_path, cover_image_path)` restates five columns, two CHECK shapes (`016`'s path
  constraints) and the `018` bounds in a signature that has to be kept in step with the table
  forever. A trigger reads `NEW` and restates nothing.
- **An RPC executable by `authenticated` adds a security-advisor finding.** Six exist and every one
  is argued for; a seventh that buys nothing a trigger does not is a bad trade. A trigger function
  revoked from `public, anon, authenticated` adds none — which is why `enforce_participation_gate`
  is `security definer` and absent from `CLAUDE.md`'s advisor table.

So: `after insert on public.clubs for each row`, inserting `(new.id, new.owner_id, 'owner')`, and
`after insert on public.rides for each row`, inserting `(new.id, new.organizer_id, 'going')`.

**`AFTER`, not `BEFORE`** — the parent row must exist for the FK. **Not a deferred constraint
trigger**: PostgREST runs each request in its own transaction, so deferring to commit buys nothing
and costs a shape nobody here has used.

**One thing to measure before writing it, not to recall.** An AFTER ROW trigger fires after a
`CommandCounterIncrement`, so the just-inserted `clubs` row should be visible to any subquery the
trigger issues. This change depends on that being true and `021` §3's four measurements are the
house style: reproduce it on a scratch database before the migration is written, and record the
observation in the migration header. If it is false, the trigger still works — it takes its values
from `NEW` and never queries `clubs` — but `019`'s policy subquery would not, which is one more
argument for §D2.

### D2 — `security definer`, and for a reason that is not privilege

The trigger function is `security definer`, `set search_path = ''`, and `revoke all … from public,
anon, authenticated`. The justification, stated the way `022` §2 states its own:

- **Determinism across roles.** An invoker-rights trigger inherits RLS. For the ordinary path
  (`authenticated` creating their own club) `019`'s WITH CHECK happens to pass — `auth.uid() =
  user_id`, the club is owned by the caller, `role = 'owner'` with the owner arm satisfied. For the
  seed, a migration or `service_role` the check is skipped by table ownership. So an invoker-rights
  version is correct for two different reasons in two different cases and its correctness depends
  on a policy subquery seeing an uncommitted sibling row. `security definer` makes it one reason.
- **It takes no caller input.** `new.id` and `new.owner_id` come from a row the caller was already
  authorized to insert by the `clubs` INSERT policy (`auth.uid() = owner_id`). There is no
  argument, so there is no id to substitute — the negative case "called with someone else's id"
  is **unrepresentable**, not merely refused. That is `021` §3's standard and this meets it.
- **It is narrower than `moderate_comment`**, which `011` §1b argues for at length and the advisors
  already accept: this writes one row, in one table, derived entirely from a row that was just
  written, and nobody can call it at all.

**The consequence that must be asserted rather than assumed:** inside the function `current_user`
is the owner, so `023`'s `enforce_participation_gate` on `club_members` and `ride_members` **does
not fire** for the seeded row (its trigger `WHEN` clause is `current_user = 'authenticated'`, and
that is evaluated in the function's context). This is correct — the gate already fired on the
`clubs` / `rides` insert, and an un-onboarded rider never reaches the trigger — but it is invisible
in a positive test, which is exactly `023` §2's own warning. Two assertions: an un-onboarded rider
cannot create a club at all, and no `club_members` row exists for them afterwards.

The same fact means `019`'s role rule does not apply to the trigger's insert. That is why §D4
removes its owner arm rather than leaving a policy branch nothing exercises.

### D3 — The invariant has two halves, and the second one is the one the brief was not about

Seeding closes the create window. It does nothing about the *other* door:

```
leaveClub(clubId)                    -> delete from club_members where user_id = auth.uid()
setRideAttendance(rideId, null)      -> delete from ride_members  where user_id = auth.uid()
```

`ClubMembershipButton` renders behind `{!isOwner && …}` and `RideAttendanceBar` behind
`canRsvp = … && !is_organizer`. Both are **UI guards**, and `CLAUDE.md` is unambiguous that a UI
guard is not the enforcement — the actions are plain async functions in the browser and the DELETE
policies are `auth.uid() = user_id` with no exception. So an owner can leave their own club today
in one call, reaching the identical end state with no tab-close and no lost signal.

A `BEFORE DELETE` guard on each table closes it. Three rules it needs, and the third is the one
that breaks the naive version:

1. **Refuse** when `old.user_id` is the club's `owner_id` / the ride's `organizer_id`.
2. **Escape hatch for non-`authenticated` roles** — `when (current_user = 'authenticated')` on the
   trigger, `023`'s shape rather than `022`'s. This is a rule about what the *client* may do, not
   an invariant about what the table may contain, because `add-account-deletion`'s privileged
   transfer must be able to delete the departing owner's row. Copying `022`'s no-escape shape here
   would make that feature unimplementable without a `disable trigger`.
3. **Allow when the parent is already gone.** Deleting a club cascades to `club_members`; the RI
   action fires after the parent row is deleted, so `select 1 from public.clubs where id =
   old.club_id` finds nothing and the guard returns `old`. Without this rule, **an owner cannot
   delete their own club** — a policy that exists and is tested. This is the third measurement for
   the scratch database, alongside D1's.

**All four functions — the two seeding and the two guarding — SHALL be `security definer`, and
for rule 3 that is a correctness requirement rather than a convention.** Under invoker rights
the probe in rule 3 runs beneath the caller's RLS, so *"the club row is invisible to me"* and
*"the club row does not exist"* return the same empty result — and the guard's response to the
second is to **permit the delete**. That is a guard that fails **open**, which is precisely the
hazard D7 spends a section on for assertions and must not then leave to chance in the guard
itself. No exploit is reachable today (every rider who can delete a `club_members` row is that
row's own `user_id` and can therefore see the club through `009`'s roster predicate), but the
property must hold by construction rather than by a coincidence of the current policy set.
`security definer` makes the probe answer the existence question it is actually asking.

`check_violation` (`23514`) for the refusal, not `insufficient_privilege`, for `023` §2's reason:
`42501` is indistinguishable from an ordinary RLS denial and an assertion that accepted "any error"
would pass when the wrong rule fired.

**Rides: presence, not status.** `ride_members` has an UPDATE policy, so the organizer may still
move themselves between `going` and `maybe`. The invariant is that the row *exists*. That is what
makes `toRideListItem` ("the organizer leads the avatar row whether or not they hold a
`ride_members` row") and `getRideCrew` (which reads only `ride_members`) agree by construction
rather than by two copies of a rule.

### D4 — `019`'s owner arm becomes dead, and dead policy branches get removed

After the trigger, nothing in the application inserts `role = 'owner'`. `019`'s arm —
`role = 'owner' and exists (select 1 from clubs c where c.id = … and c.owner_id = auth.uid())` —
is then the only way `authenticated` can claim a non-`member` role by any route, and it claims one
that already exists, so every use of it is a `23505`. Removing it leaves `authenticated` able to
insert `role = 'member'` and nothing else, which is strictly narrower than `019` and closes the
last self-assignable non-member role.

**It goes in `030`, not `029`, and the split is `021`'s lesson rather than tidiness.** Between step
2 and step 3 of the sequencing the deployed code still sends `role: 'owner'` on its idempotent
upsert. Whether PostgREST evaluates a WITH CHECK for a row that `on conflict do nothing` discards
is a Postgres detail nobody here has measured, and betting an outage on it is precisely the habit
`021`'s header exists to break. Two files, each safe at a moment that actually arrives.

### D5 — Backfill: yes, and the contrast with `023` is the argument

`023` refused to backfill `terms_accepted_at` because a fabricated consent record is worse than a
missing one — evidence a party can write is not evidence. That reasoning does not transfer, and
saying why matters, because a reader who pattern-matches on "023 said no backfill" will get this
wrong:

- A consent stamp records **an act by a person** at a time. Nothing in the database can derive it.
- An owner-membership row records **a relationship already stored** in `clubs.owner_id`. The
  backfill derives it from a column the same rider wrote, and writes exactly the row `createClub`
  intended to write and was interrupted before writing. It fabricates nothing.

So: insert the missing row for every club and every ride, and **fix the wrong-role case too** — a
club whose owner joined their own club through Explore holds `role = 'member'`, and since
`club_members` has no UPDATE policy that rider can never be repaired by any client action. The
backfill is the only thing that can, and it must be an UPDATE, not an insert that finds a conflict.

`joined_at` comes from `clubs.created_at` / `rides.created_at`, not `now()`. `now()` would make
every repaired owner the *newest* member of their own club, which skews
`add-account-deletion`'s "longest-tenured remaining member" transfer heuristic for exactly the
clubs most likely to need it.

The backfill runs **before** the delete guards are created in the same file, so a pre-existing
orphan cannot make the guard's first evaluation inconsistent, and **after** the seeding triggers,
which do not fire on existing rows.

### D6 — Sequencing, and the outage the obvious order causes

```
1. deploy  actions: second insert becomes `upsert(..., { ignoreDuplicates: true })`
2. apply   029  seeding triggers + backfill + delete guards
3. deploy  actions: second insert and both compensating deletes removed
4. apply   030  019's owner arm removed
```

**Apply `029` first and every club and ride creation breaks.** The deployed client still issues a
plain `.insert()` into `club_members` for a row the trigger has already written → `23505` → the
action's own rollback deletes the club it just created → *"That club could not be created."* on
every attempt. `main` auto-deploys, there is one Supabase project, and this is an instant outage of
two features — the same shape `021`'s header dissects and `024`'s footer records surviving.

Step 1 is safe against both databases: against today's, `upsert … ignoreDuplicates` on
`(club_id, user_id)` behaves identically to the insert; against `029`'s, it finds the trigger's row
and does nothing. It is the shape `joinClub` already uses. The reason usually given for it —
"there is no UPDATE grant on `club_members`" — is **wrong**, and `019`'s §Verification block
says so: `authenticated` does hold the table-level UPDATE grant, and promotion is blocked by the
missing UPDATE *policy*, which filters to zero rows rather than raising. `ignoreDuplicates` is
still correct, for the better reason that an on-conflict-update would silently affect nothing.

Steps 1 and 3 can be one PR each or three commits on one branch; what cannot move is that `029`
lands between them.

### D7 — The invariant is a property of the table, never of a query result

The obvious assertion is wrong and would pass:

```sql
-- WRONG. Reads 0 for a rider the owner has blocked, on a perfectly healthy club.
select count(*) from club_members where club_id = :c and role = 'owner';
```

`009`'s `club_members` SELECT policy drops rows for blocked riders in both directions. So a club
whose only member is its owner shows `members_count = 0` to a rider the owner has blocked — which
is *indistinguishable from an orphan* through any client. `getClub`'s `members_count:club_members(count)`
embed runs under RLS, so the same is true on the About screen.

Two consequences:

- Every assertion about the invariant runs **with RLS off, or as the owner**. In `supabase/tests/`
  that means `reset role` or `set role postgres` around the check, not the ambient
  `set role authenticated`.
- No screen may ever be built to *detect* an orphan from a count. There is nothing to detect after
  this change, and a count that could is a block-visibility leak.

The pre-flight in the proposal carries the same rule, which is why it says "with RLS off": run as
`authenticated` and it undercounts by exactly the rows the runner is blocked from.

### D8 — Contract with `add-account-deletion`

Both changes touch club ownership and they are compatible if two things hold, stated here so
neither has to rediscover them:

- The delete guard's `current_user = 'authenticated'` escape (D3, rule 2) is what lets the
  privileged transfer function delete the departing owner's `club_members` row. It must not be
  copied to `022`'s no-escape shape.
- The transfer must **reassign `clubs.owner_id` before** the `profiles` cascade removes the old
  owner's `club_members` row, and must insert the new owner's row with `role = 'owner'` itself —
  the seeding trigger fires on INSERT of a club, not on transfer of one. `add-account-deletion`
  task 1.6 already reassigns; this adds the membership half to its assertion list, and its
  "longest-tenured remaining member" heuristic is why D5 pins `joined_at`.

Neither change blocks the other. This one is smaller and should land first.

## Risks / Trade-offs

- **A trigger is invisible at the call site.** A future reader of `createClub` sees one insert and
  no membership row and may "fix" it by adding the second insert back. Mitigation: the comment that
  currently describes the two-insert problem is rewritten to name the trigger and the migration,
  and `030` removes the policy arm that would let a re-added insert succeed — so the mistake fails
  loudly rather than silently duplicating.
- **The delete guard removes a capability nobody asked to remove.** An owner who genuinely wants
  out of their own club now has no route. Today they have a route that silently breaks the club, so
  this is a strictly better failure — but it is a product decision and it is Q1.
- **Backfilling re-adds an owner who deliberately left.** Only reachable by hand-rolled request
  today; the invariant declares that state illegal, so re-adding is consistent. Q7 offers the
  alternative.
- **Two migrations instead of one.** Deliberate, per D4/D6. The cost is one extra apply step; the
  alternative is betting on `on conflict do nothing`'s interaction with a WITH CHECK.

## Open Questions

Each carries a recommended default so the build is never blocked on an answer, and names who can
give it.

**Blocking**

- **Q1 — product owner. May a club owner leave their own club?**
  Default: **no**. The delete guard refuses, and the alternative (leaving is permitted and triggers
  a transfer) is `add-account-deletion`'s design, not this one. Blocking because it decides whether
  `029` contains a delete guard at all — the half of this change that closes the door the original
  defect report did not mention.
- **Q2 — product owner. May a ride organizer take themselves off their own crew?**
  Default: **no**, with `maybe` as the way to express uncertainty. `RideAttendanceBar` already
  hides the control from them, so the default costs nothing today. Blocking for the same reason as
  Q1.
- ~~**Q3 — the live orphan pre-flight.**~~ **ANSWERED 2026-08-06: 0 orphan clubs, 0 orphan
  rides, on 2 clubs and 3 rides, RLS bypassed.** The agent drafting this design could not run it
  (no credential, MCP tools absent from its toolset); the parent session ran it the same day.
  The recommended default stands unchanged — **write the backfill anyway** — because a backfill
  over zero rows is a no-op costing one statement, while a missing backfill over a count that is
  non-zero *at apply time* leaves a private club nobody can reach. Re-run at apply time; a zero
  today is not a zero then. **No longer blocking.**

**Non-blocking**

- **Q4 — product owner. `joined_at` on backfilled rows: the parent's `created_at`, or `now()`?**
  Default: **`created_at`**, per D5. Only observable through `add-account-deletion`'s transfer
  heuristic and a roster's join order.
- **Q5 — product owner. Remove `019`'s `role = 'owner'` INSERT arm (`030`)?**
  Default: **yes**, after step 3. Declining leaves one self-assignable non-member role that nothing
  uses; it is not a leak, because the arm requires the caller to already own the club.
- **Q6 — designer. Copy for the owner-leave refusal.**
  Default: *"You own this club, so you cannot leave it."* No frame draws it, because no frame draws
  the control for an owner. One string; the flow is otherwise unchanged.
- **Q7 — product owner. Backfill an owner who left deliberately?**
  Default: **yes** — the invariant declares the state illegal and the row is derived, not
  fabricated. Q3's counts decide whether this is hypothetical.
- **Q8 — product owner. Does an orphan *private* club found by the pre-flight get backfilled or
  deleted?**
  Default: **backfilled**. It is unreachable today, so its owner cannot consent to either; creating
  the missing row restores a club, deleting it destroys one, and only the first is reversible.
