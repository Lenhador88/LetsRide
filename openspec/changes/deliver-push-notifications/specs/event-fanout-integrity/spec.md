## MODIFIED Requirements

### Requirement: A fan-out failure SHALL NOT be silently swallowed

A fan-out that raises SHALL abort the transaction containing it, rather than being caught and
discarded.

A swallowed exception produces a fan-out gap with **nothing to detect it**: the rider's write
succeeds, no error is logged anywhere a session can read, and the missing notification is
indistinguishable from an event that did not happen. The failure modes here are deterministic — a
constraint the fan-out itself violates, or a bug — rather than transient, so retrying buys nothing
and hiding costs everything.

The cost is stated rather than hidden: **from the moment `036` applies, a bug in a fan-out takes
down likes, comments, RSVPs, ride creation and club joining simultaneously**, because each runs
inside the rider's own transaction. That is why this is the first migration in this repo that is
additive in schema and not inert, and why it goes to DEV and is exercised before PROD.

**This rule ends at the notification row, and stating it without that boundary is how an outbound
call ends up inside a rider's like.** Delivery to a device is a different kind of work with the
opposite failure requirement: its failures are transient by nature — a provider outage, a rate
limit, a dead network — and none of them may be allowed to fail the write that produced the
notification. So the rule splits:

- **Everything that decides *whether a notification exists*** — the recipient set, the block
  check, the resolvability conjuncts, the row insert, and the enqueue of a delivery attempt —
  raises, and takes the transaction with it.
- **Everything that *sends*** — a provider call, its retries, its classification, its token
  bookkeeping — SHALL happen outside that transaction, on a schedule, and SHALL NOT be able to
  reach it.

**The enqueue belongs to the first half and not the second, which is the whole reason it is a
local insert.** An asynchronous HTTP trigger looks like it belongs to the second half and does
not: it fires inside the transaction, cannot raise, and therefore puts its failures somewhere
nothing in this repo reads — which is a swallowed fan-out failure wearing the shape of an
improvement.

#### Scenario: A fan-out error is visible
- **WHEN** a fan-out raises
- **THEN** the parent write SHALL fail with it
- **AND** the failure SHALL NOT be caught by an `exception when others then null` block

#### Scenario: The uniqueness collapse is not an error
- **WHEN** the uniqueness constraint absorbs a repeat
- **THEN** that SHALL be expressed as a conflict clause rather than as a caught exception, so that
  the one expected collision is handled without a handler that would also hide a real fault

#### Scenario: The blast radius is stated before the migration is applied
- **WHEN** `036` is applied
- **THEN** the five affected write paths SHALL be exercised on DEV before PROD
- **AND** the migration header SHALL name them, because a purely-additive reading of this migration
  is wrong and is the reading a reviewer will default to

#### Scenario: A dead provider does not fail a rider's write
- **WHEN** APNs or FCM is unreachable, rate-limiting, or returning errors
- **THEN** every like, comment, RSVP, ride creation and club join SHALL still succeed
- **AND** the notification rows SHALL still be written
- **AND** the delivery attempts SHALL fail where they are performed, on the schedule, and be
  retryable there

#### Scenario: No outbound call is attached to the fan-out tables
- **WHEN** the delivery mechanism is chosen
- **THEN** no trigger on `notifications` or on any of the five fan-out source tables SHALL make an
  HTTP request, by `pg_net`, by a Database Webhook, or by any other route
- **AND** the reason SHALL be recorded at the trigger: the asynchronous form does not raise, so its
  failures land in `net._http_response` where nothing reads them — a swallowed failure by another
  name

#### Scenario: A failed delivery is recorded where something reads it
- **WHEN** a send fails after its bounded retries
- **THEN** the outbox row SHALL be marked failed, with its attempt count
- **AND** "nothing raised" SHALL NOT be accepted as evidence that delivery is working, which is the
  same standard this requirement already applies to fan-out

### Requirement: A fan-out SHALL NOT write a row that the read policy can never return to its recipient

