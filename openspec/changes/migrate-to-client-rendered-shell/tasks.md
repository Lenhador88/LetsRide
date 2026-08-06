## 1. Integrity migrations — `018`+ (Phase 1: additive only, no application change)

Nothing in this group removes a column, table or grant the application reads. That is the
phase's definition, not a description of it — one Supabase project, `main` auto-deploys, so a
removal landing without its code repair is a production outage. The `avatar_url` drop lived here
in an earlier revision and has moved to group 3.

**State, 2026-08-05 — group 1 is finished and fully applied.** `list_migrations` reads **27
rows against 27 files**: zero drift, for the first time in weeks. `021` turned out to be two
migrations, and that split is what made the rest possible.

**`021` contained a deployment deadlock, and splitting it is what resolved the "mutually
incompatible" problem below.** The file held both the accessor functions and the revoke that
makes them necessary, and those must be applied at *different times relative to the code
deploy*:

- New code + old database → `proxy.ts` calls `my_onboarding_state()`, which does not exist →
  `42883` → the guard's fail-closed branch bounces **every signed-in rider** to login.
  Reproduced with `npm run walk`, not argued.
- Old code + new database → the revoke lands and all four paths in §DEFECT 2 break.

So no ordering of one file works. Split:

- **`021_onboarding_state_accessors.sql`** — purely additive, three `security definer`
  functions. Applied *before* the code deployed, safe against `main` as it stood.
- **`025_profile_column_privileges.sql`** — the revoke and the column allowlist. Applied
  *after*, once Vercel reported READY at `3974125`.

Filename order equals apply order in both directions, deliberately: `run.sh` applies by
filename, and a file whose local order differs from its hosted order is a trap this repo has
already sprung once (`021`'s own header documented the `024` case while committing the same
mistake).

**The two mutually-incompatible migrations are now compatible, and the fix is the accessor's
write half.** `023` gated on stamps `021` removed the only client path to setting; the answer is
that the database writes them. `accept_terms()` and `complete_onboarding(location)` are that
path. Both are applied, so the `PENDING` machinery that modelled them as held back is retired
with them.

**One trap worth carrying forward, measured on Postgres 16 rather than recalled.** Inside a
`security definer` function `current_user` is the *owner*, so `003`'s and `012`'s trigger guards
— both of which begin `if current_user <> 'authenticated' then return new` — short-circuit and
do not run. Every invariant those triggers carry had to be restated in the function bodies.
CHECK constraints, by contrast, do still fire.

- **`023` needed the consent prompt deployed first**, which task 2.3 delivered — and the apply
  order honoured it.

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
- [x] 1.8 **Split into two files — see the deadlock note under this heading.**
  `021_onboarding_state_accessors.sql` holds `my_onboarding_state()`,
  `accept_terms()` and `complete_onboarding(location)`, applied *before* the deploy;
  `025_profile_column_privileges.sql` holds the revoke and the allowlist, applied *after*.
  Both verified live. The accessor gained a third output,
  `has_username`, so the route guard keeps one round trip — it reads a column `authenticated`
  may still select, so it widens nothing. Original wording kept below for the diff:
  ~~`021_profile_column_privileges.sql` — `revoke select, insert, update~~
  (terms_accepted_at, onboarding_completed_at) on public.profiles from authenticated`, plus a
  `security definer` accessor returning the caller's own two stamps for the route guard and the
  onboarding resume step (design D6). A view alongside the table does **not** satisfy this:
  `public.profiles` stays published by PostgREST and the grant is what decides.
- [x] 1.9 Assertions split along the same line as the migrations: the functions' behaviour is
  mainline in `rls_test.sql` (they are applied), the `has_column_privilege(...) = false`
  assertions are in `rls_test_pending_025.sql`, and `rls_test_pending_023_025.sql` proves the
  pair applies together. Suite 383 → 460. Original wording:
  ~~Assertions for 1.8: rider B cannot read rider A's `terms_accepted_at` or~~
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
- [x] 1.12 **APPLIED 2026-08-05**, after the consent prompt deployed. Pre-flight re-run at
  apply time: 4 profiles, 3 with NULL consent, 1 not onboarded. Eight triggers live, with
  `may_participate` in `private` where PostgREST cannot publish it.
  **UNBLOCKED — Q11 answered 2026-08-05** — `023_participation_gate.sql`. A rider whose
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
- [x] 1.13 Also in `023`: extend `003`'s completion guard so `onboarding_completed_at` cannot be
  stamped while `terms_accepted_at` is NULL, in the same `check_violation` shape it already uses
  for `username` and `location`.
