## MODIFIED Requirements

### Requirement: A child table whose audience is NARROWER than its parent's SHALL enforce that by composition, never by a privileged helper alone

Where a table's audience is narrower than the audience of the row it hangs off, its SELECT policy
SHALL contain **both** an `EXISTS` against the parent evaluated under the caller's own row
security **and** the narrowing predicate. A `security definer` helper SHALL NOT be the only
condition.

**Every child table in this schema until now inherits its parent's audience exactly** —
`postcard_comments`, `postcard_likes`, `postcard_reports` and the `storage.objects` read policy
all express it as a bare `EXISTS` and restate nothing, which is deliberate and correct for them.
A ride's chat is the first table that is narrower, and the two obvious implementations are both
wrong in opposite directions: the bare `EXISTS` alone admits every rider who can see the ride,
and the narrowing helper alone **bypasses the parent's policy entirely**, because a
`security definer` function does not run under RLS.

That second failure is not hypothetical here. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate; a `ride_members`
row survives blocking the organizer, leaving the club, and the club turning private. So "holds a
crew row" and "can see the ride" are independent conditions, and only their conjunction is the
audience. `private.is_club_member` has the identical shape and no such gap only because `clubs`
deliberately carries no block predicate — which makes copying that shape verbatim the specific
trap this requirement closes.

**Which conjunct is the strict one is a property of the parent, not of the pattern, and it is not
always the parent.** A club's threads are the worked counter-example. `clubs` SELECT is
`is_public OR owner_id = auth.uid() OR private.is_club_member(id)`; `is_public` admits **every
signed-in rider**, so on a public club the parent `EXISTS` is satisfied by the entire platform and
contributes nothing. There, the **narrowing helper is the load-bearing half** and the `EXISTS` is
the redundant one — the exact inverse of the ride chat. An implementer who carries the ride chat's
*conclusion* ("the `EXISTS` is what protects you") rather than its *reasoning* returns every public
club's child rows to every rider in the app.

Both conjuncts are still required in both directions, and the reason a redundant conjunct stays
SHALL be stated truthfully rather than borrowed. Writing "the helper alone is a leak" where it is
not is itself a defect: `061` records that a comment whose stated reason is false is how the next
session removes the conjunct.

#### Scenario: The parent-visibility conjunct is present and is not redundant
- **WHEN** a policy on a table whose audience is narrower than its parent's is written or
  reviewed
- **THEN** it SHALL contain an `EXISTS` against the parent evaluated under the caller's own row
  security
- **AND** that conjunct SHALL NOT be removed on the grounds that the narrowing predicate already
  implies it

#### Scenario: The narrowing conjunct is present even where the parent is the permissive half
- **WHEN** the parent's SELECT policy admits a strictly wider audience than the child's — a public
  club admitting every signed-in rider, for instance
- **THEN** the narrowing predicate SHALL be present and SHALL be understood as the load-bearing
  conjunct
- **AND** a review SHALL establish **which** conjunct is strict for that parent before accepting the
  policy, rather than transferring the answer from another table

#### Scenario: A redundant conjunct is justified by what could change it, not by a borrowed reason
- **WHEN** one conjunct provably implies the other under the parent's current policy
- **THEN** both SHALL still be written
- **AND** the stated reason SHALL be that the implication is a property of the parent's present
  policy which a later arm can break silently, and that using a `private` membership helper as a
  sole conjunct anywhere establishes by example that the shape is safe
- **AND** the stated reason SHALL NOT assert a leak that does not exist

#### Scenario: A blocked rider cannot reach a child row through a definer helper
- **WHEN** a rider who has blocked, or been blocked by, a parent row's owner still satisfies the
  narrowing predicate
- **THEN** zero child rows SHALL be returned
- **AND** the refusal SHALL be attributable to the parent-visibility conjunct, asserted in
  isolation from the narrowing one

#### Scenario: Where the parent carries no block predicate, the child carries its own
- **WHEN** a child table hangs off a parent whose SELECT policy contains no `private.is_blocked`
  call — `clubs` today
- **THEN** the child's own SELECT policy SHALL carry the block arm against the **author** of the
  child row, because decision #2 is not satisfied by inheritance from a parent that does not
  enforce it
- **AND** the RLS suite SHALL assert that the parent still carries no block predicate, so that the
  day one is added, the reasoning is re-read rather than silently outlived

#### Scenario: Each conjunct is asserted alone
- **WHEN** assertions are written for such a policy
- **THEN** at least one case SHALL fail if the parent-visibility conjunct is removed, and at
  least one different case SHALL fail if the narrowing conjunct is removed
- **AND** a single case that both conjuncts happen to hide SHALL NOT be accepted as coverage,
  because it cannot say which one did the work

#### Scenario: The privileged helper is not published
- **WHEN** the narrowing predicate is a `security definer` function
- **THEN** it SHALL live in the `private` schema so PostgREST cannot publish it
- **AND** `authenticated` SHALL hold EXECUTE on it, because an RLS expression is evaluated as the
  querying role, and that grant SHALL be asserted by naming the role rather than by calling the
  function — the suite runs as the table owner, for whom no barrier exists

## ADDED Requirements

### Requirement: A grandchild table SHALL restate its grandparent's audience rather than inherit it through one hop

Where a table hangs off a child that itself narrows its parent — a message on a thread inside a
club — its SELECT policy SHALL express the **full** audience, not merely an `EXISTS` against the
intermediate row.

An `EXISTS` against the intermediate table evaluated under the caller's row security does compose
correctly today, because the intermediate's own policy runs. But the cost of relying on that is
that the grandchild's audience becomes undiscoverable from its own policy text, and a later change
to the intermediate silently retargets it. The two-hop chain SHALL be written out.

#### Scenario: A message's policy names the club, not only the thread
- **WHEN** the SELECT policy for messages inside a club thread is written
- **THEN** it SHALL contain the club-visibility `EXISTS`, the club-membership predicate, and the
  message's own block arm
- **AND** it SHALL NOT be reduced to a bare `EXISTS` against the thread on the grounds that the
  thread's own policy already decides it

#### Scenario: Each hop is asserted independently
- **WHEN** assertions are written for the grandchild
- **THEN** a rider refused by club visibility, a rider refused by club membership, and a rider
  refused by the block arm SHALL each be asserted as a separate case
