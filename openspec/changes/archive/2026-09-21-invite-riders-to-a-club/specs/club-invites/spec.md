# club-invites

## ADDED Requirements

### Requirement: Only an authorised member SHALL create an invite, and the authority SHALL differ by the club's visibility

`public.club_invites` INSERT SHALL be permitted only where `inviter_id = auth.uid()` **and**
`private.may_invite_to_club(club_id)` **and** the caller is not blocked with the invitee in either
direction.

`private.may_invite_to_club_for(candidate, club)` SHALL be
`private.is_club_admin_for(candidate, club) OR (the club is public AND
private.is_club_member_for(candidate, club))`, and its caller-relative wrapper SHALL be exactly that
delegation and nothing else.

**On a private club the authority SHALL be the same set that may answer a join request.** A looser
set defeats `085`: a rider whose request an admin declined could be admitted by a member with no
authority to reverse that decision.

**On a public club an ordinary member SHALL be permitted to invite**, because there the row is a
pointer rather than a grant — the recipient could already open the club through `clubs` SELECT's
`is_public` arm and join it through `club_members` INSERT.

The **invitee-side** conditions — not the club's owner, not already a member, not the default club,
and no pending `club_join_requests` row — SHALL be enforced by a `security definer` BEFORE INSERT
trigger raising `check_violation`, **not** by the INSERT policy, because a policy asking them would
require `authenticated` to hold EXECUTE on the subject-taking helper, which is a membership and
admin oracle for any pair.

That trigger SHALL test **no block**, in either direction, because a raise naming a block between
the invitee and the club's owner would disclose a block to a third rider.

#### Scenario: An admin invites to a private club
- **WHEN** a rider holding `club_members.role in ('owner','admin')`, or named by `clubs.owner_id`,
  inserts an invite for a rider who is not a member
- **THEN** the row SHALL be created with `status = 'pending'`

#### Scenario: An ordinary member cannot invite to a private club
- **WHEN** a member of a private club whose role is `member` attempts the insert
- **THEN** it SHALL be refused with `42501` by the INSERT policy

#### Scenario: An ordinary member CAN invite to a public club
- **WHEN** a member of a public club whose role is `member` inserts an invite
- **THEN** the row SHALL be created, because the invite grants nothing the recipient did not have

#### Scenario: A non-member cannot invite to any club
- **WHEN** a rider who holds no `club_members` row and is not the owner attempts the insert, for a
  public club and for a private one
- **THEN** both SHALL be refused with `42501`

#### Scenario: A rider cannot pre-answer an invite they send
- **WHEN** the insert names `status`, `created_at` or `responded_at`
- **THEN** it SHALL be refused with `42501`, because INSERT is granted per column over
  `(id, club_id, invitee_id, inviter_id)` alone

#### Scenario: The club's owner cannot be invited to their own club
- **WHEN** an admin inserts an invite whose `invitee_id` is `clubs.owner_id`
- **THEN** it SHALL be refused with `23514` by the admissibility trigger

#### Scenario: An existing member cannot be invited
- **WHEN** an admin inserts an invite for a rider who already holds a `club_members` row for that
  club
- **THEN** it SHALL be refused with `23514`, and no notification SHALL be written

#### Scenario: The default club takes no invites
- **WHEN** an invite is inserted for the club carrying `clubs.is_default`
- **THEN** it SHALL be refused, because `058` joins every rider to it at onboarding

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `public.club_invites` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, and `anon` SHALL hold no
  privilege on the table, asserted per grantee

### Requirement: A pending invite SHALL grant nothing

A `club_invites` row in any status SHALL add **no** arm to any policy. `clubs` SELECT,
`private.can_read_club`, `club_members` SELECT, `club_threads`, `club_messages`, `rides`,
`postcards` and every `storage.objects` policy SHALL be **unchanged** by this capability.

The **only** policy that moves for a pending invitee is `notifications`, and the only thing it makes
readable is the row telling them they were invited.

