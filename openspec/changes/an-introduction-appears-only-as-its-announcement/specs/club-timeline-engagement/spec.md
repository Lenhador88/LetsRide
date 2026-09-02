## MODIFIED Requirements

### Requirement: The wave affordance SHALL define every state, and SHALL be absent rather than inert where it cannot succeed

**The affordance's subject is narrowed by this change to the announcement row alone.** The product
owner, 2026-09-02: *"yes, only annoucements are waveable please."* A thread row on the club timeline
SHALL carry no wave control — neither on its creation entry nor on a reply entry — and the club
timeline's only waveable row SHALL be the join/announcement row.

The state table stands unchanged **for the row that still carries a wave**:

| State | Behaviour |
|---|---|
| Empty | zero waves SHALL render **no count at all**, never `0` |
| Loading | the entry SHALL render immediately with the toggle disabled and no count; the stream SHALL NOT be gated on the wave read |
| Error | a failed read costs marks not rows; a failed **write** SHALL roll the optimistic toggle back and surface its message inline without reflowing the row |
| Offline | the write SHALL fail and say so, and SHALL NOT be queued |
| Permission denied | the affordance SHALL be absent, not disabled and not erroring |
| Partial | a wave read resolving while another decoration has not SHALL be correct and SHALL NOT blank either |
| Stale | read on load, no subscription |

**The removal SHALL be an absence, not a disabled control**, and it SHALL be asserted as one: a test
that only checks what rendered cannot see a control that should not be there.

This ends the double count `097` created one level up — a **join** wave keyed on the rider beside a
**thread** wave keyed on the thread, for one announcement — which is the same objection this
capability already made when it refused two wave targets for one thread.

#### Scenario: No thread row on the timeline draws a wave
- **WHEN** the club timeline draws a thread's creation entry or a reply entry
- **THEN** no wave control SHALL be rendered on it, in any state
- **AND** the row SHALL keep its title, its lead line, its faces, its count, its unread mark and its
  scroll anchor

#### Scenario: The announcement row keeps its wave
- **WHEN** the timeline draws another rider's join entry
- **THEN** the wave control SHALL be present and behave exactly as it does today
- **AND** it SHALL remain absent on the viewer's own join row

#### Scenario: One announcement, one counter
- **WHEN** a rider looks at an announcement and its introduction
- **THEN** exactly one wave counter SHALL exist for it, on the join row

### Requirement: A rider SHALL NOT be able to welcome themselves, and a rider MAY endorse their own thread

**The database half of this requirement stands unchanged and SHALL NOT be altered by this change**:
the join wave's WITH CHECK SHALL continue to refuse `user_id = subject_user_id`, and the thread wave
table SHALL continue to carry no such restriction, matching the self-like the postcard reaction
permits.

**The client half is retired.** No affordance in the app writes a thread wave any more, so "a rider
MAY endorse their own thread" describes a permission the database still grants and the app no longer
exercises. The asymmetry SHALL stay recorded where the constraint is written, so it is not read as an
oversight and removed for consistency by a session that notices the affordance is gone.

#### Scenario: A self-welcome is still refused by the database
- **WHEN** a rider attempts to wave their own join
- **THEN** the INSERT SHALL be refused
- **AND** the affordance SHALL be absent from their own join row

#### Scenario: The thread wave table keeps its permissions
- **WHEN** this change is applied
- **THEN** no policy, grant, constraint or trigger on either wave table SHALL be altered
- **AND** the assertions covering them SHALL neither be changed nor removed

### Requirement: A wave SHALL be withdrawable by its author regardless of whether its subject is still visible

**Narrowed by this change to the DATABASE layer, and the app-level exception is named rather than
left for a reader to discover.** Every clause of this requirement stands as written: the DELETE
policy is still `using (user_id = auth.uid())` with no visibility conjunct, the own-row branch is
still a disjunct of the whole SELECT policy, and all three of its scenarios still hold — they are
database-level and this change touches no policy, no grant and no table.

**What is no longer true is its stated REASON, for thread waves alone.** *"A rider must be able to
withdraw a wave from a subject that has gone out of view, or the row is stranded"* — and after this
change every existing `club_thread_waves` row IS stranded, because the control that reached the
DELETE is gone with the rest of the client path. Three rows on DEV, measured 2026-09-02. The
product owner asked for this directly (*"yes, only annoucements are waveable please"*), so the
requirement is narrowed rather than contested:

- **For `club_join_waves` it holds end to end** — the join row is the club timeline's only waveable
  row, and its control still withdraws.
- **For `club_thread_waves` it holds at the database and nowhere above it.** A rider who waved a
  thread before this change SHALL NOT be offered a way to withdraw it, and the app SHALL NOT grow
  one back: re-adding a control to reach a stranded row would re-add the double count this change
  removed.

**The remedy is the successor, not a control.** `proposal.md` §The table with no writer names what
dropping the table owes; until then the rows are inert rather than repairable, and that is the
cost of the instruction rather than an oversight in it. A session reading this capability end to
end SHALL read this as a superseding decision and SHALL NOT file the contradiction as a bug.

#### Scenario: A pre-existing thread wave cannot be withdrawn from the app
- **WHEN** a rider who waved a club thread before this change opens that thread's row on the club
  timeline
- **THEN** no wave control SHALL be drawn, waved or not
- **AND** the row SHALL remain in `club_thread_waves` with its DELETE policy unchanged
- **AND** no new affordance SHALL be added to reach it

## ADDED Requirements

### Requirement: Retiring an affordance SHALL retire its whole client path, and a table left with no writer SHALL be named as such

When a control is removed, everything that existed only to serve it SHALL be removed with it — the
action, the read, the cache key and the prop — so that nothing dead is left looking live. A
half-retired path is how a later session re-wires a control the product owner asked to remove.

Where that leaves a **table** with no writer in the app, the proposal SHALL say so in as many words,
SHALL state what remains live about it, and SHALL leave the pointer for whoever removes it. It SHALL
NOT be removed in the same change, because dropping a table is destructive, has the opposite
deploy-ordering rule to the client change, and is safe only once the client that stopped using it is
serving.

The following SHALL be stated for such a table rather than discovered:

- rows already written SHALL be described as orphaned — readable by the policies, unreachable by the
  app, and no longer withdrawable by their authors through any affordance;
- triggers hanging off it SHALL be named as still live;
- notifications its fan-out already delivered SHALL keep working, and the client switches that render
  them SHALL NOT be narrowed, because the type still exists and rows still hold it.

#### Scenario: Nothing dead is left behind
- **WHEN** the thread wave control is removed
- **THEN** its action, its read, its cache key and its component prop SHALL be removed with it
- **AND** no exported function SHALL remain whose only caller was the removed control

#### Scenario: The table is named, not dropped
- **WHEN** the change is complete
- **THEN** the thread wave table, its policies, its grants and its fan-out triggers SHALL be unchanged
- **AND** the proposal SHALL name it as having no writer in the app, with what a successor owes

#### Scenario: Delivered notifications survive the retirement
- **WHEN** a rider opens a notification recording a thread wave delivered before this change
- **THEN** it SHALL render with its existing copy and its existing destination
- **AND** no notification type SHALL be removed from any exhaustive switch
