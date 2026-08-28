# Tasks — manage-club-riders (PD-326 + PD-335)

Ordered so the migrations land before the screens. §7 is the verification gate and is not optional.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 Re-read **PD-326** and **PD-335**, body **and** comments, immediately before starting.
  Both were read on 2026-08-28 and both carried a territory comment rather than a correction, but a
  body is older than the code and this repo corrects one by commenting on it.
- [ ] 0.2 Re-derive the migration position: `list_migrations` on PROD (`zwprydcyryvudhurbnye`) and
  DEV (`fpmrimzxadewsaiwpsel`) against `ls supabase/migrations/`. Measured 2026-08-28: **87 files,
  DEV `087`, PROD `079`.** Do not read it off `proposal.md`. **Promote `080`–`087` to PROD in
  filename order first**, per `docs/ENVIRONMENTS.md` §Migrations — `082` renames what `081` creates
  so the reverse errors, and `083` and `085` both drag `036`'s hand-exercise gate.
- [ ] 0.3 Record the **before** numbers so the after-numbers mean something. Enumerate rather than
  count, `085`'s footer's reason:
  - `select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;`
    — expect **16**, and expect it **unchanged** after both files.
  - Security advisors — expect **21**, going to **24**. Derive it rather than trusting the number:
    `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join
    pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;` measured
    **18** true rows on 2026-08-28, plus 2 `rls_enabled_no_policy` and 1
    `auth_leaked_password_protection`.
  - The RLS suite's **label set**, not its count:
    `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"`.
- [ ] 0.4 Confirm from the catalog, not from this file, the five facts the whole design rests on.
  All five were measured on DEV 2026-08-28; if any has moved, the decision it supports is reopened.
  - `club_members` has **three** policies and none is UPDATE.
  - `club_members` SELECT's qual carries **no** `is_blocked` conjunct (this is what §The block
    conjunct turns on).
  - **No** foreign key references `club_members`:
    `select count(*) from pg_constraint where contype='f' and confrelid='public.club_members'::regclass;`
    → 0.
  - `club_members` carries exactly **two** triggers, both `BEFORE`/`AFTER INSERT`; nothing fires on
    UPDATE or DELETE.
  - `blocks` carries `CHECK (blocker_id <> blocked_id)`, which is what makes `is_blocked(x, x)`
    false and the self-actor readable.
- [ ] 0.5 Confirm `has_function_privilege('authenticated','private.club_takes_join_requests(uuid)','execute')`
  is **true** and the `_for(uuid,uuid)` twin is **false**. `proposal.md` §2 and `design.md` §The
  avatar that ships both depend on it, and the SQL PD-335 tells the build to lift verbatim uses the
  wrong one.
- [ ] 0.6 Measure `select count(*) from club_members where role='admin';` on DEV and PROD. `029`
  measured zero and `019` makes it insertable by no client. If it is still zero, every admin
  assertion needs its fixture row created directly as the table owner.
- [ ] 0.7 Read the **live** comments on `public.decline_club_join_request` and
  `public.club_join_requests` before writing the restamps in 5.8. Both currently claim no decline
  notification is written.

## 1. Migration `088_club_roster_administration.sql` — additive, applies BEFORE the deploy

- [ ] 1.1 Header: what the file does, why a `security definer` RPC rather than an UPDATE policy
  (`019`'s Q10 answer and `036` §7.6's dependence on the absence), and the ordering statement —
  additive, nothing calls it until the screens ship.
- [ ] 1.2 `public.remove_club_member(target_club uuid, rider uuid) returns void` — `security
  definer`, `set search_path = ''`, `#variable_conflict error`, **one raise site**. Body order:
  refuse `rider = auth.uid()`; read `clubs.owner_id` for `target_club`; refuse
  `rider = c.owner_id`; require the caller to be the owner **or** an admin *and* the target's role
  to be `'member'`; then delete.
- [ ] 1.3 In the same function, `delete from public.club_join_requests where club_id = target_club
  and user_id = rider`. Comment it with §Removal must not be undoable by an approval's reason, not
  just "cleanup".
- [ ] 1.4 `public.promote_club_member(target_club uuid, target_rider uuid)` — owner OR admin, writes the
  **literal** `'admin'`, **no role parameter**. Comment: `019`'s rule survived `085` by having no
  input to attempt, and this is the first path that ever writes the value.
