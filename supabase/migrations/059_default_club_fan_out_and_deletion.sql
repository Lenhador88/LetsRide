-- 059. The three things `058` left open, found by review before it reached PROD.
--
-- All three are the same shape: a rule written when club membership was
-- something a rider opted into, meeting a club every rider is in.
--
--   §1  `036`'s OTHER club fan-out — the one `058` §4 did not touch. This is the
--       serious one, and it is worse than the defect `058` §4 exists to prevent.
--   §2  `058`'s exception block cannot see its own likeliest failure, because
--       that failure is not an exception.
--   §3  An ordinary rider could inherit the welcome club and delete it.
--
-- `058` is applied to DEV and NOT to PROD as of this file. It is not edited —
-- this repo never edits an applied migration — so PROD takes `058` then `059`,
-- in filename order, and must not take `058` alone: between the two, §1's
-- fan-out is open.

-- --- §1  A ride in the welcome club must not notify the whole app -----------
-- ** THE DEFECT `058` §4 REFUSED TO SHIP AGAINST ONE ACCOUNT, SHIPPED AGAINST
-- EVERY ACCOUNT. ** `036` §7.5 installs a second club fan-out, and `058` did not
-- consider it:
--
--   `rides` INSERT is `auth.uid() = organizer_id and (club_id is null or
--   private.is_club_member(club_id))`. After `058` every rider is a member of
--   the welcome club, so every rider may create a ride in it — and
--   `getMyClubs` feeds the Create-ride club dropdown, so it is an ordinary
--   option in the shipped UI rather than a crafted API call. One tap writes one
--   `notifications` row per rider in the app, synchronously, inside that
--   rider's own INSERT. Repeatable at will: create, delete, create.
--
-- `058` §4's fix does not generalise to it by accident. `notify_club_joined`
-- was silenced by looking up the club; this one reads `club_members` directly
-- and had no default-club arm at all. Hence a second, deliberate early return.
--
-- The consequence, stated rather than buried: nobody is told about a ride in
-- the welcome club. That is correct — the welcome club is a landing place, not
-- a club that organises rides — and the ride is still fully visible to every
-- member, which is everyone. If the welcome club should not host rides at all,
-- that is a policy and a dropdown, not a fan-out, and it is a separate change.
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
  select m.user_id, new.organizer_id, 'ride_created_in_club', new.id, new.club_id
    -- Index-served by club_members_pkey (club_id, user_id) — leading column.
    from public.club_members m
   where m.club_id = new.club_id
     -- By rider id, not by role: the organizer may hold any role.
     and m.user_id <> new.organizer_id
     and not private.is_blocked(new.organizer_id, m.user_id)
  on conflict do nothing;
  return null;
end;
$$;

comment on function private.notify_ride_created_in_club() is
  'Fan-out: a club ride notifies that club''s MEMBERS — deliberately NOT unioned with clubs.owner_id, unlike club_joined. rides SELECT''s only club arm is private.is_club_member, which has no owner arm, so a row written to an ownerless owner is one their own policy drops on every read, for ever. See 036 §7.5. Since 059 it returns early for the club carrying clubs.is_default: every rider is a member of that one, so this fan-out would be an app-wide broadcast that any rider could fire at will by creating a ride there.';

