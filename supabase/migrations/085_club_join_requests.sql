-- 085 — Private clubs become findable, and a rider may ask to join one (PD-325)
-- ===========================================================================
--
-- Product owner, 2026-08-27: *"Explore clubs no longer says 'public' and there
-- is a functionality to Request to join a club... When a user finds a club in
-- explore clubs which is private, there is an option in the likes of request to
-- join, instead of join."*
--
-- Proposal: openspec/changes/show-private-clubs-and-request-to-join/.
--
-- ---------------------------------------------------------------------------
-- WHY AN ACCESSOR AND NOT AN ARM ON `clubs` SELECT
-- ---------------------------------------------------------------------------
-- The argument is structural before it is a weighing. An arm on `clubs` SELECT
-- has to be predicated on something about this rider and this club, and the
-- only candidate left once membership and ownership are excluded is a request
-- row. That is circular: to make a request the rider must already hold the
-- club's id, and the only place a /clubs/explore rider gets one is a list — the
-- list being the thing this migration exists to fill. So a discovery accessor
-- is required EITHER WAY, and the policy arm would be a second, wider widening
-- stacked on a sufficient first one.
--
-- The proposal's design.md enumerates all eight surfaces that read `clubs`
-- transitively. Two of them move under a policy arm and neither is the one
-- anybody would have listed:
--
--   * storage.objects — 016's club-avatar AND club-cover policies both delegate
--     to `clubs` SELECT, so the club's own cover photograph becomes readable to
--     a non-member, silently, with no migration touching 016.
--   * notifications SELECT — 036 §3's per-column conjunct
--     `club_id is null or exists (select 1 from clubs …)` starts resolving, so
--     any club_id-carrying notification a rider happens to hold becomes
--     readable.
--
-- `clubs` SELECT and private.can_read_club are therefore UNTOUCHED by this
-- file, and 085.1/085.2 assert that by equality against the pins the suite
-- already holds at 060.1b.
--
-- ---------------------------------------------------------------------------
-- WHAT A NON-MEMBER LEARNS, AND WHAT THEY DO NOT
-- ---------------------------------------------------------------------------
-- Seven columns, through one function, and nothing else: the club's id, name,
-- avatar path, location name, coordinates and member COUNT. Nothing of its
-- rides, postcards, threads, messages, roster, description, cover, owner or
-- age. The narrow shape IS the security statement — a column added to that
-- return list later is a widening and owes its own reason.
--
-- The avatar will not sign, and that is left alone deliberately: 016's storage
-- policy runs its own EXISTS against `clubs` under the reader's RLS, so
-- signImagePaths returns null and the card draws the club's initials. The
-- one-arm change that would alter it is written out in the proposal's
-- design.md §The avatar that will not sign rather than made here.
--
-- ---------------------------------------------------------------------------
-- THERE IS NO DECLINE NOTIFICATION, AND THAT IS NOT AN OVERSIGHT
-- ---------------------------------------------------------------------------
-- 036 §3's notifications SELECT policy carries
--   `club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)`
-- evaluated under the READER's own row security. A declined requester holds no
-- club_members row, so `clubs` SELECT returns them nothing, the EXISTS is
-- false, and a decline notification would be written and then never returned
-- and never counted — silently, for ever, looking correct to every reviewer and
-- every test that only checks the row was inserted.
--
-- So a decline writes nothing, and 085.26 asserts the zero. The requester
-- learns the answer from their own request row instead, which they can read
-- and which the client renders on the club's reduced screen.
--
-- A later session WILL want to "fix" this by adding the type. The fix is not a
-- notification; it is either a change to 036 §3's conjunct (which would make
-- every club_id-carrying notification resolve for any non-member holding one)
-- or a subject-less type — and a subject-less type is LOSSY, because 036's
-- notifications_event_key is unique over all four subject columns with
-- NULLS NOT DISTINCT, so two declines from two different clubs by the same
-- admin collapse to one row and the second is dropped by `on conflict`.
--
-- ---------------------------------------------------------------------------
-- ORDERING
-- ---------------------------------------------------------------------------
-- Additive, and NOT inert: private.notify_club_joined fires
-- `after insert on club_members` with no `when` clause, so it now runs inside
-- private.join_club_from_request and a raise there takes a rider's approval
-- down with it. 036's hand-exercise gate therefore applies to this file — see
-- the verification footer.

