-- 129: the weekend digest, part 1 — the content rule, its in-app reader and
--      the rider's opt-out. PD-450.
--
-- Specification: `openspec/changes/a-weekly-digest-of-what-is-on/` —
-- `design.md` §D2 (ids, not content), §D3 (the content rule), §D4 (the body's
-- discipline), §D5 (the opt-out) and §Roles and negative cases, which
-- `rls_test.sql` §129 maps onto label for label.
--
-- ---------------------------------------------------------------------------
-- WHAT MOVES, AND WHAT DOES NOT
-- ---------------------------------------------------------------------------
-- One column (`profiles.digest_opt_out_at`) and four functions:
--
--   private.weekend_digest_for(candidate, at, near_lat, near_lon)   the rule
--   public.my_weekend_digest(near_lat, near_lon)                     reader
--   public.my_digest_opt_out()                                       opt-out read
--   public.set_digest_opt_out(p_opt_out boolean)                     opt-out write
--
-- **No table, trigger, policy or TABLE grant moves, and there is no `grant`
-- or `revoke` on `public.profiles` at all.** No new write path, so the
-- participation-gate count stays where it is. Nothing here inserts, updates or
-- deletes except `set_digest_opt_out`, on the caller's own profile row. Nothing
-- is sent: part 2 (`proposal.md` §Deferred to part 2) is the send.
--
-- ---------------------------------------------------------------------------
-- ORDERING — additive, MIGRATION-FIRST
-- ---------------------------------------------------------------------------
-- The bundle serving today names none of this, so applying first is a no-op
-- for it. The reverse order is not harmless: PD-450's bundle calls
-- `my_digest_opt_out()` when `NotificationsSheet` opens, and against a
-- database without it that is `PGRST202` and the sheet lands on `ErrorState`.
-- Same order on PROD: this file, then the promotion that carries the bundle.
--
-- ---------------------------------------------------------------------------
-- RETENTION AND REACH
-- ---------------------------------------------------------------------------
-- The stamp lives exactly as long as the profile row, which account deletion
-- takes (`029`). Clearing the preference sets NULL. It is a preference, not
-- location data. The reader stores nothing: the position arrives as an RPC
-- argument, is rounded to 2 dp inside the body, and is written nowhere.
--
-- ---------------------------------------------------------------------------
-- ADVISORS — expected +3, one class
-- ---------------------------------------------------------------------------
-- +3 `authenticated_security_definer_function_executable` (WARN): the three
-- PUBLIC functions, each deliberate and narrow. `weekend_digest_for` adds none,
-- because PostgREST does not publish `private`. No new class, nothing reachable
-- by `anon`, no table so no `rls_enabled_no_policy`.

