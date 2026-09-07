-- ===========================================================================
-- 111 — a removal bars a live invite link (PD-361)
-- ===========================================================================
-- `088`'s remove_club_member deletes one club_members row and its own comment
-- says "removal is not a ban". `093` shipped afterwards, and its reachability
-- helper carries no conjunct about removal — so a removed rider pastes the same
-- pre-minted URL back in and is a member again, with no approval, no
-- notification to the admin who removed them, and nothing anywhere recording
-- that it happened.
--
-- ** THE NARROW READING, AND IT IS THE OWNER'S. ** This closes the INVITE-LINK
-- door and nothing else. A removed rider may still ask to join and be approved,
-- may still be sent and accept an in-app invite, and may still press Join on a
-- public club — each of which is an admin (or the club's own openness) deciding
-- again, which is exactly what a removal did not decide against. The wide
-- reading — a club-level ban refusing every route — is a bigger product
-- statement and was declined; see proposal.md.
--
-- ORDERING: additive, and there is NOTHING to sequence against. The change
-- touches no file under `src/`, so neither the newer-bundle-against-older-
-- database case (`096`) nor its reverse (`092`) exists, and no shipped bundle
-- can observe any object created here. The PROD promotion carries the same
-- ordering for the same reason.
--
-- THE HAND-EXERCISE GATE DOES FIRE, and it is the reason this file is careful:
-- §2 hangs an AFTER INSERT trigger on `club_members`, which is every club join
-- in the app. Every affected path was exercised by hand on DEV in a rolled-back
-- transaction, as `authenticated`, counting `notifications` rows rather than
-- assuming them — tasks.md group 4.
--
-- Order within the file: the table and its posture, then the clearing trigger,
-- then the reader, then the writer — so the function that WRITES the record
-- lands after everything that reads and clears it.

-- ===========================================================================
-- §1. public.club_removals — a BAR, and not a log
-- ===========================================================================
-- ** STATE KEYED ON THE PAIR, NOT AN AUDIT TRAIL. ** At most one row per barred
-- pair, idempotent to write, and DELETED the instant the rider is readmitted
-- (§2). That deletion is what stops the bar becoming, by neglect, the permanent
-- ban the owner declined — invisibly, since §1c means no role can read the row
-- to notice.
--
-- ** NO `removed_by` COLUMN, and that is a spec requirement rather than a
-- saving. ** `manage-club-riders` requires that nothing anywhere records who
-- removed whom. An actor column would break that for an audit trail with no
-- reader, on the most sensitive fact in the table. If the product later wants
-- *who removed whom, and when*, that is a different table with its own
-- retention answer and its own visibility decision.
--
-- `removed_at` records WHEN. Nothing reads it today; it is what an expiry would
-- need if the owner ever asks for one, and §4's upsert keeps it meaning *the
-- most recent removal*.
create table public.club_removals (
  club_id    uuid        not null references public.clubs(id)    on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- ** THE PRIMARY KEY SERVES THE READ; THIS INDEX SERVES THE CASCADE. ** §3's
-- conjunct probes (club_id, user_id) and the PK answers it. `user_id` is a
-- second FK into public.profiles whose leading column the PK does not index, so
-- deleting a profile would scan this table — and `029 §A` derives that rule over
-- the catalogue rather than listing the tables it applies to, which is what
-- caught the omission here rather than a reviewer noticing it.
create index club_removals_user_id_idx on public.club_removals (user_id);

-- ---------------------------------------------------------------------------
-- §1b. RLS on, and NO policy — nobody reads a removal
-- ---------------------------------------------------------------------------
-- The cheapest correct answer to *who may read a removal*, and the one that
-- needs no per-role argument: nobody. There is no designed surface, so granting
-- SELECT would mean deciding what an admin, a member and the removed rider each
-- see, for a screen that does not exist. This produces one
-- `rls_enabled_no_policy` INFO advisor, matching `password_reset_grants` and
-- `push_devices`, which are in the same position for the same reason.
alter table public.club_removals enable row level security;

-- ---------------------------------------------------------------------------
-- §1c. The grants — written explicitly rather than relied on as a default
-- ---------------------------------------------------------------------------
revoke all on table public.club_removals from public, anon, authenticated;

-- ** NO enforce_participation_gate TRIGGER ON THIS TABLE, deliberately. ** The
-- gate exists to refuse content writes from an account that never accepted the
-- terms; there is no `authenticated` writer here for it to gate (§1c revokes
-- everything), so adding one would raise the gate count while gating nothing.
-- The gate stands at 22 triggers on DEV and is unchanged by this file.

comment on table public.club_removals is
  'ONE ROW PER (club, rider) PAIR AN ADMIN REMOVED — 111, PD-361. A BAR AND NOT A LOG: it exists to be read by exactly one predicate (private.club_invite_link_reachable_by''s removal conjunct) and by nothing else, and it is DELETED the moment the rider rejoins by any route (private.clear_club_removal_on_join, an AFTER INSERT trigger on club_members). So it ends at readmission and at nothing else — there is no expiry, no sweep and no Clear control, and none is needed while the clearing trigger holds. Written ONLY inside public.remove_club_member, after its authority block, which is what makes the row co-extensive with *an admin decided this* and is why a voluntary leaver has no row: removal and departure both end as an absent club_members row, so the difference has to be captured at the moment of the act. NOBODY READS IT — RLS is on, there is no policy, and every client role is revoked — so it is not an audit trail and must not grow into one. NO removed_by COLUMN: manage-club-riders requires that nothing records who removed whom. Both FKs cascade, so deleting the club or the rider''s profile erases the row with no sweep and no step added to the account-deletion Edge Function. IT CLOSES THE INVITE-LINK DOOR ALONE — a removed rider may still request to join, still accept an in-app invite, and still press Join on a public club, each of which clears this row.';
comment on column public.club_removals.club_id is
  'The club the rider was removed from. ON DELETE CASCADE from public.clubs — a deleted club takes its bars with it, which is correct because the links they bar died with the club too (093''s live_club_invite_link joins clubs).';
comment on column public.club_removals.user_id is
  'The removed rider. ON DELETE CASCADE from public.profiles, so account deletion erases the bar with everything else and the deletion Edge Function needs no new step. NOT the actor — nothing here records who did the removing, by requirement.';
comment on column public.club_removals.removed_at is
  'When the most recent removal of this pair happened — public.remove_club_member upserts with `do update set removed_at = now()`. NOTHING READS THIS COLUMN TODAY. It is here because an expiry, if the owner ever asks for one, is a predicate against it; the bar itself is the ROW''S EXISTENCE and not this value.';

-- ===========================================================================
-- §2. Clearing the record — an AFTER INSERT trigger, route-agnostic
-- ===========================================================================
-- ** IT OBSERVES THE MEMBERSHIP ROW, NEVER THE ROUTE. ** Approving a request,
-- accepting an in-app invite, claiming a link, a public club's Join button, the
-- creator's own membership row and any admission path added later all clear the
-- bar without this function being edited. Clearing it inside each admission
-- path instead would be three edits today and a fourth path written by somebody
-- who does not know this exists.
--
-- ** security definer WITH set search_path = '', AND THIS IS THE ONE LINE WHOSE
-- OMISSION TURNS THIS FILE INTO AN OUTAGE. ** A trigger function defaults to
-- `security invoker`; §1c revokes everything on club_removals from
-- `authenticated` and §1b leaves it with no policy, so an invoker-rights delete
-- raises 42501 and rolls the rider's club_members INSERT back with it.
--
-- WHICH JOINS BREAK IS A QUESTION ABOUT THE WRITER'S ROLE, NOT ABOUT WHETHER A
-- REMOVAL ROW EXISTS. Postgres checks table privileges at executor start,
-- before any row is scanned, so `delete … where false` raises exactly as loudly
-- as one that would match. That splits the paths in a way four green tests
-- would hide: `joinClub` inserts into club_members directly as `authenticated`
-- (the only such write in src/), so invoker rights would raise on every press
-- that actually joins — while private.join_club_from_invite,
-- private.join_club_from_request, complete_onboarding's default-club join and
-- 103's establish_club_owner_membership are all security definer and would
-- inherit the owner's rights and pass silently. Hence 111.13a asserts
-- `prosecdef` as a CATALOGUE READ and never from a join that worked: the RLS
-- suite runs as the table owner, for whom neither barrier exists, which is
-- exactly how `029` shipped a function its intended role could not reach with
-- nothing red.
--
-- ** NO `WHEN` CLAUSE, ** exactly like notify_club_joined beside it: the
-- clearing must happen for every writer, including the security definer ones,
-- and a `WHEN CURRENT_USER = 'authenticated'` guard — the shape
-- enforce_participation_gate and protect_club_owner_membership carry — would
-- silently skip precisely the four paths above.
--
-- ** IT MUST NOT RAISE. ** It runs inside every club join in the app. One
-- delete against a primary key cannot fail in normal operation; the
-- hand-exercise gate applies regardless.
create or replace function private.clear_club_removal_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  delete from public.club_removals r
   where r.club_id = new.club_id
     and r.user_id = new.user_id;
  return null;  -- AFTER trigger: the return value is ignored
end;
$$;

create trigger clear_club_removal_on_join
  after insert on public.club_members
  for each row
  execute function private.clear_club_removal_on_join();

revoke all on function private.clear_club_removal_on_join() from public, anon, authenticated;

comment on function private.clear_club_removal_on_join() is
  'Readmission ends the bar — 111, PD-361. AFTER INSERT on public.club_members, for each row, WITH NO `WHEN` CLAUSE so it fires for security definer writers too (notify_club_joined beside it is the precedent; enforce_participation_gate''s CURRENT_USER guard is the shape that would break this). Deletes the public.club_removals row for the joining pair and does nothing else. ROUTE-AGNOSTIC BY CONSTRUCTION: it observes the membership row, so every admission path — approve, in-app accept, link claim, the public Join button, the creator''s own row, and any path added later — clears the bar without this function being edited. security definer with set search_path = '''' is LOAD-BEARING and not conventional: club_removals grants nothing to authenticated and carries no policy, so an invoker-rights delete raises 42501 and rolls back the join. Postgres checks table privileges at executor start, so that failure is row-independent — it would break joinClub''s direct insert on every press that actually joins, while the four security definer admission paths would pass silently. Asserted from the catalogue (111.13a), never from a join that worked. Callable by no client role.';

-- ===========================================================================
-- §3. The reader — one new conjunct, in the one place it may live
-- ===========================================================================
-- ** THE PREDICATE HAS EXACTLY ONE LEGAL HOME, and that is what makes the
-- narrow reading expressible at all. ** Every alternative site is closed by
-- something `093` already wrote down:
--
--   * public.claim_club_invite_link — `093.22` reads prosrc for exactly this. A
--     caller predicate there has no policy underneath it, and it would make the
--     preview more permissive than its claim, which `093` calls "a pure
--     disclosure".
--   * both public bodies, duplicated — the defect `091` shipped and `093` was
--     built to prevent: two copies drift, and the weaker copy is always the
--     security-critical one.
--   * private.live_club_invite_link — a statement about the LINK alone, taking
--     no caller. A caller predicate there would make a link dead for EVERYBODY
--     because one rider was removed.
--   * private.join_club_from_invite — shared with the in-app accept path, so it
--     closes both doors at once. That is the wide reading the owner declined,
--     and it is the trap this change is most likely to fall into because it
--     looks like the tidiest fix.
--   * a club_members INSERT policy arm — would bar the public club's Join
--     button too, RLS being unable to see which route wrote the row.
--
-- ** `not exists`, NEVER A JOIN, ** so a removal row for another club or
-- another rider cannot affect the result set and the planner sees a
-- primary-key probe.
--
-- ** THE OTHER CONJUNCTS ARE BYTE-IDENTICAL AND THE SIGNATURE IS UNCHANGED. **
-- Note that the live body carries EIGHT of them, not the seven `093` shipped:
-- `107` added `k.owner_id is not null` when a club became able to outlive its
-- last member. The body below was read off DEV rather than reconstructed from
-- `093`'s file, which is what task 0.4 exists for — a `create or replace`
-- written against a stale body silently reverts whatever replaced it.
create or replace function private.club_invite_link_reachable_by(
  t text, uid uuid, lock boolean default false)
returns table (link_id uuid, club_id uuid, created_by uuid, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  -- ** THE LOCK, AND IT IS TAKEN BEFORE LIVENESS IS RESOLVED. ** Under READ
  -- COMMITTED — Postgres's default and Supabase's — a claim that resolved
  -- liveness a moment before a concurrent revoke committed would still admit
  -- the rider, and the admin's Revoke returned success. Unlike `091` an admin
  -- CAN then eject them (`088`), but they are not told they need to.
  --
  -- Locking on the token match ALONE — no liveness predicate — is deliberate:
  -- this statement must not become a second copy of §2f. revoke_club_invite_link
  -- UPDATEs this row, so the two serialise and the loser sees the committed
  -- outcome.
  --
  -- `for share`, not `for update`: concurrent claims of one link do not
  -- conflict with each other and must not block each other.
  if lock then
    perform 1 from public.club_invite_links l where l.token = t for share;
  end if;

  return query
  select k.link_id, k.club_id, k.created_by, k.owner_id
    from private.live_club_invite_link(t) k
   where private.may_invite_to_club_for(k.created_by, k.club_id)
     and not private.is_blocked(uid, k.created_by)
     and not private.is_blocked(uid, k.owner_id)
     and private.may_participate_for(uid)
     -- 107: an ownerless club's link admits nobody. Explicit rather than left
     -- to `uid <> k.owner_id` below, which happens to be NULL — and the
     -- is_blocked conjunct above fails OPEN against a NULL owner.
     and k.owner_id is not null
     and uid <> k.owner_id
     and not private.is_club_member_for(uid, k.club_id)
     -- 111: an admin removed this rider from this club, and a link minted
     -- before that removal must not undo it. The bar ends at readmission by any
     -- other route (private.clear_club_removal_on_join), so this is not a ban.
     and not exists (
       select 1 from public.club_removals r
        where r.club_id = k.club_id
          and r.user_id = uid
     );
end;
$$;

revoke all on function private.club_invite_link_reachable_by(text, uuid, boolean) from public, anon, authenticated;

comment on function private.club_invite_link_reachable_by(text, uuid, boolean) is
  'THE SINGLE DEFINITION OF "THIS CALLER MAY USE THIS TOKEN" — 093, extended by 107 and 111 — and the ONLY entry point public.club_invite_link_preview and public.claim_club_invite_link have. Live (private.live_club_invite_link) AND the MINTER STILL AUTHORISED (may_invite_to_club_for, re-derived at every use, so a demotion or a departure kills every link that rider minted) AND not blocked in either direction with the minter OR with the club''s owner (private.is_blocked, symmetric) AND both participation stamps on the caller AND the club still has an owner (107) AND the caller is neither the owner nor already a member AND NO public.club_removals ROW EXISTS FOR THE CALLER AND THIS CLUB (111, PD-361 — an admin removed them, and a link minted before that must not readmit them silently; the row is deleted on readmission by any other route, so the bar is not a ban). It deliberately asks may_invite_to_club_for and NOT may_mint_club_link_for: a club that has become PUBLIC since minting stays claimable, because the claim then admits nothing the plain URL would not. NEITHER RPC BODY MAY RESTATE ANY OF THIS — 093.22 asserts it by reading prosrc, and 111 extends that closed list of forbidden substrings by `club_removals` — because a preview and a claim that disagree about the CALLER are invisible from either body alone and there is no policy under either. THE REMOVAL CONJUNCT LIVES HERE AND NOWHERE ELSE: private.join_club_from_invite is shared with the in-app accept path, so a predicate there would close a door the owner deliberately left open. With lock => true it takes `for share` on the link row BEFORE resolving, so a revoke and an in-flight claim serialise; that is why it is VOLATILE, Postgres refusing FOR SHARE in a non-volatile function, and why both public RPCs are POST-only rather than served over GET with a live token in the query string. Callable by no client role.';

-- ===========================================================================
-- §4. The writer — the record is made inside remove_club_member
-- ===========================================================================
-- ** REMOVAL AND VOLUNTARY DEPARTURE BOTH END AS AN ABSENT club_members ROW, **
-- so the difference has to be captured at the moment of the act. This function
-- is the only path carrying an authority check, which makes the record exactly
-- co-extensive with *an admin decided this*.
--
-- A `before delete on club_members` trigger could technically tell them apart —
-- current_user is the definer owner inside this RPC and `authenticated` on the
-- rider's own delete — and is rejected anyway: it would also fire for cascades
-- (the club deleted, the account deleted) and record removals nobody performed.
--
-- ** PLACEMENT: after the authority block and its single raise site, ** so an
-- unauthorised attempt writes nothing, and in the same transaction as the
-- delete. NO NEW RAISE SITE — the one-door property `088` documents is
-- unchanged, and the upsert cannot raise: a pair already barred conflicts onto
-- the primary key and updates.
--
-- `do update set removed_at = now()` rather than `do nothing`, so removed_at
-- means *the most recent removal*, which is what an expiry would need. Either
-- is safe; the choice is stated so a later reader does not think it accidental.
create or replace function public.remove_club_member(
  target_club uuid, target_rider uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid       uuid := (select auth.uid());
  v_owner     uuid;
  v_role      text;
  v_is_admin  boolean;
begin
  if v_uid is null then
    raise exception 'remove_club_member requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- TWO reads and ONE raise site. "No such club", "not your club", "no such
  -- member", "that rider is the owner" and "you are an admin trying to remove
  -- an admin" all leave by the same door below, so a caller cannot use this
  -- function to learn who is in a club they may not read, or who is an admin
  -- of one.
  --
  -- **Two statements rather than one outer join, and that is not a style
  -- choice**: Postgres refuses `FOR UPDATE` on the nullable side of an outer
  -- join outright, so the obvious single `left join ... for update of m` is a
  -- runtime error rather than a slower query. The lock belongs on the
  -- membership row — it is what two admins acting at once race over, and
  -- taking it makes the second transaction re-read a row that is already gone.
  select c.owner_id into v_owner
    from public.clubs c where c.id = target_club;

  select m.role into v_role
    from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider
     for update;

  v_is_admin := private.is_club_admin_for(v_uid, target_club);

  if v_owner is null                       -- no such club
     or v_role is null                     -- that rider is not in it
     or not v_is_admin                     -- the caller may not act here
     or target_rider = v_uid               -- leaving is 001's own DELETE policy
     or target_rider = v_owner             -- the owner is not removable
     or (v_role <> 'member' and v_uid <> v_owner)  -- only the owner touches an admin
  then
    raise exception 'no removable membership matches that club and rider'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider;

  -- **Belt and braces, and named as such rather than left to look load-bearing.**
  -- No reachable state puts a `club_join_requests` row beside a membership
  -- today: an approval DELETES the row (085 §5), club_takes_join_requests
  -- excludes members so a member cannot insert one, and a declined row refuses
  -- a second ask by the unique key. The statement is here because it is one
  -- line and it makes "removal leaves no request state" true unconditionally
  -- rather than true by an argument three files long — and because if that
  -- argument ever stops holding, a surviving `pending` row would let a second
  -- admin undo this removal by approving it.
  delete from public.club_join_requests r
   where r.club_id = target_club
     and r.user_id = target_rider;

  -- 111, PD-361: record the bar, so a link minted before this removal cannot
  -- undo it. AFTER the authority block, so an unauthorised attempt writes
  -- nothing, and in the same transaction as the delete above. Idempotent: a
  -- second removal of a readmitted rider updates rather than raising, which is
  -- what keeps the one-door property intact.
  insert into public.club_removals (club_id, user_id)
  values (target_club, target_rider)
  on conflict (club_id, user_id) do update set removed_at = now();
end;
$$;

revoke all on function public.remove_club_member(uuid, uuid) from public, anon;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

comment on function public.remove_club_member(uuid, uuid) is
  'An owner or admin removes ONE rider from ONE club (088, PD-326; extended by 111, PD-361). Deletes exactly one club_members row, its belt-and-braces club_join_requests row, and WRITES ONE public.club_removals ROW — the rider''s postcards, rides and ride_members rows all stay. REMOVAL IS STILL NOT A BAN: the removals row bars ONE route, the pre-minted invite LINK, and is deleted the moment the rider is readmitted by any other — an approved request, an accepted in-app invite, or a public club''s Join button all clear it through private.clear_club_removal_on_join. So they may still ask, still be invited, and still join a public club immediately. The row is written AFTER the authority block, which makes it co-extensive with *an admin decided this* and is why a voluntary leaver never has one; the upsert is idempotent (`do update set removed_at = now()`) and ADDS NO RAISE SITE. Only the OWNER may remove an admin; nobody removes the owner, and nobody removes themselves (leaving is 001''s own DELETE policy). ONE raise site, so a caller learns nothing about a club or a roster they may not read. security definer because club_members DELETE is auth.uid() = user_id and 088 deliberately adds no policy: a policy admitting an admin to delete somebody else''s row cannot be narrowed to the case this function checks.';

-- ===========================================================================
-- §5. Verification — run after applying, against the live database
-- ===========================================================================
-- select count(*) from pg_trigger
--  where tgname = 'enforce_participation_gate' and not tgisinternal;   -- 22, unchanged
--
-- select prosecdef, proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'private' and p.proname = 'clear_club_removal_on_join';
--                                                          -- true, {search_path=""}
--
-- get_advisors(security): exactly +1 INFO (rls_enabled_no_policy on
-- club_removals) and +0 WARN. An
-- authenticated_security_definer_function_executable appearing means something
-- was created in `public` that belongs in `private` — a defect, not a cost.