- [x] 1.14 Also in `023`: close `012`'s recorded BEFORE INSERT gap with a `TG_OP`-guarded arm on
  `enforce_onboarding_completion`, so a `profiles` row inserted without its `auth.users`
  counterpart cannot carry a chosen consent timestamp. `012` §KNOWN LIMIT left this as a
  follow-up because the assertion could not be written against a path `23505` blocks; the
  trigger this group builds is what makes it writable.
- [x] 1.15 Assertions for 1.12–1.14: each of the eight inserts refused while either stamp is
  NULL and accepted once both are set; each of the five omitted tables still accepts an insert;
  the rider's own onboarding `profiles` updates still succeed while NULL, so nobody is stranded
  mid-wizard; completion refused while `terms_accepted_at` is NULL; a fresh `profiles` INSERT
  cannot choose its own consent timestamp.
- [x] 1.16 **All of `018`–`027` applied, in the order the split requires**: additive first
  (`021`, `026`, `027`), then the deploy, then destructive (`023`, `025`). `025`'s footer
  predicts eight values and all eight were confirmed live; `npm run walk` was re-run against
  the post-`025` database and all 8 screens still render. Original wording:
  ~~Apply `018`–`023` / Apply `018`, `019`, `020` and `022` only.~~ Then check the Supabase security advisors
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
- [x] 2.3 Built: `/onboarding/terms`, one screen, no pagination and no skip, writing through
  `accept_terms()` so it survives `025`. `proxy.ts` gates consent **ahead of** the wizard,
  because 1.13 refuses to stamp completion while consent is NULL — a rider sent to step 2
  first would dead-end on a screen that can never succeed. Exercised against the live
  database with a real sign-in: prompt reached, submit disabled until ticked, accepted, and
  the prompt then unreachable.

## 3. Make the data layer isomorphic (Phase 2)

**Done 2026-08-05.** One correction to record, because the plan specified a mechanism that
does not build. 3.1 called for a **runtime** test — server client when there is no `document`.
It cannot work: `lib/supabase/server.ts` imports `next/headers`, Next refuses to bundle that
into a client graph, and a `typeof document` guard plus `await import()` does not help, because
the bundler resolves the import statically whether or not the branch can be taken there.
Measured on Next 16.2.9 / Turbopack: a `'use client'` page importing one read function fails
the build with traces through both `[Client Component Browser]` and `[Client Component SSR]`.

The split is now made where the bundler makes it — the **`react-server` export condition**, via
a `#supabase/data-client` subpath import in `package.json`, with halves `resolve.rsc.ts` and
`resolve.browser.ts`. D1's intent and every alternative it rules out are unchanged; only the
discriminator moved from runtime to build time, which is strictly better: `next/headers` never
enters the browser bundle at all rather than sitting behind a dead branch. Verified by chunk
inspection — every server chunk resolves `resolve.rsc.ts`, the one client-SSR chunk resolves
`resolve.browser.ts`, and `.next/static` contains zero references to `next/headers`.

- [x] 3.1 Introduce a single **environment-aware** Supabase client accessor the 19
  `src/lib/data/` functions resolve at call time: server client when there is no `document`,
  browser client when there is (design D1). No signature changes. The server branch survives
  until group 6 — 18 server pages and 26 server components still call this layer throughout.
  **Shipped as the `react-server` condition rather than the `document` test — see above.**
- [x] 3.2 Convert all 19 read functions to it. Verify no signature moved:
  `git grep -n '^export async function' -- 'src/lib/data/*.ts'` matches the list in design.md.
  **Verified by diffing that command's output across the change: 19 functions, names and
  signatures identical, only line numbers moved where a type alias was deleted.**
- [x] 3.3 Add a unit test asserting the data layer works under both branches, alongside the
  existing `use-server-exports` test — the same class of failure that shipped `/postcards/new`
  dead, and the exact failure an earlier revision of this plan would have shipped.
  **`src/lib/data/__tests__/isomorphic.test.ts`, 17 assertions.** It walks the local module
  graph from every `lib/data/` module and fails if any of them reaches `next/headers`; asserts
  the conditional mapping's shape and that nothing bypasses it; and imports both halves to
  prove each is the one it claims. Negative-controlled — re-introducing the server import into
  `lib/data/profile.ts` fails exactly that module's case.

  **It also pins the one mistake no static gate can catch.** Moving the split from a build-time
  error to a runtime condition made a client component reading *during render* legal to compile,
  where it used to fail `next build`. `resolve.browser.ts` now throws a named error when there is
  no `document`, which puts the loudness back: static prerendering runs the SSR pass, so a page
  that reads during render fails the build with the message rather than failing closed at RLS in
  production. Verified by building exactly that page.
