## MODIFIED Requirements

### Requirement: A thread SHALL appear on the ride's timeline, bounded by thread count and never by message count

**This requirement previously mandated two sources each contributing a row** — *"The ride timeline
SHALL gain a thread-creation source and a latest-reply source, mirroring `mergeClubTimeline`'s
`thread` and `reply` arms. Each SHALL contribute at most one row per thread."* That is what draws one
conversation twice, and it is replaced.

The ride timeline SHALL carry **one** entry per thread, positioned at the thread's
`last_activity_at`. The `reply` event kind SHALL be removed from `RideTimelineEvent`.

The reply source SHALL remain and SHALL become a **decoration** source: it supplies each thread's
reply count and that count's `partial` flag, and it contributes no entry to the stream. Its horizon
SHALL leave `mergeRideTimeline`'s horizon list, because a source that draws nothing must not cut the
stream; its horizon SHALL still decide whether a count is exact or a floor.

**Both thread sources SHALL remain bounded by thread count and never by message count.** That bound
is what keeps `ride-timeline.ts`'s no-paging argument true — a conversation is the first source on a
ride with no natural ceiling — and this change SHALL NOT weaken it. The reply read SHALL continue to
scan a message window and collapse it to one row per thread before returning, and SHALL continue to
measure its horizon on the **window** rather than on the survivors.

The thread source SHALL order by `last_activity_at` descending with `id` as the tiebreak, and SHALL
declare its horizon from `last_activity_at` — the same dimension it is positioned in.

`mergeRideTimeline` SHALL keep deriving completeness from *"no source declared a horizon"* and SHALL
NOT adopt the weaker *"the horizon filter dropped nothing"*, which is reachable-wrong through a
per-thread-collapsed source.

#### Scenario: A ride thread that has been replied to draws one row
- **WHEN** a crew member opens a ride whose thread was created yesterday and replied to an hour ago
- **THEN** the timeline SHALL draw exactly one entry for that thread, at the reply
- **AND** no second entry SHALL be drawn for the thread's creation

#### Scenario: A ride thread with no replies is unmoved
- **WHEN** a thread on a ride has no messages
- **THEN** its entry SHALL sit at its `created_at`, exactly where it sits before this change

#### Scenario: The replies source still collapses to one row per thread
- **WHEN** the reply source is read for a ride with two threads holding two hundred messages between
  them
- **THEN** it SHALL return two rows of decoration
- **AND** the bound SHALL be a property of the read, not of the display cap

#### Scenario: A busy thread does not push the ride's own history off its timeline
- **WHEN** a ride has more threads than `RIDE_TIMELINE_LIMIT`
- **THEN** the timeline SHALL cut at its horizon and say so at the foot, exactly as it does for
  postcards and joins
- **AND** the thread list screen SHALL remain the complete view

#### Scenario: A timeline thread row is refused to a rider who may not read the thread
- **WHEN** a rider who can see the ride but is not on its crew loads the ride timeline
- **THEN** no thread row SHALL appear, because the read returns zero rows under RLS
- **AND** no reply count SHALL be observable, because the decoration read is refused by the same
  policy
- **AND** the absence SHALL come from the policy and SHALL NOT be a client-side filter

## ADDED Requirements

### Requirement: The ride's thread row SHALL gain a reply count and SHALL gain the `partial` flag in the same change

`RideTimelineThreadRow` deliberately carries no count today, and its header states why: a count
derived from a bounded message window counts what was **fetched**, not what exists. A bare total the
row cannot know is a wrong number presented as a right one.

The row SHALL therefore gain the comment glyph, the reply count **and** the `partial` flag together.
A count the read cannot prove exact SHALL be rendered as a floor — `12+` — in the same treatment the
club's row already uses. Adding the count without the flag SHALL NOT be done, in this change or any
later one.

A count SHALL be exact when the reply source's horizon is `null`, or when the thread was created at
or after that horizon. That comparison SHALL use the thread's `created_at` and never its
`last_activity_at`: a thread that has just bumped sits above the horizon while its own older messages
sit below it, so comparing the entry's position would render a floor as an exact total.

A thread with no replies SHALL render zero, exactly, and SHALL NOT render a floor — its emptiness is
provable from the thread row itself.

#### Scenario: A ride thread row draws a floor when the window saturated
- **WHEN** the reply window saturates and a thread was created before its horizon
- **THEN** the row SHALL render the count as a floor
- **AND** it SHALL NOT render a bare total

#### Scenario: A ride thread row draws an exact count when the coverage proves it
- **WHEN** the reply window comes back short
- **THEN** every thread's count SHALL be rendered exactly
- **AND** a thread with no replies SHALL render zero

#### Scenario: The count and the flag ship together
- **WHEN** this change is complete
- **THEN** no code path SHALL render a ride thread reply count without consulting its `partial` flag

### Requirement: A ride thread's activity column SHALL be server-owned and SHALL change no audience

`ride_threads.last_activity_at` SHALL be maintained only by an `AFTER INSERT` trigger on
`ride_thread_messages`. `authenticated` SHALL hold no INSERT and no UPDATE grant on the column, and
`ride_threads` SHALL continue to carry no UPDATE policy at all.

`108`'s SELECT policy SHALL be untouched. The column is a sort key and SHALL NOT appear in any
policy or audience predicate. A non-crew rider SHALL read zero thread rows whatever the column holds,
and `anon` SHALL hold nothing on the table.

A past ride's threads SHALL behave exactly as a current ride's: a reply to a thread on a ride that
has already departed SHALL bump it, because the ride's timeline is a record of its conversation and
not of its schedule.

#### Scenario: A rider cannot bump their own ride thread
- **WHEN** a rider attempts to set `last_activity_at` on a thread they authored
- **THEN** the write SHALL be refused by the absent grant and the absent policy
- **AND** the RLS suite SHALL assert both, scoped to the `authenticated` grantee

#### Scenario: A non-crew rider observes no position
- **WHEN** a rider who can see the ride but is not on its crew reads `ride_threads`
- **THEN** they SHALL receive zero rows
- **AND** the new column SHALL change nothing about that refusal
