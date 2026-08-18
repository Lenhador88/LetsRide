-- 064: a photo's capture time and, if the rider says so, its place. PD-255.
--
-- `openspec/changes/capture-photo-time-and-place/` is the specification; this
-- file is its schema half. Read `proposal.md` before changing anything here —
-- particularly §"Grants: insert-only, and it costs zero statements", which is
-- what makes the absence of an UPDATE statement below deliberate rather than an
-- omission.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
-- `postcards.created_at` is when a postcard was POSTED, and `044` made sure it
-- can never be anything else — the home feed sorts and pages on it, so an author
-- who could write it would pin themselves to the top of every feed permanently.
-- That decision is right and is not reopened here.
--
-- Its cost lands on the ride Journal. A rider who photographs six stops between
-- 09:00 and 17:00 and uploads them over dinner produces six postcards stamped
-- 21:xx, in whatever order the uploads finished. The Journal is the one screen
-- whose entire content is *when did this happen*, and the only column it could
-- sort on is the one `044` took away from the rider.
--
-- The real capture time exists, and so does the place — both in the JPEG's EXIF
-- block, and both for exactly one moment. `src/lib/media/compress.ts` destroys
-- that block as a side effect of the canvas re-encode, which is the app's
-- EXIF-stripping guarantee. So the window is: after the file is picked, before
-- `compressImage` runs. After that there is nothing left to read, ever.
--
-- ---------------------------------------------------------------------------
-- Why this is a privacy change and not a schema chore
-- ---------------------------------------------------------------------------
-- **RLS is row-level.** A policy that lets a rider read the postcard lets them
-- read every GRANTED column on it, so there is no way to show a photo and hide
-- where it was taken. The obvious implementation — store the precise coordinate,
-- add a `show_location boolean`, respect it in the UI — puts every rider's
-- driveway on the server and makes one policy mistake, one widened projection or
-- one future admin screen a disclosure of home addresses.
--
-- So the decision is made BEFORE the request is built, on the device, and the
-- three modes decide what is UPLOADED rather than what is displayed:
--
--   Hide (the default) .. no coordinate leaves the phone. All three columns NULL
--   Region .............. rounded IN THE BROWSER to 2 decimal places (~1.1km)
--   Precise ............. the full value
--
-- **`062`'s reasoning arrives here inverted, and that is the sharpest thing in
-- this file.** `062` revoked SELECT on `postcards.ride_id` because a raw uuid is
-- *comparable* — a viewer who can resolve neither the ride nor its crew could
-- still group postcards by it. A coordinate is comparable AND externally
-- resolvable, which is strictly worse. The mitigation there was a grant; here it
-- cannot be, because the audience of these columns is the audience of the
-- postcard and there is no narrower one available. That is precisely why the
-- whole weight rests on the upload-time choice.
--
-- ---------------------------------------------------------------------------
-- Insert-only, and it costs ZERO statements
-- ---------------------------------------------------------------------------
-- `044`, `046` and `062` between them made all three verbs column-level on
-- `postcards`, so a column added today arrives holding NOTHING. Measured on the
-- applied chain in a rolled-back transaction rather than assumed:
--
--   alter table public.postcards add column probe_col timestamptz null;
--   -- authenticated: select=f insert=f update=f, no grant rows at all
--
-- **So this file issues no UPDATE statement of any kind, and that is the whole
-- mechanism.** Leaving UPDATE alone is what produces the insert-only outcome;
-- *touching* it is `044`/`046`'s trap, where an absolute re-grant list written
-- from a document instead of from the database silently reinstates `id` and
-- `author_id`. The existing assertion that UPDATE is exactly
-- `caption, club_id, image_path` is the proof, and it must stay green.
--
-- The consequence, decided rather than discovered: **a rider who realises they
-- published their driveway has exactly one remedy — delete the postcard.** That
-- is accepted. DELETE is table-level with an `author_id = auth.uid()` policy,
-- the screen exists, and deleting the row destroys the only copy of the
-- coordinate. A "widen or clear, never sharpen" affordance needs a trigger
-- comparing old and new precision plus an edit screen that does not exist —
-- `grep updatePostcard\|editPostcard src/` returns nothing. Filed, not built.
--
-- ---------------------------------------------------------------------------
-- Both grant lists are ABSOLUTE and were read off the database
-- ---------------------------------------------------------------------------
-- Measured on fpmrimzxadewsaiwpsel (DEV) 2026-08-18, from
-- information_schema.column_privileges scoped to grantee `authenticated`:
--
--   INSERT  author_id, caption, club_id, id, image_path, ride_id
--   SELECT  author_id, caption, club_id, created_at, id, image_path, updated_at
--   UPDATE  caption, club_id, image_path
--
-- **PROD reads the same except SELECT still carries `ride_id`, and that is not
-- drift.** PROD is at `059` and `062` is unpromoted; `062` runs before this file
-- in filename order, so the list below is correct on both projects and must NOT
-- be "corrected" to re-add `ride_id` by anyone reading PROD's current state.
--
-- ---------------------------------------------------------------------------
-- What this file does NOT do
-- ---------------------------------------------------------------------------
--   no policy is touched ....... SELECT, INSERT, UPDATE and DELETE on
--       `postcards` are byte-identical afterwards; the suite diffs the quals
--   no trigger ................. `enforce_participation_gate` is already on this
--       table, alongside `postcards_set_updated_at`. The consent gate is covered
--   no index ................... `postcards_ride_id_idx` is
--       `(ride_id, created_at desc) where ride_id is not null` and already cuts
--       a Journal to a handful of rows. Sorting those on `taken_at` is a sort
--       over tens of rows. An index here would serve a query that does not exist
--       at a scale that does not exist
--   no backfill ................ there is no signal to derive a capture time
--       from. Every existing row stays NULL, for ever
--   nothing on the feed ........ `created_at` remains its sort key AND its
--       cursor. `044` is not reopened
--
-- It is additive and inert: nothing hangs off an already-shipped write path, so
-- `036`'s hand-exercise gate does not apply. It may be applied before the code
-- that writes it deploys.
--
-- Retention and reach are unchanged: no new table, and account deletion still
-- reaches every one of these values through `postcards.author_id`'s cascade from
-- `profiles`, because they are columns on `postcards`.

