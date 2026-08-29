## ADDED Requirements

### Requirement: A trigger whose event is sometimes not an event SHALL be narrowed by a `WHEN` clause, not by an early return

Where a row-level trigger matches inserts that are not the event it exists to announce, the
trigger SHALL be narrowed with a `WHEN` clause in its `CREATE TRIGGER`, and SHALL NOT rely on an
early `return` inside the function body.

The `WHEN` clause is the stronger form for two reasons: it is visible in `pg_get_triggerdef`, so
an assertion can pin the narrowing itself rather than inferring it from behaviour; and it prevents
the function from being entered at all, so a later edit to the body cannot silently widen it.

**`notify_ride_invited` is the instance.** It is `AFTER INSERT ON public.ride_invites FOR EACH
ROW` and was written when `pending` was the only status any insert could carry — true while the
column grant and the INSERT policy were the only writers. `claim_ride_invite_link` is a
`security definer` writer and inserts `accepted` rows, so without narrowing, a rider who joins a
ride by tapping a link they were sent is told **"you have been invited to a ride"** about a ride
they are already on.

**`036`'s actor-is-not-recipient guard does not catch it**, and that is the part worth writing
down. The row's `actor` is the link's `created_by` — the organizer — and its recipient is the
claimer, so the two genuinely differ. The guard is working; the event is simply not an event.

The clause SHALL be `WHEN (NEW.status = 'pending')`. It is a no-op for the in-app path, where the
column grant and INSERT policy already make `pending` the only reachable status at insert, so it
states an invariant that was previously implicit and holds it against a second writer.

#### Scenario: A link claim notifies nobody of an invitation
- **WHEN** a rider claims a live token and an `accepted` `ride_invites` row is inserted
- **THEN** no `ride_invited` notification SHALL be written to anyone

#### Scenario: An in-app invite still notifies
- **WHEN** the organizer inserts a `pending` invite
- **THEN** the invitee SHALL receive exactly one `ride_invited` notification, unchanged from `083`

#### Scenario: The narrowing is pinned, not inferred
- **WHEN** `pg_get_triggerdef` is read for `notify_ride_invited`
- **THEN** it SHALL contain the `WHEN (status = 'pending')` clause
- **AND** the assertion SHALL read the trigger definition rather than only observing that no
  notification appeared, since an absent notification has several possible causes

### Requirement: A rider joining by a route nobody initiated SHALL still reach the organizer through the existing join fan-out, and SHALL NOT gain a new type

A claim SHALL produce notifications through the `ride_members` INSERT path alone. `055`'s
`ride_joined` fan-out already tells the crew that a rider joined, which is exactly and truthfully
what happened.

**No new notification type SHALL be added by this change**, and `ride_invite_accepted` SHALL NOT
be written on a claim. That type asserts that the organizer invited *this rider by name* and they
answered — false on a link claim, where nobody named anyone.

The one case where an accept notification is correct is the conflict branch: a rider who already
held a `pending` or `declined` in-app invite and comes in through the link takes the UPDATE path,
`notify_ride_invite_answered` fires, and the organizer is told their invite was accepted. **That
is true and SHALL be left alone.**

#### Scenario: The organizer learns a stranger joined
- **WHEN** a rider with no prior invite claims a link
- **THEN** the organizer SHALL receive a `ride_joined` notification and no `ride_invited` or
  `ride_invite_accepted` notification

#### Scenario: An outstanding invite answered by a link is reported as answered
- **WHEN** a rider holding a `pending` invite claims the link instead of tapping Accept
- **THEN** the organizer SHALL receive the `ride_invite_accepted` notification the UPDATE trigger
  already writes, since the statement it makes is true

#### Scenario: The type list does not grow
- **WHEN** `notifications_type_check` is read after this change applies
- **THEN** it SHALL hold the same eight types `083` left it with
- **AND** `NotificationType` in `src/types/index.ts` SHALL be unchanged, so no exhaustive `switch`
  in `notificationCopy` or `NotificationsListItem` gains an arm
