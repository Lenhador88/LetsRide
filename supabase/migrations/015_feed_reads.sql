-- 015: the unread model — a per-audience read watermark.
--
-- The design badges two surfaces with a red `v2 / Component / Counter`: the
-- postcard filter tiles, and every joined club on `Clubs - Your clubs`. Nothing
-- has ever tracked what a rider has seen, so both counted whatever happened to
-- be on page one of a feed.
--
-- Two shapes were considered and rejected before this one:
--
--   a) `profiles.postcards_seen_at` — one timestamp per rider. Cheap, and it
--      cannot express a badge *per club*, which is what the club list draws. It
--      stopped being the cheap option and became the wrong one the moment Clubs
--      came into scope.
--
--   b) `postcard_views` — a row per (rider, postcard) seen. Exact, and the only
--      option here whose storage grows as riders × content: reading generates
--      rows, so the home screen writes on every swipe, and each badge becomes an
--      anti-join over the largest table in the schema. It also needs a pruning
--      job, and this project has no cron.
--
-- A watermark stores the decision instead of the evidence. One row per (rider,
-- audience they have joined), so the row count is bounded by *membership* — a
-- rider in five clubs holds five rows — and never moves with how much gets
-- posted. Ten thousand riders is tens of thousands of rows, flat against
-- content volume, and the count reads through the index 009 already created.
--
-- The cost, stated rather than discovered: a watermark can only express
-- "everything older than T is read". The deck is newest-first, so a rider who
-- swipes three of twelve has read a *prefix* — which no single timestamp
-- represents. The rule that makes this honest is that the watermark advances
-- only when a surface is finished, not part-way through. That is what the deck
-- already does, since it does not persist position across loads.
--
-- If per-card precision is ever genuinely wanted, `postcard_views` can be added
-- *beside* this table scoped to the current window — at which point the
-- watermark bounds how many view rows can ever exist. Choosing this now
-- forecloses nothing.

-- ---------------------------------------------------------------------------
-- §1. The table
-- ---------------------------------------------------------------------------
--
-- `club_id` mirrors `postcards.club_id` exactly: NULL is the app-wide feed, set
-- is that club's audience. The same column means the same thing on both tables,
-- which is why the badge query needs no translation layer.
--
-- Only the club rows have a writer today — the app-wide row lands with the
-- postcard filter tiles. The nullable column is here now because it is the
-- table's shape rather than a spare field: adding it later means swapping a
-- primary key for a unique index on a live table.

create table public.feed_reads (
  user_id      uuid references public.profiles(id) on delete cascade not null,
  club_id      uuid references public.clubs(id) on delete cascade,
  last_seen_at timestamptz default now() not null,

  -- NOT a primary key, because `club_id` is nullable and PK columns cannot be.
  --
  -- `nulls not distinct` is load-bearing and easy to leave off. A plain UNIQUE
  -- treats two NULLs as different values, so without it every visit to the
  -- app-wide feed would insert *another* app-wide row and the upsert in §3
  -- would never find a conflict to update. Postgres 15+; the project is on 17.
  constraint feed_reads_user_audience_key unique nulls not distinct (user_id, club_id)
);

alter table public.feed_reads enable row level security;

comment on table public.feed_reads is
  'Per-audience read watermark. One row per (rider, audience): club_id NULL is the app-wide feed, set is that club. Bounded by membership, not by content — see 015 for why this is not a per-postcard views table.';

-- ---------------------------------------------------------------------------
-- §2. Policies
-- ---------------------------------------------------------------------------
--
-- A watermark row grants nothing. It cannot make a postcard readable — the
-- postcards SELECT policy decides that and never consults this table — so the
-- authorization rule is the whole of `user_id = auth.uid()`.
--
-- WITH CHECK carries one more predicate than that, and it is worth saying why,
-- since RLS enforces authorization rather than validity here. Without it, the
-- FK to `clubs` turns an INSERT into an existence oracle: a nonexistent club id
-- raises 23503 while an existing-but-invisible one succeeds. Guessing a v4 UUID
-- makes that unexploitable in practice, but the predicate costs one call to a
-- helper the postcards policy already uses, and it states the real rule — a
-- watermark only ever exists for an audience the rider can actually read. The
-- design agrees: the counter is drawn on `is Joined=True` and nowhere else.

create policy "Riders see only their own watermarks"
  on public.feed_reads for select to authenticated
  using (user_id = auth.uid());

create policy "Riders mark only their own audiences seen"
  on public.feed_reads for insert to authenticated
  with check (
    user_id = auth.uid()
    and (club_id is null or private.is_club_member(club_id))
  );

-- The upsert's UPDATE arm. USING scopes which rows may be reached, WITH CHECK
-- what they may become; both are needed, or a rider could move a row out of
-- their own ownership.
create policy "Riders advance only their own watermarks"
  on public.feed_reads for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (club_id is null or private.is_club_member(club_id))
  );

-- No DELETE policy and no DELETE grant. Deleting a watermark means "mark
-- everything unread again", which no screen draws. Leaving a club cascades the
-- row away via the FK, so the only deletion that has a meaning already happens
-- without a grant. Same reasoning as 011's refusal to grant UPDATE on a table
-- with nothing mutable.

