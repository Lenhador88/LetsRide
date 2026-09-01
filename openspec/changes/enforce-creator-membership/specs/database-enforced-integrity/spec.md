# database-enforced-integrity (delta)

> **⚠ COORDINATION — THREE active changes modify `Club membership role SHALL NOT be
> self-assignable`, and OpenSpec will not warn you.** The others are `add-account-deletion` and
> **`manage-club-riders`** (`088`, PD-326), which was written after this banner and is not
> optional to reconcile: it is the change that made `admin` writable at all. Archiving folds a
> delta into `openspec/specs/database-enforced-integrity/spec.md` by replacing the requirement
> wholesale, so **whichever change archives last silently discards the other two's edits**.
>
> **A fourth change deliberately stayed out of this.** `an-owner-leaves-their-club` (`095`,
> PD-194) writes `role = 'owner'` through its transfer and states its rule as its own **ADDED**
> requirement rather than as a fourth competing replacement of this one — its `design.md` §D8
> carries the reasoning and the one sentence it would have added, for whoever reconciles the
> three. Do not "tidy" it into a MODIFIED.
>
> They are reconcilable in substance, and this is the merged text all three should converge on:
>
> - `authenticated` may insert `role = 'member'` only.
> - The **owner row is written by the database** at club creation (`enforce-creator-membership`'s
>   `AFTER INSERT` trigger), not by the client — so the old scenario "the creator's own owner row
>   is still permitted" describes a write that no longer happens.
> - The **privileged ownership transfer** may set `role = 'owner'` on the rider it is
>   simultaneously making `clubs.owner_id`. It bypasses RLS, so the narrowing above does not
>   bind it. There are now **two** such transfers and both claim the same latitude:
>   `add-account-deletion`'s cascade (`security definer`, `private` schema, no `authenticated`
>   EXECUTE) and `an-owner-leaves-their-club`'s `public.leave_owned_club` (`security definer`,
>   published to `authenticated` but taking a club and no rider id).
> - **`admin` is writable, and only through an RPC that takes no role argument.**
>   `manage-club-riders` shipped `public.promote_club_member` and `public.demote_club_admin`
>   (`088`), each writing a literal role. `authenticated` still cannot write `owner` or `admin`
>   by any verb on any table, which is the property all three changes preserve by different
>   means.
>
> Before archiving whichever of the three goes after the first: re-read
> `openspec/specs/database-enforced-integrity/spec.md` as the previous one left it, and rewrite this
> delta against *that* text rather than against the version you drafted.

## ADDED Requirements

### Requirement: A club SHALL always hold an owner-membership row

For every row in `public.clubs` there SHALL exist a row in `public.club_members` with the same
`club_id`, `user_id = clubs.owner_id` and `role = 'owner'`. The rule SHALL be enforced by the
database, and the state in which it does not hold SHALL have no representation reachable by any
writer.

**This is a live defect, not a risk the change introduces.** `createClub` issues two inserts with
no transaction because PostgREST has no multi-statement transaction. Until 2026-08-06 both inserts
and a compensating delete ran inside one server request; they run in the browser now, so closing
the tab between them leaves the club without its membership row. Nothing anywhere — no CHECK, no
trigger, no constraint — currently asserts that this cannot be.

The state is not cosmetic. `private.is_club_member` has no owner arm, so an orphan club's owner is
a non-member for every purpose the schema recognises: `017` refuses them a ride in their own club,
`009` refuses them a postcard to it, `getYourClubs` omits it and `getExploreClubs` shows a public
one back to them with a `Join club` button that records them as `role = 'member'` — permanently,
because `club_members` has no UPDATE policy.

#### Scenario: Creating a club establishes the owner's membership in the same statement
- **WHEN** any signed-in rider inserts a row into `clubs`, by any route including a hand-rolled
  PostgREST request
- **THEN** the matching `club_members` row with `role = 'owner'` SHALL exist when the statement
  returns
- **AND** the client SHALL NOT be required to issue a second write for the invariant to hold

