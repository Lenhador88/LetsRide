## ADDED Requirements

### Requirement: A mutation whose only effect on another rider is a notification SHALL invalidate nothing extra, and SHALL say so

`postClubMessage` and the thread-wave action SHALL NOT gain
`invalidate(keys.notifications.list())` or `invalidate(keys.notifications.unread())`. No new cache
key SHALL be added for either new notification type.

**The actor is excluded from the recipient set by construction**, so the rider whose client would run
the invalidation is exactly the rider the notification is not for. Invalidating their own
notifications cache clears something the write did not change; and there is no mechanism in this
hand-rolled cache to reach the recipient's client, so none is being invented.

The recipient sees the row on their next navigation. That is the bounded staleness this capability
already requires be **stated rather than fixed** — *the badge is stale until the next navigation* —
and it is stated here for two more types. **A key added here would be a claim the app cannot honour**,
which is worse than the staleness it appears to fix.

#### Scenario: Posting a reply invalidates the thread, not the notifications

- **WHEN** a rider posts a message into a club thread
- **THEN** the invalidations SHALL be exactly those the thread already declares — the thread's
  messages, and the club-level keys that already move with a new reply
- **AND** neither notifications key SHALL be invalidated
- **AND** the absence SHALL carry a comment at the site, because it is otherwise indistinguishable
  from a forgotten invalidation

#### Scenario: Waving a thread invalidates the wave state, not the notifications

- **WHEN** a rider waves or un-waves a club thread
- **THEN** the existing `threadWaves` key SHALL be invalidated as it already is
- **AND** neither notifications key SHALL be

#### Scenario: The recipient's badge is stale for one navigation and no longer

- **WHEN** a rider is the author of a thread that is replied to while they have the app open
- **THEN** their unread badge MAY lag until their next navigation
- **AND** this SHALL be stated in the change rather than papered over with a poll, a subscription or
  a cross-client invalidation

### Requirement: The count and the list SHALL still be invalidated together, and SHALL still read through one predicate

The two new types SHALL be readable through exactly the paths every other type is: the list through
`getNotificationsPage`, and the count through `unread_notification_count()`, which is
`security invoker` so it reads through the same SELECT policy.

**No screen, data function or action SHALL filter either new type** — not by block, not by
membership, not by thread readability. The policy is the single place those rules live, and a filter
applied to one of the two reads is how a nonzero badge ends up over an empty list.

#### Scenario: A thread that stops resolving falls out of both, in the same instant

- **WHEN** a recipient leaves the club, or is blocked with the thread's author, or the thread is
  deleted
- **THEN** the row SHALL leave the list and the unread count SHALL fall by the same number
- **AND** neither SHALL be achieved by a client-side filter

#### Scenario: Marking read clears the badge everywhere

- **WHEN** the recipient marks notifications read with either new type present
- **THEN** the count and the list SHALL be invalidated together, exactly as they are today
- **AND** the two new types SHALL need no special handling to make that true

### Requirement: A cached thread notification whose thread the reader may no longer see SHALL be evicted by the database

A `club_thread_replied` or `club_thread_waved` row already cached in a client SHALL stop being
returned by the next read once its thread stops resolving for that reader. No component SHALL drop it
after the fact, and no data function SHALL filter it.

**Eviction, not deletion.** Rejoining the club, or lifting the block, SHALL return the row with its
original `created_at` and read state — because the underlying reason it vanished is a visibility
change and visibility changes are reversible, while a delete is not.

#### Scenario: A stale cached row does not survive a refetch

- **WHEN** the row is in the client cache and the reader has since left the club
- **THEN** the next fetch through the ordinary invalidation SHALL return the list without it
- **AND** the component SHALL NOT be the thing that removed it
