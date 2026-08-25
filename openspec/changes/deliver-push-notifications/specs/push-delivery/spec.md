## Purpose

How a `notifications` row becomes a string on a lock screen: what is enqueued, when it is sent,
who decides what the text may say, what happens when a provider refuses a token, and where the
boundary sits between a fan-out failure that must be loud and a push failure that must be silent
to the rider whose write caused it.

## ADDED Requirements

### Requirement: The enqueue SHALL be a trigger and the send SHALL be scheduled, and neither SHALL do the other's job

An `AFTER INSERT` trigger on `public.notifications` SHALL write exactly one `public.push_deliveries`
row. That trigger SHALL make no outbound call of any kind. A scheduled Edge Function SHALL claim
batches from that table and perform every send.

The two halves have opposite failure requirements, which is why one mechanism cannot serve both.
`036` deliberately lets a fan-out failure take the rider's transaction down, because a notification
that silently does not happen is a gap with nothing to detect it. A **push** must never be able to
do that: a rider must be able to like a postcard while APNs is unreachable. And a push must be
re-checked immediately before sending, which a write-time trigger cannot do by construction.

#### Scenario: No network call happens inside a rider's write
- **WHEN** a rider likes, comments, RSVPs, creates a ride or joins a club
- **THEN** the resulting transaction SHALL perform no HTTP request
- **AND** `pg_net`, a Database Webhook or any equivalent SHALL NOT be attached to `notifications`
- **AND** the reason SHALL be recorded at the trigger: the asynchronous variant does not raise,
  which puts the failure in `net._http_response` where nothing in this repo reads it

#### Scenario: The enqueue trigger fires for every writer
- **WHEN** any writer inserts a notification — a client-driven fan-out, a seed, the table owner, or
  a future `security definer` RPC
- **THEN** an outbox row SHALL be written
- **AND** the trigger SHALL carry no `WHEN (CURRENT_USER = …)` clause, and its absence SHALL be
  recorded at the trigger, because an absent guard is indistinguishable from a forgotten one

#### Scenario: The latency this buys is stated, with the case that reopens it
- **WHEN** the schedule interval is chosen
- **THEN** the delay it imposes SHALL be written into the migration header
- **AND** the condition that reopens the decision SHALL be named: a notification whose value
  depends on arriving within seconds — *the group is leaving* — which does not exist yet

#### Scenario: The outbox does not outlive its notification
- **WHEN** a notification row is deleted by any of its six cascades
- **THEN** its outbox row SHALL go with it
- **AND** completed outbox rows SHALL additionally be swept, so the table does not become a
  permanent parallel log of every interaction in the app

### Requirement: A push SHALL carry only what its recipient could have read for themselves at the moment it was sent

Before any send, the delivery path SHALL re-evaluate **every** conjunct the `notifications` SELECT
policy requires, for that recipient: the recipient scope, `private.is_blocked` in both directions,
the actor resolving, and the per-type subject conjuncts — **both** of them for
`ride_created_in_club`. If any conjunct fails, no push SHALL be sent.

This SHALL be implemented as **one** `security definer` function in `public`, granted to
`service_role` by name and revoked from `public`, `anon` and `authenticated`. That function SHALL
be the only place the policy is restated, and its restatement SHALL be pinned textually in
`supabase/tests/rls_test.sql` in the manner `060` pinned `clubs` SELECT.

**A restatement that can go stale is accepted here for the reason `060` accepted it**, and the pin
is what makes it acceptable. Without the pin this is a leak behind a policy set that reads clean.

#### Scenario: Blocking is re-checked at send, in both directions
- **WHEN** a block is created between the fan-out and the send, in either direction
- **THEN** no push SHALL be sent
- **AND** this SHALL be asserted with the two riders exchanged, because the row is directional and
  the effect symmetric

#### Scenario: A rider who left a private club gets no push about it
- **WHEN** a rider holding an unsent `ride_created_in_club` or `club_joined` notification for a
  **private** club leaves that club before the send
- **THEN** no push SHALL be sent

#### Scenario: Both conjuncts are required and ride-implies-club is refused
- **WHEN** a `ride_created_in_club` notification is considered for sending
- **THEN** the ride **and** the club SHALL both resolve for the recipient
- **AND** the leak this closes SHALL be asserted directly: a public club, a ride whose `is_public`
  is false, and a recipient who has left that club
- **AND** the derivation "ride visibility implies club visibility" SHALL NOT be used to collapse
  it, because that is a property of today's `rides` policy and `036` §3 already refuses it

#### Scenario: An unresolvable actor suppresses the push
- **WHEN** the actor's profile does not resolve for the recipient
- **THEN** no push SHALL be sent, for the same reason `036` §3 makes the actor a conjunct on every
  row: the copy begins with their username and a row that renders nothing must not be delivered

#### Scenario: A suppression is final, not a retry
- **WHEN** the re-check refuses a send
- **THEN** the outbox row SHALL be marked suppressed and SHALL NOT be retried
- **AND** the in-app notification SHALL be unaffected, because `036` §3 already decides it on
  every read

#### Scenario: The restatement is pinned
- **WHEN** the `notifications` SELECT policy's qual changes
- **THEN** the RLS suite SHALL fail
- **AND** the pin SHALL be textual, because a behavioural test cannot see a policy that has grown a
  conjunct the payload function does not have

### Requirement: A delivered push SHALL be understood as outside the database's reach, and no retraction SHALL be claimed

Once a push is accepted by APNs or FCM, its text is on a device and no policy change, block,
membership change or deletion removes it. The specification SHALL state this rather than imply a
withdrawal mechanism exists.

