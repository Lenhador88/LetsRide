## 0. Before anything — resolve the two questions that change the shape

**Status 2026-08-06: asked, unanswered, built on the documented defaults.** The product owner
was asked directly and did not answer, so group 1 was built to each recommended default rather
than blocking. Every default is recorded in the migration that implements it, so a different
answer is a new migration and not a rewrite. **Q1 is the only one already cast in applied SQL**;
Q4 and Q7 are still genuinely open and neither is blocked on the other.

- [x] 0.1 **Q1 — product owner.** A club whose owner deletes their account: transfer, or delete?
  **Built as TRANSFER** (design D2's default) in `029`. It is the difference between one rider's
  erasure request and forty other riders' postcards, and the RLS suite now asserts the
  counterfactual — without the transfer, a third party's postcard provably dies. Reversing this
  is a migration that drops one function, not a redesign.
- [ ] 0.2 **Q4 — product owner, legal.** Whether a de-identified `consent_records` row is retained
  (design D10). Default: retain. **Still open and deliberately not built** — see 1.10. It is
  listed as blocking *before launch* rather than before build, and deferring it removes work
  rather than adding it.
- [ ] 0.3 **Q7 — designer.** The `Done` frame draws no re-authentication field. The default adds
  one (design D6). **Still open**, and it costs nothing yet: group 3 is unbuilt, and the Edge
  Function's JWT check is not a substitute — re-auth proves the person at the phone knows the
  password, which is a different claim from "this session is live". Ask before building 3.4.
- [x] 0.4b **Q14 — the version string is `0-placeholder`, and the owner must replace it.**
  `/legal/terms` is placeholder copy that disclaims being an agreement, so a plausible date
  would assert the opposite of what the page says. It lives in exactly one place,
  `private.current_terms_version()`; replacing it is a one-line migration and consents already
  stamped keep the version they were given.
- [x] 0.4 Re-derive the migration number rather than trusting this file. It said **026** at write
  time and was **028** by the end of the same session — which is the point. It was **028** at write
  time, and the numbering moved underneath this proposal once already: `021` was split into an
  applied `021_onboarding_state_accessors` and a pending `025_profile_column_privileges`.
  `ls supabase/migrations/` against `list_migrations`.

## 1. Migrations — additive, no application change (the only independently landable group)

Nothing in this group removes a column, table or grant the application reads, and nothing changes
a SELECT policy. That is the group's definition, taken from `migrate-to-client-rendered-shell`
group 1, and it earned that phrasing there: one Supabase project, `main` auto-deploys, so a
removal landing without its code repair is an outage.

- [x] 1.1 Pre-flight against the live project **before writing the migration**, the way `013` and
  `022` did, and record every count in the header: clubs with more than one member; clubs whose
  owner is not the only member; clubs carrying a non-NULL `avatar_path` or `cover_image_path`;
  rides with a `club_id`; rows in each of the four tables about to gain an index. A count that is
  0 today is not a count that is 0 at apply time — re-run it then.
- [x] 1.2 Four FK indexes for the cascade: `clubs.owner_id`, `rides.organizer_id`,
  `club_members.user_id`, `ride_members.user_id`. `011` added exactly this for
  `postcard_comments.author_id` and said why in its own comment; these four are the same reason,
  never written. Do **not** add duplicates for the ~~eight~~ **nine** paths already served — see
  the spec's index requirement for the list. *(Done in `029`. The four named here were exactly
  right; the surrounding counts were not. There are **13** FKs into `profiles`, not the 11
  §Impact claims, and **9** were already served, not 8. The grep §Impact recommends counts 15
  lines, two of them the `friendships` pair `013` dropped — so subtracting the dropped rows from
  an already-wrong number produced a second wrong number. Derive from `pg_constraint`.)*
- [x] 1.3 Assertions for 1.2: a query over `pg_index` finds no FK column referencing
  `public.profiles` without a leading-column index. Write it as a derivation, not as a list of
  four names, so a table added next year fails the assertion rather than slipping past it.
