## Purpose

What a rider outside a private club may see of it, who may ask to join, who may answer, what every
other role sees of that request in every state, and what a request does when the club is deleted,
flips public, or when either party blocks the other — for every role that can reach a club: owner,
admin, member, requester, non-member, blocked rider, and signed-out visitor.

**A private club's name reaching a non-member is a widening, and it happens in exactly one
function.** That is the sentence this capability turns on. `clubs` SELECT is untouched; the
`club_members`, `rides`, `postcards`, `club_threads` and `club_messages` policies are untouched;
the two `storage.objects` policies are untouched. Everything a non-member learns about a private
club, they learn from `public.discoverable_private_clubs`, and its return list is therefore the
complete statement of what a private club discloses.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** Four are named as exceptions where they are stated:
the Explore list's merge of two halves is a query shape rather than a policy; the request list's
admin gating is a component contract over a policy that already enforces it; the reduced screen's
"renders no query" property is a component contract; and the two-copy agreement between
`private.is_club_admin` and `private.is_club_admin_for` is asserted as *equal answers for four
named riders* plus a text pin, which is behaviour as well as text.

## ADDED Requirements

### Requirement: A private club SHALL be discoverable through one narrow accessor and through nothing else

`public.discoverable_private_clubs(target_club uuid default null, page_size int default 50)` SHALL
be the only path by which a rider who is not a member or owner of a private club reads anything
about it. It SHALL be `security definer`, `stable`, `set search_path = ''`, revoked from `public`
and `anon`, and granted to `authenticated`.

It SHALL return exactly `id`, `name`, `avatar_path`, `location_name`, `latitude`, `longitude` and
`members_count`, and SHALL NOT return `description`, `cover_image_path`, `owner_id`, `created_at`,
`is_default`, `is_public`, `location_place_id`, any roster row, any ride, any postcard, any thread
or any message.

`clubs` SELECT SHALL NOT be altered by this change, and `private.can_read_club` SHALL NOT be
altered by this change. A future change that widens either SHALL restate this capability's negative
cases rather than inherit them.

`page_size` SHALL be capped inside the function, so no client can request every private club in one
call.

#### Scenario: A non-member reads a private club's name, location and member count
- **WHEN** a signed-in rider who is not a member or owner of a private club calls the accessor
- **THEN** that club SHALL be returned with its name, avatar path, location name, coordinates and
  member count
- **AND** nothing else about it SHALL be returned

#### Scenario: The same rider reads nothing of that club through any other path
- **WHEN** that rider selects from `clubs`, `club_members`, `rides`, `postcards`, `club_threads` or
  `club_messages` for that club id
- **THEN** every one of those SHALL return **zero rows**
- **AND** each SHALL be asserted separately, because a single assertion cannot say which predicate
  did the work

#### Scenario: The club's images stay unreadable
- **WHEN** that rider attempts to read the club's avatar or cover object from `storage.objects`
- **THEN** both SHALL return zero rows, because `016`'s two policies delegate to `clubs` SELECT and
  this change adds no arm to either
- **AND** the surface SHALL render the club's initials rather than a broken image

#### Scenario: A public club never comes back from the accessor
- **WHEN** the accessor runs for any caller
- **THEN** no row SHALL have `is_public = true`, and no row SHALL be the `is_default` club
- **AND** the Explore list SHALL therefore contain no club twice

#### Scenario: A member, an owner and an admin get nothing new
- **WHEN** the accessor is called by a rider who is already a member, an admin or the owner of the
  club
- **THEN** that club SHALL NOT be returned, because they reach it through `clubs` SELECT and it
  belongs on Your clubs

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** the `anon` role attempts to execute the accessor
- **THEN** EXECUTE SHALL be refused, asserted with
  `has_function_privilege('anon', …, 'execute')` = false rather than by calling it

#### Scenario: The accessor is bounded
- **WHEN** a caller passes a `page_size` larger than the internal cap, or a negative one
- **THEN** the function SHALL return no more rows than the cap and SHALL NOT error

### Requirement: Blocking SHALL hide a private club from discovery in both directions, from a single directional row

