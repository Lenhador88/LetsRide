## MODIFIED Requirements

### Requirement: The timeline SHALL be derived from live rows, and what that omits SHALL be stated

The timeline holds no **event** rows of its own. Every entry is a live row in one of the sources, so
the stream is a view of the club's **current** state rather than a history of it. Five consequences
SHALL be treated as designed behaviour rather than defects, and SHALL be stated wherever the timeline
is described:

- **A rider who leaves erases their own join entry**, because the `club_members` row is deleted.
- **A rider who leaves and rejoins appears to join for the first time**, at their new `joined_at`.
- **A deleted postcard, ride or thread removes its entry**, with no tombstone.
- **A wave dies with the entry it decorates**, from `club-timeline-engagement`.
- **An introduction does NOT die with the membership it decorates.** A leave clears the marker and
  leaves the thread standing; the join entry it decorated has gone anyway.

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

#### Scenario: An introduction appears once while its subject is a member
- **WHEN** a club timeline is rendered and an introduction carries its marker
- **THEN** exactly one entry SHALL represent it, and it SHALL be the announcement row
- **AND** no thread-creation entry and no reply entry SHALL be drawn for it

#### Scenario: A leave restores the ordinary entries
- **WHEN** the subject leaves the club
- **THEN** the announcement row SHALL disappear with the membership
- **AND** the thread SHALL become an ordinary thread and MAY produce a thread entry and reply entries
  like any other

## ADDED Requirements

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