#### Scenario: An invitee reaches nothing inside the club
- **WHEN** a rider holding a pending invite to a private club reads `club_members`, `club_threads`,
  `club_messages`, the club's rides and the club's postcards
- **THEN** every read SHALL return zero rows, exactly as it did before the invite existed

#### Scenario: The two pinned objects do not move
- **WHEN** the `clubs` SELECT qual and `private.can_read_club`'s `prosrc` are compared against the
  values the suite already pins
- **THEN** both SHALL be **byte-identical**, and a failure SHALL be read as this change being wrong
  rather than as a stale pin

### Requirement: An invitee SHALL be able to see what they were invited to, through read paths that already exist

A live invitee SHALL be able to resolve the club's name, avatar path, location name and member
count, and SHALL do so through `clubs` SELECT for a public club and through `085`'s
`public.discoverable_private_clubs(club)` for a private one.

`public.my_live_club_invites()` MAY return those same fields for convenience, and SHALL disclose
**nothing** the rider could not already obtain through those two paths. It SHALL return a fixed list
of named columns and never `clubs.*`, so a column added to `clubs` later is not disclosed by
default.

#### Scenario: The accessor discloses nothing new
- **WHEN** the columns `my_live_club_invites()` returns for a private club are compared with those
  `discoverable_private_clubs` returns to the same rider
- **THEN** the first SHALL be a subset of the second plus the inviter's own username and avatar path,
  which that rider may already read through `profiles`

#### Scenario: The avatar does not sign for a private club
- **WHEN** the invitee's client asks Storage to sign the club's `avatar_path`
- **THEN** it SHALL fail and the card SHALL draw the club's initials, because `016`'s policy runs its
  own `EXISTS` against `clubs` under the reader's row security
- **AND** the assertion SHALL pin that, so the day a storage arm lands the test names it

### Requirement: An invite SHALL be unique per club and invitee, and SHALL NOT name its own inviter

`public.club_invites` SHALL carry `unique (club_id, invitee_id)` and
`check (invitee_id <> inviter_id)`.

`status` SHALL be `pending` or `declined` and **nothing else**. There SHALL deliberately be no
`accepted`: accepting DELETES the row and the `club_members` row becomes the record — `085`'s rule,
not `083`'s — because for a club the membership *is* the audience, and a surviving `accepted` row
beside the unique key would make a club a rider once left un-invitable for ever.

`check ((status = 'pending') is not distinct from (responded_at is null))` SHALL use
`is not distinct from` rather than `=`, per `073`'s measured correction: a CHECK passes on NULL, so
the `=` form is satisfied by a row that meets neither side.

#### Scenario: A repeat invite is refused rather than duplicated
- **WHEN** a second invite is inserted for a rider who already holds one, in any status
- **THEN** it SHALL be refused with `23505`
- **AND** no second notification SHALL be written

#### Scenario: A rider cannot invite themselves
- **WHEN** the insert names the caller as both parties
- **THEN** it SHALL be refused with `23514` before any policy or fan-out runs

#### Scenario: A rider who accepted, left, and is invited again
- **WHEN** a rider accepts an invite, later leaves the club, and an admin invites them again
- **THEN** the second invite SHALL succeed, because the accept deleted the first row

### Requirement: Only the invitee SHALL answer an invite, and accepting SHALL be one statement

`public.accept_club_invite(invite uuid)` and `public.decline_club_invite(invite uuid)` SHALL be
`security definer`, SHALL take an **invite id and never a rider id**, and SHALL each have exactly
**one raise site** with one message and one SQLSTATE.

`public.club_invites` SHALL carry **no UPDATE grant and no UPDATE policy** for any client role. The
absence is the enforcement: with RLS on, a command with no policy is refused for every row, so
`status` and `responded_at` are writable only by those two RPCs.