-- ---------------------------------------------------------------------------
-- §1. The columns
-- ---------------------------------------------------------------------------
-- `double precision` and the `latitude`/`longitude` spelling follow `051`, which
-- added exactly those to `rides`. (`places` uses `lat`/`lon`; `rides` is the
-- closer precedent.) The `taken_` prefix is load-bearing: where the photo was
-- taken is not where the postcard was posted, and a bare `latitude` on this
-- table would be read as the second within a year.
alter table public.postcards add column taken_at timestamptz;
alter table public.postcards add column taken_at_offset_minutes smallint;
alter table public.postcards add column taken_latitude double precision;
alter table public.postcards add column taken_longitude double precision;
alter table public.postcards add column taken_location_precision text;

-- ---------------------------------------------------------------------------
-- §2. `taken_at` is BOUNDED because it cannot be OWNED
-- ---------------------------------------------------------------------------
-- `044` closed `created_at` by taking the grant away. That instrument is
-- unavailable here: this value comes from the rider's own file and nowhere else,
-- so the client must be able to write it. When server ownership is impossible,
-- the column gets a CHECK and its readers get told the value is a claim.
--
-- **`now()` in a CHECK is accepted by Postgres and is safe HERE SPECIFICALLY.**
-- The general warning is about dump/restore revalidation — but this predicate
-- only ever becomes MORE true as time passes, so a row that once passed cannot
-- fail later. Exercised, including dropping and re-adding the constraint against
-- rows already stored.
--
-- **The floor is 1995, not 1900, and that is a correction rather than a
-- preference.** `DateTimeOriginal` was introduced with EXIF 1.0 in October 1995,
-- so a value predating the tag's own specification is garbage by construction.
-- A 1900 floor admits both values that actually turn up — the epoch-0 placeholder
-- (`1970-01-01`) and the 1904 Mac epoch — which is the entire population it was
-- written to catch.
--
-- The client clamps out-of-range values to NULL before inserting
-- (`src/lib/media/exif.ts`), so this CHECK is the guarantee and not the thing a
-- rider meets: a garbage EXIF tag costs them a sort key, never their photo.
alter table public.postcards add constraint postcards_taken_at_is_in_the_past check (
  taken_at is null
  or (taken_at <= now() and taken_at >= timestamptz '1995-01-01 00:00:00+00')
);

-- The offset that resolved `taken_at`, in minutes east of UTC — Amsterdam in
-- summer is 120. It exists so the camera's own WALL CLOCK is recoverable from
-- the instant, exactly, by any renderer.
--
-- **Coupled to `taken_at` in both directions.** There is exactly one writer and
-- it always knows an offset — `OffsetTimeOriginal` when the camera wrote one,
-- the device's own offset at that date otherwise — so the coupled shape is free,
-- and it means no reader ever has to guess which zone to draw a bare instant in.
--
-- **The bound is deliberately permissive.** `OffsetTimeOriginal` is `±HH:MM`, so
-- a camera with a wrong setting can legitimately write `+23:00`; the client's
-- clamp is what keeps garbage out. A CHECK tight to the real world (-720..840)
-- would refuse a rider over a camera setting they cannot see.
alter table public.postcards add constraint postcards_taken_at_offset_coupling check (
  (taken_at is null and taken_at_offset_minutes is null)
  or (
    taken_at is not null
    and taken_at_offset_minutes is not null
    and taken_at_offset_minutes >= -1440
    and taken_at_offset_minutes <= 1440
  )
);

