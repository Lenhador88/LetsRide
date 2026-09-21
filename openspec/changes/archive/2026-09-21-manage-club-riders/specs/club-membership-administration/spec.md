# club-membership-administration Specification

## Purpose
Who may change another rider's standing in a club, what each role may and may not do to each other
role, what a removed rider keeps and loses, and what any of it is observable as afterwards.

**Every requirement below is a statement about a role and a resource, so each maps onto an assertion
in `supabase/tests/rls_test.sql`.** The exceptions are named as such: the security-advisor sweep,
and any assertion about a grant or an EXECUTE privilege that must name a **role** rather than
attempt a statement, because the suite runs as the table owner for whom neither RLS nor the
`private` USAGE barrier exists (`031`'s lesson).

## ADDED Requirements

### Requirement: `club_members` SHALL carry no UPDATE policy, and role changes SHALL be made only by a `security definer` RPC

`public.club_members` SHALL continue to have exactly **three** policies — SELECT, INSERT and
DELETE — after this change. No UPDATE policy SHALL be added, and `authenticated` SHALL hold **no**
UPDATE grant on the table, at table level or per column.

`036` §7.6 rests on that absence for *"nobody can promote an admin"*, and `019` records it as a
decision rather than an omission. A promotion feature that satisfies itself by adding an UPDATE
policy hands every client a write path to `role` that no RPC gates, on a table where `admin` is the
capability being created. The RPC route is narrower by construction: one operation, one literal
value, one authority check in its own body.

`048`'s per-column UPDATE grant over `(club_id, user_id, role)` SHALL be **revoked with nothing
re-granted**. It is dead today only because no policy lets it fire; leaving it in place means the
next migration that adds an UPDATE policy for an unrelated reason silently hands clients `role`.

#### Scenario: The policy count does not move
- **WHEN** `pg_policies` is counted for `public.club_members`
- **THEN** it SHALL be **3**, and none of them SHALL have `cmd = 'UPDATE'`

#### Scenario: The grant is gone rather than narrowed
- **WHEN** `has_table_privilege('authenticated', 'public.club_members', 'update')` is asked
- **THEN** it SHALL be **false**
- **AND** `information_schema.column_privileges` scoped to `grantee = 'authenticated'` and
  `privilege_type = 'UPDATE'` SHALL return **zero** rows for this table
- **AND** the assertion SHALL name the grantee: a table-wide count reads nonzero against a correct
  database because `postgres` and `service_role` hold everything by Supabase default

#### Scenario: A client cannot promote itself by any route
- **WHEN** a member issues an UPDATE against their own `club_members` row setting `role = 'admin'`
- **THEN** it SHALL be refused, and the assertion SHALL cover **both** barriers — the absent grant
  and the absent policy — because either alone would let the other's removal pass unnoticed

### Requirement: Removal SHALL be a narrow RPC and the DELETE policy SHALL stay `auth.uid() = user_id`

`club_members` DELETE SHALL remain `auth.uid() = user_id` — you may leave, and no policy SHALL let
one rider delete another's row. Removal SHALL be `public.remove_club_member(target_club uuid, rider
uuid)`: `security definer`, `set search_path = ''`, `#variable_conflict error`, re-checking the
caller's authority in its own body because RLS does not apply inside it.

It SHALL have **exactly one raise site**, so "no such club", "not a member", "you are not an admin"
and "that target is above you" are one indistinguishable `insufficient_privilege` and a caller
learns nothing about a club or a roster they cannot reach.

It SHALL take a club id and a rider id rather than a row id, because `club_members` has no surrogate
key. `085`'s rule that an RPC takes the row's id and never a rider's does not transfer and SHALL NOT
be cargo-culted; the property it protects — that the caller cannot aim the operation at somebody
outside the row they hold — is preserved here by the single raise site instead.

#### Scenario: An owner removes an admin and a member
- **WHEN** the club's owner calls the RPC against an `admin` row and against a `member` row
- **THEN** both SHALL succeed and both `club_members` rows SHALL be gone

#### Scenario: An admin removes a member and only a member
- **WHEN** an admin calls the RPC against a `member` row
- **THEN** it SHALL succeed
- **WHEN** the same admin calls it against another `admin` row
- **THEN** it SHALL raise `insufficient_privilege` and the target row SHALL survive

#### Scenario: Nobody but the owner may reach the owner, including through `054`'s ownerless owner
- **WHEN** an admin calls the RPC against the club's `clubs.owner_id`
- **THEN** it SHALL raise, **whether or not** that rider holds a `club_members` row and **whatever
  role** that row carries
