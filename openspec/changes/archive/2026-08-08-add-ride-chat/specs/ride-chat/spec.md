## Purpose

Who is in a ride's conversation and who must not be, and what the thread does when someone
leaves, blocks, is blocked, or deletes their account. The audience is **narrower** than the
ride's own, which is the one thing about this capability with no precedent in the repo to copy.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** The one exception is named as such: whether
Supabase Realtime applies the SELECT policy per subscriber cannot be asserted on plain Postgres,
and it lives in `realtime-subscriptions`.

## ADDED Requirements

### Requirement: A ride's chat SHALL be readable and writable by its crew, and by nobody else

`public.ride_messages` SHALL be reachable only by riders who are the ride's organizer or who
hold a `public.ride_members` row for it. The audience SHALL be **narrower** than the `rides`
SELECT policy, which admits any signed-in rider to a public ride.

**This is the whole change and it has no precedent in this repo to copy.** Every child table
built so far — `postcard_comments` (`011`), `postcard_likes` (`009`), `postcard_reports` (`011`)
— inherits its parent's audience *exactly*, expressed as a bare `EXISTS` against the parent. A
chat does not, and an implementer who pattern-matches on `011` ships a group conversation
readable by every signed-in rider on the platform.

The narrowing SHALL be expressed as a `security definer` helper in the `private` schema,
matching `private.is_club_member`'s shape from `005`, so that PostgREST does not publish it and
it adds no security-advisor finding.

#### Scenario: A crew member reads and writes
- **WHEN** the organizer, or any rider holding a `ride_members` row, reads or writes
  `ride_messages` for that ride
- **THEN** the read SHALL return the thread and the write SHALL succeed

#### Scenario: A rider who can see the ride but has not RSVP'd reads nothing and writes nothing
- **WHEN** a signed-in rider who is not the organizer and holds no `ride_members` row reads
  `ride_messages` for a ride they *can* see — a public ride with no club, or a public club's
  public ride
- **THEN** zero rows SHALL be returned
- **AND** an insert SHALL be refused
- **AND** the refusal SHALL come from the crew predicate, not from the ride being invisible,
  because the ride is visible to them and remains so

#### Scenario: A rider who cannot see the ride at all reaches nothing
- **WHEN** a signed-in rider who is not a member of the ride's private club reads
  `ride_messages` for it
- **THEN** zero rows SHALL be returned, and this SHALL hold whether or not they somehow hold a
  `ride_members` row

#### Scenario: `maybe` has exactly the same rights as `going`
- **WHEN** a rider whose `ride_members.status` is `maybe` reads or writes the chat
- **THEN** both SHALL succeed, identically to a rider whose status is `going`
- **AND** there SHALL be no read-only tier, because crew membership is the **presence** of the
  row and never its status — `ride_members.status` admits `going` and `maybe` only, and leaving
  is a row delete

#### Scenario: The organizer reads and writes with no `ride_members` row
- **WHEN** the rider named in `rides.organizer_id` reads or writes the chat while holding no
  `ride_members` row at all
- **THEN** both SHALL succeed
- **AND** this SHALL NOT depend on any other change shipping first, because `withOrganizer`
  encodes "the organizer is on their own ride by construction" in application code where no
  policy can see it, and a membership-only predicate would lock a host out of their own ride

#### Scenario: The organizer arm becomes redundant, not wrong
- **WHEN** a change that seeds the organizer's `ride_members` row on ride creation is applied
- **THEN** the organizer arm SHALL remain in place rather than being removed as dead
- **AND** the reason SHALL be that the seeding change's delete guard binds `authenticated` only,
  so a privileged path can still remove the row, and a host silently locked out of their own
  ride's chat is a worse failure than a redundant `or exists`

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `ride_messages` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on the table
- **AND** this change SHALL add none, per decision #1

### Requirement: Chat visibility SHALL be the intersection of ride visibility and crew membership, never crew membership alone

The SELECT policy SHALL require **both** that the caller can see the ride under their own row
security **and** that they are on its crew. The crew helper alone SHALL NOT be sufficient.