-- ---------------------------------------------------------------------------
-- §3. The coordinate triple arrives whole or not at all
-- ---------------------------------------------------------------------------
-- Three nullable columns admit eight states, of which five are nonsense: a
-- latitude with no longitude, coordinates with no precision marker, a marker
-- with no coordinates. Without this, every reader invents its own guess about a
-- half-populated row.
--
-- **This copies `rides_geocode_coupling` (`051`) rather than inventing a second
-- idiom** — the same constraint on the same two column names one table over,
-- coupling a coordinate pair with a third column and carrying identical bounds.
--
-- The precision marker is `'region'` or `'precise'`. NULL is *Hide, or no EXIF
-- location*, and the two are deliberately indistinguishable: a column that told
-- a viewer "this rider chose to hide it" would itself be a disclosure.
alter table public.postcards add constraint postcards_taken_location_coupling check (
  (taken_latitude is null and taken_longitude is null and taken_location_precision is null)
  or (
    taken_latitude is not null
    and taken_longitude is not null
    and taken_location_precision is not null
    and taken_latitude >= -90 and taken_latitude <= 90
    and taken_longitude >= -180 and taken_longitude <= 180
    and taken_location_precision in ('region', 'precise')
  )
);

-- **`Region` must actually BE rounded, and the database is what says so.**
-- CLAUDE.md: no new integrity rule may live only in a Zod schema — and this one
-- especially, because the app is client-rendered and the rounding happens in the
-- browser, so a rider running a patched client could send a precise coordinate
-- under a `region` marker and be drawn on a map as approximate.
--
-- The predicate asks whether the stored value IS at two decimal places, not
-- whether it equals Postgres's own rounding of some original. That distinction
-- is what makes it safe across two languages: JS gives 4.89 for 4.895 and
-- Postgres's numeric round gives 4.90, and both pass, because any `integer / 100`
-- satisfies it. Verified on DEV across a spread of values including that exact
-- halfway case rather than reasoned about.
alter table public.postcards add constraint postcards_region_location_is_rounded check (
  taken_location_precision is distinct from 'region'
  or (
    taken_latitude = round(taken_latitude::numeric, 2)::double precision
    and taken_longitude = round(taken_longitude::numeric, 2)::double precision
  )
);

-- ---------------------------------------------------------------------------
-- §4. INSERT — `044`'s six columns plus these five
-- ---------------------------------------------------------------------------
-- Absolute, per the measurement above. A column omitted from this list holds no
-- privilege, so it is the whole surface rather than a delta.
revoke insert on public.postcards from authenticated;
grant insert (
  id, author_id, club_id, image_path, caption, ride_id,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision
) on public.postcards to authenticated;

-- ---------------------------------------------------------------------------
-- §5. SELECT — `062`'s seven columns plus these five, and still no `ride_id`
-- ---------------------------------------------------------------------------
-- The grant is issued now even though nothing renders a coordinate yet, for two
-- reasons that are decisions rather than habit: a rider must be able to read
-- back what they published, and the Journal's `order by taken_at` needs the
-- column privilege — Postgres checks a column reference in an ORDER BY exactly
-- as in a target list, which is the same thing `062` measured for a predicate.
--
-- `ride_id` stays out. `062` is the file that took it out and its reasoning is
-- unchanged; re-adding it here would be a silent revert of a shipped decision.
revoke select on public.postcards from authenticated;
grant select (
  id, author_id, club_id, image_path, caption, created_at, updated_at,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision
) on public.postcards to authenticated;

-- No grant of any kind is issued to `anon` — decision #1, and `007` revoked the
-- last of them. Asserted in the suite by naming the role.
--
-- **UPDATE is deliberately absent from this file.** See the header.

-- ---------------------------------------------------------------------------
-- §6. The column comments
-- ---------------------------------------------------------------------------
-- A database comment is the `data` agent's first read via `list_tables`, and it
-- is the one piece of documentation no edit to CLAUDE.md can reach — `028` and
-- `033` exist for exactly this.
comment on column public.postcards.taken_at is
  'When the PHOTO was taken, from EXIF DateTimeOriginal, read client-side immediately before src/lib/media/compress.ts strips the EXIF block (PD-255, 064). Not to be confused with created_at, which is when the postcard was POSTED and is server-owned since 044. Unlike created_at this is CLIENT-WRITTEN and cannot be otherwise — the value exists only in the rider''s file — so it is BOUNDED rather than owned: postcards_taken_at_is_in_the_past refuses a future value (which would pin a photo to the top of a ride Journal) and anything before 1995, the year DateTimeOriginal was specified. Treat it as a claim, never as evidence. NULL is ordinary and common: HEIC, screenshots and anything already through another app''s share sheet carry nothing.';

