# Tasks — PD-101

**Groups 1 and 2 are independent and either may ship first.** Group 1 (rides) needs no
migration. Group 2 (clubs) cannot ship without its migration — see `design.md` §D1. Group 3 is
cross-cutting and lands with whichever group ships last. Nothing in group 1 imports anything from
group 2 or vice versa; if the owner wants them split, split at the group boundary and each half
is mergeable on its own with neither leaving the other half-built.

## 1. Rides — edit and delete (no schema change)

- [ ] 1.1 Add `updateRide(rideId, prev, formData)` to `src/lib/actions/rides.ts`. Reuse
      `rideSchema`. Build the `.update()` payload from an **explicit field list** — `title`,
      `description`, `route_description`, `meeting_point`, `departure_at`, `max_riders`,
      `is_public`, `club_id` — never a spread. Comment that this is advisory, not enforced: the
      grant is table-level (`database-enforced-integrity` delta).
- [ ] 1.2 Pass `departure_at` through `wallClockToUtc`, exactly as `createRide` does.
- [ ] 1.3 Carry `createRide`'s `23514` + `private club cannot be public` branch into
      `updateRide`. `enforce_ride_club_audience` fires `BEFORE INSERT OR UPDATE`, so an edit hits
      it; `018`'s length CHECKs raise the same SQLSTATE, which is why the message is matched too.
- [ ] 1.4 Refuse, in the action and in the form, a save where `club_id` is NULL and `is_public`
      is false — the zombie shape. Name both remedies in the message.
- [ ] 1.5 Add `deleteRide(rideId)` to `src/lib/actions/rides.ts`. Plain `.delete()`; no function
      needed (`design.md` §D2).
- [ ] 1.6 Add `getRideForEdit(rideId)` to `src/lib/data/rides.ts` returning the editable columns
      plus `organizer_id`, so the screen can tell "not yours" from "not found".
- [ ] 1.7 Add a helper that renders a stored instant back into a `datetime-local` value as
      `APP_TIME_ZONE` wall-clock, in `src/lib/utils.ts`, named for the screen it serves. Unit
      tests SHALL assert **offsets, not strings** — `TZ=UTC` in `vitest.config.ts` lets a naive
      implementation pass, which is why `wallClockToUtc`'s own tests are written that way.
- [ ] 1.8 Build `src/app/(app)/rides/[id]/edit/page.tsx` — `'use client'`, read via `useQuery`
      with `keys.rides.detail(id)`, gate on the data not `isLoading`, `null` → `notFound()`.
- [ ] 1.9 Implement the state matrix from `specs/ride-lifecycle`: loading, not-found vs not-yet,
      not-yours, error-with-values-kept, offline-refuses, partial (club picker disabled with its
      current value, never empty).
- [ ] 1.10 Add the Edit affordance to `RideHeader`, organizer-only. **Not** to `RidePageMenu` —
      that is the sub-page switcher (`design.md` §D4).
- [ ] 1.11 Add the Delete control at the foot of the edit screen, `Button variant="danger"`,
      behind a second confirmation stating the crew count and that the chat goes with it.
- [ ] 1.12 Wire cache invalidation per the `client-cache-invalidation` delta: `updateRide` →
      `rides.detail(id)` + `rides.all()`; `deleteRide` → `rides.all()` + `postcards.all()`.
      Navigate away before the detail read re-runs against a deleted row.
- [ ] 1.13 Vitest for the new `lib/data` function and the wall-clock round-trip helper.

## 2. Clubs — edit and delete (migration required)

- [ ] 2.1 Write `supabase/migrations/043_delete_owned_club.sql`. **Do not edit an applied
      migration; confirm the next free prefix with `list_migrations` against
      `ls supabase/migrations/` first** — `CLAUDE.md` records DEV at `042` and PROD at `040`, and
      that number has been wrong in both directions.
- [ ] 2.2 The function: `public.delete_owned_club(club_id uuid)`, `security definer`,
      `SET search_path = ''`, `revoke execute ... from public/anon`, `grant execute to
      authenticated`. Body re-checks `owner_id = auth.uid()` and raises if not; deletes
      `rides where club_id = $1 and is_public = false`; deletes the club. One transaction.
