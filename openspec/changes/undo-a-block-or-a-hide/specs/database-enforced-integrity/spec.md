# database-enforced-integrity (delta)

> **This delta ADDS requirements and MODIFIES none, deliberately.** `openspec archive` folds a
> delta in by replacing a requirement **wholesale**, so two changes modifying the same
> requirement means whichever archives second discards the first one's edit silently. Several
> active changes already collide on this spec's `Club membership role SHALL NOT be
> self-assignable`. Everything below is new text touching no existing requirement, and therefore
> joins none of that.

## ADDED Requirements

### Requirement: An accessor that bypasses a visibility policy SHALL restate every other conjunct of it

A `security definer` function exists to open exactly one hole in exactly one policy. When such a
function reproduces a policy's qual in order to remove one conjunct, it SHALL reproduce **every
remaining conjunct** rather than approximating the predicate.

This is not a style rule. Inside a `security definer` function `current_user` is the *owner*, so
RLS does not apply and no trigger guard beginning `if current_user <> 'authenticated'` runs. The
restated qual is the *entire* remaining access control on that read; a conjunct dropped by
oversight is not caught by anything, and the RLS suite cannot see it because that suite runs as
the table owner too.

`public.ride_journal_postcard_ids(uuid)` is the standing precedent: it restates the whole
`postcards` SELECT qual and carries a comment naming the branch that must stay unconditional.

#### Scenario: The hidden-postcards accessor evaluates the audience predicate NOT AT ALL
- **WHEN** the accessor returns a rider's hidden postcards
- **THEN** it SHALL NOT evaluate `private.is_blocked` or `private.is_club_member`, and SHALL NOT
  return any value derived from either
- **AND** this is deliberately the opposite of `ride_journal_postcard_ids`' precedent above:
  restating the qual is right when the answer is *which rows to return*, and wrong here, where
  the answer would be a **per-row flag whose value another rider controls**
- **AND** the only predicate it applies SHALL be the caller's own `user_id` scope and the
  exclusion of the caller's own postcards, both facts about the caller

#### Scenario: An accessor SHALL NOT restate a conjunct that would drop its own subject
- **WHEN** the blocked-riders accessor reads a `profiles` row
- **THEN** it SHALL NOT restate `username is not null` from the `profiles` SELECT policy
- **AND** every `blocks` row whose `blocker_id` is the caller SHALL yield exactly one row out,
  because a block missing from the list cannot be lifted

#### Scenario: Both accessors are reachable by the client and by nobody else
- **WHEN** privileges are asserted
- **THEN** `has_function_privilege('authenticated', <accessor>, 'execute')` SHALL be true for
  both, because PostgREST routes only to `public` and the client has no other path
- **AND** the same predicate SHALL be false for `anon`
- **AND** the assertion SHALL name the role rather than calling the function, since the suite
  runs as the table owner, for whom no barrier exists — the gap that let `029` ship broken

#### Scenario: Neither accessor takes a rider id
- **WHEN** either accessor is called
- **THEN** its subject SHALL be `auth.uid()` and SHALL NOT be an argument
- **AND** no argument SHALL widen the set of rows returned beyond the caller's own

### Requirement: A rule about what a rider may SEE SHALL be enforced where the client cannot reach it

The render model is the client, so any rule stating what a value *may be* has to end up as a
CHECK, trigger, policy or `security definer` function body. A rule that only ever reaches a
component or a Zod schema is advisory, because the client owns the mutation and render path.

This applies to *withholding* as much as to validating: a preview the rider must not see SHALL
be withheld by the database, not merely left unrendered.

#### Scenario: The hidden list is emptied of detail by the database, not by the component
- **WHEN** a rider reads their hidden postcards
- **THEN** the accessor SHALL return only the postcard's id and when this rider hid it
- **AND** a caller reaching the function directly through PostgREST SHALL receive the same two
  columns the app does, so the property does not depend on the client
- **AND** the component SHALL NOT be the thing that decides not to draw a preview

#### Scenario: The return type SHALL NOT regain a restorability flag
- **WHEN** a later change proposes returning whether a hidden postcard could be restored, or the
  reason it could not
- **THEN** it SHALL first revisit this requirement, because such a flag reduces to
  `not private.is_blocked(auth.uid(), author_id)` for every postcard whose club membership the
  rider already knows — which is every postcard they hid
- **AND** NULLing the columns beside such a flag SHALL NOT be accepted as a mitigation, since the
  rider already knows who authored the postcard they chose to hide, so the flag is the whole
  signal