`private.club_takes_join_requests(candidate, target_club)` SHALL include
`not private.is_blocked(candidate, c.owner_id)`. `private.is_blocked` is symmetric by construction
(`009`), so one `blocks` row in either direction SHALL remove the club from the other party's
discovery and SHALL refuse their request.

The block conjunct SHALL be on `clubs.owner_id` alone. A block with an ordinary member SHALL NOT
hide the club, which is the behaviour public clubs already have — `clubs` SELECT carries no block
predicate — and this change SHALL NOT add one.

#### Scenario: The owner blocked the rider
- **WHEN** a club owner has blocked a rider
- **THEN** that rider's call to the accessor SHALL NOT return that club
- **AND** an INSERT of a request for it SHALL be refused

#### Scenario: The rider blocked the owner
- **WHEN** the rider blocked the owner instead, with the row directional the other way
- **THEN** the outcome SHALL be identical, from the same single `blocks` row

#### Scenario: A block with an ordinary member changes nothing
- **WHEN** the rider is blocked with a member of the club who is neither its owner nor an admin
- **THEN** the club SHALL still be discoverable and requestable
- **AND** this SHALL be asserted, so that a later change adding a block arm to `clubs` has to
  restate it rather than silently invert it

#### Scenario: A block after a pending request makes it inert to both parties
- **WHEN** either party blocks the other while a request is `pending`
- **THEN** neither the requester nor any admin SHALL read the row
- **AND** neither RPC SHALL be able to answer it, and the refusal SHALL be indistinguishable from
  a nonexistent request id

### Requirement: Only the rider themselves SHALL create a request, and only for a club the accessor would return

`public.club_join_requests` INSERT SHALL be permitted only where `user_id = auth.uid()` **and**
`private.club_takes_join_requests(auth.uid(), club_id)`.

INSERT SHALL be granted **per column** over `(id, club_id, user_id)`. `status`, `created_at` and
`responded_at` SHALL be on no client's INSERT grant, so a rider cannot pre-answer their own request
or backdate it.

The table SHALL carry **no UPDATE grant and no UPDATE policy for any client role**. Status changes
happen only inside the two `security definer` RPCs, which is what makes "the club answers"
enforceable rather than conventional.

#### Scenario: A rider requests to join a private club
- **WHEN** a signed-in, onboarded rider inserts a row naming themselves and a club the accessor
  returns to them
- **THEN** the insert SHALL succeed with `status` taking its default of `pending`
- **AND** `created_at` SHALL be the server's `now()` and `responded_at` SHALL be NULL

#### Scenario: A rider cannot request on someone else's behalf
- **WHEN** any rider inserts a row whose `user_id` is not `auth.uid()`
- **THEN** it SHALL be refused with `42501`

#### Scenario: A rider cannot pre-answer their own request
- **WHEN** the insert names `status`, `created_at` or `responded_at`
- **THEN** it SHALL be refused with `42501`, because INSERT is granted per column over
  `(id, club_id, user_id)` alone
- **AND** the refusal SHALL be from the grant, not from a trigger

#### Scenario: A member cannot request to join the club they are in
- **WHEN** an existing member, admin or the owner inserts a request for their own club
- **THEN** it SHALL be refused, because `club_takes_join_requests` excludes them

#### Scenario: A rider cannot request to join a PUBLIC club
- **WHEN** a rider inserts a request for a public club
- **THEN** it SHALL be refused
- **AND** the reason SHALL be stated in the migration: a public club is joined directly through
  `club_members` INSERT, and a request path for it would be a second way to do one thing

#### Scenario: A rider cannot request to join the default club
- **WHEN** a rider inserts a request for the `clubs.is_default` club
- **THEN** it SHALL be refused, whatever that club's `is_public` value is at the time

#### Scenario: An un-onboarded rider cannot request
- **WHEN** a rider with `terms_accepted_at` NULL or `onboarding_completed_at` NULL attempts the
  insert
- **THEN** `enforce_participation_gate` SHALL refuse it with `23514`
- **AND** the trigger SHALL carry `when (current_user = 'authenticated')`, which is not decoration
  (`023` §2)

