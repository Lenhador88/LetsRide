# event-fanout-integrity Specification

## Purpose
How an event in one table becomes rows in another that the actor cannot forge, skip or aim —
the security context the fan-out runs in, where the actor's identity comes from, and which
recipients must be excluded before a row is written. Split out of `notifications` deliberately,
because the next fan-out this app grows — ride reminders, "ride updated", the Inbox epic —
inherits every rule here unchanged and must not rediscover them.
## Requirements
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
`private.is_club_member(uuid)` and `private.is_ride_crew(uuid)` SHALL NOT be used inside a
fan-out.

**Both helpers read `auth.uid()` internally** — verified 2026-08-07 — so each answers *"is the
caller a member"* and never *"is this candidate a member"*. A fan-out reaching for one computes
the actor's own membership and applies that single answer to every candidate: the set is either
everybody or nobody, and it looks correct in a one-member test.

**The permitted instrument is a candidate-relative predicate**, and naming only the prohibition is
what left each fan-out to invent its own answer. A fan-out MAY use any predicate that takes its
subject as an argument — `private.is_blocked(a, b)`, `private.is_club_public(club)`,
`private.is_club_member_for(candidate, club)`, `private.can_read_ride(candidate, ride)` and
`private.can_read_club(candidate, club)` — and the full rules for that shape, including that no
client role may reach one, live in the `candidate-relative-visibility` capability.

**A candidate-relative predicate SHALL NOT be a second copy of a caller-relative one.**
`private.is_club_member(uuid)` SHALL be a one-line wrapper over
`private.is_club_member_for(auth.uid(), uuid)`, so the predicate the ten calling policies use and
the predicate the fan-outs use are **one body with two entry points**, and that sharing SHALL be
**asserted** rather than intended. Two definitions of one concept aging apart is the defect this
requirement exists to prevent, and building the fix out of two more of them would be
self-defeating.

**The assertion SHALL pin the wrapper's body by equality, and a `like` match SHALL NOT be accepted
as covering it.** An arm added to the wrapper — `select private.is_club_member_for(auth.uid(), $1)
or exists (…)` — leaves every policy's `qual` text unchanged, still satisfies a
`like '%is_club_member_for%'` match, and makes the candidate-relative predicate silently
**narrower** than the policy that delegates to it. That is this requirement's own failure mode one
level down: a stronger claim than the evidence behind it. An earlier revision of this paragraph
said the two entry points *"cannot drift apart"*, which no assertion then supported.

**The rule binds a fan-out whose recipient is a single named rider exactly as hard, and that is the
reading this requirement previously left open.** Where the recipient comes straight out of `NEW` —
`new.invitee_id`, `new.inviter_id` — no *set* is computed, so the sentence above has nothing to bite
on and invites the conclusion that a caller-relative helper is harmless here. It is not. Every
question a fan-out asks about that named rider is still a question about **somebody other than the
caller**: whether they are blocked with the actor, and above all whether the read policy can ever
return the row to them. A caller-relative helper answers all of those for the **actor**, and with a
single recipient the wrong answer produces one wrong row rather than a wrong set, which is harder to
see and not less wrong.

Any new caller-relative helper introduced alongside a fan-out SHALL therefore ship with its
candidate-relative form in the same migration, and the fan-out SHALL use the candidate form.

#### Scenario: A single named recipient is still evaluated candidate-relative
- **WHEN** a fan-out addresses one rider read out of `NEW`
- **THEN** every predicate it evaluates about that rider SHALL take the rider as an argument
- **AND** no helper reading `auth.uid()` SHALL appear in the fan-out, including one added by the
  same migration for the policy's own use

#### Scenario: A new visibility arm reaches the fan-out through the candidate form
- **WHEN** a migration adds an arm to a policy that a fan-out's resolvability check restates
- **THEN** the fan-out SHALL see the new arm through the candidate-relative restatement
- **AND** a fan-out that would have written a row before the arm and not after it, or the reverse,
  SHALL be treated as evidence the two copies have drifted

#### Scenario: The owner union applies to `club_joined` AND to `ride_created_in_club`, because readability is what decides
- **WHEN** a club's `owner_id` holds no `club_members` row
- **THEN** **both** recipient sets SHALL include `clubs.owner_id`, and the reason SHALL be that
  each subject resolves for them: `clubs` SELECT carries an `owner_id = auth.uid()` arm, and since
  `054` `private.is_club_member` carries an owner arm too, so `rides` SELECT's club arm admits
  them
- **AND** the union SHALL NOT be justified by symmetry between the two types — what decides is the
  **subject's** policy, checked per type, and the two sets were correctly *asymmetric* until `054`
- **AND** the inclusion SHALL be **measured** rather than derived from a claim about another
  function's body: the recipient set SHALL be filtered by `private.can_read_ride(candidate, ride)`
  **and** `private.can_read_club(candidate, club)`, one predicate per subject the row renders, so
  that the answer follows both policies automatically the next time either changes
- **AND** an earlier revision of this scenario required the opposite — `ride_created_in_club`
  recipients being `club_members` **alone**, because `private.is_club_member` had *"NO owner
  arm"*. `054` gave it one, `055`'s header flagged the consequence, and the suite already asserts
  under the `036/054:` label that an ownerless owner **can** now see their own private club's
  ride. The narrowing outlived its reason by three migrations while reading as a decision, which
  is why this scenario now names a live predicate instead of a fact about a body

