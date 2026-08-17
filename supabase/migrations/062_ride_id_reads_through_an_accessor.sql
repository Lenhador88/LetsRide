-- 062: `postcards.ride_id` stops being client-readable. The Journal reads it
--      through an accessor instead.
--
-- Linear PD-166, decided by the product owner on 2026-08-17 as **option A** of
-- the fork that issue was filed to hold open. Specification:
-- openspec/changes/tag-postcards-to-rides/specs/ride-journal/spec.md.
--
-- ---------------------------------------------------------------------------
-- What was actually open, and why a select list did not close it
-- ---------------------------------------------------------------------------
-- `041` shipped `postcards.ride_id` with SELECT left table-level, so every
-- signed-in rider could read the raw uuid off every postcard the SELECT policy
-- already allows them — and a raw uuid is *comparable*. Two postcards carrying
-- the same `ride_id` say "these were the same ride" to a viewer who can resolve
-- neither the ride nor its crew. `club_id` decides who sees a row; `ride_id`
-- was quietly telling them how the rows group.
--
-- PD-165 removed the column from `POSTCARD_SELECT`, and that is **payload
-- hygiene, not a boundary**: the browser holds the publishable key and talks to
-- PostgREST directly, so `GET /rest/v1/postcards?select=id,ride_id` returned it
-- regardless of what this app's own queries asked for. `src/lib/data/columns.ts`
-- already states the general rule this file is the second worked example of —
-- *a column-level revoke against a table-level grant is a documented no-op* —
-- and `021`/`025` is the first.
--
-- ---------------------------------------------------------------------------
-- Why this could not simply be revoked: the Journal wants the same privilege
-- ---------------------------------------------------------------------------
-- **Postgres checks SELECT on a column to FILTER on it, not only to return
-- it.** So the planned Journal read — `.eq('ride_id', rideId)`, `tasks.md` 4.2 —
-- needs exactly the grant the exposure needs. Revoking closes the channel and
-- breaks the Journal in one stroke, which is why `rls_test.sql` asserted the
-- grant true **on purpose**, labelled *"or the Journal query could not filter on
-- it"*. That assertion is inverted rather than deleted in this change: it is the
-- record of why the grant existed, and this file is the answer to it.
--
-- The accessor below is what replaces the filter. `authenticated` loses the
-- column; the Journal gains a function that holds it.
--
-- ---------------------------------------------------------------------------
-- `public`, NOT `private` — 031's lesson, and it is not optional here
-- ---------------------------------------------------------------------------
-- `029` put a worker in `private` and nothing could ever call it: **PostgREST
-- routes only to `public`**, and `service_role` holds no USAGE on `private`, so
-- supabase-js's `.schema('private')` is refused before it reaches Postgres.
-- `031` exists to move it. This accessor is called by the browser, so `private`
-- would ship a Journal that cannot load, silently, with the suite green —
-- because the suite runs as the table owner, for whom neither barrier exists.
--
-- ---------------------------------------------------------------------------
-- IT RETURNS IDS, NOT ROWS — and that is the safety argument, not a shortcut
-- ---------------------------------------------------------------------------
-- A `security definer` function runs as its owner, so RLS on `postcards` does
-- not apply inside it and its visibility filter is a RESTATEMENT of the SELECT
-- policy (see below). A restatement can drift. Returning ids rather than rows
-- bounds what drift can cost:
--
--   * the caller reads the postcards themselves, through the ordinary
--     `POSTCARD_SELECT` path, **under their own RLS** — so RLS stays the single
--     authority on CONTENT, and a too-permissive restatement here still returns
--     nothing extra to render;
--   * what the restatement is load-bearing for is the CORRELATION — which ids
--     are tagged to this ride — which is the whole channel PD-166 is about.
--
-- It also keeps this file out of the business of reproducing the postcard
-- projection (author embed, like counts, signed image URLs) in SQL.
--
-- ---------------------------------------------------------------------------
-- The two visibility conjuncts, and which one is a restatement
-- ---------------------------------------------------------------------------
--   * **The ride** is `private.can_read_ride(auth.uid(), ride)` — `060`'s
--     helper, already the fenced restatement of `rides` SELECT and already
--     pinned textually by the suite (060.1). Nothing new is restated for it.
--
--     It is here for `041`'s reason, in the read direction: a Journal that
--     answered for a ride the caller cannot see would hand back exactly the
--     grouping this change removes, to anyone holding the id. `041`'s INSERT
--     gate took the same line — "a FK is validated with RLS bypassed" — and the
--     symmetry is deliberate.
--
--   * **The postcards** are a restatement of `011`'s `postcards` SELECT `qual`,
--     inline below, reusing the policy's own helpers rather than inlining what
--     they do. `060` §060.1 argues the general case and this file adopts its
--     fence: the suite pins that `qual` as WHOLE TEXT, labelled with this
--     function's name, so a policy rewrite fails there and arrives here.
--
--     `041` had already pinned the same `qual` by md5. Both stay — the md5 line
--     is `041`'s account of "the SELECT policy is not touched by this file", the
--     text line is this file's "and here is what the accessor copies".
--
-- No `private.can_read_postcard(candidate, …)` is added. `060` split its
-- membership helper because a FAN-OUT needs the answer for somebody else; this
-- accessor only ever needs it for the caller, and the deferred
-- `postcard_on_ride` notification (`041` §Not built here) is where that split
-- earns its place if it is ever built.
--
-- ---------------------------------------------------------------------------
-- What this file does NOT do, each with its reason
-- ---------------------------------------------------------------------------
--   the INSERT grant on ride_id .. untouched, and PD-256 needs it: a postcard
--       is tagged once, at INSERT. Note the consequence for whoever writes it —
--       the insert may not RETURN the column, so `.select('id')` is fine and a
--       bare `.select()` asking for the full representation is `42501`
--   the UPDATE grant .. still absent, `041` §3. Unchanged in both directions
--   the SELECT POLICY .. not touched, in either direction. `ride_id` still
--       appears nowhere in it; `club_id` is still the whole audience. This file
--       changes a GRANT, which is the other mechanism entirely, and `041`'s
--       md5 pin of the policy text is what proves it
--   a `ride_id` badge on a feed postcard .. no longer possible client-side, and
--       stated rather than discovered: any screen wanting "this photo belongs to
--       a ride" now needs its own accessor, because the column is unreadable
--       even on a row the viewer owns. Nothing in the design draws one today
--   pagination on the accessor .. a ride's Journal is bounded by one ride's
--       postcards, and PD-257 has not specified a page size. The index `041`
--       created — `(ride_id, created_at desc)` — already serves the ordering
--
-- ---------------------------------------------------------------------------
-- Ordering relative to the deploy: additive first is NOT available here
-- ---------------------------------------------------------------------------
-- `021`/`025` had to be split because the accessor and the revoke that makes it
-- necessary apply at different times relative to the code deploy. **This file
-- needs no split**, and the reason is that nothing deployed reads the column:
-- `POSTCARD_SELECT` dropped it in PD-165 and no other query names it
-- (`columns.test.ts` pins both halves). So the revoke can land before, with or
-- after its code, and the accessor has no caller until PD-257 writes one.
--
-- That is a property of this moment rather than of the shape, and it is exactly
-- the moment PD-166 identified as the last cheap one: after PD-256 writes a
-- first `ride_id` and PD-257 ships a screen against the raw column, this is an
-- API change to a live surface instead of a grant nobody was using.

