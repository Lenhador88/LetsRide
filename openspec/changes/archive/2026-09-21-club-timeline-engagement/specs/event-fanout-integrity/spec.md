## ADDED Requirements

### Requirement: The welcome fan-out SHALL address the joiner alone, and SHALL be computed by direct query

`private.notify_club_waved()` SHALL write exactly one notification per wave, addressed to
`new.subject_user_id` — the rider who joined — and to nobody else. The club's owner, its admins and
its other members SHALL receive nothing.

The recipient SHALL be read from the **row**, never from `auth.uid()` and never through a
caller-relative helper. The standing rule applies unchanged: a helper like
`private.is_club_member()` answers for the *caller*, and a fan-out's question is about the
*subject*.

The function SHALL be `security definer`, because no client role holds INSERT on `notifications`,
and SHALL carry `set search_path = ''`. Its trigger SHALL carry **no** `when` clause: `036` §7.8
records that copying `023`'s `when (current_user = 'authenticated')` would be correct on a
participation gate and wrong here, because the fan-out must fire for every writer including the
seed the RLS suite runs as.

**A wave on a thread SHALL notify nobody in this change.** The asymmetry is deliberate — see
`design.md` §Q2 — and is recorded so it is not read as an omission and "fixed" by a session adding
a `thread_id` column to `notifications`.

#### Scenario: Exactly one recipient
- **WHEN** a member waves another rider's join in a club with an owner, two admins and forty
  members
- **THEN** exactly one `notifications` row SHALL be written
- **AND** its `user_id` SHALL be the joiner and its `actor_id` the waver, both read from NEW

#### Scenario: The fan-out is exercised by hand before it reaches production
- **WHEN** the migration is applied to either project
- **THEN** the wave and un-wave paths SHALL be exercised by hand in a rolled-back transaction, as
  `authenticated`, on that project
- **AND** the resulting rows SHALL be **counted**, not assumed, per `036`'s gate

#### Scenario: No thread wave notifies
- **WHEN** a thread is waved any number of times
- **THEN** no `notifications` row SHALL be written
- **AND** `notifications` SHALL gain no `thread_id` column in this change

### Requirement: A rider SHALL NOT be notified of their own wave, and SHALL NOT be able to wave themselves

The fan-out SHALL exclude `new.user_id = new.subject_user_id`, and the INSERT policy SHALL refuse
that row outright.

**Both, and neither is redundant.** The WITH CHECK is the primary rule — a self-welcome expresses
nothing — and stops the row existing. The fan-out exclusion is the standing requirement that a
rider is never notified of their own action, and it holds if a future path writes the row by some
other means. `036` §7.6 places the actor exclusion **after** the recipient union for exactly this
reason.

#### Scenario: The self-wave never exists
- **WHEN** a rider attempts to wave their own join
- **THEN** the INSERT SHALL be refused by the WITH CHECK
- **AND** no notification SHALL be written, there being no row

#### Scenario: The exclusion survives a new writer
- **WHEN** any future path writes a `club_join_waves` row whose reactor is its subject
- **THEN** the fan-out SHALL still write nothing
- **AND** the exclusion SHALL be in the function body rather than relied upon from the policy

### Requirement: Blocking SHALL be applied at fan-out as well as at read, and the redundancy SHALL be stated truthfully

The fan-out SHALL exclude a recipient with whom the actor is blocked in either direction —
`not private.is_blocked(new.user_id, new.subject_user_id)`.

**This conjunct is redundant today and SHALL be written anyway, with the honest reason.** The
INSERT policy's `EXISTS` against `club_members` already carries that table's symmetric block arm on
`user_id`, so a rider blocked with the subject cannot create the wave at all. The reasons to write
it regardless:

1. The implication is a property of the **current** `club_members` SELECT policy, not of this
   table. A widened arm there breaks it with nothing announcing the transition.
