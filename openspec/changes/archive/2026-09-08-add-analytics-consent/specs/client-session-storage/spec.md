# client-session-storage (delta)

## ADDED Requirements

### Requirement: An analytics identity SHALL NOT outlive the session that created it

Sign-out already destroys every local trace of the rider — the query cache, the guard cache, the
session store and the cached rider location all clear. An analytics SDK holds a **fifth** trace and
it is the one nobody thinks of: a distinct id, an opted-in posture, and in PostHog's case an active
session recording.

On sign-out the analytics client SHALL reset its identity and return to the capture-off posture, in
the same path as the other four. On sign-in it SHALL start capture-off again and re-read the
preference for the rider who just arrived, rather than inheriting whatever the previous rider left.

**The failure this prevents is a shared device**, which is not hypothetical for a pilot: rider A
opts out and signs out, rider B signs in on the same phone. Without a reset, B's screen is recorded
against A's distinct id if A was capturing, or B is silently under-captured if A was not. The
second is merely wrong; the first records a rider who never had a chance to say no, under somebody
else's name.

**The two directions fail differently and both are covered on purpose.** Reset-on-sign-out alone
leaves the sign-in path trusting whatever the SDK persisted client-side, which a fresh install does
not have and a shared device has wrongly.

#### Scenario: Sign-out clears the analytics identity
- **WHEN** a rider signs out
- **THEN** the analytics client SHALL reset — dropping the distinct id and any in-flight recording —
  and SHALL stop capturing
- **AND** this SHALL happen in the same place as `clearQueryCache`, `clearGuardCache`,
  `clearSessionStore` and `clearRiderLocation`, so a future sign-out path cannot forget one of five
  while remembering four

#### Scenario: A second rider on one device inherits nothing
- **GIVEN** rider A signed out on a device where analytics was capturing
- **WHEN** rider B signs in on the same device
- **THEN** the client SHALL be capture-off until B's own `my_analytics_opt_out()` returns NULL
- **AND** no event attributed to B SHALL carry A's distinct id

#### Scenario: The reset is asserted where it can actually be seen
- **WHEN** this requirement is tested
- **THEN** it SHALL be asserted in Vitest against the analytics seam — sign-out calls reset, and a
  `capture` after it is a no-op — because `npm run walk` runs against DEV, DEV has no PostHog key,
  and a walk assertion that "nothing was left behind" would pass on a device where nothing could
  ever have been written
- **AND** the walk's existing sign-out phase SHALL NOT be extended with an assertion that is
  vacuous by construction, which is the trap a flag defaulting off already set once
