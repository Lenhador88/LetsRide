# ride-threads (delta)

> **New capability.** It replaces `ride-chat`, which this change removes in full. Every
> requirement below is ADDED and none is MODIFIED, so this delta collides with no other active
> change.
>
> **Every requirement is a statement about a role and a resource, so each maps onto an assertion in
> `supabase/tests/rls_test.sql`.** The two exceptions are named where they appear: whether Supabase
> Realtime applies the SELECT policy per subscriber cannot be asserted on plain Postgres and lives
> in `realtime-subscriptions`, and the screen-state requirements are the walk's and the component
> tests'.
>
> **Table names used throughout:** `public.ride_threads`, `public.ride_thread_messages`,
> `public.ride_thread_reads`. The message table is deliberately **not** `ride_messages` — see
> `proposal.md` §Naming and `design.md` D2.

## ADDED Requirements

### Requirement: A ride's threads SHALL be readable and writable by its crew, and by nobody else

`public.ride_threads` and `public.ride_thread_messages` SHALL be reachable only by riders who are
the ride's organizer or who hold a `public.ride_members` row for that ride. The audience SHALL be
**narrower** than the `rides` SELECT policy, which admits any signed-in rider to a public ride and,
since `083`, any holder of a live invite.

The narrowing SHALL be expressed as `private.is_ride_crew(uuid)` — the existing `034` helper, reused
with no change to its body, signature or grant — in **conjunction** with an `EXISTS` against `rides`
evaluated as the caller. Neither half alone is the audience.

**Seeing a ride is not being on it, and being invited to a ride is not being on it either.** These
are two different riders and both can reach the ride detail screen.

#### Scenario: The organizer reads and writes with no `ride_members` row
- **WHEN** the rider named in `rides.organizer_id` reads or writes a thread on their own ride while
  holding no `ride_members` row at all
- **THEN** both SHALL succeed, because `private.is_ride_crew` carries an organizer arm
- **AND** the arm SHALL remain in place even though `103` now seeds the creator's membership row,
  because `103`'s delete guard binds `authenticated` only and a host locked out of their own ride's
  conversation is a worse failure than a redundant `or exists`

#### Scenario: A crew member reads and writes, and `maybe` has exactly the same rights as `going`
- **WHEN** a rider holding a `ride_members` row of status `going` or of status `maybe` reads or
  writes
- **THEN** both SHALL succeed, identically
- **AND** there SHALL be no read-only tier, because crew membership is the **presence** of the row
  and never its status

#### Scenario: A rider who can see the ride but has not RSVP'd reads nothing and writes nothing
- **WHEN** a signed-in rider who is not the organizer and holds no `ride_members` row reads
  `ride_threads` or `ride_thread_messages` for a ride they *can* see — a public ride with no club,
  or a public club's public ride
- **THEN** zero rows SHALL be returned from both tables
- **AND** an insert into either SHALL be refused
- **AND** the refusal SHALL come from the crew predicate, not from the ride being invisible, and
  SHALL be asserted in isolation so that a later edit cannot remove one conjunct while the suite
  stays green

#### Scenario: A rider holding a PENDING ride invite reads the ride and none of its threads
- **WHEN** a rider whose `ride_invites` row is `pending` opens the ride
- **THEN** the ride SHALL be readable, through `083`'s fourth audience arm
- **AND** zero `ride_threads` rows SHALL be returned, because a pending invite creates no
  `ride_members` row and `private.is_ride_crew` therefore answers false
- **AND** an insert SHALL be refused
- **AND** this SHALL be asserted, because it is the one case where a rider provably reaches the ride
  detail screen and must not reach its conversation

#### Scenario: A rider who ACCEPTED an invite to a private club's ride reads its threads and no part of the club
- **WHEN** a rider who is not a member of the ride's private club accepts an invite to that ride,
  gaining a `ride_members` row through `join_ride_from_invite`
