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
| Offline | the write SHALL fail and say so. It SHALL NOT be queued: a wave is an expression at a moment, and replaying it on reconnect makes the app act for the rider later, possibly after they have blocked the subject |
| Permission denied | **the affordance SHALL be absent, not disabled and not erroring.** A rider who cannot read the subject never sees the entry; both INSERT policies use the same `EXISTS` as SELECT, so entry-visible-but-write-refused is empty by construction. A refusal SHALL NOT be rendered as a message naming a block |
| Partial | a wave read resolving while another decoration has not SHALL be correct and SHALL NOT blank either |
| Stale | read on load, no subscription. Another rider's wave appears on the next load; the rider's own toggle is optimistic and locally authoritative until the write answers |

**The removal SHALL be an absence, not a disabled control**, and it SHALL be asserted as one: a test
that only checks what rendered cannot see a control that should not be there.

This ends the double count `097` created one level up — a **join** wave keyed on the rider beside a
**thread** wave keyed on the thread, for one announcement — which is the same objection this
capability already made when it refused two wave targets for one thread.

#### Scenario: A zero count draws nothing
- **WHEN** an entry has no waves
- **THEN** no numeral SHALL be drawn beside the glyph
- **AND** the row's height SHALL NOT change when the first wave arrives in a way that shifts the
  controls under a rider's thumb

#### Scenario: The toggle is never queued offline
- **WHEN** a rider taps wave with no connectivity
- **THEN** the write SHALL fail, the toggle SHALL revert, and a message SHALL be shown
- **AND** no retry SHALL be scheduled, and nothing SHALL be replayed on reconnect

#### Scenario: The refusal never names a block
- **WHEN** a write is refused because the subject is not readable
- **THEN** the message SHALL NOT distinguish "blocked" from "not a member" from "no such subject"
- **AND** the affordance SHALL not have been drawn in the first place

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

`club_join_waves` INSERT SHALL additionally require `user_id <> subject_user_id`.

`club_thread_waves` SHALL carry **no** such restriction, matching `postcard_likes`, which permits a
self-like.

The asymmetry is deliberate and SHALL be recorded where the constraint is written, so it is not
read as an oversight and removed for consistency. A wave on a thread is an endorsement of a topic,
which a rider may coherently feel about their own. A wave on a join is *welcome*, addressed to a
person; addressed to oneself it expresses nothing, and refusing it in the WITH CHECK keeps a
self-addressed row out of the fan-out's path rather than relying on the fan-out to exclude it.

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

DELETE SHALL be `using (user_id = auth.uid())` with **no visibility conjunct**, which is `009`'s
rule and its reason: a rider must be able to withdraw a wave from a subject that has gone out of
view, or the row is stranded.

**The SELECT policy is what makes that reachable, and it SHALL be asserted rather than assumed.**
`081` measured that RLS applies the SELECT policy to a `DELETE` whose `WHERE` names a column, so a
row the caller owns but cannot read survives its own delete with PostgREST reporting success.
Relaxing the DELETE policy cannot repair that, because SELECT is applied first.

**The own-row branch SHALL therefore be a disjunct of the WHOLE SELECT policy**, not a disjunct
inside the block arm. Inside the block arm it is a **no-op** — `blocks_no_self_block` already makes
`is_blocked(x, x)` false — and the parent `EXISTS` still dominates, so a rider blocked by a
thread's author, **and** a rider who has merely left the club, both read zero of their own waves
and both get `DELETE 0` with the row surviving while every remaining member still sees it. That
shape was specified first, measured on the real chain, and corrected; `postcard_likes` carries it
today and is filed separately. Un-hoisting the branch SHALL fail an assertion, because it looks
like a tightening and its cost is invisible from the DELETE policy alone.

No role other than the row's author SHALL delete a wave. There SHALL be no owner or admin
moderation verb for a wave, no `security definer` RPC, and no new advisor.

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

#### Scenario: A wave on a thread whose author has since blocked the waver is still withdrawable
- **WHEN** B waves A's thread and A then blocks B
- **THEN** B SHALL still be able to read and delete their own wave
- **AND** the delete SHALL match the row rather than reporting a silent success against zero rows
- **AND** B SHALL still read no OTHER rider's wave on that thread, and still not read the thread

#### Scenario: A rider who has left the club can still withdraw what they left behind
- **WHEN** a rider leaves a private club in which they waved a thread and welcomed a joiner
- **THEN** both waves SHALL still be deletable by them, each delete matching its row
- **AND** no block SHALL be involved, `private.is_club_member` simply having stopped answering
- **AND** the other waver's rows SHALL be untouched by the departure

#### Scenario: No club role can delete another rider's wave
- **WHEN** a club owner or admin attempts to delete a wave they did not write
- **THEN** the delete SHALL match zero rows
- **AND** no RPC SHALL exist that would let them, because `moderate_club_thread` already removes
  the thread and cascades its waves

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
