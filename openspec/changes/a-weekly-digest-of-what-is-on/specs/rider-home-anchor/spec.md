## Purpose

The coordinate and zone the app stores **about a rider** rather than about a place: where it comes
from, which of the two town writers must produce it, who may read it — a much shorter list than
for the town name it is derived from — when it is cleared, and how long it is kept.

It exists because a scheduled job has no device GPS and no route to a geocoder, so a question the
client answers live every session has to become a column. Every requirement below is a statement
about a role and a resource and maps onto an assertion in `supabase/tests/rls_test.sql`.

## ADDED Requirements

### Requirement: The anchor SHALL be written from the pick, and SHALL NOT be resolved at digest time

`profiles.home_latitude`, `profiles.home_longitude` and `profiles.home_timezone` SHALL be written
at the moment the rider picks a town, from the `lat`, `lon` and `timezone` the picker already
holds on `PlaceValue`. Resolving a rider's stored town to a centroid at digest time SHALL NOT be
done.

**The ceiling is the reason, and it is application-wide rather than per rider.**
`supabase/functions/search-places/shape.ts` sets `APP_DAILY_SEARCH = 2000` — two thousand lookups
per 24 hours **across every rider**, enforced by `069`'s `place_search_attempts` INSERT policy, in
front of a vendor with its own global limit. A weekly digest for a few thousand riders would spend
days of that budget in one run, and the budget it starves is the one onboarding depends on:
`114` refuses to stamp completion without a country and `src/app/onboarding/town/page.tsx`'s
country escape exists precisely because an exhausted ceiling otherwise means *no new rider
anywhere can finish onboarding*.

**It is also simply unreachable.** `getLocalityCentroid` invokes an Edge Function from the
browser; Postgres cannot call it without `pg_net`, which is installed on neither project.

#### Scenario: A picked town stores its coordinate and its zone
- **WHEN** a rider picks a town through either writer
- **THEN** `location`, `home_country`, `home_latitude`, `home_longitude` and `home_timezone` SHALL
  be written in **one** statement
- **AND** no additional vendor request SHALL be made, because the values are already in hand

#### Scenario: A pick carrying no zone stores no zone
- **WHEN** the vendor returns no `timezone` for the picked place
- **THEN** `home_timezone` SHALL be NULL rather than guessed from the country or the coordinate
- **AND** every reader SHALL treat NULL as *"we do not know"* and name its own fallback, which is
  `rides.timezone`'s existing rule applied to a rider

#### Scenario: Nothing is backfilled
- **WHEN** the migration applies
- **THEN** no existing profile SHALL gain an anchor
- **AND** *"a rider with a town and no anchor"* SHALL be treated as the ordinary state rather than
  as an edge case, because on that day it is every profile in the database

### Requirement: BOTH writers of `profiles.location` SHALL write the anchor

`setRiderTown` (`src/lib/actions/profile.ts`) and `setHomeTown` (`src/lib/actions/onboarding.ts`)
SHALL each write the anchor. There is no single writer to hang the guarantee on, so both are named
here and a unit test SHALL assert both.

A town written by one writer and an anchor written by the other is a rider whose distances are
measured from a town they replaced — silently, with nothing on any screen saying so.

#### Scenario: Both modules write the anchor
- **WHEN** the two action modules are read on comment-stripped source
- **THEN** each SHALL be found to write the anchor on its town path
- **AND** the assertion SHALL be per **exported function**, not per file, because a file-granular
  check passes while one of several exports in the same module has lost its call

#### Scenario: The wizard's country-only escape writes no anchor and is not a defect
- **WHEN** a rider completes onboarding through the country fallback because the lookup was
  unavailable
- **THEN** they SHALL have a country, no town and no anchor
- **AND** that SHALL be an accepted outcome rather than a blocked completion, because decision #5
  forbids a skip and `114` refuses the stamp without a country

#### Scenario: Neither writer gains a guard-cache obligation
- **WHEN** the route guard's inputs are re-derived
- **THEN** none of the four new columns SHALL be among the three fields the decision reads —
  `terms_accepted_at`, `onboarding_completed_at`, `has_username`
- **AND** the existing `invalidateOnboardingState()` count SHALL be unchanged at four, measured
  rather than asserted

### Requirement: The anchor and the town SHALL be constrained to arrive and to leave together

A CHECK SHALL refuse a half-pair — one of latitude and longitude without the other — and SHALL
refuse an anchor on a row with no `location`. A `BEFORE UPDATE` trigger SHALL clear the anchor
whenever the town is cleared.

**The trigger is required by the CHECK and not merely tidy.** `setRiderTown(null)` writes
`location: null` and touches nothing else; without the trigger that statement violates the CHECK
and raises at a rider who tapped *Remove*. `database-enforced-integrity`'s standing rule is that
this enforcement SHALL **clear rather than raise** wherever it guards a path the rider is already
on, and removing your town is such a path.

The trigger SHALL decide from `OLD` and `NEW` alone and SHALL state which values it clears.

#### Scenario: A latitude without a longitude is refused
- **WHEN** either coordinate is written without the other
- **THEN** the write SHALL be refused by CHECK, in both orders

#### Scenario: Clearing the town clears the anchor, and does not raise
- **WHEN** `location` is set to NULL on a row carrying an anchor
- **THEN** `home_latitude`, `home_longitude` and `home_timezone` SHALL all be NULL afterwards
- **AND** the statement SHALL succeed

#### Scenario: An anchor cannot be attached to a row with no town
- **WHEN** an anchor is written to a row whose `location` is NULL and stays NULL
- **THEN** the write SHALL be refused by CHECK

