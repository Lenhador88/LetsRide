-- 076: Reports get a reader, and a take-down that is not a raw DELETE. PD-297.
--
-- Additive only. Nothing here drops or narrows anything, and nothing here
-- changes a single policy on `postcard_reports` — the reporter still reads only
-- their own rows, nobody may edit or withdraw one, and no new role can reach
-- the table through PostgREST. What is added is a triage surface that exists
-- **outside** the API entirely.
--
-- ---------------------------------------------------------------------------
-- The gap this closes, and the one it deliberately does not
-- ---------------------------------------------------------------------------
-- `011`'s header states it plainly: `postcard_reports` has no reader. A rider
-- taps Report, a row lands, and nobody is looking. App Store Review Guideline
-- 1.2 asks a user-generated-content app for four things — a way to report, a
-- way to block, a way to hide, and action on what is reported. Three were
-- built. This is the fourth.
--
-- `011` also says closing it "takes a decision about who moderates, which is
-- not a schema question", and that is still true: **this file does not invent
-- an admin role.** There is no moderator claim in the JWT, no `is_admin`
-- column, no policy keyed on either, and no new grant to `authenticated`. The
-- reader is the project owner at the Supabase dashboard, which is a connection
-- as the table owner — a role that already sees every row in this database and
-- gains nothing here it did not have.
--
-- That is the whole security argument for `private`, and it is worth stating
-- in the negative: the objects below are not a *narrower* way to read
-- postcards, they are a *pre-joined* way to read what the owner could already
-- read with a hand-written join. Nobody else gains a byte.
--
-- ---------------------------------------------------------------------------
-- Why `private` and not `public`
-- ---------------------------------------------------------------------------
-- PostgREST routes only to `public` — `031` is the worked example, where a
-- worker in `private` turned out to be uncallable by `service_role` for exactly
-- this reason. That property is a defect when you want a client to reach
-- something and a **feature** here: an object in `private` cannot be selected
-- through the REST API by any key that ships in the client bundle, whatever a
-- future grant says.
--
-- Two layers, not one, because `031`'s lesson cuts both ways:
--
--   1. `anon` and `authenticated` hold no USAGE on `private` at all (`005`
--      created the schema and granted USAGE to neither), so the objects are
--      unreachable before any grant on them is considered.
--   2. `service_role` DOES hold USAGE — `031` granted it — so the revokes below
--      name it explicitly rather than relying on the schema.
--
-- ---------------------------------------------------------------------------
-- Two questions this file answers with a decision rather than a mechanism
-- ---------------------------------------------------------------------------
-- **Evidence does not outlive the postcard, and that is chosen.** `011`'s
-- second gap: `postcard_reports.postcard_id` is ON DELETE CASCADE, so removing
-- a reported postcard erases the reports about it and the pattern a repeat
-- offender would leave. Preserving it needs somewhere to keep a copy of what
-- was reported — which is a new store of exactly the personal data `029`'s
-- cascade exists to remove, and `/legal/account-deletion` promises is gone:
-- an author's id, their photo's path, a reporter's words about them, surviving
-- the account deletion that was supposed to erase all three. A moderation
-- archive is a real product with a retention policy and a lawful basis, and
-- inventing one inside a take-down function is how it arrives without either.
--
-- So the cascade stays, and `private.remove_reported_postcard()` below
-- **returns what it is about to destroy** — the reports, their reasons and
-- their notes — so the operator holds the evidence in the dashboard's result
-- pane at the moment they act on it. That is a deliberately human answer to a
-- retention question, and it is honest about being one.
--
-- **The image is not deleted, because no cascade can do it — and deleting it is
-- the ONLY thing that ends access to it. This paragraph said the opposite on
-- its first pass, from evidence that looked conclusive.** `009` §3 gives the
-- first half: the row goes, the object at `image_path` stays. `010` §2 looks
-- like it gives the second — the `media` bucket is `public = false` and the
-- Storage SELECT policy resolves through a `postcards` row whose author owns
-- the folder, so an orphaned object is *"unreadable by anyone at all,
-- including whoever just uploaded it"*.
--
-- **That is true of an RLS-mediated read, and the app never does one.**
-- `src/lib/data/media.ts` signs every postcard path with
-- `createSignedUrls(..., SIGNED_URL_TTL_SECONDS)` — one hour — and Supabase
-- serves a signed URL by validating its signature, not by re-running the
-- policy. That file's own header says as much: *"the signature is the only
-- thing protecting a private club's photo once it leaves RLS's reach"*.
--
-- So after a take-down, every rider whose feed had already rendered that
-- postcard holds a URL that keeps working for the rest of the hour, as does
-- anyone they forwarded it to — signed out, or with no account at all.
-- Deleting the object is step two of the runbook and it is **time-bounded**:
-- the exposure window is exactly the remaining TTL. `/legal/privacy` names the
-- hour for the same reason.

