## ADDED Requirements

### Requirement: `public.notifications` SHALL hold only messages that have an actor, one subject of each kind, and a trigger behind them — anything else SHALL be a different table

`public.notifications` SHALL NOT gain a type that satisfies any of the following, and a message
with any of these properties SHALL be modelled in its own table rather than accommodated here:

1. **No actor.** `actor_id` is `NOT NULL`, and the SELECT policy's actor conjunct —
   `exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)` — is
   **unconditional**, carrying none of the `is null or` escapes the four subject conjuncts carry.
   So an authorless row is not merely awkward: it would be **written, never returned and never
   counted, silently, for ever**, which this capability elsewhere calls a defect in the fan-out
   rather than a row awaiting a policy change.
2. **More than one instance of a subject.** The subject is four nullable single-value columns
   plus `thread_id`, pinned by `notifications_subject_shape` whose `else` arm is `false`. A
   message naming *many* rides or *many* clubs cannot be expressed, and `036`'s own reason for
   the per-column form is that the policy and the shape "cannot drift apart" — a list-valued
   subject is exactly that drift.
3. **No parent row to trigger on.** Every type here is written by an `AFTER INSERT` or
   `AFTER DELETE` trigger. A message occasioned by the passage of time has nothing to fire on.

**Relaxing the actor conjunct SHALL NOT be the repair.** The conjunct is load-bearing for every
other type: every row's copy begins with the actor's username, and the NULL-username state is
reachable by any rider in one request. `089` met the analogous problem for a recipient who cannot
read the club they were declined from and fixed it with a **type-scoped arm**, not by relaxing a
conjunct — and a second type-scoped arm would push the policy toward the type dispatch that
`121 §6`'s header calls, in as many words, *"a live leak"*.

**The cost of the separate table SHALL be paid in the outbox rather than in the policy.**
`public.push_deliveries` may grow a second, mutually exclusive subject arm and `claim_push_batch`
a second source; `notifications`, its two CHECK constraints, its SELECT and UPDATE policies and
`push_payload_for`'s per-type CASE SHALL all be left exactly as they are.

#### Scenario: A change proposing an authorless notification type is refused
- **WHEN** a change proposes a `notifications` type whose rows would carry no actor
- **THEN** it SHALL be modelled as its own table
- **AND** the refusal SHALL be checkable rather than argued: `actor_id` is `NOT NULL` and the
  actor conjunct carries no `is null or` escape, both readable from the live catalogue

#### Scenario: The weekly digest does not touch this table
- **WHEN** the weekly digest migration is applied
- **THEN** `notifications_type_check` and `notifications_subject_shape` SHALL be textually
  unchanged, and the SELECT policy's qual SHALL be textually unchanged
- **AND** the assertion SHALL compare the constraint definitions and the policy qual before and
  after, rather than counting types

#### Scenario: `push_payload_for` gains no arm
- **WHEN** the weekly digest's delivery path is built
- **THEN** `public.push_payload_for`'s per-type CASE SHALL gain no `when` branch
- **AND** its `else … raise` arm and the `notifications_type_check` pin behind it in
  `rls_test.sql §121.6` SHALL be untouched, because the two are one mechanism

#### Scenario: A separate table inherits every rule of this one that still applies
- **WHEN** a message is moved out into its own table
- **THEN** it SHALL still be readable by its recipient alone, still carry no denormalised text,
  still grant `authenticated` no INSERT and no DELETE, still confine UPDATE to `read_at` under a
  predicate identical to SELECT's, and still die with its recipient by cascade
- **AND** being a different table SHALL NOT be read as an exemption from any of them
