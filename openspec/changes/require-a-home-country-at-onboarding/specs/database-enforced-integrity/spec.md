<!--
COORDINATION — checked 2026-09-07 with the repo's own command:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

- `Country codes SHALL be a known country` is claimed by **no other active change**, so the
  MODIFIED below archives with no race.
- `Onboarding completion SHALL gate participation, not only navigation` is claimed by THREE active
  changes (`add-account-deletion`, `drop-onboarding-location-step`, `invite-riders-to-a-club`) and
  is deliberately **not touched here**. This change does not alter the participation gate — see
  the negative stated inside the ADDED requirement below, which is where that belongs.
- `Every role's reach into a rider's identity SHALL be stated` is claimed by
  `deliver-push-notifications`. The per-role statement this change owes is therefore ADDED as its
  own requirement scoped to the new column rather than folded into that one.

Re-derive before archiving; the answer above is a snapshot.
-->

## MODIFIED Requirements

### Requirement: Country codes SHALL be a known country

Every column in this schema holding an ISO 3166-1 alpha-2 country code SHALL be constrained to an
**assigned** code, not merely to two uppercase letters, and that constraint SHALL live in the
database rather than in a Zod schema.

There are two such columns after this change: `profile_countries.country_code` (`014`/`020` — the
travel log) and `profiles.home_country` (`113` — the rider's home market). **They are different
facts and neither is derivable from the other**: `014`'s own comment calls its table *"Countries a
rider says they have ridden in"*, so a rider who has ridden in France and lives in the Netherlands
is correctly described by both and by neither alone. Overloading one to mean the other corrupts
both meanings and is very hard to unpick later.

The rule generalises from `020`'s reasoning rather than repeating its wording: membership of the
ISO 3166-1 list lived in `COUNTRY_CODES` and was checked by Zod alone, so `ZZ` stored successfully
and rendered as a blank flag beside its own code for ever. Once the client owns the mutation path,
`COUNTRY_CODES.includes(value)` is advice.

#### Scenario: An unassigned code is refused, on either column
- **WHEN** a rider writes `ZZ`, `XX` or any other well-formed but unassigned code, to
  `profile_countries.country_code` or to `profiles.home_country`, by any route including a direct
  PostgREST call that never ran the client's validation
- **THEN** the database SHALL reject the write with `check_violation`

#### Scenario: A malformed value is refused, and by a different constraint
- **WHEN** a rider writes `` (empty), `nl`, `NLD`, `' NL '`, `1`, or a 249-character string
- **THEN** the database SHALL reject it
- **AND** the refusal SHALL come from the **shape** constraint rather than the membership one, so
  a client that eventually wants to tell *"not a code"* from *"not a country"* has two error
  identities to do it with — `020`'s stated reason for keeping `014`'s check after adding its own

#### Scenario: The picker's list stays the client's
- **WHEN** either constraint is added or regenerated
- **THEN** it SHALL NOT introduce a `countries` reference table, since nothing joins against one
  and `014` deliberately declined to create it
- **AND** the SQL literal SHALL be generated from `src/lib/countries.ts` by script rather than
  transcribed, because this is now the **third** hand-kept pairing of that list and nothing
  reconciles the copies automatically

#### Scenario: A CHECK SHALL NOT delegate the list to a function
- **WHEN** a future change is tempted to replace both literals with a shared
  `private.is_assigned_country_code(text)`
- **THEN** it SHALL NOT, because Postgres does not re-validate a CHECK when the function behind it
  changes — a list edited in one place would leave already-stored rows violating a constraint that
  reports itself as valid

## ADDED Requirements

### Requirement: A home country SHALL be required at completion, and SHALL be tolerated as NULL for ever

`profiles.home_country` SHALL be **nullable** at the database level, and
`public.complete_onboarding` SHALL refuse to stamp `onboarding_completed_at` for a rider who has
neither passed a home country nor already stored one.

A live table admits no NOT NULL here — every existing rider has no country, measured 2026-09-07 at
25 profiles on DEV and 5 on PROD, all of them NULL by construction. Nullable is therefore the only
available shape and is **not a weakening**: the requirement is a rule about *completion*, and
completion is stamped in exactly one place.

**The refusal SHALL live in the function body, not only in a trigger.** Inside a `security definer`
function `current_user` is the owner, and `enforce_onboarding_completion` opens with
`if current_user <> 'authenticated' then return new` — so a guard written only onto the trigger
never evaluates for the RPC that is the only way to complete onboarding. `075`'s header is the
worked example, `003` and `012` are the precedents, and a change that relaxed or tightened only the
trigger would pass `tsc`, pass this repo's RLS suite (which runs as the table owner, for whom
neither barrier exists) and ship nothing.

