## ADDED Requirements

### Requirement: A fan-out whose actor is its own recipient SHALL be permitted only where that is the honest attribution, and SHALL be stated as an exception

The standing rule *"A rider SHALL NEVER be notified of their own action"* is expressed everywhere in
this repo as `where candidates.recipient <> new.user_id`, and every existing fan-out carries it.
`private.notify_club_join_request_declined` (`089`) is the **first and only** fan-out where
recipient and actor are deliberately the same rider, and it SHALL be recorded as an exception rather
than allowed to read as a missing exclusion.

The event being recorded is *"the club answered YOUR request"*, and the rider is the subject of their
own request. `actor_id` is NOT NULL and references `profiles`, so it must name somebody; every other
candidate discloses more (see the `notifications` delta). The self-actor is the only value that is
both honest and non-disclosing.

**The exclusion SHALL NOT be copied into this fan-out**, and the reason SHALL be in the function's
own comment, because the next reader's first instinct will be to add it and doing so would delete
every row this fan-out writes.

#### Scenario: The exclusion is absent, and its absence is asserted
- **WHEN** `private.notify_club_join_request_declined`'s `prosrc` is read
- **THEN** it SHALL contain no `recipient <> ` exclusion, and the assertion SHALL name the reason so
  a later "tidy" fails a test rather than silently emptying the feature

#### Scenario: Every other fan-out still excludes the actor
- **WHEN** the other fan-outs are inspected
- **THEN** each SHALL still exclude the actor, and each SHALL still be asserted separately — the
  exception SHALL NOT be generalised

### Requirement: A fan-out's recipient guard SHALL be the read policy's predicate, including when that predicate is a disjunction

`085` learned this once: a row written to somebody whose own policy will never return it is invisible
for ever and looks correct to every test that checks the row was inserted. The guard SHALL therefore
be the **whole** of the read predicate, subject-taking, and SHALL NOT be one convenient half of it.

For `club_join_request_declined` the read predicate is a disjunction, so the guard is:

```sql
private.can_read_club(new.user_id, new.club_id)
or private.club_takes_join_requests_for(new.user_id, new.club_id)
```

Both arms SHALL be present. The first alone drops every decline for a private club, which is the
entire feature. The second alone drops a decline for a club that has since flipped public or that
the rider has since joined.

Both SHALL be the **subject-taking** forms. `036` trap (c) is at its sharpest here for the second
one, because the caller-relative wrapper `private.club_takes_join_requests(uuid)` is the name a
policy uses two files away and would compute the answer for the **declining admin** rather than for
the requester — who is always able to see the club, so the guard would pass for everyone and guard
nothing.

#### Scenario: Both arms are exercised
- **WHEN** a decline is issued for a private club the rider may still request
- **THEN** a row SHALL be written, through the second arm
- **WHEN** a decline is issued for a club the rider is somehow a member of
- **THEN** a row SHALL be written, through the first arm

#### Scenario: A blocked requester gets no row at all
- **WHEN** a `blocks` row exists in either direction between the requester and the club's owner and
  a pending request is declined
- **THEN** **zero** notification rows SHALL be written, because both arms are false

#### Scenario: The guard uses the subject-taking twins
- **WHEN** the fan-out's `prosrc` is read
- **THEN** it SHALL mention `auth.uid()` **nowhere**, and SHALL call `can_read_club` and
  `club_takes_join_requests_for` in their two-argument forms

### Requirement: A retraction already hung on an event SHALL be reused rather than duplicated, and its scope SHALL be re-proved against every new type on the same event

`087` hung `private.retract_club_join_requested` on `after update of status`, which is the **same
event** `089`'s fan-out fires on. Two triggers on one event SHALL be permitted, and the new type
SHALL be protected from the existing retraction by that retraction's `type` conjunct rather than by
trigger ordering.

`085` wrote that conjunct for exactly this hazard — *"the `type` conjunct is what stops an approval
deleting the `club_join_request_approved` row it writes in the same transaction"* — and the same
sentence now has a second instance. Relying on alphabetical trigger order instead would be a
guarantee nothing states and nothing tests.

**No new retraction trigger SHALL be added for the decline**: an admin clearing a declined row
DELETEs it, and `085`'s delete-arm trigger already fires. Its scope SHALL be extended to remove the
decline notification as well as the request notification, in one function, so a future writer of
`status` inherits both halves automatically.

#### Scenario: The decline notification survives the retraction that fires beside it
- **WHEN** `decline_club_join_request` succeeds
- **THEN** the admins' `club_join_requested` rows SHALL be gone **and** the requester's
  `club_join_request_declined` row SHALL exist
- **AND** the assertion SHALL be order-independent — it SHALL NOT be satisfied by the two triggers
  happening to fire in a convenient sequence

#### Scenario: Clearing a declined row takes its notification with it
- **WHEN** an admin deletes a `declined` row
- **THEN** the requester's `club_join_request_declined` row SHALL be gone
- **AND** the rider SHALL be able to ask again, with no notification left claiming a refusal that no
  longer exists

#### Scenario: The retraction is scoped to its own event key
- **WHEN** two riders hold declines from the same club and one is cleared
- **THEN** only that rider's notification SHALL be removed, scoped by `user_id`, `type` and
  `club_id` together
