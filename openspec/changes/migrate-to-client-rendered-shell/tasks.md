## 1. Integrity migrations — `018`+ (Phase 1: additive only, no application change)

Nothing in this group removes a column, table or grant the application reads. That is the
phase's definition, not a description of it — one Supabase project, `main` auto-deploys, so a
removal landing without its code repair is a production outage. The `avatar_url` drop lived here
in an earlier revision and has moved to group 3.

**State, 2026-08-05 — and two tasks below fail that definition, which is why they did not
ship.** `018`, `019`, `020` and `022` are written, asserted and **applied**; their boxes are
ticked. `021` (task 1.8) and `023` (tasks 1.12–1.14) are **written and deliberately unapplied**,
with their assertions in `rls_test_pending_021.sql` and `rls_test_pending_023.sql` and both
listed in `SKIP_MIGRATIONS`. Their boxes stay open because the work is not landed.

- **`021` is not additive.** It revokes grants `proxy.ts`, `setLocation`, `signUp` and
  `getMyProfile` all depend on, so it breaks four live paths and belongs in the group that owns
  that code — the same reason the `avatar_url` drop left. The heading's rule caught it; the task
  predates the rule.
- **`023` needs an application change first** — the consent prompt in group 2 — because all four
  riders have a NULL consent stamp and the gate would lock every one of them out.
- **They are also mutually incompatible**: `023` gates on stamps `021` removes the only client
  path to setting. There is deliberately no test mode that applies both.

- [x] 1.1 Pre-flight every constraint below against the live project: count violating rows for
  each column before writing its migration, the way `013` did. Record each count in the
  migration header. A non-zero count means `NOT VALID` plus a separate validate, not a
  loosened rule. Two are already measured — see 1.10 and 1.12.
- [x] 1.2 `018_text_bounds.sql` — CHECK constraints matching the Zod schemas exactly for
  `profiles.bio` (≤500), `profiles.bike_model` (≤60), `profiles.location` (1–100),
  `clubs.name` (1–60), `clubs.description` (≤500), `rides.title` (1–80),
  `rides.description` (≤500), `rides.meeting_point` (1–120), `rides.route_description`
  (≤1000), `rides.max_riders` (1–999). Trimmed floor, raw ceiling, matching
  `postcard_comments_body_length`. NULL stays permitted on every optional column.
- [x] 1.3 Add `supabase/tests/rls_test.sql` assertions for 1.2: one rejection per bound, plus
  one acceptance at the boundary value, plus NULL accepted on each optional column.
- [x] 1.4 `019_club_member_role.sql` — a rider may only insert a `club_members` row with
  `role = 'member'`, unless they are the club's `owner_id`, in which case `'owner'` is
  permitted. A `WITH CHECK` addition to the existing INSERT policy, so the rule sits beside the
  one it qualifies.
- [x] 1.5 Assertions for 1.4: non-member inserting `role='admin'` into a public club is
  refused; same with `role='owner'`; the club owner's own `'owner'` row succeeds; an ordinary
  join still succeeds with the default; **and** an UPDATE of `role` by the club owner is
  refused, pinning the recorded absence of an UPDATE policy.
- [x] 1.6 `020_profile_countries_known_code.sql` — country code must be an assigned ISO 3166-1
  alpha-2 value, not merely two uppercase letters. No `countries` reference table: `014`
  declined one deliberately and nothing joins against it.
- [x] 1.7 Assertions for 1.6: `ZZ` and `XX` refused, `NL` accepted, lowercase still refused.
- [ ] 1.8 `021_profile_column_privileges.sql` — `revoke select, insert, update
  (terms_accepted_at, onboarding_completed_at) on public.profiles from authenticated`, plus a
  `security definer` accessor returning the caller's own two stamps for the route guard and the
  onboarding resume step (design D6). A view alongside the table does **not** satisfy this:
  `public.profiles` stays published by PostgREST and the grant is what decides.
