-- 107: a club may outlive its last member, so that a rider erasing their
-- account stops destroying postcards belonging to riders who had already left.
--
-- PD-98, `openspec/changes/preserve-postcards-when-a-club-outlives-its-members/`.
-- Read `design.md` before changing any of this — every choice below is argued
-- there, and three of them look arbitrary without it.
--
-- ---------------------------------------------------------------------------
-- The defect, and why the reasoning that says it cannot happen is wrong
-- ---------------------------------------------------------------------------
-- `private.transfer_owned_clubs` (029, superseded by 032) hands each club owned
-- by the departing rider to the longest-tenured remaining admin, else member.
-- When no other member remains it takes the other arm, which deletes the club —
-- and `postcards.club_id -> clubs` is ON DELETE CASCADE, so every postcard in
-- that club goes with it.
--
-- `029` §2 reasoned that such a club holds postcards "entirely their own by
-- construction". ** That is false. ** Nothing removes a postcard when its author
-- leaves a club: the triggers on `club_members` are `enforce_participation_gate`,
-- `notify_club_joined` and `protect_club_owner_membership`, and on `postcards`
-- they are `enforce_participation_gate` and `postcards_set_updated_at` — read
-- from `pg_trigger` on DEV 2026-09-05, and none of them touches the other table.
-- A rider leaves; their postcards stay. So the arm that fires precisely when the
-- club is supposedly "entirely theirs" is the arm most likely to be wrong.
--
-- Club C owned by A; riders B and D posted into C and later left; A deletes
-- their account; B's and D's postcards are destroyed. Neither B nor D asked for
-- anything, and the loss is attributed to nobody.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured 2026-09-05 with RLS bypassed, on BOTH projects
-- ---------------------------------------------------------------------------
--                                             DEV        PROD
--   clubs ................................... 15          1
--   postcards ............................... 11          9
--   postcards with a club_id ................  5          1
--   postcards authored by a NON-member
--     of their own club ..................... 0          0
--   clubs at risk (no member but the owner,
--     holding a third party's postcard) ..... 0          0
--
-- ** The defect is loaded, not fired. ** Nobody has lost anything on either
-- project, so this migration has NOTHING TO BACKFILL and carries no repair
-- statement. It is a forward guarantee only. Re-run before reading any of that
-- as current — PROD's number is the one that had never been checked before this
-- change, and it is the one that would make this urgent rather than merely
-- correct:
--
--   select count(*) from public.postcards p
--    where p.club_id is not null
--      and not exists (select 1 from public.club_members m
--                       where m.club_id = p.club_id and m.user_id = p.author_id);
--
-- ---------------------------------------------------------------------------
-- The decision, and the two options it rejects
-- ---------------------------------------------------------------------------
-- ** Product owner, 2026-09-05 17:26Z, on PD-98. ** A club whose last member
-- leaves while third-party postcards survive STAYS, with no owner: "the
-- postcards keep the club context they were posted to, nobody inherits
-- anything, and the deletion cascade stops destroying content belonging to
-- people who had already left."
--
-- ** Rejected: hand the club to the author of the oldest surviving postcard **
-- — the issue body's own standing default, rejected in as many words because
-- "that gives somebody a club they never joined, with its members, its rides
-- and its name". The recipient may also be someone who left deliberately.
--
-- ** Rejected: detach the postcards (`club_id = null`) and delete the club. **
-- The owner rejected it for loss of meaning. There is a second and stronger
-- reason, recorded here because a later session will reach for this fix first:
-- the `postcards` SELECT policy reads
--
--   (author_id = auth.uid())
--   or (not is_blocked(...) and (club_id is null or is_club_member(club_id)) and ...)
--
-- so ** `club_id is null` means "visible to every signed-in rider" **. Nulling
-- `club_id` to save a private club's photos would publish them to the whole app.
-- It is a data-exposure bug wearing the costume of a content-preservation fix,
-- and it holds for a public club too, whose postcards are also members-only.
--
-- ** The direction is the whole argument: this change only ever moves an
-- audience NARROWER. ** A preserved postcard goes from "the club's members" to
-- "its author alone", because no rider can be a member of an ownerless club.
-- Nobody gains sight of anything they could not already see.
--
-- ---------------------------------------------------------------------------
-- Three-valued logic is the hazard here, and it lands in three directions
-- ---------------------------------------------------------------------------
-- Making `owner_id` nullable changes the meaning of every predicate that
-- interpolates it, and ** the three kinds of site fail in different directions **:
--
--   RLS `using` / `with check`   NULL is not TRUE          -> fails CLOSED  (safe)
--   a CHECK constraint           NULL is not FALSE         -> fails OPEN    (unsafe)
--   `where` inside a function    NULL is not TRUE          -> fails CLOSED  (safe)
--   a total wrapper like
--     `not private.is_blocked()` EXISTS swallows the NULL  -> fails OPEN    (unsafe)
--
-- Measured on DEV rather than reasoned:
--
--   select ('club-avatars/x/a.jpg' is null
--           or 'club-avatars/x/a.jpg' like 'club-avatars/' || null::uuid || '/%');
--   -- -> NULL, and a CHECK rejects only on FALSE, so the row is ACCEPTED.
--
-- Every site is enumerated from the catalogue rather than from a list, per the
-- requirement this change adds to `database-enforced-integrity`:
--
--   -- ** DO NOT scope this to `public` — that is how two sites were missed. **
--   select schemaname, tablename, policyname, cmd from pg_policies
--    where coalesce(qual,'') like '%owner_id%'
--       or coalesce(with_check,'') like '%owner_id%';
--   -- 7 rows: 4 on `clubs`, 1 on `club_members` INSERT, and 2 on
--   -- `storage.objects` (the club avatar and cover read policies).
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname in ('public','private') and p.prokind = 'f'
--      and pg_get_functiondef(p.oid) like '%owner_id%';          -- 24
--   select count(*) from pg_constraint
--    where contype = 'c' and conrelid = 'public.clubs'::regclass
--      and pg_get_constraintdef(oid) like '%owner_id%';           -- 2
--
-- ** The count is 7, and both of the numbers written down before the review were
-- wrong in the same direction. ** The change's task list said 4, which counts
-- `clubs` alone; a first pass here said 5, which adds `club_members` INSERT but
-- was scoped to `schemaname = 'public'` and so could not see the two
-- `storage.objects` policies at all. A schema-scoped catalogue query is not a
-- catalogue query — it is a list with a filter on it, which is the thing this
-- change's own new requirement says not to trust.
--
-- Both storage policies resolve CLOSED (`(storage.foldername(name))[2] =
-- c.owner_id::text` is NULL against a NULL owner) and §4 nulls the paths anyway,
-- so neither needed changing. They are named here because "we audited the
-- policies" was true of 4 of 7 when it was first written.
--
-- ---------------------------------------------------------------------------
-- Ordering: MIGRATION-FIRST, and the reason is that there is no unsafe side
-- ---------------------------------------------------------------------------
-- Not because migration-first is a default — `CLAUDE.md` §Supabase Rules is
-- explicit that "additive, so the order does not matter" is wrong in both
-- directions. The reasons here are specific:
--
--   * No client writes `owner_id` on an existing row. `clubs` UPDATE grants do
--     not include it and the INSERT policy pins it to `auth.uid()`, so there is
--     no `PGRST204` shape.
--   * No PostgREST relationship is added or removed, so there is no `PGRST201`
--     / HTTP 300 shape.
--   * ** The policy delta is provably a no-op against every row that exists at
--     apply time. ** `owner_id` is NOT NULL until statement §1 runs, so
--     `owner_id is not null` is universally true for every pre-existing row, and
--     the narrowed arms select exactly what they selected before. The only rows
--     the delta can affect are ones only §4 can create, and §4 is in this file.
--   * No client type changes: §2a keeps a NULL `owner_id` off the wire entirely,
--     so `owner_id: string` in `src/types/index.ts` stays honest and no `src/`
--     file moves in this change.
--
-- ---------------------------------------------------------------------------
-- §1. `clubs.owner_id` becomes nullable
-- ---------------------------------------------------------------------------
-- The owner asked this be checked before building, on the reading that
-- `CLAUDE.md`'s "a club outlives its owner" might already cover it. ** It does
-- not. ** That line describes ownership TRANSFER — 029/032 hand the club to a
-- successor so it survives its founder — which is a different thing from having
-- no owner at all. `owner_id` is NOT NULL today, so an ownerless club is
-- currently unrepresentable and this is a genuinely new lifecycle state.
--
-- Two places already anticipate it, which is evidence the shape is right rather
-- than evidence the work is done — neither makes the state representable:
--   * `private.protect_club_owner_membership` opens `if v_owner is null then
--     return old; end if;` ("Rule 3. Defence in depth").
--   * `private.join_club_from_invite` opens `if v_owner is null or v_is_default
--     then return false; end if;` (085) — so the invite WRITE path is already
--     closed against an ownerless club before this file touches anything.
--
-- `054`'s "ownerless owner" — a club whose `owner_id` points at a rider holding
-- no roster row — is a third, different thing again, and is not disturbed here.

alter table public.clubs alter column owner_id drop not null;

comment on column public.clubs.owner_id is
  'The club''s owner. ** NULL means an ownerless tombstone (107) ** — a club whose last member erased their account while third-party postcards survived in it. It is never a legal initial state: the INSERT policy pins it to auth.uid(), and the ONLY writer of NULL is private.transfer_owned_clubs. An ownerless club is invisible (clubs SELECT, 107 §2a), unjoinable (club_members INSERT, §2b), and uneditable and undeletable because `auth.uid() = owner_id` is NULL rather than TRUE. Its postcards keep club_id and are readable only by their own authors. Do not add a predicate that reads NULL as permissive — see this file''s three-valued logic table.';

-- ---------------------------------------------------------------------------
-- §2. The two policy arms that do NOT fail closed
-- ---------------------------------------------------------------------------
-- Everything else about `clubs` is already safe by three-valued logic and is
-- deliberately left alone — §3 asserts that rather than rewriting it. `clubs`
-- UPDATE and DELETE are `auth.uid() = owner_id`, which is NULL and therefore not
-- TRUE for every rider once the owner is NULL, so ** an ownerless club is
-- uneditable and undeletable by every client with no new predicate written **.
-- That is the desired "nobody inherits anything", and it is asserted in
-- `rls_test.sql` precisely because it rests on NULL semantics rather than on
-- anything visible in the policy text.

-- §2a. ** THE LOAD-BEARING STATEMENT OF THIS MIGRATION. **
--
-- The SELECT policy's public arm is the one arm that does not go NULL with the
-- owner: `is_public` stays TRUE. Left alone, a public club that goes ownerless
-- keeps appearing on Explore with a working Join button — and `club_members`
-- INSERT would admit the tap, which makes `private.is_club_member` TRUE, which
-- un-hides ** every preserved postcard in the club to a rider who was never in
-- it **. That is the exact exposure this change exists to prevent, reachable in
-- one tap, and it would pass every gate in this repo.
--
-- So the public arm is narrowed. The owner arm and the member arm are untouched:
-- both are already NULL-safe, and both are unreachable for an ownerless club
-- anyway (no owner to match, no members to be one of).
drop policy "Clubs are viewable by members and signed-in riders" on public.clubs;

create policy "Clubs are viewable by members and signed-in riders"
  on public.clubs for select to authenticated
  using (
    (is_public and owner_id is not null)
    or owner_id = auth.uid()
    or private.is_club_member(id)
  );

-- §2b. Defence in depth behind §2a, and not redundant with it.
--
-- `is_public` is data a club owner can flip, and the join path is reached
-- through a policy rather than through the screen that renders Explore. If a
-- future change re-widens the SELECT policy, or a `security definer` accessor
-- hands a club id to a rider some other way, this is what still refuses the
-- membership row. The exposure in §2a needs BOTH the sight and the join;
-- closing either closes it, so both are closed.
drop policy "Users can join public clubs, as a member" on public.club_members;

create policy "Users can join public clubs, as a member"
  on public.club_members for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.clubs c
       where c.id = club_members.club_id
         and c.owner_id is not null
         and (c.is_public or c.owner_id = auth.uid())
    )
    and role = 'member'
  );

