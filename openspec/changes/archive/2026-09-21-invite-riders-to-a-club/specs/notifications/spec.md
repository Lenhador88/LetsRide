# notifications

## MODIFIED Requirements

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

The SELECT policy SHALL require, in addition to `user_id = auth.uid()`, that **every** resource the
row's copy renders is still returned to the caller under the caller's **own** row security —
expressed as an `EXISTS` per resource, evaluated under the caller's RLS, and **conjoined** where a
type renders more than one.

The conjunct set is fixed per type. The two types this change adds carry `club_id` alone, which is
`club_joined`'s shape, so the per-column form already covers them:

| Type | Subject columns | `EXISTS` conjuncts, all required |
|---|---|---|
| `club_invited` | `club_id` | `clubs` **or** the type-scoped exception below |
| `club_invite_declined` | `club_id` | `clubs` |

**One type now needs an exception, and the exception is the requirement's own rule applied
honestly.** A `club_invited` row addressed to a rider who is not yet a member of a **private** club
fails the `clubs` `EXISTS` — `clubs` SELECT being `is_public OR owner_id = auth.uid() OR
private.is_club_member(id)` — so it would be written and never returned, for ever, looking correct
to every reviewer. That is the failure this requirement exists to name, arriving on a surface whose
entire purpose is to reach a non-member.

**A type-scoped disjunct SHALL be the only permitted remedy**, and it SHALL be permitted only where
all four of these hold. `089` established the pattern for `club_join_request_declined`; this change
is its second instance and the conditions are written down here so a third does not widen the
conjunct outright:

1. the exception names **one type**, so no other `club_id`-carrying row is affected;
2. its predicate is a **caller-relative** `security definer` wrapper whose subject-taking twin is
   granted to no client role;
3. the predicate is **exactly** the one that makes the notification actionable — for
   `club_invited`, `private.has_live_club_invite(club_id)` — so the row becomes unreadable at the
   same instant it stops being answerable;
4. the row still discloses **nothing the recipient could not already read**, which for a live
   invitee is the case, because `085`'s `discoverable_private_clubs` already returns that club's
   name, avatar, location and member count to exactly that rider.

**Relaxing the club conjunct generally is refused**, and so is a subject-less type: the second is
lossy, because `notifications_event_key` is unique over all four subject columns with `NULLS NOT
DISTINCT` (measured on DEV: `indnullsnotdistinct = true`), so two invites from one admin to one
rider for two different clubs would collapse into one row and the second would be dropped by `on
conflict do nothing`.

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

#### Scenario: A private club's invite notification reaches its recipient
- **WHEN** an admin invites a non-member to a private club
- **THEN** the invitee SHALL read exactly one `club_invited` row
- **AND** the row SHALL become unreadable the moment the invite stops being answerable — it is
  withdrawn, the inviter's authority ends, or either block is placed

#### Scenario: A stranger holding no invite reads nothing
- **WHEN** a rider who holds no live invite is handed a `club_invited` row's id, or holds a row for a
  club whose invite has since been withdrawn
- **THEN** the row SHALL NOT be returned, because the exception's predicate is the live invite itself

#### Scenario: The exception reaches one type only
- **WHEN** the policy is read
- **THEN** each exception SHALL name its `type` explicitly, and a `club_joined` or
  `ride_created_in_club` row for an unreadable club SHALL still be dropped

### Requirement: A rider SHALL NOT learn a private club's name, or a private ride's title, from a notification

A notification row SHALL carry no denormalised text describing its subject. Every rendered string
naming a club, ride, postcard or rider SHALL be read from that resource under the reader's own row
security at the moment of rendering.

**A snapshot is a second copy of a visibility decision and nothing re-checks it.** A
`club_name text` column would be readable by its recipient for ever, including after they left the
club, were removed from it, or were blocked by everyone in it — and the row would look perfectly
correct to any reviewer, because the value in it was true when it was written.

**This requirement is about denormalisation, not about which readers a club's name may reach**, and
the distinction is what the carve-out below turns on. `085` already widened the audience for a
private club's name — `public.discoverable_private_clubs` returns it to every signed-in rider the
club takes join requests from — and did so through an accessor evaluated live on every read. A
notification may therefore *point at* a club that audience can already name, provided the name still
comes from a live predicate and never off the row.

**The carve-outs are type-scoped, one disjunct per type, and there are two.**
`club_join_request_declined` (`089`, PD-335) and `club_invited` (`093`, PD-360) are each returned to
a rider who is not a member of the private club they name, through a **type-scoped** disjunct on
`036` §3's club conjunct:

```sql
or (type = 'club_join_request_declined'
    and private.club_takes_join_requests(notifications.club_id))
or (type = 'club_invited'
    and private.has_live_club_invite(notifications.club_id))
```