#### Scenario: A completion with no country is refused
- **WHEN** a rider calls `complete_onboarding` with a NULL, empty or whitespace-only country, and
  `profiles.home_country` is NULL for them
- **THEN** the call SHALL raise `check_violation`
- **AND** `onboarding_completed_at` SHALL remain NULL
- **AND** the rider SHALL remain unable to create content or join anything, because `023`'s
  participation gate reads that stamp

#### Scenario: An already-onboarded rider re-running the function is not refused
- **WHEN** a rider who already holds a `home_country` calls `complete_onboarding` again with no
  country argument
- **THEN** the call SHALL succeed and SHALL return the **original** stamp, per `003` §6b
- **AND** the guard SHALL therefore read the **stored** value as well as the argument; a guard
  reading the argument alone would refuse every legitimate re-run

#### Scenario: A NULL argument leaves a stored country alone and never clears it
- **WHEN** `complete_onboarding` is called with a NULL or whitespace-only country by a rider who
  already has one
- **THEN** the stored value SHALL be unchanged
- **AND** the write SHALL use `coalesce(nullif(btrim(...), ''), p.home_country)`, never a bare
  assignment — `075` records this as the single most dangerous line in that change, and the same
  line is reachable here for the same reason

#### Scenario: Existing riders keep NULL and are never re-prompted
- **WHEN** a rider whose `onboarding_completed_at` is already set holds a NULL `home_country`
- **THEN** nothing in this change SHALL write a value for them, prompt them, re-gate them or
  refuse them any capability
- **AND** the column comment SHALL say so, so that a later session which assumes non-null
  *"because onboarding requires it"* is contradicted by the schema rather than by folklore

#### Scenario: The requirement is not derived from anything
- **WHEN** a rider has a `profiles.location` such as `Amsterdam, NL`, or rows in
  `profile_countries`, or a device position
- **THEN** no migration and no action SHALL derive `home_country` from any of them, because the
  derivation is silently wrong for exactly the riders whose free text does not resolve — the
  population `localityOf` exists because of

#### Scenario: A new raise SHALL NOT reach the welcome-club block
- **WHEN** the completion guard is added to `complete_onboarding`
- **THEN** it SHALL sit beside the existing consent and username guards, **above** `058`'s
  `club_members` insert and outside its `when others` handler
- **AND** no new raise SHALL be introduced inside that block, because a raise there rolls the
  completion stamp back and decision #5 leaves a rider with a NULL stamp no way out of the wizard

#### Scenario: The gate's table set is unchanged
- **WHEN** `113` and `114` are applied
- **THEN** `enforce_participation_gate` SHALL be on exactly the tables it was on before, and
  SHALL still NOT be on `profiles` UPDATE
- **AND** an account that never called `accept_terms()` writing `home_country` directly SHALL
  remain permitted and SHALL remain unable to complete onboarding, because writing a country
  confers no participation and the consent guard is evaluated independently

### Requirement: Every role's reach into a rider's home country SHALL be stated

`profiles.home_country` SHALL be readable by exactly the audience the `profiles` SELECT policy
already admits, and writable by its owner alone. Each role SHALL have its access stated so that
each line maps onto an assertion in `supabase/tests/rls_test.sql`, because an unstated negative
silently becomes whatever the migration author assumed.

The audience predicate is unchanged and is stated rather than referenced:
`auth.uid() = id OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))`.

#### Scenario: The rider themselves
- **WHEN** a rider reads or writes `home_country` on their own row
- **THEN** they SHALL read it, SHALL set it while it is NULL, and SHALL change it to another
  assigned code
