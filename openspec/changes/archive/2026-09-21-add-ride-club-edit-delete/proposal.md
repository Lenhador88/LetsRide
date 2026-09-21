# Edit and delete rides and clubs — the empty action layer, and the one delete the client cannot do

> Linear **PD-101**, High, milestone **Store submission**. This file is the specification; the
> issue points at it and must not restate it. `CLAUDE.md` §The roadmap lives in Linear: *"A
> Linear issue that grows a specification is a bug."*

## Why

**You can create a ride and then never cancel or correct it.** Postcards, comments and profile
all have working delete/update UI. `src/lib/actions/rides.ts` exports `createRide` and
`setRideAttendance`; `src/lib/actions/clubs.ts` exports `createClub`, `markClubSeen`,
`markFeedSeen`, `joinClub` and `leaveClub`. There is no `updateRide`, `deleteRide`, `updateClub`
or `deleteClub` anywhere:

```bash
grep -n "^export async function" src/lib/actions/rides.ts src/lib/actions/clubs.ts
```

**The database half is done.** Measured against DEV (`fpmrimzxadewsaiwpsel`) on 2026-08-09, not
inferred from the migration files:

| Policy | cmd | `USING` | `WITH CHECK` |
|---|---|---|---|
| `Organizers update their own rides, within their own clubs` | UPDATE | `auth.uid() = organizer_id` | `auth.uid() = organizer_id AND (club_id IS NULL OR private.is_club_member(club_id))` |
| `Organizers can delete rides` | DELETE | `auth.uid() = organizer_id` | — |
| `Club owners can update` | UPDATE | `auth.uid() = owner_id` | `auth.uid() = owner_id` |
| `Club owners can delete` | DELETE | `auth.uid() = owner_id` | — |

`authenticated` holds table-level UPDATE and DELETE on both `rides` and `clubs`
(`information_schema.table_privileges`). So all four are live and reachable. **This is an empty
action layer, not an unwired UI**, exactly as the issue says.

**Three things the issue does not say, all measured, all of which change the work:**

1. **A client-side club delete cannot be made safe, and no amount of UI fixes it.** See below.
   This is the finding that decides the shape of the change.
2. **Two triggers already fire on these write paths** and neither is in `CLAUDE.md`'s schema
   table. `enforce_ride_club_audience` (BEFORE INSERT **OR UPDATE** on `rides`) raises
   `check_violation` for a public ride in a private club — so it fires on *edit*, not only on
   create, and `createRide` already has the error-message branch for it that `updateRide` will
   need. `propagate_club_privacy_to_rides` (AFTER UPDATE OF `is_public` on `clubs`) force-sets
   `is_public = false` on every public ride in a club that goes public → private. That is a club
   edit silently rewriting other riders' rides, and it is **one-directional**: flipping back to
   public does not restore them.
3. **The column is `departure_at`, not `starts_at`,** and `rides` has no end time, no distance,
   no offroad flag and no cover image. The drawn edit screens have all four.

**The reason this needs a proposal rather than a ticket is one sentence:**

> **A club delete destroys other members' postcards by cascade and orphans other members' rides
> by `SET NULL`, and the club owner has no grant that lets them clean up either.**

## The blast radius, read off the FKs

`pg_constraint` on DEV, 2026-08-09 — every FK pointing at `rides` or `clubs`:

| Deleting a **ride** | | Deleting a **club** | |
|---|---|---|---|
| `ride_members` | CASCADE | `club_members` | CASCADE |
| `ride_messages` | CASCADE | `feed_reads` | CASCADE |
| `notifications.ride_id` | CASCADE | `notifications.club_id` | CASCADE |
| `postcards.ride_id` | **SET NULL** | `postcards.club_id` | **CASCADE** |
| | | `rides.club_id` | **SET NULL** |

**Deleting a ride is clean.** Crew, chat and notifications go with it; postcards tagged to it
survive with `ride_id` NULL, and because `ride_id` is a tag and not an audience the tag going
NULL changes who can see them by exactly nothing. Nothing needs adding.

**Deleting a club is not.** Two separate problems:

- **`postcards` CASCADE.** Every postcard every *other* member ever posted to the club is
  destroyed. `CLAUDE.md` records that `009` reasoned this out **deliberately for a club deleted
  by its owner**, so it is settled and this change does not reopen it. What is *not* settled is
  that the owner is currently told nothing. The specification question is what the confirmation
  must say.
