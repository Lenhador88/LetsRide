-- 110: A ride thread's read watermark stops being an existence oracle.
--
-- Linear PD-402, following 108. One statement per policy, two policies, one
-- table. No new object, no new function, no grant change, no data change.
--
-- ===========================================================================
-- WHAT IT CLOSES
-- ===========================================================================
-- `108` §3a gave `public.ride_thread_reads` three policies whose predicate is
-- `user_id = auth.uid()` and nothing else — SELECT, INSERT and UPDATE alike.
-- The SELECT half is correct and stays. ** The two WRITE halves turned an INSERT
-- into an existence oracle for a thread id: **
--
--   * a `thread_id` that names no row raises 23503 on the foreign key
--   * a `thread_id` that names a real thread the caller CANNOT SEE succeeds
--
-- so any signed-in rider holding a uuid could tell the two apart and learn that
-- it names a live ride thread. It discloses existence only — never a title, a
-- message, an author or a ride — but it is exactly the hazard `015` §2 named and
-- `081` §2 closed, and `108` shipped it knowingly with the cost written into its
-- own header.
--
-- ===========================================================================
-- WHY `108` GOT IT WRONG, STATED SO IT IS NOT RE-DERIVED
-- ===========================================================================
-- `tasks.md` 2.9 said "own rows only … top level, **no** ride-visibility
-- conjunct" and named `club_thread_reads` as the model. Those two halves
-- contradict each other, and the instruction was followed rather than the model.
-- Measured on DEV before this file:
--
--   club_thread_reads  INSERT/UPDATE with_check:
--     (user_id = auth.uid()) AND EXISTS (SELECT 1 FROM club_threads d
--        WHERE d.id = ...thread_id AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = d.club_id)
--          AND private.is_club_member(d.club_id))
--
--   feed_reads         INSERT/UPDATE with_check:
--     (user_id = auth.uid()) AND (club_id IS NULL OR private.is_club_member(club_id))
--
--   ride_thread_reads  INSERT/UPDATE with_check:
--     (user_id = (SELECT auth.uid()))                        -- and nothing else
--
-- ** `ride_thread_reads` was the ONLY read-watermark table in the schema with no
-- audience conjunct on its write side. ** So 2.9's instruction is right about
-- SELECT — own-rows-only and conjunct-free, where all three tables agree — and
-- wrong about the write side, measured against the very table it cites. This
-- file implements that instruction's stated intent rather than reversing a
-- decision, which is the distinction that makes it a fix and not a re-opening.
--
-- ** `034`'s reason for the conjunction does NOT transfer, and inheriting it
-- would be worse than inheriting nothing: a WITH CHECK grants no reads. ** What
-- transfers is `015` §2's, which is about the foreign key and the oracle. `081`
-- §2 says the same in its own words; this is the third time the argument has had
-- to be written down, which is why it is written here in full rather than cited.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY NOT TOUCHED
-- ===========================================================================
-- ** The SELECT policy. ** A watermark is a fact about the READER rather than
-- about the content: it holds a thread id, a rider id and a timestamp, and no
-- title, body or author. Narrowing the read would mean an ex-crew rider could
-- not see their own row, for no disclosure gain.
--
-- ** The UPDATE policy's USING clause. ** `081` §3's asymmetry, for `061`'s
-- reason: USING scopes which rows may be REACHED and WITH CHECK what they may
-- BECOME. Adding the audience to USING would stop a rider who has left the crew
-- from reaching their own stale row — which changes nothing they can DO, since
-- the WITH CHECK refuses the write either way, and would make the policy harder
-- to read than the rule it encodes. ** It would also be a lockout rather than a
-- tightening **, so it is refused explicitly rather than omitted quietly.
--
-- ** No grant changes. ** `108` §3b's `select, insert, update` to `authenticated`
-- stands; the table grant was never the gate here.
--
-- ** No DELETE policy appears. ** Still none, still no grant, for `108`'s reason.
--
-- ===========================================================================
-- ORDERING: NOT SENSITIVE, AND THAT IS A MEASURED CLAIM RATHER THAN A HOPE
-- ===========================================================================
-- ** This file may apply before or after `109`, and before or after the bundle
-- deploys. There is no third ordering to hold. ** `109` is the destructive half
-- of PD-402 and is gated on the new bundle being confirmed SERVING; this file
-- shares none of that, for one reason:
--
--   ** The only code that writes `ride_thread_reads` is in the same unmerged PR
--   that creates the table, and it marks a thread the rider has just READ. **
--
-- A caller that could read the thread satisfies `private.is_ride_crew` and the
-- `rides` EXISTS by construction, so the tightened predicate refuses no write
-- any bundle — current or future — actually issues. There is no PGRST204 case
-- (no column moves), no PGRST202 case (no function moves), no PostgREST
-- relationship added, and no shipped client to fail closed against.
--
-- It touches no policy, grant or trigger that `109` reads or writes, so the two
-- commute. ** They will nonetheless be recorded on DEV out of filename order **
-- — `108`, then `110`, then `109` when its gate opens — because the recorded
-- version is an apply-time timestamp. That is the norm this repo already carries
-- on PROD, `npm run db:drift` compares migration NAMES rather than versions, and
-- the RLS suite replays the chain in FILENAME order, where `110` following `109`
-- is equally valid because neither touches the other's objects.
--
-- Security advisors: ** ZERO change. ** This file publishes no function, creates
-- no table and alters no grant. DEV read 41 after `108` and must read 41 after
-- this. A 42nd means something else landed.

