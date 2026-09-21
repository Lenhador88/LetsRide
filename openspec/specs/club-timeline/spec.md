# club-timeline Specification

## Purpose
TBD - created by archiving change add-club-timeline. Update Purpose after archive.
## Requirements
### Requirement: The timeline SHALL be assembled from separately-filtered reads, and SHALL NOT be served by a privileged union

The club timeline SHALL be built in the client by merging reads of `postcards`, `rides`,
`club_threads` and `club_members`, each returning under its own SELECT policy and under the
caller's own session.

No `security definer` function SHALL return a merged club activity stream, now or later. A
definer body runs as the owner, for whom row security does not apply, so such a function would
have to restate five audience predicates and four symmetric block arms by hand — in code that
`supabase/tests/` structurally cannot see, because the suite runs as the table owner for whom
neither RLS nor the grants exist.

The client SHALL NOT restate any audience predicate of its own. Membership, club visibility,
block state and the postcard-hide predicate are all answered by the time rows arrive; a second
copy in `src/lib/data/` is a policy free to drift, and the copy that drifts is always the one
nobody reads.

#### Scenario: No merged-stream accessor exists
- **WHEN** the change is complete
- **THEN** no function in `public` or `private` SHALL return rows of more than one club event
  kind
- **AND** the four reads SHALL each be an ordinary `from(...).select(...)` or an existing
  accessor, issued as the authenticated rider

#### Scenario: The client adds no audience filter
- **WHEN** any of the four reads is issued
- **THEN** its predicates SHALL name only the club and the ordering window
- **AND** SHALL NOT include a membership test, a block test, a club-visibility test or a
  hide test

#### Scenario: A policy change reaches the timeline with no code change
- **WHEN** the SELECT policy on any of the four source tables is later narrowed or widened
- **THEN** the timeline's audience SHALL move with it, with no edit to any client module

### Requirement: The timeline's reach SHALL be stated for every role that can reach a club

The timeline's reach SHALL be stated for every role that can reach a club.

Each role below is a testable statement about a role and a resource. Membership is
`private.is_club_member(club_id)`, which is a `club_members` row **or** `clubs.owner_id` (`054`,
split by `060`), so the owner is a member for every rule here whether or not they hold a roster
row.

| Role | Timeline | Action layer | Notes |
|---|---|---|---|
| Club **owner** | full — all four sources | full | reaches everything a member does, via the owner disjunct of `is_club_member_for` |
| Club **admin** (`club_members.role = 'admin'`) | full | full | `role` grants nothing this screen reads; every source policy tests membership, never role |
| Club **member** | full | full | |
| **Non-member of a PUBLIC club** | **absent** — refusal, not an empty or partial stream | **absent** | joins and public rides WOULD return rows; see the next requirement |
| **Non-member of a PRIVATE club** | absent — the screen is `ClubPreviewScreen`, which issues no such read | absent | `085`; the club detail is unreachable to them |
| **Blocked rider** (either direction) | never appears as an actor in any entry, and their content never appears | n/a | four symmetric conjuncts, one per source |
| **Signed-out visitor** | reaches the shell and no data | n/a | `anon` holds no grant on any of the four tables and this change adds none |

#### Scenario: An admin reaches exactly what a member reaches
- **WHEN** a rider whose `club_members.role` is `admin` opens the club
- **THEN** the timeline SHALL contain exactly the entries a member with `role = 'member'` would
  see
- **AND** no entry, control or count SHALL be gated on `role`, because no source policy tests it

#### Scenario: The owner reaches the timeline while holding no `club_members` row
- **WHEN** the rider named in `clubs.owner_id` opens the club having left it
- **THEN** every source read SHALL return their club's rows, because
  `private.is_club_member_for` carries an owner disjunct
- **AND** the create bar SHALL be present

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for any of the four tables arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant
- **AND** this change SHALL add none, per decision #1
- **AND** the visitor SHALL reach the shell and no data, consistent with
  `client-session-storage`

