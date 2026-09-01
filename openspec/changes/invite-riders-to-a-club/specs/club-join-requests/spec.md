# club-join-requests

## MODIFIED Requirements

> **Read this delta against the active changes, not against `openspec/specs/`.** The
> `club-join-requests` capability is added by `show-private-clubs-and-request-to-join` (PD-325) and
> extended by `manage-club-riders` (PD-326); **neither is archived**, so the base text these
> requirements modify lives in
> `openspec/changes/show-private-clubs-and-request-to-join/specs/club-join-requests/spec.md`.
> Archive those two before this change, or the delta has nothing to attach to.

### Requirement: Only the rider themselves SHALL create a request, and only for a club the accessor would return

`private.club_takes_join_requests_for` is **not modified by this change**, and that is a decision
rather than an omission.

The tempting narrowing is to exclude a rider who already holds a live invite, so the two mechanisms
cannot coexist at all. It is refused: that predicate is also `public.discoverable_private_clubs`'
filter, so narrowing it removes the club from an invited rider's Explore list — a visible change to a
shipped screen, for no safety gain, since a rider who can be invited can already ask.

**The determinism is enforced from the other side.** `private.club_takes_invites_for` is false while
a `pending` request exists, so the **invite** is what gives way; and where the two nonetheless meet,
the membership write clears the request.

#### Scenario: A rider holding a live invite may still ask
- **WHEN** an invited rider finds the club in Explore and requests to join
- **THEN** the request SHALL be created and the club SHALL remain discoverable to them
- **AND** `discoverable_private_clubs`' result set SHALL be unchanged by the existence of an invite

#### Scenario: An invite to a rider who has asked is refused instead
- **WHEN** an admin invites a rider holding a pending request for the same club
- **THEN** the invite SHALL be refused, and the admin's remedy SHALL be to approve the request

### Requirement: A declined request SHALL be immovable by the requester and clearable only by the club

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
