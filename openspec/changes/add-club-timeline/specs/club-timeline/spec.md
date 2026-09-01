## ADDED Requirements

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

Blocking SHALL be enforced by the four source policies and by nothing this change adds. The
conjunct per source, each an own-row escape hatch OR-ed with the symmetric helper:

- `club_threads` — `(author_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), author_id))`
- `postcards` — `(author_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), author_id)) AND …)`
- `rides` — `(organizer_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), organizer_id)) AND …)`
- `club_members` — `… AND ((user_id = auth.uid()) OR (NOT private.is_blocked(auth.uid(), user_id)))`

`private.is_blocked(a, b)` is symmetric, so the directional row's direction SHALL NOT matter.

**The merge SHALL NOT reintroduce a blocked rider**, and it cannot take a row from anywhere the
four policies have not already answered for.

**The one path the merge adds is the actor's name.** `profiles` SELECT is
`(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT private.is_blocked(auth.uid(), id)))` — a
separate predicate that can withhold a profile whose parent row arrived. An **event row** whose
actor profile is absent SHALL be dropped, never drawn nameless, extending the rule
`getClubMembers` already applies.

A **postcard entry** SHALL keep `PostcardStamp`'s existing `Rider` fallback, because a postcard is
a photo with a byline rather than a sentence about a person, and partial fidelity there does not
invert its message.

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

Entries SHALL be sorted by their timestamp descending, with the row id descending as the
tiebreak, giving a total order. Timestamp alone is not a total order here: `complete_onboarding`
writes a default-club membership inside one transaction (`058`), so shared instants are ordinary
rather than an edge case, and a stream without a tiebreak reshuffles between loads for no reason
the rider can see.

Each source SHALL be read with its own bound. A source that returns **exactly** its bound is
saturated and is incomplete below its oldest returned row. The **coherence horizon** SHALL be the
**most recent** of the saturated sources' oldest timestamps, and the stream SHALL NOT include any
entry older than it. A source returning fewer rows than its bound SHALL impose no horizon,
because it is complete back to the club's beginning.

The stream SHALL then be capped for display.

The tail SHALL be one of exactly two things:

- **Complete** — no horizon and no cap reached: the last entry SHALL be the club's own creation,
  and nothing further SHALL be drawn.
- **Incomplete** — a **handoff row** offering the four full lists. There SHALL be no infinite
  scroll and no "load more".

The club's creation entry SHALL be drawn **only** in the complete state. Under a truncated stream
it would assert an adjacency that is false.

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

The timeline holds no rows of its own. Every entry is a live row in one of the four sources, so
the stream is a view of the club's **current** state rather than a history of it. Three
consequences SHALL be treated as designed behaviour rather than defects, and SHALL be stated
wherever the timeline is described:

- **A rider who leaves erases their own join entry**, because the `club_members` row is deleted.
  A club that twenty riders joined and left shows a timeline claiming nothing happened.
- **A rider who leaves and rejoins appears to join for the first time**, at their new
  `joined_at`.
- **A deleted postcard, ride or thread removes its entry**, with no tombstone.

There SHALL be no "a rider left" entry, in this change or in any successor built on this design:
a leave is a DELETE and there is no row to read.

#### Scenario: A leave takes its own join entry with it
- **WHEN** a rider leaves the club
- **THEN** their join entry SHALL disappear from every member's timeline
- **AND** no "left the club" entry SHALL appear

#### Scenario: A rejoin is indistinguishable from a first join
- **WHEN** a rider leaves and rejoins
- **THEN** a join entry SHALL appear at the new `joined_at`
- **AND** the timeline SHALL make no claim about it being their first

#### Scenario: `joined_at` cannot be forged
- **WHEN** a rider attempts to write `club_members.joined_at`
- **THEN** the write SHALL be refused, because `048` grants `authenticated` only
  `insert (club_id, role, user_id)` and `update (club_id, role, user_id)`
- **AND** a rider SHALL therefore be unable to place themselves anywhere in another club's
  timeline

### Requirement: Timeline event rows SHALL be automatic only, and no authored announcement SHALL exist

Every event row SHALL be derived from an existing row's timestamp. There SHALL be no
rider-composed or admin-composed announcement, no announcements table, no composer, no pin and
no edit.

"Announcement" is the product owner's word for the automatic row and names nothing a rider
writes. It is stated as a prohibition rather than left unmentioned, because a changelog entry
reading "Announcements" invites the table.

#### Scenario: No writable event surface is introduced
- **WHEN** the change is complete
- **THEN** no table, column, RPC, route or form SHALL exist that lets any role author a timeline
  entry directly
- **AND** the only way to put an entry on a club's timeline SHALL be to do the underlying thing —
  post, ride, start a thread, or join
