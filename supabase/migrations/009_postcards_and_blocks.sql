-- 009: Postcards, likes, and the block list
--
-- Postcards are the home screen: a photo feed, optionally scoped to a club.
-- Blocks ship in the SAME migration on purpose, and the reason is architectural
-- decision #2 rather than convenience.
--
-- Blocking is enforced in RLS, not in the UI, and a blocked rider has to vanish
-- from feeds, search, member lists and ride crews *simultaneously*. If the feed
-- lands first and the block predicate is retrofitted afterwards, there is a
-- window in which "blocked" means "hidden on the screens someone remembered" —
-- which is the exact failure mode this project has already had once with
-- private club rosters. So the helper lands with the feed, and it is applied in
-- this same migration to every table that already existed.
--
-- Comments and shares are deliberately NOT created here. The first UI slice is
-- view + like; an unused table with untested policies is drift. private.is_blocked
-- takes an explicit pair of uuids rather than reading auth.uid() internally, so
-- a future postcard_comments table adopts it unchanged.
--
-- Scope note: this migration owns the *rows*. The Supabase Storage bucket that
-- postcards.image_path points into, and its own RLS on storage.objects, belong
-- to the `media` agent and are NOT created here. Until that lands the feed has
-- rows it cannot render.
--
-- Settled decisions carried in here:
--   #1 no anonymous access        -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS -> one security definer helper, applied widely
--   #7 username is the display name -> nothing here stores a name

-- ---------------------------------------------------------------------------
-- 1. blocks
-- ---------------------------------------------------------------------------
-- The row is DIRECTIONAL (who pressed the button) and the effect is SYMMETRIC
-- (neither sees the other). Storing it directionally is what makes unblocking
-- meaningful: if A blocks B and B blocks A, that is two rows, and A lifting
-- theirs must not lift B's.
--
-- Composite PK on (blocker_id, blocked_id), matching the ride_members /
-- club_members convention. It also does double duty as the idempotency
-- mechanism: a caller writing `on conflict do nothing` can press Block twice
-- without an error, and without a second row to clean up.