- [ ] 1.9 Assertions for 1.8: rider B cannot read rider A's `terms_accepted_at` or
  `onboarding_completed_at` by any path including a direct column select; rider A reads their
  own through the accessor; a blocked rider still gets zero rows; `has_column_privilege` for
  `authenticated` is false on both columns, scoped to that grantee rather than counted
  table-wide — the mistake `015`'s footer made and documented.
- [x] 1.10 `022_private_club_rides.sql` — a ride whose `club_id` names a private club may not
  have `is_public = true`, on INSERT and UPDATE, and a club turning private takes its rides with
  it. **Pre-flight measured 2026-08-05: 3 rides, 0 club rides, 0 private clubs, 0 violating
  rows** — it adds cleanly today, and `/rides/new` began offering `club_id` on 2026-08-05, so
  the free window is short. Re-run the count at apply time.
- [x] 1.11 Assertions for 1.10, one per role, matching the spec's enumeration: organizer,
  club member, non-member on a clubless public ride, non-member on a private club's ride
  (zero rows, and its crew unreachable through `ride_members`), blocked rider, signed-out
  visitor.
- [ ] 1.12 **UNBLOCKED — Q11 answered 2026-08-05** — `023_participation_gate.sql`. A rider whose
  `onboarding_completed_at` is NULL, or whose `terms_accepted_at` is NULL, may not insert into
  `postcards`, `clubs`, `rides`, `club_members`, `ride_members`, `postcard_comments`,
  `postcard_likes` or `postcard_reports`. One `BEFORE INSERT` trigger per table calling a single
  `security definer` helper. The five deliberate omissions — `blocks`, `postcard_hides`,
  `feed_reads`, `profile_countries`, `profiles` — are named in the migration header with their
  reason, not left as silence.

  **Q11's answer, and the constraint it puts on this task: no backfill.** All 4 riders have NULL
  consent, but the population does not need a rollout — 2 are `.test` fixtures already marked for
  deletion before launch, 1 is an abandoned signup that never onboarded, and 1 is the product
  owner, who re-accepts. **A minimal consent prompt for a rider whose stamp is NULL must exist
  before this gate becomes blocking** — it has exactly one user, so build it as one screen, not a
  flow. No migration may write a consent timestamp on a rider's behalf.
- [ ] 1.13 Also in `023`: extend `003`'s completion guard so `onboarding_completed_at` cannot be
  stamped while `terms_accepted_at` is NULL, in the same `check_violation` shape it already uses
  for `username` and `location`.
- [ ] 1.14 Also in `023`: close `012`'s recorded BEFORE INSERT gap with a `TG_OP`-guarded arm on
  `enforce_onboarding_completion`, so a `profiles` row inserted without its `auth.users`
  counterpart cannot carry a chosen consent timestamp. `012` §KNOWN LIMIT left this as a
  follow-up because the assertion could not be written against a path `23505` blocks; the
  trigger this group builds is what makes it writable.
- [ ] 1.15 Assertions for 1.12–1.14: each of the eight inserts refused while either stamp is
  NULL and accepted once both are set; each of the five omitted tables still accepts an insert;
  the rider's own onboarding `profiles` updates still succeed while NULL, so nobody is stranded
  mid-wizard; completion refused while `terms_accepted_at` is NULL; a fresh `profiles` INSERT
  cannot choose its own consent timestamp.
- [x] 1.16 ~~Apply `018`–`023`~~ **Apply `018`, `019`, `020` and `022` only** — see the state
  note under this heading; applying `021` or `023` today is an outage, not a step. Done
  2026-08-05. Then check the Supabase security advisors
  and confirm the only findings are the two known ones (`moderate_comment` by design, the
  leaked-password toggle) plus, if it appears, the new own-row accessor — which is narrower than
  `moderate_comment` and expected. `npm test` green before any of this is called done.

## 2. Consent rollout (Phase 1b — a product decision, not a build task)

