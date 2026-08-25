## MODIFIED Requirements

### Requirement: Every mutation SHALL declare what it invalidates

`revalidatePath` had **33** call sites in `src/lib/actions/`, not the 41 this spec first
claimed: `git grep -c revalidatePath -- 'src/lib/actions/*.ts'` counts *lines*, and several
lines carried two calls. `keys.ts` §header records the recount. Each call was a claim about
which screens are now stale —
`createClub` names `/clubs` and `/clubs/explore`; `likePostcard` names the feed, the card, and
the postcard's club timeline if it has one. Those claims SHALL be preserved as cache keys, not
rediscovered.

**An inbound signal that another rider mutated something SHALL declare its keys the same way a
mutation does.** A push received while the app is foregrounded is the first such signal in this
app that arrives outside both the mutation path and the Realtime path: nothing local changed,
`invalidate` was never called by an action, and the screen has no reason to know. Without a
declared key set, `/notifications` shows a badge whose list does not move — the two reads disagree
by construction, which is precisely the failure the count-and-list requirement elsewhere in this
capability exists to prevent.

The keys are the ones that already exist and SHALL NOT be invented inline:
`queryKeys.notifications.list()` and `queryKeys.notifications.unread()`, invalidated **together**,
because the list and the count read through the same policy and must move in the same instant.

**A push SHALL NOT be treated as a delivery guarantee for the cache.** Push is best-effort on both
platforms — throttled, coalesced, dropped in Doze, and absent entirely for a rider who declined —
so a screen SHALL remain correct for a rider who receives no push at all. The signal shortens
staleness; it is never the mechanism that makes a screen right.

#### Scenario: The invalidation set is derived, not reinvented
- **WHEN** an action is migrated
- **THEN** its new invalidation SHALL cover at least the routes its `revalidatePath` calls named
- **AND** any route deliberately dropped SHALL be recorded with its reason, since three of
  today's calls target routes chosen by convention rather than necessity

#### Scenario: A mutation's own screen updates without a navigation
- **WHEN** a rider likes, joins, leaves, hides, blocks, reports, comments or posts
- **THEN** the screen they are on SHALL reflect the change without a manual refresh

#### Scenario: A failed mutation leaves no false state behind
- **WHEN** a mutation fails after an optimistic update
- **THEN** the optimistic change SHALL be reverted and the failure SHALL be shown
- **AND** a like, join or RSVP SHALL NOT remain visually applied after the write was refused

#### Scenario: A foreground push moves the badge and the list together
- **WHEN** a push arrives while the app is in the foreground
- **THEN** both `queryKeys.notifications.list()` and `queryKeys.notifications.unread()` SHALL be
  invalidated
- **AND** the payload SHALL NOT be written into the cache with `setQueryData`, because it is a
  copy of a visibility decision produced elsewhere and the cache must be filled by a read under
  the rider's own session

#### Scenario: Tapping a push lands on fresh data
- **WHEN** a rider taps a push and the app opens or resumes at the notification's destination
- **THEN** the destination's keys SHALL be invalidated before it renders
- **AND** the cold-start case SHALL be handled by the existing boot-restore path rather than a
  second navigation mechanism

#### Scenario: A rider who receives no push is not left stale
- **WHEN** a rider has declined push, has no registered device, or the push was dropped by the
  platform
- **THEN** `/notifications` SHALL still be correct on its next ordinary read
- **AND** no screen SHALL depend on a push having arrived