### Requirement: A non-member of a PUBLIC club SHALL be refused the timeline, and SHALL NOT be shown a partial one

For a signed-in rider who is neither a member nor the owner of a club whose `is_public` is true,
the timeline section SHALL render a refusal sentence and the join affordance, and SHALL issue
none of the four reads.

The refusal SHALL be a statement about the rule, never about the club: it SHALL NOT say the club
is quiet, SHALL NOT say there is nothing here, and SHALL NOT carry a count of anything.

**The reason is not disclosure, it is inversion.** Their `club_members` and `rides` reads WOULD
return rows — a public club's roster is readable to any signed-in rider
(`… OR EXISTS (select 1 from clubs c where c.id = club_id and c.is_public)`) and so are its
public rides — while `club_threads` and `postcards` return nothing, both requiring
`private.is_club_member`. A merged stream would therefore draw a handful of join rows for a club
with four hundred postcards, and read as *this club is quiet* to the one rider the screen exists
to persuade.

The governing rule, which the next such screen inherits: **a partial view is honest when partial
fidelity preserves the message, and dishonest when it inverts it.** The upcoming-rides strip and
the Members rail stay for a non-member because 2 of 5 rides still says "this club rides"; the
timeline goes because 3 of 300 events says the opposite of what is true.

#### Scenario: A busy public club does not read as quiet
- **WHEN** a non-member opens a public club holding threads, postcards, rides and joins
- **THEN** no timeline entry SHALL be drawn
- **AND** a refusal sentence and the join button SHALL be drawn in its place
- **AND** the upcoming-rides strip and the Members rail SHALL still render

#### Scenario: The refusal does not depend on the reads returning nothing
- **WHEN** the non-member branch renders
- **THEN** the four reads SHALL NOT be issued at all, using `useQuery`'s null-key state
- **AND** the refusal SHALL therefore be reachable without a round trip, and SHALL NOT be an
  interpretation of an empty result

#### Scenario: The client gate is an affordance and not the boundary
- **WHEN** a rider defeats the membership gate in the client
- **THEN** `club_threads` and `postcards` SHALL still return zero rows for that club, and
  `club_members` and `rides` SHALL still return only what a non-member may already read at
  `/clubs/detail/members` and on the rides strip
- **AND** nothing SHALL be disclosed that was not already reachable

#### Scenario: The create bar is absent rather than inert
- **WHEN** a non-member opens a public club
- **THEN** no create-ride, add-postcard or threads control SHALL be rendered
- **AND** this SHALL hold because each is a write `017`, `009` and `081` refuse them, per the
  existing rule that a control which always fails RLS is worse than no control

### Requirement: The reduced private-club preview SHALL gain no read and no timeline

`ClubPreviewScreen` (`085`) SHALL be untouched by this change. It SHALL issue no timeline read,
draw no event row, draw no roster and draw no count.

The property `085` established SHALL survive intact: **the screen issues no query that could
return zero rows**, which is what keeps permission-denied and empty from being confusable there.
A timeline is four such queries.

#### Scenario: A private club's join events are not drawn as an empty roster
- **WHEN** a non-member reaches a private club through Explore
- **THEN** `club_members` SHALL return zero rows, its public-club disjunct not firing
- **AND** the screen SHALL NOT render that as "nobody has joined this club", because it SHALL not
  issue the read

#### Scenario: The new code is unreachable from the preview branch
- **WHEN** `getClub` returns `null` and `getClubPreview` returns a club
- **THEN** the timeline component SHALL NOT be mounted, and its reads SHALL NOT be enabled
- **AND** the absence SHALL be structural rather than a condition inside the component

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

### Requirement: The unread signal SHALL survive the dissolution of the Threads section in two places

Dissolving the Threads section SHALL NOT remove the per-thread unread mark `081` shipped, and
SHALL NOT leave that mark as the only carrier of the signal.

