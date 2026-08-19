# event-fanout-integrity (delta)

> **⚠ COORDINATION.** This delta modifies two requirements: `The recipient set SHALL be computed
> by direct query, never through a caller-relative helper` and `A fan-out SHALL NOT write a row
> that the read policy can never return to its recipient`. **No other active change touches
> either as of 2026-08-17** — `tag-postcards-to-rides` and `grant-club-owner-member-reach` both
> *cite* this capability without carrying a delta for it. Re-check before archiving, because
> archiving replaces a requirement wholesale and whichever change archives second silently
> discards the first one's edit:
>
> ```bash
> grep -rn "Requirement: The recipient set SHALL be computed\|Requirement: A fan-out SHALL NOT write a row" \
>   openspec/changes/ --include=spec.md | grep -v archive/
> ```

## MODIFIED Requirements

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
