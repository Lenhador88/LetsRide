## Purpose

Who may name a rider for a ride, what naming them grants, who may answer, and what every other
role sees of that — for every role that can reach a ride: organizer, invitee, crew member, club
member, non-member, blocked rider, and signed-out visitor.

**An invite is a grant of `select` on a `rides` row.** That is the sentence the whole capability
turns on. It is not a message, not a suggestion and not a UI state — it adds a fourth arm to the
one policy in this schema that has already been rewritten twice (`017`, `022`), and it is the first
route by which a rider who is not a member of a private club can read that club's ride.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** Three are named as exceptions where they are stated:
the picker's client-side exclusion of existing crew is a query shape rather than a policy; the
notification row's control-rendering rule is a component contract; and the cross-copy agreement
between the policy and `private.can_read_ride` is asserted as *equal answers for four named
riders*, which is behaviour rather than text.

## ADDED Requirements

### Requirement: Only the ride's organizer SHALL create an invite

`public.ride_invites` INSERT SHALL be permitted only where `inviter_id = auth.uid()` **and** the
caller is the ride's `organizer_id`, evaluated by an `EXISTS` against `public.rides` under the
caller's own row security, **and** the caller is not blocked with the invitee in either direction.

No crew member, club member, club owner or club admin SHALL be able to create an invite. Widening
this to the crew SHALL be a separate change with its own scenarios, because handing a non-member a
readable row for a private club's ride is a different security statement when N riders can do it
than when one can.

`public.ride_invites` SHALL carry **no** UPDATE grant and **no** UPDATE policy for any client role.
Status changes happen only inside the two `security definer` RPCs, which is what makes "the invitee
answers" enforceable rather than conventional.

#### Scenario: The organizer invites a rider
- **WHEN** a ride's organizer inserts a `ride_invites` row naming themselves as `inviter_id` and
  another rider as `invitee_id`
- **THEN** the insert SHALL succeed with `status` taking its default of `pending`
- **AND** `created_at` SHALL be the server's `now()` and SHALL NOT be nameable by the caller
- **AND** `responded_at` SHALL be NULL

#### Scenario: A crew member cannot invite
- **WHEN** a rider holding a `ride_members` row for the ride, who is not its organizer, attempts
  the same insert
- **THEN** it SHALL be refused with `42501`
- **AND** the refusal SHALL come from the INSERT policy, not from a trigger or from application code

#### Scenario: A club member of the ride's club cannot invite
- **WHEN** a member of the ride's club, who is neither organizer nor crew, attempts the insert
- **THEN** it SHALL be refused

#### Scenario: A rider cannot invite on someone else's behalf
- **WHEN** any rider inserts a row whose `inviter_id` is not `auth.uid()`
- **THEN** it SHALL be refused, even where that `inviter_id` names the ride's actual organizer

#### Scenario: A rider cannot pre-answer an invite they send
- **WHEN** the organizer's insert names `status`, `created_at` or `responded_at`
- **THEN** it SHALL be refused with `42501`, because INSERT is granted per column over
  `(id, ride_id, invitee_id, inviter_id)` alone
- **AND** the column default SHALL NOT be relied on as the guarantee, because a default applies only
  when the column is omitted

#### Scenario: No client role holds UPDATE on the table
- **WHEN** `has_table_privilege` is asked for `authenticated` and for `anon` on
  `public.ride_invites` for `UPDATE`
- **THEN** both SHALL be false, asserted per grantee rather than by a grant-row count, since
  `postgres` and `service_role` hold everything by Supabase default
- **AND** no UPDATE policy SHALL exist on the table

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `public.ride_invites` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on the table and this change SHALL add none, per decision #1

### Requirement: An invite SHALL be unique per ride and invitee, and SHALL NOT name its own inviter

`public.ride_invites` SHALL carry `unique (ride_id, invitee_id)` and
`check (invitee_id <> inviter_id)`.