#### Scenario: A failed membership write takes the club with it
- **WHEN** the membership write raises for any reason — the participation gate, a constraint, a
  deadlock
- **THEN** the `clubs` row SHALL NOT exist afterwards, because both are one statement
- **AND** no compensating delete in application code SHALL be relied on for this

#### Scenario: The owner cannot leave their own club
- **WHEN** the rider named in `clubs.owner_id` deletes their own `club_members` row, whether
  through `leaveClub` or directly against PostgREST
- **THEN** the database SHALL reject the delete with a check violation
- **AND** the refusal SHALL NOT depend on the UI hiding the control, which is what holds this
  today
- **AND** there SHALL be exactly two exceptions, both of them elevated paths rather than client
  writes: the **voluntary-leave transfer**, which reassigns `clubs.owner_id` in the same statement,
  and the **club's own deletion**, whose cascade the guard permits because the parent row is
  already gone

> **The enforcement of this scenario ships in `095`, not here — `an-owner-leaves-their-club`
> (PD-194) carries the club-side `BEFORE DELETE` guard and the two exceptions above, and this
> change keeps the two seeding triggers, the backfill and the ride-side guard.** `design.md` §D3
> records why the split is safe in both orders and why neither change blocks the other; that
> change's §D8 records why it is a split rather than a supersession. The requirement stated here is
> unchanged and is still this change's to state — what moved is which migration enforces it.

#### Scenario: Deleting the club still works
- **WHEN** the owner deletes the club itself
- **THEN** the cascade to `club_members` SHALL succeed, because the guard SHALL permit a delete
  whose parent `clubs` row no longer exists
- **AND** the `clubs` DELETE policy SHALL be unchanged

#### Scenario: A privileged transfer is still possible
- **WHEN** a role other than `authenticated` reassigns `clubs.owner_id` and deletes the departing
  owner's membership row
- **THEN** the delete SHALL succeed, because the guard binds `authenticated` only
- **AND** this SHALL remain true so that account deletion can transfer a club rather than cascade
  it, destroying other riders' postcards — and so that a voluntary owner-leave, should one be
  built (PD-194), needs no change to this rule

#### Scenario: Existing orphans are repaired rather than left
- **WHEN** the rule is applied to a database that already contains clubs with no owner-membership
  row, or whose owner holds a row with the wrong `role`
- **THEN** the missing rows SHALL be inserted and the wrong roles SHALL be corrected
- **AND** `joined_at` SHALL be taken from `clubs.created_at` rather than the migration's clock, so
  that a tenure-ordered read of the roster is not reordered by the repair
- **AND** this SHALL NOT be read as reversing the no-backfill ruling on consent: an owner-membership
  row is derived from `clubs.owner_id`, which is already stored, whereas a consent timestamp
  records an act only the rider can perform

### Requirement: A ride's organizer SHALL hold a crew row

For every row in `public.rides` there SHALL exist a row in `public.ride_members` with the same
`ride_id` and `user_id = rides.organizer_id`. The invariant is the row's **presence**; its `status`
MAY be `going` or `maybe`.

`createRide` has the same two-insert shape and the same window as `createClub`. The consequence is
different and more visible: `toRideListItem` draws the organizer "on the ride by construction"
whether or not the row exists, while `getRideCrew` reads `ride_members` alone — so the ride card
and `/rides/detail/crew` disagree about the same ride, and `RideAttendanceBar` is hidden from the
organizer, leaving them no route back onto their own crew.

#### Scenario: Creating a ride puts the organizer on the crew
- **WHEN** any signed-in rider inserts a row into `rides`, by any route
- **THEN** the matching `ride_members` row with `status = 'going'` SHALL exist when the statement
  returns

#### Scenario: The organizer cannot leave their own crew
- **WHEN** the rider named in `rides.organizer_id` deletes their own `ride_members` row, including
  through `setRideAttendance(rideId, null)`
- **THEN** the database SHALL reject the delete with a check violation

