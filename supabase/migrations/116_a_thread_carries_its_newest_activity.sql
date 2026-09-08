-- 116: a club thread and a ride thread carry `last_activity_at`, a real,
--      indexable, pageable sort key for "newest activity". PD-439.
--
-- Today a thread draws TWO rows on its timeline — one at the thread's
-- `created_at` and one at its newest reply's — because neither thread table has
-- a column meaning "newest activity". The product owner wants ONE row per
-- thread, at its newest activity, so an old thread with a fresh reply bumps to
-- the top instead of sinking.
--
-- ** THE CLIENT CANNOT DERIVE THIS, AND THE REASON IS PAGING. ** A ride thread
-- list is unpaged, so a bounded message window happens to contain every reply
-- and `max(created_at)` is computable in the browser. A CLUB thread list PAGES.
-- A thread whose newest reply falls outside the fetched window has NO KNOWN
-- POSITION — not a wrong one, an absent one — and no amount of client work
-- recovers it, because the ordering key has to exist before the page boundary
-- is chosen. Hence a column, and hence an index whose leading edge is the
-- parent id so the page can be cut on it.
--
-- ---------------------------------------------------------------------------
-- Measured starting state — read on DEV fpmrimzxadewsaiwpsel 2026-09-08 at
-- write time, not inherited from a doc
-- ---------------------------------------------------------------------------
--   club_threads          12 rows   ( 7 of them have at least one message)
--   club_messages         13 rows
--   ride_threads           2 rows   ( 1 of them has at least one message)
--   ride_thread_messages   2 rows
--
--   relacl / attacl, the fact the whole grant argument rests on:
--     club_threads   relacl authenticated=rd    attacl INSERT on
--                    (id, club_id, author_id, title); SELECT additionally
--                    named on (introduces_user_id, introduction) by 097
--     ride_threads   relacl authenticated=r     attacl INSERT on
--                    (id, ride_id, author_id, title)
--
--   ** SELECT IS TABLE-LEVEL (`r` in relacl) AND INSERT IS COLUMN-LEVEL. ** Both
--   halves matter and they point in opposite directions:
--     * SELECT being table-level means the new column is READABLE the instant it
--       exists. No `grant select` appears below and none is needed — and if one
--       were needed its absence would be invisible until PostgREST answered 42501
--       on the client's `order=last_activity_at.desc`.
--     * INSERT being column-level means the new column is BORN UNWRITABLE. The
--       lists are restated in §4 anyway; see there for why.
--
--   POLICIES: club_threads has SELECT, INSERT, DELETE. ride_threads has SELECT,
--   INSERT. ** NEITHER TABLE HAS AN UPDATE POLICY AT ALL. **
--
-- ---------------------------------------------------------------------------
-- Why the trigger function is `security definer`, CHECKED rather than assumed
-- ---------------------------------------------------------------------------
-- The rider inserting a message is refused an UPDATE on the parent thread
-- TWICE OVER, and the two refusals have different shapes:
--
--   1. THE GRANT. `has_table_privilege('authenticated','public.club_threads',
--      'UPDATE')` is false and no column carries an UPDATE `attacl`. A
--      `security invoker` trigger raises 42501 inside the rider's own INSERT —
--      so every reply in every club thread would fail, loudly.
--   2. THE POLICY. Even with a grant there is no UPDATE policy on either table,
--      so RLS would filter the UPDATE to ZERO ROWS — silently. That is the worse
--      of the two: the reply succeeds, the column never moves, and nothing
--      anywhere reports it.
--
-- So `security definer` is required, and both functions live in the `private`
-- schema rather than `public`. That is this repo's convention for such helpers
-- (`private.is_blocked`, `private.is_club_member`, `private.notify_*`) and it is
-- also what keeps CLAUDE.md's advisor accounting true: the Supabase linter's
-- `authenticated_security_definer_function_executable` counts `security definer`
-- functions in the EXPOSED schema, and `private` is not published by PostgREST.
-- ** THIS FILE MUST MOVE THE ADVISOR COUNT BY ZERO. ** DEV baseline immediately
-- before applying, from get_advisors(security): 3 INFO rls_enabled_no_policy,
-- 1 WARN anon_security_definer_function_executable, 38 WARN
-- authenticated_security_definer_function_executable, 1 WARN
-- auth_leaked_password_protection. 085's eight `private` functions adding zero
-- advisors is the measured precedent.
--
-- Each function writes exactly `new.thread_id`'s row and nothing else. Neither
-- reads `auth.uid()`, because neither makes an authorization decision: the
-- authorization already happened when RLS admitted the message.
--
-- ---------------------------------------------------------------------------
-- `greatest`, and what it is actually defending against
-- ---------------------------------------------------------------------------
-- The stamp is `greatest(last_activity_at, new.created_at)`, never a bare
-- assignment. `club_messages.created_at` and `ride_thread_messages.created_at`
-- are server-owned (not in either INSERT grant, `default now()`), so a rider
-- cannot hand-pick one — but a backfilled row, a seed, a restore, an Edge
-- Function or a future server-side writer can insert a message whose
-- `created_at` is older than the thread's current activity, and a bare
-- assignment would move the thread BACKWARDS down the timeline. `greatest` makes
-- the column monotonic by construction rather than by the discipline of every
-- future writer.
--
-- ---------------------------------------------------------------------------
-- DECISIONS, IMPLEMENTED AS STATED — do not relitigate these in a later file
-- ---------------------------------------------------------------------------
--
-- ** 1. THE ANNOUNCEMENT EXCLUSION LIVES IN THE READ, NOT IN THIS TRIGGER. **
-- `club_threads.introduces_user_id` marks an introduction, and `getClubThreads`
-- and `getClubThreadReplies` already filter it out IN THE QUERY (PD-372's fix;
-- `ANNOUNCEMENT_MARKER` in src/lib/data/club-threads.ts documents why it is
-- PRESENTATION and never AUDIENCE). So the trigger stamps every thread
-- uniformly and the column then honestly means "newest activity" for every row;
-- an announcement's bumped column is simply never read.
--
-- A trigger that special-cased the marker would put a presentation rule in the
-- database, and it would be WRONG THE DAY an ex-member's introduction becomes an
-- ordinary thread — `097` NULLs `introduces_user_id` on leave, at which point a
-- thread that had been skipped by the trigger would carry a stale, too-old
-- `last_activity_at` and sink beneath threads it is newer than, with no writer
-- left to correct it. The read-side filter has no such failure mode: it
-- re-evaluates on every query.
--
-- ** 2. A DELETED MESSAGE DOES NOT UN-BUMP A THREAD. ** There is deliberately no
-- AFTER DELETE trigger on either message table. Recomputing would cost a
-- `max(created_at)` scan of the thread's messages on every moderation action,
-- every `delete_own_club_message`, every `delete_own_ride_thread_message` and
-- every cascade — inside the deleting transaction — and the activity genuinely
-- happened. A thread whose newest reply was removed keeps the position that
-- reply earned it, until the next reply moves it. Stated here as a decision so
-- it is not later discovered and "fixed".
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
--   * ** No index is dropped. ** `club_threads_club_id_idx` (club_id,
--     created_at desc, id desc) and `ride_threads_ride_id_idx` (ride_id,
--     created_at desc) stay exactly as they are. Dropping one is destructive,
--     needs a coordinated deploy, and is not this change.
--   * ** No policy is added, removed or edited **, on any table. The audience of
--     a thread and of a message is untouched: `private.is_club_member`,
--     `private.is_ride_crew` and `private.is_blocked` all still decide it, and a
--     bumped thread is bumped only for riders who could already read it.
--   * ** No `updated_at`. ** `last_activity_at` is not an edit stamp and must not
--     be read as one; thread bodies are not editable in this schema.
--   * ** No change to `club_messages` or `ride_thread_messages` ** beyond one
--     AFTER INSERT trigger each. No column, no grant, no policy.
--   * ** No participation-gate trigger. ** No table is added, so the gate's
--     coverage and count are unchanged.
--   * ** Nothing anywhere in `supabase/` or `src/` reads a "last activity"
--     notion today ** — `grep -rn last_activity` over the repo returns nothing
--     before this file. This column has no existing reader to break.
--
-- RETENTION AND REACH: no new table and no new personal data. `last_activity_at`
-- is a derived timestamp on an existing row, carrying no more about a subject
-- than the message rows it is computed from. Account deletion's reach is
-- unchanged — both thread tables are already covered through the cascades from
-- `profiles`, and this column goes with the row.
--
-- OFFLINE WRITES: nothing to set. The column is server-owned, so a replayed
-- message insert re-derives it; both message tables already accept a
-- client-generated `id`, which is what makes the replay idempotent.
--
-- CONCURRENCY, stated because it is new behaviour: two replies to the SAME
-- thread now serialize on that thread's row for the remainder of their
-- transactions. Replies to different threads do not interact. There is no
-- deadlock cycle — every path takes the message row then the thread row, in that
-- order, and nothing in this schema takes them the other way round.
--
-- APPLY ORDER: ** MIGRATION FIRST, on each project independently. ** The column
-- is additive and the shipped client will ORDER on it; a bundle that names
-- `last_activity_at` against a pre-116 database gets 42703 from PostgREST and
-- the whole thread list fails. The reverse window costs nothing: this file
-- applied ahead of its bundle leaves a correct column that nothing reads yet.
--
-- ROLLBACK, in this order:
--   1. drop trigger touch_club_thread_activity on public.club_messages;
--      drop trigger touch_ride_thread_activity on public.ride_thread_messages;
--   2. drop function private.touch_club_thread_activity();
--      drop function private.touch_ride_thread_activity();
--   3. drop index public.club_threads_club_id_last_activity_idx;
--      drop index public.ride_threads_ride_id_last_activity_idx;
--   4. alter table public.club_threads drop column last_activity_at;
--      alter table public.ride_threads drop column last_activity_at;
--   §4's grant lists need no rollback — they restate the pre-116 state exactly.