create table public.blocks (
  blocker_id uuid references public.profiles(id) on delete cascade not null,
  blocked_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self_block check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

comment on table public.blocks is
  'Directional rows, symmetric effect. Read through private.is_blocked(a, b), never by querying this table from a policy — the helper is security definer and this table is not readable by the blocked party.';

-- The PK indexes (blocker_id, blocked_id). is_blocked() also probes the
-- reverse direction on every row it filters, so that direction needs its own
-- index or the block predicate degrades into a seq scan per row.
create index blocks_blocked_id_idx on public.blocks (blocked_id, blocker_id);

-- Policies.
--
-- SELECT is deliberately one-sided: you see the blocks YOU created, never the
-- ones created against you. Being blocked must not be disclosed — a rider who
-- can enumerate who blocked them has been handed a harassment target list, and
-- the whole point of the feature is that the other party simply goes quiet.
-- This is also why no policy here calls is_blocked(): the helper is security
-- definer precisely so the enforcement can read rows the querying rider cannot.
--
-- There is no UPDATE policy and no UPDATE grant. A block row has no mutable
-- column; unblock is a DELETE.

create policy "Riders see only the blocks they created"
  on public.blocks for select to authenticated
  using (auth.uid() = blocker_id);

-- No visibility requirement on the target. A rider must be able to block
-- someone who has already blocked them (at which point the other party is
-- invisible to them), and someone reached by a shared link.
create policy "Riders can block on their own behalf only"
  on public.blocks for insert to authenticated
  with check (auth.uid() = blocker_id);

create policy "Riders can unblock only their own block"
  on public.blocks for delete to authenticated
  using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- 2. private.is_blocked — the one helper
-- ---------------------------------------------------------------------------
-- Symmetry is resolved HERE, once, not at each call site. Every policy below
-- writes `not private.is_blocked(auth.uid(), <the other rider>)` and does not
-- need to know that the row could point either way. Getting this wrong at a
-- call site is a one-directional block, which is worse than no block: the
-- rider who pressed the button still sees the person they blocked.
--
-- security definer for two independent reasons:
--   a) the blocked party cannot read the blocks row (see the select policy
--      above), so an invoker-rights lookup would report "not blocked" for
--      exactly one of the two directions;
--   b) it is called from inside policies on tables that blocks references,
--      and bypassing RLS keeps that from recursing.
--
-- It lives in `private` because PostgREST publishes every function in `public`
-- as an RPC endpoint, and a security definer function does not belong on the
-- exposed API surface. Schemas outside the PostgREST search path are not
-- published, and `authenticated` holds no USAGE on `private`, so a direct call
-- is refused with 42501 while an RLS policy expression still resolves it.
-- Same shape as private.is_club_member from 005.
--
-- search_path is pinned to '' (stricter than 005's `public`) with the table
-- schema-qualified, matching what 002/008 settled on for handle_new_user.

create or replace function private.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function private.is_blocked(uuid, uuid) from public;
grant execute on function private.is_blocked(uuid, uuid) to authenticated;

comment on function private.is_blocked(uuid, uuid) is
  'True when either rider has blocked the other. Symmetric by construction — call sites must not re-check the reverse direction.';

-- ---------------------------------------------------------------------------
-- 3. postcards
-- ---------------------------------------------------------------------------
-- image_path is a Supabase Storage OBJECT PATH, not a URL. Storing a URL bakes
-- in the project ref and the public/signed distinction, and makes moving a
-- bucket a data migration. The check constraint enforces it rather than
-- trusting a comment — RLS enforces authorization, never validity, so shape
-- rules that the client must not own live in constraints.
--
-- There is deliberately NO is_public column. A postcard's audience is fully
-- determined by club_id: NULL means the app-wide feed (every signed-in rider,
-- per decision #1 — never the internet), and a club_id means that club's
-- members. Adding a flag would create a fourth combination (club-scoped AND
-- public) that nothing has defined, and an undefined visibility combination is
-- how this project's access-control bugs start.
--
-- club_id is ON DELETE CASCADE, unlike rides.club_id which is ON DELETE SET
-- NULL. The difference is not an inconsistency: a ride carries its own
-- is_public flag, so a club-only ride that loses its club falls back to
-- organizer-only. A postcard has no such flag, so SET NULL would silently
-- promote a private club's photos to the app-wide feed the moment the club is
-- deleted. Cascade loses the rows; set null leaks them. Losing them is the
-- correct failure.

create table public.postcards (
  id uuid default uuid_generate_v4() primary key,
  author_id uuid references public.profiles(id) on delete cascade not null,
  club_id uuid references public.clubs(id) on delete cascade,
  image_path text not null,
  caption text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint postcards_image_path_is_a_storage_path check (
    length(image_path) between 1 and 512
    and image_path !~ '://'
    and image_path !~ '^/'
  ),
  constraint postcards_caption_length check (
    caption is null or length(caption) <= 2000
  )
);

alter table public.postcards enable row level security;

comment on column public.postcards.club_id is
  'NULL = the app-wide feed (any signed-in rider). Set = visible to that club''s members only. There is no is_public flag; this column IS the audience.';
comment on column public.postcards.image_path is
  'Supabase Storage object path, e.g. postcards/<uid>/<uuid>.jpg. Never a URL — the constraint rejects one.';

-- Feed reads are "newest first", either globally or within one club.
create index postcards_created_at_idx on public.postcards (created_at desc);
create index postcards_author_id_idx on public.postcards (author_id, created_at desc);
create index postcards_club_id_idx on public.postcards (club_id, created_at desc)
  where club_id is not null;

-- The author branch comes FIRST and is unconditional, so a rider can always
-- reach their own postcards — including ones posted to a club they have since
-- left, which they would otherwise lose access to without ever being told.
create policy "Postcards are viewable by their audience"
  on public.postcards for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not private.is_blocked(auth.uid(), author_id)
      and (
        club_id is null
        or private.is_club_member(club_id)
      )
    )
  );

-- Two independent rules: you author as yourself, and you cannot post into a
-- club you are not a member of. The second one matters even though the feed UI
-- only offers clubs you belong to — the client is not a trust boundary and a
-- hand-rolled PostgREST call would otherwise inject a photo into any private
-- club whose id it could guess.
create policy "Riders can post as themselves, into their own clubs"
  on public.postcards for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      club_id is null
      or private.is_club_member(club_id)
    )
  );

-- USING pins who may edit; WITH CHECK pins what the row may become, so a
-- postcard cannot be reassigned to another author or moved into a club the
-- author does not belong to.
--
-- Side effect, accepted and asserted rather than hidden: an author who has left
-- a club can still SEE and DELETE their postcard in it (both branches are
-- author-only) but can no longer EDIT it, because the WITH CHECK re-tests
-- membership against the row's existing club_id. A policy cannot reference the
-- old row, so the only way to permit that edit is to drop the club test — which
-- would let any rider move a photo into any private club whose id they can
-- guess. Losing caption edits in a club you left is the cheaper failure, and
-- delete remains available.
create policy "Authors can edit their own postcards"
  on public.postcards for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (
      club_id is null
      or private.is_club_member(club_id)
    )
  );

