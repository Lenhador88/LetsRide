-- 098: a reply and a wave on a club thread notify the rider who started it.
--
-- Linear PD-367, `openspec/changes/notify-a-club-thread/`. Product owner,
-- 2026-09-01: "yes a comment or a wave should notify."
--
-- Two fan-outs, not one. **No notification in this schema fires on a
-- `club_messages` insert at all** — fourteen types today and none of them a
-- reply — so a rider who opens a thread and is answered by three people is told
-- nothing, ever. And `092` shipped `club_thread_waves` deliberately silent, in
-- as many words, in `comment on function private.notify_club_waved()`.
--
-- ---------------------------------------------------------------------------
-- ** ADDITIVE IN SCHEMA AND NOT INERT. READ THIS BEFORE APPLYING. **
-- ---------------------------------------------------------------------------
-- From the instant this file applies, TWO LIVE WRITE PATHS run new code inside
-- the rider's own transaction:
--
--   * `public.club_messages` INSERT  — every reply in every club thread
--   * `public.club_thread_waves` INSERT and DELETE — every thread wave and
--     un-wave
--
-- A fan-out that raises takes the rider's own write down with it, deliberately
-- (`036` §7.9 — a failure is not silently swallowed). So a bug here is not a
-- missing notification, it is **every reply and every thread wave in every club
-- failing simultaneously**. `036`'s hand-exercise gate therefore applies: both
-- paths are exercised BY HAND on DEV first, as `authenticated`, in a ROLLED-BACK
-- transaction, with rows COUNTED rather than assumed, before this reaches PROD.
--
-- The retraction adds a third, less obvious blast radius, and it is the one this
-- file's §8 exists to describe: `retract_club_thread_waved` fires on CASCADED
-- deletes of `club_thread_waves`, which is the path taken by a thread deletion,
-- `public.moderate_club_thread`, `private.remove_reported_thread`, a club
-- deletion and an account deletion. A raise there is **a thread that cannot be
-- deleted**, not a stale notification.
--
-- ---------------------------------------------------------------------------
-- §0  Pre-flight, measured on DEV `fpmrimzxadewsaiwpsel` 2026-09-01 before this
--     file was written. Re-derive against PROD before applying there; two of
--     these are live counts that move with ordinary use.
-- ---------------------------------------------------------------------------
--   notifications_type_check      14 types, listed in §3's `drop`/`add` pair
--   notifications_subject_shape   14 arms + `else false`, no thread_id anywhere
--   notifications_event_key       UNIQUE (user_id, type, actor_id, postcard_id,
--                                 comment_id, ride_id, club_id) NULLS NOT
--                                 DISTINCT — a PLAIN INDEX, absent from
--                                 pg_constraint (verified: the table's only
--                                 constraints are its pkey, six FKs and the two
--                                 CHECKs above)
--   notifications policies        2 — one SELECT, one UPDATE, textually
--                                 identical predicates in all three expressions
--   notifications rows            DEV 18   (moves; re-derive, never carry forward)
--   club_threads rows             DEV 4,  PROD 0
--   club_messages rows            DEV 4,  PROD 0
--   club_thread_waves rows        DEV 0
--   enforce_participation_gate    22 triggers, both projects
--   write sites into notifications  THIRTEEN functions, EVERY `on conflict`
--                                 clause BARE — twelve `private.notify_*` plus
--                                 `public.approve_club_join_request`
--
-- The last one is load-bearing and the query that finds it is deliberately not
-- the obvious one. Filtering `nspname='private' and proname like 'notify%'`
-- returns twelve and cannot see `approve_club_join_request`; `position('on
-- conflict' in prosrc)` returns only the FIRST match, which for that function
-- and for `notify_club_join_request_declined` is inside a COMMENT — this repo's
-- comment trap at a `position()` instead of a `grep`. Select on the INSERT and
-- return every match:
--
--   select n.nspname||'.'||p.proname as fn, m[1] as clause
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     cross join lateral regexp_matches(p.prosrc, 'on conflict[^;]{0,80}', 'gi') m
--    where p.prosrc ilike '%insert into public.notifications%'
--    order by 1, 2;
--
-- A bare `on conflict do nothing` binds to whatever unique index the row
-- violates, resolved at execution time, so **no existing write site names the
-- index and none needs editing**. Had one used `on conflict (user_id, type,
-- actor_id, …)`, §4's rebuild would have broken it at runtime with a `42P10`
-- inside a rider's own write.
--
-- ---------------------------------------------------------------------------
-- APPLY ORDER — MIGRATION FIRST, and it is the OPPOSITE of `089`'s rule
-- ---------------------------------------------------------------------------
-- ** This file applies BEFORE its bundle serves, on each project
-- independently. ** Decided 2026-09-01 (`tasks.md` §7, Q4), on three
-- measurements rather than on a preference. `089`'s rule — a new notification
-- type applies only after its bundle is confirmed serving — is not a fixed
-- order; it is the additive-first rule's real question, WHICH SIDE FAILS SAFE,
-- and here it answers the other way:
--
--   1. `089`'s premise expired one day after `089` shipped. PD-335 (#343,
--      2026-08-28) gave both exhaustive switches a runtime fallback, so an
--      unknown type now renders `Rider · did something on LetsRide.` unlinked
--      and SELF-HEALS the moment the bundle lands. It no longer takes the
--      notifications screen down.
--   2. ** This file adds a column the shipped client READS, which `089` did
--      not. ** `NOTIFICATION_SELECT` gains `thread:club_threads!thread_id(id,
--      title)`; against a pre-`098` database PostgREST answers `PGRST200` / 400
--      — no such relationship — `unwrapList` throws, and EVERY RIDER'S
--      NOTIFICATIONS LIST fails entirely. Not a degraded row: the whole screen,
--      every type. That is `096`'s rule read on the read side.
--   3. On PROD the migration-first window costs nothing measurable:
--      `club_threads` and `club_messages` are both 0 rows there, so no
--      notification of either new type can exist during it.
--
-- The two orders are not equally recoverable, which is the tie-break:
-- migration-first is undone by waiting for a build, deploy-first is a live
-- outage of an existing screen for every rider until someone applies a
-- migration.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK — IN THIS ORDER. Step 3 before step 4 is not optional.
-- ---------------------------------------------------------------------------
--   1. drop trigger notify_club_thread_replied on public.club_messages;
--      drop trigger notify_club_thread_waved  on public.club_thread_waves;
--      drop trigger retract_club_thread_waved on public.club_thread_waves;
--   2. drop function private.notify_club_thread_replied();
--      drop function private.notify_club_thread_waved();
--      drop function private.retract_club_thread_waved();
--   3. delete from public.notifications
--       where type in ('club_thread_replied', 'club_thread_waved');
--      ** Before step 4. ** The fourteen-type CHECK is VALIDATED against
--      existing rows, so one live row of a new type makes the `add constraint`
--      fail and leaves the table with no shape constraint at all.
--   4. restore `notifications_type_check` and `notifications_subject_shape` to
--      their fourteen-type / fourteen-arm form — the text is in §3's `drop`
--      comment, recorded verbatim rather than reconstructed.
--   5. restore the SELECT and UPDATE policies to their prior text — recorded
--      verbatim in §5's comment, which is `093`'s output and the exact
--      pg_policy text measured on DEV.
--   6. create unique index notifications_event_key_v0 on public.notifications
--        (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)
--        nulls not distinct;
--      drop index public.notifications_event_key;
--      alter index public.notifications_event_key_v0
--        rename to notifications_event_key;
--   7. drop index public.notifications_thread_id_idx;
--   8. alter table public.notifications drop column thread_id;
--   9. restore the two `comment on function` statements — `092`'s and `094`'s,
--      whose prior text is quoted in §11.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
--   * ** No change to `club_threads`, `club_messages` or `club_thread_waves` **
--     — not a column, not a policy, not a grant. The three triggers are the only
--     additions to them, and `097`'s two columns on `club_threads` belong to a
--     different change and are not touched.
--   * ** No new participation-gate trigger. ** Both parent tables already carry
--     one (measured) and this file adds no table, so the count stays at 22.
--   * ** No new security advisor. ** All three functions live in `private`,
--     which PostgREST does not publish, so
--     `authenticated_security_definer_function_executable` cannot fire for them
--     and the count moves by ZERO on each project. `085`'s eight `private`
--     functions adding zero advisors is the measured precedent; the count moves
--     by the number of PUBLIC functions only. The check is a DELTA per project,
--     never an absolute — DEV reads 37 and PROD 36 today, legitimately, because
--     `097` is applied on DEV and awaiting promotion.
--   * ** No retraction on a deleted reply. ** §7 of this header's sibling
--     `design.md` (§D7) and the standing rule: a retraction hanging off a DELETE
--     the ACTOR controls is a rider-aimed delete of another rider's row.
--   * ** No `message_id` column ** and no per-message notification.
--   * ** No push. ** Adding a type does not enrol it for delivery.
--   * ** No `create or replace` of `private.remove_reported_thread`. ** Its
--     in-body cascade list goes stale with this file and is corrected in its
--     EXTERNAL comment only — see §11.
--
-- ---------------------------------------------------------------------------
-- §12  VERIFICATION — run against the hosted project after apply
-- ---------------------------------------------------------------------------
-- Repeated here rather than left to the RLS suite because that suite runs on
-- plain Postgres and cannot see role grants, PostgREST exposure or Supabase
-- defaults — the gap that let `003`'s revoke pass locally and stay broken in
-- production.
--
--   -- eight columns, in this order, still nulls not distinct
--   select indexdef from pg_indexes
--    where schemaname='public' and indexname='notifications_event_key';
--   -- and the scratch name is gone
--   select count(*) from pg_indexes
--    where schemaname='public' and indexname='notifications_event_key_v2';   -- 0
--
--   -- sixteen types, sixteen arms, and thread_id named in every one of them
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.notifications'::regclass
--      and conname in ('notifications_type_check','notifications_subject_shape');
--
--   -- seven FK columns and seven usable indexes, derived rather than counted
--   select a.attname
--     from pg_constraint c
--     join lateral unnest(c.conkey) k(attnum) on true
--     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
--    where c.conrelid='public.notifications'::regclass and c.contype='f'
--      and not exists (
--        select 1 from pg_index i
--         where i.indrelid = c.conrelid and i.indkey[0] = a.attnum);      -- 0 rows
--
--   -- the two policies, three expressions, still textually identical
--   select polname, md5(pg_get_expr(polqual,polrelid)),
--          md5(coalesce(pg_get_expr(polwithcheck,polrelid),
--                       pg_get_expr(polqual,polrelid)))
--     from pg_policy where polrelid='public.notifications'::regclass;
--
--   -- unchanged: 22
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;
--
--   -- get_advisors(security): count AND name set unchanged from the reading
--   -- taken on the SAME project before this applied.
--
-- The two hand exercises, as `authenticated`, in a rolled-back transaction:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a member who is not the author>"}';
--   insert into public.club_messages (thread_id, author_id, body)
--     values ('<thread>', '<that member>', 'hand exercise');
--   insert into public.club_thread_waves (thread_id, user_id)
--     values ('<thread>', '<that member>');
--   delete from public.club_thread_waves
--    where thread_id = '<thread>' and user_id = '<that member>';
--   reset role;
--   select type, count(*) from public.notifications
--    where thread_id = '<thread>' group by type;   -- COUNT it; do not assume
--   rollback;
--
-- ** Note the identity idiom. ** On the HOSTED database `auth.uid()` reads
-- `request.jwt.claims`, which is what the block above sets. The local RLS suite
-- redefines `auth.uid()` to read `test.uid`, so the same block there sets
-- something nothing reads and every POSITIVE assertion passes while proving
-- nothing. Match the idiom to the target.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- §1  The column
-- ---------------------------------------------------------------------------
-- ** A real typed column with a foreign key, not `club_id` reused. ** `club_id`
-- already exists and a thread knows its club, so `club_id` "works" — the row
-- stores something true and the CHECK passes. It fails at the COLLAPSE KEY,
-- which is the one place nothing announces a failure: with `club_id` as the
-- subject the key for a reply is (recipient, type, actor, club), so Ana replies
-- in thread X and the author is told, Ana replies in thread Y IN THE SAME CLUB
-- and `on conflict do nothing` absorbs it — the author is never told about
-- thread Y, or Z, for the life of that club, with no error, no log line and no
-- failing assertion. It also cannot deep-link: `routes.clubThread` takes a
-- THREAD id, so a row holding only a club can open the thread LIST at best.
--
-- Not a polymorphic `subject_id` either, unchanged from `036`: a polymorphic
-- column can carry no foreign key, so nothing cascades and a deleted thread
-- leaves a row pointing at nothing with nothing to detect it.
--
-- ** THREE ORDINALS, AND THEY DIFFER BECAUSE THE SETS DIFFER. ** `thread_id` is
-- the FIFTH typed subject column (after postcard_id, comment_id, ride_id,
-- club_id), the FIFTH partial index (those four; `notifications_actor_id_idx` is
-- NOT partial), and the SEVENTH foreign-key column (those four plus user_id and
-- actor_id). All three re-derived against DEV rather than counted by eye,
-- because an earlier revision of the proposal gave two of the three wrong.
--
-- `ON DELETE CASCADE`, like every other FK on this table. A notification whose
-- subject no longer exists must not survive as a tombstone.
--
-- No column-level grant is issued and none is needed: `036` gave `authenticated`
-- a TABLE-level SELECT on `notifications` (verified — `role_table_grants` shows
-- it), so the new column is readable and the PostgREST embed can resolve its
-- foreign key. UPDATE stays column-scoped to `read_at` alone and does not move.
alter table public.notifications
  add column thread_id uuid references public.club_threads(id) on delete cascade;