#### Scenario: The stale justification is removed from the object as well as from the file
- **WHEN** a fan-out's recipient set changes for a reason recorded in a `COMMENT ON FUNCTION`
- **THEN** that comment SHALL be re-issued in the same migration
- **AND** the reason SHALL be recorded: `private.notify_ride_created_in_club`'s comment asserted
  *"private.is_club_member, which has no owner arm"* and `059` re-issued it verbatim three
  migrations after that stopped being true, so a session reading the database rather than the
  repository got the superseded answer with nothing to flag it

#### Scenario: The ownerless-owner state is reachable in one request, not only by a failed pair
- **WHEN** the reachability of an ownerless owner is assessed
- **THEN** it SHALL be recorded that `club_members` DELETE is a bare `(auth.uid() = user_id)` with
  **no owner carve-out** — verified 2026-08-07 — so any owner may leave their own club and keep
  ownership in a single request
- **AND** `createClub`'s two non-transactional inserts SHALL be recorded as a *second* route to the
  same state rather than as the only one, because a design that assumes the failure is rare
  under-weights a state a rider can reach deliberately
- **AND** the fan-out SHALL remain correct whether or not `enforce-creator-membership` has landed,
  because a predicate SHALL NOT depend on a data invariant a trigger enforces elsewhere

#### Scenario: Club recipients are exactly that club's members and its owner
- **WHEN** a ride is created in a club, or a rider joins a club
- **THEN** no rider outside that club's membership and `clubs.owner_id` SHALL receive a row,
  including riders in other clubs and riders who have left
- **AND** membership SHALL be read at the moment of fan-out, so a rider who left a moment earlier
  receives nothing

#### Scenario: No row is written for a ride in the club carrying `clubs.is_default`
- **WHEN** a ride is created in the club flagged `clubs.is_default`
- **THEN** **zero** `ride_created_in_club` rows SHALL be written, for every rider **including that
  club's owner**
- **AND** the early return SHALL sit **ahead of** the candidate union rather than inside its
  filter, because every rider in the app is a member of that club and any rider can create a ride
  in it from the shipped Create-ride dropdown — so a row per rider, synchronously, inside that
  rider's own INSERT, repeatable at will
- **AND** widening the recipient set SHALL NOT be allowed to reach past that return, since adding
  the owner to a set that is already every rider makes the broadcast worse rather than better

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

#### Scenario: The `ride_joined` recipients are the organizer and every crew member who can read the ride
- **WHEN** a rider RSVPs to a ride
- **THEN** `rides.organizer_id` and every `ride_members` row with status in `{going, maybe}` SHALL
  be candidates, and the candidate set SHALL then be filtered by
  `private.can_read_ride(candidate, ride)`
- **AND** the organizer SHALL survive that filter unconditionally — whatever `is_public`, whatever
  `club_id`, and whether or not they hold a crew row — because `rides` SELECT leads with an
  unconditional `organizer_id = auth.uid()` arm; **an organizer dropped by the filter is the most
  visible regression this shape can produce** and SHALL be asserted directly
- **AND** the status list SHALL be asserted against `ride_members_status_check`, because it is
  total against today's constraint and stops being total the day a third status is added
- **AND** two earlier revisions are superseded and both are recorded, because each reads as a
  decision: `036` addressed *"the organizer and nobody else"*, calling the widening a product
  question; `055` widened it to the whole crew and **accepted** a known gap in which a crew member
  who cannot resolve the ride receives a permanently-unreadable row, pinned as 055.6 and 055.6b

#### Scenario: A crew member who cannot resolve the ride receives nothing
- **WHEN** a rider holds a `ride_members` row for a ride they cannot SELECT — having blocked the
  organizer, or having left the ride's private club
- **THEN** **no** row SHALL be written for them
- **AND** the two routes SHALL be asserted **separately**, with no block present anywhere in the
  second fixture, because a fan-out that only excluded riders blocked with the organizer closes
  the first and misses the second entirely while reading as a complete repair
- **AND** the two existing `KNOWN GAP` assertions SHALL be **flipped** rather than left beside new
  ones, since a gap closed without moving the assertion that pinned it is a gap that gets
  re-discovered
- **AND** the repair SHALL NOT be a crew arm on `rides` SELECT — see
  `database-enforced-integrity` §*Ride visibility SHALL be stated per role*, whose crew scenario
  states why that widening collapses two other audiences

#### Scenario: A `ride_created_in_club` candidate who cannot resolve the CLUB receives nothing
- **WHEN** a candidate for `ride_created_in_club` — a `club_members` row or `clubs.owner_id` —
  cannot SELECT the club named in `club_id`, whatever their reach to the ride
- **THEN** **no** row SHALL be written for them, because the row renders the club's name as well as
  the ride and the SELECT policy tests the two independently
- **AND** the conjunct SHALL be present **even though it excludes nobody today**: every candidate
  is a member or the owner, and both satisfy `clubs` SELECT as it stands, so the filter is
  installed against the state that opens it rather than after