Accepting SHALL, in one transaction and in this order: write the `club_members` row through
`private.join_club_from_invite`, delete any pending `club_join_requests` row for the same pair, and
delete the invite row.

#### Scenario: A rider cannot answer somebody else's invite
- **WHEN** any rider other than the invitee calls either RPC with a live invite's id
- **THEN** it SHALL raise `insufficient_privilege` with the same message as a nonexistent id
- **AND** nothing SHALL distinguish "not yours", "no such invite", "already answered" and "the club
  no longer admits you"

#### Scenario: The inviter cannot accept on the invitee's behalf
- **WHEN** the inviting admin calls `accept_club_invite`
- **THEN** it SHALL raise, and no `club_members` row SHALL be written

#### Scenario: Accepting writes exactly one membership row
- **WHEN** the invitee accepts
- **THEN** exactly one `club_members` row SHALL exist for the pair, with `role = 'member'` written as
  a literal
- **AND** the invite row SHALL be gone
- **AND** `private.notify_club_joined` SHALL have fanned out to the owner and admins exactly as it
  does for any other join

#### Scenario: Accepting is idempotent against an existing membership
- **WHEN** the invitee joined by another route between the invite and the accept
- **THEN** the accept SHALL write no second row (`on conflict do nothing`), SHALL not rewrite the
  existing `joined_at` or `role`, and SHALL still delete the invite

#### Scenario: No client role holds UPDATE on the table
- **WHEN** `has_table_privilege` is asked for `authenticated` and for `anon` for UPDATE
- **THEN** both SHALL be false, asserted per grantee, and no UPDATE policy SHALL exist

### Requirement: An invite SHALL stop working when its inviter's authority ends

`private.may_invite_to_club_for(inviter, club)` SHALL be evaluated **again** at accept time, against
the club's current visibility and the inviter's current standing — never trusted from the moment the
row was written.

A rider whose invite is no longer answerable SHALL simply **not see it**:
`public.my_live_club_invites()` SHALL apply the same predicate, so a dead invite disappears rather
than presenting a button that always fails. The notification it wrote MAY survive (there is no
retraction) and SHALL degrade to plain text with no controls.

#### Scenario: The inviter left the club
- **WHEN** the inviting admin's `club_members` row is deleted and they are not the owner
- **THEN** the invitee's accept SHALL raise `insufficient_privilege`
- **AND** the invite SHALL be absent from `my_live_club_invites()`

#### Scenario: The inviter was demoted
- **WHEN** `088`'s `demote_club_admin` moves the inviter from `admin` to `member` on a private club
- **THEN** the accept SHALL raise, because a demotion withdraws exactly this authority

#### Scenario: The club flipped public to private after a member's invite
- **WHEN** an ordinary member invites a rider to a public club and an owner then makes the club
  private
- **THEN** the accept SHALL raise, because a pointer must not silently become a grant
- **AND** where the inviter was an **admin**, the same accept SHALL succeed

#### Scenario: The club flipped private to public
- **WHEN** a private club with a pending admin-sent invite is made public
- **THEN** the accept SHALL succeed and SHALL admit nothing the club's own URL would not

#### Scenario: The inviter deleted their account
- **WHEN** a rider with outstanding invites deletes their account
- **THEN** every invite naming them SHALL be removed by `on delete cascade` on `inviter_id`
- **AND** where they owned the club, `private.transfer_owned_clubs` SHALL hand it to a successor and
  the club SHALL survive with no dangling invite

### Requirement: An invite and a pending join request SHALL NOT coexist, and the invite SHALL give way

`private.club_takes_invites_for(candidate, club)` SHALL be false while a `pending`
`club_join_requests` row exists for the same pair, so the invite INSERT is refused and the admin's
remedy is the one already in front of them: approve the request.

`085`'s `private.club_takes_join_requests_for` SHALL **not** be modified: a rider holding a live
invite may still ask to join, and the club SHALL remain in their Explore list.