create policy "Authors can delete their own postcards"
  on public.postcards for delete to authenticated
  using (author_id = auth.uid());

-- updated_at is only trustworthy if the client cannot write it. Not security
-- definer: it needs no privileges the caller lacks, and enforce_onboarding_
-- completion() from 003 sets the precedent for an invoker-rights trigger
-- function in `public`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- It is a trigger function; nothing needs to call it over the API.
revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger postcards_set_updated_at
  before update on public.postcards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. postcard_likes
-- ---------------------------------------------------------------------------
-- (postcard_id, user_id) composite PK, matching ride_members / club_members.
--
-- There is deliberately no denormalised like_count on postcards. A count column
-- would have to be a single number, and the correct count is per-viewer: a
-- blocked rider's like must not be visible to, or counted for, the rider who
-- blocked them. Counting the rows under RLS gives that for free and cannot
-- drift from the rows it summarises.

create table public.postcard_likes (
  postcard_id uuid references public.postcards(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  primary key (postcard_id, user_id)
);

alter table public.postcard_likes enable row level security;

-- The PK covers "who liked this postcard". This covers "what has this rider
-- liked", which the profile screen needs.
create index postcard_likes_user_id_idx on public.postcard_likes (user_id, created_at desc);

-- The EXISTS subquery is evaluated under the querying rider's own RLS, so like
-- visibility tracks postcard visibility exactly rather than restating it — the
-- same trick 008 uses for ride rosters. Restating it would be two predicates
-- that have to be kept in step, and the one that drifts is the one nobody reads.
--
-- The block clause is separate and about the LIKER, not the postcard: on a
-- postcard you can both see, a rider you blocked must not appear in the likes.
create policy "Likes follow postcard visibility"
  on public.postcard_likes for select to authenticated
  using (
    exists (select 1 from public.postcards p where p.id = postcard_likes.postcard_id)
    and (
      user_id = auth.uid()
      or not private.is_blocked(auth.uid(), user_id)
    )
  );

-- "Cannot like what you cannot see" is the EXISTS clause, and it inherits the
-- block predicate from the postcards select policy for free — so a blocked
-- rider cannot like the blocker's postcard either.
create policy "Riders can like visible postcards, as themselves"
  on public.postcard_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.postcards p where p.id = postcard_likes.postcard_id)
  );

-- Unlike removes only your own like. Note there is no visibility requirement:
-- a rider must be able to withdraw a like from a postcard that has since gone
-- out of view, or the row is stranded.
create policy "Riders can remove only their own like"
  on public.postcard_likes for delete to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy and no UPDATE grant: a like has no mutable column.

-- ---------------------------------------------------------------------------
-- 5. Grants on the new tables
-- ---------------------------------------------------------------------------
-- RLS needs BOTH a table grant and a permitting policy, so the grant is a
-- second, independent layer — the one that still holds if a future policy is
-- written too permissively. That is 007's argument, applied at creation time
-- rather than as a later repair.
--
-- Two default ACLs exist for schema public on the hosted project: the one
-- owned by `postgres` (which 002/007 stripped anon from) and one owned by
-- `supabase_admin` (which still lists anon). Which one applies depends on the
-- role that creates the table. Rather than depend on that archaeology, revoke
-- everything and grant back exactly what the policies above need.
--
-- Note what is NOT granted: UPDATE on postcard_likes or blocks, and TRUNCATE /
-- REFERENCES / TRIGGER on any of the three. A caller writing an upsert against
-- likes must use `on conflict do nothing`, not `on conflict do update` — the
-- latter needs UPDATE and will refuse with 42501.

revoke all on public.postcards      from anon, authenticated;
revoke all on public.postcard_likes from anon, authenticated;
revoke all on public.blocks         from anon, authenticated;