-- ---------------------------------------------------------------------------
-- 1. The queue — one row per open report, with the context to judge it
-- ---------------------------------------------------------------------------
-- `security_invoker = false` is the PostgreSQL default for a view and is
-- written out anyway, because it is the entire reason this view can answer at
-- all: it runs as its owner, so the RLS on `postcards`, `profiles` and
-- `postcard_reports` is evaluated against the owner rather than the caller.
-- Leaving that implicit in a moderation surface would be a load-bearing default
-- nobody could see. There is no caller but the owner — see the revokes in §3 —
-- so nothing is being stepped past here that the reader could not already read.
--
-- **`reports_on_this_author` is a CURRENT count, not a lifetime one, and it is
-- zeroed by the very action it informs.** Reports cascade with their postcard,
-- so each take-down erases that author's history: a rider with five removals
-- behind them shows `1` on the sixth report. It reads as a pattern signal and
-- under-counts a repeat offender exactly in proportion to how well moderation
-- has been working. Weigh it as "how many complaints are open about this rider
-- right now", never as "how many they have ever had" — and note this is a
-- second, independent argument for the take-down ledger this file declines to
-- build for a retention reason.
--
-- It joins `profiles` for the AUTHOR only, and the reporter appears as a uuid.
-- A photo is judged on the photo: the reported rider's name is context, and the
-- reporter's is not needed to decide whether a caption breaks the terms. Two
-- counts do the pattern-spotting a name would otherwise be reached for. The
-- owner can always join `profiles` by hand — this is about what the default
-- surface carries, so that a view which ever escapes its schema leaks less.
create or replace view private.postcard_report_queue
with (security_invoker = false) as
  select
    r.id                as report_id,
    r.created_at        as reported_at,
    r.reason,
    r.note,
    r.reporter_id,
    p.id                as postcard_id,
    p.created_at        as postcard_created_at,
    p.caption,
    p.image_path,
    author.id           as author_id,
    author.username     as author_username,
    (select count(*) from public.postcard_reports other
       where other.postcard_id = p.id)     as reports_on_this_postcard,
    (select count(*) from public.postcard_reports other
       join public.postcards other_p on other_p.id = other.postcard_id
      where other_p.author_id = p.author_id) as reports_on_this_author
  from public.postcard_reports r
  join public.postcards p        on p.id = r.postcard_id
  join public.profiles author    on author.id = p.author_id
  order by r.created_at desc;

comment on view private.postcard_report_queue is
  'Triage queue for postcard reports. reports_on_this_author counts OPEN reports only — reports cascade with their postcard, so a take-down erases that author''s history. Readable only by the table owner at the Supabase dashboard — private is not routed by PostgREST and no client role holds USAGE on it. Runs as its owner by design, so it sees rows RLS would hide from the caller; it is a pre-joined view of what the owner could already read, never a new reach for anyone else. The reporter appears as a uuid only. See 076.';

