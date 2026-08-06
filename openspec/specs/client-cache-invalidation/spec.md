# client-cache-invalidation Specification

## Purpose
What a screen shows after a mutation, and how it learns that data changed elsewhere, once
`revalidatePath` no longer exists. Forty-one call sites across eight action files currently
state which screens a write invalidates; that statement has to survive the move without
becoming a component-by-component guess.
## Requirements
### Requirement: Every mutation SHALL declare what it invalidates

`revalidatePath` appears 41 times in `src/lib/actions/` (`git grep -c revalidatePath --
'src/lib/actions/*.ts'`, 2026-08-05). Each call is a claim about which screens are now stale —
`createClub` names `/clubs` and `/clubs/explore`; `likePostcard` names the feed, the card, and
the postcard's club timeline if it has one. Those claims SHALL be preserved as cache keys, not
rediscovered.

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

### Requirement: Counts SHALL stay per-viewer and SHALL NOT be cached across viewers

Every cache key SHALL be scoped to the signed-in rider, and no cached value MUST survive a
sign-out.

Likes and comments deliberately carry no denormalised count, because the correct count is
per-viewer: blocks and hides change it. A shared cache keyed only by postcard id would leak one
viewer's count to another.

#### Scenario: Cache keys include the viewer
- **WHEN** any list, count or roster is cached
- **THEN** the key SHALL be scoped to the signed-in rider
- **AND** no cached value SHALL be reused across a sign-out and sign-in

#### Scenario: Blocking removes content already on screen
- **WHEN** a rider blocks another rider from the postcard overflow menu
- **THEN** the blocked rider's postcards, comments, likes and roster rows SHALL disappear from
  every cached view the blocker holds, not only from the next fetch
- **AND** the deck SHALL NOT skip past the card that was open, which is the behaviour the deck
  fix of 2026-08-05 established

#### Scenario: Unread counts follow the same rule
- **WHEN** `club_unread_counts()` is read
- **THEN** its result SHALL be cached per rider only, since the function is `security invoker`
  precisely so blocks and hides apply to it

### Requirement: Stale data SHALL be bounded and visible

Every screen SHALL revalidate when the app is foregrounded, and freshness MUST be expressed as
a revalidation rule rather than as a Realtime subscription.

No screen currently knows that data changed elsewhere; the server re-rendered on navigation and
the question never arose. A cached client can hold a list open for as long as the rider leaves
the app running.

#### Scenario: Returning to the app refreshes what is on screen
- **WHEN** the app is foregrounded after being backgrounded
- **THEN** the visible screen SHALL revalidate its data

#### Scenario: A ride whose details changed is not acted on stale
- **WHEN** a rider RSVPs to a ride whose departure time or meeting point has changed since the
  screen loaded
- **THEN** the write SHALL still be attempted against the current row, and the screen SHALL
  reflect the current values afterwards rather than the ones it was showing

#### Scenario: Real-time is not assumed
- **WHEN** freshness is specified for a screen
- **THEN** it SHALL be expressed as a revalidation rule, not as a subscription, since no screen
  subscribes to Realtime today and the Inbox epic owns that decision

### Requirement: Redirect-after-write SHALL survive the loss of server redirects

A successful create SHALL navigate the rider to the created resource or the list containing it,
and MUST NOT leave the form indistinguishable from never having been submitted.

Twelve action call sites end in `redirect()` from `next/navigation` — signup, both onboarding
steps, password update, sign-out, club creation, ride creation, postcard creation. A client
mutation cannot redirect from the server, and the redirect is load-bearing in at least two
places: it is what makes "posted" distinguishable from "not submitted yet" when both states
are `{ error: null }`.

#### Scenario: Success is distinguishable from the initial state
- **WHEN** a create action succeeds
- **THEN** the rider SHALL be navigated to the created resource or the list that now contains it
- **AND** the form SHALL NOT be left in a state indistinguishable from never having been
  submitted

#### Scenario: Onboarding still advances one step at a time
- **WHEN** the username step succeeds
- **THEN** the rider SHALL land on the location step, and SHALL NOT be able to reach it before
  the username is set, matching the guard's current rule

