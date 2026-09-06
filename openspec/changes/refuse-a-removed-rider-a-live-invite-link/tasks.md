# Tasks

**This change writes no application code.** There is no task under `src/` on purpose — see
`proposal.md` under Impact. A task list that reaches into `src/` for this change is a task list
building something nobody asked for.

**Two files here belong to another session's declared territory at the time of writing** —
`supabase/migrations/**` and `supabase/tests/rls_test.sql`. The firing that picks this up must
confirm the territory is free before starting group 1.

## 0. Before a line is written

- [ ] 0.1 Settle **PD-406** — DEV records an applied `a_club_may_outlive_its_last_member`
      (`20260905203011`) with no file in the repo. Resolving it is the owner's, and the migration
      number for this change cannot be picked until it is. Do not invent a number to unblock
      yourself.
- [ ] 0.2 Re-derive the next number from the repo and both projects together:
      `ls supabase/migrations/*.sql | tail -3` against `list_migrations` on DEV
      (`fpmrimzxadewsaiwpsel`) and PROD (`zwprydcyryvudhurbnye`).
- [ ] 0.3 Record the **before** numbers, because every claim in group 6 is a delta against them:
      `get_advisors(security)` on DEV; and
      `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal;`
      (**21** when this was written).
- [ ] 0.4 Re-read `private.club_invite_link_reachable_by` and `public.remove_club_member` off the
      live database rather than from the migration files, and confirm neither has been replaced
      since. A `create or replace` written against a stale body silently reverts whatever replaced
      it.
- [ ] 0.5 Confirm `public.club_removals` still does not exist on either project.

## 1. The migration — the table

- [ ] 1.1 Create `public.club_removals` — `club_id uuid not null references public.clubs(id) on
      delete cascade`, `user_id uuid not null references public.profiles(id) on delete cascade`,
      `removed_at timestamptz not null default now()`, `primary key (club_id, user_id)`. **No
      `removed_by` column** — see `design.md` D4.
- [ ] 1.2 `alter table public.club_removals enable row level security;` and add **no policy**.
- [ ] 1.3 `revoke all on table public.club_removals from public, anon, authenticated;` — the posture
      the spec asserts, written explicitly rather than relied on as a default.
- [ ] 1.4 **No `enforce_participation_gate` trigger on this table**, and say so in the file: there
      is no `authenticated` writer for it to gate, and adding one raises the gate count while
      gating nothing.
- [ ] 1.5 `comment on table` and `comment on column` for all three columns, stating that this is a
      **bar and not a log**, what ends it, why there is no actor column, and which single predicate
      reads it. The next reader meets this table through `list_tables`, and no edit to `CLAUDE.md`
      reaches them.
- [ ] 1.6 State the migration's own ordering in its header: additive, no bundle to sequence against,
      and the hand-exercise gate DOES fire (group 4).

## 2. The migration — the three function changes

- [ ] 2.1 `private.clear_club_removal_on_join()` — a trigger function that deletes the removal row
      for `new.club_id, new.user_id`. **No `WHEN` clause on the trigger**, so it fires for
      `security definer` writers too; state that choice in the file, per the standing integrity
      requirement that a trigger's guard is a recorded decision.
- [ ] 2.2 `create trigger ... after insert on public.club_members for each row execute function
      private.clear_club_removal_on_join();` — beside the existing `notify_club_joined`.
- [ ] 2.3 `revoke all on function private.clear_club_removal_on_join() from public, anon,
      authenticated;`
- [ ] 2.4 `create or replace function private.club_invite_link_reachable_by(text, uuid, boolean)`
      with the eighth conjunct from `design.md` D1, the other seven **byte-identical**, and the
      signature unchanged.
- [ ] 2.5 `create or replace function public.remove_club_member(uuid, uuid)` with the idempotent
      upsert from `design.md` D2 — after the authority block, beside the existing two deletes,
      everything else unchanged, no new raise site.
- [ ] 2.6 Restamp `comment on function` for both replaced functions. A stale comment describing the
      old body is worse than none, and both comments are load-bearing prose other files cite.
- [ ] 2.7 Re-assert the grants on both replaced functions in the same file — `create or replace`
      preserves them, but writing them keeps the file readable as the whole statement of the
      object's posture.

## 3. Assertions in `supabase/tests/rls_test.sql`

Every scenario in `specs/` maps onto one of these. **A policy or predicate change with no new
assertion is not finished.**

- [ ] 3.1 The reported defect: an admin removes a rider, the rider re-opens the same live token, the
      preview returns zero rows and the claim reaches the existing single raise site.
- [ ] 3.2 A **newer** link, minted after the removal, is refused for the same rider — and admits a
      different eligible rider.
- [ ] 3.3 A link into a **different** club still admits them.
- [ ] 3.4 A rider who **left voluntarily** claims a live link and is admitted; assert that **zero**
      removal rows exist for that pair.
