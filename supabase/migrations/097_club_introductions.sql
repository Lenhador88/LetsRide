-- 097 — a rider introduces themselves when they join a club (PD-365)
-- ===========================================================================
--
-- Product owner, 2026-09-01: *"when the user presses 'join club', there should
-- be a popup, welcome to club.... this and that! … Then an input for
-- 'Introduction to be posted' something like that? … So then this announcement
-- still shows 'user x joined etc.' … And this can be waved or commented."*
--
-- Proposal: openspec/changes/introduce-yourself-on-joining-a-club/. It extends
-- PD-356 (`092`) and PD-355, both merged and both on both projects.
--
-- ** AN INTRODUCTION IS A MARKED THREAD, NOT A NEW TABLE. ** Two nullable
-- columns on `club_threads` — `introduces_user_id`, the membership it
-- introduces, and `introduction`, the words — written by one `security definer`
-- RPC so the marker and the text land in a single statement. No new table, so
-- the participation-gate trigger count does not move; ONE new PUBLIC function,
-- so the security-advisor count moves by exactly one.
--
-- `design.md` §D1 carries the argument against a `club_introductions` table in
-- full; the short form is that its rows would be readable by exactly the club's
-- members, blocked-filtered on the author, which is `club_threads`' SELECT
-- policy verbatim — and `009`'s reason applies, *"the one that drifts is the one
-- nobody reads."* Making it a thread also means the comment path, the delete
-- path, the moderation path (`094`), the report path (`094`) and the wave
-- (`092`'s `club_thread_waves`) all already exist and need no widening.
--
-- ---------------------------------------------------------------------------
-- WHY THE MARKER IS ON `club_threads` AND NOT ON `club_members` — MEASURED
-- ---------------------------------------------------------------------------
-- The obvious shape is `club_members.introduction_thread_id`, and it costs an
-- UPDATE policy on the roster. `authenticated` already holds a column-level
-- `UPDATE (club_id, role, user_id)` grant on `club_members` and the table
-- carries ZERO UPDATE policies — row security with no matching policy refuses
-- every UPDATE, and that absence is the only thing making the grant inert.
--
-- Add the obvious own-row policy so a rider can write their own marker and the
-- `role` grant is re-armed with it. Measured on DEV 2026-09-01, in a rolled-back
-- transaction:
--
--   create policy probe on public.club_members for update
--     using (user_id = auth.uid()) with check (user_id = auth.uid());
--   -- as an ORDINARY MEMBER, on their own row:
--   update public.club_members set role = 'admin' where user_id = auth.uid();
--   -- role_after_self_update = admin
--
-- That defeats `019`, `088` and the standing requirement that a club membership
-- role SHALL NOT be self-assignable — silently, by a two-line policy that names
-- no role and reads correct in review. `097.9` pins the UPDATE-policy count at
-- zero so a later change cannot add one quietly, and it is deliberately an
-- assertion with nothing to do with this feature.
--
-- ---------------------------------------------------------------------------
-- TRAP 1 — THE COMPOSITE `ON DELETE SET NULL` MUST NAME ITS COLUMN LIST
-- ---------------------------------------------------------------------------
-- `club_threads.club_id` is NOT NULL, and a bare `on delete set null` nulls
-- EVERY referencing column, so deleting the membership tries to null `club_id`
-- too. Measured on DEV 2026-09-01, both arms, rolled back:
--
--   alter table ... on delete set null                    -- accepted, no warning
--   delete from club_members ...                          -- 23502: null value in
--                                                         -- column "club_id" of
--                                                         -- relation "club_threads"
--   alter table ... on delete set null (introduces_user_id)   -- PG15+; DEV is 17.6
--   delete from club_members ...          -- succeeds; thread survives, marker NULLed
--
-- A rider who introduced themselves could NEVER LEAVE THE CLUB, and nothing in
-- the migration would look wrong. `097.6` is the assertion and it has to delete
-- a membership that ACTUALLY HAS an introduction — a leave by a rider without
-- one succeeds under every wrong shape here and proves nothing.
--
-- ---------------------------------------------------------------------------
-- TRAP 2 — THE PAIRING CHECK MUST BE ONE-DIRECTIONAL
-- ---------------------------------------------------------------------------
-- A foreign key's `SET NULL` action is an UPDATE, so every CHECK on the child
-- row is re-evaluated with the marker already nulled. The biconditional — *both
-- set or both null*, which is the obvious way to forbid a half-state — is
-- therefore violated by the fix for Trap 1, and refuses the same leave with
-- `23514` instead of `23502`. Measured, rolled back:
--
--   check ((introduces_user_id is null) = (introduction is null))  -- accepted at DDL
--   delete from club_members ...    -- 23514: violates check constraint
--                                   --        ← the rider cannot leave
--   check (introduces_user_id is null or introduction is not null) -- the survivor
--   delete from club_members ...    -- SUCCEEDS: club_id intact, marker NULL,
--                                   --           text preserved
--   update club_threads set introduces_user_id = ..., introduction = null;  -- 23514
--
-- So the constraint reads *"a thread that CLAIMS to be an introduction must have
-- text"*, and *"a thread with text whose subject has left"* is permitted rather
-- than impossible. `097.7` asserts the surviving half still refuses a marker
-- with no text; without that half the one-directional form would be vacuous.
--
-- ---------------------------------------------------------------------------
-- ** WHY THE `SET NULL` CANNOT TRIP THE PARTICIPATION GATE ** (tasks 1.1a)
-- ---------------------------------------------------------------------------
-- The obvious wrong conclusion from the two traps above is that the UPDATE the
-- foreign key performs is a *content write* and so is refused for a rider whose
-- consent stamp is NULL — which would make an un-onboarded rider unable to leave
-- a club, a third failure in the same shape as the first two. It is not:
-- `enforce_participation_gate` on `club_threads` is **BEFORE INSERT** only, and
-- carries `when (current_user = 'authenticated')`. Read off the catalogue on DEV
-- 2026-09-01:
--
--   CREATE TRIGGER enforce_participation_gate BEFORE INSERT ON public.club_threads
--     FOR EACH ROW WHEN ((CURRENT_USER = 'authenticated'::name))
--     EXECUTE FUNCTION enforce_participation_gate()
--
-- An UPDATE fires nothing there, and the referential action runs as the owner of
-- the REFERENCING table in any case (`095`'s measurement (c)), for whom the WHEN
-- clause is false. Both halves are independently sufficient; the trigger's
-- event list is the one that survives a change to the other.
--
-- ---------------------------------------------------------------------------
-- WHY `SET NULL` RATHER THAN `CASCADE`
-- ---------------------------------------------------------------------------
-- `092` cascades a join wave with the membership, correctly: a wave decorates
-- the EVENT, and when the event goes so should its reactions. An introduction is
-- not a decoration — it is words the rider wrote and words OTHER riders wrote in
-- reply. Cascading it would mean a rider leaving a club silently deletes
-- everybody's welcome messages, which is the exact defect
-- `club-timeline-engagement` §D2 refused. `add-club-threads` §*Leaving a club
-- SHALL remove the whole conversation from the leaver, and SHALL remove nothing
-- from anybody else* is the standing requirement, and SET NULL is what satisfies
-- it. This is the THIRD table to key off `club_members`' composite primary key;
-- `092`'s `club_join_waves` is the precedent and it cascades, deliberately.
--
-- What the ex-member's thread becomes: an ordinary thread, authored by a rider
-- who is no longer a member, with its `introduction` still populated and its
-- marker NULL. Every render therefore keys off the TEXT and never off the
-- marker — the two come apart permanently at the leave, and a render gated on
-- the marker drops every ex-member's introduction, and every comment written
-- under it, out of a thread that is still there and still readable.
--
-- ---------------------------------------------------------------------------
-- ORDER RELATIVE TO THE DEPLOY: SAFE ON EITHER SIDE; THE TASKS PICK
-- MIGRATION-FIRST
-- ---------------------------------------------------------------------------
-- Stated rather than inherited from "additive, so the order does not matter",
-- which `CLAUDE.md` records as wrong in both directions for the `092`–`096`
-- group.
--
--   * An OLDER bundle against a post-`097` database names none of it. Both
--     columns are nullable with no default, the CHECKs are satisfied by NULL,
--     the foreign key is MATCH SIMPLE so a NULL marker never enforces it, and no
--     trigger is hung — every existing write path behaves identically.
--   * A NEWER bundle against a pre-`097` database calls `introduce_to_club` and
--     gets `PGRST202`. The prompt fails visibly; the join is unaffected.
--
-- ** DO NOT COPY THIS ORDERING INTO STORY 3. ** `098` (`notify-a-club-thread`)
-- adds notification types and must go AFTER its bundle is confirmed serving —
-- the opposite side of the build, per `089`. Two files whose safe sides disagree
-- cannot be one file; `069`/`070` is the worked example.
--
-- ** `036`'s HAND-EXERCISE GATE APPLIES. ** `097` hangs no trigger, but
-- `introduce_to_club` writes into a live table under a live gate and a live
-- policy set. Exercise it by hand on each project as `authenticated` in a
-- rolled-back transaction before trusting it: a member introducing themselves, a
-- non-member refused, an un-onboarded rider refused, a second introduction
-- refused, and a leave by a rider who HAS one.
--
-- ---------------------------------------------------------------------------
-- §Rollback, IN THIS ORDER
-- ---------------------------------------------------------------------------
--   1. drop function public.introduce_to_club(uuid, text);
--   2. drop index public.club_threads_one_introduction_per_membership;
--   3. alter table public.club_threads
--        drop constraint club_threads_introduces_membership_fkey,
--        drop constraint club_threads_introduction_pairing,
--        drop constraint club_threads_introduction_length;
--   4. alter table public.club_threads
--        drop column introduces_user_id, drop column introduction;
--        -- takes the column grants with it
--   5. restore the `club_threads` table comment to `094` §6's text verbatim.
-- Destructive, so it goes AFTER the reverting bundle is confirmed serving —
-- `070`'s rule, not `069`'s. Nothing else is owed: this file adds no policy, no
-- trigger, no table and no notification type.

-- ---------------------------------------------------------------------------
-- §0 PRE-FLIGHT, MEASURED ON `letsride-dev` (fpmrimzxadewsaiwpsel) 2026-09-01
-- ---------------------------------------------------------------------------
-- Recorded here rather than in a report that does not travel with the file.
-- Every number below is a BASELINE for a delta, never a claim to inherit — read
-- it again on each project immediately before applying.
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='club_threads'
--    order by ordinal_position;
--   -- id, club_id, author_id, title, created_at   (five; no probe columns left
--   --                                              behind by the design's
--   --                                              rolled-back measurements)
--
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;      -- 22
--   -- UNCHANGED by this file. 097 adds no table, and the gate is restated
--   -- INSIDE introduce_to_club rather than by a trigger — see §3. 097.14.
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'EXECUTE');     -- 33
--   -- 34 after this file. ONE, because introduce_to_club is the only PUBLIC
--   -- function it adds. Two would mean a helper landed in `public` that
--   -- belonged in `private`.
--
--   select count(*) filter (where cmd='UPDATE'), count(*) from pg_policies
--    where schemaname='public' and tablename='club_members';           -- 0, 3
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.club_messages'::regclass and conname='club_messages_body_length';
--   -- CHECK (((body ~ '\S') AND (length(body) <= 1000)))
--   -- The bound §1 gives `introduction` is THIS one, character for character.

-- ===========================================================================
-- §1. The two columns and their constraints
-- ===========================================================================
-- Both nullable, no default, and NO backfill. Every membership that predates
-- this file — 22 on DEV, six of them on the default club — keeps rendering
-- exactly as it did, plus nothing. "Joined, no introduction" is a designed
-- first-class state, not a gap: `club_threads`' INSERT policy requires the
-- membership to already exist, so the join always commits first and there is
-- always a window in which a rider is a member and has not introduced
-- themselves. A closed tab lands in it.
alter table public.club_threads
  add column introduces_user_id uuid,
  add column introduction       text;

-- The bounds, named after the column and identical to `club_messages_body_length`
-- — an introduction that could be longer than any reply to it would be a
-- different kind of object. `018` is the precedent for the pair (a bound in the
-- database, a matching Zod schema for the message only).
--
-- The `is null` arm is written EXPLICITLY rather than relying on three-valued
-- logic. A CHECK evaluating to NULL passes, so `introduction ~ '\S'` alone would
-- also admit NULL — but silently, by an accident of the standard, and the next
-- reader would have to re-derive that to know whether NULL was intended.
alter table public.club_threads
  add constraint club_threads_introduction_length
  check (introduction is null
         or (introduction ~ '\S' and length(introduction) <= 1000));

-- ** ONE-DIRECTIONAL. ** See TRAP 2 in this file's header before changing it:
-- the biconditional is accepted at DDL time and refuses the leave with 23514.
-- A set marker implies text; text with no marker is the ex-member's thread and
-- is permitted.
alter table public.club_threads
  add constraint club_threads_introduction_pairing
  check (introduces_user_id is null or introduction is not null);

-- ** THE COLUMN LIST IS NOT OPTIONAL. ** See TRAP 1. MATCH SIMPLE (the default)
-- means a NULL marker satisfies the key outright, which is what lets every
-- ordinary thread carry a NULL here against a composite key.
alter table public.club_threads
  add constraint club_threads_introduces_membership_fkey
  foreign key (club_id, introduces_user_id)
  references public.club_members (club_id, user_id)
  on delete set null (introduces_user_id);

-- At most one introduction per MEMBERSHIP — the club and the rider together,
-- never the rider alone, so leaving and rejoining does not inherit the old
-- thread as the new introduction. `design.md` §D2 option (c) loses on exactly
-- this. Partial, because every ordinary thread carries NULL here and NULLs are
-- distinct under a plain unique index anyway; the predicate says so out loud and
-- keeps the index off the rows it can never be asked about.
create unique index club_threads_one_introduction_per_membership
  on public.club_threads (club_id, introduces_user_id)
  where introduces_user_id is not null;

comment on column public.club_threads.introduces_user_id is
  'The MEMBERSHIP this thread introduces — (club_id, introduces_user_id) into club_members (097). NULL on every ordinary thread, and NULLed by the foreign key''s ON DELETE SET NULL (introduces_user_id) when the subject leaves; the column list is not optional, because a bare SET NULL nulls club_id too and the leave fails 23502. Not writable by any client: no INSERT and no UPDATE grant on it for any role, so public.introduce_to_club is the only writer and nobody can mark somebody else''s thread. NOT an embed path — it is a composite key into club_members, so there is no introduces_user_id -> profiles relationship for PostgREST to resolve; the rider''s name comes from author_id, who is the same rider by construction and survives the leave.';

comment on column public.club_threads.introduction is
  'The words a rider wrote when they joined (097). Bounds are club_messages_body_length''s exactly — non-blank, at most 1000 characters — so an introduction cannot be longer than any reply to it. Immutable like the rest of the row: club_threads has no UPDATE grant and no UPDATE policy for anyone, so an introduction is deleted and rewritten rather than edited. ** SURVIVES THE LEAVE, unlike the marker ** — every render keys off THIS column and never off introduces_user_id, or an ex-member''s introduction and every comment under it vanish from a thread that still exists. Paired one-directionally: a set marker implies text; text with a NULL marker is exactly the ex-member case.';

-- The table comment gains the marker, the text, their immutability, the leave
-- behaviour and the retention answer. It is the first thing anyone reads off
-- `\d+ club_threads` or `list_tables`, so leaving it would leave the database
-- itself describing a five-column table.
comment on table public.club_threads is
  'Titled threads inside a club (081 as club_discussions, renamed by 082/PD-313). The audience is CLUB MEMBERSHIP: private.is_club_member(club_id), which includes the owner through 054''s owner arm. ** The parent EXISTS against `clubs` is the REDUNDANT half here, the exact inverse of ride_messages (034) ** — clubs SELECT is `is_public OR owner_id = auth.uid() OR private.is_club_member(id)`, so on a PUBLIC club it admits every signed-in rider and the membership helper is the load-bearing conjunct. The redundant conjunct is written anyway, because the implication is a property of the current three-arm clubs policy which a later arm can break silently, and because using a private membership helper as a sole conjunct anywhere teaches the next table that the shape is safe. Not editable by anyone: no UPDATE policy and no UPDATE grant. Deleted by its author (081''s DELETE policy) or by anyone who ADMINISTERS the club — owner or admin — through public.moderate_club_thread, widened by 094. Reportable by any member who can read it, into public.club_thread_reports (094); nobody in the club reads those. ** 097 adds two nullable columns making a thread an INTRODUCTION: introduces_user_id, a composite key into club_members, and introduction, the rider''s own words. ** Both are immutable for the same reason the title is, both are readable by exactly the audience above and by no separate rule, and neither is writable by any client — public.introduce_to_club is the only writer. A rider has at most one introduction per membership; leaving the club NULLs the marker and keeps the thread, its text and every comment other riders wrote in it, so an ex-member''s introduction is an ordinary thread by a non-member. RETENTION: indefinite. An introduction dies with its club or with its author, through club_threads'' two existing ON DELETE CASCADE keys and through account deletion, and by nothing else — there is no scheduled job and no expiry, because a thread is club content rather than a personal-data record about a subject who has left.';

-- ===========================================================================
-- §2. Grants — SELECT only, and nothing else, for anybody
-- ===========================================================================
-- `club_threads`' SELECT grant for `authenticated` is column-scoped, so a new
-- column is unreadable until it is named. Without this every read touching
-- either column answers 42501, and the failure arrives as a WHOLE SCREEN rather
-- than a missing field.
grant select (introduces_user_id, introduction) on public.club_threads to authenticated;

-- ** NO INSERT AND NO UPDATE GRANT ON EITHER COLUMN, TO ANY ROLE. ** The INSERT
-- grant stays exactly (author_id, club_id, id, title) — 097.2 asserts that list
-- by equality and scoped to the grantee, because a table-wide count reads high:
-- postgres and service_role hold everything by Supabase default (015's trap).
-- This is what makes public.introduce_to_club the only writer and what stops a
-- client marking another rider's thread as that rider's introduction.
--
-- No policy is added to club_threads and none is changed. The introduction
-- inherits the thread's audience; a second arm would be the second copy of the
-- same three-conjunct predicate that §D1 refuses. No UPDATE policy is added to
-- club_members either — see this file's header.

-- ===========================================================================
-- §3. public.introduce_to_club — the only writer
-- ===========================================================================
-- ** THE PARTICIPATION GATE IS RESTATED HERE, AND IT IS MANDATORY RATHER THAN
-- BELT-AND-BRACES. ** Every enforce_participation_gate trigger carries
-- `when (current_user = 'authenticated')`, and `current_user` inside a
-- `security definer` body is the FUNCTION'S OWNER — so the trigger on
-- club_threads cannot fire for this insert whatever the trigger count says.
-- `078` is the measured precedent (a trigger there could never fire, which is
-- why `078.9` asserts its absence rather than adding one) and `085` is the
-- remedy: private.may_participate_for(candidate), the subject-taking twin, which
-- exists for exactly this. ** Adding a trigger here would raise the coverage
-- count while gating nothing. ** 097.4 is the assertion; 097.14 pins the count.
--
-- ** ONE RAISE SITE, and it is one `raise` STATEMENT rather than several with
-- the same wording. ** A club that does not exist, one the caller cannot see,
-- one they are not a member of, one they OWN, the default club, an un-onboarded
-- caller and a second introduction all reach the same line, so the function is
-- not an oracle for private clubs — `083`, `085` and `091` all ship this shape.
-- The unique-index violation is MAPPED ONTO IT rather than allowed to escape as
-- a bare 23505: a concurrent second introduction is a refusal a caller must not
-- be able to tell apart from the others.
--
-- ** IT TAKES A CLUB AND NEVER A RIDER ID. ** The subject is read from
-- auth.uid() and from nowhere else, so there is no argument on which "we check
-- the id matches the caller" could later stop being checked — `085`'s and
-- `088`'s idiom.
create or replace function public.introduce_to_club(target_club uuid, body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  -- Every refusal is a conjunct of this one condition, so none of them has a
  -- raise of its own. private.is_club_member reads auth.uid() internally, which
  -- is CORRECT inside a definer body whose subject is the caller — unlike a
  -- fan-out, where the subject is the recipient and 036 trap (c) forbids it.
  if v_uid is not null
     and private.may_participate_for(v_uid)
     and private.is_club_member(target_club)
     and exists (
           select 1
             from public.clubs c
            where c.id = target_club
              -- The Welcome club takes no introduction: 058 auto-joins every
              -- rider to it inside a wizard decision #5 gives no skip
              -- affordance, so a prompt there is the first thing a new rider is
              -- asked and the one they least understand.
              and not c.is_default
              -- A club's owner introducing themselves to the club they founded
              -- expresses nothing. 054 makes the owner a member, so without this
              -- the state rule would prompt every founder.
              and c.owner_id <> v_uid
         )
     -- Checked against the ROSTER as well as against clubs.owner_id, because
     -- 054/PD-128 allows an ownerless owner and 095 records the two drifting.
     and not exists (
           select 1
             from public.club_members m
            where m.club_id = target_club
              and m.user_id = v_uid
              and m.role = 'owner'
         )
     -- The ordinary second-introduction case. The unique index below is what
     -- ENFORCES it; this only keeps the common refusal off the exception path.
     and not exists (
           select 1
             from public.club_threads t
            where t.club_id = target_club
              and t.introduces_user_id = v_uid
         )
  then
    begin
      insert into public.club_threads (club_id, author_id, title, introduces_user_id, introduction)
      -- ** A CONSTANT THAT NAMES NOBODY. ** club_threads has no UPDATE grant
      -- and no UPDATE policy, so a title is immutable for the life of the
      -- thread, and club-timeline-engagement §D2 refused a shape precisely for
      -- publishing a living rider's username into one. The cost is that a
      -- club's Threads list can show several identically-titled rows, which the
      -- secondary line answers by naming the AUTHOR — derived from author_id,
      -- which survives the leave that nulls the marker.
      values (target_club, v_uid, 'Introduction', v_uid, body)
      returning id into v_id;
    exception
      when unique_violation then
        -- The concurrent second introduction the `not exists` above cannot see.
        -- Swallowed to a NULL id so it falls into the single raise below.
        v_id := null;
    end;
  end if;

  if v_id is null then
    raise exception 'no club of yours is open to an introduction from you'
      using errcode = 'insufficient_privilege';
  end if;

  return v_id;
end;
$$;

revoke all on function public.introduce_to_club(uuid, text) from public, anon;
grant execute on function public.introduce_to_club(uuid, text) to authenticated;

comment on function public.introduce_to_club(uuid, text) is
  'A rider posts their own introduction to one club, as one statement (097). Takes a CLUB and the text and NEVER a rider id — the subject is auth.uid() and nothing else, so no caller can introduce anybody but themselves. FOUR refusals, plus two the schema adds: a caller who is not a member (private.is_club_member, caller-relative and correct in a definer body), a caller whose consent stamp is NULL (private.may_participate_for — MANDATORY here, because enforce_participation_gate carries `when (current_user = ''authenticated'')` and current_user in a definer body is the owner, so the trigger on club_threads cannot fire for this insert; 078 is the precedent and adding a trigger instead would raise the coverage count while gating nothing), the club''s OWNER (054 makes them a member; introducing yourself to a club you founded expresses nothing), and the DEFAULT club (058 auto-joins every rider inside a wizard with no skip affordance). The schema adds the bounds CHECK and the per-membership unique index. ** ONE RAISE SITE ** — a nonexistent club, an invisible one, a club the caller is not in, one they own, the default club, an un-onboarded caller and a SECOND introduction all raise the identical message and SQLSTATE, and the unique violation is mapped onto it rather than escaping as 23505, so the function is not an oracle for private clubs. Writes a constant title naming nobody, because a title is immutable and club-timeline-engagement §D2 refused publishing a living rider''s username into one. Returns the new thread id. The ACL is the house shape for a public RPC — revoked from PUBLIC and anon, granted to authenticated — and service_role keeps EXECUTE from Supabase''s ambient default on `public`, exactly as approve_club_join_request, moderate_club_thread, accept_ride_invite, claim_ride_invite_link and remove_club_member all do (measured on DEV 2026-09-01: sr=t, anon=f on every one of them). That is harmless rather than overlooked: the subject is auth.uid(), a service_role caller carries no JWT, so auth.uid() is NULL and the function refuses at its first conjunct. It fails CLOSED for the one role that could bypass RLS.';

-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- §1: the FK by OBJECT. ** The column list is the assertion. ** A recorded
--   -- migration text proves nothing; pg_get_constraintdef proves the catalogue.
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.club_threads'::regclass order by contype, conname;
--   -- club_threads_introduces_membership_fkey must read:
--   --   FOREIGN KEY (club_id, introduces_user_id)
--   --     REFERENCES club_members(club_id, user_id)
--   --     ON DELETE SET NULL (introduces_user_id)
--
--   -- §1: the pairing CHECK is the one-directional form, not the biconditional
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'club_threads_introduction_pairing';
--   -- CHECK ((introduces_user_id IS NULL) OR (introduction IS NOT NULL))
--
--   -- §1: the index is PARTIAL
--   select indexdef from pg_indexes
--    where indexname = 'club_threads_one_introduction_per_membership';
--   -- ... WHERE (introduces_user_id IS NOT NULL)
--
--   -- §2: grants, SCOPED TO THE GRANTEE (015's trap)
--   select column_name, privilege_type from information_schema.column_privileges
--    where table_name = 'club_threads' and grantee = 'authenticated'
--      and column_name in ('introduces_user_id', 'introduction') order by 1, 2;
--   -- exactly two rows, both SELECT
--   select string_agg(attname, ',' order by attname) from pg_attribute
--    where attrelid = 'public.club_threads'::regclass and attnum > 0
--      and not attisdropped
--      and has_column_privilege('authenticated', 'public.club_threads', attname, 'insert');
--   -- author_id,club_id,id,title      ← unchanged by this file
--
--   -- §3: the function's shape and its ACL
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.introduce_to_club(uuid,text)'::regprocedure;
--   -- t, {"search_path=\"\""}
--   select has_function_privilege('authenticated',
--            'public.introduce_to_club(uuid,text)', 'execute'),            -- t
--          has_function_privilege('anon',
--            'public.introduce_to_club(uuid,text)', 'execute'),            -- f
--          has_function_privilege('service_role',
--            'public.introduce_to_club(uuid,text)', 'execute');            -- t
--   -- ** service_role is TRUE and that is CORRECT — this line said `f` until a
--   -- pre-merge review measured it. ** It is Supabase's ambient default on
--   -- `public` and the house shape: approve_club_join_request,
--   -- moderate_club_thread, accept_ride_invite, claim_ride_invite_link and
--   -- remove_club_member all read sr=t, anon=f identically. The function comment
--   -- below already said so; this block contradicted it. Harmless because the
--   -- subject is auth.uid() and a service_role caller carries no JWT, so it
--   -- refuses at the first conjunct — it fails CLOSED for the one role that
--   -- could bypass RLS. Left as `f` this is a verification step that reads FAIL
--   -- against a correct database at exactly the moment it is run, the PROD
--   -- promotion, which is the defect 099's header names in its own footer.
--
--   -- the two DELTAS, against the §0 baseline read on THIS project
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;
--   -- the pre-flight count, + 0
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'EXECUTE');
--   -- the pre-flight count, + 1   (introduce_to_club, and nothing else)
--
--   -- get_advisors(security): exactly ONE new
--   -- authenticated_security_definer_function_executable, for
--   -- introduce_to_club. Two would mean a helper landed in `public` that
--   -- belonged in `private`.