Where the two mechanisms nonetheless meet — a request created after an invite, or a request standing
when a **link** is claimed — the membership write SHALL delete the pending request row in the same
transaction, so `085`/`087`'s `private.retract_club_join_requested` clears the admins' "asked to
join" notification.

#### Scenario: An invite to a rider who has asked is refused
- **WHEN** an admin invites a rider holding a pending request for that club
- **THEN** it SHALL be refused with `23514`
- **AND** the refusal SHALL disclose nothing, because only that club's admins may invite and they may
  already read that request

#### Scenario: A request after an invite is still permitted
- **WHEN** a rider holding a pending invite finds the club in Explore and requests to join
- **THEN** the request SHALL be created, and the club SHALL remain discoverable to them

#### Scenario: A membership written by either path clears the request
- **WHEN** the rider then accepts the invite, or claims a link
- **THEN** the pending request row SHALL be deleted in the same transaction
- **AND** the admins' `club_join_requested` notification SHALL be retracted by the existing trigger
- **AND** no admin SHALL be left holding an actionable request for a rider who is already a member

#### Scenario: An approval first makes the invite inert
- **WHEN** an admin approves the request before the invite is answered
- **THEN** the rider SHALL become a member, and accepting the invite afterwards SHALL write no second
  membership row and SHALL delete the invite

### Requirement: Invite visibility SHALL be stated per role

`public.club_invites` SELECT SHALL return a row only to the two riders it names, and only while
neither block stands:

```
(invitee_id = auth.uid() or inviter_id = auth.uid())
and not private.is_blocked(auth.uid(), invitee_id)
and not private.is_blocked(auth.uid(), inviter_id)
```

Stated per role, for one invite to a private club:

| Role | Reaches the row |
|---|---|
| The invitee | yes, and only they may answer it |
| The inviter | yes, and they may withdraw it while pending |
| Another admin of the club | **no** through SELECT; they may DELETE it, per the next requirement |
| An ordinary member of the club | no |
| A non-member | no |
| Either party while a block stands, in either direction | no |
| The club's owner, who is neither party | no |
| A signed-out visitor | no — `anon` holds no privilege |

**No arm SHALL read `clubs`.** An arm making the row visible to anyone who can see the club would
hand every member of a public club the invites of a private one, and for a private club it would be
circular.

**Another admin reaching DELETE without SELECT is deliberate**, and the surface SHALL NOT present a
list it cannot read: the admin's Clear affordance acts on rows returned by their own read, so an
invite sent by a co-admin is cleared through the RPC-less DELETE only where the client already holds
its id.

#### Scenario: A blocked pair sees nothing, in either direction
- **WHEN** one directional `blocks` row exists between the inviter and the invitee
- **THEN** neither SHALL read the invite, because `private.is_blocked` is symmetric
- **AND** the invitee SHALL NOT be able to accept it

#### Scenario: An ordinary member cannot read the club's invites
- **WHEN** a member whose role is `member` selects from `club_invites` for their own club
- **THEN** zero rows SHALL be returned

### Requirement: Blocking SHALL be enforced in four places and disclosed in none

A block SHALL be applied at: the INSERT policy (between inviter and invitee), the fan-out, the
answerability predicate, and `private.join_club_from_invite` — where it SHALL also cover the block
between the **invitee and the club's owner**.

No refusal SHALL be distinguishable from any other. `private.join_club_from_invite` SHALL return
`false` rather than raising, so its caller keeps one raise site, and the admissibility trigger SHALL
test no block at all.

The owner-block rule survives `085`'s stated reason expiring. `club_members` SELECT **does** carry a
block conjunct today, measured; the reason the rule holds is larger: a membership admits the rider to
the club's threads, messages, rides and timeline, which is the shared space decision #2 exists to
keep two blocked riders out of.

#### Scenario: A rider blocked with the club's owner cannot be admitted
- **WHEN** an unblocked admin invites a rider whom the club's **owner** has blocked, and the rider
  accepts