- [ ] 3.5 Readmission clears the record, by **each** route separately: an approved join request, an
      accepted in-app invite, and a public club's Join button. Then leaving voluntarily and claiming
      a link succeeds.
- [ ] 3.6 The negative assertions that prove the narrow reading: a removed rider's join request is
      created and approvable, and an in-app invite to them is sendable and acceptable. Both assert
      admission, not merely the absence of an error.
- [ ] 3.7 Grants: `anon` and `authenticated` hold **nothing** on `club_removals` — scoped to those
      grantees, or `has_table_privilege`, never a table-wide count.
- [ ] 3.8 Reads: the club's owner, an admin, a member and the removed rider each fail to select from
      `club_removals`.
- [ ] 3.9 The owner and self-removal refusals are unchanged, and write **zero** removal rows; the
      whole actor/target permission table still holds.
- [ ] 3.10 An unauthorised removal attempt writes zero removal rows.
- [ ] 3.11 Cascades from both ends: deleting the club, and deleting the rider's profile, each erase
      the row.
- [ ] 3.12 The dead-state assertion moves from **eleven to twelve** states, comparing the **message**
      and not only the SQLSTATE, and the removed rider's answer is byte-identical to the expired
      one.
- [ ] 3.13 `prosrc` for both public RPCs contains no `club_removals` reference — the existing
      single-site assertion, extended by one name.
- [ ] 3.14 The participation-gate count is asserted **by delta and by table name**, not by absolute:
      `club_removals` is absent from the gated list and the count is unchanged.
- [ ] 3.15 Deleting a club writes no removal rows.
- [ ] 3.16 Reconcile the suite by **label set**, not by count — a count cannot tell a rename from a
      loss.

## 4. The hand-exercise gate, on DEV, before the migration applies

The trigger hangs new code on **every club join in the app**, and the RPC change on every removal.
Each of these is exercised by hand, in a rolled-back transaction, as `authenticated`, **counting
rows rather than assuming them**.

- [ ] 4.1 Join a public club with the Join button.
- [ ] 4.2 Approve a join request.
- [ ] 4.3 Accept an in-app club invite.
- [ ] 4.4 Claim an invite link.
- [ ] 4.5 Create a club — the creator's own membership row is written by a database path, and it
      fires this trigger too.
- [ ] 4.6 Remove a rider, then remove the same rider again after readmitting them, and confirm
      neither raises and one row results.
- [ ] 4.7 For each of 4.1–4.5, count the `notifications` rows the existing fan-out produces and
      confirm the number is unchanged by the new trigger.

## 5. Apply, and verify against the live database

- [ ] 5.1 Apply to DEV. If the file is too large to pass as a string, apply it reduced and prove it
      by **object diff**, never by comparing the recorded statement text.
- [ ] 5.2 `PGPASSWORD=postgres npm test` — the full RLS suite, green.
- [ ] 5.3 Re-run every group 4 exercise against the applied database, for real this time.
- [ ] 5.4 Walk the claim path end to end on DEV with a removed rider and confirm the rendered copy is
      the existing `This invite link is no longer valid.` with no new branch.

## 6. The claims this change makes about the database

- [ ] 6.1 `get_advisors(security)` on DEV: exactly **+1 INFO** (`rls_enabled_no_policy` on
      `club_removals`) against 0.3's number, and **+0 WARN**. An
      `authenticated_security_definer_function_executable` appearing means something was created in
      `public` that belongs in `private` — treat it as a defect, not as an expected cost.
- [ ] 6.2 Participation-gate triggers: unchanged at 0.3's number.
- [ ] 6.3 `npx vitest run src/lib/data/__tests__/embed-hints.test.ts` — green, confirming the new
      junction between `clubs` and `profiles` breaks no embed.
- [ ] 6.4 `npm run test:unit` and `npx tsc --noEmit` — both green with no `src/` diff, which is
      itself the check that no client surface crept in.
- [ ] 6.5 `git diff --stat origin/development -- src/` prints **nothing**.

## 7. Handover — what the main thread writes, not this change

- [ ] 7.1 `docs/reference/schema.md` gains a `club_removals` row carrying the audience predicate
      (nobody), the cascades and the retention window, plus a line under `remove_club_member`.
- [ ] 7.2 `docs/reference/migrations.md` records the file, its ordering and its advisor delta.
- [ ] 7.3 `CLAUDE.md`'s advisor accounting gains one INFO. **Agents do not write `CLAUDE.md` or the
      handoff — the main thread does.**
- [ ] 7.4 Report to the owner, in one line each: which of `proposal.md`'s four open questions were
      answered by building the defaults, and that the pending-invite question is still theirs.
- [ ] 7.5 The PROD promotion carries the same ordering as the DEV apply and needs no separate
      sequencing decision, because no bundle changes with it. Record it in the per-file log.