-- ---------------------------------------------------------------------------
-- §1. The table
-- ---------------------------------------------------------------------------
create table public.club_join_requests (
  id uuid default uuid_generate_v4() primary key,
  club_id uuid references public.clubs(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status text default 'pending' not null,
  created_at timestamptz default now() not null,
  responded_at timestamptz,

  -- Not a wider key. A key including `status` would permit a second row per
  -- rider and destroy the property that makes a refusal stick.
  unique (club_id, user_id),

  -- TWO values, not three. Approval DELETES the row and the club_members row
  -- is the record — see §5. A surviving 'approved' row beside this unique key
  -- would make a private club a rider LEFT permanently unreachable to them:
  -- the re-request collides, and there is no affordance anywhere to clear it.
  constraint club_join_requests_status_is_known
    check (status in ('pending', 'declined')),

  -- `is not distinct from`, never `=`. A CHECK accepts NULL, so the `=` form
  -- passes for a row that satisfies neither side — 073's measured correction.
  constraint club_join_requests_response_coupling
    check ((status = 'pending') is not distinct from (responded_at is null))
);

alter table public.club_join_requests enable row level security;

-- 029's rule: every FK column LEADS an index. `user_id` leads the first, and it
-- is also the profiles-cascade path; `club_id` leads the unique index created
-- by the constraint above, which discharges the clubs cascade, and this second
-- index is the admin's pending list rather than a duplicate of it.
create index club_join_requests_user_idx
  on public.club_join_requests (user_id, created_at desc, id desc);
create index club_join_requests_club_status_idx
  on public.club_join_requests (club_id, status, created_at desc, id desc);

comment on table public.club_join_requests is
  'One row per (club, rider who asked to join) — 085, PD-325. A private club is discoverable ONLY through public.discoverable_private_clubs; `clubs` SELECT is untouched by this migration and 085.1 asserts it. Approval DELETES this row and the club_members row becomes the record, because a surviving approved row beside unique (club_id, user_id) would make a club a rider LEFT unreachable to them for ever. A declined row is immovable BY THE REQUESTER and clearable by an admin — 083''s rule inverted, because there the invitee was the party at risk and here the requester is the party who could spam. There is no expiry: an expiring request would silently withdraw a rider''s ask in a way neither party is told about, and the answer to an unusable pending list is pagination first. There is NO decline notification and that is not an oversight — see this file''s header for 036 §3''s club conjunct.';

comment on column public.club_join_requests.status is
  'pending | declined. Written ONLY by the column default and public.decline_club_join_request — authenticated holds no INSERT grant on this column and no UPDATE grant at all, and the table has no UPDATE policy. There is deliberately no `approved`: approval deletes the row.';

comment on column public.club_join_requests.responded_at is
  'NULL exactly while `status` is pending, pinned by club_join_requests_response_coupling. Server-owned by the absent INSERT grant, like created_at.';

-- There is deliberately NO `responded_by` column. The requester reads every
-- column on their own row, so it would tell them which individual admin refused
-- them. A club refuses as a club; naming the person turns an institutional
-- answer into a personal one, in an app whose only safety primitive is
-- blocking. An internal audit trail is PD-326's to ask for, behind an accessor
-- scoped to admins.

-- ---------------------------------------------------------------------------
-- §2. The helpers
-- ---------------------------------------------------------------------------
-- Every one is subject-taking with a caller-relative wrapper where a policy
-- needs one, on 060's pattern. 036 trap (c) is the live hazard in this file:
-- the request fan-out's recipient set is LITERALLY the set private.is_club_admin
-- describes, so `where private.is_club_admin(new.club_id)` is the natural thing
-- to type and it would compute the set relative to whoever happened to be
-- inserting. The `_for` twin is what the fan-out uses.

-- Who may answer a request for this club. The union is notify_club_joined's
-- recipient set restated, and 085.24 asserts the two agree as SETS rather than
-- as counts.
--
-- The owner arm is separate from the club_members arm on purpose: 054's
-- ownerless owner — a clubs.owner_id with no membership row — is an admin here,
-- matching how private.is_club_member already treats the same rider. A club
-- whose owner never joined it must not be a club nobody can answer requests for.
create or replace function private.is_club_admin_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.id = target_club
       and c.owner_id = candidate
  ) or exists (
    select 1 from public.club_members m
     where m.club_id = target_club
       and m.user_id = candidate
       and m.role in ('owner', 'admin')
  );
$$;

-- Body is EXACTLY the delegation and nothing else — 085.28 asserts it by
-- equality rather than by `like`, because `like '%..._for%'` is satisfied by a
-- comment mentioning the name (060's reasoning, and CLAUDE.md's comment trap).
create or replace function private.is_club_admin(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_club_admin_for(auth.uid(), target_club);
$$;

-- May this candidate ask to join this club? Every conjunct excludes somebody
-- and the comment says who.
create or replace function private.club_takes_join_requests_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.id = target_club
       -- A public club is joined directly and comes from the ordinary query.
       -- Overlap would double the club in Explore's merged list.
       and c.is_public = false
       -- 058's welcome club: every rider is auto-joined to it at onboarding, so
       -- a request to join it is meaningless. It is public today, which makes
       -- this belt-and-braces against somebody flipping it.
       and c.is_default = false
       -- A club you own or belong to belongs on Your clubs, not Explore.
       and c.owner_id <> candidate
       and not private.is_club_member_for(candidate, c.id)
       -- Decision #2. is_blocked is symmetric by construction (009), so ONE
       -- directional blocks row hides the club from the requester and hides
       -- their request from the owner, both ways round.
       --
       -- The conjunct is on clubs.owner_id and on NOBODY ELSE, deliberately: a
       -- club is not a rider, and the only rider a clubs row identifies is its
       -- owner. Blocking one ordinary member does not hide the club — which is
       -- already true of every public club today, because `clubs` SELECT
       -- carries no block predicate at all. 085.11 is the assertion that fails
       -- if somebody "tidies" this to cover all members.
       and not private.is_blocked(candidate, c.owner_id)
  );
