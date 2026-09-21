## MODIFIED Requirements

### Requirement: The timeline SHALL be derived from live rows, and what that omits SHALL be stated

The timeline holds no **event** rows of its own. Every entry is a live row in one of the sources,
so the stream is a view of the club's **current** state rather than a history of it. Four
consequences SHALL be treated as designed behaviour rather than defects, and SHALL be stated
wherever the timeline is described:

- **A rider who leaves erases their own join entry**, because the `club_members` row is deleted.
  A club that twenty riders joined and left shows a timeline claiming nothing happened.
- **A rider who leaves and rejoins appears to join for the first time**, at their new `joined_at`.
- **A deleted postcard, ride or thread removes its entry**, with no tombstone.
- **A wave dies with the entry it decorates**, which is new in this change. `club_join_waves`
  cascades from `club_members (club_id, user_id)` and `club_thread_waves` from `club_threads(id)`,
  so a leave, a thread deletion or an account deletion removes the reactions along with the row —
  and a rejoin starts at zero waves rather than inheriting the old ones.

There SHALL be no "a rider left" entry, in this change or in any successor built on this design: a
leave is a DELETE and there is no row to read.

**The timeline DOES now hold rows of its own in one narrow sense, and the distinction is the
point.** It holds *reaction* rows — `club_thread_waves` and `club_join_waves` — which are not
entries and never appear in `mergeClubTimeline`'s output. The earlier phrasing, *"the timeline
holds no rows of its own"*, would otherwise be read as still literally true and would make the two
new tables look like a contradiction of this capability rather than an extension of it.

#### Scenario: A leave takes its own join entry and its waves with it
- **WHEN** a rider leaves the club
- **THEN** their join entry SHALL disappear from every member's timeline
- **AND** every wave placed on that join SHALL be deleted by cascade
- **AND** no "left the club" entry SHALL appear

#### Scenario: A rejoin is indistinguishable from a first join, waves included
- **WHEN** a rider leaves and rejoins
- **THEN** a join entry SHALL appear at the new `joined_at` carrying **zero** waves
- **AND** no wave placed before the departure SHALL reappear

#### Scenario: `joined_at` cannot be forged
- **WHEN** a rider attempts to write `club_members.joined_at`
- **THEN** the write SHALL be refused, because `048` grants `authenticated` only
  `insert (club_id, role, user_id)` and `update (club_id, role, user_id)`
- **AND** a rider SHALL therefore be unable to place themselves, or a wave addressed to them,
  anywhere in another club's timeline

### Requirement: Timeline event rows SHALL be automatic only, and no authored announcement SHALL exist

Every event row SHALL be derived from an existing row's timestamp. There SHALL be no
rider-composed or admin-composed announcement, no announcements table, no composer, no pin and no
edit.

"Announcement" is the product owner's word for the automatic row and names nothing a rider writes.
It is stated as a prohibition rather than left unmentioned, because a changelog entry reading
"Announcements" invites the table.

**A wave does not breach this and the boundary SHALL be stated, because it is the obvious place for
the next change to cross.** A wave is a *reaction to* a derived row, carrying no text, no title and
no position in the stream; it cannot create an entry, cannot reorder one, and cannot change what
any entry says. What remains forbidden is anything that lets a role put words or an entry on the
timeline directly.

**A pre-filled thread composer is likewise not an authored announcement.** It writes an ordinary
`club_threads` row through the ordinary policy, authored by the rider who submitted it, appearing
as an ordinary `thread` event. The pre-filled title is a default in a form, not a record.

#### Scenario: No writable event surface is introduced
- **WHEN** the change is complete
- **THEN** no table, column, RPC, route or form SHALL exist that lets any role author a timeline
  entry directly
- **AND** the only way to put an entry on a club's timeline SHALL be to do the underlying thing —
  post, ride, start a thread, or join

#### Scenario: A wave changes no entry
- **WHEN** any number of riders wave an entry
- **THEN** the entry's sentence, timestamp, position and destination SHALL be unchanged
- **AND** no ordering in the stream SHALL depend on a wave count

### Requirement: The stream SHALL be totally ordered and SHALL NOT extend past its coherence horizon

Entries SHALL be sorted by their timestamp descending, with the row key descending as the tiebreak,
giving a total order. Each source SHALL be read with its own bound and SHALL **declare** the instant
below which its picture is incomplete, rather than the merge deriving it from the rows that
survived — a read that post-processes its window is the only thing that knows how far back it
looked. The **coherence horizon** SHALL be the **most recent** of the declared horizons, and the
stream SHALL NOT include any entry older than it.

**A wave read is NOT a source and SHALL declare no horizon.** It is scoped to the subject ids the
timeline already holds, so it is bounded by the timeline's bound and contributes no window over the
club's history. Adding a horizon for it would be worse than omitting one: the latest of the
declared horizons is the cut, so a decoration read's oldest row could truncate the stream it
decorates.

**The condition under which that changes SHALL be stated rather than discovered.** If a later
change draws a wave as its own entry — *"Ana waved at Bruno"* — it becomes a source and owes a
horizon like every other.

#### Scenario: The tail cannot claim an event that is missing
- **WHEN** one source saturates and another does not
- **THEN** the stream SHALL stop at the saturated source's oldest returned timestamp
- **AND** SHALL NOT contain an older entry from the unsaturated source, even though that entry
  was fetched

