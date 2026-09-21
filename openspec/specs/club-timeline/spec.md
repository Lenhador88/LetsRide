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

Entries SHALL be sorted by their timestamp descending, with the entry key as the tiebreak, giving
a total order — and with the club's own founding always last on a tie, since nothing can precede
the club existing. Timestamp alone is not a total order here: `complete_onboarding`
writes a default-club membership inside one transaction (`058`), so shared instants are ordinary
rather than an edge case, and a stream without a tiebreak reshuffles between loads for no reason
the rider can see.

Each source SHALL be read with its own bound and SHALL **declare** the instant
below which its picture is incomplete, rather than the merge deriving it from the rows that
survived — a read that post-processes its window is the only thing that knows how far back it
looked. The **coherence horizon** SHALL be the **most recent** of the declared horizons, and the
stream SHALL NOT include any entry older than it. A source returning fewer rows than its bound
SHALL impose no horizon, because it is complete back to the club's beginning.

**A wave read is NOT a source and SHALL declare no horizon.** It is scoped to the subject ids the
timeline already holds, so it is bounded by the timeline's bound and contributes no window over the
club's history. Adding a horizon for it would be worse than omitting one: the latest of the
declared horizons is the cut, so a decoration read's oldest row could truncate the stream it
decorates.

**The condition under which that changes SHALL be stated rather than discovered.** If a later
change draws a wave as its own entry — *"Ana waved at Bruno"* — it becomes a source and owes a
horizon like every other.

The stream SHALL then be capped for display.

**The following paragraph of this requirement is REPLACED by this change**, and the replacement is
its opposite. It previously read: *"Incomplete — a handoff row offering the four full lists. There
SHALL be no infinite scroll and no 'load more'."* It now reads:

> **Incomplete — the stream SHALL offer to extend itself**, by lowering the horizon and raising the
> display cap, until it is complete or a stated ceiling is reached. The handoff row SHALL remain
> the terminal state of a stream that stops short, and SHALL be drawn when — and only when — the
> stream cannot be extended any further.

The tail SHALL therefore be one of exactly three things:

- **Complete** — no horizon and no cap reached: the last entry SHALL be the club's own creation,
  and nothing further SHALL be drawn.
- **Extendable** — more entries are reachable: the stream SHALL offer to extend, and SHALL NOT
  draw the handoff row.
- **Terminal but incomplete** — extension has failed or reached its ceiling: the **handoff row**
  offering the full lists SHALL be drawn, exactly as before.

`complete` SHALL NOT be redefined by paging. It SHALL continue to mean that nothing was dropped at
either end — the horizon cut nothing **and** the display cap cut nothing — and SHALL NOT be
inferred from the entry count. What paging changes is that it becomes reachable on a club whose
sources saturate, because every source's horizon moves down until its window comes back short.

The club's creation entry SHALL be drawn **only** in the complete state. Under a truncated stream
it would assert an adjacency that is false, and that holds identically for a stream truncated
part-way through paging.

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
- **THEN** the entry key SHALL break the tie
- **AND** the order SHALL be identical across reloads, and across a page boundary that re-reads
  one of them

#### Scenario: The horizon is the most recent of the oldest, not the oldest
- **WHEN** two sources are saturated with different oldest timestamps
- **THEN** the horizon SHALL be the **later** of the two
- **AND** entries between the two SHALL be excluded, because at least one source is already
  truncated there

#### Scenario: The merge rule is covered by a unit test rather than by inspection
- **WHEN** the horizon, the tiebreak, the saturation test and the three tail states are
  implemented
- **THEN** they SHALL live in pure functions with their own unit tests
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

#### Scenario: A paged club reaches its founding rather than a wall
- **WHEN** a rider extends a stream whose sources all saturated on the first read
- **THEN** each source's horizon SHALL move down as its next window is read
- **AND** when every source's deepest window comes back short, `complete` SHALL be true, the
  `club-created` entry SHALL be appended, and the handoff row SHALL NOT be drawn

#### Scenario: The floor entry is withheld part-way through paging
- **WHEN** the stream has been extended once and a horizon still cuts it
- **THEN** `complete` SHALL be false
- **AND** the `club-created` entry SHALL NOT be drawn, because it would assert that nothing
  happened between the club's founding and the oldest entry on screen

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

