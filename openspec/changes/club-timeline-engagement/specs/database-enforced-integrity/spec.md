## ADDED Requirements

### Requirement: A reaction table SHALL inherit its subject's audience through a parent `EXISTS`, and SHALL restate nothing

Where a table holds a rider's reaction to a row in another table, its SELECT and INSERT policies
SHALL consist of exactly two conjuncts:

1. an `EXISTS` against the parent row, evaluated under the caller's own row security; and
2. a symmetric block arm on the **reactor**, with an own-row escape hatch —
   `user_id = auth.uid() or not private.is_blocked(auth.uid(), user_id)`.

It SHALL restate no membership predicate, no club-visibility predicate, no role test and no block
arm on the parent's own author. The parent's policy already answers all of them, and the `EXISTS`
runs under the caller's session, so the reaction's audience tracks the subject's exactly.

This is `009`'s `postcard_likes` shape stated as a general rule because this change is the second
and third instance of it, and the reason it works is easy to lose: *"the EXISTS subquery is
evaluated under the querying rider's own RLS, so like visibility tracks postcard visibility exactly
rather than restating it… Restating it would be two predicates that have to be kept in step, and
the one that drifts is the one nobody reads."*

**The INSERT policy SHALL use the same `EXISTS` as SELECT**, so "cannot react to what you cannot
see" is one predicate rather than two that can diverge.

#### Scenario: A reaction policy names no audience of its own
- **WHEN** a reaction table is added
- **THEN** its policies SHALL name only its own key columns, the parent `EXISTS`, and the reactor
  block arm
- **AND** a policy change on the parent SHALL move the reaction's audience with no edit anywhere

#### Scenario: The parent's own block arm is not copied
- **WHEN** the parent's SELECT policy carries a block arm on its author
- **THEN** the reaction's policy SHALL NOT repeat it
- **AND** a reaction by an unblocked rider on a row by a blocked one SHALL be unreachable because
  the parent row is, not because the reaction restated the rule

### Requirement: A reaction count SHALL be computed under RLS, SHALL NOT be stored, and SHALL NOT be used as a shared fact

A count of reactions SHALL be an aggregate over the rows the caller's own policies return. It SHALL
NOT be denormalised into a column on the parent or anywhere else.

**The count is therefore per-viewer, and what that forbids SHALL be stated wherever it is
defined.** Because two riders may legitimately see different totals for one row, a reaction count
SHALL NOT order, rank or sort any list; SHALL NOT provide a cursor or page boundary; and SHALL NOT
feed a threshold, badge or label that implies a shared judgement.

`009` refused a `like_count` column for the disclosure half of this and it was right. The coherence
half is the part no screen makes visible: a rider blocked by everyone still reads their own count
as `1`, and the obvious repair — a global count — discloses that a hidden rider exists and acted,
which decision #2 forbids.

#### Scenario: No denormalised count column is added
- **WHEN** a reaction table is added
- **THEN** no column holding a count of its rows SHALL be added to any table
- **AND** no trigger SHALL maintain one

#### Scenario: A per-viewer number never becomes an ordering
- **WHEN** any list containing reactable rows is ordered
- **THEN** the ordering key SHALL be a value every viewer computes identically
- **AND** a reaction count SHALL NOT appear in an `order by`, a keyset cursor or a page boundary,
  because a per-viewer sort key makes pagination differ per rider

### Requirement: A row whose subject is a MEMBERSHIP SHALL key to the membership, not to the rider

Where a derived or reaction row is about a rider's presence **in a container** — a club membership,
a ride crew place — its foreign key SHALL address the membership row, so that leaving cascades it
away.

Keying such a row to `profiles` alone produces a row that outlives the thing it describes, is
unreachable from any screen, survives an account deletion of neither party, and **reappears if the
rider rejoins** — asserting a fact about a membership that did not exist when the row was written.

`club_members`' primary key is `(club_id, user_id)`, so a two-column foreign key with
`ON DELETE CASCADE` is available and SHALL be used. The reactor's own key to `profiles` is separate
and SHALL remain, so deleting the reactor's account removes their rows independently.

**Both foreign keys into `profiles` SHALL have an index Postgres can use**, per the standing rule.
A composite primary key leading with another column does not serve one.

#### Scenario: Leaving cascades the rows about the membership
- **WHEN** a rider leaves a club
- **THEN** every row keyed to that membership SHALL be deleted by cascade
- **AND** no client code SHALL be responsible for the cleanup

#### Scenario: A rejoin does not resurrect them
- **WHEN** that rider rejoins
- **THEN** the new membership SHALL carry none of the old rows
- **AND** nothing SHALL assert a fact about the previous membership

#### Scenario: Every profile foreign key leads an index
- **WHEN** a table referencing `public.profiles` is added
- **THEN** an index leading with that column SHALL be added in the same migration
- **AND** the assertion SHALL read the catalog rather than time a deletion

### Requirement: A new content table SHALL carry the participation gate, or SHALL state why it does not

Any table holding rider-authored content visible to another rider SHALL carry a `BEFORE INSERT`
`enforce_participation_gate` trigger with `when (current_user = 'authenticated')`.

The `when` clause SHALL be present and SHALL NOT be moved into the function body: inside a
`security definer` body `current_user` is the owner, so a body guard is true on every call and the
gate never fires (`023` §2, measured).

The gate count SHALL be **measured** after the migration rather than asserted from prose, and the
suite SHALL additionally assert the trigger's presence **by table name** — a flat count cannot
distinguish a new table's gate from a moved one, which is the error `078`'s own task list made in
the other direction.

#### Scenario: A reaction table is gated
- **WHEN** a table holding a rider's reaction visible to others is added
- **THEN** it SHALL carry the gate trigger
- **AND** an account with `terms_accepted_at` NULL SHALL be refused the write by the database

#### Scenario: The count is re-derived
- **WHEN** the migration is applied
- **THEN** `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
  tgisinternal` SHALL be run against both projects
- **AND** the number SHALL be recorded with that command beside it, never alone

### Requirement: A DELETE policy on an own-row table SHALL be reachable, and the SELECT policy is what decides

A table whose rows a rider may delete SHALL be checked for the interaction `081` measured: RLS
applies the **SELECT** policy to a `DELETE` whose `WHERE` names a column, so a row the caller owns
but cannot read survives its own delete with PostgREST reporting success.

For an own-row table this SHALL be made unreachable by the SELECT policy's own-row disjunct —
`user_id = auth.uid()` — rather than by relaxing the DELETE policy, which changes nothing because
SELECT is applied first.

The own-row disjunct SHALL therefore be asserted as **load-bearing for the delete path**, so that
removing it is caught rather than mistaken for a tightening.

#### Scenario: An own row is deletable however the caller is blocked
- **WHEN** a rider deletes their own row on a table whose parent has since become invisible to them
- **THEN** the row SHALL be deleted
- **AND** the delete SHALL NOT report a silent success against zero matched rows

#### Scenario: Removing the own-row read arm breaks the delete
- **WHEN** the SELECT policy's `user_id = auth.uid()` disjunct is removed
- **THEN** an assertion SHALL fail
- **AND** the failure SHALL name the delete path, because the change looks like a tightening and
  its cost is invisible from the DELETE policy alone
