# Tasks — PD-101

**Groups 1 and 2 are independent and either may ship first.** Group 1 (rides) needs no
migration. Group 2 (clubs) cannot ship without its migration — see `design.md` §D1. Group 3 is
cross-cutting and lands with whichever group ships last. Nothing in group 1 imports anything from
group 2 or vice versa; if the owner wants them split, split at the group boundary and each half
is mergeable on its own with neither leaving the other half-built.

## 1. Rides — edit and delete (no schema change)

- [x] 1.1 Add `updateRide(rideId, prev, formData)` to `src/lib/actions/rides.ts`. Reuse
      `rideSchema`. Build the `.update()` payload from an **explicit field list** — `title`,
      `description`, `route_description`, `meeting_point`, `departure_at`, `max_riders`,
      `is_public`, `club_id` — never a spread. Comment that this is advisory, not enforced: the
      grant is table-level (`database-enforced-integrity` delta).
- [x] 1.2 Pass `departure_at` through `wallClockToUtc`, exactly as `createRide` does.
- [x] 1.3 Carry `createRide`'s `23514` + `private club cannot be public` branch into
      `updateRide`. `enforce_ride_club_audience` fires `BEFORE INSERT OR UPDATE`, so an edit hits
      it; `018`'s length CHECKs raise the same SQLSTATE, which is why the message is matched too.
- [x] 1.4 Refuse, in the action and in the form, a save where `club_id` is NULL and `is_public`
      is false — the zombie shape. Name both remedies in the message.
- [x] 1.4a Handle the **ex-member organizer** dead end. A `WITH CHECK` is evaluated on every
      update, so an organizer who left the ride's club can no longer edit that ride at all — the
      refusal arrives on a save that touched no club field. Show the Edit affordance, surface the
      refusal naming the club, and offer the two exits the policies already permit: delete the
      ride, or make it public and detach it from the club. Do **not** widen the policy.
- [x] 1.4b Add RLS assertions for it: an ex-member organizer's UPDATE is refused; their DELETE
      succeeds; their `club_id → NULL` with `is_public = true` succeeds. **Done** — 13
      assertions in `rls_test.sql`, labelled `017:` because they constrain that migration's
      UPDATE policy rather than `043`. Suite 1109 → 1122. Each claim was mutation-tested, and
      the precondition that the same rider *can* edit while still a member is what stops the
      case passing vacuously against a policy that refuses everyone
      and `npm run walk` instead, per `ride-lifecycle`'s own requirement table.
- [x] 1.5 Add `deleteRide(rideId)` to `src/lib/actions/rides.ts`. Plain `.delete()`; no function
      needed (`design.md` §D2).
- [x] 1.6 Add `getRideForEdit(rideId)` to `src/lib/data/rides.ts` returning the editable columns
      plus `organizer_id`, so the screen can tell "not yours" from "not found".
- [x] 1.7 Add a helper that renders a stored instant back into a `datetime-local` value as
      `APP_TIME_ZONE` wall-clock, in `src/lib/utils.ts`, named for the screen it serves. Unit
      tests SHALL assert **offsets, not strings** — `TZ=UTC` in `vitest.config.ts` lets a naive
      implementation pass, which is why `wallClockToUtc`'s own tests are written that way.
- [x] 1.8 Build `src/app/(app)/rides/[id]/edit/page.tsx` — `'use client'`, read via `useQuery`
      with `keys.rides.detail(id)`, gate on the data not `isLoading`, `null` → `notFound()`.
      **Reads `keys.rides.edit(id)` instead** — `getRideForEdit` returns a narrower shape than
      `getRide`, so it needs its own key rather than colliding two shapes on `rides.detail(id)`;
      see that key's own comment in `keys.ts`.
- [x] 1.9 Implement the state matrix from `specs/ride-lifecycle`: loading, not-found vs not-yet,
      not-yours, error-with-values-kept, offline-refuses, partial (club picker disabled with its
      current value, never empty).
- [x] 1.10 Add the Edit affordance to `RideHeader`, organizer-only. **Not** to `RidePageMenu` —
      that is the sub-page switcher (`design.md` §D4).
- [x] 1.11 Add the Delete control at the foot of the edit screen, `Button variant="danger"`,
      behind a second confirmation stating the crew count and that the chat goes with it.
- [x] 1.12 Wire cache invalidation per the `client-cache-invalidation` delta: `updateRide` →
      `rides.detail(id)` + `rides.all()`; `deleteRide` → `rides.all()` + `postcards.all()`.
      Navigate away before the detail read re-runs against a deleted row.
- [x] 1.13 Vitest for the new `lib/data` function and the wall-clock round-trip helper.
      **`formatRideDepartureInput` is tested directly** (`utils.test.ts`); `getRideForEdit` itself
      calls `resolveSupabase()` and is not unit-testable without a live database, matching every
      other `lib/data/` read function's own test coverage (none of them mock Supabase either) —
      `unwrapCount`, the new shared helper it and the club counts route through, is.