$$;

-- The caller-relative wrapper, and it is not optional: an RLS expression is
-- evaluated AS THE QUERYING ROLE, so the INSERT policy cannot call a function
-- `authenticated` holds no EXECUTE on. Granting the subject-taking form instead
-- would hand every rider a membership-and-block oracle for any pair, which is
-- exactly what 060.2 says makes such a helper safe only while nobody can call
-- it. Body is EXACTLY the delegation; 085.28 pins it by equality.
create or replace function private.club_takes_join_requests(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.club_takes_join_requests_for(auth.uid(), target_club);
$$;

-- A DECLINED rider is deliberately NOT excluded here, and the club therefore
-- stays in their Explore list with no control on the card. That is what makes
-- the silent decline legible: the rider taps through to the club's reduced
-- screen, which reads their own request row and says the club declined. Excluding
-- them instead would remove the only surface on which a declined request can be
-- rendered at all — the row would be readable from psql and from nowhere in the
-- product — and it is the request row, not the club's disappearance, that this
-- change calls the record. The re-request is refused by the unique key (23505),
-- not by this predicate, and 085.14 asserts exactly that.

-- 023's may_participate is CALLER-RELATIVE — its body reads auth.uid(). An
-- approval's caller is the ADMIN and its subject is the REQUESTER, so calling
-- it inside the approval path would answer for the admin (always onboarded) and
-- let an un-onboarded rider into the club. That is 036 trap (c) again, one
-- function over, and it is the obvious thing to type.
--
-- So: the subject-taking twin, and 023's function rewritten to delegate to it.
-- 060 did exactly this to private.is_club_member, whose body on DEV today is
-- `select private.is_club_member_for(auth.uid(), target_club_id);` — one body,
-- not two, is what stops the copies drifting.
create or replace function private.may_participate_for(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = candidate
       and p.onboarding_completed_at is not null
       and p.terms_accepted_at is not null
  );
$$;

create or replace function private.may_participate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.may_participate_for((select auth.uid()));
$$;

-- No client role, on either subject-taking helper. is_club_admin_for is an
-- ADMIN ORACLE for a private club and club_takes_join_requests is a MEMBERSHIP
-- AND BLOCK ORACLE — both answer for any pair, which is exactly what 060.2 says
-- makes such a helper safe only while no rider can call it.
revoke all on function private.is_club_admin_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.club_takes_join_requests_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.may_participate_for(uuid) from public, anon, authenticated;

-- The wrappers ARE called from RLS expressions, which are evaluated as the
-- querying role, so they keep the grant 023 and 060 give theirs.
revoke all on function private.is_club_admin(uuid) from public, anon;
grant execute on function private.is_club_admin(uuid) to authenticated;
revoke all on function private.club_takes_join_requests(uuid) from public, anon;
grant execute on function private.club_takes_join_requests(uuid) to authenticated;

comment on function private.is_club_admin_for(uuid, uuid) is
  'May this CANDIDATE answer join requests for this club? clubs.owner_id UNION club_members with role in (owner, admin) — the same union private.notify_club_joined fans out to, asserted as set equality at 085.24. Subject-taking so a fan-out can ask it about somebody else (036 trap (c)); granted to NO client role, because it answers for any pair and is therefore an admin oracle. 054''s ownerless owner is an admin here, matching private.is_club_member.';
comment on function private.is_club_admin(uuid) is
  'May the CALLER answer join requests for this club? Delegates to is_club_admin_for(auth.uid(), …) and does nothing else — 085.28 pins that body by EQUALITY, never by `like`, because a mention of the name in a comment satisfies a pattern match. Granted to authenticated because the club_join_requests policies call it and an RLS expression runs as the querying role.';
comment on function private.club_takes_join_requests_for(uuid, uuid) is
  'May this CANDIDATE ask to join this club? Not public, not the default club, not owned by them, not already a membership, and not blocked with the club''s OWNER. It is both the accessor''s predicate and the INSERT policy''s, so discovery and the request cannot disagree. A DECLINED rider is deliberately still admitted — the club stays in their Explore list so the reduced screen has somewhere to tell them the answer; the re-request is refused by the unique key, not here. Granted to NO client role: it answers for any pair and is therefore a membership and block oracle.';
comment on function private.club_takes_join_requests(uuid) is
  'May the CALLER ask to join this club? Delegates to club_takes_join_requests_for(auth.uid(), …) and does nothing else — 085.28 pins that body by equality. It exists because the INSERT policy calls it and an RLS expression is evaluated as the querying role, so the policy cannot reach the ungranted subject-taking form.';
comment on function private.may_participate_for(uuid) is
  'Decision #5 and T&C consent, asked about a NAMED candidate (085). 023''s body with `candidate` where auth.uid() stood, and private.may_participate() is now exactly a delegation to it. It exists because private.join_club_from_request writes a membership row for the REQUESTER while running as the APPROVER, so the caller-relative form would answer for the wrong rider and admit an un-onboarded one. Granted to no client role.';
comment on function private.may_participate() is
  'Decision #5 and T&C consent for the CALLER (023, rewritten by 085 to delegate to may_participate_for). One body, not two — 060''s reason for doing the same to private.is_club_member. Its grants, its security definer marking and every caller of it are unchanged.';

-- ---------------------------------------------------------------------------
-- §3. The accessor — the ONLY path by which a non-member reads a private club
-- ---------------------------------------------------------------------------
-- `returns table`, never `returns setof public.clubs`. The second would make
-- every future `alter table public.clubs add column` a widening of this
-- disclosure with no diff anywhere to notice it in. The seven-column list IS
-- the disclosure, and 085.4 asserts it against pg_get_function_result so that
-- adding to it is a red test rather than a code review.
create or replace function public.discoverable_private_clubs(
  target_club uuid default null,
  page_size   int  default 50
)
returns table (
  id             uuid,
  name           text,
  avatar_path    text,
  location_name  text,
  latitude       double precision,
  longitude      double precision,
  members_count  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id,
         c.name,
         c.avatar_path,
         c.location_name,
         c.latitude,
         c.longitude,
         -- An aggregate and NEVER a roster. It is the same number ClubCard
         -- already draws for a public club, computed in here because
         -- club_members SELECT returns the caller zero rows for this club.
         (select count(*) from public.club_members m where m.club_id = c.id) as members_count
    from public.clubs c
   where private.club_takes_join_requests_for((select auth.uid()), c.id)
     -- One body, two call shapes. A separate club_discovery_card(uuid) would be
     -- a second copy of one visibility rule and a second advisor, and 060's
     -- whole lesson is that two copies of one rule drift.
     and (target_club is null or c.id = target_club)
   order by c.created_at desc, c.id desc
   -- Capped in SQL so a client cannot ask for every private club in one call.
   -- `greatest(..., 0)` is not decoration: Postgres raises `LIMIT must not be
   -- negative` on a negative one, so without it a client passing -1 gets a 500
   -- from an endpoint that should simply have returned nothing. Caught by the
   -- assertion at 085.8 rather than by a rider.
   limit greatest(least(coalesce(page_size, 50), 100), 0);
$$;

comment on function public.discoverable_private_clubs(uuid, int) is
  'The ONLY path by which a non-member reads a private club (085, PD-325). Seven named columns and no more: id, name, avatar_path, location_name, latitude, longitude, members_count. Nothing of the club''s rides, postcards, threads, messages, roster, description, cover, owner or age. THE NARROW SHAPE IS THE SECURITY STATEMENT — a column added here is a widening and owes its own migration and its own reason; 085.4 pins the return list so it cannot be added silently. `clubs` SELECT and private.can_read_club are deliberately UNTOUCHED (085.1, 085.2), which is why this is a function rather than a policy arm: an arm there also moves storage.objects and notifications SELECT, neither of which any migration would mention. avatar_path is returned and will NOT sign — 016''s storage policy runs its own EXISTS against clubs under the reader''s RLS — so the card draws initials, deliberately; 085.6 pins that so the day a storage arm lands the test names it. target_club non-null narrows to one club for the reduced club screen and changes nothing else. Ordered created_at desc, id desc without returning created_at.';

revoke all on function public.discoverable_private_clubs(uuid, int) from public, anon;
grant execute on function public.discoverable_private_clubs(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- §4. Policies, grants and the participation gate
-- ---------------------------------------------------------------------------
-- No arm here reads `clubs`. An arm making the row visible to anyone who can
-- see the club would hand every member of a PUBLIC club the join requests of a
-- private one it has nothing to do with; and for a private club it would be
-- circular anyway, since a non-member cannot see the club.
create policy "Join requests are readable by the rider and the club's admins"
  on public.club_join_requests for select to authenticated
  using (
    (user_id = auth.uid() or private.is_club_admin(club_id))
    and not private.is_blocked(auth.uid(), user_id)
  );

create policy "A rider asks to join a club that takes requests"
  on public.club_join_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and private.club_takes_join_requests(club_id)
  );

-- The block conjunct is 036 §4's rule and not tidiness: without it the write
-- path reaches rows the read path does not return, and the affected-row count
-- of a bulk delete is a number an admin can compare against the list they were
-- just shown — which would reveal, exactly, how many requests a block is hiding
-- from them. Decision #2 says a block must never be revealed by any gap, count
-- or marker.
--
-- The first disjunct's `status` scope is what makes a refusal stick against the
-- requester: they may withdraw a question, never un-answer it. The second is
-- the "you may ask again" affordance, deliberately in the club's hands; its
-- SURFACE is PD-326's and ships with no button here.
create policy "A rider withdraws a pending ask; the club's admins clear any"
  on public.club_join_requests for delete to authenticated
  using (
    (
      (user_id = auth.uid() and status = 'pending')
      or private.is_club_admin(club_id)
    )
    and not private.is_blocked(auth.uid(), user_id)
  );

-- NO UPDATE POLICY AND NO UPDATE GRANT. The absence IS the enforcement: the two
-- RPCs in §5 are the only writers of `status`, exactly as 078 made the absence
-- of any policy on push_devices the thing that closes it. Do not "complete" the
-- CRUD set here.

revoke all on public.club_join_requests from anon, authenticated;
grant select, delete on public.club_join_requests to authenticated;
-- Per-column, and `status`, `created_at` and `responded_at` are on NONE of
-- them. A column DEFAULT applies only when the column is omitted, and PostgREST
-- will happily name it if a client asks — so the default is not the guard, the
-- absent grant is.
grant insert (id, club_id, user_id) on public.club_join_requests to authenticated;

-- The sixteenth gate trigger. The WHEN clause is not decoration (023 §2): it is
-- what stops the gate firing for the table owner, and it is also why a
-- security definer writer has to restate the rule in its own body — see
-- private.join_club_from_request in §5.
drop trigger if exists enforce_participation_gate on public.club_join_requests;
create trigger enforce_participation_gate
  before insert on public.club_join_requests
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, sixteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ---------------------------------------------------------------------------
-- §5. The write path, the two RPCs and the fan-outs
-- ---------------------------------------------------------------------------
-- The single place an approval writes a club_members row. In `private`, so
-- PostgREST cannot publish it and service_role cannot reach it (031).
--
-- It restates BOTH gates in its own body, because a security definer writer
-- bypasses the trigger and the INSERT policy that would otherwise carry them:
-- enforce_participation_gate on club_members carries
-- `when (current_user = 'authenticated')` and current_user inside a definer
-- function is the OWNER, so the trigger cannot fire. DO NOT add a second
-- trigger to compensate — 078.9 asserts that absence precisely because such a
-- trigger raises the gate count while gating nothing, making coverage read
-- complete.
--
-- It returns FALSE rather than raising for every refusal, so the caller keeps
-- ONE observable failure and a block is not disclosed by a second error string
-- or a different SQLSTATE (083 5.15's reasoning: a SQLSTATE-only comparison
-- passes green with a block oracle present).
create or replace function private.join_club_from_request(rider uuid, target_club uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_owner     uuid;
  v_is_default boolean;
begin
  -- The SUBJECT-taking gate. private.may_participate() would answer for the
  -- APPROVER, who is always onboarded, and let an un-onboarded rider in.
  if not private.may_participate_for(rider) then
    return false;
  end if;

  select c.owner_id, c.is_default
    into v_owner, v_is_default
    from public.clubs c
   where c.id = target_club;

  if v_owner is null or v_is_default then
    return false;
  end if;

  -- A block with the club's OWNER refuses the approval, not only the request.
  -- club_takes_join_requests already refuses a request made after a block; this
  -- is the same rule for a request that predates one. Without it an unblocked
  -- admin could admit a rider the owner has blocked, and club_members SELECT
  -- carries no block predicate, so the two would then appear on each other's
  -- roster.
  if private.is_blocked(rider, v_owner) then
    return false;
  end if;

  -- 'member' as a LITERAL, and this function takes no role argument — 019's
  -- rule that `admin` is claimable by no client survives this new path because
  -- there is no input by which to attempt it. 085.20 asserts both halves.
  insert into public.club_members (club_id, user_id, role)
  values (target_club, rider, 'member')
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function private.join_club_from_request(uuid, uuid) from public, anon, authenticated;

comment on function private.join_club_from_request(uuid, uuid) is
  'The single place an approved join request writes a club_members row (085). Restates the participation gate for the SUBJECT via private.may_participate_for — never may_participate(), which is caller-relative and would answer for the approving admin — and restates the owner block, because a security definer writer bypasses both the gate trigger and the INSERT policy. Returns FALSE rather than raising on any refusal, so the caller keeps one observable failure and a block is not disclosed by a second error string. Writes ''member'' as a literal and takes no role argument. In `private`, so PostgREST cannot publish it and service_role cannot reach it (031).';

-- --- §5.2  The two RPCs ----------------------------------------------------
-- Both take a REQUEST id and never a rider id — the subject is the row, and
-- "we check the id matches the caller" is one refactor away from not doing
-- that. Both have exactly ONE raise site, so an ordinary member, the requester
-- themselves, an owner of a different club and a nonexistent id are all
-- indistinguishable to a caller.
create or replace function public.approve_club_join_request(request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid    uuid := (select auth.uid());
  v_club   uuid;
  v_rider  uuid;
  v_joined boolean := false;
begin
  select r.club_id, r.user_id
    into v_club, v_rider
    from public.club_join_requests r
   where r.id = request
     and r.status = 'pending'
     and private.is_club_admin_for(v_uid, r.club_id)
     and not private.is_blocked(v_uid, r.user_id);

  if v_club is not null then
    -- ORDER IS LOAD-BEARING, not stylistic. The notification below is only
    -- READABLE once the membership row exists: 036 §3's notifications SELECT
    -- policy requires the clubs row to resolve for the recipient, and for a
    -- private club that is true only for a member. Writing the notification
    -- first produces a row nobody can ever read. 085.25 mutation-tests this.
    v_joined := private.join_club_from_request(v_rider, v_club);
  end if;

  if not v_joined then
    raise exception 'no answerable request with that id is yours to approve'
      using errcode = 'insufficient_privilege';
  end if;

  -- The request has been answered; the club_members row is now the record.
  -- This also fires private.retract_club_join_requested, which takes the
  -- admins' "X asked to join" notification away at the same moment
  -- private.notify_club_joined gives them an "X joined" one.
  delete from public.club_join_requests r where r.id = request;

  -- `on conflict do nothing` because 036's notifications_event_key is unique
  -- over the four subject columns with NULLS NOT DISTINCT, so this row's key —
  -- (requester, type, approver, club) — is stable across approvals. A rider
  -- approved, who then leaves and asks again, would otherwise raise a bare
  -- 23505 from inside this function and escape the single raise site above.
  insert into public.notifications (user_id, actor_id, type, club_id)
  values (v_rider, v_uid, 'club_join_request_approved', v_club)
  on conflict do nothing;
end;
$$;

create or replace function public.decline_club_join_request(request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  update public.club_join_requests r
     set status = 'declined',
         responded_at = now()
   where r.id = request
     and r.status = 'pending'
     and private.is_club_admin_for(v_uid, r.club_id)
     and not private.is_blocked(v_uid, r.user_id);

  if not found then
    raise exception 'no answerable request with that id is yours to decline'
      using errcode = 'insufficient_privilege';
  end if;

  -- NO NOTIFICATION, and no membership write. See this file's header: 036 §3's
  -- club conjunct means a decline notification would be written and never
  -- returned. The requester reads their own row instead. 085.26 asserts the
  -- zero, and this comment is here because a later session's first instinct
  -- will be to "fix" the omission.
end;
$$;

revoke all on function public.approve_club_join_request(uuid) from public, anon;
grant execute on function public.approve_club_join_request(uuid) to authenticated;
revoke all on function public.decline_club_join_request(uuid) from public, anon;
grant execute on function public.decline_club_join_request(uuid) to authenticated;

comment on function public.approve_club_join_request(uuid) is
  'An owner or admin approves one pending request for their own club (085). Takes a REQUEST id and never a rider id; ONE raise site, so a member, the requester, a foreign club''s owner and a nonexistent id are indistinguishable. Statement order is load-bearing: the club_members row is written BEFORE the notification, because 036 §3''s SELECT policy needs the clubs row to resolve for the recipient and for a private club only a member gets that. The request row is then DELETED — the membership is the record — which also retracts the admins'' club_join_requested rows. The notification insert carries `on conflict do nothing` because 036''s event key is stable across a leave-and-rejoin.';
comment on function public.decline_club_join_request(uuid) is
  'An owner or admin declines one pending request for their own club (085). Same shape and same single raise site as approve. Writes no club_members row and NO NOTIFICATION — 036 §3''s club conjunct would make one unreadable to the very rider it addresses. The requester learns the answer from their own request row, which the client renders on the club''s reduced screen. Terminal against the requester (DELETE is scoped to pending for them) and clearable by an admin.';

-- --- §5.3  The notification types ------------------------------------------
-- BOTH constraints, in the same block. 036's comment says why the second is
-- load-bearing rather than tidy: the flat list says which strings are legal and
-- the shape says which subject columns each one carries, and a type in the
-- first without an arm in the second falls to `else false` and is refused.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined',
             'club_join_requested', 'club_join_request_approved')
  );

alter table public.notifications
  drop constraint notifications_subject_shape;
alter table public.notifications
  add constraint notifications_subject_shape check (
    case type
      when 'postcard_liked' then
        postcard_id is not null and comment_id is null
        and ride_id is null     and club_id is null
      when 'postcard_commented' then
        postcard_id is not null and comment_id is not null
        and ride_id is null     and club_id is null
      when 'ride_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'club_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'ride_created_in_club' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is not null
      when 'ride_invited' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'ride_invite_accepted' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'ride_invite_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      -- Both new types carry club_id ALONE, matching club_joined exactly. That
      -- is deliberate: 036 §3's SELECT policy tests each subject column with
      -- its own conjunct, so a type reusing an existing shape needs no change
      -- to the policy at all. It is the property the per-column form was chosen
      -- for, and it is why this migration does not touch that policy.
      when 'club_join_requested' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'club_join_request_approved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      else false
    end
  );

-- --- §5.4  The fan-outs ----------------------------------------------------
-- Trap (a): NO `when` clause. Every GATE trigger in this repo carries
-- `when (current_user = 'authenticated')`, and copying that onto a fan-out
-- whose writer is a security definer RPC disables it silently.
-- Trap (b): the actor comes from the ROW, never from auth.uid() inside the
-- trigger function.
-- Trap (c): private.is_club_admin_for, never private.is_club_admin — the
-- recipient set is literally the set the caller-relative one describes, which
-- is what makes the wrong one the natural thing to type.
create or replace function private.notify_club_join_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select candidates.recipient, new.user_id, 'club_join_requested', new.club_id
    from (
      select c.owner_id as recipient
        from public.clubs c
       where c.id = new.club_id
      union
      select m.user_id
        from public.club_members m
       where m.club_id = new.club_id
         and m.role in ('owner', 'admin')
    ) candidates
   where candidates.recipient <> new.user_id
     and not private.is_blocked(new.user_id, candidates.recipient)
     -- Per recipient, and NOT defence in depth: 036 §3's SELECT policy requires
     -- the clubs row to resolve for the READER, so a row written to somebody
     -- who cannot see the club is one their own policy drops on every read, for
     -- ever. That is 036 §7.5's recorded defect on ride_created_in_club. It
     -- excludes nobody in today's fixture — every candidate is a member or the
     -- owner — and 085.24 asserts that by comparing this set with
     -- notify_club_joined's as SETS.
     and private.can_read_club(candidates.recipient, new.club_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_club_join_requested
  after insert on public.club_join_requests
  for each row execute function private.notify_club_join_requested();

-- Retraction, on retract_postcard_liked's shape and scoped by the FULL event
-- key INCLUDING type. A subset scope would let an approval delete the
-- club_join_request_approved row it had just written. Fires on both exits — a
-- withdrawal, a decline-then-clear, an approval, and a cascade — which is
-- bounded and redundant rather than wrong.
create or replace function private.retract_club_join_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.type = 'club_join_requested'
     and n.actor_id = old.user_id
     and n.club_id = old.club_id;
  return null;
end;
$$;

create trigger retract_club_join_requested
  after delete on public.club_join_requests
  for each row execute function private.retract_club_join_requested();

revoke all on function private.notify_club_join_requested() from public, anon, authenticated;
revoke all on function private.retract_club_join_requested() from public, anon, authenticated;

comment on function private.notify_club_join_requested() is
  'Fan-out: a join request notifies the club''s owner and its admins (085). The owner union is safe here for the same reason it is in notify_club_joined — clubs SELECT carries an owner_id = auth.uid() arm — and the exclusion of the actor happens AFTER the union. Uses private.is_club_admin_for, never the caller-relative wrapper: the recipient set IS the set that wrapper describes, so 036 trap (c) is at its sharpest here. Guarded per recipient by private.can_read_club, which excludes nobody today and is what stops 036 §7.5''s unreadable-row defect if the roster ever gains a rider the club policy does not admit.';
comment on function private.retract_club_join_requested() is
  'Retraction: answering, withdrawing or clearing a request removes exactly the club_join_requested rows the matching insert wrote (085), scoped by type, actor_id and club_id together. The `type` conjunct is what stops an approval deleting the club_join_request_approved row it writes in the same transaction. Also fires on cascaded deletes, which is bounded and redundant rather than wrong.';

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The two policies this change exists NOT to touch. A prose claim does not
--    discharge either; capture both before and after.
--
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='clubs' and cmd='SELECT';
--   -- 4299c23bc61a3b5f53c580631cdf941c   (unchanged by 085)
--
--   select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='private' and p.proname='can_read_club';
--   -- unchanged by 085
--
-- 2. The grants, scoped to their grantee. 015's footer counted a privilege
--    table-wide and read 2 against a correct database, because postgres and
--    service_role hold everything by Supabase default.
--
--   select string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.table_privileges
--    where table_schema='public' and table_name='club_join_requests'
--      and grantee='authenticated';
--   -- DELETE,INSERT,SELECT
--
--   select string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='club_join_requests'
--      and grantee='authenticated' and privilege_type='INSERT';
--   -- club_id,id,user_id      (status, created_at, responded_at on NONE)
--
--   select has_table_privilege('authenticated','public.club_join_requests','update');
--   -- f      -- and there is no UPDATE policy either; the absence is the rule
--
--   select count(*) from information_schema.table_privileges
--    where table_schema='public' and table_name='club_join_requests' and grantee='anon';
--   -- 0
--
-- 3. ELEVEN new security definer functions, plus ONE rewritten — so the query
--    below returns TWELVE rows, and the twelfth is `private.may_participate`,
--    which 023 created and this file replaces. Enumerate rather than
--    count: CLAUDE.md records 078's task list getting exactly this arithmetic
--    wrong, and a function created without `security definer` would otherwise
--    be a code review rather than a red footer.
--
--   select p.proname, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname, p.proname) in (
--            ('private','is_club_admin_for'), ('private','is_club_admin'),
--            ('private','club_takes_join_requests_for'),
--            ('private','club_takes_join_requests'), ('private','may_participate_for'),
--            ('private','may_participate'), ('private','join_club_from_request'),
--            ('private','notify_club_join_requested'),
--            ('private','retract_club_join_requested'),
--            ('public','discoverable_private_clubs'),
--            ('public','approve_club_join_request'),
--            ('public','decline_club_join_request'))
--    order by 1;
--   -- prosecdef t on every row; proconfig {search_path=} on every row
--
-- 4. The oracles are reachable by NO client role, named by role rather than
--    attempted — 031's lesson, since the suite runs as the table owner for whom
--    neither the schema barrier nor the EXECUTE barrier exists.
--
--   select has_function_privilege('authenticated','private.is_club_admin_for(uuid,uuid)','execute'),        -- f
--          has_function_privilege('authenticated','private.club_takes_join_requests_for(uuid,uuid)','execute'), -- f
--          has_function_privilege('authenticated','private.club_takes_join_requests(uuid)','execute'),        -- t
--          has_function_privilege('authenticated','private.may_participate_for(uuid)','execute'),           -- f
--          has_function_privilege('authenticated','private.is_club_admin(uuid)','execute'),                 -- t
--          has_function_privilege('authenticated','public.discoverable_private_clubs(uuid,int)','execute'), -- t
--          has_function_privilege('anon',         'public.discoverable_private_clubs(uuid,int)','execute'), -- f
--          has_function_privilege('anon',         'public.approve_club_join_request(uuid)','execute'),      -- f
--          has_function_privilege('anon',         'public.decline_club_join_request(uuid)','execute');      -- f
--
-- 5. The accessor's return list is the disclosure. SEVEN named columns.
--
--   select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='discoverable_private_clubs';
--   -- TABLE(id uuid, name text, avatar_path text, location_name text,
--   --       latitude double precision, longitude double precision, members_count bigint)
--
-- 6. The gate, and the count that must NOT move on club_members.
--
--   select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
--   -- 16      (15 before 085)
--
--   select count(*) from pg_trigger
--    where tgrelid = 'public.club_members'::regclass and not tgisinternal;
--   -- unchanged — 078.9's lesson: a compensating trigger here would raise the
--   -- gate count while gating nothing, because current_user inside a definer
--   -- function is the owner and the WHEN clause can never be true.
--
-- 7. The cascades, and the notification CHECKs.
--
--   select conname, confdeltype from pg_constraint
--    where conrelid='public.club_join_requests'::regclass and contype='f';
--   -- both 'c'
--
--   select conname from pg_constraint where conrelid='public.notifications'::regclass
--      and contype='c' and pg_get_constraintdef(oid) like '%club_join_requested%';
--   -- notifications_subject_shape and notifications_type_check, both naming ten types
--
-- 8. Advisors: SEVENTEEN before, TWENTY after. Three new
--    `authenticated_security_definer_function_executable` WARNs, one per new
--    `public` definer function, and NONE for the eight in `private` — PostgREST
--    does not publish that schema, which is why 083's three private functions
--    raised the count by two rather than five. A twenty-first means a revoke did
--    not land, or something was created in `public` that belongs in `private`.
--
-- 9. 036's HAND-EXERCISE GATE APPLIES TO THIS FILE. private.notify_club_joined
--    fires `after insert on club_members` with no `when` clause, so from the
--    moment this applies it runs inside private.join_club_from_request and a
--    raise there takes a rider's approval down with it. Exercise on DEV in a
--    ROLLED-BACK transaction, before any code lands:
--      a. an ordinary club join by a rider — the unchanged path;
--      b. an approval into a private club;
--      c. an approval into a club whose owner holds no club_members row (054's
--         ownerless owner, who is an admin under is_club_admin_for).
--
--    ** AND THE WIDER HALF, WHICH THE THREE ABOVE DO NOT COVER. ** This file
--    also rewrites private.may_participate to delegate to its new
--    subject-taking twin, and public.enforce_participation_gate() calls that
--    function on every gated INSERT across all SIXTEEN tables — so 085's blast
--    radius is the whole gate, not only the approval path. It is provably
--    equivalent (023's body with `candidate` substituted, the same signature
--    and modifiers, and `create or replace` does not reset the ACL), so the
--    risk is a bad APPLY rather than a bad rule — which is exactly what a
--    hand-exercise catches. Two more cases, before the three above:
--      d. a gated INSERT by an onboarded rider — expect success;
--      e. a gated INSERT by a rider with onboarding_completed_at set and
--         terms_accepted_at NULL — expect 23514 and the gate's own message.
