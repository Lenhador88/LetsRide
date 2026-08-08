# realtime-subscriptions Specification

## Purpose
The rules every live stream in this app obeys, established by the first one. Per-ride chat is the
first Supabase Realtime subscription this repo has ever had; DMs, the notification feed, unread
counters and presence all inherit these rules unchanged, which is why they are a capability of
their own rather than a section of `ride-chat`.

**Realtime bugs are almost always lifecycle bugs, and they fail quietly.** Four of the six
requirements below describe failures with **no error to read**: a channel subscribed to an
unpublished table, a socket holding an expired JWT, a missed event during a reconnect, and a
subscription that outlived the session that authorised it. Each looks exactly like a quiet
conversation.
## Requirements
### Requirement: A subscription SHALL NOT outlive the thing that opened it, nor the session that authorised it

Every channel SHALL be removed when the component that opened it unmounts, and when the rider
signs out. No channel SHALL survive a session change.

A channel that outlives its component is a memory leak and a duplicate-delivery bug. A channel
that outlives its **session** is worse: the socket was authorised with rider A's access token,
and a shared device is the normal case for a motorcycle club rather than an edge case. The
standing requirement that sign-out destroys every local trace of the rider was written before any
socket existed; a live channel is a new kind of trace and it is covered here rather than by
widening that requirement.

#### Scenario: Unmount removes the channel
- **WHEN** the component holding a subscription unmounts
- **THEN** its effect cleanup SHALL remove the channel
- **AND** navigating away and back SHALL leave exactly one channel, not two

#### Scenario: Sign-out removes every channel
- **WHEN** a rider signs out
- **THEN** every open channel SHALL be removed before the session is discarded
- **AND** no payload authorised by the previous rider's token SHALL be delivered into the next
  rider's session on the same device

#### Scenario: A refreshed token re-authorises the socket
- **WHEN** the access token is refreshed
- **THEN** the socket SHALL be re-authenticated with the new token
- **AND** a stream that stops delivering after roughly one token lifetime SHALL be treated as
  this defect, because the server drops an expired socket with no client-visible error and the
  symptom is indistinguishable from nobody talking

#### Scenario: A double-mounted effect does not stack channels
- **WHEN** an effect runs twice — React's development double-invocation, or a fast remount
- **THEN** exactly one channel SHALL remain subscribed
- **AND** the fix SHALL be correct cleanup rather than a guard flag that suppresses the second
  mount

### Requirement: Each live stream SHALL have exactly one deterministically-named channel

A channel name SHALL be derived from the stream it carries, so that two components asking for the
same stream get the same channel. Names SHALL NOT be random, incremental or scoped to a component
instance.

Two components subscribing to the same logical stream must **share**, not stack. A name that
includes a random suffix or a mount counter guarantees they stack, and the symptom is every
message arriving twice — which reads as a rendering bug and gets fixed by de-duplicating in the
list, leaving the leak in place.

#### Scenario: The name is a function of the stream
- **WHEN** a channel is opened for a ride's messages
- **THEN** its name SHALL be derived from the ride's id alone, in a form any other caller can
  reproduce
- **AND** it SHALL NOT contain a random value, a timestamp or a component instance id

#### Scenario: Two subscribers share one channel
- **WHEN** two components subscribe to the same stream at the same time
- **THEN** one channel SHALL exist
- **AND** each payload SHALL be delivered once per subscriber, not once per channel per
  subscriber

#### Scenario: Duplicate delivery is fixed at the channel, not at the list
- **WHEN** a message appears twice on screen
- **THEN** the cause SHALL be established as a channel lifecycle defect before any de-duplication
  is added to the rendering path
- **AND** de-duplicating in the list SHALL NOT be accepted as the fix, because it hides a leak
  that also costs the socket

### Requirement: A subscription SHALL NOT be treated as a delivery guarantee

Every screen with a subscription SHALL also refetch its data on reconnect and on foreground. A
subscription SHALL be an optimisation over revalidation, never a replacement for it.

Missed events are never replayed. Riders lose signal constantly — that is the premise of the
whole native move — so a client that trusts the event stream to have filled the gap will show a
thread with a hole in it and no indication that anything is missing.

#### Scenario: Reconnect refetches rather than resumes
- **WHEN** the socket reconnects after any interruption
- **THEN** the screen SHALL refetch its current state
- **AND** it SHALL NOT assume the events it missed will arrive

#### Scenario: Foreground refetches
- **WHEN** the app is foregrounded after being backgrounded
- **THEN** the visible screen SHALL revalidate, unchanged from the standing rule for every other
  screen
- **AND** the presence of a subscription SHALL NOT be treated as making that unnecessary

#### Scenario: A refetch reconciles rather than replaces
- **WHEN** a refetch returns rows the client already holds
- **THEN** the merged result SHALL contain each message once, matched by id
- **AND** the rider's scroll position SHALL be preserved

#### Scenario: A dropped subscription is not silent forever
- **WHEN** the channel fails to resubscribe
- **THEN** the screen SHALL fall back to revalidation on foreground and on interaction
- **AND** it SHALL NOT present a stale thread as live indefinitely