-- ---------------------------------------------------------------------------
-- §3. The two helper sites where NULL fails OPEN
-- ---------------------------------------------------------------------------

-- §3a. `private.club_invite_is_answerable_for` — the fourth row of the
-- three-valued table, and the one that is genuinely surprising.
--
-- Its owner-block conjunct is `not private.is_blocked(candidate, c.owner_id)`.
-- `is_blocked` is a total wrapper over an EXISTS, so `is_blocked(x, NULL)` is
-- FALSE and the negation is ** TRUE **. Unlike every RLS site, this one does not
-- fail closed: against an ownerless club that conjunct simply passes.
--
-- It is closed today only by `may_invite_to_club_for(i.inviter_id, i.club_id)`,
-- an adjacent conjunct about something else entirely — which is exactly the kind
-- of accidental safety that stops being safe when the adjacent rule is revised.
-- The condition is written explicitly rather than relying on it.
--
-- Body carried forward verbatim apart from the added conjunct, so this stays
-- diffable against `093`.
create or replace function private.club_invite_is_answerable_for(candidate uuid, invite uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.club_invites i
      join public.clubs c on c.id = i.club_id
     where i.id = invite
       and i.invitee_id = candidate
       and i.status in ('pending', 'declined')
       -- 107: an ownerless club answers no invite. Written BEFORE the block
       -- conjunct below, because that conjunct cannot refuse this case: see the
       -- header of this section.
       and c.owner_id is not null
       -- §2a, and this is where the re-derivation actually happens.
       and private.may_invite_to_club_for(i.inviter_id, i.club_id)
       -- Symmetric by construction (`009`), so one call covers a block in
       -- either direction and no directional `blocks` row is ever read here.
       and not private.is_blocked(candidate, i.inviter_id)
       -- A block with the club's OWNER refuses the accept, not only the invite.
       -- Without it an unblocked admin could admit a rider the owner has
       -- blocked — the rule `085` states, whose stated reason (that
       -- club_members SELECT carries no block predicate) has expired while the
       -- rule has not: a membership admits a rider to the club's threads,
       -- messages, rides and timeline.
       and not private.is_blocked(candidate, c.owner_id)
       -- ** THE PARTICIPATION GATE GOVERNS THE READ AS WELL AS THE WRITE. ** A
       -- `security definer` read has no policy beneath it, so a check absent
       -- here is absent everywhere; without it an account created by calling
       -- GoTrue's /auth/v1/signup directly and never calling accept_terms()
       -- could read a private club's name off an invite.
       and private.may_participate_for(candidate)
  );
