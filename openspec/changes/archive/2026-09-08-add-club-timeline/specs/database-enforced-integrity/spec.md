## ADDED Requirements

### Requirement: A merged view of several tables SHALL be assembled under the caller's own row security, and SHALL NOT be served by a `security definer` union

Where a screen shows one ordered stream built from rows of several tables whose audiences differ,
the rows SHALL be obtained by separate reads, each returning under the SELECT policy of the table
that owns it. No `security definer` function SHALL return such a union.

This is the general form of the rule `034` learned the hard way and it is stated here because the
next three screens want the same shape — the profile timeline, the standalone ride Journal
(PD-257), and any Inbox aggregate.

**Why a definer union is not merely a shortcut.** Its body runs as the owner, for whom row
security does not apply, so every audience rule of every source has to be restated inside it by
hand. For the club timeline that is five predicates and four symmetric block arms, drawn from
four unrelated policies, one of which (`083`'s live-invite disjunct on `rides`) has nothing to do
with the subject at all. And **`supabase/tests/` cannot see the mistake**: the suite runs as the
table owner, for whom neither RLS nor the grants exist, so a definer body that silently returns a
private club's thread titles passes every assertion in the file.

**The costs of the client merge are the ones to pay.** More round trips, and a bound per source
rather than one bound over the union. Both are visible, bounded and stated in the spec that uses
them. A restated audience rule that drifts is none of those things.

Where a merged view genuinely cannot be built from ordinary reads, the exception SHALL be a
narrow `security definer` accessor **returning ids and never rows**, on the precedent of
`ride_journal_postcard_ids` (`062`) and `club_stamp_postcard_ids` (`086`), so that RLS still
decides every row that renders.

#### Scenario: No union accessor is added
- **WHEN** a client screen needs an ordered stream over several tables
- **THEN** it SHALL issue one read per table and merge the results in the client
- **AND** no function SHALL be added that returns rows of more than one of those tables

#### Scenario: An id-returning accessor is the only permitted narrowing
- **WHEN** ordering or correlation genuinely cannot be expressed by the client
- **THEN** a `security definer` accessor MAY return identifiers and an ordering key
- **AND** the rows themselves SHALL still be read through the caller's own RLS, so a caller who
  may not see a row receives nothing for its id

#### Scenario: The suite's blind spot is stated where the temptation is
- **WHEN** a session considers replacing several reads with one privileged function
- **THEN** the deciding fact SHALL be that the RLS suite runs as the table owner and would pass
  regardless
- **AND** the absence of a failing test SHALL NOT be read as evidence that the union is safe
