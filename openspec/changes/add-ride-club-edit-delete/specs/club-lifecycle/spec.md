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
| An `admin` row confers no write **as the policies stand today** | suite — a regression guard on current behaviour, **not** a settled product rule; see the open decision below |
| Ownership is not transferable by a client | suite — `WITH CHECK` on `owner_id` |
| Deletion destroys members' postcards | suite — FK cascade assertion |
| Deletion leaves no zombie rides | suite — against the new function |
| The function is `authenticated`-reachable and owner-gated | suite — `has_function_privilege` **+** an ownership case |
| The privacy flip rewrites rides one-directionally | suite — the trigger, both directions |
| The confirmation's counts and copy | **`reviewer` + `npm run walk`** — not the suite |
| Every screen state | **`npm run walk` + `reviewer`** — not the suite |

## ADDED Requirements

### Requirement: Only a club's owner SHALL be able to edit or delete it

The rider in `clubs.owner_id` SHALL be able to update the club and to delete it. **No other role
SHALL be able to do either**, and this change SHALL NOT add an arm to either policy.

- **`club_members.role = 'admin'` confers neither, and that is a description of the current
  policies rather than a rule this change decides.** The `clubs` UPDATE and DELETE policies test
  `auth.uid() = owner_id` and consult `club_members` in no arm — measured. **Nothing has ever
  written `admin`**: `CLAUDE.md` records member invitations with an Admin role as unbuilt, and
  the only code that reads the value is `private.transfer_owned_clubs`, which sorts admins first
  when picking a successor during account deletion.

  **So the requirement asserted here is narrow on purpose: *as the policies stand, an `admin` row
  changes nothing*.** That is a regression guard on today's behaviour and is worth a test.
  **What this spec explicitly does NOT decide is whether `admin` *should* carry edit rights once
  the role can be held** — that is `design.md` Q3, open, product owner's. A later change that
  grants admins edit rights amends this requirement; it does not violate it. The distinction
  matters because an assertion phrased as "an admin must never edit a club" would ship the
  undecided answer as a passing test, which is exactly how silence becomes a settled rule.
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

#### Scenario: An `admin` row is written by hand and the policies are unchanged

- **WHEN** a `club_members` row with `role = 'admin'` exists and that rider attempts a club UPDATE
  or DELETE
- **THEN** RLS SHALL match zero rows, because neither policy consults `club_members`
- **AND** this SHALL be read as pinning current policy behaviour, **not** as deciding that admins
  may never be granted edit rights

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

Before the delete executes, the confirmation SHALL enumerate the **whole** blast radius, not the
postcards alone. Deleting a club destroys, by cascade or by `delete_owned_club`: every postcard in
it, every `club_members` row, every `feed_reads` watermark, every notification about it, every
private ride in it — **and with each of those rides its `ride_members` crew and its
`ride_messages` chat history**. A confirmation naming only postcards understates it by two whole
tables of other people's writing.

The copy SHALL state:

- **How many postcards will be permanently deleted, and that they include other members'.**
- **How many rides will be deleted, and that each takes its crew list and its entire chat history
  with it.** The chat is the least recoverable thing here and the least obvious.
- **That every member loses the club**, and the number of members.
- **That none of it can be undone.**

**Every count SHALL be read under the owner's own RLS, and the copy SHALL be phrased as a floor
rather than a total** — "at least N", not "N". This applies to **all three** counts, for the same
reason and consistently:

- **Postcards** — a postcard by a rider who has blocked the owner is excluded by the `postcards`
  SELECT policy's `NOT private.is_blocked(...)` arm, and one the owner has hidden is excluded by
  the `postcard_hides` arm. Both are still destroyed.
- **Rides** — a ride organized by a rider who has blocked the owner is excluded by the `rides`
  SELECT policy's `NOT private.is_blocked(auth.uid(), organizer_id)` arm. It is still destroyed.
- **Members** — `club_members` SELECT carries `(user_id = auth.uid()) OR NOT
  private.is_blocked(auth.uid(), user_id)`, so a blocked member is invisible to the owner. They
  still lose the club.

A privileged count that returned the true totals SHALL NOT be built: it would tell the owner
exactly how much content a rider who blocked them has, which is the thing blocking exists to
withhold. **Under-disclosing to a floor is the deliberate trade, and the copy carries it** rather
than the number silently being wrong.

It SHALL require a second, deliberate confirmation step. A single tap SHALL NOT execute it.

**A destructive action whose blast radius is invisible is a store-review problem as well as a
product one** — this is the requirement carrying the `Store submission` milestone.

#### Scenario: An owner deletes a club other members have posted to

- **WHEN** the owner opens the delete confirmation
- **THEN** it SHALL name the postcard count, the ride count and the member count, each phrased as
  a floor
