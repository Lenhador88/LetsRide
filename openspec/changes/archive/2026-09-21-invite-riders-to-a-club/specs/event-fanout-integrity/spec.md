# event-fanout-integrity

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

**There are two ways to satisfy this requirement and only one of them is right here.** The rule says
a row the policy can never return is a defect *in the fan-out*, which reads as "do not write it". For
`club_invited` that would delete the feature: the whole point is to reach somebody outside the club.
The correct resolution is the **other** side — move the policy, narrowly and by type, so the row the
fan-out writes is returnable — and it is legitimate **only** because the recipient can already read
the subject by an existing path (`085`'s accessor). Where that is not true, the row must not be
written.

This distinction SHALL be stated wherever a fan-out addresses a recipient outside the subject's
ordinary audience, because the two remedies are indistinguishable from the fan-out's own body.

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

## ADDED Requirements

### Requirement: A fan-out whose writer is a `security definer` RPC SHALL carry no `current_user` guard, and its subject SHALL be read from the row

Both fan-outs this change adds SHALL be `after insert`/`after update` triggers with **no `when
(current_user = …)` clause**, and both SHALL read every rider from `NEW` rather than from
`auth.uid()`.

This is trap (a) and trap (b) restated for a change whose writers are RPCs: `decline_club_invite` is
`security definer`, so `current_user` inside it is the **owner** and a copied gate clause would
disable the decline fan-out entirely and silently; and `auth.uid()` is NULL in the RLS suite, in
psql and in a seed, so a guard written against it filters out every recipient exactly where it is
asserted.

Where a fan-out needs to know something about **somebody else** — whether the recipient can read the
club — it SHALL use the subject-taking `_for` helper, never the caller-relative wrapper. That is trap
(c), and it is at its sharpest here because the natural thing to type,
`private.has_live_club_invite(club_id)`, would compute the **actor's** answer and apply it to the
recipient.

#### Scenario: No gate clause on either fan-out
- **WHEN** `pg_get_triggerdef` is read for both
- **THEN** neither SHALL carry a `WHEN (CURRENT_USER = …)` clause

#### Scenario: No `auth.uid()` in either body
- **WHEN** `prosrc` is read for both fan-out functions
- **THEN** neither SHALL contain `auth.uid()`

#### Scenario: The decline fan-out fires from an RPC
- **WHEN** the invitee calls `decline_club_invite`
- **THEN** exactly one `club_invite_declined` row SHALL be written, addressed to the inviter, with
  the invitee as actor
- **AND** the count SHALL be asserted rather than assumed
