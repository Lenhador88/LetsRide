## ADDED Requirements

### Requirement: A function that widens a table's reach SHALL name every column it returns, and that list SHALL be the whole disclosure

Where a `security definer` function exists in order to let a rider read something their own row
security refuses, its return list SHALL be enumerated column by column in the migration, and the
rule SHALL be that the enumeration **is** the security statement — not a summary of it.

Such a function SHALL NOT return `select *`, SHALL NOT return a composite of the underlying row
type, and SHALL NOT return a column added to the underlying table later without a migration that
says so.

This is `062`'s discipline generalised. There, the narrow return was *ids only*, because the rows
themselves were readable and only the correlation needed widening. Here the row is **not** readable,
so the function must return values — which makes the column list the entire boundary and makes
`select *` a permanent, silent widening.

#### Scenario: The accessor's return list is enumerated and pinned
- **WHEN** `public.discoverable_private_clubs` is created
- **THEN** its `returns table (…)` SHALL name exactly seven columns
- **AND** the suite SHALL pin that list, so that a column added to `public.clubs` cannot reach a
  non-member by being added to this function without a review

#### Scenario: A composite return type is refused
- **WHEN** the function's signature is reviewed
- **THEN** it SHALL NOT be `returns setof public.clubs`, and the migration SHALL state why: that
  form makes every future `alter table public.clubs add column` a widening with no diff to notice
  it in

#### Scenario: Two shapes of the same widening share one body
- **WHEN** both the list of discoverable clubs and a single club's preview are needed
- **THEN** they SHALL be one function with an optional filter argument, not two functions
- **AND** the reason SHALL be `060`'s: two copies of one visibility rule drift, and the copy that
  drifts is the one nobody read

### Requirement: A membership row written for a rider other than its subject SHALL be written by exactly one function, and that function SHALL restate the gate

`public.club_members` has had exactly two writers: the rider themselves under the INSERT policy
(`auth.uid() = user_id`), and `complete_onboarding` (`058`). This change adds a third, which is the
first that writes a membership row **on one rider's behalf at another rider's instruction**.

Every such writer SHALL be a single named function; SHALL hardcode `role = 'member'` rather than
reading a role from its input; SHALL restate the participation gate for the **subject** of the row,
because `enforce_participation_gate` carries `when (current_user = 'authenticated')` and cannot
fire for a definer writer; and SHALL NOT be compensated for by adding a second gate trigger.

The `club_members` INSERT policy SHALL NOT be widened to accommodate it. A definer function is not
subject to RLS, so widening the policy would grant the client something the client does not need.

#### Scenario: The INSERT policy is byte-for-byte unchanged
- **WHEN** the migration is applied
- **THEN** `club_members`' INSERT policy qual SHALL be identical to its pre-migration text
- **AND** this SHALL be asserted by equality, because "we did not need to change it" and "we
  changed it and it still works" are indistinguishable from a green suite otherwise

#### Scenario: The role is a literal
- **WHEN** the approval function's body is examined
- **THEN** `'member'` SHALL appear as a literal and the function SHALL take no role argument
- **AND** `019`'s rule that `admin` is insertable by nobody SHALL remain true after this change,
  asserted by attempting an `admin` insert through every path including the new RPC

#### Scenario: The gate cannot be bypassed by the new path
- **WHEN** an un-onboarded rider is approved
- **THEN** the write SHALL fail
- **AND** the count of `enforce_participation_gate` triggers on `club_members` SHALL be unchanged,
  asserted separately

### Requirement: A private club's NAME SHALL be discoverable while its CONTENT SHALL NOT, and the boundary SHALL be enumerated

The standing requirement *"A private club's ride SHALL NOT be publicly visible"* states one half of
this boundary. This change moves the other half and the two SHALL be stated together, because
stating only the ride half is how the club half gets assumed.

After this change, for a signed-in rider who is neither a member nor the owner of a private club
and is not blocked with its owner:

| Resource | Reachable? |
|---|---|
| the club's `name`, `location_name`, coordinates, `members_count`, `avatar_path` | **yes**, through the accessor only |
| the club's `description`, `cover_image_path`, `owner_id`, `created_at`, `is_default` | no |
| the club's avatar or cover **bytes** in `storage.objects` | no |
| any `club_members` row for it | no |
| any `rides` row for it | no |
| any `postcards` row scoped to it | no |
| any `club_threads` or `club_messages` row for it | no |
| any `feed_reads` or `club_thread_reads` row for it | no |
| the `clubs` row itself, by any query | no |
| any notification naming it | no |

#### Scenario: Every negative row is asserted separately
- **WHEN** the suite covers this table
- **THEN** each `no` SHALL be its own assertion with its own label, because a single combined
  assertion cannot say which predicate did the work and a later change that breaks one of them
  would still pass

#### Scenario: The positives are asserted as positives
- **WHEN** the suite covers the `yes` row
- **THEN** the accessor SHALL be asserted to **return** the club for a non-member
- **AND** a suite that only proves the negatives cannot tell an intended reach from one nobody
  noticed

#### Scenario: The blocked rider is excluded from both columns
- **WHEN** the reader is blocked with the club's owner in either direction
- **THEN** every row in the table above SHALL be **no**, including the first
