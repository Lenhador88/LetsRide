-- 079: the "All new" tile counts a rider's own postcard, and the club badge
--      next to it no longer does. PD-270.
--
-- 068 gave `club_unread_counts()` an `author_id <> auth.uid()` arm so posting
-- into a club stops badging that club. It did not touch `countUnseenPostcards`
-- in `src/lib/data/postcards.ts` — the query behind the "All new" tile on
-- `/postcards` — which counts every postcard newer than the app-wide watermark,
-- the rider's own included. The result: compose a postcard into a club, land
-- back on `/postcards`, and the club shows no badge while the tile right next
-- to it reads `+1` for the thing just written. Two screens, one tap apart,
-- disagreeing about the same rule.
--
-- PD-270 names three routes and picks the second: move the count into a
-- `security invoker` function beside `club_unread_counts()`, the same shape
-- 068 already gave that one. The reasoning is about EVIDENCE, not effort.
-- `club_unread_counts()` is a database function, so the RLS suite pins it —
-- 068.2 includes the negative case proving the exclusion is not vacuous, and
-- this file's assertions below do the same. `countUnseenPostcards` was a
-- client-side query under the caller's own session, and nothing in
-- `supabase/tests/` can reach a query that never leaves the browser — a unit
-- test against a stubbed client would prove only that the query was *built*
-- with a predicate, never that the predicate matches what `club_unread_counts`
-- enforces. Putting both counts in the database makes them agree BY
-- CONSTRUCTION, under the one gate that can hold either of them.
--
-- `security invoker`, not `security definer` — deliberate, and the same
-- argument 068 and 036 already made for their own counts. The count must run
-- under the caller's own RLS, so a blocked author, a hide, or a private club
-- the caller has left all fall out of the count for the same reason they fall
-- out of the feed. `security definer` would need the read policy's three
-- branches (author, block, club membership) re-implemented inside the
-- function instead of inherited from it — the drift `036` §147-149 warns
-- about — and it would add an `authenticated_security_definer_function_executable`
-- advisor this repo does not otherwise carry for a plain read.

-- The cap of 100 mirrors the bound `club_unread_counts()` and
-- `unread_notification_count()` already apply to their own scans — a badge is
-- allowed to read "99+" in spirit, never to walk an unbounded table on every
-- render of the home screen. `src/lib/data/postcards.ts`'s own client-side
-- `UNSEEN_SCAN_LIMIT` goes with the query this file replaces — the cap now
-- lives only here, beside the count it bounds. Read through
-- `postcards_created_at_idx (created_at desc)`, which needs no new index: the
-- author predicate is not the index's leading column, exactly as
-- `club_unread_counts()`'s own `author_id <> auth.uid()` arm is not on
-- `postcards_club_id_idx`.
--
-- No watermark means everything unseen, matching `countUnseenPostcards`'s own
-- documented rule and `club_unread_counts()`'s NULL branch: a rider who has
-- never visited the app-wide feed has genuinely not seen any of it, so the
-- comparison collapses to `created_at > '-infinity'`, which every real
-- timestamp satisfies.
create function public.count_unseen_postcards()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from (
      select 1
        from public.postcards p
       where p.author_id <> auth.uid()
         and p.created_at > coalesce(
           (select r.last_seen_at from public.feed_reads r
             where r.user_id = auth.uid() and r.club_id is null),
           '-infinity'::timestamptz
         )
       limit 100
    ) capped;
$$;

comment on function public.count_unseen_postcards() is
  'The "All new" tile''s count on /postcards (079) — postcards newer than the caller''s app-wide watermark (feed_reads, club_id is null), or all of them if there is none yet. SECURITY INVOKER, so RLS decides what is counted: a blocked author, a hide, or a club the caller cannot read all fall out the same way they do off the feed itself. Excludes the caller''s own postcards, matching club_unread_counts() (068) — replaces the equivalent client-side query in countUnseenPostcards, src/lib/data/postcards.ts, which nothing in supabase/tests/ could pin.';

-- No client role holds table-level SELECT on `postcards` (062 revoked it down
-- to a column grant), so this function needing no elevated rights is not
-- optional the way it might read on a table with an open grant — but the
-- revoke is still explicit and still free, matching `stamp_feed_read()`,
-- `unread_notification_count()` and `club_unread_counts()`: Postgres checks
-- EXECUTE on a plain function at CALL time, so a client with no explicit grant
-- gets `42501` rather than silently succeeding.
revoke all on function public.count_unseen_postcards() from public, anon;
grant execute on function public.count_unseen_postcards() to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: f — no elevated rights, matching club_unread_counts() and
-- unread_notification_count()
--   select prosecdef from pg_proc where proname = 'count_unseen_postcards';
--
-- Expected: t then f
--   select has_function_privilege('authenticated', 'public.count_unseen_postcards()', 'execute'),
--          has_function_privilege('anon', 'public.count_unseen_postcards()', 'execute');
--
-- Expected: the same THIRTEEN advisors CLAUDE.md's table names, with
-- auth_leaked_password_protection still the only outstanding one. A fourteenth
-- means the revoke above did not land, or the function was written `definer` —
-- in which case it would be a second `authenticated_security_definer_function_
-- executable` WARN, that advisor firing once per such function. (Ten was the
-- count before 078 added two; measured 2026-08-25 after this file applied.)
--   mcp__Supabase__get_advisors  type=security
--
-- Nothing about `feed_reads`, `club_unread_counts()` or any policy changes in
-- this file — this adds one function and its grants, nothing else.