### Requirement: An accumulated source SHALL cover its interval contiguously, and a window SHALL declare the interval it covers

Paging SHALL be expressed as **lowering the horizon**, never as five independent cursors. Each
source SHALL be re-asked for the window below the point that source itself stopped at, and the
windows SHALL be accumulated into one source per kind.

An accumulated source SHALL satisfy: **it covers `[horizon, now]` contiguously** — every row of
that source in that interval that the rider may read is present in `rows`. A source with a gap in
its coverage SHALL NOT be passed to the merge, because the merge reads `horizon` as "complete
above this point" and a gap makes the whole stream a plausible, well-ordered, confidently wrong
answer.

Each window SHALL declare the interval it covers — its horizon, the instant it was bounded at, and
whether that instant is inside it. The declaration belongs to the **read**, for the same reason
`ClubTimelineSource.horizon` does: only the read knows what bound it used, and a caller deriving
it would be guessing.

Absorbing a window into an accumulated source SHALL obey one rule in both directions:

1. Inside the window's covered interval the window is authoritative; accumulated rows there that
   it did not return SHALL be dropped.
2. Outside that interval accumulated rows SHALL be kept unchanged.
3. The accumulated horizon SHALL be the older of the two, with "reaches the club's beginning"
   winning.

This SHALL be a pure function with its own unit test, because it is where this change's silent
failure lives.

**A source whose accumulated horizon is `null` is finished and SHALL NOT be asked for another
window.** The bound for a deeper window is that source's own horizon, and `null` denotes *now* —
the first window's bound — so re-asking a finished source does not fetch older rows, it silently
re-fetches page one on every subsequent step for ever. The per-source guard is therefore a
correctness rule and not an optimisation, and it SHALL be expressed per source: a stream-wide
verdict about which tail to draw cannot decide which reads to issue.

**A read that post-processes or re-filters its window SHALL declare its horizon from what it
fetched, not from what survived.** Two sources already do this — the joins read measures its
horizon before dropping riders it cannot name, and the reply read measures its window before the
collapse. A two-step read is the same case: where an accessor returns ids and a second query
re-reads those rows under the caller's own RLS, the second read may legitimately return fewer
rows, and saturation SHALL be taken from the first step. Taken from the second, a window that
saturated but lost one row to a policy reads as short, imposes no horizon, and lets the stream
declare itself `complete` — which draws the club's founding beneath rows it never saw.

#### Scenario: A deeper window extends coverage without a gap
- **WHEN** a source whose horizon is `h` is asked for the window below `h`
- **THEN** the accumulated source SHALL cover from the new window's horizon up to now
- **AND** the merge SHALL be free to draw entries between the two horizons

#### Scenario: A source that came back short is never asked again
- **WHEN** a source's window comes back short of its bound
- **THEN** it SHALL impose no horizon and SHALL NOT be re-read for a deeper window
- **AND** a further page SHALL cost only the reads of the sources that are still saturated

#### Scenario: A finished source is not re-read as if it were the first page
- **WHEN** every source but one has gone short and the rider asks for another page
- **THEN** only the saturated source's read SHALL be issued
- **AND** no read SHALL be issued with an absent upper bound, which would fetch the newest rows
  again rather than older ones

#### Scenario: A two-step read declares its saturation from the step that knows it
- **WHEN** an accessor returns a full page of ids and the RLS-filtered re-read returns fewer rows
- **THEN** the source SHALL be treated as saturated and SHALL impose a horizon
- **AND** the stream SHALL NOT report itself complete, and SHALL NOT draw the club's founding

#### Scenario: A refetched first window does not open a hole beneath itself
- **WHEN** the first window is refetched after new rows were added, so its own horizon moves
  **up**
- **THEN** the rows between the old and the new first-window horizon SHALL be retained from the
  accumulated source
- **AND** the accumulated horizon SHALL remain the deepest window's, because the coverage is still
  contiguous

#### Scenario: A gap is never papered over by keeping the deeper horizon
- **WHEN** an implementation replaces the first window's rows instead of absorbing them
- **THEN** the stream SHALL be wrong in exactly the way the horizon exists to prevent, and the
  unit test SHALL fail
