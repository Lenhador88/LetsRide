## ADDED Requirements

### Requirement: A list SHALL NOT open one subscription per row, and every screen SHALL declare whether it subscribes at all

Where a screen renders a list of subscribable things — threads in a club, conversations in an inbox
— it SHALL open **no** subscription, and SHALL revalidate through its own cache key instead. A
subscription SHALL be opened only by the screen that renders a single stream.

Until this change the app had exactly one live stream, so "one channel per logical stream" had
nothing to distinguish it from "one channel per screen". With a second, the distinction becomes
load-bearing: a Discussions list holding forty threads that subscribes per row opens forty sockets
on mount, and the symptom is a slow screen and a burnt connection quota rather than anything that
looks like a Realtime bug.

Every new screen SHALL state, in its own documentation, whether it subscribes — because a screen
that quietly does not is indistinguishable from one whose channel is broken.

#### Scenario: A thread list does not subscribe
- **WHEN** the Discussions list for a club is rendered
- **THEN** no channel SHALL be opened
- **AND** the list SHALL be refreshed by invalidating its cache key and on foreground, per the
  standing revalidation rule

#### Scenario: A single-stream screen subscribes to exactly one channel
- **WHEN** one thread is opened
- **THEN** exactly one channel SHALL exist for it, named from that thread's id alone
- **AND** navigating between two threads SHALL leave exactly one channel open, never two

#### Scenario: A screen's subscription status is declared
- **WHEN** a screen carrying live-updatable data is added
- **THEN** it SHALL state whether it subscribes and, if not, what revalidates it
- **AND** the absence of a statement SHALL NOT be read as "it subscribes"

### Requirement: Channel names SHALL be unique across streams, not merely within one stream type

A channel name SHALL identify the stream **and** what kind of stream it is, so that two different
kinds of stream can never collide on one name.

With one subscription in the app, `ride:<id>:messages` was unambiguous by construction. With two,
the namespace is shared: an id is a uuid from a different table, and a name built from an id alone
is one refactor away from two unrelated streams sharing a channel — which delivers each side's
payloads to the other's subscribers, filtered only by RLS.

#### Scenario: Two stream kinds cannot collide
- **WHEN** channel names are chosen for a ride's messages and a club discussion's messages
- **THEN** each SHALL carry a segment naming its kind as well as its id
- **AND** the two SHALL be verifiably distinct even if the two ids were somehow equal

#### Scenario: The name remains reproducible
- **WHEN** any caller needs the channel for a given stream
- **THEN** it SHALL be derivable from the stream's identity alone, with no random value, timestamp
  or component instance id

### Requirement: Adding a table to the publication SHALL be a decision made per table, and a table left out SHALL be left out explicitly

Where a change creates several tables and subscribes to some of them, the migration SHALL add
exactly those to `supabase_realtime` and SHALL record why each other table is absent.

A table's absence from the publication is invisible from the client: a subscription to it reports
`SUBSCRIBED` and never fires. So an absence that was a decision and an absence that was an omission
look identical from every direction except the migration text.

#### Scenario: The message table joins the publication and the thread table does not
- **WHEN** the migration creating a club's threads and messages is applied
- **THEN** the messages table SHALL be in the publication and the threads table SHALL NOT
- **AND** the migration SHALL state that a new thread appearing live is not required, so that a
  later session adding a thread-list subscription discovers the absence in the file rather than in
  a channel that silently never fires

#### Scenario: Both memberships are asserted from the catalog
- **WHEN** the RLS suite runs
- **THEN** it SHALL assert the message table's membership **and** the thread table's non-membership
- **AND** both SHALL be catalog queries rather than recollections

### Requirement: Replica identity SHALL be chosen from what the subscription reads, not copied

Each subscribed table SHALL keep the default replica identity unless a subscriber genuinely needs
the OLD row, and the choice SHALL be stated.

`full` puts every column of every changed row into the WAL. It is needed only to carry the OLD row
on UPDATE and DELETE. A table with no UPDATE at all whose subscribers read INSERT does not need it,
and setting it produces a payload nothing reads at a cost nothing measures.

#### Scenario: A message table keeps the default
- **WHEN** a message table with no UPDATE grant is added to the publication and its subscribers
  listen for INSERT
- **THEN** the default replica identity SHALL be kept
- **AND** the migration SHALL say so, so that `full` is not added later as a reflex
