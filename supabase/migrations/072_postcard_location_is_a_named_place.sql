-- 072: a postcard's location is a place the rider NAMES, not a grid cell
--      rounded off their photo.
--
-- `openspec/changes/replace-postcard-region-with-a-named-place/` is the
-- specification; this file is its schema half. Read `design.md` §D3, §D4 and
-- §D13 and `specs/database-enforced-integrity/spec.md` before changing anything
-- here — particularly §D4, which is the argument for why the rounding CHECK
-- GAINS a subject in this change rather than losing one.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
-- `064` shipped three modes — Hide, Region, Precise — and all three are
-- REDUCTIONS OF AN EXIF GPS FIX. A photo without one gets no control at all:
-- the composer renders "This photo has no location." and the rider has no way
-- to say where they were. That is the common case rather than the edge, and
-- `064`'s own column comment says so: HEIC, screenshots and anything already
-- through another app's share sheet carry nothing.
--
-- The middle mode also describes itself to the rider as a unit — "about a
-- kilometre" — and a rider thinks in places. A 2-decimal-place grid cell is a
-- privacy MECHANISM being presented as though it were a LOCATION.
--
-- So the middle mode becomes a named place: the rider names a town, either
-- prefilled from the photo or typed with the same typeahead the ride composer
-- uses, and `taken_place_name` is what the postcard carries.
--
-- ---------------------------------------------------------------------------
-- Why this is a privacy change and not a schema chore
-- ---------------------------------------------------------------------------
-- **There is still exactly ONE coordinate pair on this table, and
-- `taken_location_precision` says whose it is.** The tempting shape is four
-- columns — the photo's pair beside the town's — and it is `064`'s
-- "stored but hidden" state under a new name: the precise fix would sit on the
-- server for every postcard whose rider chose the town, RLS is row-level, and
-- any reader of the row reads it. `design.md` §D3.
--
-- **The rounding CHECK is kept, renamed, and is doing MORE work than before.**
-- The instinct on reading "the middle mode is a town now" is that
-- `postcards_region_location_is_rounded` has lost its subject. It has gained
-- one. The constraint never checked PROVENANCE, it checked COARSENESS, and
-- without it:
--
--   A patched client sends taken_place_name = 'Utrecht',
--   taken_location_precision = 'place', and the author's own front door as the
--   coordinate. The database accepts it. The postcard's audience is shown a
--   house and told it is a city.
--
-- That is worse than the outcome the constraint was written for, because it now
-- arrives with a label that actively misdirects. It is renamed
-- `postcards_coarse_location_is_rounded` and retargeted at BOTH coarse markers.
-- `design.md` §D4. Dropping it would leave the middle mode's coarseness resting
-- entirely on `roundToRegion` running in a browser this app does not control,
-- which CLAUDE.md names as advisory in as many words.
--
-- **No new visibility.** The two columns sit on `postcards`, RLS is row-level,
-- and the postcard's existing SELECT policy is the whole answer: exactly the
-- riders who can already read the row can read the name and the id, and nobody
-- else. Blocked riders, non-members and `anon` reach nothing, unchanged.
-- `design.md` §D13 spells out every role.
--
-- ---------------------------------------------------------------------------
-- Both grant lists are ABSOLUTE and were read off the live databases
-- ---------------------------------------------------------------------------
-- Measured 2026-08-20 from information_schema.column_privileges scoped to
-- grantee `authenticated`, on BOTH projects — fpmrimzxadewsaiwpsel (DEV) and
-- zwprydcyryvudhurbnye (PROD). The two agree exactly, for the first time since
-- `064` was written: `062` promoted with `070`, so PROD's SELECT list no longer
-- carries `ride_id`.
--
--   INSERT  author_id, caption, club_id, id, image_path, ride_id, taken_at,
--           taken_at_offset_minutes, taken_latitude,
--           taken_location_precision, taken_longitude
--   SELECT  author_id, caption, club_id, created_at, id, image_path, taken_at,
--           taken_at_offset_minutes, taken_latitude,
--           taken_location_precision, taken_longitude, updated_at
--   UPDATE  caption, club_id, image_path
--
-- **`ride_id` must NOT be re-added to SELECT.** `062` took it out deliberately
-- and an absolute re-grant list is exactly how a shipped decision gets silently
-- reverted — `044`/`046` are this repo's worked example, on this exact table.
--
-- **This file issues no UPDATE statement of any kind, and that is the whole
-- mechanism.** All three verbs on `postcards` are already column-level, so a
-- column added today arrives holding NOTHING; leaving UPDATE alone is what
-- produces the insert-only outcome and *touching* it is the trap. Do not
-- "complete" this file by adding one. The existing assertion that UPDATE is
-- exactly `caption, club_id, image_path` is the proof, and it must stay green.
--
-- The consequence is `064`'s and is accepted unchanged: a rider who regrets a
-- disclosure has exactly one remedy, which is to delete the postcard.
--
-- ---------------------------------------------------------------------------
-- What this file does NOT do
-- ---------------------------------------------------------------------------
--   no policy is touched ....... SELECT, INSERT, UPDATE and DELETE on
--       `postcards` are byte-identical afterwards. §D13: a WITH CHECK arm
--       refusing a name on a postcard whose club the author is not in would be
--       the only candidate, and the existing INSERT policy already refuses the
--       whole row in that case — there is no row for a column to hang off
--   no trigger ................. `enforce_participation_gate` and
--       `postcards_set_updated_at` are already on this table. Nothing new hangs
--       off an already-shipped write path, so **`036`'s hand-exercise gate does
--       not apply** and this file may be applied before the code that writes
--       the new columns deploys
--   no index ................... nothing sorts, filters or joins on either new
--       column; nothing renders them at all yet
--   no backfill ................ NO UPDATE, DELETE or INSERT against
--       `postcards` appears below. The grandfathered `'region'` rows are left
--       exactly as they are, and `'region'` stays in the coupling's domain so
--       they stay legal. A backfill would spend vendor lookups to attach a town
--       to a coordinate its author never asked us to name, on somebody else's
--       postcard — a disclosure performed on a rider's behalf, which is the one
--       move `064`'s architecture exists to prevent. `design.md` §D9
--   nothing to `anon` .......... decision #1, and `007` revoked the last of
--       them
--
-- **Nothing here is destructive to a running client.** An old client that never
-- sends the new columns writes rows satisfying arms 1, 4 and 5 of the new
-- coupling — the all-NULL, `'precise'` and `'region'` shapes are exactly
-- `064`'s three. So the ordering constraint is the ordinary one, not
-- `069`/`070`'s.
--
-- Retention and reach are unchanged: no new table, and account deletion still
-- reaches both values through `postcards.author_id`'s cascade from `profiles`,
-- because they are columns on `postcards`.

