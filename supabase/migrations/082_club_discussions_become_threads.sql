-- 082: club Discussions become club THREADS — a pure rename.
--
-- Linear PD-313. The naming contract is that issue's table and nothing here
-- departs from it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS, AND WHAT IT IS NOT
-- ---------------------------------------------------------------------------
-- It is a rename and only a rename. NO policy predicate, grant, trigger, CHECK
-- expression, index definition, publication membership or function body LOGIC
-- changes. 081 established the audience — club membership through
-- private.is_club_member, with the parent EXISTS against `clubs` as the
-- REDUNDANT half, the inverse of 034 — and that audience is untouched here.
-- If a reader of a future diff wants to know why any predicate below reads the
-- way it does, 081's header is still the answer and this file adds nothing to
-- it.
--
--   public.club_discussions        ->  public.club_threads
--   public.club_discussion_reads   ->  public.club_thread_reads
--   public.club_messages           ->  UNCHANGED
--   *.discussion_id                ->  *.thread_id
--   club_discussion_unread(uuid)   ->  club_thread_unread(uuid)
--                                      (OUT column discussion_id -> thread_id)
--   moderate_club_discussion(uuid) ->  moderate_club_thread(uuid)
--   stamp_club_discussion_read()   ->  stamp_club_thread_read()
--   delete_own_club_message(uuid)  ->  UNCHANGED
--
-- ---------------------------------------------------------------------------
-- THE THREE TRAPS, AND WHICH SECTION BELOW ANSWERS EACH
-- ---------------------------------------------------------------------------
-- 1. `alter table ... rename to` CARRIES policies, indexes, constraints,
--    triggers and publication membership across — and KEEPS THEIR NAMES. A
--    rename that stops at the table leaves `club_discussion_reads_pkey` and
--    "Riders see only their own discussion watermarks" sitting on a table
--    called club_thread_reads, which is half a rename and is the thing PD-313
--    exists to avoid. §2, §3, §4 and §5 rename every one of them explicitly.
--
-- 2. `alter table ... rename column` DOES update policy expressions, CHECK
--    expressions and index definitions on its own, because those are stored
--    PARSED (as nodetrees keyed on attnum) rather than as text. That is
--    asserted rather than assumed: the footer re-reads pg_get_expr,
--    pg_get_indexdef and pg_get_constraintdef and the RLS suite's 081/082
--    assertions read the renamed column out of the live policy text.
--
-- 3. ** FUNCTION BODIES ARE STORED AS TEXT AND RE-PARSED AT RUNTIME. ** A
--    plpgsql or sql body naming public.club_discussions does NOT follow the
--    table across, and does not fail at rename time — it fails the first time
--    a rider calls it, silently until then. Exactly two functions in the whole
--    database name the renamed identifiers in their bodies, measured on
--    letsride-dev 2026-08-27 rather than assumed:
--
--      select n.nspname||'.'||p.proname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname in ('public','private','storage')
--         and (p.prosrc ilike '%club_discussion%' or p.prosrc ilike '%discussion_id%');
--      -->  public.club_discussion_unread, public.moderate_club_discussion
--
--    Both are dropped and recreated in §6. `delete_own_club_message` names
--    only public.club_messages, which is not renamed, so it is left entirely
--    alone — its body, its ACL and its comment.
--
-- ---------------------------------------------------------------------------
-- WHY §6 DROPS RATHER THAN REPLACES, AND WHAT THAT COSTS
-- ---------------------------------------------------------------------------
-- `create or replace function` cannot change a function's name, cannot rename
-- an IN parameter, and cannot rename an OUT column. All three apply here, so
-- two of the three renamed functions are dropped and recreated:
--
--   * club_thread_unread's OUT column changes name (discussion_id ->
--     thread_id). That is the single change in this migration that
--     `create or replace` structurally cannot express, which makes it the one
--     most likely to be left behind — hence its own assertion in the suite,
--     read off information_schema.parameters rather than off a call.
--   * moderate_club_thread changes both its name and its IN parameter's
--     (discussion -> thread).
--
-- ** A DROPPED FUNCTION TAKES ITS ACL WITH IT. ** A recreated function is
-- born with EXECUTE granted to PUBLIC — Postgres's default, which 005 spent a
-- whole migration undoing — so every revoke and grant is re-issued in §7
-- immediately after. Forgetting that half ships an RPC that either nobody can
-- call or everybody can.
--
-- stamp_club_thread_read is the exception and is renamed in place with
-- `alter function ... rename to`: its body names no table at all
-- (`new.last_read_at := now()`), so there is nothing to re-parse, and the
-- rename preserves both the OID the trigger points at and the ACL 081 revoked.
-- The trigger is then renamed with `alter trigger`, which is why §5 does not
-- have to drop and recreate it.
--
-- ---------------------------------------------------------------------------
-- COMMENTS DO NOT FOLLOW A RENAME
-- ---------------------------------------------------------------------------
-- `comment on` text is a string. Renaming the object it hangs off leaves it
-- word for word as it was, so §8 re-issues every one that carried the old
-- vocabulary — including public.enforce_participation_gate()'s, which names
-- its twelfth and thirteenth triggers BY TABLE and would otherwise still point
-- at a table that no longer exists. The gate itself is untouched: still
-- thirteen triggers, still the same function, and club_thread_reads still
-- deliberately carries none (081 §3b).
--
-- ---------------------------------------------------------------------------
-- DATA
-- ---------------------------------------------------------------------------
-- None. This migration moves no rows and this file contains no DML. The DEV
-- fixture rows several agents left in these tables were deleted separately,
-- through execute_sql, deliberately NOT from here: a data deletion in a
-- migration would also run against PROD, where those tables mean something
-- different.
-- ===========================================================================


