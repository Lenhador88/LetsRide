## 0. Before anything — resolve the questions that change the shape

**Status 2026-09-18: all three are answered.** The product owner was asked in August, did not
answer then, and group 1 was built to each recommended default rather than blocking — every
default recorded in the migration that implements it, so a different answer is a new migration
and not a rewrite. **Q1 is cast in applied SQL; Q7 was answered 2026-08-14 (require the
password); Q4 was answered 2026-09-18 (keep a de-identified record) and 0.2 below carries it.**
Nothing in this group is open.

- [x] 0.1 **Q1 — product owner.** A club whose owner deletes their account: transfer, or delete?
  **Built as TRANSFER** (design D2's default) in `029`. It is the difference between one rider's
  erasure request and forty other riders' postcards, and the RLS suite now asserts the
  counterfactual — without the transfer, a third party's postcard provably dies. Reversing this
  is a migration that drops one function, not a redesign.
- [x] 0.2 **Q4 — ANSWERED by the product owner 2026-09-18 (PD-458): keep a de-identified
  record.** The answer **contradicts design D10's recommended shape** and D10 is rewritten to the
  decision rather than kept beside it. What was decided: one row per completed deletion, carrying
  the terms version and a day-precision acceptance date and **no subject identifier at all** —
  not a uuid and **not a salted hash of one**. The hash is refused because the id space is
  enumerable from `auth.users`, so a hash of it is a lookup table away from being the id. Do
  **not** re-open this and do **not** ask before building 1.10. **The owner's own caveat travels
  with it, on PD-458**: this was reasoned by a session rather than by a lawyer and goes to counsel
  with the Terms page — which is a reason to keep it cheap to reverse, not a reason to defer it.
  1.10 and 1.11 below are the build.
- [x] 0.3 **Q7 — ANSWERED by the product owner 2026-08-14: require the password.** The `Done`
  frame draws no re-authentication field; the deviation is blessed, and design D6's default is
  now the decision. Do **not** re-open it and do **not** ask before building 3.4. The Edge
  Function's JWT check is not a substitute — re-auth proves the person at the phone knows the
  password, which is a different claim from "this session is live".
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
- [x] 1.10 **The consent retention table (PD-458, Q4 answered — build it).** Two data columns and
  no more: the terms version (nullable text) and the acceptance **date**. **No subject id, no
  hash of one, no email, no username, no IP, no device id, no free text and no `created_at`** —
  the last is the trap, because a `default now()` records the deletion moment at full precision
  under a name that reads like bookkeeping. A key is permitted only if it carries no order: a
  random uuid is fine, a sequence is another deletion clock. Take the migration number from
  `list_migrations` against **BOTH** projects and from `ls supabase/migrations/`;
  `docs/HANDOFF.md` records that the file count and the highest applied number disagree, so a
  number free in the repository can already be taken by a row with no file behind it.
  - **No credential in the system may read it, `service_role` included** — that credential
    bypasses RLS, so the refusal has to rest on the **absent table grant**, never on a policy.
    The judgement is design D10's and it is about the rows: their de-identification holds only
    while nobody can order them, and `xmin` and `ctid` are an insertion-order oracle for anyone
    holding SELECT.
  - **Decide the placement explicitly and say which rule applies.** In `private` the table never
    receives the `service_role` grants at all — Supabase sets its default privileges on `public`
    — so it is *outside* `CLAUDE.md` §Supabase Rules' keep-or-revoke rule rather than an
    exception to it, and `117`'s `system_alerts` is the precedent. In `public` it needs an
    explicit revoke, becomes one more revoked table in that rule's count, and adds one INFO
    advisor. Either is defensible; leaving the `public` default in place is not.
  - **RLS enabled in the same migration regardless**, with no policy at all — belt and braces
    rather than the barrier, since `CLAUDE.md` asks it of every new table without exception.
  - State the retention window in the header (Q15: **indefinite, with no sweep**, and the
    reason), because this change's own `deletion-evidence-and-retention` rule says a table states
    its window when it is created and a blank field is what that rule exists to prevent.
  - The row **count** is the one accepted disclosure — how many accounts have been deleted, which
    is not personal data about any of them. Say so in the header rather than leaving it as the
    unexamined residual.
- [x] 1.10a **The `before delete` row trigger on `public.profiles`**, in the same migration.
  `security definer`, owner-owned, `set search_path = ''`.
  - **It MUST `return old` on every path, and this is the most dangerous line in the change.**
    Measured on DEV 2026-09-18 on scratch tables: a `before delete` row trigger returning NULL
    **cancels** the cascading delete and raises nothing — parent gone, child row alive. On
    `profiles` that is `012` §KNOWN LIMIT's orphan state, reported to the rider as success. An
    early return that forgets `old` is indistinguishable from working code in every test that
    only checks the retention row arrived.
  - **No row when `terms_accepted_at` is NULL.** Nothing was consented to, and a row saying
    "unknown, at an unknown time" is a countable event with no evidentiary content — it inflates
    the very count D10 coarsened the date to protect while proving nothing. Same ruling `023` and
    `030` record: a fabricated consent record is worse than a missing one.
  - **A NULL `terms_version` with a non-NULL `terms_accepted_at` DOES get a row**, with the
    version NULL. That is the four rows `030` deliberately did not backfill, and `030` already
    fixed what NULL means there — "the consent predates the column and its version is genuinely
    unknown". Dropping the row would invent a second meaning for absence.
  - The Edge Function is **untouched** (PD-458 requires it: its re-authentication proof is
    verified and must not be disturbed). No task in group 2 changes, and `2.3a`'s redeploy is not
    re-opened.
- [x] 1.11 **Assertions for 1.10 and 1.10a.** Per grantee, never table-wide — `postgres` and
  `service_role` hold everything by default, so an unscoped assertion passes against a wrong
  database.
  - `has_table_privilege` for `authenticated`, `anon` **and `service_role`** on SELECT, INSERT,
    UPDATE and DELETE: all false. Use the grantee-scoped form `CLAUDE.md` names — a savepoint-staged
    `has_table_privilege`, or a grantee-scoped `information_schema.role_table_grants` count — and
    note that a grep for one form finds none of the other.
  - If the table is in `private`, also assert `has_schema_privilege` per grantee: `anon` and
    `authenticated` hold no USAGE, and `service_role` **does** — which is exactly why the table
    grant is the thing being asserted above.
  - RLS is enabled and the policy count on the table is **0**.
  - Delete a fixture's `auth.users` row inside a savepoint: exactly **one** row appears, its
    columns are the version and a date with no time component, and **the fixture's `profiles` row
    is gone**. The second half is what catches a trigger that returned NULL; the first half alone
    passes while the cascade is silently cancelled.
  - The same for a fixture with `terms_accepted_at` NULL: **zero** rows appear, and their
    `profiles` row is still gone.
  - The same for a fixture with `terms_accepted_at` set and `terms_version` NULL: one row, version
    NULL.
  - A second deletion of the same rider adds no row — and assert it for the right reason: the
    event is the DELETE, so after the first one there is no row left to delete. There is no
    dedupe key to lean on, because there is no subject id, which is why the argument has to be
    about the event.
  - **`authenticated` holds no TRUNCATE on `public.profiles`** (`047` revoked it; re-assert it
    here rather than citing it). A `TRUNCATE` does **not** fire row-level delete triggers, so it
    is the one real bypass of this retention, and the only thing keeping it out of a rider's reach
    is that revoke. Assert `authenticated` holds no DELETE either (`042`), so the only path to a
    `profiles` delete is the cascade this trigger hangs off.
  - No rider can read the table by any route: as `authenticated`, a direct select is refused, and
    the table appears in no view, no `security definer` accessor's projection and no join.
  - Re-run `CLAUDE.md` §Supabase Rules' kept/revoked query after applying and record the new
    counts in the migration header rather than trusting "fourth".
- [x] 1.11a Apply to DEV, then read the security advisors. **Predicted before applying, and the
  prediction was HALF WRONG — the measured half is the one to keep.** The `public`
  security-definer classes did not move, as expected: a `security definer` function in `private`
  raises nothing, so `authenticated_security_definer_function_executable` stayed at 38 and
  `anon_security_definer_function_executable` at 1. But **`rls_enabled_no_policy`'s candidate set
  is NOT limited to `public`** — it went 4 → **5**, naming `private.consent_records`, exactly as
  it already named `private.system_alerts` (`117`). So a table in `private` adds one INFO just as
  a table in `public` would, and only the *grant* question differs between the two placements.
  The finding is chosen: RLS on, no policy, no grant to anyone. A finding you did not predict
  means something else changed — stop and read it rather than recording it as expected.
- [ ] 1.11b **Exercise the REAL deletion path on DEV, before the PROD promotion.** `CLAUDE.md`
  asks for a hand-exercise gate when a migration hangs a trigger off an already-shipped write
  path, and `120` is exactly that shape — the `delete-account` Edge Function calling GoTrue's
  admin delete, which cascades into `public.profiles`. **The gate was met by PROXY and that is
  not the same thing**: the *mechanism* was verified on a scratch parent/child pair on DEV, and
  `120.5` exercises a real `auth.users` cascade on the suite's own cluster — but the live
  function → GoTrue → cascade path was never run. Closure is retrospective and cheap now that it
  is applied: create a disposable DEV rider, accept the terms, delete the account **through the
  function**, then assert the `profiles` row is gone AND `private.consent_records` gained exactly
  one row with that rider's version and day. Reported by `reviewer` on the PR that landed this.
- [x] 1.12 Apply, then check the Supabase security advisors. Expect the two known findings
  (`moderate_comment` by design, the leaked-password toggle) plus the new transfer function, which
  is narrower than `moderate_comment` and expected. `PGPASSWORD=postgres npm test` green before
  any of this is called done.

## 2. The Edge Function (nothing in group 3 may point at this until it is deployed and exercised)

- [x] 2.1 Create `supabase/functions/` — there is none today, so this is also the repo's first
  Edge Function and brings a deploy path CI does not have. Record how it is deployed, and that a
  function deployed by hand and never redeployed is the same class of drift as an unapplied
  migration.
- [ ] 2.2 The function itself: verify the JWT in the function rather than trusting the gateway;
  resolve the subject from the token; **take no id parameter of any kind**; require the
  re-authentication proof from 3.4; run the club transfer, then the Storage sweep, then
  `deleteUser(sub)` with **hard delete**, never Supabase's soft-delete mode.

  **The re-authentication clause is deployed as well as committed, verified by content (PD-249,
  2026-08-19).** `signInWithPassword` verifies the proof before the club transfer runs, returning
  `reauth_required` rather than `unauthorized` so the client never confuses a wrong password with an
  already-deleted account. The owner redeployed on 2026-08-17 — PROD v9, DEV v5, both `ACTIVE`,
  `verify_jwt` true, both `ezbr_sha256` `9793933d…` — and the deployed source read back through
  `get_edge_function` carries both `signInWithPassword`/`reauth_required` and `'ride-maps'` in
  `PREFIXES`. **The sha is not what closed this**: three tasks wanted the same redeploy, so one
  moved digest satisfies any of them by accident; the deployed body is the evidence.
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
  -- From the POLICIES, not from storage.objects — an objects query lists only
  -- folders that already CONTAIN something, and a prefix is empty at exactly
  -- the moment it is introduced. See the requirement in
  -- specs/account-erasure-cascade/spec.md for the measured failure.
  select distinct substring(coalesce(qual, with_check)
         from '\(storage\.foldername\(name\)\)\[1\] = ''([a-z-]+)''') as prefix
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
   order by prefix;
  ```
- [x] 2.3a **OWNER ACTION — `delete-account` redeployed. Done 2026-08-17, confirmed by content
  2026-08-19 (PD-249).** `PREFIXES` gained `'ride-maps'` in PD-104's PR #183 and the deployed build
  predated it for five days; it no longer does — `get_edge_function` against both refs returns a
  `PREFIXES` array containing `'ride-maps'`. The sweep is six prefixes on both projects.

  **The window closed in the right order, which is the part worth keeping.** `resolve-ride-location`
  — the only thing that ever writes `ride-maps/` — was deployed in the same window, so no deletion
  ever ran the five-prefix sweep against a bucket that had tiles in it. `add-ride-map-tiles` 8.3 is
  the other half of this pair.

  It is not urgent *yet* and the reason is worth stating rather than assuming: nothing writes
  `ride-maps/` until `resolve-ride-location` is deployed, which is PD-104 task 8.3 — and that task
  already blocks its own deploy on this redeploy, so the two are one window. Deploying the renderer
  first is what opens the gap. **Verify with `list_edge_functions` on both projects: a new
  `ezbr_sha256` for `delete-account`, equal across PROD and DEV.**

  **That sha check is necessary and NOT sufficient any more — see 3.4.** Three tasks now demand
  this one redeploy for three different reasons (this one, 3.4's re-auth arm, and
  `add-ride-map-tiles` 8.3), so whichever redeploy happens first changes the sha and satisfies
  all three checks while proving nothing about the other two reasons. Verify the *content*:
  `ride-maps` present in the deployed `PREFIXES`.
- [ ] 2.4 Idempotency and failure handling per design D7: already-deleted returns success; a
  failure before the auth delete leaves everything intact; concurrent invocations do not
  double-transfer a club and never select a candidate who is themselves mid-deletion.

  **Two clauses of this task were wrong and are corrected here rather than left to be re-derived.**
  "The transfer and the cascade are one transaction" **cannot be true** — `032` §1 measured it:
  the transfer is a PostgREST RPC that commits when its HTTP call returns, well before the
  Storage sweep and `deleteUser`. What is true is that the transfer is idempotent and a retry
  completes, which is why `032` demotes the departing rider instead of removing them. And "never
  select a candidate who is themselves mid-deletion" was **not delivered by group 2 and is not
  the Edge Function's to deliver** — it is `032` §3's open race, and **group 8 closes it in SQL
  with the function untouched**. Leave this box open until group 8 lands; ticking it on the
  strength of the in-transaction lock is exactly the false claim `032` §3 was written to remove.
- [x] 2.5 The credential: service-role key in the function's secret store only. **Not** in the
  repo, `.env.local.example`, Vercel, any test fixture or any `NEXT_PUBLIC_*` variable. Add a
  grep-based unit test that fails if a service-role key pattern appears anywhere under `src/` or
  in a committed env example — the same shape as the existing `use-server-exports` and
  `isomorphic` guards, and for the same reason: this is a rule no reviewer will catch twice.
- [x] 2.6 Exercise it against the real project with a disposable account before any UI points at
  it: delete succeeds; a second call succeeds; a request with another rider's id in the body still
  deletes only the caller; a request bearing the publishable key is refused; a request with no
  token is refused. **A live run, not a claim** — `docs/HANDOFF.md` records three PRs that merged
  unverified.

  **All five passed on DEV against the build deployed 2026-08-11** — recorded on `PD-86`. That
  pass did not transfer, and the durable half is why: **the build that will ship is not the build
  that was exercised**, so Q7's re-auth arm put all five back in debt against the redeployed
  function.

  **Re-run against the redeployed build (DEV v5, `ezbr_sha256` 9793933d…) on 2026-08-19, seven
  cases, all passing.** Three disposable accounts created through `/auth/v1/signup` (DEV
  autoconfirms, so no mailbox is needed). **The table below deletes two of the three** — case 1
  takes the first, case 3 takes the second; the third holds the token for cases 6 and 7 and is
  the account case 3 names in its body, and it was removed by an eighth call to the function with
  its own correct password once the table was done. `select count(*) from auth.users where email
  like 'probe-pd102-%'` is 0, which proves no residue and not who removed it — hence saying so:

  | # | Request | Result |
  |---|---|---|
  | 1 | valid token, correct password | `{"deleted":true}` 200; `auth.users`, `auth.identities` and `profiles` rows all gone, verified in SQL rather than off the 200 |
  | 2 | the same token replayed after deletion | `{"error":"unauthorized"}` 401 |
  | 3 | valid token, `user_id`/`id`/`sub` of a *different* live account in the body, correct password | `{"deleted":true}` 200 — the caller deleted, the named account still present |
  | 4 | publishable key in the `Authorization` slot | `{"error":"unauthorized"}` 401 |
  | 5 | no `Authorization` header | `UNAUTHORIZED_NO_AUTH_HEADER` 401, refused at the gateway |
  | 6 | valid token, no body / `{}` | `{"error":"reauth_required"}` 401 |
  | 7 | valid token, a real non-empty **wrong** password | `{"error":"reauth_required"}` 401 |

  **Case 2 is the one that stopped being inferred.** Both this file and D7 previously reasoned
  about the already-deleted shape from GoTrue's documented behaviour — the 2026-08-11 run replayed
  no real token against a deleted account. It does now: `unauthorized`, which is the contract the
  client already implements.

  **Case 7 is the other, and it is the one 3.4 left open.** Case 6 never reaches
  `signInWithPassword`, so only case 7 exercises `classifyAuthError` against
  `REAUTH_REJECTED_STATUSES` — a wrong password is reported at 400, and 400 is absent from
  `GETUSER_REJECTED_STATUSES`, so the bug this guards against would have surfaced as
  `verification_unavailable` (503) telling a rider to retry on a plain typo. It returns
  `reauth_required`.

  **DEV's `ezbr_sha256` equals PROD's, and that is the one thing sha equality does prove.** It is
  no currency check — 2.3a and the function's own header both say so — but PROD's v9 and DEV's v5
  are byte-identical builds, so these seven results describe the PROD function too. What is
  untested on PROD is PROD's own `SERVICE_ROLE_KEY` secret, and that is separately proven by
  `PD-86`'s real PROD deletion on 2026-08-16.

  **The browser path is not covered by any of the seven.** Every one is `curl`, which needs no
  preflight; the function's own CORS note says to test both. The preflight was checked separately
  and answers `204` with `access-control-allow-methods: POST, OPTIONS` and `authorization,
  content-type` among the allowed headers — necessary, not sufficient. `6.3`'s live walk through
  the actual sheet is still owed. **It is no longer blocked**: the product owner had the flag
  removed on 2026-08-19 (*"I don't see a reason for the flag in dev"*), so `src/lib/flags.ts` is
  deleted and the row renders unconditionally — walking it on DEV is the next thing 6.3 needs, and
  the flag was the reason it could not be done. **A gate nobody can open blocks its own test**:
  turning it on took setting a Vercel variable AND redeploying that target, both owner actions.

  **An eighth case ran on 2026-08-19 and it is the success arm**: the correct password answers
  `{"deleted": true}` with the account gone. None of the seven had covered it, so all three arms of
  the re-authentication proof are only now exercised end to end against the deployed DEV build —
  which is what removed the last reason for the flag.

  **What that trades, recorded once rather than argued again:** the browser path reaches riders
  before anyone has walked it. The curl arms cover the function and the preflight is checked, but
  until `6.3` runs, the sheet itself is unexercised in a real browser, in front of an irreversible
  action.

## 3. The flow

- [x] 3.1 `ProfileMenu`'s "Delete account" row — `Warning/100`, `TrashIcon`, its own list group
  below Sign out. *(Done, PD-102. It opens `DeleteAccountSheet`, not a route — see 3.3.)*
- [x] 3.2 **Decided: `Preferences` stays unbuilt.** There is no `/profile/preferences` screen and
  nothing in scope draws one, so it would be the dead row this file's own rule refuses. Both wrong
  claims fixed in `ProfileMenu.tsx`'s own doc comment; `docs/FIGMA-FIDELITY-TODO.md` §Profile is
  6.5's, not this task's, and is unchanged.
- [x] 3.3 **Built as a sheet, not a route, and that is a correction to this task rather than a
  deviation from it.** `npm run figma -- tree "Confirm account deletion" --all` shows
  `Context Menu / Confirm account deletion` layered as a second `ContextMenu`-style sheet over
  the SAME `/profile` canvas — `Delete account?` / `This action cannot be undone.` / danger
  `Delete account` / secondary `Cancel`, at `2303:9370` — the same shape
  `Content / Context Menu / Postcard` uses, not a full page. `src/app/(app)/profile/delete/`
  does not exist and should not. The password field (D6) sits between the body copy and the
  buttons, built from `LoginPage`'s `<Input type="password">` — the designer still owns the
  final control per the note below.
- [x] 3.4 **The re-authentication arm is deployed, not merely committed (PD-249, 2026-08-19).**
  `supabase/functions/delete-account/index.ts` reads `{ password }` and verifies it with
  `signInWithPassword` before anything destructive runs, returning `reauth_required` (never
  `unauthorized`) on a missing or wrong one — and the **deployed** source on both projects contains
  that arm, read back through `get_edge_function` rather than inferred from a moved digest. A
  password submitted through 3.3's sheet is now checked on both projects.

  **That arm is now exercised against the live endpoint (2026-08-19).** A request with no
  `password` comes back `reauth_required` without ever reaching `signInWithPassword`, so it tests
  only the guard above the call; a real, non-empty wrong password reaches `signInWithPassword` and
  also comes back `reauth_required` rather than the `verification_unavailable` a mis-set status
  allowlist would have produced. Both are case 6 and case 7 of 2.6's table, which is the evidence
  rather than this line.
- [x] 3.5 `getAccountDeletionImpact()` (`src/lib/data/profile.ts`) — clubs changing hands, upcoming
  rides to cancel, riders on those rides' crews, read under the rider's own session. Renders
  nothing when there is nothing, per the spec's own scenario; **not gated on this read succeeding**
  — a documented deviation from `DeleteClubControl`'s stricter refuse-on-error gate, because
  Apple's 5.1.1(v) is the reason this feature exists and the summary is informational only.
- [x] 3.6 `deleteAccount` in `src/lib/actions/auth.ts` — pending/error states via `useActionState`,
  offline refused before the network call (`isOnline()`), and it distinguishes the function's two
  401s (`reauth_required` vs the already-deleted `unauthorized`) via `edgeFunctionErrorCode`
  (`src/lib/supabase/functions.ts`, the one new doorway import for `@supabase/supabase-js`'s error
  classes).
- [x] 3.7 On success `deleteAccount` returns `signOut()` — same clears, same destination, not a
  second hand-written list (client-session-storage's own rule). `client-session-storage`'s
  "revocation the server refuses is not a failed deletion" scenario is `signOut()`'s existing
  local-scope fallback, reused rather than re-solved.
- [x] 3.8 In flight (submit disabled, Escape/scrim refused while pending), offline (refused before
  the call), failed (retryable, account intact), already-deleted (`unauthorized` → same as
  success), cancelled (Cancel/scrim/Escape do nothing destructive). `combineQueries`/`ErrorState`
  not reused here — this is a sheet with one field, not a data-gated screen.

## 4. What everyone else sees — the four screens where empty and forbidden look identical

- [x] 4.1 `src/app/(app)/not-found.tsx` — the one boundary every existing `notFound()` call in
  `rides/detail`, `postcards/detail`, `profile/detail` and `clubs/detail/members` already shared
  (Next's unstyled default, until this). Says "This isn't available", never "deleted" and never
  "you do not have permission", for all six causes (never-existed, private, and the four this
  change adds) alike — none of those four screens had to change, only what catches their existing
  `notFound()`.
- [x] 4.2 **Already built, verified rather than added.** `PostcardDeck`'s `remaining =
  remainingPostcards(postcards, dismissed)` is recomputed every render straight off the `postcards`
  prop, so a card the feed drops between fetches simply stops appearing — no blank position, no
  code change needed.
- [x] 4.3 **Already correct by construction, verified.** `postcard_comments.author_id` has no
  nullable arm and cascades from `profiles`; a departed rider's comments are rows that no longer
  exist, not rows with a null author, so there is nothing for a tombstone to render.
- [x] 4.4 **Already true, verified.** No denormalised counter anywhere this touches — `club.data.members_count`,
  postcard like/comment counts and the roster are all live aggregates or live selects, so a
  departed rider's rows disappearing from one disappears from the other in the same read.
  **Extended past the letter of this task**: `Avatar` and `ClubCard`'s cover image now fall back to
  initials on a signed URL's `onError` rather than rendering broken — `client-cache-invalidation`'s
  own "a signed URL whose object is gone renders the fallback" (task 7 delta), which a deletion or
  a club transfer reaches immediately, before the next revalidation.
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

- [x] 7.1 **Built, and it needed a distinction the requirement's own text does not draw.**
  `onboardingStateFrom` (`guard.ts`) now returns a fourth `GuardState`, `gone`, for `{data: null,
  error: null}` specifically — zero rows with no read failure — kept separate from `unavailable`
  (a genuine error) because `resolveDestination` sends both to the same place but `guard-cache.ts`
  must not react to them the same way: destroying local state on an ordinary network hiccup would
  sign out a rider whose account is fine. `read()` triggers `destroySessionForDeletedAccount()`
  (`clearQueryCache`, `clearRiderLocation`, `clearSessionStore`, no network call — see its own
  comment for why `supabase.auth.signOut()` was tried and reverted: it races this module's own
  `SIGNED_OUT` listener and wipes `gone` before the redirect can use it) only on `gone`, before the
  final `notify()` of that read.
- [x] 7.2 12 new cases across `guard.test.ts` (the `gone`/`unavailable` split, pure) and
  `guard-cache.test.ts` (the destruction call counts, via mocked `clearQueryCache` /
  `clearSessionStore` / `clearRiderLocation`) — `npm run test:unit`, 1594/1594.
- [x] 7.3 `deleteAccount` returns `signOut()`, which already calls `clearQueryCache()`, never
  `invalidate()`. Recorded in `keys.ts`'s `EVERYTHING` export comment, beside sign-out's own claim
  rather than a new entry, since it is the same claim for the same reason.
- [x] 7.4 `Avatar` and `ClubCard`'s cover image now track their own `src` in state and fall back to
  initials / no-cover on the `<img>`'s `onError`, rather than rendering broken. **Not exhaustive**:
  `profile/detail`'s and `profile`'s own cover banners and `NotificationsListItem`'s club-avatar
  and postcard thumbnails are still raw `<img>` with no fallback — flagged in the report rather
  than silently left, since they are the same defect on different screens.
- [x] 7.5 **Already true in the delta, verified rather than added.** `specs/client-render-shell/spec.md`
  in this change's own `specs/` directory already carries "An irreversible destructive write SHALL
  be refused rather than held" as its own scenario under `Every screen SHALL define its offline
  behaviour` — this is the file a future offline-queue change reads, and it already states the
  exclusion explicitly rather than leaving deletion to inherit a default.
- [x] 7.6 Satisfied by 4.1: one `not-found.tsx` boundary, one copy, no role-specific branch — so
  there is no code path that COULD read differently per role, which is stronger than asserting five
  roles happen to agree.
- [x] 7.7 Re-read all four (`client-session-storage`, `database-enforced-integrity`,
  `client-cache-invalidation`, `client-render-shell`) against this session's diff. No new drift
  found; the one live coordination banner (`database-enforced-integrity` vs
  `enforce-creator-membership`) is unrelated to groups 3/4/7 and untouched.

## 6. Verification and handoff

- [x] 6.1 **Most of this was already built in `029`'s own §B/§C, unticked — the gap was coverage,
  not existence.** `029` already deletes `auth.users` inside `savepoint transfer_029`, asserts the
  transfer, the ride cascade and (from 000c's own `set_config('test.uid', ...)` session — table
  10063, "029: ... and 000c can still read it under RLS, from their own session") that a third
  party's postcard in the departed owner's club survives. What was missing: its own "nothing
  dangling" sweep is a hand-picked sum of nine tables, written when the FK count was 13/14 — `034`
  and `036` each added a FK into `profiles` since (`ride_messages.author_id`,
  `notifications.user_id`/`actor_id`) and neither ever joined that list, so this cascade test has
  been silently blind to two of the sixteen live FKs since they shipped. Added a `do $$ ... $$`
  block deriving every FK-into-`profiles` column from `pg_constraint` (same technique 029 §A
  already uses for its index assertion) and summing rows referencing the deleted rider across all
  of them — covers today's sixteen and every one a future migration adds, with a floor check
  (`checked < 16`) so a broken derivation fails loudly rather than iterating zero times and passing
  for the wrong reason. `PGPASSWORD=postgres npm test` — 1459/1459, +1 over the prior baseline.
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

## 8. The deletion-in-progress marker (PD-175) — closing `032` §3's race

**Numbered 8 so nothing above renumbers, but it belongs with group 1**: it is additive SQL that
changes no policy, no grant a client holds and no shape the application reads, and it is
independently landable. It is late in the file and early in the risk order — **the flow it
corrects is in production** (PD-102 completed 2026-08-19), so this is a live defect in an
irreversible path rather than groundwork.

**The mechanism is design D12 and the Edge Function is untouched.** PD-175's own comment assumed
the other candidate — an advisory lock across the invocation — and said in the same breath that
it did not need an answer to proceed; D12 records why the marker wins on that comment's own
objection. Do not re-open the choice inside the migration.

- [x] 8.1 Pre-flight against **both** live projects before writing the migration, and record every
  count in the header the way `029` and `032` did: profiles; clubs; clubs with more than one
  member; `club_members` rows; rows where a candidate would already be excluded (zero, since the
  column does not exist). A count that is 0 today is not a count that is 0 at apply time — re-run
  it then. Take the migration number from `list_migrations` against **BOTH** projects and from
  `ls supabase/migrations/`, not from this file and not from the file count alone.
- [x] 8.2 The column: `public.profiles.deletion_started_at timestamptz`, nullable, no default.
  **It goes into none of `025`'s three column allowlists** — not SELECT, not INSERT, not UPDATE —
  exactly as `030` did for `terms_version` and for the same reason: `025` revoked the table-level
  grant and re-granted an explicit list, so a new column is unreachable to `authenticated` by
  default. **Assert it anyway, per grantee.** "It is unreachable by default" is how a column
  becomes reachable the day someone adds it to a list to make something work, and the failure is
  silent. Comment the column with what NULL means and with the fact that nothing ever clears it.
- [x] 8.3 `create or replace private.transfer_owned_clubs(departing)` — three changes, no others:
  1. **Stamp `deletion_started_at` for `departing` at the very top of the body, before the club
     loop.** The position is load-bearing, not tidiness: it is the serialisation point. A
     concurrent rider's `for update of p` on this row blocks the stamp, so the club loop cannot
     run until that rider's transfer is visible — see D12. A stamp written after the loop buys
     nothing.
  2. **The successor select excludes a candidate whose marker is set and still fresh, and the
     freshness test goes in the `where` clause, never in `order by`.** Under `read committed` a
     row locked by `for update` that was updated concurrently is re-checked against the **`where`
     clause** only; `order by` is not re-evaluated after the lock, so a marker expressed as a sort
     key is silently ignored in exactly the interleaving it exists for. Verified on DEV
     2026-09-18 against the real tables with the column added inside a rolled-back transaction —
     the plan is `Limit → LockRows → Sort → Hash Join` with the marker filter on the `profiles`
     scan, below `LockRows`. **Keep `for update of p`.** `032` §3 says the lock did not close the
     race; the stamp is what changes that, and removing the lock reopens it.
  3. **Nothing else.** In particular, do **not** add a last-resort pass that prefers a marked
     candidate over the no-successor arm. The obvious worry — that excluding the last candidate
     deletes a club holding third-party postcards — was answered by `107` and widened by `117`:
     the no-successor arm now **keeps the club with `owner_id NULL`** when any postcard in it was
     authored by someone else. A skipped last candidate therefore reaches that arm one deletion
     earlier with the postcards intact, and a pass handing the club to a rider whose deletion is
     in flight would be strictly worse, because that club cascades away when the deletion lands.
     **Read `107` and `117` before touching this branch**, not `032` — `117` is the current
     definition and the `create or replace` goes over it.
  Keep `for update of p`. The window is **15 minutes** (Q16) and the header says why: a
  successful deletion takes the row with it, so a stale marker always means a failed run whose
  rider is still here, and the window is what stops that rider being excluded from club
  succession for ever. **Name the deadlock in the header**: two riders who each own a club and
  are members of each other's can deadlock on each other's `profiles` row; Postgres detects it,
  one deletion fails retryably, and the retry finds a stamped row. `skip locked` would remove the
  deadlock and replace it with a silently wrong successor — a loud retryable error is the chosen
  failure.
- [x] 8.4 Assertions for 8.2, per grantee and never table-wide:
  `has_column_privilege('authenticated', 'public.profiles', 'deletion_started_at', …)` and the
  same for `anon`, all false on select, insert and update. A rider's `select
  deletion_started_at` is `42501`, and so is naming it in an UPDATE — column privileges are
  checked against the columns named in SET *before* any BEFORE trigger runs (`025` §DEFECT 2c),
  so refusal rather than correction is the assertable property. **Also assert the column appears
  in no `security definer` accessor's projection** — `my_onboarding_state()` and every other
  own-row RPC — because those are the routes that reach columns the grant does not.
- [x] 8.5 Assertions for 8.3, one per branch, in the style of `1.7`:
  - the stamp lands on the departing rider's row when they own **no** clubs at all — the Edge
    Function always calls the RPC, so the stamp is unconditional and does not live inside the
    loop;
  - a fresh-marked candidate is skipped in favour of an unmarked one, even when the marked one
    sorts first by role and tenure;
  - a **stale**-marked candidate is treated as ordinary and may be chosen;
  - a club whose only other member is fresh-marked, **and which holds a postcard by someone
    else**, is **kept ownerless** — `owner_id` NULL, the postcard still there — rather than
    transferred or deleted. Assert the postcard survives from its author's own session, the way
    `1.7` does;
  - a club whose only other member is fresh-marked and which holds **no** third-party postcard is
    deleted, with only its private rides going — the pre-existing arm, reached one deletion
    earlier and otherwise unchanged;
  - the existing branches still hold — admin before member, tenure order, the departing rider
    demoted rather than removed (`032` §1), only private rides deleted with a deleted club
    (`032` §2), no club ending with two owner rows, `authenticated` still holding no EXECUTE on
    the transfer function, and `club_members` still carrying exactly three policies with no
    UPDATE among them.
- [x] 8.6 **The interleaving itself is NOT assertable in the RLS suite, and this task is to say so
  where it will be read rather than to work around it.** The suite runs both calls inside one
  psql transaction, so its idempotency assertion proves nothing about two concurrent HTTP
  invocations — PD-175's own comment makes this point. Exercise it by hand against DEV, in two
  sessions, and record the result in the migration header and in the PR:
  - session 1 opens a transaction and stamps a rider's marker without committing;
  - session 2 runs the successor select for a club that rider is the best candidate for, and
    **blocks**;
  - session 1 commits; session 2 returns a *different* candidate, or no successor when there is
    none — in which case the club takes the ownerless arm. It must not return the marked rider,
    and it must not return "no successor" while an unmarked candidate exists.
  Roll both back. "The suite is green" is not evidence for this and must not be written as if it
  were.
- [x] 8.7 Apply to DEV, then read the security advisors. Expect **no change**:
  `private.transfer_owned_clubs` is already counted, `create or replace` does not alter its
  grants (`032` §Verification measured that), and a column adds no finding. An advisor that moves
  means something else changed — stop and read it.
- [x] 8.8 `PGPASSWORD=postgres npm test` green, and compare **label sets** rather than counts
  against the prior run, per `CLAUDE.md`.
