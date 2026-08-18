<!--
⚠ COORDINATION — THREE-WAY, AND THIS ONE IS THE DANGEROUS DIRECTION.

`Storage object ownership SHALL remain database-enforced` is modified by THREE active changes:
`add-account-deletion`, `add-ride-map-tiles`, and this one. Both of the others already carry
their own coordination banners about each other; neither knows about this one. Re-derive rather
than trust it:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

Archiving folds a delta in by replacing the requirement WHOLESALE, and `openspec archive`
compares scenario NAMES, not bodies — so whichever change archives last silently wins.

**The asymmetry that matters:** the other two are extending this requirement (deletion ordering;
read audience and the folder set) and both carry the `Unenforced capacity is recorded, not
silently assumed` scenario forward VERBATIM, because at the time they were written it was true.
This change makes it false. So if either of them archives AFTER this one, the standing spec is
left asserting that "no policy, trigger or constraint limits `ride_members` by `max_riders`" —
about a database where a trigger does exactly that. That is not a lost edit; it is a spec that
contradicts the schema, in the file whose whole job is to be the schema's contract.

Two things follow, and both are tasks (see tasks.md §6):

  1. Before archiving THIS change: re-read `openspec/specs/database-enforced-integrity/spec.md`
     as the previous archive actually left it and rewrite the MODIFIED block below against THAT
     text — the version transcribed here was read on 2026-08-18, before either sibling archived.
     Keep every scenario either sibling has added; the only scenario this change removes is the
     capacity one.
  2. Whether this change archives first or last, delete the capacity scenario from the OTHER TWO
     deltas' copies of this requirement in the same session, so the reinstatement cannot happen.
     That is an edit to another change's files and is deliberate: it is the only place the fix
     can live.

The two ADDED requirements below have no other claimant.
-->

## MODIFIED Requirements

### Requirement: Storage object ownership SHALL remain database-enforced

**Modified by three active changes — see the coordination banner at the top of this file before
archiving.** This change touches neither the requirement's prose nor any Storage scenario; it
removes exactly one scenario that was filed under it and has stopped being true.

A rider MUST NOT be able to upload outside their own folder, nor reference an object in another
rider's folder from a row they author.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles` and `clubs`
through CHECK constraints on the row. Every `storage.objects` policy is granted to `authenticated`
and nothing else, and none of them is an UPDATE. **Re-derive the folder and policy counts rather
than reading a number here** — this paragraph has stated one before and it was true of one
project only:

```sql
select cmd, count(*) from pg_policies
 where schemaname = 'storage' and tablename = 'objects' group by cmd order by cmd;
```

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/` or
  `club-covers/` outside their own folder
- **THEN** Storage SHALL refuse the upload

<!--
REMOVED FROM THIS REQUIREMENT, deliberately and by this change:

  #### Scenario: Unenforced capacity is recorded, not silently assumed
  - **WHEN** `rides.max_riders` is set
  - **THEN** nothing SHALL claim it is enforced: no policy, trigger or constraint limits
    `ride_members` by it, and this migration does not add one

It was an honest record of a gap and it stops being true the moment `063` applies. The
replacement is not another scenario here — it is the whole `ride-capacity` capability, whose
first requirement says the opposite in as many words. Kept as a comment so a reader diffing this
delta against the standing spec can see the removal was intended rather than dropped.
-->

## ADDED Requirements

### Requirement: A gate that counts rows the caller cannot see SHALL count them through a privileged path

Where a write is refused on the basis of **how many** rows exist, and the table carries a SELECT
policy that hides rows from some callers, the count SHALL be evaluated where that policy does not
apply. A `security invoker` count SHALL NOT be used, and "it is only a count, not a read" SHALL
NOT be accepted as a reason it is safe.

The failure is silent and proportional: the gate admits exactly as many extra rows as the caller
has hidden from them. `ride_members` is the first table where this bites, because `009` put
`private.is_blocked` on its SELECT policy; `postcard_likes`, `postcard_comments` and
`club_members` all carry the same shape and would behave the same way.

Measured on the applied chain 2026-08-18, one block in place, same ride: **4 rows as the table
owner, 3 as the joining rider.**

#### Scenario: A count under the caller's own row security is short
- **WHEN** a rule counts rows of a block-filtered table under the caller's own row security
- **THEN** it SHALL be treated as a defect, whatever the count is used for

#### Scenario: The privileged count returns a decision, never rows
- **WHEN** such a count is implemented
- **THEN** the privileged path SHALL expose a boolean or a number and SHALL NOT return, or be
  able to be made to return, the rows it counted

#### Scenario: The assertion exercises the hidden rows
- **WHEN** the rule is asserted in `supabase/tests/`
- **THEN** the assertion SHALL be written under a client role with a block actually in place, not
  as the table owner, because the owner sees every row either way and the test would pass against
  a broken implementation

### Requirement: A BEFORE trigger's refusal SHALL be treated as reachable by callers the policy would have refused

A `BEFORE INSERT` trigger runs **before** the row-security `WITH CHECK` is evaluated — measured on
Postgres 16, and asserted rather than assumed. So anything a BEFORE trigger raises is disclosed to
callers row security was about to refuse, and a trigger message SHALL be reviewed as a disclosure
to a rider who cannot see the resource at all.

Where the disclosure is unacceptable, the two mechanisms that close it SHALL be considered
explicitly: moving the check to an `AFTER` (constraint) trigger, which fires after the policy has
had its say, or having the trigger defer to row security when the caller cannot read the parent
row. Where it is acceptable, it SHALL be stated in the spec rather than left to be discovered.

`023`'s participation gate has this shape already and discloses nothing by it — its message is
about the caller, not about the resource. The first rule that discloses something about the
resource is capacity, and its one bit is accepted and recorded in `ride-capacity`.

#### Scenario: The ordering is a fact, not an assumption
- **WHEN** a BEFORE trigger and a restrictive `WITH CHECK` both apply to one insert
- **THEN** the trigger's error SHALL be the one the caller receives

#### Scenario: A new trigger message is reviewed as a disclosure
- **WHEN** a `BEFORE` trigger that can raise is added to a table whose parent carries a
  visibility policy
- **THEN** the spec SHALL state what the message tells a caller who cannot read the parent
- **AND** an unstated disclosure SHALL be treated the same as an unstated negative case