For every type, the recipient set SHALL be a **subset** of the set to which the `notifications`
SELECT policy will return that row. A row that the policy drops on every read from the instant it is
written SHALL be treated as a defect in the fan-out, not as a row awaiting a policy change.

**This is the rule that catches the class of bug, and this change shipped an instance of it in
draft.** The recipient set and the resolvability conjunct are written in different places, by
different reasoning, and a widening on one side is invisible from the other. The failure has no
symptom: nothing raises, no count moves, no assertion fails, and the row accumulates until its
subject is deleted. It is the write-side mirror of the read-side rule that a notification's
correctness at write time says nothing about its correctness at read time.

The mapping SHALL be stated per type and checked whenever **either** side changes:

| Type | Recipient set | The policy arm that returns it |
|---|---|---|
| `postcard_liked` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()` |
| `postcard_commented` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()`, and `postcard_comments` SELECT, which inherits it by `EXISTS` |
| `ride_joined` | `rides.organizer_id` | `rides` SELECT `organizer_id = auth.uid()` |
| `club_joined` | `clubs.owner_id` ∪ `club_members` | `clubs` SELECT `owner_id = auth.uid() OR private.is_club_member(id)` — both arms present, so the union is safe |
| `ride_created_in_club` | `club_members` **only** | `rides` SELECT `club_id IS NOT NULL AND private.is_club_member(club_id)` — **no owner arm**, which is why the union is not safe here — **and** `clubs` SELECT, which the club-member arm satisfies |

**The rule extends one table further down: a derived row of a derived row inherits it.** An outbox
row enqueuing a push for a notification the policy will never return is the same defect, with the
same absent symptom, one level removed — nothing raises, nothing counts, and the row waits to be
claimed by a job that will decline it. Two consequences:

- The enqueue trigger SHALL be unconditional, writing one outbox row per notification, and SHALL
  NOT attempt its own readability check. A second copy of the read decision written at a second
  moment is exactly the drift this requirement exists to prevent.
- The **sender** SHALL perform the check, immediately before sending, against the same conjunct set
  the SELECT policy requires — so there is one check, taken at the latest possible moment, in one
  place.

**That is not a relaxation of the subset rule; it is where the subset rule is evaluated for this
consumer.** A notification's recipient set is fixed at fan-out because the row is durable and
re-checked on every read. A push has exactly one moment of truth, and it is the send.

#### Scenario: Every type's recipient set is checked against its resolving policy arm
- **WHEN** a type is added, or a recipient set or a subject policy is changed
- **THEN** the table above SHALL be re-derived from the live policy text rather than recalled
- **AND** a recipient set that is not a subset of the resolving set SHALL fail review

#### Scenario: A row nobody can ever read is a defect, not a latent feature
- **WHEN** a fan-out would write a row whose recipient the SELECT policy cannot return it to
- **THEN** the row SHALL NOT be written
- **AND** widening the SELECT policy to admit it SHALL NOT be the repair, because that would let a
  notification resolve for a subject whose own screen still refuses the rider — the row would render
  and its destination would not open

#### Scenario: The check is asserted, not only reviewed
- **WHEN** the RLS suite exercises a fan-out
- **THEN** each type SHALL assert that every recipient the fan-out wrote for can **read** the row
  back under their own session
- **AND** an assertion that only counts rows written SHALL NOT be accepted as covering this, because
  the whole failure is a row that exists and is unreadable

#### Scenario: The enqueue does not re-decide readability
- **WHEN** the outbox row is written
- **THEN** it SHALL be written unconditionally for every notification
- **AND** it SHALL NOT carry a copy of the readability answer, because a copy taken at enqueue is
  a second visibility decision that nothing re-checks

#### Scenario: An unsendable outbox row is suppressed rather than retried
- **WHEN** the sender finds the notification no longer resolves for its recipient
- **THEN** the outbox row SHALL be marked suppressed and never retried
- **AND** it SHALL NOT be deleted silently, because the distinction between "sent", "suppressed"
  and "failed" is the only evidence this path produces