-- ---------------------------------------------------------------------------
-- §3. The index the count needs
-- ---------------------------------------------------------------------------
--
-- `postcards_club_id_idx (club_id, created_at desc)` already exists from 009 and
-- is exactly the shape §4 probes. `rides` had **no indexes at all** — not one,
-- since 001 — so the rides half of every badge would have been a sequential
-- scan of the whole table on every Clubs tab load.

create index rides_club_id_created_at_idx on public.rides (club_id, created_at desc)
  where club_id is not null;

-- ---------------------------------------------------------------------------
-- §4. The badge count
-- ---------------------------------------------------------------------------
--
-- "Any activity" is the product owner's call: new postcards plus new rides in
-- that club. Comments are excluded — a comment has no audience of its own (011)
-- and the club sub-pages the badge points at are Timeline and Rides.
--
-- SECURITY INVOKER, deliberately, and it is the reason this can sit in `public`
-- where PostgREST publishes it. The function runs as the caller, so RLS applies
-- to `postcards`, `rides` and `club_members` inside it — which means blocks and
-- hides are excluded for free, by the same policies the feed itself obeys. It
-- can return nothing the caller could not already read. Contrast 005/006, which
-- moved the SECURITY DEFINER helpers into `private` precisely because those
-- *could*.
--
-- Counting under RLS rather than denormalising a counter is the same argument
-- CLAUDE.md already makes for `postcard_likes`: the correct count is per-viewer.
-- A trigger maintaining `club_members.unread_count` would also fan out one write
-- per member on every insert — posting to a 5,000-member club would be 5,000 row
-- updates inside that transaction.
--
-- Two details that are not incidental:
--
--   * `coalesce(r.last_seen_at, m.joined_at)` — a rider with no watermark yet
--     reads as "everything since you joined", not "every postcard this club has
--     ever had". Joining a five-year-old club should not badge it 4,000.
--
--   * the `limit` inside each subquery bounds the scan. Without it a club with
--     50,000 new postcards scans 50,000 index entries to render a 24×24 badge.
--     The UI shows `99+` above 99, so anything past the cap is a number nobody
--     reads. This is what keeps the query O(1) in club activity rather than
--     merely indexed.
--
-- The CTE aliases `club_id` to `cid` so no inner column collides with the OUT
-- parameter names, which in a `language sql` function is an ambiguity error
-- rather than a shadowing.

create function public.club_unread_counts()
returns table (club_id uuid, unread integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with watermarks as (
    select
      m.club_id as cid,
      coalesce(r.last_seen_at, m.joined_at) as since
    from public.club_members m
    left join public.feed_reads r
      on r.user_id = m.user_id
     and r.club_id = m.club_id
    where m.user_id = auth.uid()
  )
  select
    w.cid,
    (
      select count(*)::integer
      from (
        select 1
        from public.postcards p
        where p.club_id = w.cid
          and p.created_at > w.since
        limit 100
      ) capped_postcards
    )
    +
    (
      select count(*)::integer
      from (
        select 1
        from public.rides d
        where d.club_id = w.cid
          and d.created_at > w.since
        limit 100
      ) capped_rides
    )
  from watermarks w
$$;

comment on function public.club_unread_counts() is
  'Unread activity per joined club — new postcards plus new rides since the rider''s watermark, or since they joined. SECURITY INVOKER, so RLS decides what counts.';

-- ---------------------------------------------------------------------------
-- §5. Grants
-- ---------------------------------------------------------------------------
--
-- RLS needs BOTH a table grant and a permitting policy. Note what is not
-- granted: DELETE on the table (§2), and anything at all to `anon` — decision #1.

revoke all on public.feed_reads from anon, authenticated;
grant select, insert, update on public.feed_reads to authenticated;

revoke all on function public.club_unread_counts() from public, anon;
grant execute on function public.club_unread_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 3 (select, insert, update — no delete)
--   select count(*) from pg_policies where tablename = 'feed_reads';
--
-- Expected: 0 — every policy must be `to authenticated`
--   select count(*) from pg_policies
--    where tablename = 'feed_reads' and roles::text[] <> array['authenticated'];
--
-- Expected: 0 — anon holds nothing
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'feed_reads' and grantee = 'anon';
--
-- Expected: f — `authenticated` cannot delete a watermark.
--
-- Scoped to the grantee on purpose. The unscoped form of this
-- ("no DELETE grant on the table at all") returns 2 and always will: `postgres`
-- owns the table and `service_role` is granted everything by Supabase default,
-- on this and every other table in the schema. It was written unscoped here
-- first, read as a failure against a correct database, and is the reason the
-- suite asserts the privilege rather than counting grant rows.
--   select has_table_privilege('authenticated', 'public.feed_reads', 'delete');
--
-- Expected: t — the unique index treats NULLs as equal
--   select indnullsnotdistinct from pg_index
--    where indexrelid = 'feed_reads_user_audience_key'::regclass;
--
-- Expected: f — the function is INVOKER, not DEFINER
--   select prosecdef from pg_proc where proname = 'club_unread_counts';
--
-- Expected: 1 — the rides index exists
--   select count(*) from pg_indexes
--    where tablename = 'rides' and indexname = 'rides_club_id_created_at_idx';
