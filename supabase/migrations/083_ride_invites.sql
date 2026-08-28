-- 083: ride invites — a fourth audience arm for `rides`, and the two RPCs that
-- answer one.
--
-- Linear PD-329. The proposal is openspec/changes/invite-riders-to-a-ride/, and
-- its six delta specs are the contract this file implements. The shareable-link
-- half is PD-330 and reuses `private.join_ride_from_invite` below; nothing here
-- carries a token, a bearer status or an unauthenticated route.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING: additive in schema, and NOT inert
-- ---------------------------------------------------------------------------
-- The table, the policies and the three fan-outs below hang off a relation that
-- did not exist a statement earlier, so none of them can fire for anyone today.
-- **`create or replace private.can_read_ride` is the exception and it is the
-- whole hazard.** Every existing `notifications` fan-out calls that function —
-- `notify_ride_joined` and `notify_ride_created_in_club` do it INSIDE a rider's
-- own RSVP and ride-creation transaction — so from the moment this applies,
-- every RSVP, every ride created in a club and every club join runs the new
-- body, and a raise there takes that rider's write down with it.
--
-- That is `036`'s rule and it is why the order is DEV first, the affected write
-- paths exercised by hand in a rolled-back transaction, and only then PROD.
--
-- Rollback is: drop the three triggers on `ride_invites` FIRST, then their
-- functions, then the two RPCs and `join_ride_from_invite`, then restore
-- `private.can_read_ride` and the `rides` SELECT policy to their `060`/`022`
-- text, then the two `notifications` CHECKs to their five-type form, then the
-- table. Dropping the table first leaves `can_read_ride` referencing a missing
-- relation, which turns every RSVP into an error.
--
-- ---------------------------------------------------------------------------
-- Why this needs a proposal, and what the change actually is
-- ---------------------------------------------------------------------------
-- **An invite is a grant of SELECT on somebody else's resource.** Ride
-- visibility has been three predicates since `022` — the organizer, a public
-- ride, a ride in a club you belong to — and this adds a fourth that a rider
-- can *cause*. That is exactly the class `openspec/config.yaml` exists for: a
-- visibility decision left unstated "silently becomes whatever the migration
-- author assumed".
--
-- The unstated thing, stated: **an invite to a ride in a PRIVATE club hands a
-- non-member of that club a readable `rides` row.** The blast radius is
-- enumerated rather than described, because "it only grants the ride" is the
-- kind of summary that is wrong by one surface:
--
--   REACHED, by construction, because each delegates to `rides` SELECT
--     * `ride_members` — the crew list, through its own `EXISTS (rides …)`
--     * `storage.objects` under `ride-maps` — `051`'s "readable with the ride"
--       policy runs the same EXISTS, so an invitee sees the ride's map tile
--     * `public.ride_journal_postcard_ids(ride)` — `062`'s accessor, granted to
--       `authenticated`, gated on `private.can_read_ride`, which §3b changes.
--       So an invitee learns WHICH of the postcards they can already read are
--       tagged to this ride. `062`'s own comment names that correlation as the
--       load-bearing part of the function, and it is a real disclosure: bounded,
--       intended, and asserted at 083.2 rather than discovered later.
--
--   NOT REACHED **WHILE THE INVITE IS PENDING**, because each hangs off a
--   helper this file does not touch
--     * the club, its other rides, its member list, its threads — `is_club_member`
--     * the ride's chat and its read watermark — `is_ride_crew`
--     * tagging a postcard to the ride — `041` needs both conjuncts
--
--   ** THE `is_ride_crew` THREE ARE PENDING-ONLY, AND SAYING SO IS THE POINT. **
--   Accepting writes a `ride_members` row, which makes `is_ride_crew` true — so
--   an ACCEPTED invitee to a private club's ride reaches its chat, `ride_reads`'
--   write predicate and `041`'s tagging, none of which they could reach before
--   `083`. That is the product working: accepting means joining. It is stated
--   here because these lines are the blast-radius statement for a visibility
--   change into a private club, and a reader asking "can an invited non-member
--   of this club post in the ride chat?" would otherwise be told no. The suite
--   is scoped correctly — 083.2's label reads *an invitee is not crew*.
--
--   ** AND AN ORGANIZER CANNOT UNDO AN ACCEPTED INVITE. ** DELETE is scoped to
--   `pending`, there is no UPDATE grant or policy, and `accepted` grants read
--   for ever by design (§1's anti-eviction property). Their only exit is a
--   block. That is not new — `ride_members` DELETE has been `auth.uid() =
--   user_id` since `001`, so an organizer has never been able to remove a rider
--   from a ride — but the invite is the first thing that lets them *add* one,
--   which is what makes the asymmetry worth writing down.
--
--   NOT REACHED, because both its policies are organizer-scoped
--     * `ride_map_render_attempts` (`051`)
--
-- §7's assertions walk that table one row at a time. Five separate assertions
-- rather than one count, because a count cannot say which predicate did the
-- work.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access          -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS  -> the new arm sits INSIDE the block group (§3)
--   #5 onboarding gates participation -> §4's trigger, and §5's restatement
--   #7 username is the display name -> nothing here stores a name
--   #8 Supabase with RLS is the backend -> no service-role path writes a row

-- ===========================================================================
-- §1. The table
-- ===========================================================================
-- **`status` is the answer to the INVITATION and never a copy of membership.**
-- Nothing hangs off `ride_members` to keep the two in step, deliberately: a
-- rider who RSVPs to a ride they were also invited to leaves the invite
-- `pending`, which is the truth — they were invited and never answered. Every
-- surface that wants to know whether they are riding reads `ride_members`.
create table public.ride_invites (
  id uuid default uuid_generate_v4() primary key,

  -- Cascade: deleting a ride takes every invite to it. Nobody is notified,
  -- which matches what already happens to the crew.
  ride_id uuid references public.rides(id) on delete cascade not null,

  -- Both parties cascade, and neither is visible in the other's key. The row
  -- records "rider A named rider B for ride R at time T" — a relationship
  -- between two identified riders — so `029`'s erasure contract has to reach it
  -- from both ends. This is the pairing `036` states for user_id/actor_id.
  invitee_id uuid references public.profiles(id) on delete cascade not null,
  inviter_id uuid references public.profiles(id) on delete cascade not null,

  -- Server-owned by the GRANT rather than by this default: §4's `grant insert`
  -- does not name this column, so there is no statement in which a client could
  -- set it. A default alone would not do — it applies only when the column is
  -- omitted, and PostgREST will happily name one.
  status text default 'pending' not null,

  created_at timestamptz default now() not null,
  responded_at timestamptz,

  -- ** NOT a wider key. ** A repeat invite must be a 23505 rather than a second
  -- row, which is the whole anti-treadmill property: an organizer cannot ring
  -- the same rider's phone twice for the same ride, in any status. A key
  -- including `inviter_id` would permit exactly that the day crew invites land,
  -- and one including `status` would permit it today.
  unique (ride_id, invitee_id),

  constraint ride_invites_status_is_known
    check (status in ('pending', 'accepted', 'declined')),

  -- Refused before any policy or fan-out runs, so a self-invite cannot reach
  -- the notification path at all.
  constraint ride_invites_no_self_invite
    check (invitee_id <> inviter_id),

  -- `is not distinct from` rather than `= null`, and `is not distinct from`
  -- again on the whole equality: **a CHECK passes on NULL**, so a naive
  -- `(status = 'pending') = (responded_at is null)` would be NULL — and
  -- therefore accepted — whenever either side was unknown. `073`'s measured
  -- correction, applied at creation.
  constraint ride_invites_response_coupling
    check ((status = 'pending') is not distinct from (responded_at is null))
);

alter table public.ride_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Indexes, and which foreign key each one discharges
-- ---------------------------------------------------------------------------
-- `029` asserts that every FK into `profiles` LEADS an index, because that is
-- what makes an account deletion's cascade a lookup rather than a scan.
--
--   ride_id     -> the `unique (ride_id, invitee_id)` index above already leads
--                  with it; no second index is added for the cascade.
--   invitee_id  -> ride_invites_invitee_idx below, which is also the invitee's
--                  own list, newest first.
--   inviter_id  -> ride_invites_inviter_idx below.
--
-- The third is the organizer's per-ride list. It leads with `ride_id` too, and
-- is not redundant with the unique index: that one orders by `invitee_id`, and
-- the list is drawn newest first.
create index ride_invites_invitee_idx
  on public.ride_invites (invitee_id, created_at desc, id desc);
create index ride_invites_inviter_idx
  on public.ride_invites (inviter_id);
create index ride_invites_ride_created_idx
  on public.ride_invites (ride_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- The rider picker has NO index, and that is a decision rather than an omission
-- ---------------------------------------------------------------------------
-- Naming a rider means searching usernames by prefix, and **nothing in this
-- schema serves that**: `001`'s plain unique on `username` was dropped by
-- `003`, whose replacement is `profiles_username_lower_key` on
-- `(lower(username))` with the DEFAULT operator class, and there is no
-- `pg_trgm`, `citext` or `text_pattern_ops` anywhere in the chain. So every
-- keystroke in the picker is a sequential scan of `profiles` with
-- `private.is_blocked` — a `security definer` EXISTS — evaluated per surviving
-- row.
--
-- **An earlier draft of this file added `(lower(username) text_pattern_ops)`
-- and it was removed before merge, because it would have been a DEAD INDEX
-- THAT READS AS LIVE** — the trap this repo names in a dozen other places.
-- Postgres cannot use a b-tree for `ILIKE` at all, and the picker's read is
-- `.ilike('username', q || '%')` through PostgREST, which has no expression
-- filter and so cannot say `lower(username) like lower(q) || '%'`. The index
-- would have sat there costing writes and answering nothing, while the next
-- reviewer read its presence as the performance question being handled.
--
-- **What is accepted, and what bounds it.** The scan is fine at this size —
-- `profiles` is in the tens of rows and the app has shipped to nobody — and it
-- is bounded by the picker's own shape: a two-character minimum, a prefix
-- anchor and a 20-row cap. It stops being fine somewhere in the thousands.
--
-- **The two real fixes, so the next session does not re-derive them.** Either
-- `pg_trgm` with a GIN index, which serves `ILIKE` directly and costs an
-- extension; or a `security INVOKER` SQL function doing
-- `lower(username) like lower(q) || '%'` behind a `(lower(username)
-- text_pattern_ops)` index — invoker, so `profiles` SELECT and its block arm
-- still apply, which is what a `security definer` search would step past.
-- PD-333; it is a performance change with no visibility consequence either way.

comment on table public.ride_invites is
  'One row per (ride, invited rider) — 083, PD-329. A LIVE invite (status `pending` or `accepted`) is a FOURTH audience arm of the rides SELECT policy, reached through private.has_live_ride_invite, and it sits INSIDE that policy''s block-dominated group so a blocked rider''s invite grants nothing. Only the ride''s organizer may insert one; only the invitee may answer it, through accept_ride_invite / decline_ride_invite; nobody may UPDATE the table directly, because no UPDATE grant or policy exists. Decline is terminal against the INVITER — DELETE is scoped to `pending` — and reopenable by the invitee alone. `status` is the answer to the invitation and NEVER a copy of ride_members: nothing keeps the two in step and nothing should.';

comment on column public.ride_invites.status is
  'pending | accepted | declined. Written ONLY by the column default and the two RPCs — `authenticated` holds no INSERT grant on this column and no UPDATE grant at all. `accepted` still grants read on the ride, deliberately: without it a rider who accepts and later leaves the crew is evicted from a ride they were admitted to and cannot rejoin, because ride_members INSERT''s own EXISTS(rides …) runs under their own RLS.';

comment on column public.ride_invites.responded_at is
  'NULL exactly while `status` is pending, pinned by ride_invites_response_coupling. Server-owned by the absent INSERT grant, like created_at.';

-- ===========================================================================
-- §2. The helper pair — one body, two entry points
-- ===========================================================================
-- `060`'s `is_club_member` / `is_club_member_for` pattern, and it is a pattern
-- rather than a duplication for a reason this file depends on twice: an RLS
-- policy can only ever ask the question about its CALLER, while a fan-out has
-- to ask it about somebody else (`036` trap (c)). Two entry points, one body,
-- so an arm added to one cannot be missing from the other.

-- The subject-taking form. `auth.uid()` appears NOWHERE in this body — §7
-- asserts its absence, which is trap (c) in its enforceable form.
create or replace function private.has_live_ride_invite_for(candidate uuid, target_ride uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ride_invites i
     where i.ride_id = target_ride
       and i.invitee_id = candidate
       -- ** `in`, never `<> 'declined'`. ** A fourth status added later must
       -- grant NOTHING by default, and an inequality defaults to granting
       -- everything. Same failure shape as `036`'s `else false`, which its own
       -- comment calls load-bearing rather than defensive tidiness.
       and i.status in ('pending', 'accepted')
  );
$$;

-- The caller-relative wrapper. Its body is EXACTLY the delegation and nothing
-- else, and §7 pins that by equality rather than by `like` — `060`'s own
-- reasoning: a `like '%..._for%'` match is satisfied by the mention alone, so a
-- wrapper that grew a second arm would pass a substring pin while leaving the
-- `_for` body — and therefore `can_read_ride` — silently narrower.
create or replace function private.has_live_ride_invite(target_ride uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_live_ride_invite_for(auth.uid(), target_ride);
$$;

-- The `_for` form is an INVITE ORACLE — it answers "is this named rider invited
-- to this ride" for any pair — so no client role may reach it. Only the
-- wrapper, and only because an RLS expression is evaluated as the querying role
-- and would otherwise fail with 42501.
revoke all on function private.has_live_ride_invite_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_live_ride_invite(uuid) from public, anon;
grant execute on function private.has_live_ride_invite(uuid) to authenticated;

comment on function private.has_live_ride_invite_for(uuid, uuid) is
  'Does this CANDIDATE hold a live (pending or accepted) invite to this ride? The subject-taking half of 083''s helper pair, for fan-outs and for private.can_read_ride. Granted to NO client role — it answers the question for any pair, which is an invite oracle.';

comment on function private.has_live_ride_invite(uuid) is
  'Does the CALLER hold a live invite to this ride? Delegates to has_live_ride_invite_for(auth.uid(), …) and does nothing else — the suite pins that body by equality. Granted to authenticated because the rides SELECT policy calls it and an RLS expression runs as the querying role.';

-- ===========================================================================
-- §3. The `rides` SELECT policy gains its fourth arm — INSIDE the block group
-- ===========================================================================
-- ** THE PLACEMENT IS THE ENTIRE SECURITY STATEMENT, and it is a one-line diff
-- away from a block bypass. **
--
--   Inside the group (below)  : a blocked invitee fails `not is_blocked(...)`,
--                               so the whole group is false and the ride is
--                               invisible.  CORRECT.
--   Top-level, beside the      : the disjunct is true independently, so a rider
--   organizer arm                the organizer has BLOCKED reads the ride.
--                               ** A BLOCK BYPASS. **
--
-- Decision #2 is that a blocked rider disappears from feeds, search, chat,
-- member lists and ride crews *simultaneously*. An invite that outlives a block
-- is a hole in exactly that. The organizer arm is top-level because a rider
-- cannot block themselves out of their own ride; nothing else may join it
-- there.
--
-- **The arm is a disjunct and narrows nothing.** A rider who can already see
-- the ride some other way is unaffected — an invite adds reach and never
-- removes it — which is why an invite to a rider who is already a club member
-- is inert rather than wrong.
drop policy if exists "Rides are viewable by the club, organizer and signed-in riders" on public.rides;

create policy "Rides are viewable by the club, organizer and signed-in riders"
  on public.rides for select to authenticated
  using (
    organizer_id = auth.uid()
    or (
      not private.is_blocked(auth.uid(), organizer_id)
      and (
        (is_public and (club_id is null or private.is_club_public(club_id)))
        or (club_id is not null and private.is_club_member(club_id))
        or private.has_live_ride_invite(id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- §3b. The SECOND copy of that policy moves in the same statement block
-- ---------------------------------------------------------------------------
-- `private.can_read_ride` (`060`) is a second implementation of the policy
-- above — its predicate with `auth.uid()` replaced by `candidate` and
-- `is_club_member` by `is_club_member_for`. It exists because a policy can only
-- be evaluated for the caller and a fan-out needs the answer for somebody else.
--
-- **`supabase/tests/rls_test.sql` §060.1 pins the policy's qual by EQUALITY and
-- its failure message says what to do**: *"the helper is stale — update it in
-- the same change rather than re-pinning this string, or every notification
-- fan-out starts filtering against a policy that no longer exists."* Here both
-- are required, because the policy genuinely changed. A re-pin with this
-- statement skipped is PD-211's exact shape and it fails SILENTLY: the invited
-- rider opens the ride fine, and the fan-out deciding whether to notify them
-- filters against a rule that no longer exists.
--
-- `create or replace` preserves the OID and the existing privileges; the
-- revoke below is re-issued anyway so the file is correct in isolation on a
-- scratch replay.
create or replace function private.can_read_ride(candidate uuid, target_ride uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride
       and (
         -- Unconditional, exactly as in the policy: an organizer resolves their
         -- own ride whatever its is_public, whatever its club, and whether or
         -- not they hold a ride_members or club_members row.
         r.organizer_id = candidate
         or (
           not private.is_blocked(candidate, r.organizer_id)
           and (
             (r.is_public and (r.club_id is null or private.is_club_public(r.club_id)))
             or (r.club_id is not null and private.is_club_member_for(candidate, r.club_id))
             -- 083's fourth arm, in the same position as the policy's. Same
             -- block domination, same disjunct, candidate-relative form.
             or private.has_live_ride_invite_for(candidate, r.id)
           )
         )
       )
  );
$$;

revoke all on function private.can_read_ride(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_ride(uuid, uuid) is
  'Can this CANDIDATE read this ride? A second implementation of the rides SELECT policy — FOUR arms since 083: the organizer, a public ride, a ride in a club they belong to, and a live ride_invites row, the last three dominated by the block check. It exists because a policy can only be evaluated for its caller and a fan-out needs the answer for somebody else (036 trap (c)). Change it in the same migration that changes the policy, never afterwards.';

-- ===========================================================================
-- §4. Policies and grants on `ride_invites`
-- ===========================================================================

-- SELECT: the two parties, and neither of them while a block stands. The block
-- is asked once per party because either can be the caller; `private.is_blocked`
-- is symmetric, so one directional `blocks` row hides the invite from both.
-- `is_blocked(x, x)` is false — measured on DEV 2026-08-27 — so the caller's own
-- half is always satisfied and no `case` is needed.
--
-- ** No arm reading `rides.organizer_id`. ** It would be dead code today, since
-- the INSERT policy already pins `inviter_id` to the organizer, and dead policy
-- arms are how a widening arrives unnoticed. It arrives with crew invites, which
-- is `club_members.role`'s precedent: the column landed in `019` and no policy
-- read it until something needed it to.
create policy "Ride invites are readable by the two riders they name"
  on public.ride_invites for select to authenticated
  using (
    (invitee_id = auth.uid() or inviter_id = auth.uid())
    and not private.is_blocked(auth.uid(), invitee_id)
    and not private.is_blocked(auth.uid(), inviter_id)
  );

-- INSERT: the ride's organizer, as themselves, and not into a block.
--
-- **The `EXISTS` is evaluated under the caller's own RLS, and that is the
-- composition rather than a convenience.** An organizer whose ride they can no
-- longer read — there is no such state today — could not invite into it.
--
-- Organizer-only is a decision, not a limitation to route around: an invite is
-- a grant of SELECT, and nothing in this schema has ever let a non-owner grant
-- visibility to a resource. Widening to the crew is one predicate here and no
-- schema change at all (`055`'s precedent), so it lands later with its own
-- scenarios rather than being smuggled in as a default.
create policy "A ride's organizer invites riders to it"
  on public.ride_invites for insert to authenticated
  with check (
    inviter_id = auth.uid()
    and exists (
      select 1 from public.rides r
       where r.id = ride_id and r.organizer_id = auth.uid()
    )
    and not private.is_blocked(auth.uid(), invitee_id)
  );

-- DELETE: the inviter withdrawing an unanswered invite, and nothing else.
--
-- ** `status = 'pending'` is what makes decline terminal. ** Without it an
-- organizer could delete a refusal and re-send it, daily — the unique index
-- would no longer bind anything, because a deleted row is indistinguishable
-- from never-invited. The invitee cannot delete their own invite either: the
-- record of the refusal is the point of it.
--
-- ** WHAT THIS DOES NOT BOUND, stated rather than left to be discovered: a
-- PENDING invite can be revoked and re-sent without limit. ** §6e's retraction
-- clears the notification, so each re-send writes a fresh one rather than being
-- absorbed by `036`'s uniqueness index — an organizer can therefore ring an
-- unanswering invitee's phone arbitrarily often, and the invitee's only exits
-- are to decline (which is then terminal for them too) or to block. The
-- anti-spam property the story names is held against a REFUSAL and not against
-- silence. Bounding it is a product decision — a cooldown, a re-send cap, or
-- dropping the retraction so the uniqueness index absorbs the repeat — and it
-- is PD-332 rather than settled here by omission.
create policy "An inviter withdraws an invite nobody has answered"
  on public.ride_invites for delete to authenticated
  using (inviter_id = auth.uid() and status = 'pending');

-- ** NO UPDATE POLICY AND NO UPDATE GRANT, and the absence is the enforcement. **
-- `078`'s precedent. With RLS on, a command with no policy is refused for every
-- row — so `status` and `responded_at` are writable only by §5's two RPCs, which
-- are `security definer` and check the caller themselves. A policy here would be
-- the thing that let a rider write their own status, and a grant without a
-- policy would return 42501 and read as a bug.

revoke all on public.ride_invites from anon, authenticated;
grant select, delete on public.ride_invites to authenticated;
-- Per column, and `status`, `created_at` and `responded_at` are on NONE of
-- them: a default applies only when the column is omitted, and a client can
-- name one.
grant insert (id, ride_id, invitee_id, inviter_id) on public.ride_invites to authenticated;

-- The participation gate. `when (current_user = 'authenticated')` is not
-- decoration — `023` §2: this is a rule about what RIDERS may write, so it must
-- not refuse the app's own accessors, a seed or a repair statement. (`036`'s
-- fan-outs carry the opposite rule and its §7 has a trap warning about copying
-- exactly this clause into one.)
drop trigger if exists enforce_participation_gate on public.ride_invites;
create trigger enforce_participation_gate
  before insert on public.ride_invites
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped from thirteen, per `028`/`033`: this comment is the `data` agent's
-- first read via `list_tables` and no edit to CLAUDE.md reaches it.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, fourteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ===========================================================================
-- §5. The write path — one function writes the crew row on an invite path
-- ===========================================================================
-- ** This is PD-330's seam. ** `accept_ride_invite` is its only caller today; a
-- token-bearing claim becomes its second, without touching the write. One
-- invite concept, one `ride_members` write, two ways of reaching it.
--
-- ** `078`'s case exactly, and the reason the gate is restated in the body: **
-- the `enforce_participation_gate` trigger on `ride_members` carries
-- `when (current_user = 'authenticated')`, and `current_user` inside a
-- `security definer` function is the OWNER — so it cannot fire for this writer.
-- ** Do NOT add a second trigger to compensate. ** It would raise the gate
-- count by one while gating nothing, making coverage read complete; `078.9`
-- asserts that absence on `push_devices` for exactly this reason.
-- ** IT RETURNS A BOOLEAN RATHER THAN RAISING ON AN UNREADABLE RIDE, AND THAT
-- IS A DISCLOSURE RULE RATHER THAN A STYLE CHOICE. ** A raise here would reach
-- the rider as its own message, distinguishable from `accept_ride_invite`'s
-- "no answerable invite" — so an invitee whom the organizer blocked after
-- inviting them would learn that their invite still exists AND that something
-- about the organizer's relationship to them changed. Decision #2 requires that
-- a block never be revealed "by any gap, count or marker", and two different
-- error strings on one button are a marker. The caller folds `false` into its
-- own single raise.
--
-- **The GATE still raises, and the asymmetry is the point:** failing the gate
-- is a fact about the CALLER themselves, which they may be told; failing
-- readability is a fact about somebody else's ride and their relationship to
-- its organizer, which they may not.
create or replace function private.join_ride_from_invite(rider uuid, target_ride uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  -- The gate, restated. Not a convenience: it is the only thing standing
  -- between an account created by calling GoTrue's /auth/v1/signup directly and
  -- a `ride_members` row.
  if not exists (
    select 1 from public.profiles p
     where p.id = rider
       and p.onboarding_completed_at is not null
       and p.terms_accepted_at is not null
  ) then
    raise exception 'that rider has not completed onboarding'
      using errcode = 'check_violation';
  end if;

  -- The readability check, restated for the same reason: `security definer`
  -- runs this body with RLS bypassed (ownership, measured on Postgres 16 for
  -- `021` §3), so the `ride_members` INSERT policy's own `EXISTS (rides …)` —
  -- which would have asked this question under the rider's own row security —
  -- never gets to. This line is that check.
  if not private.can_read_ride(rider, target_ride) then
    return false;
  end if;

  -- `going`, because accept is an affirmative answer to a question; `maybe` is
  -- one tap away afterwards through the ordinary RSVP control, unchanged.
  --
  -- `on conflict do nothing` rather than an upsert: a rider who RSVPed before
  -- answering keeps the status and the `joined_at` they already had. Accepting
  -- must not silently rewrite an existing answer.
  insert into public.ride_members (ride_id, user_id, status)
  values (target_ride, rider, 'going')
  on conflict do nothing;

  return true;
end;
$$;

revoke all on function private.join_ride_from_invite(uuid, uuid) from public, anon, authenticated;

comment on function private.join_ride_from_invite(uuid, uuid) is
  'The single place an invite path writes a ride_members row (083). Restates the participation gate and the ride''s readability in its own body, because a security definer writer bypasses both the trigger and the INSERT policy that would otherwise carry them. Returns FALSE rather than raising on an unreadable ride, so the caller keeps ONE observable failure and a block is not disclosed by a second error string; the gate still raises, because that is a fact about the caller themselves. In `private`, so PostgREST cannot publish it and service_role cannot reach it. PD-330''s token-bearing claim becomes its second caller.';

-- ---------------------------------------------------------------------------
-- §5b. The two RPCs the invitee calls
-- ---------------------------------------------------------------------------
-- ** One raise site each, so "not yours", "no such invite", "already answered"
-- and "blocked by the organizer" are the same code path. ** `043`'s shape: a
-- caller learns nothing about an invite that is not theirs, including whether
-- it exists.
--
-- `declined` is in accept's WHERE and not in decline's: the invitee may reopen
-- their own refusal, and nobody else can. The anti-spam property the terminal
-- state exists for is entirely about the INVITER, and §4's DELETE policy is
-- what holds it — no organizer can clear or re-send a declined invite. A rider
-- cannot be spammed by their own button, and the alternative locks a rider out
-- of a private ride permanently on one mis-tap, since the invite is the only
-- arm that admits them.
create or replace function public.accept_ride_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid    uuid := (select auth.uid());
  v_ride   uuid;
  v_joined boolean := false;
begin
  -- ** THE STATEMENT ORDER IS LOAD-BEARING AND THE NATURAL ONE IS WRONG. **
  -- `join_ride_from_invite` asks `can_read_ride`, and the arm that answers yes
  -- is *this invite being live*. Validate-then-write — the shape a reviewer
  -- reaches for — makes the `declined -> accepted` reopen fail on exactly the
  -- ride the reopen exists for: a private, invite-only one, where `declined`
  -- grants no read and the readability check is therefore false a statement
  -- before the update would have made it true. The update goes first; the
  -- raise below is what unwinds it when the join is refused.
  update public.ride_invites i
     set status = 'accepted',
         responded_at = now()
   where i.id = invite
     and i.invitee_id = v_uid
     and i.status in ('pending', 'declined')
  returning i.ride_id into v_ride;

  if v_ride is not null then
    v_joined := private.join_ride_from_invite(v_uid, v_ride);
  end if;

  -- ONE raise site, covering "no such invite", "not addressed to you", "already
  -- accepted" and "the organizer has blocked you" with one indistinguishable
  -- answer. `043`'s shape, and decision #2's requirement that no gap, count or
  -- marker reveals a block — a second message here would be that marker.
  if not v_joined then
    raise exception 'no answerable invite with that id is addressed to the caller'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.decline_ride_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  update public.ride_invites i
     set status = 'declined',
         responded_at = now()
   where i.id = invite
     and i.invitee_id = v_uid
     and i.status = 'pending';

  if not found then
    raise exception 'no pending invite with that id is addressed to the caller'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.accept_ride_invite(uuid) from public, anon;
grant execute on function public.accept_ride_invite(uuid) to authenticated;
revoke all on function public.decline_ride_invite(uuid) from public, anon;
grant execute on function public.decline_ride_invite(uuid) to authenticated;

comment on function public.accept_ride_invite(uuid) is
  'The invitee accepts their own invite: sets status to accepted and writes the ride_members row through private.join_ride_from_invite. Takes an invite id and never a rider id — the subject is auth.uid(). One raise site, so a caller learns nothing about an invite that is not theirs. `declined` is answerable here and nowhere else: the invitee may reopen their own refusal, and no inviter can (083 §4''s DELETE policy).';

comment on function public.decline_ride_invite(uuid) is
  'The invitee declines their own PENDING invite. Terminal against the inviter — no DELETE reaches a declined row — and reopenable by the invitee through accept_ride_invite. Writes no ride_members row. One raise site, like accept.';

-- ===========================================================================
-- §6. Notifications — three new types, both CHECKs, three triggers
-- ===========================================================================
-- All three carry **`ride_id` alone**, the same subject shape as `ride_joined`,
-- so `036` §3's per-COLUMN resolvability conjuncts already cover them and the
-- SELECT policy needs no change at all.
--
-- ** Both CHECKs move together. ** `036`'s own comment says why the second is
-- load-bearing rather than tidy: a bare `case` with no `else` returns NULL for
-- an unmatched type and a CHECK passes on NULL, so a type added to the first
-- and forgotten in the second would silently admit a row with no subject.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined')
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
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- §6b. The fan-outs — and trap (c) applies even though nothing computes a SET
-- ---------------------------------------------------------------------------
-- `event-fanout-integrity`'s standing requirement is written for fan-outs that
-- compute a recipient SET. All three below address exactly one named rider read
-- out of `NEW`, so that wording has nothing to bite on — which invites the
-- conclusion that a caller-relative helper is safe here. **It is not.** The
-- resolvability check (`036` §7.5: never write a row the read policy can never
-- return) is a question about the RECIPIENT, and answering it with
-- `private.has_live_ride_invite` or `private.is_ride_crew` would compute the
-- ACTOR's answer and apply it to the recipient. Both take the subject-taking
-- form, `private.can_read_ride(<the recipient>, new.ride_id)`.
--
-- **No `when (current_user = …)` clause on any of the three** — trap (a), and
-- here it is stronger than usual: the only writers of `status` are `security
-- definer` RPCs, for which `current_user` is the OWNER, so such a clause would
-- disable §6d entirely and every answer notification would silently not happen.
--
-- **`auth.uid()` appears nowhere below** — trap (b). Both riders come from the
-- row, which is available in every context; `auth.uid()` is NULL in the RLS
-- suite, in psql and in a seed, and a guard written against it would filter out
-- every recipient exactly where it is asserted.

-- --- §6c  ride_invited ------------------------------------------------------
create or replace function private.notify_ride_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, ride_id)
  select new.invitee_id, new.inviter_id, 'ride_invited', new.ride_id
   where new.invitee_id <> new.inviter_id
     -- Blocking, applied the first of its two times. Symmetric, so one call
     -- covers both directions. The INSERT policy already refuses a blocked
     -- pair, so this is unreachable through the client today and is here for
     -- the writer the policy does not bind: a seed, a repair, an owner
     -- statement.
     and not private.is_blocked(new.invitee_id, new.inviter_id)
     -- Resolvability, candidate-relative. True by construction in an AFTER
     -- INSERT — the invite row exists in this transaction, so the new arm
     -- answers yes — which is exactly why it is worth writing: it is the
     -- self-consistency check that fails the day §3 and §3b drift apart.
     and private.can_read_ride(new.invitee_id, new.ride_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_ride_invited
  after insert on public.ride_invites
  for each row execute function private.notify_ride_invited();

-- --- §6d  the answers -------------------------------------------------------
-- One function for both directions rather than two, because the recipient, the
-- actor, the subject and all three guards are identical and only the type
-- string differs. `after update of status`, guarded again on the value actually
-- moving: the RPCs also write `responded_at`, and a future statement touching
-- another column must not fan out.
create or replace function private.notify_ride_invite_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is not distinct from new.status then
    return null;
  end if;
  if new.status not in ('accepted', 'declined') then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, ride_id)
  select new.inviter_id,
         new.invitee_id,
         case new.status
           when 'accepted' then 'ride_invite_accepted'
           else 'ride_invite_declined'
         end,
         new.ride_id
   where new.invitee_id <> new.inviter_id
     and not private.is_blocked(new.inviter_id, new.invitee_id)
     -- Trivially true while the inviter is the organizer, and not trivially
     -- true the day crew invites land. Written for that day.
     and private.can_read_ride(new.inviter_id, new.ride_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_ride_invite_answered
  after update of status on public.ride_invites
  for each row execute function private.notify_ride_invite_answered();

-- --- §6e  the retraction ----------------------------------------------------
-- A withdrawn invite retracts its own notification rather than leaving one for
-- an event that has been undone. `retract_postcard_liked`'s shape and its
-- scoping rule: matched on the FULL event key — recipient, type, actor and ride
-- — and never on a subset. Here the type is what keeps it off the ANSWER
-- notifications, which are addressed to the other rider and record a different
-- event; a delete scoped by `ride_id` and the pair alone would clear those too.
--
-- Reachable only for a `pending` invite through the client, because §4's DELETE
-- policy is scoped to that — but it also fires on a CASCADE, when the ride or
-- either rider goes, which is harmless and at worst redundant: the same
-- notification rows are removed by `notifications.ride_id`'s, `.user_id`'s and
-- `.actor_id`'s own cascades anyway.
create or replace function private.retract_ride_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.user_id = old.invitee_id
     and n.type = 'ride_invited'
     and n.actor_id = old.inviter_id
     and n.ride_id = old.ride_id;
  return null;
end;
$$;

create trigger retract_ride_invited
  after delete on public.ride_invites
  for each row execute function private.retract_ride_invited();

-- Reached only as triggers. `private` is already revoked from the client roles
-- (`005`) and adds no advisor either way; this is belt and braces, matching
-- every other fan-out in `036`.
revoke all on function private.notify_ride_invited() from public, anon, authenticated;
revoke all on function private.notify_ride_invite_answered() from public, anon, authenticated;
revoke all on function private.retract_ride_invited() from public, anon, authenticated;

-- ===========================================================================
-- §7. Verification — run against the project after applying
-- ===========================================================================
--   -- 3 — select, insert, delete. NO update row.
--   select cmd, count(*) from pg_policies where tablename = 'ride_invites'
--    group by cmd order by cmd;
--
--   -- f — the absence that makes the two RPCs the only writers of `status`
--   select has_table_privilege('authenticated', 'public.ride_invites', 'update');
--
--   -- t, t, t, t / f, f, f — the enumerated INSERT columns, and the three the
--   -- client may not name
--   select has_column_privilege('authenticated', 'public.ride_invites', 'id', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'ride_id', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'invitee_id', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'inviter_id', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'status', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'created_at', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'responded_at', 'INSERT');
--
--   -- 0 — anon reaches nothing
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'ride_invites' and grantee = 'anon';
--
--   -- f, t — the oracle is closed and the wrapper is open
--   select has_function_privilege('authenticated', 'private.has_live_ride_invite_for(uuid,uuid)', 'execute'),
--          has_function_privilege('authenticated', 'private.has_live_ride_invite(uuid)', 'execute');
--
--   -- t x5 — every new function is security definer
--   select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.proname in ('has_live_ride_invite','has_live_ride_invite_for',
--                        'join_ride_from_invite','accept_ride_invite','decline_ride_invite')
--    order by proname;
--
--   -- 3, all 'c' — the cascade window
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'public.ride_invites'::regclass and contype = 'f';
--
--   -- 14 — 081's thirteen plus ride_invites. Count it rather than read it off
--   -- a comment; a table added without one looks exactly like the list being
--   -- right.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- both CHECKs name eight types / eight shapes
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.notifications'::regclass and contype = 'c';
--
--   -- 17, from 15 — measured on DEV 2026-08-27. TWO new
--   -- authenticated_security_definer_function_executable WARNs, for
--   -- accept_ride_invite and decline_ride_invite, and NONE for the three
--   -- functions in `private`, which PostgREST does not publish. An eighteenth
--   -- means a revoke did not land, or something was created in `public` that
--   -- belongs in `private`.
--   --   mcp__Supabase__get_advisors <ref> security
