# client-cache-invalidation (delta)

> **ADDS one requirement, MODIFIES none.** No existing requirement's text is touched, so this
> delta collides with no other active change at archive time.

## ADDED Requirements

### Requirement: A new read key SHALL be placed under a prefix its writers already invalidate

A cache key earns its place by the prefix that sweeps it. Where an existing action already
invalidates a prefix that covers a new key, the key SHALL be placed under that prefix and the
action SHALL NOT gain a new `invalidate` call — an added call site that a prefix already reaches
is dead code, which is the reasoning `keys.ts` records for `postcards.journal`.

Where no existing prefix covers it, the writer SHALL be given the invalidation explicitly, and
the reason SHALL be recorded beside the key.

#### Scenario: The hidden-postcards key needs no new invalidation
- **WHEN** the hidden-postcards list is added
- **THEN** its key SHALL sit under the `postcards` prefix
- **AND** `hidePostcard` and `unhidePostcard` SHALL be unchanged, because both already call
  `invalidate(queryKeys.postcards.all())` and `invalidate` matches structurally by prefix
- **AND** hiding a postcard SHALL add it to the list without a manual refresh, which is the case
  a key placed outside that prefix would silently miss

#### Scenario: The blocked-riders key is already swept
- **WHEN** a rider blocks or unblocks someone
- **THEN** `blockRider` and `unblockRider` SHALL remain unchanged, because both invalidate
  `EVERYTHING` — the empty prefix, which reaches every key by construction
- **AND** the list SHALL reflect the change without a navigation
- **AND** the key SHALL additionally be swept by `updateProfile`'s existing `profile.all()`,
  which costs one re-read of a short list and cannot make it stale

#### Scenario: Neither key survives a sign-out
- **WHEN** a rider signs out
- **THEN** `clearQueryCache()` SHALL discard both, as it does every key
- **AND** neither list SHALL be visible to the next rider who signs in on the same device
- **AND** both keys hold own-row data only, so no value in either is shared across viewers