- [ ] 2.3 **Paired assertion task — a policy/function change with no assertion is not finished.**
      Add to `supabase/tests/rls_test.sql`:
      - `has_function_privilege('authenticated', …, 'EXECUTE')` is true — **name the role, do not
        call the function**; the suite runs as the table owner (`031`'s lesson).
      - the same is false for `anon`.
      - a non-owner call deletes nothing and raises.
      - an owner call removes the club and its private rides.
      - an owner call **leaves a public ride standing** with `club_id` NULL.
      - after an owner call, **no ride exists with `club_id` NULL, `is_public` false and
        surviving `ride_members` rows**.
- [ ] 2.4 Add assertions for the four standing policies from the **client** direction, which the
      suite does not currently cover: owner/organizer can UPDATE and DELETE; `admin`, `member`,
      non-member and blocked rider cannot; `organizer_id`/`owner_id` cannot be moved by the
      `WITH CHECK`.
- [ ] 2.5 Add an assertion pair for `propagate_club_privacy_to_rides` in **both** directions:
      public → private downgrades rides; private → public does **not** restore them.
- [ ] 2.6 Apply to DEV via `apply_migration`. Then run the security advisors and confirm exactly
      one new WARN, `authenticated_security_definer_function_executable`.
- [ ] 2.7 Update `CLAUDE.md`'s security-advisor table — six becomes seven, eight becomes nine,
      naming `delete_owned_club`. An expected advisor missing from that table reads as a
      regression for ever.
- [ ] 2.8 Add `updateClub(clubId, prev, formData)` to `src/lib/actions/clubs.ts`, explicit field
      list: `name`, `description`, `is_public`, `avatar_path`, `cover_image_path`.
- [ ] 2.9 Add `deleteClub(clubId)` calling the RPC. A bare `.from('clubs').delete()` must not
      ship.
- [ ] 2.10 Add `getClubForEdit(clubId)` and a counts read for the confirmation — postcards, rides
      and members, **under the caller's own RLS**, no definer path.
- [ ] 2.11 Build `src/app/(app)/clubs/[id]/edit/page.tsx`, owner-only, with the image upload the
      create screen already has.
- [ ] 2.12 Implement the privacy-toggle disclosure: before saving `is_public = false`, state that
      the club's public rides become private and are **not** restored by toggling back, and name
      the count.
- [ ] 2.13 Implement the delete confirmation: postcard count including other members', ride
      count, member count, "cannot be undone", second deliberate tap. If the counts cannot be
      read, **refuse the action** rather than showing zero.
- [ ] 2.14 Add the Edit affordance to `ClubDetailHeader`, owner-only. Not to
      `ClubDetailPageMenu`.
- [ ] 2.15 Wire invalidation: `updateClub` → `clubs.all()`, plus `rides.all()` **when
      `is_public` changed**; `deleteClub` → `clubs.all()` + `rides.all()` + `postcards.all()`.
      Navigate away before the detail read re-runs.

## 3. Cross-cutting — lands with whichever group ships last

- [ ] 3.1 Add any new keys to `src/lib/query/keys.ts`; no key written inline in a component.
- [ ] 3.2 Add the edit routes to `npm run walk` so the screens are actually rendered — `tsc`,
      ESLint, Vitest, `next build` and the RLS suite all stay green through a screen that throws
      on load.
- [ ] 3.3 Run `npm test` (RLS suite) and compare **label sets, not counts**, against the previous
      run: a count cannot tell a rename from a loss.
- [ ] 3.4 Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] 3.5 Run `npm run docs:check` — the advisor-count edit in 2.7 touches a registered numeric
      claim.
- [ ] 3.6 Update `docs/HANDOFF.md`: the migration's applied state on DEV vs PROD, each claim
      beside the command that verifies it.
- [ ] 3.7 Log the deferred hardening as a follow-up: narrow the `rides`/`clubs` UPDATE grant per
      column so `created_at` is not client-writable (`design.md` Q5).
- [ ] 3.8 Delegate `reviewer` on the final diff, immediately before the PR.