1. **Each thread entry in the timeline SHALL carry its own unread dot**, from
   `getClubThreadUnread`'s existing `(thread_id, has_unread)` map.
2. **The club's Threads entrance SHALL carry an aggregate mark** derived from that same map,
   with no additional read.

(2) is required rather than decorative. A thread entry is placed by `club_threads.created_at`,
which is the only timestamp this change may read for it, so a thread begun three weeks ago and
active this morning sits three weeks down the stream — frequently below the coherence horizon,
and always below the fold. Today's Threads section puts the three newest threads and their dots
above the fold; the aggregate mark is what stops this change being a regression on that.

Both marks SHALL fail to nothing: a failed unread read SHALL render the entries and the tile
unmarked rather than not rendering them, preserving `getClubThreadUnread`'s existing behaviour of
resolving to `{}`.

#### Scenario: A thread with unread messages is marked wherever it sits
- **WHEN** a member has unread messages in a thread created three weeks ago
- **THEN** that thread's timeline entry SHALL carry an unread dot
- **AND** the club's Threads entrance SHALL carry a mark, above the fold, regardless of
  where the entry sits

#### Scenario: A failed unread read costs marks and not rows
- **WHEN** `club_thread_unread` errors
- **THEN** the thread entries and the Threads tile SHALL render unmarked
- **AND** no error state SHALL be shown for the timeline

#### Scenario: Opening the club does not spend the thread watermark
- **WHEN** a member opens the club detail
- **THEN** `MarkClubSeen` SHALL write `feed_reads` only
- **AND** no `club_thread_reads` row SHALL be advanced, so the dots survive the visit

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

### Requirement: Every destination that loses its section SHALL keep an entrance in every state

Dissolving the Postcards carousel and the Threads section removes two `See all` links and two
`(+)` controls. `/postcards?club=<id>`, `/clubs/detail/rides`, `/clubs/detail/threads` and
`/clubs/detail/members` SHALL each keep at least one entrance for a member in **every** state of
this screen, including the shortest stream and the complete-tail state where no handoff row is
drawn.

An entrance SHALL NOT be offered to a destination that is empty, which is the existing policy on
this screen and the reason `See all` is dropped from an empty section today.

#### Scenario: A club with one member and nothing else strands no route
- **WHEN** a member opens a brand-new club
- **THEN** the create bar SHALL offer Postcard, Ride and Thread, and a Threads entrance SHALL sit above the stream
- **AND** the Members rail SHALL keep its own `See all`
- **AND** no entrance SHALL be offered to a list with nothing in it

#### Scenario: A club with a complete tail still reaches the full lists
- **WHEN** the stream runs to the club's creation and draws no handoff row
- **THEN** every destination that has rows SHALL still be reachable from the screen
- **AND** the absence of the handoff row SHALL NOT be the only entrance to any of them

### Requirement: The timeline SHALL be derived from live rows, and what that omits SHALL be stated

The timeline holds no **event** rows of its own. Every entry is a live row in one of the sources,
so the stream is a view of the club's **current** state rather than a history of it. Five
consequences SHALL be treated as designed behaviour rather than defects, and SHALL be stated
wherever the timeline is described:

- **A rider who leaves erases their own join entry**, because the `club_members` row is deleted.
  A club that twenty riders joined and left shows a timeline claiming nothing happened.
- **A rider who leaves and rejoins appears to join for the first time**, at their new `joined_at`.
- **A deleted postcard, ride or thread removes its entry**, with no tombstone.
- **A wave dies with the entry it decorates**, from `club-timeline-engagement`.
  `club_join_waves` cascades from `club_members (club_id, user_id)` and `club_thread_waves` from
  `club_threads(id)`, so a leave, a thread deletion or an account deletion removes the reactions
  along with the row — and a rejoin starts at zero waves rather than inheriting the old ones.