-- ===========================================================================
-- §1. The write side gains the audience it should have had
-- ===========================================================================
-- `alter policy` rather than drop-and-recreate, deliberately: the name, the
-- command and the role list are unchanged, so a replace is available, and a
-- dropped-and-recreated policy is an opportunity to lose the `to authenticated`
-- clause silently. `082` §7 is the worked example of what a drop costs on a
-- FUNCTION; the same care is cheap here.
--
-- The predicate is `108` §2's message-INSERT conjunction with the author test
-- swapped for the watermark's owner test — deliberately the SAME shape as the
-- content tables, reaching `rides` through the thread's `ride_id`, so that
-- "may I mark this read" resolves to "may I read this" and cannot drift from it:
--
--   user_id = auth.uid()                     it is my own watermark
--   exists (... ride_threads t ...)          the thread exists AND
--     exists (... rides r ...)                 I can see its ride, as the caller
--     private.is_ride_crew(t.ride_id)          and I am on its crew
--
-- ** The inner `rides` EXISTS is not decoration here either. ** Without it a
-- rider who blocked the organizer, or who left the private club, keeps a crew
-- row and could still write a watermark against a ride they can no longer see —
-- the same half-conjunction that made `034`'s first draft a leak, arriving at a
-- third table.
alter policy "Riders mark only their own ride threads read"
  on public.ride_thread_reads
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.ride_threads t
       where t.id = ride_thread_reads.thread_id
         and exists (select 1 from public.rides r where r.id = t.ride_id)
         and private.is_ride_crew(t.ride_id)
    )
  );

-- The upsert's UPDATE arm. ** Only WITH CHECK is named, so USING keeps `108`'s
-- `user_id = (select auth.uid())` untouched ** — see the header for why
-- narrowing it would be a lockout rather than a tightening.
alter policy "Riders advance only their own ride thread watermarks"
  on public.ride_thread_reads
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.ride_threads t
       where t.id = ride_thread_reads.thread_id
         and exists (select 1 from public.rides r where r.id = t.ride_id)
         and private.is_ride_crew(t.ride_id)
    )
  );