#### Scenario: The residue is named
- **WHEN** a rider is blocked, removed from a club, or loses a ride one second after a push was
  delivered
- **THEN** the in-app notification SHALL stop being returned on their next read, per `036` §3
- **AND** the delivered push SHALL remain in their notification centre
- **AND** this asymmetry SHALL be recorded in the migration header and in this spec

#### Scenario: A re-check sweep over delivered pushes is refused
- **WHEN** a mechanism to withdraw delivered pushes is proposed
- **THEN** it SHALL be refused
- **AND** the reason SHALL be that it requires a standing sweep re-evaluating every delivered
  push against every rider's current visibility, which is an unbounded query answering a question
  the device has already shown to somebody

#### Scenario: The lock screen is not treated as a third audience
- **WHEN** a payload names a private club or a private ride the recipient is entitled to see
- **THEN** it SHALL be included
- **AND** the platform's own per-app hide-previews control SHALL be treated as the rider's control
- **AND** no second, in-app preference SHALL be built for it, because this change deliberately has
  no preferences

### Requirement: The delivery function SHALL hold a service-role key and SHALL reach nothing but three named functions

The function SHALL issue no `.from()` against any table. Its entire database reach SHALL be the
batch claim, the payload function and the token-invalidation call, each in `public`, each granted
to `service_role` by name.

`delete-account`'s four rules are ruled on individually rather than inherited:

- **The key lives only in the function's secret store** — APPLIES, and widens to the APNs `.p8`,
  its key id and team id, and the FCM service account. Each SHALL have a detector in
  `src/__tests__/no-service-role-key.test.ts`, and each detector SHALL prove it still matches a
  real key of that format.
- **It takes no user id** — DOES NOT APPLY as written and is REPLACED: the function takes no
  arguments from any caller, and SHALL refuse every caller whose **verified** JWT does not carry
  `role: service_role`.
- **It verifies the JWT itself** — APPLIES and is sharper: both Supabase keys are valid JWTs
  differing in a `role` claim, so a decode-only check is forgeable.
- **Nothing type-checks it** — APPLIES unchanged, and now over the largest secret set in the repo.

#### Scenario: A signed-in rider cannot invoke it
- **WHEN** a rider calls the function with their own access token
- **THEN** it SHALL be refused
- **AND** `verify_jwt: true` SHALL NOT be treated as that refusal, because a rider's token
  satisfies it

#### Scenario: The functions it calls live in `public`, not `private`
- **WHEN** the helpers are placed
- **THEN** every one the function calls SHALL be in `public` and granted to `service_role`
- **AND** the assertion SHALL name the role —
  `has_function_privilege('service_role', …, 'EXECUTE')` — rather than calling it, because the
  suite runs as the table owner for whom neither the grant nor the `private` USAGE barrier exists
- **AND** the reason SHALL cite `031`: `029` shipped a function nothing could call, and PostgREST
  routes only to `public`

#### Scenario: The blast radius is checkable
- **WHEN** the function is reviewed
- **THEN** a grep of its source for `.from(` SHALL return zero
- **AND** the reason SHALL be recorded: a service-role key reaching arbitrary tables makes every
  policy in this repo decorative, which is decision #8's third reading

### Requirement: Delivery failures SHALL be classified, and only a permanent refusal SHALL delete a token

A provider response SHALL be classified into exactly three outcomes and each SHALL have a distinct
action:

| Outcome | Examples | Action |
|---|---|---|
| **Delivered** | 200 | advance `last_seen_at`; complete the outbox row |
| **Token is dead** | APNs `410 Unregistered`, `403 BadDeviceToken`; FCM `UNREGISTERED`, `INVALID_ARGUMENT` | delete the token row immediately; the outbox row is not failed by it |
| **Transport** | 5xx, 429, timeout, TLS failure | retry with backoff; after a bounded attempt count mark the outbox row failed and **leave every token alone** |

**The classification is the whole requirement.** `search-places` is this repo's worked example of
getting one wrong: `isPolicyRefusal` matched `42501` only, the participation gate raises `23514`,
so a refusal fell to the outage branch and DEV reported "unavailable" for a case that was not.
A push path that folds a transport error into the dead-token branch silently unsubscribes every
rider on the platform having the outage, and nothing reports it.

#### Scenario: A provider outage costs no tokens
- **WHEN** every attempt in a batch returns 503
- **THEN** no token row SHALL be deleted
- **AND** the batch SHALL be retryable

#### Scenario: One dead token does not fail its siblings
- **WHEN** a rider has three tokens and one is reported unregistered
- **THEN** that row SHALL be deleted and the other two SHALL still be delivered to
- **AND** the outbox row SHALL complete rather than fail

#### Scenario: A rider with no tokens is not a failure
- **WHEN** a notification's recipient has registered no device, or every token was just deleted
- **THEN** the outbox row SHALL complete
- **AND** nothing SHALL be logged as an error, because most riders will have no token for most of
  this feature's life

#### Scenario: A notification is pushed at most once
- **WHEN** the same outbox row is claimed twice — a retried batch, an overlapping schedule run, a
  function timing out after sending
- **THEN** at most one push SHALL reach a device for it
- **AND** the claim SHALL be the thing that guarantees it, rather than a check the sender performs
  after the fact

#### Scenario: A batch is bounded
- **WHEN** a backlog exists — the scheduler was paused, the project auto-paused, a deploy was
  late
- **THEN** each run SHALL claim a bounded number of rows and SHALL NOT attempt the whole backlog
- **AND** this SHALL follow `event-fanout-integrity`'s rule that a fan-out is bounded and SHALL
  NOT be assumed small, applied one table further down
