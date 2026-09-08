<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

`The guard cache SHALL be invalidated by whichever write is last, and the writer count SHALL be a
measurement rather than a sentence` (standing, `client-cache-invalidation`) is deliberately NOT
modified. This change renames a writer; it does not add or remove one, so the count query and its
answer of 4 are unchanged and a MODIFIED block would restate them for no reason.
`require-a-home-country-at-onboarding` holds a MODIFIED block on that same requirement and is still
unarchived — a second one here would collide with it.

The requirement below is ADDED and is claimed by nothing.
-->

## ADDED Requirements

### Requirement: A second writer of a column the guard does not read SHALL NOT acquire a guard-cache claim

Where a change gives a column a writer outside the onboarding wizard, that writer SHALL invalidate
the guard cache **only if the guard's decision actually reads the column**, and the spec SHALL say
which of the two it is rather than leaving it to the reviewer to work out.

`profiles.home_country` gets a second writer here: `setRiderTown` writes it beside `location` when a
later town change carries a country. It **SHALL NOT** call `invalidateOnboardingState()`.

The reason is the single most load-bearing decision PD-428 made and it is easy to undo by accident.
`resolveDestination` reads three values — `terms_accepted_at`, `onboarding_completed_at` and
`has_username` — and `home_country` is none of them; `my_onboarding_state()` does not return it and
its shape does not change here. A writer that invalidated the guard cache for a column the guard
cannot see would look correct, pass every gate, and quietly establish that the country *is* guard
state — which is the premise a later author would then widen the accessor on.

The inverse mistake is the one `writers-invalidate.test.ts` already refuses, per **exported
function** rather than per file. This requirement is the other direction, and nothing automated
catches it.

#### Scenario: The town writer's cache claims
- **WHEN** `setRiderTown` writes a town, or a town and a country, or clears a town
- **THEN** it SHALL invalidate `queryKeys.profile.all()` and `queryKeys.riderLocation()`, and SHALL
  call `clearRiderLocation()` for the module memo — all three, because the memo is module state
  rather than a cache entry and invalidating the keys alone leaves every screen re-reading a
  five-minute-old answer built from the old town
- **AND** it SHALL NOT call `invalidateOnboardingState()`
- **AND** it SHALL NOT write `onboarding_completed_at`, `terms_accepted_at` or `username`

#### Scenario: The wizard's terminal writer keeps its claim
- **WHEN** the town step's action writes both columns and then stamps completion
- **THEN** it SHALL call `invalidateOnboardingState()` once, after both writes rather than between
  them, because the stamp the guard cached is what sent the rider to that screen
- **AND** renaming that exported function SHALL NOT change the number of guard-cache writers, which
  stays four and SHALL be re-derived by the counting query rather than asserted from this sentence
- **AND** `writers-invalidate.test.ts` SHALL still refuse it if the call is removed, verified in both
  directions — green now, red with the call deleted

#### Scenario: A country written outside the wizard does not move the resume target
- **WHEN** an already-onboarded rider changes their town, and with it their country
- **THEN** the guard's cached onboarding state SHALL remain valid, and the rider SHALL NOT be
  re-routed
- **AND** their completion stamp SHALL be untouched, because completion is stored rather than derived
  and no path in this change rewrites it