comment on column public.notifications.thread_id is
  'The club thread a club_thread_replied or club_thread_waved notification is about (098). NULL on every row of the other fourteen types, which notifications_subject_shape enforces arm by arm. It is the SUBJECT, so it is in notifications_event_key: without it a second reply in a second thread of the same club collapses into the first and the author is never told.';


-- ---------------------------------------------------------------------------
-- §2  The partial index
-- ---------------------------------------------------------------------------
-- `029` §A's contract: every foreign key into this table needs an index
-- Postgres can use to find the referencing rows, so a delete reaching here is an
-- index scan rather than a sequential scan holding locks. With `thread_id` there
-- are SEVEN FK columns and there must be SEVEN usable indexes.
--
-- PARTIAL, matching the four existing subject indexes: every row of the fourteen
-- existing types leaves `thread_id` NULL, so a partial index enters only the
-- rows that use it and no pre-existing type pays a write cost for this change.
--
-- ** `notifications_event_key` does not cover this and must not be offered as
-- covering it. ** `thread_id` sits LAST in that index (§4), and a non-leading
-- column cannot serve the lookup.
create index notifications_thread_id_idx
  on public.notifications (thread_id)
  where thread_id is not null;


-- ---------------------------------------------------------------------------
-- §3  The two CHECK constraints — SIXTEEN arms, not two
-- ---------------------------------------------------------------------------
-- Both are dropped and re-added WHOLE. An absolute rewrite rather than a delta,
-- like `093`'s: a `check` cannot be altered in place, and reconstructing it from
-- memory is how a live type gets silently dropped from the list.
--
-- The prior text, recorded verbatim for the rollback (measured on DEV
-- 2026-09-01):
--
--   notifications_type_check CHECK (type = ANY (ARRAY['postcard_liked',
--     'postcard_commented', 'ride_joined', 'club_joined',
--     'ride_created_in_club', 'ride_invited', 'ride_invite_accepted',
--     'ride_invite_declined', 'club_join_requested',
--     'club_join_request_approved', 'club_join_request_declined', 'club_waved',
--     'club_invited', 'club_invite_declined']))
--
--   notifications_subject_shape — the same fourteen arms as below, with the two
--   new ones absent and WITHOUT the `and thread_id is null` conjunct on any of
--   them, plus `else false`.
--
-- ** THE FOURTEEN EXISTING ARMS MATTER AS MUCH AS THE TWO NEW ONES, AND THIS IS
-- THE THING THE OBVIOUS BUILD GETS WRONG. ** A CHECK is only a shape if it
-- constrains EVERY column. Add `thread_id` and leave the existing arms alone and
-- a `postcard_liked` row can legally carry a thread — which would put it in a
-- different equivalence class under §4's rebuilt key, break its own retraction's
-- four-column scope, and make it resolvable or not according to a thread nothing
-- about it renders. Nothing anywhere would refuse it. The proposal that
-- commissioned this file described it as "the two subject shape arms"; it is
-- SIXTEEN, and stating it as two is how the gap gets inherited as covered.
--
-- The `else false` fallthrough is what makes forgetting LOUD: a type added to
-- `notifications_type_check` and forgotten here is refused by the database
-- rather than stored shapeless.
--
-- ** ORDERING IS NOT OPTIONAL. ** The `add constraint` VALIDATES against
-- existing rows, so this must run before any row of a new type can exist — which
-- it does by construction, the triggers being created in §10.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined',
             'club_join_requested', 'club_join_request_approved',
             'club_join_request_declined', 'club_waved',
             'club_invited', 'club_invite_declined',
             -- fifteen and sixteen
             'club_thread_replied', 'club_thread_waved')
  );