- **AND** the state that opens it SHALL be named rather than left as a generality — `clubs` SELECT
  gaining a block predicate, which `041` already records as reachable, after which a member blocked
  with the **club owner** but not with the **ride organizer** passes the ride test and fails the
  club one
- **AND** because a recipient count cannot exercise a conjunct that excludes nobody, the club
  predicate's arms — public, owner, member — SHALL be exercised **directly**

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
  of the `rides` policy keeps the subject resolvable **for the organizer**, who is the recipient —
  the departing rider is the *actor*, and nothing about their own reach is being asserted here

### Requirement: A fan-out SHALL NOT write a row that the read policy can never return to its recipient

For every type, the recipient set SHALL be a **subset** of the set to which the `notifications`
SELECT policy will return that row. A row that the policy drops on every read from the instant it is
written SHALL be treated as a defect in the fan-out, not as a row awaiting a policy change.

**This is the rule that catches the class of bug, and it has now been broken twice more, in
opposite directions, after the change that wrote it.** The recipient set and the resolvability
conjunct are written in different places, by different reasoning, and a change on one side is
invisible from the other. The failure has no symptom: nothing raises, no count moves, no assertion
fails, and the row accumulates until its subject is deleted.

**Being a subset is not achieved by *reasoning about* the policy — it is achieved by *calling*
it.** Where a subject's resolvability is anything more than an own-row arm, the recipient set
SHALL be filtered by a candidate-relative predicate that restates that policy, rather than by a
narrowing justified in prose. The two directions this rule has failed in are both prose failures:
`ride_created_in_club` was narrowed for a reason that stopped being true (`054`), and `ride_joined`
was widened past a policy that has no crew arm (`055`). A prose justification cannot go stale
loudly; a predicate can be asserted.

**One predicate per subject the row renders, and a type with two subjects SHALL NOT discharge
either by reasoning from the other.** The `notifications` SELECT policy tests each subject as its
own `EXISTS` conjunct, so a recipient set filtered on only one of them is asserting an implication
the policy does not make — and `036` §3 forbids that implication by name: *"Ride-implies-club is a
derivation from today's policy text and SHALL NOT be relied on."* An earlier revision of the table
below discharged `ride_created_in_club`'s club half exactly that way, arguing in prose that every
candidate satisfies `clubs` SELECT because they are a member or the owner. **That argument is true
today and is not a filter.** The state that falsifies it is already named by `041`: `clubs` SELECT
gaining a block predicate, after which a member blocked with the **club owner** but not with the
**ride organizer** passes the ride test, fails the club test, and holds a permanently unreadable
row — latent in exactly the way `036` §7.5 was latent when it was written.

The mapping SHALL be stated per type and checked whenever **either** side changes:

| Type | Recipient set | The policy arm that returns it |
|---|---|---|
| `postcard_liked` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()` |
| `postcard_commented` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()`, and `postcard_comments` SELECT, which inherits it by `EXISTS` |
| `ride_joined` | (`rides.organizer_id` ∪ crew with status in `{going, maybe}`) **filtered by `private.can_read_ride`** | `rides` SELECT — the organizer arm for the first, and whichever arm `can_read_ride` finds for the rest. **There is no crew arm**, which is why the filter is required and not merely tidy. `club_id` is NULL on this type, so the club conjunct is vacuous and `can_read_club` is deliberately NOT called |
| `club_joined` | `clubs.owner_id` ∪ `club_members` | `clubs` SELECT `owner_id = auth.uid() OR private.is_club_member(id)` — both arms present, so the union is safe |
| `ride_created_in_club` | (`clubs.owner_id` ∪ `club_members`) **filtered by `private.can_read_ride` AND `private.can_read_club`**, and empty for the club carrying `clubs.is_default` | **Two conjuncts, tested independently.** `rides` SELECT, restated by `can_read_ride`; **and** `clubs` SELECT, restated by `can_read_club`. Neither is derived from the other |

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

#### Scenario: A row nobody can read is a defect even when it fails closed and is reversible
- **WHEN** the two properties that made `055` accept its known gap are offered again — that the
  failure is a notification never shown rather than a row shown to the wrong rider, and that
  unblocking or rejoining makes the row readable
- **THEN** they SHALL be accepted as bounding the **severity** and SHALL NOT be accepted as
  closing the defect
- **AND** the reason SHALL be recorded: the same two properties are true of every instance of this
  class, so accepting them as a defence retires the requirement rather than applying it

#### Scenario: The subset property is enforced by a predicate wherever the subject has more than an own-row arm
- **WHEN** a recipient set addresses anyone other than the subject's own owner
- **THEN** it SHALL be filtered by a candidate-relative predicate restating the subject's SELECT
  policy, rather than by a narrowing argued in a comment
- **AND** the restatement's staleness SHALL be bounded by an assertion pinning the policy's `qual`
  text, labelled with the predicate's name, so a rewrite of the policy fails the suite with a
  pointer rather than silently changing who gets notified
- **AND** the direction of failure SHALL be recorded: a stale restatement writes rows the read
  policy discards, or withholds rows it would have returned, and **neither can show anything to
  anyone** — which is what makes this the safe side to carry the duplication on

#### Scenario: A type with two subjects is filtered by two predicates, one per subject
- **WHEN** a notification type sets more than one subject column — `ride_created_in_club` sets both
  `ride_id` and `club_id`