-- ---------------------------------------------------------------------------
-- §1. The grant — revoke table-level SELECT, re-grant it per column
-- ---------------------------------------------------------------------------
-- The seven columns below are `postcards`' full column list on 2026-08-17,
-- read off fpmrimzxadewsaiwpsel in the session this file was written, MINUS
-- `ride_id`. Omitting one silently makes it invisible to the app, and the
-- failure surfaces as a screen on the error boundary rather than as anything
-- traceable to a migration — so the suite asserts all seven individually, and
-- `columns.test.ts` pins this list against `POSTCARD_SELECT` from the client
-- side. That is `025`'s standing cost, adopted here: **a column added to
-- `postcards` from now on is unreadable by `authenticated` until it is added
-- to this list.**
--
-- INSERT and DELETE stay table-level and are untouched. UPDATE is already
-- per-column (`041`, narrowed by `044` and `046`) and is untouched too.
revoke select on public.postcards from authenticated;
grant select (id, author_id, club_id, image_path, caption, created_at, updated_at)
  on public.postcards to authenticated;

-- No grant of any kind is issued to `anon` — decision #1, and `007` revoked the
-- last of them. The suite asserts `anon` still holds nothing here.

-- `041` put the per-column contract in `pg_description` and it names the grant
-- this file revokes: *"authenticated holds SELECT and INSERT on this column"*.
-- A column comment is where this repo states that contract — `009`, `041` and
-- `058` all do — and `docs/reference/schema.md` tells its readers to re-derive
-- from the database rather than from the file, so leaving it would put a false
-- grant claim in the authoritative place, on the one column this change is
-- about. Restated whole rather than patched, because `comment on` replaces.
comment on column public.postcards.ride_id is
  'A TAG, never the audience — club_id still decides who sees the row (NULL = app-wide feed, set = that club''s members). Set once at INSERT and never editable: authenticated holds INSERT on this column and deliberately no UPDATE (041). It holds no SELECT either as of 062: the raw uuid is comparable, so a viewer who can resolve neither the ride nor its crew could still group postcards by it. The value is readable by no client, on any row, including the reader''s own. What replaces it runs in ONE direction only: public.ride_journal_postcard_ids(ride uuid) holds the column and answers ride -> the postcard ids the caller may see. There is no postcard -> ride accessor, so a per-postcard ride badge is not buildable client-side today and needs one written. Postgres checks a column privilege to FILTER as well as to return, which is why the Journal and the exposure wanted the same grant (PD-166). Tagging requires BOTH that the tagger can see the ride under their own RLS AND private.is_ride_crew — neither alone, because a FK is validated with RLS bypassed and the crew helper is security definer. ON DELETE SET NULL, because rides.organizer_id cascades: a cascade here would mean one rider deleting their account destroys other riders'' postcards.';

