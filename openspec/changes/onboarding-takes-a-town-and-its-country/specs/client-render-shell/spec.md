<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

**Both MODIFIED requirements below were ADDED by `require-a-home-country-at-onboarding` (PD-428)
and are NOT in `openspec/specs/client-render-shell/spec.md` yet — that change is still unarchived
even though its code and its migrations (`113`, `114`) are live on both projects.** It SHALL be
archived before this change, or these two blocks have no base to modify. No other active change
claims either requirement.

**Scenario diff, per requirement, stated because a stale MODIFIED block drops scenarios wholesale**
(`docs/HANDOFF.md`):

`The onboarding resume order SHALL be derivable from `my_onboarding_state()` alone` — 4 scenarios
in, 4 out. Kept: *The resume step for each reachable state*, *A rider mid-wizard across the deploy*,
*The guard is not the enforcement*. Renamed only: *A rider abandons the country step and returns* →
*A rider abandons the town step and returns*. Nothing dropped.

`The country step SHALL define every state it can be in` → `The town step SHALL define every state
it can be in` — 7 scenarios in, 10 out. All seven kept by name: *First paint and the list* (rewritten
— the list stopped being a local constant and became a metered lookup), *The submit is in flight*,
*The submit fails*, *Offline*, *Permission denied and empty are told apart*, *Stale — the rider is
already onboarded*, *The screen claims no proximity*. Three added: *The lookup is empty*, *The lookup
fails*, *A town typed and never picked*. Nothing dropped.

The third requirement is ADDED and is claimed by nothing.
-->

## MODIFIED Requirements

### Requirement: The onboarding resume order SHALL be derivable from `my_onboarding_state()` alone

`resolveDestination` SHALL resolve the resume step from the three values `my_onboarding_state()`
already returns — `terms_accepted_at`, `has_username`, `onboarding_completed_at` — and the
accessor's return shape SHALL NOT change to carry the home country **or the town**.

The wizard's steps are terms → username → town, and the town adds no information the existing three
do not already carry: *"has a username and no stamp"* means *"is at the last step"*, whether or not
the column write has already landed, because that screen is where both the write and its retry live.

**This holds across the step's rename.** The terminal step's path changes from `/onboarding/country`
to `/onboarding/town`; the *state* that resolves to it does not, which is the entire reason the
resume order is expressed in stamps rather than in paths.

Widening the accessor is the expensive option and the failure is silent: a newer bundle
destructuring a field an older function does not return reads `undefined`, which is falsy, which —
on a misordered branch — resolves to the last step for **every rider on the app**, onboarded or not.
`tsc` cannot see it and the guard is mounted in the root layout, so the blast radius is every screen.

#### Scenario: The resume step for each reachable state
- **WHEN** `resolveDestination` is called for a signed-in rider on a path that needs the stamps
- **THEN** it SHALL resolve `/onboarding/terms` when `terms_accepted_at` is NULL;
  `/onboarding/username` when consent is stamped, `has_username` is false and
  `onboarding_completed_at` is NULL; `/onboarding/town` when consent is stamped, `has_username` is
  true and `onboarding_completed_at` is NULL; and the app otherwise
- **AND** consent SHALL remain gated **ahead** of the wizard, because `023` refuses to stamp
  completion while the consent stamp is NULL
- **AND** neither `profiles.location` nor `profiles.home_country` SHALL appear in this decision

#### Scenario: A rider abandons the town step and returns
- **WHEN** a rider sets a username, reaches `/onboarding/town`, closes the app, and returns — in the
  same session or a new one, on the same device or another
- **THEN** they SHALL land on `/onboarding/town`, and SHALL NOT be asked for their username again
- **AND** they SHALL be sent there from `/onboarding/username`, from `/onboarding/terms`, from
  **`/onboarding/country`** — the path this step used to have, now in bookmarks, in a stale tab and
  in a native shell's restored path — and from any other path under `/onboarding`, and from every
  app route
- **AND** the step SHALL offer no skip affordance, per decision #5
- **AND** nothing SHALL have been written by the abandoned visit: the step performs no write before
  its submit, so re-entering is idempotent

#### Scenario: A rider mid-wizard across the deploy
- **WHEN** a rider set a username under the previous bundle, was stamped complete by it, and returns
  after this change ships