- **THEN** the recipient set SHALL be filtered by one candidate-relative predicate **per subject**,
  conjoined, matching the independent `EXISTS` conjuncts the SELECT policy applies
- **AND** neither subject's resolvability SHALL be inferred from the other's, however reliably the
  implication holds against today's policy text
- **AND** a filter that excludes nobody today SHALL still be installed, because the whole class of
  defect this requirement names is latent until a policy changes — and the policy change that
  opens this one, a block predicate on `clubs` SELECT, is already named as reachable by `041`
- **AND** a recipient count SHALL NOT be accepted as exercising such a conjunct, since it excludes
  nobody; the predicate's arms SHALL be exercised **directly**, because a conjunct nothing
  exercises is one a later edit deletes silently

#### Scenario: A subject a type never sets is NOT filtered, and the omission is asserted in both directions
- **WHEN** a type leaves a subject column NULL — `ride_joined` sets `ride_id` and leaves `club_id`
  NULL
- **THEN** the corresponding predicate SHALL NOT be called, because the SELECT policy's conjunct
  for that subject is vacuous for the type
- **AND** the omission SHALL be pinned by assertion **in both directions** — that the fan-out that
  needs the club predicate calls it, and that the fan-out that does not need it does not — because
  a deliberate omission with no assertion behind it is indistinguishable from a missed one, which
  is the confusion this whole requirement exists to end

#### Scenario: The check is asserted, not only reviewed
- **WHEN** the RLS suite exercises a fan-out
- **THEN** each type SHALL assert that every recipient the fan-out wrote for can **read** the row
  back under their own session
- **AND** an assertion that only counts rows written SHALL NOT be accepted as covering this, because
  the whole failure is a row that exists and is unreadable
- **AND** where a recipient is newly added — the ownerless owner — the read-back SHALL be the
  assertion that matters, not the row count

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

### Requirement: A fan-out on a status transition SHALL fire on the transition and not on the row

Where an event is a **change** to a row rather than the row's existence, the trigger SHALL be an
`AFTER UPDATE` guarded on the transition itself — `old.status is distinct from new.status` and the
new value — and SHALL NOT fire on any statement that touches the row for another reason.

It SHALL carry **no** `when (current_user = …)` clause. `036` trap (a) applies with extra force
here: the writers of these transitions are themselves `security definer` functions, for which
`current_user` is the owner, so such a clause would disable the fan-out entirely rather than merely
skipping seeds.

#### Scenario: Only the transition fires
- **WHEN** a statement updates an invite row without moving `status`
- **THEN** no notification SHALL be written

#### Scenario: The definer writer still fans out
- **WHEN** the transition is made by a `security definer` RPC
- **THEN** the fan-out SHALL fire, which SHALL be asserted directly, because a `when` clause added
  later would silently stop it and nothing else would notice

#### Scenario: Each terminal answer produces at most one live row per recipient
- **WHEN** the same answer is submitted twice
- **THEN** the second SHALL raise before reaching the fan-out, and the unique event key SHALL
  additionally make a duplicate row impossible

### Requirement: A retraction SHALL exist for any fan-out whose subject row can be withdrawn

Where the row a fan-out fires on can be deleted by its author while the event it announced has not
yet been acted on, an `AFTER DELETE` trigger SHALL delete exactly the notification the matching
fan-out would have written, matched on the full event key.

It SHALL NOT delete notifications recording an event that already happened — an answer, an
acceptance, a join — because those are records rather than pending prompts.

#### Scenario: Withdrawing the prompt withdraws the notification
- **WHEN** an invite is revoked while pending
- **THEN** the invitee's `ride_invited` notification SHALL be gone
- **AND** the unread count SHALL agree, because both are read through the same policy

#### Scenario: Records of answers survive
- **WHEN** any invite row is deleted for any reason
- **THEN** notifications recording an accept or a decline SHALL be unaffected by the retraction
  trigger, and SHALL die only through their own subject and actor cascades

### Requirement: A trigger whose event is sometimes not an event SHALL be narrowed by a `WHEN` clause, not by an early return

Where a row-level trigger matches inserts that are not the event it exists to announce, the
trigger SHALL be narrowed with a `WHEN` clause in its `CREATE TRIGGER`, and SHALL NOT rely on an
early `return` inside the function body.

The `WHEN` clause is the stronger form for two reasons: it is visible in `pg_get_triggerdef`, so
an assertion can pin the narrowing itself rather than inferring it from behaviour; and it prevents
the function from being entered at all, so a later edit to the body cannot silently widen it.

**`notify_ride_invited` is the instance.** It is `AFTER INSERT ON public.ride_invites FOR EACH
ROW` and was written when `pending` was the only status any insert could carry — true while the
column grant and the INSERT policy were the only writers. `claim_ride_invite_link` is a
`security definer` writer and inserts `accepted` rows, so without narrowing, a rider who joins a
ride by tapping a link they were sent is told **"you have been invited to a ride"** about a ride
they are already on.

**`036`'s actor-is-not-recipient guard does not catch it**, and that is the part worth writing
down. The row's `actor` is the link's `created_by` — the organizer — and its recipient is the
claimer, so the two genuinely differ. The guard is working; the event is simply not an event.