-- ===========================================================================
-- §1. Tables and columns
-- ===========================================================================

alter table public.club_discussions      rename to club_threads;
alter table public.club_discussion_reads rename to club_thread_reads;

alter table public.club_messages     rename column discussion_id to thread_id;
alter table public.club_thread_reads rename column discussion_id to thread_id;


-- ===========================================================================
-- §2. Constraints
-- ===========================================================================
-- Renaming a PRIMARY KEY constraint renames its underlying index with it, so
-- club_threads_pkey and club_thread_reads_pkey do not reappear in §3.

alter table public.club_threads rename constraint club_discussions_pkey           to club_threads_pkey;
alter table public.club_threads rename constraint club_discussions_club_id_fkey   to club_threads_club_id_fkey;
alter table public.club_threads rename constraint club_discussions_author_id_fkey to club_threads_author_id_fkey;
alter table public.club_threads rename constraint club_discussions_title_length   to club_threads_title_length;

alter table public.club_messages rename constraint club_messages_discussion_id_fkey to club_messages_thread_id_fkey;

alter table public.club_thread_reads rename constraint club_discussion_reads_pkey              to club_thread_reads_pkey;
alter table public.club_thread_reads rename constraint club_discussion_reads_user_id_fkey      to club_thread_reads_user_id_fkey;
alter table public.club_thread_reads rename constraint club_discussion_reads_discussion_id_fkey to club_thread_reads_thread_id_fkey;


-- ===========================================================================
-- §3. Indexes
-- ===========================================================================
-- Definitions are untouched — the column rename in §1 rewrote them, because an
-- index's key is stored as attnums rather than as text. Only the names move.

alter index public.club_discussions_club_id_idx   rename to club_threads_club_id_idx;
alter index public.club_discussions_author_id_idx rename to club_threads_author_id_idx;

alter index public.club_messages_discussion_id_idx rename to club_messages_thread_id_idx;

alter index public.club_discussion_reads_discussion_id_idx rename to club_thread_reads_thread_id_idx;