- **AND** they SHALL NOT return it to NULL: `enforce_onboarding_completion` SHALL coerce the
  removal away — `new.home_country := coalesce(new.home_country, old.home_country)`, `038`'s shape
  — and the assertion SHALL check the **stored value** rather than a SQLSTATE, because a coercion
  raises nothing

#### Scenario: Any other signed-in rider
- **WHEN** a signed-in rider updates a `profiles` row that is not their own, setting
  `home_country` to any value or to NULL
- **THEN** zero rows SHALL be affected, because the UPDATE policy is `auth.uid() = id`

#### Scenario: A blocked rider
- **WHEN** rider A blocks rider B, and B reads A's `home_country` by any route
- **THEN** zero rows SHALL be returned, and the same SHALL hold with A and B exchanged, because
  blocking is symmetric even though the row is directional
- **AND** this change SHALL open no new inference channel: there is no unique index, no
  availability check and no count over this column

#### Scenario: Club owner, admin, member and non-member
- **WHEN** a rider holding `club_members.role` of `owner`, `admin` or `member`, or holding no
  membership at all, reaches another rider's profile through a club roster, a ride crew, a
  postcard byline or Explore
- **THEN** they SHALL read `home_country` exactly as the SELECT policy already admits, and SHALL
  write nothing
- **AND** no club role SHALL confer authority to set, change or clear another rider's home country

#### Scenario: A signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned and zero rows written, because `anon` holds no grant on
  `profiles` at all
- **AND** no rule in this change SHALL be expressed in a way that admits `anon`, per decision #1

#### Scenario: The column is rider-owned, not server-owned
- **WHEN** the grants are written
- **THEN** `authenticated` SHALL hold SELECT, INSERT and UPDATE on `home_country`, the posture
  `location` already has
- **AND** it SHALL NOT take `025`'s server-owned posture, which is reserved for evidence the rider
  must not author — a consent stamp, a completion stamp, a terms version, an analytics preference
- **AND** the grant assertion SHALL be scoped to its grantee or use `has_table_privilege`, because
  `postgres` and `service_role` hold everything by Supabase default

#### Scenario: The route guard is not the enforcement
- **WHEN** a rider defeats or bypasses the client-side route guard and calls
  `complete_onboarding` directly with no country
- **THEN** the refusal SHALL be identical, because it lives in the database
- **AND** the guard SHALL NOT be modified to compensate for any defect in this rule

### Requirement: A completion invariant added to a live table SHALL be armed separately from the column it reads

A migration that adds a column a shipped client will write SHALL be separate from the migration
that begins refusing writes which omit it, and the deploy SHALL sit between them.

One file cannot be both sides of a deploy. The additive half must exist **before** the new bundle,
or the bundle writes a column that is not there (`PGRST204`) and calls a signature that is not
there (`PGRST202`) — `096` is the precedent, and the failure is that nobody can finish onboarding.
The restrictive half must not exist **until** the new bundle is serving, or the old bundle's
completion call — which passes no country — is refused for every rider mid-signup. `108`/`109` is
the shape.

#### Scenario: The additive migration is safe against the serving bundle
- **WHEN** `113` is applied while the current bundle is still serving
- **THEN** `complete_onboarding` SHALL still resolve for a caller that supplies only
  `p_location`, via a defaulted `p_country` parameter, and SHALL still stamp completion
- **AND** the omitted country SHALL leave the column alone rather than clearing it

#### Scenario: The arming migration waits for a serving bundle, not a merge
- **WHEN** `114` is scheduled
- **THEN** it SHALL be applied only after the new bundle is confirmed **serving** — `READY` on the
  merge sha with `aliasError` null — never merely after the merge
- **AND** the same two-file split SHALL be preserved through the PROD promotion rather than
  collapsed into one

#### Scenario: The trigger edit is a coercion, and is exercised by hand before it applies
- **WHEN** `113` changes `enforce_onboarding_completion`, which fires inside every profile edit's
  own transaction
- **THEN** the new arm SHALL be a coercion rather than a raise, so it cannot take a shipped write
  path down
- **AND** every affected write SHALL be exercised by hand on DEV first, in a rolled-back
  transaction, as `authenticated`
