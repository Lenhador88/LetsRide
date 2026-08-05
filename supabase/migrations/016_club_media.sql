-- 016: club avatars and cover images.
--
-- `List / Club` leads with an 80×104 cover and a 72×72 avatar, and the club
-- detail header carries the avatar again. `clubs` has carried the same seven
-- columns since 001, and `avatar_url` among them has never been written by
-- anything in this repo — the same dead-column shape 014 replaced on `profiles`.
--
-- This lands with Create/Edit club rather than with the club list, deliberately.
-- Columns without an upload screen render the identical empty container while
-- planting exactly the column this migration exists to clean up after.
--
-- `avatar_url` is NOT dropped here. It is a coordinated change across
-- PUBLIC_PROFILE_COLUMNS, two types and resolveAvatarUrls on the *profiles*
-- side, and `clubs.avatar_url` has its own callers; bundling a removal into a
-- migration that adds a surface is how a rollback stops being one line.

-- ---------------------------------------------------------------------------
-- §1. The columns
-- ---------------------------------------------------------------------------
--
-- **Paths are scoped to the uploader, not to the club**, which is the one place
-- this deviates from what you would guess. `club-avatars/<club id>/…` reads
-- better and cannot be written: at create time the club row does not exist yet,
-- so a policy keyed on club id would refuse the upload that has to happen
-- before the insert. Scoping to `auth.uid()` keeps the 010/014 invariant — a
-- rider may only ever write inside their own folder — and lets the flow stay
-- upload-then-insert, the same order `/postcards/new` uses.
--
-- The CHECK then binds the row to its owner: a club's image must live in the
-- owner's folder. That is what stops one rider attaching another rider's object
-- to a club, which the storage policy alone would permit.

alter table public.clubs add column avatar_path text;
alter table public.clubs add column cover_image_path text;

comment on column public.clubs.avatar_path is
  'Supabase Storage object path, e.g. club-avatars/<owner uid>/<uuid>.jpg. Never a URL — render through a signed URL. Preferred over the legacy avatar_url.';
comment on column public.clubs.cover_image_path is
  'Supabase Storage object path, e.g. club-covers/<owner uid>/<uuid>.jpg. The cover behind the avatar on List / Club.';

alter table public.clubs add constraint clubs_avatar_path_shape
  check (
    avatar_path is null
    or avatar_path ~ '^club-avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

alter table public.clubs add constraint clubs_avatar_path_owned
  check (avatar_path is null or avatar_path like ('club-avatars/' || owner_id::text || '/%'));

alter table public.clubs add constraint clubs_cover_image_path_shape
  check (
    cover_image_path is null
    or cover_image_path ~ '^club-covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

alter table public.clubs add constraint clubs_cover_image_path_owned
  check (cover_image_path is null or cover_image_path like ('club-covers/' || owner_id::text || '/%'));

-- ---------------------------------------------------------------------------
-- §2. storage.objects policies
-- ---------------------------------------------------------------------------
--
-- Two more folders in the shared `media` bucket, bringing it to five surfaces:
-- postcards/ (010), avatars/ and covers/ (014), club-avatars/ and club-covers/.
-- Each folder carries its own three policies, which is why the RLS suite counts
-- them by policy name rather than by a whole-table total — that assertion broke
-- when 014 landed and would break again here.

create policy "Riders upload club avatars into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^club-avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

create policy "Riders upload club covers into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-covers'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^club-covers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );

-- Readability follows the *club*, not the folder, and that is the whole point:
-- a private club's cover must be unreadable to a rider who cannot see the club,
-- even though the object sits in a folder named after its uploader. The EXISTS
-- delegates to the clubs SELECT policy rather than restating "public or owner or
-- member" — restating it is how the two drift, which is the defect 004/008 had
-- to reconcile.
--
-- The `foldername[2] = c.owner_id` binding is 010 §2's line, restated: without
-- it, attaching a *victim's* object path to a club you own would make that
-- object readable to your club. The CHECK in §1 already refuses that write, so
-- this is the second of two independent locks on the same door.
create policy "Club avatars are readable with the club"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.clubs c
        where c.avatar_path = storage.objects.name
          and (storage.foldername(storage.objects.name))[2] = c.owner_id::text
      )
    )
  );

create policy "Club covers are readable with the club"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-covers'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.clubs c
        where c.cover_image_path = storage.objects.name
          and (storage.foldername(storage.objects.name))[2] = c.owner_id::text
      )
    )
  );

-- Replacing a club image leaves the old object behind, so delete is what keeps
-- the bucket from growing without bound. Scoped to the uploader's own folder —
-- there is no case where a rider deletes an object they did not upload.
create policy "Riders delete club avatars from their own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Riders delete club covers from their own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-covers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- No UPDATE policy and no UPDATE grant on storage.objects, matching 010 and
-- 014: replacing an image is delete-then-insert, and an upsert that overwrites
-- an object in place would let a path already attached to a visible club have
-- its bytes swapped.

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 6 — three each for club-avatars/ and club-covers/
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%club %';
--
-- Expected: 15 — 3 postcards + 6 from 014 + 6 here
--   select count(*) from pg_policies where schemaname='storage' and tablename='objects';
--
-- Expected: 0 — no storage policy targets anything but authenticated
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and roles::text[] <> array['authenticated'];
--
-- Expected: 0 — no UPDATE policy on storage.objects, from any migration
--   select count(*) from pg_policies
--    where schemaname='storage' and tablename='objects' and cmd = 'UPDATE';
--
-- Expected: 4 — the two shape checks and the two owner-folder checks
--   select count(*) from pg_constraint
--    where conrelid = 'public.clubs'::regclass and contype = 'c'
--      and conname like '%path%';
--
-- Expected: 2 rows, both text and nullable
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'clubs' and column_name in ('avatar_path','cover_image_path');
