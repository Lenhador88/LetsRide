-- 014: Profile avatar, profile cover, and countries ridden.
--
-- Three of the five gaps docs/FIGMA-FIDELITY-TODO.md §Profile registered when
-- /profile was rebuilt on 2026-08-05. The other two — Badges and the Garage
-- (Motorcycles / Gear) — are deliberately NOT here: Badges needs a rules engine
-- deciding what earns one, and the Garage is its own epic with per-bike likes
-- and comments. Neither is blocked on a column.
--
-- 010's header named the eight upload surfaces this app will have and committed
-- to a shape for them:
--
--   "One shared bucket with a top-level folder per surface ... each getting its
--    own storage.objects policies in the migration that builds that surface —
--    not its own bucket."
--
-- `avatars/` and `covers/` are the second and third of those eight. This
-- migration adds their folders' policies and nothing else about them; the
-- bucket itself already exists and is already private.
--
-- ---------------------------------------------------------------------------
-- Decision: avatar_url is left in place, not repurposed and not dropped.
-- ---------------------------------------------------------------------------
-- `profiles.avatar_url` has existed since 001 and **nothing in this repo has
-- ever written it** — there is no upload flow, and `grep -rn avatar_url
-- src/lib/actions src/lib/media` returns nothing. It is almost certainly NULL
-- for every row.
--
-- "Almost certainly" was why it survived the first draft of this migration,
-- which was written before the hosted database was reachable from this session.
--
-- **It has since been checked, and the answer is 0.** On 2026-08-05, against
-- the live project: 3 profile rows, `avatar_url` non-null on **none** of them
-- (2 of the 3 have completed onboarding). So the column carries no data and
-- dropping it loses nothing.
--
-- It is still not dropped HERE, and that is a scope decision rather than a
-- doubt. Removing it is a coordinated change — the column is in
-- PUBLIC_PROFILE_COLUMNS, in the `Profile` and `PublicProfile` types, and is
-- the fallback `resolveAvatarUrls` writes into — so it belongs in its own
-- migration alongside those edits, not bolted onto the one introducing the
-- replacement. `015` is where it goes, and the number above is the evidence
-- it needs.
--
-- The new column is `avatar_path`, named for what it holds — a Storage object
-- path, as `postcards.image_path` is — because calling a path a URL is how the
-- next reader writes `<img src={avatar_url}>` against a private bucket and gets
-- a broken image. The read layer prefers a signed `avatar_path` and falls back
-- to `avatar_url`, so an externally-hosted avatar (an OAuth provider's, if one
-- is ever wired up) still renders.

-- ---------------------------------------------------------------------------
-- 1. The two columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists cover_image_path text;

comment on column public.profiles.avatar_path is
  'Supabase Storage object path, e.g. avatars/<uid>/<uuid>.jpg. Never a URL — render through a signed URL. Preferred over the legacy avatar_url.';
comment on column public.profiles.cover_image_path is
  'Supabase Storage object path, e.g. covers/<uid>/<uuid>.jpg. The 390x200 cover on Profile / View your profile.';

