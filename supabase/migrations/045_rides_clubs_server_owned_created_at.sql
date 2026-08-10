-- 045: `rides.created_at` and `clubs.created_at` become server-owned, and
--      ownership stops being writable by a grant as well as by a policy. PD-163.
--
-- The second half of PD-163. `044` did `postcards`; this is the half
-- `openspec/changes/add-ride-club-edit-delete/design.md` Q5 assigned to the same
-- issue by name — "fold the rides/clubs half into that issue rather than filing a
-- new one" — and that `src/lib/actions/rides.ts` points at in a code comment.
--
-- ---------------------------------------------------------------------------
-- The measured starting state — read at write time, not inherited
-- ---------------------------------------------------------------------------
-- Measured on fpmrimzxadewsaiwpsel 2026-08-10, from pg_class.relacl and
-- pg_attribute.attacl. **Both tables are at the pre-`041` shape**: everything
-- table-level, nothing per column.
--
--   rides.relacl   authenticated=arwdDxtm/postgres    attacl: null on all 11
--   clubs.relacl   authenticated=arwdDxtm/postgres    attacl: null on all 8
--
-- So `created_at` is writable on both verbs on both tables, and `id`,
-- `organizer_id` and `owner_id` are writable on UPDATE. Same defect as `044`
-- closed, arriving from Supabase's project default rather than from any file
-- here.
--
-- ---------------------------------------------------------------------------
-- What the feed actually sorts on, and why this is still worth doing
-- ---------------------------------------------------------------------------
-- **Neither list sorts on `created_at`.** `src/lib/data/rides.ts` orders
-- `departure_at asc` (a rider-set field, and legitimately so — that IS the
-- product), and `getClubRoster` orders `joined_at`. The one `created_at desc`
-- is `getClubsToExplore` (`src/lib/data/clubs.ts:240`), so on `clubs` this is
-- `044`'s exact defect one screen over: an owner can float their club to the top
-- of Explore for every rider, permanently, by writing one column.
--
-- On `rides` it is **not** a live pinning vector today, and that is stated
-- rather than glossed: no query orders or cursors on `rides.created_at`. It is
-- fixed anyway, for two reasons that are about the schema rather than about
-- today's screens — a falsifiable creation timestamp is a lie in the record
-- whether or not a screen reads it, and the first list that adds "newest rides"
-- would inherit the hole silently. Closing it before there is a reader is the
-- cheap direction.
--
-- ---------------------------------------------------------------------------
-- `updated_at` — the question does not arise, and that is a MEASUREMENT
-- ---------------------------------------------------------------------------
-- **Neither table has an `updated_at` column at all.** Checked in
-- information_schema.columns rather than assumed by symmetry with `postcards`:
--
--   rides   id, title, description, route_description, meeting_point,
--           departure_at, max_riders, is_public, club_id, organizer_id, created_at
--   clubs   id, name, description, is_public, owner_id, created_at,
--           avatar_path, cover_image_path
--
-- So there is no `set_updated_at` trigger on either — `044`'s finding that a
-- column privilege gates the SET list while a BEFORE trigger assigns to NEW
-- afterwards has nothing to apply to here. **This is a gap rather than a
-- decision**: both tables are editable (`updateRide`/`updateClub`, PD-101), and
-- CLAUDE.md's offline convention asks for `updated_at` on anything editable so a
-- sync layer has something to resolve against. Adding the column is additive and
-- is NOT done here, because a new column is a schema change with its own
-- backfill question and this file is a grant change. Recorded so the absence is
-- known rather than discovered.
--
-- ---------------------------------------------------------------------------
-- `id`, `organizer_id` and `owner_id` come out of UPDATE too. The justification
-- ---------------------------------------------------------------------------
-- This goes beyond `created_at`, so it is argued rather than assumed.
--
-- **Ownership is refused today by a policy conjunct and by nothing else.** Both
-- UPDATE policies carry `auth.uid() = organizer_id` / `= owner_id` in their
-- `with check`, so the post-image of a hand-off fails. That works, and it is
-- the same shape `042`'s header rejected on `profiles`:
--
--   "the refusal rests on the ABSENCE OF A POLICY, not on the absence of a
--    grant. That is protection by omission, and omission is not a boundary."
--
-- Here it is one step worse than an absence, because the conjunct exists for a
-- *different* reason — it is there to pin the row to its owner during ordinary
-- edits, not to guard a transfer. The day anyone relaxes a `with check` for an
-- unrelated feature (a club admin editing a member's ride is the obvious one,
-- and `043` already circles it), the transfer capability arrives free, silently,
-- with no line of that migration mentioning ownership. A revoked grant is a
-- second lock that a policy edit cannot open by accident.
--
-- `id` comes out for a smaller reason: nothing names it, re-keying your own row
-- buys nothing a delete-and-recreate does not, and every FK pointing at it is
-- `on update no action`, so the only reachable outcomes are a no-op and a 23503.
--
-- **`id` stays INSERTABLE on both tables**, and that is deliberate rather than
-- an oversight in the list below: it is insertable today, the suite supplies it
-- on fixture rows, and CLAUDE.md requires client-generated UUIDs for anything
-- the client may create offline so a replayed mutation lands as a `23505`
-- instead of a duplicate. `034` and `044` both keep it for that reason.
--
-- **What this costs, stated:** an owner still cannot leave a club they own, and
-- a ride still cannot be handed to another rider. Both were already true —
-- `043`'s suite section asserts them — and this file changes *which layer*
-- refuses, not whether it is refused. The two assertions that measured it are
-- repointed rather than left reading true for a new reason, which is the whole
-- trap: `assert_denied` only recognises 42501, and a grant denial and a policy
-- denial are both 42501. Left alone, those two labels would keep passing while
-- claiming "the WITH CHECK refuses the new row" — a sentence that stops being
-- what is measured the moment this file applies. Both are relabelled and the
-- policy conjuncts are pinned structurally beside them.
--
-- ---------------------------------------------------------------------------
-- The four live write paths, read before the lists were written
-- ---------------------------------------------------------------------------
-- `044` was safe partly because no postcard UPDATE path exists in `src/` at all.
-- That is NOT true here: `updateRide` and `updateClub` shipped in PD-101
-- (`5fd6a17`) hours before this file. Every column each of the four names was
-- read out of the source, not trusted:
--
--   createRide  .insert({ ...rest, departure_at, organizer_id })
--               -> title, description, meeting_point, route_description,
--                  departure_at, max_riders, is_public, club_id, organizer_id
--   updateRide  .update({ ... }) explicit
--               -> title, description, route_description, meeting_point,
--                  departure_at, max_riders, is_public, club_id
--   createClub  .insert({ ...parsed.data, owner_id })
--               -> name, description, is_public, avatar_path, cover_image_path,
--                  owner_id
--   updateClub  .update({ ... }) explicit
--               -> name, description, is_public, avatar_path, cover_image_path
--
-- **Two of the four are SPREADS, not explicit field lists**, and PD-101's own
-- docstrings claim otherwise — `rides.ts:216` and `clubs.ts:300` each say "an
-- explicit field list, never a spread". That is true of the two UPDATE paths and
-- false of the two INSERT paths, so the auditable-payload guarantee those
-- comments offer does not cover `createRide` or `createClub`. It happens not to
-- matter, because a spread of `parsed.data` carries exactly the Zod schema's
-- keys — Zod strips unknown keys by default, and `rideSchema` and `clubSchema`
-- are the closed lists above — but the safety comes from Zod rather than from
-- the payload being written out, which is not what the comments say.
--
-- Every column in all four survives the grants below. Nothing was widened to
-- fit a payload; the two sets simply agree, which is what a per-column grant on
-- a table with a live write path is supposed to demonstrate.
--
-- ---------------------------------------------------------------------------
-- What this file does NOT do
-- ---------------------------------------------------------------------------
--   no policy is touched ..... all eight policies on the two tables are
--       byte-identical afterwards; the suite pins the four UPDATE/SELECT texts
--   no TRUNCATE/REFERENCES/TRIGGER revoke .. `authenticated` holds all three on
--       `rides`, `clubs`, `club_members`, `ride_members` and `profiles` — the
--       Supabase default, which `postcards`, `ride_messages` and `notifications`
--       do not carry. **RLS does not apply to TRUNCATE**, so the grant is real
--       and it is measured, not inferred. It is deliberately NOT fixed here: it
--       is a different defect on a five-table set, two of which this brief puts
--       out of scope, and folding it in would make this a two-defect migration.
--       Reported instead
--   no `updated_at` column ... see above — additive, with its own backfill
--       question
--   nothing on `club_members` or `ride_members` .. `joined_at` orders the club
--       roster and the ride crew off a client-writable column. Out of scope by
--       the brief and filed separately
--
-- Retention and reach are unchanged: no table, no column, no personal data.

