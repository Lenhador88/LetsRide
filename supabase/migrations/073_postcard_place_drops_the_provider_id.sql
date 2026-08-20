-- 073: the postcard's place keeps its NAME and loses the provider id, and the
--      coupling CHECK stops passing rows it was written to refuse.
--
-- Two corrections to `072`, which is applied to DEV and to no other project.
-- `072` is not edited — `CLAUDE.md` §Supabase Rules, and the same remedy `010`
-- used for `009`, `052` for `051` and `069` for `066`/`067`.
--
-- ---------------------------------------------------------------------------
-- Correction 1 — `taken_place_id` is a PRECISION BACKDOOR and is dropped
-- ---------------------------------------------------------------------------
-- Product owner, 2026-08-20, from the proposal review: the provider id is a
-- `geoapify:` pointer that a place-details lookup resolves back to the picked
-- feature's **exact geometry**. Stored beside a deliberately 2dp-rounded
-- coordinate it restores precisely the precision the rounding exists to remove
-- — so `072`'s arm 3 shipped a coordinate the CHECK calls coarse next to a
-- pointer that is not.
--
-- **This is not the same column as `clubs.location_place_id` or
-- `rides.start_place_id`, and that is why `069`'s reasoning does not carry.**
-- Those two sit beside a FULL-PRECISION coordinate the rider chose to publish,
-- so the id discloses nothing the row does not already. Here the whole point of
-- the column's neighbour is that it has been blunted.
--
-- Nothing consumes it: no screen renders a postcard's location at all, which is
-- exactly why `072` was the moment to change the model. So the id is a
-- disclosure surface bought for zero function, and dropping it now costs one
-- migration rather than a rewrite of every stored row later.
--
-- The NAME survives unchanged. A town name is the disclosure the rider made on
-- purpose, and it resolves to a town, not to a driveway.
--
-- ---------------------------------------------------------------------------
-- Correction 2 — the coupling PASSED rows it was written to refuse, because a
--                CHECK treats NULL as satisfied
-- ---------------------------------------------------------------------------
-- **Found by the RLS suite before this reached a second database**, on `064`'s
-- own assertion "a coordinate with no precision marker is refused". Under
-- `072`'s predicate that INSERT succeeded.
--
-- The mechanism, because it is subtle and it will be retyped again:
--
--   taken_latitude = 52.37, taken_longitude = 4.9, taken_location_precision NULL
--
--   arm 1 .. `taken_latitude is null`                     -> FALSE
--   arm 2 .. `taken_place_name is not null`               -> FALSE
--   arm 3 .. same                                          -> FALSE
--   arm 4 .. `taken_location_precision = 'precise'`       -> **NULL**
--   arm 5 .. `taken_location_precision = 'region'`        -> **NULL**
--
--   FALSE or FALSE or FALSE or NULL or NULL               -> NULL
--
-- and **a CHECK constraint accepts NULL**. It only ever refuses an explicit
-- FALSE. So every arm testing a nullable column with `=` was a hole rather than
-- a filter, and the rows that walked through were exactly the half-populated
-- ones the coupling exists to stop.
--
-- **`064` did not have this bug and the reason is worth naming**: its second
-- arm carried `taken_location_precision is not null` as its own conjunct, so
-- the arm collapsed to FALSE before the `= ANY (...)` was ever reached. `072`
-- split that one arm into four marker-specific ones and the guard did not come
-- with them. Rewriting one arm into several is where this defect is born.
--
-- The fix is `is not distinct from`, which returns a boolean for every input
-- including NULL. `is null` / `is not null` are already NULL-safe and stay.
-- **Do not re-introduce a bare `=` against `taken_location_precision` here.**
--
-- ---------------------------------------------------------------------------
-- What this file does NOT do
-- ---------------------------------------------------------------------------
--   no grant statement of ANY verb .. `alter table ... drop column` removes the
--       dropped column's privileges with it, so the INSERT and SELECT lists
--       lose `taken_place_id` and nothing else moves. Issuing an absolute
--       re-grant to "tidy up" is `044`/`046`'s trap and is the one edit this
--       file must not acquire. The §Verification footer reads all three lists
--       back to prove it — including UPDATE, still exactly
--       `caption, club_id, image_path`
--   no policy is touched ........... `072` touched none either; the place rides
--       the postcard's own audience and needs no arm of its own
--   no trigger ..................... nothing hangs off a shipped write path, so
--       `036`'s hand-exercise gate does not apply
--   no index, no backfill .......... NO UPDATE, DELETE or INSERT against
--       `postcards` appears below. The grandfathered `'region'` rows are
--       untouched and stay legal, as arm 5
--   nothing to `anon` .............. decision #1
--
-- **The coarseness rule stays where `072` put it.** Arm 3 requires a coordinate
-- to be present and in range; that it is at 2 decimal places is
-- `postcards_coarse_location_is_rounded`'s job and is deliberately NOT
-- duplicated here, so a rider sending a front door under `'place'` fails the
-- constraint that says what is wrong rather than the one that says the row is
-- shaped oddly.
--
-- Applied to DEV only. PROD is at `070` and has seen neither `072` nor this.

