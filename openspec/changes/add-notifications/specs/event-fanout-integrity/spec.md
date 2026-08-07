## Purpose

How an event in one table becomes rows in another that the actor cannot forge, skip or aim —
the security context the fan-out runs in, where the actor's identity comes from, and which
recipients must be excluded before a row is written. Split out of `notifications` deliberately,
because the next fan-out this app grows — ride reminders, "ride updated", the Inbox epic —
inherits every rule here unchanged and must not rediscover them.

## ADDED Requirements

### Requirement: Fan-out SHALL be performed by a database trigger and by nothing else

Every notification row SHALL be written by an `AFTER INSERT` (or `AFTER DELETE`) row-level trigger
on the table whose write is the event. No application code, Server Action, Edge Function or client
call SHALL write one.

**Fan-out is an integrity rule, and `CLAUDE.md`'s standing rule is that no integrity rule may live
only in client code.** The client owns the mutation path: a client that also writes the
notification is a client that can decline to write it, write it to the wrong rider, or write one
for an event that did not happen. A trigger is the only place in this architecture the rule cannot
be skipped, because the publishable key ships in the bundle and PostgREST accepts any rider's JWT.

#### Scenario: The trigger fires whatever issued the write
- **WHEN** the parent row is inserted by the app, by a hand-rolled PostgREST request, by a seed, by
  a `security definer` function, or by `psql` as the table owner
- **THEN** the fan-out SHALL run
- **AND** it SHALL NOT carry a `WHEN (CURRENT_USER = 'authenticated')` clause, because that clause
  is what makes `023`'s participation gate correctly *skip* privileged writes, and a notification
  that silently does not happen for a privileged write is a gap with nothing to detect it

#### Scenario: The trigger is AFTER, not BEFORE
- **WHEN** the fan-out runs
- **THEN** it SHALL run AFTER the parent row exists
- **AND** a parent write refused by RLS, a CHECK or the participation gate SHALL produce no
  notification, because it never reaches the AFTER phase

#### Scenario: A refused parent write leaves nothing behind
- **WHEN** a rider attempts a like, comment, RSVP, ride creation or club join that the database
  refuses
- **THEN** zero notification rows SHALL exist afterwards

#### Scenario: An event with no recipients writes nothing and does not fail
- **WHEN** a ride is created with `club_id` NULL, or the only club member is the actor, or every
  candidate recipient is blocked
- **THEN** zero rows SHALL be written and the parent write SHALL succeed normally

### Requirement: The fan-out's security context SHALL be stated, and SHALL NOT be guarded by `current_user`

Each fan-out function SHALL be `SECURITY DEFINER`, owned by the table owner, with
`SET search_path = ''`, and with `EXECUTE` revoked from `public`, `anon` and `authenticated`. It
SHALL live in the `private` schema. Its body SHALL NOT branch on `current_user`.

Two things make the definer context necessary rather than stylistic, and both are measured:
`authenticated` holds **no INSERT grant** on `notifications`, so an invoker-rights trigger is
refused outright; and `notifications` is owned by `postgres` with `relforcerowsecurity` **false**
— as all fifteen public tables are, verified 2026-08-07 — so a definer function owned by that role
inserts past RLS, which is the only way a row addressed to *somebody else* can be written at all.

**The `current_user` trap is the one this repo has already paid for.** Inside a `SECURITY DEFINER`
function `current_user` is the **owner**, not `authenticated` — measured on Postgres 16, which is
why `003`'s and `012`'s guards short-circuit when reached from `accept_terms()`. A fan-out function
that copies that guard shape never runs. A fan-out *trigger* that copies `023`'s
`WHEN (CURRENT_USER = 'authenticated')` clause never fires for a privileged write.

#### Scenario: The function is not reachable from a client
- **WHEN** `authenticated`, `anon` or `service_role` attempts to call a fan-out function directly
- **THEN** the call SHALL be refused
- **AND** the assertion SHALL name the role via `has_function_privilege(…)` rather than attempting
  the call, because the suite runs as the table owner for whom the barrier does not exist — this is
  `031`'s lesson, and the exact shape of the bug `029` shipped

