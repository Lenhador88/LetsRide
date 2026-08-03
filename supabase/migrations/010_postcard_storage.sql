-- 010: Postcard image storage — the bucket 009 left for this migration.
--
-- 009 created postcards.image_path as a Supabase Storage OBJECT PATH and said,
-- in its own column comment, that the bucket and its storage.objects RLS
-- belong here:
--
--   "Supabase Storage object path, e.g. postcards/<uid>/<uuid>.jpg."
--
-- This migration creates both, and nothing else — no page, no component, no
-- upload UI. That is `feature`'s job once the create-postcard screen is
-- specced; this migration only has to make the row 009 already allows
-- actually resolve to a photo.
--
-- ---------------------------------------------------------------------------
-- Decision: one bucket, `media`, shared by every upload surface — not one
-- bucket per surface.
-- ---------------------------------------------------------------------------
-- Postcards, ride covers, ride journals, club covers, avatars, profile
-- covers, motorcycles and gear are eight upload surfaces. A bucket per
-- surface is the "eight variations" shape the brief says not to build. One
-- shared bucket with a top-level folder per surface is the one shared shape:
-- `postcards/`, later `rides/covers/`, `clubs/covers/`, `avatars/`, and so on,
-- each getting its own storage.objects policies in the migration that builds
-- that surface — not its own bucket.
--
-- Only `postcards/` has policies below, because postcards is the only one of
-- the eight that has a table, a column and a feature behind it today. Writing
-- policies for the other seven now would be inventing rules for screens that
-- do not exist — the exact shape of guess 009's own footer warns against, one
-- layer further out (Storage, not Postgres rows). Add each one in the
-- migration that builds that surface.
--
-- 009's column comment already commits to the value stored in image_path
-- being 'postcards/<uid>/<uuid>.jpg' verbatim — not the bucket name plus that
-- string. So image_path is passed straight to
-- `.storage.from('media').createSignedUrl(image_path)` with no stripping.
--
-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- Private (`public = false`) is the entire point of decision #1. A public
-- bucket serves every object to anyone with the URL — no session, no RLS —
-- and would silently undo every policy below along with the 32 policies 009
-- already shipped. Rendering goes through signed URLs, generated server-side
-- once a page exists to need them.
--
-- file_size_limit and allowed_mime_types are the FIRST of two independent
-- caps on what an upload may be — see the INSERT policy below for the
-- second. Two layers because the brief is explicit that the client is not a
-- security boundary: a bucket-config change alone is one dashboard click from
-- silently loosening, and the RLS check does not depend on it.
--
-- 5 MiB is a defensive ceiling, not the expected size. src/lib/media/compress.ts
-- targets well under 1 MiB per image; this bound exists for a caller that
-- skips the client entirely — a stolen token replayed with curl — not for the
-- ordinary path, which never gets close to it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. storage.objects policies, scoped to the `postcards/` folder
-- ---------------------------------------------------------------------------
-- No revoke/grant statements here, unlike 009's own tables. `storage.objects`
-- is Supabase-managed infrastructure, not ours — we do not own the table and
-- do not touch its default privileges, matching every published Supabase
-- Storage RLS example, which is policy-only for exactly this reason. RLS is
-- still the complete enforcement layer: no policy below targets anon or
-- PUBLIC, matching decision #1, and that is what
-- supabase/tests/rls_test.sql's negative assertions check.
--
-- Path shape is `postcards/<uploader uuid>/<object uuid>.jpg`. Two
-- independent checks enforce it:
--   * storage.foldername(name) — cheap, and how a Storage policy usually
--     pins ownership: the folder segments must be ('postcards', auth.uid()).
--   * a regex — locks the exact shape end to end, including the extension.
--     foldername() cannot see the filename or its extension, and the
--     extension is exactly what ties this to what compress.ts actually
--     produces: always a re-encoded .jpg, never whatever the source was.
-- Same belt-and-braces reasoning as postcards_image_path_is_a_storage_path
-- in 009 — a shape rule the client must not own lives in a constraint (or
-- here, a policy), not only in application code.
create policy "Riders upload postcard images into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'postcards'
    and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^postcards/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    -- The second cap promised above. `metadata` is populated by storage-api
    -- from the multipart request BEFORE this row is written, so — unlike a
    -- client-supplied header — it is trustworthy here in exactly the way
    -- §1's bucket config is, and independently of it.
    and (metadata ->> 'mimetype') = 'image/jpeg'
    and coalesce((metadata ->> 'size')::bigint, 0) <= 5242880
  );