#### Scenario: The organizer may still say maybe
- **WHEN** the organizer updates their own `ride_members.status` to `maybe`
- **THEN** the write SHALL succeed, because the invariant is presence rather than status
- **AND** the existing `ride_members` UPDATE policy SHALL be unchanged

#### Scenario: Deleting the ride still works
- **WHEN** the organizer deletes the ride
- **THEN** the cascade to `ride_members` SHALL succeed, by the same parent-is-gone rule the club
  guard uses

#### Scenario: The two read paths agree by construction
- **WHEN** any rider who can see a ride reads its card and its crew roster
- **THEN** the organizer SHALL appear in both
- **AND** no read function SHALL synthesise an organizer row it did not read, so that the rule
  lives in one place

### Requirement: Creator membership SHALL be established without a callable elevated function

The mechanism that establishes creator membership SHALL take no caller-supplied argument, SHALL
NOT be executable by `authenticated`, `anon` or `public`, and SHALL derive every value it writes
from the row being inserted.

An RPC would bind only the callers that choose it, leaving `insert into clubs` reachable with the
publishable key that already ships in the bundle; it would restate five columns and their
constraints in a signature that must be kept in step with the table; and an elevated function
`authenticated` can execute adds a security-advisor finding for nothing a trigger does not give.

#### Scenario: There is no id to pass, so someone else's id cannot be passed
- **WHEN** any rider attempts to cause an owner-membership row for a rider other than themselves
- **THEN** there SHALL be no interface that accepts a rider id
- **AND** the values written SHALL come from `NEW.owner_id` / `NEW.organizer_id` on a row the
  `clubs` / `rides` INSERT policy already restricted to `auth.uid()`

#### Scenario: Nobody can call it directly
- **WHEN** `authenticated` or `anon` attempts to execute the function that performs the write
- **THEN** execution SHALL be refused, and the function SHALL NOT be published by PostgREST

#### Scenario: It adds no executable elevated surface
- **WHEN** the security advisors are read after the migration applies
- **THEN** no new `authenticated_security_definer_function_executable` finding SHALL appear
- **AND** the known findings SHALL be unchanged in number and identity

#### Scenario: The participation gate is enforced once, not twice
- **WHEN** a rider whose `onboarding_completed_at` or `terms_accepted_at` is NULL attempts to
  create a club or a ride
- **THEN** the write SHALL be refused on the `clubs` / `rides` insert by `023`'s gate
- **AND** no `club_members` or `ride_members` row SHALL exist for them afterwards
- **AND** the gate not firing a second time inside the elevated function SHALL be asserted rather
  than assumed, because a definer function runs as its owner and the gate's `WHEN` clause is
  evaluated in that context

### Requirement: The creator-membership invariant SHALL be asserted against the table, never against a query result

Any check that the invariant holds SHALL run with row-level security bypassed, or as the club's own
owner. No screen, read function or test SHALL infer the invariant from a count returned under
another rider's session.

`club_members` SELECT carries a block predicate in both directions. A club whose only member is its
owner therefore returns `members_count = 0` to a rider the owner has blocked — which is byte-for-byte
what an orphan looks like from the client. The same is true of `getClub`'s
`members_count:club_members(count)` embed, which runs under RLS.

#### Scenario: A blocked rider sees a healthy club as memberless
- **WHEN** rider A owns a club whose only member is A, A blocks B, and B reads that club's roster
  and member count
- **THEN** B SHALL see zero rows and a count of zero, unchanged from today
- **AND** this SHALL NOT be treated as a violation of the invariant, nor surfaced to B as an error
  state

#### Scenario: The assertion runs with the policy out of the way
- **WHEN** the RLS suite asserts that no club lacks its owner-membership row
- **THEN** the assertion SHALL run with RLS bypassed rather than under the ambient
  `authenticated` role
- **AND** an assertion written under `authenticated` SHALL be treated as a defect, because it
  passes on a database full of orphans owned by riders the runner is blocked from