- **THEN** the ride's threads SHALL be readable and postable
- **AND** the thread rows SHALL carry a `ride_id` and no club identifier, name or description, so
  nothing about the private club is disclosed by reading them
- **AND** the club's own `club_threads` SHALL remain unreadable to them, unchanged by this capability
- **AND** this is `proposal.md` Q1: the default is stated here so the build is not blocked, and it
  is the one place this change lets a non-member read text written inside a private club's orbit

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for either table arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on either table
- **AND** this change SHALL add none, per decision #1
- **AND** the assertion SHALL be scoped to the grantee, or use `has_table_privilege`, because a
  table-wide grant count reads non-zero against a correct database — `postgres` and `service_role`
  hold everything by Supabase default

### Requirement: Thread visibility SHALL be the intersection of ride visibility and crew membership, restated at every level

The SELECT policy on **each** of `ride_threads` and `ride_thread_messages` SHALL require **both**
that the caller can see the ride under their own row security **and** that they are on its crew. The
grandchild SHALL restate the full audience rather than relying on a one-hop `EXISTS` against
`ride_threads`.

`private.is_ride_crew` is `security definer`, so RLS does not apply inside it — which is the point of
the instrument and here is the hazard. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)`, a private-club predicate and `083`'s invite arm;
a definer helper asking only *"do I hold a crew row"* sees none of them. A `ride_members` row
survives every event that takes the ride away, so *"holds a crew row"* and *"can see the ride"* are
**independent**.

**`034`'s own header records that its first draft used the crew predicate INSTEAD of the parent
`EXISTS` and shipped a leak.** That draft is the most likely thing a build re-derives, because
`private.is_club_member` has the identical shape and no such gap — `clubs` deliberately carries no
block predicate, so there is nothing for a definer call to skip past. `rides` carries three.

The restatement at the grandchild follows `082`'s ruling for `club_messages`, and for its reason:
the audience is then discoverable from the policy text, and a change to the thread policy cannot
silently retarget the messages.

#### Scenario: A crew member who blocks the organizer loses the threads
- **WHEN** a crew member blocks the ride's organizer, or is blocked by them, and their `ride_members`
  row is untouched
- **THEN** zero rows SHALL be returned from both tables
- **AND** inserts into both SHALL be refused
- **AND** the refusal SHALL come from the ride-visibility conjunct, asserted in isolation, because
  the crew conjunct alone would admit them
- **AND** it SHALL be asserted with the two riders exchanged, because the `blocks` row is directional
  and the effect symmetric

#### Scenario: A rider who left the club but kept a `ride_members` row loses the threads
- **WHEN** a rider holding a `ride_members` row for a private club's ride leaves that club, and
  nothing removes the crew row
- **THEN** zero rows SHALL be returned from both tables, because `022` pins a private club's ride to
  `is_public = false` and `rides` SELECT then admits club members only
- **AND** an insert SHALL be refused
- **AND** this SHALL be asserted **separately** from the blocking case, because a single assertion
  cannot say which conjunct did the work
- **AND** this is the exact hole `034`'s header records having fallen into once; it is closed here by
  composition and not by any new predicate

#### Scenario: A club turning private takes its rides' threads with it
- **WHEN** a public club is set private and its rides therefore cease to be public
- **THEN** crew members who are not members of that club SHALL stop reading those rides' threads
- **AND** their existing threads and messages SHALL remain readable to the club's own members who are
  on the crew, per the leaving rule below

#### Scenario: A message in a thread the caller may not read is not reachable by id
- **WHEN** a rider queries `ride_thread_messages` directly by a known message id, bypassing the
  thread list
- **THEN** the restated audience on the message policy SHALL refuse it independently of the thread
  policy
- **AND** removing the restatement SHALL fail at least one assertion rather than passing quietly,
  because a one-hop `EXISTS` against `ride_threads` would appear to work while making the message
  audience a silent function of somebody else's policy

#### Scenario: The ride-visibility conjunct is not simplified away
- **WHEN** either policy is reviewed, refactored or replaced
- **THEN** the `EXISTS` against `rides` SHALL remain on both, and each SHALL carry a policy comment
  saying why
- **AND** removing it SHALL fail at least two assertions

### Requirement: The own-row arm SHALL sit above the block conjunct and below the crew and ride-visibility conjuncts

In every new SELECT policy, the arm admitting a rider to their own row SHALL be placed **inside** the
block-dominated group — `<ride EXISTS> and is_ride_crew(...) and (author_id = auth.uid() or not
private.is_blocked(auth.uid(), author_id))` — and SHALL NOT be hoisted to the top level.

This placement is load-bearing and has already been a defect seven times over in this repo (`102`,
PD-362). Two failures sit on either side of it:

- **Too low** — written as `... and not is_blocked(...)` with the own-row arm omitted or buried
  inside the block conjunct where `blocks_no_self_block` makes it a no-op — and a rider loses sight
  of what they themselves wrote the moment someone blocks them.
- **Too high** — hoisted above `is_ride_crew` or above the ride `EXISTS` — and the audience stops
  being an intersection, which is this capability's central invariant. `docs/HANDOFF.md` records
  this exact refusal for `ride_messages`: *"hoisting past `is_ride_crew` would break the documented
  invariant that this table's audience is an INTERSECTION."*

#### Scenario: A blocked author still reads their own thread and their own messages
- **WHEN** rider A has written a thread and messages on a ride, and rider B — also on the crew —
  blocks A
- **THEN** A SHALL still read A's own thread and messages, because the own-row arm dominates the
  block conjunct
- **AND** B SHALL NOT see A's thread or A's messages
- **AND** A SHALL NOT see B's

#### Scenario: An ex-crew member does not read their own messages either
- **WHEN** a rider leaves the crew of a ride they can still see, and reads back
- **THEN** zero rows SHALL be returned, including their own
- **AND** this SHALL be the *intended* consequence of the own-row arm sitting below `is_ride_crew`,
  stated here rather than discovered
- **AND** the remedy for the row they can no longer reach SHALL be the deletion RPC below, which is
  not subject to the SELECT policy — so the arm's placement costs the rider nothing they cannot undo

#### Scenario: The placement is pinned per policy
- **WHEN** any of the three new tables' policies is written
- **THEN** the migration SHALL record, at each policy, where the own-row arm sits and why
- **AND** an assertion SHALL exist that fails if it is hoisted, rather than the placement resting on
  a comment

### Requirement: Deletion SHALL go through a `security definer` RPC, and neither message nor thread SHALL carry a DELETE policy

`public.ride_thread_messages` SHALL have **no DELETE policy and no DELETE grant** for any client
role. Deletion SHALL be `public.delete_own_ride_thread_message(uuid)`. Thread removal SHALL be
`public.moderate_ride_thread(uuid)`, whose authority arm is `rides.organizer_id`.

**RLS filters a DELETE by what the caller may READ** — Postgres applies the SELECT policy whenever a
statement's `WHERE` reads a column, measured on Postgres 17.6 and recorded in `082`. A policy-based
delete therefore reports success against zero rows whenever the row is invisible to the very rider
entitled to remove it. `034` shipped that gap for both the author and the organizer, and `102`
deliberately left `ride_messages`' residual silent `DELETE 0` open rather than break the
intersection. An RPC has no such gap because it is not subject to the SELECT policy at all.

#### Scenario: An author erases their own message after being blocked
- **WHEN** the author of a message is blocked by the thread's author, and calls
  `delete_own_ride_thread_message` with their own message id
- **THEN** the message SHALL be deleted
- **AND** this SHALL be the case that a DELETE policy could not serve, and SHALL be asserted as such

#### Scenario: An ex-crew member erases their own message
- **WHEN** a rider who has left the crew calls the RPC with a message they wrote while on it
- **THEN** the message SHALL be deleted
- **AND** the function SHALL scope on `author_id = auth.uid()` and SHALL NOT additionally require
  current crew membership, because that requirement is what created the stranded row

#### Scenario: Nobody deletes anybody else's message
- **WHEN** any rider calls `delete_own_ride_thread_message` with a message they did not author
- **THEN** nothing SHALL be deleted
- **AND** the function SHALL NOT disclose whether the id exists

#### Scenario: The ride's organizer removes a thread, and nobody else can
- **WHEN** the rider named in `rides.organizer_id` calls `public.moderate_ride_thread` for a thread
  on their own ride
- **THEN** the thread SHALL be removed and its messages SHALL go with it by cascade
- **AND** a crew member who is neither the organizer nor the thread's author SHALL be refused
- **AND** a club owner or admin SHALL NOT gain this power by virtue of the club, because the resource
  is the ride and a ride has no admin role — `proposal.md` Q2
- **AND** the organizer SHALL be able to remove a thread whose author has blocked them, which is the
  whole reason this is an RPC

#### Scenario: A thread's author removes their own thread
- **WHEN** the rider who started a thread removes it
- **THEN** it SHALL be removed with its messages
- **AND** the messages of other riders inside it SHALL go too, which SHALL be disclosed in the
  confirmation copy rather than discovered

#### Scenario: Nothing is editable
- **WHEN** any rider — including an author and including the organizer — attempts to UPDATE
  `ride_threads` or `ride_thread_messages`
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL be backed by the absent grant as well as the absent policy, so a future
  policy written too permissively does not open it
- **AND** neither table SHALL carry an `updated_at` column, because a column that cannot move
  documents an intention rather than a fact

#### Scenario: Every new function's reachability is asserted by role, not by calling it
- **WHEN** the RPCs are added
- **THEN** `authenticated` SHALL hold EXECUTE and `anon` SHALL hold none, asserted with
  `has_function_privilege` naming the role
- **AND** this SHALL NOT be checked by calling the function, because the RLS suite runs as the table
  owner, for whom neither barrier exists — `029` is the precedent for what that misses

### Requirement: A thread's and a message's identity, order and time SHALL be owned by the server

`created_at` SHALL be written by the database on every insert of either table, whatever the client
sends. Ordering SHALL derive from `created_at` with a deterministic `id` tiebreak. `id` SHALL be
supplied by the client and SHALL serve as the idempotency key for a retry.

A column DEFAULT is not a rule: `authenticated` holds INSERT and PostgREST lets a client name any
column, so a DEFAULT applies only when the column is **omitted**. The guarantee is the per-column
INSERT grant, following `034` §4b and `081` §3.

#### Scenario: A client-supplied timestamp is not merely ignored
- **WHEN** a rider inserts a thread or a message naming `created_at` with any value
- **THEN** the statement SHALL be refused, because the column is withheld from the INSERT grant
- **AND** a thread list sorts on this column, so a client-stamped value would pin a thread to the top
  of a ride for ever

#### Scenario: An author cannot be forged
- **WHEN** a rider inserts a row naming another rider as `author_id`
- **THEN** the write SHALL be refused

#### Scenario: A retry with the same id creates one row, not two
- **WHEN** a send times out and the rider retries
- **THEN** exactly one row SHALL exist afterwards, because the client reuses the id it generated
- **AND** a `23505` on that id SHALL be treated as success
- **AND** the duplicate SHALL disclose nothing, because RLS evaluates WITH CHECK before the index
  insert, so a caller who is not on the crew is refused `42501` and never reaches `23505`

#### Scenario: Ordering is stable across ties and the device clock never orders anything
- **WHEN** two rows carry the same `created_at`
- **THEN** the order SHALL be deterministic by `id`
- **AND** the same `(created_at, id)` tiebreak SHALL be used in the index, the read query and the
  pagination cursor, so a row cannot appear twice or vanish between pages

#### Scenario: Text bounds are enforced by the database
- **WHEN** a title or a body is empty, whitespace-only, or over its bound
- **THEN** the write SHALL be refused by a CHECK constraint
- **AND** the floor SHALL be `~ '\S'` rather than `length(btrim(x)) >= 1`, because `btrim` with no
  second argument strips spaces only and would accept a body of newlines — making the client
  **stricter** than the database, the exact inversion CLAUDE.md's Zod rule exists to prevent
- **AND** the ceiling SHALL apply to the raw length so padding cannot smuggle a longer body past a
  trimmed check
- **AND** the bounds SHALL match the club's — 80 for a title, 1000 for a body — so one Zod schema
  shape serves both domains

#### Scenario: The participation gate reaches both new tables
- **WHEN** an account that has not called `accept_terms()` inserts into either table
- **THEN** the write SHALL be refused by `enforce_participation_gate`
- **AND** both tables SHALL carry the trigger, raising the gated-table count by two, which
  `docs/reference/schema.md` §The participation gate SHALL record

### Requirement: A thread SHALL appear on the ride's timeline, bounded by thread count and never by message count

The ride timeline SHALL gain a thread-creation source and a latest-reply source, mirroring
`mergeClubTimeline`'s `thread` and `reply` arms. Each SHALL contribute **at most one row per
thread**.

`src/lib/data/ride-timeline.ts` argues that the ride does not page because *"a ride is a bounded
event with two sources"*. A conversation is the first source on a ride with **no natural ceiling**.
The argument survives only under the bound above; without it, a single busy thread would fill the
ride's timeline and the display cap would silently hide the ride's own postcards and joins.

#### Scenario: The replies source collapses to one row per thread
- **WHEN** the latest-reply source is read for a ride with two threads holding two hundred messages
  between them
- **THEN** it SHALL return two rows
- **AND** the bound SHALL be a property of the read, not of the display cap

#### Scenario: A busy thread does not push the ride's own history off its timeline
- **WHEN** a ride has more threads than `RIDE_TIMELINE_LIMIT`
- **THEN** the timeline SHALL cut at its horizon and say so at the foot, exactly as it does for
  postcards and joins
- **AND** the thread list screen SHALL remain the complete view

#### Scenario: The ride's completeness derivation is not weakened to the club's
- **WHEN** the thread sources are added to `mergeRideTimeline`
- **THEN** it SHALL keep deriving completeness from *"no source declared a horizon"*
- **AND** it SHALL NOT adopt `mergeClubTimeline`'s *"the horizon filter dropped nothing"*, which
  `docs/HANDOFF.md` records as reachable-wrong precisely through a per-thread-collapsed reply source
  — the source being added here

#### Scenario: A timeline thread row is refused to a rider who may not read the thread
- **WHEN** a rider who can see the ride but is not on its crew loads the ride timeline
- **THEN** no thread row SHALL appear, because the read returns zero rows under RLS
- **AND** the absence SHALL come from the policy and SHALL NOT be a client-side filter

### Requirement: The ride detail's create affordance SHALL offer both entrances or neither, from one decision

`resolveRideDetailActions` SHALL remain the single place that decides what the ride detail's sticky
bottom slot and its timeline `(+)` fallback do. Its `create` outcome SHALL open a sheet listing a
postcard tagged to the ride and a new thread, rather than linking straight to the postcard composer.

PD-401 built the one-action version and said explicitly not to pre-build the sheet. This is the
story that owns the second action, and the property PD-401 protected — *"a crew member is offered
exactly one entrance … never two and never none"* — SHALL survive the sheet.

#### Scenario: A crew member on a past ride gets the create bar, and it opens a sheet
- **WHEN** a crew member opens a ride that is not upcoming, so no RSVP bar claims the slot
- **THEN** the create bar SHALL own the slot and SHALL open a two-entry sheet
- **AND** the timeline heading SHALL NOT also draw its `(+)`, so the rider has exactly one entrance

#### Scenario: A crew member on an upcoming ride they do not organize keeps the RSVP bar and gets the `(+)`
- **WHEN** the RSVP bar claims the slot
- **THEN** the timeline heading's `(+)` SHALL open the **same** sheet, not the postcard composer
- **AND** the two entrances SHALL never both render

#### Scenario: A non-crew rider gets neither entrance
- **WHEN** a rider who is not on the crew opens the ride
- **THEN** neither the create bar nor the `(+)` SHALL render
- **AND** the database SHALL refuse both writes regardless, so a direct call gains nothing —
  `041` requires `private.is_ride_crew` to tag a postcard, and this capability requires it to
  start a thread

#### Scenario: The resolver's case table is exhaustive and grows with the sheet
- **WHEN** `resolveRideDetailActions` is changed
- **THEN** its test SHALL enumerate every combination of its inputs, not a sample
- **AND** the day the postcard predicate and the thread predicate can differ — they are the same
  `is_ride_crew` today — `canCreate` SHALL split into two booleans and the table SHALL double,
  which is recorded here so it is not rediscovered

### Requirement: The thread surfaces SHALL define every state they can be in, and SHALL tell four kinds of zero rows apart

The thread list and the thread screen SHALL each distinguish: the ride is not available to you, you
are not on this crew, the crew has started no threads, and this thread has no messages you can see.
RLS returns zero rows for all four and they are identical from the client.

#### Scenario: An invisible ride is a not-found
- **WHEN** the ride is not returned — blocked, a private club the viewer is not in, deleted, or an id
  that is not a UUID
- **THEN** not-found SHALL render for the ride, and it SHALL NOT reveal whether the ride exists

#### Scenario: A visible ride the viewer is not on says how to join
- **WHEN** the ride is visible and the viewer is not on its crew
- **THEN** the screen SHALL say the conversation is for the ride's crew and SHALL offer the RSVP
  control
- **AND** it SHALL NOT render the empty state, which would tell the rider the crew has said nothing
  when in fact they are not being shown it
- **AND** this is `client-render-shell`'s permission-denied rule, which attaches exactly where the
  rider can act on the difference — here they are one tap from resolving it

#### Scenario: A crew member with no threads sees the empty state
- **WHEN** the viewer is on the crew and no thread is visible to them
- **THEN** an empty state inviting them to start one SHALL render
- **AND** it SHALL be the same state whether no thread exists or every thread is hidden by a block,
  because distinguishing them discloses the block

#### Scenario: Loading is distinct from empty, and gates on data
- **WHEN** either screen mounts and its data has not arrived
- **THEN** a loading state distinct from the empty state SHALL render
- **AND** the gate SHALL be the data, never `isLoading`, which is `false` on the first pass before
  the effect has issued the fetch
- **AND** "no threads yet" SHALL NOT appear at any point during a successful load

#### Scenario: A failed read offers a retry and does not read as empty
- **WHEN** a read fails
- **THEN** the screen SHALL say so and offer a retry
- **AND** it SHALL NOT display the PostgREST code or the failing relation

#### Scenario: A partial failure costs only its own region
- **WHEN** the thread loads but an avatar, an unread mark or the crew count fails
- **THEN** the thread SHALL still render and the failed region SHALL show its own fallback

#### Scenario: Offline refuses a send rather than queuing it
- **WHEN** a rider posts with no connectivity
- **THEN** the send SHALL fail saying it did not send, SHALL NOT be queued for later delivery, and
  the composer SHALL retain what the rider typed
- **AND** this SHALL hold notwithstanding that a conversation is the most tempting place in the app
  to build a queue

#### Scenario: A failed send never looks sent
- **WHEN** an optimistic row fails to reach the database
- **THEN** it SHALL be shown as failed with a retry, or removed
- **AND** it SHALL NOT remain rendered indistinguishably from a delivered row

#### Scenario: The composer's absence is not the enforcement
- **WHEN** a non-crew rider reaches either screen
- **THEN** the composer SHALL NOT render, and the database SHALL refuse the insert regardless

#### Scenario: No gap is drawn where a blocked rider's thread or message was
- **WHEN** a list contains rows hidden from the viewer by a block
- **THEN** the remaining rows SHALL render contiguously
- **AND** no placeholder, greyed row, "hidden" marker or count including them SHALL appear
- **AND** a reply to a hidden message SHALL still be shown, the resulting non-sequitur accepted,
  because transitive hiding discloses the block by omission and has no defined stopping point

### Requirement: Messages SHALL page by keyset cursor, and the unread mark SHALL extend the watermark model

The first read of a thread SHALL fetch a bounded page of the most recent messages, ordered
descending and reversed for render. Older messages SHALL be fetched by a keyset cursor on
`(created_at, id)`. `offset` SHALL NOT be used.

Unread state SHALL be one `ride_thread_reads` row per rider per thread — the per-audience watermark
model the feed and the club already use — and SHALL NOT introduce a per-message read table or be
computed by fetching every message and counting in the client.

#### Scenario: A ten-thousand-message thread behaves like a ten-message one
- **WHEN** a thread grows to any size
- **THEN** the first paint SHALL cost one bounded query, served by an index without a sequential scan

#### Scenario: A new message arriving during paging does not disturb the reader
- **WHEN** a message arrives while the rider is reading older messages
- **THEN** the scroll position SHALL be preserved and the content being read SHALL NOT be displaced

#### Scenario: The watermark's clock is the server's on both sides of the comparison
- **WHEN** a rider marks a thread read
- **THEN** the stamp SHALL be written by a trigger, not by the client, following `061` §3 and `081`
- **AND** withholding the column grant SHALL NOT be relied on as the mechanism, because the upsert's
  UPDATE arm must name the column

#### Scenario: A rider keeps their own watermark after leaving the crew
- **WHEN** a rider leaves a ride's crew
- **THEN** their `ride_thread_reads` rows SHALL remain their own rows and SHALL NOT strand
- **AND** the read policy on that table SHALL be scoped to `user_id = auth.uid()` and SHALL NOT carry
  a ride-visibility conjunct, because a watermark discloses nothing about content

#### Scenario: The unread mark is per-viewer and is not a fact about the ride
- **WHEN** two crew members read the same thread list
- **THEN** each SHALL see their own marks, keyed to the signed-in rider
- **AND** the key SHALL NOT survive a sign-out

### Requirement: Blocking SHALL be enforced in RLS across every thread surface, and applied to the row's own author

The block predicate SHALL be `private.is_blocked`, never a query against `blocks` from a policy, and
SHALL be applied to `ride_threads.author_id` and to `ride_thread_messages.author_id`
**independently** — a thread by an unblocked author may hold messages by a blocked one.

#### Scenario: Two crew members who have blocked each other see different threads
- **WHEN** crew members A and B are both on a ride and A has blocked B
- **THEN** A SHALL NOT see B's threads or messages, and B SHALL NOT see A's, at the same time
- **AND** both SHALL remain on the crew and keep reading everyone else's
- **AND** it SHALL be asserted with A and B exchanged

#### Scenario: A blocked rider's messages disappear from a thread that remains visible
- **WHEN** the viewer has blocked a rider who replied in a thread started by somebody else
- **THEN** the thread SHALL remain visible and only that rider's messages SHALL be absent
- **AND** the thread's message count, if drawn, SHALL be the viewer's own count and SHALL NOT be
  reconciled against anyone else's

#### Scenario: The block filter is never applied by a screen
- **WHEN** any thread surface renders
- **THEN** no component, data function or action SHALL filter by block
- **AND** the policy SHALL remain the single place the rule lives, per decision #2

### Requirement: Ride threads SHALL have a stated retention and a stated deletion consequence

Threads and messages SHALL be removed with their ride and with their author's account. Any further
retention rule SHALL be stated rather than left unstated.

#### Scenario: Deleting the ride destroys its threads
- **WHEN** a ride is deleted
- **THEN** every thread on it and every message in those threads SHALL be removed by cascade

#### Scenario: Deleting a thread's author destroys other riders' replies inside it
- **WHEN** the rider who started a thread deletes their account
- **THEN** the thread SHALL be removed by `author_id`'s `ON DELETE CASCADE`, and every message in it
  SHALL go with it **including messages authored by other riders**
- **AND** this SHALL be stated as a consequence of the erasure rather than discovered, because it is
  two cascade levels deep and invisible in any single foreign key
- **AND** it is a **new** consequence relative to the chat, which had no thread container — the club
  already made this call (`club_threads.author_id` is `ON DELETE CASCADE`) and this follows it

#### Scenario: The organizer's account deletion destroys everyone's conversation on their rides
- **WHEN** a rider who organises rides deletes their account
- **THEN** those rides SHALL be removed — `rides.organizer_id` is `ON DELETE CASCADE` — and every
  thread and message on them SHALL go with them

#### Scenario: A departing rider's own messages are hard-deleted, with no tombstone
- **WHEN** a crew member deletes their account
- **THEN** their messages SHALL be removed from every thread they wrote in
- **AND** the thread SHALL close the gap rather than render a tombstone or a "deleted user" byline,
  because a tombstone is a retained identifier of an account reported as erased

#### Scenario: There is no automatic expiry, and that is recorded rather than assumed
- **WHEN** this change ships
- **THEN** no scheduled deletion SHALL exist, so a thread lives as long as its ride
- **AND** nothing SHALL delete a past ride, so retention SHALL be understood as indefinite
- **AND** this SHALL remain an open question owned by the product owner with a stated default
  (`proposal.md` Q6), not an omission

### Requirement: A past ride's threads SHALL behave exactly as a current ride's

Nothing in the schema distinguishes a past ride from an upcoming one, and no policy SHALL invent the
distinction.

#### Scenario: A crew member reads and posts on a ride that has finished
- **WHEN** a crew member opens a ride whose `departure_at` is in the past
- **THEN** its threads SHALL be readable and postable, identically to an upcoming ride
- **AND** no policy SHALL reference `departure_at`, because a time-based policy is a rule whose truth
  changes with no write to observe — nothing would invalidate a cache or notify a screen

#### Scenario: The archive is the thread list, not a separate surface
- **WHEN** a rider looks for a conversation from a ride months ago
- **THEN** they SHALL find it on that ride's thread list, titled
- **AND** this is the half a chat never had and the reason the change exists

### Requirement: The retired chat SHALL leave no reachable surface behind

`/rides/detail/chat` SHALL not resolve, `routes.rideChat` and `detailPaths.rideChat` SHALL not
exist, and no shipped code SHALL reference `ride_messages` or `ride_reads`.

#### Scenario: A bookmarked chat URL does not dead-end
- **WHEN** a rider opens `/rides/detail/chat?id=<uuid>` from a bookmark or a stale tab
- **THEN** they SHALL reach the ride's thread list for that ride, or the ride detail, rather than a
  404 with no way forward
- **AND** the route guard SHALL still apply, because an unmatched URL renders the root layout and the
  guard — a deleted step's URL redirects rather than dead-ends

#### Scenario: The smoke walk stops walking a route that no longer exists
- **WHEN** `npm run walk` runs after this change
- **THEN** `/rides/detail/chat` SHALL be absent from its route list
- **AND** the ride's thread routes SHALL be present, with the thread id discovered from the ride's own
  thread list the way the club's already is
- **AND** a shrunken `N/N` SHALL be read as a skip rather than a pass

#### Scenario: The shared chat primitives survive
- **WHEN** the chat surface is deleted
- **THEN** `src/components/chat/ChatThread.tsx`, `ChatComposer.tsx`, `MarkChatSeen.tsx` and
  `src/lib/data/chat.ts` SHALL remain, because `src/app/(app)/clubs/detail/thread/page.tsx` imports
  all four and the new ride thread screen imports them too
- **AND** deleting them SHALL be caught by the type check rather than by a rider
