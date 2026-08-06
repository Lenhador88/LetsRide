-- 032: make a half-finished deletion survivable, and stop over-deleting other
-- riders' rides.
--
-- Three corrections to `029`'s transfer function, all from review. None changes
-- a policy, a grant or a column; this is `create or replace` on one function.
--
-- ---------------------------------------------------------------------------
-- §1. The departing rider is DEMOTED, not removed — and this is the important one
-- ---------------------------------------------------------------------------
-- `029` deleted the departing rider's `club_members` row as it handed the club
-- over, on the reasoning that they are leaving anyway and the cascade would take
-- it moments later. **The "moments later" is not guaranteed, and that is the
-- defect.**
--
-- The transfer is a PostgREST RPC, so it commits when the HTTP call returns —
-- before the Edge Function's Storage sweep, and long before `deleteUser`. A
-- transient Storage 5xx between them leaves a rider who is: still signed in,
-- still holding an account, no longer the owner of clubs they founded, and **no
-- longer a member of them either**. They cannot rejoin a private one —
-- `club_members`' INSERT policy requires `c.is_public or c.owner_id = auth.uid()`
-- and neither now holds — so a retryable network error silently and permanently
-- ejects them from their own club.
--
-- Demoting instead costs nothing and removes that state: a failed run leaves
-- them an ordinary member, the retry finds nothing to transfer and proceeds, and
-- on success the cascade deletes the row exactly as before. The end state of a
-- *successful* deletion is byte-for-byte what `029` produced.
--
-- `019`'s WITH CHECK permits `role = 'member'` for anyone, so the demoted row is
-- a shape that policy already calls legitimate — the same argument `029` made
-- for promoting the successor to `owner`.
--
-- **The header claim this falsifies**, corrected in the Edge Function in the
-- same change: `delete-account/index.ts` said "If step 2 fails, the whole call
-- fails and nothing is deleted". The club transfer is already committed by then.
-- Design D7's "a failure before the auth delete leaves everything intact" and
-- D2's "inside the deletion, in one transaction" both describe an implementation
-- that cannot exist across an RPC boundary and an HTTP call. What is true, and
-- what is now written down, is that the transfer is idempotent and the retry
-- completes.
--
-- ---------------------------------------------------------------------------
-- §2. Only the rides that would become zombies are deleted
-- ---------------------------------------------------------------------------
-- `029` deleted **every** ride in a club it was about to delete. D3 argues for
-- exactly one thing: that `rides.club_id`'s `ON DELETE SET NULL` leaves a ride
-- with `club_id` NULL and `is_public` false, which `022` §4's SELECT policy
-- resolves to organizer-only while its `ride_members` rows survive — a roster
-- nobody can read. That argument covers private rides and no others.
--
-- A **public** ride in that club loses nothing to `SET NULL`: it stays public,
-- stays readable, keeps its crew, and simply stops belonging to a club. `029`
-- deleted it anyway, which is destroying another rider's content for no stated
-- reason. Narrowed to `is_public = false`.
--
-- Note this is not the same as "private club rides": `022` lets a PUBLIC club
-- hold a private ride, and that ride is a zombie too. The predicate is the ride's
-- own audience, which is what D3 actually reasoned about.
--
-- ---------------------------------------------------------------------------
-- §3. The `for update of p` comment was wrong, and the race is real
-- ---------------------------------------------------------------------------
-- `029` claimed the lock "stops this selecting someone who is themselves
-- mid-deletion: their cascade must take the same lock". **It does not.** The
-- lock lives as long as the RPC transaction, which ends before the Edge Function
-- does anything else. So:
--
--   1. Rider B's transfer RPC runs and commits — B owns nothing, returns nothing.
--   2. Rider A's transfer RPC selects B as successor for club C. Commits.
--   3. B's Edge Function reaches `deleteUser(B)`. C cascades away, and every
--      postcard every other member posted into C goes with it.
--
-- Which is the exact harm this function exists to prevent, reached through it.
--
-- **It is not fixed here, because it cannot be fixed in SQL.** The window is
-- open between two HTTP calls in two different processes; closing it needs
-- either a deletion-in-progress marker on `profiles` (a new column, a new
-- state, and a new way to be stuck if a run dies half way) or a serialising
-- advisory lock held across the whole Edge Function invocation. Both are real
-- options and both are bigger than a comment fix, so this migration states the
-- race precisely and leaves it open rather than leaving a false claim that it is
-- closed.
--
-- What the lock DOES do is still worth keeping, and was verified rather than
-- assumed: `explain` puts `LockRows` below `Limit`, and in a two-session test a
-- candidate deleted concurrently is skipped in favour of the next one rather
-- than being misread as "no successor". So within the transaction the selection
-- is sound.
--
-- Recorded as a known issue in `docs/HANDOFF.md`. It needs two riders deleting
-- their accounts within seconds of each other, in a club they share, and there
-- are four accounts on this project.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-06
-- ---------------------------------------------------------------------------
--   club rides (any club_id) ................................. 0
--   club_members rows ........................................ 3
--   clubs .................................................... 2
--   `Users can leave clubs` DELETE policy ..... `auth.uid() = user_id`, unqualified
--
-- That last one is §2's whole premise, and it is why `design.md`'s "there is no
-- content but their own, so the case is empty by construction" is false: a rider
-- joins a public club, posts, and leaves, and nothing removes what they posted.
-- `seed.sql`'s `...00e5` — captioned "Posted before I left" — is that exact row.

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
    select c.id, c.avatar_path, c.cover_image_path
      from public.clubs c
     where c.owner_id = departing
     order by c.id
     for update
  loop
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
    -- §3 above, which states that race rather than pretending it is closed.
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

      -- DEMOTED, not deleted — §1. This transaction commits before the rest of
      -- the deletion runs, so the row has to survive a failure in between.
      update public.club_members
         set role = 'member'
       where club_id = club.id
         and user_id = departing;
    else
      -- No member remains, so the club goes — 009's original case.
      --
      -- Only the rides that `SET NULL` would turn into zombies. A public ride
      -- survives the club perfectly well; deleting it destroys another rider's
      -- content for no reason D3 ever gave. §2.
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
  'Hand every club this rider owns to its longest-tenured remaining admin, else its longest-tenured remaining member, else delete it (029, corrected by 032). Returns the Storage object paths it surrendered so the caller can delete the bytes. The departing rider is DEMOTED to member rather than removed, because this commits before the rest of the deletion and a failure in between must not eject them from a private club they can no longer rejoin. When the club is deleted, only its PRIVATE rides go — a public ride survives ON DELETE SET NULL intact, and D3''s zombie argument never covered it. security definer; in `private` so PostgREST never publishes it, reached only through 031''s service_role-only wrapper.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- The grants 029 and 031 established are unchanged by a `create or replace`.
-- Expect f, f, t:
--
--   select has_function_privilege('authenticated', 'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('anon',          'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('service_role',  'private.transfer_owned_clubs(uuid)', 'execute');
--
-- Still no advisor: it is in `private` and `authenticated` cannot execute it.
-- Expect the count to stay at eight.