- **AND** it SHALL state that other members' postcards are included, and that each deleted ride
  takes its crew and chat history with it
- **WHEN** they confirm
- **THEN** the club, its `club_members`, its `feed_reads`, its notifications, every postcard in it
  and every private ride with that ride's `ride_members` and `ride_messages` SHALL be gone

#### Scenario: A club contains a postcard by a rider who blocked the owner

- **WHEN** the owner opens the delete confirmation
- **THEN** the postcard count SHALL exclude that postcard, because RLS hides it
- **AND** the copy SHALL be phrased so the stated number is a floor and not a total
- **WHEN** they confirm
- **THEN** that postcard SHALL be destroyed along with the rest

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

- **Club deletion SHALL go through `public.delete_owned_club(p_club_id uuid)`**, a `security
  definer` function that deletes the club's `is_public = false` rides and the club in one
  transaction. `deleteClub` SHALL call it; a bare `.from('clubs').delete()` SHALL NOT ship.
- **The parameter SHALL NOT be named for a column it filters on**, and SHALL follow this repo's
  `p_` convention (`complete_onboarding(p_location text)`, where `location` is a `profiles`
  column). `club_id` is a column on `rides`, `club_members`, `feed_reads`, `postcards` and
  `notifications`. Every column reference in the body SHALL be qualified with a table alias, and
  the body SHALL open with `#variable_conflict error`.

  **Measured on DEV, 2026-08-09, rather than assumed:** `plpgsql.variable_conflict` is `error`,
  so an unqualified collision raises `42702 column reference "club_id" is ambiguous` and deletes
  nothing. The pragma therefore SHALL be described as pinning the guarantee **inside** the
  function — immune to a cluster GUC set to `use_column`, which is the only configuration in
  which the collision becomes a silent mass delete — and SHALL NOT be described as fixing a
  silent deletion that the default configuration already refuses.
- **The suite SHALL contain an assertion that fails when the function deletes more than it was
  asked to.** Deleting one club SHALL leave a second, unrelated club and that club's private
  rides, memberships and crew rows intact. Assertions that only prove the target's rows are gone
  all pass under a `WHERE` clause that is too broad, which is the failure mode this function's
  elevated rights make dangerous.
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

#### Scenario: One club is deleted while another exists

- **WHEN** an owner deletes club A, and an unrelated club B exists with its own private ride,
  members and crew
- **THEN** club B, its private ride, its `club_members` and that ride's `ride_members` SHALL all
  still exist
- **AND** the suite SHALL fail if any of them were removed

#### Scenario: A public club with a public ride is deleted

- **WHEN** the owner deletes a public club containing a public ride organized by a member
- **THEN** that ride SHALL survive with `club_id` NULL
- **AND** it SHALL remain visible to every signed-in rider not blocked by its organizer

### Requirement: Club deletion SHALL orphan Storage objects, and the specification SHALL say so rather than imply cleanup

`delete_owned_club` deletes **rows**. Storage is a separate API that no SQL function in this repo
reaches, so every image behind the deleted rows survives the transaction. Three sets, and they are
**not** equally recoverable:

- **The club's own `avatar_path` and `cover_image_path`** (`016`, under `club-avatars/<owner
  uid>/` and `club-covers/<owner uid>/`). These sit under the **owner's** uid, and the owner is
  the caller, so the client SHALL delete them. The function SHALL **return the orphaned object
  paths**, mirroring `private.transfer_owned_clubs`, which already returns `object_path text` for
  exactly this reason during account deletion. `deleteClub` SHALL pass them to Storage.
- **Every cascade-deleted postcard's `image_path`** (under `postcards/<author uid>/`). These
  belong to **other riders**, and the Storage policies gate on the path's uid prefix, so the club
  owner cannot delete them and neither can the function. **They are permanently orphaned**, and
  this SHALL be stated plainly rather than left to be discovered.
- **Anything the client's Storage call fails to remove** — offline, a partial failure, or a
  rider who closes the app between the RPC and the Storage delete. The row deletion has already
  committed, so there is no transaction to roll back.

**Orphaned Storage objects are `PD-94`'s problem, not this change's.** This requirement does not
propose a sweep, a lifecycle rule or a reconciliation job; it records which objects this change
orphans so `PD-94` inherits an accurate list instead of rediscovering it. No new issue SHALL be
filed for it.

#### Scenario: An owner deletes a club with a cover image and other members' postcards

- **WHEN** deletion succeeds
- **THEN** the function SHALL have returned the club's own avatar and cover object paths
- **AND** `deleteClub` SHALL delete those objects from Storage
- **AND** the postcard images authored by other riders SHALL remain in Storage, orphaned, as
  `PD-94`'s scope

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
