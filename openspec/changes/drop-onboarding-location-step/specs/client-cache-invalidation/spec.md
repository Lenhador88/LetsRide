<!--
COORDINATION — no other active change claims the requirement below.

Five active changes carry a `client-cache-invalidation` delta (`add-account-deletion`,
`add-ride-chat-unread`, `add-ride-club-edit-delete`, `add-ride-map-tiles`,
`inline-place-search-with-recent-starts`, `replace-places-index-with-geocoder`), and every one of
them is about the **query** cache in `src/lib/query/`. This one is about the **guard** cache in
`src/lib/auth/guard-cache.ts`, which is a different cache with a different writer set and no
`keys.ts` entry. It is ADDED rather than folded into `Every mutation SHALL declare what it
invalidates` for that reason.

Re-derive before archiving:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive
-->

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