-- ---------------------------------------------------------------------------
-- §1. The column — `025`'s allowlists do not change
-- ---------------------------------------------------------------------------
-- Nullable, no default, no backfill: NULL means "not opted out", which is the
-- correct reading for every existing rider (`096` §1's direction argument).
--
-- **It joins NONE of `025`'s three column lists — not SELECT, not INSERT, not
-- UPDATE — and the absence is the control.** RLS is row-level: the `profiles`
-- SELECT policy admits every non-blocked rider with a username, so a column in
-- the SELECT list would publish every rider's preference to every other rider.
-- `025`'s lists are an absolute allowlist, so the correct implementation issues
-- no statement at all; `096.1`'s widths (10/8/8) must not move. The only reach
-- is §2's two accessors, `my_digest_opt_out()` and `set_digest_opt_out()`.
alter table public.profiles add column digest_opt_out_at timestamptz;

comment on column public.profiles.digest_opt_out_at is
  'When this rider opted out of the weekend round-up (129, PD-450). NULL means NOT opted out. A PREFERENCE and never a gate: it changes nothing any screen shows, and nothing reads it in part 1 except its own accessor, because nothing is sent yet — part 2''s assembler applies it as its own conjunct. Independent of analytics_opt_out_at in both directions. Server-owned: authenticated holds no select, insert or update on it (none of 025''s three lists), so the only reach is my_digest_opt_out() and set_digest_opt_out().';

-- ---------------------------------------------------------------------------
-- §2. The two accessors — `096`'s pair, verbatim but for the column
-- ---------------------------------------------------------------------------
-- `security definer` for `096` §2's reason: §1 withholds the column grant, so
-- an invoker-rights function could not see the column at all. Neither takes a
-- rider id, so a foreign preference is unrepresentable rather than refused.

create or replace function public.my_digest_opt_out()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p.digest_opt_out_at
    from public.profiles p
   where p.id = (select auth.uid());
$$;

comment on function public.my_digest_opt_out() is
  'The CALLER''s own weekend round-up opt-out stamp, and nobody else''s (129). NULL means not opted out, and a caller with no profile row gets NULL too. security definer because 025''s allowlist withholds the column grant and 129 never adds one; no arguments, so there is no row to choose but your own.';

revoke all on function public.my_digest_opt_out() from public, anon;
grant execute on function public.my_digest_opt_out() to authenticated;

-- `true` keeps the FIRST stamp (`accept_terms()`'s idempotence), `false` clears
-- it outright, NULL is refused rather than read as an opt-in, and the effective
-- value is returned so the caller writes its cache from the answer.
create or replace function public.set_digest_opt_out(p_opt_out boolean)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_stamp timestamptz;
begin
  if v_uid is null then
    raise exception 'set_digest_opt_out requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  if p_opt_out is null then
    raise exception 'set_digest_opt_out requires true or false'
      using errcode = 'null_value_not_allowed';
  end if;

  update public.profiles p
     set digest_opt_out_at = case
           when p_opt_out then coalesce(p.digest_opt_out_at, pg_catalog.now())
           else null
         end
   where p.id = v_uid
  returning p.digest_opt_out_at into v_stamp;

  -- NULL is a meaningful answer ("not opted out"), so a silent no-op would tell
  -- a rider who just tapped "turn off" that it is on. Raise instead.
  if not found then
    raise exception 'set_digest_opt_out found no profile for the caller'
      using errcode = 'no_data_found';
  end if;

  return v_stamp;
end;
$$;

comment on function public.set_digest_opt_out(boolean) is
  'Records the CALLER''s weekend round-up opt-out, and nobody else''s (129, PD-450). true stamps now() and keeps an existing stamp; false clears it to NULL; NULL is refused (22004). No session is 42501, no profile row is P0002. Takes no rider id and returns the effective value. security definer because 025''s allowlist withholds the UPDATE grant on the column. A PREFERENCE and never a gate, and independent of set_analytics_opt_out in both directions.';

revoke all on function public.set_digest_opt_out(boolean) from public, anon;
grant execute on function public.set_digest_opt_out(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- §3. `private.weekend_digest_for` — the content rule, written once
-- ---------------------------------------------------------------------------
-- `security definer` because it answers for a CANDIDATE rather than for the
-- caller: part 2's assembler will call it for every rider from a context with
-- no session, so it cannot lean on the caller's RLS and must decide audience
-- itself. It does that ONLY through the pinned candidate-relative helpers —
-- `can_read_ride`, `can_read_club_thread`, `is_club_member_for`, `is_blocked`
-- — which `rls_test.sql` §060 and §121.6b hold against their policies, so a
-- policy rewrite fails there rather than silently here. It never consults the
-- session, the rider's free-text town line or either opt-out; §129.6 asserts
-- that on the comment-stripped `prosrc`, so the body below names none of them,
-- even in a comment.
--
-- Returns ids, order and counts, never content (`design.md` §D2): the client
-- reads each ride and club row by id under its own RLS and drops what that
-- does not return. A defect here can leak an id and a count, not a title.
--
-- Rows: section 'rides' carries `ride_id` (club_id and both counts NULL);
-- section 'clubs' carries `club_id`, `new_rides` and `new_threads` (ride_id
-- NULL). `ordinal` is 1-based within its section. At most 5 of each. Nothing to
-- show is ZERO rows — never a row with zero counts.
--
-- EXECUTE is revoked from every client role AND `service_role`. The suite runs
-- as the owner, so §129.5 names each role rather than attempting the call.

create or replace function private.weekend_digest_for(
  candidate uuid,
  at        timestamptz,
  near_lat  double precision,
  near_lon  double precision
)
returns table (
  section     text,
  ordinal     integer,
  ride_id     uuid,
  club_id     uuid,
  new_rides   integer,
  new_threads integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at      constant timestamptz := $2;
  v_located boolean := false;
  v_lat     double precision;
  v_lon     double precision;
begin
  -- No subject, no content, and no error: a call with no subject is empty.
  if candidate is null then
    return;
  end if;

  -- Both NULL is "no position". One NULL is a caller bug. NaN sorts above
  -- every number and the infinities sit outside the box, so the range test
  -- below refuses all three without naming them.
  if (near_lat is null) <> (near_lon is null) then
    raise exception 'weekend_digest_for takes both near_lat and near_lon, or neither'
      using errcode = 'invalid_parameter_value';
  end if;

  if near_lat is not null then
    if not (near_lat >= -90 and near_lat <= 90
            and near_lon >= -180 and near_lon <= 180) then
      raise exception 'weekend_digest_for: position out of range'
        using errcode = 'invalid_parameter_value';
    end if;
    -- The body holds precision at ~1 km whoever calls it.
    v_lat := round(near_lat::numeric, 2)::double precision;
    v_lon := round(near_lon::numeric, 2)::double precision;
    v_located := true;
  end if;

  -- The rides section. "This weekend" is decided in the ride's OWN zone
  -- (Europe/Amsterdam when it has none), on timestamps without a zone, so the
  -- session zone plays no part. `date_trunc('week')` is ISO, Monday-based.
  -- The 8-day bound is the sargable prefilter on 071's index: the last
  -- admissible instant is always less than 8 days after `at`.
  -- Haversine with distance.ts's mean radius and inclusive 100 km, so the SQL
  -- boundary and `isNearby` agree. `greatest(..., 0)` only guards the antipodal
  -- rounding case, where 1 - h dips a hair below zero and sqrt would raise.
  if v_located then
    return query
    select 'rides'::text,
           (row_number() over (order by q.departure_at, q.km, q.id))::integer,
           q.id,
           null::uuid,
           null::integer,
           null::integer
      from (
        select r.id, r.departure_at, d.km
          from public.rides r
          cross join lateral (
            select power(sin(radians(r.latitude - v_lat) / 2), 2)
                 + cos(radians(v_lat)) * cos(radians(r.latitude))
                 * power(sin(radians(r.longitude - v_lon) / 2), 2) as h
          ) hv
          cross join lateral (
            select 2 * 6371.0088::double precision
                 * atan2(sqrt(hv.h), sqrt(greatest(1 - hv.h, 0))) as km
          ) d
         where r.departure_at > v_at
           and r.departure_at < v_at + interval '8 days'
           and r.latitude is not null
           and r.longitude is not null
           and extract(isodow from (r.departure_at at time zone coalesce(r.timezone, 'Europe/Amsterdam'))) in (6, 7)
           and date_trunc('week', r.departure_at at time zone coalesce(r.timezone, 'Europe/Amsterdam'))
             = date_trunc('week', v_at at time zone coalesce(r.timezone, 'Europe/Amsterdam'))
           and d.km <= 100
           and r.organizer_id <> candidate
           and not exists (
             select 1
               from public.ride_members m
              where m.ride_id = r.id
                and m.user_id = candidate
           )
           and not private.is_blocked(candidate, r.organizer_id)
           and private.can_read_ride(candidate, r.id)
      ) q
     order by q.departure_at, q.km, q.id
     limit 5;
  end if;

  -- The clubs section: the candidate's own clubs, each with the last 7 days'
  -- new upcoming rides and new threads. The candidate's own rows and rows by
  -- anyone blocked with them are not counted. A club with nothing is omitted.
  -- It reads no admin-only table, so owner, admin and member agree.
  return query
  select 'clubs'::text,
         (row_number() over (order by k.total desc, k.name, k.id))::integer,
         null::uuid,
         k.id,
         k.rides_n,
         k.threads_n
    from (
      select c.id, c.name, nr.n as rides_n, nt.n as threads_n, nr.n + nt.n as total
        from public.clubs c
        cross join lateral (
          select count(*)::integer as n
            from public.rides r
           where r.club_id = c.id
             and r.created_at > v_at - interval '7 days'
             and r.departure_at > v_at
             and r.organizer_id <> candidate
             and not private.is_blocked(candidate, r.organizer_id)
             and private.can_read_ride(candidate, r.id)
        ) nr
        cross join lateral (
          select count(*)::integer as n
            from public.club_threads t
           where t.club_id = c.id
             and t.created_at > v_at - interval '7 days'
             and t.author_id <> candidate
             and not private.is_blocked(candidate, t.author_id)
             and private.can_read_club_thread(candidate, t.id)
        ) nt
       where private.is_club_member_for(candidate, c.id)
    ) k
   where k.total > 0
   order by k.total desc, k.name, k.id
   limit 5;
end;
$$;

comment on function private.weekend_digest_for(uuid, timestamptz, double precision, double precision) is
  'The weekend digest''s content rule, written once (129, PD-450; design.md §D3). Candidate-relative: audience is decided only by can_read_ride, can_read_club_thread, is_club_member_for and is_blocked, never by the session. Returns ids, ordinals and counts, never content — section ''rides'' (ride_id) and section ''clubs'' (club_id, new_rides, new_threads), at most 5 each, zero rows when there is nothing to show. A NULL candidate is zero rows; a position with one NULL half, NaN or out of range is 22023; the position is rounded to 2 dp. No client role and not service_role may execute it: my_weekend_digest is the in-app door, and part 2''s assembler will be the other.';

revoke all on function private.weekend_digest_for(uuid, timestamptz, double precision, double precision)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §4. `public.my_weekend_digest` — the in-app door, and nothing else
-- ---------------------------------------------------------------------------
-- `security definer` only because its callee is revoked from `authenticated`.
-- The body is exactly one delegation, pinned by EQUALITY in §129.6, so it
-- cannot grow an arm unnoticed: the subject is the caller and the instant is
-- now. `service_role` keeps Supabase's default EXECUTE, as `096`'s pair does,
-- and gets zero rows because it carries no subject.
create or replace function public.my_weekend_digest(
  near_lat double precision default null,
  near_lon double precision default null
)
returns table (
  section     text,
  ordinal     integer,
  ride_id     uuid,
  club_id     uuid,
  new_rides   integer,
  new_threads integer
)
language sql
stable
security definer
set search_path = ''
as $$select * from private.weekend_digest_for((select auth.uid()), pg_catalog.now(), near_lat, near_lon)$$;

comment on function public.my_weekend_digest(double precision, double precision) is
  'The CALLER''s weekend digest for a position they pass (129, PD-450): ids, ordinals and counts from private.weekend_digest_for(auth.uid(), now(), ...), never content — the client reads the rides and clubs by id under its own RLS and drops any id that does not return. Both arguments NULL means no position (no ride rows, club rows still computed). One NULL, NaN or out of range is 22023. security definer only because its callee is revoked from authenticated; the body is a single delegation pinned by equality in the RLS suite.';

revoke all on function public.my_weekend_digest(double precision, double precision) from public, anon;
grant execute on function public.my_weekend_digest(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — grantee-scoped; `postgres` and `service_role` hold
-- everything by default.
-- ---------------------------------------------------------------------------
--   -- f, f, f: the column is in none of 025's lists.
--   select has_column_privilege('authenticated','public.profiles','digest_opt_out_at','select'),
--          has_column_privilege('authenticated','public.profiles','digest_opt_out_at','insert'),
--          has_column_privilege('authenticated','public.profiles','digest_opt_out_at','update');
--   -- 10, 8, 8: 096.1's widths, unchanged.
--   select count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'select')),
--          count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'insert')),
--          count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'update'))
--     from pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped;
--   -- t, t, t for authenticated; f, f, f for anon.
--   select has_function_privilege('authenticated','public.my_weekend_digest(double precision,double precision)','execute'),
--          has_function_privilege('authenticated','public.my_digest_opt_out()','execute'),
--          has_function_privilege('authenticated','public.set_digest_opt_out(boolean)','execute');
--   -- f for authenticated, anon AND service_role.
--   select has_function_privilege('service_role',
--            'private.weekend_digest_for(uuid,timestamptz,double precision,double precision)','execute');
--   -- all four: prosecdef t, proconfig {"search_path=\"\""}.
--   select n.nspname, p.proname, p.prosecdef, p.proconfig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where p.proname in ('weekend_digest_for','my_weekend_digest','my_digest_opt_out','set_digest_opt_out');