### Requirement: A table SHALL be in the publication before anything subscribes to it

Any table a client subscribes to SHALL be a member of the `supabase_realtime` publication, added
in the migration that creates it, and its membership SHALL be asserted.

**Measured 2026-08-07: the `supabase_realtime` publication exists and contains zero tables.** A
subscription to a table outside it connects, transitions to `SUBSCRIBED`, and never fires — no
error, no callback, no log entry. This is the most common way a first Realtime integration is
declared finished and does nothing, and it is invisible to every gate this repo has except a
human watching a screen.

#### Scenario: Publication membership ships with the table
- **WHEN** a migration creates a table intended to be subscribed to
- **THEN** the same migration SHALL add it to the publication
- **AND** the membership SHALL be asserted from the catalog, which the RLS suite can do on plain
  Postgres

#### Scenario: A healthy-looking subscription that never fires is diagnosed here first
- **WHEN** a channel reports subscribed and no payload ever arrives
- **THEN** publication membership SHALL be checked before the policy, the client or the network
- **AND** the check SHALL be a catalog query rather than a recollection

### Requirement: Realtime authorization SHALL be verified per subscriber, and DELETE events SHALL NOT be subscribed to

Row-level security on a subscribed stream SHALL be **measured** with two real sessions, not
inferred from the policy. Subscriptions SHALL be scoped to `INSERT`, and `REPLICA IDENTITY` SHALL
remain at its default.

Realtime evaluates the SELECT policy against each subscriber's own claims, so the audience rule
is enforced on the wire — but in a context the RLS suite cannot reach, because that suite runs on
plain Postgres with no Realtime server. A policy that is correct in `psql` and a policy that is
correct on the wire are two claims, and only one of them is currently tested.

**A delete cannot be filtered by RLS at all.** Logical replication emits a delete carrying only
the replica identity — by default the primary key — and RLS needs the row's other columns to
decide. Widening the replica identity to make the decision possible would put the deleted row's
**content** into the replication stream, which is the opposite of the fix.

#### Scenario: A blocked rider is verified silent, not assumed silent
- **WHEN** two riders who have blocked each other are both subscribed to the same stream
- **THEN** neither SHALL receive the other's payloads
- **AND** this SHALL be established by subscribing as each and observing silence, against a real
  Supabase project, because no assertion on plain Postgres can establish it

#### Scenario: A non-audience subscriber is verified silent
- **WHEN** a rider outside the stream's audience subscribes to its channel by name
- **THEN** they SHALL receive nothing
- **AND** the channel name SHALL NOT be treated as a secret, because it is derivable and the
  policy is the control

#### Scenario: Subscriptions are INSERT-only
- **WHEN** a channel is configured
- **THEN** it SHALL listen for `INSERT` only
- **AND** it SHALL NOT listen for `DELETE` or `*`, because a delete payload cannot be filtered by
  RLS and would disclose that a row existed to a subscriber who could never read it

#### Scenario: Replica identity stays at the primary key
- **WHEN** a subscribed table is created or altered
- **THEN** `REPLICA IDENTITY FULL` SHALL NOT be set
- **AND** the reason SHALL be recorded: it would place the deleted row's content in a stream that
  cannot evaluate a policy against it

#### Scenario: A removed row disappears on the next revalidation, not by event
- **WHEN** a row is deleted from a subscribed table
- **THEN** subscribers SHALL learn of it through revalidation on foreground or reconnect
- **AND** the delay SHALL be accepted as the cost of the rule above

### Requirement: An optimistic write SHALL reconcile against the server row or fail visibly

A write shown before the server confirms it SHALL carry a client-generated identifier, SHALL be
matched to the server row by that identifier, and SHALL never be left rendered as though it
succeeded when it did not.

Matching by content guesses, and guesses collide the moment two riders send the same short
message. The identifier is also what makes a retry idempotent, which is the stronger of its two
justifications.

#### Scenario: The optimistic row and the server row are the same row
- **WHEN** the server confirms a write, whether by the mutation's own response or by a
  subscription payload
- **THEN** the optimistic row SHALL be replaced, matched on the client-generated id
- **AND** the row SHALL NOT appear twice, and SHALL NOT jump position when it reconciles

#### Scenario: A failed write is visibly failed
- **WHEN** a write fails or times out
- **THEN** the optimistic row SHALL be marked failed with a retry affordance, or removed
- **AND** it SHALL NOT remain rendered indistinguishably from a confirmed row, per the standing
  rule that a failed mutation leaves no false state behind

#### Scenario: A retry reuses the identifier
- **WHEN** a rider retries a write whose outcome is unknown
- **THEN** the same client-generated id SHALL be sent
- **AND** a unique-violation on it SHALL be treated as success rather than as an error

#### Scenario: An optimistic row is never trusted for ordering
- **WHEN** an optimistic row is placed in a list
- **THEN** its position SHALL be provisional and SHALL be settled by the server's own ordering
  fields on reconciliation
- **AND** the device clock SHALL NOT be written into any field the server owns