comment on table public.ride_thread_reads is
  'Per-thread read watermark on a ride (108, PD-402; write side tightened by 110). One row per (rider, thread); last_read_at is server-imposed by public.stamp_ride_thread_read() on INSERT and UPDATE, never client-supplied — not for tamper-resistance but because it is compared against ride_thread_messages.created_at, which is server-owned, and a comparison spanning a phone''s clock and the database''s is wrong in a way nothing logs (068). ** SELECT is `user_id = auth.uid()` and nothing wider **: readable ONLY by the row''s owner, because this app has no read receipts and that is a refusal rather than an omission — and with no visibility conjunct, so a rider who leaves the crew keeps their own row rather than stranding it. ** INSERT and UPDATE carry the FULL audience in their WITH CHECK ** — the ride_threads EXISTS, the rides EXISTS resolved as the caller, and private.is_ride_crew — mirroring club_thread_reads (081 §2). 108 shipped them conjunct-free and that made the INSERT an existence oracle: a nonexistent thread_id raises 23503 while an existing-but-invisible one succeeded, which is 015 §2''s hazard. The UPDATE''s USING clause is deliberately NOT narrowed (061/081''s asymmetry): USING scopes which rows may be reached and WITH CHECK what they may become, and narrowing USING would stop an ex-crew rider reaching their own stale row while changing nothing they can do. Retention is indefinite: it dies with the thread or the rider, through the two cascades and nothing else.';

-- ===========================================================================
-- §Verification — run against the project after applying, do not assume
-- ===========================================================================
--
--   -- Both write policies now name the audience; SELECT still does not.
--   select polname, polcmd,
--          pg_get_expr(polqual, polrelid)      as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as with_check
--     from pg_policy where polrelid = 'public.ride_thread_reads'::regclass
--    order by polcmd;
--   -- SELECT (r): using = (user_id = ( SELECT auth.uid())), with_check = null
--   -- INSERT (a): using = null, with_check names ride_threads, rides, is_ride_crew
--   -- UPDATE (w): using = (user_id = ( SELECT auth.uid())) -- UNCHANGED
--   --             with_check names ride_threads, rides, is_ride_crew
--
--   -- t, t, t, t — both write arms carry all three conjuncts
--   select bool_and(pg_get_expr(polwithcheck, polrelid) like '%ride_threads t%'),
--          bool_and(pg_get_expr(polwithcheck, polrelid) like '%rides r%'),
--          bool_and(pg_get_expr(polwithcheck, polrelid) like '%is_ride_crew%'),
--          bool_and(pg_get_expr(polwithcheck, polrelid) like '%user_id = %')
--     from pg_policy
--    where polrelid = 'public.ride_thread_reads'::regclass and polcmd in ('a','w');
--
--   -- f — ** the SELECT policy did NOT acquire one. ** The lockout tripwire.
--   select pg_get_expr(polqual, polrelid) like '%is_ride_crew%' from pg_policy
--    where polrelid = 'public.ride_thread_reads'::regclass and polcmd = 'r';
--
--   -- f — and neither did the UPDATE's USING clause, for the same reason
--   select pg_get_expr(polqual, polrelid) like '%is_ride_crew%' from pg_policy
--    where polrelid = 'public.ride_thread_reads'::regclass and polcmd = 'w';
--
--   -- INSERT,SELECT,UPDATE — the command set is unchanged, and still no DELETE
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'ride_thread_reads';
--
--   -- t, f — the grants are unchanged: still writable by authenticated,
--   -- still nothing to anon, still no DELETE
--   select has_table_privilege('authenticated','public.ride_thread_reads','insert'),
--          has_table_privilege('authenticated','public.ride_thread_reads','delete');
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'ride_thread_reads' and grantee = 'anon';        -- 0
--
-- And the advisors: `get_advisors(security)` must be UNCHANGED at 41 on DEV.
-- This file publishes no function and creates no table, so a move in either
-- direction is something else.
--
-- ===========================================================================
-- §Rollback
-- ===========================================================================
--   alter policy "Riders mark only their own ride threads read"
--     on public.ride_thread_reads with check (user_id = (select auth.uid()));
--   alter policy "Riders advance only their own ride thread watermarks"
--     on public.ride_thread_reads with check (user_id = (select auth.uid()));
--   -- and restore 108's table comment.
-- That returns the oracle, so a rollback is a decision rather than a repair.
