-- 058. Every rider joins the welcome club the moment they finish onboarding.
--
-- The Clubs tab is the emptiest screen a new rider sees: "Your clubs" reads as
-- broken rather than empty, because a tab with nothing in it and a tab that
-- failed to load are the same picture. One club they are already in fixes that
-- with no rider action at all.
--
-- ** THE CLUB IS NAMED BY A FLAG, NEVER BY AN ID OR A NAME. ** The welcome club
-- is different data on every project — `Welcome club` on PROD
-- (23d62dc7-4370-4b0b-b0fe-e83e7015ac7b), `Welcome club (dev)` on DEV
-- (7458ae47-f874-4922-a97f-e16b16529da2), and nothing at all on the scratch
-- database the RLS suite builds. A migration naming either id is correct on
-- exactly one project and a silent no-op on the other, and `npm run db:drift`
-- compares migration *names* — it would never see it. So the id lives in a
-- column, §5 sets it per project, and §6's verification query is how a session
-- checks it landed rather than trusting this comment.
--
-- ** IT FAILS SAFE IN BOTH DIRECTIONS, AND THAT IS THE WHOLE RISK MODEL. **
-- The join runs inside `complete_onboarding()`'s transaction, so an error there
-- would roll back the completion stamp and strand the rider in a wizard they
-- cannot leave — decision #5 means the route guard sends them straight back
-- into it, for ever, with no affordance to skip. A welcome club is not worth
-- that trade at any probability, so §3 wraps the insert in an exception block:
-- no default club, a deleted default club, a participation gate that refuses,
-- anything at all — onboarding completes and the rider is simply not in a club.
-- The `raise warning` is what keeps that from being silent; it lands in the
-- Postgres logs where `query_logs` can find it.
--
-- What this migration does NOT do: it does not backfill the riders who
-- onboarded before it. §3 fires on the transition into completion and nowhere
-- else, so the five existing PROD profiles keep whatever membership they
-- already chose. Backfilling is a decision about other people's memberships and
-- was deliberately not taken (option C, declined).

-- --- §1  The flag ----------------------------------------------------------
-- `not null default false` rather than a nullable boolean: "is this the default
-- club" is answerable for every club, and a three-valued version would make
-- `where is_default` in §3 silently drop the NULL rows rather than the false
-- ones, which reads identically and is not the same statement.
alter table public.clubs
  add column is_default boolean not null default false;

comment on column public.clubs.is_default is
  'The welcome club every rider joins on completing onboarding (058). At most one row may carry it (clubs_one_default_club), it must be public (clubs_default_club_is_public), and `authenticated` holds SELECT on it and NEITHER write verb — a rider who could set this on their own club would have every future signup join it. Read by complete_onboarding() and by private.notify_club_joined(), which skips its fan-out entirely for this club.';

-- At most one, enforced rather than assumed. §3 reads the flag with a bare
-- `where is_default` and would otherwise join a rider to every club carrying
-- it — a partial unique index over the true rows is the cheapest way to make
-- "the default club" a singular noun in the schema and not just in the prose.
create unique index clubs_one_default_club
  on public.clubs (is_default)
  where is_default;

-- A private default club would work — §3's insert runs as the function owner
-- and RLS does not apply to it — and would be wrong: every rider would hold a
-- membership of a club that does not appear on Explore, cannot be found, and
-- whose roster is the entire user base. The CHECK also refuses the other
-- direction, so the default club cannot later be made private out from under
-- the riders already in it.
alter table public.clubs
  add constraint clubs_default_club_is_public
  check (not is_default or is_public);

-- --- §2  The grant posture -------------------------------------------------
-- `045` converted `clubs` to per-column INSERT/UPDATE, so a column added today
-- arrives with neither verb granted and this revoke is a no-op against a
-- correct database. It is written anyway, as a tripwire: it is a *delta* rather
-- than one of the absolute `revoke`-then-`grant` lists `044` and `046` issue,
-- so it cannot reinstate anything, and if a later migration ever re-grants
-- `clubs` at table level this line is the one that has to be deleted on purpose
-- rather than forgotten.
revoke insert (is_default), update (is_default) on public.clubs from anon, authenticated;

-- SELECT is granted, and the asymmetry with the two write verbs is the point.
-- The column says which club is the welcome club; every rider is in it, so it
-- discloses nothing they cannot already see from their own membership. Reading
-- it is also what lets a screen later treat that club differently. Withholding
-- SELECT on one column while granting it on all eight siblings is how the next
-- `select('*')` earns a 42501 — `src/lib/data/columns.ts` carries that lesson
-- from `021` already.
grant select (is_default) on public.clubs to authenticated;