-- ---------------------------------------------------------------------------
-- §2. The accessor
-- ---------------------------------------------------------------------------
create or replace function public.ride_journal_postcard_ids(ride uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.postcards p
   where p.ride_id = ride
     -- Evaluated once per statement rather than per row: it does not depend on
     -- `p`. 060's helper, and the only reason this function may answer at all.
     and private.can_read_ride((select auth.uid()), ride)
     -- 011's postcards SELECT qual, restated. The author branch is
     -- unconditional there and must stay unconditional here: 009 made it so a
     -- rider can never lose their own photo, including one in a club they left
     -- and one they hid from themselves.
     and (
       p.author_id = (select auth.uid())
       or (
         not private.is_blocked((select auth.uid()), p.author_id)
         and (
           p.club_id is null
           or private.is_club_member(p.club_id)
         )
         and not exists (
           select 1
             from public.postcard_hides h
            where h.postcard_id = p.id
              and h.user_id = (select auth.uid())
         )
       )
     )
   order by p.created_at desc, p.id desc;
$$;

comment on function public.ride_journal_postcard_ids(uuid) is
  'The ids of the postcards tagged to a ride that the CALLER may see, newest first (062). security definer because 062 revokes SELECT on postcards.ride_id from authenticated — Postgres checks the column privilege to FILTER on it, so the Journal''s .eq(''ride_id'', …) is exactly the read PD-166 closed. Returns ids rather than rows on purpose: the caller re-reads the postcards under their own RLS, so RLS stays the only authority on content and this function''s restated visibility is load-bearing only for the correlation — which postcards belong to this ride. Ride visibility is private.can_read_ride (060, pinned); postcard visibility restates 011''s SELECT qual, which the suite pins as whole text under this function''s name.';

-- Postgres grants EXECUTE to PUBLIC on every new function unless told
-- otherwise. `revoke all` and `revoke execute` are the same thing on a
-- function; `all` matches 021's and 043's shape.
revoke all on function public.ride_journal_postcard_ids(uuid) from public, anon;
grant execute on function public.ride_journal_postcard_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The grant, scoped to its grantee. `015`'s footer counted a privilege
--    table-wide and read 2 against a correct database, because postgres and
--    service_role hold everything by Supabase default.
--
--   select string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated' and privilege_type='SELECT';
--   -- author_id,caption,club_id,created_at,id,image_path,updated_at
--
--   select has_table_privilege('authenticated','public.postcards','select')            as table_level, -- f
--          has_column_privilege('authenticated','public.postcards','ride_id','SELECT') as tag_readable,-- f
--          has_column_privilege('authenticated','public.postcards','ride_id','INSERT') as tag_settable,-- t
--          has_column_privilege('authenticated','public.postcards','ride_id','UPDATE') as tag_writable,-- f
--          has_column_privilege('authenticated','public.postcards','club_id','SELECT') as club_readable;-- t
--
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards' and grantee='anon';  -- 0
--
-- 2. The function, by ROLE rather than by calling it — 031's lesson, since the
--    owner is subject to neither the grant nor the schema barrier.
--
--   select has_function_privilege('authenticated','public.ride_journal_postcard_ids(uuid)','execute'), -- t
--          has_function_privilege('anon',         'public.ride_journal_postcard_ids(uuid)','execute'), -- f
--          (select prosecdef from pg_proc where proname='ride_journal_postcard_ids'),                  -- t
--          (select proconfig from pg_proc where proname='ride_journal_postcard_ids');  -- {search_path=}
--
-- 3. **The SELECT policy is untouched.** Capture before and after; on
--    fpmrimzxadewsaiwpsel it is c8fb49b026866743283b3d7ecfbc5122, unchanged
--    since before `041`. A prose claim does not discharge this.
--
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='postcards' and cmd='SELECT';
--
-- 4. The behavioural probe, as `authenticated` with the rider's own id in
--    request.jwt.claims — the HOSTED idiom; supabase/tests/ redefines
--    auth.uid() to read `test.uid` and setting the claims there is read by
--    nothing. In a transaction that is ROLLED BACK. Three shapes:
--    `select ride_id from postcards limit 1` is 42501; the same rider's
--    `select id, caption from postcards limit 1` still works; and
--    `select * from public.ride_journal_postcard_ids('<a visible ride>')`
--    returns only the ids that rider can already see.
--
-- 5. The advisors gain exactly one WARN —
--    `authenticated_security_definer_function_executable` for this function,
--    taking that family from seven to eight. Anything else means a function
--    landed somewhere it should not have.
