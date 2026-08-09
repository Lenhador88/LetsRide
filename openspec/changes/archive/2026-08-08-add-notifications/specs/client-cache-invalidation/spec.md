<!--
⚠ COORDINATION — READ BEFORE ARCHIVING THIS CHANGE.

**`add-account-deletion` carries a `## MODIFIED` block against `Counts SHALL stay per-viewer and
SHALL NOT be cached across viewers` — the SAME requirement this file modifies.** That is the
collision, and it is a direct one: archiving folds a delta in by replacing the requirement
**WHOLESALE**, so whichever of the two archives last silently discards the other's edit, and
OpenSpec will not warn you. Verified 2026-08-07: the three `### Requirement:` header lines — the
standing one, `add-account-deletion`'s and this one — are byte-for-byte identical
(`md5` `43bc3f4e404c4955e3297746090c6c1b` on each).

An earlier revision of this note pointed at `add-ride-chat` instead, whose delta in this file is
against a **sibling** requirement (`Stale data SHALL be bounded and visible`). A sibling is not a
collision — two changes editing two different requirements in one file merge cleanly. Naming the
sibling and not the direct claimant described the harmless case and hid the real one.

Claimant counts, re-derived rather than recalled — `grep -rn "^### Requirement: <text>" openspec/`,
counting **unarchived** changes only, because the archived `2026-08-06-migrate-to-client-rendered-shell`
is where these requirements came FROM and is already folded into `openspec/specs/`:

| Requirement | Unarchived claimants |
|---|---|
| `Counts SHALL stay per-viewer …` | **2** — `add-account-deletion`, `add-notifications` |
| `Stale data SHALL be bounded and visible` | 2 — `add-ride-chat`, `add-account-deletion` |
| `Club membership role SHALL NOT be self-assignable` | 2 — `enforce-creator-membership`, `add-account-deletion` |
| `Onboarding completion SHALL gate participation …` | **3** — `add-account-deletion`, `add-ride-chat`, `add-notifications` |

So exactly **one** requirement in this repo has three claimants and it is the onboarding one, in
the other delta file. This one has two.

**Before archiving: re-read `openspec/specs/client-cache-invalidation/spec.md` as the previous
archive actually left it, and rewrite the MODIFIED block below against THAT text** rather than
against the version transcribed here on 2026-08-07.

The merged text this delta should converge on: the standing requirement's three original
scenarios, **plus `add-account-deletion`'s widened opening sentence and its three added scenarios**,
plus the fourth scenario added below naming the second unread count. Every edit on both sides is
additive in substance — neither contradicts the original or the other — so the correct merge keeps
all of them. A merge that keeps only one change's scenarios is the failure this note exists to
prevent.
-->

## MODIFIED Requirements

### Requirement: Counts SHALL stay per-viewer and SHALL NOT be cached across viewers

Every cache key SHALL be scoped to the signed-in rider, and no cached value MUST survive a
sign-out.

Likes and comments deliberately carry no denormalised count, because the correct count is
per-viewer: blocks and hides change it. A shared cache keyed only by postcard id would leak one
viewer's count to another.

**There are two unread counts now, not one, and the second is read on every tab-root screen.**
`club_unread_counts()` is read on one screen; the notification badge is read on four, which makes
the per-rider scoping rule load-bearing in a place the original scenario did not contemplate — a
count leaked across a sign-out would follow the next rider onto the first screen they open rather
than onto one they might never visit.

#### Scenario: Cache keys include the viewer
- **WHEN** any list, count or roster is cached
- **THEN** the key SHALL be scoped to the signed-in rider
- **AND** no cached value SHALL be reused across a sign-out and sign-in

#### Scenario: Blocking removes content already on screen
- **WHEN** a rider blocks another rider from the postcard overflow menu
- **THEN** the blocked rider's postcards, comments, likes and roster rows SHALL disappear from
  every cached view the blocker holds, not only from the next fetch
- **AND** the deck SHALL NOT skip past the card that was open, which is the behaviour the deck
  fix of 2026-08-05 established

#### Scenario: Unread counts follow the same rule
- **WHEN** `club_unread_counts()` is read
- **THEN** its result SHALL be cached per rider only, since the function is `security invoker`
  precisely so blocks and hides apply to it