- **An introduction does NOT die with the membership it decorates**, which is new in this change
  and is the one deliberate asymmetry with the wave beside it. A wave is a reaction to an event; an
  introduction is words, and the comments under it are other riders' words. So a leave clears the
  marker and leaves the thread standing as an ordinary thread, and the join entry it decorated has
  gone anyway. A rejoin therefore starts with **no** introduction and does not inherit the old
  thread.

There SHALL be no "a rider left" entry, in this change or in any successor built on this design: a
leave is a DELETE and there is no row to read.

**The timeline DOES now hold rows of its own in one narrow sense, and the distinction is the
point.** It holds *reaction* rows — `club_thread_waves` and `club_join_waves` — which are not
entries and never appear in the merged output. An introduction is **not** one of those: it is a
`club_threads` row, so it is an entry in its own right on the thread source *and* a decoration on a
join entry.

**The following paragraph of this requirement is REPLACED by this change**, and the replacement is
its opposite. It previously read: *"it SHALL appear once as each. That double appearance is designed
and SHALL NOT be suppressed on either side."* It now reads:

> **An introduction SHALL appear exactly once on the stream, as its announcement row, for as long as
> it carries its marker.** It is a `club_threads` row, so it is *capable* of appearing as a thread
> entry and of producing a reply entry per comment, and both SHALL be suppressed. The suppression is
> a presentation decision over rows the policies already returned, and SHALL NOT be described,
> implemented or reviewed as a visibility rule.

The reason the earlier decision was wrong is worth keeping: a reply entry is written **per comment**,
so the double appearance was not one duplicate row but one per comment, at the top of a newest-first
stream, above everything else the club did.

**When the marker goes, the suppression goes with it.** An ex-member's introduction is an ordinary
thread and SHALL appear as one, on the Threads list and as a thread entry with the reply entries its
comments produce. That is the same live-rows rule as everything else in this requirement: the entry
follows the row's current state, not its history.

#### Scenario: A leave takes its own join entry and its waves with it
- **WHEN** a rider leaves the club
- **THEN** their join entry SHALL disappear from every member's timeline
- **AND** every wave placed on that join SHALL be deleted by cascade
- **AND** no "left the club" entry SHALL appear

#### Scenario: A leave does NOT take the introduction with it
- **WHEN** a rider who had introduced themselves leaves the club
- **THEN** the introduction's thread SHALL remain on the timeline as an ordinary thread entry
- **AND** every comment written in it SHALL survive

#### Scenario: A rejoin is indistinguishable from a first join, waves and introduction included
- **WHEN** a rider leaves and rejoins
- **THEN** a join entry SHALL appear at the new `joined_at` carrying **zero** waves
- **AND** no wave placed before the departure SHALL reappear
- **AND** the new join entry SHALL carry no introduction, no comment icon and no count

#### Scenario: `joined_at` cannot be forged
- **WHEN** a rider attempts to write `club_members.joined_at`
- **THEN** the write SHALL be refused, because `048` grants `authenticated` only
  `insert (club_id, role, user_id)` and `update (club_id, role, user_id)`
- **AND** a rider SHALL therefore be unable to place themselves, or a wave addressed to them,
  anywhere in another club's timeline

#### Scenario: An introduction appears once while its subject is a member
- **WHEN** a club timeline is rendered and an introduction carries its marker
- **THEN** exactly one entry SHALL represent it, and it SHALL be the announcement row
- **AND** no thread-creation entry and no reply entry SHALL be drawn for it

#### Scenario: A leave restores the ordinary entries
- **WHEN** the subject leaves the club
- **THEN** the announcement row SHALL disappear with the membership
- **AND** the thread SHALL become an ordinary thread and MAY produce a thread entry and reply entries
  like any other

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

### Requirement: A count on a timeline row SHALL be per-viewer, and a windowed one SHALL say so