- **`rides` SET NULL — the zombie.** A ride left with `club_id` NULL and `is_public` false is
  visible only to its organizer, because the `rides` SELECT policy's non-organizer arm needs
  either `is_public AND is_club_public(club_id)` or `club_id IS NOT NULL AND
  is_club_member(club_id)` and neither holds. Its `ride_members` rows survive. `ride_members`
  SELECT and `ride_messages` SELECT both open with an `EXISTS` against `rides` under the
  caller's own RLS, so the crew loses the ride, the roster **and** the chat in one step while
  the organizer keeps seeing a crew that can no longer see them.

  `private.transfer_owned_clubs` already solves this for account deletion by deleting
  `is_public = false` rides with the club. **That path is `service_role`-only** —
  `has_function_privilege('authenticated', …, 'EXECUTE')` is `false` for both it and
  `public.transfer_owned_clubs_for_deletion`, measured.

  **And a club owner cannot do it by hand.** The `rides` DELETE policy is
  `auth.uid() = organizer_id` with no club-owner arm, so an owner deleting their club has no
  grant to delete a ride some other member organized in it. For a **private** club this is every
  ride: `propagate_club_privacy_to_rides` and `enforce_ride_club_audience` between them
  guarantee a private club's rides are all `is_public = false`.

**So the honest answer is that the client cannot do this safely, and the story needs a database
function.** Stated plainly rather than designed around, per the brief. `design.md` §D1 carries
the decision and the two rejected alternatives.

## What Changes

### Rides — no schema change

- **`updateRide(rideId, formData)`** and **`deleteRide(rideId)`** in `src/lib/actions/rides.ts`.
- **`/rides/detail/edit`**, a client page reusing `rideSchema` and `CreateRideForm`'s field set.
- **`departure_at` goes through `wallClockToUtc`** on the write, exactly as `createRide` does.
  A `datetime-local` input is zone-less and `new Date(that)` resolves in the rider's browser
  zone, so an unpinned edit silently moves a ride when an organizer in Lisbon corrects a typo in
  the title. The edit form must also render the *existing* `departure_at` back into the input as
  `APP_TIME_ZONE` wall-clock, or a save-without-touching-the-field shifts the ride by the
  offset — a round-trip bug an edit screen has and a create screen cannot.
- **`updateRide` must carry `createRide`'s `23514` branch.** `enforce_ride_club_audience` fires
  on UPDATE and the generic message leaves the rider with no route to the fix.
- **The action sends only the editable columns.** `authenticated` holds UPDATE on *every* column
  of `rides` including `id`, `created_at` and `organizer_id` — column-level grants were never
  narrowed (`information_schema.column_privileges`). The policy's `WITH CHECK` stops
  `organizer_id` moving away from the caller, so a ride cannot be handed off; nothing stops
  `created_at` being rewritten. Narrowing that grant is **out of scope and logged** — see
  §Out of scope.

### Clubs — one migration, and it is not optional

- **`public.delete_owned_club(club_id uuid)`**, `security definer`, `EXECUTE` to
  `authenticated` only. It re-checks `owner_id = auth.uid()` internally — a `security definer`
  function bypasses RLS, so the ownership test is the function's own job and not the policy's —
  then deletes the club's `is_public = false` rides and the club, in one transaction.
  It reuses `private.transfer_owned_clubs`'s already-argued rule: only the rides that `SET NULL`
  would zombify, because a public ride survives the club perfectly well and deleting it destroys
  another rider's content for no reason.
- **`updateClub(clubId, formData)`** and **`deleteClub(clubId)`** in
  `src/lib/actions/clubs.ts`; `deleteClub` calls the RPC rather than `.from('clubs').delete()`.
- **`/clubs/detail/edit`**, a client page: name, description, privacy, avatar, cover.

### The confirmations are part of the specification, not copy

A destructive action whose blast radius is invisible is a store-review problem as well as a
product one. The club delete confirmation must state, from live counts read under the owner's
own RLS: how many postcards will be destroyed and that they include other members'; how many
rides will be deleted; and that members lose the club. The privacy toggle going public → private
must state that the club's public rides become private and will not come back if it is toggled
again.

## Impact

- **Affected code** — `src/lib/actions/{rides,clubs}.ts`, `src/lib/data/{rides,clubs}.ts`,
  `src/lib/query/keys.ts`, `src/app/(app)/rides/detail/edit/`, `src/app/(app)/clubs/detail/edit/`,
  `RideHeader`, `ClubDetailHeader`, `src/lib/validation/`.
- **Affected schema** — one migration adding `public.delete_owned_club`. **No policy change**,
  which is why the four policies above are quoted rather than modified. `supabase/tests/` gains
  assertions for the new function and for the four standing policies, which the suite does not
  currently cover from the *client* direction.
