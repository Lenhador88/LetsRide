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

#### Scenario: The horizon is unchanged by this change
- **WHEN** the wave reads are added
- **THEN** the set of declared horizons SHALL be exactly the five the timeline already computes
- **AND** the stream's length and cut point SHALL be identical to what they were before

#### Scenario: A wave read that returns nothing does not shorten the stream
- **WHEN** either wave read returns zero rows or fails outright
- **THEN** every entry SHALL still render
- **AND** `complete` SHALL be computed from the same five sources as before

### Requirement: A blocked rider SHALL be absent from every source, and an event whose actor cannot be named SHALL be dropped

Blocking SHALL be enforced by the source policies and by nothing the client adds. The merge SHALL
NOT reintroduce a blocked rider, and it cannot take a row from anywhere the policies have not
already answered for.

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

#### Scenario: A blocked rider's wave on a visible thread is filtered by its own policy
- **WHEN** A has blocked B, and B has waved a thread authored by C whom A has not blocked
- **THEN** the thread entry SHALL render for A
- **AND** B's wave SHALL be absent from A's rows and from A's count
- **AND** the absence SHALL come from `club_thread_waves`' own policy, not from `club_threads`'

#### Scenario: No waver is named
- **WHEN** an entry carries waves
- **THEN** the screen SHALL draw a count and a pressed state and no rider's name or avatar
- **AND** no read SHALL fetch the wavers' profiles