Two counts now appear on the timeline and they are computed differently. The distinction SHALL be
preserved rather than harmonised, because only one of them is bounded by a read window.

- The **introduction's comment count** on a join row SHALL be an unbounded aggregate over the rows
  row security returns for that thread. It SHALL NOT carry a "more than this" mark, because there
  is no window to overflow.
- The **thread row's count** SHALL continue to be derived from the club-wide message window, and
  SHALL continue to mark that it is a floor **on exactly the rows that already carry the mark
  today, and on no others**. Replacing the words `N replies` with an icon and a number SHALL
  change only the rendering: a row marked as a floor before the change SHALL be marked after it,
  and a row not marked before SHALL NOT become marked.

  **A full window is necessary and NOT sufficient**, and this is the half that inverts if the rule
  is restated from the window alone. A thread's **creation** row that survives the stream's
  coherence cut was created after the reply window's oldest message, so every one of its replies is
  inside that window and its count is exact — the floor mark is cleared on those rows deliberately,
  and carrying it renders `2+` on a thread that has exactly two. The mark is earned on a **reply**
  row, where an older thread's earlier messages can genuinely fall outside.

Neither count SHALL be presented as a fact about the club, and neither SHALL order any list.

#### Scenario: The windowed count keeps its floor mark where it had one
- **WHEN** a reply row's count is derived from a full message window
- **THEN** the number SHALL be rendered as a floor and SHALL NOT be rendered as an exact total

#### Scenario: A creation row does NOT gain a floor mark from a full window
- **WHEN** a thread-creation row inside the coherence horizon has its count derived from a full
  message window
- **THEN** the number SHALL be rendered exactly, with no floor mark
- **AND** a thread with two replies SHALL render `2` and never `2+`

#### Scenario: The introduction count carries no floor mark
- **WHEN** a join row draws its introduction's comment count
- **THEN** the number SHALL be exact for that viewer
- **AND** it SHALL NOT be marked as a floor, because it is not read through a window

### Requirement: Every timeline row SHALL be addressable, and a return from a row's destination SHALL land on that row

A rider who opens a thread, an announcement or any other timeline entry and comes back SHALL return
to the club detail **at the row they left from**, not at the top of the stream.

Each row SHALL carry a stable anchor derived from the ordering key the stream already assigns it,
so an anchor cannot name a row the stream does not have and the two cannot drift. The destination
SHALL carry the origin and the row key as **bounded values** — a kind from a closed set and a
well-formed id — so the only navigation the parameter can produce is a return to a row of that
club. It SHALL NOT carry a URL.

**The return SHALL be positioned after the rows exist, and exactly once.** The timeline is
assembled from several independently-resolving reads and has no rows at first paint, so a
position applied on mount lands on an empty screen. It SHALL NOT re-apply on later renders, or an
arriving row or an invalidated cache would move a rider who has started reading.

**An anchor that does not resolve SHALL be a no-op.** The row may have been deleted, may have
fallen past the coherence horizon, or may be one the viewer may no longer read. The screen SHALL
render normally at the top, SHALL NOT retry, and SHALL NOT report anything — the three cases are
indistinguishable to the client and all three are ordinary.

**The anchor SHALL NOT influence what the screen reads.** It names a row; it SHALL NOT change any
source, any page size or the horizon.

#### Scenario: Back from a thread lands on its row
- **WHEN** a rider opens a thread from the club timeline and navigates back
- **THEN** the club detail SHALL be positioned at the row they opened it from

#### Scenario: Back from an introduction lands on the join announcement
- **WHEN** a rider opens an introduction from a join announcement and navigates back
- **THEN** the club detail SHALL be positioned at that join announcement

#### Scenario: A deep link carries no anchor and lands at the top
- **WHEN** a thread is reached from a notification, a shared URL or a reload
- **THEN** the back destination SHALL be the club's thread list, as it is today
- **AND** no position SHALL be applied