#### Scenario: Coordinates are bounded
- **WHEN** a latitude outside [-90, 90] or a longitude outside [-180, 180] is written
- **THEN** it SHALL be refused by CHECK
- **AND** the bound SHALL be a CHECK rather than a Zod schema, because the client owns the
  mutation path and a rider can simply not run a validation

#### Scenario: Changing the town replaces the anchor rather than keeping the old one
- **WHEN** a rider picks a different town
- **THEN** the anchor SHALL be the new town's, and a stale coordinate SHALL NOT survive
- **AND** the module-level position memo SHALL be cleared in the same action, as
  `clearRiderLocation()` already is

### Requirement: No rider SHALL be able to read another rider's anchor

`authenticated` SHALL hold **no** SELECT, INSERT or UPDATE grant on `home_latitude`,
`home_longitude`, `home_timezone` or `digest_opt_out_at` on `public.profiles`. The only reach
SHALL be own-row `security definer` RPCs taking no rider id.

**This is a decision against the obvious reflex and the reflex is what leaks.**
`profiles.location` — a town name — **is** granted SELECT to `authenticated` today, so every
non-blocked rider reads every other rider's town, and RLS is row-level so the policy admits the
whole row. Adding the coordinate columns to that same allowlist would publish an approximate home
location for every rider through a bare `?select=home_latitude,home_longitude` that needs no
screen at all.

A town name and a ~1 km coordinate are not the same disclosure. `rider-position-question`'s own
`LOCATION_PRECISION_DP` reasoning says so directly — two decimal places is *"defence in depth, not
de-identification"*, and *"persisting an approximate rider location anywhere needs its own
decision, not an inference from this one."* This is that decision.

The migration SHALL issue **no `grant` or `revoke` statement on `public.profiles` at all**.
`025`'s grant lists are an absolute allowlist, so an ungranted column is invisible; the only way to
get this wrong is to touch those lists, and the file simply does not contain the statement.

#### Scenario: Another rider selecting every column gets none of the four
- **WHEN** a signed-in rider selects all columns of another rider's profile
- **THEN** none of `home_latitude`, `home_longitude`, `home_timezone` or `digest_opt_out_at`
  SHALL be returned
- **AND** the assertion SHALL be `has_column_privilege('authenticated', 'public.profiles', …,
  'select')` being false for each, rather than a narrowed projection, because a projection is a
  convention the database does not enforce

#### Scenario: A rider cannot write the columns directly
- **WHEN** a rider issues `update profiles set home_latitude = …` against their own row
- **THEN** the statement SHALL be refused by the absent column grant
- **AND** the same SHALL hold for an insert naming the columns

#### Scenario: The RPC takes no rider id
- **WHEN** the write RPC is defined
- **THEN** it SHALL resolve its subject from `auth.uid()` alone, so a foreign write is
  **unrepresentable** rather than merely refused

#### Scenario: `anon` reaches nothing
- **WHEN** a request arrives with no session
- **THEN** every read and write of the four columns and of both RPCs SHALL be refused, and this
  change SHALL grant `anon` nothing, per decision #1

#### Scenario: The advisor count moves by exactly the number of new public definer functions
- **WHEN** the security advisors are read after applying
- **THEN** each new `security definer` function in `public` that `authenticated` may execute SHALL
  account for exactly one new `authenticated_security_definer_function_executable` WARN
- **AND** a WARN appearing for a function meant to be reachable by nobody SHALL be treated as a
  failed apply, because it means a `revoke` did not land

### Requirement: The anchor SHALL have a stated retention, and it SHALL be the profile's own lifetime

The anchor SHALL live exactly as long as the profile row and the town it was derived from. It
SHALL be deleted when the rider deletes their account, by the profile row going; and cleared when
the rider clears their town, by the trigger. **There SHALL be no sweep and no expiry**, and that
is a decision recorded rather than an omission.

Anything holding personal data needs a stated window at creation. The window here is *the
profile's lifetime* because a current town is a current fact the rider entered and can change or
remove at any time from the profile's location setting — unlike a GPS **track**, which is a record
of where someone *was* and would need a real expiry. **A future background-location feature SHALL
NOT extend this window to its own data by analogy**; a track is a different class and owes its own
decision.

The rider SHALL be able to see and remove it: the profile's location setting already names the
three sources — device, *"you told us"*, and none — and the *Remove* control already exists.
Removing the town SHALL remove the anchor with it, which is what makes "see it and withdraw it" a
single act.

#### Scenario: Account deletion takes the anchor
- **WHEN** a rider deletes their account
- **THEN** the columns go with the profile row, and no step is added to the `delete-account` Edge
  Function

#### Scenario: Removing the town removes the anchor
- **WHEN** a rider taps *Remove* on the profile's location setting
- **THEN** the anchor SHALL be NULL afterwards and the rider SHALL be measurable from nowhere
- **AND** they SHALL thereafter be in the digest's no-anchor population, receiving no rides half

#### Scenario: The privacy copy names the anchor
- **WHEN** `/legal/privacy` is read
- **THEN** it SHALL say, in its own words, that the app stores the approximate centre of the town
  the rider gave, that it is used to find rides near them, and that removing the town removes it
- **AND** the sentence SHALL move whenever this window does

#### Scenario: No scheduled deletion is added
- **WHEN** the retention mechanism is reviewed
- **THEN** there SHALL be no sweep function and no expiry interval for these columns
- **AND** the absence SHALL be the recorded decision rather than a gap, because a different
  retention answer needs a mechanism and not a sentence