- [x] 3.4 **One unit, one PR:** `024_drop_legacy_avatar_url.sql` dropping `profiles.avatar_url`
  and `clubs.avatar_url`, *together with* the `PUBLIC_PROFILE_COLUMNS` edit at
  `src/lib/data/columns.ts` and the `resolveAvatarUrls` fallback removal. Re-run the census
  first — 0 non-NULL as of 2026-08-05 — and stop rather than migrate values silently if it has
  changed. **Census re-run at write time: `profiles` 4 rows / 0 non-NULL, `clubs` 2 rows / 0
  non-NULL.**

  **This task's repair list was six query sites short, and the missing six were a latent bug.**
  It named `PUBLIC_PROFILE_COLUMNS` and `resolveAvatarUrls`. Three club embeds in `rides.ts`,
  two in `postcards.ts` and one hand-spelled profile select in `rides.ts` named `avatar_url`
  directly, reachable through neither.

  **Three of those five club sites draw an image; two draw text.** `RideCard` and `PostcardCard`
  render the club as a text chip, so `getRides` and the postcard deck embed `id, name` and sign
  nothing — a first pass had the rides list selecting and signing an image nothing renders, which
  review caught. The three that do draw one — the ride-detail chip, the ride filter tiles, the
  postcard filter tiles — take `CLUB_EMBED_COLUMNS` plus a `resolveAvatarUrls` pass.
  `clubs.avatar_url` was NULL on every row and always had been, so those three could only ever
  draw initials, while `/clubs/new` (016) had been uploading to `avatar_path` and only the Clubs
  screens signed it. **Latent rather than live**: 0 clubs and 0 riders have any `avatar_path`
  either, so nothing has yet rendered differently — the defect was reading a column that could
  never hold a value.
- [x] 3.5 Assertions for 3.4: the columns are absent from `information_schema.columns`, and a
  rider still cannot write any image reference outside their own Storage folder. **13 new
  assertions, suite 370 → 383.** Mutation-tested: three name-preserving mutations of the
  constraints and policies each fail exactly one new assertion and nothing pre-existing.
- [x] 3.6 Extend the Vitest suite to cover `src/lib/data/` for the first time — currently
  uncovered, and this group changes every function in it. **`media.test.ts` (11) and
  `columns.test.ts` (46).** `media.ts` first because every screen depends on it and none fail
  loudly when it is wrong — a missed signing pass renders initials, which is a state the design
  draws deliberately elsewhere, so the bug reads as a design choice. `columns.test.ts` scans
  every select in `lib/data/`, `lib/actions/` **and `proxy.ts`** for a dropped column — the guard
  that would have caught all six sites in 3.4. Both are negative-controlled, and the select
  matcher skips comments between `(` and the literal, because review defeated an earlier version
  with `.select(\n  // comment\n  'id, avatar_url')` — this repo's house style, not an exotic case.

### Two things this group found that the plan did not predict

- **`021` would have aborted on apply, and no local suite could have shown it.** Its §1 SELECT
  grant list named `avatar_url`. `run.sh` applies by filename, so locally `021` lands *before*
  `024` and the column is still there; against the hosted project it lands *after*, where
  `grant select (avatar_url)` raises `42703` and takes the whole migration down mid-deploy.
  Removed from the list — required under every reading of `021`'s open shape question, since a
  column that does not exist cannot be granted either way. Proven both directions against a
  scratch database in the real hosted order: the old list aborts with `42703`, the new one
  applies cleanly.
- **The code change is backward-compatible, so `024` did not land in the same instant.** Every
  changed select was probed against the live schema *before* `024` — PostgREST returns `42703`
  for a column that does not exist and `42501` for one the role cannot read, so the two are
  distinguishable without a session, and all seven came back `42501`. The order was therefore
  **merge and deploy the code, then apply `024`** — same PR, with no window in which either half
  is alone. Applying `024` first would have been an immediate outage on `main`. Done
  2026-08-05: PR #52 merged, deployment `READY` at `b60618a`, then the drop; `list_migrations`
  now returns 22 rows ending `drop_legacy_avatar_url` against 24 files, the two missing being
  `021` and `023`.

## 4. Session, auth and the recovery grant (Phase 3)