- [ ] 1.5 `public.demote_club_admin(target_club uuid, target_rider uuid)` — owner, or the admin stepping down themselves; writes the literal
  `'member'`. Refuses `rider = c.owner_id` and `rider = auth.uid()` on the same two conjuncts.
- [ ] 1.6 `revoke all on function <each> from public, anon;` then
  `grant execute … to authenticated;` for all three. Postgres grants EXECUTE to PUBLIC on creation;
  the revoke is what does the work.
- [ ] 1.7 `revoke update on public.club_members from authenticated;` **with nothing re-granted.**
  Comment: `048` narrowed it so a promotion feature could not inherit `joined_at` for free; the
  promotion feature arrived as an RPC, so the grant has no legitimate user left and a dead grant
  beside a live writer is a loaded gun for the next UPDATE policy.
- [ ] 1.8 **Add no UPDATE policy.** State the absence in a comment, `078`'s shape, so a later
  session does not "complete" the CRUD set.
- [ ] 1.9 `comment on function` for all three, each naming: the authority it re-checks in its own
  body (RLS does not apply inside), the single raise site and what it therefore conflates, and the
  ownerless-owner conjunct.
- [ ] 1.10 Restamp `comment on column public.club_members.role` — `019`'s text says `admin` is
  *"writable by nobody"* and that stops being true. `028`/`033`: this is the `data` agent's first
  read and no edit to `CLAUDE.md` reaches it.
- [ ] 1.11 Verification footer: `prosecdef`/`proconfig` per function; the pragma survived; the three
  `has_function_privilege` pairs; PUBLIC's default grant gone; `club_members` policy count still
  **3** with no UPDATE; `has_table_privilege('authenticated','public.club_members','update')` now
  **false**; gate trigger count still **16**; advisors **21 → 24**.

## 2. Migration `089_a_declined_rider_is_told.sql` — applies AFTER the build is confirmed serving

- [ ] 2.1 Header: PD-335's decision verbatim; why this is neither option B (the actor, and the
  `nulls not distinct` collapse) nor option C (type-scoped); **and the ordering paragraph** — that
  the file is additive in schema and still belongs in the destructive-last slot because
  `notificationCopy` and `describe` are exhaustive switches with no `default`, so a row of the new
  type reaching an old bundle throws on the destructuring.
- [ ] 2.2 Extend `notifications_type_check` to **eleven** strings and
  `notifications_subject_shape` with one arm carrying `club_id` alone, `else false` intact. Both
  constraints in the same block, `085`'s reason.
- [ ] 2.3 Replace `036` §3's SELECT policy and `036` §4's UPDATE policy — **all three expressions**,
  USING and WITH CHECK — adding only the type-scoped disjunct. Reproduce each policy whole; a policy
  is replaced whole and a diff is not what runs.
- [ ] 2.4 `private.notify_club_join_request_declined()` — `security definer`, `set search_path = ''`,
  in `private` so it adds **no** advisor. `actor_id` from `new.user_id`. Guarded per recipient by
  `private.can_read_club(new.user_id, new.club_id) or
  private.club_takes_join_requests_for(new.user_id, new.club_id)` — **both** subject-taking forms.
  `on conflict do nothing`.
- [ ] 2.5 The trigger: `after update of status on public.club_join_requests for each row when
  (new.status = 'declined' and old.status is distinct from new.status)`. **No `current_user`
  guard** — `085` §5.4 trap (a), and `087` is the worked example of that trap arriving by a second
  route.
- [ ] 2.6 Extend `private.retract_club_join_requested` to remove the decline row as well as the
  request rows, in **one** function, so a future writer of `status` inherits both halves. Keep the
  `type` conjunct on the existing half — it is what stops it eating the row 2.4 writes in the same
  transaction, and relying on trigger ordering instead is a guarantee nothing tests.
- [ ] 2.7 `016`'s club-avatar SELECT policy: replace it whole, adding the third disjunct with the
  **one-argument** `private.club_takes_join_requests(c.id)` and the
  `(storage.foldername(...))[2] = c.owner_id::text` binding carried verbatim. **Do not touch the
  covers policy.**
- [ ] 2.8 Restamp the two stale comments from 0.7, and `private.retract_club_join_requested`'s.
- [ ] 2.9 Verification footer: eleven types in both constraints; the three policy expressions
  identical and all carrying the disjunct; the trigger list on `club_join_requests` now **five**
  with only the gate carrying a `current_user` guard; gate count still **16**; advisors still
  **24** (this file adds none — assert it, because "one more definer function" is the natural wrong
  expectation); `notifications.club_id`'s FK still `on delete cascade`.

