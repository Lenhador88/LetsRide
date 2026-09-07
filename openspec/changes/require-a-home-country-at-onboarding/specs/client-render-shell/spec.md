<!--
COORDINATION — checked 2026-09-07:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

`The route guard SHALL be a UX affordance and SHALL NOT be relied on for access control` is claimed
by `add-account-deletion` and `add-static-export-bundle`, and `Every screen SHALL have a defined
first-paint state` by several. Neither is modified here: both requirements below are ADDED and
scoped to what this change actually introduces — a third wizard step and the rule that keeps it out
of the guard's cached state. The negative *"the guard is not the enforcement"* is stated in the
`database-enforced-integrity` delta, where the enforcement lives.
-->

## ADDED Requirements

### Requirement: The onboarding resume order SHALL be derivable from `my_onboarding_state()` alone

`resolveDestination` SHALL resolve the resume step from the three values
`my_onboarding_state()` already returns — `terms_accepted_at`, `has_username`,
`onboarding_completed_at` — and the accessor's return shape SHALL NOT change to carry the home
country.

The wizard's steps are terms → username → country, and the country adds no information the existing
three do not already carry: the only client path that writes `home_country` during onboarding is
`complete_onboarding`, which writes the country and the completion stamp in one statement, so
*"has a username and no stamp"* means *"is at the country step"* by construction.

Widening the accessor is the expensive option and the failure is silent: a newer bundle
destructuring a field an older function does not return reads `undefined`, which is falsy, which —
on a misordered branch — resolves to the country step for **every rider on the app**, onboarded or
not. `tsc` cannot see it and the guard is mounted in the root layout, so the blast radius is every
screen.

#### Scenario: The resume step for each reachable state
- **WHEN** `resolveDestination` is called for a signed-in rider on a path that needs the stamps
- **THEN** it SHALL resolve `/onboarding/terms` when `terms_accepted_at` is NULL;
  `/onboarding/username` when consent is stamped, `has_username` is false and
  `onboarding_completed_at` is NULL; `/onboarding/country` when consent is stamped,
  `has_username` is true and `onboarding_completed_at` is NULL; and the app otherwise
- **AND** consent SHALL remain gated **ahead** of the wizard, because `023` refuses to stamp
  completion while the consent stamp is NULL

#### Scenario: A rider abandons the country step and returns
- **WHEN** a rider sets a username, reaches `/onboarding/country`, closes the app, and returns —
  in the same session or a new one, on the same device or another
- **THEN** they SHALL land on `/onboarding/country`, and SHALL NOT be asked for their username
  again
- **AND** they SHALL be sent there from `/onboarding/username`, from `/onboarding/terms`, from any
  other path under `/onboarding` (a deleted step's URL in a bookmark, a stale tab, a native shell
  restoring its last path), and from every app route
- **AND** the step SHALL offer no skip affordance, per decision #5

#### Scenario: A rider mid-wizard across the deploy
- **WHEN** a rider set a username under the previous bundle, was stamped complete by it, and
  returns after this change ships
- **THEN** they SHALL reach the app with a NULL `home_country` and SHALL NOT be sent into the
  wizard, because `onboarding_completed_at` is set
- **AND** the deploy window itself SHALL be understood to manufacture a small number of such
  riders, who join the permanently-tolerated NULL population rather than being re-prompted

#### Scenario: The guard is not the enforcement
- **WHEN** a rider defeats the guard and navigates directly to an app route with no completion
  stamp
- **THEN** every content write SHALL still be refused by `023`'s participation gate, and the
  screens SHALL return zero rows under RLS

### Requirement: The country step SHALL define every state it can be in

`/onboarding/country` SHALL have a defined behaviour for each state below, and SHALL NOT gate its
render on `isLoading`.

The list is fixed and reachable: the picker's source is a local constant, but the submit is a round
trip to `eu-west-1` from a rider who has just installed the app and may be on a moving motorcycle's
connection.

#### Scenario: First paint and the list
- **WHEN** the screen mounts
- **THEN** the country list SHALL render immediately from `COUNTRY_CODES` with no fetch, no
  skeleton and no empty state, because it is a client-side constant
- **AND** the submit SHALL be disabled until a country is chosen, so there is no state in which
  tapping it can mean *"whatever was preselected"*

#### Scenario: The submit is in flight
- **WHEN** the rider submits
- **THEN** the button SHALL show its `loading` state through `useActionState`'s pending value, and
  the control SHALL refuse a second submit
- **AND** the screen SHALL NOT navigate until the RPC has answered, because the stamp it writes is
  what the guard reads on arrival

#### Scenario: The submit fails
- **WHEN** the RPC answers an error
- **THEN** `23514` SHALL render as an actionable field message rather than a raw Postgres error,
  and every other error SHALL render as a retryable message that leaves the chosen country in place
- **AND** the rider SHALL be able to submit again without re-picking

#### Scenario: Offline
- **WHEN** the rider has no connection
- **THEN** the submit SHALL fail visibly and SHALL NOT be queued, because a completion stamp
  written later would let a rider walk into the app before the database agrees they may
- **AND** the chosen country SHALL survive the failure in component state

#### Scenario: Permission denied and empty are told apart
- **WHEN** the RPC returns no row
- **THEN** it SHALL be treated as *"your profile could not be found — sign in again"* rather than
  as an empty result, matching `setUsername`'s existing handling of the same shape
- **AND** `null` SHALL be read as a decided answer and `undefined` as *"not yet"*, so no 404
  flashes on the way in

#### Scenario: Stale — the rider is already onboarded
- **WHEN** the rider completed onboarding in another tab or on another device while this screen was
  open, and submits
- **THEN** `complete_onboarding` SHALL succeed idempotently and return the original stamp, and the
  rider SHALL be sent on rather than shown an error

#### Scenario: The screen claims no proximity
- **WHEN** the step renders any explanatory copy
- **THEN** it SHALL NOT promise that the app knows where the rider is, SHALL NOT offer to use the
  device location, and SHALL NOT trigger an OS permission prompt
- **AND** a country SHALL never be rendered as `near <country>` anywhere in the app, because a
  country is a filter and not a proximity