The clause SHALL be `WHEN (NEW.status = 'pending')`. It is a no-op for the in-app path, where the
column grant and INSERT policy already make `pending` the only reachable status at insert, so it
states an invariant that was previously implicit and holds it against a second writer.

#### Scenario: A link claim notifies nobody of an invitation
- **WHEN** a rider claims a live token and an `accepted` `ride_invites` row is inserted
- **THEN** no `ride_invited` notification SHALL be written to anyone

#### Scenario: An in-app invite still notifies
- **WHEN** the organizer inserts a `pending` invite
- **THEN** the invitee SHALL receive exactly one `ride_invited` notification, unchanged from `083`

#### Scenario: The narrowing is pinned, not inferred
- **WHEN** `pg_get_triggerdef` is read for `notify_ride_invited`
- **THEN** it SHALL contain the `WHEN (status = 'pending')` clause
- **AND** the assertion SHALL read the trigger definition rather than only observing that no
  notification appeared, since an absent notification has several possible causes

### Requirement: A rider joining by a route nobody initiated SHALL still reach the organizer through the existing join fan-out, and SHALL NOT gain a new type

A claim SHALL produce notifications through the `ride_members` INSERT path alone. `055`'s
`ride_joined` fan-out already tells the crew that a rider joined, which is exactly and truthfully
what happened.

**No new notification type SHALL be added by this change**, and `ride_invite_accepted` SHALL NOT
be written on a claim. That type asserts that the organizer invited *this rider by name* and they
answered — false on a link claim, where nobody named anyone.

The one case where an accept notification is correct is the conflict branch: a rider who already
held a `pending` or `declined` in-app invite and comes in through the link takes the UPDATE path,
`notify_ride_invite_answered` fires, and the organizer is told their invite was accepted. **That
is true and SHALL be left alone.**

#### Scenario: The organizer learns a stranger joined
- **WHEN** a rider with no prior invite claims a link
- **THEN** the organizer SHALL receive a `ride_joined` notification and no `ride_invited` or
  `ride_invite_accepted` notification

#### Scenario: An outstanding invite answered by a link is reported as answered
- **WHEN** a rider holding a `pending` invite claims the link instead of tapping Accept
- **THEN** the organizer SHALL receive the `ride_invite_accepted` notification the UPDATE trigger
  already writes, since the statement it makes is true

#### Scenario: The type list does not grow
- **WHEN** `notifications_type_check` is read after this change applies
- **THEN** it SHALL hold the same **eleven** types it held before this change — `083` left it at
  eight and `085` added three after, so the count this requirement originally named was already a
  pre-`085` reading. Assert the NAMES, not the number: a count cannot tell an addition from a
  rename, and it is the absence of a twelfth that this requirement is about
- **AND** `NotificationType` in `src/types/index.ts` SHALL be unchanged, so no exhaustive `switch`
  in `notificationCopy` or `NotificationsListItem` gains an arm

### Requirement: A new caller-relative helper SHALL be paired with a subject-taking twin BEFORE any fan-out needs it

The standing requirement *"The recipient set SHALL be computed by direct query, never through a
caller-relative helper"* is stated against the helpers that existed when it was written. This change
introduces a **new** one — `private.is_club_admin(target_club)` — whose description is *exactly* the
recipient set of the request fan-out. That coincidence is what makes trap (c) attractive here:
`where private.is_club_admin(new.club_id)` reads correctly, compiles, and computes the set relative
to whoever happened to be inserting rather than to each candidate.

So the rule SHALL be strengthened: **any caller-relative helper added by a change that also adds a
fan-out SHALL be created together with its subject-taking twin, in the same migration**, one body
behind both, and the fan-out SHALL use the twin.

#### Scenario: Both forms exist in the same migration
- **WHEN** `085` is applied
- **THEN** `private.is_club_admin_for(uuid, uuid)` and `private.is_club_admin(uuid)` SHALL both
  exist, the second delegating to the first with a body equal to the delegation exactly

#### Scenario: The fan-out uses the subject-taking form
- **WHEN** `private.notify_club_join_requested`'s body is examined
- **THEN** it SHALL reference `private.is_club_admin_for` and SHALL NOT reference
  `private.is_club_admin`
- **AND** it SHALL contain no reference to `auth.uid()` anywhere

#### Scenario: The caller-relative form is unreachable from a trigger by construction
- **WHEN** the recipient set is computed
- **THEN** it SHALL be a direct query over `public.clubs` and `public.club_members` with the
  candidate substituted, matching `private.notify_club_joined`'s existing union, so that the two
  fan-outs addressing the same audience cannot disagree about who that audience is

#### Scenario: The two fan-outs' audiences are asserted to agree
- **WHEN** a club has an owner, an admin, an ordinary member and a non-member
- **THEN** the set receiving `club_join_requested` SHALL equal the set receiving `club_joined` for
  the same club, minus the actor in each case
- **AND** this SHALL be asserted as set equality rather than as two independent lists, because the
  defect being guarded against is the two drifting

### Requirement: An existing fan-out that acquires a `security definer` caller SHALL be re-exercised, and its `when` clause SHALL be re-checked

`private.notify_club_joined` is `after insert on public.club_members for each row` with **no `when`
clause**. This change makes it fire for the first time from inside a `security definer` function.

