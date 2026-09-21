# club-join-requests

## MODIFIED Requirements

> **Read this delta against `openspec/specs/club-join-requests/spec.md`.** The capability was added
> by `show-private-clubs-and-request-to-join` (PD-325) and extended by `manage-club-riders` (PD-326),
> and both archived on 2026-09-21 —
> `openspec/changes/archive/2026-09-21-show-private-clubs-and-request-to-join/specs/club-join-requests/spec.md`
> is the first — so the standing spec is the base text these requirements modify.

### Requirement: Only the rider themselves SHALL create a request, and only for a club the accessor would return

`public.club_join_requests` INSERT SHALL be permitted only where `user_id = auth.uid()` **and**
`private.club_takes_join_requests(auth.uid(), club_id)`.

INSERT SHALL be granted **per column** over `(id, club_id, user_id)`. `status`, `created_at` and
`responded_at` SHALL be on no client's INSERT grant, so a rider cannot pre-answer their own request
or backdate it.

The table SHALL carry **no UPDATE grant and no UPDATE policy for any client role**. Status changes
happen only inside the two `security definer` RPCs, which is what makes "the club answers"
enforceable rather than conventional.

A join request SHALL be created only by the rider it names, and only for a club
`private.club_takes_join_requests_for` would return to them.

`private.club_takes_join_requests_for` is **not modified by this change**, and that is a decision
rather than an omission.

The tempting narrowing is to exclude a rider who already holds a live invite, so the two mechanisms
cannot coexist at all. It is refused: that predicate is also `public.discoverable_private_clubs`'
filter, so narrowing it removes the club from an invited rider's Explore list — a visible change to a
shipped screen, for no safety gain, since a rider who can be invited can already ask.

**The determinism is enforced from the other side.** `private.club_takes_invites_for` is false while
a `pending` request exists, so the **invite** is what gives way; and where the two nonetheless meet,
the membership write clears the request.

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

#### Scenario: A rider holding a live invite may still ask
- **WHEN** an invited rider finds the club in Explore and requests to join
- **THEN** the request SHALL be created and the club SHALL remain discoverable to them
- **AND** `discoverable_private_clubs`' result set SHALL be unchanged by the existence of an invite

#### Scenario: An invite to a rider who has asked is refused instead
- **WHEN** an admin invites a rider holding a pending request for the same club
- **THEN** the invite SHALL be refused, and the admin's remedy SHALL be to approve the request

### Requirement: A declined request SHALL be immovable by the requester and clearable only by the club

DELETE on `public.club_join_requests` SHALL be permitted where
`(user_id = auth.uid() and status = 'pending')` **or** `private.is_club_admin(club_id)`.

A requester SHALL be able to withdraw a `pending` request and SHALL NOT be able to remove, alter or
replace a `declined` one. An admin SHALL be able to remove either.

This is the inversion of `083`'s rule, and the inversion is the point: there, decline was terminal
against the **inviter** because the inviter is the party who could spam. Here the requester is that
party, so the terminality binds them.

A declined request SHALL NOT be moved or removed by the requester, and SHALL be clearable only by
the club.

Unchanged in substance. **One new writer of the row exists** and it is not a client:
`private.join_club_from_invite` deletes a **pending** request for the pair it has just admitted,
running as the owner and therefore bypassing the DELETE policy.

That is not an exception to this requirement — the policy still governs every client delete, and a
`declined` row is untouched by the new writer. It is stated here because a reader of this requirement
alone would conclude a request row can only leave by a client's delete, and it can now also leave
because the rider joined by another route.

**The retraction is the point of doing it in the database rather than in the client.** `085`/`087`'s
`private.retract_club_join_requested` fires on that delete and takes the admins' *"X asked to join"*
notification with it. Without the delete, every admin keeps an actionable request line for a rider
who is already a member — `087`'s defect, arriving by a third route.

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

#### Scenario: Joining through an invite clears the pending request
- **WHEN** a rider with a pending request accepts an invite or claims a link for the same club
- **THEN** the pending request SHALL be deleted in the same transaction, **after** the membership row
  is written
- **AND** the `club_join_requested` notification held by each admin SHALL be retracted by the
  existing trigger
- **AND** the club's Requests list SHALL not show a rider who is already a member

#### Scenario: A declined request is not cleared by a later join
- **WHEN** the rider's request was `declined` rather than `pending` and they later join through a
  link
- **THEN** the declined row SHALL survive, because it is the record of a refusal and only an admin
  may clear it
- **AND** the rider being a member SHALL not depend on it in any way

#### Scenario: The order is asserted, not assumed
- **WHEN** the writer's body is read
- **THEN** the membership INSERT SHALL precede the request DELETE, so no window exists in which the
  rider is neither requested nor a member
