## ADDED Requirements

### Requirement: The two thread fan-outs SHALL satisfy every standing fan-out rule, and each SHALL be checked rather than assumed inherited

`private.notify_club_thread_replied`, `private.notify_club_thread_waved` and
`private.retract_club_thread_waved` SHALL each satisfy all ten of this capability's standing
requirements, and each of the ten SHALL be checked against them individually rather than declared
inherited.

Compliance SHALL NOT be argued from the capability's own purpose statement — *"the next fan-out this
app grows … inherits every rule here unchanged and must not rediscover them"* is a statement about
the rules, not a promise that any particular new fan-out obeys them.

| # | Standing requirement | How these three satisfy it |
|---|---|---|
| 1 | Performed by a trigger and by nothing else | Three `AFTER` row-level triggers. No action, no RPC and no Edge Function writes a notification |
| 2 | `security definer`, `search_path = ''`, EXECUTE revoked, in `private`, no `current_user` branch | All three, and no `WHEN` clause on any trigger |
| 3 | The actor read from the row, never `auth.uid()` | `new.author_id` for a reply, `new.user_id` for a wave; `auth.uid()` appears nowhere |
| 4 | The actor is never notified of their own action | `<> thread.author_id`, evaluated after the recipient is resolved |
| 5 | The recipient computed by direct query, never a caller-relative helper | One `join` to `club_threads`. `private.is_club_member` and `private.is_ride_crew` appear nowhere |
| 6 | Never write a row the read policy cannot return | The recipient is the thread's author and the conjunct is the thread — see the mapping below |
| 7 | A retraction deletes exactly the row its fan-out would have written | Four columns: `user_id`, `type`, `actor_id`, `thread_id` |
| 8 | At most one live notification per recipient per event; repeats do not stack | `notifications_event_key`, rebuilt with `thread_id`, absorbed by `on conflict do nothing` |
| 9 | A failure is not silently swallowed | No `exception when others` block anywhere; a raise aborts the rider's own write |
| 10 | Bounded, and not assumed small | **One row per event**, and that is the bound rather than an expectation |

#### Scenario: Each of the ten is asserted, not just reviewed

- **WHEN** the RLS suite exercises the two new fan-outs
- **THEN** it SHALL carry at least one assertion per row of the table above
- **AND** an assertion that only counts rows written SHALL NOT be accepted as covering rows 6 or 7

### Requirement: A thread fan-out SHALL run in the same security context as every other, and SHALL add no security advisor

`private.notify_club_thread_replied()`, `private.notify_club_thread_waved()` and
`private.retract_club_thread_waved()` SHALL each be `SECURITY DEFINER`, owned by the table owner,
with `SET search_path = ''`, every reference schema-qualified, and `EXECUTE` revoked from `public`,
`anon`, `authenticated` and `service_role`. All three SHALL live in the `private` schema. None SHALL
branch on `current_user`.

The definer context is necessary rather than stylistic: `authenticated` holds **no INSERT grant** on
`notifications`, so an invoker-rights trigger is refused outright, and the row is addressed to
somebody other than its writer.