comment on column public.postcards.taken_at_offset_minutes is
  'The UTC offset taken_at was resolved with, in minutes east of UTC (Amsterdam in summer is 120). Added by 064 so the camera''s own WALL CLOCK is recoverable from the instant exactly, by any renderer, rather than being drawn in whatever zone a formatter happens to be pinned to. Sourced from EXIF OffsetTimeOriginal when the camera wrote one, and from the uploading device''s offset at that date otherwise. Coupled to taken_at in both directions by postcards_taken_at_offset_coupling — there is one writer and it always knows an offset, and a bare instant would leave every reader guessing.';

comment on column public.postcards.taken_latitude is
  'Where the photo was taken, AS THE RIDER CHOSE TO DISCLOSE IT (PD-255, 064). The composer offers Hide (the default — no coordinate leaves the device), Region (rounded to 2 decimal places IN THE BROWSER, ~1.1km) and Precise. The mode decides what is UPLOADED, never what is displayed: RLS is row-level, so a policy that lets a rider read this postcard lets them read this column, and storing a precise value behind a "do not show" flag would put every rider''s driveway on the server. There is no server-side copy of a hidden location because none is ever sent. NULL and "the rider chose Hide" are deliberately indistinguishable.';

comment on column public.postcards.taken_longitude is
  'See postcards.taken_latitude. Coupled to it and to taken_location_precision by postcards_taken_location_coupling — all three or none, plus the range bounds — copying rides_geocode_coupling''s shape from 051.';

comment on column public.postcards.taken_location_precision is
  '''region'' or ''precise'', matching what the rider chose in the composer, or NULL for Hide AND for a photo that carried no location — the two are indistinguishable on purpose, since a marker saying "this rider hid it" would itself be a disclosure. postcards_region_location_is_rounded enforces that a ''region'' row really is at 2 decimal places, because the rounding happens in a browser this app does not control and a patched client could otherwise have a precise coordinate drawn as approximate.';

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. Both grant lists, scoped to their grantee. `015`'s footer counted a
--    privilege table-wide and read 2 against a correct database, because
--    postgres and service_role hold everything by Supabase default.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated'
--    group by privilege_type;
--   -- INSERT author_id,caption,club_id,id,image_path,ride_id,taken_at,
--   --        taken_at_offset_minutes,taken_latitude,taken_location_precision,
--   --        taken_longitude
--   -- SELECT author_id,caption,club_id,created_at,id,image_path,taken_at,
--   --        taken_at_offset_minutes,taken_latitude,taken_location_precision,
--   --        taken_longitude,updated_at
--   -- UPDATE caption,club_id,image_path          <-- UNCHANGED. If this moved,
--   --                                                this file touched UPDATE
--   --                                                and walked into 044/046's
--   --                                                trap.
--
-- 2. No write verb reaches the new columns.
--
--   select bool_or(has_column_privilege('authenticated','public.postcards',c,'UPDATE'))
--     from unnest(array['taken_at','taken_at_offset_minutes','taken_latitude',
--                       'taken_longitude','taken_location_precision']) c;   -- f
--
-- 3. anon holds nothing, on any column, in any verb.
--
--   select bool_or(has_column_privilege('anon','public.postcards',c,p))
--     from unnest(array['taken_at','taken_at_offset_minutes','taken_latitude',
--                       'taken_longitude','taken_location_precision']) c,
--          unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p;        -- f
--
-- 4. The four constraints exist.
--
--   select conname from pg_constraint where conrelid='public.postcards'::regclass
--     and contype='c'
--     and conname in ('postcards_taken_at_is_in_the_past',
--                     'postcards_taken_at_offset_coupling',
--                     'postcards_taken_location_coupling',
--                     'postcards_region_location_is_rounded');
--
-- 5. No policy moved. Capture before applying and compare — this file changes
--    grants and constraints only.
--
--   select cmd, md5(coalesce(qual,'')), md5(coalesce(with_check,''))
--     from pg_policies where schemaname='public' and tablename='postcards';
--
-- 6. The advisors. This file adds no function, no view and nothing
--    `security definer`, so the count must not move. Anything new means
--    something landed that this file did not describe.
--
-- 7. The compose path. `createPostcard` names the five new columns on INSERT and
--    no other client write touches them — grepped across src/lib/actions/ and
--    src/lib/data/ before this file was written. The RLS suite's existing
--    `insert into postcards (...)` fixtures name none of them, which is why they
--    keep working: the columns are nullable and the coupling CHECKs allow the
--    all-NULL shape.