-- ===========================================================================
-- §4. Policies
-- ===========================================================================
-- Predicates are untouched — §1's column rename rewrote the two that named
-- discussion_id, for the reason in §3. Only names move, and only the five that
-- carried the old vocabulary: "Club members open their own threads, as
-- themselves", "Thread authors delete their own threads", "Club members post
-- into their club's threads, as themselves" and "Club messages are readable by
-- that club's members" already said thread and are left exactly as 081 wrote
-- them.

alter policy "Club discussions are readable by that club's members"
  on public.club_threads rename to "Club threads are readable by that club's members";

alter policy "Riders see only their own discussion watermarks"
  on public.club_thread_reads rename to "Riders see only their own thread watermarks";

alter policy "Riders mark only their own discussions read"
  on public.club_thread_reads rename to "Riders mark only their own threads read";

alter policy "Riders advance only their own discussion watermarks"
  on public.club_thread_reads rename to "Riders advance only their own thread watermarks";


-- ===========================================================================
-- §5. Triggers
-- ===========================================================================
-- The two enforce_participation_gate triggers keep their name — it is shared
-- across all thirteen gated tables and names the rule rather than the table.
-- The watermark stamp is renamed in place; §6 renames the function it points
-- at with `alter function`, which preserves the OID, so the trigger keeps
-- working across both statements and never has to be dropped.

alter trigger stamp_club_discussion_read on public.club_thread_reads
  rename to stamp_club_thread_read;


-- ===========================================================================
-- §6. Functions
-- ===========================================================================

-- 6a. The stamp. Renamed in place: no body change is needed (it names no
--     table), and the rename keeps the OID the §5 trigger points at and the
--     ACL 081 revoked from public, anon and authenticated.
alter function public.stamp_club_discussion_read() rename to stamp_club_thread_read;

-- 6b. The unread answer. Dropped and recreated because its OUT column changes
--     name, which `create or replace` cannot do. Body identical to 081's with
--     the three renamed identifiers substituted: still LANGUAGE sql, still
--     STABLE, still SECURITY INVOKER — 081 §4's whole point, so the SELECT
--     policies decide what counts — and still search_path pinned to ''.
--
--     The OUT column and the column it reads are both now `thread_id`, exactly
--     as they were both `discussion_id` before: a qualified column reference
--     (m.thread_id, w.thread_id) takes precedence over a parameter name of the
--     same spelling, so the substitution is symmetric and introduces no new
--     ambiguity.
drop function public.club_discussion_unread(uuid);

create function public.club_thread_unread(club uuid)
returns table (thread_id uuid, has_unread boolean)
language sql
stable
set search_path = ''
as $$
  select d.id,
         exists (
           select 1
             from public.club_messages m
            where m.thread_id = d.id
              and m.author_id <> auth.uid()
              and m.created_at > coalesce(
                    greatest(
                      (select w.last_read_at from public.club_thread_reads w
                        where w.user_id = auth.uid() and w.thread_id = d.id),
                      (select k.joined_at from public.club_members k
                        where k.club_id = d.club_id and k.user_id = auth.uid())
                    ),
                    d.created_at
                  )
         )
    from public.club_threads d
   where d.club_id = club;
$$;

