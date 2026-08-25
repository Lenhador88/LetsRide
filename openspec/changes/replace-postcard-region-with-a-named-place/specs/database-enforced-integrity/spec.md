## Purpose

**Delta note.** `database-enforced-integrity` is a standing capability
(`openspec/specs/database-enforced-integrity/spec.md`) and this delta is written against it.
Two of its requirements are extended rather than replaced — the ones `064` added in
`openspec/changes/capture-photo-time-and-place/specs/database-enforced-integrity/spec.md`, which
is shipped and unarchived — and those are named where they apply.

## ADDED Requirements

### Requirement: A postcard's place SHALL be stated by one column whose visibility is the postcard's own

`public.postcards` SHALL carry `taken_place_name text null`.

**No provider-id column SHALL be added.** An earlier revision of this delta specified one, as
provenance. A provider's place id is a pointer that a place-details lookup resolves back to the
picked feature's **exact geometry**, so stored beside a deliberately 2dp-rounded coordinate it
returns the precision the rounding exists to remove — a row whose coordinate the CHECK calls coarse
carrying a pointer that is not. **That is the whole requirement and it does not depend on what is
rendered** — an earlier revision added "and nothing renders a postcard's location, so it was bought
for nothing", which PD-279 falsified on 2026-08-24 without weakening the rule by one word. A future
display that genuinely needs provenance SHALL argue for it on its own terms.

**No policy SHALL be added or changed by this capability.** The columns sit on `postcards`, RLS is
row-level, and the postcard's existing SELECT policy is therefore the whole visibility answer.

Each of the following is a testable statement about a role and a resource:

- The **author** SHALL be able to read the place of their own postcard.
- A **club member** SHALL be able to read the place of a postcard whose `club_id` is their club,
  exactly as they read its caption.
- A **non-member** SHALL be able to read nothing of such a postcard, the columns included, because
  the row itself is not visible to them.
- A **club owner holding no `club_members` row** SHALL be able to read it, through `054`'s owner
  arm on `private.is_club_member`, exactly as a member does.
- **Any signed-in rider** SHALL be able to read the place of a postcard whose `club_id` is NULL,
  because that NULL is the app-wide audience.
- A **blocked rider**, in either direction, SHALL be able to read nothing of the postcard, the
  columns included; blocking is symmetric though the row is directional.
- A rider who has **hidden** the postcard SHALL NOT be served the row and therefore not the
  columns.
- **`anon`** SHALL hold no privilege on either column, in any verb.
- **No rider SHALL be able to write either column on a row that already exists**, their own
  included.

#### Scenario: A non-member reaches nothing
- **WHEN** a rider who is not a member of the postcard's club queries `postcards`
- **THEN** the row SHALL NOT be returned, so neither column can be read

#### Scenario: A blocked rider reaches nothing
- **WHEN** either rider in a block pair queries the other's postcard
- **THEN** the row SHALL NOT be returned

#### Scenario: `anon` holds nothing
- **WHEN** the privileges of `anon` on each new column are checked for every verb
- **THEN** every answer SHALL be false

#### Scenario: The author reads back what they published
- **WHEN** the author selects their own postcard
- **THEN** both columns SHALL be returned

#### Scenario: No policy moved
- **WHEN** the policies on `postcards` are compared before and after the migration
- **THEN** every `USING` and `WITH CHECK` expression SHALL be byte-identical

### Requirement: The place columns SHALL be insert-only, and the UPDATE grant SHALL NOT be touched

Both new columns SHALL appear in the absolute INSERT grant list and the absolute SELECT grant list
for `authenticated`, and the migration SHALL issue **no UPDATE statement of any kind**.

Leaving UPDATE alone is the mechanism, not an omission. All three verbs on this table are already
column-level, so a column added today arrives holding no privilege; issuing an absolute re-grant
of UPDATE is how `044` and `046` reinstated each other's lists, silently, with nothing red.

The consequence is `064`'s and is accepted unchanged: a rider who regrets a disclosure has exactly
one remedy, which is to delete the postcard.

#### Scenario: The UPDATE list has not moved
- **WHEN** the column privileges of `authenticated` on `postcards` are read after the migration
- **THEN** the UPDATE list SHALL be exactly `caption, club_id, image_path`

#### Scenario: The new columns are not updatable
#### Scenario: The new column is not updatable
- **WHEN** UPDATE privilege on `taken_place_name` is checked for `authenticated`
- **THEN** it SHALL be false

#### Scenario: The grant lists are built from the database
- **WHEN** the absolute INSERT and SELECT lists are written
- **THEN** they SHALL be derived from `information_schema.column_privileges` scoped to
  `authenticated`, read immediately before the file is written, and never from a document

### Requirement: A place, a coordinate and a precision marker SHALL arrive in one of the legal combinations, and the database SHALL say which

The coupling constraint on `postcards` SHALL be replaced so that a row is refused unless it is one
of exactly these:

1. **Nothing** — name, both coordinates and the marker all NULL.
2. **A named place with no pin** — name present, marker `'place'`, both coordinates NULL.
3. **A named place with a pin** — name present, marker `'place'`, both coordinates present, in
   range, and at 2 decimal places.
4. **A precise photo location** — both coordinates present and in range, marker `'precise'`; the
   name may be present or absent.
5. **A legacy rounded photo location** — both coordinates present and in range, marker
   `'region'`, name NULL.