- **AND** the accumulated source SHALL therefore be built by the absorb rule rather than by
  concatenation

### Requirement: No entry SHALL be drawn twice across a page boundary, and the postcard boundary's exception SHALL be stated

Every entry carries a stable key — `ride:`, `postcard:`, `thread:`, `reply:<message id>`,
`join:<user id>`, `club-created:`. Re-reading a boundary SHALL NOT produce two entries with one
key, and SHALL NOT lose a row that sits exactly on it.

Duplication SHALL be prevented structurally, by the absorb rule above, rather than by a
de-duplicating pass over the rendered list: rows at a shared boundary instant are dropped from the
accumulated source before the new window's copies are added. A rider who leaves and rejoins
between two windows SHALL produce one `join:` entry, not two, because a join's identity is the
rider rather than the row.

A deeper window SHALL be bounded **inclusively** (`<= until`) wherever the read can express one,
so that a `limit` slicing through rows that share an instant cannot drop the ones below the cut.

**One source cannot express it, and the consequence SHALL be stated rather than discovered.** The
club feed pages through `public.club_stamp_postcard_ids`, whose bound is `created_at < before` on
the timestamp alone (`086`). Its window SHALL declare itself exclusive, the absorb rule SHALL
honour that by keeping the accumulated rows at the boundary instant, and the residue — two
postcards in one club sharing a `created_at` to the microsecond and straddling a boundary lose the
one below it — SHALL be recorded as a bound this change chose, with its remedy (a keyset argument
on the accessor, which is a migration) named. It SHALL NOT be described as impossible: `044`
writes that column at transaction time, which makes it merely very unlikely.

#### Scenario: A boundary instant is read twice and drawn once
- **WHEN** the oldest rows of a window share an instant with the newest rows of the next
- **THEN** each row SHALL appear exactly once in the stream
- **AND** no React key SHALL be duplicated

#### Scenario: A rejoin across a boundary is one row
- **WHEN** a rider's `club_members` row is deleted and re-created between two windows
- **THEN** exactly one `join:` entry SHALL be drawn, at the current `joined_at`

#### Scenario: The exclusive postcard bound loses nothing that is already held
- **WHEN** the postcard window below `h` is fetched with a strictly-older bound
- **THEN** the accumulated postcards at exactly `h` SHALL be retained rather than dropped
- **AND** no postcard SHALL be drawn twice

### Requirement: The reply source's collapse SHALL stay per-window, and its activity SHALL accumulate by summing

`getClubThreadReplies` reads a window of messages and collapses it to the newest message per
thread, so its window is measured in messages, its output in threads and its horizon in time.
Paging SHALL treat a deeper reply window as "the next window of messages older than where we
stopped", and SHALL NOT require it to yield any particular number of rows.

**The collapse SHALL remain per-window and SHALL NOT become global.** A thread alive in two
windows SHALL produce one entry per window, at two different instants, because each is a true
statement about a different period, and because a global collapse would delete the only evidence
that a period had any conversation in it. The rule the collapse enforces — one club argument SHALL
NOT bury everything else — is a within-window rule and SHALL stay exactly as strong.

**A thread's accumulated activity SHALL be the sum of its per-window counts**, and its participants
the union in shallowest-window-first order. Summing is required rather than preferred: a
thread-creation entry renders its reply count as **exact**, and that is only true if the count
spans the whole of the reply source's contiguous coverage. The accumulated activity SHALL be
derived from the window list rather than incremented in place, so that a refetched first window
re-contributes instead of double-counting.

**Whether a count is exact or a floor SHALL be derived from that same coverage, and SHALL NOT be
accumulated.** A flag set true because some window saturated is monotonic — it never clears — so a
thread whose every message is demonstrably in hand would keep announcing a floor even after the
stream reached the club's founding, and the count would be governed by two contradictory rules at
once. One rule, which the exactness of a creation entry is the special case of:

> A thread's count is **exact** when the reply source's accumulated horizon is `null`, or when the
> thread was created at or after that horizon. Otherwise it is a **floor**.

A count SHALL therefore be able to *improve* as the rider pages: `12+` becomes `12` at the moment
the coverage can prove it.