grant select, insert, update, delete on public.postcards      to authenticated;
grant select, insert,         delete on public.postcard_likes to authenticated;
grant select, insert,         delete on public.blocks         to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Apply the block predicate to the tables that already existed
-- ---------------------------------------------------------------------------
-- This is the half that makes decision #2 true rather than aspirational. A
-- blocked rider that disappears from the new feed but still shows up in rider
-- search, on a club roster and in a ride crew has not been blocked.
--
-- Only SELECT policies are touched, and they are dropped by catalog lookup
-- rather than by name — 008's argument holds unchanged: policies for the same
-- command are OR'd, so one leftover under a name this file did not predict
-- undoes the rest. Every other policy on these tables is left exactly as 002 /
-- 003 / 008 defined it.
--
-- WHAT IS NOT CHANGED, and why:
--
--   clubs — a club is a place, not a person. Hiding an entire club because you
--   blocked its owner would silently strand every other member's shared space,
--   and would contradict itself: rides.club_id policies call is_club_member(),
--   which is security definer and would keep reporting you as a member of a
--   club you can no longer see. Decision #2 names "club member lists", and that
--   is club_members, which IS changed below. If hiding whole clubs is ever
--   wanted it needs its own decision, not a silent inclusion here.
--
--   Every write policy — blocking changes what you can SEE, never what exists.
--   See the data note in §7.

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'club_members', 'rides', 'ride_members', 'friendships')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end
$$;

-- profiles ------------------------------------------------------------------
-- 003's predicate (own row, or any row that has chosen a username) with the
-- block clause added. This is the one that removes a blocked rider from search
-- and from every embedded profile join at once.
--
-- Known consequence, accepted: onboarding step 1's live availability check
-- reads this policy, so a name held by a rider you have blocked reads as free
-- and taking it fails with a raw 23505 instead of "already taken". Reaching
-- that state requires blocking someone and then re-running onboarding, which
-- decision #5 makes a one-way door. The clean fix is a security definer
-- username_available(text) RPC, which is an onboarding change, not this one.
create policy "Profiles are viewable by signed-in riders"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or (
      username is not null
      and not private.is_blocked(auth.uid(), id)
    )
  );

-- club_members --------------------------------------------------------------
-- 008's predicate plus the block clause. "Club member lists" from decision #2,
-- literally. Your own row is unconditional so you never vanish from a roster
-- you are on.
create policy "Club rosters follow club visibility"
  on public.club_members for select to authenticated
  using (
    (
      private.is_club_member(club_id)
      or exists (
        select 1 from public.clubs c
        where c.id = club_members.club_id and c.is_public
      )
    )
    and (
      user_id = auth.uid()
      or not private.is_blocked(auth.uid(), user_id)
    )
  );

-- rides ---------------------------------------------------------------------
-- A ride is authored by one rider and carries their name as a byline, so it
-- behaves like a post rather than like a club: a ride organised by someone you
-- blocked leaves your feed entirely. The organizer branch is unconditional and
-- first, so you never lose your own ride.
create policy "Rides are viewable by the club, organizer and signed-in riders"
  on public.rides for select to authenticated
  using (
    organizer_id = auth.uid()
    or (
      not private.is_blocked(auth.uid(), organizer_id)
      and (
        is_public
        or (club_id is not null and private.is_club_member(club_id))
      )
    )
  );

-- ride_members --------------------------------------------------------------
-- "Ride crews" from decision #2. The EXISTS clause still inherits the rides
-- policy above, so a crew row for a ride you can no longer see is gone too.
create policy "Ride rosters follow ride visibility"
  on public.ride_members for select to authenticated
  using (
    exists (select 1 from public.rides r where r.id = ride_members.ride_id)
    and (
      user_id = auth.uid()
      or not private.is_blocked(auth.uid(), user_id)
    )
  );

-- friendships ---------------------------------------------------------------
-- Beyond the tables named in the brief, and included on purpose: a pending
-- friend request from a rider you have blocked, still sitting in your list, is
-- the same leak as a visible postcard. The row's two parties ARE the pair, so
-- the symmetric helper resolves it directly.
--
-- The DELETE policy from 002 is untouched, so either party can still remove a
-- friendship they can no longer see rather than being stranded with it.
create policy "Users can view their own friendships"
  on public.friendships for select to authenticated
  using (
    (auth.uid() = requester_id or auth.uid() = addressee_id)
    and not private.is_blocked(requester_id, addressee_id)
  );

drop policy if exists "Users can send friend requests" on public.friendships;

create policy "Users can send friend requests"
  on public.friendships for insert to authenticated
  with check (
    auth.uid() = requester_id
    and not private.is_blocked(requester_id, addressee_id)
  );