#### Scenario: No client role holds UPDATE on the table
- **WHEN** the migration is applied
- **THEN** `has_table_privilege('authenticated', 'public.club_join_requests', 'update')` SHALL be
  **false**, and no UPDATE policy SHALL exist for any role
- **AND** the absence SHALL be commented in the migration, `078`'s precedent, so it is not
  "repaired" later

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** `anon` is examined against the table
- **THEN** it SHALL hold **zero** grants and be named by no policy

### Requirement: A request SHALL be unique per club and rider, and a second one SHALL be refused rather than duplicated

`public.club_join_requests` SHALL carry `unique (club_id, user_id)`. A repeat request SHALL be a
`23505` and never a second row.

#### Scenario: A repeat request while one is pending
- **WHEN** a rider with a `pending` request inserts another for the same club
- **THEN** it SHALL be refused with `23505`
- **AND** the client SHALL treat that as "already requested" rather than as an error

#### Scenario: A repeat request after a decline
- **WHEN** a rider with a `declined` request inserts another for the same club
- **THEN** it SHALL be refused with `23505`
- **AND** this SHALL be asserted explicitly, because it is the mechanism that makes a refusal stick

#### Scenario: A request after leaving the club
- **WHEN** a rider was approved, later left the club, and requests again
- **THEN** the insert SHALL succeed, because approval deleted the request row
- **AND** this SHALL be asserted, because a surviving `approved` row would make a private club a
  rider left permanently unreachable to them

### Requirement: Only the club's owner or an admin SHALL answer a request, and answering SHALL be one statement

`public.approve_club_join_request(request uuid)` and `public.decline_club_join_request(request uuid)`
SHALL each take a **request id and never a rider id**, SHALL be `security definer` with
`set search_path = ''` and `#variable_conflict error`, and SHALL each re-check
`private.is_club_admin_for(auth.uid(), club_id)` in their own body, because RLS does not apply
inside a definer function.

Each SHALL have **exactly one raise site**, so that "no such request", "not your club", "already
answered" and "blocked" are indistinguishable to the caller.

Approval SHALL write the `club_members` row and SHALL delete the request row. Decline SHALL set
`status = 'declined'` and `responded_at = now()` and SHALL write no membership.

#### Scenario: The owner approves
- **WHEN** a club's owner calls `approve_club_join_request` on a `pending` request for their club
- **THEN** a `club_members` row SHALL appear with `role = 'member'`
- **AND** the request row SHALL be gone
- **AND** `role` SHALL be the literal `'member'`, never a value read from the request

#### Scenario: An admin approves
- **WHEN** a rider holding `club_members.role = 'admin'` for that club calls it
- **THEN** it SHALL succeed identically
- **AND** the assertion SHALL create that row directly in the fixture, because `019` makes `admin`
  insertable by no client and `029` measured zero such rows — the authority is written for PD-326
  and must be proven before PD-326 exists

#### Scenario: An ordinary member cannot answer
- **WHEN** a member with `role = 'member'` calls either RPC
- **THEN** it SHALL raise, with the same error a nonexistent request id raises, compared on the
  **message text** and not only the SQLSTATE

#### Scenario: The requester cannot approve their own request
- **WHEN** the requester calls either RPC on their own row
- **THEN** it SHALL raise identically

#### Scenario: An admin of a DIFFERENT club cannot answer
- **WHEN** an owner of another club calls either RPC with this request's id
- **THEN** it SHALL raise identically, and SHALL disclose nothing about whether the id exists

#### Scenario: Answering twice is refused indistinguishably
- **WHEN** either RPC is called on a request that is no longer `pending`
- **THEN** it SHALL raise identically to a nonexistent id

#### Scenario: Approving when the rider is already a member is a no-op
- **WHEN** the rider joined by another route between requesting and being approved — the club
  having flipped public in between
- **THEN** the membership insert SHALL be `on conflict do nothing`, the existing row's `role` and
  `joined_at` SHALL be untouched, and the request row SHALL still be removed

#### Scenario: A blocked requester cannot be approved
- **WHEN** the requester and the approver are blocked in either direction
- **THEN** the RPC SHALL raise the same error a nonexistent id raises, compared on the message text
- **AND** the block SHALL be detected before the membership row is written, so no partial state
  survives