alter table public.notifications
  drop constraint notifications_subject_shape;
alter table public.notifications
  add constraint notifications_subject_shape check (
    case type
      when 'postcard_liked' then
        postcard_id is not null and comment_id is null
        and ride_id is null     and club_id is null
        and thread_id is null
      when 'postcard_commented' then
        postcard_id is not null and comment_id is not null
        and ride_id is null     and club_id is null
        and thread_id is null
      when 'ride_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
        and thread_id is null
      when 'club_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'ride_created_in_club' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is not null
        and thread_id is null
      when 'ride_invited' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
        and thread_id is null
      when 'ride_invite_accepted' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
        and thread_id is null
      when 'ride_invite_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
        and thread_id is null
      when 'club_join_requested' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'club_join_request_approved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'club_join_request_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'club_waved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'club_invited' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      when 'club_invite_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
        and thread_id is null
      -- The two new arms. `club_id` is deliberately NULL on both: these types
      -- render the THREAD'S TITLE and open the THREAD, and `routes.clubThread`
      -- takes a thread id, so the row needs no club id to build its link.
      -- Carrying one would add a conjunct with no rendered resource behind it,
      -- add a column to the collapse key that `thread_id` already determines,
      -- and put a second, WEAKER resolvability test beside a stronger one —
      -- inviting a later reader to simplify the strong one away. Nothing is lost
      -- on the cascade side: deleting the club cascades `club_threads`, which
      -- cascades these rows.
      when 'club_thread_replied' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is null
        and thread_id is not null
      when 'club_thread_waved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is null
        and thread_id is not null
      else false
    end
  );