- **AND** the assertion SHALL use an **ownerless-owner** fixture — a `clubs.owner_id` with no
  roster row — because a predicate written only against `club_members.role` passes an ordinary
  fixture and fails this one

#### Scenario: Nobody removes themselves
- **WHEN** any caller passes their own id as `rider`
- **THEN** it SHALL raise, before any other check
- **AND** the reason SHALL be recorded: for the owner it would be a no-op wearing the clothes of an
  action, because every authority predicate in this schema reads `clubs.owner_id` and not the roster
  row; for anyone else, leaving already exists under the DELETE policy

#### Scenario: A member, a non-member and a signed-out visitor reach nothing
- **WHEN** an ordinary member, a rider in no club, or the `anon` role attempts any of the three RPCs
- **THEN** the first two SHALL raise `insufficient_privilege` and the third SHALL hold no EXECUTE
  privilege at all
- **AND** the `anon` half SHALL be asserted by naming the role through `has_function_privilege`,
  never by attempting the call

### Requirement: Promotion SHALL be open to admins, demotion SHALL be owner-only, and neither SHALL take a role argument

`public.promote_club_member(target_club uuid, rider uuid)` and
`public.demote_club_admin(target_club uuid, rider uuid)` SHALL each write a **literal** role value
and SHALL accept **no role parameter**. `019` made `admin` claimable by no client, and `085`
preserved that through a new write path by having *"no input by which to attempt it"*; the first
path that ever writes `admin` SHALL preserve it the same way.

`promote_club_member` SHALL be gated on `private.is_club_admin_for(auth.uid(), target_club)` — the
owner or an admin — which is PD-326's own title (*"an admin can remove a rider and promote one"*)
and the product owner's sentence behind it. Its target SHALL currently hold `role = 'member'`, so
promotion is never a way into a club and never a way to touch the owner's row.

`demote_club_admin` SHALL be gated on `clubs.owner_id = auth.uid()` **or** on the caller being the
target themselves, and on nothing weaker. Removal is a superset of demotion, so an admin able to
demote a peer could remove them in two steps and `remove_club_member`'s refusal would be decorative.

**The recorded counter-argument on promotion**: `private.transfer_owned_clubs` orders its successor
`case role when 'admin' then 0 when 'member' then 1 else 2 end, joined_at, user_id`, so an admin is
placed ahead of every longer-tenured member in the succession — a promotion is measurably the power
to inherit. Restricting promotion to the owner SHALL remain one conjunct (`v_uid <> v_owner`) plus
one assertion, and the decision SHALL be the product owner's.

#### Scenario: An admin may promote a member but may not demote an admin
- **WHEN** an admin calls `promote_club_member` against a `member` of their own club
- **THEN** the row's `role` SHALL become the literal `'admin'`
- **AND WHEN** that same admin calls `demote_club_admin` against any admin other than themselves
- **THEN** it SHALL raise `insufficient_privilege` and no `role` value SHALL change

#### Scenario: An admin may step down
- **WHEN** an admin calls `demote_club_admin` against themselves
- **THEN** the row's `role` SHALL become `'member'`, and the caller SHALL immediately be refused by
  every RPC an admin may call — the authority is read from the live row, never from the session

#### Scenario: The owner's own role is unreachable
- **WHEN** any caller, including the owner, targets the club's `clubs.owner_id` with either RPC
- **THEN** it SHALL raise, and `clubs.owner_id` SHALL be unchanged
- **AND** ownership transfer SHALL be out of scope and SHALL NOT be reachable as a side effect:
  `clubs` UPDATE is `auth.uid() = owner_id` in both USING and WITH CHECK, so no client writes a
  different owner, and `private.transfer_owned_clubs` remains the only writer that does

#### Scenario: `admin` is still claimable by no client
- **WHEN** any client role attempts to insert or update a `club_members` row with `role = 'admin'`
- **THEN** it SHALL be refused — by `019`'s INSERT WITH CHECK and by the absent UPDATE policy —
  and the assertion SHALL cover a public club, a private club and the caller's own club

#### Scenario: A demoted admin is a member and nothing else
- **WHEN** `demote_club_admin` succeeds
- **THEN** the row's `role` SHALL be the literal `'member'`, `joined_at` SHALL be unchanged, and no
  other column SHALL move

### Requirement: Removing a rider SHALL also remove any join request they hold for that club

`remove_club_member` SHALL delete any `public.club_join_requests` row for the same (club, rider) in
the same statement.

