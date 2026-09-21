# ride-lifecycle Specification

## Purpose
Who may correct a ride, who may cancel it, and what a cancellation takes with it. The audience
question is already settled by the `rides` SELECT policy; what this capability adds is that
**editing is a visibility operation** — `club_id` and `is_public` are both editable columns, so a
correction to a ride can change who can see it, and the two-line form that does it must not be
able to strand a crew.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`** — except the four named here, which the suite
cannot reach. The suite runs as the table owner, for whom RLS does not exist (`031`'s lesson), so
anything about *what a screen renders* or *which columns an action sends* is `reviewer`'s and
`npm run walk`'s. Stated anyway, because the alternative is that they are not written down at all.

| Requirement | Enforced by |
|---|---|
| Only the organizer may edit or delete | suite — both directions, per role |
| A ride cannot be handed to another organizer | suite — `WITH CHECK` on `organizer_id` |
| An organizer who left the club cannot edit, but can delete or detach | suite — three cases |
| Cancellation takes crew, chat and notifications | suite — FK cascade assertions |
| A tagged postcard survives its ride | suite — `SET NULL`, and the SELECT policy unchanged |
| The audience trigger fires on UPDATE, not only INSERT | suite — an UPDATE that must raise |
| `departure_at` is written as `APP_TIME_ZONE` wall-clock | **Vitest only** — `wallClockToUtc` |
| The edit form round-trips `departure_at` without drift | **Vitest + `reviewer`** — not the suite |
| The action sends only editable columns | **`reviewer` only** — the grant permits more |
| Every screen state | **`npm run walk` + `reviewer`** — not the suite |
## Requirements
### Requirement: Only a ride's organizer SHALL be able to edit or delete it

The organizer of a ride SHALL be able to update it and to delete it. **No other role SHALL be
able to do either**, and the enumeration is the point:

- **Crew (`ride_members`, `going` or `maybe`)** SHALL NOT edit or delete the ride. Being on the
  crew grants the chat and nothing else.
- **A club admin or club owner** SHALL NOT edit or delete a ride in their club that they did not
  organize. `club_members.role` is not consulted by the `rides` UPDATE or DELETE policy in any
  arm.
- **A non-member, and any signed-in rider who can merely *see* the ride**, SHALL NOT edit or
  delete it.
- **A blocked rider** SHALL NOT edit or delete it, and SHALL NOT reach it at all — the `rides`
  SELECT policy's non-organizer arm is guarded by `NOT private.is_blocked(auth.uid(),
  organizer_id)`, so the ride is already invisible. **This capability adds no block predicate of
  its own**, and adding one would be the bug: blocking is enforced in RLS once, symmetrically,
  and an affordance that re-tests it in the client is a second copy that can disagree.
- **A signed-out visitor** SHALL reach no ride and no edit route. Decision #1 — `anon` holds zero
  grants, and `/rides/*` is not on the route guard's public denylist.

The affordance SHALL follow the same predicate: a rider who is not the organizer SHALL see **no
Edit and no Delete control at all**, rather than a disabled one or one that fails on submit.

#### Scenario: A crew member opens a ride they did not organize

- **WHEN** a rider with a `going` RSVP opens `/rides/detail`
- **THEN** the header offers no Edit action and the page offers no Delete
- **AND** a direct navigation to `/rides/detail/edit` SHALL NOT render the form

#### Scenario: A non-organizer submits an update anyway

- **WHEN** any rider other than the organizer issues an UPDATE against the ride row
- **THEN** RLS SHALL match zero rows and the write SHALL affect nothing
- **AND** the screen SHALL report a failure rather than reporting success on zero rows

### Requirement: A ride SHALL NOT be transferable to another organizer

The `rides` UPDATE `WITH CHECK` requires `auth.uid() = organizer_id` **after** the update, so an
organizer SHALL NOT be able to set `organizer_id` to another rider. The edit form SHALL NOT offer
an organizer field. A rider who wants to hand off a ride has no supported path, and that is a
stated gap rather than an oversight.

#### Scenario: An organizer tries to reassign their ride

- **WHEN** an organizer submits an update setting `organizer_id` to another rider
- **THEN** the `WITH CHECK` SHALL refuse the row

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
| `club_id` not NULL | that club's members (`private.is_club_member`) **not blocked with the organizer** |
| `is_public` false and `club_id` NULL | **nobody but the organizer** |

**Every row is dominated by the block check**, which the live `rides` SELECT policy applies once
across all three of its arms — `NOT private.is_blocked(auth.uid(), organizer_id)`. The rows are a
lookup on the stored shape, so where two apply (a public ride in a public club) they agree by
construction: the predicate below asks only whether the audience is **empty**, never which row
produced it.

**One consequence is stated rather than fixed, because fixing it would break decision #2.** A
two-person club whose only other member is blocked with the organizer has, in fact, no standing
audience — but the client cannot know that, and SHALL NOT try: blocking is enforced in RLS once,
symmetrically, and a second copy of it in a component is a copy that can disagree. So the
refusal SHALL fire there, protecting a crew member who already cannot see the ride. The cost is
one over-refusal in a club of two; the alternative is a block predicate in the browser.

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

**Two shipped routes reach it, and the requirement is about the STATE rather than either act.**
`leaveClub` is one. The other is being **ejected**: `removeClubMember` (`src/lib/actions/club-members.ts`)
calls the `security definer` RPC `public.remove_club_member`, live on both projects — `club_members`
carries no admin DELETE policy, so a reader checking policies alone misses this route entirely. An
organizer ejected from club X hits the identical `WITH CHECK` failure on a column they never
touched.

**So the copy SHALL name the state — "you are no longer a member of this ride's club" — and SHALL
NOT assert that the organizer left.** Telling an ejected rider that leaving caused the refusal is
the same defect this whole change exists to remove: a refusal asserting something the rider knows
to be false. Neither the client nor the action can distinguish the two routes — nothing records
which happened — so the sentence must be true of both.

**The club is named by REFERENCE rather than by name, and that is a limit rather than a
shortcut.** `RideForEdit.club` is `null` for a club the viewer cannot currently see — which is
precisely this case whenever the club is private, as that type's own note records — and
`updateRide` reaches this branch holding `previous.club_id` and no name. So an implementation that
interpolated a name would print nothing, or an empty gap, for the population the requirement is
written about.

**And no control on the screen supplies one either, which is the sharper reason.** The club that
has left `getMyClubs` renders through `EditRideForm`'s `currentClubOption`, whose name falls back
to the literal **`Current club`** exactly when `ride.club` is null — the same private-club case. So
a rider in this state sees no club name anywhere on the form, and a requirement demanding one would
be unsatisfiable rather than merely inconvenient. **Naming the club by reference is the only
honest option**, and any future change that makes a name reachable here should amend this
requirement rather than quietly interpolate an empty string.

It is not hypothetical.

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
permission-denied case. The message SHALL identify the club — by reference where no name is
readable, per the note above — say that **no longer being a member of it** is why the save was
refused, and offer the two exits above.

**This change SHALL NOT widen the `rides` UPDATE policy**, and any future proposal that does must
say loudly that it is a visibility change: removing the `is_club_member` conjunct would let an
ex-member keep editing a ride that is visible to a private club they are no longer in, which is
the club's audience being written by an outsider.

#### Scenario: An organizer leaves the club and then edits their ride

- **WHEN** a rider who organized a club ride calls `leaveClub` and then submits any edit to that
  ride
- **THEN** the `WITH CHECK` SHALL refuse the row even though no club field was changed
- **AND** the screen SHALL identify the club, say that no longer being a member of it caused the
  refusal, and offer cancelling the ride or making it public and detaching it
- **AND** the same SHALL hold for an organizer EJECTED by an admin through `removeClubMember`,
  who reaches the identical state by a route the copy must not contradict

#### Scenario: An ex-member detaches the ride and leaves it private

- **WHEN** that rider sets `club_id` to NULL without ticking "Make this ride public"
- **THEN** the transition rule SHALL refuse it before the request leaves the browser, with the
  crew-losing-sight message rather than the ex-member message
- **AND** the two exits offered SHALL remain deleting the ride, or making it public and detaching

#### Scenario: An ex-member cancels the ride instead

- **WHEN** that same rider deletes the ride
- **THEN** the DELETE SHALL succeed, because the DELETE policy carries no membership test

### Requirement: `departure_at` SHALL be read and written as `APP_TIME_ZONE` wall-clock

The write SHALL pass the form's zone-less `datetime-local` value through `wallClockToUtc`, as
`createRide` does. **The read SHALL be the same rule inverted**: the form SHALL render the stored
instant back into the input as its `APP_TIME_ZONE` wall-clock. An edit screen has a round trip a
create screen does not, and rendering the raw instant means saving a ride without touching the
time field moves it by the browser's offset from `Europe/Amsterdam`.

#### Scenario: An organizer in another zone corrects only the title

- **WHEN** an organizer whose browser is not in `Europe/Amsterdam` edits the title and saves
- **THEN** `departure_at` SHALL be unchanged
- **AND** the ride SHALL still render the same time to every rider

### Requirement: Deleting a ride SHALL take its crew, chat and notifications, and SHALL leave tagged postcards standing

Read off the FKs rather than assumed: `ride_members`, `ride_messages` and `notifications.ride_id`
are `ON DELETE CASCADE`; `postcards.ride_id` is `ON DELETE SET NULL`.

- Every RSVP, every chat message and every notification about the ride SHALL be destroyed with
  it. **This is unrecoverable and there is no undo.**
- A postcard tagged to the ride SHALL survive with `ride_id` NULL. Because `ride_id` is a tag and
  not an audience, the tag going NULL SHALL change who can see the postcard by exactly nothing.
- **No crew member SHALL be notified.** Out of scope per PD-124, and stated here because a
  cancelled ride silently disappearing from a rider's list is the user-visible consequence.
- The confirmation SHALL state the crew count and that the chat goes with it, and SHALL require a
  second, deliberate tap. A one-tap irreversible delete on a glove-sized target is the shape
  `PostcardMenu` already rejected.

#### Scenario: An organizer cancels a ride with a crew and a chat

- **WHEN** the organizer confirms deletion
- **THEN** the ride, its `ride_members`, its `ride_messages` and its notifications SHALL be gone
- **AND** any postcard tagged to it SHALL remain visible to exactly the audience it had before

### Requirement: The update action SHALL send only the fields the form owns

`authenticated` holds UPDATE on **every** column of `rides`, including `id`, `created_at` and
`organizer_id` — the grant is table-level and was never narrowed. The policy stops `organizer_id`
moving; nothing stops `created_at`. `updateRide` SHALL therefore construct its payload from an
explicit field list and SHALL NOT spread a parsed form object that could carry another key.

**This requirement is `reviewer`'s and nothing else's.** It is a rule about what the client
sends, and per `CLAUDE.md` a rule that only ever reaches TypeScript is advisory — the client owns
the mutation path. Narrowing the grant is the real fix and is out of scope; this is the interim,
labelled as such.

#### Scenario: An update payload is built from a spread

- **WHEN** `updateRide` passes a spread of parsed form data to `.update()`
- **THEN** review SHALL reject it in favour of an explicit field list
- **AND** the spec SHALL NOT claim the database refuses the extra column

#### Scenario: An organizer rewrites `created_at` directly

- **WHEN** an organizer issues an UPDATE setting `created_at` on their own ride
- **THEN** the database SHALL permit it, because the grant is table-level
- **AND** that gap SHALL be recorded as an open follow-up rather than described as covered

### Requirement: The edit and delete screens SHALL define every state

- **Loading** — the form SHALL gate on the ride data, never on `isLoading`; `useQuery` starts its
  fetch in an effect, so the first pass has no data *and* no fetch in flight.
- **Not found vs not yet** — `null` SHALL be `notFound()`; `undefined` SHALL render the skeleton.
  Conflating them shows a 404 flash on every load.
- **Permission denied is indistinguishable from empty at the client**, and the two need different
  UI. A ride the caller cannot see and a ride that does not exist both return zero rows. The edit
  route SHALL resolve this by comparing the loaded ride's `organizer_id` to the session: a ride
  that loads but is not the caller's SHALL show "only the organizer can edit this ride", and a
  ride that does not load SHALL show not-found. It SHALL NOT report "not found" for a ride the
  rider can plainly see on the previous screen.
- **Error** — a failed save SHALL keep the entered values and offer a retry. It SHALL NOT clear
  the form.
- **Offline** — riders lose signal constantly. A save attempted offline SHALL fail visibly and
  SHALL NOT be silently queued; a queued mutation that lands minutes later against a row someone
  else changed is a worse outcome than a refusal. The delete confirmation SHALL NOT be reachable
  while offline.
- **Stale** — the ride may have changed elsewhere since the form loaded. This change ships
  **last-write-wins** and no optimistic-concurrency check; that is a decision, recorded in
  `design.md` §D3, not an omission.
- **Partial** — if the ride loads but the organizer's club list does not, the club picker SHALL
  render disabled with its current value, rather than empty. An empty picker reads as "this ride
  is in no club" and one save makes that true.

#### Scenario: A rider opens the edit route for someone else's ride

- **WHEN** the ride loads and its `organizer_id` is not the session's rider
- **THEN** the screen SHALL say only the organizer can edit this ride
- **AND** SHALL NOT show a not-found screen for a ride the rider can see

#### Scenario: The club list fails while the ride loads

- **WHEN** the ride read succeeds and the organizer's club list read fails
- **THEN** the club picker SHALL render disabled showing the ride's current club
- **AND** SHALL NOT render empty

#### Scenario: A save is attempted with no connection

- **WHEN** the organizer submits the form while offline
- **THEN** the failure SHALL be visible and the entered values SHALL be kept
- **AND** the write SHALL NOT be queued for later delivery