-- Both paths are pinned to the OWNER'S folder by a CHECK, not only by a Storage
-- policy. 010 learned this the expensive way and wrote it down: its §4 exists
-- because a rider could write someone else's `postcards/<them>/...` path into
-- their own row, and the Storage read policy then served the object to them.
-- The fix there was a policy clause; here the same rule is a table constraint,
-- which is strictly stronger — a constraint cannot be loosened by an `or`
-- someone adds to a policy without understanding it, and it is checked on every
-- write regardless of which role or code path performs it.
--
-- Referencing `id` from the row's own CHECK is what makes that possible, and it
-- is why these are two constraints rather than one regex: the shape rule and the
-- ownership rule fail with different meanings, and a rider who somehow produces
-- a malformed path should not be told it belongs to someone else.
alter table public.profiles
  add constraint profiles_avatar_path_is_a_storage_path
  check (
    avatar_path is null
    or avatar_path ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

alter table public.profiles
  add constraint profiles_avatar_path_is_own_folder
  check (avatar_path is null or avatar_path like ('avatars/' || id::text || '/%'));

alter table public.profiles
  add constraint profiles_cover_image_path_is_a_storage_path
  check (
    cover_image_path is null
    or cover_image_path ~ '^covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

alter table public.profiles
  add constraint profiles_cover_image_path_is_own_folder
  check (cover_image_path is null or cover_image_path like ('covers/' || id::text || '/%'));

-- One profile per object, mirroring 010's postcards_image_path_key and for the
-- same two reasons: a second row pointing at one path is only ever an attempt
-- to claim someone else's image, and it gives the Storage SELECT policies below
-- at most one row to find.
create unique index profiles_avatar_path_key       on public.profiles (avatar_path);
create unique index profiles_cover_image_path_key  on public.profiles (cover_image_path);

-- ---------------------------------------------------------------------------
-- 2. storage.objects policies for `avatars/` and `covers/`
-- ---------------------------------------------------------------------------
-- Same three-policy shape 010 established for `postcards/`: insert into your
-- own folder only, read through the owning table's own visibility, delete your
-- own. No UPDATE, so no upsert path — uploads mint a fresh uuid rather than
-- overwriting, exactly as uploadObject already does.
--
-- The mimetype clause is null-tolerant for the reason 010 documents at length:
-- storage-api runs an RLS pre-check in a rolled-back transaction *before* the
-- body arrives, when `metadata` is still null, and a bare equality there
-- refuses every upload with 42501.

create policy "Riders upload avatars into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (metadata ->> 'mimetype' is null or (metadata ->> 'mimetype') = 'image/jpeg')
    and coalesce((metadata ->> 'size')::bigint, 0) <= 5242880
  );

create policy "Riders upload covers into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'covers'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (metadata ->> 'mimetype' is null or (metadata ->> 'mimetype') = 'image/jpeg')
    and coalesce((metadata ->> 'size')::bigint, 0) <= 5242880
  );

-- Readability is the PROFILE's readability, inherited rather than restated. The
-- subquery runs under the caller's row security, so it picks up 009's profiles
-- SELECT policy — `auth.uid() = id or (username is not null and not
-- private.is_blocked(auth.uid(), id))` — for free. That is the whole reason a
-- blocked rider cannot fetch the avatar of someone who blocked them, and it is
-- why the block predicate does not appear here: a second copy is free to drift
-- from the one 009 owns, and this one is a layer further from where anyone
-- would notice.
--
-- The `foldername[2] = p.id` binding is 010 §2's hard-won line, restated for
-- these folders. Without it the EXISTS inherits RLS from whatever profile row
-- happens to match the path rather than from the object's owner. The table
-- CHECKs in §1 already make a mismatched row unwritable, so this is the second
-- of two independent brakes.
create policy "Riders read avatars their profile visibility allows"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      -- Your own folder, unconditionally. This branch is NOT a convenience:
      -- without it, replacing an avatar leaks the old object FOREVER and by
      -- construction. The `exists` below defines readability as "some profiles
      -- row points at me", so the instant the row is repointed the previous
      -- object stops being selectable — and Postgres ANDs SELECT quals into a
      -- DELETE whose WHERE names table columns, so the cleanup delete matches
      -- zero rows and reports no error. Verified: the same delete returns
      -- DELETE 1 before the repoint and DELETE 0 after.
      --
      -- Extending #24's orphan sweeper could not have fixed it either. An
      -- orphan is by definition unreferenced, so under the `exists` alone it is
      -- unreadable and therefore undeletable by anyone, including its owner.
      --
      -- It leaks nothing: the folder is keyed by uid, so this grants a rider
      -- sight of objects they uploaded themselves and nothing else.
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.avatar_path = storage.objects.name
          and (storage.foldername(storage.objects.name))[2] = p.id::text
      )
    )
  );

-- Same own-folder branch, same reason — see the avatar policy above.
create policy "Riders read covers their profile visibility allows"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'covers'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.cover_image_path = storage.objects.name
          and (storage.foldername(storage.objects.name))[2] = p.id::text
      )
    )
  );