#### Scenario: No orphan-detection affordance is built
- **WHEN** any screen is tempted to warn a rider that a club looks memberless
- **THEN** it SHALL NOT, because a count that can distinguish "orphan" from "blocked" is a
  block-visibility leak

### Requirement: Every role's access to a creator-membership row SHALL be stated

Every role that can reach a creator-membership row SHALL have its access stated, and the row SHALL
inherit the existing `club_members` / `ride_members` SELECT policies unchanged.

It is an ordinary roster row. Stated role by role so each line maps onto an assertion, and so the
absence of a change to the visibility layer is a checked claim rather than an assumption.

#### Scenario: Owner
- **WHEN** a club's owner reads their own membership row
- **THEN** it SHALL be returned, unconditionally, by the `user_id = auth.uid()` arm

#### Scenario: Admin
- **WHEN** a rider holding `role = 'admin'` in the club reads the owner's row
- **THEN** it SHALL be returned if the club is visible to them, and they SHALL NOT be able to
  delete it, because `club_members` DELETE is `auth.uid() = user_id` and carries no admin arm
- **AND** no `admin` row exists on this database today, since nothing writes the value and there is
  no UPDATE policy — the rule is stated so it is not invented later

#### Scenario: Member
- **WHEN** a member of the club reads the roster
- **THEN** the owner's row SHALL be returned, and the member SHALL NOT be able to delete it

#### Scenario: Non-member
- **WHEN** a signed-in rider who is not a member reads the roster
- **THEN** the owner's row SHALL be returned for a public club and zero rows for a private one,
  unchanged from `008` and `009`
- **AND** they SHALL NOT be able to insert, alter or delete it

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the owner, in either direction, reads the roster
- **THEN** the owner's row SHALL NOT be returned, unchanged from `009`
- **AND** the club itself SHALL still be returned, because `clubs` deliberately carries no block
  predicate

**The six scenarios above are `club_members` only, and this change seeds `ride_members` too.**
The ride half is stated below rather than assumed to be symmetric, because it is not: the two
tables reach the same outcome by different mechanisms, and an implementer who generalises from
the club rules will write the wrong assertion.

Measured from `pg_policy` on 2026-08-06, `ride_members` SELECT is:

```
EXISTS (SELECT 1 FROM rides r WHERE r.id = ride_members.ride_id)
AND (user_id = auth.uid() OR NOT private.is_blocked(auth.uid(), user_id))
```

So **two** block predicates bear on the organizer's own crew row: its own, on the roster
member (`user_id`, which for this row *is* the organizer), and the transitive one inside
`rides` SELECT (`NOT private.is_blocked(auth.uid(), organizer_id)`). Either alone would hide it.
That redundancy is the current state, not a requirement — the assertions below must pin the
outcome, so that removing one predicate later fails a test rather than passing silently.

#### Scenario: Organizer — their own crew row
- **WHEN** the rider named in `rides.organizer_id` reads `ride_members` for their own ride
- **THEN** their `going` row SHALL be returned, on a public ride and on a private-club ride alike
- **AND** they SHALL NOT be able to delete it, by the `BEFORE DELETE` guard this change adds
- **AND** they SHALL still be able to change its `status` to `maybe`, because the invariant is
  presence on the crew, not a particular status

#### Scenario: Club admin and club member — a private club's ride
- **WHEN** a rider holding `role = 'admin'` or `role = 'member'` in the ride's club reads the roster
- **THEN** the organizer's crew row SHALL be returned, because `rides` SELECT admits them through
  `private.is_club_member(club_id)`
- **AND** neither SHALL be able to insert, alter or delete it

#### Scenario: Non-member — public ride versus private-club ride
- **WHEN** a signed-in rider who is not in the ride's club reads the roster
- **THEN** the organizer's crew row SHALL be returned for a public ride whose club is NULL or
  public, and **zero rows** for a ride whose `club_id` names a private club
- **AND** the refusal SHALL come from `rides` SELECT via the `EXISTS`, not from any predicate on
  `ride_members` itself — so a future change that widens `rides` widens this too, deliberately

