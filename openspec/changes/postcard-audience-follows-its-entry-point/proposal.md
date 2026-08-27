# Postcard audience follows its entry point

## Why

The postcard composer asks the rider two questions they have already answered by getting there.
`CreatePostcardForm` draws a **Club** `<select>` (the audience) and a **Ride** `<select>` (the
tag), both seeded from the URL the rider arrived on — so a rider who taps "Add postcard" inside a
club is shown a dropdown pre-set to that club and invited to change it. The product owner settled
on 2026-08-27 that the entry point **is** the answer.

The same sitting settled a second thing that looks unrelated and is not: **`rides.is_public`
defaults to `true`, and for a ride with no club that default is the only thing keeping the ride
visible to anybody but its organizer.**

Both are audience decisions. They ship in one change because the second is what makes the first
safe: once a postcard's audience is inherited from the ride, the ride's own audience stops being a
checkbox nobody reads.

## What Changes

### The composer

- **The club and ride fields come out.** Audience follows the entry point:
  - **from Home** → app-wide, `club_id` NULL, with an explicit line saying who will see it
  - **from a club** → that club
  - **from a ride** → tagged to that ride, and the audience is the ride's `club_id` when it has
    one
- **The composer title carries the context and states the AUDIENCE, not the source** — *"Only
  &lt;club&gt; members see this"*, never *"Club postcard — &lt;club&gt;"*. A rider is choosing who
  reads it, not filing it.

### The chain is resolved once, at insert

**The mental model is postcard → ride → club. It is NOT stored that way, and the spec says so.**
The postcards SELECT policy, measured on DEV 2026-08-27, is:

```
author_id = auth.uid()
or (not private.is_blocked(auth.uid(), author_id)
    and (club_id is null or private.is_club_member(club_id))
    and not exists (select 1 from postcard_hides h
                     where h.postcard_id = postcards.id and h.user_id = auth.uid()))
```

**`ride_id` appears nowhere in it, and must not.** `ride_id` is a TAG, not a second audience —
`062`'s own column comment, and `docs/reference/schema.md`'s *"nulling it changes who can see the
postcard by exactly nothing"*. So the composer **resolves** the chain once and the row stores its
own `club_id`.

**Why materialising beats a live chain**, recorded rather than left to be re-derived: `rides.club_id`
is `ON DELETE SET NULL` and is in `authenticated`'s UPDATE grant list, so it can change after the
postcard is written. A policy walking the chain would silently move who can see old postcards — a
club deletion or one organizer's edit retroactively republishing other riders' photos.

### A crew member who is not in the ride's club: the post is REFUSED

`rides.is_public` and `rides.club_id` are independent, so a **public** club ride can carry crew who
never joined the club. Copying the ride's club onto their postcard hits the postcards INSERT
policy's `club_id is null or private.is_club_member(club_id)` conjunct and returns `42501`.

**Owner decision (option J), reaffirmed after the alternative was argued.** Recorded once, per
`CLAUDE.md` §Working With the Product Owner, and not re-raised:

> It closes an injection vector. A stranger joining a public club ride could otherwise drop
> content into that club's journal, in front of members who never let them in.

**The refusal SHALL be an explained state in the UI, not a raw error.** Today `createPostcard`
returns the undifferentiated `'Could not post that. Try again.'` for every failure — which is
actively wrong here, because retrying will never succeed.

**The accepted cost, stated:** `authenticated` holds no UPDATE grant on `ride_id` (the UPDATE list
is exactly `caption, club_id, image_path`, measured 2026-08-27), so a postcard posted from Home can
never join a ride's journal afterwards. **A refused rider loses that ride's journal permanently.**

### `rides.is_public` default flips

- **A ride created inside a club defaults to NOT public** — club-only.
- **A clubless ride must be public.** Owner decision, and the reason is concrete: the rides SELECT
  policy's public arm is the only one a non-organizer with no club can satisfy, and **there is no
  invite flow.** `Invite riders` is a design frame with no schema behind it —
  `src/app/(app)/rides/detail/crew/page.tsx` says so in its own header. So a private clubless ride
  is visible to its organizer alone, for ever.
- **Spec the coupling: clubless ⇒ public**, in the database, because the client owns the mutation
  path and `authenticated` holds UPDATE on both `club_id` and `is_public`.

