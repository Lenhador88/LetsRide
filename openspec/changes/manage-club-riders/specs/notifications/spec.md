## MODIFIED Requirements

### Requirement: A rider SHALL NOT learn a private club's name, or a private ride's title, from a notification

A notification row SHALL carry no denormalised text describing its subject. Every rendered string
naming a club, ride, postcard or rider SHALL be read from that resource under the reader's own row
security at the moment of rendering.

**A snapshot is a second copy of a visibility decision and nothing re-checks it.** A
`club_name text` column would be readable by its recipient for ever, including after they left the
club, were removed from it, or were blocked by everyone in it — and the row would look perfectly
correct to any reviewer, because the value in it was true when it was written.

**This requirement is about denormalisation, not about which readers a club's name may reach**, and
the distinction is what the carve-out below turns on. `085` already widened the audience for a
private club's name — `public.discoverable_private_clubs` returns it to every signed-in rider the
club takes join requests from — and did so through an accessor evaluated live on every read. A
notification may therefore *point at* a club that audience can already name, provided the name still
comes from a live predicate and never off the row.

**The carve-out is exactly one type and SHALL stay exactly one type.** `club_join_request_declined`
(`089`, PD-335) is returned to a rider who is not a member of the private club it names, through a
**type-scoped** disjunct on `036` §3's club conjunct:

```sql
or (type = 'club_join_request_declined'
    and private.club_takes_join_requests(notifications.club_id))
```

Every other `club_id`-carrying type SHALL evaluate exactly the conjunct it evaluates today. An
unconditional widening of that conjunct — which would make *any* `club_id`-carrying row resolve for
any non-member holding one — SHALL NOT be made.

#### Scenario: No column holds a name, title or caption
- **WHEN** the table is inspected after `089`
- **THEN** it SHALL still carry no `club_name`, `ride_title`, `actor_username`, `postcard_caption`,
  `body`, `message` or equivalent column
- **AND** the decline row's club name SHALL be resolved at render time through
  `public.discoverable_private_clubs`, under a predicate that goes false the moment the rider is
  blocked with the club's owner

#### Scenario: A non-member receives a private club's name ONLY for the declined type, and only while the club would still take their request
- **WHEN** a rider who is not a member of a private club holds a `club_join_request_declined` row
  for it
- **THEN** the row SHALL be returned, and the club's name SHALL be reachable to them — through the
  accessor, never through the `club:clubs(...)` embed, which SHALL continue to return null
- **WHEN** the same rider holds any **other** `club_id`-carrying type for the same club
- **THEN** that row SHALL NOT be returned, unchanged from today

#### Scenario: The carve-out closes when the rider is blocked
- **WHEN** a `blocks` row exists in either direction between the requester and the club's owner
- **THEN** `private.club_takes_join_requests` SHALL be false, the ordinary `clubs` EXISTS SHALL be
  false, and the decline row SHALL NOT be returned and SHALL NOT be counted

#### Scenario: A ride's title follows the ride's own policy
- **WHEN** a notification names a ride the reader can no longer see
- **THEN** the title SHALL not be fetchable and the row SHALL not be returned

#### Scenario: An unresolvable actor evicts the row in the database, because that state is reachable
- **WHEN** the actor's profile is not returned to the reader — blocked, **or `username` NULL**
- **THEN** the row SHALL NOT be returned by the SELECT policy, by the same `EXISTS` mechanism the
  subject uses, so the unread count falls with the list in the same instant
- **AND** the row SHALL NOT be rendered with a placeholder name, an id, or "someone"
- **AND** no component SHALL drop it after the fact

#### Scenario: The self-actor row is immune to that eviction, and that is why it was chosen
- **WHEN** the reader is the row's own `actor_id`
- **THEN** `profiles` SELECT's first arm — `auth.uid() = id` — SHALL resolve them unconditionally,
  including when they have nulled their own username
- **AND** `private.is_blocked(x, x)` SHALL be false, because `blocks` carries
  `CHECK (blocker_id <> blocked_id)`

## ADDED Requirements

### Requirement: A decline SHALL notify the rider without naming the individual who refused

`089` SHALL add an eleventh type, `club_join_request_declined`, carrying **`club_id` alone** — the
subject shape `club_joined` already has, so `notifications_subject_shape` gains one arm and no
per-column conjunct is added for it.

**`actor_id` SHALL be the requester themselves, and SHALL NOT be the declining admin or the club's
owner.** `NOTIFICATION_SELECT` embeds `actor:profiles!actor_id(...)` and the recipient holds
table-wide SELECT on `notifications`, so any other choice hands the requester the identity `085`
refused a `responded_by` column to withhold — and a client-side omission is advisory, not a
guarantee. The club's owner is worse on two counts: it is a false attribution, and `owner_id` is
deliberately absent from `discoverable_private_clubs`' seven columns, so it would be a new
disclosure rather than a restated one.

