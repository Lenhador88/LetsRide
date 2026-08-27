# Tasks — postcard audience follows its entry point

**Read `design.md` before touching any of this.** Three of its measurements change the obvious
implementation: the three policies are not the shortened versions usually quoted (D1), the chain
must not be walked at read time because `rides.club_id` moves (D2), and the clubless coupling
interacts with `rides.club_id`'s `ON DELETE SET NULL` in a way that can refuse a club deletion
(D4).

**This change does not touch the location control.** `Country`/`Region`/`Precise`, the default and
the search split belong to `postcard-location-defaults-to-a-region`. If a task here starts editing
`taken_*` columns, stop.

## 0. Measure before deciding — `data`, blocking

- [ ] 0.1 Re-run the pre-flight against **both** projects immediately before applying anything.
      DEV 2026-08-27: 15 rides, 8 with a club, 0 private clubless rides, 7 clubs, 0 private clubs,
      10 postcards, 5 with a club, 0 ride-tagged.
      ```sql
      select count(*) from public.rides where club_id is null and not is_public;
      ```
- [ ] 0.2 Enumerate every path that reaches `rides.club_id`'s `ON DELETE SET NULL` and state the
      outcome under the new CHECK for each — `delete_owned_club` (`043`),
      `private.transfer_owned_clubs` (`029`/`031`), and a bare `clubs` DELETE under the still-live
      `auth.uid() = owner_id` policy. **Question B is settled by this, not by argument.**
- [ ] 0.3 Confirm `022`'s two triggers cannot trip the new CHECK — both write rows carrying a
      `club_id`. Assert it; do not reason it.


**The numbers below are provisional.** `080` is the highest file today and both changes
claim numbers from `081`; whichever merges first takes them, so **read `ls
supabase/migrations/` at write time and renumber rather than trusting these**. `run.sh`
applies by filename, and a file whose local order differs from its hosted order is a trap
this repo has already sprung.

## 1. Migration `082_a_clubless_ride_is_public.sql`

- [ ] 1.1 `rides_clubless_ride_is_public`: `check (club_id is not null or is_public)`.
- [ ] 1.2 Header carries the reason a *form default* is not enough: `authenticated` holds
      `update (club_id)` and `update (is_public)` on `rides`.
- [ ] 1.3 Header carries 0.2's enumeration and what the constraint does to each path.
- [ ] 1.4 **This is a tightening**, so it applies to PROD **after** its code is confirmed serving,
      not before — the `063`/`070` half of the ordering rule.
- [ ] 1.5 No policy is touched. The rides SELECT policy is `022`'s and stays byte-identical.
- [ ] 1.6 No grant statement. No column is added.
- [ ] 1.7 §Verification: `pg_get_constraintdef`, the rides CHECK count re-derived (nine today,
      ten after), the four policies unmoved by `md5(qual)`/`md5(with_check)`, and
      `get_advisors(security)` unchanged at **fifteen** — measured on DEV
      2026-08-27, not read off `CLAUDE.md`'s table, which is two definer functions short.

## 2. Migration `083_postcard_audience_is_insert_only.sql` — ONLY if question A is answered yes

- [ ] 2.1 Revoke `update (club_id)` on `postcards` from `authenticated`.
- [ ] 2.2 **Issue it as a narrow revoke, never as an absolute re-grant list.** `044`/`046` is this
      repo's worked example of an absolute list silently reverting a decision, on this exact table.
- [ ] 2.3 Re-issue the `club_id` column comment: it is the audience and it is now insert-only.
- [ ] 2.4 §Verification: the UPDATE list reads exactly `caption, image_path`; `ride_id` still on
      INSERT and absent from SELECT; `anon` at zero in every verb.
- [ ] 2.5 If question A is answered **no**, this file is not written and `proposal.md` records the
      reason a grant with no UI behind it is retained.

## 3. Assertions — `supabase/tests/rls_test.sql`

- [ ] 3.1 Every scenario in `specs/database-enforced-integrity/spec.md`, additions only.
- [ ] 3.2 The clubless coupling on INSERT **and** on UPDATE, in both directions (club removed from
      a private ride; a clubless ride made private).
- [ ] 3.3 **The refusal case, end to end**: a rider who is crew of a public club ride and not a
      member of the club, inserting a postcard with that club — `42501`.
- [ ] 3.4 The same rider tagging the ride with `club_id` NULL succeeds, proving the refusal is the
      club conjunct and not the crew one.
- [ ] 3.5 Every role in `specs/postcard-audience/spec.md`'s per-role statement: author, any
      signed-in rider, member, admin, non-member, blocked, hider, `anon`.
