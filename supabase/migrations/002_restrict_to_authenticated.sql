-- 002: Remove all anonymous access
--
-- Architectural decision #1: there is no anonymous access to LetsRide. Every
-- route outside /auth/* requires a session, and is_public = true means
-- "visible to any signed-in rider", never "visible to the internet".
--
-- 001 did not honour that. None of its 22 policies specify a `to` clause, so
-- every one of them defaults to the PUBLIC role, which includes `anon`. The
-- anon key ships in the client bundle, so anyone who views source could read:
--
--   profiles       every row     -- using (true)
--   club_members   every row     -- using (true)
--   ride_members   every row     -- using (true)
--   clubs          public rows   -- auth.uid() is NULL for anon, so the
--   rides          public rows   -- predicate collapses to is_public = true
--
-- friendships and all write policies were safe only incidentally, because
-- `auth.uid() = x` evaluates to NULL (not true) for an anonymous request.
-- Incidental safety is not safety, so they are pinned to `authenticated` too.
--
-- Two layers here, deliberately. The REVOKE removes anon's table privileges
-- outright, so a future permissive policy still cannot leak. The `to
-- authenticated` clauses make the intent explicit and self-documenting.

-- ---------------------------------------------------------------------------
-- Layer 1: strip anon's privileges entirely
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on routines from anon;

-- ---------------------------------------------------------------------------
-- Layer 2: pin every policy to the authenticated role
-- ---------------------------------------------------------------------------

-- profiles
drop policy if exists "Profiles are viewable by everyone" on profiles;
drop policy if exists "Users can insert their own profile" on profiles;
drop policy if exists "Users can update their own profile" on profiles;

create policy "Profiles are viewable by signed-in riders"
  on profiles for select to authenticated using (true);
create policy "Users can insert their own profile"
  on profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users can update their own profile"
  on profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- clubs
drop policy if exists "Public clubs are viewable by everyone" on clubs;
drop policy if exists "Authenticated users can create clubs" on clubs;
drop policy if exists "Club owners can update" on clubs;
drop policy if exists "Club owners can delete" on clubs;

create policy "Public clubs are viewable by signed-in riders"
  on clubs for select to authenticated
  using (is_public = true or owner_id = auth.uid());
create policy "Authenticated users can create clubs"
  on clubs for insert to authenticated with check (auth.uid() = owner_id);
create policy "Club owners can update"
  on clubs for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Club owners can delete"
  on clubs for delete to authenticated using (auth.uid() = owner_id);

-- club_members
drop policy if exists "Club members are viewable by everyone" on club_members;
drop policy if exists "Users can join clubs" on club_members;
drop policy if exists "Users can leave clubs" on club_members;

create policy "Club members are viewable by signed-in riders"
  on club_members for select to authenticated using (true);
create policy "Users can join clubs"
  on club_members for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can leave clubs"
  on club_members for delete to authenticated using (auth.uid() = user_id);

-- rides
drop policy if exists "Public rides are viewable by everyone" on rides;
drop policy if exists "Authenticated users can create rides" on rides;
drop policy if exists "Organizers can update rides" on rides;
drop policy if exists "Organizers can delete rides" on rides;

create policy "Public rides are viewable by signed-in riders"
  on rides for select to authenticated
  using (is_public = true or organizer_id = auth.uid());
create policy "Authenticated users can create rides"
  on rides for insert to authenticated with check (auth.uid() = organizer_id);
create policy "Organizers can update rides"
  on rides for update to authenticated
  using (auth.uid() = organizer_id) with check (auth.uid() = organizer_id);
create policy "Organizers can delete rides"
  on rides for delete to authenticated using (auth.uid() = organizer_id);

-- ride_members
drop policy if exists "Ride members are viewable by everyone" on ride_members;
drop policy if exists "Users can join rides" on ride_members;
drop policy if exists "Users can update their ride status" on ride_members;
drop policy if exists "Users can leave rides" on ride_members;

create policy "Ride members are viewable by signed-in riders"
  on ride_members for select to authenticated using (true);
create policy "Users can join rides"
  on ride_members for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their ride status"
  on ride_members for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can leave rides"
  on ride_members for delete to authenticated using (auth.uid() = user_id);

-- friendships
drop policy if exists "Users can view their own friendships" on friendships;
drop policy if exists "Users can send friend requests" on friendships;
drop policy if exists "Addressees can accept requests" on friendships;
drop policy if exists "Users can remove friendships" on friendships;

create policy "Users can view their own friendships"
  on friendships for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "Users can send friend requests"
  on friendships for insert to authenticated
  with check (auth.uid() = requester_id);
create policy "Addressees can accept requests"
  on friendships for update to authenticated
  using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);
create policy "Users can remove friendships"
  on friendships for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ---------------------------------------------------------------------------
-- Layer 3: pin the trigger's search_path
-- ---------------------------------------------------------------------------
-- handle_new_user() is security definer, so it runs with the owner's rights.
-- Without a fixed search_path a caller can shadow `profiles` with their own
-- table and have it written as the owner. Names are schema-qualified so an
-- empty search_path resolves correctly.
--
-- The email-local-part fallback for `username` is a separate live bug
-- (dave@gmail.com and dave@yahoo.com both yield "dave", and the second signup
-- fails on the unique constraint). It is fixed in the login epic, where
-- username moves into onboarding. Not changed here to keep this migration
-- purely a security fix.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verification (run manually against the restored project)
-- ---------------------------------------------------------------------------
-- Expect zero rows — no policy may target anon or PUBLIC:
--
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and not (roles = '{authenticated}');
--
-- Expect zero rows — anon must hold no table privileges:
--
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
