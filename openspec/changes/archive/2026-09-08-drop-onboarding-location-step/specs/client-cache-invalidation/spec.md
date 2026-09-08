<!--
COORDINATION — no other active change claims the requirement below.

Five active changes carry a `client-cache-invalidation` delta (`add-account-deletion`,
`add-ride-chat-unread`, `add-ride-club-edit-delete`, `add-ride-map-tiles`,
`inline-place-search-with-recent-starts`, `replace-places-index-with-geocoder`), and every one of
them is about the **query** cache in `src/lib/query/`. This one is about the **guard** cache in
`src/lib/auth/guard-cache.ts`, which is a different cache with a different writer set and no
`keys.ts` entry. It is ADDED rather than folded into `Every mutation SHALL declare what it
invalidates` for that reason.

**This delta also carries one MODIFIED requirement**, `Redirect-after-write SHALL survive the loss
of server redirects`, whose `Onboarding still advances one step at a time` scenario asserts a
location step that stops existing. No other active change claims it — re-derive with the command
below — so archiving replaces it with no race. It is here rather than in `client-render-shell`
because that is where it lives in the standing spec.

Re-derive before archiving:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive
-->

## MODIFIED Requirements

### Requirement: Redirect-after-write SHALL survive the loss of server redirects

A successful create SHALL navigate the rider to the created resource or the list containing it,
and MUST NOT leave the form indistinguishable from never having been submitted.

Twelve action call sites end in `redirect()` from `next/navigation` — signup, both onboarding
steps, password update, sign-out, club creation, ride creation, postcard creation. A client
mutation cannot redirect from the server, and the redirect is load-bearing in at least two
places: it is what makes "posted" distinguishable from "not submitted yet" when both states
are `{ error: null }`.

**The onboarding half of that list is one step shorter since PD-286**, and the scenario below is
rewritten rather than dropped. `setUsername` no longer hands off to a second wizard screen: it is
the terminal step, so its redirect is `/postcards` and the property worth asserting moves with it.
What has to survive is the *reason* the scenario existed — a wizard step whose success is
indistinguishable from its initial state strands the rider on it — not the number of steps.

#### Scenario: Success is distinguishable from the initial state
- **WHEN** a create action succeeds
- **THEN** the rider SHALL be navigated to the created resource or the list that now contains it
- **AND** the form SHALL NOT be left in a state indistinguishable from never having been
  submitted

#### Scenario: Onboarding still advances one step at a time
- **WHEN** the username step succeeds
- **THEN** the rider SHALL land on `/postcards`, because it is the last step of the wizard and
  commits `onboarding_completed_at` itself
- **AND** the rider SHALL NOT reach any app route before the username is set, which the route
  guard enforces as a redirect and `023`'s participation gate enforces as a refusal
- **AND** the redirect SHALL name a destination rather than a wizard step, leaving the guard to
  resolve where a rider actually belongs — the shape `acceptTerms` already uses

## ADDED Requirements

### Requirement: The guard cache SHALL be invalidated by whichever write is last, and the writer count SHALL be a measurement rather than a sentence

Every action that writes a stamp `resolveDestination` reads SHALL call
`invalidateOnboardingState()`, and when a step is removed the **surviving** last writer SHALL carry
the call. The number of such writers SHALL be verified by counting call sites, never by trusting
prose — including the prose in `CLAUDE.md`.

`guard-cache.ts` holds the session and both onboarding stamps for the page load rather than
re-reading them per navigation, which is what removed a round trip to `eu-west-1` from behind a
full-screen splash on every tab tap. The cost of that is a hard rule: *miss one and the rider
finishes a step and is sent straight back into it.* Today there are four writers — `signUp`,
`setUsername`, `acceptTerms`, `setLocation` — and this change deletes the one that is **last**,
which is the only position where a missed call is guaranteed to strand somebody rather than merely
risk it.

Three writers survive, and `setUsername` inherits the terminal position. It SHALL invalidate
**once, after both of its writes**, not between them: an invalidation issued after the username
UPDATE and before `complete_onboarding` re-populates the cache with a stamp that is about to change,
which is the same staleness the call exists to prevent, arriving one round trip earlier.

**The count is load-bearing outside the code.** `scripts/docs/registry.mjs`'s
`guard-cache-invalidators` claim greps the call sites and compares them against a number written in
`CLAUDE.md` §Critical: the route guard. Deleting `setLocation` without editing that sentence turns a
correct change into a failed `docs:check` — which is the check working, and is a task rather than a
surprise. Its own registry comment states the asymmetry to respect: it *"counts calls, not
writers"*, so it catches a deleted call and cannot catch a fifth writer added without one.

#### Scenario: The terminal step invalidates after its last write
- **WHEN** the username step writes the username and then commits the completion stamp
- **THEN** `invalidateOnboardingState()` SHALL be called once, after both writes have succeeded
- **AND** the rider SHALL land on `/postcards` without the guard bouncing them back into the wizard

#### Scenario: A partial failure leaves the cache no worse than the truth
- **WHEN** the username write succeeds and the completion call then fails
- **THEN** the cached state MAY still say "no username", and the guard's answer — the username
  step — SHALL be correct either way
- **AND** no code path SHALL cache a completion stamp that was never written

#### Scenario: The writer count is re-measured, not edited from memory
- **WHEN** an onboarding action is added or removed
- **THEN** the number in `CLAUDE.md` SHALL be re-derived with the registry's own command rather
  than adjusted by hand
- **AND** `npm run docs:check` SHALL pass before the change merges, because this claim's `kind` is
  a shell grep and therefore runs in CI's cheap set

#### Scenario: Sign-out still clears the whole cache
- **WHEN** a rider signs out
- **THEN** `clearGuardCache()` SHALL run, unchanged by this change
- **AND** the session half SHALL continue to have `onAuthStateChange` as its single writer