Any change that gives an existing fan-out a new caller of a different security context SHALL:
re-assert that the trigger has no `current_user` guard; assert that it still fires from the new
caller; and hand-exercise the affected write path per `036`, because a raise inside a fan-out takes
the calling transaction down with it.

#### Scenario: The trigger has no `when` clause and none is added
- **WHEN** the trigger definition is examined before and after
- **THEN** it SHALL be unchanged and SHALL carry no `when (current_user = …)` clause
- **AND** the migration SHALL comment that adding one would silently disable the fan-out for the
  approval path, since `current_user` inside a definer function is the owner

#### Scenario: It fires from inside the approval RPC
- **WHEN** `approve_club_join_request` succeeds
- **THEN** the club's owner and admins SHALL each hold a `club_joined` notification with the
  approved rider as actor
- **AND** this SHALL be asserted directly, because the property depends on a trigger nobody in this
  change wrote

#### Scenario: The approved rider is not notified of their own join
- **WHEN** the same approval runs
- **THEN** the requester SHALL hold no `club_joined` row, because `notify_club_joined` excludes the
  actor
- **AND** they SHALL hold exactly one `club_join_request_approved` row, so the approval produces one
  notification for them and not two

#### Scenario: The default-club early return is unaffected
- **WHEN** `clubs.is_default` is true
- **THEN** `notify_club_joined` SHALL still return early
- **AND** no request path can reach that club anyway, because the discovery predicate excludes it —
  both guards SHALL exist and neither SHALL be removed on the strength of the other

### Requirement: A fan-out SHALL NOT write a row its recipient can never read, and where that forecloses the notification the fan-out SHALL be absent rather than silent

Restated here from the `notifications` delta because it is a property of the fan-out, not of the
table: `private.notify_club_join_requested` SHALL guard each recipient with
`private.can_read_club(candidate, new.club_id)`, and the approval notification SHALL be written only
after the membership row exists.

Where no ordering and no guard can make a recipient able to read a row — the decline case — **no
trigger SHALL be written for it**, and the migration SHALL say so in a comment at the point where a
reader would expect the third fan-out to be.

#### Scenario: Every written row is readable by its recipient at write time
- **WHEN** either fan-out writes
- **THEN** the recipient SHALL be able to select the row immediately afterwards under their own row
  security

#### Scenario: The absent third fan-out is commented, not merely missing
- **WHEN** the migration is read
- **THEN** the place a `notify_club_join_declined` would sit SHALL carry a comment naming `036` §3's
  club conjunct and the standing `notifications` requirement it would violate
- **AND** the absence SHALL be asserted: zero notifications after a decline

#### Scenario: Blocking is applied at fan-out as well as at read
- **WHEN** a requester is blocked with one of the club's admins
- **THEN** that admin SHALL receive no `club_join_requested` row
- **AND** the other admins SHALL, so the block is per-pair and not per-club

### Requirement: A fan-out whose actor is its own recipient SHALL be permitted only where that is the honest attribution, and SHALL be stated as an exception

The standing rule *"A rider SHALL NEVER be notified of their own action"* is expressed everywhere in
this repo as `where candidates.recipient <> new.user_id`, and every existing fan-out carries it.
`private.notify_club_join_request_declined` (`089`) is the **first and only** fan-out where
recipient and actor are deliberately the same rider, and it SHALL be recorded as an exception rather
than allowed to read as a missing exclusion.

The event being recorded is *"the club answered YOUR request"*, and the rider is the subject of their
own request. `actor_id` is NOT NULL and references `profiles`, so it must name somebody; every other
candidate discloses more (see the `notifications` delta). The self-actor is the only value that is
both honest and non-disclosing.

**The exclusion SHALL NOT be copied into this fan-out**, and the reason SHALL be in the function's
own comment, because the next reader's first instinct will be to add it and doing so would delete
every row this fan-out writes.

#### Scenario: The exclusion is absent, and its absence is asserted
- **WHEN** `private.notify_club_join_request_declined`'s `prosrc` is read
- **THEN** it SHALL contain no `recipient <> ` exclusion, and the assertion SHALL name the reason so
  a later "tidy" fails a test rather than silently emptying the feature

#### Scenario: Every other fan-out still excludes the actor
- **WHEN** the other fan-outs are inspected
- **THEN** each SHALL still exclude the actor, and each SHALL still be asserted separately — the
  exception SHALL NOT be generalised

### Requirement: A fan-out's recipient guard SHALL be the read policy's predicate, including when that predicate is a disjunction

`085` learned this once: a row written to somebody whose own policy will never return it is invisible
for ever and looks correct to every test that checks the row was inserted. The guard SHALL therefore
be the **whole** of the read predicate, subject-taking, and SHALL NOT be one convenient half of it.

For `club_join_request_declined` the read predicate is a disjunction, so the guard is:

```sql
private.can_read_club(new.user_id, new.club_id)
or private.club_takes_join_requests_for(new.user_id, new.club_id)
```

Both arms SHALL be present. The first alone drops every decline for a private club, which is the
entire feature. The second alone drops a decline for a club that has since flipped public or that
the rider has since joined.