- **THEN** the accept SHALL raise the single message, no membership row SHALL be written, and the
  admin SHALL learn nothing about why
- **AND** the invite SHALL never have produced a notification

#### Scenario: The block is symmetric from one directional row
- **WHEN** the invitee is the blocker rather than the blocked
- **THEN** every outcome above SHALL be identical

### Requirement: A declined invite SHALL be terminal against the inviter and reopenable by the invitee

`club_invites` DELETE SHALL be
`((inviter_id = auth.uid() and status = 'pending') or private.is_club_admin(club_id))
and not private.is_blocked(auth.uid(), invitee_id)`.

The inviter SHALL NOT be able to delete a **declined** row, so a refusal sticks against the person
refused. The club's admins MAY clear one, which is `085`'s rule for a declined request and the same
affordance.

`accept_club_invite` SHALL answer a `declined` row as well as a `pending` one — the invitee alone may
reopen their own refusal. `decline_club_invite` SHALL answer `pending` only.

The block conjunct on DELETE is `036` §4's rule rather than tidiness: without it the write path
reaches rows the read path does not return, and an affected-row count is a number an admin can
compare against the list they were just shown.

#### Scenario: An inviter cannot clear a refusal
- **WHEN** the inviting admin deletes their own `declined` invite
- **THEN** zero rows SHALL be affected

#### Scenario: An admin may clear a refusal
- **WHEN** any owner or admin of the club deletes a `declined` invite
- **THEN** the row SHALL be removed and a fresh invite SHALL become possible
- **AND** a re-send by the **same** admin SHALL write no new notification, because
  `notifications_event_key` collapses `(recipient, type, actor, club)`

#### Scenario: The invitee may reopen their own refusal
- **WHEN** a rider who declined later calls `accept_club_invite` on the same row
- **THEN** it SHALL succeed and write the membership

#### Scenario: A withdrawal leaves the notification standing
- **WHEN** the inviter deletes a `pending` invite
- **THEN** no retraction SHALL fire — there is deliberately no such trigger, per `090` — and the
  invitee's notification SHALL remain, rendering as plain text with no Accept or Decline control,
  because the controls read the live invite rather than the notification

### Requirement: The membership row on an invite path SHALL be written by exactly one function, which restates both gates

`private.join_club_from_invite(rider uuid, target_club uuid, admitter uuid)` SHALL be the single
place any invite path writes a `club_members` row, and SHALL be its only caller's contract for both
the accept and the link claim.

It SHALL restate, in its own body: `private.may_participate_for(rider)` — **never
`private.may_participate()`**, which is caller-relative and on the claim path would answer for the
wrong rider — `private.may_invite_to_club_for(admitter, target_club)`, and both blocks. It SHALL
write `'member'` as a **literal** and SHALL take no role argument, so `019`'s property that `admin`
is claimable by no client survives this new write path because there is no input by which to attempt
it.

It SHALL live in `private`, so PostgREST cannot publish it and `service_role` cannot reach it
(`031`).

**No compensating gate trigger SHALL be added to `club_members`.** `078.9`'s reason: every gate
trigger carries `when (current_user = 'authenticated')` and `current_user` inside a `security
definer` body is the owner, so such a trigger would raise the gate count while gating nothing.

#### Scenario: An un-onboarded rider cannot be admitted
- **WHEN** a rider whose `onboarding_completed_at` or `terms_accepted_at` is NULL accepts an invite
  or claims a link
- **THEN** no `club_members` row SHALL be written and the single raise SHALL fire
- **AND** this SHALL hold for an account created by calling GoTrue's `/auth/v1/signup` directly and
  never calling `accept_terms()`

#### Scenario: The role cannot be chosen
- **WHEN** the function's signature and body are read
- **THEN** there SHALL be no role parameter and the inserted role SHALL be the literal `'member'`