There SHALL be exactly one coordinate pair on this table and the marker SHALL say whose it is. A
second pair holding the photo's location beside the named place's would be the stored-but-hidden
state this capability already forbids: RLS is row-level, so any reader of the row reads it.

#### Scenario: A marker with no name is refused for a named place
- **WHEN** a row is written with the `'place'` marker and a NULL name
- **THEN** the statement SHALL be refused

#### Scenario: A coordinate cannot be half a pair
- **WHEN** a row is written with a latitude and no longitude, under any marker
- **THEN** the statement SHALL be refused

#### Scenario: A typed place with no coordinate is accepted
- **WHEN** a row is written with a name, the `'place'` marker and NULL coordinates
- **THEN** the statement SHALL succeed

#### Scenario: An unknown marker is refused
- **WHEN** a row is written with a marker that is not one of the three known values
- **THEN** the statement SHALL be refused

#### Scenario: A row written by an older client is still legal
- **WHEN** a client that knows nothing of the new columns writes a row in any of `064`'s three
  shapes
- **THEN** the statement SHALL succeed, because those shapes are arms 1, 4 and 5

### Requirement: The new column SHALL be length-bounded

`taken_place_name` SHALL be bounded at 200 characters.

200 mirrors `clubs_location_name_length`, against the same producer: the provider's label falls
back through a chain ending in a whole address on one line, so it runs long more readily than a
town name suggests.

The client SHALL truncate to this bound rather than surfacing a constraint violation, because the
field owns the value and a rider handed an over-long label has nothing to shorten.

#### Scenario: An over-long name is refused by the database
- **WHEN** a row is written with a 201-character place name
- **THEN** the statement SHALL be refused

#### Scenario: A name at the bound is accepted
- **WHEN** a row is written with a 200-character place name
- **THEN** the statement SHALL succeed

## MODIFIED Requirements

### Requirement: A coarse location SHALL be provably coarse, whatever produced it

*Replaces `064`'s "A reduced disclosure SHALL be verifiably reduced", which is expressed today as
`postcards_region_location_is_rounded` and covers the `'region'` marker alone.*

Every marker that claims a location is coarse SHALL require the stored coordinate to be at 2
decimal places. This SHALL cover both `'place'` and the legacy `'region'`, and SHALL permit a NULL
coordinate so that a named place with no pin remains legal.

The constraint SHALL be renamed to say what it now checks rather than which mode it was written
for.

The predicate SHALL continue to ask whether the stored value **is** at 2 decimal places, never
whether it equals the database's own rounding of some original — that is what makes it safe across
two languages whose halfway-case rounding disagrees, since any `integer / 100` satisfies it.

**The reason has changed and become stronger.** Under the previous model the constraint stopped a
patched client from having a precise coordinate drawn as approximate. Under this one it stops a
patched client from publishing a precise coordinate to the postcard's audience **wearing a place
name that misdescribes it** — a house labelled as a city. Dropping the constraint because the
middle mode is no longer a rounded photo coordinate would remove the only check that is not a
suggestion, on a mutation path the client owns.

#### Scenario: An unrounded coordinate under a coarse marker is refused
- **WHEN** a row is written with the `'place'` marker and a coordinate at more than 2 decimal
  places
- **THEN** the statement SHALL be refused

#### Scenario: The legacy marker is still covered
- **WHEN** a row is written with the `'region'` marker and an unrounded coordinate
- **THEN** the statement SHALL be refused

#### Scenario: A named place with no coordinate passes
- **WHEN** a row is written with a name, the `'place'` marker and NULL coordinates
- **THEN** the statement SHALL succeed

#### Scenario: The precise marker is unaffected
- **WHEN** a row is written with the `'precise'` marker and a full-precision coordinate
- **THEN** the statement SHALL succeed

#### Scenario: A rounding halfway case is not a divergence
- **WHEN** a coordinate rounded in the browser at a halfway case is written
- **THEN** the statement SHALL succeed, because the predicate tests the stored value's own form

### Requirement: An existing row written under a superseded meaning SHALL be left intact and SHALL remain legal

*Extends `064`'s "No backfill" statement, which said only that existing rows stay NULL.*

Rows already carrying the `'region'` marker were written under the meaning "the photo's coordinate,
rounded". They SHALL NOT be rewritten, deleted, renamed or backfilled, and the marker value SHALL
remain in the constraint's domain so that they remain legal.

A backfill would spend third-party lookups to attach a place name to a coordinate its author never
asked to have named, on somebody else's postcard — a disclosure performed on a rider's behalf,
which is the move this capability exists to prevent. Nothing in the application reads the column,
so the rows are indistinguishable from the new ones to every screen: both are invisible.

That the client stops writing the legacy marker SHALL NOT be enforced by the database. A dated
CHECK against the server-owned `created_at` would be safe, and is declined because a stray legacy
row is a correctly shaped, correctly rounded coarse location that nothing renders — zero value
against a hardcoded date nobody can read the intent of later.

#### Scenario: A legacy row survives the migration
- **WHEN** the migration is applied to a database holding a row with the legacy marker
- **THEN** the row SHALL be unchanged and SHALL satisfy every constraint on the table

#### Scenario: The migration performs no data modification
- **WHEN** the migration is read
- **THEN** it SHALL contain no `UPDATE`, `DELETE` or `INSERT` against `postcards`
