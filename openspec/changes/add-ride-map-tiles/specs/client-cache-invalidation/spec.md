> **This delta MODIFIES nothing, deliberately.** `Stale data SHALL be bounded and visible` and
> `Counts SHALL stay per-viewer and SHALL NOT be cached across viewers` are both already contested
> between the active `add-account-deletion` change and the archived `add-ride-chat`, and a third
> change joining that fight buys a merge conflict and no clarity. The rule below is additive and
> belongs beside the other cache-lifetime rules rather than inside one of them — the same call
> `add-ride-chat` made when it put its sign-out rule in `realtime-subscriptions`.

## ADDED Requirements

### Requirement: A cache entry holding a signed URL SHALL NOT outlive the signature

Where a cached value contains a signed Storage URL, the entry SHALL be treated as expiring when the
signature does. A stale signature SHALL produce a re-mint, never a rendered broken image and never
a silent blank.

**A signed URL is the one cached value in this app that stops working on a clock rather than on an
event.** Every other staleness rule here is about a *write* somewhere making a cached read wrong,
and the fix is invalidation on that write. Nothing writes when a signature expires. A cache tuned
only for the write case holds a dead URL indefinitely, and the symptom is an image that vanishes
from a screen nobody touched.

#### Scenario: An expired signature re-mints rather than renders
- **WHEN** a cached value's signed URL has passed its expiry
- **THEN** the URL SHALL be re-minted under the current session before use
- **AND** the screen SHALL NOT render a broken image, an empty container where an image was, or a
  retry the rider has to press

#### Scenario: The signature's lifetime bounds the entry, not the other way round
- **WHEN** a cache entry's lifetime and a signature's lifetime disagree
- **THEN** the shorter one SHALL govern
- **AND** an entry SHALL NOT be extended by a refetch that reuses the URL it already held

#### Scenario: A signed URL is never cached across riders
- **WHEN** a value containing a signed URL is cached
- **THEN** its key SHALL be scoped to the signed-in rider
- **AND** it SHALL NOT survive a sign-out, because the URL keeps working after the session that
  minted it is gone

#### Scenario: Expiry is not revocation, and the cache does not pretend otherwise
- **WHEN** a rider loses access to the row an object hangs off
- **THEN** invalidating the cache entry SHALL NOT be treated as having revoked their access
- **AND** the outstanding URL SHALL be understood to work until it expires, which is a property of
  Storage that no cache rule can change

#### Scenario: A missing derivative is a normal cached value, not a cache miss
- **WHEN** a cached row carries a NULL object path — no tile was ever rendered for it
- **THEN** that NULL SHALL be cached as the answer it is
- **AND** it SHALL NOT trigger a refetch on every render, because "no tile" is the steady state of
  most rows rather than a gap waiting to be filled