- [ ] 4.1 Build the storage adapter: secure store in the native shell, an explicitly-labelled
  weaker store in a plain browser. Construct `@supabase/supabase-js` with it. Keep it behind a
  flag — cookie sessions stay live until the guard moves in 5.1, because `proxy.ts` reads
  `request.cookies` and a half-moved session redirects every request to login.
- [ ] 4.2 Assert no session, access token or refresh token is reachable from `localStorage`,
  `sessionStorage` or a cookie.
- [x] 4.3 **D3's mechanism is unbuildable and the replacement is better — see
  `026_password_reset_grant.sql` §1.** `@supabase/ssr` 0.12.4 hardcodes PKCE, so
  `resetPasswordForEmail` keeps the `code_verifier` in the *client's* own storage and
  `exchangeCodeForSession` requires it back; no Edge Function can hold it. What D3 wanted
  was a proof the client cannot forge, and one already exists: the project mints ES256
  tokens and GoTrue records `amr: [{method: "recovery"}]`. PostgREST verifies the
  signature and puts the payload in `auth.jwt()`, so the check is SQL — no secret, no
  service-role key, no function to deploy. **Applied 2026-08-05.** Original wording:
  ~~Edge Function for the recovery grant (design D3): exchanges the recovery code,~~
  returns a short-lived single-use grant. Fifteen-minute expiry, matching today's cookie.
- [x] 4.4 Done — `updatePassword` consumes the grant *before* the update, so it is spent
  whatever happens next and two racing submits cannot both win. `RECOVERY_COOKIE` is gone.
  **Recorded limit, not a gap left silent:** this gates the app's front door exactly as the
  cookie did, not GoTrue's `PUT /auth/v1/user`, which any session holder can call with the
  publishable key. Closing that is the `UpdatePasswordRequireCurrentPassword` project
  setting — an **owner action**, named in `026`'s header. Original wording:
  ~~Repoint `updatePassword` at the grant and delete `RECOVERY_COOKIE`. Assert an~~
  ordinary signed-in session cannot change the password, and that a spent grant is refused.
- [ ] 4.5 Sign-out destroys the query cache, cached images, signed URLs and secure storage —
  and still lands the rider signed out when the revocation call fails offline.
- [ ] 4.6 Test the shared-device case explicitly: rider A signs out, rider B signs in, B sees
  nothing of A, including with the device offline.
- [x] 4.7 `/auth/reset-password` is now a client page — it was the group's only server page,
  and only because it read the httpOnly cookie, so 4.3 and this were one piece of work as
  predicted. The other five were already client pages. Original wording:
  ~~Migrate `/auth/login`, `/auth/signup`, `/auth/forgot-password`,~~
  `/auth/reset-password` and both onboarding steps. Five are already client pages;
  `/auth/reset-password` is the one server page here and imports `next/headers`.

## 5. Screens, one route group at a time (Phase 4)

- [ ] 5.1 Convert `proxy.ts` to a client route guard **with the first route group**, not later:
  the cookie/device-storage split cannot straddle a merge. Keep the denylist shape, and read the
  onboarding stamp through 1.8's accessor rather than `user_metadata`.
- [x] 5.2 Built and unit-tested, but **not yet wired to any screen** — the conversion is a
  later change. `Skeleton.tsx` plus deck/list/detail/form shapes. Original:
  ~~Build the four shared loading treatments~~ — deck, list, detail, form (design D7) —
  from existing v2 tokens. One treatment per shape, not per screen.
- [x] 5.3 Built and unit-tested, **not yet wired**. `ErrorState`, `OfflineState`,
  `useOnlineStatus`. Original:
  ~~Build the shared error and offline treatments~~, with a retry that re-runs only the
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
- [ ] 5.9 Confirm the invalidation total: every one of the **33** original `revalidatePath`
  claims
  **(not 41 — that is `git grep -c`, which counts the 8 `import` lines too. The anchored form
  is `git grep -o "revalidatePath(" -- 'src/lib/actions/*.ts' | wc -l`. Same counting trap
  CLAUDE.md documents three times over, reproduced by this plan and by `design.md` and
  `docs/HANDOFF.md`.)** — every one of them
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
- [x] 7.5 Raised as `openspec/changes/add-account-deletion/` — proposal, design, tasks and
  four delta specs. Original:
  ~~Raise account deletion~~ as its own proposal before Phase 2 of the native work starts —
  it is a store-submission requirement, it is not in this change, and 1.14 assumes it will exist.
