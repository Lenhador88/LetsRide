## 1. Integrity migrations — `018`+ (Phase 1, lands first, no application change)

- [ ] 1.1 Pre-flight every constraint below against the live project: count violating rows for
  each column before writing its migration, the way `013` did. Record each count in the
  migration header. A non-zero count means `NOT VALID` plus a separate validate, not a
  loosened rule.
- [ ] 1.2 `018_text_bounds.sql` — CHECK constraints matching the Zod schemas exactly for
  `profiles.bio` (≤500), `profiles.bike_model` (≤60), `profiles.location` (1–100),
  `clubs.name` (1–60), `clubs.description` (≤500), `rides.title` (1–80),
  `rides.description` (≤500), `rides.meeting_point` (1–120), `rides.route_description`
  (≤1000), `rides.max_riders` (1–999). Trimmed floor, raw ceiling, matching
  `postcard_comments_body_length`. NULL stays permitted on every optional column.
- [ ] 1.3 Add `supabase/tests/rls_test.sql` assertions for 1.2: one rejection per bound, plus
  one acceptance at the boundary value, plus NULL accepted on each optional column.
- [ ] 1.4 `019_club_member_role.sql` — a rider may only insert a `club_members` row with
  `role = 'member'`, unless they are the club's `owner_id`, in which case `'owner'` is
  permitted. Implemented as a `WITH CHECK` addition to the existing INSERT policy so the rule
  sits beside the one it qualifies.
- [ ] 1.5 Assertions for 1.4: non-member inserting `role='admin'` into a public club is
  refused; same with `role='owner'`; the club owner's own `'owner'` row succeeds; an ordinary
  join still succeeds with the default; **and** an UPDATE of `role` by the club owner is
  refused, pinning the recorded absence of an UPDATE policy.
- [ ] 1.6 Re-run the `avatar_url` census (design D5/Q3 — 0 non-NULL as of 2026-08-05, on a live
  database) and then `020_drop_legacy_avatar_url.sql`, dropping `profiles.avatar_url` and
  `clubs.avatar_url`. If the census is no longer zero, stop and raise it rather than migrating
  values silently.
- [ ] 1.7 Assertions for 1.6: the column is absent (`to_regclass`-style check on
  `information_schema.columns`), and a rider still cannot write any image reference outside
  their own Storage folder.
- [ ] 1.8 `021_profile_countries_known_code.sql` — country code must be an assigned ISO 3166-1
  alpha-2 value, not merely two uppercase letters. No `countries` reference table: `014`
  declined one deliberately and nothing joins against it.
- [ ] 1.9 Assertions for 1.8: `ZZ` and `XX` refused, `NL` accepted, lowercase still refused.
- [ ] 1.10 `022_onboarding_participation_gate.sql` — a rider whose
  `profiles.onboarding_completed_at` is NULL may not insert into `postcards`, `clubs`,
  `rides`, `club_members`, `ride_members`, `postcard_comments` or `postcard_likes`. One
  `BEFORE INSERT` trigger per table calling a single `security definer` helper (design D4), so
  the rule exists once. Reads are untouched.
- [ ] 1.11 Assertions for 1.10: each of the seven inserts refused while the stamp is NULL and
  accepted once it is set; the rider's own onboarding `profiles` updates still succeed while
  NULL, so nobody is stranded mid-wizard; the `003` stamp guard still refuses completion while
  `username` or `location` is NULL.
- [ ] 1.12 `023_profile_column_exposure.sql` — a `security invoker` view exposing only
  `PUBLIC_PROFILE_COLUMNS` for other riders, with own-row reads unchanged against `profiles`
  (design D6). Point `src/lib/data/columns.ts` at it in Phase 2, not here.
- [ ] 1.13 Assertions for 1.12: rider B cannot read rider A's `terms_accepted_at` or
  `onboarding_completed_at` through any path; rider A still can read their own; a blocked
  rider still gets zero rows.
- [ ] 1.14 Apply `018`–`023` to the hosted project, then check the Supabase security advisors
  and confirm the only findings are the two known ones (`moderate_comment` by design, the
  leaked-password toggle). `npm test` green before any of this is called done.

## 2. Make the data layer isomorphic (Phase 2)

- [ ] 2.1 Introduce a single Supabase client accessor the 19 `src/lib/data/` functions resolve
  at call time, returning the browser client (design D1). No signature changes.
- [ ] 2.2 Convert all 19 read functions to it. Verify no signature moved:
  `git grep -n '^export async function' -- 'src/lib/data/*.ts'` matches the list in design.md.
- [ ] 2.3 Remove `next/headers` from the data layer's reachable module graph and add a unit
  test asserting that, alongside the existing `use-server-exports` test — the same class of
  failure that shipped `/postcards/new` dead.