`private.is_ride_crew` is `security definer`, so RLS does not apply inside it — which is the
point of the instrument and here is the hazard. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate; a definer helper
asking only "do I hold a crew row" sees neither. A `ride_members` row survives every event that
takes the ride away, so "holds a crew row" and "can see the ride" are **independent**.

**`private.is_club_member` has the same shape and no such gap**, because `clubs` deliberately
carries no block predicate. Copying that shape verbatim is therefore the specific trap this
requirement exists to close.

#### Scenario: A crew member who blocks the organizer loses the chat
- **WHEN** a crew member blocks the ride's organizer, in either direction, and their
  `ride_members` row is untouched
- **THEN** zero `ride_messages` rows SHALL be returned to them
- **AND** an insert SHALL be refused
- **AND** the refusal SHALL come from the ride-visibility conjunct, which SHALL be asserted in
  isolation, because the crew conjunct alone would admit them

#### Scenario: A crew member who leaves a private club loses the chat
- **WHEN** a rider holding a `ride_members` row for a private club's ride leaves that club
- **THEN** zero `ride_messages` rows SHALL be returned to them, because `022` forces a private
  club's ride to `is_public = false` and `rides` SELECT then admits club members only
- **AND** this SHALL be asserted separately from the blocking case, because a single assertion
  cannot say which conjunct did the work and a later edit could remove one while the suite stays
  green

#### Scenario: A club turning private takes its rides' chats with it
- **WHEN** a public club is set private and its rides therefore cease to be public
- **THEN** crew members who are not members of that club SHALL stop reading the chat
- **AND** their existing messages SHALL remain readable to the club's own members, per the
  leaving rule below

#### Scenario: The ride-visibility conjunct is not simplified away
- **WHEN** the SELECT policy is reviewed, refactored or replaced
- **THEN** the `EXISTS` against `rides` SHALL remain, and SHALL carry a policy comment saying why
- **AND** removing it SHALL fail at least two assertions rather than passing quietly

### Requirement: Leaving the crew SHALL end access without retracting the conversation

A rider who leaves a ride's crew SHALL stop reading its chat immediately. The messages they
already sent SHALL remain visible to everyone still on the crew.

`setRideAttendance(rideId, null)` deletes the `ride_members` row. **A conversation is not
retracted because one participant leaves** — this is the intended behaviour and is stated
plainly rather than left to be inferred from the cascade that does not exist.

#### Scenario: The leaver stops reading at once
- **WHEN** a crew member sets their attendance to `No`, deleting their `ride_members` row
- **THEN** their next read of `ride_messages` for that ride SHALL return zero rows
- **AND** an insert SHALL be refused

#### Scenario: The leaver's own messages are not returned to them either
- **WHEN** the same rider reads the thread after leaving
- **THEN** their own messages SHALL NOT be returned
- **AND** the `author_id = auth.uid()` arm SHALL be subordinate to the crew and ride-visibility
  conjuncts rather than a top-level alternative, because a top-level arm would show them their
  own half of a conversation answering nothing, with no way to tell why

#### Scenario: The thread is unchanged for everyone else
- **WHEN** any remaining crew member reads the thread after another rider leaves
- **THEN** the departed rider's messages SHALL still be present, with their author still
  resolvable
- **AND** no marker, gap or placeholder SHALL indicate that the author has left

#### Scenario: Rejoining restores the whole thread
- **WHEN** a rider who left RSVPs again
- **THEN** the entire thread SHALL be readable, including messages sent while they were away
- **AND** nothing SHALL record that they were absent, because no such column exists and adding
  one is not in scope

### Requirement: Blocking SHALL remove a rider from the conversation in both directions, silently

A blocked rider's messages SHALL be absent from the blocker's thread and the blocker's messages
SHALL be absent from theirs, while both remain on the crew. The rule SHALL be enforced through
`private.is_blocked`, never by querying `blocks` from a policy.