#### Scenario: An ordinary club reaches its own beginning
- **WHEN** no source saturates
- **THEN** there SHALL be no horizon, the stream SHALL run to the club's creation entry, and no
  handoff row SHALL be drawn

#### Scenario: Two events at one instant keep a stable order
- **WHEN** two entries share a timestamp
- **THEN** the row id SHALL break the tie
- **AND** the order SHALL be identical across reloads

#### Scenario: The horizon is the most recent of the oldest, not the oldest
- **WHEN** two sources are saturated with different oldest timestamps
- **THEN** the horizon SHALL be the **later** of the two
- **AND** entries between the two SHALL be excluded, because at least one source is already
  truncated there

#### Scenario: The merge rule is covered by a unit test rather than by inspection
- **WHEN** the horizon, the tiebreak, the saturation test and the two tail states are
  implemented
- **THEN** they SHALL live in a pure function with its own unit test
- **AND** each of the behaviours above SHALL have a case, because no other gate in this repo can
  see a silently truncated stream

#### Scenario: The horizon is unchanged by this change
- **WHEN** the wave reads are added
- **THEN** the set of declared horizons SHALL be exactly the five the timeline already computes
- **AND** the stream's length and cut point SHALL be identical to what they were before

#### Scenario: A wave read that returns nothing does not shorten the stream
- **WHEN** either wave read returns zero rows or fails outright
- **THEN** every entry SHALL still render
- **AND** `complete` SHALL be computed from the same five sources as before

### Requirement: A blocked rider SHALL be absent from every source, and an event whose actor cannot be named SHALL be dropped

Blocking SHALL be enforced by the source policies and by nothing the client adds. The conjunct per
source, each an own-row escape hatch OR-ed with the symmetric helper:

- `club_threads` — `(author_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), author_id))`
- `postcards` — `(author_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), author_id)) AND …)`
- `rides` — `(organizer_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), organizer_id)) AND …)`
- `club_members` — `… AND ((user_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), user_id)))`

`private.is_blocked(a, b)` is symmetric, so the directional row's direction SHALL NOT matter.

**The merge SHALL NOT reintroduce a blocked rider**, and it cannot take a row from anywhere the
policies have not already answered for.

**The one path the merge adds is the actor's name.** `profiles` SELECT is
`(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT private.is_blocked(auth.uid(), id)))` — a
separate predicate that can withhold a profile whose parent row arrived. An **event row** whose
actor profile is absent SHALL be dropped, never drawn nameless, extending the rule
`getClubMembers` already applies.

A **postcard entry** SHALL keep `PostcardStamp`'s existing `Rider` fallback, because a postcard is
a photo with a byline rather than a sentence about a person, and partial fidelity there does not
invert its message.

**A wave adds a fifth author column to that rule and SHALL be filtered by its own table's policy,
not by the entry's.** A thread by an unblocked author may carry a wave by a blocked rider, exactly
as `081` records that *"a thread by an unblocked author can hold messages by a blocked one"*. Both
wave tables therefore carry their own symmetric arm on `user_id`, and the client SHALL restate
neither.

**A wave SHALL NOT be attributed in the UI in this change.** No list of who waved is drawn, so the
"actor cannot be named" rule that drops an event does not arise for waves: there is no sentence
about a person to leave subject-less. If a later change draws a waver list, it inherits
`getClubJoins`' rule — a rider whose profile the policies hide is dropped rather than drawn
nameless.

#### Scenario: A blocked rider's join never appears
- **WHEN** a rider blocked in either direction holds a `club_members` row for the club
- **THEN** the join event SHALL be absent from the timeline
- **AND** the absence SHALL come from the `club_members` SELECT policy, not from a client filter

#### Scenario: A blocked rider's thread, postcard and ride never appear
- **WHEN** a blocked rider has started a thread, posted a club postcard and created a club ride
- **THEN** none of the three SHALL appear as a timeline entry
- **AND** each absence SHALL come from that table's own policy

#### Scenario: An unnameable actor drops its event rather than rendering "Rider"
- **WHEN** an event row's actor profile is withheld — most reachably, an account with a NULL
  `username` between signup and the username step
- **THEN** the event SHALL be dropped from the stream
- **AND** the timeline SHALL NOT render a sentence naming nobody

#### Scenario: The club's own creation event survives a blocked owner
- **WHEN** the club's owner is blocked in either direction, so their profile and roster row are
  both withheld
- **THEN** the creation entry SHALL render as a club-scoped sentence with no avatar and no name
- **AND** it SHALL NOT be dropped, because it is an event about the club rather than about a
  person

#### Scenario: A blocked rider's wave on a visible thread is filtered by its own policy
- **WHEN** A has blocked B, and B has waved a thread authored by C whom A has not blocked
- **THEN** the thread entry SHALL render for A
- **AND** B's wave SHALL be absent from A's rows and from A's count
- **AND** the absence SHALL come from `club_thread_waves`' own policy, not from `club_threads`'

#### Scenario: No waver is named
- **WHEN** an entry carries waves
- **THEN** the screen SHALL draw a count and a pressed state and no rider's name or avatar
- **AND** no read SHALL fetch the wavers' profiles
