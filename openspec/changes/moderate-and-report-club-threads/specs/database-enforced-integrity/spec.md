> **ADDED only, deliberately.** Several active changes already collide on this spec's existing
> requirements — `act-on-postcard-reports` carries the same banner — and archiving replaces a
> requirement wholesale. Every requirement below is new, so this delta adds and modifies nothing.

## ADDED Requirements

### Requirement: A widened authority SHALL reuse the existing predicate rather than restate it

When an existing `security definer` function's authority is widened to a role another function
already admits, it SHALL delegate to the **same predicate helper** and SHALL NOT write a second
expression that happens to mean the same thing.

For club authority that helper is `private.is_club_admin_for(candidate uuid, target_club uuid)`
(`085`), which `088`'s three manage-riders RPCs and `085`'s approval RPC already call. A body
writing `clubs.owner_id = auth.uid() or exists (club_members … role in ('owner','admin'))` inline
SHALL be treated as a defect even though it evaluates identically today: two spellings of one rule
drift, and the drift is silent because both look correct in isolation.

Adding the helper **beside** the predicate it replaces — `c.owner_id = v_uid or
private.is_club_admin_for(…)` — SHALL likewise be treated as a defect. The helper's first disjunct
is that predicate.

A `security definer` function MAY call a `private` helper no client role holds EXECUTE on, because
it runs as the owner. A grant added to "make it work" SHALL be treated as a defect: the caller is
wrong, not the ACL.

#### Scenario: The widened function names one predicate
- **WHEN** the moderation function's body is read after the change
- **THEN** it SHALL contain exactly one authority expression, and that expression SHALL be a call to
  `private.is_club_admin_for`

#### Scenario: The helper's body is pinned by equality
- **WHEN** the helper is relied on for the owner arm
- **THEN** its body SHALL be compared by **equality**, never by `like`, because a mention of the
  name in a comment satisfies a pattern match

### Requirement: Ownership SHALL be tested at `clubs.owner_id`, and a role-only predicate SHALL be treated as a regression

`clubs.owner_id` is the column that establishes ownership. `club_members.role = 'owner'` is a roster
row that `019` pins to that column, and a club owner holding **no** roster row is a reachable state
today (`054`, PD-128; `enforce-creator-membership` is a separate open change).

Any predicate deciding an owner's authority SHALL therefore include the `clubs.owner_id` arm —
directly, or through a helper whose first disjunct is that arm. A predicate written as
`club_members.role in ('owner','admin')` alone SHALL be treated as a **regression**, not a
simplification, because it removes a right the ownerless owner holds today.

**The client carries the identical trap.** A viewer gate written as `viewer_role === 'owner' ||
viewer_role === 'admin'` SHALL be treated as the same defect as the SQL one; the correct gate reads
the ownership boolean and the role separately.

#### Scenario: An ownerless owner keeps every right they hold today
- **WHEN** an owner with no `club_members` row exercises an authority the change widened
- **THEN** it SHALL succeed
- **AND** this SHALL be asserted explicitly, because every other assertion in the change passes
  against the predicate that refuses it

### Requirement: A function SHALL be widened with `create or replace`, because a recreated function is born granted to PUBLIC

Where the signature is unchanged, an existing function SHALL be modified with `create or replace`,
which preserves its ACL and its OID.

A `drop function` followed by `create function` SHALL be treated as a defect unless the signature
forces it, and where it is forced, the `revoke all … from public, anon` and the `grant execute … to
authenticated` SHALL be re-issued in the same file (`082` §7 is the worked example).

The reason is that a newly created function is born with `EXECUTE` to `PUBLIC`, which includes
`anon` — so decision #1 is breached by a routine refactor, with nothing red anywhere.

#### Scenario: The privilege set survives the widening
- **WHEN** the function's privileges are read after the migration
- **THEN** `anon` SHALL hold no EXECUTE and `authenticated` SHALL hold EXECUTE
- **AND** the assertion SHALL exist even though the migration did not intend to touch the ACL,
  because that is precisely the case where a mistake is silent

### Requirement: A new table's revoke SHALL name `service_role` at creation

`revoke all … from anon, authenticated` SHALL NOT be considered complete for a table holding
personal data. Supabase's project default grants `service_role` SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES and TRIGGER on a new `public` table, and `service_role` bypasses RLS.

`076` §3b measured exactly this on `postcard_reports`, sixty-five migrations after that table was
created, and described it as *"a standing leak: the only thing between that key and every reporter's
identity was that nothing had asked."* A table created after `076` SHALL name `service_role` in its
revoke from the first line.

Revoking it SHALL NOT break account deletion: a referential cascade runs as the constraint's system
trigger and does not consult privileges. That SHALL be **measured** in a rolled-back transaction
rather than reasoned, because the failure mode is account deletion breaking and nothing in CI would
notice.

#### Scenario: A new report table is unreachable by the service-role key
- **WHEN** `service_role` selects from the new table
- **THEN** it SHALL be refused
- **AND** the deletion cascade that removes a rider's rows SHALL still run

### Requirement: A new gated table SHALL carry the participation gate, and the count SHALL be claimed as a delta

Every new table admitting a client INSERT of rider-authored content SHALL carry
`enforce_participation_gate` as a `before insert … for each row when (current_user =
'authenticated')` trigger (`023`).

The `when` clause SHALL be written. It is what stops the gate firing for the table owner, and it is
also why a `security definer` writer must restate the rule in its own body — `current_user` inside a
definer function is the owner.

**The trigger count SHALL be claimed as a delta against a measurement taken immediately before the
migration applies, never as an absolute number written by hand.** It is 17 on DEV as of 2026-08-31
and concurrent changes move it before this one lands. The measurement is:

```sql
select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
```

The assertion SHALL check the gate **by table name** as well as by count, because a count alone
cannot tell a new gate from a moved one.

The `comment on function public.enforce_participation_gate()` SHALL be composed from the **live**
comment read at apply time rather than from a copy in an older migration file, because concurrent
changes rewrite the same string and the last writer wins.

#### Scenario: The gate is present and bites
- **WHEN** a rider whose `terms_accepted_at` is NULL inserts into the new table
- **THEN** the write SHALL be refused with `23514`
- **AND** the trigger SHALL be asserted present by table name, and the flat count asserted as the
  pre-migration measurement plus one

### Requirement: An additive migration widening a live function SHALL still take the hand-exercise gate

`036`'s gate is usually read as being about triggers hung on shipped write paths. It SHALL also
apply when a migration **replaces a function riders already call**: from the moment it applies,
every existing call runs new code inside a rider's own transaction, and a raise there takes that
rider's write down with it.

The exercise SHALL be by hand, on DEV, in a rolled-back transaction, as `authenticated`, covering
the previously-permitted caller as well as the newly-permitted one — a widening that accidentally
narrows is invisible to a test that only checks the new case.

The migration SHALL apply **before** the bundle that calls it serves, both halves being additive,
and the ordering argument SHALL be stated as which side fails safe rather than as a fixed rule.

#### Scenario: The previously-permitted caller is exercised too
- **WHEN** a function's authority is widened
- **THEN** the role that could already call it SHALL be exercised by hand alongside the new role
- **AND** the check SHALL be a real call in a rolled-back transaction, not a reading of the body