Blocking is symmetric even though the row is directional (decision #2). This is `011`'s comment
shape applied per message: the block clause is about the **author**, not the ride.

#### Scenario: Two crew members who have blocked each other see different threads
- **WHEN** crew members A and B are both on a ride and A has blocked B
- **THEN** A SHALL NOT see B's messages and B SHALL NOT see A's, in the same thread, at the same
  time
- **AND** both SHALL remain on the crew and both SHALL keep reading everyone else's messages
- **AND** this SHALL be asserted with A and B exchanged, because the row is directional and the
  effect symmetric

#### Scenario: No gap is drawn where a hidden message was
- **WHEN** a thread contains messages hidden from the viewer by a block
- **THEN** the screen SHALL render the remaining messages contiguously
- **AND** it SHALL NOT render a placeholder, a greyed row, a "message hidden" marker or a count
  that includes them, because any of those discloses the block

#### Scenario: A reply to a hidden message is not itself hidden
- **WHEN** a visible rider replies to a message the viewer cannot see
- **THEN** the reply SHALL be shown
- **AND** the resulting non-sequitur SHALL be accepted, because the alternative is transitive
  hiding, which discloses the block by omission and has no defined stopping point

#### Scenario: Your own message is always visible to you
- **WHEN** a crew member reads a thread containing their own messages
- **THEN** their own messages SHALL always be returned, whatever blocks exist
- **AND** "always" SHALL mean *with respect to the block predicate only* — the arm SHALL NOT
  defeat the crew or ride-visibility conjuncts, per the leaving rule above

#### Scenario: The block filter is never applied by a screen
- **WHEN** the thread is rendered
- **THEN** no component, data function or action SHALL filter by block
- **AND** the policy SHALL remain the single place the rule lives, per decision #2

### Requirement: The crew count a chat screen shows SHALL be per-viewer and SHALL NOT be treated as a fact about the ride

The header's rider count SHALL be understood as the number of crew members *this viewer* can
see, and SHALL NOT be used to detect anything.

`Ride - Chat` draws `10 riders` as a single number. `ride_members` SELECT carries
`NOT private.is_blocked(auth.uid(), user_id)`, so two crew members counting the same ride get
different answers. The same property `client-cache-invalidation` already states for like counts.

#### Scenario: Two crew members see different counts
- **WHEN** crew members A and B are on the same ride and A has blocked one other crew member
- **THEN** A's header count SHALL be one lower than B's
- **AND** neither screen SHALL present the number as authoritative, offer a discrepancy warning,
  or reconcile against any other count

#### Scenario: The count is cached per rider
- **WHEN** the count is cached
- **THEN** its key SHALL be scoped to the signed-in rider and SHALL NOT survive a sign-out

### Requirement: A message SHALL NOT be editable, and its deletion SHALL be limited with the gap recorded

`ride_messages` SHALL carry **no UPDATE policy and no UPDATE grant**. DELETE SHALL be permitted
for a rider's own message, or for any message on a ride the caller organises.

Same ruling and same reasoning as `011`: editing a message means designing "edited" — whether it
is disclosed, from when, and what the record of a conversation means once it can be rewritten —
and none of that exists. A table with no mutable column carries no UPDATE grant, so the refusal
holds even if a future policy is written too permissively.

#### Scenario: Nobody can edit a message
- **WHEN** any rider — including its author and including the ride's organizer — attempts to
  UPDATE `ride_messages`
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL be backed by the absent grant as well as the absent policy, so that a
  future policy written too permissively does not open it

#### Scenario: A rider deletes their own message
- **WHEN** the author of a message deletes it
- **THEN** the delete SHALL succeed and the message SHALL disappear for every crew member

#### Scenario: An organizer moderates their own ride's chat
- **WHEN** the ride's organizer deletes a message authored by someone else on that ride
- **THEN** the delete SHALL succeed

#### Scenario: Nobody else can delete anything
- **WHEN** a crew member who is neither the author nor the organizer attempts to delete a message
- **THEN** the statement SHALL match zero rows and the message SHALL survive
- **AND** the surviving row SHALL be the assertion, because a DELETE filtered by `USING` succeeds
  against zero rows rather than raising

#### Scenario: KNOWN GAP — an organizer cannot delete a message they cannot see
- **WHEN** the ride's organizer has blocked a crew member and attempts to delete that rider's
  message by id
- **THEN** the statement SHALL match zero rows and silently report success, because Postgres
  applies the SELECT policy whenever a statement reads columns and a `WHERE` clause reads them
- **AND** this SHALL be recorded as a KNOWN GAP rather than presented as working, exactly as
  `011` §1b measured it for comments
- **AND** this change SHALL NOT build the `security definer` moderation RPC that closes it, and
  SHALL NOT invent a different mechanism — the shape of the eventual fix is `011`'s
  `moderate_comment`, written down in `design.md` §D4

#### Scenario: No delete affordance ships in the first pass
- **WHEN** the chat screen is built
- **THEN** it SHALL offer no delete control, because the design's only chat menu is
  `Content / Context Menu / Chat`, which contains Pin and Mute and nothing else
- **AND** the policy SHALL still exist, so that the remedy for a message a rider regrets is a
  deploy rather than a migration

### Requirement: A message's identity, order and time SHALL be owned by the server

`created_at` SHALL be written by the database on every insert, whatever the client sends.
Ordering SHALL derive from `created_at` with a deterministic tiebreak, never from a device clock.
`id` SHALL be supplied by the client and SHALL serve as the idempotency key for a retry.

A column DEFAULT is not a rule: `authenticated` holds INSERT and PostgREST lets a client name any
column, so a DEFAULT applies only when the column is omitted. In a chat, ordering **is** the
product — a message stamped with the year 3000 pins itself to the top of every crew member's
thread for ever, and the only remedy is a delete the design ships no control for. `CLAUDE.md` is
explicit that anything not expressed as a CHECK, trigger or policy is advisory.

#### Scenario: A client-supplied timestamp is overwritten, not merely ignored
- **WHEN** a rider inserts a message naming `created_at` with any value, past or future
- **THEN** the stored value SHALL be server time
- **AND** this SHALL be enforced by a trigger or a revoked column grant, never by the client
  omitting the column

#### Scenario: Ordering is stable across ties
- **WHEN** two messages carry the same `created_at`
- **THEN** the order SHALL still be deterministic, by a documented tiebreak on `id`
- **AND** the tiebreak SHALL be the same in the index, in the read query and in the pagination
  cursor, so a row cannot appear twice or vanish between pages

#### Scenario: The device clock never orders anything
- **WHEN** a message is rendered, sorted, grouped by day, or reconciled against an optimistic row
- **THEN** the ordering SHALL come from the server's `created_at`
- **AND** a device with a skewed clock SHALL NOT be able to sort its own message into the past or
  the future of anyone's thread

#### Scenario: A retry with the same id creates one message, not two
- **WHEN** a send times out and the client cannot know whether the row landed, and the rider
  retries
- **THEN** exactly one message SHALL exist afterwards
- **AND** the client SHALL reuse the id it generated for the first attempt rather than generating
  a new one
- **AND** a `23505` on that id SHALL be treated as success, because it proves the first attempt
  landed

#### Scenario: A chosen id gains nothing
- **WHEN** a rider supplies an id that already exists
- **THEN** the insert SHALL be refused by the primary key
- **AND** it SHALL NOT overwrite anything, because there is no UPDATE policy and no UPDATE grant

#### Scenario: An author cannot be forged
- **WHEN** a rider inserts a message naming another rider as `author_id`
- **THEN** the write SHALL be refused

#### Scenario: A message body has bounds the database enforces
- **WHEN** a rider sends a message that is empty, whitespace-only, or longer than the bound
- **THEN** the write SHALL be refused by a CHECK constraint
- **AND** the floor SHALL apply to the trimmed length and the ceiling to the raw length, so that
  padding cannot smuggle a longer body past a trimmed check, matching
  `postcard_comments_body_length`
- **AND** the Zod schema SHALL own the message and never the guarantee, because the client owns
  the mutation path and can decline to run it

### Requirement: The chat screen SHALL tell its three kinds of zero rows apart

The screen SHALL distinguish "the ride is not available to you", "you are not on this crew" and
"the crew has not said anything yet", and SHALL NOT render one state for all three.

RLS returns zero rows for all of them and they are identical from the client. Here the rider
**can** act on the difference — the middle case is one tap from being resolved — which is exactly
the condition `client-render-shell` attaches its permission-denied requirement to.

#### Scenario: An invisible ride is a not-found
- **WHEN** the ride itself is not returned — blocked, a private club the viewer is not in,
  deleted, or an id that is not a UUID
- **THEN** the screen SHALL render not-found for the ride
- **AND** it SHALL NOT reveal whether the ride exists

#### Scenario: A visible ride the viewer is not on says how to join
- **WHEN** the ride is visible and the viewer is not on its crew
- **THEN** the screen SHALL say the chat is for the ride's crew and SHALL offer the RSVP control
- **AND** it SHALL NOT render the empty state, which would tell the rider the crew has said
  nothing when in fact they are not being shown it

#### Scenario: A crew member with no messages sees the empty state
- **WHEN** the viewer is on the crew and the thread has no messages they can see
- **THEN** the screen SHALL render an empty state inviting them to start
- **AND** this SHALL be the same state whether the thread is genuinely empty or every message in
  it is hidden by a block, because distinguishing them discloses the block

#### Scenario: Loading is distinct from empty
- **WHEN** the screen mounts and the thread has not arrived
- **THEN** it SHALL render a loading state distinct from the empty state
- **AND** "no messages yet" SHALL NOT appear at any point during a successful load

#### Scenario: A failed read offers a retry and does not read as empty
- **WHEN** the thread read fails
- **THEN** the screen SHALL say it could not load and SHALL offer a retry
- **AND** it SHALL NOT display the PostgREST code or the failing relation

#### Scenario: Offline refuses a send rather than queuing it
- **WHEN** a rider sends a message with no connectivity
- **THEN** the send SHALL fail with a message saying it did not send, and SHALL NOT be queued for
  later delivery
- **AND** the composer SHALL retain what the rider typed
- **AND** this SHALL hold notwithstanding that a chat is the most tempting place in the app to
  build a queue, because durable offline queuing is deferred by a standing requirement

#### Scenario: A failed send never looks sent
- **WHEN** an optimistic message fails to reach the database
- **THEN** it SHALL be shown as failed with a retry affordance, or removed
- **AND** it SHALL NOT remain rendered indistinguishably from a delivered message

#### Scenario: A partial failure costs only its own region
- **WHEN** the thread loads but the crew count, an avatar or a signed URL fails
- **THEN** the thread SHALL still render
- **AND** the failed region SHALL show its own fallback rather than replacing the screen

#### Scenario: The composer's absence is not the enforcement
- **WHEN** a non-crew rider reaches the screen
- **THEN** the composer SHALL NOT be rendered
- **AND** the database SHALL refuse the insert regardless, so that a direct call gains nothing

### Requirement: The thread SHALL be paginated, and SHALL NOT be read whole

The first read SHALL fetch a bounded page of the most recent messages. Older messages SHALL be
fetched by a keyset cursor, not an offset.

A chat is the only list in this app with no natural ceiling. `order by created_at asc` on a long
thread reads the whole thread to find the end, and `offset` double-counts and skips whenever a
row lands between pages — which in a chat happens constantly, because new rows land at the end
while the rider is paging backwards.

#### Scenario: The first page is bounded and reads from the end
- **WHEN** a rider opens a thread of any length
- **THEN** a bounded page of the most recent messages SHALL be fetched
- **AND** the query SHALL be ordered descending and reversed for render, rather than ordered
  ascending over the whole thread

#### Scenario: Older messages page by cursor
- **WHEN** the rider scrolls back past the first page
- **THEN** the next page SHALL be fetched by a keyset cursor on the same `(created_at, id)`
  ordering
- **AND** `offset` SHALL NOT be used, because rows arriving during paging would make it skip and
  duplicate

#### Scenario: A ten-thousand-message thread behaves the same as a ten-message one
- **WHEN** a thread grows to any size
- **THEN** the first paint SHALL cost one bounded query
- **AND** an index SHALL exist that serves it without a sequential scan

#### Scenario: A new message arriving during paging does not disturb the reader
- **WHEN** a message arrives while the rider is reading older messages
- **THEN** the scroll position SHALL be preserved
- **AND** the content the rider is reading SHALL NOT be displaced

### Requirement: Ride messages SHALL have a stated retention, and its absence SHALL be a decision

Ride messages SHALL be removed with their ride and with their author's account, and any further
retention rule SHALL be stated rather than left unstated.

A chat message is personal data and is more disclosive than most of what this app stores: it is a
conversation between identified people about being in a specific place at a specific time.
Nothing else in this schema carries a retention window either, which is worth naming rather than
letting chat inherit the silence — and it stops being tolerable the day background location
tracking lands, because a thread saying "meet at the bridge at 07:00" is the same class of record
as the GPS track that follows it.

#### Scenario: Deleting the ride destroys its chat
- **WHEN** a ride is deleted
- **THEN** every message on it SHALL be removed by cascade

#### Scenario: The organizer's account deletion destroys everyone's messages on their rides
- **WHEN** a rider who organises rides deletes their account
- **THEN** those rides SHALL be removed — `rides.organizer_id` is `ON DELETE CASCADE` — and every
  message on them SHALL go with them, including messages authored by other riders
- **AND** this SHALL be stated as a consequence of the erasure rather than discovered, because it
  is two cascade levels deep and invisible in any single foreign key

#### Scenario: A departing rider's own messages are hard-deleted from every thread
- **WHEN** a crew member deletes their account
- **THEN** their `ride_messages` rows SHALL be removed from every thread they wrote in
- **AND** the thread SHALL close the gap rather than render a tombstone or a "deleted user"
  byline, matching the ruling already made for comments
- **AND** the resulting conversation with one participant's half removed SHALL be accepted,
  because a tombstone is a retained identifier of an account reported as erased

#### Scenario: There is no automatic expiry, and that is recorded rather than assumed
- **WHEN** this change ships
- **THEN** no scheduled deletion SHALL exist, so a message lives as long as its ride
- **AND** nothing SHALL delete a past ride, so retention SHALL be understood as indefinite
- **AND** this SHALL be an open question owned by the product owner with a stated default, not an
  omission

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Pin, Mute, attachments, typing indicators, presence, push, read state and unread badges SHALL NOT
be rendered as disabled or non-functional controls.

A control that renders and does nothing is a worse artifact than an absent one, because it looks
finished — the reasoning `RideHeader` already applies to the two buttons it omits, and the same
reasoning that removed the Inbox tab (PD-100) rather than shipping it disabled.

#### Scenario: Pin and Mute are absent, not disabled
- **WHEN** the chat screen is built
- **THEN** the header's options control SHALL be omitted rather than opening a menu whose two
  rows do nothing
- **AND** the reason SHALL be recorded: Pin orders a chat list that has not existed since the
  Inbox tab was removed, and Mute suppresses notifications that do not exist

#### Scenario: The unread badge extends the existing watermark model or is not built
- **WHEN** unread state is eventually built
- **THEN** it SHALL extend the per-audience read watermark that already exists for the feed —
  one row per rider per audience, bounded by membership rather than by content
- **AND** it SHALL NOT introduce a per-message read table, and SHALL NOT be computed by fetching
  every message and counting in the client

#### Scenario: No rate limit exists and that is recorded
- **WHEN** a crew member sends messages as fast as the network allows
- **THEN** nothing SHALL stop them
- **AND** this SHALL be a stated known gap, because nothing in this app rate-limits anything and
  inventing a mechanism for one table would be the only one of its kind
