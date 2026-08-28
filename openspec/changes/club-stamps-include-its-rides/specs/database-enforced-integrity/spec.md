## ADDED Requirements

### Requirement: An accessor that composes more than one visibility predicate SHALL justify each one individually, including the ones that exclude nobody today

`062` established the pattern: where a column grant is revoked to prevent a correlation, a
`security definer` accessor returning **ids only** restores the intended read without restoring the
grant. `062`'s accessor composes two predicates. This change's composes three, and the rule the
second one needs is that **the migration SHALL name, per predicate, the rider it excludes** — and
where it excludes nobody today, SHALL name the reachable state in which it will.

A predicate justified only as "defence in depth" SHALL be treated as unjustified. `036` §3 already
forbids the inverse reasoning — deriving one visibility from another — by name; this is the same
rule pointed at the conjuncts rather than at the omissions.

#### Scenario: Each predicate names its excluded rider
- **WHEN** `public.club_stamp_postcard_ids` is created
- **THEN** the migration SHALL name, for the outer club gate, `083`'s invitee — a rider who reads one
  ride of a private club and no part of the club — as the rider it excludes
- **AND** SHALL name, for the per-ride gate, a non-member of a **public** club facing that club's
  private ride
- **AND** SHALL name, for the restated postcards qual, a blocked author, a hidden postcard and a
  club the reader has left

#### Scenario: Each exclusion is asserted separately
- **WHEN** the suite covers the accessor
- **THEN** each of the three SHALL have its own assertion with its own label
- **AND** a suite in which removing any one predicate leaves every assertion green SHALL be treated
  as incomplete

#### Scenario: The redundant-looking gate is mutation-tested
- **WHEN** the outer club gate's assertion is written
- **THEN** the gate SHALL be removed in a scratch copy, the assertion SHALL be confirmed red, and the
  removal reverted
- **AND** an assertion for a predicate that has never been seen to fail SHALL NOT be counted as
  coverage

### Requirement: An accessor that restates a policy SHALL be pinned as text, and the pin SHALL instruct a reader to move the restatements rather than re-pin the string

`private.can_read_ride`, `private.can_read_club` and `public.ride_journal_postcard_ids` all restate a
policy and all can go stale; `060` says so in its own comments and PD-211 is what it cost when only
one of a pair moved. This change adds a fourth restatement of `postcards` SELECT.

Every such restatement SHALL be pinned in `supabase/tests/rls_test.sql` under **its own** function's
name, and every pin's failure message SHALL say to update the restatements in the same change rather
than to re-pin the string.

#### Scenario: The new restatement is pinned under its own name
- **WHEN** `086` is applied
- **THEN** `postcards` SELECT's qual SHALL be pinned as whole text under
  `club_stamp_postcard_ids`' name, in addition to the existing pin under
  `ride_journal_postcard_ids`' name
- **AND** a change to that policy SHALL therefore fail **two** assertions, which is the point

#### Scenario: A lazy re-pin is the failure mode named in the message
- **WHEN** the pin fails
- **THEN** its message SHALL name both accessors and instruct that both bodies move
- **AND** the message SHALL state that a green suite after a re-pin with only one body updated is
  exactly PD-211's shape

### Requirement: A grant revoked to prevent a correlation SHALL stay revoked, and the accessor SHALL be asserted to be a filter rather than a grant

`select (ride_id)` on `public.postcards` SHALL remain revoked from `authenticated`, `anon` and every
other client role. No accessor added by this change SHALL return it.

The suite SHALL assert both halves: that the grant is absent, and that the accessor answers — because
a suite asserting only the first cannot tell a working accessor from a broken one, and a suite
asserting only the second cannot tell a filter from a widening.

#### Scenario: The column grant is unchanged
- **WHEN** `086` is applied
- **THEN** `authenticated`'s SELECT column list on `public.postcards` SHALL be exactly what it was
  before, asserted as a sorted string rather than a count

#### Scenario: The accessor is a filter
- **WHEN** a reader calls the accessor
- **THEN** every id it returns SHALL be a postcard that reader can read through the ordinary
  `postcards` SELECT policy
- **AND** this SHALL be asserted as an equality between the accessor's result and the reader's own
  filtered read, not as a spot check
