<!--
COORDINATION — checked 2026-09-07:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

`Every mutation SHALL declare what it invalidates` is claimed by `deliver-push-notifications` and
`share-a-ride-invite-link`; `The guard cache SHALL be invalidated by whichever write is last, and
the writer count SHALL be a measurement rather than a sentence` is ADDED by the still-active
`drop-onboarding-location-step` and is therefore NOT yet in the standing spec — a MODIFIED against
it would be a delta against something that does not exist.

So the requirement below is ADDED and states the property that change could not: what happens when
the terminal step MOVES. If `drop-onboarding-location-step` archives first, the two sit beside each
other and neither contradicts the other; whoever archives second should confirm that rather than
assume it.
-->

## ADDED Requirements

### Requirement: Moving the terminal onboarding step SHALL move the invalidation obligation with it

Every write that changes a value `resolveDestination` reads SHALL call
`invalidateOnboardingState()`, and when the wizard gains or loses a step the obligation SHALL be
re-derived rather than inherited.

`CLAUDE.md` states the standing half — *"any new writer of a stamp the decision reads must
invalidate the cache"* — and `src/lib/actions/__tests__/writers-invalidate.test.ts` refuses a new
stamp writer that does not. What that rule cannot catch on its own is a writer that stops being
terminal: `setUsername` currently writes the username *and* commits the completion stamp, and after
this change it writes only the username. It still owes an invalidation, for a different reason than
before — `has_username` is now a value the resume branch reads — and losing sight of that is how a
rider finishes a step and is sent straight back into it.

**The home country is deliberately not a stamp the decision reads**, so nothing about it enters the
guard cache; the new action's obligation comes entirely from the completion stamp it writes.

#### Scenario: The new terminal writer invalidates
- **WHEN** the country step's action completes onboarding
- **THEN** it SHALL call `invalidateOnboardingState()` after the RPC succeeds, and `writers-invalidate.test.ts`
  SHALL refuse it if it does not
- **AND** the rider SHALL be routed by the guard on the next decision rather than by a cached
  answer that still says *"not complete"*

#### Scenario: The former terminal writer keeps its invalidation
- **WHEN** `setUsername` stops calling `complete_onboarding`
- **THEN** it SHALL keep `invalidateOnboardingState()`, because `has_username` is what moves the
  resume step from `/onboarding/username` to `/onboarding/country`
- **AND** removing it as *"no longer the last write"* SHALL be treated as the defect it is: the
  rider would submit a username and be returned to the username screen

#### Scenario: The guard cache gains no new field
- **WHEN** this change is implemented
- **THEN** `OnboardingState`, `GuardSnapshot`, `GuardState` and `my_onboarding_state()` SHALL each
  keep their current shape
- **AND** the generation counter, the `retry`/`superseded` outcomes and the by-value session check
  SHALL be untouched, because nothing here introduces a write that races a read already in flight —
  the country write is a rider-initiated submit, not a signup-time write behind an in-flight boot
  read

#### Scenario: An invalidation is necessary and not sufficient
- **WHEN** any future writer of an onboarding value is added
- **THEN** it SHALL invalidate, **and** the generation counter SHALL remain the thing that protects
  a read which left before the write landed — the two SHALL NOT be treated as alternatives

#### Scenario: The query cache is not involved
- **WHEN** the country is written
- **THEN** no `keys.ts` entry SHALL be added for it and no `invalidate()` call SHALL be made
  against the query cache during onboarding, because no screen reads it yet
- **AND** the profile editor's own write SHALL invalidate whatever key already covers the profile
  row it edits, rather than introducing a second key for one column
