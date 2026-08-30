## MODIFIED Requirements

### Requirement: The recipient set SHALL be computed by direct query, never through a caller-relative helper

Recipient membership SHALL be evaluated with an explicit predicate naming the candidate rider.
`private.is_club_member` and `private.is_ride_crew` SHALL NOT be used inside a fan-out.

**Both helpers read `auth.uid()` internally** — verified 2026-08-07 — so each answers *"is the
caller a member"* and never *"is this candidate a member"*. A fan-out reaching for one computes the
actor's own membership and applies that single answer to every candidate: the set is either
everybody or nobody, and it looks correct in a one-member test. `private.is_blocked(a, b)`,
`private.is_club_public(club)`, `private.can_read_ride(candidate, ride)` and
`private.can_read_club(candidate, club)` take their subject as an argument and are the forms a
fan-out may use.

**The rule binds a fan-out whose recipient is a single named rider exactly as hard, and that is the
reading this requirement previously left open.** Where the recipient comes straight out of `NEW` —
`new.invitee_id`, `new.inviter_id` — no *set* is computed, so the sentence above has nothing to bite
on and invites the conclusion that a caller-relative helper is harmless here. It is not. Every
question a fan-out asks about that named rider is still a question about **somebody other than the
caller**: whether they are blocked with the actor, and above all whether the read policy can ever
return the row to them. A caller-relative helper answers all of those for the **actor**, and with a
single recipient the wrong answer produces one wrong row rather than a wrong set, which is harder to
see and not less wrong.

Any new caller-relative helper introduced alongside a fan-out SHALL therefore ship with its
candidate-relative form in the same migration, and the fan-out SHALL use the candidate form.

#### Scenario: A single named recipient is still evaluated candidate-relative
- **WHEN** a fan-out addresses one rider read out of `NEW`
- **THEN** every predicate it evaluates about that rider SHALL take the rider as an argument
- **AND** no helper reading `auth.uid()` SHALL appear in the fan-out, including one added by the
  same migration for the policy's own use

#### Scenario: A new visibility arm reaches the fan-out through the candidate form
- **WHEN** a migration adds an arm to a policy that a fan-out's resolvability check restates
- **THEN** the fan-out SHALL see the new arm through the candidate-relative restatement
- **AND** a fan-out that would have written a row before the arm and not after it, or the reverse,
  SHALL be treated as evidence the two copies have drifted

#### Scenario: The owner union applies to `club_joined` and NOT to `ride_created_in_club`
- **WHEN** a club's `owner_id` holds no `club_members` row
- **THEN** the `club_joined` recipient set SHALL be `clubs.owner_id` **∪** `club_members`, because
  `clubs` SELECT carries an `owner_id = auth.uid()` arm and the row therefore resolves for them
- **AND** the `ride_created_in_club` recipient set SHALL be `club_members` **alone**, because the
  only arm of `rides` SELECT admitting a club's members is
  `club_id IS NOT NULL AND private.is_club_member(club_id)`, and `private.is_club_member` queries
  `club_members` with **no owner arm** — so a row written to an ownerless owner is one the SELECT
  policy drops on every read, permanently
- **AND** the asymmetry SHALL be recorded at both sites, because the two sets read as
  interchangeable and are not: what differs is the **subject's** policy, not the club

#### Scenario: The ownerless-owner state is reachable in one request, not only by a failed pair
- **WHEN** the reachability of an ownerless owner is assessed
- **THEN** it SHALL be recorded that `club_members` DELETE is a bare `(auth.uid() = user_id)` with
  **no owner carve-out** — verified 2026-08-07 — so any owner may leave their own club and keep
  ownership in a single request
- **AND** `createClub`'s two non-transactional inserts SHALL be recorded as a *second* route to the
  same state rather than as the only one, because a design that assumes the failure is rare
  under-weights a state a rider can reach deliberately

#### Scenario: The narrowing is a consequence of a defect and SHALL NOT be defended as a preference
- **WHEN** the `ride_created_in_club` recipient set is reviewed
- **THEN** its reason SHALL be recorded as a pre-existing defect rather than as a decision that
  owners do not want the notification: an ownerless owner **cannot see their own private club's
  rides at all today**, and `rides` INSERT's own `with check` — `club_id IS NULL OR
  private.is_club_member(club_id)` — refuses them a ride in their own club
- **AND** a notification SHALL NOT be the one surface that pretends otherwise, because a row that
  renders "created a ride in ‹club›" for a ride whose detail screen returns not-found is worse than
  no row
- **AND** when `enforce-creator-membership` lands, every owner SHALL hold a membership row, the two
  sets SHALL coincide, and this narrowing SHALL become invisible rather than needing reversal
- **AND** this change SHALL NOT depend on that change landing first, in either order

## ADDED Requirements

### Requirement: A fan-out on a status transition SHALL fire on the transition and not on the row

Where an event is a **change** to a row rather than the row's existence, the trigger SHALL be an
`AFTER UPDATE` guarded on the transition itself — `old.status is distinct from new.status` and the
new value — and SHALL NOT fire on any statement that touches the row for another reason.

It SHALL carry **no** `when (current_user = …)` clause. `036` trap (a) applies with extra force
here: the writers of these transitions are themselves `security definer` functions, for which
`current_user` is the owner, so such a clause would disable the fan-out entirely rather than merely
skipping seeds.

#### Scenario: Only the transition fires
- **WHEN** a statement updates an invite row without moving `status`
- **THEN** no notification SHALL be written

#### Scenario: The definer writer still fans out
- **WHEN** the transition is made by a `security definer` RPC
- **THEN** the fan-out SHALL fire, which SHALL be asserted directly, because a `when` clause added
  later would silently stop it and nothing else would notice

#### Scenario: Each terminal answer produces at most one live row per recipient
- **WHEN** the same answer is submitted twice
- **THEN** the second SHALL raise before reaching the fan-out, and the unique event key SHALL
  additionally make a duplicate row impossible

### Requirement: A retraction SHALL exist for any fan-out whose subject row can be withdrawn

Where the row a fan-out fires on can be deleted by its author while the event it announced has not
yet been acted on, an `AFTER DELETE` trigger SHALL delete exactly the notification the matching
fan-out would have written, matched on the full event key.

It SHALL NOT delete notifications recording an event that already happened — an answer, an
acceptance, a join — because those are records rather than pending prompts.

#### Scenario: Withdrawing the prompt withdraws the notification
- **WHEN** an invite is revoked while pending
- **THEN** the invitee's `ride_invited` notification SHALL be gone
- **AND** the unread count SHALL agree, because both are read through the same policy

#### Scenario: Records of answers survive
- **WHEN** any invite row is deleted for any reason
- **THEN** notifications recording an accept or a decline SHALL be unaffected by the retraction
  trigger, and SHALL die only through their own subject and actor cascades