#### Scenario: The trigger count on `club_members` does not move
- **WHEN** the triggers on `public.club_members` are counted before and after `093`
- **THEN** the number SHALL be unchanged

### Requirement: Invites SHALL have a stated retention, and its absence SHALL be a decision

A `club_invites` row records that one named rider asked another named rider to join one named club at
a named time. Its retention SHALL be stated: **until it is accepted (which deletes it), withdrawn,
cleared by an admin, or removed by the cascade on the club or on either rider.** There SHALL be **no
expiry** on a pending invite.

The reason SHALL be `085`'s, unchanged: an expiry silently withdraws the offer in a way neither party
is told about, which — given that nothing announces it — is indistinguishable from a refusal and from
a club that never looked. The **link** is the mechanism that carries an expiry, because possession is
its whole credential.

#### Scenario: The club is deleted
- **WHEN** a club with pending and declined invites is deleted
- **THEN** every invite SHALL be removed by `on delete cascade`
- **AND** every notification carrying that `club_id` SHALL go with it, by `036`'s own cascade

#### Scenario: Either rider deletes their account
- **WHEN** the invitee or the inviter deletes their account
- **THEN** their invites SHALL be removed by `on delete cascade`, and each FK into `profiles` SHALL
  **lead** an index, per `029`'s rule

#### Scenario: A pending invite outlives inattention
- **WHEN** nobody answers
- **THEN** it SHALL remain `pending` indefinitely and SHALL continue to render as an invitation while
  its inviter's authority stands

### Requirement: Every invite surface SHALL define all seven of its states

Empty, loading, error, offline, permission-denied-versus-empty, partial and stale SHALL each be
defined for: the rider picker, the admin's outgoing invite list, the invitee's notification row, and
the club menu's row.

#### Scenario: Empty
- **WHEN** an admin opens the invite surface for a club with no outstanding invites
- **THEN** it SHALL draw a designed empty state naming what to do, never a blank panel

#### Scenario: Loading
- **WHEN** the lists are first read
- **THEN** the screen SHALL gate on **the data** and never on `isLoading`, per `CLAUDE.md` — a
  first-pass render has no data and no fetch in flight

#### Scenario: Permission denied versus empty
- **WHEN** RLS returns zero rows because the viewer is not an admin
- **THEN** the surface SHALL NOT be reachable at all rather than rendering as empty, because the
  entrance is gated on the same disjunction the policy uses

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the picker and both write controls SHALL be disabled with a stated reason, and no write
  SHALL be queued — an invite sent from a stale roster is a write against a club the rider may no
  longer administer

#### Scenario: Stale
- **WHEN** an invite is answered or withdrawn elsewhere
- **THEN** the admin's list SHALL be invalidated by the mutation that changed it, and the invitee's
  controls SHALL read the live invite rather than the notification that announced it

### Requirement: The club's share row SHALL render only where its action can succeed

One component SHALL own the `is_public` branch, and every ⋯ menu that offers the row SHALL mount it
rather than branching itself. There are two callers today — `ClubOptionsMenu` and the club thread
screen's row — and the second was added knowingly carrying the defect.

| Club | Viewer | The row |
|---|---|---|
| Public | anyone who can open the menu | `Share club`, sharing `routes.club(id)`, plus an in-app send for a member |
| Private | owner or admin | `Invite riders` |
| Private | member who is not an admin, or a non-member | **nothing** |

An unknown visibility SHALL render **nothing**, never the public branch.

#### Scenario: A private club no longer offers a broken share
- **WHEN** a member of a private club whose role is `member` opens the ⋯ menu
- **THEN** no share or invite row SHALL be rendered
- **AND** this SHALL be asserted as an **absence**, because a test that only checks what renders
  cannot see a row that should not

#### Scenario: Both callers change together
- **WHEN** the club thread screen's menu is rendered for a private club
- **THEN** it SHALL show the same three states as the club detail's menu, because both mount one
  component
