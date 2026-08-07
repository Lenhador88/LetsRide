## Purpose

Which events tell which rider that something happened, who must never receive or read a
notification, and what a row does once the visibility decision that produced it has changed —
because a notification is written once and read for ever, and nothing re-checks it unless the
policy does.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** The exceptions are named as such: the
security-advisor sweep, and any assertion about a grant that must name a *role* rather than
attempt a statement, because the suite runs as the table owner for whom neither RLS nor the
`private` USAGE barrier exists (`031`'s lesson).

## ADDED Requirements

### Requirement: A notification SHALL be readable by its recipient and by nobody else

`public.notifications` SHALL be readable only by the rider named in `user_id`. There SHALL be no
route by which any other rider — including the actor who caused it, the author of the subject, a
club owner, a ride organizer or a blocked party — reads, counts or enumerates it.

The recipient is the *only* role with any read right. This is narrower than every other table in
this schema, all of which admit some second party, and stating it as a requirement is what stops
an implementer reaching for a `postcard_comments`-shaped `EXISTS` that admits the subject's
audience.

#### Scenario: The recipient reads their own notifications
- **WHEN** the rider named in `notifications.user_id` reads the table
- **THEN** their own rows SHALL be returned, subject to the resolvability rule below

#### Scenario: Another rider reads nothing
- **WHEN** any signed-in rider other than the recipient reads `notifications`, by any filter
  including a known row id
- **THEN** zero rows SHALL be returned

#### Scenario: The actor cannot see what they caused
- **WHEN** the rider named in `actor_id` reads `notifications` for the row their own action wrote
- **THEN** zero rows SHALL be returned
- **AND** they SHALL have no way to learn that the notification exists, was delivered, or was read

#### Scenario: A postcard author cannot enumerate who was notified
- **WHEN** a rider who authored a postcard, organises a ride or owns a club reads `notifications`
  for rows naming their own resource as the subject
- **THEN** zero rows SHALL be returned unless they are themselves the recipient
- **AND** the count of riders notified SHALL NOT be derivable from any read they can issue

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `notifications` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on the table
- **AND** this change SHALL add none, per decision #1

### Requirement: A notification SHALL be dropped by the database when its subject is no longer visible to its recipient, not filtered by a screen

The SELECT policy SHALL require, in addition to `user_id = auth.uid()`, that **every** resource the
row's copy renders is still returned to the caller under the caller's **own** row security —
expressed as an `EXISTS` per resource, evaluated under the caller's RLS, and **conjoined** where a
type renders more than one.

**A type is not limited to one subject table, and stating it as one is how a leak gets specified.**
`ride_created_in_club` sets both `ride_id` and `club_id`, and renders both — the club's name in the
copy, the ride as the destination. Naming one table per type forces a choice and both choices are
wrong: `clubs` alone leaks a public club's private ride (the row renders "created a ride in ‹club›"
for a ride the rider cannot open), and `rides` alone leaves the club name renderable when the club
is not. The conjunct set is therefore fixed per type and stated here rather than derived:

| Type | Subject columns | `EXISTS` conjuncts, all required |
|---|---|---|
| *(every type)* | `actor_id` | `profiles` — see the actor requirement below |
| `postcard_liked` | `postcard_id` | `postcards` |
| `postcard_commented` | `postcard_id`, `comment_id` | `postcards` **AND** `postcard_comments` |
| `ride_joined` | `ride_id` | `rides` |
| `club_joined` | `club_id` | `clubs` |
| `ride_created_in_club` | `ride_id`, `club_id` | `rides` **AND** `clubs` |

**The actor is a rendered resource and therefore a conjunct on every row, not a special case.** Every
row's copy begins with the actor's username. A row whose actor does not resolve renders nothing, so
it must not be returned — and an earlier revision of this spec left `profiles` out of the conjunct
set and pushed the case to the screen, which is the client-side visibility filter this same
requirement forbids two paragraphs above.

**Ride-implies-club is a derivation from today's policy text and SHALL NOT be relied on to collapse
the last row to one conjunct.** It holds against `rides` SELECT as measured on 2026-08-07, but that
policy has already been rewritten twice — by `017` and by `022` — and nothing in this spec or any
other constrains it to keep the property. The conjunction is cheap and does not go stale; the
derivation does.

#### Scenario: A type rendering two resources requires both to resolve
- **WHEN** a `ride_created_in_club` notification is read
- **THEN** it SHALL be returned only if **both** the ride and the club resolve for the reader
- **AND** the leak this closes SHALL be asserted directly: a **public** club, a ride whose
  `is_public` is false, and a reader who has left that club — the club resolves, the ride does not,
  and the row SHALL NOT be returned
- **AND** the assertion SHALL NOT be replaced by one relying on ride-visibility implying
  club-visibility, because that is a property of the current `rides` policy and not of this contract

**This is the whole reason the change stores ids rather than a text snapshot, and it is the
requirement most likely to be dropped as "we can just filter in the client".** A fan-out-time
check answers a question that was true when the row was written. A rider who leaves a private
club, is removed from it, or loses a ride when its club turns private, holds notification rows
whose copy names a resource they may no longer see. If the only control is fan-out, they keep
reading it for ever.

