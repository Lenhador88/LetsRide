## MODIFIED Requirements

### Requirement: Introductions SHALL be distinguishable from one another wherever threads are listed

**Narrowed by this change rather than dropped.** An introduction is no longer listed among a club's
threads while its subject is a member, so the case this requirement governs is now the one that
survives a leave: an **ex-member's** introduction, which returns to the Threads list as an ordinary
thread carrying the same constant title as every other introduction.

Such a row SHALL carry, in its secondary line, something that tells it apart from another — the
author's name being the obvious and correct choice, since it is what the row is about. It SHALL be
derived from the thread's **author**, which survives the leave, and SHALL NOT be derived from the
marker, which does not.

#### Scenario: Two ex-members' introductions in one club are told apart
- **WHEN** two riders who each introduced themselves have both left the club
- **THEN** both introductions SHALL appear on the Threads list as ordinary threads
- **AND** their rows SHALL differ from each other in what they display
- **AND** the difference SHALL name the rider, not a position or a date alone

#### Scenario: A current member's introduction is not on that list to be confused with anything
- **WHEN** a club holds introductions from two riders who are both still members
- **THEN** neither SHALL appear on the Threads list at all
- **AND** each SHALL appear exactly once on the timeline, on its own announcement row

## ADDED Requirements

### Requirement: An introduction SHALL appear on exactly one browse surface while its subject is a member

The announcement row — the join entry carrying the introduction's door and comment count — SHALL be
the only place a club's browse surfaces draw an introduction. While the introduction carries its
marker it SHALL NOT appear:

- as a thread-creation entry on the club timeline;
- as a reply entry on the club timeline when somebody comments on it;
- as a row on the club's Threads list.

Its thread screen SHALL remain reachable through that row's door, through a direct link, and through
any notification naming it, and SHALL be unchanged in every respect.

#### Scenario: A comment on an introduction adds no timeline row
- **WHEN** a member comments on another member's introduction
- **THEN** no new entry SHALL appear on the club timeline
- **AND** the announcement row's comment count SHALL increase by one for every viewer who can read
  that comment

#### Scenario: The introduction is drawn once, not three times
- **WHEN** a member opens a club detail holding one introduction with comments
- **THEN** the introduction SHALL be represented by exactly one row on the stream
- **AND** that row SHALL be the announcement row

#### Scenario: The thread itself is untouched
- **WHEN** a rider opens an introduction's thread by any route
- **THEN** the thread, its introduction text, its comments, its composer, its moderation and its
  report affordance SHALL behave exactly as before this change

### Requirement: The marker SHALL decide where an introduction is drawn, and the rule SHALL be stated in one place

The rule SHALL be: **a thread is an announcement while `introduces_user_id` is non-null, and an
ordinary thread otherwise.** It SHALL NOT be keyed on the introduction text.

Every read that lists threads or their activity SHALL apply that one rule, and the rule SHALL be
expressed once — one named, documented definition that each read applies — so that a later change
cannot move one surface and leave another behind.

The rule SHALL be applied in the query rather than to the rows a query returned. A read whose rows
are its window SHALL keep that property, because both the Threads list's "is there another page"
signal and the timeline's threads horizon are computed from it.

#### Scenario: The three reads agree
- **WHEN** the Threads list, the timeline's thread entries and the timeline's reply entries are read
- **THEN** all three SHALL exclude the same set of threads
- **AND** the exclusion SHALL be expressed through one definition rather than three literals

#### Scenario: The text is never the key
- **WHEN** a thread carries introduction text and no marker
- **THEN** it SHALL be treated as an ordinary thread by every surface

### Requirement: A leave SHALL return an introduction to the Threads list, and that SHALL be a designed state

`097` nulls the marker when the subject leaves the club and keeps the thread, its text and every
comment. The join entry goes with the membership. So on a leave the introduction SHALL become an
ordinary thread and SHALL be listed as one — reachable, moderatable, and honest about what it now
is.

The alternative — keying the filter on the introduction text — SHALL NOT be adopted, because it
leaves a thread that still exists, still holds other riders' words, and is reachable from no browse
surface at all. That is the defect `097` refused one level down when it required the thread screen
to render on the text and never on the marker.