- **Affected specs** — two new capabilities, `ride-lifecycle` and `club-lifecycle`; deltas to
  `database-enforced-integrity` and `client-cache-invalidation`.

## Out of scope — stated so it is not inherited as covered

- **Notifying the crew of an edit or a cancellation.** That is **PD-124**, parked in `Todo AI`
  awaiting three owner decisions (which columns count as an update, reminder lead time, pg_cron
  vs a scheduled Edge Function). No notification trigger is designed here. **The consequence is
  real and must be said out loud: cancelling a ride tells nobody.** The crew's `ride_members`
  rows and the chat vanish with it. That matches the existing behaviour of a ride cancelled by
  its organizer's account deletion, which `CLAUDE.md` records as deliberate — *"the crew is not
  notified because there is nothing to notify them with."*
- **Narrowing the `rides`/`clubs` UPDATE grant to a column list.** `ride_messages` did this at
  birth for `created_at`. Doing it retroactively is a separate migration with its own
  assertions, and it hardens a hole that predates this change. Logged, not bundled.

  **This is the same defect class as `PD-163`, which is already queued for `postcards`** — a
  table-level grant handing `authenticated` write access to columns no form owns. Naming it here
  so the rides/clubs half reads as the rest of a known defect rather than a new idea, and so
  whoever picks up `PD-163` can see the full scope in one place. **No new issue is filed**; if
  the two are ever done together they are one deliverable, not three.
- **Transferring club ownership.** The `clubs` UPDATE `WITH CHECK` is `auth.uid() = owner_id`,
  so the client cannot move `owner_id` at all. Nothing in this change relaxes that, and "leave
  the club you own" therefore still has no answer.
- **Member management from the edit screen** — invite, remove, promote to admin. Drawn on both
  edit frames and unbuildable as drawn; see §Design below.
- **Editing a postcard's ride tag.** `authenticated` holds no UPDATE grant on `postcards`, by
  design (`041`).

## Design — there is no v2 frame for either screen, and the composition is ours

Measured from the committed snapshot, offline. Both `Edit ride` (`1918:15995`) and `Edit club`
(`1951:8602`) exist on the **Design** page and are drawn **entirely in the OLD/v1 stylesheet** —
`Grey (OLD)/*`, `Accent (OLD)/*` throughout, no v2 token anywhere in either tree.

The `Edit ride | … | Done` and `Edit club | … | Done` epic covers are on the **Archive** page and
govern the archived v1 frames (`339:3191`, `367:5392`), not these. Enumerating every epic cover
on the Design page shows **no `Edit ride` or `Edit club` epic there at all**: `Edit ride` sits
loose in the `Rides` section under no epic, and `Edit club` sits inside `Clubs / Create club`,
whose epic reads **To do** — the same epic `CLAUDE.md` already records as *"Create club has no v2
design … so its composition is ours."*

```bash
node -e "const i=require('./design/index.json');
  i.frames.filter(f=>/epic-cover/.test(f.file)&&f.page==='Design').forEach(f=>{
  const j=require('./design/'+f.file);const o=[];(function w(n){if(n.characters)o.push(n.characters);
  (n.children||[]).forEach(w)})(j);console.log(f.section+' :: '+o.join(' | '))})"
```

**So: composition is ours, and this is the failure mode to avoid — an invented layout presented
as measured.** What the OLD frames draw that has no column behind it, and must not be built from
them: an end date+time, `Distance` in Km, an `Includes offroad` toggle, `Public seats` as a
separate field from `max_riders`, a cover image on both, **`Country` and `City` as two separate
text fields** — `clubs` has neither, and `rides` has only the free-text `meeting_point` — and
`Invite` + an `Admin` chip + per-member remove. `club_members.role` has had `admin` since `001`
and **nothing has ever written it**, so building the chip would render a role no rider can hold.
The `Edit club` frame also carries two copy bugs confirming it is a copy-paste of Create club: its
header title reads `Create club` and its destructive button reads **`Delete ride`**.

**Both frames put the destructive action at the bottom of the edit screen**, as a full-width
`Warning/100` text button — not in an overflow menu. That is the one piece of layout worth taking
from them, and it contradicts the natural assumption that `RidePageMenu` / `ClubDetailPageMenu`
are the homes for these. **They are not overflow menus** — both are the header's *sub-page
switcher* (`Ride plan ⌄`, `Timeline ⌄`), built on `ContextMenu`, and adding a destructive row to
a navigation sheet puts `Delete` one tap from `Crew`. The `Edit` entry point is a header action;
`Delete` lives at the foot of the edit screen behind a second tap, which is the shape
`PostcardMenu` already established for an irreversible action.
