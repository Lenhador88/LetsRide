-- A club carries its own location (PD-259), so Explore can say "near you".
--
-- Product owner, 2026-08-17: *"we need a places reference!"* — and the club's
-- location is the CLUB's, never the creator's: *"the club location is not the
-- location of the rider who created it."* So this is four columns filled from
-- a picked `public.places` row, not a copy of `profiles.location`.
--
-- ---------------------------------------------------------------------------
-- Why there is NO foreign key to public.places, and why that is not laziness
-- ---------------------------------------------------------------------------
-- `places` is reference data reloaded WHOLESALE: `scripts/places/load.sql` is
-- one transaction holding a `delete`, the `\copy` and an `analyze`. A foreign
-- key from `clubs` would take one of two shapes and both are worse than none:
--
--   * `on delete restrict` (or no action) — the `delete` at the top of every
--     reload fails the moment one club references one row, so the index can
--     never be refreshed again. Overture releases monthly.
--   * `on delete cascade`/`set null` — the reload silently wipes the location
--     of every club whose place happens not to survive into the new release,
--     with no error anywhere and nothing to notice it by.
--
-- So the GERS id is stored as plain `text`, alongside a DENORMALISED copy of
-- the name and the coordinates. `051` did exactly this for `rides` and the copy
-- is the POINT rather than a shortcut: a club's location is what it was when
-- somebody chose it, and it must not change because a data vendor re-cut a
-- polygon.
--
-- The consequence to hold: `location_place_id` can dangle, and nothing in the
-- database will ever tell you. Read it as provenance — "this is the row that
-- was picked" — never as a join key.
--
-- ---------------------------------------------------------------------------
-- Visibility: there is nothing to write here, and that IS the answer
-- ---------------------------------------------------------------------------
-- The columns live on `clubs`, so `001`'s SELECT policy governs them exactly as
-- it governs `name` and `description`. A private club's location is visible to
-- its members and to nobody else, for free, because it is not a separate row
-- with a separate predicate. **Adding a policy here would be the bug** — it
-- could only widen what is already correct.
--
-- Explore reads `is_public = true`, so a private club's coordinates never reach
-- a stranger's device even as an anonymous distance.

-- ---------------------------------------------------------------------------
-- §1. The columns
-- ---------------------------------------------------------------------------

alter table public.clubs add column location_name text;
alter table public.clubs add column location_place_id text;
alter table public.clubs add column latitude double precision;
alter table public.clubs add column longitude double precision;

comment on column public.clubs.location_name is
  'Where the club is based, as the rider picked it from public.places (066, PD-259). A DENORMALISED copy of the place''s label, not a join — see this migration''s header for why there is no FK. NULL is the normal state: location is optional at create and every club that predates 066 has none.';

comment on column public.clubs.location_place_id is
  'The Overture GERS id of the picked place (066). Provenance, never a join key: `places` is reloaded wholesale, so this can dangle and nothing will say so. `text` rather than `uuid` because GERS ids are documented as opaque strings and only happen to be UUID-shaped today — same reasoning as places.id.';

comment on column public.clubs.latitude is
  'Latitude of the club''s location, copied from the picked place (066). Filled at write time and never recomputed, so it stays what it was when somebody chose it. Coupled to the other three by clubs_location_coupling: all four NULL or all four present.';

comment on column public.clubs.longitude is
  'Longitude of the club''s location. See latitude.';

-- ---------------------------------------------------------------------------
-- §2. The integrity rules, in the database rather than in Zod
-- ---------------------------------------------------------------------------
-- CLAUDE.md's rule: "No new integrity rule may live only in a Zod schema."
-- A rider drives the browser, so a client-side check is a suggestion. Three
-- things must hold whatever the client does:

-- 1. All four together or none. A half-written location is the shape that
--    breaks callers: a name with no coordinates renders on a card and is
--    invisible to the distance filter, and coordinates with no name filter
--    correctly and render as a blank line.
alter table public.clubs add constraint clubs_location_coupling check (
  (location_name is null
     and location_place_id is null
     and latitude is null
     and longitude is null)
  or (location_name is not null
     and location_place_id is not null
     and latitude is not null
     and longitude is not null
     and latitude >= -90 and latitude <= 90
     and longitude >= -180 and longitude <= 180)
);