- [x] 2.1 ~~**Q11 — product owner.**~~ **Answered 2026-08-05. No backfill; the gate ships.** The
  population needs no rollout: of 4 accounts, 2 are `.test` fixtures already marked for deletion
  before launch, 1 is an abandoned signup that never onboarded, and 1 is the product owner, who
  re-accepts. A fabricated consent record is worse than a missing one.
- [x] 2.2 ~~**Q12 — engineering.**~~ **Answered 2026-08-05: provenance, not a broken write.** The
  owner predates `003_onboarding` by two days; `duskrider` and `qa-verify` were SQL-inserted and
  never went through `signUp`; the fourth row matches `signUp`'s own documented consent-failure
  path exactly (no consent, no username, no onboarding, no sign-in). See `design.md` §Q12.
  **The finding this surfaced is larger than the question:** no rider has ever completed the
  current signup flow on this database, so the one path every rider takes is unproven end to end.
  It needs an email domain the owner controls — `.test` is rejected by Supabase's validator,
  which is why both fixtures were SQL-inserted in the first place. Owner to exercise before the
  client owns signup in Phase 4.
- [ ] 2.3 Build whatever 2.1 decides, before 1.12 lands.

## 3. Make the data layer isomorphic (Phase 2)

- [ ] 3.1 Introduce a single **environment-aware** Supabase client accessor the 19
  `src/lib/data/` functions resolve at call time: server client when there is no `document`,
  browser client when there is (design D1). No signature changes. The server branch survives
  until group 6 — 18 server pages and 26 server components still call this layer throughout.
- [ ] 3.2 Convert all 19 read functions to it. Verify no signature moved:
  `git grep -n '^export async function' -- 'src/lib/data/*.ts'` matches the list in design.md.
- [ ] 3.3 Add a unit test asserting the data layer works under both branches, alongside the
  existing `use-server-exports` test — the same class of failure that shipped `/postcards/new`
  dead, and the exact failure an earlier revision of this plan would have shipped.
- [ ] 3.4 **One unit, one PR:** `024_drop_legacy_avatar_url.sql` dropping `profiles.avatar_url`
  and `clubs.avatar_url`, *together with* the `PUBLIC_PROFILE_COLUMNS` edit at
  `src/lib/data/columns.ts` and the `resolveAvatarUrls` fallback removal. The constant is
  interpolated into 14 query sites across five `lib/data/` files; the migration alone returns
  `42703`, `unwrap` throws by design, and every authenticated screen hits the error boundary on
  a production database. Re-run the census first — 0 non-NULL as of 2026-08-05 — and stop rather
  than migrate values silently if it has changed.
- [ ] 3.5 Assertions for 3.4: the columns are absent from `information_schema.columns`, and a
  rider still cannot write any image reference outside their own Storage folder.
- [ ] 3.6 Extend the Vitest suite to cover `src/lib/data/` for the first time — currently
  uncovered, and this group changes every function in it.

## 4. Session, auth and the recovery grant (Phase 3)

- [ ] 4.1 Build the storage adapter: secure store in the native shell, an explicitly-labelled
  weaker store in a plain browser. Construct `@supabase/supabase-js` with it. Keep it behind a
  flag — cookie sessions stay live until the guard moves in 5.1, because `proxy.ts` reads
  `request.cookies` and a half-moved session redirects every request to login.
- [ ] 4.2 Assert no session, access token or refresh token is reachable from `localStorage`,
  `sessionStorage` or a cookie.
- [ ] 4.3 Edge Function for the recovery grant (design D3): exchanges the recovery code,
  returns a short-lived single-use grant. Fifteen-minute expiry, matching today's cookie.
- [ ] 4.4 Repoint `updatePassword` at the grant and delete `RECOVERY_COOKIE`. Assert an
  ordinary signed-in session cannot change the password, and that a spent grant is refused.
- [ ] 4.5 Sign-out destroys the query cache, cached images, signed URLs and secure storage —
  and still lands the rider signed out when the revocation call fails offline.