## 3. RLS assertions — `supabase/tests/rls_test.sql`

One per arm, including every negative. A policy change with no new assertion is not finished
(`openspec/config.yaml`).

### `088` — the roster

- [ ] 3.1 **088.1** `club_members` still has exactly **3** policies and none is UPDATE; and
  `has_table_privilege('authenticated','public.club_members','update')` is now **false**, with the
  column-privilege list scoped to `grantee='authenticated'` returning zero rows. Both halves — one
  alone lets the other's removal pass.
- [ ] 3.2 **088.2** An owner removes an admin ✓ and a member ✓.
- [ ] 3.3 **088.3** An admin removes a member ✓; an admin removing another admin raises
  `insufficient_privilege` ✗ and the row survives.
- [ ] 3.4 **088.4** An admin removing `clubs.owner_id` raises — asserted **twice**: once with an
  ordinary owner holding a `role='owner'` row, and once with `054`'s **ownerless owner** holding no
  row at all. The second is the one a role-only predicate fails.
- [ ] 3.5 **088.5** Every self-target raises: owner→self, admin→self, on all three RPCs.
- [ ] 3.6 **088.6** A plain member, and a rider in no club, are refused by all three with the
  identical message and SQLSTATE — so "not a member", "not your club" and "not an admin" are
  indistinguishable.
- [ ] 3.7 **088.7** Removing a rider who holds a stale `pending` request deletes the request row,
  a later `approve_club_join_request` on its id raises, and the admins' `club_join_requested`
  notification is gone (the delete-arm retraction fired).
- [ ] 3.8 **088.8** Promotion: owner ✓ writes the literal `'admin'` with `joined_at` unchanged;
  admin ✗; member ✗; both refuse `rider = clubs.owner_id`.
- [ ] 3.9 **088.9** Demotion: owner ✓ writes `'member'`; admin ✗; nobody may demote the owner.
- [ ] 3.10 **088.10** `019`'s rule intact: no client role can insert or update `role='admin'` on a
  public club, a private club or their own club.
- [ ] 3.11 **088.11** Grants by **role**, never by attempting the call — `authenticated` true and
  `anon` false on each of the three; PUBLIC's default EXECUTE gone on each; `prosecdef` and
  `proconfig` per function.
- [ ] 3.12 **088.12** No block conjunct: an admin who has blocked a member removes them
  successfully, with the same outcome as an unblocked removal. And `club_members` SELECT's qual is
  **unchanged**, asserted by equality.
- [ ] 3.13 **088.13** What a removed rider keeps — one assertion per row of `design.md` §What a
  removed rider keeps: postcard readable ✓, deletable ✓, **not editable** ✗; own club message still
  deletable ✓; own thread no longer deletable ✗; `ride_members` row survives while the private
  club's ride becomes unreadable; `feed_reads` UPDATE refused; the admins' `club_joined` row
  survives.
- [ ] 3.14 **088.14** Removal writes **zero** notifications, and the removed rider's reads are
  byte-identical to a rider who left voluntarily.
- [ ] 3.15 **088.15** Rejoin: public club, immediate ✓; private club, a fresh request is admitted by
  `club_takes_join_requests` and refused by nothing.
- [ ] 3.16 **088.16** `029`'s succession, at last reachable: an `admin` who joined **second**
  inherits ahead of a `member` who joined first; two admins are ordered by `joined_at`; the
  departing owner is **demoted**, not deleted (`032`); and the new owner can actually answer the
  club's pending requests.

### `089` — the decline and the avatar

- [ ] 3.17 **089.1** A decline writes exactly **one** notification, to the requester, with
  `actor_id = user_id`. **This replaces `085.26`** — do not delete that assertion, rewrite it, and
  reconcile the suite by label set so the rename is visible as a rename.
- [ ] 3.18 **089.2** Two declines from two clubs produce **two** rows. The property option B would
  have lost.
- [ ] 3.19 **089.3** The requester reads the row and its `actor_id` is their own id; no column
  anywhere names the responder.
- [ ] 3.20 **089.4** The type literal in the policy text equals the literal in
  `private.notify_club_join_request_declined`'s `prosrc`, extracted and compared as strings. The
  mitigation for the first per-type clause in a per-column policy.