#### Scenario: A floor becomes exact once the coverage proves it
- **WHEN** the rider pages until the reply source has read back to the club's beginning
- **THEN** every thread's reply count SHALL be rendered as exact
- **AND** no count SHALL still announce a floor because an earlier window happened to saturate

#### Scenario: A busy thread appears once per window, never as a transcript
- **WHEN** one thread carries the whole of two consecutive message windows
- **THEN** it SHALL produce exactly one entry per window
- **AND** SHALL NOT produce one entry per message

#### Scenario: A creation row's exact count survives paging
- **WHEN** a thread-creation entry is drawn above the deepest reply horizon
- **THEN** its reply count SHALL be the sum across every reply window
- **AND** it SHALL be rendered as exact rather than as a floor, because every one of that thread's
  messages lies inside the accumulated coverage

#### Scenario: A refetched first window does not double a count
- **WHEN** the first reply window is refetched
- **THEN** the accumulated counts SHALL be recomputed from the windows
- **AND** a thread's count SHALL NOT grow because the same messages were read twice

#### Scenario: The reply horizon is still measured before the collapse
- **WHEN** any reply window is read, at any depth
- **THEN** its horizon SHALL be the oldest row of the **window**, not of the survivors
- **AND** the floor flag SHALL be set from whether that window filled

### Requirement: The stream SHALL extend on scroll, SHALL raise its cap before it fetches, and SHALL stop at a stated ceiling

Extension SHALL be triggered by the rider approaching the end of the stream, not by a button on
this screen. Whether the two screens that page with a button today adopt the same mechanism is out
of this change's scope.

**A step SHALL raise the display cap first and fetch only when the cap is no longer what cuts.**
The first read of every source already returns far more rows than the display cap draws, so most
steps SHALL cost no round trip at all, and on a club where no source saturates the rider SHALL
reach the club's founding with no additional read.

Extension SHALL stop at a **stated ceiling** on how many windows one visit may fetch. The ceiling
SHALL be a named constant with its reasons recorded — client memory, the growth of the
decoration read's id list, and the total reads one screen may issue — and reaching it SHALL put
the tail in the terminal-but-incomplete state rather than leaving the rider on a spinner.

At most one extension SHALL be in flight at a time. An extension SHALL NOT be attempted while the
rider is offline, and a failed extension SHALL NOT be retried automatically.

**Declining to fetch is not the same as saying nothing.** An offline rider at the end of an
extendable stream SHALL be told the stream is paused, SHALL NOT be shown a loading treatment that
cannot resolve, and SHALL have the stream resume without a gesture when connectivity returns.

#### Scenario: Reaching the end asks for more without a tap
- **WHEN** the rider scrolls to within the sentinel's margin of the last entry
- **THEN** the stream SHALL extend
- **AND** the entries already on screen SHALL NOT move, because rows are appended below them

#### Scenario: A step that needs no read issues none
- **WHEN** the merged in-horizon stream holds more entries than the display cap draws
- **THEN** the step SHALL raise the cap and SHALL NOT issue any read

#### Scenario: An offline rider at the end of the stream is told, not spun
- **WHEN** the rider reaches the end of an extendable stream with no connectivity
- **THEN** the tail SHALL say the stream is paused and SHALL draw no loading treatment
- **AND** the stream SHALL resume on its own when connectivity returns

#### Scenario: The ceiling ends in the handoff, not in a spinner
- **WHEN** a visit has fetched the maximum number of windows and the stream is still incomplete
- **THEN** the handoff row SHALL be drawn
- **AND** no further fetch SHALL be attempted for that mount

#### Scenario: One extension at a time
- **WHEN** the sentinel fires repeatedly while a fetch is in flight
- **THEN** exactly one fetch SHALL be running
- **AND** no window SHALL be fetched twice for the same depth

### Requirement: Paging SHALL add no audience, no accessor and no way to enumerate

Every window at every depth SHALL be an ordinary read of the same table under the same SELECT
policy as the first, differing only by a time bound. The client SHALL NOT add a membership test, a
club-visibility test, a block test or a hide test at any depth, and SHALL NOT relax a filter the
first window carries — the announcement exclusion and the `!inner` thread embed included.

