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
policy requires, for that recipient. If any conjunct fails, no push SHALL be sent.

**The gate SHALL be written per COLUMN, mirroring the policy's own shape, and SHALL NOT be
dispatched on `type`.** `036` states the subject shapes once so that its SELECT policy *"can be
written per COLUMN rather than per type and the two cannot drift apart"*, and the live qual is four
independent `<column> is null or exists (…)` conjuncts evaluated on every row whatever its type.
A type-keyed gate reads as equivalent and is not, and the divergence has an exact trigger: **adding
a sixth type changes `notifications_type_check` and `notifications_subject_shape` and does not
change the SELECT qual at all**, so a pin on the policy stays green while the type-keyed gate has
no branch for the new type.

The conjunct set is therefore:

| Conjunct | Predicate | Applied |
|---|---|---|
| recipient scope | the row's own `user_id` | always |
| block, both directions | `private.is_blocked(user_id, actor_id)` | always |
| actor resolves | `private.can_read_profile(user_id, actor_id)` | always — the actor is a rendered resource on every row |
| `postcard_id` | `postcard_id is null or private.can_read_postcard(user_id, postcard_id)` | per column |
| `comment_id` | `comment_id is null or private.can_read_comment(user_id, comment_id)` | per column |
| `ride_id` | `ride_id is null or private.can_read_ride(user_id, ride_id)` | per column |
| `club_id` | `club_id is null or private.can_read_club(user_id, club_id)` | per column |

**The copy dispatch is a separate half and irreducibly per type**, because the sentence a rider
reads differs by type. That half SHALL carry an explicit `else` arm that **raises**, for the reason
`036`'s `notifications_subject_shape` carries `else false`: a bare `CASE` with no `ELSE` returns
NULL for an unmatched type, and a NULL-copy push is either a crash in the sender or an empty
notification on a lock screen.

This SHALL be implemented as **one** `security definer` function in `public`, granted to
`service_role` by name and revoked from `public`, `anon` and `authenticated`. That function SHALL
be the only place the policy is restated, and its restatement SHALL be pinned textually in
`supabase/tests/rls_test.sql` in the manner `060` pinned `clubs` SELECT — pinning **both** the
SELECT qual **and** `notifications_type_check`, since the type list is the half that moves.

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

#### Scenario: Both conjuncts are required, and the per-column shape is what guarantees it
- **WHEN** a `ride_created_in_club` notification is considered for sending
- **THEN** the ride **and** the club SHALL both resolve for the recipient
- **AND** the leak this closes SHALL be asserted directly: a public club, a ride whose `is_public`
  is false, and a recipient who has left that club
- **AND** the derivation "ride visibility implies club visibility" SHALL NOT be used to collapse
  it, because that is a property of today's `rides` policy and `036` §3 already refuses it
- **AND** no implementer SHALL have to remember this: both conjuncts fire because the row sets both
  columns, which is the property the per-column shape buys

#### Scenario: An unknown type suppresses loudly rather than sending empty copy
- **WHEN** the copy dispatch meets a `type` it has no arm for
- **THEN** it SHALL raise, and the outbox row SHALL be marked failed
- **AND** it SHALL NOT return NULL, an empty string or a generic fallback string
- **AND** the visibility gate SHALL already have passed in that case, which is exactly why the
  copy half needs its own `else`: the two halves fail on different inputs

#### Scenario: The pin covers the type list, not only the policy
- **WHEN** a sixth notification type is added
- **THEN** the RLS suite SHALL fail on the pinned `notifications_type_check` text
- **AND** a pin on the SELECT qual alone SHALL NOT be accepted as covering this, because that qual
  does not change when a type is added

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

### Requirement: Apple and Google SHALL be named as sub-processors, because this is the first RLS-governed content to leave Supabase

A push transmits, in cleartext to a third party, another rider's username, a club's name, a ride's
title and a persistent per-device identifier — for every notification, for every rider who grants.
`/legal/privacy` SHALL name Apple and Google in its *"Who processes your data today"* section,
alongside Supabase, Vercel and Geoapify, with what each receives, **in the change that ships
delivery**.

**This is the first time content governed by an RLS policy leaves Supabase for a third party at
all.** Every prior outbound call in this repo sends something a rider typed or a coordinate:
`search-places` sends a query string, `resolve-ride-location` sends a place. Neither sends another
rider's identity or a private club's name, and neither did so from an `eu-west-1` project holding
EU riders' data.

#### Scenario: The privacy page is updated in the same change, not later
- **WHEN** delivery ships
- **THEN** `/legal/privacy` SHALL already name both providers and what each receives
- **AND** this SHALL NOT be filed as a follow-up, because the disclosure obligation begins with the
  first delivered push rather than with the first complaint

#### Scenario: The question put to the product owner names the sub-processor
- **WHEN** the owner is asked whether a push may carry a private club's name or a private ride's
  title
- **THEN** the question SHALL say that doing so also transmits it to Apple or Google
- **AND** a question framed only around the lock screen SHALL be treated as materially the wrong
  question, because that surface is the rider's own device and this one is not

#### Scenario: The device identifier counts as personal data too
- **WHEN** the disclosure is written
- **THEN** it SHALL include the provider token and the installation identifier, not only the copy
- **AND** the retention window for those SHALL be the one this change already states, so the page
  and the migration header agree in the same words

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

#### Scenario: A notification is pushed at most once, and never after it has been read
- **WHEN** the same outbox row is claimed twice — a retried batch, an overlapping schedule run, a
  function timing out after sending
- **THEN** at most one push SHALL reach a device for it
- **AND** the claim SHALL be the thing that guarantees it, rather than a check the sender performs
  after the fact

#### Scenario: A notification the rider has already read is not pushed
- **WHEN** `notifications.read_at` is non-NULL at the moment the batch is claimed
- **THEN** the row SHALL be suppressed rather than sent
- **AND** the reason SHALL be recorded: with a one-minute interval this is the ordinary case, not
  an edge one — a rider who is in the app when the row lands, sees it and taps it would otherwise
  get a push about it forty seconds later

#### Scenario: A batch is bounded by size **and** by age
- **WHEN** a backlog exists — the scheduler was paused, the free-tier project auto-paused after
  ~7 days idle, a deploy was late
- **THEN** each run SHALL claim a bounded number of rows and SHALL NOT attempt the whole backlog
- **AND** any row older than a stated age SHALL be **suppressed rather than sent**, classified
  alongside the visibility refusal rather than as a failure
- **AND** the reason SHALL be recorded: the entire value of this feature is timeliness, so a
  resumed project delivering a week of notifications in installments is worse than delivering
  none of them — and a size bound alone produces exactly that, one batch at a time
- **AND** the age SHALL be a few hours rather than a day, and SHALL be stated in the migration
  header beside the schedule interval it is paired with
- **AND** this SHALL follow `event-fanout-integrity`'s rule that a fan-out is bounded and SHALL
  NOT be assumed small, applied one table further down