-- Replacing an avatar uploads a new object and clears the old one; without a
-- DELETE policy every replacement would leak a billable object, which is the
-- gap #24 had to write a sweeper for on the postcards side.
create policy "Riders delete their own avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Riders delete their own covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'covers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3. profile_countries — the "Countries" section, entered by hand
-- ---------------------------------------------------------------------------
-- The design draws `22/195` over a grid of flags and does not say where the 22
-- come from. Two readings were open: a rider ticks them, or they are derived
-- from rides logged in each country. **Manual was chosen by the product owner**
-- on 2026-08-05, which is what makes this a table rather than a query — and it
-- is worth recording that the derived reading is not merely unbuilt but
-- currently unbuildable: `rides` has no country, no coordinates, and only a
-- free-text `meeting_point`.
--
-- The denominator (195) is a constant in the UI, not a table. A `countries`
-- reference table would be 195 rows of data this app never joins against —
-- every country the picker offers is already in the ISO list the client ships,
-- and the CHECK below is what keeps the column honest.
create table public.profile_countries (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  country_code text        not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, country_code),
  -- ISO 3166-1 alpha-2, uppercase. Not a foreign key to a countries table for
  -- the reason above; this constraint is the whole of the referential
  -- discipline, so it is deliberately strict about case rather than tolerant.
  constraint profile_countries_code_is_iso_alpha2 check (country_code ~ '^[A-Z]{2}$')
);

comment on table public.profile_countries is
  'Countries a rider says they have ridden in. Entered manually — see 014 §3. One row per (rider, ISO 3166-1 alpha-2 code).';

alter table public.profile_countries enable row level security;

-- Visibility is the profile's visibility, inherited through the same EXISTS
-- trick the Storage policies above use. A blocked rider therefore cannot read
-- your countries, and nothing here says the word "blocked" — 009 owns that
-- predicate and this policy borrows it.
--
-- Note the asymmetry with `postcard_hides`, which is per-viewer: this is a fact
-- ABOUT a rider, published to everyone who can see that rider, not a private
-- annotation. Getting that backwards would either hide countries from the
-- profile that displays them or expose them to someone the owner has blocked.
create policy "Countries are visible to anyone who can see the profile"
  on public.profile_countries for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = profile_countries.user_id)
  );

create policy "Riders add their own countries"
  on public.profile_countries for insert to authenticated
  with check (user_id = auth.uid());

create policy "Riders remove their own countries"
  on public.profile_countries for delete to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy and no UPDATE grant. A country is added or removed, never
-- edited — the primary key IS the whole row's identity, so an update could only
-- ever be a delete plus an insert. Same reasoning 009 applied to
-- postcard_likes and 011 to postcard_comments: an unused privilege is a
-- liability, not a convenience.
revoke all on public.profile_countries from anon, authenticated;
grant select, insert, delete on public.profile_countries to authenticated;

-- An index on user_id alone would duplicate the primary key's leading column,
-- which already serves `where user_id = $1`. Deliberately not created.

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- Every case below is also an assertion in supabase/tests/rls_test.sql, which
-- applies this whole chain to a scratch database on every PR. Repeated here
-- because that suite runs on a stub of storage.objects (harness.sql) and cannot
-- see the real bucket config, role grants or PostgREST exposure.
--
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   -- expect 9: 3 for postcards/ (010) + 3 for avatars/ + 3 for covers/.
--   -- every one 'to authenticated', none for anon or PUBLIC.
--
--   select count(*) from information_schema.role_table_grants
--     where grantee = 'anon' and table_name = 'profile_countries';
--   -- expect 0.
--
-- NEGATIVE — a rider cannot claim another rider's avatar path. Expect 23514
-- (check_violation) from the table constraint. Note the example below updates
-- the CALLER'S OWN row, so the UPDATE policy passes and the constraint is what
-- refuses it. Postgres evaluates the RLS WITH CHECK **first**, so a write that
-- violates both a policy and a constraint reports the policy violation, not
-- 23514 — an earlier draft of this footer claimed the reverse. The constraint
-- is still the stronger guarantee (a policy can be loosened by an `or`, a
-- constraint cannot); it is simply not the first thing to fire.
--
--   update profiles set avatar_path = 'avatars/<someone-else>/<uuid>.jpg' where id = '<self>';
--
-- NEGATIVE — a blocked rider cannot read the blocker's countries or avatar
-- object. Both must return zero rows:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<blocked>","role":"authenticated"}';
--     select count(*) from profile_countries where user_id = '<blocker>';
--     select name from storage.objects where name = '<blocker''s avatar path>';
--   rollback;
--
-- NEGATIVE — a rider cannot insert a country row for someone else, nor a
-- lowercase or three-letter code:
--
--   insert into profile_countries (user_id, country_code) values ('<someone-else>', 'NL');  -- 42501
--   insert into profile_countries (user_id, country_code) values ('<self>', 'nl');          -- 23514
--   insert into profile_countries (user_id, country_code) values ('<self>', 'NLD');         -- 23514
