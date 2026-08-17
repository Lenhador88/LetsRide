> **This delta MODIFIES nothing, deliberately.** `Counts SHALL stay per-viewer` and `Stale data
> SHALL be bounded and visible` are both already contested by `add-account-deletion`, and
> `A count and the list it summarises SHALL be invalidated together and read through the same
> predicate` is the requirement this change is an instance of — it needs no edit, because this
> change satisfies it rather than qualifying it. Adding beside them buys no merge conflict and no
> ambiguity about which text archiving folds in. Same call `add-ride-map-tiles` made.
>
> **Compliance with the count-and-list requirement, stated rather than assumed.** The unread key is
> nested *under* the thread's key — `['rides','detail',<id>,'messages','unread']` beneath
> `['rides','detail',<id>,'messages']` — so no call site can invalidate the thread without reaching
> the badge, which is exactly what that requirement's first scenario asks for. And the answer is
> `security invoker`, so it obeys every predicate the thread obeys, which is its second.

## ADDED Requirements

### Requirement: A read-state write SHALL NOT invalidate the content it marks read

Where a mutation records that a rider has *seen* something, it SHALL invalidate the badge derived
from that record and SHALL NOT invalidate the content the badge summarises.

**This is the one invalidation in the app that must be asymmetric, and getting it symmetric is
expensive rather than merely wasteful.** Existing rules push in one direction — over-invalidating is
the safe direction, because a refetch is cheaper than a correctness bug — and a read-state write is
where that stops being true. The write fires while the rider is looking at the content: `015`
already found this twice and narrowed both call sites for it, recording that refetching `/postcards`
on `markFeedSeen` would *"replace the cards under a rider looking at the exhausted state"*.

A live thread makes it worse than wasteful. The mark advances on every arriving message, so a
symmetric invalidation turns each delivered message into a refetch that marks it read that triggers
another refetch — one extra round trip per message on the screen the rider is actively reading, for
data that just arrived.

The direction that must hold is the other one: a write that produces new content SHALL reach the
badge, and it SHALL do so through the key structure rather than through a second key named at the
call site.

#### Scenario: Marking seen refetches the badge only
- **WHEN** a rider's read-state watermark is written
- **THEN** only the key holding the derived unread answer SHALL be invalidated
- **AND** the list, thread or feed that the watermark refers to SHALL NOT be invalidated

#### Scenario: A new message reaches the badge without the call site naming it
- **WHEN** content is written into a surface that carries a read watermark
- **THEN** the badge's cached answer SHALL be invalidated
- **AND** the widening SHALL be expressed in `src/lib/query/keys.ts` by nesting the badge's key
  under the content's key, never by adding a second `invalidate` argument at the call site

#### Scenario: The asymmetry is recorded where the narrow claim is made
- **WHEN** an invalidation is deliberately narrower than the prefix above it
- **THEN** the reason SHALL be recorded at that call site
- **AND** it SHALL NOT be readable as an oversight, because every other narrow claim in this app is
  one that widened from a `revalidatePath`

### Requirement: A badge SHALL NOT be cached across riders, and its key SHALL be scoped to the resource it decorates

An unread answer SHALL be cached per rider and per resource, and SHALL NOT survive a sign-out.

The existing per-viewer rule already covers `club_unread_counts()` and the notification count. This
adds the case those two do not have: an answer that is **per rider and per ride at once**, computed
through a policy carrying a symmetric block arm, so two crew members on the same ride at the same
moment can hold different correct answers about the same thread.

#### Scenario: Two crew members hold different answers about the same thread
- **WHEN** one crew member has blocked another and that other rider posts
- **THEN** the blocker's cached answer SHALL be `false` while another crew member's is `true`
- **AND** neither SHALL be treated as authoritative about the ride, matching the rule already stated
  for the chat's crew count

#### Scenario: Sign-out destroys it
- **WHEN** a rider signs out
- **THEN** `clearQueryCache()` SHALL be what removes the cached answer, rather than a per-key expiry
- **AND** no unread answer SHALL be reused across a sign-out and sign-in on a shared device