- [ ] 3.6 Every role in `specs/ride-lifecycle/spec.md`'s per-role statement, including the new
      "public club's non-public ride" row.
- [ ] 3.7 Compare **label sets** against the previous run, not counts.

## 4. `src/components/postcards/CreatePostcardForm.tsx`

- [ ] 4.1 Remove the club `<select>` and the ride `<select>`, and the `useRestoreSelection` calls
      that exist because a refusal used to reset them.
- [ ] 4.2 Resolve the audience from the entry point. Keep `seedRideId`/`seedClubId`'s rule: an id
      that does not name a ride the rider is crew of, or a club they belong to, resolves to
      nothing — an unknown id in the URL must not show one context and submit another.
- [ ] 4.3 The refusal state, computed at render from the ride's `club_id` and the rider's own
      clubs — **before** the upload, so a knowable refusal does not orphan a Storage object.
- [ ] 4.3b **The membership set must be the policy's, not `getMyClubs()`'s.** That query reads
      `club_members` alone; `private.is_club_member_for` (`054`) is `club_members` **or**
      `clubs.owner_id`. So a club owner holding no membership row is a member to the database
      and a non-member to the composer — and 4.3 withholds Post entirely, which would block an
      insert the policy accepts. Both specs already name that role for READS; this change
      promotes the client set to a write gate, which is what makes the divergence matter.
      Latent today (7 of 7 DEV club owners hold a row), so it fails the day one does not.
- [ ] 4.4 The audience line, from a pure function in its own module with its own test —
      `resolveLocationCopy`'s shape, and `design.md` D5's five states.
- [ ] 4.5 Say the audience, never the source. *"Only &lt;club&gt; members see this"*.

## 5. `src/lib/actions/postcards.ts`

- [ ] 5.1 `createPostcard` stops reading `clubId`/`rideId` off `FormData` as rider choices and
      starts receiving the resolved context.
- [ ] 5.2 The `42501` refusal gets its own message naming the club and the reason. **Not** the
      generic `'Could not post that. Try again.'`, which is false here — retrying cannot succeed.
- [ ] 5.3 Cache invalidation unchanged: `keys.ts` owns every key, and a club postcard still
      invalidates that club's detail.

## 6. `src/components/rides/CreateRideForm.tsx` and the edit form

- [ ] 6.1 With a club selected, the visibility control defaults to **not public**.
- [ ] 6.2 With no club, the control is **not offered** — the ride is public and the copy says so.
      Do not draw a disabled checkbox; draw the fact.
- [ ] 6.3 `wasChecked`'s existing trap stands: an unticked box sends nothing, so restoring a
      literal default would silently re-publish a ride the rider had just made private.
- [ ] 6.4 The `23514` from the new constraint reaches the form as an explained state.
- [ ] 6.5 The `022` refusal (public ride in a private club) likewise.
- [ ] 6.6 Replace the current helper sentence — *"A private ride is visible to its club, or to you
      alone if it has no club"* — since its second clause becomes unreachable.

## 7. Entry points

- [ ] 7.1 Every surface that opens the composer passes its context: Home, a club, a ride.
- [ ] 7.2 A ride's journal opens the composer with the ride, and the audience is resolved from the
      ride's `club_id`.
- [ ] 7.3 `getCrewRides` is still the source of what a rider may tag — `041`'s write gate mirrored
      in the client, not replacing it.

## 8. Documentation

- [ ] 8.1 `docs/reference/schema.md`'s `postcards` and `rides` rows, if any grant or constraint
      moved.
- [ ] 8.2 **State the `ON DELETE CASCADE` consequence** in the `postcards` row: a rider posting
      from a club ride has their photo deleted with the club, an audience they never typed deciding
      the fate of their own postcard. Named, not fixed — question C.
- [ ] 8.3 `CLAUDE.md`'s migration-count line if `082`/`083` land. **The main thread writes
      `CLAUDE.md` and `docs/HANDOFF.md`, not an agent.**

## 9. Gates

- [ ] 9.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 9.2 `PGPASSWORD=postgres npm test` — additions only, 0 failures.
- [ ] 9.3 Apply to DEV and read the constraints, the policies and the grants back off the database.
- [ ] 9.4 `get_advisors(security)` — **fifteen**, unchanged. No function is added here.
- [ ] 9.5 `npm run walk` against DEV, with `WALK_FIXTURES=1` so the ride and club detail routes
      exist. This is the only gate that renders anything, and the refusal state is exactly the kind
      of screen that stays green through `tsc`, ESLint, Vitest, `next build` and the RLS suite
      while being unreachable or broken.
- [ ] 9.6 `npm run docs:check` if a numeric claim moved.
