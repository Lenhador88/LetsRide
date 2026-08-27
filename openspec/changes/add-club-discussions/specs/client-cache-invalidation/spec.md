## ADDED Requirements

### Requirement: A key outside its domain's detail prefix SHALL be named at every call site that must move it, and its reach SHALL be documented in `keys.ts`

Where a screen is reached by an id that is not its domain's own root id — a discussion opened by
its discussion id, with no club id available until the read resolves — its cache key SHALL NOT be
nested under that domain's **detail** prefix, and no mutation SHALL rely on a `detail`-scoped
invalidation to reach it.

**The domain-wide prefix still reaches it, and a spec claiming otherwise would be wrong.**
`invalidate` matches structurally on prefix — `keyStartsWith` in `src/lib/query/queryClient.ts`
compares element by element — so `['clubs']` reaches `['clubs','discussions',<id>,'messages']` just
as it reaches every other key under the domain. The true statement is narrower and is the one that
matters at the call site: the key is not under `['clubs','detail',<clubId>]`, so the club-scoped
invalidations that a thread mutation would naturally reach for do **not** move it, while the
domain-wide `clubs.all()` does.

That asymmetry SHALL be recorded in `keys.ts` as *which prefixes reach it*, stated positively, and
SHALL NOT be recorded as "no prefix reaches it" — `keys.ts`'s header is treated as authoritative by
every later reader, so a false claim there is worse than no claim.

#### Scenario: The thread key is named, not inherited
- **WHEN** a message is sent into a club discussion
- **THEN** the action SHALL invalidate the thread's own key explicitly
- **AND** it SHALL NOT rely on a club-scoped `['clubs','detail',<clubId>]` invalidation, which does
  not reach it
- **AND** it SHALL NOT rely on the domain-wide `clubs.all()` either — which *would* reach it —
  because that refetches every club screen in the cache on every send

#### Scenario: A mutation that moves two unconnected keys names both
- **WHEN** a thread is deleted
- **THEN** the action SHALL invalidate both the club's Discussions list key and the thread's own
  message key
- **AND** the club id needed for the first SHALL be carried by the action rather than re-read after
  the row is gone

#### Scenario: The reach is written down where the keys are, positively
- **WHEN** a key is added that sits outside its domain's detail prefix
- **THEN** `keys.ts` SHALL record **which prefixes reach it and which do not**, in the same table
  that reconciles the retired `revalidatePath` claims
- **AND** the record SHALL be verified against `keyStartsWith` rather than assumed from the key's
  shape, because prefix matching is structural and an eyeballed answer is how a false claim enters
  the contract
- **AND** the key SHALL NOT be renested under `detail` to hide the asymmetry, because the screen
  does not hold the club id at read time

### Requirement: An unread mark and the list it annotates SHALL be read under one predicate and invalidated together

Where a list is drawn with a per-row unread mark computed by a separate call, both SHALL be
computed under the caller's own row security through the same visibility predicate, and the mark's
key SHALL be nested under the list's key so that invalidating the list reaches the mark.

The nesting SHALL be one-directional on purpose: invalidating the list reaches the mark, because
anything that changes the list can change the mark; invalidating the mark SHALL NOT reach the list,
because a watermark advancing changes no row.

#### Scenario: A new thread moves both
- **WHEN** the Discussions list key is invalidated
- **THEN** the per-thread unread key SHALL be invalidated with it

#### Scenario: Marking a thread read does not refetch the list
- **WHEN** the watermark advances for one thread
- **THEN** the unread key alone SHALL be invalidated
- **AND** the list SHALL NOT be refetched, because no thread appeared, vanished or moved

#### Scenario: The mark obeys the same block rule as the list
- **WHEN** a rider has blocked the author of a thread's most recent message
- **THEN** the mark SHALL be computed by a `security invoker` reader so the same SELECT policy
  decides both
- **AND** no block filter SHALL be applied a second time in the data layer or the component
