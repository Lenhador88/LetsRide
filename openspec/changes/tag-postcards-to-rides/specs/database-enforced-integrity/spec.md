<!--
COORDINATION — checked 2026-08-09, and clean.

`A table with no designed edit SHALL carry no UPDATE grant` has **one** unarchived claimant: this
change. Neither `add-account-deletion` nor `enforce-creator-membership` touches it, and neither
touches either ADDED requirement below. Re-derive rather than trust this note, because archiving
folds a delta in by replacing the requirement WHOLESALE and OpenSpec will not warn you:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

In this file `add-account-deletion` holds **four** (`Club membership role`, `Consent and lifecycle
timestamps`, `Onboarding completion`, `Storage object ownership`) and `enforce-creator-membership`
holds **six** — `Club membership role` plus **five** of its own, not the four an earlier revision of
this note claimed. This change collides with neither.

**Before archiving: re-read `openspec/specs/database-enforced-integrity/spec.md` as the previous
archive actually left it and rewrite the MODIFIED block below against THAT text**, not against the
version transcribed here on 2026-08-09. The merged text this delta should converge on: the rule is
unchanged and its *granularity* moves from the table to the column, so a table with a designed edit
can still carry a column without one. Any merge that keeps only the table-level sentence is the one
that is wrong.
-->

## MODIFIED Requirements

### Requirement: A table with no designed edit SHALL carry no UPDATE grant

Where editing has not been designed, there SHALL be no UPDATE policy **and** no UPDATE grant to
`authenticated`. The rule SHALL apply at **column** granularity as well as table granularity: a
table with a designed edit SHALL NOT thereby confer one on every column it grows.

The grant is the second, independent layer — the one that still holds if a future policy is
written too permissively. `009` applied this to `postcard_likes` and `blocks`, `011` to
`postcard_comments`, `postcard_hides` and `postcard_reports`, and each stated the same reason: a
table with no mutable column has nothing to grant UPDATE for. It is stated here as a rule rather
than repeated a sixth time in a migration comment.

**Editing is a design problem, not a permission one.** It means deciding whether "edited" is
disclosed, from when, and what the record of a conversation means once it can be rewritten. None
of that exists for any table in this schema.

**The table-level reading is not sufficient, and `postcards` is the case that shows why.** It has a
designed edit, an UPDATE policy (`author_id = auth.uid()`) and a table-level UPDATE grant — so every
column added to it is UPDATE-grantable by default, including `ride_id`, whose edit is not designed
and whose write gate depends on a crew membership that can lapse. Reading this rule as being about
tables answers "does this table have an edit" (yes) and never asks the question that matters.

**A withheld column grant is the right instrument precisely where a policy cannot do the job.** A
`with check` is evaluated against the whole new row on **every** UPDATE and a policy cannot see
`OLD`, so a predicate guarding one column's value silently guards every other column's edit as well:
a rider who no longer satisfies it is refused an unrelated change with no explicable error.
Distinguishing "this column changed" from "this row changed" needs a `BEFORE UPDATE` trigger, which
is a second instrument, a second home for the rule and a new advisor surface.

**The two mechanisms are independent, and treating a withheld grant as making a policy conjunct inert
is the error this requirement most needs to name.** A column privilege gates the **SET list**; an RLS
`WITH CHECK` is evaluated over the **whole new row**. Withholding `UPDATE (c)` stops `set c = …` and
does nothing to stop a `with check` referencing `c` from firing during `set <other> = …`. So a
conjunct added "harmlessly, since the column cannot be written" is fully reachable, and reproduces
the lockout above on every unrelated edit.

#### Scenario: Nobody can update a ride message
- **WHEN** any rider — including its author and the ride's organizer — attempts to UPDATE
  `ride_messages`
- **THEN** the write SHALL be refused
- **AND** both the absent policy and the absent grant SHALL be asserted, because either alone
  would be undone by a single future line

#### Scenario: A column with no designed edit on a table that has one
- **WHEN** a column is added to a table that already carries an UPDATE policy and an UPDATE grant,
  and editing that column has not been designed
- **THEN** the table-level UPDATE grant SHALL be revoked and re-granted over the columns that hold
  it today, omitting the new one
- **AND** the enumeration SHALL be read off the live database at write time rather than copied from
  any document, because a silently retracted grant surfaces as a rider unable to edit something,
  with no error traceable to a migration

#### Scenario: The absence is asserted by naming the role
- **WHEN** the assertion for a withheld column grant is written
- **THEN** it SHALL be `has_column_privilege('<role>', '<table>', '<column>', 'UPDATE') = false`
- **AND** it SHALL NOT be an attempted UPDATE, because the suite runs as the table owner for whom no
  column privilege exists and the attempt would succeed against a correct database — `031`'s lesson

#### Scenario: An upsert against such a table uses do-nothing, not do-update
- **WHEN** a caller writes an upsert against a table with no UPDATE grant
- **THEN** it SHALL use `on conflict do nothing`
- **AND** `on conflict do update` SHALL be refused with `42501` rather than silently affecting
  nothing

#### Scenario: The absence is a recorded gap, not an accident
- **WHEN** a table is created with no UPDATE path, or a column is added with none
- **THEN** the migration SHALL say so explicitly
- **AND** the day editing is designed, adding the grant SHALL be understood as a deliberate
  widening rather than a one-line fix

## ADDED Requirements

### Requirement: A rider-supplied reference SHALL have its referent's visibility checked by policy, because a foreign key does not