**Filtering it in a screen is forbidden by decision #2's own reasoning and is worse here than for
blocks**, because the count RPC and the list are two different reads: a client-side filter makes
them disagree by construction, and the disagreement is visible as a badge that never clears.

#### Scenario: A rider who leaves a private club loses its notifications
- **WHEN** a rider holding a `ride_created_in_club` or `club_joined` notification for a private
  club leaves that club
- **THEN** their next read SHALL return zero rows for it
- **AND** the unread count SHALL fall by the same number, in the same instant, because both read
  through the same policy

#### Scenario: A public club's notifications survive leaving, and that asymmetry is deliberate
- **WHEN** the same rider leaves a **public** club
- **THEN** the notification SHALL still be returned, because `clubs` SELECT admits any signed-in
  rider to a public club and the subject therefore still resolves
- **AND** this SHALL be asserted separately from the private case, because a single assertion
  cannot say which arm of the club policy did the work

#### Scenario: A club turning private retracts its ride notifications from non-members
- **WHEN** a public club is set private, and its rides therefore cease to be public
- **THEN** riders who are not members of that club SHALL stop reading `ride_created_in_club`
  notifications for its rides
- **AND** nothing SHALL delete those rows, so a rider who rejoins SHALL read them again

#### Scenario: A notification about your own resource always resolves
- **WHEN** the recipient reads a `postcard_liked`, `postcard_commented` or `ride_joined`
  notification whose subject they authored or organise
- **THEN** the subject SHALL always resolve, because `postcards` SELECT and `rides` SELECT each
  carry an own-row arm ahead of every other predicate
- **AND** this SHALL hold even if they have hidden their own postcard, because `postcard_hides` is
  an input to the *other* arm of that policy only

#### Scenario: A comment notification stops being returned by three different mechanisms, and they SHALL NOT be conflated
- **WHEN** a `postcard_commented` notification stops reaching its recipient
- **THEN** the cause SHALL be one of exactly three, each asserted separately because each is a
  different mechanism and a single assertion cannot say which fired:
- **AND** the comment being **deleted** SHALL remove the row outright, by the `comment_id`
  `ON DELETE CASCADE` — a deletion, not an eviction, so unblocking or restoring nothing brings it
  back
- **AND** the commenter being **blocked** SHALL evict it by the `not private.is_blocked(auth.uid(),
  actor_id)` conjunct on `notifications` itself — not by the `postcard_comments` policy, whose own
  block arm names the same pair and is therefore redundant here rather than load-bearing
- **AND** the **postcard** being deleted SHALL remove it by the `postcard_id` cascade, taking the
  comment with it
- **AND** an earlier revision of this scenario was titled *"Hiding the postcard a comment sits on
  retracts the comment notification"*, which asserted the **opposite** of the own-resource scenario
  above and is false: the recipient of a `postcard_commented` row is by construction the postcard's
  author, whose own-row arm on `postcards` sits ahead of the hide predicate. A hide retracts nothing

#### Scenario: Hiding your own postcard retracts nothing, which is the deliberate reading
- **WHEN** the postcard's author hides their own postcard and then reads their notifications
- **THEN** every `postcard_liked` and `postcard_commented` row naming it SHALL still be returned
- **AND** this SHALL be asserted rather than inferred, because `postcard_hides` is an input to the
  `postcards` SELECT policy and it is only the *ordering* of that policy's arms that makes the answer
  come out this way

#### Scenario: An organizer flipping a ride's own `is_public` is a second, independent retraction path
- **WHEN** the organizer of a club ride sets `rides.is_public` to false directly, rather than the
  club being turned private
- **THEN** riders who received `ride_created_in_club` and have **since left** that club SHALL stop
  reading it, because neither arm of `rides` SELECT admits them any more
- **AND** riders who are still members SHALL keep reading it, because the club-member arm does not
  consult `is_public` at all
- **AND** both paths SHALL be asserted, because the spec previously named only the club turning
  private and an organizer can reach the same outcome through a column on their own row

#### Scenario: The resolvability conjunct is not simplified away
- **WHEN** the SELECT policy is reviewed, refactored or replaced
- **THEN** the subject `EXISTS` SHALL remain and SHALL carry a policy comment saying why
- **AND** removing it SHALL fail at least two assertions rather than passing quietly

### Requirement: Blocking SHALL be applied twice — at fan-out and at read time — and the second SHALL NOT be optional

A notification SHALL NOT be written for a recipient who is blocked by, or has blocked, the actor;
**and** a notification already written SHALL stop being returned the moment a block exists in
either direction. Both SHALL be enforced through `private.is_blocked(a, b)`, never by querying
`blocks` from a policy.