A request row can outlive the join it asked for: `085`'s lifecycle records that a club flipping
private → public lets a rider with a `pending` row join directly, leaving the row standing. Once
removal exists, that stale row is a way for a **different** admin to undo a removal by answering an
old question, and `private.join_club_from_request`'s `on conflict do nothing` makes the re-admission
look like an ordinary approval.

#### Scenario: A stale pending request cannot re-admit a removed rider
- **WHEN** a rider holds a `pending` request for a club they are a member of, and an admin removes
  them
- **THEN** the request row SHALL be gone, and a subsequent `approve_club_join_request` against its
  id SHALL raise
- **AND** `085`'s delete-arm retraction SHALL have fired, so no `club_join_requested` notification
  survives for that pair

#### Scenario: Removal writes no `declined` row and imposes no cooldown
- **WHEN** a removal completes
- **THEN** no `club_join_requests` row SHALL exist for that pair in any status
- **AND** the removed rider SHALL be able to rejoin a **public** club immediately through the
  existing INSERT policy, and to make a fresh request for a **private** one, refused by nothing

### Requirement: What a removed rider keeps SHALL be stated per resource, not summarised

Removal SHALL cascade nothing — **no foreign key references `club_members`** and none SHALL be
added. Everything that changes SHALL change because a policy stopped returning true, and each SHALL
be asserted rather than reasoned about.

| Resource | After removal |
|---|---|
| their postcards in the club | rows survive; the club still sees them; the author still **reads** and **deletes** them; the author may **no longer edit** them |
| their club threads and messages | survive, visible to the club, invisible to them |
| deleting their own club **message** | still possible — `delete_own_club_message` gates on authorship alone |
| deleting their own **thread** | no longer possible — the DELETE policy conjuncts membership |
| a ride they organised in the club | untouched, still in the club |
| a private-club ride they are only **crew** on | the `ride_members` row survives and the ride, its roster and its chat become unreadable to them |
| their `feed_reads` and `club_thread_reads` rows | survive, frozen — both write predicates conjunct membership |
| notifications naming the club | evicted from the list **and** the count together, for a private club |
| the admins' "X joined club" notification about them | **survives** — `036` §7.6 decided that a notification records an event at an instant |

#### Scenario: The author keeps their postcard and loses the ability to edit it
- **WHEN** a removed rider reads, deletes and attempts to edit their own postcard in the club
- **THEN** the read SHALL succeed through `postcards` SELECT's first arm, the delete SHALL succeed,
  and the edit SHALL be refused by the UPDATE policy's membership conjunct
- **AND** a remaining member SHALL still see the postcard

#### Scenario: The crew row outlives the ride's readability, and that is recorded rather than repaired
- **WHEN** a removed rider held a `ride_members` row for a private club's ride they did not organise
- **THEN** the row SHALL survive and the ride, its crew and its chat SHALL be unreadable to them
- **AND** this SHALL be recorded as an accepted consequence: evicting them would destroy an
  organizer's crew as a side effect of a club decision, which is the shape `043` refused when it
  declined to widen the `rides` DELETE policy

#### Scenario: The notification count falls with the list, in the same instant
- **WHEN** a rider is removed from a **private** club they held notifications about
- **THEN** those rows SHALL stop being returned by `036` §3's policy **and** SHALL stop being
  counted by `unread_notification_count()`, because that function is `security invoker` and reads
  the same predicate

### Requirement: Removal SHALL be indistinguishable from leaving, to everyone

No notification SHALL be written on removal, no tombstone row SHALL be created, and nothing
anywhere SHALL record who removed whom.

**The reason is a product rule and SHALL be stated as one**, because the mechanism would in fact
work: a row addressed to the removed rider with the club as subject is readable for a public club
through `036` §3's ordinary conjunct and for a private one through this change's type-scoped
disjunct. Telling a rider they were removed is a moderation statement addressed to the person
moderated, in an app with no appeal surface, and `085` already settled the principle — *a club
refuses as a club*.

The honest consequence SHALL be carried into the product rather than hidden: **on a public club,
removal is undone by the rider in one tap.** The tool for keeping somebody out is `blocks`, which is
symmetric and already enforced in every policy.

#### Scenario: Nothing is written and nothing is retracted
- **WHEN** a removal completes
- **THEN** **zero** `notifications` rows SHALL be written
- **AND** the existing `club_joined` rows the club's admins hold about that rider SHALL survive
  unchanged

#### Scenario: A removed rider's view is identical to a rider who left
- **WHEN** the removed rider's reads of the club, its roster, its rides and its threads are compared
  against the same reads by a rider who left voluntarily
- **THEN** they SHALL be identical, with no marker, gap or count distinguishing the two