$$;

-- §3c. `private.can_read_club` — the TEXTUAL TWIN of the SELECT policy §2a
-- narrows, and it must move in the same migration.
--
-- ** This was not in the change's task list, which said explicitly not to touch
-- this function on the grounds that it "already fails closed". That was wrong,
-- and `rls_test.sql` 060 is what caught it ** — an assertion that pins the
-- `clubs` SELECT policy string against what this helper restates, whose own
-- message says: "it must arrive at the helper in the same change rather than
-- re-pinning this string, or every notification fan-out starts filtering against
-- a policy that no longer exists".
--
-- The helper carries the same three arms, so it inherits the same defect: its
-- `c.is_public` arm does not go NULL with the owner. Left alone, an ownerless
-- public club would still be "readable" through every caller of this helper
-- while being invisible through the policy — the two would disagree, which is
-- the precise failure 060 exists to prevent, and `notify_ride_created_in_club`
-- filters on it.
--
-- The owner and member arms are untouched for the same reason as in §2a.
create or replace function private.can_read_club(candidate uuid, target_club uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clubs c
     where c.id = target_club
       and (
         -- 107: an ownerless club is readable by nobody through this helper,
         -- exactly as it is invisible through the clubs SELECT policy. The two
         -- are pinned against each other at rls_test.sql 060.
         (c.is_public and c.owner_id is not null)
         or c.owner_id = candidate
         or private.is_club_member_for(candidate, c.id)
       )
  );
$$;

-- §3b. The two notification fan-outs, each of which unions in `c.owner_id` as a
-- recipient.
--
-- ** These are closed today only by accident, and the accident is worth naming. **
-- `notifications.user_id` is NOT NULL. A NULL recipient reaching the insert
-- would raise inside the rider's own transaction and take their join — or their
-- ride creation — down with it. It does not, because the post-union filter
-- `candidates.recipient <> new.user_id` evaluates to NULL for a NULL recipient
-- and drops the row. So the safety comes from a comparison written for an
-- entirely different purpose, and it evaporates if that filter is ever reordered
-- or the arm is read on its own.
--
-- Both are unreachable for an ownerless club through any client path once §2b
-- lands — nobody can join one, and nobody can create a ride in one. These are
-- written for the table-owner and `security definer` paths, and so that the
-- reason is on the record rather than rediscovered from a production incident.

create or replace function private.notify_club_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 058 §4, carried forward VERBATIM and deliberately still first. Every rider
  -- joins the default club at onboarding, so a fan-out here addresses the whole
  -- signup stream — at 036's recipient set that was one account's notification
  -- list; at 099's it is every rider who has ever signed up. See the header.
  if exists (select 1 from public.clubs c
              where c.id = new.club_id
                and c.is_default) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, club_id)
  select candidates.recipient, new.user_id, 'club_joined', new.club_id
    from (
      -- Kept even though 054 makes an owner a member: 095 lets an owner LEAVE
      -- their own club, and clubs SELECT's owner_id arm means such an ownerless
      -- owner still resolves the subject. See the header.
      --
      -- 107: `owner_id is not null` is explicit rather than relying on the
      -- post-union filter to drop a NULL recipient. notifications.user_id is
      -- NOT NULL, so this is the difference between a dropped row and a raise
      -- inside the joining rider's own transaction.
      select c.owner_id as recipient
        from public.clubs c
       where c.id = new.club_id
         and c.owner_id is not null
      union
      -- 099: no role predicate. The recipient set is every member, so the guard
      -- against a fourth role arriving is the domain assertion at 099.8 rather
      -- than a list here that would silently stop being total.
      -- Index-served by club_members_pkey (club_id, user_id) — leading column.
      select m.user_id
        from public.club_members m
       where m.club_id = new.club_id
    ) candidates
   -- AFTER the union, never inside an arm: the club's creator qualifies through
   -- both, and filtering inside one leaves them in through the other.
   where candidates.recipient <> new.user_id
     -- Blocking, symmetric from one directional row, so one call per candidate
     -- covers both directions. The rider's own join still succeeds — a block
     -- suppresses the notification, not the action.
     and not private.is_blocked(new.user_id, candidates.recipient)
  on conflict do nothing;
  return null;
end;
$$;