- [ ] 3.21 **089.5** The three policy expressions are textually identical and all three carry the
  disjunct.
- [ ] 3.22 **089.6** **Type scoping, asserted per type**: a non-member of a private club holding a
  `club_joined`, `club_join_requested`, `club_join_request_approved` or `ride_created_in_club` row
  for it reads **zero**, unchanged. This is the assertion that proves this is not option C.
- [ ] 3.23 **089.7** The requester can mark it read and `unread_notification_count()` falls by one.
- [ ] 3.24 **089.8** A blocked requester: the fan-out writes **zero** rows, and an existing decline
  row stops being returned and stops being counted when a block appears afterwards.
- [ ] 3.25 **089.9** State changes: the club flips public → the row still resolves; the rider is
  later approved → still resolves; the club is deleted → the row is gone by cascade.
- [ ] 3.26 **089.10** The decline row survives the retraction firing beside it on the same event —
  asserted order-independently.
- [ ] 3.27 **089.11** An admin clearing a `declined` row removes the requester's decline
  notification, and a second rider's decline from the same club survives.
- [ ] 3.28 **089.12** The avatar: a discoverer reads **one** storage row for the avatar and **zero**
  for the cover; a blocked rider reads zero for both; a member and the owner are unchanged.
  **`085.6` is replaced on its avatar half and reproduced verbatim on its cover half.**
- [ ] 3.29 **089.13** The policy names the **one-argument** wrapper, and the two-argument `_for`
  twin is still revoked from `authenticated`.

## 4. Data and actions

- [ ] 4.1 `removeClubMember`, `promoteClubMember`, `demoteClubAdmin` in `src/lib/actions/clubs.ts`
  — plain async functions through `resolveSupabase`, each `.rpc(...)`, each claiming its
  invalidations per the `client-cache-invalidation` delta.
- [ ] 4.2 `clearClubJoinRequest(requestId, clubId)` in
  `src/lib/actions/club-join-requests.ts` — a plain `.delete()`, which `085`'s DELETE policy already
  permits an admin.
- [ ] 4.3 `getClubMembers` and `queryKeys.clubs.members(clubId)` are **reused**. Do not add a second
  read of the same rows.
- [ ] 4.4 `NOTIFICATION_SELECT` gains the raw `club_id` column — the destination for the decline row,
  since the `club:clubs(...)` embed returns null for it.
- [ ] 4.5 `getNotificationsPage` resolves declined clubs by **N parallel one-id
  `discoverable_private_clubs` calls** for the distinct declined `club_id`s on the page, reusing
  `getClubPreview`'s shape. No new accessor, no new advisor — `design.md` §Naming the club in a
  decline row rates the alternatives.
- [ ] 4.6 `toDiscoverableListItem` in `src/lib/data/clubs.ts` — **delete the `avatar_url: null`
  literal and the comment saying the object will not sign**, and pass the discovered rows through
  `resolveAvatarUrls`. Same in `getClubPreview`. Without this, `089`'s storage arm changes nothing
  a rider can see.
- [ ] 4.7 `keys.ts` reconciliation table gains the four mutations' claims, including the stated
  bound that the removed rider's own device is unreachable.

## 5. Screens

- [ ] 5.1 `routes.clubRiders` / `detailPaths.clubRiders` → `/clubs/detail/riders`.
- [ ] 5.2 `ClubOptionsMenu`: a `Manage riders` row, gated on
  `isOwner || viewerRole === 'admin'`. **`viewer_is_owner`, never `viewer_role === 'owner'`** — the
  ownerless owner is the one rider who most needs it.
- [ ] 5.3 The Manage riders page: the roster with per-rider actions in a `ContextMenu`, each drawn
  only where the authority matrix permits it, and `notFound()` for a non-admin.
- [ ] 5.4 Destructive confirmation per `client-render-shell`'s copy requirement — the public/private
  clause, and no claim that the rider is told or that their content goes.
- [ ] 5.5 **Move** `ClubJoinRequestsSection` from `src/app/(app)/clubs/detail/page.tsx` onto the new
  screen, unchanged, plus a `Clear` control on declined rows. Delete the section and its import from
  the club detail — one deletion, not a restructure (the territory comment says this file is shared
  with slot-2).