Making `actor_id` nullable SHALL NOT be the answer either: it is NOT NULL on a shipped table and
`036` §3's actor conjunct would refuse the row, requiring a second policy edit to rescue the first.

#### Scenario: Two declines from two clubs produce two rows
- **WHEN** the same rider is declined by two different private clubs
- **THEN** **two** rows SHALL exist, because `036` §8's key spans `club_id` and the two differ there
- **AND** this SHALL be asserted, because it is the exact property a subject-less type would lose to
  `nulls not distinct`

#### Scenario: The requester cannot learn who pressed Decline, by any route
- **WHEN** the requester reads every column of their own decline notification, including through a
  hand-rolled request that names `actor_id`
- **THEN** the value SHALL be their own id
- **AND** no column on `club_join_requests` SHALL name the responder either — `085`'s absence of
  `responded_by` is unchanged by this file

#### Scenario: The type list and the subject shape move together
- **WHEN** `089` is applied
- **THEN** `notifications_type_check` SHALL name **eleven** types and `notifications_subject_shape`
  SHALL carry an arm for each, with `else false` intact
- **AND** an insert of the new type with a NULL `club_id`, or carrying `postcard_id`, `comment_id`
  or `ride_id`, SHALL be refused with `23514`

#### Scenario: A rider still cannot write or forge one
- **WHEN** any client role attempts to insert the new type
- **THEN** it SHALL be refused, because `authenticated` holds no INSERT grant on `notifications` and
  this change adds none

### Requirement: The read and write predicates SHALL be widened together, and the type literal SHALL be asserted rather than read

The disjunct SHALL be added to `036` §3's SELECT policy **and** to `036` §4's UPDATE policy in
**both** its USING and its WITH CHECK. The suite already asserts the three expressions are textually
identical and SHALL continue to.

Widening only the read leaves a rider able to see a row they can never mark read, and therefore a
badge that never clears — the same class of defect as a write reaching a row a read does not return,
arriving from the other side.

**This is the first per-TYPE clause in a policy `036` §3 deliberately wrote per COLUMN**, and its
failure mode is silent: a mistyped literal makes the disjunct never fire, the row unreadable, and
nothing red — `085`'s original defect exactly. The change SHALL therefore assert that the literal in
the policy equals the literal the fan-out writes, compared as strings.

#### Scenario: All three expressions carry the disjunct and remain identical
- **WHEN** the SELECT qual, the UPDATE qual and the UPDATE `with_check` are read from `pg_policies`
- **THEN** all three SHALL be textually identical and all three SHALL contain the disjunct

#### Scenario: The type string in the policy matches the type string the trigger writes
- **WHEN** the policy text and `private.notify_club_join_request_declined`'s `prosrc` are compared
- **THEN** the same literal SHALL appear in both, asserted by extraction rather than by eye

#### Scenario: The recipient can mark the decline read, and the count falls with it
- **WHEN** the requester marks the row read
- **THEN** the UPDATE SHALL succeed and `unread_notification_count()` SHALL fall by one, because it
  is `security invoker` and reads the widened predicate

#### Scenario: No other type's readability moves
- **WHEN** a rider who is not a member of a private club holds a `club_joined`,
  `club_join_requested`, `club_join_request_approved` or `ride_created_in_club` row naming it
- **THEN** none SHALL be returned, before or after `089`
- **AND** this SHALL be asserted per type, because "the disjunct is type-scoped" is exactly the
  claim a reviewer must not have to take on trust

### Requirement: The decline row SHALL lead with the club, not with its actor

Because the actor is the reader, the row SHALL NOT draw the actor's name or avatar. It SHALL draw
the **club's** name and avatar and a complete sentence after it, falling back to "A club" exactly as
`club_joined` does when its subject does not resolve.

This is `085`'s own rule applied to a component — *a club refuses as a club* — rather than a
workaround for the actor choice.

The row SHALL carry a destination: the club's reduced screen, whose id comes from the notification's
own `club_id` **column** rather than from the `club:clubs(...)` embed, which returns null for this
audience. It SHALL carry no action pair; there is nothing to answer.

#### Scenario: The reader never sees their own name on the row
- **WHEN** a decline row is rendered
- **THEN** the leading name SHALL be the club's and SHALL NOT be the reader's username
- **AND** a component test SHALL assert it, because the data shape makes the wrong rendering the
  natural one

#### Scenario: The destination survives, or the row does not
- **WHEN** the club is deleted
- **THEN** the notification SHALL be deleted with it, because `notifications.club_id` is
  `ON DELETE CASCADE`
- **AND** there SHALL be no state in which the row renders with a destination that 404s