#### Scenario: The notification badge follows it on four screens rather than one
- **WHEN** the unread notification count is read from any tab-root screen
- **THEN** its result SHALL be cached per rider only, for the same reason and by the same
  mechanism — the count function is `security invoker` so that blocks and subject resolvability
  apply to it
- **AND** `clearQueryCache()` on sign-out SHALL be what enforces it, rather than a per-key
  expiry, because a shared device is the case this protects and an expiry is a race

## ADDED Requirements

### Requirement: A count and the list it summarises SHALL be invalidated together and read through the same predicate

Where a screen shows both a count and the list it counts, the two SHALL share a cache key prefix
so that no invalidation can reach one without the other, and both SHALL be produced by reads
subject to the same row security.

**A badge that disagrees with its list is a defect the rider cannot clear and cannot report
usefully.** It has two independent causes and this repo has the ingredients for both: a
`security definer` count reads past predicates the list obeys, and two cache keys under different
prefixes drift the moment one action invalidates only the cheaper one. `club_unread_counts()`
already avoids the first by being `security invoker`; nothing yet states it as a rule.

#### Scenario: One invalidation reaches both
- **WHEN** anything invalidates a count
- **THEN** the list it summarises SHALL be invalidated in the same call, by prefix
- **AND** a call site SHALL NOT be able to name one without the other

#### Scenario: A definer-rights count is refused as a mechanism
- **WHEN** a count is implemented
- **THEN** it SHALL NOT bypass any predicate the corresponding list obeys
- **AND** `security definer` SHALL NOT be used to make a count cheaper, because the saving is a
  badge that never clears on a screen that is empty

#### Scenario: The rider never sees a nonzero badge over an empty list
- **WHEN** the count and the list are both fresh
- **THEN** a nonzero count SHALL imply at least one row in the list
- **AND** the reverse SHALL hold for zero

#### Scenario: Agreement is a property of the predicate, not of a filter the renderer applies
- **WHEN** a row is counted but cannot be rendered — its actor or its subject does not resolve for
  the reader
- **THEN** the repair SHALL be to add the missing conjunct to the **predicate both reads share**, so
  the row is in neither
- **AND** dropping it in the component SHALL NOT be the repair, because that produces a nonzero
  count over a shorter list, which is precisely what this requirement forbids
- **AND** "render nothing for that row" SHALL be recognised as the same defect written as an
  instruction: a list of ten that draws nine is a list of nine with a wrong badge

#### Scenario: A failed count shows nothing rather than a stale value
- **WHEN** a count read fails
- **THEN** the badge SHALL be absent
- **AND** it SHALL NOT render the last successful value, because a dot the rider cannot clear by
  visiting the screen is worse than a missing one

### Requirement: A cached row whose subject the reader may no longer see SHALL be evicted by the database, not by the component that renders it

Where a cached list holds rows that point at another resource, the decision to drop a row whose
target has become invisible SHALL be made by the query, and no component SHALL filter a list for
visibility.

Decision #2 already forbids client-side block filtering. This extends the same rule to the wider
case that notifications introduce: a row can become unrenderable because the *reader's own*
relationship to the subject changed — they left a club, a club turned private — with no block
anywhere. A component filtering that case would make the count and the list disagree by
construction, and would put a visibility rule in the one place this project has decided it must
never live.

#### Scenario: The query decides, not the renderer
- **WHEN** a list contains a row whose subject the reader can no longer read
- **THEN** the row SHALL be absent from the query result
- **AND** no component, data function or action SHALL drop it after the fact

#### Scenario: An eviction is not a deletion
- **WHEN** a row stops being returned because the reader's relationship to its subject changed
- **THEN** the underlying row SHALL survive
- **AND** it SHALL be returned again if that relationship is restored, with its original ordering
  and read state

#### Scenario: A membership change invalidates everything that could depend on it
- **WHEN** a rider joins or leaves a club
- **THEN** every cached list whose contents can be gated by that membership SHALL be invalidated,
  not only the club's own screens
- **AND** over-invalidating SHALL be the chosen direction, matching the existing rule that a
  refetch is cheaper than a correctness bug