-- --- §2  The failure `058`'s exception block cannot see ---------------------
-- `058`'s header claims "the `raise warning` is what keeps that from being
-- silent". It does not, for the failure most likely to happen. If no club
-- carries the flag — `058` §5's guard finding zero or two matches, or the club
-- deleted later — the insert selects **zero rows**, which is a SUCCESS. No
-- exception is raised, the handler never runs, and nothing is ever logged. The
-- feature is off, permanently, for every rider, with no diagnostic anywhere.
--
-- That is exactly the silence `058` §5 warns about ("a `where` that matches
-- nothing looks exactly like a `where` that matched"), reproduced at run time
-- rather than at apply time.
--
-- The condition is `not found AND no club is flagged` rather than `not found`
-- alone, because `on conflict do nothing` also leaves `found` false for the
-- rider who already holds the row — the welcome club's own owner, most
-- obviously — and that case is correct and must stay quiet. A warning that
-- fires on a healthy database is one nobody reads.
--
-- Reproduced whole from `058`; every comment carried verbatim, because `prosrc`
-- is what the reconciliation in docs/reference/migrations.md compares.
create or replace function public.complete_onboarding(p_location text)
returns timestamptz
language plpgsql
volatile
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

  -- 003 §6a, same message and same errcode, because it is the same rule.
  -- The NULL arm is the one 018's CHECK cannot cover: `profiles_location_length`
  -- deliberately permits NULL, since every rider is NULL there between signup
  -- and step 2. The ceiling (100) is left to that CHECK, which measurement 3
  -- confirms still fires from inside a security definer function.
  if v_username is null
     or p_location is null
     or pg_catalog.length(pg_catalog.btrim(p_location)) < 1 then
    raise exception 'onboarding cannot be completed before username and location are set'
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
  update public.profiles p
     set location                = p_location,
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
      on conflict do nothing;

      -- 059: zero rows is a SUCCESS, so the handler below never runs for the
      -- likeliest failure of all — nothing carries the flag, and every rider
      -- silently joins nothing for ever. See the migration header. The second
      -- conjunct keeps this quiet for `on conflict do nothing`, which also
      -- leaves `found` false and is the correct, healthy case.
      if not found
         and not exists (select 1 from public.clubs c where c.is_default) then
        raise warning 'complete_onboarding: no club carries clubs.is_default, so % joined nothing',
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

comment on function public.complete_onboarding(text) is
  'Own-row RPC: stamps onboarding completion and writes location in one statement, because 025 revokes the client''s UPDATE grant on the stamp (021). Restates 023''s consent rule and 003''s completion invariants itself — inside a security definer function current_user is the owner, so both triggers short-circuit. Since 058 it also joins the caller to the club carrying clubs.is_default, on the transition into completion only, in an exception block that can never take the stamp down with it; 059 adds the warning for the case that block cannot see, where no club carries the flag and the insert succeeds against zero rows.';

-- --- §3  The welcome club is not an ordinary rider's to delete --------------
-- `029`'s `private.transfer_owned_clubs` hands a departing owner's clubs to
-- the longest-tenured remaining admin, else member. After `058` the welcome
-- club always has members, so it can never reach that function's "nobody left,
-- delete it" arm — it transfers, to whichever rider joined earliest.
--
-- That rider then satisfies `delete_owned_club`'s *entire* access check
-- (`c.owner_id = v_uid`), which has no `is_default` arm. One tap in the club
-- menu and auto-join is off for every future rider — silently, because §2's
-- warning fires per signup in the Postgres log and nowhere a human looks.
--
-- Two things were already held and are not re-fixed here: that rider cannot set
-- `is_default` on a club of their own (`058` §2's column grant) and cannot make
-- the welcome club private (`clubs_default_club_is_public` refuses that
-- direction too).
--
-- ** THE TRANSFER ITSELF IS LEFT AS IT IS, AND THAT IS A DECISION. ** `clubs.owner_id`
-- is NOT NULL with an `ON DELETE CASCADE` FK, so "do not transfer" is not
-- available — the alternatives are transfer, or destroy the club and every
-- postcard in it. Transfer is right. What it leaves is an ordinary rider
-- holding rename and imagery rights over the club everyone is in, reachable
-- only by the welcome club's owner deleting their own account. Recorded as a
-- known gap rather than closed.
--
-- 42501 rather than a new SQLSTATE: this function deliberately has ONE refusal
-- shape (`043` collapses "no such club" and "not your club" into it so a caller
-- learns nothing), and `deleteClub` maps every error to one message anyway.
-- Nothing is hidden by the choice here — the caller can read `is_default` — so
-- consistency is the only thing at stake and it wins.
--
-- The guard sits AFTER the ownership check so the order of refusals reads the
-- way the rules do: whether you own it, then whether it may go.
--
-- Reproduced whole from `043`; every comment carried verbatim.
create or replace function public.delete_owned_club(p_club_id uuid)
returns table (object_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid    uuid := (select auth.uid());
  v_avatar text;
  v_cover  text;
  v_default boolean;
begin
  if v_uid is null then
    raise exception 'delete_owned_club requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- The ownership test is the function's OWN job. `security definer` runs the
  -- body with RLS bypassed — measured on Postgres 16 for 021 §3, and it is
  -- ownership rather than superuser, so `force row level security` would be the
  -- only thing that changed it. There is no policy backstop behind this line:
  -- the `and c.owner_id = v_uid` below is the entire access control, and it is
  -- the line to read first in any future edit.
  --
  -- One SELECT and one raise site, so "no such club" and "not your club" are
  -- the same code path and cannot drift into two distinguishable answers. A
  -- caller learns nothing about a club they do not own, including whether it
  -- exists.
  select c.avatar_path, c.cover_image_path, c.is_default
    into v_avatar, v_cover, v_default
    from public.clubs c
   where c.id = p_club_id
     and c.owner_id = v_uid
     for update;

  if not found then
    raise exception 'no club with that id is owned by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- 059: see the migration header. Owning the welcome club is something an
  -- ordinary rider can INHERIT through 029's succession, and deleting it turns
  -- 058 off for every future rider with nothing red anywhere. Removing it is a
  -- deliberate act that needs a session with database access to unflag it
  -- first, which is the correct weight for "the club every rider is in".
  if v_default then
    raise exception 'the default club cannot be deleted while it carries clubs.is_default'
      using errcode = 'insufficient_privilege';
  end if;

  -- Surrendered whether or not the caller manages to delete the bytes, so they
  -- are returned before the row that holds them goes. Both sit under the
  -- OWNER's uid prefix (016's CHECKs pin them there), and the owner is the
  -- caller, so the caller's own Storage policy permits the delete.
  if v_avatar is not null then
    object_path := v_avatar;
    return next;
  end if;
  if v_cover is not null then
    object_path := v_cover;
    return next;
  end if;

  -- Only the rides `ON DELETE SET NULL` would turn into zombies — `032` §2's
  -- already-argued rule, reused rather than re-derived. A PUBLIC ride survives
  -- the club perfectly well: it stays public, stays readable by every signed-in
  -- rider, keeps its crew and simply stops belonging to a club. Deleting it
  -- would destroy another rider's content for no reason.
  --
  -- Note the predicate is the RIDE's own audience, not the club's: 022 lets a
  -- public club hold a private ride, and that ride is a zombie too.
  delete from public.rides r
   where r.club_id = p_club_id
     and r.is_public = false;

  delete from public.clubs c
   where c.id = p_club_id;

  return;
end;
$$;

comment on function public.delete_owned_club(uuid) is
  'Own-club deletion (043): security definer, re-checks owner_id = auth.uid() in its own body because RLS does not apply inside it, deletes the club''s is_public = false rides with the club so SET NULL cannot strand them, and returns the club''s Storage paths for the caller to remove. Since 059 it refuses the club carrying clubs.is_default with the same 42501 — that ownership is inheritable through 029''s succession, and deleting it would turn 058''s auto-join off for every future rider with nothing red anywhere.';

-- --- §4  Verification ------------------------------------------------------
-- Run against each project after applying. The first must be 0 for a database
-- where nothing has gone wrong; the second confirms the flag survived.
--
--   -- a ride in the default club that notified anybody
--   select count(*) from notifications n join clubs c on c.id = n.club_id
--    where n.type = 'ride_created_in_club' and c.is_default;
--
--   select id, name, is_public, is_default from clubs where is_default;
