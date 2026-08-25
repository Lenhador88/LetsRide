-- 074: a postcard's named place carries a country too — the flag half of
--      PD-279, `072`/`073`'s town name beside it.
--
-- ---------------------------------------------------------------------------
-- What this is
-- ---------------------------------------------------------------------------
-- `search-places` already returns `country_code` on the same GeoJSON
-- `properties` object `toPlaceResult` reads for the label and the coordinate —
-- the vendor's own two-letter code, stored VERBATIM rather than parsed out of
-- the place name, which `PD-279` rejected explicitly (a name is free text a
-- rider may edit or truncate; a coordinate reverse-geocoded from EXIF has none
-- of that risk). The composer writes it beside `taken_place_name`, only ever
-- from a PICKED or reverse-geocoded result — a typed-and-never-picked name
-- carries no vendor data at all, so it carries no country either.
--
-- **Uppercased to match this schema's one other country column.** `014`'s
-- `profile_countries_code_is_iso_alpha2` is `^[A-Z]{2}$` and `020` went further
-- and rejected `'nl'` outright as an unknown code — so a lowercase value here
-- would be the one place in the schema where "country code" means something
-- different. The vendor's own documented casing is lowercase; the client
-- (`search-places/shape.ts`'s `toPlaceResult`) uppercases before this column
-- ever sees the value, and this CHECK is what holds that true against a client
-- this app does not control — the same relationship `postcards_coarse_
-- location_is_rounded` has to the browser's own rounding.
--
-- ---------------------------------------------------------------------------
-- Why this is NOT derived from `taken_latitude`/`taken_longitude`
-- ---------------------------------------------------------------------------
-- Product owner, explicitly, in the proposal review: reverse-geocoding the
-- stored coordinate at READ time would spend a second vendor credit — against
-- the same metered ceiling `069` protects — for every render of every
-- postcard that carries a place, on every viewer's every load. Storing the
-- code once, at the moment the rider already paid for the lookup that named
-- the place, is free by comparison and is what `taken_place_name` itself
-- already does for the town.
--
-- ---------------------------------------------------------------------------
-- Why this is column-and-CHECK rather than folded into
-- `postcards_taken_location_coupling`
-- ---------------------------------------------------------------------------
-- `072`/`073`'s five-arm coupling decides whose COORDINATE is stored and how
-- coarse it is; a country is neither. Widening that constraint to a sixth
-- column multiplies its arms for a value that is cosmetic exactly the way
-- `taken_place_name` is cosmetic under `precise` (`073`'s comment) — a label,
-- not evidence, and not a fact the coordinate's precision depends on. What
-- IS enforced below is the one shape that would be a bug rather than a
-- possibility: a country with no name to describe. `PostcardCard` draws the
-- flag immediately before the town and never on its own, so a row carrying a
-- country and no name would store a value nothing can ever render.
--
-- ---------------------------------------------------------------------------
-- No new visibility, no trigger, no index, no backfill
-- ---------------------------------------------------------------------------
-- Same reasoning as `072`'s header, restated rather than re-derived: the
-- column sits on `postcards`, RLS is row-level, and the existing SELECT policy
-- is the whole audience — exactly the riders who can already read the row can
-- read the country, and nobody else. No trigger hangs off this write path
-- (`enforce_participation_gate` and `postcards_set_updated_at` are already on
-- the table, so `036`'s hand-exercise gate does not apply), nothing sorts or
-- filters on the column, and no backfill runs — every row written before this
-- file holds NULL here, forever, exactly as every row written before `072`
-- holds a NULL place name.
--
-- ---------------------------------------------------------------------------
-- Grants — ABSOLUTE lists, read off `072`/`073`'s own footer plus this column
-- ---------------------------------------------------------------------------
-- `044`/`046`'s lesson: an absolute re-grant list is how a shipped decision
-- gets silently reverted if it is copied from anywhere other than the last
-- file that actually issued one. This one is copied from `073`'s own
-- §Verification footer (12 INSERT, 13 SELECT, `taken_place_id` and `ride_id`
-- both absent from SELECT) with exactly one column added to each.
--
-- **No UPDATE statement of any kind, matching `072`/`073`.** The column
-- arrives holding nothing because UPDATE is not touched, not because it is
-- explicitly revoked — touching it is `044`/`046`'s trap. The remedy for a
-- mis-published country is the same as for a mis-published town: delete the
-- postcard.
alter table public.postcards add column taken_country_code text;

alter table public.postcards add constraint postcards_taken_country_code_is_iso_alpha2 check (
  taken_country_code is null or taken_country_code ~ '^[A-Z]{2}$'
);

-- The one shape this file refuses beyond the format itself: a country with
-- nothing for `PostcardCard` to draw it beside. Every producer already
-- satisfies this — the composer only ever sets a country alongside a name it
-- came from the same lookup with — so this is a guarantee against a patched
-- client rather than a rule the honest one needs telling.
alter table public.postcards add constraint postcards_taken_country_code_needs_a_place check (
  taken_country_code is null or taken_place_name is not null
);

revoke insert on public.postcards from authenticated;
grant insert (
  id, author_id, club_id, image_path, caption, ride_id,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision, taken_place_name, taken_country_code
) on public.postcards to authenticated;

revoke select on public.postcards from authenticated;
grant select (
  id, author_id, club_id, image_path, caption, created_at, updated_at,
  taken_at, taken_at_offset_minutes, taken_latitude, taken_longitude,
  taken_location_precision, taken_place_name, taken_country_code
) on public.postcards to authenticated;

comment on column public.postcards.taken_country_code is
  'The ISO-3166-1 alpha-2 country of taken_place_name, from search-places'' own `country_code` property — vendor data stored VERBATIM, never parsed out of the name (PD-279). Set only alongside a PICKED or reverse-geocoded place; a typed-and-never-picked name carries no vendor data and no country. Uppercased before it reaches this column, matching profile_countries'' `^[A-Z]{2}$` (014/020) rather than the vendor''s own lowercase. AUDIENCE IS THE POSTCARD''S, exactly as taken_place_name — RLS is row-level. INSERT-ONLY: no UPDATE grant, same remedy as the name it describes. postcards_taken_country_code_needs_a_place refuses a country with no name for PostcardCard to draw it beside; it is deliberately NOT folded into postcards_taken_location_coupling, because a country is cosmetic exactly as the name is under `precise` — a label, not evidence the coordinate''s precision depends on.';

-- ---------------------------------------------------------------------------
-- §Verification — run against DEV after applying, do not assume
-- ---------------------------------------------------------------------------
-- 1. All three grant lists, scoped to `authenticated`.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated'
--    group by privilege_type;
--
--   INSERT  author_id,caption,club_id,id,image_path,ride_id,taken_at,
--           taken_at_offset_minutes,taken_country_code,taken_latitude,
--           taken_location_precision,taken_longitude,taken_place_name   <-- 13
--   SELECT  author_id,caption,club_id,created_at,id,image_path,taken_at,
--           taken_at_offset_minutes,taken_country_code,taken_latitude,
--           taken_location_precision,taken_longitude,taken_place_name,
--           updated_at                                                  <-- 14
--   UPDATE  caption,club_id,image_path      <-- UNMOVED, through three files
--                                               that rewrote the other two.
--
-- 2. No write verb reaches the new column.
--
--   select bool_or(has_column_privilege('authenticated','public.postcards',
--     'taken_country_code', v)) from unnest(array['UPDATE']) v;          -- f
--
-- 3. anon holds nothing, on any column, in any verb (unchanged from 072/073,
--    reasserted because this file re-issues both re-grant lists).
--
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='anon';                                              -- 0
--
-- 4. The advisors. `get_advisors(security)` on DEV after applying: ten, the
--    same ten CLAUDE.md §Supabase Rules records. No new advisor — this file
--    adds no function, no view and nothing `security definer`.