The unique index is the anti-spam mechanism and SHALL NOT be relaxed to include `inviter_id`,
`status` or `created_at`: a repeat invite must be a refusal, not a second row, and a second row is
exactly what a wider key would permit once crew invites land.

Where two riders could invite the same rider to the same ride — unreachable today, reachable the
day crew invites land — **the first invite SHALL win and the row SHALL keep its original
`inviter_id`**. The second inserter SHALL receive `23505`, and the surface SHALL render that as
"already invited" rather than as an error.

#### Scenario: A repeat invite is refused, not duplicated
- **WHEN** the organizer inserts a second invite for a rider who already holds one for that ride,
  in any status
- **THEN** it SHALL be refused with `23505`
- **AND** no second notification SHALL be written

#### Scenario: A rider cannot invite themselves
- **WHEN** any rider inserts a row where `invitee_id = inviter_id`
- **THEN** it SHALL be refused by a table CHECK, before any policy or trigger is reached
- **AND** the fan-out SHALL therefore be unable to notify a rider of their own action, which the
  fan-out also guards independently

### Requirement: A live invite SHALL grant read on the ride, and the block check SHALL dominate it

`rides` SELECT SHALL gain a fourth audience arm, placed **inside** the block-dominated group as a
third disjunct beside the public arm and the club-member arm — never as a top-level arm beside
`organizer_id = auth.uid()`.

A "live" invite is one whose `status` is `pending` **or** `accepted`, expressed as an explicit list
and never as `status <> 'declined'`, so that a status added later grants nothing until someone
decides it should.

The arm SHALL be expressed as a `security definer` helper on `private.is_club_member`'s pattern —
caller-relative, reading `auth.uid()` internally, `set search_path = ''`, revoked from `public` and
`anon` and granted to `authenticated` because an RLS expression is evaluated as the querying role —
and SHALL NOT be an inline widening of the policy predicate.

#### Scenario: A pending invitee reads the ride
- **WHEN** a rider holding a `pending` invite reads a ride that is not public and whose club they
  are not a member of
- **THEN** the ride SHALL be returned

#### Scenario: An accepted invitee who has left the crew still reads the ride
- **WHEN** a rider accepts an invite, later deletes their `ride_members` row, and reads the ride
- **THEN** the ride SHALL still be returned, because the invite is `accepted` and `accepted` is live
- **AND** they SHALL be able to rejoin through the ordinary RSVP path, whose own
  `EXISTS (rides …)` is evaluated under their row security and therefore depends on this

#### Scenario: A declined invitee reads nothing
- **WHEN** a rider declines an invite and reads the ride
- **THEN** zero rows SHALL be returned, unless some other arm of the policy admits them

#### Scenario: A blocked invitee reads nothing, and the placement is what enforces it
- **WHEN** a rider holds a `pending` invite and the organizer has blocked them, in either direction
- **THEN** zero rows SHALL be returned from `rides`, because the invite arm sits inside the group
  governed by `not private.is_blocked(auth.uid(), organizer_id)`
- **AND** an implementation placing the arm at the top level SHALL be rejected in review, because it
  returns the ride to a rider the organizer has blocked

#### Scenario: The invite arm grants the ride and nothing that hangs off membership
- **WHEN** a pending invitee to a private club's ride reads `clubs`, that club's other rides, its
  member list, its threads, or the ride's `ride_messages`
- **THEN** every one SHALL return zero rows, because each hangs off `private.is_club_member` or
  `private.is_ride_crew` and neither is touched by this change
- **AND** they SHALL be able to read the ride's crew through `ride_members`, whose SELECT policy is
  an `EXISTS` against `rides` plus the block check, which is the intended and stated consequence

#### Scenario: The helper is not reachable as an oracle
- **WHEN** the client roles' privileges on the subject-taking form are examined
- **THEN** `authenticated` and `anon` SHALL hold no `execute` on it, because
  `has_live_ride_invite_for(x, r)` answering true for an arbitrary `x` discloses that `x` was
  invited to `r`
