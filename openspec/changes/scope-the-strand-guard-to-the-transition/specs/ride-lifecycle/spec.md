## MODIFIED Requirements

> **Read this delta against `add-ride-club-edit-delete`, not against `openspec/specs/`.** The
> `ride-lifecycle` capability is added by PD-101's change, which is still active and unarchived,
> so the base text these requirements modify lives in
> `openspec/changes/add-ride-club-edit-delete/specs/ride-lifecycle/spec.md`. Archive that change
> before this one, or the delta has nothing to attach to.
>
> **The rule is stated twice in the base — a requirement bullet and a scenario — and the adjacent
> ex-member requirement restates it a third time as one of its two exits.** All three move
> together here. Amending one and leaving the others is how the spec ends up disagreeing with
> itself, which is what PD-338 found in the code.

### Requirement: Editing a ride SHALL NOT be able to strand its crew

`club_id` and `is_public` are both editable, and together they decide the ride's audience. **The
rule is about the transition, not the shape**: an edit SHALL NOT be able to *reduce* a ride's
standing audience to its organizer alone while `ride_members` rows survive — the zombie shape
`029` names. An edit to a ride that **already** has no standing audience SHALL be permitted, and
SHALL NOT be refused, disabled or warned about.

**"Standing audience" is defined here because the whole requirement turns on it.** It is the set
of riders who can see the ride by a standing rule rather than by a per-rider invitation the
organizer issued:

| Stored shape | Standing audience |
|---|---|
| `is_public` true, `club_id` NULL | every signed-in rider not blocked with the organizer |
| `is_public` true, club is public | every signed-in rider not blocked with the organizer |
| `club_id` not NULL | that club's members (`private.is_club_member`) |
| `is_public` false and `club_id` NULL | **nobody but the organizer** |

Riders holding a **live invite** are deliberately NOT counted as a standing audience. `083`'s
fourth `rides` SELECT arm — `private.has_live_ride_invite(id)`, live on DEV — means such a ride is
reachable, which is why the shape is legitimate at all; but each of those riders was named by the
organizer one at a time, so an invite grants *reach* without giving the ride an audience the
organizer did not personally choose.

- **The refused transition, stated as a predicate.** An update SHALL be refused when the **stored**
  row has a standing audience and the **submitted** row would not — that is, when `submitted.club_id
  IS NULL AND submitted.is_public IS false`, **and** the stored row was not already in that shape.
  Two edits produce it: detaching a private ride from its club (`club_id` → NULL with `is_public`
  false), and un-publishing a clubless public ride (`is_public` → false with `club_id` NULL).
- **An edit to a ride already in that shape SHALL save.** This includes a ride with `ride_members`
  rows and a ride with none, and it includes every field: title, meeting point, departure time,
  route. **This is the case PD-320 made ordinary** — the composer's default output for any ride
  created outside a club — and refusing it made the ride uneditable except by publishing it to
  every signed-in rider.
- **`createRide` SHALL NOT carry this guard, and that is deliberate rather than an omission.**
  Creating a ride with no club and no publication narrows nothing: there is no prior audience and
  no crew. The two write paths therefore disagree **by design**, and any future reviewer finding
  the asymmetry SHALL read this sentence rather than "fixing" it.
- **Moving a ride into a club** SHALL be permitted only for a club the organizer is a member of;
  the `WITH CHECK`'s `private.is_club_member(club_id)` already refuses otherwise, and the form
  SHALL offer only those clubs.
- **Moving a ride into a private club while `is_public` is true** SHALL raise
  `enforce_ride_club_audience`, which fires `BEFORE INSERT OR UPDATE`. The action SHALL match
  SQLSTATE `23514` **and** the message text `private club cannot be public`, exactly as
  `createRide` does — `018`'s length CHECKs raise the same SQLSTATE, and reporting a
  title-too-long as an audience problem is the failure that match avoids.
- **Riders who lose sight of the ride through a legitimate edit** — a public ride moved into a
  private club they do not belong to — SHALL keep their `ride_members` row. Their loss of access
  is the policy working, not a defect; nothing in this change deletes their RSVP behind them, and
  no crew member SHALL be notified that a ride's audience changed.
- **This rule is advisory and SHALL be written down as advisory.** It lives in the client and in
  `updateRide`, and `CLAUDE.md` is explicit that a rule reaching only client code is advisory
  because the client owns the mutation path. No CHECK, trigger or policy expresses it, and the
  `rides` UPDATE `WITH CHECK` permits the shape. **That is a decision, not a gap** — see
  `design.md` §D2 — and a spec that claimed the database refuses this would be false.