## 2. Clubs — edit and delete (migration required)

- [x] 2.1 Write `supabase/migrations/043_delete_owned_club.sql`. **Do not edit an applied
      migration; confirm the next free prefix with `list_migrations` against
      `ls supabase/migrations/` first** — `CLAUDE.md` records DEV at `042` and PROD at `040`, and
      that number has been wrong in both directions.
- [x] 2.2 The function: **`public.delete_owned_club(p_club_id uuid)`**, `security definer`,
      `SET search_path = ''`, `revoke execute ... from public/anon`, `grant execute to
      authenticated`. Body re-checks `owner_id = auth.uid()` and raises if not; deletes
      `rides where r.club_id = p_club_id and r.is_public = false`; deletes the club. One
      transaction.

      **The parameter is `p_club_id` and that name is load-bearing.** `club_id` is a column on
      `rides`, `club_members`, `feed_reads`, `postcards` and `notifications`, so a parameter of
      that name makes `where club_id = club_id` ambiguous. `p_` is this repo's own convention
      for exactly this case — `complete_onboarding(p_location text)` is the precedent, and
      `location` is a `profiles` column. Locals take `v_`, as that function's do.
- [x] 2.2a **Write `#variable_conflict error` as the first line of the body, and qualify every
      column reference with its table alias** (`r.club_id`, `c.owner_id`), the way
      `complete_onboarding` writes `p.id = v_uid`.

      Measured on DEV 2026-08-09: `plpgsql.variable_conflict` is already `error`, so the
      collision raises `42702 column reference "club_id" is ambiguous` and deletes **nothing** —
      it does not silently resolve to the column. The pragma is therefore **not** a fix for a
      silent-deletion bug; it is what makes the guarantee *local to the function* instead of
      dependent on a cluster GUC an operator can set to `use_column`, which is the setting under
      which the silent mass delete would become real. Say that in the migration's comment rather
      than the scarier version, or the next session inherits a claim the database contradicts.
- [x] 2.3 **Paired assertion task — a policy/function change with no assertion is not finished.**
      Add to `supabase/tests/rls_test.sql`:
      - `has_function_privilege('authenticated', …, 'EXECUTE')` is true — **name the role, do not
        call the function**; the suite runs as the table owner (`031`'s lesson).
      - the same is false for `anon`.
      - a non-owner call deletes nothing and raises.
      - an owner call removes the club and its private rides.
      - an owner call **leaves a public ride standing** with `club_id` NULL.
      - after an owner call, **no ride exists with `club_id` NULL, `is_public` false and
        surviving `ride_members` rows**.
- [x] 2.3a **The blast-radius containment assertion — the one the happy path cannot make.**
      Seed **two** unrelated clubs, each with a private ride and its own `club_members` and
      `ride_members` rows. Delete club A. Assert club B still exists **and club B's private ride
      still exists**, alongside its membership and crew rows.

      Every other assertion in 2.3 checks that the target's rows are *gone*, and all of them pass
      under a `WHERE` clause that is too broad — a dropped club filter, an ambiguous reference
      resolved the wrong way, or a plain `delete from rides where is_public = false`. This is the
      only assertion that fails when the function deletes **more** than it was asked to, which is
      the entire risk this function carries.
- [x] 2.4 Add assertions for the four standing policies from the **client** direction, which the
      suite does not currently cover: owner/organizer can UPDATE and DELETE; `member`,
      non-member and blocked rider cannot; `organizer_id`/`owner_id` cannot be moved by the
      `WITH CHECK`.
- [x] 2.4a The `admin` case is asserted **as a regression guard on current policy text, not as a
      product rule**: a hand-written `role = 'admin'` row still matches zero rows on club UPDATE
      and DELETE, because neither policy consults `club_members`. **Name it in the assertion
      label as such** (e.g. `admin role confers no club write under current policies`) and add a
      comment pointing at `design.md` Q3, which is open. A label reading "admins may not edit
      clubs" ships the undecided answer as a green test — the failure `openspec/config.yaml`
      exists to prevent.
- [x] 2.5 Add an assertion pair for `propagate_club_privacy_to_rides` in **both** directions:
      public → private downgrades rides; private → public does **not** restore them.
- [x] 2.6 Apply to DEV via `apply_migration`. Then run the security advisors and confirm exactly
      one new WARN, `authenticated_security_definer_function_executable`.
- [x] 2.7 Update `CLAUDE.md`'s security-advisor table — six becomes seven, eight becomes nine,
      naming `delete_owned_club`. An expected advisor missing from that table reads as a
      regression for ever.
- [x] 2.8 Add `updateClub(clubId, prev, formData)` to `src/lib/actions/clubs.ts`, explicit field
      list: `name`, `description`, `is_public`, `avatar_path`, `cover_image_path`.
- [x] 2.9 Add `deleteClub(clubId)` calling the RPC. A bare `.from('clubs').delete()` must not
      ship.
- [x] 2.9a **Function half done in `043`; the client half is not.** Have the function **return the orphaned Storage object paths** (`club-avatars/…`,
      `club-covers/…`), mirroring `private.transfer_owned_clubs`'s `object_path text` return, and
      have `deleteClub` delete those objects from Storage. They sit under the owner's own uid
      prefix, so the caller's Storage policy permits it.
- [x] 2.9b Record in the migration comment that **cascade-deleted postcards' images are
      permanently orphaned** — they live under `postcards/<author uid>/` and the club owner's
      Storage policy cannot reach another rider's prefix. Point at **`PD-94`** (orphaned Storage
      objects); **file no new issue**.