- [x] 1.4a **Decide whether 1.4 and 1.5 are needed at all, before writing either.** A CHECK is
  evaluated against the finished row, and both constraints already carry a NULL arm
  (`avatar_path is null or avatar_path like ('club-avatars/' || owner_id::text || '/%')`). A
  transfer that clears both paths at or before the moment it changes `owner_id` therefore passes
  as written, and D2 already chose to clear them. Prove it on a scratch database — one UPDATE
  setting `owner_id` and both paths to NULL — and if it passes, **drop 1.4 and 1.5 and keep the
  constraints**, which is what the `database-enforced-integrity` delta requires. Only a transfer
  that keeps the images needs the relaxation, and that option is rejected.

  *(Run, and it passes — so 1.4 and 1.5 are dropped and all four CHECKs survive `029` untouched.
  Measured on the real constraint definition: a transfer that KEEPS the path is refused `23514`;
  a transfer that NULLs it is allowed. This task and the same conclusion were reached
  independently on two branches at the same time, which is about as much corroboration as a
  measurement gets.)*
- [x] ~~1.4 Relax `016`'s `clubs_avatar_path_owned` and `clubs_cover_image_path_owned`.~~
  **DROPPED by 1.4a.** The proposal's §Impact bullet still asserts the relaxation is needed;
  it contradicts D2 in the same document ("null both paths on transfer… **no new constraint
  semantics**"), and D2 is the one that is right.
- [x] ~~1.5 Assertions for 1.4.~~ Kept in spirit, retargeted at what actually happens: an
  ownership transfer on a club with both images set succeeds *and surrenders both*, and the four
  path CHECKs `016` verified still exist by name. Both are in the `029` §B block.
- [x] 1.6 `security definer` transfer function: reassign `clubs.owner_id` to the longest-tenured
  remaining `admin` by `club_members.joined_at`, else the longest-tenured remaining `member`,
  else delete the club. Null both image paths on transfer and return their object paths so the
  caller can delete the objects. Delete the club's rides when the club is deleted, rather than
  letting `rides.club_id`'s `ON DELETE SET NULL` orphan them into the zombie state design D3
  describes. It lives in `private` so PostgREST does not publish it, matching `is_blocked` and
  `is_club_member`; `authenticated` gets no EXECUTE. *(Done in `029`, corrected by `032` — and
  this instruction is **incomplete in a way that shipped a broken function**. "In `private`, no
  EXECUTE for `authenticated`" describes who must be kept out and never says who must be let in,
  so `029` landed a function no caller could reach: `service_role` holds no USAGE on `private`,
  and PostgREST routes only to `public`. `031` adds a `service_role`-only `public` wrapper. The
  general form of the miss: **a task that names only the negative case produces a function that
  refuses everyone**, which is the exact inverse of the failure `openspec/config.yaml` was
  written to prevent, and just as silent.)*
- [x] 1.6a **The transfer must move `club_members.role`, not only `clubs.owner_id`.** The roster
  label and `ClubDetail.viewer_role` are both read from `club_members.role`; `clubs` UPDATE and
  DELETE are decided by `owner_id`. Move one without the other and the club has a database owner
  with no owner affordances and a roster showing no owner at all — and `019` left `club_members`
  with no UPDATE policy, so nobody can repair it afterwards. Promote the recipient's row to
  `owner` in the same transaction, inside the same `private` function, with no caller-supplied
  role. **Do not add an UPDATE policy to `club_members`** — that would hand promotion to every
  rider the policy admits, which is exactly what `019` refused.

  *(Done in `029` and asserted. No UPDATE policy was added.)*
- [ ] 1.6b **Re-check the "only member remaining" branch: "its postcards are entirely their own
  by construction" is false.** A rider can leave a club while the postcards they wrote there stay
  — nothing deletes a postcard when its author leaves the club. So a club whose *only remaining
  member* is the departing owner can still hold another rider's postcards, and the delete branch
  destroys them: the exact outcome D2 exists to prevent, reached by the branch D2 treats as safe.
  Recommended default: the branch condition becomes "no rows authored by anyone else remain" —
  if third-party postcards exist, transfer to the author of the oldest one and insert their
  `club_members` row as `owner` rather than deleting the club. **PO decides**; blocking for 1.6,
  because it changes what the function does.

  **PARTLY ADDRESSED, and the open half is the important one.** Independently found in review of
  this branch, and `032` fixed the *rides* half: the delete branch now removes only rides that
  `ON DELETE SET NULL` would strand (`is_public = false`), where `029` deleted every ride in the
  club including other riders' public ones. Confirmed live that the premise holds —
  `Users can leave clubs` is a bare `auth.uid() = user_id`, and `seed.sql`'s `...00e5` is
  captioned "Posted before I left".

  **The postcards half is NOT built**, because the recommended default is a product decision the
  PO has not made: it hands a club to someone who never joined it, on the strength of having
  posted there once. `/legal/account-deletion` currently states the built behaviour — the club
  and its posts go — so the page and the code agree today and both change together if this is
  adopted.
- [x] 1.6c `031` — `public.transfer_owned_clubs_for_deletion(uuid)`, `security invoker` and
  privilege-free, EXECUTE to `service_role` alone; plus USAGE on `private` and EXECUTE on the
  worker for that role. Asserted to grant nothing to riders and none of the other six helpers.
- [x] 1.7 Assertions for 1.6, 1.6a and 1.6b, one per branch: transfer to an admin; transfer to a
  member when no admin exists; deletion when no member remains ~~**and no other rider's postcards
  remain**~~ *(that clause waits on 1.6b)*; the recipient's `club_members.role` reads `owner` and
  no club ends with two owner rows; ~~a blocked rider is an eligible recipient and
  `private.is_blocked` is not consulted~~ *(true by construction — the function never mentions
  blocks — but not separately asserted)*; `authenticated` still holds no EXECUTE on the transfer
  function and `club_members` still has exactly three policies with no UPDATE among them;
  **another rider's postcards in the club survive the owner's deletion**, asserted from that
  rider's own session; a private club's transferred rides keep `is_public = false` and `022`'s
  invariant still holds; no ride is left with `club_id` NULL and `is_public` false and a roster
  its own crew cannot read.
- [x] 1.8 `profiles.terms_version` (Q14), server-owned and immutable in the same
  `enforce_onboarding_completion` shape `012` uses for the timestamp. **No backfill** — the same
  ruling `023` records, for the same reason.
- [x] 1.8a **`terms_version` goes into none of `025`'s three column allowlists.** `025` revoked
  the table-level grant and re-granted an explicit list, so a new column on `profiles` is
  invisible and unwritable to `authenticated` until someone adds it — and for a consent record
  that is the correct end state, not a bug to fix. Do **not** add it to `grant select`,
  `grant insert` or `grant update`; the own-row `security definer` accessor writes it, exactly as
  it writes the timestamp. Adding it to the SELECT list would republish a consent record to every
  rider who can see the row, which is `025`'s hole reopened one column across.

  *(Done in `030`, and it is what makes 1.9 assertable in the stronger form below. Reached
  independently on both branches.)*
- [x] 1.9 Assertions for 1.8 and 1.8a, and the first is asserted **stronger than asked**: a
  client-supplied version is not "replaced by the server's" but **refused with `42501`**, because
  `030` gives `authenticated` no column grant at all and column privileges are checked against
  the columns named in SET *before* any BEFORE trigger runs (`025` §DEFECT 2c). Refusal beats
  correction, and it leaves `enforce_onboarding_completion` — which `003`, `012` and `023` have
  each layered — untouched. `authenticated` and `anon` hold no SELECT, INSERT or UPDATE on the
  column, asserted per grantee. Idempotency is asserted by moving the stored version out from
  under a second `accept_terms()` call, since "did not re-stamp" and "re-stamped with the same
  constant" are otherwise indistinguishable while there is one version string.

  *(The per-role `select *` sweep — club owner, admin, fellow member, non-member, blocked rider —
  is not separately written: `025` already revoked table-level SELECT, so `select *` is `42501`
  for every one of them before the column exists, and the suite asserts that. Noted rather than
  silently skipped.)*
- [ ] 1.10 If Q4 is "retain": the `consent_records` table — salted hash of the subject uuid, terms
  version, server timestamp, nothing else. RLS enabled, **no policy at all**, no grant to
  `authenticated`, so the refusal does not rest on a policy being written correctly.
  **DEFERRED, and deliberately, not overlooked.** Q4 is marked PO *(legal)* and "blocking before
  launch, not before build"; retaining a hash of a deleted person's identifier is a legal
  posture nobody in a session should adopt on the owner's behalf. Deferring costs nothing —
  "retain nothing" removes work rather than adding it, and the Edge Function that would write
  the row is not deployed either. `030`'s `terms_version` is the half that had to land first,
  because it cannot be reconstructed later.
- [ ] 1.11 Assertions for 1.10 — deferred with it.
- [x] 1.12 Apply, then check the Supabase security advisors. Expect the two known findings
  (`moderate_comment` by design, the leaked-password toggle) plus the new transfer function, which
  is narrower than `moderate_comment` and expected. `PGPASSWORD=postgres npm test` green before
  any of this is called done.

## 2. The Edge Function (nothing in group 3 may point at this until it is deployed and exercised)

- [x] 2.1 Create `supabase/functions/` — there is none today, so this is also the repo's first
  Edge Function and brings a deploy path CI does not have. Record how it is deployed, and that a
  function deployed by hand and never redeployed is the same class of drift as an unapplied
  migration.
- [x] 2.2 The function itself: verify the JWT in the function rather than trusting the gateway;
  resolve the subject from the token; **take no id parameter of any kind**; require the
  re-authentication proof from 3.4; run the club transfer, then the Storage sweep, then
  `deleteUser(sub)` with **hard delete**, never Supabase's soft-delete mode.
- [x] 2.3 Storage sweep across every prefix in the `media` bucket keyed on the rider's uid —
  `postcards/<uid>/`, `avatars/<uid>/`, `covers/<uid>/`, `club-avatars/<uid>/`,
  `club-covers/<uid>/` and, since PD-104, `ride-maps/<uid>/` — through the
  Storage API. `delete from storage.objects` is refused by Supabase's own guard, which
  `scripts/storage/sweep-orphans.mjs` documents; paging matters, because `list()` truncates
  silently and a truncated sweep reports success.

  **This task read "all five prefixes" until 2026-08-12 and the sixth is the dangerous one.** A
  `ride-maps/` tile is a static map centred on `rides.meeting_point`, frequently the organizer's
  home address. `rides_organizer_id_fkey` is `ON DELETE CASCADE`, so the rows naming the tiles go
  with the rider regardless — a missed prefix therefore fails as a **non-event**, with nothing
  logged, nothing red, and no screen showing the difference. Count the list against the bucket
  rather than reading it here:

  ```sql
  select distinct split_part(name, '/', 1) as prefix from storage.objects
   where bucket_id = 'media' order by prefix;
  ```
- [ ] 2.3a **OWNER ACTION — `delete-account` must be redeployed, and it is not this change's own
  deploy that is outstanding.** `PREFIXES` in `supabase/functions/delete-account/index.ts` gained
  `'ride-maps'` in PD-104's PR #183, but **the deployed build predates it** and no session can
  redeploy: there is no `supabase` CLI in the build container and the MCP server exposes no deploy
  tool. Until the owner does it, an account deletion runs the five-prefix sweep and leaves the
  tiles.

  It is not urgent *yet* and the reason is worth stating rather than assuming: nothing writes
  `ride-maps/` until `resolve-ride-location` is deployed, which is PD-104 task 8.3 — and that task
  already blocks its own deploy on this redeploy, so the two are one window. Deploying the renderer
  first is what opens the gap. **Verify with `list_edge_functions` on both projects: a new
  `ezbr_sha256` for `delete-account`, equal across PROD and DEV.**
- [ ] 2.4 Idempotency and failure handling per design D7: already-deleted returns success; a
  failure before the auth delete leaves everything intact; the transfer and the cascade are one
  transaction; concurrent invocations do not double-transfer a club and never select a candidate
  who is themselves mid-deletion.
- [x] 2.5 The credential: service-role key in the function's secret store only. **Not** in the
  repo, `.env.local.example`, Vercel, any test fixture or any `NEXT_PUBLIC_*` variable. Add a
  grep-based unit test that fails if a service-role key pattern appears anywhere under `src/` or
  in a committed env example — the same shape as the existing `use-server-exports` and
  `isomorphic` guards, and for the same reason: this is a rule no reviewer will catch twice.
- [ ] 2.6 Exercise it against the real project with a disposable account before any UI points at
  it: delete succeeds; a second call succeeds; a request with another rider's id in the body still
  deletes only the caller; a request bearing the publishable key is refused; a request with no
  token is refused. **A live run, not a claim** — `docs/HANDOFF.md` records three PRs that merged
  unverified.

## 3. The flow

- [ ] 3.1 Add the `Delete account` row to `ProfileMenu`'s sheet: last position, own list group,
  `Warning/100`, `TrashIcon` from `@/components/icons/generated` (`Element / Icon / Trash` — the
  generated set has it). No dead row: it ships working or it does not ship.
- [ ] 3.2 **Also add the `Preferences` row, or explicitly decide not to.** The frame has
  **three** rows and the built menu has one. `ProfileMenu.tsx`'s doc comment and
  `docs/FIGMA-FIDELITY-TODO.md` §Profile both say "exactly two rows in the design, and that is
  read from the frame rather than assumed" — verified wrong with
  `npm run figma -- tree "Profile / Delete account / Account options" --all`, where none of the
  three list items is hidden. Fix both claims in the same change; a wrong claim that names its own
  method is worse than a stale one.
- [ ] 3.3 The confirmation screen from `2303:9370`: "Delete account?" (`Poppins/24/Semibold`),
  "This action cannot be undone." (`Poppins/14/Regular`), `Button variant="danger"` labelled
  `Delete account`, `secondary` labelled `Cancel`. The title's fill in the frame is the legacy
  `Grey (OLD)/10` — resolve to the nearest v2 token per decision #4 rather than porting it.
- [ ] 3.4 Re-authentication before the destructive call (design D6, Q7). Server-verified, not a
  client-side gate.
- [ ] 3.5 The impact summary: clubs that will change hands, upcoming rides that will be cancelled,
  riders currently RSVP'd to them. Read through `src/lib/data/`, under the rider's own session,
  never through the privileged function. Render nothing rather than zeroes when there is nothing.
- [ ] 3.6 The action in `src/lib/actions/` that calls the function, with pending, error and
  offline states. **Offline refuses** and never queues — an irreversible destructive action is the
  one mutation that must never be optimistic.
- [ ] 3.7 On success: clear the session, the query cache, cached images and device secure storage,
  then land on `/auth/login`. The local clear happens even when the sign-out call fails.
- [ ] 3.8 Every state from the flow spec has a treatment: in flight, offline, failed, already
  deleted, cancelled at every point. Reuse the shared loading/error/offline treatments the render
  migration builds rather than inventing screen-local ones.

## 4. What everyone else sees — the four screens where empty and forbidden look identical

- [ ] 4.1 `/rides/detail`, `/postcards/detail`, the profile reached from a byline, and a club roster:
  say the content is **unavailable**. Not "deleted" — that discloses a person to someone who may
  have blocked them. Not "you do not have permission" — that is a different and wrong explanation
  of the same zero rows.
- [ ] 4.2 The postcard deck skips a card whose postcard has disappeared since the fetch, without
  leaving a blank position. The deck only moves forward, so a blank cannot be returned to.
- [ ] 4.3 Comment threads close the gap rather than rendering a placeholder byline. There is no
  tombstone author and `postcard_comments.author_id` is `not null`.
- [ ] 4.4 Counts agree with rows after a deletion, everywhere. Nothing is denormalised — `009` and
  `011` both declined a counter deliberately — so this should be free, and the assertion is what
  proves it.

## 5. The web-accessible route (Play), and it depends on nothing

- [x] 5.1 `src/app/legal/account-deletion/page.tsx` — public, under the existing `/legal/*` prefix
  the route guard already allows. Explains what deletion removes, what happens to clubs and rides,
  and links into the in-app flow. **Reads no table, holds no personal data, adds no `anon`
  grant.**
- [x] 5.2 It must never accept a deletion request from an unauthenticated form. A page that
  deletes an account on an emailed identifier is an account-deletion service for strangers.
- [x] 5.3 Link it from `/legal/terms` and `/legal/privacy` so a store reviewer finds it without
  being given the URL.

## 7. The four standing capabilities this change modifies

**Numbered 7 so nothing above renumbers, but it runs alongside groups 3 and 4, not after group
6.** These are the deltas against `openspec/specs/` — behaviour that already had a contract and
now has a case it did not cover. Each one is a rule a reviewer can check against the standing
spec, which is why they are listed apart from the flow's own tasks rather than folded into them.

- [ ] 7.1 **Destroy, do not merely redirect, when the account is gone**
  (`client-session-storage`). The route guard's `unavailable` branch is reachable in production
  for the first time because of this change: `my_onboarding_state()` returns zero rows for a
  caller with no `profiles` row, `onboardingStateFrom` maps that to `unavailable`, and
  `resolveDestination` redirects to `/auth/login?error=profile_unavailable` — while clearing
  nothing. `signIn` has never cleared the cache; only `signOut` does. Clear the session store and
  the query cache on that branch, before the login screen renders, without needing the network.
- [ ] 7.2 Unit tests for 7.1 in the existing guard and session-store suites: the `unavailable`
  branch destroys the store entry and bumps every cache generation; it still falls through on the
  two auth entry paths rather than redirecting to itself; zero rows is never mapped to
  un-onboarded. The last one already has a guard test — extend it to assert the destruction, not
  only the destination.
- [ ] 7.3 **The deletion clears the cache rather than invalidating it**
  (`client-cache-invalidation`), and its cache claim is recorded in `src/lib/query/keys.ts`'s
  contract table like every other mutation's. `invalidate()` refetches, which with a dead token
  repopulates nothing and burns the one moment the cache could have been destroyed.
- [ ] 7.4 A cached signed URL whose Storage object was deleted renders the ordinary fallback —
  initials for an avatar, the club's initials for club imagery — and not a broken image, a
  whole-screen error, or a retry loop against a URL that cannot start working again. This is the
  club-transfer path as much as the deletion path: D2 nulls both club image paths and deletes the
  objects, so every member holding a cached club row has a URL that will 404 for the rest of its
  hour.
- [ ] 7.5 The offline exclusion is written where the offline queue will be built, not only in
  this change's flow spec (`client-render-shell`). The standing requirement offers "refuse **or**
  hold"; deletion removes the second branch. When durable offline queuing ships it must carry an
  explicit exclusion rather than inheriting deletion by default.
- [ ] 7.6 The unavailable copy from group 4 satisfies the three-way distinction, not the two-way
  one: never "you do not have permission", never "this account was deleted", and identical for a
  club owner, a club admin, a fellow member, a non-member and a rider on either side of a block.
  A difference between any two of them is a disclosure.
- [ ] 7.7 Re-read all four standing specs before opening the PR and confirm the deltas still
  match them. They are one archive old; a second archive lands more requirements into
  `openspec/specs/`, and a delta whose MODIFIED block no longer matches the standing text loses
  detail silently at archive time rather than failing.

## 6. Verification and handoff

- [ ] 6.1 A cascade test in the RLS suite: delete a fixture's `auth.users` row inside a savepoint
  and assert, table by table, what survived and what did not — including, from the *other*
  rider's session, that their postcards in the departed owner's club are still there. This is the
  part most likely to be silently wrong and it is fully testable on plain Postgres.
- [x] 6.2 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`,
  `PGPASSWORD=postgres npm test` all green.
- [ ] 6.3 Walk it against the real database with a real disposable account, on a device, offline
  and online. `npm test` proves the cascade; only a live run proves the JWT verification, the
  Storage delete and the sign-out.
- [x] 6.4 Run `reviewer` before the PR, including its RLS and data-exposure audit. Never on its
  own work. The service-role credential and the transfer function are what it is for.
- [x] 6.5 Correct the documentation this change found wrong, in the same PR: the two-row claim in
  `ProfileMenu.tsx` and `docs/FIGMA-FIDELITY-TODO.md` §Profile (3.2); `docs/HANDOFF.md`'s "account
  deletion is not built" line; and a note in `scripts/storage/sweep-orphans.mjs` that it sweeps
  `postcards/` for one rider and is not a remedy for a departed rider's objects.
- [x] 6.6 Update `CLAUDE.md`: the Trust & Safety row in §Product Scope, the `clubs` and `rides`
  rows in §Schema where the cascade behaviour is now different, and — the first entry of its kind
  — the existence of an Edge Function and where its secret lives.
- [ ] 6.7 ~~Tick `migrate-to-client-rendered-shell` task 7.5 and its Q9~~ — **done, and the
  target has moved.** 7.5 was ticked when that change was archived on 2026-08-06 (this proposal
  *is* what it asked for), and the change now lives under
  `openspec/changes/archive/2026-08-06-migrate-to-client-rendered-shell/`. **Do not edit an
  archived change** — it is the record of what shipped. What survives of this task: record in
  **this** change's design that `023`'s 1.14 INSERT arm is defence in depth rather than the
  primary control, per D8.