No `security definer` function SHALL be introduced to serve a page of the merged stream, now or
later.

**A rider who may not read the timeline SHALL NOT be able to page it.** For a non-member of a
public club the extension control SHALL NOT be rendered and the source reads SHALL stay disabled
by the null-key state, so the refusal continues to cost no round trip. For a non-member of a
private club the component is not mounted at all, and the reduced preview SHALL gain no read.

A blocked rider SHALL be absent from every window at every depth, by the four source policies and
by nothing the client adds.

#### Scenario: A non-member of a public club cannot trigger a page
- **WHEN** a non-member opens a public club that has hundreds of entries
- **THEN** no sentinel SHALL be rendered and no source read SHALL be issued
- **AND** the refusal sentence and the join affordance SHALL be what is drawn

#### Scenario: A deeper window is the same policy as the first
- **WHEN** any window beyond the first is read
- **THEN** its predicates SHALL name only the club, the ordering window and the time bound
- **AND** the rows returned SHALL be exactly those the rider could already have read by other
  means

#### Scenario: A blocked rider is absent at depth
- **WHEN** a rider blocked in either direction has content older than the first window
- **THEN** none of it SHALL appear in any deeper window
- **AND** the absence SHALL come from each table's own policy rather than from a client filter

#### Scenario: No merged-stream accessor is added for paging
- **WHEN** this change is complete
- **THEN** no function in `public` or `private` SHALL return rows of more than one club event kind
- **AND** no migration SHALL be part of this change

### Requirement: The return anchor SHALL hunt for its row within a bounded budget, and SHALL stay a no-op when it cannot be found

A rider returning from a thread carries a row key as a URL fragment. The screen SHALL extend the
stream, without a gesture, until that row exists — up to a stated budget of windows, smaller than
the extension ceiling because this runs unasked on load.

The hunt SHALL terminate on any of three conditions: the row appears, the stream is complete, or
the budget is spent. Its budget SHALL be drawn from the mount's own extension ceiling rather than
added to it, so that a mount's worst case is the ceiling and not the ceiling plus the hunt.

The scroll SHALL happen at most once per mount, and a hunt that ends without finding the row SHALL
leave the screen unable to scroll later — an arriving refetch that happens to make the row exist
SHALL NOT yank a rider who has started reading.

**Those are two states and SHALL be held as two.** "The hunt is over" and "the screen has already
scrolled" have different triggers — the first latches on an outcome that may be a failure, the
second on an action that may never occur — so a single flag cannot express both. A flag raised
when the rows first arrive, before any hunting fetch has been issued, SHALL NOT be used as the
guard: it ends the hunt before it starts, because every window the hunt fetches makes the rows
"ready" again.

**An unreachable anchor SHALL remain an ordinary no-op**, never a throw, an error state or a
report. Some anchors are unreachable in principle rather than merely deep: a `reply:<message id>`
names one message, and the collapse keeps only the newest message per thread per window, so a
newer message in that thread makes the anchored one unreachable for ever. A deleted row and a row
whose author has since been blocked are the same shape.

#### Scenario: A row past the first window is found and scrolled to
- **WHEN** a rider returns from a thread whose entry sits below the first window
- **THEN** the screen SHALL extend until that row exists, within the budget
- **AND** SHALL scroll to it once

#### Scenario: An unreachable anchor costs a bounded number of reads and nothing else
- **WHEN** the fragment names a row that no window can contain
- **THEN** the hunt SHALL stop at the budget or at completeness
- **AND** the screen SHALL render normally with no error, no report and no scroll

#### Scenario: A late refetch does not move a reading rider
- **WHEN** the hunt has already finished and a refetch later makes the anchored row exist
- **THEN** the screen SHALL NOT scroll

#### Scenario: The hunt survives its own fetches
- **WHEN** a hunted window lands and the rows become ready again
- **THEN** the hunt SHALL continue rather than being ended by the arrival of its own results
- **AND** the guard that prevents a second scroll SHALL NOT be what decides whether to keep
  hunting

#### Scenario: A hunt does not raise the mount's read ceiling
- **WHEN** a hunt spends part of the budget and the rider then scrolls
- **THEN** the windows the hunt fetched SHALL count against the same ceiling
- **AND** the total windows fetched in that mount SHALL NOT exceed it