2. The standing requirement is that blocking be applied twice, at fan-out and at read, and that the
   second is not optional. A fan-out relying on a sibling table's policy is applying it once.
3. It costs nothing measurable.

It SHALL NOT be justified as *"the policy alone is a leak"*, because it is not. `081`'s header
records what a false stated justification costs: the next session reads the reason, finds it does
not hold, and removes the conjunct.

#### Scenario: The redundancy is documented as redundancy
- **WHEN** the fan-out is written
- **THEN** its comment SHALL say that the conjunct is redundant today and why it stays
- **AND** SHALL NOT claim the INSERT policy admits a blocked pair

#### Scenario: The block still holds at read time
- **WHEN** a block is created after the notification row exists
- **THEN** the `notifications` read policy SHALL withhold the row from its recipient
- **AND** the fan-out SHALL NOT be responsible for cleaning it up

### Requirement: A wave retraction SHALL delete exactly the row its matching fan-out wrote

`private.retract_club_waved()` SHALL fire `after delete on public.club_join_waves` and SHALL delete
the notification scoped by **all four** of `user_id`, `type`, `actor_id` and `club_id`.

A subset scope would let one rider's un-wave delete another rider's notification, which is `036`
§7.2's recorded lesson and the reason that function names all four columns.

It SHALL also fire on cascaded deletes — a leave, a thread deletion, an account deletion — and that
is bounded and redundant rather than wrong. **No `pg_trigger_depth` guard SHALL be added**, per the
standing note on `retract_postcard_liked`.

**The wave/un-wave loop re-lighting a notification SHALL be accepted and named.** The unique index
means a wave cannot *stack*; a retraction followed by a fresh wave writes a fresh row and re-lights
it. `036` accepted that once, for likes, and this is the second acceptance. It is recorded here so
that it is a decision rather than an inheritance, and so that a rate limit — which this app has
nowhere — is a known future need rather than a surprise.

#### Scenario: One rider's un-wave leaves another's notification alone
- **WHEN** two riders have waved the same join and one un-waves
- **THEN** exactly one notification row SHALL be deleted
- **AND** the other rider's row SHALL survive, `actor_id` being in the scope

#### Scenario: A cascaded delete retracts too
- **WHEN** the join's `club_members` row is deleted, cascading its waves
- **THEN** each retraction SHALL fire and remove its notification
- **AND** the recipient SHALL not be left with a notification about a membership that no longer
  exists

#### Scenario: The loop is bounded by the uniqueness index
- **WHEN** a rider waves and un-waves repeatedly
- **THEN** at most one live notification SHALL exist for that `(recipient, type, actor, club)` at
  any moment
- **AND** the collapse SHALL come from `notifications_event_key` with `nulls not distinct`, which
  SHALL be verified rather than assumed

### Requirement: A fan-out SHALL NOT write a row its read policy can never return

`club_waved` SHALL carry `club_id` as its only subject, so the `notifications` read policy's club
arm decides its visibility. The recipient is a member of that club at the moment of writing — they
just joined it — so the row is readable when written.

**Where it later becomes unreadable, it SHALL drop rather than be cleaned up.** If the recipient
leaves a **private** club, `clubs` SELECT (`is_public OR owner_id = auth.uid() OR
is_club_member(id)`) stops admitting them and the notification disappears from their list. That is
the standing behaviour — a notification dies with its subject's visibility — and SHALL NOT be
compensated for by a second retraction trigger.

#### Scenario: The row is readable at the moment it is written
- **WHEN** the fan-out writes a `club_waved` row
- **THEN** its recipient SHALL be able to read it immediately
- **AND** the `notifications` policy SHALL be the thing that says so, not the fan-out

#### Scenario: Leaving a private club drops the notification
- **WHEN** the recipient leaves a private club in which they were welcomed
- **THEN** the notification SHALL no longer be returned to them
- **AND** no trigger SHALL be added to delete it, the read policy already answering