#### Scenario: Blocked rider — both predicates, asserted separately
- **WHEN** a rider blocked by the organizer, in either direction, reads the roster
- **THEN** the organizer's crew row SHALL NOT be returned
- **AND** this SHALL be asserted **twice**: once proving `ride_members`' own
  `NOT private.is_blocked(auth.uid(), user_id)` arm hides it, and once proving the ride itself is
  invisible so the `EXISTS` hides it — because a single assertion cannot distinguish which
  predicate did the work, and a later edit could remove one while the test stays green

#### Scenario: No SELECT policy is edited
- **WHEN** this change is applied
- **THEN** the policy set for `clubs`, `club_members`, `rides` and `ride_members` SHALL differ from
  today by exactly one INSERT policy on `club_members` and nothing else

## MODIFIED Requirements

### Requirement: Club membership role SHALL NOT be self-assignable

**This is the merged text — see the coordination banner above.** The database SHALL refuse any
`club_members` row whose `role` is `owner` or `admin`, from `authenticated`, without exception.
The owner's row SHALL be written by the database itself when the club is created, and SHALL NOT
be writable by the client at all.

**One privileged exception exists and must survive whichever change archives second.**
`add-account-deletion` proposes an ownership transfer that promotes the rider it is
simultaneously making `clubs.owner_id`. It runs `security definer` in the `private` schema with
no `authenticated` EXECUTE, so it never writes as `authenticated` and the narrowing above does
not bind it. Stated here explicitly because this delta would otherwise fold into the standing
spec as an unconditional prohibition and silently delete that exception.

**What changed and why.** `019` admitted one exception: the rider named in `clubs.owner_id` could
insert their own `role = 'owner'` row, because `createClub` wrote it as a second round trip and
without that arm club creation stopped working. Creator membership is now established by the
database in the same statement as the club, so nothing in the application ever sends `role`
`'owner'` again and the arm's only remaining use would be to duplicate a row that already exists.
Removing it leaves `authenticated` able to insert `role = 'member'` and nothing else — strictly
narrower than `019`, and the last self-assignable non-member role closed.

The rest of `019` is unchanged and restated because a requirement is replaced whole: `club_members`
INSERT is still `auth.uid() = user_id` plus the club being public or owned by the caller, the
roster screen still renders the value, and there is still no UPDATE policy.

**Ordering is load-bearing.** The arm must be removed only after the deployed client has stopped
sending `role: 'owner'`. Removing it earlier makes every club creation fail against a client that
still sends it, and whether a `WITH CHECK` is evaluated for a row an `on conflict do nothing`
discards is unmeasured — so the removal is its own migration, applied after the code deploy, on the
pattern `021`'s split established.

#### Scenario: A non-member joining a public club cannot arrive as owner or admin
- **WHEN** a signed-in rider who is not a member inserts a `club_members` row for a public club
  with `role` set to `owner` or `admin`
- **THEN** the database SHALL reject the write

#### Scenario: Not even the club's own owner may insert an owner row
- **WHEN** the rider named in `clubs.owner_id` inserts a `club_members` row for their own club with
  `role = 'owner'`
- **THEN** the write SHALL be refused once the arm is removed
- **AND** this SHALL NOT break club creation, because the row already exists by the time any client
  statement could attempt it

#### Scenario: Nobody can promote an existing member
- **WHEN** any rider — including the club owner — attempts to UPDATE `club_members.role`
- **THEN** the write SHALL be refused, because no UPDATE policy on `club_members` exists
- **AND** this SHALL remain true until the invitations feature ships its own policy, so that the
  absence is a recorded gap rather than an accident

#### Scenario: A rider who demoted themselves through Explore is repaired
- **WHEN** a club owner holds a `club_members` row with `role = 'member'` for their own club,
  which is reachable today by tapping `Join club` on their own orphan club in Explore
- **THEN** the migration SHALL correct the role to `owner`
- **AND** it SHALL be an UPDATE, since an insert would find the existing row and do nothing