### Requirement: A thread SHALL contribute exactly one entry to the stream, positioned at its newest activity

The stream SHALL carry **one** entry per thread, never one for the thread's creation and a second
for its newest reply. That entry SHALL be positioned at the thread's `last_activity_at` — the
instant of its newest message, or its own `created_at` when it has none.

The `reply` event kind SHALL be removed from `ClubTimelineEvent`. The reply **source** SHALL remain,
as a decoration source: it SHALL supply each thread's reply count, that count's `partial` flag and
the thread's participant faces, and it SHALL contribute no entry to the stream.

The thread entry SHALL carry the comment glyph, the reply count and the participants — everything
the removed reply entry conveyed — so that removing the second row removes no information.

A thread SHALL be readable at exactly one position at a time. Two entries bearing one thread's key
SHALL NOT be produced under any read, refetch or paging sequence.

#### Scenario: A thread that has been replied to draws one row
- **WHEN** a member opens a club whose thread was created in March and replied to this morning
- **THEN** the timeline SHALL draw exactly one entry for that thread
- **AND** it SHALL sit at this morning's reply, not in March
- **AND** it SHALL carry the reply count and the participant faces

#### Scenario: A thread with no replies keeps the position it has today
- **WHEN** a thread has been created and never replied to
- **THEN** it SHALL appear at its own `created_at`, exactly where it appears before this change
- **AND** its count SHALL be zero rather than absent

#### Scenario: The reply source draws nothing
- **WHEN** the timeline is merged
- **THEN** no entry SHALL be built from the reply source
- **AND** the reply source SHALL still be read, because the count, the `partial` flag and the faces
  come from it

### Requirement: The thread source SHALL be ordered, bounded and horizoned in the SAME dimension it is positioned in

The thread read SHALL order by `last_activity_at` descending with `id` as the tiebreak, SHALL apply
its paging bound (`until`) to `last_activity_at`, and SHALL declare its horizon from
`last_activity_at`.

Ordering on one column while measuring the horizon or the paging bound on another SHALL NOT be done.
A source that orders by activity and reports a horizon in creation time makes the timeline foot's
*"the stream is cut here"* a claim about a boundary that does not exist, and lets rows be dropped or
repeated at every page edge.

The stream's coherence horizon SHALL therefore continue to mean what it means — the newest of the
saturated sources' oldest returned positions — with the thread source's contribution now expressed
in activity time. An entry whose thread was created long before the horizon SHALL be drawn when its
activity is above it; that is the change's intent and not a leak past the horizon.

#### Scenario: A revived thread survives the cut
- **WHEN** the stream's horizon is at yesterday and a thread created in March was replied to this
  morning
- **THEN** that thread's entry SHALL be inside the horizon and SHALL be drawn
- **AND** the foot SHALL make the same claim it makes today about what lies below the cut

#### Scenario: The paging bound and the horizon name one column
- **WHEN** a deeper window of threads is requested
- **THEN** the bound SHALL be `last_activity_at <= h`, where `h` is the thread source's own
  accumulated horizon in the same dimension
- **AND** no window SHALL be bounded on `created_at`

#### Scenario: A thread source that came back short imposes no horizon
- **WHEN** the thread window returns fewer rows than its bound
- **THEN** it SHALL impose no horizon, exactly as before
- **AND** the change of ordering column SHALL NOT alter the saturation test

### Requirement: The reply source's horizon SHALL leave the merge's horizon list, and SHALL still decide exactness

A source that contributes no entry SHALL NOT cut the stream. The reply source's horizon SHALL be
removed from the set the merge reduces to the coherence horizon, and `complete` SHALL be derived
from the remaining four.

This SHALL NOT be described as a relaxation. The reply source's horizon exists to say how far back
the *message* window reached; with no reply entry on the stream there is no row it can withhold, so
including it would withhold the club's founding entry and mark a stream incomplete for rows that
were never going to be drawn.

The reply horizon SHALL continue to govern whether a thread's reply count is exact or a floor, by
the rule that already exists: a count is exact when the reply source's accumulated horizon is `null`
**or** when the thread was created at or after that horizon.