Its position in the list SHALL be its own `created_at`, so it appears where it was always written
rather than at the top; the leave SHALL produce no notification, no unread change and no reordering.

#### Scenario: An ex-member's introduction is reachable
- **WHEN** the subject of an introduction leaves the club
- **THEN** their introduction SHALL appear on the club's Threads list as an ordinary thread
- **AND** its comments SHALL remain readable under the same policy as before
- **AND** a club admin SHALL be able to reach and moderate it by the ordinary route

#### Scenario: The row does not jump
- **WHEN** that thread returns to the list
- **THEN** it SHALL be ordered by its own creation time, not by the leave
- **AND** no rider SHALL be notified, and no unread state SHALL change as a result of the leave

#### Scenario: A rejoin does not restore the announcement
- **WHEN** that rider rejoins the club
- **THEN** the old thread SHALL remain an ordinary thread, its marker having been nulled
- **AND** the rider SHALL be treated as owing a new introduction, per `097`

### Requirement: Every role's reach into an introduction SHALL be unchanged by this change, and that SHALL be asserted rather than assumed

This change adds no policy, no grant, no function and no migration. It SHALL therefore change
nothing about who may read or write an introduction, and the following SHALL each remain true —
each already enforced by `081`, `092`, `094` and `097` and asserted in `supabase/tests/rls_test.sql`:

| Role | Reach into an introduction and its comments |
|---|---|
| **Owner** of the club | Reads the thread and every comment; may moderate it. Unchanged |
| **Admin** of the club | Reads the thread and every comment; may moderate it. Unchanged |
| **Member** | Reads the thread and every comment; may comment; may delete only their own comment. Unchanged |
| **The subject** | Reads and may delete their own introduction's thread. Unchanged |
| **Non-member of a PUBLIC club** | Reads the club and its roster; reads **zero** threads and **zero** messages. Unchanged, and the filter SHALL NOT be described as what achieves it |
| **Non-member of a PRIVATE club** | Reads nothing, including the club. Unchanged |
| **Blocked rider** (either direction) | The block is symmetric and enforced in the policies; a blocked author's thread and comments do not arrive, and the comment count aggregated under row security therefore excludes them per-viewer. Unchanged, and this change SHALL restate none of it |
| **Signed-out visitor** | Reaches the shell and no data. `anon` holds zero grants on `club_threads` and `club_messages` |

#### Scenario: The filter is not a visibility rule
- **WHEN** a non-member of a public club opens that club's Threads list
- **THEN** they SHALL see zero threads because `081` returned zero rows
- **AND** the announcement filter SHALL be irrelevant to that outcome, having nothing to filter

#### Scenario: A blocked rider's comment is uncounted without a second rule
- **WHEN** a rider who has blocked, or is blocked by, a commenter reads an announcement row
- **THEN** that commenter's comment SHALL neither be counted nor rendered
- **AND** no code added by this change SHALL name a block, a membership or a club's privacy

#### Scenario: No new grant is needed to apply the rule
- **WHEN** any of the three reads applies the marker filter
- **THEN** it SHALL succeed for `authenticated` under `097`'s existing column-level SELECT grant
- **AND** no migration SHALL be required for any part of this change

### Requirement: The exact comment count SHALL survive and the windowed one SHALL NOT be computed for an announcement

Two counts for one introduction exist today: the **exact** count on the announcement row, aggregated
by Postgres under row security over that one thread, and the **floor** count derived from the
club-wide message window, which carries a `+` when the window filled.

After this change the announcement row's exact count SHALL be the only one that exists for an
introduction. The floor count SHALL NOT merely go undrawn — the announcement's messages SHALL NOT
enter the window at all, so no activity entry SHALL be computed for it.

The two SHALL NEVER be drawn for the same thread in the same view.

#### Scenario: One count, and it is exact
- **WHEN** an announcement row draws its comment count
- **THEN** the number SHALL be the count aggregated over that thread under row security
- **AND** it SHALL carry no `+`, because it is not derived from a window

#### Scenario: The window holds no announcement messages
- **WHEN** the club-wide message window is read for the timeline
- **THEN** it SHALL contain no message belonging to a thread carrying a marker
- **AND** the per-thread activity map SHALL hold no entry for such a thread
