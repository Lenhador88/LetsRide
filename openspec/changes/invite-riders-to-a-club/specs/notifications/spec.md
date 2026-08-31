# notifications

## MODIFIED Requirements

### Requirement: A notification SHALL be dropped by the database when its subject is no longer visible to its recipient, not filtered by a screen

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

**The invite notification does not weaken this and is worth stating so it is not read as an
exception to it.** A `club_invited` row still carries **no name**: the copy resolves the club at
render time, and the rider resolves it through `public.discoverable_private_clubs(club)` — a path
`085` already grants them, gated on a predicate that is true for exactly a non-owner, non-member,
unblocked rider of a non-default private club. So the club's name reaches them because they may read
it, not because a notification told them.

**The negative half is unchanged and is what the assertion checks**: a rider who is *not* a live
invitee learns nothing, because the notification is not returned and the accessor's predicate has
its own reasons to be false for them.

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