-- ---------------------------------------------------------------------------
-- §1. rides
-- ---------------------------------------------------------------------------
-- A table-level revoke clears the column grants with it — measured on this
-- database for `044` and relied on again here, so each verb is one revoke and
-- one grant, and the re-grant list is the whole surface rather than a delta.
--
-- SELECT and DELETE stay table-level and are untouched: `created_at` must stay
-- readable, and `deleteRide` is organizer-scoped by policy.
revoke insert on public.rides from authenticated;
grant insert (id, title, description, route_description, meeting_point,
              departure_at, max_riders, is_public, club_id, organizer_id)
  on public.rides to authenticated;

revoke update on public.rides from authenticated;
grant update (title, description, route_description, meeting_point,
              departure_at, max_riders, is_public, club_id)
  on public.rides to authenticated;

comment on column public.rides.created_at is
  'Server-owned since 045 (PD-163). `authenticated` holds SELECT and neither INSERT nor UPDATE, so the value can only come from `default now()` — a default applies solely when the column is OMITTED, and PostgREST lets a client name it, so the grant is the guarantee and the default is only the value. No query orders or cursors on this column today (the rides list sorts `departure_at asc`), so unlike clubs.created_at this was never a live feed-pinning vector; it is closed because a falsifiable creation timestamp is a lie in the record whether or not a screen reads it, and because the first "newest rides" list would otherwise inherit the hole silently.';

