# Design — edit and delete for rides and clubs

## Context

All four RLS policies are live and were measured off DEV (`fpmrimzxadewsaiwpsel`) on 2026-08-09,
not read from the migration files. The work is an action layer plus two screens. One decision is
genuinely load-bearing and the rest follow from it.

## D1 — Club deletion goes through a `security definer` RPC, not a client `.delete()`

**Decision.** Add `public.delete_owned_club(club_id uuid)`, `security definer`, `SET search_path`
pinned, `EXECUTE` to `authenticated`, re-checking `owner_id = auth.uid()` internally. It deletes
the club's `is_public = false` rides and then the club, in one transaction. `deleteClub` calls it.

**Why nothing else works.** `rides.club_id` is `ON DELETE SET NULL`, which leaves a private ride
visible only to its organizer with its `ride_members` rows intact — the zombie `029` names, and
the reason `private.transfer_owned_clubs` deletes a club's private rides rather than letting the
FK fire. A client-side delete would need to clear those rides first, and **the club owner has no
grant to do it**: the `rides` DELETE policy is `auth.uid() = organizer_id` with no club-owner arm.
For a private club that blocks *every* ride, because `propagate_club_privacy_to_rides` and
`enforce_ride_club_audience` between them guarantee a private club's rides are all
`is_public = false`.

So this is not a preference for an RPC. **The client is structurally incapable of the cleanup**,
and shipping the bare delete means every private-club deletion strands its crews silently.

**Rejected — A) widen the `rides` DELETE policy to admit the club owner.** One extra arm,
no function, no advisor. Rejected because it is permanently broader than the problem: it would let
a club owner delete any member's ride in their club *at any time*, not only while deleting the
club. That is a real product decision about club moderation which nobody has made, arriving as a
side effect of a cleanup. It also cannot be scoped to "during a delete" in a policy.

**Rejected — B) refuse to delete a club that contains rides the owner did not organize.** Honest
and cheap, and it needs no migration. Rejected because the owner then has no path at all: they
cannot delete those rides, cannot transfer the club, and cannot make the other member delete
theirs. It converts a silent bug into a permanent dead end.

**Cost, stated.** A seventh `authenticated_security_definer_function_executable` advisor, taking
the total from eight to nine. `CLAUDE.md`'s advisor table must gain the row in the same change, or
a deliberate WARN reads as a regression for ever.

## D2 — Deleting a ride needs no function

`ride_members`, `ride_messages` and `notifications.ride_id` all cascade; `postcards.ride_id` is
`SET NULL` and `ride_id` is a tag rather than an audience, so nulling it changes visibility by
nothing. A plain `.from('rides').delete().eq('id', …)` under the existing policy is correct and
complete. The asymmetry with clubs is entirely `postcards.club_id`'s cascade and `rides.club_id`'s
`SET NULL`.

## D3 — Last-write-wins; no optimistic concurrency

Neither table has an `updated_at` or a version column, and adding one is a schema change this story
does not need. Two organizers cannot both edit a ride (there is only one organizer) and two owners
cannot both edit a club (there is only one owner). The realistic conflict is **one rider with the
form open on two devices**, which is rare and self-inflicted.

Recorded as a decision rather than left silent, because "the screen does not know its data went
stale" is a state the checklist asks about and the answer here is *deliberately, it does not*.

## D4 — The affordances: Edit in the header, Delete at the foot of the edit screen

`RidePageMenu` and `ClubDetailPageMenu` are **sub-page switchers**, not overflow menus — they are
the header's `Ride plan ⌄` / `Timeline ⌄` control, built on `ContextMenu`, and every row in them
is navigation. Putting `Delete` in one places an irreversible action one tap from `Crew` on a
glove-sized target.

Both drawn frames put the destructive action at the foot of the edit screen as a full-width
`Warning/100` text button, and that is the one piece of layout worth taking from a v1 frame. It
also matches `PostcardMenu`'s established shape for an irreversible action: a second, deliberate
tap.

## D5 — Composition is ours, and the drawn frames are v1

Measured: `Edit ride` (`1918:15995`) and `Edit club` (`1951:8602`) are on the Design page and are
drawn entirely in `Grey (OLD)/*` / `Accent (OLD)/*`. No `Edit ride` or `Edit club` epic exists on
the Design page at all — the `Done` covers of those names are on the **Archive** page, governing
the archived v1 frames. `Edit ride` sits under no epic; `Edit club` sits inside `Clubs / Create
club`, whose epic reads **To do**.

**Build the v2 field set from the schema, not from those frames.** They draw an end date+time, a
`Distance` in Km, an `Includes offroad` toggle, `Public seats` separate from `max_riders`, a cover
image, and `Invite` + an `Admin` chip + per-member remove. None has a column. The `Edit club`
frame's header reads `Create club` and its destructive button reads `Delete ride`, which confirms
it is an unedited copy of Create club.

The editable field set is therefore exactly what the create forms already own:

- **Ride** — `title`, `description`, `route_description`, `meeting_point`, `departure_at`,
  `max_riders`, `is_public`, `club_id`.
- **Club** — `name`, `description`, `is_public`, `avatar_path`, `cover_image_path`.

## Open questions — each with a recommended default so the build is not blocked

| # | Question | Recommended default | Blocking? | Who decides |
|---|---|---|---|---|
| Q1 | Should a club owner be able to delete a club containing rides other members organized, given it destroys those rides? | **Yes, with the count in the confirmation.** D1's alternative B is a dead end. | No | Product owner |
| Q2 | Should the postcard count in the delete confirmation be the owner's RLS-visible count, or a true total? | **RLS-visible.** A true total needs a definer function that leaks how much content a private club holds. Copy says "at least", not an exact claim. | No | Product owner |
| Q3 | If `admin` is ever written to `club_members.role`, does it carry club edit rights? | **Undecided — do not build for it.** No rider can hold the role today. Deciding it here would settle a moderation model nobody has designed. | No | Product owner |
| Q4 | Should an organizer be able to hand a ride to someone else, or an owner hand over a club? | **No, unchanged.** Both `WITH CHECK`s refuse it and this change does not relax them. The owner-cannot-leave gap is real and stays open. | No | Product owner |
| Q5 | Should the `rides`/`clubs` UPDATE grant be narrowed per column so `created_at` is not client-writable? | **Yes, but as its own migration.** It hardens a hole predating this change and wants its own assertions. | No | Agent, follow-up |
| Q6 | Does cancelling a ride need to tell the crew before PD-124 lands? | **No.** PD-124 owns it and is parked on three owner decisions. The gap is stated in the spec so it is not inherited as covered. | **Yes, if the answer is "it must"** — that would pull notification design into this change | Product owner |
| Q7 | Should there be a soft-delete / "cancelled" state for rides instead of a hard delete? | **No.** No column exists, the FKs are built for a hard delete, and a tombstone changes what every ride query must filter. | No | Product owner |