- **AND** only the caller-relative wrapper SHALL be granted to `authenticated`

### Requirement: The invite arm SHALL be added to BOTH copies of the rides visibility rule

`private.can_read_ride(candidate uuid, target_ride uuid)` (`060`) is a second implementation of the
`rides` SELECT policy, maintained so that a fan-out can ask the question for somebody other than the
caller. Any change to the policy SHALL be made to both, in the same migration, in the same position.

The two invite helpers SHALL be **one body with two entry points**: the caller-relative wrapper's
`prosrc` SHALL be exactly a delegation to the subject-taking form with `auth.uid()` as the
candidate, and the subject-taking form's body SHALL mention `auth.uid()` nowhere.

`supabase/tests/rls_test.sql` §060.1 pins the `rides` SELECT qual **by equality**. This change
SHALL re-pin it to the new text **and** update the helper, per that assertion's own instruction; it
SHALL NOT re-pin the string alone.

#### Scenario: Policy and helper agree for every role
- **WHEN** the RLS suite compares, for the same ride, whether `rides` SELECT returns a row and
  whether `private.can_read_ride` answers true
- **THEN** the two SHALL agree for the organizer, for a signed-in non-member of a public ride, for
  a member of the ride's private club, for a pending invitee, for an accepted invitee, for a
  declined invitee, and for a blocked rider
- **AND** this SHALL be asserted as agreement between the two, not as two independent expectations,
  so that a future rewrite of either is caught by the disagreement rather than by a stale string

#### Scenario: The wrapper cannot grow an arm the body does not have
- **WHEN** the RLS suite reads the caller-relative wrapper's `prosrc`
- **THEN** it SHALL equal the delegation exactly, matched by equality and never by `like`
- **AND** the subject-taking body SHALL be asserted not to contain `auth.uid()`, because a
  caller-relative helper computes one answer and applies it to every candidate

#### Scenario: A stale second copy is caught by the fan-out, not only by the string
- **WHEN** an invitee is notified of an invite
- **THEN** the fan-out's resolvability check SHALL use the candidate-relative form and SHALL answer
  true, which is the self-consistency check that fails the day the two copies drift

### Requirement: Only the invitee SHALL answer an invite, and answering SHALL be one statement

`public.accept_ride_invite(invite uuid)` and `public.decline_ride_invite(invite uuid)` SHALL be the
only paths that move an invite's `status`. Both SHALL be `security definer`, `set search_path = ''`,
`#variable_conflict error`, SHALL re-check `invitee_id = auth.uid()` in their own bodies, and SHALL
carry exactly **one** raise site each, so that "not your invite", "no such invite" and "already
answered" are indistinguishable to the caller.

Both SHALL set `responded_at` to the server's `now()`, and a table CHECK SHALL couple the two —
`responded_at is null` exactly when `status = 'pending'` — so a row cannot record an answer with no
time or a time with no answer.

#### Scenario: The invitee accepts
- **WHEN** the invitee calls `accept_ride_invite` on their own pending invite
- **THEN** the invite SHALL become `accepted` with `responded_at` set
- **AND** a `ride_members` row SHALL exist for them on that ride with `status = 'going'`
- **AND** both SHALL happen in one transaction, so no observer can see one without the other

#### Scenario: The invitee declines
- **WHEN** the invitee calls `decline_ride_invite` on their own pending invite
- **THEN** the invite SHALL become `declined` with `responded_at` set
- **AND** no `ride_members` row SHALL be written

#### Scenario: The organizer cannot answer on the invitee's behalf
- **WHEN** the ride's organizer, or any other rider, calls either function on an invite they do not
  own as invitee
- **THEN** it SHALL raise `insufficient_privilege`, identically to a nonexistent invite id