The two checks answer different questions and neither implies the other. Fan-out asks *"is this
blocked now"*; read time asks *"is it blocked now"* at a later now. **A block created after the
row still has to hide it**, and that is the case a fan-out-only design silently fails. Blocking is
symmetric even though the row is directional (decision #2), so one `is_blocked` call covers both
directions.

`private.is_blocked(a uuid, b uuid)` takes both parties as arguments — verified 2026-08-07 — which
is what makes it usable at fan-out. `private.is_club_member` and `private.is_ride_crew` read
`auth.uid()` internally and answer only for the caller, so neither may be used to evaluate a
candidate recipient.

#### Scenario: A block existing before the action produces no row at all
- **WHEN** rider A likes, comments on, joins or creates something that would notify rider B, and a
  block exists between them in either direction
- **THEN** no `notifications` row SHALL be written
- **AND** A's own write SHALL still succeed, because the block suppresses the notification and not
  the action

#### Scenario: A block created after the row hides it
- **WHEN** a notification exists naming A as actor and B as recipient, and B then blocks A — or A
  blocks B
- **THEN** B's next read SHALL NOT return it
- **AND** the unread count SHALL fall by the same number
- **AND** this SHALL be asserted with A and B exchanged, because the row is directional and the
  effect symmetric

#### Scenario: Unblocking restores the notification rather than resurrecting a deleted row
- **WHEN** the block is removed
- **THEN** the notification SHALL be returned again, with its original `created_at` and its
  original read state
- **AND** nothing SHALL have deleted it in the meantime, because deletion is irreversible and a
  block is not

#### Scenario: Blocking does not retract notifications about third parties
- **WHEN** B blocks A
- **THEN** B SHALL keep every notification whose actor is somebody other than A, including
  notifications about the same postcard, ride or club
- **AND** no gap, count or marker SHALL indicate that any row was removed, because that discloses
  the block

#### Scenario: No screen applies a block filter
- **WHEN** the notification list or the unread count is rendered
- **THEN** no component, data function or action SHALL filter by block
- **AND** the policy SHALL remain the single place the rule lives, per decision #2

### Requirement: A rider SHALL NOT learn a private club's name, or a private ride's title, from a notification

A notification row SHALL carry no denormalised text describing its subject. Every rendered string
naming a club, ride, postcard or rider SHALL be read from that resource under the reader's own row
security at the moment of rendering.

**A snapshot is a second copy of a visibility decision and nothing re-checks it.** A
`club_name text` column would be readable by its recipient for ever, including after they left the
club, were removed from it, or were blocked by everyone in it — and the row would look perfectly
correct to any reviewer, because the value in it was true when it was written.

#### Scenario: No column holds a name, title or caption
- **WHEN** the table is created
- **THEN** it SHALL carry no `club_name`, `ride_title`, `actor_username`, `postcard_caption`,
  `body`, `message` or equivalent column
- **AND** the copy SHALL be composed at render time from `type` plus resources read separately

#### Scenario: A non-member never receives a private club's name
- **WHEN** a rider who is not a member of a private club holds any notification naming it
- **THEN** the club SHALL not resolve, the row SHALL not be returned, and the club's name SHALL
  never reach their device
- **AND** the club's `id` reaching their device in an earlier response SHALL disclose nothing,
  because every read of that id is refused

#### Scenario: A ride's title follows the ride's own policy
- **WHEN** a notification names a ride the reader can no longer see
- **THEN** the title SHALL not be fetchable and the row SHALL not be returned

#### Scenario: An unresolvable actor evicts the row in the database, because that state is reachable
- **WHEN** the actor's profile is not returned to the reader — blocked, **or `username` NULL**
- **THEN** the row SHALL NOT be returned by the SELECT policy, by the same `EXISTS` mechanism the
  subject uses, so the unread count falls with the list in the same instant
- **AND** the row SHALL NOT be rendered with a placeholder name, an id, or "someone"
- **AND** no component SHALL drop it after the fact, which is what an earlier revision of this
  contract prescribed — *"render nothing for a row whose actor does not resolve"* — and which is
  simultaneously a nonzero count over an empty list and a component-level visibility filter, both
  forbidden by this change's own `client-cache-invalidation` delta

#### Scenario: The NULL-username state is reachable today and the contract SHALL NOT assume it closed
- **WHEN** the reachability of an unresolvable actor is assessed
- **THEN** it SHALL be recorded as **reachable in one request by any rider**, verified against
  `zwprydcyryvudhurbnye` on 2026-08-07, and not as a defect that cannot occur:
  `has_column_privilege('authenticated','public.profiles','username','UPDATE')` is **true**; the
  CHECK is `username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'`, which NULL passes; and
  `enforce_onboarding_completion` guards only `terms_accepted_at` and `onboarding_completed_at` —
  for an already-onboarded rider it pins completion and **returns early**, so `username` is never
  reached
- **AND** the consequence SHALL be stated: `profiles` SELECT is
  `(auth.uid() = id) OR (username IS NOT NULL AND NOT is_blocked(…))`, so a rider who nulls their
  username vanishes from every other rider's read of them while their notification rows survive
- **AND** the eviction SHALL be an eviction rather than a deletion — restoring the username SHALL
  return every row, with its original `created_at` and read state — because the underlying hole is
  somebody else's to close and this change SHALL behave correctly whether it is open or shut
- **AND** the hole itself SHALL be filed as its own issue rather than fixed here, because a
  column-privilege change on `profiles` is not this change's blast radius

### Requirement: A rider SHALL NOT be able to write, forge, retitle or dismiss a notification

`authenticated` SHALL hold **no INSERT grant** on `notifications` and the table SHALL carry **no
INSERT policy**. `authenticated` SHALL hold **no DELETE grant** and no DELETE policy. UPDATE SHALL
be confined to `read_at`, on the caller's own rows only, and **the UPDATE policy's predicate SHALL
be identical to the SELECT policy's** — the same recipient, block and resolvability conjuncts, in
both `using` and `with check`.

**No write path SHALL reach a row no read path returns**, and this is the specific rule rather than a
general instinct. An UPDATE policy of `user_id = auth.uid()` alone is *wider* than SELECT, so `update
notifications set read_at = now() where read_at is null` touches rows the rider cannot see, and the
affected-row count PostgREST reports is a number they can compare against the list they were shown.
The difference is the count of hidden rows, and the commonest reason a row is hidden is a block —
which this change elsewhere requires SHALL never be disclosed by *"any gap, count or marker"*. A
wider UPDATE policy is that marker.

An earlier revision made the widening deliberate, so that "mark all read" would clear evicted rows
too. That justification does not survive inspection: an evicted row is in neither the count nor the
list, so leaving it unread has no observable effect, and if the eviction is later reversed — the
block lifted, the club rejoined, the username restored — the row returning **unread** is the correct
answer, because the rider never saw it.

Whether PostgREST surfaces the affected-row count on a `PATCH` is not the load-bearing question and
SHALL NOT be treated as one: a write reaching a row a read cannot is a contract defect whether or not
today's client library happens to expose the number.

The client owns the mutation path. A client that can insert a notification can forge one — "Zola
liked your postcard" from a rider who did not — and can decline to write the ones it should. The
absence of the grant is what makes the trigger the only writer; the absence of the policy alone
would not, because a grant with no policy still fails *closed* only by accident of RLS being on.

**No DELETE, and that is a decision rather than an omission**: `Inbox - Notifications` draws no
dismiss, swipe or clear affordance on any row, and a rider who could delete a notification could
delete the evidence that they were told something.

#### Scenario: A rider cannot insert a notification
- **WHEN** any signed-in rider attempts to insert into `notifications`, for themselves or for
  anyone else
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL be backed by the **absent grant** as well as the absent policy, so
  that a future policy written too permissively does not open it
- **AND** the assertion SHALL name the role — `has_table_privilege('authenticated', …)` — because
  the RLS suite runs as the table owner, for whom the grant does not apply

#### Scenario: A rider cannot delete a notification
- **WHEN** the recipient attempts to delete their own notification row
- **THEN** the statement SHALL be refused
- **AND** the row SHALL survive, and the surviving row SHALL be the assertion

#### Scenario: A rider cannot change anything but their own read state
- **WHEN** the recipient attempts to update `type`, `actor_id`, `user_id`, `created_at` or any
  subject id on their own row
- **THEN** the write SHALL be refused by the absence of a column grant, not merely by a policy

#### Scenario: A rider cannot mark somebody else's notification read
- **WHEN** a rider updates `read_at` on a row whose `user_id` is not their own
- **THEN** the statement SHALL match zero rows and change nothing

#### Scenario: Mark-all-read touches exactly the rows the list shows
- **WHEN** the recipient holds unread notifications of which some are evicted — by a block, by an
  unresolvable subject, or by an unresolvable actor — and they mark all read
- **THEN** the number of rows affected SHALL equal the number the unread count reported, exactly
- **AND** the evicted rows SHALL be untouched, so no arithmetic on the response can reveal that any
  exist
- **AND** this SHALL be asserted by comparing the affected count against
  `unread_notification_count()` taken immediately before, rather than by inspecting the table as the
  owner, because the owner sees the rows the policy hides

#### Scenario: An eviction that is reversed returns the row unread
- **WHEN** a block is lifted, a club rejoined, or an actor's username restored after the recipient
  marked everything read
- **THEN** the returning row SHALL still be unread if it was unread when it was evicted
- **AND** that SHALL be the intended behaviour rather than a leak, because the rider genuinely has
  not seen it

#### Scenario: `created_at` is server-owned
- **WHEN** a notification is written
- **THEN** its `created_at` SHALL be server time, and no client-supplied value SHALL be capable of
  reaching it, because the client cannot insert at all
- **AND** ordering SHALL therefore never depend on a device clock

#### Scenario: Marking read is idempotent and reversible only by the rider
- **WHEN** the recipient marks a notification read twice, or marks all read
- **THEN** the result SHALL be the same
- **AND** setting `read_at` back to NULL SHALL be permitted, because it affects only their own
  read state and no other rider can observe it

### Requirement: A notification SHALL die with its subject, its actor, its recipient and its club

Every foreign key on `notifications` SHALL be `ON DELETE CASCADE`, including `user_id → profiles`
and `actor_id → profiles`. A notification whose subject, actor or recipient no longer exists SHALL
NOT survive as a tombstone.

This is the reason the subject is typed columns rather than a polymorphic `subject_id`: a
polymorphic column can carry no foreign key, so nothing cascades, and deleting a postcard leaves a
notification pointing at a row that no longer exists with nothing to detect it. See `design.md`
§D1.

**Account deletion is the case that reaches two levels down and is invisible in any single foreign
key**, so it is stated rather than left to be discovered — the same failure `029` records for
clubs and postcards.

#### Scenario: Deleting the postcard destroys its notifications
- **WHEN** a postcard is deleted
- **THEN** every `postcard_liked` and `postcard_commented` notification naming it SHALL be removed

#### Scenario: Deleting a comment destroys its notification only
- **WHEN** a comment is deleted — by its author, or by the postcard's author through
  `moderate_comment()`
- **THEN** the `postcard_commented` notification naming it SHALL be removed
- **AND** `postcard_liked` notifications on the same postcard SHALL survive

#### Scenario: Unliking retracts the notification
- **WHEN** a rider removes their `postcard_likes` row
- **THEN** the matching `postcard_liked` notification SHALL be removed, whether or not it had been
  read
- **AND** the recipient's unread count SHALL fall if it was unread, which SHALL be accepted rather
  than compensated for

#### Scenario: Leaving a club or a ride retracts nothing, and that SHALL be stated rather than left silent
- **WHEN** the actor of a `club_joined` row deletes their `club_members` row, or the actor of a
  `ride_joined` row deletes their `ride_members` row
- **THEN** the notification SHALL survive, unchanged, for as long as its subject and both parties do
- **AND** the recipient SHALL keep reading "joined club ‹club›" about a rider who has since left,
  which is correct because the row records an **event at an instant** — `created_at` is that instant
  — and not a standing claim about the present
- **AND** `postcard_unliked` SHALL be understood as the **exception** rather than the pattern it
  generalises: a like is a one-tap toggle, so without a retraction it is an unbounded notification
  generator aimed at another rider, which is a harassment argument and not a truthfulness one
- **AND** no `AFTER DELETE` trigger SHALL be added on `club_members` or `ride_members`, because a
  retraction hanging off a DELETE the **actor** controls is a rider-aimed delete of another rider's
  row in a table no rider may write — the hazard `event-fanout-integrity`'s retraction-scoping
  requirement exists to bound, accepted once for likes and not a second time

#### Scenario: Deleting the ride destroys its notifications
- **WHEN** a ride is deleted
- **THEN** every `ride_joined` and `ride_created_in_club` notification naming it SHALL be removed

#### Scenario: Deleting the club destroys notifications the ride itself survives
- **WHEN** a club is deleted directly, so that `rides.club_id` is set to NULL and the ride survives
- **THEN** every `club_joined` and `ride_created_in_club` notification naming that club SHALL still
  be removed, because their copy names a club that no longer exists
- **AND** this SHALL be asserted explicitly, because `rides.club_id` is `ON DELETE SET NULL` while
  `notifications.club_id` is `ON DELETE CASCADE`, and the two disagreeing is the point

#### Scenario: A departing rider's notifications are hard-deleted in both directions
- **WHEN** a rider deletes their account
- **THEN** every notification **to** them SHALL be removed by the `user_id` cascade
- **AND** every notification **about** them as actor SHALL be removed by the `actor_id` cascade,
  from every other rider's list
- **AND** no tombstone, "deleted rider" byline or placeholder SHALL remain, matching the ruling
  already made for comments and ride messages

#### Scenario: An organizer's account deletion reaches notifications two levels down
- **WHEN** a rider who organises rides deletes their account
- **THEN** those rides SHALL be removed — `rides.organizer_id` is `ON DELETE CASCADE` — and every
  notification about them SHALL go with them, including rows delivered to riders who are still
  active
- **AND** this SHALL be stated as a consequence of the erasure rather than discovered, because it
  is invisible in any single foreign key

#### Scenario: A club transferred rather than deleted keeps its notifications
- **WHEN** an owner's account deletion transfers their club to a remaining admin or member through
  `private.transfer_owned_clubs`
- **THEN** notifications naming that club SHALL survive, because the club survives
- **AND** only rows whose `actor_id` was the departing rider SHALL be removed

### Requirement: Every cascade path into `notifications` SHALL be indexed

Each of the six foreign keys on `notifications` SHALL have an index Postgres can use to find the
referencing rows, so that every delete that reaches this table is an index scan rather than a
sequential scan holding locks.

**`add-account-deletion` already carries this as a standing rule and this change is the first table
it applies to**: *"Every foreign key referencing `public.profiles` SHALL have an index Postgres can
use"*, and *"WHEN a future migration adds a table referencing `profiles` THEN it SHALL add the index
in the same file"*. `036` adds two such keys — `user_id` and `actor_id`. Only `user_id` is served by
the list index; `actor_id` sits **third** in the uniqueness index and so cannot lead a lookup. That
requirement is therefore unmet by the draft, and an unindexed `actor_id` is a sequential scan of
every notification in the table for every account deletion.

The four subject keys are not covered by that requirement's literal text — they reference
`postcards`, `postcard_comments`, `rides` and `clubs`, not `profiles` — but they sit on the **same
cascade**, one level further down: deleting a rider cascades to their postcards and rides, and each
of those cascades here. Indexing them is therefore this change's own decision, taken for the
requirement's reason rather than under its letter, and it is recorded as such rather than claimed as
compliance.

**The subject indexes SHALL be partial** — `where <column> is not null` — because most rows leave
most subject columns NULL. A partial index enters only the rows that use it, so a `postcard_liked`
row costs one subject-index entry rather than four, and the fan-out's write amplification stays at
four index entries per row rather than eight. `015`'s `rides (club_id, created_at desc) where club_id
is not null` is the precedent in this schema.

#### Scenario: `actor_id` leads an index of its own
- **WHEN** the migration is written
- **THEN** `actor_id` SHALL have an index leading with it
- **AND** its position in the uniqueness index SHALL NOT be offered as covering it, because a
  non-leading column cannot serve the lookup

#### Scenario: The four subject keys are indexed, partially
- **WHEN** the migration is written
- **THEN** `postcard_id`, `comment_id`, `ride_id` and `club_id` SHALL each have an index
- **AND** each SHALL be partial on its own column being non-NULL

#### Scenario: The check is derived, not remembered
- **WHEN** this change or any later one adds a foreign key to `notifications`
- **THEN** the index set SHALL be verified by querying `pg_index` for FK columns lacking a
  leading-column index, matching the derivation `add-account-deletion` requires
- **AND** the count SHALL be **six FK columns, six usable indexes**, verified against the live
  database after apply rather than asserted from the file

#### Scenario: These indexes are not the speculative ones the fan-out spec forbids
- **WHEN** the prohibition in `event-fanout-integrity` — *"no additional index SHALL be added
  speculatively for a query no screen issues"* — is applied to this set
- **THEN** it SHALL NOT forbid them, because a cascade is a delete path with a standing requirement
  behind it and not a read query anyone chose to issue
- **AND** the two requirements SHALL each name the other, because as first drafted they contradicted
  each other and neither mentioned it

### Requirement: The unread count and the notification list SHALL agree by construction

The unread count SHALL be produced by a `security invoker` function so that it reads through the
same SELECT policy the list reads through. It SHALL NOT be a `security definer` function, a
denormalised counter, or a client-side length.

**This is the single named place where the count and the list can disagree, and there are four
ways in.** A `security definer` count steps past the block predicate and the resolvability
conjunct, so it counts rows the list will not show — a badge that never clears, on a screen that
is empty. This is exactly why `club_unread_counts()` is `security invoker` (`prosecdef false`,
measured), and copying it is the intended shape.

#### Scenario: The count reads through the same policy as the list
- **WHEN** the unread count is computed
- **THEN** it SHALL be `security invoker`
- **AND** blocks, resolvability and recipient scoping SHALL apply to it without being restated

#### Scenario: A blocked actor's notification is in neither the count nor the list
- **WHEN** a block hides an unread notification
- **THEN** the badge SHALL not indicate it and the list SHALL not show it, in the same instant

#### Scenario: An unresolvable subject is in neither
- **WHEN** a rider leaves a private club holding unread notifications about it
- **THEN** the badge SHALL fall and the list SHALL shorten together

#### Scenario: The count and the list are invalidated together
- **WHEN** either is invalidated
- **THEN** both SHALL be, because they share a cache prefix
- **AND** a screen SHALL NOT hold a stale count beside a fresh list, or the reverse

#### Scenario: Marking read in one place clears the badge everywhere in the app
- **WHEN** the rider marks notifications read
- **THEN** the badge SHALL clear on every tab-root screen without a navigation or a reload
- **AND** a second device SHALL NOT be expected to update, because there is no subscription and
  that is stated rather than assumed

#### Scenario: The count is bounded
- **WHEN** a rider has more unread notifications than the screen can usefully express
- **THEN** the query SHALL be capped rather than counting the whole table
- **AND** the design draws a **dot** and no number — `v2 / Component / Notification` is a 16×16
  `Warning/100` mark with no text child — so the cap SHALL NOT be visible to the rider and the
  number SHALL NOT be rendered unless the design gains one

### Requirement: The notification list SHALL define every state it can be in

The screen SHALL define its empty, loading, error, offline, permission-denied, partial and stale
states, and SHALL NOT render one state for another.

#### Scenario: Three kinds of zero rows collapse to one empty state, deliberately
- **WHEN** the list returns zero rows — because nothing has happened, because everything is hidden
  by a block, or because every subject has become unresolvable
- **THEN** the screen SHALL render the same empty state for all three
- **AND** this SHALL be the one place in the app where permission-denied and empty are *not* told
  apart, because the rider can act on none of the three and distinguishing them discloses a block
- **AND** it SHALL be stated as a decision here rather than inherited by silence from
  `client-render-shell`

#### Scenario: Loading is distinct from empty
- **WHEN** the screen mounts and the list has not arrived
- **THEN** it SHALL render a loading state distinct from the empty state
- **AND** "nothing new" SHALL NOT appear at any point during a successful load

#### Scenario: A failed read offers a retry and does not read as empty
- **WHEN** the list or the count fails
- **THEN** the screen SHALL say it could not load and SHALL offer a retry
- **AND** it SHALL NOT display the PostgREST code or the failing relation
- **AND** the badge SHALL show **no dot** on a failed count rather than a stale one, because a dot
  the rider cannot clear is worse than a missing one

#### Scenario: Offline is reported as offline and marking read is refused, not queued
- **WHEN** the rider opens the list or marks read with no connectivity
- **THEN** the read SHALL report offline specifically rather than as a generic error
- **AND** the mark-read SHALL fail with a message saying so and SHALL NOT be queued, per the
  standing rule that durable offline queuing is out of scope
- **AND** the rows SHALL NOT be optimistically shown as read and then silently revert

#### Scenario: A partial failure costs only its own region
- **WHEN** the list loads but an avatar, a signed URL or a postcard thumbnail fails
- **THEN** the rows SHALL still render with their copy and their timestamp
- **AND** the failed region SHALL show its own fallback rather than replacing the screen

#### Scenario: A row whose subject vanished between the read and the tap is a not-found
- **WHEN** the rider taps a notification whose subject has been deleted since the list loaded
- **THEN** the destination SHALL render not-found rather than an error
- **AND** the list SHALL NOT crash, and the row SHALL be gone on the next read

#### Scenario: The badge is stale until the next navigation, and that is stated
- **WHEN** an event occurs while the rider is looking at a screen
- **THEN** the badge SHALL NOT be expected to appear without a navigation or a foreground
- **AND** freshness SHALL be a revalidation rule rather than a subscription, because Realtime
  delivery is explicitly out of scope for this change

### Requirement: The list SHALL be ordered, sectioned and paginated deterministically

The list SHALL be ordered by `created_at` descending with a deterministic tiebreak, sectioned into
Today / Yesterday / This week / All time, and fetched a bounded page at a time by a keyset cursor.

A notification list is the second list in this app with no natural ceiling — every like, comment,
RSVP, ride and join a rider ever receives lands in it. `offset` double-counts and skips whenever a
row lands between pages, which here happens while the rider is reading.

#### Scenario: Ordering is stable across ties
- **WHEN** two notifications carry the same `created_at` — which a single club fan-out guarantees,
  since every row in it is written by one statement
- **THEN** the order SHALL still be deterministic, by a documented tiebreak on `id`
- **AND** the tiebreak SHALL be the same in the index, in the read query and in the cursor, so a
  row cannot appear twice or vanish between pages

#### Scenario: A ten-thousand-row list behaves like a ten-row one
- **WHEN** the list grows to any size
- **THEN** the first paint SHALL cost one bounded query
- **AND** an index on `(user_id, created_at desc)` SHALL serve it and the unread count without a
  sequential scan

#### Scenario: Section boundaries are computed in one fixed zone
- **WHEN** Today / Yesterday / This week are computed
- **THEN** the day boundary SHALL be resolved in `APP_TIME_ZONE`, matching every other date in the
  app, and SHALL NOT use the viewer's own zone
- **AND** the reason SHALL be the documented interim one — the prerender pass runs on Vercel, so an
  unpinned boundary renders one zone into the HTML and another on hydration
- **AND** the relative stamp on each row (`2m`, `1d`, `2w`) SHALL use the existing
  `formatRelativeTime`, which needs no zone because it measures elapsed instants

#### Scenario: A fan-out of five hundred rows does not become five hundred sections
- **WHEN** a 500-member club's ride creation writes 500 rows for 500 different recipients
- **THEN** each recipient SHALL see exactly one row
- **AND** no recipient's list SHALL be affected by the size of the fan-out

#### Scenario: Read and unread rows are in one list
- **WHEN** the list is rendered
- **THEN** read and unread notifications SHALL appear in the same chronological list
- **AND** there SHALL be no separate "unread" tab or filter, because the design draws none

### Requirement: Every string and mark on the row SHALL name the token it renders

The notification row's own text SHALL be built from named v2 type tokens read from the committed
snapshot, and the unread mark's contrast SHALL be recorded rather than re-estimated.

An earlier revision specified the row's geometry — 72px, a two-line block, a trailing 56×56
thumbnail — and named a token for **neither** of its two text lines, which leaves the one decision a
`design-system` agent cannot make from geometry alone.

Measured 2026-08-07 from `design/`, offline, via `npm run figma -- text "Inbox - Notifications"`:

| Element | Token |
|---|---|
| Line one — actor username | `Poppins/16/Semibold` (16/24, w600) |
| Line one — relative stamp (`2m`, `1d`, `2w`) | `Poppins/14/Regular` (14/20, w400) |
| Line two — the copy | `Poppins/14/Regular` (14/20, w400) |
| Section title — Today / Yesterday / This week / All time | `Poppins/20/Semibold` (20/30, w600) |

#### Scenario: The row's two lines render the measured tokens
- **WHEN** the notification row is built
- **THEN** each of its text nodes SHALL render the token named above
- **AND** none SHALL be inferred from a nearby component, because the design draws the actor's name
  one step heavier and larger than the copy beneath it and a single-token row loses that

#### Scenario: `SectionHeader` already carries the section token
- **WHEN** the day sections are rendered
- **THEN** the existing `SectionHeader` SHALL be used unchanged, because its `text-xl
  font-semibold` is `Poppins/20/Semibold` — checked, not assumed
- **AND** a new section component SHALL NOT be built

#### Scenario: The unread mark's contrast is recorded, not re-estimated
- **WHEN** the unread dot is built from `v2 / Component / Notification`
- **THEN** its contrast SHALL be recorded as **4.22:1** — `Warning/100` `#D92140` on `Grey/5`
  `#F2ECE6`, computed 2026-08-07 — against the 3:1 bar that applies to a non-text component
- **AND** it SHALL be recorded as **passing**, so that a later pass does not re-derive it
- **AND** the 4.5:1 text bar SHALL NOT be applied to it, because it carries no text child

### Requirement: Notifications SHALL have a stated retention, and its absence SHALL be a decision

**The retention window for `notifications` is: as long as its subject exists.** Rows are removed with
their subject, their actor and their recipient, by cascade, and by nothing else. That is the whole
window and it SHALL be written into the migration header in those words.

**It is one window, stated once.** An earlier revision of this change stated two — this requirement
said *"as long as the subject exists"* while `design.md` defaulted to *"state 90 days as the intent,
cap nothing"* — and a migration header cannot carry both. The number is the one that had to go:
nothing implements it, no `pg_cron` and no scheduled Edge Function exist in this project, so a
90-day claim would be an unlabelled guess promoted to a fact in the one artifact a future session
reads as authoritative. The cascade window is true, enforced, and verifiable by deleting a subject
and counting.

A notification is personal data about a relationship: it records that a named rider interacted with
another named rider's content at a named instant, and it accumulates one row per interaction for
ever. It is more disclosive in aggregate than any single row it points at. The brief's standing
rule is that anything holding personal data needs a stated window **at creation**.

#### Scenario: The stated window is the cascade window, and no number is written beside it
- **WHEN** this change ships
- **THEN** the retention window SHALL be recorded as *as long as the subject exists*, in the
  migration header, in this spec and in `design.md`, in the same words
- **AND** no time-based figure — 90 days or any other — SHALL appear as the window, because nothing
  implements one and a number nothing implements becomes a fact nobody rechecks
- **AND** a time-based sweep SHALL be filed as a **follow-up issue**, landing with the first
  scheduled job this project acquires, rather than left as an open question whose default is a number

#### Scenario: The window is verifiable rather than declared
- **WHEN** the window is checked
- **THEN** deleting a postcard, a comment, a ride, a club, an actor or a recipient SHALL be shown to
  remove the matching rows
- **AND** that SHALL be the evidence for the retention claim, which is the property a stated number
  would not have had

#### Scenario: The read is not capped, and that follows the design
- **WHEN** the list is paged to its end
- **THEN** every surviving notification SHALL be reachable, because the design's fourth section is
  literally `All time`
- **AND** a time-capped read SHALL NOT be used as a substitute for a retention window, because rows
  that persist unreadable are still personal data held

#### Scenario: A sweep, if added, deletes rather than anonymises
- **WHEN** a retention sweep is eventually built
- **THEN** it SHALL delete rows outright
- **AND** it SHALL NOT null the `actor_id` to keep the row, because a notification with no actor
  renders as nothing and is a retained record of an interaction reported as erased

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Follow buttons, "Ride upcoming!", "Ride updated", "liked your comment.", ride thumbnails, push
delivery, per-type preferences and a dismiss control SHALL NOT be rendered as disabled or
non-functional controls.

A control that renders and does nothing is a worse artifact than an absent one — the reasoning that
removed the Inbox tab (PD-100) rather than shipping it disabled, and that `RideHeader` already
applies to the buttons it omits.

#### Scenario: The Follow button is absent, not disabled
- **WHEN** the list is built
- **THEN** no follow affordance SHALL be rendered anywhere on it
- **AND** the reason SHALL be recorded: there is no follow graph, `013` dropped `friendships`, and
  the social graph is clubs plus blocking

#### Scenario: The scheduled and update rows are absent
- **WHEN** the list is built
- **THEN** `Ride upcoming!` and `Ride updated` rows SHALL NOT be rendered as placeholders, greyed
  rows or "coming soon" entries
- **AND** their two-line date/time row shape SHALL NOT be built speculatively

#### Scenario: No club-postcard notification is added
- **WHEN** the trigger set is built
- **THEN** no notification SHALL be written for a new postcard in a club
- **AND** the reason SHALL be recorded: `015`'s `feed_reads` watermark and `club_unread_counts()`
  already badge that surface, and a second mechanism for one event is how one of them goes stale

#### Scenario: The header control does not displace an existing menu
- **WHEN** the notification control is added to a tab-root screen that already renders a header
  action — `/profile` and its `ProfileMenu` is the only one today
- **THEN** both controls SHALL be present, matching the design's two 40×40 controls at x302/x342
- **AND** neither SHALL be removed, hidden behind the other, or moved into the other's menu

#### Scenario: How `Header` carries two controls is an architecture decision, not a styling one
- **WHEN** the mechanism is chosen — a second named slot, or an `action` that accepts a fragment
- **THEN** it SHALL be recorded as an **architecture decision in `design.md`**, with the option not
  taken and why, rather than delegated as "`design-system`'s call"
- **AND** the reason SHALL be that `Header` is a primitive every screen in the app renders, its
  `action` slot is already consumed by `/profile` and `RideHeader`, and this is the **only** change
  in this proposal that touches code outside `src/**/notifications/` — so its blast radius is the
  whole app rather than one screen
- **AND** the decision SHALL be taken before `§4` starts, because both call sites have to be written
  against whichever shape is chosen

#### Scenario: Detail screens get no notification control
- **WHEN** a detail screen renders its header
- **THEN** it SHALL keep its `action` slot for its own menu and SHALL NOT gain the notification
  icon
- **AND** the four tab-root screens SHALL be the complete set that carries it