## What Does NOT Change

- **`ride_id` stays out of every audience predicate**, on SELECT and everywhere else. It is a tag.
- **`ride_id` stays out of `authenticated`'s SELECT grant** (`062`) and out of UPDATE (`041`).
- **The postcards INSERT policy's club conjunct is the enforcement.** Removing the club field from
  the composer removes a control, never a check. Nothing in this change may add an application-side
  audience filter — decision #2's shape, applied to an audience rather than a block.
- **`private.is_ride_crew` still gates the tag.** The composer already lists only rides the rider is
  crew of (`getCrewRides`), and the policy already refuses the rest. Both stay.
- **Blocking.** Unchanged, in RLS, symmetric.
- **The location control.** `Country`/`Region`/`Precise`, the default and the search split are
  `postcard-location-defaults-to-a-region`'s. The two changes ship independently, but they claim
  overlapping migration numbers — see `tasks.md`'s header.

## Consequence to state, not to solve

**`postcards.club_id → clubs` is `ON DELETE CASCADE`** (`009`). So a rider posting from a club ride
has their photo deleted with the club — **an audience they never typed deciding the fate of their
own postcard.** Today that is reachable only by a rider who deliberately picked the club in the
dropdown; after this change it is the default outcome for every postcard from a club ride.

This is existing behaviour reaching new rows. It is named here and **not fixed in this change** —
`docs/reference/schema.md` already records that a club deletion orphans other riders' postcard
images permanently (`PD-94`), so changing the cascade is its own decision with its own migration
and its own storage question. See Q**C**.

## A future decision this change does not assume

The owner noted that private clubless rides become possible only if a "friends" concept is
introduced later. **That would be a reversal of `013`, which dropped `friendships` on 2026-08-04**,
and `CLAUDE.md`'s current position is that the social graph is clubs plus blocking, with no Friends
tab. It is flagged as a **future owner decision**, not something this change assumes, prepares for
or builds toward. Nothing here should be shaped to make it easier.

## Open Questions

**A) The `club_id` UPDATE grant, now that no screen writes it.** *(blocking, product owner + `data`)*
`authenticated` holds `update (club_id)` on `postcards`. With the field gone from the composer,
that is a grant with no UI behind it — and the `010` UPDATE `with check` permits moving a postcard
to NULL, which **widens** its audience. **Read the policy from `010_postcard_storage.sql`, never from `009`** — `010` drops `009`'s
version and recreates it with a third conjunct, `image_path like ('postcards/' ||
auth.uid()::text || '/%')`, and an author re-issuing `009`'s text would silently drop that
prefix guard. `044`/`046`'s trap, on this exact table.
Recommended default: revoke `update (club_id)`, making the
audience insert-only like the ride tag and every location column. It makes "audience follows the
entry point" a database rule instead of a UI convention.

**B) What the clubless-ride coupling does to a club deletion.** *(blocking, `data` — see D4)* A
`club_id is not null or is_public` CHECK interacts with `rides.club_id`'s `ON DELETE SET NULL`: a
bare `clubs` delete (the DELETE policy is still `auth.uid() = owner_id`) would try to SET NULL on a
private ride and hit `23514`. Recommended default: ship the CHECK anyway. It converts a silent
orphaning — which `docs/reference/schema.md` already flags as the reason `delete_owned_club` exists
— into a loud refusal that points at the RPC. Confirm the RPC's own path stays clean.

**C) The cascade on `postcards.club_id`.** *(non-blocking, product owner)* Should a club deletion
still destroy every member's postcards, now that the audience is inherited rather than chosen?
Recommended default: unchanged in this change. It is a retention and storage decision, not an
audience one, and the Storage objects are orphaned either way.

**D) What a rider sees on the ride journal they were refused from.** *(non-blocking, `rider-ux`)*
Recommended default: the journal renders normally and simply contains nothing of theirs; the
refusal is explained at the moment of posting and not repeated afterwards, because a permanent
banner about a thing they cannot fix is worse than the loss.

**E) Existing rides on the flipped default.** *(non-blocking, `data`)* Recommended default: no
backfill. DEV holds 15 rides, 8 with a club and **0 private clubless rides**, so the coupling adds
cleanly with no data migration — measured 2026-08-27. Re-measure against PROD before applying.
