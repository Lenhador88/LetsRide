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

## ADDED Requirements

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

- **WHEN** a rider with a `going` RSVP opens `/rides/[id]`
- **THEN** the header offers no Edit action and the page offers no Delete
- **AND** a direct navigation to `/rides/[id]/edit` SHALL NOT render the form

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

`club_id` and `is_public` are both editable, and together they decide the ride's audience. An
edit SHALL NOT be able to produce a ride that only its organizer can see while `ride_members`
rows survive — the zombie shape `029` names.

- **Moving a ride out of a club** (`club_id` → NULL) with `is_public` false produces exactly that
  shape. The form SHALL therefore refuse to save a ride that is neither public nor in a club the
  organizer belongs to, and SHALL say which of the two to change.
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
  is the policy working, not a defect; nothing in this change deletes their RSVP behind them.

#### Scenario: An organizer detaches a private ride from its club

- **WHEN** an organizer sets `club_id` to NULL on a ride whose `is_public` is false
- **THEN** the form SHALL refuse to save and SHALL name both remedies
- **AND** no row SHALL be written

#### Scenario: An organizer makes a private club's ride public

- **WHEN** an organizer sets `is_public` true on a ride whose club is private
- **THEN** the database SHALL raise `check_violation`
- **AND** the screen SHALL show the audience-specific message, not a generic failure

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
  disjunct, and `enforce_ride_club_audience` does not fire when `club_id` is NULL. Because a ride
  that is neither public nor in a club is the zombie shape this spec already refuses, detaching
  SHALL be offered only together with making the ride public.

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
