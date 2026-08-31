# event-fanout-integrity

## MODIFIED Requirements

### Requirement: A fan-out SHALL NOT write a row that the read policy can never return to its recipient

For every type, the recipient set SHALL be a **subset** of the set to which the `notifications`
SELECT policy will return that row. A row that the policy drops on every read from the instant it is
written SHALL be treated as a defect in the fan-out, not as a row awaiting a policy change.

The mapping SHALL be stated per type and checked whenever **either** side changes. This change adds
two rows:

| Type | Recipient set | The policy arm that returns it |
|---|---|---|
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