Both SHALL be the **subject-taking** forms. `036` trap (c) is at its sharpest here for the second
one, because the caller-relative wrapper `private.club_takes_join_requests(uuid)` is the name a
policy uses two files away and would compute the answer for the **declining admin** rather than for
the requester — who is always able to see the club, so the guard would pass for everyone and guard
nothing.

#### Scenario: Both arms are exercised
- **WHEN** a decline is issued for a private club the rider may still request
- **THEN** a row SHALL be written, through the second arm
- **WHEN** a decline is issued for a club the rider is somehow a member of
- **THEN** a row SHALL be written, through the first arm

#### Scenario: A blocked requester gets no row at all
- **WHEN** a `blocks` row exists in either direction between the requester and the club's owner and
  a pending request is declined
- **THEN** **zero** notification rows SHALL be written, because both arms are false

#### Scenario: The guard uses the subject-taking twins
- **WHEN** the fan-out's `prosrc` is read
- **THEN** it SHALL mention `auth.uid()` **nowhere**, and SHALL call `can_read_club` and
  `club_takes_join_requests_for` in their two-argument forms

### Requirement: A retraction already hung on an event SHALL be reused rather than duplicated, and its scope SHALL be re-proved against every new type on the same event

`087` hung `private.retract_club_join_requested` on `after update of status`, which is the **same
event** `089`'s fan-out fires on. Two triggers on one event SHALL be permitted, and the new type
SHALL be protected from the existing retraction by that retraction's `type` conjunct rather than by
trigger ordering.

`085` wrote that conjunct for exactly this hazard — *"the `type` conjunct is what stops an approval
deleting the `club_join_request_approved` row it writes in the same transaction"* — and the same
sentence now has a second instance. Relying on alphabetical trigger order instead would be a
guarantee nothing states and nothing tests.

**No new retraction trigger SHALL be added for the decline**: an admin clearing a declined row
DELETEs it, and `085`'s delete-arm trigger already fires. Its scope SHALL be extended to remove the
decline notification as well as the request notification, in one function, so a future writer of
`status` inherits both halves automatically.

#### Scenario: The decline notification survives the retraction that fires beside it
- **WHEN** `decline_club_join_request` succeeds
- **THEN** the admins' `club_join_requested` rows SHALL be gone **and** the requester's
  `club_join_request_declined` row SHALL exist
- **AND** the assertion SHALL be order-independent — it SHALL NOT be satisfied by the two triggers
  happening to fire in a convenient sequence

#### Scenario: Clearing a declined row takes its notification with it
- **WHEN** an admin deletes a `declined` row
- **THEN** the requester's `club_join_request_declined` row SHALL be gone
- **AND** the rider SHALL be able to ask again, with no notification left claiming a refusal that no
  longer exists

#### Scenario: The retraction is scoped to its own event key
- **WHEN** two riders hold declines from the same club and one is cleared
- **THEN** only that rider's notification SHALL be removed, scoped by `user_id`, `type` and
  `club_id` together

### Requirement: The welcome fan-out SHALL address the joiner alone, and SHALL be computed by direct query

`private.notify_club_waved()` SHALL write exactly one notification per wave, addressed to
`new.subject_user_id` — the rider who joined — and to nobody else. The club's owner, its admins and
its other members SHALL receive nothing.

The recipient SHALL be read from the **row**, never from `auth.uid()` and never through a
caller-relative helper. The standing rule applies unchanged: a helper like
`private.is_club_member()` answers for the *caller*, and a fan-out's question is about the
*subject*.

The function SHALL be `security definer`, because no client role holds INSERT on `notifications`,
and SHALL carry `set search_path = ''`. Its trigger SHALL carry **no** `when` clause: `036` §7.8
records that copying `023`'s `when (current_user = 'authenticated')` would be correct on a
participation gate and wrong here, because the fan-out must fire for every writer including the
seed the RLS suite runs as.

**A wave on a thread SHALL notify nobody in this change.** The asymmetry is deliberate — see
`design.md` §Q2 — and is recorded so it is not read as an omission and "fixed" by a session adding
a `thread_id` column to `notifications`.

#### Scenario: Exactly one recipient
- **WHEN** a member waves another rider's join in a club with an owner, two admins and forty
  members
- **THEN** exactly one `notifications` row SHALL be written
- **AND** its `user_id` SHALL be the joiner and its `actor_id` the waver, both read from NEW

#### Scenario: The fan-out is exercised by hand before it reaches production
- **WHEN** the migration is applied to either project
- **THEN** the wave and un-wave paths SHALL be exercised by hand in a rolled-back transaction, as
  `authenticated`, on that project
- **AND** the resulting rows SHALL be **counted**, not assumed, per `036`'s gate

#### Scenario: No thread wave notifies
- **WHEN** a thread is waved any number of times
- **THEN** no `notifications` row SHALL be written
- **AND** `notifications` SHALL gain no `thread_id` column in this change

### Requirement: A rider SHALL NOT be notified of their own wave, and SHALL NOT be able to wave themselves

The fan-out SHALL exclude `new.user_id = new.subject_user_id`, and the INSERT policy SHALL refuse
that row outright.