-- ---------------------------------------------------------------------------
-- §4  The uniqueness rebuild — seven columns become eight
-- ---------------------------------------------------------------------------
-- ** Create, drop, rename — in that order, inside this file's transaction. **
-- Three measured facts make it safe, and each is a measurement rather than an
-- argument:
--
--   1. `notifications_event_key` is a PLAIN UNIQUE INDEX, not a table
--      constraint. It appears in `pg_indexes` and NOT in `pg_constraint`
--      (verified on DEV: the table's only constraints are its pkey, six FKs and
--      the two CHECKs of §3). So this is `create index` / `drop index`, nothing
--      depends on a constraint name, and no `alter table … drop constraint` is
--      needed or possible.
--   2. Every existing row has `thread_id` NULL, and `nulls not distinct`
--      compares two NULLs EQUAL. Appending a column that is constant across
--      every existing row cannot split an equivalence class: any two rows that
--      collided under seven columns still collide under eight, and any two that
--      did not, still do not. ** If the `create unique index` below fails on
--      existing data, that is a PRE-EXISTING DUPLICATE and a finding — do not
--      make it succeed by weakening the index. **
--   3. All THIRTEEN existing write sites end in a BARE `on conflict do
--      nothing` — no index name, no column list, no `on constraint` — so none
--      names this index and none needs editing. §0 carries the query, and the
--      reason it is not the obvious query.
--
-- ** `thread_id` goes LAST. ** Two reasons: it keeps the existing seven-column
-- prefix intact, so every existing retraction's `(user_id, type, actor_id,
-- <subject>)` predicate is still served exactly as it was; and appending is the
-- only change that provably preserves every equivalence class under fact 2.
--
-- ** Not `concurrently`. ** That cannot run inside a transaction block, which
-- would leave this file non-atomic for no benefit: a non-concurrent `create
-- unique index` takes a SHARE lock blocking writes to `notifications` for its
-- duration, and the table holds 18 rows on DEV and 15 on PROD, so the duration
-- is sub-millisecond.
--
-- The scratch name `_v2` exists only between these three statements. §12's
-- verification asserts it is gone.
create unique index notifications_event_key_v2 on public.notifications
  (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id, thread_id)
  nulls not distinct;
drop index public.notifications_event_key;
alter index public.notifications_event_key_v2 rename to notifications_event_key;


-- ---------------------------------------------------------------------------
-- §5  The SELECT and UPDATE policies gain one conjunct, identically
-- ---------------------------------------------------------------------------
-- The prior text of BOTH, recorded verbatim for the rollback — this is `093`'s
-- output and the exact `pg_policy` text measured on DEV 2026-09-01. All three
-- expressions (SELECT `using`, UPDATE `using`, UPDATE `with check`) were
-- textually identical:
--
--   user_id = auth.uid()
--   and not private.is_blocked(auth.uid(), actor_id)
--   and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
--   and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
--   and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
--   and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
--   and (club_id is null
--        or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
--        or (type = 'club_join_request_declined' and private.club_takes_join_requests(notifications.club_id))
--        or (type = 'club_invited' and private.has_live_club_invite(notifications.club_id)))
--
-- ** `089`'s AND `093`'s TYPE-SCOPED DISJUNCTS ARE PRESERVED VERBATIM. ** They
-- are on the `club_id` conjunct, this change does not touch it, and dropping
-- them in a rewrite would take those two types' notifications down SILENTLY —
-- the exact failure a whole-policy re-create invites. `098.38` asserts they
-- still work.
--
-- ** BOTH POLICIES, IDENTICALLY, IS A REQUIREMENT AND NOT TIDINESS. ** `036` §4
-- requires the UPDATE predicate to be identical to SELECT's in both `using` and
-- `with check`. An UPDATE policy wider than SELECT makes `update notifications
-- set read_at = now() where read_at is null` touch rows the rider cannot see,
-- and PostgREST reports the affected-row count — a number the rider can compare
-- against the list they were shown. The difference IS the count of hidden rows,
-- and the commonest reason a row is hidden is a block, which must never be
-- disclosed by any gap, count or marker.
--
-- ** THE NEW CONJUNCT DISCLOSES NOTHING, AND THAT IS A DERIVATION RATHER THAN A
-- HOPE. ** `club_threads` SELECT is
--   exists(clubs c where c.id = club_id)
--   and private.is_club_member(club_id)
--   and (author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id))
-- and it is evaluated here under the READER's own row security. Its FIRST
-- conjunct is literally the `clubs` test, so thread-resolves implies
-- club-resolves and the new line can only ever NARROW. The thread's TITLE is
-- never stamped on the row; it is read live through the embed under the same
-- reader's RLS.
--
-- ** NO TYPE-SCOPED DISJUNCT IS ADDED FOR THE TWO NEW TYPES, AND THE REASON IS
-- SPECIFIC. ** `089` and `093` each added one because their recipients are, by
-- construction, riders who NEVER COULD read the subject — a declined requester
-- and an invitee are non-members at the instant the row is written, so without a
-- disjunct the row would be unreadable from birth. Neither new type meets that
-- condition: the recipient AUTHORED the thread, which `club_threads` INSERT
-- required membership for, so the ordinary conjunct resolves at the moment the
-- row is written.
--
-- ** It does not resolve for ever, and that is deliberate. ** A thread's author
-- who later LEAVES the club stops reading it, because `club_threads` SELECT
-- needs membership. That is an EVICTION, not a deletion — nothing removes the
-- row, and rejoining returns it with its original `created_at` and read state.
-- It is `openspec/changes/notify-a-club-thread/proposal.md` Q8, put to the
-- product owner because it is rider-visible, and this file builds its stated
-- default. A disjunct is NOT the repair: it would keep the notification readable
-- while the thread screen it links to still refuses the rider, which is exactly
-- the row-renders-but-its-destination-will-not-open state `036` forbids.
--
-- ** DO NOT SIMPLIFY THE THREAD CONJUNCT AWAY. ** It is the whole of the
-- resolvability test for these two types; there is no weaker club conjunct
-- standing behind it, because §3 leaves `club_id` NULL on both.
drop policy "Notifications are readable only by their recipient" on public.notifications;
drop policy "Riders mark only their own readable notifications read" on public.notifications;

create policy "Notifications are readable only by their recipient"
  on public.notifications for select to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
    and (thread_id is null
         or exists (select 1 from public.club_threads st where st.id = notifications.thread_id))
  );

create policy "Riders mark only their own readable notifications read"
  on public.notifications for update to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
    and (thread_id is null
         or exists (select 1 from public.club_threads st where st.id = notifications.thread_id))
  )
  with check (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
    and (thread_id is null
         or exists (select 1 from public.club_threads st where st.id = notifications.thread_id))
  );


-- ---------------------------------------------------------------------------
-- §6  Fan-out 1 — a reply notifies the rider who started the thread
-- ---------------------------------------------------------------------------
-- ** ONE RECIPIENT: `club_threads.author_id`, AND NOBODY ELSE. ** Not the club's
-- owner, not its admins, not its other members, not prior repliers. This is
-- `ride_joined`'s original shape and `event-fanout-integrity` records the
-- reasoning as standing: widening it is a product decision recorded as an open
-- question, not a default. That is `proposal.md` Q1 and its default is `no`.
--
-- ** THE BOUND, STATED RATHER THAN DISCOVERED. ** One message writes AT MOST
-- ONE row, inside the replier's own transaction. Not N−1, not one per member: a
-- 500-member club and a 3-member club cost the same. At most one LIVE row per
-- (thread author, replier, thread), because `actor_id` and `thread_id` are both
-- in §4's key — so a thread with 40 distinct repliers accumulates at most 40
-- rows over its life, all addressed to one rider. This is the tightest bound of
-- any fan-out in this schema, deliberately: a club thread is CHAT, and
-- `ride_messages` — the app's other chat surface — notifies NOBODY precisely
-- because a per-message fan-out is a firehose.
--
-- ** THE RECIPIENT IS RESOLVED BY A DIRECT JOIN, NEVER BY A CALLER-RELATIVE
-- HELPER. ** `036` trap (c): `private.is_club_member` reads `auth.uid()`
-- internally, so it answers "is the CALLER a member" and never "is this
-- CANDIDATE a member" — a fan-out reaching for it computes the actor's own
-- membership once and applies that single answer to everybody, which looks
-- correct in a one-member test. No membership predicate is needed here at all,
-- and that is a property of the SINGLE-RECIPIENT design rather than an
-- inheritable absence: a widening to prior repliers must add
-- `private.is_club_member_for(candidate, club_id)` — the subject-taking twin
-- `085` added — explicitly.
--
-- ** `auth.uid()` APPEARS NOWHERE. ** `036` trap (b). The actor is
-- `new.author_id`, pinned to `auth.uid()` by `club_messages`' own INSERT policy,
-- so reading the row gives the same value in every context AND is correct where
-- there is no JWT at all — psql, a seed, the RLS suite, and inside every
-- `security definer` writer. A self-exclusion written against `auth.uid()` would
-- be NULL rather than TRUE in exactly the environment that asserts it, filtering
-- out every recipient and making every negative assertion pass vacuously.
--
-- ** THE BLOCK CONJUNCT IS REDUNDANT TODAY AND IS WRITTEN ANYWAY. ** Stated
-- honestly, per `081`'s lesson about false justifications: `club_messages`
-- INSERT carries an `EXISTS` against `club_threads` evaluated under the caller's
-- own row security, and `club_threads` SELECT withholds a thread from anyone
-- blocked with its author — so a rider blocked with the thread's author cannot
-- write the parent row at all and this line can never be what refuses one. It is
-- NOT true that the policy alone is a leak. Three reasons it stays: the
-- implication is a property of the CURRENT `club_threads` SELECT policy rather
-- than of these tables, and a widened arm there would break it with nothing
-- announcing the transition; the standing requirement is that blocking is
-- applied TWICE, at fan-out and at read, and a fan-out leaning on a sibling
-- policy applies it once; and it costs nothing measurable.
--
-- AFTER, not BEFORE: the parent row must exist before the foreign keys resolve,
-- and a write refused by RLS, a CHECK or the participation gate must produce
-- nothing — which AFTER gives for free, because it never runs. `return null`
-- because an AFTER ROW trigger's return value is ignored.
--
-- `on conflict do nothing` rather than an exception handler: the one expected
-- collision is §4's index, absorbed without a handler that would also hide a
-- real fault. The cost is stated rather than hidden — ** a reply notification
-- does not resurface. ** A rider who has read "Bo replied to Sunday run" is not
-- told again when Bo replies again in the same thread. The alternative,
-- `on conflict do update` bumping `created_at` and clearing `read_at`, is
-- refused twice over: `created_at` records AN EVENT AT AN INSTANT, so moving it
-- makes the row lie about when the thing happened and reorders a list whose
-- ordering is specified to be deterministic; and it hands every rider a re-ping
-- button with no rate limit anywhere in this app. (`proposal.md` Q5.)
create function private.notify_club_thread_replied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, thread_id)
  select t.author_id, new.author_id, 'club_thread_replied', new.thread_id
    from public.club_threads t
   where t.id = new.thread_id
     and t.author_id <> new.author_id
     and not private.is_blocked(new.author_id, t.author_id)
  on conflict do nothing;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- §7  Fan-out 2 — a thread wave notifies the rider who started the thread
-- ---------------------------------------------------------------------------
-- The same shape one table over, with `new.user_id` as the actor because
-- `club_thread_waves` names its rider that. `092` shipped this table
-- deliberately silent and recorded the decision in the database; the product
-- owner has since asked for the fan-out, and §11 corrects the comment in the
-- same file that reverses it.
--
-- Bounded additionally by `club_thread_waves`' primary key `(thread_id,
-- user_id)`, which lets one rider hold one wave per thread at a time.
create function private.notify_club_thread_waved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, thread_id)
  select t.author_id, new.user_id, 'club_thread_waved', new.thread_id
    from public.club_threads t
   where t.id = new.thread_id
     and t.author_id <> new.user_id
     and not private.is_blocked(new.user_id, t.author_id)
  on conflict do nothing;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- §8  The retraction — and the two things that make it different from `092`'s
-- ---------------------------------------------------------------------------
-- ** SCOPED BY ALL FOUR OF user_id, type, actor_id AND thread_id, NEVER BY A
-- SUBSET. ** A delete scoped by `type + thread_id` alone is a write ONE RIDER
-- CAN AIM AT ANOTHER RIDER'S ROW, in the one table in this schema whose entire
-- premise is that no rider can write to it: rider A un-waving would delete rider
-- B's notification for the same thread. A holds no grant on `notifications` —
-- but this trigger does, and it is running on A's delete. `actor_id` is what
-- makes it A's own row; `user_id` is what stops a future multi-recipient type
-- being cleared wholesale. The scope is free: `(user_id, type, actor_id, …)` is
-- a prefix of §4's index.
--
-- The four subject columns not named — postcard_id, comment_id, ride_id,
-- club_id — are NULL on every `club_thread_waved` row by §3's arm, so naming
-- `type` is what fixes them. That is `retract_postcard_liked`'s own reasoning.
--
-- ** DIFFERENCE 1: THE RECIPIENT IS NOT ON THE DELETED ROW. ** `club_thread_waves`
-- holds `(thread_id, user_id, created_at)` and nothing else, so
-- `club_threads.author_id` has to be JOINED. ** `092`'s `retract_club_waved`
-- cannot be copied here ** — it reads all four scope columns straight off `OLD`,
-- because `club_join_waves` carries `subject_user_id`, `user_id` AND `club_id`.
-- Copying its shape here does not compile into anything correct.
--
-- ** DIFFERENCE 2: ON A CASCADED DELETE THIS DOES NOTHING, AND MUST NOT RAISE. **
-- When a thread is deleted the FK cascade issues `delete from club_thread_waves
-- where thread_id = …`, and by the time that statement fires its AFTER DELETE
-- triggers the `club_threads` row is ALREADY GONE. So the join below finds
-- nothing, no recipient resolves, and ZERO rows are deleted. The notifications
-- are removed by `notifications.thread_id`'s own cascade, which does all the
-- work here. ** This is NOT redundant or duplicated removal ** — a description
-- claiming redundancy is satisfied by an implementation that raises, since the
-- row is gone either way. That is `092`'s comment, which says the opposite and
-- IS RIGHT ABOUT ITS OWN TABLE: a `club_join_waves` cascade leaves
-- `subject_user_id` and `club_id` on OLD, so its retraction still resolves.
--
-- ** THE FAILURE MODE OF GETTING THIS WRONG IS NOT A MISSING NOTIFICATION, IT IS
-- A THREAD THAT CANNOT BE DELETED. ** `select … into strict`, `perform` + `if
-- not found then raise`, or any raise on the empty case raises `NO_DATA_FOUND`
-- INSIDE the thread's own delete and aborts it — taking
-- `public.moderate_club_thread`, `private.remove_reported_thread`, club deletion
-- and account deletion with it, because all four reach `club_thread_waves`
-- through this cascade. Fan-out failures are deliberately not swallowed, so it
-- surfaces as a rider who cannot delete their own thread and an admin who cannot
-- moderate one. The two forms that are safe are the `delete … using` join below
-- and a scalar subquery compared with `=` (NULL matches nothing); this file uses
-- the first.
--
-- ** STILL NO `pg_trigger_depth()` OR `TG_OP` GUARD. ** The temptation now runs
-- the other way — "skip the cascade case, it does nothing" — and it is refused
-- for the original reason: a guard that skips the cascade case is one refactor
-- away from skipping the rider case, and the rider case is the feature.
--
-- ** The accepted cost, stated. ** wave → un-wave → wave writes a FRESH row each
-- cycle, because the retraction removed the first and §4's key therefore does
-- not collide. That is `090`'s argument against a retraction, and it applies
-- here — `proposal.md` Q2 puts it to the product owner and this file builds the
-- stated default (keep it). The exposure is bounded by `club_thread_waves`'
-- primary key, one wave per rider per thread at a time, and by the recipient
-- being a single rider who can block the waver.
create function private.retract_club_thread_waved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   using public.club_threads t
   where t.id        = old.thread_id
     and n.user_id   = t.author_id
     and n.type      = 'club_thread_waved'
     and n.actor_id  = old.user_id
     and n.thread_id = old.thread_id;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- §9  Revokes — unreachable from every client role and from service_role
-- ---------------------------------------------------------------------------
-- ** Revoking from `public` is what does the work **, because EXECUTE is granted
-- to PUBLIC by default on function creation. The roles are named as well so the
-- statement is correct in isolation and reads as intent rather than as a side
-- effect. Asserted by NAMING the role with `has_function_privilege`, never by
-- attempting the call — `031`'s lesson: the suite runs as the table owner, for
-- whom neither the grant barrier nor PostgREST's `public`-only routing exists.
revoke all on function private.notify_club_thread_replied() from public, anon, authenticated, service_role;
revoke all on function private.notify_club_thread_waved()   from public, anon, authenticated, service_role;
revoke all on function private.retract_club_thread_waved()  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- §10  The three triggers
-- ---------------------------------------------------------------------------
-- ** NONE CARRIES A `when` CLAUSE, AND THE OMISSION IS THE POINT. ** `036` trap
-- (a): copying `023`'s `when (current_user = 'authenticated')` is correct on the
-- PARTICIPATION GATE — which sits on these same two tables and is right to carry
-- it — and WRONG here. A fan-out is not a rule about the client; it must fire
-- for every writer, including a seed, a `security definer` RPC, psql, and above
-- all the writes the RLS suite itself makes. A notification that silently does
-- not happen for a privileged write is a gap with nothing to detect it, and
-- `098.8` is the assertion every other assertion in that block depends on.
--
-- Equally, no body above branches on `current_user`: inside a `security definer`
-- function `current_user` is the OWNER, so such a guard is true on every call and
-- gates nothing. That is `087`'s bug and `078`'s reason for restating the gate
-- inside its RPC.
create trigger notify_club_thread_replied
  after insert on public.club_messages
  for each row execute function private.notify_club_thread_replied();

create trigger notify_club_thread_waved
  after insert on public.club_thread_waves
  for each row execute function private.notify_club_thread_waved();

create trigger retract_club_thread_waved
  after delete on public.club_thread_waves
  for each row execute function private.retract_club_thread_waved();

-- ** THERE IS DELIBERATELY NO `after delete on public.club_messages` TRIGGER. **
-- Its absence is otherwise indistinguishable from an oversight, so the reason is
-- recorded at the site. Three reasons, in force order:
--
--   1. The standing requirement already rules on it: a retraction hanging off a
--      DELETE the ACTOR controls is a rider-aimed delete of another rider's row
--      in a table no rider may write — accepted once for likes and not a second
--      time. `public.delete_own_club_message` is exactly such a DELETE.
--   2. It would be wrong even where it is safe. A rider who replied three times
--      holds ONE notification, keyed on the thread; deleting one of the three
--      messages would clear a row the other two still justify. A correct
--      retraction would have to count the actor's remaining messages in the
--      thread — a read inside a trigger inside another rider's transaction, to
--      undo something that is still true.
--   3. It is `090`'s generator with an extra step: post → delete → post
--      re-notifies once per cycle.
--
-- The cost, stated: a recipient can hold "Bo replied to Sunday run" pointing at
-- a thread with no message from Bo. That is correct — the row records AN EVENT
-- AT AN INSTANT, which `created_at` is, and not a standing claim about the
-- present. Identical to a `club_joined` row surviving the joiner leaving.


-- ---------------------------------------------------------------------------
-- §11  Two comments in the database currently say this feature does not exist
-- ---------------------------------------------------------------------------
-- Both go false the moment this file applies.
--
-- (1) `private.notify_club_waved()`'s comment ended: "A THREAD wave notifies
--     nobody at all; there is deliberately no notify_club_thread_waved." The
--     rest is re-issued VERBATIM with that one sentence replaced. The comment is
--     external, so this costs nothing and does not touch `prosrc`.
comment on function private.notify_club_waved() is
  'Fan-out: waving a rider''s join notifies THAT RIDER and nobody else (092) — not the club owner, not its admins, not its other members. Recipient and actor both come from NEW, never from auth.uid(), which is NULL wherever there is no JWT. security definer because no client role holds INSERT on notifications and the row is addressed to somebody else. The is_blocked conjunct is REDUNDANT TODAY — club_join_waves INSERT''s EXISTS already inherits club_members'' block arm — and is written anyway because that implication is a property of the club_members policy rather than of this table. A THREAD wave DOES now notify, as of 098 (PD-367): private.notify_club_thread_waved addresses club_threads.author_id, and its retraction must JOIN club_threads for that recipient because club_thread_waves does not carry it — which is why this function''s shape cannot be copied there.';

-- (2) `private.remove_reported_thread(uuid)`'s BODY says, in its cascade list:
--     "036's notifications has no thread_id column and is not in the chain."
--     That is now false, and it is the line an operator reads before removing a
--     reported thread.
--
--     ** THE BODY IS DELIBERATELY NOT REWRITTEN, AND THE REASON IS `prosrc`
--     ALONE. ** Correcting an in-body comment needs `create or replace`, which
--     changes `prosrc` — the value every cross-project reconciliation in this
--     repo is keyed on (`md5(prosrc)`, `pg_get_functiondef`), because a reduced
--     apply makes the recorded statement useless for comparison. A DEV/PROD
--     divergence in that hash, produced by a notifications migration, is a
--     signal that costs a session to run down and says nothing true. It would
--     also put `094`'s function behind this file's ordering constraint for a
--     comment. `092` declined the identical trade for `postcard_likes`' policy.
--     The in-body edit is filed as its own follow-up (`tasks.md` 8.4).
--
--     ** It is NOT because the function is `security definer` — it is not one. **
--     `private.remove_reported_thread` has `prosecdef = false` (measured on DEV
--     2026-09-01). The definer one is `public.moderate_club_thread`, a different
--     function, and the two are easy to conflate because they sit in one
--     migration and do the same delete.
comment on function private.remove_reported_thread(uuid) is
  'Removes exactly one club thread and returns what it destroyed — the thread, its club, its author, the reports about it and up to 200 of its messages with a messages_total beside them, so a truncation is visible rather than silent. Reads the evidence BEFORE the delete because the cascade destroys it (076 D5''s retention decision, restated). Owner-only: private is not routed by PostgREST, execute is granted to nobody, and it is deliberately NOT security definer — its only caller is already the owner, and marking it definer would add an advisor for a function no authenticated session can execute. See 094. CORRECTION (098, PD-367): this function''s BODY still says "036''s notifications has no thread_id column and is not in the chain". That is FALSE as of 098 — notifications.thread_id references club_threads ON DELETE CASCADE, so removing a thread here also destroys every club_thread_replied and club_thread_waved notification naming it. The in-body line is left alone deliberately: correcting it needs create or replace, which moves prosrc, the value every DEV/PROD reconciliation in this repo compares.';