#### Scenario: The function adds no security advisor
- **WHEN** the security advisors are read after applying the migration
- **THEN** the count and identity SHALL be unchanged at eight
- **AND** a new `authenticated_security_definer_function_executable` WARN SHALL mean either the
  function landed in `public` or a `revoke` did not, and SHALL be treated as a failed apply

#### Scenario: No branch on `current_user` exists anywhere in the fan-out
- **WHEN** the fan-out code is reviewed
- **THEN** no `if current_user <> …` guard and no `WHEN (CURRENT_USER = …)` trigger clause SHALL
  appear
- **AND** the reason SHALL be recorded at the site, because both shapes are already in this schema
  and both are correct where they are

#### Scenario: `search_path` is empty and every reference is schema-qualified
- **WHEN** the fan-out functions are created
- **THEN** each SHALL set `search_path = ''` and qualify every table and function reference,
  matching every other `security definer` function in this schema

### Requirement: The actor SHALL be read from the row, never from `auth.uid()`

The acting rider SHALL be taken from the inserted row's own column — `postcard_likes.user_id`,
`postcard_comments.author_id`, `ride_members.user_id`, `rides.organizer_id`,
`club_members.user_id` — and never from `auth.uid()`.

**`auth.uid()` is NULL wherever there is no JWT**, which includes the RLS test suite, `psql`, a
seed and the Supabase MCP. A self-suppression written as `where recipient <> auth.uid()` therefore
evaluates to NULL, which is not TRUE, which filters out **every** recipient — so the fan-out
silently writes nothing in exactly the environment where it is asserted, and every "the actor is
not notified" assertion passes vacuously while every "the recipient is notified" assertion fails
for a reason that looks like a policy problem.

Each of those columns is already pinned to `auth.uid()` by its own INSERT policy, so reading the
row is not weaker than reading the JWT — it is the same value, available in every context.

#### Scenario: The fan-out is correct with no JWT present
- **WHEN** the parent row is inserted from a context with no `request.jwt.claims` — the RLS suite,
  a seed, or a maintenance session
- **THEN** the fan-out SHALL still identify the actor and still suppress self-notification
- **AND** the assertions SHALL therefore mean what they say

#### Scenario: The actor cannot be aimed at another rider
- **WHEN** a rider attempts to cause a notification naming somebody else as actor
- **THEN** it SHALL be impossible, because the actor is the parent row's own owner column and each
  of those is pinned to `auth.uid()` by its table's INSERT policy

#### Scenario: `auth.uid()` appears nowhere in a fan-out function
- **WHEN** the fan-out code is reviewed
- **THEN** `auth.uid()` SHALL NOT appear in it
- **AND** this SHALL be checkable by inspection rather than inferred from behaviour

### Requirement: A rider SHALL NEVER be notified of their own action

Every fan-out SHALL exclude the actor from its recipient set, in all five types, before writing.

Self-notification is the most visible possible defect and the easiest to ship: the club-creation
path inserts the creator's own `club_members` row, so without suppression **every club creation
immediately tells its creator that they joined their own club**, and every organizer who RSVPs to
their own ride tells themselves.

#### Scenario: Liking or commenting on your own postcard notifies nobody
- **WHEN** a rider likes or comments on a postcard they authored
- **THEN** zero notification rows SHALL be written

#### Scenario: An organizer RSVPing to their own ride notifies nobody
- **WHEN** the rider named in `rides.organizer_id` inserts their own `ride_members` row
- **THEN** zero notification rows SHALL be written
- **AND** this SHALL hold whether the row is inserted by the rider or seeded by a future
  creator-membership trigger

#### Scenario: Creating a club notifies nobody, including its creator
- **WHEN** a club is created and its creator's own `owner` membership row is inserted
- **THEN** zero notification rows SHALL be written

#### Scenario: Creating a ride in a club does not notify its organizer
- **WHEN** a rider creates a ride in a club they belong to
- **THEN** every other member SHALL be notified and the organizer SHALL NOT
- **AND** the exclusion SHALL be by rider id, not by role, because the organizer may hold any role