create or replace function private.notify_ride_created_in_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is null then
    return null;
  end if;

  -- 059: the default club's membership is every rider in the app, so this
  -- fan-out is an app-wide broadcast any rider can fire at will. See the
  -- migration header; this is 058 §4's rule applied to the fan-out 058 missed.
  if exists (select 1 from public.clubs c
              where c.id = new.club_id
                and c.is_default) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, ride_id, club_id)
  select candidates.recipient, new.organizer_id, 'ride_created_in_club', new.id, new.club_id
    from (
      -- Index-served by club_members_pkey (club_id, user_id) — leading column.
      select m.user_id as recipient
        from public.club_members m
       where m.club_id = new.club_id
      union
      -- 060: the club's owner, who may hold no membership row. 036 §7.5
      -- withheld this arm because is_club_member had no owner arm; 054 gave it
      -- one, and the filter below is what proves it rather than asserting it.
      --
      -- 107: explicit `owner_id is not null`, same reason as notify_club_joined.
      select c.owner_id
        from public.clubs c
       where c.id = new.club_id
         and c.owner_id is not null
    ) candidates
   -- AFTER the union: an owner who also holds a membership row qualifies
   -- through both arms, so an exclusion inside one leaves them in through the
   -- other. 036 §7.6 pays for this lesson on club_joined.
   where candidates.recipient <> new.organizer_id
     and not private.is_blocked(new.organizer_id, candidates.recipient)
     -- 060: and only if their own SELECT policy resolves the ride. This is what
     -- replaces §7.5's reasoning about is_club_member's body with a measurement
     -- of it.
     and private.can_read_ride(candidates.recipient, new.id)
     -- 060: AND the club, because this type carries club_id as well and 036 §3
     -- tests the two subjects independently. Removes nobody today — see §3b for
     -- why it is written anyway, and for the reachable state that needs it.
     and private.can_read_club(candidates.recipient, new.club_id)
  on conflict do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- §3d. The four sites that are closed TODAY, but only by a neighbouring
--      conjunct about something else
-- ---------------------------------------------------------------------------
-- ** Every one of these already refuses an ownerless club. None of them is a
-- live hole, and each is rewritten anyway ** — because this change adds a
-- requirement to `database-enforced-integrity` saying a site SHALL NOT rely on
-- a neighbouring guarantee that is about something else, and these four are
-- exactly that shape. Shipping the rule while leaving four counter-examples in
-- the tree would make the rule advisory on the day it lands.
--
-- What saves each one today, and why that is not enough to leave it alone:
--
--   * `club_takes_join_requests_for`  — saved by `c.owner_id <> candidate`,
--     which is NULL and therefore not TRUE. Its own `not is_blocked(candidate,
--     c.owner_id)` conjunct fails OPEN.
--   * `club_invite_link_reachable_by` — saved by `uid <> k.owner_id`, same
--     shape, and its `not is_blocked(uid, k.owner_id)` also fails OPEN.
--   * `notify_club_invited`           — its owner-block test is
--     `not exists (... and is_blocked(invitee, c.owner_id))`, which against a
--     NULL owner is TRUE. Closed only because `club_takes_invites_for` refuses
--     the invite upstream, in a different function.
--   * `notify_club_join_requested`    — carries the same
--     `select c.owner_id as recipient` union and the same
--     `notifications.user_id NOT NULL` hazard as the two fan-outs in §3b, and
--     was missed by the first pass over them.
--
-- A `<>` that saves a site by going NULL is one `coalesce` away from not saving
-- it, and nothing in the file says it is load-bearing. These make it explicit.

create or replace function private.club_takes_join_requests_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.id = target_club
       -- 107: an ownerless club takes no join request. Explicit rather than
       -- left to `c.owner_id <> candidate` below, which happens to be NULL.
       and c.owner_id is not null
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

create or replace function private.club_invite_link_reachable_by(t text, uid uuid, lock boolean default false)
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
     and not private.is_club_member_for(uid, k.club_id);
end;
$$;

create or replace function private.notify_club_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select new.invitee_id, new.inviter_id, 'club_invited', new.club_id
   where not private.is_blocked(new.invitee_id, new.inviter_id)
     -- 107: written as a POSITIVE existence test, because the negative one
     -- below cannot express it — `not exists (... and is_blocked(x, NULL))` is
     -- TRUE for an ownerless club, so adding the condition there would read as
     -- a guard while doing nothing.
     and exists (
           select 1 from public.clubs c
            where c.id = new.club_id
              and c.owner_id is not null
         )
     and not exists (
           select 1 from public.clubs c
            where c.id = new.club_id
              and private.is_blocked(new.invitee_id, c.owner_id)
         )
  on conflict do nothing;
  return null;
end;
$$;

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
      -- 107: same reason as the two fan-outs in §3b — notifications.user_id is
      -- NOT NULL, and a NULL recipient is dropped only by the post-union `<>`
      -- filter below, which is a comparison written for another purpose.
      select c.owner_id as recipient
        from public.clubs c
       where c.id = new.club_id
         and c.owner_id is not null
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

