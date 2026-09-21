## ADDED Requirements

### Requirement: A new caller-relative helper SHALL be paired with a subject-taking twin BEFORE any fan-out needs it

The standing requirement *"The recipient set SHALL be computed by direct query, never through a
caller-relative helper"* is stated against the helpers that existed when it was written. This change
introduces a **new** one — `private.is_club_admin(target_club)` — whose description is *exactly* the
recipient set of the request fan-out. That coincidence is what makes trap (c) attractive here:
`where private.is_club_admin(new.club_id)` reads correctly, compiles, and computes the set relative
to whoever happened to be inserting rather than to each candidate.

So the rule SHALL be strengthened: **any caller-relative helper added by a change that also adds a
fan-out SHALL be created together with its subject-taking twin, in the same migration**, one body
behind both, and the fan-out SHALL use the twin.

#### Scenario: Both forms exist in the same migration
- **WHEN** `085` is applied
- **THEN** `private.is_club_admin_for(uuid, uuid)` and `private.is_club_admin(uuid)` SHALL both
  exist, the second delegating to the first with a body equal to the delegation exactly

#### Scenario: The fan-out uses the subject-taking form
- **WHEN** `private.notify_club_join_requested`'s body is examined
- **THEN** it SHALL reference `private.is_club_admin_for` and SHALL NOT reference
  `private.is_club_admin`
- **AND** it SHALL contain no reference to `auth.uid()` anywhere

#### Scenario: The caller-relative form is unreachable from a trigger by construction
- **WHEN** the recipient set is computed
- **THEN** it SHALL be a direct query over `public.clubs` and `public.club_members` with the
  candidate substituted, matching `private.notify_club_joined`'s existing union, so that the two
  fan-outs addressing the same audience cannot disagree about who that audience is

#### Scenario: The two fan-outs' audiences are asserted to agree
- **WHEN** a club has an owner, an admin, an ordinary member and a non-member
- **THEN** the set receiving `club_join_requested` SHALL equal the set receiving `club_joined` for
  the same club, minus the actor in each case
- **AND** this SHALL be asserted as set equality rather than as two independent lists, because the
  defect being guarded against is the two drifting

### Requirement: An existing fan-out that acquires a `security definer` caller SHALL be re-exercised, and its `when` clause SHALL be re-checked

`private.notify_club_joined` is `after insert on public.club_members for each row` with **no `when`
clause**. This change makes it fire for the first time from inside a `security definer` function.

Any change that gives an existing fan-out a new caller of a different security context SHALL:
re-assert that the trigger has no `current_user` guard; assert that it still fires from the new
caller; and hand-exercise the affected write path per `036`, because a raise inside a fan-out takes
the calling transaction down with it.

#### Scenario: The trigger has no `when` clause and none is added
- **WHEN** the trigger definition is examined before and after
- **THEN** it SHALL be unchanged and SHALL carry no `when (current_user = …)` clause
- **AND** the migration SHALL comment that adding one would silently disable the fan-out for the
  approval path, since `current_user` inside a definer function is the owner

#### Scenario: It fires from inside the approval RPC
- **WHEN** `approve_club_join_request` succeeds
- **THEN** the club's owner and admins SHALL each hold a `club_joined` notification with the
  approved rider as actor
- **AND** this SHALL be asserted directly, because the property depends on a trigger nobody in this
  change wrote

#### Scenario: The approved rider is not notified of their own join
- **WHEN** the same approval runs
- **THEN** the requester SHALL hold no `club_joined` row, because `notify_club_joined` excludes the
  actor
- **AND** they SHALL hold exactly one `club_join_request_approved` row, so the approval produces one
  notification for them and not two

#### Scenario: The default-club early return is unaffected
- **WHEN** `clubs.is_default` is true
- **THEN** `notify_club_joined` SHALL still return early
- **AND** no request path can reach that club anyway, because the discovery predicate excludes it —
  both guards SHALL exist and neither SHALL be removed on the strength of the other

### Requirement: A fan-out SHALL NOT write a row its recipient can never read, and where that forecloses the notification the fan-out SHALL be absent rather than silent

Restated here from the `notifications` delta because it is a property of the fan-out, not of the
table: `private.notify_club_join_requested` SHALL guard each recipient with
`private.can_read_club(candidate, new.club_id)`, and the approval notification SHALL be written only
after the membership row exists.

Where no ordering and no guard can make a recipient able to read a row — the decline case — **no
trigger SHALL be written for it**, and the migration SHALL say so in a comment at the point where a
reader would expect the third fan-out to be.

#### Scenario: Every written row is readable by its recipient at write time
- **WHEN** either fan-out writes
- **THEN** the recipient SHALL be able to select the row immediately afterwards under their own row
  security

#### Scenario: The absent third fan-out is commented, not merely missing
- **WHEN** the migration is read
- **THEN** the place a `notify_club_join_declined` would sit SHALL carry a comment naming `036` §3's
  club conjunct and the standing `notifications` requirement it would violate
- **AND** the absence SHALL be asserted: zero notifications after a decline

#### Scenario: Blocking is applied at fan-out as well as at read
- **WHEN** a requester is blocked with one of the club's admins
- **THEN** that admin SHALL receive no `club_join_requested` row
- **AND** the other admins SHALL, so the block is per-pair and not per-club
