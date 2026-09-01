## ADDED Requirements

### Requirement: A screen assembled from several independently-audienced reads SHALL define every state ONCE, for the whole screen

The club detail today makes six independent decisions about what a rider who cannot see a
section's rows is told, and two of them already refuse to lie — `ClubThreadsSection` renders
*"Join the club to read and start threads."* and `ClubPostcardCarousel` renders *"Postcards in
this club are for its members."* Merging those sections into one stream deletes the six
decisions and leaves one. It SHALL be made deliberately, for all seven states.

| State | Behaviour |
|---|---|
| Empty | **unreachable by construction** for a member: a brand-new club always holds its owner's `club_members` row and the club's own `created_at`, so the shortest stream is two entries. The screen SHALL therefore have no empty state and SHALL render the shortest stream under the club's own band, which reads as a beginning rather than as a failure |
| Loading | gate on the **data**, never on `isLoading` — `useQuery` starts its fetch in an effect, so the first render pass has no data *and* no fetch in flight. A skeleton stream, and the identity band and rides strip SHALL be allowed to paint ahead of it rather than being held behind one gate |
| Error | a failed timeline read SHALL show a retryable error **in place of the stream only**. It SHALL NOT take the club down: the identity band, the rides strip and the Members rail SHALL still render, the same call `ClubMemberRail` and `ClubThreadsSection` already make |
| Offline | the stream SHALL render from cache when there is one, unchanged and unmarked, and SHALL show the same retryable error as any failed read when there is not. Nothing here is queued: every entry is a record of something that already happened |
| Permission denied | **a refusal, never an empty stream.** For a non-member of a public club the reads SHALL NOT be issued at all, so the refusal is reachable without a round trip and is not an interpretation of an empty result. See the `club-timeline` capability |
| Partial | **the normal case, and the one that must not be silent.** One source failing SHALL NOT blank the stream; the stream SHALL render from the sources that answered **and SHALL be treated as saturated at that point**, so the coherence horizon truncates rather than the merge silently omitting a source's whole history |
| Stale | the stream is read on load and SHALL NOT subscribe. A write made from the create bar SHALL invalidate it — see the `client-cache-invalidation` delta |

#### Scenario: One failed source does not silently delete a kind of event
- **WHEN** the threads read fails and the other three answer
- **THEN** the stream SHALL render without thread entries
- **AND** the failed source SHALL be treated as saturated at the newest timestamp it could have
  returned, so the stream does not extend into a range it cannot vouch for
- **AND** the screen SHALL NOT claim the club has no threads

#### Scenario: The screen never renders `undefined` on first paint
- **WHEN** the first render pass runs, before the effect that starts the fetches
- **THEN** the screen SHALL render its skeleton, gated on the absence of data rather than on
  `isLoading`, which is `false` at that moment

#### Scenario: A failed stream does not take the club down
- **WHEN** every timeline read fails but `getClub` succeeded
- **THEN** the identity band, the upcoming-rides strip and the Members rail SHALL render
- **AND** a retryable error SHALL occupy the stream's place alone

### Requirement: Permission-denied SHALL NOT be rendered as a partial result when partial fidelity inverts the message

`client-render-shell` already requires that permission-denied and empty be told apart where the
rider can act on the difference. A merged stream adds a third case those two do not cover: a
result that is **neither** denied nor empty, but so partial that it asserts the opposite of what
is true.

A screen SHALL apply this test: **a partial view is honest when partial fidelity preserves the
message, and dishonest when it inverts it.** Where it inverts, the screen SHALL refuse rather
than render partially.

Worked both ways on the club detail, so the test is not abstract: a rides strip showing 2 of a
club's 5 rides still says *this club rides*, and stays; a stream showing 3 of 300 events says
*nothing happens here* about a busy club, and goes.

#### Scenario: The rule is applied per section, not per screen
- **WHEN** a non-member opens a public club
- **THEN** the upcoming-rides strip and the Members rail SHALL render, both being honest at
  partial fidelity
- **AND** the timeline SHALL be replaced by a refusal, being dishonest at partial fidelity
- **AND** the two decisions SHALL be reachable independently, so a later change to one does not
  silently move the other