### Requirement: The membership row on an approval path SHALL be written by exactly one function, which restates the participation gate

`private.join_club_from_request(rider uuid, target_club uuid)` SHALL be the only place an approval
writes `club_members`. It SHALL live in `private`, so PostgREST cannot publish it and
`service_role` cannot reach it (`031`'s lesson).

It SHALL restate the participation gate for `rider` — `terms_accepted_at is not null and
onboarding_completed_at is not null` — because `enforce_participation_gate` on `club_members`
carries `when (current_user = 'authenticated')` and `current_user` inside a definer function is the
owner, so the trigger **cannot fire** (`078`).

A second gate trigger SHALL NOT be added to compensate. It would raise the trigger count while
gating nothing, which is `078.9`'s assertion and the exact mistake `078`'s own task list made.

#### Scenario: An un-onboarded rider cannot be approved into a club
- **WHEN** a rider with `terms_accepted_at` NULL is approved
- **THEN** the RPC SHALL refuse and no `club_members` row SHALL appear

#### Scenario: The gate trigger count on `club_members` is unchanged
- **WHEN** the migration is applied
- **THEN** the number of `enforce_participation_gate` triggers on `club_members` SHALL be exactly
  what it was before
- **AND** this SHALL be asserted separately from the scenario above, because the two halves of
  `078`'s lesson fail independently

#### Scenario: The gate is restated rather than delegated
- **WHEN** `private.join_club_from_request`'s body is examined
- **THEN** it SHALL contain the two NOT NULL checks in its own text
- **AND** the migration SHALL comment why, naming `078`

### Requirement: A declined request SHALL be immovable by the requester and clearable only by the club

DELETE on `public.club_join_requests` SHALL be permitted where
`(user_id = auth.uid() and status = 'pending')` **or** `private.is_club_admin(club_id)`.

A requester SHALL be able to withdraw a `pending` request and SHALL NOT be able to remove, alter or
replace a `declined` one. An admin SHALL be able to remove either.

This is the inversion of `083`'s rule, and the inversion is the point: there, decline was terminal
against the **inviter** because the inviter is the party who could spam. Here the requester is that
party, so the terminality binds them.

#### Scenario: The requester withdraws a pending request
- **WHEN** a rider deletes their own `pending` row
- **THEN** it SHALL succeed
- **AND** they SHALL then be able to request again

#### Scenario: The requester cannot clear their own refusal
- **WHEN** the same rider deletes their own `declined` row
- **THEN** the delete SHALL match **zero rows** and SHALL NOT error
- **AND** the client SHALL NOT chain `.select()` onto that delete, because `RETURNING` re-attaches
  the SELECT policy and a zero-row delete would otherwise report success indistinguishably

#### Scenario: An admin clears a refusal so the rider may ask again
- **WHEN** an owner or admin deletes a `declined` row for their club
- **THEN** it SHALL succeed
- **AND** the rider SHALL then be able to insert a new request

#### Scenario: Nobody else can delete a request
- **WHEN** an ordinary member of the club, or any other signed-in rider, attempts a delete
- **THEN** it SHALL match zero rows

### Requirement: Request visibility SHALL be stated per role

`public.club_join_requests` SELECT SHALL be
`(user_id = auth.uid() or private.is_club_admin(club_id)) and not private.is_blocked(auth.uid(), user_id)`.

| Role | Rows returned |
|---|---|
| the requester | their own, in every status |
| the club's owner | every request for that club |
| a club admin | every request for that club |
| an ordinary member of that club | **none** |
| a member of a different club | none |
| any other signed-in rider | none |
| a rider blocked with the requester | none |
| a signed-out visitor | no grant at all |

The SELECT policy SHALL NOT disclose the existence of a private club to anyone who could not
already see it: every row it returns names a club the reader is either an admin of (so a member) or
has themselves requested (so already holds the id from the accessor).

#### Scenario: The requester reads their own row in every status
- **WHEN** a requester selects their own rows
- **THEN** `pending` and `declined` rows SHALL both be returned

#### Scenario: An ordinary member reads nothing
- **WHEN** a member of the club with `role = 'member'` selects from the table
- **THEN** they SHALL read **zero** rows, including rows for their own club and including another
  rider's request
- **AND** this SHALL be asserted explicitly; it is the negative case most likely to be assumed
  rather than written

#### Scenario: Nobody learns who refused
- **WHEN** the table's columns are examined
- **THEN** there SHALL be **no `responded_by` column**, so the requester cannot learn which admin
  declined them
- **AND** the migration SHALL comment that the requester reads every column on their own row, which
  is why the column is absent rather than merely unused

#### Scenario: Blocking hides the row from both parties
- **WHEN** one directional `blocks` row exists between the requester and an admin
- **THEN** neither SHALL read the row
- **AND** a third rider's request to the same club SHALL be unaffected

#### Scenario: `is_blocked` against oneself is false
- **WHEN** a requester reads their own row
- **THEN** the policy's `not private.is_blocked(auth.uid(), user_id)` conjunct SHALL be true,
  because `blocks_no_self_block` refuses a self-block row
- **AND** this SHALL be asserted, because the policy calls the helper once per row and one of the
  two parties is always the caller

#### Scenario: The counted and the listed agree
- **WHEN** any surface shows a count of pending requests beside a list of them
- **THEN** both SHALL be read through the same policy in the same round trip, never one from a
  count and the other from a list

### Requirement: The admin authority SHALL have one body and two entry points, and the fan-out SHALL use the subject-taking one

`private.is_club_admin_for(candidate uuid, target_club uuid)` SHALL be subject-taking,
`security definer`, `stable`, `set search_path = ''`, and granted to **no** client role — a rider
holding EXECUTE would have a private-club-admin oracle.

`private.is_club_admin(target_club uuid)` SHALL be the caller-relative wrapper, its body **exactly**
`select private.is_club_admin_for(auth.uid(), target_club);` and nothing else, granted to
`authenticated` because an RLS expression is evaluated as the querying role. This is `060`'s
`is_club_member` / `is_club_member_for` pattern and SHALL follow it exactly.

The authority SHALL be `clubs.owner_id = candidate` **or** a `club_members` row with
`role in ('owner','admin')` — the same union `private.notify_club_joined` already uses for its
recipient set, so a club owner holding no membership row is an admin here exactly as they are a
member there (`054`).

#### Scenario: The wrapper cannot grow an arm the body does not have
- **WHEN** the two functions are compared
- **THEN** the wrapper's `prosrc` SHALL equal the delegation **exactly**, asserted by equality and
  never by `like` — `060`'s own reasoning, that `like '%..._for%'` is satisfied by the mention alone

#### Scenario: The subject-taking form mentions `auth.uid()` nowhere
- **WHEN** `private.is_club_admin_for`'s body is examined
- **THEN** it SHALL contain no reference to `auth.uid()`
- **AND** this SHALL be asserted, because the request fan-out's recipient set is literally the set
  this function describes, which is `036` trap (c) with a brand-new function to fall into

#### Scenario: An ownerless owner is an admin
- **WHEN** a club's `owner_id` names a rider holding no `club_members` row
- **THEN** `is_club_admin_for` SHALL answer true for them, matching `054`'s treatment of the same
  rider in `private.is_club_member`

#### Scenario: No client role can use it as an oracle
- **WHEN** grants are examined
- **THEN** `has_function_privilege('authenticated','private.is_club_admin_for(uuid,uuid)','execute')`
  SHALL be **false**, and the wrapper's SHALL be **true**

### Requirement: A request SHALL survive a change in the club's visibility and SHALL die with the club or with either rider

#### Scenario: The club is deleted
- **WHEN** a club with pending and declined requests is deleted
- **THEN** every request for it SHALL be removed by `on delete cascade`
- **AND** every notification carrying that `club_id` SHALL go with it, by `036`'s own cascade

#### Scenario: The requester deletes their account
- **WHEN** a rider with outstanding requests deletes their account
- **THEN** their requests SHALL be removed by `on delete cascade` on `user_id`
- **AND** no admin SHALL be left holding a row naming a rider who no longer exists

#### Scenario: The club's owner deletes their account
- **WHEN** the owner of a club with a pending request deletes their account
- **THEN** the club SHALL survive through `029`/`032`'s succession and the request SHALL survive
  with it, answerable by the new owner
- **AND** where nobody remains and the club is deleted, the cascade above SHALL apply

#### Scenario: The club flips private to public
- **WHEN** a club with a pending request is made public
- **THEN** the request SHALL survive and SHALL remain answerable
- **AND** the club SHALL leave the accessor's results and appear in the ordinary public half of
  Explore, with `Join club` rather than `Request to join`
- **AND** a rider who joins directly while holding a pending request SHALL leave a stale row that
  the approval RPC's `on conflict do nothing` renders harmless

#### Scenario: The club flips public to private
- **WHEN** a public club is made private
- **THEN** existing requests SHALL be unaffected
- **AND** `propagate_club_privacy_to_rides` (`022`) SHALL run as it does today, this change adding
  nothing to it

#### Scenario: Every cascade path is indexed
- **WHEN** the indexes are examined
- **THEN** each FK column SHALL **lead** an index (`029`'s rule) and the migration SHALL state in a
  comment which index discharges which FK

### Requirement: Requests SHALL have a stated retention, and its absence SHALL be a decision

A `club_join_requests` row records that one named rider asked to join one named club at a named
time. Its retention window SHALL be stated: **until the club is deleted, the rider is deleted, or
an admin removes the row.** There SHALL be **no expiry** on a pending request.

#### Scenario: The absence of an expiry is recorded rather than omitted
- **WHEN** the retention decision is reviewed
- **THEN** the migration and `design.md` SHALL both state that no expiry exists, what was
  considered, and the trigger that would reopen it
- **AND** the reason SHALL be that an expiry silently withdraws a rider's request in a way neither
  party is told about, which — given that a decline is also silent — makes an expiry
  indistinguishable from a refusal and from a club that never looked

#### Scenario: A pending request outlives inattention
- **WHEN** nobody answers a request
- **THEN** it SHALL remain `pending` indefinitely and SHALL continue to render as `Requested` to
  the rider

### Requirement: Every request and discovery surface SHALL define all seven of its states

Empty, loading, error, offline, permission-denied-versus-empty, partial and stale SHALL each be
defined for: the Explore list with its private half, the reduced club screen, and the admin request
list.

#### Scenario: Empty
- **WHEN** the accessor returns nothing
- **THEN** the Explore list SHALL render its existing empty state unchanged, and SHALL NOT claim
  there are no private clubs — it cannot know that, since the page is bounded
- **AND** an admin's request list with no pending rows SHALL NOT render at all, rather than render
  an empty section, because the section is an exception surface and a permanent empty one is noise

#### Scenario: Loading
- **WHEN** either half of the Explore list is still in flight
- **THEN** the screen SHALL gate on **data**, never on `isLoading`, and SHALL render its skeleton
  at the content's own padding

#### Scenario: Error and retry
- **WHEN** the accessor fails while the public half succeeds
- **THEN** the list SHALL NOT silently render the public half alone as if it were complete
- **AND** the failure SHALL be surfaced with a retry, because a silently-shortened list is
  indistinguishable from there being nothing to find

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** `Request to join`, Approve and Decline SHALL be disabled with a stated reason and the
  action SHALL NOT be queued — a request answered from a stale queue would be answered against a
  row that may have moved

#### Scenario: Permission denied versus empty
- **WHEN** a rider reaches the reduced club screen
- **THEN** the screen SHALL issue **no query that could return zero rows** — it renders only what
  the accessor returned — so the two states cannot be confused
- **AND** the sentence naming the state SHALL be a statement about the club's privacy, never an
  empty-state sentence claiming the club has no rides, postcards or members

#### Scenario: Partial
- **WHEN** the request-status read succeeds and the accessor fails, or the reverse
- **THEN** a private card SHALL NOT render `Request to join` on unknown status — an unknown status
  SHALL render no control, because offering one that turns out to be a duplicate is a promise the
  database will refuse

#### Scenario: Stale
- **WHEN** a request is answered on another device
- **THEN** the rider's next read SHALL reflect it, and the control SHALL be derived from the live
  request row rather than from anything cached alongside the club