- **THEN** they SHALL reach the app with whatever `location` and `home_country` they hold — including
  neither — and SHALL NOT be sent into the wizard, because `onboarding_completed_at` is set
- **AND** the deploy window itself SHALL be understood to manufacture a small number of such riders,
  who join the permanently-tolerated NULL population rather than being re-prompted

#### Scenario: The guard is not the enforcement
- **WHEN** a rider defeats the guard and navigates directly to an app route with no completion stamp
- **THEN** every content write SHALL still be refused by `023`'s participation gate, and the screens
  SHALL return zero rows under RLS

### Requirement: The town step SHALL define every state it can be in

`/onboarding/town` SHALL have a defined behaviour for each state below, and SHALL NOT gate its render
on `isLoading`.

**The list of states grew when the control changed.** The country step's picker read a local
constant, so it had no empty, loading or error state worth naming. A town is answered by a metered
third-party lookup over the network, from a rider who has just installed the app and may be on a
moving motorcycle's connection — so the suggestion list has its own empty, in-flight and failed
states, distinct from the submit's.

#### Scenario: First paint and the list
- **WHEN** the screen mounts
- **THEN** it SHALL render its form immediately with no read of its own and no skeleton, and the
  suggestion list SHALL be closed and empty
- **AND** it SHALL NOT perform a lookup on mount, because a lookup spends a metered credit
  (`069`'s ledger row is written before the vendor is called) for a rider who has touched nothing
- **AND** the submit SHALL be disabled until a town is picked — and, in the fallback branch below,
  until a country is chosen as well — so there is no state in which tapping it can mean *"whatever
  was preselected"*
- **AND** a rider returning after a failed stamp SHALL NOT be required to re-pick a town already
  stored on their row, so the retry is one tap

#### Scenario: The lookup is empty
- **WHEN** the rider types a term the geocoder answers with no results
- **THEN** the field SHALL say so in its own list, SHALL leave the typed text in place, and SHALL
  NOT be reported as an error
- **AND** the submit SHALL remain disabled, because no pick has been made

#### Scenario: The lookup fails
- **WHEN** the lookup errors, times out, or the rider is rate-limited by `069`'s per-rider ceiling
- **THEN** the failure SHALL be shown on the field with a retry, SHALL NOT be shown as a failure of
  the step, and SHALL NOT clear a pick the rider has already made
- **AND** the rider SHALL NOT be stranded with no route forward that this change can offer; the
  remaining dead end — a town the geocoder cannot find at all — is `design.md` Q3 and is named rather
  than silently handled

#### Scenario: A town typed and never picked
- **WHEN** the rider types a town name and submits without choosing a suggestion
- **THEN** nothing SHALL be stored, the typed text SHALL NOT be submitted, and the field SHALL NOT
  present the text as an answer
- **AND** this SHALL hold because the step passes **no `freeText`** to `PlaceSearchField`: in place
  mode the visible input carries no `name`, the draft reverts on blur, and the hidden inputs read
  through the pick. Passing `freeText` here SHALL be understood as converting a typed string into a
  stored town, which is the one thing this screen must not do

#### Scenario: The submit is in flight
- **WHEN** the rider submits
- **THEN** the button SHALL show its `loading` state through `useActionState`'s pending value, and
  the control SHALL refuse a second submit
- **AND** the screen SHALL NOT navigate until the RPC has answered, because the stamp it writes is
  what the guard reads on arrival

#### Scenario: The submit fails
- **WHEN** the `profiles` UPDATE or `complete_onboarding` answers an error
- **THEN** `23514` SHALL render as an actionable message rather than a raw Postgres error, and every
  other error SHALL render as a retryable message that leaves the picked town and the chosen country
  in place
- **AND** the rider SHALL be able to submit again without re-picking, and re-submitting the same pick
  SHALL succeed — it rewrites the rider's own row with the same values before re-running the RPC

#### Scenario: Offline
- **WHEN** the rider has no connection
- **THEN** the lookup SHALL fail on the field and the submit SHALL fail visibly, and neither SHALL be
  queued — a completion stamp written later would let a rider walk into the app before the database
  agrees they may
- **AND** the picked town SHALL survive the failure in component state

#### Scenario: Permission denied and empty are told apart
- **WHEN** the `profiles` UPDATE matches no row
- **THEN** it SHALL be treated as *"your profile could not be found — sign in again"* rather than as
  a success, matching `setUsername`'s existing handling of the same shape
- **AND** `null` SHALL be read as a decided answer and `undefined` as *"not yet"*, so no 404 flashes
  on the way in

#### Scenario: Stale — the rider is already onboarded
- **WHEN** the rider completed onboarding in another tab or on another device while this screen was
  open, and submits
- **THEN** `complete_onboarding` SHALL succeed idempotently and return the **original** stamp, and
  the rider SHALL be sent on rather than shown an error
- **AND** their stored town SHALL NOT be overwritten by this submit's RPC call, because
  `p_location` is passed as `null` and `075`'s `coalesce` reads that as *leave it alone*

#### Scenario: The screen claims no proximity
- **WHEN** the step renders any explanatory copy
- **THEN** it SHALL NOT offer to use the device location and SHALL NOT trigger an OS permission
  prompt — a form field answered is consent; an OS prompt with no escape is not, and a mandatory town
  SHALL NOT become an argument for either that prompt or an IP lookup
- **AND** a country SHALL never be rendered as `near <country>` anywhere in the app, because a
  country is a filter and not a proximity
- **AND** the copy SHALL describe what the town is used for in terms that are true — rides and clubs
  measured from it — rather than repeating the country step's promise that nothing kept

## ADDED Requirements

### Requirement: A fallback control SHALL appear only when the value it substitutes for is absent, and SHALL NOT share a field name with it

Where one rider action can supply a value directly, and a second control exists only for the case
where it did not, the second control SHALL be rendered **only in that case**, and the two SHALL NOT
both be able to write the same form field name at the same time.

This is the country select on the town step, and both halves are load-bearing.

Rendering it always — pre-filled from the pick, as a confirmation — turns a branch nobody usually
sees into a question everybody answers, on a wizard step that already has no skip. The common case
is a pick that carries a country, and the correct number of controls in the common case is one.

Sharing a name is the silent half. `CountrySelect` renders a hidden input named `country`; a pick
that carries a country would render another under the same name, and `formData.get('country')`
returns the **first** match. A rider's explicit fallback answer could be shadowed by a stale one, or
the reverse, with nothing wrong on screen, nothing red in `tsc` and nothing red in the suite. The
two SHALL be mutually exclusive by construction rather than by ordering.

#### Scenario: The pick carries a country
- **WHEN** the picked place's `countryCode` is a non-empty string
- **THEN** no country control SHALL be rendered — not pre-filled, not disabled, not as a confirmation
- **AND** exactly one form field named `country` SHALL exist, carrying the picked code
- **AND** the submit SHALL be enabled

#### Scenario: The pick carries no country
- **WHEN** the picked place's `countryCode` is `null` **or the property is absent entirely**
- **THEN** a `CountrySelect` SHALL appear beneath the town field, on the same step, with no
  navigation
- **AND** exactly one form field named `country` SHALL exist — the select's — because the pick renders
  none
- **AND** the submit SHALL stay disabled until a country is chosen
- **AND** the branch SHALL test for both `null` and `undefined`, because `countryCode` is optional on
  `PlaceValue`: `toPlaceValue` always sets it from a fresh lookup, but a seeded value omits the
  property, so a test written as `=== null` misses half the cases

#### Scenario: The rider changes their pick after the fallback appeared
- **WHEN** a rider picks a place with no country, is shown the select, and then picks a different
  place that does carry one
- **THEN** the select SHALL disappear, and the country SHALL be the new pick's
- **AND** a country the rider chose in the select SHALL NOT survive as a hidden field, because the
  select is unmounted with it

#### Scenario: The gate is an affordance, not the guarantee
- **WHEN** a rider defeats the disabled submit and posts with no country by either route
- **THEN** `114` SHALL refuse to stamp completion with `check_violation`, the rider SHALL remain
  un-onboarded, and the screen SHALL show an actionable message rather than a raw Postgres error
- **AND** `023`'s participation gate SHALL refuse their content writes independently