- **The refusal SHALL argue from what is actually lost, and SHALL NOT claim the ride would be
  invisible to everyone.** Since `083` a private clubless ride is visible to riders the organizer
  invites, so *"nobody but you could ever see it"* is false and SHALL NOT appear. The sentence
  SHALL name the riders already in the crew as the thing at risk, and SHALL name both remedies.
- **The refusal SHALL exist as exactly ONE string**, rendered by the form and returned by the
  action. Two copies existed, drifted, and both argued from the retired premise.
- **The refusal message SHALL be `role="alert"` and the action's error SHALL be `role="status"`.**
  `npm run walk`'s `refused edit` phase reads `role="status"` only, precisely so a live warning
  cannot be mistaken for a submitted refusal; swapping either role makes that phase report a
  refusal that never happened.

#### Scenario: An organizer edits the title of a ride created under the private default

- **WHEN** the organizer of a ride with `club_id` NULL and `is_public` false — the composer's
  default output — opens the edit form and changes only the title
- **THEN** Save SHALL be enabled and no refusal SHALL be shown
- **AND** the update SHALL be written
- **AND** this SHALL hold whether or not the ride has `ride_members` rows, and whether or not it
  has any invites

#### Scenario: A rider who belongs to no clubs edits their ride

- **WHEN** the organizer belongs to no clubs, so the club picker offers only "No club", and their
  ride is private and clubless
- **THEN** the form SHALL NOT require them to publish the ride in order to save any other field
- **AND** ticking "Make this ride public" SHALL remain a choice they can decline

#### Scenario: An organizer detaches a private ride from its club

- **WHEN** an organizer sets `club_id` to NULL on a ride whose stored `is_public` is false and
  whose stored `club_id` is not NULL
- **THEN** the form SHALL refuse to save and SHALL name both remedies
- **AND** no row SHALL be written
- **AND** the entered values SHALL be kept, including the club selection and the checkbox

#### Scenario: An organizer un-publishes a ride that is in no club

- **WHEN** an organizer clears "Make this ride public" on a ride whose stored `club_id` is NULL
  and whose stored `is_public` is true
- **THEN** the edit SHALL be refused, because the standing audience would fall from every signed-in
  rider to nobody
- **AND** the refusal SHALL name picking a club or leaving it public, and SHALL NOT claim the ride
  would be invisible to everyone
- **AND** the organizer's remaining exits SHALL be exactly: leave it public, put it in a club, or
  delete the ride — there is no in-app path to make an existing clubless public ride private, and
  that is recorded as an accepted cost in `design.md` §D1 rather than left undiscovered

#### Scenario: The action is reached directly with the refused transition

- **WHEN** an update reaches `updateRide` with `club_id` NULL and `is_public` false for a ride
  whose stored row has a standing audience
- **THEN** the action SHALL refuse with the same single string the form renders
- **AND** the prior shape SHALL be read fresh from the database, never taken from a form field —
  a client that can post the payload can post a claim about the prior state too

#### Scenario: The prior row cannot be read

- **WHEN** `updateRide` cannot read the ride's stored `club_id` and `is_public` — it is gone, or
  the caller cannot see it
- **THEN** the action SHALL NOT invent a refusal and SHALL NOT invent a permission
- **AND** the update SHALL proceed, so that RLS matching zero rows is what reports the failure

#### Scenario: An organizer makes a private club's ride public

- **WHEN** an organizer sets `is_public` true on a ride whose club is private
- **THEN** the database SHALL raise `check_violation`
- **AND** the screen SHALL show the audience-specific message, not a generic failure

#### Scenario: The club list fails to load for a ride already in the shape

- **WHEN** the organizer's club list read fails (`clubs === null`) on a ride whose stored `club_id`
  is NULL and `is_public` is false
- **THEN** the club control SHALL render as the disabled, stated value it already does
- **AND** Save SHALL be enabled, because nothing is being narrowed
- **AND** the screen SHALL NOT present a state in which no control on the form can make Save
  reachable

#### Scenario: A crew member of a ride whose audience narrows legitimately

- **WHEN** a public clubless ride with `ride_members` rows is moved into a private club the crew
  do not belong to
- **THEN** the edit SHALL be permitted, because the standing audience becomes the club rather than
  nobody
- **AND** every `ride_members` row SHALL survive untouched, and no notification SHALL be sent

#### Scenario: No role other than the organizer gains anything

- **WHEN** a crew member, a club admin, a club owner, a non-member, a rider blocked with the
  organizer, or a signed-out visitor attempts to update the ride