-- 6c. Owner moderation. Dropped and recreated because both its name and its IN
--     parameter's change. Still SECURITY DEFINER — 081 §4's reason holds
--     unchanged: RLS filters a DELETE by what the caller may READ, so an owner
--     who has blocked the thread's author cannot see the row and a policy-arm
--     delete would match zero rows while PostgREST reported success. The
--     internal clubs.owner_id = auth.uid() check is still the whole access
--     control, and there is still exactly one raise site so "no such thread"
--     and "not your club" stay indistinguishable.
--
--     The raise message's wording follows the rename. Nothing reads it —
--     `grep -rn "no discussion with that id" src/ supabase/` found only 081
--     itself — so this is vocabulary, not contract.
create function public.moderate_club_thread(thread uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  select d.id
    into v_id
    from public.club_threads d
    join public.clubs c on c.id = d.club_id
   where d.id = thread
     and c.owner_id = v_uid
     for update of d;

  if not found then
    raise exception 'no thread with that id sits in a club owned by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- One row. The FK cascade takes the messages and the watermarks.
  delete from public.club_threads d where d.id = v_id;
end;
$$;

drop function public.moderate_club_discussion(uuid);

-- public.delete_own_club_message(uuid) is deliberately absent from this
-- section. Its name is unchanged by the contract, its body names only
-- public.club_messages — which is not renamed — and touching it would drop and
-- recreate an ACL for no reason.


-- ===========================================================================
-- §7. Grants on the recreated functions
-- ===========================================================================
-- A dropped function takes its ACL with it and a new one is born with EXECUTE
-- to PUBLIC. These two lines are 081 §5's, re-issued verbatim under the new
-- names. stamp_club_thread_read is NOT re-granted here because §6a renamed it
-- rather than recreating it, so its ACL never left — the revoke is repeated
-- anyway, because it is idempotent and because a reader auditing this file
-- should not have to reason about which of the three kept its privileges.

revoke all    on function public.club_thread_unread(uuid) from public, anon;
grant execute on function public.club_thread_unread(uuid) to authenticated;

revoke all    on function public.moderate_club_thread(uuid) from public, anon;
grant execute on function public.moderate_club_thread(uuid) to authenticated;

revoke all on function public.stamp_club_thread_read() from public, anon, authenticated;


-- ===========================================================================
-- §8. Comments
-- ===========================================================================
-- Re-issued in full rather than patched, because `comment on` replaces the
-- whole string. Every one of these is 081's text with the renamed identifiers
-- substituted and nothing else changed; where the word "discussion" was being
-- used as a common noun for a topic thread it becomes "thread", which is the
-- vocabulary the contract adopts.

comment on table public.club_threads is
  'Titled threads inside a club (081 as club_discussions, renamed by 082/PD-313). The audience is CLUB MEMBERSHIP: private.is_club_member(club_id), which includes the owner through 054''s owner arm. ** The parent EXISTS against `clubs` is the REDUNDANT half here, the exact inverse of ride_messages (034) ** — clubs SELECT is `is_public OR owner_id = auth.uid() OR private.is_club_member(id)`, so on a PUBLIC club it admits every signed-in rider and the membership helper is the load-bearing conjunct. The redundant conjunct is written anyway, because the implication is a property of the current three-arm clubs policy which a later arm can break silently, and because using a private membership helper as a sole conjunct anywhere teaches the next table that the shape is safe. Not editable by anyone: no UPDATE policy and no UPDATE grant. Deleted by its author (policy) or by the club owner (public.moderate_club_thread).';

comment on column public.club_threads.created_at is
  'Server-owned: withheld from the INSERT column grant (081 §3, following 034 §4b), because a default applies only when the column is OMITTED and PostgREST will happily send it. The thread list sorts on this, so a client-stamped value pins a thread to the top of a club for ever and the only remedy is a delete.';

comment on table public.club_messages is
  'Messages inside a club thread (081, PD-307; the parent table was renamed to club_threads by 082/PD-313 and this table''s name and column grants were not). A GRANDCHILD: its SELECT policy restates the full audience — the clubs EXISTS, private.is_club_member, and its own block arm on club_messages.author_id — rather than relying on the one-hop EXISTS against club_threads, so the audience is discoverable from the policy text and a change to the thread policy cannot silently retarget it. The block arm is on the MESSAGE''s author, not inherited from the thread: a thread by an unblocked author can hold messages by a blocked one. ** There is NO DELETE POLICY and NO DELETE GRANT, and that is the enforcement rather than an oversight ** — deletion is public.delete_own_club_message(uuid). RLS applies the SELECT policy to a DELETE whose WHERE names a column (measured, Postgres 17.6), so a rider blocked by the thread''s author would silently be unable to erase their own words through a policy. No UPDATE policy and no UPDATE grant either.';

comment on column public.club_messages.id is
  'Client-suppliable on purpose (034''s precedent): an interrupted send retried with the same id lands as 23505, which sendClubMessage reads as success rather than double-posting. It discloses nothing — RLS evaluates WITH CHECK before the index insert, so a non-member is refused 42501 and never reaches 23505.';

comment on column public.club_messages.created_at is
  'Server-owned: withheld from the INSERT column grant (081 §3, following 034 §4b). The thread is ordered by it, so a client-stamped value pins a message to the end of every member''s thread for ever.';

comment on table public.club_thread_reads is
  'Per-thread read watermark (081 as club_discussion_reads, renamed by 082/PD-313). One row per (rider, thread); last_read_at is server-imposed by public.stamp_club_thread_read() on INSERT and UPDATE, never client-supplied — not for tamper-resistance but because it is compared against club_messages.created_at, which is server-owned, and a comparison spanning a phone''s clock and the database''s is wrong in a way nothing logs (068). Readable ONLY by the row''s owner: this app has no read receipts, and that is a refusal rather than an omission. Per THREAD rather than per club, because a per-club watermark would make reading thread A mark thread B read. Bounded by threads opened rather than by membership, which is weaker than feed_reads and ride_reads and is named rather than discovered. Retention is indefinite: it dies with the thread or the rider, through the two cascades and nothing else.';

comment on function public.club_thread_unread(uuid) is
  'Which of this club''s threads hold a message the caller has not read (081, renamed by 082/PD-313)? SECURITY INVOKER, so 081 §2''s SELECT policies decide what counts — club membership and blocks included — and a club the caller cannot see answers zero rows rather than raising. Excludes the caller''s own messages (079''s fix at birth). The comparison point is coalesce(greatest(last_read_at, joined_at), created_at): GREATEST rather than a coalesce between the first two, because a watermark survives leaving the club and a rejoiner would otherwise be badged with the whole back catalogue; the third arm is what keeps a club owner holding no club_members row from being the one member whose dot never lights.';

comment on function public.moderate_club_thread(uuid) is
  'Deletes one thread in a club the CALLER owns (081 as moderate_club_discussion, renamed by 082/PD-313). security definer and an RPC rather than a second arm on the DELETE policy, because RLS filters a DELETE by what the caller may READ: an owner who has blocked the thread''s author cannot see the row, so a policy-arm delete matches zero rows and PostgREST reports success. Re-checks clubs.owner_id = auth.uid() internally — RLS does not apply inside the body, so that check is the whole access control. One raise site, so "no such thread" and "not your club" are indistinguishable (043''s shape). The messages and watermarks go by cascade.';

comment on function public.stamp_club_thread_read() is
  'Imposes club_thread_reads.last_read_at from the server clock on INSERT and UPDATE (081, renamed by 082/PD-313). Not tamper-resistance — forging your own watermark suppresses your own dot — but because the value is compared against club_messages.created_at, which 081 §3 makes server-owned, and a comparison spanning two clocks is wrong in a way nothing logs (068).';

-- The gate is untouched — same function, same thirteen triggers, same tables.
-- Only the twelfth one's TABLE has a new name, and this comment is the only
-- place in the database that spells it out.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, thirteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';


-- ===========================================================================
-- §9. Verification — run against the project this was applied to
-- ===========================================================================
--
--   -- Neither old table name resolves, and neither old function name does.
--   -- A view or a compatibility shim left behind would pass a "the new name
--   -- exists" check and fail this one.
--   select to_regclass('public.club_discussions'),
--          to_regclass('public.club_discussion_reads'),
--          to_regclass('public.club_threads'),
--          to_regclass('public.club_thread_reads');
--   -- null | null | club_threads | club_thread_reads
--
--   select to_regprocedure('public.club_discussion_unread(uuid)'),
--          to_regprocedure('public.moderate_club_discussion(uuid)'),
--          to_regprocedure('public.stamp_club_discussion_read()'),
--          to_regprocedure('public.club_thread_unread(uuid)'),
--          to_regprocedure('public.moderate_club_thread(uuid)'),
--          to_regprocedure('public.stamp_club_thread_read()');
--   -- null | null | null | then the three new signatures
--
--   -- 0 — no policy, index, trigger or constraint name on the two renamed
--   -- tables still carries the old vocabulary.
--   select count(*) from (
--     select policyname n from pg_policies
--      where tablename in ('club_threads','club_thread_reads','club_messages')
--     union all
--     select indexname from pg_indexes
--      where tablename in ('club_threads','club_thread_reads','club_messages')
--     union all
--     select conname from pg_constraint
--      where conrelid in ('public.club_threads'::regclass,
--                         'public.club_thread_reads'::regclass,
--                         'public.club_messages'::regclass)
--     union all
--     select tgname from pg_trigger
--      where tgrelid in ('public.club_threads'::regclass,
--                        'public.club_thread_reads'::regclass,
--                        'public.club_messages'::regclass)
--        and not tgisinternal
--   ) x where n ilike '%discussion%';
--
--   -- thread_id — the one thing create or replace cannot change, and therefore
--   -- the one most likely to have been left behind.
--   select parameter_name from information_schema.parameters
--    where specific_schema = 'public'
--      and specific_name like 'club_thread_unread%'
--      and parameter_mode = 'OUT';
--
--   -- The column rename rewrote these; nothing here was edited by hand.
--   select pg_get_indexdef('public.club_messages_thread_id_idx'::regclass);
--   -- ... USING btree (thread_id, created_at, id)
--   select polname, pg_get_expr(polqual, polrelid)
--     from pg_policy where polrelid = 'public.club_thread_reads'::regclass;
--   -- ... user_id = auth.uid() ... thread_id ... nowhere discussion_id
--
--   -- 8 — 3 on club_threads (select, insert, delete), 2 on club_messages
--   -- (select, insert), 3 on club_thread_reads (select, insert, update).
--   -- Unchanged by this migration, which is the point.
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('club_threads','club_messages','club_thread_reads');
--
--   -- 0 — anon holds nothing, table-level or column-level.
--   select count(*) from information_schema.role_table_grants
--    where grantee = 'anon'
--      and table_name in ('club_threads','club_messages','club_thread_reads');
--
--   -- 13 — unchanged. A rename cannot move this number, so a 12 means a
--   -- trigger went with a table it should have ridden across on.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- club_messages present, club_threads absent — 081 §6's decision, carried
--   -- across by the rename rather than re-stated.
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename in ('club_threads','club_messages','club_thread_reads');
--
--   -- authenticated may execute both RPCs; anon may execute neither. This is
--   -- the assertion that catches a dropped function recreated without §7.
--   select has_function_privilege('authenticated','public.club_thread_unread(uuid)','execute'),
--          has_function_privilege('anon',         'public.club_thread_unread(uuid)','execute'),
--          has_function_privilege('authenticated','public.moderate_club_thread(uuid)','execute'),
--          has_function_privilege('anon',         'public.moderate_club_thread(uuid)','execute'),
--          has_function_privilege('authenticated','public.stamp_club_thread_read()','execute');
--   -- t | f | t | f | f
--
--   -- Security advisors: FIFTEEN, exactly as before, and the two 081-era
--   -- definer functions now appear under their NEW names. A count that MOVED
--   -- is the defect this checks for: 14 means a definer function was dropped
--   -- and not recreated, 16 means one was recreated without its §7 revoke.
--   -- moderate_club_thread and delete_own_club_message are the two;
--   -- club_thread_unread is INVOKER and contributes none.
