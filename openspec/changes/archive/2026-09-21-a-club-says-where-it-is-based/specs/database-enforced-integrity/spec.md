<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

The requirement below is ADDED and is claimed by nothing. Its two standing neighbours are
deliberately NOT modified:

- `Columns that are meaningful only together SHALL be constrained to arrive together` — that is
  `clubs_location_coupling` (`066`) and it is correct exactly as it stands. This change adds no
  column and relaxes nothing.
- `When the database stops requiring a value, every client-side copy of that requirement SHALL stop
  requiring it too` — the requirement below is its **mirror**: the client starts requiring something
  the database never did. They are two directions of one hazard and are stated separately because
  the failure modes are opposite.

**This change contains no migration.** The requirement is here because `openspec/config.yaml` asks
for rules as testable statements about a role and a resource, and because the most dangerous thing
this change can produce is a later author reading it as an invariant.
-->

## ADDED Requirements

### Requirement: A requirement the database does not carry SHALL be scoped to the gate that introduced it, and SHALL NOT be readable as an invariant

Where a change makes a value mandatory at one entry point without a CHECK, a trigger or a policy
behind it, the change SHALL state that the value remains permanently optional everywhere else, SHALL
scope the refusal to that one entry point, and SHALL NOT permit any read, type or query to begin
assuming the value is present.

`clubs.location_name`, `location_place_id`, `latitude` and `longitude` are the case. Creating a club
without them is refused by the client; **the database refuses nothing**, and that is the design
rather than a gap.

**`CLAUDE.md`'s rule that no new integrity rule may live only in a Zod schema is not being broken,
and the reason is that this is not an integrity rule.** An integrity rule says what a value *may be*
and must therefore live where the client cannot reach it. This says what one screen *insists on
collecting*. The database's statement about a club's location is unchanged — it may be absent, for
ever — and `066`'s coupling CHECK, which requires the four to arrive together or all stay null,
remains the only thing Postgres says about them.

Two consequences, and the second is the dangerous one:

- **A client that skips the gate creates a locationless club and is refused by nothing.** Accepted:
  the column has always permitted it, every reader already tolerates it, and no policy, count or
  visibility decision depends on it. **Not** because such a club resembles the ones that exist —
  measured 2026-09-08, DEV 15/15 and PROD 2/2 carry a location, so today it would resemble none of
  them.
- **A later reader must not turn "a club must say where it is based" into a non-null assumption.**
  A non-null type, a `!`, or a distance sort that reads absence as zero breaks the moment any row
  carries NULL — an owner clearing the field on edit, or a club created before this gate — and
  breaks silently. **The count of such rows today is zero, and that is exactly why this is written
  down**: a reader who checks the database finds every row populated and concludes the assumption is
  safe.

#### Scenario: The gate is scoped to creation
- **WHEN** a club is created through the app with no location
- **THEN** the create action SHALL refuse it with a field message naming the field, before any write
- **AND** a club is **edited** with no location — because it never had one — the edit SHALL succeed,
  and all four columns SHALL be written as NULL exactly as they are today
- **AND** the two SHALL be expressed as two schemas sharing one body, never as one schema with a
  conditional, because a conditional is how the edit path silently acquires the gate

#### Scenario: The database refuses nothing, and this is asserted rather than assumed
- **WHEN** a signed-in rider inserts a `clubs` row with all four location columns NULL, by any route
  that is not the create form
- **THEN** the insert SHALL succeed, `066`'s `clubs_location_coupling` SHALL be satisfied, and no
  CHECK, trigger or policy SHALL refuse it
- **AND** this change SHALL add no migration, no `NOT NULL` and no backfill
- **AND** the RLS suite SHALL gain no new assertion, because no policy or constraint moved — stated
  so a reviewer does not read the absence as an omission

#### Scenario: Every read keeps its null branch
- **WHEN** any surface reads a club's location — `/clubs/explore`, `ExploreClubsStrip`, a club detail
  page, a distance sort
- **THEN** it SHALL tolerate NULL permanently, SHALL NOT hide or filter out a club that carries none,
  and SHALL NOT treat an absent coordinate as `0`
- **AND** the existing guard in `src/lib/data/clubs.ts` —
  `if (!near || item.latitude === null || item.longitude === null) return item` — SHALL remain, and
  no type SHALL be narrowed to non-null on the strength of this change

#### Scenario: Every role's reach is unchanged
- **WHEN** this change ships
- **THEN** any signed-in, onboarded rider SHALL still be able to create a club and become its owner,
  and an un-onboarded rider SHALL still be refused by `023`'s participation gate rather than by this
  form
- **AND** a club **admin**, **member** and **non-member** SHALL still be unable to set or change that
  club's location; only the owner may, through the edit path, under the policy that already governs it
- **AND** a **blocked** rider SHALL be unaffected in both directions, because blocking governs
  visibility and membership and this change touches neither
- **AND** a signed-out visitor SHALL reach none of it: `/clubs/new` is not a public path and `anon`
  holds no grant on `clubs`