Every other `club_id`-carrying type SHALL evaluate exactly the conjunct it evaluates today. An
unconditional widening of that conjunct — which would make *any* `club_id`-carrying row resolve for
any non-member holding one — SHALL NOT be made.

**The invite notification does not weaken this and is worth stating so it is not read as an
exception to it.** A `club_invited` row still carries **no name**: the copy resolves the club at
render time, and the rider resolves it through `public.discoverable_private_clubs(club)` — a path
`085` already grants them, gated on a predicate that is true for exactly a non-owner, non-member,
unblocked rider of a non-default private club. So the club's name reaches them because they may read
it, not because a notification told them.

**The negative half is unchanged and is what the assertion checks**: a rider who is *not* a live
invitee learns nothing, because the notification is not returned and the accessor's predicate has
its own reasons to be false for them.

#### Scenario: No column holds a name, title or caption
- **WHEN** the table is inspected after `089`
- **THEN** it SHALL still carry no `club_name`, `ride_title`, `actor_username`, `postcard_caption`,
  `body`, `message` or equivalent column
- **AND** the decline row's club name SHALL be resolved at render time through
  `public.discoverable_private_clubs`, under a predicate that goes false the moment the rider is
  blocked with the club's owner

#### Scenario: A non-member receives a private club's name ONLY for the declined type, and only while the club would still take their request
- **WHEN** a rider who is not a member of a private club holds a `club_join_request_declined` row
  for it
- **THEN** the row SHALL be returned, and the club's name SHALL be reachable to them — through the
  accessor, never through the `club:clubs(...)` embed, which SHALL continue to return null
- **WHEN** the same rider holds any **other** `club_id`-carrying type for the same club
- **THEN** that row SHALL NOT be returned, unchanged from today

#### Scenario: The carve-out closes when the rider is blocked
- **WHEN** a `blocks` row exists in either direction between the requester and the club's owner
- **THEN** `private.club_takes_join_requests` SHALL be false, the ordinary `clubs` EXISTS SHALL be
  false, and the decline row SHALL NOT be returned and SHALL NOT be counted

#### Scenario: A ride's title follows the ride's own policy
- **WHEN** a notification names a ride the reader can no longer see
- **THEN** the title SHALL not be fetchable and the row SHALL not be returned

#### Scenario: An unresolvable actor evicts the row in the database, because that state is reachable
- **WHEN** the actor's profile is not returned to the reader — blocked, **or `username` NULL**
- **THEN** the row SHALL NOT be returned by the SELECT policy, by the same `EXISTS` mechanism the
  subject uses, so the unread count falls with the list in the same instant
- **AND** the row SHALL NOT be rendered with a placeholder name, an id, or "someone"
- **AND** no component SHALL drop it after the fact

#### Scenario: The self-actor row is immune to that eviction, and that is why it was chosen
- **WHEN** the reader is the row's own `actor_id`
- **THEN** `profiles` SELECT's first arm — `auth.uid() = id` — SHALL resolve them unconditionally,
  including when they have nulled their own username
- **AND** `private.is_blocked(x, x)` SHALL be false, because `blocks` carries
  `CHECK (blocker_id <> blocked_id)`

#### Scenario: The name is resolved, never stored
- **WHEN** the two new types are added
- **THEN** no `club_name` column SHALL appear, and the copy SHALL be composed at render time from
  `type` plus a separately-read club

#### Scenario: A blocked rider learns no name
- **WHEN** a rider blocked with the club's owner is somehow addressed by a `club_invited` row
- **THEN** the fan-out SHALL not have written it, and were it written by a repair statement the
  accessor SHALL refuse them the name

## ADDED Requirements

### Requirement: A notification a rider can read SHALL be one they can mark read

The `notifications` SELECT policy and the UPDATE policy that marks a row read SHALL carry the
**identical** predicate, and any change to one SHALL be made to the other in the same statement
block.

They are two policies — `Notifications are readable only by their recipient` and `Riders mark only
their own readable notifications read` — whose quals are byte-identical today, measured. Widening
only the read gives a rider a notification they can see and can never clear: the UPDATE is refused,
`read_at` never moves, and the unread count carries a number with nothing behind it that explains
itself. **The feature demo works**, which is why this needs an assertion rather than a review.

#### Scenario: The two quals stay equal
- **WHEN** `pg_policies` is read for both policies after any change to either
- **THEN** the SELECT `qual`, the UPDATE `qual` and the UPDATE `with_check` SHALL be equal

#### Scenario: An invitee can clear their own invite notification
- **WHEN** the invitee of a private club marks their `club_invited` row read
- **THEN** the UPDATE SHALL succeed and the unread count SHALL fall by one

#### Scenario: They can still not retitle it
- **WHEN** the same rider attempts to write any column other than `read_at`
- **THEN** it SHALL be refused, unchanged by this requirement