-- ---------------------------------------------------------------------------
-- §1. The coupling comes off FIRST, because it names the column being dropped
-- ---------------------------------------------------------------------------
-- Dropping the column would take both of these with it silently. Naming them is
-- the point: an auto-dropped constraint is invisible in the file that caused it
-- and reappears as a mystery in the next session's `pg_constraint` diff.
alter table public.postcards drop constraint postcards_taken_location_coupling;
alter table public.postcards drop constraint postcards_taken_place_id_length;

alter table public.postcards drop column taken_place_id;

-- ---------------------------------------------------------------------------
-- §2. The coupling, corrected: five arms, four columns, and NULL-safe
-- ---------------------------------------------------------------------------
alter table public.postcards add constraint postcards_taken_location_coupling check (
  -- (1) NOTHING. Hide, or a photo with no fix and a rider who named nothing.
  --     The two are deliberately indistinguishable: a column that told a viewer
  --     "this rider chose to hide it" would itself be a disclosure.
  (taken_place_name is null
     and taken_latitude is null
     and taken_longitude is null
     and taken_location_precision is null)
  -- (2) A NAMED PLACE WITH NO PIN. The rider typed a town and never picked one,
  --     so there is a name and no coordinate. A first-class state rather than a
  --     partial row — refusing it would make the typeahead a gate rather than
  --     an accelerator, which is the ride composer's existing free-text case.
  or (taken_place_name is not null
     and taken_location_precision is not distinct from 'place'
     and taken_latitude is null
     and taken_longitude is null)
  -- (3) A NAMED PLACE WITH A PIN. The place's centroid, rounded in the browser
  --     before it is sent. That it is genuinely at 2 decimal places is
  --     postcards_coarse_location_is_rounded's job, not this constraint's — see
  --     the header.
  or (taken_place_name is not null
     and taken_location_precision is not distinct from 'place'
     and taken_latitude is not null
     and taken_longitude is not null
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
  -- (4) A PRECISE PHOTO LOCATION. The camera's own fix, every digit kept. The
  --     NAME may be present and may disagree with the coordinate; that is
  --     deliberate and cosmetic (design.md §D5), because a name cannot reduce
  --     what `precise` already discloses. The direction that must be impossible
  --     is the other one — a `place` row carrying the photo's own fix — and the
  --     rounding CHECK is what makes it so.
  or (taken_latitude is not null
     and taken_longitude is not null
     and taken_location_precision is not distinct from 'precise'
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
  -- (5) A LEGACY ROUNDED PHOTO LOCATION. `064`'s middle mode. The client stops
  --     writing this marker and the database does not enforce that — a stray
  --     one is a correctly shaped, correctly rounded coarse location that no
  --     screen renders (design.md §D9). No name may accompany it: these rows
  --     were written under a meaning that had no name in it.
  or (taken_latitude is not null
     and taken_longitude is not null
     and taken_location_precision is not distinct from 'region'
     and taken_place_name is null
     and taken_latitude >= -90 and taken_latitude <= 90
     and taken_longitude >= -180 and taken_longitude <= 180)
);

-- ---------------------------------------------------------------------------
-- §3. The comment, re-issued to say what is NOT stored
-- ---------------------------------------------------------------------------
-- `028` and `033` exist because a stale comment is worse than none. The "what
-- it is not" half is the load-bearing one here: a provider id beside this name
-- is the obvious next feature and it is the one thing that must not be added.
comment on column public.postcards.taken_place_name is
  'The place the rider NAMED for this photo — prefilled from a reverse lookup of the photo''s coordinate where one exists, typed, or picked from the same typeahead the ride composer uses (072). It is the middle disclosure mode: 064''s ''region'' described a rounded coordinate and this describes a town, which is what a rider actually thinks in. **NO PROVIDER ID IS STORED BESIDE IT, and one must not be added (073).** clubs.location_place_id and rides.start_place_id sit beside a full-precision coordinate the rider chose to publish, so they disclose nothing the row does not; here the neighbouring coordinate is deliberately blunted to 2 decimal places, and a `geoapify:` id resolves through a details lookup to the feature''s exact geometry — it would hand back precisely the precision the rounding exists to remove. AUDIENCE IS THE POSTCARD''S and there is no narrower one — RLS is row-level, so every reader of the row reads this. INSERT-ONLY: no UPDATE grant exists on it, and the remedy for a mis-published location is deleting the postcard. Bounded at 200 by postcards_taken_place_name_length, mirroring clubs_location_name_length against the same producer. Under ''precise'' this name MAY disagree with the coordinate (design.md §D5) — it is a caption, not evidence.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
-- Executed against fpmrimzxadewsaiwpsel (DEV) on 2026-08-20, immediately after
-- this file was applied. PROD (zwprydcyryvudhurbnye) is at `070` and has seen
-- neither `072` nor this file.
--
-- 1. All three grant lists, scoped to their grantee — this file issues no grant
--    statement, so what must be true is that exactly one column left.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated'
--    group by privilege_type;
--
--   INSERT  author_id,caption,club_id,id,image_path,ride_id,taken_at,
--           taken_at_offset_minutes,taken_latitude,taken_location_precision,
--           taken_longitude,taken_place_name                          <-- 12
--   SELECT  author_id,caption,club_id,created_at,id,image_path,taken_at,
--           taken_at_offset_minutes,taken_latitude,taken_location_precision,
--           taken_longitude,taken_place_name,updated_at               <-- 13
--   UPDATE  caption,club_id,image_path      <-- UNMOVED, through two files that
--                                               rewrote the other two lists.
--
--   `ride_id` is on INSERT and NOT on SELECT. Confirmed.
--   `taken_place_id` appears in no list, in no verb: the column is gone.
--
-- 2. anon holds nothing on postcards, in any verb.
--
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='anon';                                            -- 0
--
-- 3. The coupling, as pg_get_constraintdef returns it.
--
--   postcards_taken_location_coupling
--     CHECK ((((taken_place_name IS NULL) AND (taken_latitude IS NULL) AND
--     (taken_longitude IS NULL) AND (taken_location_precision IS NULL)) OR
--     ((taken_place_name IS NOT NULL) AND (taken_location_precision IS NOT
--     DISTINCT FROM 'place'::text) AND (taken_latitude IS NULL) AND
--     (taken_longitude IS NULL)) OR ((taken_place_name IS NOT NULL) AND
--     (taken_location_precision IS NOT DISTINCT FROM 'place'::text) AND
--     (taken_latitude IS NOT NULL) AND (taken_longitude IS NOT NULL) AND
--     (taken_latitude >= ('-90'::integer)::double precision) AND (taken_latitude
--     <= (90)::double precision) AND (taken_longitude >=
--     ('-180'::integer)::double precision) AND (taken_longitude <= (180)::double
--     precision)) OR ((taken_latitude IS NOT NULL) AND (taken_longitude IS NOT
--     NULL) AND (taken_location_precision IS NOT DISTINCT FROM 'precise'::text)
--     AND (taken_latitude >= ('-90'::integer)::double precision) AND
--     (taken_latitude <= (90)::double precision) AND (taken_longitude >=
--     ('-180'::integer)::double precision) AND (taken_longitude <= (180)::double
--     precision)) OR ((taken_latitude IS NOT NULL) AND (taken_longitude IS NOT
--     NULL) AND (taken_location_precision IS NOT DISTINCT FROM 'region'::text)
--     AND (taken_place_name IS NULL) AND (taken_latitude >=
--     ('-90'::integer)::double precision) AND (taken_latitude <= (90)::double
--     precision) AND (taken_longitude >= ('-180'::integer)::double precision)
--     AND (taken_longitude <= (180)::double precision))))
--
--   `postcards_coarse_location_is_rounded` is UNTOUCHED by this file and still
--   reads exactly as `072` left it. The seven CHECK constraints on the table
--   are: postcards_caption_length, postcards_coarse_location_is_rounded,
--   postcards_image_path_is_a_storage_path, postcards_taken_at_is_in_the_past,
--   postcards_taken_at_offset_coupling, postcards_taken_location_coupling,
--   postcards_taken_place_name_length. `postcards_taken_place_id_length` is
--   gone with its column.
--
-- 4. The hole is closed, exercised rather than reasoned about — in a
--    rolled-back transaction on DEV:
--
--   insert into postcards (id, author_id, image_path,
--                          taken_latitude, taken_longitude)
--   values (..., 52.37, 4.9);          -- 23514 under this file
--                                      -- SUCCEEDED under 072
--
-- 5. The legacy rows survived and nothing was rewritten. DEV holds one
--    `'region'` row and six all-NULL rows, unchanged since before `072`, and
--    every one satisfies the new constraint.
--
-- 6. No policy moved. Four policies on `postcards`, none mentioning
--    `taken_place_name`, quals byte-identical to their state before `072`.
--
-- 7. The advisors. `get_advisors(security)` on DEV after applying: ten, the
--    same ten CLAUDE.md §Supabase Rules records. **No new advisor.** This file
--    adds no function, no view and nothing `security definer`.