-- ---------------------------------------------------------------------------
-- 7. What a block does to data that already exists
-- ---------------------------------------------------------------------------
-- NOTHING IS DELETED. A block is a visibility filter and is fully reversible.
-- When A blocks B:
--
--   * B's existing like on a postcard A can see survives. A's view of the like
--     count drops by one; everyone else's is unchanged; unblocking restores it.
--   * B's club_members and ride_members rows survive. B stays on the roster for
--     every other member and simply vanishes from A's view of it.
--   * B's postcards survive and remain visible to everyone except A.
--   * A friendship or pending request between A and B survives and is hidden
--     from both; either may still delete it.
--
-- The alternative — cascading deletes on block — was rejected for two reasons.
-- It is unrecoverable, so an accidental block destroys shared history that
-- unblocking cannot bring back. And it makes blocking a write primitive
-- against other people's data: block the organizer to erase yourself from a
-- ride's record, or to decrement someone's like count. Visibility-only cannot
-- be weaponised.
--
-- The cost is that a blocked rider still occupies a seat against rides.
-- max_riders, which is counted from rows rather than from what the viewer can
-- see. That is correct — the seat is genuinely taken — but the crew list will
-- read as one shorter than the count for the blocker. A UI concern, recorded
-- here so it is not rediscovered as a bug.

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- Every case below is also an assertion in supabase/tests/rls_test.sql, which
-- applies this whole chain to a scratch database on every PR. They are repeated
-- here because that suite runs on plain Postgres and cannot see role grants,
-- PostgREST exposure or Supabase defaults — the exact gap that let 003's
-- revoke pass locally and stay broken in production.
--
-- Shape — expect three tables, all with rls enabled:
--
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in ('postcards', 'postcard_likes', 'blocks');
--
-- Expect zero rows — no policy may target anon or PUBLIC:
--
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and not (roles = '{authenticated}');
--
-- Expect zero rows — anon must hold no table privileges:
--
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
--
-- Expect exactly one SELECT policy per table. More than one would be a leftover
-- from the drop loop above, and policies for the same command are OR'd, so a
-- leftover permissive one silently undoes the block predicate:
--
--   select tablename, count(*) from pg_policies
--   where schemaname = 'public' and cmd = 'SELECT' group by tablename;
--
-- Expect 0 then 1 — the helper must not be on the PostgREST surface:
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'is_blocked' and n.nspname = 'public';
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'is_blocked' and n.nspname = 'private';
--
-- NEGATIVE: a blocked rider's postcard is gone from the blocker's feed, and
-- the blocker's postcard is gone from theirs. Both must return zero rows:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<blocker>","role":"authenticated"}';
--     select id from public.postcards where author_id = '<blocked>';
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<blocked>","role":"authenticated"}';
--     select id from public.postcards where author_id = '<blocker>';
--   rollback;
--
-- NEGATIVE: a non-member cannot see a club-scoped postcard. Expect zero rows:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<non-member>","role":"authenticated"}';
--     select id from public.postcards where club_id = '<private-club>';
--   rollback;
--
-- NEGATIVE: a rider cannot like a postcard they cannot see, cannot author as
-- someone else, and cannot like on someone else's behalf. All must fail 42501:
--
--   insert into public.postcard_likes (postcard_id, user_id)
--     values ('<invisible-postcard>', '<self>');
--   insert into public.postcards (author_id, image_path)
--     values ('<someone-else>', 'postcards/x.jpg');
--   insert into public.postcard_likes (postcard_id, user_id)
--     values ('<visible-postcard>', '<someone-else>');
--
-- NEGATIVE: a rider cannot block themselves (expect 23514), and a duplicate
-- block is a duplicate (23505) unless written with on conflict do nothing:
--
--   insert into public.blocks (blocker_id, blocked_id) values ('<self>', '<self>');
--   insert into public.blocks (blocker_id, blocked_id) values ('<self>', '<other>');
--   insert into public.blocks (blocker_id, blocked_id) values ('<self>', '<other>')
--     on conflict do nothing;   -- must succeed as a no-op
--
-- NEGATIVE: being blocked is not disclosed. Expect zero rows for the blocked
-- rider, one for the blocker:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<blocked>","role":"authenticated"}';
--     select * from public.blocks;
--   rollback;
--
-- NEGATIVE: the helper is not callable over the API. Expect 42501,
-- "permission denied for schema private":
--
--   begin;
--     set local role authenticated;
--     select private.is_blocked('<a>'::uuid, '<b>'::uuid);
--   rollback;