### Requirement: `029`'s succession SHALL be exercised now that its `admin` arm is reachable

`private.transfer_owned_clubs` has ordered successors `admin` before `member` since `029`, and the
first arm has never been reachable because no `admin` row has ever existed. This change makes it
reachable and SHALL assert it.

#### Scenario: An admin inherits ahead of a longer-tenured member
- **WHEN** a club has an owner, a `member` who joined first and an `admin` who joined second, and
  the owner's `profiles` row is deleted
- **THEN** `clubs.owner_id` SHALL become the **admin**, not the member
- **AND** the new owner's `club_members` row SHALL read `role = 'owner'`
- **AND** the departing owner SHALL be **demoted to member** rather than deleted, per `032`

#### Scenario: Two admins are ordered by tenure
- **WHEN** two `admin` rows exist and the owner is deleted
- **THEN** the successor SHALL be the one with the earlier `joined_at`, ties broken by `user_id`

#### Scenario: The new owner can actually act
- **WHEN** succession completes
- **THEN** `private.is_club_admin_for(new_owner, club)` SHALL be true and the new owner SHALL be
  able to answer the club's pending join requests — the half a cascade assertion alone would not
  show

### Requirement: The new RPCs SHALL carry no block conjunct, and the omission SHALL be argued from the read path

`remove_club_member`, `promote_club_member` and `demote_club_admin` SHALL NOT test
`private.is_blocked` between the caller and the target.

`036` §4's rule is that **no write path may reach a row no read path returns**, because the
difference is a count that discloses a block. `club_join_requests` SELECT hides blocked riders'
requests, so `085`'s RPCs carry the conjunct. **`club_members` SELECT carries no block predicate at
all** — its qual is membership-or-public — so a blocked rider is already on the roster and already
drawn. A conjunct here would produce a visible control, aimed at a visible rider, refusing with no
explanation: a marker for the block rather than a hiding of it, which is the inverse of what
decision #2 requires.

The join-request half of the same screen keeps `085`'s conjuncts exactly as written.

#### Scenario: An admin may remove a rider they have blocked
- **WHEN** an admin who holds a `blocks` row against a member removes them
- **THEN** it SHALL succeed, with the same outcome and the same error surface as any other removal

#### Scenario: The roster's own read is unchanged
- **WHEN** the `club_members` SELECT policy is compared before and after
- **THEN** its qual SHALL be identical, asserted by equality, so no block arm is added here by
  accident

### Requirement: The management surface SHALL be reachable only by those who can use it, and its refusals SHALL come from the database

The Manage riders screen SHALL be reachable from `ClubOptionsMenu` only when
`viewer_is_owner || viewer_role === 'admin'`, and SHALL **redirect to the club** for anyone else who
reaches its URL directly.

**It SHALL NOT `notFound()`, and the reason is that a 404 there would be false.** `notFound()` is
this app's answer to *"no such club, or not one you may see"*, deliberately conflated so a private
club's existence is not confirmed. Reaching this screen at all means `getClub` returned a club, so
the reader can already open it by name and the conflation has nothing left to protect. The case that
makes this reachable rather than hypothetical is one this change itself creates: an admin is told
*"Rider asked to join Club"*, is demoted before opening it — by the owner, or by themselves — and
`085`'s retraction does not fire, because the request is still pending and nothing about it changed.
The notification is still readable and still points here.

The redirect SHALL be issued from an effect and the screen SHALL draw its placeholder rather than
its roster while it is pending, so no rider sees controls the RPCs would refuse.

**The gate SHALL be `viewer_is_owner`, never `viewer_role === 'owner'`.** The two differ for `054`'s
ownerless owner, `private.is_club_admin_for` admits that rider through its `clubs.owner_id` arm, and
gating on the role would hide the screen from the one rider who can use every control on it.

The route guard and this gate are affordances. The three RPCs are the boundary, and each SHALL
refuse identically whatever the client renders.

#### Scenario: A member who guesses the URL sees nothing and can do nothing
- **WHEN** an ordinary member navigates directly to the Manage riders route
- **THEN** the screen SHALL not render its controls
- **AND** every RPC SHALL refuse with one `insufficient_privilege` if called directly, and the
  `club_join_requests` SELECT policy SHALL return them **zero** rows for their own club

#### Scenario: A non-member of a private club is refused earlier and identically
- **WHEN** a non-member of a private club navigates to the route
- **THEN** `getClub` SHALL return `null` and the existing not-found path SHALL fire, conflating "no
  such club" with "not yours" exactly as it does today