-- ---------------------------------------------------------------------------
-- 2. The take-down
-- ---------------------------------------------------------------------------
-- `011` §1b's `public.moderate_comment()` is the precedent for the *shape* — a
-- removal scoped to exactly one row, where the actor cannot reach the row
-- through RLS — and this one departs from it in the two ways that matter:
--
--   * `moderate_comment` is `security definer` in `public` and granted to
--     `authenticated`, because a rider calls it. This one is neither. It lives
--     in `private`, it is granted to nobody, and it needs no `security definer`
--     at all: its only caller is already the owner, and marking it definer
--     would add a `authenticated_security_definer_function_executable` advisor
--     for a function no `authenticated` session can execute. **This file adds
--     no security advisor** — check `get_advisors(security)` against
--     `CLAUDE.md` §Supabase Rules' table of ten after applying it.
--   * `moderate_comment` returns a boolean, because the caller only needs to
--     know whether the button worked. This returns the evidence, for the
--     retention reason in the header.
--
-- `set search_path = ''` and fully-qualified names per `005`, which applies to
-- any function this schema ships regardless of its security context.
create or replace function private.remove_reported_postcard(target uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  evidence jsonb;
  removed integer;
begin
  -- Read the evidence BEFORE the delete, because the delete destroys it: the
  -- reports cascade from the postcard. Selecting it afterwards returns null and
  -- looks exactly like a postcard nobody had reported.
  select jsonb_build_object(
           'postcard_id', p.id,
           'author_id', p.author_id,
           'author_username', a.username,
           'caption', p.caption,
           -- The Storage object is NOT removed by this function or by any
           -- cascade. Returned so the operator can delete it; see §Operating it.
           'image_path', p.image_path,
           'postcard_created_at', p.created_at,
           'reports', coalesce(
             -- Reporters by uuid here too, for the reason the view gives.
             (select jsonb_agg(jsonb_build_object(
                       'reported_at', r.created_at,
                       'reason', r.reason,
                       'note', r.note,
                       'reporter_id', r.reporter_id)
                     order by r.created_at)
                from public.postcard_reports r
               where r.postcard_id = p.id),
             '[]'::jsonb))
    into evidence
    from public.postcards p
    join public.profiles a on a.id = p.author_id
   where p.id = target;

  if evidence is null then
    -- A postcard that does not exist is a clean answer, not an error — the
    -- same shape `moderate_comment` settled on, and for the same reason: an
    -- operator acting on a queue row somebody already deleted has done nothing
    -- wrong.
    return jsonb_build_object('removed', false, 'reason', 'no such postcard');
  end if;

  -- FIVE cascades hang off `postcards` and the header used to name one. Read
  -- off `pg_constraint` on DEV rather than remembered: `postcard_likes`,
  -- `postcard_comments`, `postcard_hides`, `postcard_reports` and
  -- `notifications`, every one `ON DELETE CASCADE`. The blast radius is a
  -- property of the schema, not of this body — there is no DELETE trigger on
  -- `postcards` at all, and the one AFTER DELETE trigger reached transitively
  -- (`private.retract_postcard_liked` on `postcard_likes`) only deletes
  -- notifications and has no raise path, so a cascade cannot abort a take-down.
  delete from public.postcards where id = target;
  get diagnostics removed = row_count;

  return evidence || jsonb_build_object('removed', removed > 0, 'removed_at', now());
end;
$$;

comment on function private.remove_reported_postcard(uuid) is
  'Removes exactly one postcard and returns what it destroyed — including the reports about it, which cascade away with the row (011''s second known gap). Owner-only: private is not routed by PostgREST, execute is granted to nobody, and it is deliberately NOT security definer. Does not delete the Storage object at image_path; the return value carries the path. See 076.';

-- ---------------------------------------------------------------------------
-- 3. Grants — the second layer, per 009 §5 and 011 §5
-- ---------------------------------------------------------------------------
-- RLS is irrelevant to both objects above: a view runs as its owner and a
-- function in `private` is not published. The grant IS the access control here,
-- which is why it is stated absolutely rather than left to the schema's
-- default, and why `service_role` is named — it holds USAGE on `private`
-- (`031`), so it is the one client-side role for which the schema is not
-- already the barrier.
revoke all on private.postcard_report_queue from public, anon, authenticated, service_role;
revoke all on function private.remove_reported_postcard(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3b. And `service_role` stops reading the reports themselves
-- ---------------------------------------------------------------------------
-- Measured on DEV before this file, and it is the shape `011` §5 missed rather
-- than a new exposure: it revoked from `anon, authenticated` and never named
-- `service_role`, so Supabase's project default stood.
--
--   authenticated | INSERT, SELECT
--   service_role  | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- The key that holds those privileges lives in exactly one place — the
-- `delete-account` function's secret store — so this is not a live leak. It is
-- a standing one: the only thing between that key and every reporter's identity
-- was that nothing had asked. Reporter safety is why the suite already asserts
-- that a reported postcard's author cannot read reports about them.
--
-- Safe, and the two reasons are independent. `delete-account` never touches
-- this table — it removes Storage objects under six prefixes and the
-- `auth.users` row, and the database's own cascades do the rest. And a
-- referential cascade does not consult privileges at all: it runs as the
-- constraint's system trigger, not as the deleting role. **Measured rather than
-- reasoned**, in a rolled-back transaction on the scratch database, because
-- getting this wrong takes account deletion down and nothing in CI would
-- notice:
--
--   grant all on public.postcard_reports to service_role;   -- the hosted default
--   revoke all on public.postcard_reports from service_role;-- this line
--   set local role service_role;
--   delete from public.profiles where id = '<a reporter>';  -- DELETE 1
--   -- reports_before 1 -> reports_after 0, with has_table_privilege(
--   --   'service_role', 'public.postcard_reports', 'delete') = false throughout.
--
-- The narrowness is deliberate and is not a claim about the other tables:
-- `service_role` still holds Supabase's default on every one of them. What this
-- revoke buys is that a report cannot be enumerated by the one credential in
-- this system that bypasses RLS.
revoke all on public.postcard_reports from service_role;

-- ---------------------------------------------------------------------------
-- 4. The table comment stops saying nobody can triage
-- ---------------------------------------------------------------------------
-- `011` set this comment and it was true for the whole life of the table. It
-- is the first thing anyone reads off `\d+ postcard_reports`, so leaving it
-- would leave the database itself asserting the gap this file closes.
comment on table public.postcard_reports is
  'Reports filed by riders. The reporter reads only their own rows and nobody may edit or withdraw one (011 §4). Triage is out-of-band: private.postcard_report_queue and private.remove_reported_postcard(), owner-only at the dashboard, added by 076. There is still no admin role and no moderator claim.';

-- ---------------------------------------------------------------------------
-- §Operating it — the runbook, because a queue nobody knows how to read is
-- the same gap with more SQL in it
-- ---------------------------------------------------------------------------
-- At the Supabase dashboard's SQL editor, which connects as the table owner:
--
--   -- what is waiting
--   select * from private.postcard_report_queue;
--
--   -- act on one, keeping the result: it is the only copy of the evidence
--   select private.remove_reported_postcard('<postcard_id>');
--
-- Then delete the Storage object the result names: the `media` bucket (the only
-- one this project has), under `postcards/<author uuid>/`, at the path from
-- `image_path`. Nothing in the database can do this step — no cascade reaches
-- Storage (`009` §3), and Supabase refuses a direct `delete from
-- storage.objects` with `42501: Direct deletion from storage tables is not
-- allowed`, which is why `scripts/storage/sweep-orphans.mjs` goes through the
-- Storage API. **Do it in the same sitting.** Until it runs, the photo is still
-- fetchable by anyone holding a signed URL the app already issued — see the
-- header. The window closes on its own after an hour; deleting the object is
-- what closes it now, and it is also what makes `/legal/privacy` true.
--
-- Leaving a report and taking no action needs no SQL at all — a report is not
-- state, it is a row that stays. There is deliberately no `resolved_at`: that
-- is a moderation product's column, `011` grants no UPDATE on this table to
-- anyone, and adding one would make the queue a workflow with two writers.
--
-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying
-- ---------------------------------------------------------------------------
--   -- the queue answers, and only for the owner
--   select count(*) from private.postcard_report_queue;
--   select has_schema_privilege('authenticated', 'private', 'usage');      -- f
--   select has_schema_privilege('anon', 'private', 'usage');               -- f
--   select has_table_privilege('service_role',
--            'private.postcard_report_queue', 'select');                   -- f
--   select has_function_privilege('service_role',
--            'private.remove_reported_postcard(uuid)', 'execute');         -- f
--   select has_function_privilege('authenticated',
--            'private.remove_reported_postcard(uuid)', 'execute');         -- f
--   select has_table_privilege('service_role',
--            'public.postcard_reports', 'select');                         -- f
--
--   -- and no new advisor: the ten in CLAUDE.md §Supabase Rules, unchanged