-- ---------------------------------------------------------------------------
-- §1. The columns
-- ---------------------------------------------------------------------------
-- The `taken_` prefix is `064`'s and is load-bearing: where the photo was TAKEN
-- is not where the postcard was POSTED.
alter table public.postcards add column taken_place_name text;
alter table public.postcards add column taken_place_id text;

-- ---------------------------------------------------------------------------
-- §2. Both columns are BOUNDED
-- ---------------------------------------------------------------------------
-- 200 mirrors `clubs_location_name_length`, against the same producer: the
-- provider's label falls back through a chain ending in a whole address on one
-- line, so it runs long more readily than "a town name" suggests. The client
-- truncates to this rather than surfacing a violation — the picker owns the
-- string, so a rider has nothing to shorten.
alter table public.postcards add constraint postcards_taken_place_name_length check (
  taken_place_name is null or char_length(taken_place_name) <= 200
);

-- 512 mirrors both other provider-id columns after `069` widened them from 100.
-- It is a BOUND rather than a fitted maximum: the live ids follow
-- `74 + 2 x name bytes`, so a 200-byte name reaches 474. Do not trim toward the
-- observed maximum — a tighter bound is the defect `069` exists to fix, where a
-- pick fails on a value the rider can neither see nor shorten, and only for
-- SOME places.
alter table public.postcards add constraint postcards_taken_place_id_length check (
  taken_place_id is null or char_length(taken_place_id) <= 512
);

-- ---------------------------------------------------------------------------
-- §3. The coupling, replaced: five arms and the marker says whose coordinate
-- ---------------------------------------------------------------------------
-- Dropping and re-adding an applied constraint in a NEW file is not editing an
-- applied migration — `067` set that precedent explicitly when it replaced
-- `rides_geocode_coupling`, and `069` did the same for two length bounds.
--
-- The range bounds are `064`'s, carried into every arm that has a coordinate.
-- Retyping a constraint is exactly where a bound gets lost.
alter table public.postcards drop constraint postcards_taken_location_coupling;