-- 2. Bounds on the two text columns, for the reason `018` added them to
--    `profiles`: `001` declares `clubs.name` and `description` as bare `text`,
--    so the table would take a megabyte in a column a card renders on one line.
--    200 is generous against the longest label `search_places()` can return
--    (a name plus a street plus a locality) and small enough that no card
--    layout has to defend against it.
alter table public.clubs add constraint clubs_location_name_length check (
  location_name is null or char_length(location_name) <= 200
);

-- 3. A GERS id is opaque but it is not unbounded, and it is the field a client
--    controls most directly — nothing stops a rider posting a novel here.
alter table public.clubs add constraint clubs_location_place_id_length check (
  location_place_id is null or char_length(location_place_id) <= 100
);

-- ---------------------------------------------------------------------------
-- §3. Grants — ADDITIVE, never a re-stated list
-- ---------------------------------------------------------------------------
-- `045` revoked table-wide INSERT and UPDATE on `clubs` from `authenticated`
-- and granted an explicit column list, and `058` revoked `is_default` from
-- both. A column added after those grants is NOT writable until it is named,
-- which is the allowlist working as designed.
--
-- **These are additive `grant` statements, deliberately not a re-issued list.**
-- `044`/`046` are this repo's worked example of the alternative going wrong:
-- two files each issuing an absolute `revoke` + `grant` list, where running
-- them out of order silently reinstates a column the later one removed, with no
-- error and nothing red. An additive grant cannot do that.
--
-- `created_at` and `is_default` stay unwritable — nothing here names them.

grant insert (location_name, location_place_id, latitude, longitude)
  on public.clubs to authenticated;

grant update (location_name, location_place_id, latitude, longitude)
  on public.clubs to authenticated;

-- No grant of any kind to `anon` — decision #1, and `007` revoked the last one.

-- ---------------------------------------------------------------------------
-- §4. No index, and that is a decision rather than an omission
-- ---------------------------------------------------------------------------
-- The obvious move is a btree on (latitude, longitude), mirroring `037`'s on
-- `places`. It is not added, because the shapes are not alike: `places` holds
-- 736,538 rows and is scanned per keystroke, while `clubs` holds tens and the
-- Explore read is already bounded to the newest `CLUBS_PAGE_SIZE` public clubs
-- and computes distance client-side over that page (see `getExploreClubs`).
-- An index on a table this size is not read by the planner anyway, and an index
-- nothing uses is a write cost and a thing to keep in step.
--
-- **The trigger for adding one is a SQL-side distance predicate**, which is
-- what a club count in the thousands would force. Add it with that change, not
-- before it.

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The grants, SCOPED TO THE GRANTEE. A table-wide count reads wrong,
--    because postgres and service_role hold everything by Supabase default —
--    the mistake `015`'s footer made and documented.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='clubs'
--      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE')
--    group by privilege_type order by privilege_type;
--   -- INSERT  avatar_path,cover_image_path,description,id,is_public,latitude,
--   --         location_name,location_place_id,longitude,name,owner_id
--   -- UPDATE  avatar_path,cover_image_path,description,is_public,latitude,
--   --         location_name,location_place_id,longitude,name
--
-- 2. The coupling actually refuses a half-written location, as the caller
--    rather than as the owner:
--
--   -- expect 23514 on each of these three
--   update public.clubs set location_name = 'Utrecht' where id = '<some club>';
--   update public.clubs set latitude = 52.09 where id = '<some club>';
--   update public.clubs set location_name = 'Utrecht', location_place_id = 'x',
--          latitude = 91, longitude = 5.12 where id = '<some club>';
--
-- 3. And that a complete one is accepted:
--
--   update public.clubs
--      set location_name = 'Utrecht', location_place_id = '<gers id>',
--          latitude = 52.09, longitude = 5.12
--    where id = '<some club you own>';