-- ---------------------------------------------------------------------------
-- §1  The column, on both tables
-- ---------------------------------------------------------------------------
-- `default now()` is the same expression `created_at` already carries, so a
-- brand-new thread is born with the two equal to the microsecond: both resolve
-- to the transaction timestamp of the INSERT that creates the row.
--
-- ** The default does NOT correctly fill the existing rows, and §2 is not
-- optional because of it. ** `add column ... default now()` evaluates the
-- default ONCE, at DDL time, and writes THAT instant to every existing row — so
-- without §2 every thread already on DEV and PROD would read as bumped to the
-- migration's own timestamp: the exact visible regression this file exists to
-- avoid, and one that no later reply would ever correct downwards.
alter table public.club_threads
  add column last_activity_at timestamptz not null default now();

alter table public.ride_threads
  add column last_activity_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- §2  The backfill
-- ---------------------------------------------------------------------------
-- ** EVERY ROW IS TOUCHED, not just the ones with messages. ** The correlated
-- form below is deliberate: a `from (select thread_id, max(created_at) ...
-- group by thread_id)` join would update only threads that HAVE replies and
-- leave every message-less thread holding §1's DDL-time `now()` — which is the
-- majority of them (5 of 12 club threads, 1 of 2 ride threads on DEV).
--
-- `greatest(created_at, ...)` rather than `max(...)` alone, so a thread whose
-- messages are all somehow older than it still lands on its own creation
-- instant; `coalesce(..., created_at)` supplies the message-less case. Both
-- reads use the existing (thread_id, created_at, ...) indexes.
update public.club_threads t
   set last_activity_at = greatest(
         t.created_at,
         coalesce((select max(m.created_at)
                     from public.club_messages m
                    where m.thread_id = t.id),
                  t.created_at));

