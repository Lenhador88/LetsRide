-- Membership lookups run from inside the club_members/clubs policies themselves,
-- so they must bypass RLS or Postgres reports infinite recursion. security definer
-- is safe here because the function only ever reports on the *calling* user.
create or replace function is_club_member(target_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
  );
$$;

-- Clubs: members of a private club could not see the club itself, only its roster.
drop policy if exists "Public clubs are viewable by everyone" on clubs;

create policy "Clubs are viewable by the public and their members" on clubs for select
  using (
    is_public
    or owner_id = auth.uid()
    or is_club_member(id)
  );

-- Club members: rosters of private clubs were world-readable.
drop policy if exists "Club members are viewable by everyone" on club_members;

create policy "Club rosters are viewable by the public and club members" on club_members for select
  using (
    is_club_member(club_id)
    or exists (
      select 1 from clubs c
      where c.id = club_members.club_id and c.is_public
    )
  );

-- Club members: any authenticated user could insert themselves into any club,
-- including private clubs they cannot see. The owner_id branch keeps the club
-- creation flow working, where the owner adds their own membership row.
drop policy if exists "Users can join clubs" on club_members;

create policy "Users can join public clubs" on club_members for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from clubs c
      where c.id = club_members.club_id
        and (c.is_public or c.owner_id = auth.uid())
    )
  );

-- Rides: a club ride with is_public = false was visible only to its organizer,
-- so the club it was created for could not see it.
drop policy if exists "Public rides are viewable by everyone" on rides;

create policy "Rides are viewable by the public, organizer and club" on rides for select
  using (
    is_public
    or organizer_id = auth.uid()
    or (club_id is not null and is_club_member(club_id))
  );

-- Ride members: attendee lists of non-public rides were world-readable. The
-- subquery inherits the rides select policy above, so roster visibility now
-- tracks ride visibility exactly.
drop policy if exists "Ride members are viewable by everyone" on ride_members;

create policy "Ride rosters follow ride visibility" on ride_members for select
  using (
    exists (select 1 from rides r where r.id = ride_members.ride_id)
  );

drop policy if exists "Users can join rides" on ride_members;

create policy "Users can join visible rides" on ride_members for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from rides r where r.id = ride_members.ride_id)
  );