- [ ] 4.6 Test the shared-device case explicitly: rider A signs out, rider B signs in, B sees
  nothing of A, including with the device offline.
- [ ] 4.7 Migrate `/auth/login`, `/auth/signup`, `/auth/forgot-password`,
  `/auth/reset-password` and both onboarding steps. Five are already client pages;
  `/auth/reset-password` is the one server page here and imports `next/headers`.

## 5. Screens, one route group at a time (Phase 4)

- [ ] 5.1 Convert `proxy.ts` to a client route guard **with the first route group**, not later:
  the cookie/device-storage split cannot straddle a merge. Keep the denylist shape, and read the
  onboarding stamp through 1.8's accessor rather than `user_metadata`.
- [ ] 5.2 Build the four shared loading treatments — deck, list, detail, form (design D7) —
  from existing v2 tokens. One treatment per shape, not per screen.
- [ ] 5.3 Build the shared error and offline treatments, with a retry that re-runs only the
  failed read, and an automatic retry when connectivity returns.
- [ ] 5.4 Postcards: `/postcards`, `/postcards/new`, `/postcards/[id]`. Pages, components,
  states, and `actions/postcards.ts`'s 10 `revalidatePath` calls plus `actions/comments.ts`'s 3,
  in one change with the old list visible in the diff.
- [ ] 5.5 Rides: `/rides`, `/rides/new`, `/rides/[id]`, `/rides/[id]/crew`, plus
  `actions/rides.ts`'s 5 invalidations.
- [ ] 5.6 Clubs: `/clubs`, `/clubs/explore`, `/clubs/new`, `/clubs/[id]` and its three
  sub-pages, plus `actions/clubs.ts`'s 11 invalidations — the largest single group.
- [ ] 5.7 Profile: `/profile`, plus `actions/profile.ts`'s 5, `actions/blocks.ts`'s 2 and
  `actions/moderation.ts`'s 3.
- [ ] 5.8 Replace the 12 `redirect()` call sites with client navigation, keeping success
  distinguishable from the unsubmitted state — both are `{ error: null }` without it.
- [ ] 5.9 Confirm the invalidation total: every one of the 41 original `revalidatePath` claims
  is either represented by a cache key or recorded as deliberately dropped, with its reason.
- [ ] 5.10 Blocking a rider removes their content from every cached view the blocker holds, not
  only from the next fetch, and does not skip the open card in the deck. The club itself stays
  visible — `clubs` carries no block predicate by decision.
- [ ] 5.11 Foregrounding the app revalidates the visible screen.

## 6. Retire the server render path (Phases 5–6)

- [ ] 6.1 Audit that every rule the guard enforces has a database counterpart — group 1 is what
  makes this true, which is why this is late rather than early.
- [ ] 6.2 Delete `src/lib/supabase/server.ts`, the accessor's server branch,
  `src/app/auth/callback/route.ts` and `src/lib/auth/recovery.ts`. Remove `@supabase/ssr`.
- [ ] 6.3 Re-derive the scope counts and confirm zero server pages and zero server components
  remain, matching the first line of each file rather than a bare `git grep`.

## 7. Verification and handoff

- [ ] 7.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`, `npm test`
  all green.
- [ ] 7.2 Load the app against the real database and walk every screen in each of its states —
  the class of defect that produced the `/rides/new/crew` 500 was found this way and by nothing
  else.
- [ ] 7.3 Run the `reviewer` agent before the PR, including its RLS and data-exposure audit.
  Never on its own work.
- [ ] 7.4 Update `CLAUDE.md`'s render-model section and its dependency list, and prune
  `docs/HANDOFF.md` as part of landing. **Not** the applied-migration range or the three handoff
  contradictions — both were corrected while this proposal was being written.
- [ ] 7.5 Raise account deletion as its own proposal before Phase 2 of the native work starts —
  it is a store-submission requirement, it is not in this change, and 1.14 assumes it will exist.
