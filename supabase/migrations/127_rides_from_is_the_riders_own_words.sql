-- 127: "where you ride from" becomes the rider's own words. PD-476.
--
-- Specification: `openspec/changes/rides-from-and-town-from-device/` —
-- `design.md` §D1 (why a new column rather than a looser `location`), §D2 (why
-- SELECT and UPDATE but not INSERT), §D3 (the bound).
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT "MAKE `location` FREE TEXT"
-- ---------------------------------------------------------------------------
-- `profiles.location` is the placed town. Both of its writers (`setHomeTown`,
-- `setRiderTown`) require a pick, and it is the second source in
-- `resolveRiderLocation`'s chain: `resolveFromProfile` geocodes it, and the
-- result drives every "near you" list and the typeahead's proximity bias.
-- Loosening it would let a rider overwrite their own position with a string
-- that geocodes to nothing — PD-425's defect in a new shape. So the attribute
-- gets its own column, and `location` and the chain are untouched.
--
-- ---------------------------------------------------------------------------
-- ORDERING — apply BEFORE the bundle that writes it serves
-- ---------------------------------------------------------------------------
-- Additive only, so it is a no-op for the bundle serving today. The reverse
-- order breaks more than the save: the new bundle also READS the column through
-- `OWN_PROFILE_COLUMNS` and `VIEWED_PROFILE_COLUMNS`, so both profile screens
-- land on their error boundary, and every profile save answers `PGRST204`.
-- Same order on PROD: this file, then the promotion.

-- --- §1  The column -------------------------------------------------------
-- Nullable, no DEFAULT, no backfill. NULL means the rider has not written the
-- line, and nothing may fill it in for them — not onboarding, not a copy of
-- `location`.
alter table public.profiles
  add column rides_from text;

-- `018`'s bound (100), with a stricter floor: `018` tests
-- `length(btrim(location)) >= 1`, and `btrim` with no second argument strips
-- SPACES only, so a tab or a newline alone passes it. `~ '\S'` asks for one
-- non-whitespace character of any kind. The client maps a cleared field to
-- NULL, so it never sends what this refuses.
alter table public.profiles
  add constraint profiles_rides_from_length
  check (rides_from is null or (rides_from ~ '\S' and length(rides_from) <= 100));

comment on column public.profiles.rides_from is
  'Where the rider says they ride from, in their own words (127, PD-476). Free text, shown on the profile header in place of the placed town when set. It is NEVER a position: nothing geocodes it, nothing measures a distance from it, and nothing may fall back to it when `location` is NULL — `location` is the only stored position. NULL until the rider writes it; never pre-filled or backfilled.';

-- --- §2  Grants — a bare additive widening of `025`'s allowlist ------------
-- `025` holds `profiles` to column allowlists, so a new column is invisible to
-- `authenticated` until it is granted. One privilege per statement, for `113`
-- §4's reason: a column list attaches only to the privilege right before it,
-- so `grant select, update (rides_from)` would grant SELECT table-wide.
--
-- No INSERT: the row is created by the auth trigger and no client path inserts
-- or upserts a profile, so an INSERT grant would widen a list with no caller.
-- No `anon` grant, ever (decision #1).
--
-- Readable by other riders on purpose — `/profile/detail` draws it — and the
-- `profiles` SELECT policy's block test covers it like every other column.
-- `001`'s UPDATE policy (`auth.uid() = id`) binds it to the rider's own row.
grant select (rides_from) on public.profiles to authenticated;
grant update (rides_from) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — scoped to the grantee; `postgres` and `service_role` hold
-- everything by default.
-- ---------------------------------------------------------------------------
--   select has_column_privilege('authenticated','public.profiles','rides_from','select'),  -- t
--          has_column_privilege('authenticated','public.profiles','rides_from','update'),  -- t
--          has_column_privilege('authenticated','public.profiles','rides_from','insert'),  -- f
--          has_column_privilege('anon','public.profiles','rides_from','select'),           -- f
--          has_table_privilege('authenticated','public.profiles','select');                -- f
