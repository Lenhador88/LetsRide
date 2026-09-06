# database-enforced-integrity (delta)

> **This delta ADDS requirements and MODIFIES none, deliberately.** `openspec archive` folds a delta
> in by replacing a requirement **wholesale**, so two changes modifying the same requirement means
> whichever archives second discards the first one's edit silently. Several active changes already
> collide on this spec's `Club membership role SHALL NOT be self-assignable`. Everything below is new
> text touching no existing requirement.
>
> Three standing requirements govern this change and are **not** restated here, because they already
> say what is needed: *"A child table whose audience is NARROWER than its parent's SHALL enforce that
> by composition, never by a privileged helper alone"*, *"A column the server owns SHALL NOT be
> writable by a client that can insert the row"*, and *"A table with no designed edit SHALL carry no
> UPDATE grant"*. What follows is the part none of them covers: dropping a table safely, and the
> rule that a policy-based DELETE cannot serve a row its own owner cannot read.

## ADDED Requirements

### Requirement: A right that a DELETE policy cannot deliver SHALL be delivered by a `security definer` RPC, not recorded as a known gap

When a table's intended delete rights include a case where the deleter cannot READ the row —
because a block, a departed membership or a parent going out of view removes it from their SELECT
policy — the delete SHALL be implemented as a `security definer` function rather than as a policy
with the gap written down beside it.

Postgres applies the SELECT policy to any statement whose `WHERE` clause reads a column, measured on
17.6 and recorded in `082`. A DELETE filtered by `USING` therefore **succeeds against zero rows** and
reports success, so the rider is told their message is gone and it is not. This repo has recorded the
same defect three times — `011` §1b for comments, `034`'s organizer arm for ride messages, and
`102`'s residual `DELETE 0` for a rider who left a crew — and each time the remedy named was an RPC
that was not built.

**A recorded gap is not a mitigation.** It is invisible to the RLS suite, which runs as the table
owner for whom no policy applies, and invisible to the rider, who sees a success.

#### Scenario: A new table with a delete right ships the RPC in the same migration
- **WHEN** a migration creates a table whose rows a rider may remove
- **THEN** it SHALL determine whether any intended deleter can be unable to read the row
- **AND** where one can, the table SHALL carry **no DELETE policy and no DELETE grant**, and the
  right SHALL be a `security definer` function scoped inside its own body
- **AND** the absence of the grant SHALL be the enforcement, so a later policy written too
  permissively cannot open a second path

#### Scenario: The RPC's scope is asserted, and not by calling it
- **WHEN** such a function is added
- **THEN** an assertion SHALL name the role — `has_function_privilege('authenticated', …)` and the
  same for `anon` — rather than exercising the function
- **AND** the reason SHALL be `029`'s: the suite runs as the table owner, for whom neither the grant
  barrier nor RLS exists, so a passing call proves nothing about a client role

#### Scenario: The function discloses nothing about rows outside its scope
- **WHEN** the function is called with an id the caller has no right to
- **THEN** it SHALL remove nothing
- **AND** it SHALL NOT distinguish "that id does not exist" from "that id is not yours", because the
  function bypasses RLS and is therefore the only thing standing between the caller and the whole
  table

### Requirement: Dropping a table a shipped bundle reads SHALL be sequenced against the bundle being SERVING, not against the merge

A migration that drops a table, a column or a function which any shipped client reads SHALL apply
only after the replacing client is confirmed **serving** — a `READY` deployment on the merge sha with
a null alias error — and the confirmation SHALL be a distinct, evidenced step rather than an
inference from the merge.

This repo applied a destructive file **102 seconds** after a merge, out from under a Preview still
calling the function it dropped. A merge is not a deploy: Vercel builds after it, and an
already-loaded browser tab keeps its pre-merge JS until it is reloaded regardless.

#### Scenario: The confirmation is a command with an output, not a judgement
- **WHEN** a destructive migration is about to apply
- **THEN** the deployment state for the merge sha SHALL be read and recorded
- **AND** "the PR merged" SHALL NOT satisfy this, and neither SHALL "CI is green"

#### Scenario: The additive and destructive halves are separate files
- **WHEN** one change both creates a replacement object and drops the object it replaces
- **THEN** they SHALL be two migration files with two numbers
- **AND** the reason SHALL be that one must apply before the deploy and the other after, which a
  single file cannot do
- **AND** the two SHALL be applied in filename order with the deploy between them, and that ordering
  SHALL be recorded per-file in `docs/reference/migrations.md` §Applied state

#### Scenario: A dropped name is not reused by its replacement
- **WHEN** a replacement table serves the same purpose as the dropped one
- **THEN** it SHALL take a different name
- **AND** the reason SHALL be both mechanical and diagnostic: the additive migration must create it
  while the old table still exists, and an old bundle meeting a same-named table with a different
  column set receives malformed rows instead of a clean `PGRST205`

#### Scenario: A dropped table's rows are counted before they are destroyed
- **WHEN** a destructive migration removes rider-authored rows
- **THEN** the count SHALL be measured on each project and recorded in the change
- **AND** a decision to archive or not archive SHALL be stated explicitly, including when the count
  is zero