-- Mirrors "Postcards are viewable by their audience" (009) through the same
-- EXISTS-under-RLS trick postcard_likes already uses for its own visibility:
-- the subquery runs under the CALLER's row security, so it inherits the
-- author / block / club-membership predicate for free. Restating that
-- predicate here — author_id = auth.uid() or (not blocked and (club_id is
-- null or is_club_member(club_id))) — would be a second copy that can
-- silently drift from the one 009 owns, one layer further from where it's
-- easy to notice.
--
-- Consequence, accepted: an object with no postcards row pointing at it is
-- unreadable by anyone at all, including whoever just uploaded it. Nothing
-- renders it until the row exists, so nothing needs to.
create policy "Riders read postcard images their audience predicate allows"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'postcards'
    and exists (
      select 1 from public.postcards p where p.image_path = storage.objects.name
    )
  );

-- No UPDATE policy, and so no upsert path: uploads never overwrite (see
-- uploadObject in src/lib/media/upload.ts — a retry after a dropped
-- connection reuses the same random path and treats a 409 as success rather
-- than upserting). Granting UPDATE for a path that is never exercised would
-- be an unused privilege, the same reasoning 009 applied to postcard_likes
-- and blocks.

-- Lets an uploader remove their own object, never anyone else's. This is
-- what makes createPostcard's compensating cleanup possible: if the postcards
-- insert fails after the upload already succeeded, the action deletes the
-- object it was just handed under the uploader's own session. See that
-- action's comment (src/lib/actions/postcards.ts) for the failure-path
-- detail this exists to support.
create policy "Riders delete their own postcard images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'postcards'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3. What happens to the object if the postcards row never gets written
-- ---------------------------------------------------------------------------
-- Nothing, at the database level — Storage and Postgres are two different
-- systems here, and there is no cross-system foreign key to cascade. The
-- DELETE policy above is the mechanism; createPostcard is what calls it: on
-- an insert failure it deletes the just-uploaded object under the caller's
-- own session before returning the error, so a failed post does not leave a
-- billable, unreachable object behind. The reverse direction — a postcard row
-- deleted without its object being cleaned up — is a real gap and is
-- recorded rather than silently left: postcards already has a DELETE policy
-- ("Authors can delete their own postcards", 009), but no deletePostcard
-- action calls it yet, so it is not this migration's to close. Whoever adds
-- that action must delete the Storage object first, or in the same request,
-- because there is still no cascade to do it for them.

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- Every case below is also an assertion in supabase/tests/rls_test.sql, which
-- applies this whole chain to a scratch database on every PR. Repeated here
-- because that suite runs on a stub of storage.objects (see harness.sql) and
-- cannot see the real bucket config, role grants or PostgREST exposure —
-- the exact gap 003's footer already names for the public schema.
--
-- Shape:
--
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'media';
--   -- expect: media | f | 5242880 | {image/jpeg}
--
--   select relrowsecurity from pg_class where relnamespace = 'storage'::regnamespace and relname = 'objects';
--   -- expect: t
--
--   select policyname, roles, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   -- expect exactly 3 rows (insert, select, delete — no update), every one 'to authenticated' only.
--
-- NEGATIVE — a rider cannot read an object behind a postcard they cannot see
-- (a club postcard, non-member) or a postcard from someone who blocked them.
-- Both must return zero rows:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<non-member>","role":"authenticated"}';
--     select name from storage.objects where name = '<club-scoped image path>';
--   rollback;
--
-- NEGATIVE — a rider cannot write into another rider's folder, upload a
-- non-jpeg mimetype, or exceed the size cap. All three must fail 42501:
--
--   insert into storage.objects (bucket_id, name, owner, metadata)
--     values ('media', 'postcards/<someone-else>/<uuid>.jpg', '<self>', '{"mimetype":"image/jpeg","size":1}');
--   insert into storage.objects (bucket_id, name, owner, metadata)
--     values ('media', 'postcards/<self>/<uuid>.png', '<self>', '{"mimetype":"image/png","size":1}');
--   insert into storage.objects (bucket_id, name, owner, metadata)
--     values ('media', 'postcards/<self>/<uuid>.jpg', '<self>', '{"mimetype":"image/jpeg","size":99999999}');
--
-- NEGATIVE — a blocked rider's images are not reachable by the blocker, even
-- by a direct signed-URL-style row lookup rather than through the feed:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<blocker>","role":"authenticated"}';
--     select name from storage.objects where name = '<blocked rider''s image path>';
--   rollback;
--   -- expect zero rows.
