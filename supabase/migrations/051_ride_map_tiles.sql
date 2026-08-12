-- 051: Ride map tiles — the five columns, the spend ledger, and the
--      `ride-maps/` Storage folder. PD-104.
--
-- Section 1 of openspec/changes/add-ride-map-tiles/tasks.md, and nothing else.
-- Purely additive: every existing ride gets NULL in all five columns and both
-- screens render exactly what they render today. Safe to apply before any code
-- deploys and before the Edge Function exists at all.
--
-- ---------------------------------------------------------------------------
-- THE GRANT LEVEL — MEASURED AT WRITE TIME, AND IT HAS MOVED SINCE THE PROPOSAL
-- ---------------------------------------------------------------------------
-- `tag-postcards-to-rides` requires a migration adding columns to a table to
-- state the grant level it found. Measured 2026-08-12 on fpmrimzxadewsaiwpsel
-- (DEV), from pg_class.relacl and pg_attribute.attacl:
--
--   rides.relacl   authenticated=rdm/postgres      -- SELECT, DELETE, MAINTAIN
--   rides.attacl   10 columns carry a column ACL
--
-- ** This CONTRADICTS design.md §D2 and tasks.md §0.1, and the difference is
-- load-bearing rather than cosmetic. ** Both record `relacl = arwdDxtm` with
-- `attacl` empty on every column, measured 2026-08-09 against PROD. `045`
-- (2026-08-10, PD-163) landed in between and converted BOTH verbs on `rides` to
-- per-column grants, to make `created_at` server-owned and to take `id` and
-- `organizer_id` out of UPDATE.
--
-- So the premise §D2 reasons from — "the new columns arrive client-writable
-- because the grant is table-level" — is no longer true. `045` produced exactly
-- the inversion §D2 described when it declined to do this itself: **every future
-- column on `rides` now arrives with no INSERT and no UPDATE grant at all.**
--
-- What that would have cost, left alone: the Edge Function writes these five
-- columns under the CALLER's forwarded JWT as `authenticated` (§D2, task 4.3).
-- With no column grant that write fails `42501` at the privilege layer, ABOVE
-- RLS, on every ride — the policy set would look correct and the feature would
-- never store a tile. Nothing in the RLS suite would catch it either: the suite
-- runs as the table owner, for whom no grant barrier exists (`031`'s lesson).
--
-- ** §5 therefore grants UPDATE on the five columns explicitly. ** That is the
-- decided design reached deliberately instead of by inheritance, not a new
-- decision: §D2 accepts these columns being organizer-writable in as many words
-- ("The organizer can write the columns directly through PostgREST... which is
-- within their authority since they author the address"), and names a
-- `security definer` RPC as the retreat only if a LATER constraint refuses the
-- direct write. `045` was not that constraint — its header enumerates the
-- columns it was closing and why, and none of them is a map column.
--
-- INSERT is deliberately NOT granted on any of the five. A tile is only ever
-- written by the Edge Function's UPDATE after the ride exists; `createRide`
-- names none of them, and the stale-tile trigger in §4 only fires on UPDATE.
-- Withholding it costs nothing and keeps the write surface at its minimum.
--
-- ** ORDERING: this file must apply after `045`, and filename order gives that.
-- ** Stated because `045` issues an ABSOLUTE `revoke update` + `grant update
-- (...)` list rather than a delta — the same shape as the `041 -> 044 -> 046`
-- chain in docs/reference/migrations.md. Replaying `045` after this file would
-- silently drop the five grants below, with no error and nothing red, and the
-- feature would stop storing tiles for a reason no policy shows. §5's grant is
-- additive precisely so a full in-order apply is always correct.
--
-- ---------------------------------------------------------------------------
-- WHAT THE CHECK CONSTRAINTS DO NOT DO — read this before trusting them
-- ---------------------------------------------------------------------------
-- The coupling CHECK in §2 enforces exactly two things: no coordinate without a
-- confidence at or above the floor, and no tile path without a coordinate. It
-- **cannot distinguish a right coordinate from a wrong one at all.**
--
-- That is measured, not cautious. `Stationsplein 1, Amsterdam` returns two
-- buildings — Amsterdam and Weesp, 12.2 km apart, Weesp having merged into the
-- Amsterdam *municipality* in 2022 — and BOTH carry `confidence: 1`, the
-- vendor's maximum. Both satisfy this constraint perfectly. On that input the
-- CHECK distinguishes nothing whatsoever.
--
-- Three gates decide correctness and ALL THREE live in the Edge Function, where
-- the schema cannot see them:
--
--   1. granularity  -- reads `properties.result_type`, NOT `rank.match_type`;
--                      `match_type` returns `full_match` for a city as readily
--                      as for a building
--   2. numeric floor -- `rank.confidence`, and the 0.70 below is CHOSEN rather
--                      than validated; one observation of the value `1` is
--                      equally consistent with a 0-1, 0-10 or 0-100 scale
--   3. separation   -- among the survivors of 1 and 2 only, keyed on DISTANCE
--                      and never on a tie in the score, because confidence
--                      SATURATES: those two candidates tied at the ceiling
--                      rather than because they were equally good
--
-- Do not add a CHECK for any of them. Granularity would hardcode a vendor's
-- vocabulary into the schema, and ambiguity needs the whole response — how many
-- candidates came back and how far apart they were never reaches the row.
--
-- A single confidently-wrong candidate is a KNOWN GAP: the gates bound
-- *ambiguity* and *granularity*, never *wrongness*. A rider whose address is
-- ambiguous gets no tile; a rider whose address resolves cleanly to one wrong
-- building gets a wrong one.
--
-- ---------------------------------------------------------------------------
-- Personal data: retention and reach, decided here rather than retrofitted
-- ---------------------------------------------------------------------------
-- A coordinate plus a rendered image of a meeting point is location data about
-- identified people, and so is a ledger row recording when a named rider was
-- editing one.
--
--   RETENTION -- a tile lives as long as its ride, indefinitely, because nothing
--   deletes a past ride. Stated as the product owner's default (tasks.md §0.6)
--   rather than left silent. It covers ORPHANS too: an object no row names is a
--   rendered image of where an identified rider previously intended to be, and
--   the bytes persist whether or not a row points at them. Ledger rows older
--   than the window serve no further purpose and **nothing prunes them today**.
--
--   REACH -- `ride_id` is `on delete cascade`, so the ledger dies with the ride
--   and, through `rides.organizer_id`'s own cascade, with the organizer's
--   account. Storage has no foreign key to Postgres, so `ride-maps/<uid>/` must
--   be added to the account-deletion sweep by hand: that is task 7.1, a
--   coordination point with `add-account-deletion`, and it is NOT covered here.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access   -> every policy `to authenticated`; no anon grant,
--                               and the `media` bucket stays private
--   #2 blocking is in RLS    -> inherited through the EXISTS against `rides`,
--                               never restated; no `blocks` query appears below
--   #5 onboarding required   -> §3 adds the TENTH participation-gate trigger
--   #8 Supabase + RLS is it  -> no service-role key reaches any of this

-- ---------------------------------------------------------------------------
-- §1. The five columns
-- ---------------------------------------------------------------------------
-- All nullable, and NULL is the NORMAL state rather than an error: it is the
-- state of every ride in the database today and of every ride whose organizer
-- never edits it again. There is no backfill and there will not be one — no
-- actor in this design is entitled to render a ride it does not organise, which
-- is the same property that keeps the service-role key out of the function.
--
-- `geocode_confidence` is `real` rather than `numeric` deliberately: it is a
-- vendor score, not money, and nothing arithmetic depends on it. The cost is
-- that the floor comparison must be written against the column's own type —
-- see §2, which is where that bites.
--
-- No coordinate column is added for the place picker (PD-114). It writes THESE
-- columns with a known-good coordinate and the confidence column records which
-- kind of value it was; a second pair would be two sources of truth for one
-- fact.

alter table public.rides add column latitude double precision;
alter table public.rides add column longitude double precision;
alter table public.rides add column geocode_confidence real;
alter table public.rides add column map_card_path text;
alter table public.rides add column map_detail_path text;

comment on column public.rides.latitude is
  'Geocoded latitude of meeting_point, or NULL when unresolved (051). NULL is the normal state. Written only by the resolve-ride-location Edge Function, under the caller''s own JWT. Cleared by trigger whenever meeting_point changes.';
comment on column public.rides.longitude is
  'Geocoded longitude of meeting_point, or NULL when unresolved (051). See latitude.';
comment on column public.rides.geocode_confidence is
  'The vendor''s rank.confidence for the coordinate above (051). Records WHY a coordinate was admitted, so a later change can tell a geocoded guess from a picked place (PD-114). The 0.70 floor in the CHECK is chosen rather than validated, and it bounds neither granularity nor ambiguity — both gates live in the Edge Function.';
comment on column public.rides.map_card_path is
  'Supabase Storage object path for the 80x148 card strip tile, e.g. ride-maps/<organizer uid>/<uuid>.jpg, rendered at z13 (051). Never a URL — render through a signed URL, minted per viewer.';
comment on column public.rides.map_detail_path is
  'Supabase Storage object path for the 358x160 detail panel tile, ~z15 (051). Two renders rather than one crop: zoom is not scale, and an 80px crop of the z15 tile covers ~235 m and reads as texture.';

-- ---------------------------------------------------------------------------
-- §2. Three CHECK constraints
-- ---------------------------------------------------------------------------

-- (a) Coupling and the floor. Either the whole coordinate triple is absent, or
-- it is entirely present, in range, and at or above the floor.
--
-- ** `>= 0.70::real`, and the cast is the whole point. ** Measured on this
-- database, Postgres 17.6:
--
--   select (0.70::real >= 0.70);        -->  false
--   select (0.70::real >= 0.70::real);  -->  true
--
-- `real` cannot represent 0.70 and the bare literal is `numeric`, so Postgres
-- widens the `real` and the comparison fails. Uncast, a candidate whose
-- confidence is EXACTLY the stated floor violates its own constraint — and that
-- is not a filter, it is a write error: the Edge Function's UPDATE raises, on a
-- path no scenario covers, skipping the compensating delete in task 4.8 and
-- leaving two uploaded objects behind.
--
-- ** The upper arm is what makes a mis-scaled vendor value fail closed. ** The
-- 0-1 scale is plausible rather than validated (one observation of `1`), so if
-- the vendor is really emitting 0-100 every write is refused and NO tile is ever
-- stored — loudly, rather than every tile being stored with a meaningless score.
alter table public.rides add constraint rides_geocode_coupling check (
  (latitude is null and longitude is null and geocode_confidence is null)
  or (
    latitude is not null
    and longitude is not null
    and geocode_confidence is not null
    and latitude >= -90 and latitude <= 90
    and longitude >= -180 and longitude <= 180
    and geocode_confidence >= 0.70::real
    and geocode_confidence <= 1.0::real
  )
);

-- (b) One-directional, and the direction is load-bearing. A tile path requires
-- a coordinate; a coordinate does NOT require a path.
--
-- The reverse — requiring paths alongside coordinates — would turn a partial
-- failure into a write failure: a geocode that succeeds and an upload that
-- fails is a valid stored state, and a symmetric constraint would lose the
-- coordinate too. It also permits one path present and the other NULL, which is
-- the "one tile lands, the other does not" case: the screen whose path is
-- present draws its tile and the other draws its fallback.
alter table public.rides add constraint rides_map_paths_need_a_coordinate check (
  latitude is not null
  or (map_card_path is null and map_detail_path is null)
);

-- (c) Path pinning, both columns, matching the pinning `profiles` (014) and
-- `clubs` (016) already use: the folder segment must be the row's OWN
-- organizer, and the filename shape is locked end to end including the
-- extension.
--
-- This is what stops a ride being used as a laundering route to another rider's
-- avatar, cover or postcard image. It is one of two independent locks on that
-- door — the Storage SELECT policy in §6 requires the object's uid segment to
-- match `organizer_id` as well, so the two fail independently.
--
-- `.jpg` and not `.png`: the `media` bucket allows `image/jpeg` only, and that
-- refusal happens at the bucket, ABOVE every policy, with nothing in the policy
-- set to explain it.
alter table public.rides add constraint rides_map_paths_pinned_to_organizer check (
  (
    map_card_path is null
    or (
      map_card_path like ('ride-maps/' || organizer_id::text || '/%')
      and map_card_path ~ '^ride-maps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    )
  )
  and (
    map_detail_path is null
    or (
      map_detail_path like ('ride-maps/' || organizer_id::text || '/%')
      and map_detail_path ~ '^ride-maps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    )
  )
);

-- Supports the Storage SELECT policy's lookup of an object path back to its
-- ride, so a tile fetch does not sequentially scan `rides`. Partial, because
-- NULL is the normal state and will be for most rows indefinitely — there is no
-- backfill, so a full index would be almost entirely NULL entries.
create index rides_map_card_path_idx
  on public.rides (map_card_path) where map_card_path is not null;
create index rides_map_detail_path_idx
  on public.rides (map_detail_path) where map_detail_path is not null;

-- ---------------------------------------------------------------------------
-- §3. The spend ledger — append-only, and the direction of the grant is the design
-- ---------------------------------------------------------------------------
-- Every render is a billable vendor call and every geocode transmits
-- `meeting_point` — frequently a home address — to a third party. Unbounded, an
-- organizer editing in a loop is a charge on our account with no rider-visible
-- symptom.
--
-- ** A counter column on `rides` was the first answer and it is wrong. ** It
-- looked right and survived a round of review, so the reasoning is recorded
-- rather than left to be re-derived: a trigger owning the counter satisfies
-- "the organizer cannot lower it" by discarding client values, and in doing so
-- leaves NO WRITER AT ALL. The only remaining writer would be an UPDATE on
-- `rides` — and every FAILING render issues no UPDATE. An empty geocode, a
-- sub-floor confidence, a rejected granularity, a vendor outage and a quota
-- rejection all leave the columns NULL and save the ride normally. The count
-- would rise only on success while the money is spent at the geocode, so the
-- ceiling would bind the organizers whose addresses resolve cleanly and miss
-- the one editing "the usual spot" ten times BECAUSE the map will not appear —
-- precisely the rider it exists to bound.
--
-- Hence a ledger of ATTEMPTS, inserted before the vendor call. The adversary's
-- interest is what makes it work: the organizer wants the count DOWN, and down
-- is the direction with no grant behind it. Up is self-harm and needs no
-- defence.
--
-- No `updated_at`: the table is append-only by construction, so a column
-- recording an edit that cannot happen would be a dead column reading as live.
-- `id` IS client-suppliable, per the standing convention that anything a client
-- may create carries a client-generated UUID so a replayed mutation lands as a
-- 23505 rather than as a duplicate row.
create table public.ride_map_render_attempts (
  id uuid default uuid_generate_v4() primary key,
  ride_id uuid references public.rides(id) on delete cascade not null,
  -- Written by the BEFORE INSERT trigger below, never by the client. `default
  -- now()` is the VALUE and not the guarantee — a default applies only when the
  -- column is OMITTED, and PostgREST lets a client name it (034 §4b, 044).
  attempted_at timestamptz default now() not null
);

alter table public.ride_map_render_attempts enable row level security;

comment on table public.ride_map_render_attempts is
  'Append-only spend ledger bounding vendor renders per ride (051). `authenticated` holds INSERT and SELECT only — no UPDATE grant, no UPDATE policy, no DELETE grant, no DELETE policy — because the organizer is the party the limit is aimed at and the only direction they want is the one with no grant behind it. The ceiling is a WITH CHECK aggregate over this table''s own rows; it OVERSHOOTS under concurrency, permissively, and the RLS suite runs serially and cannot demonstrate that either way. Deleting the ride cascades its rows away, which is deliberate and costs nothing because the ceiling is per ride. Nothing prunes rows older than the window.';

comment on column public.ride_map_render_attempts.attempted_at is
  'Server time, written by the BEFORE INSERT trigger (051). A client that can backdate a row out of the rolling window has no ceiling at all — 034''s ruling for a conversation''s created_at, applied here.';

-- The ceiling's count never scans: it is keyed on one ride and a time window.
create index ride_map_render_attempts_ride_id_attempted_at_idx
  on public.ride_map_render_attempts (ride_id, attempted_at desc);

-- `security invoker`, matching `set_updated_at` rather than the notification
-- triggers: this function reads no table and assigns to NEW only, so
-- `security definer` would be privilege it has no use for. EXECUTE is revoked
-- from every client role anyway — a trigger function is invoked by the trigger
-- mechanism, which does not check EXECUTE at fire time (Postgres checks it when
-- the trigger is created), so revoking costs nothing and keeps it off the
-- `authenticated_security_definer_function_executable` advisor list.
create or replace function public.set_ride_map_render_attempted_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.attempted_at := now();
  return new;
end;
$$;

comment on function public.set_ride_map_render_attempted_at() is
  'Stamps ride_map_render_attempts.attempted_at with server time on every insert, discarding whatever the client supplied (051). The rolling render ceiling is meaningless if a caller can backdate rows out of the window.';

revoke all on function public.set_ride_map_render_attempted_at() from public, anon, authenticated;

create trigger set_ride_map_render_attempted_at
  before insert on public.ride_map_render_attempts
  for each row
  execute function public.set_ride_map_render_attempted_at();

-- The TENTH participation-gate trigger. 023 put this on eight tables, 034 made
-- it nine. A rider who has not completed onboarding or accepted the terms must
-- not be able to spend our vendor budget either.
--
-- The WHEN clause is not decoration: 023 §2 measured that inside a
-- `security definer` function `current_user` is the OWNER, so a guard in the
-- body would be true on every call and the gate would never fire. It is
-- evaluated in the caller's context, before the function is entered.
drop trigger if exists enforce_participation_gate on public.ride_map_render_attempts;
create trigger enforce_participation_gate
  before insert on public.ride_map_render_attempts
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- 034's comment says "nine BEFORE INSERT triggers" and there are ten now. A
-- database comment is the `data` agent's first read via `list_tables`, so it is
-- the one piece of documentation no edit to CLAUDE.md can reach — 028 and 033
-- exist for exactly this.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, ten BEFORE INSERT triggers — the ninth is ride_messages (034) and the tenth is ride_map_render_attempts (051); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- INSERT and SELECT, and nothing else. Both halves of the refusal matter and
-- are asserted separately in the suite: RLS needs a table grant AND a
-- permitting policy, so the missing grant is the outer gate and the missing
-- policy the inner one. Absence is the enforcement here, which is exactly the
-- kind of thing a well-meaning `grant all` puts back.
--
-- Table-level INSERT rather than a per-column grant excluding `attempted_at`,
-- which would also work: the spec's scenario is that a caller naming
-- `attempted_at` has the value REPLACED by server time, and a column grant
-- would refuse the statement outright instead. The trigger is the mandated
-- mechanism, so the grant is left wide enough for it to be the thing observed.
revoke all on public.ride_map_render_attempts from anon, authenticated;
grant select, insert on public.ride_map_render_attempts to authenticated;

-- SELECT: the ride's organizer, and nobody else. The ledger records when an
-- identified rider was editing a meeting point and is nobody else's business.
--
-- ** The ceiling's correctness depends on this policy, and the coupling is
-- silent. ** The count(*) inside the INSERT policy runs under the CALLER's own
-- RLS, so it counts only rows this policy admits. Today they coincide — the
-- caller is the organizer and this is organizer-scoped — so the count is right.
-- Narrowing this policy later, for any unrelated reason, silently UNDER-counts
-- and WIDENS the ceiling, with no test failing. Any change here must re-check
-- the ceiling.
create policy "Organizers read their own rides' render attempts"
  on public.ride_map_render_attempts for select to authenticated
  using (
    exists (
      select 1 from public.rides r
      where r.id = ride_map_render_attempts.ride_id
        and r.organizer_id = auth.uid()
    )
  );

-- INSERT: the caller organises the ride, and their rows inside the rolling
-- window are below the ceiling. This WITH CHECK **is** the ceiling — the
-- function does not count for itself, because it is stateless and a client may
-- call it concurrently.
--
-- 10 attempts per ride per rolling 24 hours (tasks.md §0.4): high enough that no
-- honest organizer meets it, low enough to bound a loop. The window is genuinely
-- rolling — one row per attempt is what a rolling window is — so there is no
-- boundary at which an organizer can spend the ceiling twice in quick
-- succession.
--
-- ** This is the first policy in this repo whose predicate is an aggregate over
-- its own table, and it OVERSHOOTS under concurrency. ** Under READ COMMITTED
-- two concurrent inserts each evaluate the count before either commits, both see
-- ceiling - 1, both pass, and the window ends with ceiling + 1 rows. The failure
-- is PERMISSIVE, not restrictive, which is the direction that does not announce
-- itself. Bounded by the number of genuinely concurrent callers — one extra
-- geocode for a double-tapped button — and accepted at that size. The tension is
-- named rather than hidden: the ceiling lives in the policy BECAUSE the function
-- is stateless and may be called concurrently, so concurrency is both the reason
-- for this design and its one soft edge. Tightening it needs SERIALIZABLE or an
-- advisory lock and neither is worth one geocode.
--
-- ** The RLS suite runs serially and cannot demonstrate this. ** An assertion
-- written there passes whatever the concurrent behaviour is; do not read a green
-- suite as evidence about it.
--
-- ** The ceiling must never be enforced by a trigger on `rides`. ** A BEFORE
-- UPDATE trigger that raises aborts the whole statement, so an organizer at
-- their ceiling could not edit their own ride's address at all for the rest of
-- the window — a far worse failure than a missing map. The refusal landing on a
-- different table from the ride is what preserves "a refused render never fails
-- the ride write", and §7's assertions prove both halves.
create policy "Organizers record render attempts on their own rides, up to the ceiling"
  on public.ride_map_render_attempts for insert to authenticated
  with check (
    exists (
      select 1 from public.rides r
      where r.id = ride_map_render_attempts.ride_id
        and r.organizer_id = auth.uid()
    )
    and (
      select count(*)
      from public.ride_map_render_attempts a
      where a.ride_id = ride_map_render_attempts.ride_id
        and a.attempted_at > now() - interval '24 hours'
    ) < 10
  );

-- No UPDATE policy and no DELETE policy, matching the absent grants above. See
-- the table comment: the organizer must be able to raise their own count and
-- must not be able to lower it.

-- ---------------------------------------------------------------------------
-- §4. The stale-tile trigger
-- ---------------------------------------------------------------------------
-- A tile drawn from a previous address is not a stale cache entry, it is A
-- PICTURE OF THE WRONG PLACE shown beside the right one.
--
-- A trigger and not a convention in `src/lib/actions/`, because the client owns
-- the mutation path and can simply decline to run a convention.
--
-- BEFORE and not AFTER: a BEFORE trigger overwrites values supplied by the same
-- statement, so a client sending `meeting_point` and a path together cannot keep
-- the path. An AFTER trigger issuing a second statement can be raced.
--
-- ** The WHEN scope is NOT optional. ** Measured:
-- `propagate_club_privacy_to_rides` runs
-- `update public.rides set is_public = false where club_id = new.id and
-- is_public` the moment a club turns private. An unscoped trigger would clear
-- every tile in that club in one statement — a bulk data loss with a
-- plausible-looking cause, discovered weeks later.
--
-- `IS DISTINCT FROM` is the whole comparison, so a whitespace-only or case-only
-- edit clears the tile. Deciding whether two strings denote the same place is
-- the problem geocoding exists to solve, and an over-eager clear costs one
-- render.
--
-- It CLEARS COLUMNS RATHER THAN RAISING, so no ride write can ever be aborted by
-- it. This is the only trigger this change puts on `rides`, taking that table
-- from three non-internal triggers to four.
--
-- ** Its one hazard is that it forgets. ** Clearing the path columns destroys
-- the only record of the superseded object names, so the client must delete
-- those objects BEFORE issuing the UPDATE that fires this (task 5.1a). The
-- own-folder arm in §6 is the recovery path when that ordering is not honoured.
create or replace function public.clear_ride_map_tiles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.latitude := null;
  new.longitude := null;
  new.geocode_confidence := null;
  new.map_card_path := null;
  new.map_detail_path := null;
  return new;
end;
$$;

comment on function public.clear_ride_map_tiles() is
  'Clears the five tile columns when rides.meeting_point changes (051). Scoped by the trigger''s WHEN clause to an actual meeting_point change: propagate_club_privacy_to_rides bulk-updates is_public across a club, and an unscoped version would wipe every tile in that club the moment it turned private.';

revoke all on function public.clear_ride_map_tiles() from public, anon, authenticated;

create trigger clear_ride_map_tiles
  before update on public.rides
  for each row when (old.meeting_point is distinct from new.meeting_point)
  execute function public.clear_ride_map_tiles();

-- ---------------------------------------------------------------------------
-- §5. The UPDATE grant on the five columns — see the header
-- ---------------------------------------------------------------------------
-- Additive, deliberately: `045` re-granted with an ABSOLUTE list, and issuing
-- another absolute list here would make the two files order-dependent in both
-- directions instead of one. This adds five column grants and touches nothing
-- else, so a full in-order apply is correct and a replay of THIS file is a
-- no-op.
--
-- Not granted: INSERT on any of the five. The tile is only ever written by an
-- UPDATE after the ride exists.
grant update (latitude, longitude, geocode_confidence, map_card_path, map_detail_path)
  on public.rides to authenticated;

-- ---------------------------------------------------------------------------
-- §6. storage.objects policies for `ride-maps/`
-- ---------------------------------------------------------------------------
-- The sixth folder in the shared `media` bucket, after postcards/ (010),
-- avatars/ and covers/ (014), club-avatars/ and club-covers/ (016). No bucket is
-- created and none is modified: `media` stays private, 5 MB, `image/jpeg` only.
--
-- ** `enforce_participation_gate` does not reach this folder, and that is
-- recorded rather than assumed. ** No `storage.objects` policy in this repo
-- carries it — the trigger is attached to tables and `storage.objects` is not
-- one of the ten. These three policies do not gate on onboarding or consent.

-- INSERT and DELETE take the ordinary own-folder shape used by all five existing
-- folders: prefix and caller uid only. That is correct for a write and
-- CATASTROPHIC if copied into a read.
create policy "Riders upload ride map tiles into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'ride-maps'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^ride-maps/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

-- SELECT. ** Modelled on `Riders read postcard images their audience predicate
-- allows` (010) specifically — the bare EXISTS — and NOT on "the five folders"
-- generally: ** four of the five carry an `own-folder OR EXISTS(parent)`
-- disjunction, and copying that shape blindly is a different policy from
-- copying this one.
--
-- The own-folder arm IS present here, for the stated orphan reason below rather
-- than by imitation.
--
-- The audience is the ride's audience, EXACTLY — neither wider nor narrower.
-- The tile depicts `meeting_point`, which RideCard and RideMap already render as
-- text to precisely this audience. Narrower would hide a picture of a string the
-- same screen is printing; wider would publish a private club's meeting point.
--
-- ** `private.is_ride_crew` must NOT appear here, and the instinct after 034 is
-- to reach for it. ** 034 needed a NARROWING conjunct because a chat contains
-- content the ride does not; a tile is a RENDERING of the parent's own column.
-- The test for the next surface: does the child hold information the parent's
-- audience cannot already obtain from the parent? If it is a rendering, a
-- derivative or a projection, its audience is the parent's.
--
-- The EXISTS runs under the CALLER's row security, so it IS the rides SELECT
-- policy — blocking (`not private.is_blocked(...)`), the private-club arm and
-- 022 are all inherited rather than restated. No `security definer` helper is
-- the condition that decides visibility. A blocked rider's refusal therefore
-- comes from the parent policy and from nothing written here.
--
-- The `foldername[2] = r.organizer_id` binding is 010 §2's line restated: without
-- it the EXISTS inherits RLS from whatever ride matches the path, and a rider
-- could publish another rider's object to their own ride's audience. The CHECK
-- in §2(c) already refuses that write, so this is the second of two independent
-- locks on the same door.
--
-- ** The own-folder arm exists for ORPHANS, and it grants nobody a byte. ** Every
-- referenced object's folder uid IS the ride's organizer_id, by that same CHECK,
-- so for a live tile the arm returns nothing the EXISTS would not. Its entire
-- effect is on objects no row names — an upload whose column write was refused,
-- a tile superseded by an address edit, a tile whose ride was deleted.
--
-- Omitting it was the first draft's choice and the reasoning was backwards on
-- the axis that matters: ** without the arm the organizer cannot DELETE the
-- object either. ** A Storage listing is filtered by this same policy, so an
-- orphan is invisible in a listing and its name is unrecoverable; the DELETE
-- policy permits removal only by naming it. Omitting the arm does not make the
-- tile go away, it makes it permanent, invisible and uncounted — each one a
-- rendered image of where an identified rider previously intended to be. The arm
-- converts a retention problem into a cleanup affordance.
--
-- It is permitted here by the test in `stored-media-visibility`: the owning
-- row's own SELECT policy admits the folder's uid UNCONDITIONALLY —
-- `rides` SELECT begins `organizer_id = auth.uid() OR ...` — so the arm hands
-- that rider nothing the parent policy withheld.
create policy "Ride map tiles are readable with the ride"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'ride-maps'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.rides r
        where (r.map_card_path = storage.objects.name
               or r.map_detail_path = storage.objects.name)
          and (storage.foldername(storage.objects.name))[2] = r.organizer_id::text
      )
    )
  );

create policy "Riders delete ride map tiles from their own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'ride-maps'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- No UPDATE policy, matching 010, 014 and 016: replacing a tile is
-- delete-then-insert, so a replacement is subject to the same path pinning as
-- the original. An upsert overwriting an object in place would let a path
-- already attached to a visible ride have its bytes swapped.

-- ---------------------------------------------------------------------------
-- §7. Verification — run against the live project after applying, not just CI
-- ---------------------------------------------------------------------------
-- The suite runs on plain Postgres and cannot see role grants, exposed RPC
-- endpoints, the bucket's MIME allowlist or Supabase defaults. Each of these
-- predicts a number:
--
--   -- 5, all nullable
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'rides'
--      and column_name in ('latitude','longitude','geocode_confidence',
--                          'map_card_path','map_detail_path');
--
--   -- 3 — the coupling+floor, the one-directional and the path-pinning CHECKs
--   select conname from pg_constraint where conrelid = 'public.rides'::regclass
--     and contype = 'c'
--     and conname in ('rides_geocode_coupling','rides_map_paths_need_a_coordinate',
--                     'rides_map_paths_pinned_to_organizer');
--
--   -- 5 — the map columns, and NOT id/organizer_id/created_at. Scoped to the
--   -- grantee: a table-wide count reads high because postgres and service_role
--   -- hold everything by Supabase default.
--   select column_name from information_schema.column_privileges
--    where table_name = 'rides' and grantee = 'authenticated'
--      and privilege_type = 'UPDATE'
--      and column_name in ('latitude','longitude','geocode_confidence',
--                          'map_card_path','map_detail_path');
--
--   -- 0 — INSERT is deliberately not granted on any of the five
--   select count(*) from information_schema.column_privileges
--    where table_name = 'rides' and grantee = 'authenticated'
--      and privilege_type = 'INSERT'
--      and column_name in ('latitude','longitude','geocode_confidence',
--                          'map_card_path','map_detail_path');
--
--   -- 4 — three from 001/017/036 plus clear_ride_map_tiles
--   select tgname from pg_trigger where tgrelid = 'public.rides'::regclass
--     and not tgisinternal;
--
--   -- 2 — SELECT and INSERT only. No UPDATE, no DELETE.
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'ride_map_render_attempts' and grantee = 'authenticated';
--
--   -- 0 — anon holds nothing, decision #1
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'ride_map_render_attempts' and grantee = 'anon';
--
--   -- false, false — the ledger cannot be edited or emptied by its subject
--   select has_table_privilege('authenticated','public.ride_map_render_attempts','update'),
--          has_table_privilege('authenticated','public.ride_map_render_attempts','delete');
--
--   -- 2 — SELECT and INSERT policies only
--   select cmd, roles::text from pg_policies
--    where schemaname = 'public' and tablename = 'ride_map_render_attempts';
--
--   -- 10 — the participation gate reaches the ledger now
--   select count(*) from pg_trigger where tgname = 'enforce_participation_gate'
--     and not tgisinternal;
--
--   -- 3 — insert, select and delete for ride-maps/. No UPDATE, on any folder.
--   select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and policyname like '%ride map tile%';
--
--   -- 18 — 15 before this file, plus 3
--   select count(*) from pg_policies where schemaname='storage' and tablename='objects';
--
--   -- 0 — no storage policy targets anything but authenticated
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and roles::text[] <> array['authenticated'];
--
--   -- media | f | 5242880 | {image/jpeg} — unchanged by this file
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets
--    where id = 'media';
--
--   -- false, false — neither trigger function is reachable by a client role
--   select has_function_privilege('authenticated','public.clear_ride_map_tiles()','execute'),
--          has_function_privilege('authenticated','public.set_ride_map_render_attempted_at()','execute');
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- nine. Both trigger functions are `security invoker` with EXECUTE revoked, so
-- neither joins the `authenticated_security_definer_function_executable` list; a
-- new WARN means a revoke did not land.
--
-- NEGATIVE — a non-member of a private club cannot read that club's ride tile,
-- even knowing the exact object path, which is guessable from a ride id and a
-- uid and is NOT a secret:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<non-member>","role":"authenticated"}';
--     select name from storage.objects where name = '<the club ride''s tile path>';
--   rollback;
--   -- expect zero rows.
--
-- NEGATIVE — another rider reads zero ledger rows for a ride they do not
-- organise, and cannot lower a count by any statement against the ledger.
--
-- NOT ASSERTABLE ANYWHERE, named so their absence is not read as coverage:
-- signed-URL behaviour after the policy stops matching (Storage checks the
-- policy when the URL is MINTED, not when it is fetched), the bucket's MIME
-- allowlist (it runs above every policy), the ceiling's concurrent overshoot
-- (the suite runs serially), and the Edge Function's JWT verification (Deno,
-- excluded from tsconfig.json, with nothing type-checking it).