Where a client-writable column references another table, the INSERT policy SHALL check that the
caller may see the referenced row, evaluated under the caller's own row security. A foreign key
SHALL NOT be treated as any part of that check.

**A foreign key is validated with RLS bypassed.** `references rides(id)` accepts every ride in the
database, including rides the writer cannot see, cannot reach and does not know exist. The
constraint answers "does this row exist" and has no opinion about who may point at it — so a column
added with nothing but a FK behind it lets any signed-in rider attach their content to any resource
in the system.

`postcards.club_id` has enforced this since `009` (`club_id IS NULL OR private.is_club_member(club_id)`)
and nothing wrote down that the FK was not the mechanism, so the next reference column inherits the
gap. The rule generalises past any one column: it binds every future client-writable FK.

**Where the referenced table's own policy is `security definer`-shaped, both halves are required.**
A `security definer` helper answers a membership question with no opinion about blocks, private
clubs or whether the parent is visible at all — see *A child table whose audience is NARROWER than
its parent's*, whose reasoning is identical on the write side.

#### Scenario: A reference to an invisible row is refused
- **WHEN** a rider inserts a row naming a referenced id they cannot select under their own session
- **THEN** the insert SHALL be refused by the policy
- **AND** the refusal SHALL be asserted in isolation from any narrowing predicate on the same
  column, because one assertion cannot say which conjunct did the work

#### Scenario: The check runs under the caller's row security
- **WHEN** the visibility check is written
- **THEN** it SHALL be an `EXISTS` against the referenced table inside the policy, which is evaluated
  as the querying role
- **AND** it SHALL NOT be a `security definer` helper, which would bypass the very policy it is
  meant to consult

#### Scenario: The visibility check subsumes the existence check, and closes the error-code oracle
- **WHEN** a rider names an id that does not exist, and a rider names an id that exists but is
  invisible to them
- **THEN** both SHALL be refused with the **same** `42501`, because the policy's `EXISTS` cannot tell
  the two apart — no rows is no rows — and RLS `WITH CHECK` is evaluated **before** the foreign key's
  referential-integrity trigger, which is an `AFTER ROW` trigger and never fires
- **AND** a design that leaves the referent unchecked SHALL be understood to *create* that oracle
  rather than inherit it, because then a nonexistent id raises `23503` and an invisible one raises
  `42501`
- **AND** this SHALL be verified by execution rather than reasoned about — **measured 2026-08-09** on
  `fpmrimzxadewsaiwpsel`, in a rolled-back transaction, with a probe table carrying both a FK and a
  `WITH CHECK`: a nonexistent referent returned `42501 new row violates row-level security policy`,
  and no `23503` was reachable

### Requirement: Adding a column to a table with table-level grants SHALL be treated as granting it

Before adding a column to a table, the grants on that table SHALL be read from `pg_class.relacl` and
`pg_attribute.attacl` and the result stated in the migration. Where the grant is table-level, the
new column is writable by every role holding it from the moment the `alter table` runs, and the
migration SHALL either accept that in writing or revoke and re-grant per column.

**A table-level grant covers every column the table will ever have.** `information_schema.column_privileges`
expands a table-level grant into one row per column, so it shows the same picture for both cases and
cannot tell them apart — the distinction is only visible in `relacl` versus `attacl`:

```sql
select 'table' as level, acl.privilege_type
  from pg_class c cross join lateral aclexplode(c.relacl) acl
 where c.relname = '<table>' and acl.grantee::regrole::text = 'authenticated'
union all
select 'column', acl.privilege_type
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join lateral aclexplode(a.attacl) acl
 where c.relname = '<table>' and acl.grantee::regrole::text = 'authenticated';
```

`034` granted INSERT on `ride_messages` per column so `created_at` could not be client-written, and
`036` granted UPDATE on `notifications.read_at` alone. Both are right and neither recorded that the
technique is also what makes a *later* column safe, so a table created with a table-level grant hands
the trap to whoever adds the next column.

#### Scenario: The grant level is measured, not assumed
- **WHEN** a migration adds a column to an existing table
- **THEN** it SHALL state, from `relacl` and `attacl`, which privileges `authenticated` holds and at
  which level
- **AND** "the column is additive" SHALL NOT be claimed for a table whose grants are table-level,
  because the write privilege arrives with the column

#### Scenario: A revoke-and-regrant enumerates the current columns
- **WHEN** a table-level grant is converted to per-column in order to exclude a new column
- **THEN** the enumeration SHALL be derived from the live database in the same session as the
  migration is written
- **AND** each re-granted column SHALL be asserted, so that an omission fails the suite rather than
  a rider

#### Scenario: The default is stated for a table with no grant conversion
- **WHEN** a column is added and the table-level grant is deliberately left in place
- **THEN** the migration SHALL say that the column is client-writable and why that is acceptable
- **AND** a policy `with check` SHALL name the column, because a column no policy mentions is
  unconstrained rather than protected

#### Scenario: Converting a grant to per-column inverts the default for every later column
- **WHEN** a table's grant for a verb is converted from table-level to per-column
- **THEN** the migration SHALL record that every column added to that table afterwards arrives with
  **no** grant for that verb, rather than an automatic one
- **AND** that direction SHALL be recognised as failing closed and therefore safe, so the record
  exists to remove a surprise rather than to flag a risk
- **AND** a later reader finding a new column unexpectedly read-only SHALL be able to find this
  decision from the migration rather than diagnosing it as a bug
