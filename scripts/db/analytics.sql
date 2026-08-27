-- The product questions, as SQL against what the schema already stores.
--
-- WHY THIS FILE EXISTS. "Analytics" sat on CLAUDE.md's deliberately-undecided
-- list because answering any of it was assumed to need an events pipeline. It
-- mostly does not: `profiles` carries created_at, terms_accepted_at, username
-- and onboarding_completed_at on every row, so the onboarding funnel — the
-- highest-value question here — is four counts against one table. Every other
-- domain table carries a timestamp too.
--
-- WHAT THIS IS NOT. These are OPERATOR queries. They are run by a human or an
-- agent with elevated access (the Supabase MCP `execute_sql`, or psql against
-- the pooler), never by the app, and never through a rider's session. Nothing
-- here is reachable under RLS and nothing here should become a screen without
-- its own visibility rules. See docs/reference/analytics.md for what each
-- number is FOR — a query with no decision attached is a number nobody acts on.
--
-- HOW TO RUN
--   Supabase MCP:  execute_sql, one block at a time
--   psql:          psql "$DEV_DATABASE_URL" -f scripts/db/analytics.sql
--
-- ---------------------------------------------------------------------------
-- THREE DEFINITIONS THAT DECIDE WHETHER THESE NUMBERS MEAN ANYTHING
-- ---------------------------------------------------------------------------
--
-- 1. THE DEFAULT CLUB IS NOT A JOIN A RIDER MADE. complete_onboarding() writes
--    a club_members row for the club carrying clubs.is_default (058). So club
--    membership is 100% by construction, AND finishing the wizard is itself a
--    timestamped write. Every query below that touches club_members excludes
--    that club — the adoption ones because they would read as total success,
--    and the ACTIVITY ones because otherwise a rider who completed onboarding
--    and never returned counts as active, which drives retention toward 100%
--    on exactly the young install where the number is most quoted.
--
-- 2. "CREW" IS 'going' OR 'maybe'. ride_members.status is CHECKed to those two
--    and both are offered in the UI (RideAttendanceBar). Counting only 'going'
--    files a ride with five maybes under "nobody came", which is the headline
--    number on this page and the easiest one to overstate.
--
-- 3. ACTIVITY IS ONE DEFINITION, USED TWICE. The `writes` CTE below appears
--    identically in the snapshot and in Q7. If you change one, change both, or
--    two different measurements end up printed under the same name.

-- ---------------------------------------------------------------------------
-- 1. THE SNAPSHOT — every headline number in one result set.
-- ---------------------------------------------------------------------------
-- Run this one first. The drill-downs below only earn their time once a line
-- here looks wrong.
with default_club as (select id from clubs where is_default limit 1),
writes as (
  select author_id as uid, created_at as at from postcards
  union all select author_id, created_at from postcard_comments
  union all select user_id,   created_at from postcard_likes
  union all select author_id, created_at from ride_messages
  union all select author_id, created_at from club_threads
  union all select author_id, created_at from club_messages
  union all select user_id,   joined_at  from ride_members
  union all select user_id,   joined_at  from club_members
    where club_id is distinct from (select id from default_club)
)
select 'riders signed up' as metric,
       (select count(*) from profiles)::text as value
union all select '… accepted terms',
       (select count(*) from profiles where terms_accepted_at is not null)::text
union all select '… set a username',
       (select count(*) from profiles where username is not null)::text
union all select '… completed onboarding',
       (select count(*) from profiles where onboarding_completed_at is not null)::text
union all select 'rides created',
       (select count(*) from rides)::text
union all select '… with no RSVP at all but the organizer',
       (select count(*) from rides r where not exists (
          select 1 from ride_members m
          where m.ride_id = r.id and m.user_id <> r.organizer_id))::text
union all select '… with no committed rider but the organizer',
       (select count(*) from rides r where not exists (
          select 1 from ride_members m
          where m.ride_id = r.id and m.user_id <> r.organizer_id and m.status = 'going'))::text
union all select 'clubs excluding the default',
       (select count(*) from clubs where not is_default)::text
union all select '… memberships in them',
       (select count(*) from club_members
         where club_id is distinct from (select id from default_club))::text
union all select '… distinct riders in one',
       (select count(distinct user_id) from club_members
         where club_id is distinct from (select id from default_club))::text
union all select 'postcards',
       (select count(*) from postcards)::text
union all select '… distinct authors',
       (select count(distinct author_id) from postcards)::text
union all select 'riders with a deliberate write, last 7d',
       (select count(distinct uid) from writes where at > now() - interval '7 days')::text
union all select 'moderation events (block/report/hide)',
       ((select count(*) from blocks)
      + (select count(*) from postcard_reports)
      + (select count(*) from postcard_hides))::text;

-- ---------------------------------------------------------------------------
-- 2. ONBOARDING — where riders stop.
-- ---------------------------------------------------------------------------
-- Q1. The funnel, as a stage each rider reached. A rider appears in exactly one
-- bucket, so the rows sum to every signup. This is the whole question except
-- WHICH sub-step rejected them, which no row records — see analytics.md §The
-- one thing SQL cannot answer.
select case
         when onboarding_completed_at is not null then '4. completed'
         when username is not null                then '3. named, did not finish'
         when terms_accepted_at is not null       then '2. consented, no username'
         else                                          '1. signed up only'
       end as stage,
       count(*) as riders,
       round(100.0 * count(*) / nullif((select count(*) from profiles), 0), 1) as pct