**That comparison SHALL use the thread's `created_at`, never its `last_activity_at`.** Exactness
asks whether every one of a thread's messages lies inside the reply source's coverage, which depends
on when the thread started. A thread that has just bumped has `last_activity_at` above the horizon
while older messages of its own sit below it, so comparing the entry's own position would render a
floor as an exact total — a wrong number presented as a right one. The thread's `created_at` SHALL
therefore remain on the entry after the ordering column changes.

#### Scenario: A busy conversation no longer marks the stream incomplete
- **WHEN** the reply window saturates but every other source comes back short
- **THEN** the coherence horizon SHALL be `null`, `complete` SHALL be true and the club's founding
  entry SHALL be drawn
- **AND** the thread counts SHALL still be rendered as floors where the reply coverage cannot prove
  them exact

#### Scenario: A bumped old thread does not claim an exact count
- **WHEN** a thread created before the reply horizon is bumped to the top of the stream
- **THEN** its count SHALL be rendered as a floor
- **AND** the exactness comparison SHALL be made against the thread's creation, not its position

#### Scenario: A thread created inside the reply coverage claims its count exactly
- **WHEN** a thread was created at or after the reply source's accumulated horizon
- **THEN** its count SHALL be exact
- **AND** paging deeper SHALL be able to turn a floor into an exact count, never the reverse

### Requirement: An accumulated source SHALL be de-duplicated by row identity, because one row type's position is now mutable

`absorbClubTimelineWindow` keeps accumulated rows that fall outside the incoming window's covered
interval **without consulting their id**, and then concatenates the window's rows. That is correct
only while a row's position is immutable. A bumping thread makes it wrong in both directions, and
neither failure is visible to any automated gate in this repo.

The absorb rule SHALL therefore drop any accumulated row whose identity the incoming window supplies,
**regardless of interval**, before the window's rows are added. No accumulated source SHALL hold two
rows with one identity, and the merge SHALL NOT be able to emit two entries with one key.

A row whose position moved **above** an already-fetched window SHALL NOT be lost. Where the absorb
rule alone cannot guarantee this — the row was below the first window when it was read and above it
when it bumped — the first window's refetch SHALL be what restores it, and the reply mutation SHALL
invalidate the thread source so that refetch happens.

#### Scenario: A bumped thread is not drawn twice
- **GIVEN** a thread held in a deep accumulated window at its old position
- **WHEN** a reply bumps it above the first window's horizon and the first window refetches
- **THEN** the accumulated source SHALL hold exactly one row for that thread, at its new position
- **AND** no two entries SHALL share the key `thread:<id>`

#### Scenario: A thread that bumps between two window fetches is not lost
- **GIVEN** a thread below the first window's horizon when that window was read
- **WHEN** it is bumped above that horizon and a deeper window is then fetched
- **THEN** the thread SHALL be present in the stream once the first window has been refetched
- **AND** it SHALL NOT be silently absent from every window at once

#### Scenario: The de-duplication is a pure function with its own test
- **WHEN** the absorb rule is implemented
- **THEN** its identity rule SHALL be covered by a unit test asserting both the duplicate and the
  loss
- **AND** the test SHALL fail against the interval-only rule that exists today

### Requirement: A thread SHALL have ONE anchor key, and the return trip SHALL still land

A rider returning from a thread carries a row key as a URL fragment (PD-366). The two event kinds
carry two different keys today — `thread:<thread id>` and `reply:<message id>` — and one row per
thread means one key.

The surviving key SHALL be `thread:<thread id>`. `clubThreadFromTimeline` SHALL round-trip it, the
row SHALL render it as its `id`, and the anchor hunt SHALL extend the stream looking for it under
the same bounded budget it uses today.

**A `reply:<message id>` fragment SHALL become permanently unreachable, and SHALL remain an ordinary
no-op.** Such a fragment can only arrive from a link built before this change; it SHALL NOT throw,
SHALL NOT produce an error state, SHALL NOT be reported, and SHALL leave the screen rendered
normally with no scroll. The existing rule already covers this — an anchor unreachable in principle
is a no-op — and this change SHALL NOT narrow it.

