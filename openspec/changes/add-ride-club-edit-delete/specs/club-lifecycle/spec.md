## Purpose

Who may edit a club, who may delete one, and what a deletion destroys that does not belong to the
person doing it. This is the capability where the negative case is the whole story: **a club
delete is the only action in this app where one rider's tap destroys another rider's content**,
and until this change nothing tells them.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`** — except the four named here. The suite runs as the
table owner, for whom neither RLS nor `EXECUTE` barriers exist, so an assertion about who can
reach `delete_owned_club` must name a **role** (`has_function_privilege('authenticated', …)`)
rather than call it. That is `031`'s lesson applied before it costs a migration this time.

| Requirement | Enforced by |
|---|---|
| Only the owner may edit or delete | suite — both directions, per role |
| `admin` grants nothing | suite — an `admin` row that still cannot write |
| Ownership is not transferable by a client | suite — `WITH CHECK` on `owner_id` |
| Deletion destroys members' postcards | suite — FK cascade assertion |
| Deletion leaves no zombie rides | suite — against the new function |
| The function is `authenticated`-reachable and owner-gated | suite — `has_function_privilege` **+** an ownership case |
| The privacy flip rewrites rides one-directionally | suite — the trigger, both directions |
| The confirmation's counts and copy | **`reviewer` + `npm run walk`** — not the suite |
| Every screen state | **`npm run walk` + `reviewer`** — not the suite |

## ADDED Requirements

### Requirement: Only a club's owner SHALL be able to edit or delete it, and `admin` SHALL grant neither

The rider in `clubs.owner_id` SHALL be able to update the club and to delete it. **No other role
SHALL be able to do either:**

- **A `club_members.role = 'admin'`** SHALL NOT edit or delete the club. The `clubs` UPDATE and
  DELETE policies test `auth.uid() = owner_id` and consult `club_members` in no arm.

  **`admin` is a value in the enum that nothing has ever written.** `CLAUDE.md` records member
  invitations with an Admin role as unbuilt; the only code that reads the value is
  `private.transfer_owned_clubs`, which sorts admins first when picking a successor during
  account deletion. So the honest statement for this change is not "admins may not edit" as a
  policy choice — it is that **no rider can currently hold the role**, and specifying an admin
  affordance would build UI for a state the database cannot reach. If the role is ever written,
  whether it carries edit rights is a **new decision**, not something this spec has already made.
  Recorded so a later session does not read this silence as a settled "no".
- **An ordinary member** SHALL NOT edit or delete the club. Their only club write is
  `leaveClub`.
- **A non-member** SHALL NOT edit or delete it, including a signed-in rider who can see a public
  club on Explore.
- **A blocked rider** SHALL NOT edit or delete it. This capability adds **no block predicate of
  its own** — `blocks` does not appear in the `clubs` policies at all, and blocking reaches club
  surfaces through `club_members` SELECT and the `profiles` predicate. Re-testing it in the
  client would be a second copy that can disagree with RLS.
- **A signed-out visitor** SHALL reach no club and no edit route. Decision #1.

The affordance SHALL follow the same predicate: a non-owner SHALL see no Edit and no Delete
control at all.

#### Scenario: A club admin opens the club they help run

- **WHEN** a rider whose `club_members.role` is `admin` opens `/clubs/[id]`
- **THEN** the header offers no Edit action and no Delete
- **AND** a direct navigation to `/clubs/[id]/edit` SHALL NOT render the form

#### Scenario: A member submits a club update anyway

- **WHEN** any rider other than the owner issues an UPDATE against the club row
- **THEN** RLS SHALL match zero rows and the write SHALL affect nothing

### Requirement: Club ownership SHALL NOT be transferable by a client

The `clubs` UPDATE `WITH CHECK` is `auth.uid() = owner_id`, so an owner SHALL NOT set `owner_id`
to another rider. The edit form SHALL NOT offer an owner field. The only path that moves
ownership is `private.transfer_owned_clubs`, which runs as `service_role` during account
deletion.

**The consequence is a stated gap: an owner cannot hand over a club and leave it.** Their only
exits are deleting the club — destroying everyone's postcards — or deleting their account. This
change does not close it.

#### Scenario: An owner tries to reassign their club

- **WHEN** an owner submits an update setting `owner_id` to another rider
- **THEN** the `WITH CHECK` SHALL refuse the row

#### Scenario: An owner looks for a way to leave the club they own

- **WHEN** the owner opens the club's edit screen
- **THEN** no ownership-transfer control SHALL be offered
- **AND** the spec SHALL record this as an open gap rather than an intended refusal

### Requirement: Deleting a club SHALL destroy every member's postcards in it, and the owner SHALL be told before it happens

`postcards.club_id → clubs` is `ON DELETE CASCADE`. `CLAUDE.md` records that `009` reasoned this
out **deliberately for a club deleted by its owner**, so the cascade is settled and this
capability SHALL NOT change it. What it adds is disclosure.

Before the delete executes, the confirmation SHALL state, from counts read under the owner's own
RLS at the moment of confirmation:

- **How many postcards will be permanently deleted, and that they include other members'.** A
  count the owner cannot see is a count they cannot consent to, so the number SHALL be the
  RLS-visible one and the copy SHALL NOT imply it is exhaustive of postcards hidden from them.
- **How many rides will be deleted.**
- **That every member loses the club**, and the number of members.
- **That none of it can be undone.**

It SHALL require a second, deliberate confirmation step. A single tap SHALL NOT execute it.

**A destructive action whose blast radius is invisible is a store-review problem as well as a
product one** — this is the requirement carrying the `Store submission` milestone.

#### Scenario: An owner deletes a club other members have posted to

- **WHEN** the owner opens the delete confirmation
- **THEN** it SHALL name the postcard count, the ride count and the member count
- **AND** it SHALL state that other members' postcards are included
- **WHEN** they confirm
- **THEN** the club, its `club_members`, its `feed_reads`, its notifications and every postcard in
  it SHALL be gone

### Requirement: Deleting a club SHALL leave no ride that only its organizer can see

`rides.club_id` is `ON DELETE SET NULL`. A ride left with `club_id` NULL and `is_public` false
satisfies neither non-organizer arm of the `rides` SELECT policy, so it becomes visible **only to
its organizer** while its `ride_members` rows survive. `ride_members` SELECT and `ride_messages`
SELECT both open with an `EXISTS` against `rides` under the caller's RLS, so the crew loses the
ride, the roster and the chat at once while the organizer keeps seeing a crew that can no longer
see them.

**A client cannot prevent this.** The `rides` DELETE policy is `auth.uid() = organizer_id` with no
club-owner arm, so a club owner holds no grant to delete a ride another member organized in their
club — and for a private club that is every ride, because `propagate_club_privacy_to_rides` and
`enforce_ride_club_audience` between them guarantee a private club's rides are all
`is_public = false`.

Therefore:

- **Club deletion SHALL go through `public.delete_owned_club(club_id uuid)`**, a `security
  definer` function that deletes the club's `is_public = false` rides and the club in one
  transaction. `deleteClub` SHALL call it; a bare `.from('clubs').delete()` SHALL NOT ship.
- **`EXECUTE` SHALL be granted to `authenticated` and to no other client role**, and the function
  SHALL re-check `owner_id = auth.uid()` **internally**. A `security definer` function runs with
  RLS bypassed, so the ownership test is the function's own job; relying on the `clubs` DELETE
  policy inside it is the mistake that turns one missing line into "any signed-in rider can
  delete any club".
- **It SHALL delete only the rides that `SET NULL` would zombify** — `is_public = false`. A
  public ride survives the club perfectly well (its SELECT arm is `is_public AND (club_id IS NULL
  OR …)`), and deleting it destroys another rider's content for no reason. This is
  `private.transfer_owned_clubs`'s already-argued rule, reused rather than re-derived.
- **It SHALL be `SET search_path` pinned** and SHALL appear in the security-advisor sweep as a
  seventh `authenticated_security_definer_function_executable` WARN. That is expected, and
  `CLAUDE.md`'s advisor table SHALL be updated to say so — an unexpected advisor is one not in
  that table, and leaving it out makes a deliberate entry look like a regression.

#### Scenario: An owner deletes a private club containing another member's ride

- **WHEN** the owner confirms deletion of a private club in which another member organized a ride
- **THEN** that ride SHALL be deleted with the club
- **AND** no ride SHALL remain with `club_id` NULL, `is_public` false and surviving
  `ride_members` rows

#### Scenario: A non-owner calls the function directly

- **WHEN** a signed-in rider who is not the owner calls `delete_owned_club` with that club's id
- **THEN** the function SHALL refuse and delete nothing
- **AND** the refusal SHALL NOT reveal whether the club exists

#### Scenario: A public club with a public ride is deleted

- **WHEN** the owner deletes a public club containing a public ride organized by a member
- **THEN** that ride SHALL survive with `club_id` NULL
- **AND** it SHALL remain visible to every signed-in rider not blocked by its organizer

### Requirement: Turning a club private SHALL rewrite its public rides, and the owner SHALL be told it is one-directional

`propagate_club_privacy_to_rides` fires `AFTER UPDATE OF is_public` and, when a club goes public →
private, sets `is_public = false` on every public ride in it. **It does not fire in the other
direction**, so toggling back to public does not restore them — the information is gone.

- The privacy control SHALL state, before the save, that the club's public rides become private
  and will not be restored if the club is made public again.
- It SHALL name the number of rides affected.
- **Riders who lose sight of those rides SHALL keep their `ride_members` rows.** Their loss of
  access is the policy working; nothing in this change deletes an RSVP behind them.
- Making a private club public SHALL NOT change any ride's `is_public`, and SHALL NOT be
  described to the owner as reversing the previous step.

#### Scenario: An owner makes a public club private and then public again

- **WHEN** the owner sets `is_public` false on a club with two public rides
- **THEN** both rides SHALL become private
- **WHEN** the owner then sets `is_public` true again
- **THEN** both rides SHALL remain private

### Requirement: The club edit screen SHALL define every state

- **Loading** — gate on the club data, never on `isLoading`.
- **Not found vs not yet** — `null` is `notFound()`; `undefined` is the skeleton.
- **Permission denied vs empty** — a private club the caller does not belong to and a club that
  does not exist both return zero rows. The edit route SHALL compare the loaded club's `owner_id`
  to the session: a club that loads but is not the caller's SHALL say only the owner can edit it;
  one that does not load SHALL show not-found.
- **Error** — a failed save SHALL keep the entered values and offer a retry.
- **Offline** — a save SHALL fail visibly rather than queue, and the delete confirmation SHALL NOT
  be reachable offline. The confirmation's counts are read live; a confirmation that cannot count
  SHALL NOT offer the destructive action.
- **Partial** — if the club loads but its postcard/ride/member counts do not, the delete
  confirmation SHALL NOT proceed with a blank or zero blast radius. It SHALL say the counts could
  not be read and SHALL refuse until they can.
- **Stale** — last-write-wins, no optimistic-concurrency check. Decided in `design.md` §D3.
- **Images** — `clubs_avatar_path_owned` and `clubs_cover_image_path_owned` are CHECKs tying each
  path to the row's `owner_id`. An edit that replaces an image SHALL write a path under the
  **owner's** uid; since ownership cannot move, the existing paths remain valid across every edit
  this change permits.

#### Scenario: A member opens the edit route for a club they belong to

- **WHEN** the club loads and its `owner_id` is not the session's rider
- **THEN** the screen SHALL say only the owner can edit this club
- **AND** SHALL NOT show a not-found screen for a club the rider can see

#### Scenario: The blast-radius counts cannot be read

- **WHEN** the owner opens the delete confirmation and the postcard, ride or member counts fail
  to load
- **THEN** the confirmation SHALL refuse to proceed and SHALL say the counts could not be read
- **AND** SHALL NOT display zero or a blank count

#### Scenario: A club edit is saved while offline

- **WHEN** the owner submits the edit form with no connection
- **THEN** the failure SHALL be visible and the entered values SHALL be kept
- **AND** the delete confirmation SHALL NOT be reachable in that state