#### Scenario: Answering twice is refused indistinguishably
- **WHEN** the invitee calls `decline_ride_invite` on an already-declined invite, or
  `accept_ride_invite` on an already-accepted one
- **THEN** it SHALL raise the same error as a nonexistent id, and SHALL write no notification

#### Scenario: A blocked invitee cannot accept
- **WHEN** the organizer blocks the invitee after sending the invite, and the invitee calls
  `accept_ride_invite`
- **THEN** it SHALL raise, because the function re-checks `private.can_read_ride` for the caller
- **AND** the error SHALL be the same one a nonexistent invite raises, so the block is not disclosed

### Requirement: The crew row on an invite path SHALL be written by exactly one function, which restates the participation gate

`private.join_ride_from_invite(rider uuid, target_ride uuid)` SHALL be the only place an invite path
writes `public.ride_members`. `accept_ride_invite` SHALL be its only caller in this change, and a
token-bearing claim SHALL become its second caller without changing the write.

It SHALL restate the participation gate in its own body — `terms_accepted_at` and
`onboarding_completed_at` both non-NULL for the rider — because `enforce_participation_gate` on
`ride_members` carries `when (current_user = 'authenticated')` and `current_user` inside a
`security definer` function is the **owner**, so the trigger cannot fire for this writer.

A second gate trigger SHALL NOT be added to compensate. It would raise the trigger count while
gating nothing, making coverage read complete where it is not — the failure `078.9` asserts the
absence for.

The insert SHALL be `on conflict do nothing`, so accepting an invite for a ride the rider has
already joined is a no-op rather than an error.

#### Scenario: An un-onboarded rider cannot join through an accept
- **WHEN** a rider whose `terms_accepted_at` is NULL calls `accept_ride_invite`
- **THEN** it SHALL raise
- **AND** the refusal SHALL come from the restatement inside the function, which SHALL be asserted
  directly, because the trigger provably cannot fire in this context

#### Scenario: The gate trigger count is unchanged by the RPC
- **WHEN** the trigger count is measured after the migration
- **THEN** exactly one new `enforce_participation_gate` trigger SHALL exist, on `ride_invites`
- **AND** `ride_members` SHALL still carry exactly the one it already had

#### Scenario: Accepting when already crew is a no-op
- **WHEN** a rider who already holds a `ride_members` row for the ride accepts their invite
- **THEN** the invite SHALL become `accepted`, the existing crew row SHALL be untouched — its
  `status` and `joined_at` unchanged — and no error SHALL be raised

### Requirement: A declined invite SHALL be immovable by the inviter and reopenable only by the invitee

Decline SHALL be terminal **with respect to the inviter**: no rider SHALL be able to delete,
clear, reset or re-send a `declined` invite, so the same invitation cannot arrive again tomorrow.

The invitee SHALL be able to reopen their own declined invite by accepting it — `declined →
accepted` through `accept_ride_invite` and by no other route. No rider can be spammed by their own
button, and the alternative leaves a rider who mis-taps Decline permanently locked out of a ride
they can reach by no other arm.

`accepted → declined` SHALL NOT be a transition. Leaving a ride is a `ride_members` DELETE and SHALL
touch no invite row.

#### Scenario: The inviter cannot clear a refusal
- **WHEN** the organizer attempts to delete a `declined` invite, or to insert a fresh one for the
  same rider and ride
- **THEN** the delete SHALL match zero rows and the insert SHALL be refused with `23505`

#### Scenario: The invitee changes their mind
- **WHEN** the invitee calls `accept_ride_invite` on their own `declined` invite
- **THEN** it SHALL become `accepted`, the crew row SHALL be written, and the organizer SHALL
  receive a `ride_invite_accepted` notification
- **AND** the earlier `ride_invite_declined` notification SHALL remain, because it records something
  that happened

#### Scenario: Leaving the ride does not un-accept the invite
- **WHEN** an accepted invitee deletes their `ride_members` row
- **THEN** the invite SHALL remain `accepted` with its original `responded_at`
- **AND** no notification SHALL be written, because leaving a ride is not answering an invitation