#### Scenario: An unresolvable anchor is silent
- **WHEN** the named row is absent from the stream for any reason
- **THEN** the screen SHALL render at the top with no error, no retry and no message

#### Scenario: The position is applied once
- **WHEN** the timeline re-fetches or a new row arrives after the position was applied
- **THEN** the screen SHALL NOT move again

### Requirement: The timeline SHALL gain no source, and the condition under which that changes SHALL be stated

An introduction contributes no event, no ordering key and no new source: it decorates a join entry
that is already on the stream and appears in its own right only as the thread entry it already was.
The stream's coherence horizon SHALL therefore be unchanged.

This SHALL stop being true the moment an introduction produces an entry of its own — *"Ana
introduced themselves"* as a row — which would be a source and would owe a horizon like every other.

#### Scenario: No horizon changes
- **WHEN** this change is applied
- **THEN** the set of sources merged into the stream SHALL be unchanged
- **AND** the horizon SHALL be computed from exactly the sources it was computed from before

#### Scenario: Reads for the decoration are scoped to what is on screen
- **WHEN** the screen reads introductions for its join entries
- **THEN** it SHALL read only for the subjects already on the stream
- **AND** it SHALL NOT read every introduction the club has ever held

### Requirement: A source's horizon SHALL be measured on the window it read, and a filter SHALL be applied inside that window rather than after it

Each timeline source declares how far back it looked. Two of them post-process what they read and
therefore compute their own horizon; the rest are horizons by construction, because the rows they
return *are* the window.

A filter that removes rows a source would otherwise have returned SHALL be applied **in the query**,
so that the window and the rows stay the same thing. Filtering after the read SHALL NOT be done,
because it makes the horizon answer a question nobody asked: *how far back we looked for rows we then
discarded*, which cuts the whole stream at an instant no entry on it came from.

The rule that the reply source's horizon and its "the count is a floor" flag are measured on the
window **before** the collapse SHALL survive this change verbatim. What changes is what the window
holds, not when it is measured.

#### Scenario: The reply window holds only listed threads' messages
- **WHEN** the club-wide message window is read
- **THEN** it SHALL exclude messages belonging to threads carrying a marker
- **AND** the exclusion SHALL be part of the query, so the rows returned are the window read

#### Scenario: The horizon is measured before the collapse, as before
- **WHEN** the window is collapsed to one entry per thread
- **THEN** the horizon SHALL be the oldest row of the window, not of the survivors
- **AND** the floor flag SHALL be set from whether the window filled

#### Scenario: An unlisted conversation SHALL NOT shorten the stream
- **WHEN** a club's introductions carry many comments
- **THEN** those comments SHALL NOT consume the window
- **AND** the stream SHALL NOT be cut at an instant derived from entries it does not draw

#### Scenario: The threads source stays a window
- **WHEN** the timeline computes the threads source's horizon from the page it read
- **THEN** that page SHALL be a full page of listable threads or fewer
- **AND** no row SHALL have been discarded between the read and the horizon

### Requirement: The stream SHALL gain and lose no source, and `complete` SHALL keep meaning what it means

This change adds no source, no ordering key and no new horizon. The set of sources merged into the
stream SHALL be exactly the set merged today, and `complete` SHALL continue to mean that nothing was
dropped at either end — never that the stream is short.

A stream that is shorter because a club's threads are mostly introductions SHALL still be
`complete`, provided the horizon cut nothing and the limit cut nothing.

#### Scenario: The merge is unchanged
- **WHEN** this change is applied
- **THEN** the merge SHALL hold the same five sources it holds today
- **AND** no horizon SHALL be computed from anything new

#### Scenario: Fewer entries does not mean incomplete
- **WHEN** every one of a club's threads is a current member's introduction
- **THEN** the stream SHALL draw the club's rides, postcards, joins and founding
- **AND** it SHALL report itself complete if nothing was cut