**Their triggers SHALL carry no `WHEN` clause.** Copying `023`'s `WHEN (CURRENT_USER =
'authenticated')` is correct on the participation gate and wrong here: a fan-out must fire for every
writer, including a seed, a `security definer` RPC, `psql` and above all the writes the RLS suite
itself makes. A notification that silently does not happen for a privileged write is a gap with
nothing to detect it.

**Because all three live in `private`, the security-advisor count SHALL NOT move.** PostgREST
publishes only `public`, so `authenticated_security_definer_function_executable` cannot fire for
them. `085` adding eight `private` functions and zero advisors is the measured precedent; the count
moves by the number of **public** functions only.

#### Scenario: No client role can call any of the three

- **WHEN** `authenticated`, `anon` or `service_role` is checked against each function
- **THEN** `has_function_privilege(…)` SHALL be false for all three
- **AND** the assertion SHALL name the role rather than attempting the call, because the suite runs
  as the table owner for whom the barrier does not exist — `031`'s lesson

#### Scenario: The advisor count is unchanged after apply

- **WHEN** the security advisors are read against each project after applying the migration
- **THEN** the count and the name set SHALL be unchanged
- **AND** a new `authenticated_security_definer_function_executable` WARN SHALL mean a function
  landed in `public` or a `revoke` did not, and SHALL be treated as a failed apply
- **AND** the count SHALL be read off `get_advisors` rather than off any sentence in any document

#### Scenario: No branch on `current_user` exists in any of the three

- **WHEN** the fan-out and retraction code is reviewed
- **THEN** no `if current_user <> …` guard and no `WHEN (CURRENT_USER = …)` trigger clause SHALL
  appear
- **AND** the reason SHALL be recorded at the site, because the participation gate on the very same
  two tables carries that clause and is correct to

#### Scenario: `auth.uid()` appears nowhere in any of the three

- **WHEN** the code is reviewed
- **THEN** `auth.uid()` SHALL NOT appear
- **AND** the actor SHALL be `new.author_id` for a reply and `new.user_id` for a wave, each pinned to
  `auth.uid()` by its own table's INSERT policy, so reading the row is the same value in every
  context and correct where there is no JWT at all

### Requirement: The thread fan-outs SHALL NOT use a caller-relative membership helper

Recipient resolution SHALL be a direct join from the inserted row to `public.club_threads`.
`private.is_club_member` and `private.is_ride_crew` SHALL NOT appear in any of the three functions.

**Both read `auth.uid()` internally**, so each answers *"is the caller a member"* and never *"is this
candidate a member"*. A fan-out reaching for one computes the actor's own membership and applies that
single answer to every candidate — the set is either everybody or nobody, and it looks correct in a
one-member test. Where a candidate's membership genuinely must be evaluated, the subject-taking twin
`private.is_club_member_for(candidate, club)` is the only correct form; `private.is_blocked(a, b)` and
`private.can_read_club(candidate, club)` are the other two that take their subject as an argument.

#### Scenario: The single-recipient form STILL needs a membership test

- **WHEN** the recipient is `club_threads.author_id` for the thread the parent row belongs to
- **THEN** the fan-out SHALL still carry `private.is_club_member_for(t.author_id, t.club_id)`
- **AND** the tempting reasoning — *"the join is the whole recipient set, so no membership predicate
  is needed"* — SHALL be recorded as REFUTED rather than removed, because it is what this scenario
  said until migration `100` and it is what a reader re-derives in five seconds
- **AND** the refutation is that authorship is not membership at the moment the fan-out fires:
  `club_threads` INSERT required membership when the THREAD was created, and the fan-out runs when
  the REPLY is written. Nothing deletes a thread when its author leaves the club, so
  `A starts a thread → A leaves → B replies` writes A a row `club_threads` SELECT can never return
- **AND** a widening to prior repliers SHALL carry the same predicate per candidate

### Requirement: Blocking SHALL be written into both thread fan-outs even where the parent policy already implies it

Both fan-outs SHALL carry `not private.is_blocked(actor, recipient)` before writing.

**Stated honestly: the conjunct is redundant today.** `club_messages` INSERT and
`club_thread_waves` INSERT each carry an `EXISTS` against `club_threads` evaluated under the caller's
own row security, and `club_threads` SELECT withholds a thread from anyone blocked with its author —
so a rider blocked with the thread's author cannot write the parent row at all, and this line can
never be what refuses one. It is **not** true that the policy alone is a leak.

It is written anyway for three reasons: the implication is a property of the **current**
`club_threads` SELECT policy rather than of these tables, and a widened arm there would break it with
nothing announcing the transition; the standing requirement is that blocking is applied **twice**, at
fan-out and at read, and a fan-out leaning on a sibling policy applies it once; and it costs nothing
measurable. This is `092`'s reasoning at `notify_club_waved`, transferred rather than re-derived.

#### Scenario: A block existing before the action produces no row at all

- **WHEN** a block exists in either direction between a would-be replier or waver and the thread's
  author, and the parent write is made as the table owner so the policy cannot refuse it
- **THEN** zero notification rows SHALL be written
- **AND** the assertion SHALL be made as the owner precisely because a client cannot reach this
  state, so a client-level assertion would pass vacuously

#### Scenario: A block created after the row hides it

- **WHEN** a `club_thread_replied` or `club_thread_waved` row exists and a block is then created in
  either direction
- **THEN** the recipient's next read SHALL NOT return it, and the unread count SHALL fall by the same
  number
- **AND** this SHALL be asserted with the two riders exchanged, because the row is directional and the
  effect symmetric

#### Scenario: Unblocking restores the row rather than resurrecting a deleted one

- **WHEN** the block is removed
- **THEN** the notification SHALL be returned again with its original `created_at` and read state
- **AND** nothing SHALL have deleted it in the meantime

### Requirement: A thread fan-out SHALL write at most one row per event, and its bound SHALL be stated

Each thread fan-out SHALL be a single `INSERT … SELECT` writing **at most one row**, inside the
writer's own transaction. It SHALL NOT iterate, and it SHALL NOT scale with club size.

The bound, stated rather than discovered:

- **One message writes at most one notification row.** A 500-member club and a 3-member club cost the
  same. This is the tightest bound of any fan-out in this schema.
- **At most one live row per `(thread author, actor, thread)`**, because `actor_id` and `thread_id`
  are both in the collapse key. A thread with 40 distinct repliers accumulates at most 40 rows over
  its life, all addressed to one rider.
- **A thread wave is bounded additionally by `club_thread_waves`' primary key `(thread_id, user_id)`**,
  which admits one wave per rider per thread at a time.

**The number to watch is not club size but the recipient count**, and it is 1 by design. Answering
`proposal.md` Q1 `yes` changes it to *(distinct prior repliers)* per message — PD-368's exception
taken a second time, on a chat surface — and that is the point at which this requirement needs
rewriting rather than extending.

#### Scenario: The fan-out is one statement, not a loop

- **WHEN** either thread fan-out runs
- **THEN** it SHALL be a single `INSERT … SELECT`
- **AND** it SHALL NOT iterate per recipient

#### Scenario: The recipient lookup is index-served

- **WHEN** the recipient is resolved
- **THEN** it SHALL be a primary-key lookup on `club_threads` by the parent row's `thread_id`
- **AND** it SHALL NOT be a scan

#### Scenario: A busy thread does not become a busy notification list

- **WHEN** one rider posts many messages in one thread
- **THEN** the recipient SHALL hold exactly one row for that rider and that thread
- **AND** the collapse SHALL come from the index rather than from any application-level throttle,
  because nothing in this app rate-limits anything

### Requirement: A thread fan-out failure SHALL take the rider's write down with it

Neither fan-out nor the retraction SHALL catch and discard an exception. A raise SHALL abort the
transaction containing it.

The cost is stated rather than hidden: **from the moment `098` applies, a bug in either fan-out takes
down every reply and every thread wave in every club simultaneously**, because each runs inside the
rider's own transaction. That is why this migration is additive in schema and **not inert**, and why
`036`'s hand-exercise gate applies: both write paths SHALL be exercised by hand on DEV, in a
rolled-back transaction, as `authenticated`, with rows counted rather than assumed, before PROD.

#### Scenario: The uniqueness collapse is not an error

- **WHEN** a repeat would violate `notifications_event_key`
- **THEN** it SHALL be absorbed by `on conflict do nothing` rather than raised
- **AND** it SHALL NOT be handled by an `exception when unique_violation` block, which would also
  hide a real fault

#### Scenario: A refused parent write leaves nothing behind

- **WHEN** a reply or a wave is refused by RLS, by a CHECK or by the participation gate
- **THEN** zero notification rows SHALL exist afterwards, because an `AFTER` trigger never runs

#### Scenario: The blast radius is named before the migration applies

- **WHEN** `098` is applied to a project
- **THEN** the two affected write paths SHALL have been exercised on DEV first
- **AND** the migration header SHALL name them, because a purely-additive reading of this file is
  wrong and is the reading a reviewer will default to

## MODIFIED Requirements

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
| `club_invited` | the invitee, one named rider read from `NEW` | **not** the ordinary `clubs` `EXISTS` for a private club — the type-scoped `club_invited` disjunct, whose predicate is the live invite itself |
| `club_invite_declined` | the inviter, one named rider read from `NEW` | `clubs` SELECT, satisfied because the inviter is a member or the owner |
| **`club_thread_replied`** | **`club_threads.author_id`** | **`club_threads` SELECT — and the arm that returns it is `private.is_club_member(club_id)`, NOT the author's own-row arm** |
| **`club_thread_waved`** | **`club_threads.author_id`** | **the same** |

**There are two ways to satisfy this requirement and only one of them is right here.** The rule says
a row the policy can never return is a defect *in the fan-out*, which reads as "do not write it". For
`club_invited` that would delete the feature: the whole point is to reach somebody outside the club.
The correct resolution is the **other** side — move the policy, narrowly and by type, so the row the
fan-out writes is returnable — and it is legitimate **only** because the recipient can already read
the subject by an existing path (`085`'s accessor). Where that is not true, the row must not be
written.

This distinction SHALL be stated wherever a fan-out addresses a recipient outside the subject's
ordinary audience, because the two remedies are indistinguishable from the fan-out's own body.

**The two new rows carry a trap that reads the opposite way round from `club_joined`'s, and it SHALL
be recorded at both sites.** `club_threads` SELECT is
`EXISTS(clubs) AND private.is_club_member(club_id) AND (author_id = auth.uid() OR NOT
private.is_blocked(auth.uid(), author_id))`. The author's own-row test sits **inside the block
conjunct**, not ahead of the membership one — so **authoring a thread is not sufficient to read it.**
The recipient is a subset of the resolving set *only while they remain a member*, and the moment they
leave, the row is evicted rather than deleted. That is the correct behaviour and it is the standing
eviction ruling, but a reviewer reading "the recipient is the author, so the own-row arm resolves it"
would be reasoning from `postcards`' policy shape, which is the opposite one.

**Both thread fan-outs SHALL carry `private.is_club_member_for(t.author_id, t.club_id)`, and a
widening to prior repliers SHALL carry it per candidate.** `club_members` DELETE is a bare
`auth.uid() = user_id` with no owner carve-out, so an author who has left is reachable in one
request — and until migration `100` both fan-outs wrote that rider a row their own SELECT policy
could never return, which is the defect this capability's own *"a row the policy drops on every read
from the instant it is written"* requirement names. It is NOT the eviction ruling above: that covers
a row readable when written; this one never was.

**An earlier revision of this paragraph also told a widening to "exclude a club owner holding no
`club_members` row — the same ownerless-owner case that narrows `ride_created_in_club` to members
alone", and BOTH halves of that were false.** Recorded rather than deleted, because it is the
sentence a future widening would have followed:

- The two instructions contradict each other. `private.is_club_member_for` **includes** the
  ownerless owner — its body is `exists(club_members …) or exists(clubs where owner_id =
  candidate)` — so one predicate cannot both be carried and exclude them.
- `ride_created_in_club` does **not** narrow to members alone. Measured off `prosrc` on DEV:
  `private.notify_ride_created_in_club` unions `clubs.owner_id`, and `060`'s own comment at the
  site says why — *"`036` §7.5 withheld this arm because `is_club_member` had no owner arm; `054`
  gave it one."*

Including the ownerless owner is therefore correct here for the same reason it is correct there:
`club_threads` SELECT resolves through `private.is_club_member`, which delegates to the same twin,
so the recipient set is now **equal** to the set the policy returns to rather than a superset.

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

#### Scenario: The invite fan-out and the policy arm move together
- **WHEN** either the `club_invited` recipient set or the type-scoped policy disjunct changes
- **THEN** the other SHALL be re-derived from the live policy text in the same migration
- **AND** an assertion SHALL confirm the written row is returned to its recipient in the same
  transaction, which is the self-consistency check that fails the day the two drift

#### Scenario: A recipient who cannot read the subject by any path is not written to
- **WHEN** a candidate recipient could not read the club through `clubs` SELECT **and** could not
  reach it through `discoverable_private_clubs` — a rider blocked with the owner, for instance
- **THEN** no row SHALL be written for them, and the fan-out SHALL exclude them by predicate rather
  than relying on the read policy to hide it

#### Scenario: The check is asserted for the two new types, not only reviewed

- **WHEN** the RLS suite exercises the thread fan-outs
- **THEN** it SHALL assert that the recipient can **read the row back** under their own session, not
  merely that a row was written
- **AND** it SHALL assert the eviction case too — the same rider, after leaving the club, reading
  zero — because the whole failure this requirement names is a row that exists and is unreadable

#### Scenario: A row is never written to an ownerless owner

- **WHEN** a club's `owner_id` holds no `club_members` row and a thread in that club is replied to
- **THEN** no row SHALL be written to that owner
- **AND** this holds trivially today because the recipient is the thread's author, and SHALL be
  asserted anyway, because it is the invariant a widening would break silently

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

A retraction SHALL scope its delete by the **full** key the insert would have used — `user_id`,
`type`, `actor_id` and the subject column together — and SHALL NOT match on any subset of it.

**A fan-out MAY have no retraction at all, and where it does not, the absence SHALL be a stated
decision with the degradation it implies.** `090` measured the cost of the obvious choice: with a
retraction on withdrawal, a withdraw-and-re-send cycle deletes the row and writes it again, so
`notifications_event_key` never collides and the recipient can be notified once per cycle, without
limit — the harassment shape the index exists to prevent, reachable with two buttons. **The index is
the only rate limit this app has, and it only works while nothing clears the row underneath it.**

`club_invited` therefore ships with **no retraction**, and the two consequences `090` names apply
unchanged: a withdrawn invite leaves its notification standing, and a re-send to a rider who already
dismissed the first one is silent.

Every retraction SHALL scope its delete by the **full** key the matching insert would have used —
the recipient, the type, the actor and the subject together — and SHALL NOT match on any subset of
it. For `club_thread_waved` that is `user_id`, `type`, `actor_id` and `thread_id`.

The scope is index-served for free: `(user_id, type, actor_id, …)` is a prefix of the rebuilt
uniqueness index, whose column order is unchanged for its first seven columns.

**A retraction SHALL NOT be added for every deletable parent.** Where the parent's DELETE is
controlled by the **actor** and the notification's subject is not that parent row — a reply, whose
subject is the thread — no retraction SHALL be created, because it would clear a row other surviving
rows still justify and would make post-delete-post an unbounded notification generator.

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

#### Scenario: The absent retraction is recorded rather than omitted
- **WHEN** the migration is reviewed
- **THEN** it SHALL state that no `after delete` retraction exists for `club_invited`, why, and what
  the standing row degrades to

#### Scenario: A withdrawn invite's notification degrades rather than misleads
- **WHEN** an invite is withdrawn and its recipient opens their notifications
- **THEN** the row SHALL render as plain text with **no** Accept or Decline control, because the
  controls read the live invite through `my_live_club_invites()` and not the notification
- **AND** tapping it SHALL open the club where the rider can still read it and SHALL be inert where
  they cannot, never a dead link

#### Scenario: Re-sending does not re-notify
- **WHEN** the same admin withdraws and re-sends an invite to the same rider for the same club
- **THEN** `on conflict do nothing` against `notifications_event_key` SHALL absorb the second write,
  `read_at` and `created_at` SHALL keep their original values, and the row SHALL not return to the
  top of the list

#### Scenario: One rider's un-wave does not clear another rider's notification

- **WHEN** riders A and B have both waved the same thread and A un-waves
- **THEN** A's row SHALL be removed and B's SHALL survive
- **AND** this SHALL be asserted with two actors, because a single-actor assertion cannot fail

#### Scenario: The retraction cannot reach another thread's row

- **WHEN** a rider has waved two threads by the same author and un-waves one
- **THEN** only the row naming the un-waved thread SHALL be removed
- **AND** this SHALL be asserted, because `thread_id` is the column the seven-column key did not have

#### Scenario: A retraction that would fire on an actor-controlled delete of a non-subject parent is refused

- **WHEN** a retraction on `club_messages` DELETE is considered
- **THEN** it SHALL NOT be created
- **AND** the reason SHALL be recorded at the site, because its absence is otherwise
  indistinguishable from an oversight