-- ---------------------------------------------------------------------------
-- §2. clubs
-- ---------------------------------------------------------------------------
revoke insert on public.clubs from authenticated;
grant insert (id, name, description, is_public, owner_id,
              avatar_path, cover_image_path)
  on public.clubs to authenticated;

revoke update on public.clubs from authenticated;
grant update (name, description, is_public, avatar_path, cover_image_path)
  on public.clubs to authenticated;

comment on column public.clubs.created_at is
  'Server-owned since 045 (PD-163). `authenticated` holds SELECT and neither INSERT nor UPDATE. This one WAS a live pinning vector: getClubsToExplore (src/lib/data/clubs.ts) orders `created_at desc`, so while the column was writable an owner could float their club to the top of Explore for every signed-in rider, permanently and repeatably, with no moderation path to undo it. 044 closed the same defect on postcards, where the column was the feed sort key and its pagination cursor.';

-- No grant of any kind is issued to `anon` by this file — decision #1, and 007
-- revoked the last of them. Asserted in the suite by naming the role.

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. Both verbs on both tables, scoped to the grantee. A table-wide count reads
--    wrong, because postgres and service_role hold everything by default.
--
--   select table_name, privilege_type,
--          string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name in ('rides','clubs')
--      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE')
--    group by table_name, privilege_type order by table_name, privilege_type;
--   -- clubs INSERT  avatar_path,cover_image_path,description,id,is_public,name,owner_id
--   -- clubs UPDATE  avatar_path,cover_image_path,description,is_public,name
--   -- rides INSERT  club_id,departure_at,description,id,is_public,max_riders,
--   --               meeting_point,organizer_id,route_description,title
--   -- rides UPDATE  club_id,departure_at,description,is_public,max_riders,
--   --               meeting_point,route_description,title
--
-- 2. The columns that must NOT be writable, named by role on both verbs.
--
--   select bool_or(has_column_privilege('authenticated','public.rides',c,p))
--     from unnest(array['created_at']) c, unnest(array['INSERT','UPDATE']) p;  -- f
--   select has_column_privilege('authenticated','public.rides','organizer_id','UPDATE'); -- f
--   select has_column_privilege('authenticated','public.rides','organizer_id','INSERT'); -- t
--   select has_column_privilege('authenticated','public.clubs','owner_id','UPDATE');     -- f
--   select has_column_privilege('authenticated','public.clubs','owner_id','INSERT');     -- t
--
-- 3. The defaults still supply what the grant now reserves, or every insert
--    fails NOT NULL instead of getting a wrong timestamp.  -- both now()
--
-- 4. No policy moved. Eight policies across the two tables; capture the four
--    with a `with check` before applying and compare.
--
-- 5. The four live write paths, run as a real rider in a ROLLED-BACK
--    transaction with the HOSTED idiom (`set local request.jwt.claims`), not the
--    suite's `test.uid`. All four must succeed and every negative must be 42501.
--
-- 6. The advisors. This file adds no function and no view, so DEV must stay at
--    nine — anything else means a revoke did not land.
