-- PostgREST publishes every function in `public` as an RPC endpoint, so the
-- membership helper was reachable at /rest/v1/rpc/is_club_member. It only ever
-- reports on the calling user, so nothing leaked, but a security definer
-- function does not belong in the exposed API surface. Schemas outside the
-- PostgREST search path are not published.
create schema if not exists private;

create or replace function private.is_club_member(target_club_id uuid)
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

-- RLS expressions are evaluated as the querying role, so that role needs
-- execute on the helper. Everyone else is cut off.
revoke all on function private.is_club_member(uuid) from public;
grant execute on function private.is_club_member(uuid) to authenticated;

-- Repoint the policies before dropping the old function, which they depend on.
drop policy "Clubs are viewable by the public and their members" on clubs;

create policy "Clubs are viewable by the public and their members" on clubs for select
  using (
    is_public
    or owner_id = auth.uid()
    or private.is_club_member(id)
  );

drop policy "Club rosters are viewable by the public and club members" on club_members;

create policy "Club rosters are viewable by the public and club members" on club_members for select
  using (
    private.is_club_member(club_id)
    or exists (
      select 1 from clubs c
      where c.id = club_members.club_id and c.is_public
    )
  );

drop policy "Rides are viewable by the public, organizer and club" on rides;

create policy "Rides are viewable by the public, organizer and club" on rides for select
  using (
    is_public
    or organizer_id = auth.uid()
    or (club_id is not null and private.is_club_member(club_id))
  );

drop function public.is_club_member(uuid);

-- handle_new_user runs as its owner on every signup with a mutable search_path,
-- which lets a schema earlier in that path shadow the objects it references.
alter function public.handle_new_user() set search_path = public, pg_temp;

-- It is a trigger function; the trigger fires it regardless of who is signing
-- up, so no role needs to call it directly over the API.
revoke all on function public.handle_new_user() from public;