update public.ride_threads t
   set last_activity_at = greatest(
         t.created_at,
         coalesce((select max(m.created_at)
                     from public.ride_thread_messages m
                    where m.thread_id = t.id),
                  t.created_at));

-- ---------------------------------------------------------------------------
-- §3  The two trigger functions, in `private`, and their triggers
-- ---------------------------------------------------------------------------
-- `search_path = ''` and every name schema-qualified, per 005. Neither function
-- branches on `current_user`: inside a `security definer` function
-- `current_user` is the OWNER, so such a guard is true on every call and gates
-- nothing (087's bug).
create function private.touch_club_thread_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.club_threads
     set last_activity_at = greatest(last_activity_at, new.created_at)
   where id = new.thread_id;
  return null;
end;
$$;

create function private.touch_ride_thread_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ride_threads
     set last_activity_at = greatest(last_activity_at, new.created_at)
   where id = new.thread_id;
  return null;
end;
$$;

comment on function private.touch_club_thread_activity() is
  'AFTER INSERT on public.club_messages. Stamps the parent thread''s last_activity_at to greatest(last_activity_at, new.created_at) — monotonic by construction, so a backdated or out-of-order insert can never move a thread backwards down the timeline. SECURITY DEFINER because the inserting rider holds neither an UPDATE grant nor an UPDATE policy on club_threads: without it the write would raise 42501, and with a grant but no policy it would silently update zero rows. It stamps EVERY thread including an introduction (introduces_user_id not null) — the announcement exclusion is a READ-side filter in getClubThreads (PD-372), because 097 can NULL that marker and a trigger that skipped such rows would strand a stale timestamp with no writer left to correct it. There is deliberately no DELETE counterpart: a removed reply does not un-bump a thread (116).';

comment on function private.touch_ride_thread_activity() is
  'AFTER INSERT on public.ride_thread_messages. The ride-side twin of private.touch_club_thread_activity(); see that comment for the greatest() and SECURITY DEFINER reasoning, which is identical. ride_threads has no introduction marker, so only the DELETE decision applies here.';

-- Revoking from `public` is what does the work — EXECUTE is granted to PUBLIC by
-- default on function creation. The roles are named as well so the statement
-- reads as intent and is correct in isolation. A trigger function needs no
-- EXECUTE privilege on the inserting role: Postgres checks that at CREATE
-- TRIGGER, never at fire time.
revoke all on function private.touch_club_thread_activity() from public, anon, authenticated, service_role;
revoke all on function private.touch_ride_thread_activity() from public, anon, authenticated, service_role;

-- ** NEITHER TRIGGER CARRIES A `when` CLAUSE, AND THE OMISSION IS THE POINT. **
-- Copying the participation gate's `when (current_user = 'authenticated')` —
-- which sits on these same message tables and is right to carry it — would be
-- wrong here. This is not a rule about the client. It must fire for every
-- writer: a seed, a restore, a `security definer` RPC, psql, and above all the
-- writes the RLS suite itself makes, whose assertions would otherwise pass
-- against a database where the stamp never happens for anyone.
create trigger touch_club_thread_activity
  after insert on public.club_messages
  for each row execute function private.touch_club_thread_activity();

create trigger touch_ride_thread_activity
  after insert on public.ride_thread_messages
  for each row execute function private.touch_ride_thread_activity();

-- ---------------------------------------------------------------------------
-- §4  The column is SERVER-OWNED — 048's pattern, and why it is restated
-- ---------------------------------------------------------------------------
-- ** A grantable `last_activity_at` is a "pin my own thread to the top of every
-- timeline, for ever" primitive. ** It is strictly worse than the sort keys 044,
-- 045 and 048 closed: those let a rider claim a position in a list, this one
-- lets a rider claim the position AND re-claim it on any schedule, in every
-- club they are a member of, above threads riders are actually talking in.
--
-- ** Today the guarantee already holds, and this section is still not a no-op. **
-- INSERT on both thread tables is already COLUMN-LEVEL (measured above), so a
-- column added by §1 carries no `attacl` and is unwritable the moment it exists;
-- and neither table has any UPDATE grant to narrow. So the lists below are
-- byte-for-byte the pre-116 state. They are issued anyway for 048's own reason,
-- turned on this file: 048's footer warns that "any LATER migration re-granting
-- these tables must restate the full list or it will silently reinstate what
-- this one removed" — and a migration that says nothing about grants is exactly
-- what a reader has to reconstruct from three other files to be sure. Restating
-- makes 116 self-contained: the whole INSERT surface of both tables is written
-- down here, `last_activity_at` is visibly absent from it, and the suite asserts
-- both halves by grantee.
--
-- A table-level revoke clears column grants with it (measured for 044), so each
-- list below is the WHOLE surface rather than a delta. A column omitted from it
-- holds no privilege.
--
--   club_threads INSERT
--     id ................. client-suppliable, for the offline-UUID convention
--     club_id ............ required; the INSERT policy checks membership on it
--     author_id .......... required — the policy is `author_id = auth.uid()`
--     title .............. the rider's text
--     created_at ......... ABSENT, and was before this file
--     introduces_user_id . ABSENT: 097 writes it from `introduce_to_club` only
--     introduction ....... ABSENT: same
--     last_activity_at ... ABSENT: the point of this section
revoke insert on public.club_threads from authenticated;
grant insert (id, club_id, author_id, title)
  on public.club_threads to authenticated;

--   ride_threads INSERT — the same four, with ride_id in club_id's place
revoke insert on public.ride_threads from authenticated;
grant insert (id, ride_id, author_id, title)
  on public.ride_threads to authenticated;

-- ** NO UPDATE GRANT IS ADDED TO EITHER TABLE, and these two revokes are the
-- statement of that. ** Both are no-ops today — neither table has ever held an
-- UPDATE grant — and both are here so the intent survives: a rider edits neither
-- a thread nor its activity stamp, and the next author of an "edit your own
-- thread title" migration has to name every column it wants rather than
-- inheriting this one for free. SELECT and DELETE are untouched; SELECT must
-- stay table-level or the client cannot order on the new column at all.
revoke update on public.club_threads from authenticated;
revoke update on public.ride_threads from authenticated;

comment on column public.club_threads.last_activity_at is
  'Server-owned since 116 (PD-439). The thread''s newest activity: its own created_at, or its newest message''s created_at, whichever is later. `authenticated` holds SELECT (table-level) and neither INSERT nor UPDATE, so the only writers are 116''s backfill and private.touch_club_thread_activity() — a grantable version of this column would be a "pin my own thread to the top of every club timeline for ever" primitive. Maintained by AFTER INSERT on club_messages with greatest(), so it is monotonic and a backdated insert cannot move a thread down. NOT recomputed on delete: a removed reply keeps the position it earned. Stamped for EVERY thread including introductions — the announcement exclusion is a read-side filter (PD-372), never an audience rule. Ordered on via club_threads_club_id_last_activity_idx.';

comment on column public.ride_threads.last_activity_at is
  'Server-owned since 116 (PD-439). The ride-side twin of club_threads.last_activity_at — same writers, same greatest() monotonicity, same absence of a DELETE recompute, maintained by AFTER INSERT on ride_thread_messages. `authenticated` holds SELECT and neither INSERT nor UPDATE. Ordered on via ride_threads_ride_id_last_activity_idx.';

-- No grant of any kind is issued to `anon` by this file — decision #1.

-- ---------------------------------------------------------------------------
-- §5  The indexes the client will order on
-- ---------------------------------------------------------------------------
-- `(parent_id, last_activity_at desc, id desc)` — the parent id leads because
-- every read is scoped to one club or one ride; `id desc` is the tiebreak that
-- makes keyset paging total, which is what the club list needs and the reason
-- this column exists at all. The shape deliberately mirrors
-- `club_threads_club_id_idx`, which both of these sit beside rather than replace.
create index club_threads_club_id_last_activity_idx
  on public.club_threads (club_id, last_activity_at desc, id desc);

create index ride_threads_ride_id_last_activity_idx
  on public.ride_threads (ride_id, last_activity_at desc, id desc);

-- ---------------------------------------------------------------------------
-- §6  VERIFICATION — run against the hosted project after applying
-- ---------------------------------------------------------------------------
-- Repeated here rather than left to the RLS suite, which runs on plain Postgres
-- as the table owner and can see neither role grants nor Supabase defaults.
--
-- 1. The grant, BOTH WAYS and scoped to the grantee. postgres and service_role
--    hold everything by default, so a bare check reads true against a broken
--    database.
--
--   select c, has_column_privilege('authenticated','public.club_threads',c,'SELECT') sel,
--             has_column_privilege('authenticated','public.club_threads',c,'INSERT') ins,
--             has_column_privilege('authenticated','public.club_threads',c,'UPDATE') upd
--     from unnest(array['last_activity_at','title']) c;
--   -- last_activity_at  t f f     <- readable, never writable
--   -- title             t t f     <- the control: INSERT really is still granted
--
--   ...and the same two rows for public.ride_threads.
--
-- 2. The whole INSERT surface, by grantee, equals §4's lists.
--
--   select table_name, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name in ('club_threads','ride_threads')
--      and grantee='authenticated' and privilege_type='INSERT'
--    group by table_name;
--   -- club_threads  author_id,club_id,id,title
--   -- ride_threads  author_id,id,ride_id,title
--
-- 3. No TABLE-level INSERT or UPDATE survives on either.
--
--   select bool_or(has_table_privilege('authenticated', t, p))
--     from unnest(array['public.club_threads','public.ride_threads']) t,
--          unnest(array['INSERT','UPDATE']) p;                          -- f
--
-- 4. The backfill left no row on the DDL clock. Both must return 0.
--
--   select count(*) from public.club_threads t
--    where t.last_activity_at is distinct from greatest(t.created_at,
--      coalesce((select max(m.created_at) from public.club_messages m
--                 where m.thread_id = t.id), t.created_at));
--   -- and the ride_threads twin.
--
-- 5. Both functions are SECURITY DEFINER with search_path pinned, and both are
--    in `private`. This is the object diff that catches an apply_migration call
--    that diverged from the file — 022's defect, one clause and the
--    security-relevant one.
--
--   select p.pronamespace::regnamespace::text as schema, p.proname,
--          p.prosecdef, p.proconfig
--     from pg_proc p
--    where p.proname in ('touch_club_thread_activity','touch_ride_thread_activity');
--   -- private  touch_club_thread_activity  t  {"search_path="}
--   -- private  touch_ride_thread_activity  t  {"search_path="}
--
-- 6. Two new triggers, both AFTER INSERT ROW (tgtype 5), neither with a WHEN.
--
--   select tgrelid::regclass::text, tgname, tgtype, tgqual is null as no_when
--     from pg_trigger where tgname like 'touch_%_thread_activity';
--
-- 7. Both indexes exist and the two pre-existing created_at ones still do.
--
--   select indexname from pg_indexes where schemaname='public'
--     and tablename in ('club_threads','ride_threads') order by 1;
--
-- 8. The advisors. This file adds no PUBLIC function, no view and no table, so
--    every count must be unchanged: 3 / 1 / 38 / 1 as recorded in the header.
--
-- 9. Round-trip the real thing on DEV, in a rolled-back transaction, as
--    `authenticated` with the HOSTED identity idiom (`set local
--    request.jwt.claims`) — NOT the suite's `test.uid`, which auth.uid() does
--    not read on a hosted project. Insert a reply and read the parent back.