from profiles
group by stage
order by stage;

-- Q2. How long completion takes, and whether anyone resumes. A large gap is a
-- rider who left and came back — which is the only evidence that decision #5's
-- resumable wizard is earning its complexity.
select count(*) filter (where onboarding_completed_at is not null) as completed,
       round(avg(extract(epoch from onboarding_completed_at - created_at))::numeric, 0) as avg_seconds,
       round((percentile_cont(0.5) within group (
         order by extract(epoch from onboarding_completed_at - created_at)))::numeric, 0) as median_seconds,
       count(*) filter (where onboarding_completed_at - created_at > interval '1 hour') as resumed_later
from profiles
where onboarding_completed_at is not null;

-- ---------------------------------------------------------------------------
-- 3. THE CORE LOOP — do rides get crews, do riders post, do clubs get used.
-- ---------------------------------------------------------------------------
-- Q4. Crew size per ride, counting BOTH statuses (see definition 2 above). The
-- `crew_any = 0` row is the one that matters: a ride nobody responded to at all
-- is the product failing at the thing it is named for. `none_committed` splits
-- out the softer failure — riders answered, but none of them said going.
select crew_any,
       count(*) as rides,
       count(*) filter (where crew_going = 0) as of_which_none_committed
from (
  select r.id,
         (select count(*) from ride_members m
           where m.ride_id = r.id and m.user_id <> r.organizer_id) as crew_any,
         (select count(*) from ride_members m
           where m.ride_id = r.id and m.user_id <> r.organizer_id
             and m.status = 'going') as crew_going
  from rides r
) s
group by crew_any
order by crew_any;

-- Q5. Posting concentration. If `authors` is a handful while `postcards` is
-- large, the feed is one person talking.
select count(*) as postcards,
       count(distinct author_id) as authors,
       round(count(*)::numeric / nullif(count(distinct author_id), 0), 1) as per_author,
       count(*) filter (where created_at > now() - interval '30 days') as last_30d
from postcards;

-- Q6. Club adoption, with the default club excluded. `riders_in_a_real_club`
-- against `riders_total` is the real adoption rate.
with default_club as (select id from clubs where is_default limit 1)
select (select count(*) from clubs where not is_default) as clubs,
       (select count(distinct user_id) from club_members
         where club_id is distinct from (select id from default_club)) as riders_in_a_real_club,
       (select count(*) from profiles) as riders_total,
       (select count(*) from club_members
         where club_id is distinct from (select id from default_club)
           and role = 'owner') as owners;

-- Q7. Return rate. DAU/WAU means nothing at this size; "did this rider write
-- anything deliberate" is the honest proxy. The default-club join is excluded
-- for the reason in definition 1 — it is the wizard finishing, not a rider
-- coming back. Keep this union identical to the snapshot's.
with default_club as (select id from clubs where is_default limit 1),
writes as (
  select author_id as uid, created_at as at from postcards
  union all select author_id, created_at from postcard_comments
  union all select user_id,   created_at from postcard_likes
  union all select author_id, created_at from ride_messages
  union all select author_id, created_at from club_threads
  union all select author_id, created_at from club_messages
  union all select user_id,   joined_at  from ride_members
  union all select user_id,   joined_at  from club_members
    where club_id is distinct from (select id from default_club)
)
select count(distinct uid) filter (where at > now() - interval '7 days')  as active_7d,
       count(distinct uid) filter (where at > now() - interval '30 days') as active_30d,
       (select count(*) from profiles)                                    as riders_total
from writes;

-- ---------------------------------------------------------------------------
-- 4. COST AND SAFETY — already recorded, never looked at.
-- ---------------------------------------------------------------------------
-- Q9. The spend ledgers. 069 gives place search a per-rider hourly and daily
-- ceiling plus an application-wide one; 051 gives map tiles 10 per ride PER
-- ROLLING 24 HOURS. Search fails LOUDLY and tiles fail OPEN, so a rider at the
-- search ceiling sees an error and a ride at the tile ceiling silently shows no
-- map. Both are already in these tables and nothing has ever read them.
--
-- Every row here is windowed. Neither ledger prunes on a schedule — 051's own
-- table comment says nothing removes rows older than the window — so an
-- unwindowed count against a rolling ceiling only ever grows and would report a
-- ride that rendered 8 tiles across three weeks as near its limit.
select 'place searches, last 24h' as ledger, count(*)::text as n from place_search_attempts
  where attempted_at > now() - interval '24 hours'
union all
select 'place searches, distinct riders 24h', count(distinct user_id)::text from place_search_attempts
  where attempted_at > now() - interval '24 hours'
union all
select 'map renders, last 24h', count(*)::text from ride_map_render_attempts
  where attempted_at > now() - interval '24 hours'
union all
select 'rides at 8+ of the 10 renders allowed in the last 24h', count(*)::text from (
  select ride_id from ride_map_render_attempts
   where attempted_at > now() - interval '24 hours'
   group by ride_id having count(*) >= 8) s;

-- Q10. Moderation, as raw totals. A number that climbs is a product problem
-- before it is a legal one, and postcard_hides is the softest and earliest
-- signal. Deliberately not divided by active riders: at this volume the ratio
-- swings on single rows and reads as a trend that is not there.
select 'blocks' as kind, count(*) as n, max(created_at) as latest from blocks
union all select 'reports', count(*), max(created_at) from postcard_reports
union all select 'hides',   count(*), max(created_at) from postcard_hides;