- [ ] 5.6 Extend the section's read to include `declined` rows so `Clear` has something to act on;
  `085`'s SELECT policy already returns them to an admin.
- [ ] 5.7 `notificationCopy` and `NotificationsListItem.describe` gain the eleventh arm — the club as
  the leading name and avatar, the destination from `row.club_id`, no action pair. `tsc` names both
  sites when `NotificationType` grows.
- [ ] 5.8 Every control disabled offline, never queued — `ClubJoinRequestsSection`'s existing rule.
- [ ] 5.9 A component test asserting the decline row never renders the reader's own name — the data
  shape makes the wrong rendering the natural one, which is exactly the class of invariant the eight
  existing component tests exist for.
- [ ] 5.10 Log the composed-rather-than-drawn screen in `docs/FIGMA-FIDELITY-TODO.md`. **No v2 frame
  exists** for Manage riders or for a per-rider destructive control; compose from measured
  components and say so rather than calling it measured.

## 6. Gates

- [ ] 6.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 6.2 `PGPASSWORD=postgres npm test` — the RLS suite. Reconcile against 0.3's label set, and
  expect **089.1 to appear as `085.26` renamed** rather than as a loss.
- [ ] 6.3 `npm run docs:check` after the `CLAUDE.md` advisor-table edit.
- [ ] 6.4 `npm run walk` against DEV with the relay, once the screens exist — it is the only gate
  that renders anything, and a screen that throws on load is green in every other one.

## 7. The hand-exercise gate, and the apply

- [ ] 7.1 **`088` does NOT fire `036`'s gate** — it hangs no trigger, and `club_members` carries no
  trigger on UPDATE or DELETE (0.4). Its removal path does reach `085`/`087`'s retraction through a
  new caller, so exercise it on DEV **in a rolled-back transaction** anyway: (a) removing a member
  who holds no request row; (b) removing one who holds a stale `pending` row; (c) removing one who
  holds a `declined` row.
- [ ] 7.2 **`089` DOES fire it.** Its fan-out hangs on `after update of status on
  club_join_requests`, whose live writer `decline_club_join_request` has been shipped on DEV since
  2026-08-28 — so from the moment it applies, every Decline runs new code inside the admin's own
  transaction and a raise there takes their answer down with it. Exercise on DEV in a rolled-back
  transaction, **before any code lands**: (a) a decline for a private club by its owner; (b) a
  decline by a non-owner admin; (c) a decline where the requester is blocked with the owner —
  expect the RPC to succeed and **zero** notification rows; (d) an admin clearing a declined row;
  (e) an approval, to confirm the new trigger's `when` clause leaves it alone.
- [ ] 7.3 Apply `088` to DEV, then run 6.2 and the 1.11 footer.
- [ ] 7.4 Apply `089` to DEV, then run 6.2 and the 2.9 footer, then re-derive the advisors.
- [ ] 7.5 **PROD, and the order is the whole of this task.** `088` before the promotion build
  serves; `089` **after** `app.letsride.social` resolves to a `READY` deployment on the promotion
  sha with `aliasError` null. "Merged" is not "deployed" — `070`'s header, and DEV is the worked
  example of getting it backwards.

## 8. Docs — main thread, not a subagent

- [ ] 8.1 `CLAUDE.md`'s advisor table: **21 → 24**, naming `remove_club_member`,
  `promote_club_member` and `demote_club_admin`, and stating that `089` adds none because its
  fan-out is in `private`.
- [ ] 8.2 `CLAUDE.md`'s applied-state paragraph and the migration count.
- [ ] 8.3 `docs/reference/schema.md` — the `club_members` row (the RPCs are now its only role writer;
  no UPDATE grant and no UPDATE policy) and the `club_join_requests` row (the decline notification
  exists now, and removal deletes stale rows).
- [ ] 8.4 Scope the doc edit to those rows. Another session holds `docs/reference/` for other files.

## 9. Close-out

- [ ] 9.1 `reviewer` on the final diff, before the PR. Non-negotiable.
- [ ] 9.2 PR to `development`, merged in the same session. Both Linear issues to `Deployed to DEV`
  only once it is actually running there.
- [ ] 9.3 **`/opsx:archive show-private-clubs-and-request-to-join` FIRST, then this change.** The
  reverse folds out a standing spec saying *"there SHALL be no `club_join_request_declined` type"*
  that the shipped code contradicts. Do not archive while the RLS suite is failing.
