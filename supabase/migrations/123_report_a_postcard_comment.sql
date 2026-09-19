-- 123: A postcard COMMENT can be reported, and the report has a reader. PD-454.
--
-- Additive in every statement, and the second of two files. `122` did the same
-- for a ride thread; this does it for a comment. One new table, two policies,
-- one gate trigger, two objects in `private` that no client role can reach, and
-- two comment restamps. Nothing is dropped, nothing is narrowed, no existing
-- row changes shape and no existing policy is touched.
--
-- ---------------------------------------------------------------------------
-- THE NUMBER: the tasks file says `119` and `119` IS TAKEN
-- ---------------------------------------------------------------------------
-- The proposal and tasks say `118` then `119`, correctly on 2026-09-18. `122`'s
-- header carries the re-derivation in both directions; the short version is that
-- `118` is applied to DEV from an open PR with no file behind it, and `119`,
-- `120` and `121` all have files on `development`. So `122` then `123`.
--
-- ---------------------------------------------------------------------------
-- WHY THE SUBJECT IS THE COMMENT AND NOT THE POSTCARD
-- ---------------------------------------------------------------------------
-- `011` built likes, comments, hides and reports in one file and gave the report
-- to the POSTCARD. A comment on somebody else's postcard is a DIFFERENT SUBJECT
-- WITH A DIFFERENT AUTHOR, and the only remedies a rider has against one today
-- are to block its author or to ask the postcard's author to delete it. Reporting
-- the photo to complain about a sentence under it hands the operator the wrong
-- object and puts the wrong rider's id in the queue.
--
-- ** `094` §2's reasoning applies unchanged, and its third reason still decides
-- it on its own: ** `private.postcard_report_queue` (`076`) inner-joins
-- `public.postcards` AND `public.profiles` on the postcard's author, so a comment
-- report parked in `postcard_reports` either breaks the operator's live queue or
-- — with a `left join` "fix" — quietly vanishes from it. A report in a table no
-- query returns is the exact failure `011` spent sixty-five migrations in. The
-- other three: the subject column cannot be shared without going nullable; the
-- audience predicates differ and cannot share a policy; and the repo's own shape
-- is one table per subject.
--
-- ** `public.moderate_comment(comment_id uuid)` (`011` §1b) is UNTOUCHED. ** It
-- is `security definer`, keyed on the postcard author's `p.author_id =
-- auth.uid()`, and it remains the photo owner's way to remove a comment. This
-- file adds a third, separate right and it never implies either deletion arm:
-- **reporting does not hide.** `011`'s separation stands — a report leaves the
-- comment exactly as visible as it was, and a rider who wants it gone from their
-- own view blocks or hides.
--
-- ** Nobody gains a read. ** Not the commenter, and NOT THE POSTCARD'S AUTHOR
-- whose photo the comment sits on — the single most tempting thing a reasonable
-- implementer would add here, because they already hold a delete right over
-- those comments. They keep the delete and gain no read. `094` Q1's answer
-- (product owner, 2026-08-31: *a report reaches NOBODY in the club*) is
-- reapplied rather than reopened.
--
-- ---------------------------------------------------------------------------
-- THE INHERITED AUDIENCE — read off `pg_policies` on DEV 2026-09-19
-- ---------------------------------------------------------------------------
-- This is the predicate the report INSERT inherits, so any change to it moves
-- who may report. Quoted rather than paraphrased:
--
--   postcard_comments SELECT
--     author_id = auth.uid()
--     OR (EXISTS (SELECT 1 FROM postcards p WHERE p.id = postcard_comments.postcard_id)
--         AND NOT private.is_blocked(auth.uid(), author_id))
--
--   postcards SELECT
--     author_id = auth.uid()
--     OR (NOT private.is_blocked(auth.uid(), author_id)
--         AND (club_id IS NULL OR private.is_club_member(club_id))
--         AND NOT EXISTS (SELECT 1 FROM postcard_hides h
--                          WHERE h.postcard_id = postcards.id AND h.user_id = auth.uid()))
--
-- So the single EXISTS §2 writes carries THREE inherited refusals, none of them
-- named there:
--
--   * A rider outside a PRIVATE CLUB the postcard was posted into is refused —
--     the `private.is_club_member` conjunct inside the `postcards` policy.
--   * A rider the postcard's author has BLOCKED (in either direction — the row is
--     directional and `private.is_blocked` is symmetric) is refused.
--   * A rider who HID the postcard themselves is refused — the hide
--     `NOT EXISTS`. This is the one that surprises people: hiding is a read
--     decision and it removes the reporting route with it.
--
-- ** THE EXCEPTION IS THEIR OWN COMMENT, and it is not a leak. ** The
-- own-comment arm sits at TOP LEVEL in `postcard_comments` SELECT, above the
-- parent EXISTS, so a rider still reads — and may therefore SELF-REPORT, inertly
-- — a comment they wrote on a postcard that has since left their view. An
-- assertion written against the rider's own comment would pass the insert and
-- fail the test, so the suite names somebody else's comment for each of the
-- three refusals and pins the own-comment exception separately.
--
-- Children of `public.postcard_comments`, read off `pg_constraint` on DEV
-- 2026-09-19 rather than remembered (`076`'s header records naming one of five):
-- `notifications` via `comment_id`, ON DELETE CASCADE, and nothing else.
-- `postcard_comment_reports` below makes two.
--
-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — MEASURED ON DEV 2026-09-19, after `122` and before this file
-- ---------------------------------------------------------------------------
--                                                     DEV after 122
--   enforce_participation_gate triggers                23  (22 before 122)
--   public security-definer fns exec by authenticated  38  (unchanged by 122)
--   public tables                                      35, of which 5 have
--                                                      service_role revoked
--   views in private                                   3
--   security advisor findings                           46 (unchanged by 122)
--
-- ** Only the DELTA is claimed. ** This file claims + 1 gate trigger, + 0
-- published definer functions, + 1 revoked table, + 1 private view, + 0 advisor
-- findings. The census after this file is 30 kept / 6 revoked.
--
-- Advisors add zero for the same mechanism `122` gives: this file creates no
-- `public` function at all, so
-- `authenticated_security_definer_function_executable` cannot move from 38, and
-- `security_definer_view` does not reach `private`. `rls_enabled_no_policy` does
-- not fire because the table below has RLS on AND two policies.
--
-- ---------------------------------------------------------------------------
-- ORDERING: additive, MIGRATION-FIRST, and this file is SECOND
-- ---------------------------------------------------------------------------
-- Migration first, bundle second: the client writes a table that does not exist
-- yet, so the reverse ordering answers `PGRST205` behind "Could not send that
-- report." for the length of a deploy.
--
-- ** This file must land AFTER `122`, and the reason is one COMMENT rather than
-- one object. ** The two share no table, view, function or policy. They do both
-- restamp `public.enforce_participation_gate()`'s comment, where the last writer
-- wins: `122` made it twenty-three, this makes it twenty-four, and §2's
-- enumeration below is composed from the comment `122` actually left — read off
-- `pg_proc` after applying it, never from a copy in either file (`092`/`093`'s
-- recorded trap). Applied in the other order the enumeration is wrong and
-- nothing fails.
--
-- ** No second PostgREST relationship. ** `122`'s §ORDERING carries the measured
-- criterion: the table below has a single-column `id` primary key with
-- `unique (reporter_id, comment_id)` as a SEPARATE constraint, so it is not a
-- junction and adds no relationship between `profiles` and `postcard_comments`.
-- A composite primary key instead would silently become one.
--
-- ** `036`'s hand-exercise gate does NOT fire. ** No trigger is hung on an
-- already-shipped write path — the gate trigger is on the new table — and no
-- function anyone calls today is replaced. `public.moderate_comment` is read in
-- this header and not touched.

-- ===========================================================================
-- §1. public.postcard_comment_reports
-- ===========================================================================
create table public.postcard_comment_reports (
  id uuid default uuid_generate_v4() primary key,
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  comment_id uuid references public.postcard_comments(id) on delete cascade not null,
  reason text not null,
  note text,
  created_at timestamptz default now() not null,

  -- `011` §4's six, carried through `094` and `122` verbatim and deliberately
  -- not extended. There is no report frame anywhere in the Figma snapshot
  -- (`npm run figma -- ls "*eport*"` returns 0 of 451, and so do `"*omment*"`
  -- and `"*hread*"`), so the client ships one-tap and sends `other` — the only
  -- value that asserts nothing the rider did not say. Adding a value is a cheap
  -- drop-and-recreate of this one constraint; removing one is not, so the list
  -- stays short on purpose.
  constraint postcard_comment_reports_reason check (
    reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'other')
  ),
  -- Same bound and same trimmed/raw split as the comment body it is about. The
  -- note is optional; an empty string is not a note. FLOOR on the trimmed
  -- length, CEILING on the raw one, so padding cannot smuggle a longer body past
  -- a trimmed check.
  constraint postcard_comment_reports_note_length check (
    note is null or (length(btrim(note)) >= 1 and length(note) <= 1000)
  ),
  -- ** The anti-brigading key. ** Reporting the same comment twice is a
  -- duplicate, and a caller writing `on conflict do nothing` gets a clean no-op
  -- instead of a second row and instead of an error shown to the rider. It also
  -- LEADS with `reporter_id`, so it is the index Postgres uses for the `profiles`
  -- cascade — `029`'s standing rule, satisfied without a second index.
  constraint postcard_comment_reports_one_per_rider unique (reporter_id, comment_id)
);

alter table public.postcard_comment_reports enable row level security;

-- For the `postcard_comments` cascade and for §3's join. Neither the primary key
-- nor the unique index above serves it — the unique index leads with
-- `reporter_id`.
create index postcard_comment_reports_comment_id_idx
  on public.postcard_comment_reports (comment_id, created_at desc);

comment on table public.postcard_comment_reports is
  'Reports filed by riders against a postcard COMMENT (123, PD-454). The subject is the comment and not the postcard: a comment is a different subject with a different author, and 076''s live postcard queue inner-joins public.postcards, so a comment report parked in postcard_reports would either break that queue or vanish from it (094 §2''s third reason). The audience predicate is INHERITED, not restated: the INSERT policy''s EXISTS against public.postcard_comments resolves under the caller''s own RLS, so all three of 011''s refusals apply without being named — a rider outside the postcard''s PRIVATE CLUB, a rider blocked by its author in either direction, and a rider who HID the postcard themselves. ** The exception is the rider''s OWN comment: postcard_comments SELECT carries author_id = auth.uid() at TOP LEVEL, so they still read it after the postcard has left their view and may self-report it, inertly. ** ** NOBODY GAINS A READ ** — not the commenter, and not the postcard''s author whose photo the comment sits on, who already holds a delete right over it through public.moderate_comment (011 §1b) and keeps that delete unchanged. Reporting does not hide: the comment stays exactly as visible as it was. The reporter reads only their own rows; the reader is private.postcard_comment_report_queue, owner-only at the Supabase dashboard. Not editable and not withdrawable: no UPDATE policy, no UPDATE grant, no DELETE policy, no DELETE grant. RETENTION, stated at creation rather than left silent: indefinite, and it dies with its comment and with its reporter through two ON DELETE CASCADEs and nothing else. There is no scheduled deletion, no resolved_at and no take-down ledger; a different retention answer needs a mechanism, not a sentence.';

comment on column public.postcard_comment_reports.created_at is
  'Server-owned, and WITHHELD from the INSERT column grant (034 §4b, 081 §3, 094 §3). The triage queue orders by it, so a client-stamped value would pin a report to the top of the operator''s queue for ever.';

-- ===========================================================================
-- §2. Policies, grants and the gate
-- ===========================================================================
-- ** No visibility conjunct on SELECT, deliberately. ** A report is the
-- reporter's own statement, and evidence that evaporates when the reporter walks
-- away is not evidence. The row holds a comment id, a reason and a note — no
-- comment text — so a rider who has since LEFT THE CLUB, HIDDEN THE POSTCARD or
-- BLOCKED THE COMMENTER leaks nothing by reading their own row back. Adding a
-- conjunct here "for consistency" is the change this comment exists to stop.
--
-- The reporter's own id IS the whole predicate, so there is no parent conjunct
-- above it to dominate the own-row arm (PD-362's shape, avoided by
-- construction).
create policy "Riders see only the comment reports they filed"
  on public.postcard_comment_reports for select to authenticated
  using (reporter_id = auth.uid());

-- ** Names no club predicate, no hide predicate and no block predicate, and
-- inherits all three. ** The EXISTS is evaluated under the CALLER's row
-- security, so "may I report this comment" resolves to "may I read this comment"
-- by construction and cannot drift from the policies `011` owns. Writing
-- `private.is_club_member(...)` here instead would be a second copy of an
-- audience a future change to `011` cannot reach.
--
-- The designed consequences, written out because each is a trap:
--
--   * A rider who cannot see the POSTCARD cannot report another rider's comments
--     on it — a private club they are not in, an author who blocked them, or a
--     postcard THEY THEMSELVES HID, all three arriving through the same
--     `postcards` EXISTS. The last one reads as a bug and is not: hiding is a
--     read decision and it takes the reporting route with it.
--   * ** Block-then-report is UNREACHABLE, in both directions. ** A rider who
--     blocks the commenter first can no longer read the comment, so this EXISTS
--     resolves to zero rows. Already true for a postcard (`011`) and a club
--     thread (`094` N14), and not fixed because every fix is worse: a
--     `security definer` reporting RPC would step past the block to confirm the
--     comment exists and would then have to decide what to tell a caller about a
--     row they cannot see, and a block-arm exemption would let a rider probe for
--     the existence of content by riders who blocked them.
--   * ** On THIS surface the fallback is real in SQL and unreachable from the
--     app, and that cost is stated rather than hidden. ** The postcard's author
--     who has blocked a commenter cannot report that comment — they cannot see
--     it. `public.moderate_comment` (`011` §1b) is `security definer` and keyed
--     on `p.author_id = auth.uid()`, so THE PRIVILEGE GENUINELY SURVIVES THE
--     BLOCK and that function exists for exactly this measured reason. ** What
--     does not survive is the id: ** `postcard_comments` SELECT hides the blocked
--     rider's comment from the photo's owner, so the list never renders it and no
--     screen can hand `moderate_comment` a target. The honest statement of the
--     cost: a comment by a rider the photo's owner has blocked stays visible to
--     EVERY OTHER VIEWER, while its owner can neither see it, report it, nor
--     remove it through any control this app draws. ** That is pre-existing
--     (`011`) and this file does not redesign it ** — the affordance a photo
--     owner would need is a list of comments on their own postcard that the block
--     does not filter, which is a new read path with its own audience question.
--     The suite asserts BOTH halves, and its green half carries a comment saying
--     it is unreachable from the app.
--
-- A SELF-report is permitted and inert — the own-comment arm is at top level, so
-- it is reachable at the policy level here in a way it is not on a thread the
-- reporter cannot read. Excluding it needs a second subquery re-reading the
-- author identity inside a policy whose whole virtue is naming nothing, to
-- prevent a row visible only to an operator who can ignore it. ** The affordance
-- is simply not drawn for the author — a menu row is a display hint, never an
-- authorization. **
create policy "Riders can report visible comments, as themselves"
  on public.postcard_comment_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (select 1 from public.postcard_comments c where c.id = postcard_comment_reports.comment_id)
  );

-- NO UPDATE AND NO DELETE, neither policy nor grant. `011`'s rule, carried
-- through `094` and `122`: a report is a statement of fact at a moment in time,
-- and letting the reporter rewrite or withdraw it makes the table useless as
-- evidence to the reader §3 gives it. ** The absence IS the enforcement, and it
-- is asserted in BOTH directions in the suite, because a well-meaning
-- `grant all` restores only one of them. **

-- ** `service_role` is named in the revoke AT CREATION, and the judgement is
-- written down because there is no mechanical test for it. ** `076` §3's
-- criterion is: rows the one credential that bypasses RLS must not be able to
-- enumerate. A row here is ONE RIDER'S ACCUSATION AGAINST ANOTHER and it carries
-- the reporter's uuid; enumerating them is exactly the reporter-safety failure
-- this file's SELECT policy exists to prevent. On a comment thread under one
-- photo the candidate set is small, so a leaked `reporter_id` names a person
-- rather than narrowing a list. So: revoked, taking `CLAUDE.md` §Supabase Rules'
-- census to 30 kept / 6 revoked (it read 30 / 4 on DEV 2026-09-19 before `122`).
--
-- ** Account deletion is unaffected, and `076` MEASURED that rather than
-- reasoning it: ** a referential cascade runs as the constraint's system
-- trigger, not as the deleting role, so it does not consult privileges at all.
-- `095` measured the same from the other side. The suite repeats the
-- measurement, because getting it wrong takes account deletion down and nothing
-- in CI would notice.
revoke all on public.postcard_comment_reports from public, anon, authenticated, service_role;

-- ** Column-scoped INSERT, a deliberate departure from `011` and a copy of
-- `094` §3. ** `011` granted INSERT at table level, so a client there can name
-- `created_at` and `id`. Here it cannot: `created_at` orders the operator's
-- queue and `id` is the server's. Nothing to `anon` — decision #1, and no route
-- is created or implied for it.
grant select on public.postcard_comment_reports to authenticated;
grant insert (reporter_id, comment_id, reason, note)
  on public.postcard_comment_reports to authenticated;

-- `023`'s shape. ** The `when` clause is not decoration ** — it is what stops
-- the gate firing for the table owner, which is the role the RLS suite runs as
-- and the role a `security definer` body runs as.
--
-- ** The gate fires BEFORE the RLS WITH CHECK, and that is checked rather than
-- assumed harmless. ** `093` shipped a membership oracle on exactly this shape.
-- This trigger cannot, because it is keyed on the CALLER's own
-- `terms_accepted_at` — read from `auth.uid()`, never from a column the caller
-- writes — so an un-onboarded rider gets the same `23514` for a comment they can
-- read and one they cannot. The suite asserts that by STRING EQUALITY between
-- the two refusals, which is the only comparison that can see the two diverge.
drop trigger if exists enforce_participation_gate on public.postcard_comment_reports;
create trigger enforce_participation_gate
  before insert on public.postcard_comment_reports
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- ** Composed from the LIVE comment, read off `pg_proc` on DEV AFTER `122`
-- applied ** — not from `122`'s copy of it and not from any earlier file
-- (`092`/`093`'s recorded trap, and `122` is the last writer before this line).
-- Twenty-four is the trigger count measured after `122` (twenty-three) plus this
-- file's one; `122`'s header records why the count had to be read off
-- `pg_trigger` rather than incremented from the string.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, twenty-four BEFORE INSERT triggers — the ninth is ride_map_render_attempts (051), the tenth place_search_attempts (069), the eleventh club_threads and the twelfth club_messages (081, the eleventh renamed from club_discussions by 082), the thirteenth ride_invites (083), the fourteenth feedback (084), the fifteenth club_join_requests (085), the sixteenth ride_invite_links (091), the seventeenth club_join_waves (092), the eighteenth club_invites and the nineteenth club_invite_links (093), the twentieth club_thread_reports (094), the twenty-first ride_threads and the twenty-second ride_thread_messages (108), the twenty-third ride_thread_reports (122), the twenty-fourth postcard_comment_reports (123); the five uncovered INSERT-policy tables are named in 023''s header with their reasons. The ordinals are positions in this list and nothing more, and TWO tables have been dropped out of the middle of it: club_thread_waves, which 092 made the eighteenth and 101 (PD-373) dropped, and ride_messages, which 034 made the ninth and 109 dropped — each time every entry after it shifted down by one, and no trigger moved. ** Both 122 and 123 read the count off pg_trigger rather than off this string, and 122 had to: the stamp it inherited said twenty-three while the live count was twenty-two, ride_messages'' removal having been recorded as a trailing sentence instead of folded into the enumeration. Twenty-two on DEV 2026-09-19 before 122, twenty-three after it, twenty-four after this file. **';

-- ===========================================================================
-- §3. The reader, in the same file — `076`/`094`/`122` line for line
-- ===========================================================================
-- Both objects live in `private` and the barrier is THREE layers, none of them
-- sufficient alone:
--
--   1. `anon` and `authenticated` hold no USAGE on `private` at all (`005`),
--      so the objects are unreachable before any grant on them is considered.
--   2. `service_role` DOES hold USAGE (`031`), so the revokes below name it
--      explicitly rather than relying on the schema.
--   3. PostgREST routes only to `public`, so supabase-js's `.schema('private')`
--      is refused before it reaches Postgres. `031` is the worked example.
--
-- ** The view runs as its OWNER and therefore steps past every club, hide and
-- block predicate in the system. ** That is what it is for, and it is precisely
-- why no PostgREST role may reach it: it must not become a second way to read a
-- comment on a private club's photo. It is NOT a narrower way to read one — it is
-- a PRE-JOINED way to read what the owner could already read with a hand-written
-- join. Nobody else gains a byte, and no route from the app to either object is
-- created, implied or left open.
--
-- `with (security_invoker = false)` is WRITTEN OUT. It is the default AND the
-- entire reason the view can answer, so leaving it implicit would be a
-- load-bearing default nobody can see (`076` §1).
--
-- ** The reporter appears as a uuid and nothing more, ** for the reason `076` and
-- `094` give: the reported rider's username is context for judging the words, the
-- reporter's is not needed to judge them, and a view that ever escapes its schema
-- then leaks less. No column of `auth.users` appears here.
--
-- ** And NO `image_path`, which is a departure from `076` rather than an
-- omission. ** `076`'s queue carries it because a postcard take-down leaves a
-- Storage object behind that only the operator can delete, and its runbook has a
-- second step for exactly that. A COMMENT take-down leaves nothing in Storage,
-- and a comment is judged on its text. Omitting the column keeps the
-- minimum-exposure rule honest: an offensive PHOTO is reportable on the surface
-- that already carries that column. The caption is here because it is the
-- context a sentence is read in; the image is not.
create or replace view private.postcard_comment_report_queue
with (security_invoker = false) as
  select
    r.id                as report_id,
    r.created_at        as reported_at,
    r.reason,
    r.note,
    r.reporter_id,
    c.id                as comment_id,
    c.body              as comment_body,
    c.created_at        as comment_created_at,
    commenter.id        as commenter_id,
    commenter.username  as commenter_username,
    p.id                as postcard_id,
    p.caption           as postcard_caption,
    p.club_id           as postcard_club_id,
    photographer.id     as postcard_author_id,
    photographer.username as postcard_author_username,
    -- Both counts are OPEN reports only. Reports cascade with their comment, so
    -- a take-down zeroes the first and reduces the second; neither is a history,
    -- and a repeat offender therefore under-counts. `076` D5's decision,
    -- restated: the alternative is a moderation archive with a lawful basis and
    -- a retention window, which is a product rather than a column.
    (select count(*) from public.postcard_comment_reports other
      where other.comment_id = c.id)            as reports_on_this_comment,
    (select count(*) from public.postcard_comment_reports other
       join public.postcard_comments other_c on other_c.id = other.comment_id
      where other_c.author_id = c.author_id)    as reports_on_this_commenter
  from public.postcard_comment_reports r
  join public.postcard_comments c      on c.id = r.comment_id
  join public.postcards p              on p.id = c.postcard_id
  join public.profiles commenter       on commenter.id = c.author_id
  join public.profiles photographer    on photographer.id = p.author_id
  order by r.created_at desc;

comment on view private.postcard_comment_report_queue is
  'Triage queue for postcard-comment reports (123, PD-454). reports_on_this_comment and reports_on_this_commenter count OPEN reports only — reports cascade with their comment, so a take-down erases that history and a repeat offender under-counts (076 D5''s retention decision, restated rather than fixed). Readable ONLY by the table owner at the Supabase dashboard: private is not routed by PostgREST, anon and authenticated hold no USAGE on the schema (005), and service_role, which does hold USAGE (031), is refused by an explicit revoke. Runs as its owner by design, so it sees rows RLS would hide from the caller — a PRE-JOINED view of what the owner could already read with a hand-written join, never a narrower one, and ** never a second way to read a comment on a private club''s photo **. The reporter appears as a uuid only. No column of auth.users appears here. ** And deliberately NO image_path, which is a departure from 076 rather than an omission: ** a comment take-down leaves nothing in Storage, so there is no second runbook step for it, and a comment is judged on its text — the caption is here as the context the words sit in, the photo is not, and an offensive PHOTO is reportable on the surface that already carries that column (D12). Fourth sibling of private.postcard_report_queue (076), private.club_thread_report_queue (094) and private.ride_thread_report_queue (122); four queues rather than one, because a union over four subject shapes either loses columns or invents nullable ones. §Operating it in this file carries the union for an operator who wants one pane.';

-- ** Not `security definer`, granted to nobody, and both are deliberate. **
-- Not definer because there is nothing to escalate to: the only caller is the
-- owner, who already holds BYPASSRLS. The advisor is NOT the reason —
-- `authenticated_security_definer_function_executable` fires per PUBLIC definer
-- function EXECUTABLE BY `authenticated`, and a `private` function with its
-- EXECUTE revoked is executable by nobody. The precedent is read rather than
-- reasoned: `private.remove_reported_postcard` (`076`),
-- `private.remove_reported_thread` (`094`) and
-- `private.remove_reported_ride_thread` (`122`) all have `prosecdef = false`,
-- measured on DEV 2026-09-19.
--
-- ** It reads the evidence BEFORE the delete, because the delete destroys it. **
-- The reports cascade from the comment; selecting them afterwards returns null
-- and looks exactly like a comment nobody had reported. The alternative — an
-- archive that outlives the comment — is a new store of exactly the personal data
-- `029`'s cascade exists to remove and `/legal/account-deletion` promises is
-- gone. `076` D5 refused it and this refuses it identically.
--
-- ** Unlike `076` there is NO SECOND STEP. ** `notifications.comment_id` cascades
-- with the comment (read off `pg_constraint`, ON DELETE CASCADE) and no Storage
-- object is involved at all, so the take-down is the whole action and the
-- operator has nothing to sweep afterwards. Unlike `094` and `122` the subject IS
-- the message, so there is no proportionality problem either: removing one
-- comment destroys one comment.
create or replace function private.remove_reported_comment(target uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  evidence jsonb;
  removed integer;
begin
  select jsonb_build_object(
           'comment_id', c.id,
           'comment_body', c.body,
           'comment_created_at', c.created_at,
           'commenter_id', c.author_id,
           'commenter_username', cm.username,
           'postcard_id', p.id,
           'postcard_caption', p.caption,
           'postcard_club_id', p.club_id,
           'postcard_author_id', p.author_id,
           'postcard_author_username', ph.username,
           'reports', coalesce(
             -- Reporters by uuid here too, for the reason the view gives.
             (select jsonb_agg(jsonb_build_object(
                       'reported_at', r.created_at,
                       'reason', r.reason,
                       'note', r.note,
                       'reporter_id', r.reporter_id)
                     order by r.created_at)
                from public.postcard_comment_reports r
               where r.comment_id = c.id),
             '[]'::jsonb))
    into evidence
    from public.postcard_comments c
    join public.postcards p   on p.id = c.postcard_id
    join public.profiles cm   on cm.id = c.author_id
    join public.profiles ph   on ph.id = p.author_id
   where c.id = target;

  if evidence is null then
    -- A comment that does not exist is a clean answer, not an error — `076`'s
    -- shape, for its reason: an operator acting on a queue row somebody already
    -- deleted has done nothing wrong, and a subject deleted after being reported
    -- leaves the queue silently by the same cascade.
    return jsonb_build_object('removed', false, 'reason', 'no such comment');
  end if;

  -- The cascade list is read off `pg_constraint` at write time, never
  -- remembered — `076`'s header records naming one of five. The only child of
  -- `public.postcard_comments` on DEV 2026-09-19 is `notifications` via
  -- `comment_id`, ON DELETE CASCADE, plus `postcard_comment_reports` from this
  -- file. ** No Storage object is involved, so unlike `076` there is no second
  -- step. **
  delete from public.postcard_comments where id = target;
  get diagnostics removed = row_count;

  return evidence || jsonb_build_object('removed', removed > 0, 'removed_at', now());
end;
$$;

comment on function private.remove_reported_comment(uuid) is
  'Removes exactly one postcard comment and returns what it destroyed — the comment, its author, the postcard it sits on with that postcard''s author, and the reports about it. Reads the evidence BEFORE the delete because the cascade destroys it (076 D5''s retention decision, restated). A target that does not exist returns {"removed": false, "reason": "no such comment"} rather than raising, because an operator acting on a queue row somebody already deleted has done nothing wrong. ** No second step: ** notifications.comment_id cascades with the comment and NO STORAGE OBJECT IS INVOLVED, unlike 076''s postcard take-down whose runbook owes a Storage delete. Owner-only: private is not routed by PostgREST, EXECUTE is granted to nobody, and it is deliberately NOT security definer — its only caller already holds BYPASSRLS (076, 094 and 122''s take-downs are all prosecdef = false). ** Distinct from public.moderate_comment(uuid), which is 011 §1b''s postcard-author delete right and is untouched by 123. ** See 123.';

-- ** The grant IS the access control here. ** RLS is irrelevant to a view
-- running as its owner and to a function in `private` that is not published, so
-- it is stated absolutely rather than left to the schema's default, and
-- `service_role` is named because it is the one client-side role for which the
-- schema is not already the barrier. Neither object is a write surface for any
-- role but the owner.
revoke all on private.postcard_comment_report_queue from public, anon, authenticated, service_role;
revoke all on function private.remove_reported_comment(uuid) from public, anon, authenticated, service_role;

-- ===========================================================================
-- §4. `public.postcard_comments`' table comment names the report table
-- ===========================================================================
-- `011` set it and it has been two sentences ever since. It is the first thing
-- anyone reads off `\d+ postcard_comments` or `list_tables`, so leaving it would
-- leave the database itself asserting that a comment has no report. ** Composed
-- from the LIVE comment, with the inherited-audience detail and the report
-- sentence added and nothing removed. **
comment on table public.postcard_comments is
  'A comment inherits its postcard''s audience. Every policy delegates to postcards via EXISTS rather than restating the club predicate — see 009 §4 for the same shape on likes. ** The own-comment arm sits at TOP LEVEL in SELECT (author_id = auth.uid()), above that parent EXISTS, ** so a rider keeps reading a comment they wrote on a postcard that has since left their view — a private club they left, an author who blocked them, or a postcard they hid — and may therefore self-report it, inertly (123). Deleted by its author or by the POSTCARD''S author, the latter through public.moderate_comment(uuid) (011 §1b), which is security definer and keyed on p.author_id = auth.uid() and therefore survives a block the SELECT policy does not — so the privilege outlives the block while the ID does not, and no screen can supply a target for a comment the photo''s owner cannot see. ** Reportable by any rider who can read it, into public.postcard_comment_reports (123, PD-454), and NOBODY GAINS A READ OF THOSE ** — not the commenter, not the postcard''s author who holds the delete right. Reporting is a third right, separate from both delete arms, and it never implies either: a report leaves the comment exactly as visible as it was.';

-- ===========================================================================
-- §Operating it — because a queue nobody knows how to read is the same gap
--                 with more SQL in it
-- ===========================================================================
-- At the Supabase dashboard's SQL editor, which connects as the table owner:
--
--   -- what is waiting
--   select * from private.postcard_comment_report_queue;
--
--   -- act on one, KEEPING THE RESULT: it is the only copy of the evidence
--   select private.remove_reported_comment('<comment_id>');
--
-- ** There is no Storage step, unlike `076`. ** A comment has no image, and
-- `notifications.comment_id` goes with it on the cascade. That is the whole
-- blast radius: one comment, its notifications and its reports.
--
-- Leaving a report and taking no action needs no SQL at all — a report is not
-- state, it is a row that stays. ** There is deliberately no `resolved_at`. **
-- That is a moderation product's column: it needs an UPDATE grant, which `011`,
-- `076`, `094` and `122` all refuse, and it would make the queue a workflow with
-- two writers.
--
-- ** FOUR queues now, not one, and the union is here rather than as a view. ** A
-- `union all` over four subject shapes either loses columns or invents nullable
-- ones, and each queue earns its columns by being about exactly one thing. For
-- an operator who wants one pane:
--
--   select 'postcard' as kind, report_id, reported_at, reason, note,
--          reporter_id, author_username
--     from private.postcard_report_queue
--   union all
--   select 'club thread', report_id, reported_at, reason, note,
--          reporter_id, author_username
--     from private.club_thread_report_queue
--   union all
--   select 'ride thread', report_id, reported_at, reason, note,
--          reporter_id, author_username
--     from private.ride_thread_report_queue
--   union all
--   select 'comment', report_id, reported_at, reason, note,
--          reporter_id, commenter_username
--     from private.postcard_comment_report_queue
--    order by reported_at desc;
--
-- ** Note the last SELECT names `commenter_username`, not `author_username`. **
-- This queue has two riders in it and neither is "the author" without saying
-- which: `commenter_username` wrote the reported words, `postcard_author_username`
-- owns the photo they sit under. A union written from `094`'s line verbatim fails
-- with `column "author_username" does not exist`, which is the cheap failure; the
-- expensive one would have been naming the photo's owner as the reported party.
--
-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- §2: the policy set, as a sorted COMMAND LIST rather than a count — a
--   -- count of 2 also passes for a set that swapped SELECT for UPDATE.
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'postcard_comment_reports';
--                                                        -- INSERT,SELECT
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'postcard_comment_reports'
--      and roles <> '{authenticated}';                                     -- 0
--
--   -- §2: grants, SCOPED TO THE GRANTEE (015's trap — a table-wide count reads
--   -- high because postgres and service_role hold everything by default)
--   select privilege_type from information_schema.table_privileges
--    where table_name = 'postcard_comment_reports' and grantee = 'authenticated'
--    order by 1;                                                    -- SELECT
--   select column_name from information_schema.column_privileges
--    where table_name = 'postcard_comment_reports' and grantee = 'authenticated'
--      and privilege_type = 'INSERT' order by 1;
--                                   -- comment_id, note, reason, reporter_id
--   select has_table_privilege('authenticated',
--            'public.postcard_comment_reports', 'update'),                 -- f
--          has_table_privilege('authenticated',
--            'public.postcard_comment_reports', 'delete'),                 -- f
--          has_table_privilege('anon',
--            'public.postcard_comment_reports', 'select'),                 -- f
--          has_table_privilege('service_role',
--            'public.postcard_comment_reports', 'select');                 -- f
--
--   -- the census CLAUDE.md §Supabase Rules carries: 30 kept / 6 revoked after
--   -- this file (30 / 4 before 122).
--
--   -- §2: the gate, by TABLE NAME and by DELTA. Both, because a count alone
--   -- cannot tell a new gate from a moved one.
--   select count(*) from pg_trigger t
--    where t.tgname = 'enforce_participation_gate' and not t.tgisinternal
--      and t.tgrelid = 'public.postcard_comment_reports'::regclass;        -- 1
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate'
--      and not tgisinternal;                             -- 23 + 1 = 24 on DEV
--
--   -- §3: private is unreachable, BY ROLE rather than by calling it as the
--   -- owner — 031 exists because 029 shipped a function nothing could call and
--   -- the suite, which runs as the table owner, did not notice.
--   select has_schema_privilege('authenticated', 'private', 'usage'),      -- f
--          has_schema_privilege('anon', 'private', 'usage'),               -- f
--          has_table_privilege('service_role',
--            'private.postcard_comment_report_queue', 'select'),           -- f
--          has_function_privilege('service_role',
--            'private.remove_reported_comment(uuid)', 'execute'),          -- f
--          has_function_privilege('authenticated',
--            'private.remove_reported_comment(uuid)', 'execute');          -- f
--   select prosecdef from pg_proc
--    where oid = 'private.remove_reported_comment(uuid)'::regprocedure;    -- f
--   select reloptions from pg_class
--    where oid = 'private.postcard_comment_report_queue'::regclass;
--                                            -- {security_invoker=false}
--   -- and NO image_path in the queue (D12)
--   select count(*) from pg_attribute
--    where attrelid = 'private.postcard_comment_report_queue'::regclass
--      and attname = 'image_path';                                        -- 0
--   -- and 011's moderate_comment is untouched and still definer
--   select prosecdef from pg_proc
--    where oid = 'public.moderate_comment(uuid)'::regprocedure;            -- t
--
--   -- advisors: NO new finding. The published definer count is unchanged.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--                                                       -- 38 on DEV, + 0
--
-- ===========================================================================
-- §Rollback — per file and complete
-- ===========================================================================
--   drop function private.remove_reported_comment(uuid);
--   drop view private.postcard_comment_report_queue;
--   drop table public.postcard_comment_reports;    -- takes its trigger with it
--   -- restamp public.enforce_participation_gate()'s comment back to
--   -- twenty-three, dropping the twenty-fourth entry, and restamp
--   -- public.postcard_comments' comment back to 011's two sentences.
-- Nothing else moved, so the rollback is complete rather than approximate. It is
-- also independent of `122`: the two files share no object, so either can be
-- rolled back alone, and if only one of the two ever applies, ship only that
-- subject's affordance.
