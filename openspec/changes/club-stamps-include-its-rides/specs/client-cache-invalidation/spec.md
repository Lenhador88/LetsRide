## ADDED Requirements

### Requirement: Two reads that share a cache key SHALL be widened together, or the key SHALL be split before either moves

Where two functions are documented as returning the same list and share one key, a change that
widens one SHALL widen the other in the same commit. Splitting the key instead SHALL be permitted
only where the two lists are *intended* to differ, and SHALL then be justified as a product decision
rather than as a caching one.

`getClubFeed(clubId)` and `getFeed({}, { kind: 'club', id })` share
`postcards.feed(filterSegment.club(id))` and are documented in
`src/app/(app)/clubs/detail/page.tsx` as *"the same select, order, limit and predicate"*. That
sentence is a **contract**, not a description, and this change keeps it true by making one function
the implementation of both.

#### Scenario: One key, one list, whatever the navigation order
- **WHEN** a rider loads the club detail and then `/postcards?club=<id>`, or the reverse
- **THEN** the two screens SHALL render the same postcards
- **AND** the entry served from cache SHALL be correct for the screen that asks second

#### Scenario: The shared-key note is updated, not left standing
- **WHEN** the widening lands
- **THEN** the comment asserting the two reads are identical SHALL be edited to say what they now
  return
- **AND** it SHALL NOT be annotated with a correction paragraph — `CLAUDE.md` §Working Principles, which
  says to replace a wrong claim rather than narrate it

#### Scenario: A split key would have been a product decision
- **WHEN** the alternative is reviewed
- **THEN** it SHALL be recorded that giving `getClubFeed` its own key makes the strip and its own
  `See all` show legitimately different lists, which is a worse outcome than the defect it avoids

### Requirement: A widened read SHALL have its existing invalidation claims RE-DERIVED against the wider list, not assumed to still hold

This change adds no mutation and no new key, and the existing claims are believed sufficient. That
belief SHALL be re-derived against `keys.ts`'s stated prefix reach rather than assumed, because the
set of writes that can change this list has grown: **tagging a postcard to a ride now changes which
club strips contain it**, which was previously true of no write at all.

The re-derivation, stated so a reviewer can check it rather than take it: `createPostcard` and
`invalidatePostcard` both claim `queryKeys.postcards.all()`, and `postcards.feed(club:<id>)` sits
under that prefix for **every** club, so a postcard created with a `ride_id` naming a club's ride
already invalidates that club's strip without knowing which club it is. `deletePostcard` and the
like/unlike pair reach it the same way.

Where a future write reaches the tag without claiming the whole prefix, the claim SHALL be widened
rather than a club id guessed from a second read.

#### Scenario: The prefix claim is confirmed to reach the widened list
- **WHEN** a postcard is created tagged to a ride of a club the author is not posting to
- **THEN** that club's strip SHALL redraw with the postcard on it, without a reload
- **AND** the claim doing that work SHALL be `postcards.all()`, named explicitly in the review rather
  than inferred

#### Scenario: The narrower-looking claim is refused
- **WHEN** somebody proposes resolving the ride's club so the invalidation can name
  `postcards.feed(club:<that id>)` precisely
- **THEN** it SHALL be refused: it costs a round trip, it under-invalidates whenever the postcard is
  tagged to a ride whose club differs from its audience, and `invalidatePostcard`'s own header
  already records that naming keys precisely *"would under-invalidate by exactly the amount that is
  hard to see"*

#### Scenario: No key is added without a reader
- **WHEN** the change is reviewed
- **THEN** no new entry SHALL appear in `src/lib/query/keys.ts`
- **AND** a key nothing fills SHALL be treated as worse than none, because it carries an
  invalidation claim about an entry that never exists