alter table public.postcards add constraint postcards_taken_location_coupling check (
  -- (1) NOTHING. Hide, or a photo with no fix and a rider who named nothing.
  --     The two are deliberately indistinguishable: a column that told a viewer
  --     "this rider chose to hide it" would itself be a disclosure.
  (taken_place_name is null
     and taken_place_id is null
     and taken_latitude is null
     and taken_longitude is null
     and taken_location_precision is null)
  -- (2) A NAMED PLACE WITH NO PIN. The rider typed a town and never picked one,
  --     so there is a name and no coordinate. This is PlaceSearchField's
  --     free-text case, which the ride composer already relies on; refusing it
  --     would make the typeahead a gate rather than an accelerator.
  or (taken_place_name is not null
     and taken_location_precision = 'place'
     and taken_place_id is null
     and taken_latitude is null
     and taken_longitude is null)
  -- (3) A NAMED PLACE WITH A PIN. The centroid, rounded in the browser before
  --     it is sent — §4 below is what makes that a rule rather than a habit.
  --     The provider id may be present (a pick) or absent (a typed name that
  --     nevertheless resolved).
  or (taken_place_name is not null
     and taken_location_precision = 'place'
     and taken_latitude is not null
     and taken_longitude is not null
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
  -- (4) A PRECISE PHOTO LOCATION. The camera's own fix, every digit kept.
  --     **No provider id**: the id is provenance FOR THE STORED COORDINATE, and
  --     under this marker that coordinate came from the camera — an id naming a
  --     town beside a coordinate that is not the town's would make one column
  --     mean two things. The NAME may be present and may disagree with the
  --     coordinate; that is deliberate and cosmetic (§D5), because a name
  --     cannot reduce what `precise` already discloses.
  or (taken_latitude is not null
     and taken_longitude is not null
     and taken_location_precision = 'precise'
     and taken_place_id is null
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
  -- (5) A LEGACY ROUNDED PHOTO LOCATION. `064`'s middle mode. The client stops
  --     writing this marker and the database does not enforce that — a stray
  --     one is a correctly shaped, correctly rounded coarse location that no
  --     screen renders. §D9. Neither place column may accompany it: these rows
  --     were written under a meaning that had no name in it.
  or (taken_latitude is not null
     and taken_longitude is not null
     and taken_location_precision = 'region'
     and taken_place_name is null
     and taken_place_id is null
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
);

-- ---------------------------------------------------------------------------
-- §4. The rounding CHECK, renamed and retargeted at BOTH coarse markers
-- ---------------------------------------------------------------------------
-- The rename is deliberate rather than cosmetic: the old name says `region`,
-- the live coarse marker is `place`, and a constraint whose name contradicts
-- its predicate is how the next reader concludes it is dead.
--
-- **The predicate's SHAPE is `064`'s and must not be "improved".** It asks
-- whether the stored value IS at two decimal places, never whether it equals
-- the database's own rounding of some original. That is what makes it safe
-- across two languages whose halfway-case rounding disagrees — JS gives 4.89
-- for 4.895 and Postgres's numeric round gives 4.90 — because any
-- `integer / 100` satisfies it.
--
-- A NULL coordinate passes, which is arm (2) above: a named place with no pin.
alter table public.postcards drop constraint postcards_region_location_is_rounded;

alter table public.postcards add constraint postcards_coarse_location_is_rounded check (
  (taken_location_precision is distinct from 'region'
     and taken_location_precision is distinct from 'place')
  or (taken_latitude is null and taken_longitude is null)
  or (
    taken_latitude = round(taken_latitude::numeric, 2)::double precision
    and taken_longitude = round(taken_longitude::numeric, 2)::double precision
  )
);

-- ---------------------------------------------------------------------------
-- §5. INSERT — the measured eleven plus these two
-- ---------------------------------------------------------------------------
-- Absolute, per the measurement in the header. A column omitted from this list
-- holds no privilege, so this is the whole surface rather than a delta.
revoke insert on public.postcards from authenticated;
grant insert (
  id, author_id, club_id, image_path, caption, ride_id,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision, taken_place_name, taken_place_id
) on public.postcards to authenticated;

-- ---------------------------------------------------------------------------
-- §6. SELECT — the measured twelve plus these two, and still no `ride_id`
-- ---------------------------------------------------------------------------
-- The grant is issued now even though nothing renders a place yet, for `064`'s
-- reason: a rider must be able to read back what they published.
--
-- `ride_id` stays out. `062` is the file that took it out, its reasoning is
-- unchanged, and re-adding it here would be a silent revert of a shipped
-- decision.
revoke select on public.postcards from authenticated;
grant select (
  id, author_id, club_id, image_path, caption, created_at, updated_at,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision, taken_place_name, taken_place_id
) on public.postcards to authenticated;

-- No grant of any kind is issued to `anon` — decision #1. Asserted in the suite
-- by naming the role.
--
-- **UPDATE is deliberately absent from this file.** See the header.

-- ---------------------------------------------------------------------------
-- §7. The column comments
-- ---------------------------------------------------------------------------
-- A database comment is the `data` agent's first read via `list_tables`, and it
-- is the one piece of documentation no edit to CLAUDE.md can reach.
comment on column public.postcards.taken_place_name is
  'The place the rider NAMED for this photo — prefilled from a reverse lookup of the photo''s coordinate where one exists, typed, or picked from the same typeahead the ride composer uses (072). It is the middle disclosure mode: 064''s ''region'' described a rounded coordinate and this describes a town, which is what a rider actually thinks in. AUDIENCE IS THE POSTCARD''S and there is no narrower one — RLS is row-level, so every reader of the row reads this. INSERT-ONLY: no UPDATE grant exists on it, and the remedy for a mis-published location is deleting the postcard. Bounded at 200 by postcards_taken_place_name_length, mirroring clubs_location_name_length against the same producer. Under ''precise'' this name MAY disagree with the coordinate (design.md §D5) — it is a caption, not evidence.';

comment on column public.postcards.taken_place_id is
  'The provider''s opaque id for taken_place_name — PROVENANCE, NEVER A JOIN KEY (072). It may dangle, no foreign key exists for it and none may be added; namespaced by provider (`geoapify:...`) so a row''s source is readable from the value itself, exactly as clubs.location_place_id and rides.start_place_id are. Bounded at 512 by postcards_taken_place_id_length — a bound rather than a fitted maximum, per 069. It is provenance FOR THE STORED COORDINATE, so postcards_taken_location_coupling refuses it beside a ''precise'' marker, where the coordinate came from the camera. Insert-only and as visible as the postcard, like every other column here.';

-- `064` said ''region'' or ''precise''. Both are still legal; the live pair is
-- now ''place'' and ''precise''.
comment on column public.postcards.taken_location_precision is
  '''place'', ''precise'' or the LEGACY ''region'', matching what the rider chose in the composer, or NULL for Hide AND for a photo that carried no location — the two are indistinguishable on purpose, since a marker saying "this rider hid it" would itself be a disclosure. ''place'' means taken_place_name is the disclosure and any coordinate is that place''s centroid; ''precise'' means the camera''s own fix, every digit; ''region'' is 064''s rounded photo coordinate, which 072 stopped the client writing and deliberately did NOT backfill (design.md §D9). postcards_coarse_location_is_rounded enforces that BOTH coarse markers really are at 2 decimal places, because the rounding happens in a browser this app does not control — without it a patched client could publish a front door labelled ''Utrecht''.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
-- Executed against fpmrimzxadewsaiwpsel (DEV) on 2026-08-20, immediately after
-- this file was applied. PROD (zwprydcyryvudhurbnye) is at `070` and is NOT
-- touched by this run; its promotion belongs to the PR that ships the client.
--
-- 1. All three grant lists, scoped to their grantee. `015`'s footer counted a
--    privilege table-wide and read 2 against a correct database, because
--    postgres and service_role hold everything by Supabase default.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated'
--    group by privilege_type;
--
--   INSERT  author_id,caption,club_id,id,image_path,ride_id,taken_at,
--           taken_at_offset_minutes,taken_latitude,taken_location_precision,
--           taken_longitude,taken_place_id,taken_place_name      <-- 13
--   SELECT  author_id,caption,club_id,created_at,id,image_path,taken_at,
--           taken_at_offset_minutes,taken_latitude,taken_location_precision,
--           taken_longitude,taken_place_id,taken_place_name,updated_at  <-- 14
--   UPDATE  caption,club_id,image_path      <-- UNMOVED. If this ever reads
--                                               otherwise, this file touched
--                                               UPDATE and walked into
--                                               044/046's trap.
--
--   `ride_id` is on INSERT and NOT on SELECT. Confirmed.
--
-- 2. No write verb reaches the new columns.
--
--   select bool_or(has_column_privilege('authenticated','public.postcards',c,'UPDATE'))
--     from unnest(array['taken_place_name','taken_place_id']) c;          -- f
--
-- 3. anon holds nothing, on any column, in any verb.
--
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='anon';                                               -- 0
--
-- 4. Both replaced constraints, as pg_get_constraintdef returns them.
--
--   postcards_taken_location_coupling
--     CHECK ((((taken_place_name IS NULL) AND (taken_place_id IS NULL) AND
--     (taken_latitude IS NULL) AND (taken_longitude IS NULL) AND
--     (taken_location_precision IS NULL)) OR ((taken_place_name IS NOT NULL)
--     AND (taken_location_precision = 'place'::text) AND (taken_place_id IS
--     NULL) AND (taken_latitude IS NULL) AND (taken_longitude IS NULL)) OR
--     ((taken_place_name IS NOT NULL) AND (taken_location_precision =
--     'place'::text) AND (taken_latitude IS NOT NULL) AND (taken_longitude IS
--     NOT NULL) AND (taken_latitude >= ('-90'::integer)::double precision) AND
--     (taken_latitude <= (90)::double precision) AND (taken_longitude >=
--     ('-180'::integer)::double precision) AND (taken_longitude <=
--     (180)::double precision)) OR ((taken_latitude IS NOT NULL) AND
--     (taken_longitude IS NOT NULL) AND (taken_location_precision =
--     'precise'::text) AND (taken_place_id IS NULL) AND (taken_latitude >=
--     ('-90'::integer)::double precision) AND (taken_latitude <= (90)::double
--     precision) AND (taken_longitude >= ('-180'::integer)::double precision)
--     AND (taken_longitude <= (180)::double precision)) OR ((taken_latitude IS
--     NOT NULL) AND (taken_longitude IS NOT NULL) AND
--     (taken_location_precision = 'region'::text) AND (taken_place_name IS
--     NULL) AND (taken_place_id IS NULL) AND (taken_latitude >=
--     ('-90'::integer)::double precision) AND (taken_latitude <= (90)::double
--     precision) AND (taken_longitude >= ('-180'::integer)::double precision)
--     AND (taken_longitude <= (180)::double precision))))
--
--   postcards_coarse_location_is_rounded
--     CHECK ((((taken_location_precision IS DISTINCT FROM 'region'::text) AND
--     (taken_location_precision IS DISTINCT FROM 'place'::text)) OR
--     ((taken_latitude IS NULL) AND (taken_longitude IS NULL)) OR
--     ((taken_latitude = (round((taken_latitude)::numeric, 2))::double
--     precision) AND (taken_longitude = (round((taken_longitude)::numeric,
--     2))::double precision))))
--
--   `postcards_region_location_is_rounded` is GONE, and the eight CHECK
--   constraints on the table are: postcards_caption_length,
--   postcards_coarse_location_is_rounded,
--   postcards_image_path_is_a_storage_path, postcards_taken_at_is_in_the_past,
--   postcards_taken_at_offset_coupling, postcards_taken_location_coupling,
--   postcards_taken_place_id_length, postcards_taken_place_name_length.
--
-- 5. The legacy rows survived and nothing was rewritten. DEV held one
--    `'region'` row and six all-NULL rows before this file and holds exactly
--    the same seven afterwards, with both new columns NULL on every one.
--
-- 6. No policy moved. Four policies on `postcards`, none mentioning either new
--    column, quals unchanged — this file changes grants and constraints only.
--
--   select cmd, md5(coalesce(qual,'')), md5(coalesce(with_check,''))
--     from pg_policies where schemaname='public' and tablename='postcards';
--
-- 7. The advisors. `get_advisors(security)` on DEV after applying: ten, the
--    same ten CLAUDE.md §Supabase Rules records — eight
--    `authenticated_security_definer_function_executable`, one
--    `rls_enabled_no_policy` on `password_reset_grants`, one
--    `auth_leaked_password_protection`. **No new advisor.** This file adds no
--    function, no view and nothing `security definer`, so anything new would
--    mean something landed that this file does not describe.