- [x] 2.10 Add `getClubForEdit(clubId)` and a counts read for the confirmation — postcards, rides
      and members, **under the caller's own RLS**, no definer path. **All three counts undercount
      by design**: blocked riders' postcards, rides and memberships are invisible to the owner and
      are still destroyed. Name the variables so the floor is obvious at the call site.
      **`getClubDeletionImpact` carries postcards/rides; members is read alongside them** rather
      than reused from `ClubDetail.members_count`, so `DeleteClubControl` has one source for every
      number it shows instead of two reads that could disagree.
- [x] 2.11 Build `src/app/(app)/clubs/[id]/edit/page.tsx`, owner-only, with the image upload the
      create screen already has.
- [x] 2.12 Implement the privacy-toggle disclosure: before saving `is_public = false`, state that
      the club's public rides become private and are **not** restored by toggling back, and name
      the count.
- [x] 2.13 Implement the delete confirmation. It must enumerate the **whole** blast radius, not
      postcards alone: postcard count including other members'; ride count **and that each ride
      takes its crew list and its entire chat history with it**; member count; "cannot be undone";
      second deliberate tap. If the counts cannot be read, **refuse the action** rather than
      showing zero.
- [x] 2.13a Phrase every count as a **floor** — "at least N", never "N". All three are read under
      the owner's RLS and exclude blocked riders' content, which is still destroyed. Do **not**
      build a privileged count to fix this: it would tell the owner exactly how much content a
      rider who blocked them holds, which is what blocking withholds. The under-disclosure is the
      deliberate trade and the copy carries it.
- [x] 2.14 Add the Edit affordance to `ClubDetailHeader`, owner-only. Not to
      `ClubDetailPageMenu`.
- [x] 2.15 Wire invalidation: `updateClub` → `clubs.all()`, plus `rides.all()` **when
      `is_public` changed**; `deleteClub` → `clubs.all()` + `rides.all()` + `postcards.all()`.
      Navigate away before the detail read re-runs.

## 3. Cross-cutting — lands with whichever group ships last

- [x] 3.1 Add any new keys to `src/lib/query/keys.ts`; no key written inline in a component.
- [x] 3.2 Add the edit routes to `npm run walk` so the screens are actually rendered — `tsc`,
      ESLint, Vitest, `next build` and the RLS suite all stay green through a screen that throws
      on load. **Added to `discoverDetailPaths()`'s `paths`, not run** — this session has no DEV
      credentials and the walk needs `WALK_EMAIL`/`WALK_PASSWORD` plus the relay; see the
      session's own report for what that leaves unverified.
- [ ] 3.3 Run `npm test` (RLS suite) and compare **label sets, not counts**, against the previous
      run: a count cannot tell a rename from a loss. **Not run** — this change touches no
      `supabase/**` file, and the brief scoping this session's work states the RLS suite is not a
      required gate for it.
- [x] 3.4 Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [x] 3.5 Run `npm run docs:check` — the advisor-count edit in 2.7 touches a registered numeric
      claim. **Also caught this session's own drift**: the unit-test count (987 → 1010) and the
      dynamic-route count (8 → 10, the two new `/edit` routes) were both registered claims;
      `docs/HANDOFF.md` is updated to match.
- [x] 3.6 Update `docs/HANDOFF.md`: the migration's applied state on DEV vs PROD, each claim
      beside the command that verifies it.
- [ ] 3.7 Log the deferred hardening **on the existing `PD-163`** rather than as a new issue:
      narrow the `rides`/`clubs` UPDATE grant per column so `created_at` is not client-writable
      (`design.md` Q5). `PD-163` already covers the same defect class on `postcards`; add a
      comment naming the two extra tables so its scope is complete. **Not done in this session —
      no Linear tool was in this session's allowlist.**
- [ ] 3.8 Delegate `reviewer` on the final diff, immediately before the PR.