- [ ] 2.4 Repoint `PUBLIC_PROFILE_COLUMNS` at the `023` view and confirm `resolveAvatarUrls`
  still resolves, now without the dropped `avatar_url` fallback branch.
- [ ] 2.5 Extend the Vitest suite to cover `src/lib/data/` for the first time — currently
  uncovered, and this phase changes every function in it.

## 3. Session, auth and the recovery grant (Phase 3)

- [ ] 3.1 Build the storage adapter: secure store in the native shell, an explicitly-labelled
  weaker store in a plain browser. Construct `@supabase/supabase-js` with it.
- [ ] 3.2 Assert no session, access token or refresh token is reachable from `localStorage`,
  `sessionStorage` or a cookie.
- [ ] 3.3 Edge Function for the recovery grant (design D3): exchanges the recovery code,
  returns a short-lived single-use grant. Fifteen-minute expiry, matching today's cookie.
- [ ] 3.4 Repoint `updatePassword` at the grant and delete `RECOVERY_COOKIE`. Assert an
  ordinary signed-in session cannot change the password, and that a spent grant is refused.
- [ ] 3.5 Sign-out destroys the query cache, cached images, signed URLs and secure storage —
  and still lands the rider signed out when the revocation call fails offline.
- [ ] 3.6 Test the shared-device case explicitly: rider A signs out, rider B signs in, B sees
  nothing of A, including with the device offline.
- [ ] 3.7 Migrate `/auth/login`, `/auth/signup`, `/auth/forgot-password`,
  `/auth/reset-password` and both onboarding steps. Five of these are already client pages;
  `/auth/reset-password` is the one server page here and imports `next/headers`.

## 4. Screens, one route group at a time (Phase 4)

- [ ] 4.1 Build the four shared loading treatments — deck, list, detail, form (design D7) —
  from existing v2 tokens. One treatment per shape, not per screen.
- [ ] 4.2 Build the shared error and offline treatments, with a retry that re-runs only the
  failed read, and an automatic retry when connectivity returns.
- [ ] 4.3 Postcards: `/postcards`, `/postcards/new`, `/postcards/[id]`. Convert pages and
  components, add states, and migrate `actions/postcards.ts`'s 10 `revalidatePath` calls and
  `actions/comments.ts`'s 3 in the same change, with the old list visible in the diff.
- [ ] 4.4 Rides: `/rides`, `/rides/new`, `/rides/[id]`, `/rides/[id]/crew`, plus
  `actions/rides.ts`'s 5 invalidations.
- [ ] 4.5 Clubs: `/clubs`, `/clubs/explore`, `/clubs/new`, `/clubs/[id]` and its three
  sub-pages, plus `actions/clubs.ts`'s 11 invalidations — the largest single group.
- [ ] 4.6 Profile: `/profile`, plus `actions/profile.ts`'s 5, `actions/blocks.ts`'s 2 and
  `actions/moderation.ts`'s 3.
- [ ] 4.7 Replace the 12 `redirect()` call sites with client navigation, keeping success
  distinguishable from the unsubmitted state — both are `{ error: null }` without it.
- [ ] 4.8 Confirm the invalidation total: every one of the 41 original `revalidatePath` claims
  is either represented by a cache key or recorded as deliberately dropped, with its reason.
- [ ] 4.9 Blocking a rider removes their content from every cached view the blocker holds, not
  only from the next fetch, and does not skip the open card in the deck.
- [ ] 4.10 Foregrounding the app revalidates the visible screen.

## 5. Retire the server render path (Phases 5–6)

- [ ] 5.1 Convert `proxy.ts` to a client route guard, keeping the denylist shape and reading
  `onboarding_completed_at` from the database rather than `user_metadata`.
- [ ] 5.2 Audit that every rule the guard enforces has a database counterpart — Phase 1 is what
  makes this true, which is why this task is late rather than early.
- [ ] 5.3 Delete `src/lib/supabase/server.ts`, `src/app/auth/callback/route.ts` and
  `src/lib/auth/recovery.ts`. Remove `@supabase/ssr`.
- [ ] 5.4 Re-derive the scope counts and confirm zero server pages and zero server components
  remain, matching the first line of each file rather than a bare `git grep`.

## 6. Verification and handoff

- [ ] 6.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`, `npm test`
  all green.
- [ ] 6.2 Load the app against the real database and walk every screen in each of its states —
  the class of defect that produced the `/rides/new/crew` 500 was found this way and by nothing
  else.
- [ ] 6.3 Run the `reviewer` agent before the PR, including its RLS and data-exposure audit.
  Never on its own work.
- [ ] 6.4 Update `CLAUDE.md` (applied-migration range, the render-model section, the removed
  dependency) and prune `docs/HANDOFF.md` as part of landing, not as a follow-up.
- [ ] 6.5 Raise account deletion as its own proposal before Phase 2 of the native work starts —
  it is a store-submission requirement and it is not in this change.