-- --- §3  complete_onboarding() joins it ------------------------------------
-- Reproduced whole from `033`, plus `v_was_complete` and the block at the end.
-- Every existing comment is carried verbatim: `prosrc` is what the migration
-- reconciliation in docs/reference/migrations.md compares, so a body that drops
-- its comments reads as drift for ever after.
--
-- ** THIS RPC RATHER THAN A TRIGGER ON `profiles`, AND THE SUITE IS THE
-- REASON. ** An `after update` trigger keyed on the stamp going non-NULL would
-- be the more general hook — it would catch a second completion path if one
-- were ever added. There is no second path (`025` revoked the client's UPDATE
-- grant on the stamp, so this function is the entire surface), and a trigger
-- would also fire for the table owner: `supabase/tests/seed.sql` finishes its
-- riders off with a direct UPDATE, so every fixture profile in the suite would
-- join the default club and shift counts in assertions that have nothing to do
-- with this migration. The narrower hook is the one that does not move
-- unrelated tests.
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
  -- has no such `when` clause (036 §7.8, deliberately), which is why §4 is a
  -- change to the function body and not to the trigger.
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
  'Own-row RPC: stamps onboarding completion and writes location in one statement, because 025 revokes the client''s UPDATE grant on the stamp (021). Restates 023''s consent rule and 003''s completion invariants itself — inside a security definer function current_user is the owner, so both triggers short-circuit. Since 058 it also joins the caller to the club carrying clubs.is_default, on the transition into completion only, in an exception block that can never take the stamp down with it.';

-- --- §4  notify_club_joined() skips the default club -----------------------
-- ** WITHOUT THIS, 058 IS A NOTIFICATION DENIAL-OF-SERVICE ON ONE ACCOUNT. **
-- `036` §7.6's fan-out notifies a club's owner and its admins on every join.
-- Auto-joining every rider means the welcome club's owner receives one
-- `club_joined` row per signup, for ever — their notification list is unusable
-- at the fiftieth rider and their unread count is the user count. That is not a
-- follow-up to file; it is the same change.
--
-- The skip is on the CLUB, not on the auto-join, so a rider who leaves the
-- welcome club and re-joins it by hand also notifies nobody. Distinguishing the
-- two would need a session flag threaded from §3 into the trigger, and the
-- distinction is not worth the machinery: the owner does not want to be told
-- about the welcome club's roster by either route.
--
-- An early return rather than a conjunct on the recipient set, so the lookup
-- happens once per join instead of once per candidate row.
create or replace function private.notify_club_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 058: see the migration header. Every rider joins the default club at
  -- onboarding, so a fan-out here addresses one account with the entire signup
  -- stream.
  if exists (select 1 from public.clubs c
              where c.id = new.club_id
                and c.is_default) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, club_id)
  select candidates.recipient, new.user_id, 'club_joined', new.club_id
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
  on conflict do nothing;
  return null;
end;
$$;

comment on function private.notify_club_joined() is
  'Fan-out: a join notifies the club''s owner and its admins (036), EXCEPT for the club carrying clubs.is_default, which notifies nobody at all (058) — every rider joins that one on completing onboarding, so a fan-out would address its owner with the entire signup stream. The owner union IS safe here because clubs SELECT carries an owner_id = auth.uid() arm — the asymmetry with ride_created_in_club is about the subject''s policy, not the club. Exclusion of the actor happens AFTER the union, or every club creation notifies its own creator.';

-- --- §5  Flag the club that already exists ---------------------------------
-- Keyed on the name because it is the only thing the two projects share — the
-- ids differ and the names differ only by DEV's suffix. Guarded to an exact
-- single match: flagging the wrong club would put every rider in it, and a
-- second club named `Welcome club anything` is a thing a rider can create.
--
-- A no-op on the RLS suite's scratch database, which has no such club and needs
-- none: §3's fail-safe path is itself under test there.
--
-- Both branches raise a notice, because the failure this guard produces is
-- silence — a `where` that matches nothing looks exactly like a `where` that
-- matched. §6 is how a session confirms which happened.
do $$
declare
  v_id   uuid;
  v_rows int;
begin
  if exists (select 1 from public.clubs where is_default) then
    raise notice '058: a default club is already flagged; leaving it alone';
    return;
  end if;

  -- Counted and fetched separately rather than `count(*), min(id)`: there is no
  -- `min(uuid)` before Postgres 18, so the compact version parses fine, applies
  -- on nothing this project runs, and fails at the point of no return. CI is
  -- postgres:17 and both hosted projects are 17 — measured by it failing here.
  select count(*) into v_rows
    from public.clubs
   where name ilike 'welcome club%';

  if v_rows = 1 then
    select id into v_id from public.clubs where name ilike 'welcome club%';
    update public.clubs set is_default = true where id = v_id;
    raise notice '058: flagged % as the default club', v_id;
  else
    raise notice '058: found % clubs matching ''welcome club%%'' — flagging none. Set clubs.is_default by hand and see §6.', v_rows;
  end if;
end
$$;

-- --- §6  Verification ------------------------------------------------------
-- Run this against each project after applying. Zero rows is the failure mode
-- §5 warns about, and it is the quiet one: onboarding still works, riders just
-- join nothing.
--
--   select id, name, is_public, is_default from public.clubs where is_default;
--
-- And the grant posture, which is the security half — INSERT and UPDATE must
-- return no rows for this column:
--
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'clubs'
--      and column_name = 'is_default' and grantee in ('anon', 'authenticated');