#### Scenario: A rider who is both owner and joiner is excluded once
- **WHEN** the actor would qualify for the recipient set through more than one arm — as owner and
  as a `club_members` row, for instance
- **THEN** they SHALL be excluded, and the exclusion SHALL apply after the union rather than inside
  one arm of it

### Requirement: The recipient set SHALL be computed by direct query, never through a caller-relative helper

Recipient membership SHALL be evaluated with an explicit predicate naming the candidate rider.
`private.is_club_member` and `private.is_ride_crew` SHALL NOT be used inside a fan-out.

**Both helpers read `auth.uid()` internally** — verified 2026-08-07 — so each answers *"is the
caller a member"* and never *"is this candidate a member"*. A fan-out reaching for one computes the
actor's own membership and applies that single answer to every candidate: the set is either
everybody or nobody, and it looks correct in a one-member test. `private.is_blocked(a, b)` and
`private.is_club_public(club)` take their subject as an argument and are the only two a fan-out may
use.

#### Scenario: The owner union applies to `club_joined` and NOT to `ride_created_in_club`
- **WHEN** a club's `owner_id` holds no `club_members` row
- **THEN** the `club_joined` recipient set SHALL be `clubs.owner_id` **∪** `club_members`, because
  `clubs` SELECT carries an `owner_id = auth.uid()` arm and the row therefore resolves for them
- **AND** the `ride_created_in_club` recipient set SHALL be `club_members` **alone**, because the
  only arm of `rides` SELECT admitting a club's members is
  `club_id IS NOT NULL AND private.is_club_member(club_id)`, and `private.is_club_member` queries
  `club_members` with **no owner arm** — so a row written to an ownerless owner is one the SELECT
  policy drops on every read, permanently
- **AND** the asymmetry SHALL be recorded at both sites, because the two sets read as
  interchangeable and are not: what differs is the **subject's** policy, not the club

#### Scenario: The ownerless-owner state is reachable in one request, not only by a failed pair
- **WHEN** the reachability of an ownerless owner is assessed
- **THEN** it SHALL be recorded that `club_members` DELETE is a bare `(auth.uid() = user_id)` with
  **no owner carve-out** — verified 2026-08-07 — so any owner may leave their own club and keep
  ownership in a single request
- **AND** `createClub`'s two non-transactional inserts SHALL be recorded as a *second* route to the
  same state rather than as the only one, because a design that assumes the failure is rare
  under-weights a state a rider can reach deliberately