The anchor hunt SHALL terminate on the same three conditions as today: the row appears, the stream is
complete, or the budget is spent. A bumping row SHALL NOT be able to make the hunt non-terminating:
the hunt SHALL stop at its budget whether the row moved or was never there.

#### Scenario: Back from a thread lands on that thread's row
- **WHEN** a rider opens a thread from the timeline and presses Back
- **THEN** the screen SHALL scroll to that thread's single row
- **AND** it SHALL do so whether the row sits at the thread's creation or at its newest reply

#### Scenario: A stale reply anchor is a no-op
- **WHEN** the fragment names `reply:<message id>`
- **THEN** the hunt SHALL end at completeness or at its budget
- **AND** the screen SHALL render normally, with no error and no scroll

#### Scenario: The anchor survives the row moving under the hunt
- **WHEN** the anchored thread is bumped while the hunt is fetching windows
- **THEN** the hunt SHALL still terminate within its budget
- **AND** SHALL scroll at most once for the mount

### Requirement: The thread entry's position SHALL be read from the database and SHALL NOT be derived from a fetched message window

The entry's position SHALL come from a stored column on the thread row. It SHALL NOT be computed by
scanning a bounded window of messages and taking the newest per thread.

A derived position is wrong exactly where this change matters: on a paging club, a thread whose
newest reply falls outside the fetched message window has no known position, so it would be placed
at its creation date — sinking the quiet-then-revived thread that the newest-activity decision
exists to surface. A stored column also makes the position indexable, so the thread source can be
ordered and bounded in the database rather than in the client.

#### Scenario: A thread whose newest reply is outside the message window still sorts correctly
- **WHEN** a thread's newest reply is older than every message in the reply source's window
- **THEN** the thread's entry SHALL still be positioned at that reply
- **AND** its position SHALL NOT fall back to its creation date

#### Scenario: The ordering is served by an index
- **WHEN** the thread source is read for a club
- **THEN** the read SHALL be served by an index on `(club_id, last_activity_at desc, id desc)`
- **AND** no client-side re-sort SHALL be required to establish the stream's order

### Requirement: The single entry SHALL keep the unread signal, and SHALL carry it once

The unread dot is carried by both event kinds today, read from one per-thread map. One entry per
thread SHALL carry it once, from that same map, and the dot SHALL mean what it means now: this
thread holds messages newer than the reader's watermark.

Collapsing two entries into one SHALL NOT change when the dot appears, when it clears, or which
threads it counts. The watermark, its RPC and its cache key SHALL be untouched by this change.

#### Scenario: An unread thread shows one dot
- **WHEN** a thread holds messages newer than the reader's watermark
- **THEN** exactly one entry SHALL be marked unread
- **AND** opening the thread SHALL clear it exactly as it does today

### Requirement: Position SHALL NOT become an audience signal, and no role's reach SHALL change

`last_activity_at` is a sort key. It SHALL NOT appear in any policy, in any audience predicate, or in
any decision about what a rider may read.

`081`'s SELECT policy on `club_threads` SHALL be untouched. A non-member of a public club SHALL read
zero thread rows, a non-member of a private club SHALL reach no timeline at all, a blocked rider
SHALL be absent in both directions by `private.is_blocked`, and a signed-out visitor SHALL reach
nothing — no `anon` grant on `club_threads` and no policy naming `anon`.

A rider SHALL NOT be able to move their own thread, or any other rider's, other than by posting a
message they were already entitled to post.

#### Scenario: A non-member of a public club sees no thread and no position
- **WHEN** a non-member opens a public club whose threads are busy
- **THEN** the timeline SHALL be refused entire, as it is today
- **AND** no thread position SHALL be observable by any means

#### Scenario: A blocked rider's reply does not surface their identity
- **WHEN** a rider blocked in either direction replies in a thread the reader can see
- **THEN** the thread's position MAY move
- **AND** the reader SHALL learn no author, no body and no change in the reply count, because every
  reply read is block-filtered by the same policies

#### Scenario: A rider cannot bump a thread directly
- **WHEN** a rider attempts to write `last_activity_at` on any thread row
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL come from the absence of both a column grant and an UPDATE policy, not
  from client-side validation