### Requirement: An invite SHALL be revocable only while pending, and revoking SHALL retract its notification

`public.ride_invites` DELETE SHALL be permitted only where `inviter_id = auth.uid()` **and**
`status = 'pending'`. An `AFTER DELETE` trigger SHALL delete exactly the `ride_invited` notification
its matching fan-out would have written, matched on the full event key.

Revoking SHALL make the ride unreadable to the invitee again, immediately, because the read arm
reads the row.

#### Scenario: The organizer withdraws a pending invite
- **WHEN** the organizer deletes a `pending` invite they sent
- **THEN** the row SHALL be gone, the invitee's `ride_invited` notification SHALL be gone, and the
  ride SHALL no longer be readable to them through the invite arm

#### Scenario: A revoked invite can be re-sent
- **WHEN** the organizer revokes a pending invite and later invites the same rider to the same ride
- **THEN** the insert SHALL succeed and a fresh notification SHALL be written
- **AND** this SHALL be the only route by which a second invite for a pair ever exists, which is why
  it is the inviter's own action rather than a rider's refusal that enables it

#### Scenario: An answered invite cannot be revoked
- **WHEN** the organizer attempts to delete an `accepted` or a `declined` invite
- **THEN** it SHALL match zero rows
- **AND** removing an accepted rider from a ride SHALL remain out of scope: nothing in this change
  gives an organizer a way to remove crew

#### Scenario: A blocked pair's invite is inert and un-revocable to both
- **WHEN** a block exists between the organizer and a pending invitee
- **THEN** neither SHALL see the invite row, so neither SHALL be able to delete it
- **AND** the row SHALL grant nothing, because the read arm is dominated by the block check
- **AND** this SHALL be stated as the accepted outcome rather than repaired, because any repair
  requires one of them to observe a row about the other

### Requirement: Invite visibility SHALL be stated per role

Every role that can reach a `ride_invites` row SHALL have its access stated, so each line maps onto
an assertion.

The SELECT policy SHALL be `(invitee_id = auth.uid() or inviter_id = auth.uid())` conjoined with a
block check against the other party. It SHALL carry **no** arm reading `rides.organizer_id`: today
`inviter_id` *is* the organizer, so such an arm would be dead code that reads as live — the failure
`club_members.role = 'admin'` has been for the whole life of this schema. That arm arrives with crew
invites or not at all.

#### Scenario: Invitee
- **WHEN** the invitee reads `ride_invites`
- **THEN** their own invites SHALL be returned, in every status

#### Scenario: Inviter
- **WHEN** the ride's organizer reads `ride_invites`
- **THEN** the invites they sent SHALL be returned, in every status, with the invitee's identity

#### Scenario: Crew member who is neither
- **WHEN** a rider on the ride's crew who is neither inviter nor invitee reads `ride_invites`
- **THEN** zero rows SHALL be returned — the crew SHALL NOT learn who was invited and did not come

#### Scenario: Club member, non-member, and any other signed-in rider
- **WHEN** any other signed-in rider reads `ride_invites`, including by a ride id they can see
- **THEN** zero rows SHALL be returned