#### Scenario: The narrowing is a consequence of a defect and SHALL NOT be defended as a preference
- **WHEN** the `ride_created_in_club` recipient set is reviewed
- **THEN** its reason SHALL be recorded as a pre-existing defect rather than as a decision that
  owners do not want the notification: an ownerless owner **cannot see their own private club's
  rides at all today**, and `rides` INSERT's own `with check` — `club_id IS NULL OR
  private.is_club_member(club_id)` — refuses them a ride in their own club
- **AND** a notification SHALL NOT be the one surface that pretends otherwise, because a row that
  renders "created a ride in ‹club›" for a ride whose detail screen returns not-found is worse than
  no row
- **AND** when `enforce-creator-membership` lands, every owner SHALL hold a membership row, the two
  sets SHALL coincide, and this narrowing SHALL become invisible rather than needing reversal
- **AND** this change SHALL NOT depend on that change landing first, in either order

#### Scenario: Club recipients are exactly that club's members
- **WHEN** a ride is created in a club, or a rider joins a club
- **THEN** no rider outside that club SHALL receive a row, including riders in other clubs and
  riders who have left
- **AND** membership SHALL be read at the moment of fan-out, so a rider who left a moment earlier
  receives nothing

#### Scenario: The `club_joined` recipient set is owner plus admins and nobody else
- **WHEN** a rider joins a club
- **THEN** only the club's owner and its `admin`-role members SHALL be notified
- **AND** ordinary members SHALL NOT be, because a club with any real membership would otherwise
  notify everyone on every join

#### Scenario: The admin arm is asserted even though no client can reach it
- **WHEN** the admin arm is tested
- **THEN** the `admin` row SHALL be inserted as the table owner, and the assertion SHALL record why
- **AND** the reason SHALL be that `club_members` INSERT admits only `member`, or `owner` for the
  club's own `owner_id`, and there is **no UPDATE policy on the table at all** — so `admin` is
  insertable by nobody and promotable by nobody, and zero admin rows exist (measured 2026-08-07)
- **AND** omitting the assertion as untestable SHALL NOT be acceptable, because the arm ships the
  day invitations do

#### Scenario: The `ride_joined` recipient is the organizer and nobody else
- **WHEN** a rider RSVPs to a ride
- **THEN** only `rides.organizer_id` SHALL be notified
- **AND** other crew members SHALL NOT be, notwithstanding that the design fans this row out to all
  attendees — widening it is a product decision recorded as an open question, not a default

#### Scenario: A ride with no club notifies nobody about its creation
- **WHEN** a ride is created with `club_id` NULL
- **THEN** zero rows SHALL be written, because a ride with no club has no audience to address
- **AND** a public ride SHALL NOT be fanned out to every signed-in rider

#### Scenario: A rider who cannot see the ride cannot be its joiner
- **WHEN** the organizer of a ride in a private club is notified of a joiner
- **THEN** that joiner SHALL necessarily be a member of the club, because `ride_members` INSERT
  requires an `EXISTS` against `rides` under the caller's own row security and a private club's
  ride is visible to its members only
- **AND** the case of an organizer notified about a rider who cannot see the club SHALL therefore
  be unreachable through the client, which SHALL be recorded rather than defended against
- **AND** the row SHALL survive that rider later leaving the club, because the organizer's own arm
  of the `rides` policy keeps the subject resolvable for them

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

### Requirement: A retraction SHALL delete exactly the row its matching fan-out would have written

The `AFTER DELETE` retraction on `postcard_likes` SHALL scope its delete by the **full** key the
insert would have used — `user_id`, `type`, `actor_id` and `postcard_id` together — and SHALL NOT
match on any subset of it.

**A retraction scoped by `type + postcard_id` alone is a write one rider can aim at another
rider's row**, in the one table in this schema whose entire premise is that no rider can write to it.
Rider A unliking a postcard would delete rider B's `postcard_liked` notification for the same
postcard: A holds no grant on `notifications`, but the trigger does, and the trigger is running on A's
delete. That is a forged write with the grant model intact, and it is reachable with one tap by any
rider who can see the postcard. `actor_id` is what makes it A's own row and nobody else's;
`user_id` is what stops a future type that notifies more than one recipient from being cleared
wholesale.

The scope is index-served for free: the uniqueness index leads `(user_id, type, actor_id,
postcard_id, …)`, so the four-column predicate is a prefix of it.

#### Scenario: One rider's unlike does not clear another rider's notification
- **WHEN** riders A and B have both liked the same postcard, and A unlikes it
- **THEN** A's `postcard_liked` notification SHALL be removed and B's SHALL survive
- **AND** this SHALL be asserted with two actors, because a single-actor assertion cannot fail

#### Scenario: The retraction cannot reach another recipient's row
- **WHEN** the retraction runs
- **THEN** it SHALL match on `user_id` as well as on the actor and the subject
- **AND** no retraction SHALL be written as a delete over a subject alone

#### Scenario: The retraction fires on a cascaded delete and that is bounded rather than ignored
- **WHEN** `postcard_likes` rows are removed by a cascade — a postcard being deleted, or an account
  deletion reaching them through `postcard_likes.user_id → profiles` — rather than by a rider's tap
- **THEN** the row-level `AFTER DELETE` trigger SHALL fire once per cascaded row, inside the
  deletion's own transaction, which SHALL be recorded rather than discovered
- **AND** the work SHALL be bounded by the retraction being an index-prefix delete rather than a scan
- **AND** the result SHALL be harmless because the same rows are removed by
  `notifications.postcard_id`'s and `notifications.actor_id`'s own cascades, so the retraction is at
  worst redundant and never wrong
- **AND** the redundancy SHALL NOT be removed by adding a `pg_trigger_depth()` or `TG_OP` guard,
  because a guard that skips the cascade case is one refactor away from skipping the rider case

### Requirement: An event SHALL produce at most one live notification per recipient, and repeating it SHALL NOT stack

A uniqueness constraint SHALL exist over the recipient, the type, the actor and the subject, so
that repeating an event cannot produce a second row.

A like/unlike loop is one tap each way. Without the constraint it is an unbounded row generator
aimed at another rider's list, which is a harassment vector with no rate limit behind it — and
nothing in this app rate-limits anything.

**Uniqueness SHALL be `NULLS NOT DISTINCT`.** The subject is several nullable typed columns and
most rows leave most of them NULL; a plain UNIQUE treats two NULLs as different, so the constraint
would never fire. This is `015`'s `feed_reads` lesson exactly, where a plain UNIQUE would have
inserted a second app-wide row on every visit.

#### Scenario: Liking, unliking and liking again leaves one row
- **WHEN** a rider likes a postcard, unlikes it and likes it again
- **THEN** exactly one notification SHALL exist afterwards

#### Scenario: A repeat that the constraint catches is a no-op, not an error
- **WHEN** a duplicate fan-out would violate the constraint
- **THEN** it SHALL be absorbed rather than raising, so that the rider's own write is not refused
  by a notification bookkeeping detail

#### Scenario: Two comments from the same rider produce two notifications
- **WHEN** a rider comments twice on the same postcard
- **THEN** two notifications SHALL exist, because the subject of a comment notification is the
  comment and each comment is a distinct row
- **AND** collapsing them SHALL NOT be done, because the recipient has two things to read

#### Scenario: Changing an RSVP produces nothing new
- **WHEN** a crew member changes their `ride_members.status` from `going` to `maybe` or back
- **THEN** no notification SHALL be written, because the fan-out is on INSERT and a status change
  is an UPDATE

#### Scenario: Leaving and rejoining a ride does not re-notify
- **WHEN** a rider deletes their `ride_members` row and inserts it again
- **THEN** exactly one notification SHALL exist, because the constraint catches the second insert
- **AND** the organizer SHALL NOT be told twice about one rider

#### Scenario: Two riders doing the same thing produce two rows
- **WHEN** two different riders like the same postcard
- **THEN** two notifications SHALL exist, because `actor_id` is part of the key

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

### Requirement: A fan-out SHALL be bounded and SHALL NOT be assumed small

A fan-out that writes one row per member SHALL be a single set-based statement, and its cost SHALL
be stated at the scale the club sizes allow.

A 500-member club creating a ride writes 500 rows in one statement, inside the organizer's own
transaction, while they wait. That is acceptable at this size and is recorded as a measured
expectation rather than an assumption.

#### Scenario: The fan-out is one statement, not a loop
- **WHEN** a club fan-out runs
- **THEN** it SHALL be a single `INSERT … SELECT` over the recipient set
- **AND** it SHALL NOT iterate per recipient

#### Scenario: The recipient query is index-served
- **WHEN** the recipient set is computed
- **THEN** it SHALL be served by an existing index on `club_members` rather than a sequential scan

#### Scenario: The write's index cost is stated, and a cascade index is not a speculative one
- **WHEN** 500 rows land for 500 recipients
- **THEN** the indexes the insert maintains SHALL be the primary key, the uniqueness constraint, the
  `(user_id, created_at desc)` list index, the `actor_id` cascade index, and **only those partial
  subject indexes whose column is non-NULL on the row** — two for a `ride_created_in_club` row, one
  for the other four types
- **AND** no additional index SHALL be added for a **read query no screen issues**, which is the
  prohibition this scenario carries and the whole of it
- **AND** an index on a **cascade path** SHALL NOT be read as caught by that prohibition, because a
  cascade is a delete path with a standing requirement behind it rather than a query anyone chose to
  write — see `specs/notifications` §*Every cascade path into `notifications` SHALL be indexed*
- **AND** an earlier revision of this scenario said "the `(user_id, created_at desc)` index SHALL be
  the only one the insert maintains", which forbade exactly the indexes
  `add-account-deletion`'s `The cascade SHALL be indexed on every path it walks` requires; the two
  requirements collided and neither named the other