-- ---------------------------------------------------------------------------
-- §3e. `public.complete_onboarding` — the ONE membership-conferring definer
--      function with no `owner_id` predicate
-- ---------------------------------------------------------------------------
-- Every function in `public` or `private` whose body inserts into
-- `public.club_members` was enumerated. There are four, all `security definer`:
--
--   private.establish_club_owner_membership  n/a — AFTER INSERT on clubs, and
--                                            the INSERT policy demands
--                                            auth.uid() = owner_id
--   private.join_club_from_invite            guarded — `if v_owner is null ...`
--   private.join_club_from_request           guarded — same, verbatim
--   public.complete_onboarding               ** NOT guarded **
--
-- §4b excludes the welcome club from the ownerless arm, so this function cannot
-- meet an ownerless club today. ** The guard is added anyway, and the reason is
-- the rule this change is adding rather than a live hole: ** §4b is precisely a
-- "neighbouring guarantee about something else", and it holds only while
-- `is_default` marks exactly one club and nothing ever flags a second.
--
-- The `is_default` exclusion and this guard are BOTH kept, deliberately. The
-- exclusion is what preserves onboarding: if the welcome club could go
-- ownerless, this guard would make every new rider join NOTHING — silently,
-- because `059`'s warning fires only when no club carries `is_default` at all,
-- and an ownerless one still does. So the warning's condition is widened here
-- too, and that widening is the whole reason this guard is safe to add.
--
-- Body carried forward verbatim apart from those two changes.
create or replace function public.complete_onboarding(p_location text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_username      text;
  v_terms         timestamptz;
  v_stamp         timestamptz;
  v_was_complete  boolean;
begin
  if v_uid is null then
    raise exception 'complete_onboarding requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- `for update` so the read and the write below cannot be split by a concurrent
  -- call. The row is the caller's own and nobody else writes it, so there is no
  -- contention to speak of; this is here to remove the question rather than to
  -- resolve a measured problem.
  select p.username, p.terms_accepted_at, p.onboarding_completed_at
    into v_username, v_terms, v_stamp
    from public.profiles p
   where p.id = v_uid
     for update;

  -- 058: captured BEFORE the update, because that update sets the stamp
  -- unconditionally and the `coalesce` below makes a re-run indistinguishable
  -- from a first completion afterwards. The welcome club is joined on the
  -- transition into completion and never again — otherwise a rider who joined,
  -- left, and then re-ran this function would be put straight back in, and
  -- `leaveClub` would be a button that does not work.
  v_was_complete := v_stamp is not null;

  -- 023 §1.13, carried here because the trigger that also carries it does not
  -- run for this statement (measurement 2). Without this line, the participation
  -- gate would be walked around by completing onboarding through the very RPC
  -- that 021 makes the only way to complete it.
  if v_terms is null then
    raise exception 'onboarding cannot be completed before the terms are accepted'
      using errcode = 'check_violation';
  end if;

  -- 003 §6a, same errcode, because it is the same rule minus one arm.
  --
  -- 075 (PD-286): the location arms are GONE — `p_location is null` and
  -- `length(btrim(p_location)) < 1` no longer refuse anything. Onboarding is one
  -- step now (username), and a rider who never had a location screen must be
  -- able to finish. The username arm is unchanged, word for word, and so is the
  -- consent arm above it.
  --
  -- The message changed with the rule. The old text named a location
  -- requirement; leaving it behind would have named a rule the schema no longer
  -- has, and nothing would have gone red — every assertion covering these
  -- refusals matches on SQLSTATE 23514 and none on the text.
  if v_username is null then
    raise exception 'onboarding cannot be completed before a username is set'
      using errcode = 'check_violation';
  end if;

  -- 003 §6b: completion is a one-way door. `coalesce` over the OLD value is what
  -- pins it — re-running this updates the location and returns the ORIGINAL
  -- stamp, so a later profile edit can never re-date a rider's completion.
  --
  -- `coalesce` is deliberately NOT schema-qualified, unlike every other name in
  -- this file. It is a SQL construct rather than a function — there is no
  -- `pg_catalog.coalesce`, and writing one raises 42883 at runtime, which is a
  -- failure the happy path reaches and no amount of reading catches. Measured:
  -- the first version of this line had it, and the 101-character location
  -- assertion is what found it. The same applies to NULLIF, GREATEST, LEAST and
  -- CASE; it does not apply to `length` or `btrim`, which are real catalog
  -- functions and are qualified above.
  --
  -- 075: the location assignment is now conditional, and THIS IS THE MOST
  -- DANGEROUS LINE IN THE CHANGE. It was `set location = p_location`,
  -- unconditional, and that was safe only because the raise above refused a NULL
  -- or blank argument before control reached it. With that refusal gone, the new
  -- client's `complete_onboarding(null)` would silently erase a stored location
  -- on every re-run. A NULL or blank argument now means "leave it alone", never
  -- "clear it"; a real location is still stored, in the same statement as the
  -- stamp, exactly as before. `nullif(btrim(...), '')` rather than a bare
  -- `coalesce` because 018's `profiles_location_length` refuses a trimmed-empty
  -- string, so storing '   ' would raise 23514 where doing nothing is correct.
  update public.profiles p
     set location                = coalesce(nullif(pg_catalog.btrim(p_location), ''),
                                            p.location),
         onboarding_completed_at = coalesce(p.onboarding_completed_at,
                                            pg_catalog.now())
   where p.id = v_uid
  returning p.onboarding_completed_at into v_stamp;

  -- 058: the welcome club. Everything about this block is subordinate to the
  -- stamp above — it must never be able to undo it.
  --
  -- The insert runs as the function owner, so `club_members`' INSERT policy
  -- ("Users can join public clubs…") does not apply and no policy needs
  -- widening for a rider to be placed in a club they did not ask for.
  --
  -- ** 107: which is exactly why the owner_id predicate is written HERE. ** This
  -- is the only membership-conferring definer function in the schema without
  -- one, so an ownerless club carrying clubs.is_default would be joined by every
  -- new rider through a door no policy governs — un-hiding every preserved
  -- postcard in it to the whole signup stream. 107 §4b keeps that club from
  -- going ownerless in the first place; this is the second lock, because §4b is
  -- a guarantee about something else.
  --
  -- `enforce_participation_gate` does NOT fire either, and for the reason 023
  -- and 003 already document rather than a new one: its trigger carries
  -- `when (current_user = 'authenticated')`, and inside a security definer
  -- function current_user is the owner. That is not a gap being walked
  -- through — this function restates both halves of the gate itself, above,
  -- and refuses before reaching here if either is missing. `notify_club_joined`
  -- has no such `when` clause (036 §7.8, deliberately), which is why 058 §4 is
  -- a change to the function body and not to the trigger.
  --
  -- `on conflict do nothing` covers the rider who somehow already holds the
  -- row — the welcome club's own owner re-running this, most obviously — and
  -- suppresses the AFTER trigger with it, since a row that is not inserted
  -- fires nothing.
  --
  -- The exception block is a subtransaction on every first completion, which at
  -- signup volume costs nothing worth measuring, and buys the guarantee that no
  -- failure here reaches the rider. `when others` is deliberately that wide:
  -- the set of things that could go wrong is open (the club deleted mid-signup,
  -- a future trigger on `club_members`, a constraint added later), and every
  -- member of it has the same correct handling.
  if not v_was_complete then
    begin
      insert into public.club_members (club_id, user_id, role)
      select c.id, v_uid, 'member'
        from public.clubs c
       where c.is_default
         and c.owner_id is not null
      on conflict do nothing;

      -- 059: zero rows is a SUCCESS, so the handler below never runs for the
      -- likeliest failure of all — nothing carries the flag, and every rider
      -- silently joins nothing for ever. See the migration header. The second
      -- conjunct keeps this quiet for `on conflict do nothing`, which also
      -- leaves `found` false and is the correct, healthy case.
      --
      -- ** 107 widened this condition with `and c.owner_id is not null`, and it
      -- is what makes the guard above safe to add. ** Without it, an ownerless
      -- welcome club would satisfy `is_default`, the warning would stay silent,
      -- and every rider would join nothing for ever with no signal at all —
      -- 059's own worst failure, reintroduced by a security fix.
      if not found
         and not exists (select 1 from public.clubs c
                          where c.is_default and c.owner_id is not null) then
        raise warning 'complete_onboarding: no club carries clubs.is_default with an owner, so % joined nothing',
          v_uid;
      end if;
    exception
      when others then
        raise warning 'complete_onboarding: could not join % to the default club (%): %',
          v_uid, sqlstate, sqlerrm;
    end;
  end if;

  return v_stamp;
end;
$$;

-- ---------------------------------------------------------------------------
-- §4. `private.transfer_owned_clubs` — the no-successor arm splits in two
-- ---------------------------------------------------------------------------
-- ** This is the statement that can create the new state, and it is deliberately
-- last in the file. ** Everything that makes an ownerless club safe — the
-- nullable column, both narrowed policies, all three helper guards — is already
-- in place by the time this function can produce one. Reordering this above §2
-- would open a window, inside a single migration, in which the state exists and
-- the guards do not.
--
-- The successor arm is untouched, including its `for update of p` lock.
--
-- ** NULLING `owner_id` IS THE MECHANISM, NOT THE BOOKKEEPING — and this is the
-- one thing about this change that is invisible from its description. **
-- `clubs_owner_id_fkey` is `references public.profiles(id) ON DELETE CASCADE`.
-- Detaching the club from that cascade is the ENTIRE reason it survives the
-- erasure: the `profiles` row is deleted moments later, and any club still
-- pointing at it goes with it.
--
-- So "keep the club" cannot be implemented as "skip the `delete from
-- public.clubs`". A version that leaves `owner_id` pointing at the departing
-- rider looks correct, passes every assertion written against this function in
-- isolation, and then loses the club — and every postcard in it — to the
-- cascade a few statements later. Only an end-to-end run through the real
-- deletion path would catch it. `rls_test.sql` 107.1 performs the cascade for
-- exactly this reason rather than asserting on the function's output alone.
--
-- `public.leave_owned_club` already records the constraint from the other side:
-- "clubs.owner_id is NOT NULL with a CASCADE FK and 'do not transfer' is
-- unavailable when the owner's account is being erased." This migration is what
-- removes the first half of that sentence.
--
-- The split, in the arm that runs when no member remains:
--
--   * ** No third-party postcard survives ** -> keep `032`'s two statements
--     verbatim. `009`'s original reasoning holds exactly here: the club really
--     is entirely the departing rider's, there is nothing to protect, and an
--     empty ownerless club would be a permanent tombstone bought for nothing.
--   * ** A third-party postcard survives ** -> null the owner and both image
--     paths, and leave the club standing.
--
-- ** No ride is deleted in the new arm, and that is a decision rather than an
-- omission. ** `032` §2 deletes the club's private rides because
-- `rides.club_id ON DELETE SET NULL` would otherwise strand them: a private ride
-- with a NULL club is visible only to its organizer while its `ride_members`
-- rows survive, which is the zombie `029` named. ** That premise evaporates when
-- the club survives **: nothing sets `club_id` to NULL, so no ride is stranded
-- and the crew keeps exactly the ride, roster and chat it had. Deleting them
-- would destroy another rider's content for no reason `032` ever gave.
--
-- ** Both image paths are surrendered on BOTH arms, and on the new one it is
-- load-bearing rather than tidy. ** `016`'s ownership CHECK is
-- `avatar_path is null or avatar_path like 'club-avatars/' || owner_id || '/%'`.
-- With a NULL owner that expression is NULL, and a CHECK rejects only on FALSE,
-- so it ** stops biting ** — an ownerless club would silently keep a path
-- containing the erased rider's uid, indefinitely. `029` §D2 rejected exactly
-- that state as "the opposite of what an erasure request asked for". The second
-- path CHECK is a pure shape regex with no `owner_id` in it and keeps biting;
-- only the ownership one is disarmed, which is why this is written out rather
-- than left to the constraint.
--
-- ---------------------------------------------------------------------------
-- §4b. ** THE WELCOME CLUB IS EXCLUDED FROM THE NEW ARM, and this is a
--      SECURITY condition rather than a tidiness one. **
-- ---------------------------------------------------------------------------
-- `public.complete_onboarding` is `security definer` and joins every completing
-- rider to the club carrying `clubs.is_default`:
--
--   insert into public.club_members (club_id, user_id, role)
--   select c.id, v_uid, 'member' from public.clubs c where c.is_default
--   on conflict do nothing;
--
-- with no `owner_id` predicate — and its own comment says why that matters:
-- "The insert runs as the function owner, so `club_members`' INSERT policy does
-- not apply and no policy needs widening for a rider to be placed in a club they
-- did not ask for."
--
-- ** So §2b cannot reach it. ** If the welcome club were allowed to go
-- ownerless, every subsequent signup would still be force-joined to it, each
-- new membership row would make `private.is_club_member` TRUE, and every
-- preserved third-party postcard in that club would be readable by every new
-- rider in the app — the exact exposure §2a exists to prevent, arriving through
-- a door no policy in this file governs, and widening rather than closing over
-- time. It was found by reading `rls_test.sql` 081.16b's fixture, not by the
-- catalogue audit, which is worth knowing about the audit.
--
-- The alternative — adding `owner_id is not null` to `complete_onboarding`'s
-- join — was rejected: it keeps the club and makes every future rider join
-- NOTHING, silently, which is `059` §2's own documented worst failure. The
-- `not found` warning would not even fire, because a club carrying `is_default`
-- still exists.
--
-- ** Stated cost, not hidden: third-party postcards in the welcome club are
-- still destroyed by an erasure. ** PD-98's defect stays open for exactly one
-- club, and plausibly the one most likely to hold other riders' content. The
-- trade is deliberate: `rls_test.sql` 081.16b already records that this arm
-- destroys the welcome club and all its threads, so this file leaves that path
-- exactly as it found it rather than half-fixing it — and a partial fix that
-- also opens a leak is worse than a deferred one. Filed as its own follow-up
-- rather than left silent.
--
-- ** 081.16b's body assertion turns red on purpose. ** It pins
-- `transfer_owned_clubs` as mentioning `is_default` nowhere, and says in its own
-- message that it exists "so closing it is deliberate". This is that deliberate
-- edit; the assertion is updated rather than worked around.
--
-- ** One `update`, not two. ** Row CHECKs are evaluated per statement, so
-- nulling `owner_id` in one statement and the paths in another raises `23514` on
-- the happy path — the intermediate row has a NULL owner and a non-NULL path,
-- and although that expression is NULL rather than FALSE today, splitting it
-- relies on that and would break the moment the CHECK is tightened. One
-- statement has no intermediate row at all.
create or replace function private.transfer_owned_clubs(departing uuid)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  club record;
  successor uuid;
begin
  for club in
    -- 107 adds `is_default` to this list. See the §4b block below for why the
    -- welcome club is excluded from the new arm.
    select c.id, c.avatar_path, c.cover_image_path, c.is_default
      from public.clubs c
     where c.owner_id = departing
     order by c.id
     for update
  loop
    -- Emitted BEFORE the branch, so the bytes are surrendered on all three
    -- outcomes: transfer, ownerless, and deletion.
    if club.avatar_path is not null then
      object_path := club.avatar_path;
      return next;
    end if;
    if club.cover_image_path is not null then
      object_path := club.cover_image_path;
      return next;
    end if;

    -- admin, then member, then anything else — total over the enum, so a stray
    -- second 'owner' row sorts last rather than being picked at random.
    --
    -- `for update of p` makes the selection sound WITHIN this transaction: a
    -- candidate whose own deletion is committing concurrently is skipped in
    -- favour of the next, rather than being misread as "no successor". It does
    -- NOT prevent selecting someone whose deletion starts a moment later — see
    -- 032 §3, which states that race rather than pretending it is closed.
    select m.user_id into successor
      from public.club_members m
      join public.profiles p on p.id = m.user_id
     where m.club_id = club.id
       and m.user_id <> departing
     order by case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
              m.joined_at,
              m.user_id
     limit 1
       for update of p;

    if successor is not null then
      update public.clubs
         set owner_id         = successor,
             avatar_path      = null,
             cover_image_path = null
       where id = club.id;

      update public.club_members
         set role = 'owner'
       where club_id = club.id
         and user_id = successor;

      -- DEMOTED, not deleted — 032 §1. This transaction commits before the rest
      -- of the deletion runs, so the row has to survive a failure in between.
      update public.club_members
         set role = 'member'
       where club_id = club.id
         and user_id = departing;

    elsif not club.is_default and exists (
      -- 107: a postcard by anyone other than the departing rider is third-party
      -- content, and destroying it is what this change exists to stop.
      --
      -- `author_id <> departing` is the whole test and it is neither vacuous nor
      -- universal. No arm of this branch can see a postcard by a surviving
      -- MEMBER — there are no members left, which is why this arm ran at all —
      -- so every row it matches is by a rider who has already left. The
      -- departing rider's own postcards are excluded because they are going with
      -- the account, correctly and by the profiles cascade.
      select 1 from public.postcards p
       where p.club_id = club.id
         and p.author_id <> departing
    ) then
      -- The club survives with no owner. One statement — see the header.
      update public.clubs
         set owner_id         = null,
             avatar_path      = null,
             cover_image_path = null
       where id = club.id;

      -- No ride is deleted here. See the header: `032` §2's stranding premise
      -- does not hold when the club survives.

    else
      -- 032's arm, verbatim. Nothing third-party to protect, so `009`'s original
      -- answer is still the right one.
      --
      -- Only the rides that `SET NULL` would turn into zombies. A public ride
      -- survives the club perfectly well; deleting it destroys another rider's
      -- content for no reason D3 ever gave. 032 §2.
      delete from public.rides
       where club_id = club.id
         and is_public = false;
      delete from public.clubs where id = club.id;
    end if;

    successor := null;
  end loop;
end;
$$;

comment on function private.transfer_owned_clubs(uuid) is
  'Hand every club this rider owns to its longest-tenured remaining admin, else its longest-tenured remaining member (029/032). ** 107: when no member remains, the club is now KEPT with owner_id NULL if any postcard in it was authored by somebody else, and deleted only when there is nothing third-party to protect. THE DEFAULT CLUB IS EXCLUDED from that arm and still deletes — complete_onboarding is security definer and force-joins every new rider to clubs.is_default with no owner_id predicate, so an ownerless welcome club would hand its preserved postcards to the whole signup stream; see 107 §4b. ** Returns the Storage object paths it surrendered so the caller can delete the bytes. Exists so one rider erasing their account does not destroy other riders'' postcards through the clubs -> postcards cascade — which 029 §2 believed impossible on a premise (a memberless club''s postcards are "entirely their own by construction") that is false, because nothing removes a postcard when its author leaves a club. security definer because it rewrites rows across three tables under nobody''s ownership; in `private` so PostgREST never publishes it.';

-- `private` has no USAGE for `authenticated` (005), so this is belt and braces —
-- and belt and braces is the point for a function that deletes clubs. Restated
-- because `create or replace` preserves grants and this file should not depend
-- on that.
revoke all on function private.transfer_owned_clubs(uuid) from public, anon, authenticated;
revoke all on function private.club_invite_is_answerable_for(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- §5. Reaping the tombstone — an ownerless club does not outlive its content
-- ---------------------------------------------------------------------------
-- Without this, an ownerless club whose last postcard is later deleted is
-- unreachable by every role for ever: invisible (§2a), unjoinable (§2b),
-- uneditable and undeletable (`auth.uid() = owner_id` is NULL). That is a leak
-- in the lifecycle rather than a state, so the club is reaped when the last
-- thing it was preserved FOR is gone.
--
-- ** This hangs a trigger on `postcards` DELETE, an already-shipped write path. **
-- From the moment this file applies, every rider deleting any postcard runs new
-- code inside their own transaction, and a raise here takes their deletion down
-- with it. `CLAUDE.md`'s hand-exercise rule fires: the paths were exercised by
-- hand on DEV, as `authenticated`, in rolled-back transactions, counting rows —
-- results in §Verification at the foot of this file. The RLS suite does not
-- satisfy that rule and is not offered as satisfying it.
--
-- Five properties, each of which a plausible implementation gets wrong:
--
--   1. ** SECURITY DEFINER, and this is the one that fails SILENTLY. ** The
--      `clubs` DELETE policy is `auth.uid() = owner_id`, which is NULL for an
--      ownerless club and therefore admits NOBODY — including the rider whose
--      postcard deletion is running this. A `security invoker` version deletes
--      zero rows, with no error, and passes every assertion that only checks the
--      postcard deletion succeeded.
--   2. ** `old.club_id is null` is tested FIRST **, and again in the trigger's
--      own WHEN clause so the function is not even called. Most postcards are
--      app-wide (6 of 11 on DEV), and that deletion must pay nothing at all.
--   3. ** A multi-row delete fires this once per row, after the statement. **
--      Each invocation sees zero remaining postcards; the first reaps the club
--      and the rest must find nothing and no-op rather than raise.
--   4. ** It re-enters itself. ** `delete from public.clubs` cascades to
--      `postcards` via `postcards_club_id_fkey`, firing this same trigger. It is
--      harmless — the delete only runs when no postcard remains, so the cascade
--      removes none — but it is written knowing that rather than by luck.
--   5. ** It does not reap while a RIDE remains **, and this is the condition the
--      change's own design got wrong. `rides.club_id` is ON DELETE SET NULL, so
--      reaping a club that still holds a private ride strands exactly the zombie
--      `032` §2 exists to prevent: a private ride with a NULL club, visible only
--      to its organizer while its `ride_members` rows survive. §4 keeps those
--      rides deliberately; reaping out from under them would undo that in one
--      statement. A ride is third-party content too.
--
-- In `private`, so no `authenticated_security_definer_function_executable`
-- advisor is added and the count stays 39 DEV / 37 PROD. (The advisor actually
-- keys on `has_function_privilege('authenticated', ...)` rather than on the
-- schema, so `private` is a safe over-approximation rather than the mechanism.)
create or replace function private.reap_ownerless_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Property 2. Also in the trigger's WHEN clause; kept here so the function is
  -- still correct if that clause is ever dropped.
  if old.club_id is null then
    return null;
  end if;

  -- The subtransaction is scoped to the delete and is entered only for a
  -- club-attached postcard. Housekeeping must never fail a rider's own
  -- deletion — property 3's no-op case is silent, and anything genuinely
  -- unexpected becomes a warning rather than a lost delete.
  begin
    delete from public.clubs c
     where c.id = old.club_id
       -- Cheapest discriminating condition first: one indexed probe on the PK,
       -- and an ordinary club's postcard deletion stops here.
       and c.owner_id is null
       and not exists (select 1 from public.club_members m where m.club_id = c.id)
       and not exists (select 1 from public.postcards p where p.club_id = c.id)
       -- Property 5.
       and not exists (select 1 from public.rides r where r.club_id = c.id);
  exception
    when others then
      raise warning 'reap_ownerless_club: could not reap % (%): %',
        old.club_id, sqlstate, sqlerrm;
  end;

  return null;
end;
$$;

comment on function private.reap_ownerless_club() is
  'Deletes an ownerless club (107) once nothing is left that it was preserved for: no members, no postcards, no rides. Without it such a club is unreachable by every role for ever, since it is invisible, unjoinable, uneditable and undeletable. security definer BECAUSE the clubs DELETE policy is `auth.uid() = owner_id`, which is NULL for an ownerless club and admits nobody — a security invoker version would delete zero rows silently. Never reaps while a ride remains: rides.club_id is ON DELETE SET NULL, and stranding a private ride is the zombie 032 §2 exists to prevent.';

revoke all on function private.reap_ownerless_club() from public, anon, authenticated;

drop trigger if exists reap_ownerless_club on public.postcards;
create trigger reap_ownerless_club
  after delete on public.postcards
  for each row
  when (old.club_id is not null)
  execute function private.reap_ownerless_club();

-- ---------------------------------------------------------------------------
-- §Verification — the HAND-EXERCISE GATE, run before this file applied
-- ---------------------------------------------------------------------------
-- `CLAUDE.md`: "A migration that hangs triggers off an already-shipped write
-- path needs a hand-exercise gate before it applies ... Exercise every affected
-- path by hand on DEV first, in a rolled-back transaction, as `authenticated`,
-- counting the fan-outs' rows rather than assuming them."
--
-- §5's trigger is exactly that case. Run against DEV (`fpmrimzxadewsaiwpsel`)
-- 2026-09-05, in ONE transaction that created the column change, the function
-- and the trigger, exercised all five paths and then ROLLED BACK. Steps 5.1 and
-- 5.2 used REAL rows — a postcard in the live welcome club and an app-wide
-- postcard — deleted by their real author with `role authenticated` and a
-- matching `request.jwt.claims`, not as the table owner.
--
--   5.1  postcard in an OWNED club ................ PASS  deleted, club untouched
--   5.2  APP-WIDE postcard ........................ PASS  deleted (WHEN clause
--                                                   means the function is never
--                                                   even called)
--   5.3  LAST postcard in an OWNERLESS club ....... PASS  club reaped
--   5.4  ONE OF SEVERAL in an ownerless club ...... PASS  club stays
--   5.5  CASCADE: the author erased while their
--        postcards are the last in an ownerless
--        club .................................... PASS  erasure COMPLETED and
--                                                   the club was reaped inside it
--
-- 5.5 is the one worth keeping: the reap runs inside the `profiles` cascade,
-- in the rider's own deletion transaction, and a raise there would abort the
-- erasure itself. It did not.
--
-- The rollback was confirmed rather than assumed — DEV read back immediately
-- afterwards at 15 clubs, 11 postcards, 24 profiles, `owner_id` still NOT NULL
-- and 2 triggers on `postcards`.
--
-- ---------------------------------------------------------------------------
-- §Verification — after applying, against the live catalogue
-- ---------------------------------------------------------------------------
-- Do not assume any of these; each has been wrong in this repo before.
--
--   -- the column is nullable, and NOTHING is ownerless yet
--   select attnotnull from pg_attribute
--    where attrelid = 'public.clubs'::regclass and attname = 'owner_id';   -- f
--   select count(*) from public.clubs where owner_id is null;              -- 0
--
--   -- both narrowed copies moved, and they must agree
--   select qual from pg_policies
--    where schemaname='public' and tablename='clubs' and cmd='SELECT';
--   select pg_get_functiondef('private.can_read_club(uuid,uuid)'::regprocedure);
--
--   -- three triggers on postcards now, and the third carries its WHEN clause
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.postcards'::regclass and not tgisinternal;
--
--   -- the advisor count must NOT move: 39 DEV / 37 PROD. reap_ownerless_club is
--   -- the only new function and it is in `private`.
--   get_advisors(security)
