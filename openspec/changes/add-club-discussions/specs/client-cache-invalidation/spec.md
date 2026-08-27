## ADDED Requirements

### Requirement: A key its domain prefix cannot reach SHALL be named at every call site that must move it, and the gap SHALL be documented in `keys.ts`

Where a screen is reached by an id that is not its domain's own root id — a discussion opened by
its discussion id, with no club id available until the read resolves — its cache key cannot be
nested under that domain's detail prefix, and a domain-wide invalidation SHALL NOT be assumed to
reach it.

Every key in `keys.ts` today is reachable from its domain's root: `invalidate(['clubs'])` reaches
every club key and `invalidate(['rides'])` every ride key, which is what lets `rides.unread` sit
under `rides.messages` and move for free. A thread's messages break that, because the screen holds
only the thread's id. The key is still spelled in `keys.ts` — a key written inline in a component is
a bug even when the string is right — but its **reach** is different, and a call site that assumes
otherwise fails silently as a screen that will not refresh.

Every mutation touching such a key SHALL name it explicitly, and `keys.ts` SHALL carry the
exception in its header table beside the reconciliation it already holds, so the next reader learns
it from the contract rather than from a stale screen.

#### Scenario: The thread key is named, not inherited
- **WHEN** a message is sent into a club discussion
- **THEN** the action SHALL invalidate the thread's own key explicitly
- **AND** it SHALL NOT rely on a `clubs` prefix invalidation, which does not reach it

#### Scenario: A mutation that moves two unconnected keys names both
- **WHEN** a thread is deleted
- **THEN** the action SHALL invalidate both the club's Discussions list key and the thread's own
  message key
- **AND** the club id needed for the first SHALL be carried by the action rather than re-read after
  the row is gone

#### Scenario: The exception is written down where the keys are
- **WHEN** a key is added whose domain prefix does not reach it
- **THEN** `keys.ts` SHALL record which prefixes do and do not reach it, in the same table that
  reconciles the retired `revalidatePath` claims
- **AND** the key SHALL NOT be renamed or renested to hide the asymmetry, because the nesting would
  then assert a reach it does not have

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