- **THEN** the outcome SHALL be exactly what it was before this change: the `rides` UPDATE policy
  is unchanged, `USING (auth.uid() = organizer_id)` with `WITH CHECK (auth.uid() = organizer_id
  AND (club_id IS NULL OR private.is_club_member(club_id)))`
- **AND** relaxing a client-side refusal SHALL NOT be read as widening a policy; this change adds
  no grant, no policy and no migration

#### Scenario: A declined or withdrawn invitee cannot see the ride the message promises

- **WHEN** a rider's invite to a private clubless ride is `declined`, or the organizer withdrew it
- **THEN** they SHALL NOT be able to see the ride, because `private.has_live_ride_invite_for`
  matches `status in ('pending', 'accepted')` only
- **AND** no copy written for this change SHALL imply that everyone the organizer has ever invited
  can still see it

#### Scenario: A blocked rider is not an available remedy

- **WHEN** the organizer is blocked with a rider in either direction
- **THEN** that rider SHALL NOT be invitable — the `ride_invites` INSERT policy carries
  `NOT private.is_blocked(auth.uid(), invitee_id)` — and SHALL NOT reach the ride
- **AND** this change SHALL add no block predicate of its own to the client; blocking is enforced
  in RLS once, symmetrically, and a second copy in a component is a copy that can disagree

### Requirement: An organizer who has left the ride's club SHALL be told why the edit is refused, and SHALL be offered the two exits that exist

The `rides` UPDATE `WITH CHECK` is `auth.uid() = organizer_id AND (club_id IS NULL OR
private.is_club_member(club_id))`, and a `WITH CHECK` is evaluated against the **post-update row
on every update**, not only on updates that touch `club_id`. So a rider who organized a ride in a
club and then left that club **can never edit that ride again** — not the title, not the meeting
point, not the departure time. The `USING` clause passes (they are still the organizer); the
`WITH CHECK` fails on a column they did not touch.

This is a live dead end reachable by `leaveClub`, which already ships. It is not hypothetical.

**Two exits exist and both are already permitted by the policies as written:**

- **Delete the ride.** The DELETE policy is `auth.uid() = organizer_id` with no membership test at
  all, so cancelling always works.
- **Detach the ride from the club.** Setting `club_id` to NULL satisfies the `WITH CHECK`'s first
  disjunct, and `enforce_ride_club_audience` does not fire when `club_id` is NULL. **Detaching
  SHALL be offered only together with making the ride public**, and that remains true under the
  transition rule above rather than in spite of it: the ride's stored shape has a standing audience
  (its club), so detaching while private is exactly the refused transition. **The reason has
  changed and the outcome has not** — it is no longer "nobody could ever see it", it is "the club
  members who can see it today would lose it, and the crew with it". The message SHALL say the
  second thing.

**There is no third exit, and the absence is stated rather than left to be rediscovered.** An
ex-member cannot detach-and-stay-private even though `083` would let them invite riders back in
one at a time. Whether that exit should exist is `design.md` §Open questions Q1, not something a
build session decides.

The UI SHALL **show the Edit affordance and surface the refusal**, not hide it. Hiding it makes
the organizer's own ride look like someone else's, which is the same undiagnosable state as the
permission-denied case. The message SHALL name the club, say that leaving it is why the save was
refused, and offer the two exits above.

**This change SHALL NOT widen the `rides` UPDATE policy**, and any future proposal that does must
say loudly that it is a visibility change: removing the `is_club_member` conjunct would let an
ex-member keep editing a ride that is visible to a private club they are no longer in, which is
the club's audience being written by an outsider.

#### Scenario: An organizer leaves the club and then edits their ride

- **WHEN** a rider who organized a club ride calls `leaveClub` and then submits any edit to that
  ride
- **THEN** the `WITH CHECK` SHALL refuse the row even though no club field was changed
- **AND** the screen SHALL name the club, explain that leaving it caused the refusal, and offer
  cancelling the ride or making it public and detaching it

#### Scenario: An ex-member detaches the ride and leaves it private

- **WHEN** that rider sets `club_id` to NULL without ticking "Make this ride public"
- **THEN** the transition rule SHALL refuse it before the request leaves the browser, with the
  crew-losing-sight message rather than the ex-member message
- **AND** the two exits offered SHALL remain deleting the ride, or making it public and detaching

#### Scenario: An ex-member cancels the ride instead

- **WHEN** that same rider deletes the ride
- **THEN** the DELETE SHALL succeed, because the DELETE policy carries no membership test
