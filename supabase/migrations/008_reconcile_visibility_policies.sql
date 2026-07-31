-- Reconciles two migration chains that were written in parallel and never saw
-- each other.
--
-- 002 closed the anonymous dimension: every policy pinned to `authenticated`.
-- 004 closed the member-visibility dimension: private club rosters, club-only
-- rides, and joining clubs you cannot see. Each one recreates the same policies
-- the other does, so whichever ran second silently reverted the first.
--
-- The correct policy is the intersection: `to authenticated` from 002, the
-- visibility predicates from 004. That is what this migration establishes.
--
-- Scope is deliberately limited to the four tables 004 touched. `profiles` and
-- `friendships` belong to 002 and 003 — 003 redefines the profiles policy as
-- part of onboarding, and recreating it here would silently revert that when
-- the login epic lands.
--
-- Policies are dropped by lookup rather than by name because the two chains
-- named them differently, and which names exist depends on the order they were
-- applied in. On this project's database that order differs from the file
-- order, so dropping by name would leave a permissive policy behind — and
-- policies for the same command are OR'd, so one leftover undoes the rest.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('clubs', 'club_members', 'rides', 'ride_members')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------------

create policy "Clubs are viewable by members and signed-in riders"
  on clubs for select to authenticated
  using (
    is_public
    or owner_id = auth.uid()
    or private.is_club_member(id)
  );

create policy "Authenticated users can create clubs"
  on clubs for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Club owners can update"
  on clubs for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Club owners can delete"
  on clubs for delete to authenticated
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- club_members
-- ---------------------------------------------------------------------------

create policy "Club rosters follow club visibility"
  on club_members for select to authenticated
  using (
    private.is_club_member(club_id)
    or exists (
      select 1 from clubs c
      where c.id = club_members.club_id and c.is_public
    )
  );

-- The owner branch keeps club creation working: the owner inserts their own
-- membership row immediately after creating a club, including a private one.
create policy "Users can join public clubs"
  on club_members for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from clubs c
      where c.id = club_members.club_id
        and (c.is_public or c.owner_id = auth.uid())
    )
  );

create policy "Users can leave clubs"
  on club_members for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- rides
-- ---------------------------------------------------------------------------

create policy "Rides are viewable by the club, organizer and signed-in riders"
  on rides for select to authenticated
  using (
    is_public
    or organizer_id = auth.uid()
    or (club_id is not null and private.is_club_member(club_id))
  );

create policy "Authenticated users can create rides"
  on rides for insert to authenticated
  with check (auth.uid() = organizer_id);

create policy "Organizers can update rides"
  on rides for update to authenticated
  using (auth.uid() = organizer_id) with check (auth.uid() = organizer_id);

create policy "Organizers can delete rides"
  on rides for delete to authenticated
  using (auth.uid() = organizer_id);

-- ---------------------------------------------------------------------------
-- ride_members
-- ---------------------------------------------------------------------------

-- The subquery inherits the rides select policy above, so roster visibility
-- tracks ride visibility exactly rather than restating it.
create policy "Ride rosters follow ride visibility"
  on ride_members for select to authenticated
  using (exists (select 1 from rides r where r.id = ride_members.ride_id));

create policy "Users can join visible rides"
  on ride_members for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from rides r where r.id = ride_members.ride_id)
  );

create policy "Users can update their own ride status"
  on ride_members for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can leave rides"
  on ride_members for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- handle_new_user search_path
-- ---------------------------------------------------------------------------
-- 002 pins this to '' and schema-qualifies the function body, which is stricter
-- than the `public, pg_temp` that 005 set. Because the two chains applied in
-- different orders on different databases, whichever ran last won — so a fresh
-- database and this project's database ended up disagreeing. Pin it explicitly
-- here so both land on 002's stricter setting.
--
-- Only the setting is changed, not the body, so this stays compatible with 003
-- replacing the function as part of onboarding.
alter function public.handle_new_user() set search_path = '';