**Both, and neither is redundant.** The WITH CHECK is the primary rule — a self-welcome expresses
nothing — and stops the row existing. The fan-out exclusion is the standing requirement that a
rider is never notified of their own action, and it holds if a future path writes the row by some
other means. `036` §7.6 places the actor exclusion **after** the recipient union for exactly this
reason.

#### Scenario: The self-wave never exists
- **WHEN** a rider attempts to wave their own join
- **THEN** the INSERT SHALL be refused by the WITH CHECK
- **AND** no notification SHALL be written, there being no row

#### Scenario: The exclusion survives a new writer
- **WHEN** any future path writes a `club_join_waves` row whose reactor is its subject
- **THEN** the fan-out SHALL still write nothing
- **AND** the exclusion SHALL be in the function body rather than relied upon from the policy

### Requirement: Blocking SHALL be applied at fan-out as well as at read, and the redundancy SHALL be stated truthfully

The fan-out SHALL exclude a recipient with whom the actor is blocked in either direction —
`not private.is_blocked(new.user_id, new.subject_user_id)`.

**This conjunct is redundant today and SHALL be written anyway, with the honest reason.** The
INSERT policy's `EXISTS` against `club_members` already carries that table's symmetric block arm on
`user_id`, so a rider blocked with the subject cannot create the wave at all. The reasons to write
it regardless:

1. The implication is a property of the **current** `club_members` SELECT policy, not of this
   table. A widened arm there breaks it with nothing announcing the transition.
2. The standing requirement is that blocking be applied twice, at fan-out and at read, and that the
   second is not optional. A fan-out relying on a sibling table's policy is applying it once.
3. It costs nothing measurable.

It SHALL NOT be justified as *"the policy alone is a leak"*, because it is not. `081`'s header
records what a false stated justification costs: the next session reads the reason, finds it does
not hold, and removes the conjunct.

#### Scenario: The redundancy is documented as redundancy
- **WHEN** the fan-out is written
- **THEN** its comment SHALL say that the conjunct is redundant today and why it stays
- **AND** SHALL NOT claim the INSERT policy admits a blocked pair

#### Scenario: The block still holds at read time
- **WHEN** a block is created after the notification row exists
- **THEN** the `notifications` read policy SHALL withhold the row from its recipient
- **AND** the fan-out SHALL NOT be responsible for cleaning it up

### Requirement: A wave retraction SHALL delete exactly the row its matching fan-out wrote

`private.retract_club_waved()` SHALL fire `after delete on public.club_join_waves` and SHALL delete
the notification scoped by **all four** of `user_id`, `type`, `actor_id` and `club_id`.

A subset scope would let one rider's un-wave delete another rider's notification, which is `036`
§7.2's recorded lesson and the reason that function names all four columns.

It SHALL also fire on cascaded deletes — a leave, a thread deletion, an account deletion — and that
is bounded and redundant rather than wrong. **No `pg_trigger_depth` guard SHALL be added**, per the
standing note on `retract_postcard_liked`.

**The wave/un-wave loop re-lighting a notification SHALL be accepted and named.** The unique index
means a wave cannot *stack*; a retraction followed by a fresh wave writes a fresh row and re-lights
it. `036` accepted that once, for likes, and this is the second acceptance. It is recorded here so
that it is a decision rather than an inheritance, and so that a rate limit — which this app has
nowhere — is a known future need rather than a surprise.

#### Scenario: One rider's un-wave leaves another's notification alone
- **WHEN** two riders have waved the same join and one un-waves
- **THEN** exactly one notification row SHALL be deleted
- **AND** the other rider's row SHALL survive, `actor_id` being in the scope

#### Scenario: A cascaded delete retracts too
- **WHEN** the join's `club_members` row is deleted, cascading its waves
- **THEN** each retraction SHALL fire and remove its notification
- **AND** the recipient SHALL not be left with a notification about a membership that no longer
  exists

#### Scenario: The loop is bounded by the uniqueness index
- **WHEN** a rider waves and un-waves repeatedly
- **THEN** at most one live notification SHALL exist for that `(recipient, type, actor, club)` at
  any moment
- **AND** the collapse SHALL come from `notifications_event_key` with `nulls not distinct`, which
  SHALL be verified rather than assumed

### Requirement: A fan-out SHALL NOT write a row its read policy can never return

`club_waved` SHALL carry `club_id` as its only subject, so the `notifications` read policy's club
arm decides its visibility. The recipient is a member of that club at the moment of writing — they
just joined it — so the row is readable when written.

**Where it later becomes unreadable, it SHALL drop rather than be cleaned up.** If the recipient
leaves a **private** club, `clubs` SELECT (`is_public OR owner_id = auth.uid() OR
is_club_member(id)`) stops admitting them and the notification disappears from their list. That is
the standing behaviour — a notification dies with its subject's visibility — and SHALL NOT be
compensated for by a second retraction trigger.

#### Scenario: The row is readable at the moment it is written
- **WHEN** the fan-out writes a `club_waved` row
- **THEN** its recipient SHALL be able to read it immediately
- **AND** the `notifications` policy SHALL be the thing that says so, not the fan-out

#### Scenario: Leaving a private club drops the notification
- **WHEN** the recipient leaves a private club in which they were welcomed
- **THEN** the notification SHALL no longer be returned to them
- **AND** no trigger SHALL be added to delete it, the read policy already answering