#### Scenario: Blocked rider, both directions from one row
- **WHEN** a block exists between the two parties to an invite
- **THEN** neither SHALL see the row, from one directional `blocks` row, because blocking is
  symmetric (decision #2)
- **AND** a third rider's invites SHALL be unaffected

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant

#### Scenario: The counted and the listed agree
- **WHEN** a screen shows a count of pending invites beside a list of them
- **THEN** both SHALL be read through the same policy and the same predicate, so a row the reader
  cannot see is in neither

### Requirement: An invite SHALL NOT grant the ride's chat, and `private.is_ride_crew` SHALL NOT gain an invite arm

An invitee SHALL NOT read `public.ride_messages` before accepting, and SHALL NOT be able to write
one. The enforcement is `private.is_ride_crew`, which reads `rides.organizer_id` and
`public.ride_members` and nothing else, and which this change SHALL NOT modify.

`private.is_ride_crew`'s body SHALL be pinned by equality in the RLS suite, so that a later change
adding an invite arm to it — the cheap-looking way to resolve the apparent inconsistency of a rider
who sees the ride and not its chat — fails loudly.

#### Scenario: A pending invitee reads no messages
- **WHEN** a pending invitee reads `ride_messages` for the ride they were invited to
- **THEN** zero rows SHALL be returned, and an insert SHALL be refused
- **AND** the refusal SHALL come from the crew conjunct, not from the ride conjunct, which now
  passes for them

#### Scenario: The chat opens on accept and not before
- **WHEN** the invitee accepts
- **THEN** the ride's messages SHALL become readable, because the accept wrote the `ride_members`
  row the helper reads

#### Scenario: The crew helper is pinned
- **WHEN** the RLS suite reads `private.is_ride_crew`'s `prosrc`
- **THEN** it SHALL mention `ride_invites` nowhere, asserted by equality against its current body
- **AND** the assertion's message SHALL name what else the arm would silently open — `ride_reads`'
  write predicate and `postcards`' ride tagging, both of which use the same helper

### Requirement: An invite to a rider who is already crew SHALL be inert, and membership SHALL be read live

The database SHALL permit an invite to a rider who already holds a `ride_members` row. It SHALL NOT
be refused by a CHECK or a trigger: a CHECK cannot reference another table, and a trigger would
refuse in a race with no rider-visible explanation, which is the failure `077` removed the capacity
gate for.

`ride_invites.status` SHALL NOT be a copy of membership. It records the answer to the invitation and
nothing else, and no trigger SHALL be hung on `ride_members` to resolve an invite — that is a new
trigger on an already-shipped write path and a second copy of a decision the crew table already
owns.

The surfaces SHALL therefore read membership live:

- The invitee's pending-invite list SHALL exclude rides they are already crew on, by a
  `not exists (ride_members …)` in the read rather than by a status check.
- The organizer's invite list SHALL render an invitee who holds a crew row as **joined**, read from
  the crew and never from the invite's status.

#### Scenario: An invite to an existing crew member is accepted by the database and hidden by the surface
- **WHEN** the organizer invites a rider already on the crew
- **THEN** the row SHALL be written and the notification SHALL be delivered
- **AND** the invitee's pending list SHALL not show it, because they are already on the ride

#### Scenario: A rider who RSVPs instead of answering
- **WHEN** an invited rider joins through the ordinary RSVP control rather than the invite
- **THEN** the invite SHALL remain `pending`, and the organizer SHALL learn through `ride_joined`
  rather than `ride_invite_accepted`
- **AND** the organizer's invite list SHALL show that rider as joined
- **AND** this state SHALL be treated as legitimate rather than as a contradiction to repair

### Requirement: An invite SHALL survive a change in the ride's visibility and SHALL die with the ride

An invite SHALL NOT be expired, retracted or rewritten by a change to `rides.is_public` or
`rides.club_id`. The read arm is a **disjunct**, so a ride becoming more visible makes the invite
redundant and a ride becoming less visible leaves the invitee's reach intact — which is the intended
behaviour in both directions.

#### Scenario: The ride is made public after the invite
- **WHEN** the organizer sets `is_public = true` on a ride with pending invites
- **THEN** the invites SHALL remain pending and answerable
- **AND** the invitee SHALL now reach the ride by two arms, which changes nothing they can do

#### Scenario: The ride is moved into a private club after the invite
- **WHEN** the organizer sets `club_id` to a private club the invitee is not a member of
- **THEN** the invitee SHALL still read the ride, through the invite arm alone
- **AND** they SHALL still read no part of the club
- **AND** this SHALL be stated in `docs/reference/schema.md`'s `rides` row, because it is a route
  into a private club's ride that did not exist before

#### Scenario: The ride is deleted
- **WHEN** the organizer deletes the ride
- **THEN** every invite to it SHALL be deleted by the `ride_id` cascade, and every notification
  carrying that `ride_id` SHALL be deleted by `036`'s own cascade
- **AND** nobody SHALL be notified, consistent with the crew not being notified today, because there
  is no longer a subject to render

#### Scenario: The organizer deletes their account
- **WHEN** the ride's organizer deletes their account
- **THEN** the ride SHALL cascade away with them, taking every invite and every notification about
  it, and the invitee SHALL simply stop seeing it

### Requirement: The rider picker SHALL search `profiles` under the existing policy and SHALL add no exposure

Naming a rider SHALL use the `profiles` SELECT policy as it stands —
`(auth.uid() = id) or (username is not null and not private.is_blocked(auth.uid(), id))` — and the
per-column SELECT grants `025` left in place. No new RPC, no `security definer` search, no new
column grant and no new policy arm.

It SHALL return only columns the client already holds a grant on, and SHALL NOT return an email
address, a consent stamp or an onboarding stamp — which it cannot, because no client role holds
those grants.

The query SHALL be prefix-anchored, SHALL require at least two characters, and SHALL be capped and
unpaginated.

#### Scenario: A rider is found by username prefix
- **WHEN** the inviter types at least two characters
- **THEN** matching riders SHALL be returned by `username ilike <q> || '%'`, ordered by `username`,
  capped at a fixed small number of rows
- **AND** an infix match SHALL NOT be used, because it turns the picker into a substring index of
  the whole directory

#### Scenario: A blocked rider is absent in both directions with no filter in the query
- **WHEN** the inviter searches for a rider they have blocked, or who has blocked them
- **THEN** zero rows SHALL be returned, enforced by the `profiles` policy and not by the query
- **AND** the empty result SHALL be indistinguishable from a rider who does not exist

#### Scenario: A rider with no username is unreachable
- **WHEN** a rider has not set a username, or has nulled it
- **THEN** they SHALL NOT appear in the picker, because the policy already excludes them

#### Scenario: Existing crew and existing invitees are excluded by the surface
- **WHEN** the picker renders results for a specific ride
- **THEN** riders already on the crew and riders already holding an invite SHALL be excluded from
  the list, by filtering rows the caller can already read
- **AND** this exclusion is a query shape rather than a policy, so it SHALL NOT be asserted in the
  RLS suite, and SHALL NOT be relied on for any security property

#### Scenario: A search returns nothing about who else was invited
- **WHEN** any rider searches
- **THEN** the result SHALL be the same regardless of any ride, invite or crew they are not party to

### Requirement: Invites SHALL have a stated retention, and its absence SHALL be a decision

A `ride_invites` row SHALL live exactly as long as its ride, its invitee and its inviter, through
three `on delete cascade` foreign keys, and SHALL be deleted by nothing else except a revoke of a
pending row.

**A pending invite SHALL NOT expire**, and that SHALL be recorded as a decision with what was
considered: a fixed window was weighed and declined because nothing renders an unanswered invite
except the two parties' own lists, and an expiry needs a schedule this repo does not run. The
trigger that reopens it is the link half, where the credential is a bearer token rather than a row
naming one rider.

#### Scenario: Both account-deletion directions are covered
- **WHEN** the invitee deletes their account
- **THEN** every invite addressed to them SHALL be gone, out of every organizer's list
- **AND** when the **inviter** deletes their account, every invite they sent SHALL be gone, out of
  every invitee's list
- **AND** both SHALL be asserted, because neither is visible in the other's assertion

#### Scenario: Every cascade path is indexed
- **WHEN** the indexes are examined
- **THEN** each foreign-key column SHALL lead an index of its own, `029`'s standing requirement, with
  the unique `(ride_id, invitee_id)` serving the `ride_id` path

#### Scenario: The retention answer is written where a reader will find it
- **WHEN** `docs/reference/schema.md` gains its `ride_invites` row
- **THEN** it SHALL state the cascade window, the absence of an expiry as a decision, and that the
  row is a relationship record between two identified riders

### Requirement: Every invite surface SHALL define all seven of its states

Each screen this change adds — the invitee's pending list, the organizer's invite list, the rider
picker, and the Accept/Decline controls on a notification row — SHALL have a defined empty,
loading, error, offline, permission-denied, partial and stale state.

Screens SHALL gate on **data**, never on `isLoading`; `null` SHALL be a decided absence and
`undefined` SHALL be "not yet".

#### Scenario: Empty
- **WHEN** a rider has no pending invites, or a ride has none
- **THEN** a designed empty state SHALL render — for the organizer, one that offers the picker;
  for the invitee, one that does not imply an error

#### Scenario: Loading
- **WHEN** either list is fetched for the first time
- **THEN** a skeleton at the content's own padding SHALL render, and the screen SHALL NOT gate on
  `isLoading`

#### Scenario: Error and retry
- **WHEN** the read fails
- **THEN** a failure SHALL be distinguishable from an empty list, and a retry SHALL be offered

#### Scenario: Offline
- **WHEN** the rider has no connection
- **THEN** cached invites SHALL render read-only, and Accept and Decline SHALL be disabled with a
  reason rather than failing on submit — an invite answered optimistically offline and refused on
  reconnect is a rider who believes they are on a ride they are not

#### Scenario: Permission denied versus empty
- **WHEN** a rider opens an invite deep link for an invite that is not theirs, or that has been
  revoked
- **THEN** the screen SHALL render the same "this invite is no longer available" state for both,
  because the two are indistinguishable from the client and disclosing the difference discloses the
  invite's existence

#### Scenario: Partial
- **WHEN** the invite list loads but the crew read fails
- **THEN** the list SHALL render without the joined markers rather than failing whole

#### Scenario: Stale
- **WHEN** the invite was answered on another device
- **THEN** the controls SHALL be derived from the live invite row on the next read, and an answer
  submitted against a stale row SHALL fail with the same indistinguishable error and refresh the row

### Requirement: Both invite lists SHALL be ordered and bounded deterministically

Both lists SHALL be ordered by `created_at desc, id desc` — a total order, so pagination cannot skip
or repeat a row when two invites share a timestamp.

The organizer's list SHALL be capped rather than paged, at the same order of magnitude as the crew
rail's existing `RIDE_CREW_LIMIT`, and the cap SHALL be stated where it is applied. The invitee's
pending list is bounded by how many riders have named them and SHALL be capped on the same terms.

#### Scenario: Ties do not break pagination
- **WHEN** two invites share a `created_at`
- **THEN** the order SHALL still be total, because `id` breaks the tie

#### Scenario: A cap is a stated limit, not a silent truncation
- **WHEN** either list reaches its cap
- **THEN** the surface SHALL say so rather than silently ending, and the cap SHALL be a named
  constant rather than a literal at the call site

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

The following SHALL NOT exist after this change, and each SHALL be named in the proposal rather than
left as an apparent omission: a shareable invite link or any token column; crew members inviting; an
organizer removing an accepted rider from the crew; a free-text message attached to an invite; push
delivery of the three new notification types; an expiry sweep; and any anonymous route.

#### Scenario: No token column exists
- **WHEN** `ride_invites` is examined after the migration
- **THEN** it SHALL carry no token, secret, code or link column, and no `anon` grant, so that the
  link half is a deliberate addition rather than a half-present affordance

#### Scenario: No surface implies a capability that is absent
- **WHEN** any screen this change adds is reviewed
- **THEN** it SHALL NOT draw a disabled control for a capability that does not exist, because a
  greyed button is a promise
