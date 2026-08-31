-- 094: An ADMIN can moderate a club thread, and any member can REPORT one.
--      PD-348.
--
-- Two halves, one file. Additive in both: one function widened to admit a
-- strictly larger set of callers, one new table with two policies, one gate
-- trigger, and two objects in `private` that no client role can reach. Nobody
-- loses a right and no existing row changes shape.
--
-- ---------------------------------------------------------------------------
-- Provenance — the issue body gets this wrong, so it is corrected here
-- ---------------------------------------------------------------------------
-- PD-348 attributes `moderate_club_thread` to `043`. It is not. `043` is
-- `public.delete_owned_club`. The function widened below was created by `081`
-- (PD-307) as `public.moderate_club_discussion(discussion uuid)` and renamed —
-- name AND parameter — by `082` (PD-313) to
-- `public.moderate_club_thread(thread uuid)`. Read `082` §6c before this file;
-- `043` is a different function about a different object and following the
-- issue's pointer leads to the club-deletion RPC.
--
-- ---------------------------------------------------------------------------
-- Half one: why the admin arm exists at all
-- ---------------------------------------------------------------------------
-- `082`'s body gates on `c.owner_id = v_uid` and nothing else. `088` (PD-326)
-- made `club_members.role = 'admin'` writable for the first time in this
-- project's life — the column has carried the value since `001`'s CHECK and
-- nothing had ever written it — so a rider promoted through
-- `promote_club_member` finds the one moderation control in a club refusing
-- them. Every other admin-shaped capability in the schema reads
-- `private.is_club_admin_for`; this one predates it.
--
-- ** The widening delegates its WHOLE access-control decision to that helper
-- and writes no second spelling of "owner or admin". ** Two shapes that look
-- equivalent and are not:
--
--   * `m.role in ('owner','admin')` alone, dropping the `clubs.owner_id`
--     disjunct. Tidier, and it silently removes an owner who holds no roster
--     row — the `054`/PD-128 state, which is reachable today and which
--     `enforce-creator-membership` has NOT shipped (verified below).
--   * `c.owner_id = v_uid or private.is_club_admin_for(...)`, keeping the old
--     conjunct beside the helper. Redundant, the helper's FIRST disjunct being
--     exactly that predicate, and two spellings of one rule is how they drift.
--
-- `moderate_club_thread` may call a `private` function no client role can
-- execute, because it is itself `security definer` and therefore runs as the
-- owner. `085`'s own `approve_club_join_request` does the same. Do NOT add a
-- grant to make it "work" — if it appears not to, the caller is wrong.
--
-- ---------------------------------------------------------------------------
-- Half two: a club thread was the only user-generated surface with no report
-- ---------------------------------------------------------------------------
-- A postcard has one (`011`, and a reader since `076`). A thread — a persistent
-- titled object every member of a club reads — had a ⋯ menu offering deletion
-- and nothing else. App Store Review Guideline 1.2 asks a user-generated-content
-- app for a way to report, a way to block, a way to hide, and ACTION on what is
-- reported.
--
-- ** `076`'s title is the whole lesson: reports have a reader. ** `011` shipped
-- a report table with no reader and it took sixty-five migrations to close. So
-- the reader ships in the same file as the table, and it is `076` line for
-- line: a view and a take-down in `private`, revoked from every client role
-- including `service_role`, read by the project owner at the dashboard. There
-- is still no admin role and no moderator claim in the JWT.
--
-- ** Q1 was put to the product owner on 2026-08-31 and answered: a report
-- reaches NOBODY in the club. ** Not the thread's author, not the club's owner,
-- not its admins. They gain a delete in this file; they gain no read. The three
-- reasons are in the change's `design.md` D7 and the load-bearing one is that
-- the reported party is frequently the reader — a thread's author can be the
-- club's owner or an admin, and `088` lets an admin be promoted by another
-- admin. In a five-member club even an unattributed flag narrows the reporter
-- to a handful of names, and the admin can now remove that rider (`088`) and
-- delete their thread (this file).
--
-- ---------------------------------------------------------------------------
-- Pre-flight — MEASURED 2026-08-31, not recalled
-- ---------------------------------------------------------------------------
-- Through the Supabase MCP `execute_sql` (a privileged role, so these are true
-- counts) against DEV `fpmrimzxadewsaiwpsel` and PROD `zwprydcyryvudhurbnye`,
-- and against a full local replay of the chain on Postgres 17.
--
--                                          DEV     PROD    local replay
--   migrations applied                     091     091     093 (files)
--   enforce_participation_gate triggers      17      17      21
--   public security-definer fns
--     executable by `authenticated`          24      24      30
--   club_members rows with role='admin'       0       0       -
--
-- ** The absolute numbers differ by design and only the DELTA is asserted. **
-- `092` and `093` are on disk and applied to NEITHER project; they add two gate
-- triggers each (`club_thread_waves`, `club_join_waves`; `club_invites`,
-- `club_invite_links`) and `093` adds six published `security definer`
-- functions. So a project's absolute count depends on which of `092`–`095` has
-- applied, and this file claims `before + 1` gate triggers and `before + 0`
-- published definer functions.
--
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--
-- `private.is_club_admin_for`'s body, pinned by EQUALITY rather than by a
-- `like` (`085.28`'s rule — a mention of the name in a comment satisfies a
-- pattern match). Read off `pg_proc.prosrc` on DEV, 2026-08-31:
--
--   select exists (
--     select 1 from public.clubs c
--      where c.id = target_club
--        and c.owner_id = candidate
--   ) or exists (
--     select 1 from public.club_members m
--      where m.club_id = target_club
--        and m.user_id = candidate
--        and m.role in ('owner', 'admin')
--   );
--
-- The FIRST disjunct is `clubs.owner_id = candidate`. That is what preserves
-- the ownerless owner BY CONSTRUCTION rather than by remembering to re-add an
-- arm, and it is the single reason this file delegates instead of writing its
-- own disjunction.
--
-- `club_threads` SELECT, read off `pg_policies` on DEV the same day — this is
-- the predicate the report INSERT inherits, and any change to it moves who may
-- report:
--
--   EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_threads.club_id)
--   AND private.is_club_member(club_id)
--   AND (author_id = auth.uid() OR NOT private.is_blocked(auth.uid(), author_id))
--
-- Children of `club_threads`, read off `pg_constraint` rather than remembered
-- (`076`'s header records naming one of five): `club_messages`,
-- `club_thread_reads`, and `club_thread_waves` once `092` applies — all three
-- `ON DELETE CASCADE`, and `club_thread_reports` below makes four. `036`'s
-- `notifications` has no `thread_id` column and is NOT in the chain.
--
-- ---------------------------------------------------------------------------
-- Security advisors: this file adds ZERO
-- ---------------------------------------------------------------------------
-- `authenticated_security_definer_function_executable` fires once per PUBLIC
-- `security definer` function executable by `authenticated`, so the count moves
-- by the number of NEW published ones. `moderate_club_thread` is already one —
-- widening it adds nothing — and the two objects below live in `private`, which
-- PostgREST does not route to and which the `security_definer_view` advisor
-- does not reach. `085`'s eight private helpers adding zero between them is the
-- same rule from the other side. A new WARN after applying this file means
-- something landed in `public` by mistake.
--
-- ---------------------------------------------------------------------------
-- Ordering: additive, and the migration goes FIRST
-- ---------------------------------------------------------------------------
-- `069`'s rule in its ordinary direction. Migration first, bundle second: an
-- admin does not see the moderation row yet and no rider sees a Report row —
-- nothing is broken, a capability is merely not yet drawn. The reverse gives an
-- admin a Delete that returns `42501` behind "That thread could not be deleted."
-- and a rider a Report that returns `PGRST205` (no such table), for the length
-- of a deploy.
--
-- ** `036`'s hand-exercise gate FIRES, and not for its usual reason. ** No
-- trigger is hung on an already-shipped write path — the gate trigger is on the
-- new table. But a function OWNERS CALL TODAY is replaced, so from the moment
-- this applies every existing moderation runs new code inside a rider's own
-- transaction. Exercise it by hand on DEV first, in a rolled-back transaction,
-- as `authenticated`: an owner still succeeds, an admin now succeeds, a plain
-- member is refused, a stranger is refused with the SAME message.

-- ===========================================================================
-- §1. The admin arm
-- ===========================================================================
-- ** `create or replace`, never drop-and-recreate. ** The signature is
-- unchanged, so replace is available, and it preserves the ACL and the OID. A
-- drop-and-recreate is born EXECUTE to PUBLIC — which includes `anon` — and
-- `082` §7 is the worked example of having to re-issue `revoke all … from
-- public, anon` plus `grant execute … to authenticated` afterwards to undo it.
-- `082` had no choice; this file does.
--
-- ** No revoke and no grant is re-issued below. ** Re-issuing them would make a
-- future reader think the ACL had been reset. The suite asserts `anon` holds no
-- EXECUTE and `authenticated` does, AFTER this file, which is the tripwire.
--
-- ** Exactly ONE raise site, and no session guard ahead of it. ** `088`'s three
-- RPCs carry a `requires a session` raise first and this deliberately does not
-- copy that: `private.is_club_admin_for(null, club)` is false on both
-- disjuncts, so a session-less caller leaves by the same door as a stranger,
-- and a second exit buys nothing a caller does not already know about their own
-- session. Keeping one raise is also what makes the indistinguishability
-- assertion writable as a STRING EQUALITY between two refusals rather than as
-- "an error was raised" — which cannot see the two diverge.
--
-- The join to `clubs` disappears and that is not a loss: `082` joined it only
-- to reach `owner_id`, the helper's first disjunct reads the same column, and
-- `club_members.club_id` carries a foreign key into `clubs`, so the second
-- disjunct cannot be true for a club that does not exist. `for update of d` is
-- still legal — it names the only table left.
create or replace function public.moderate_club_thread(thread uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  -- The whole access control is `private.is_club_admin_for`. There is no policy
  -- backstop behind this line: `security definer` runs the body with RLS
  -- bypassed, so this predicate is the only thing between a caller and another
  -- club's conversation.
  select d.id
    into v_id
    from public.club_threads d
   where d.id = thread
     and private.is_club_admin_for(v_uid, d.club_id)
     for update of d;

  if not found then
    raise exception 'no thread with that id sits in a club the caller administers'
      using errcode = 'insufficient_privilege';
  end if;

  -- One row. The FK cascade takes the messages, the read watermarks, `092`'s
  -- waves once it applies, and §2's reports.
  delete from public.club_threads d where d.id = v_id;
end;
$$;

comment on function public.moderate_club_thread(uuid) is
  'Deletes exactly one thread in a club the caller ADMINISTERS — owner or admin, widened by 094 (PD-348) from 082''s owner-only gate. The single predicate is private.is_club_admin_for(auth.uid(), club_id) and no second spelling of "owner or admin" is written here; the OWNER arm survives as that helper''s FIRST disjunct (clubs.owner_id), so an owner holding no club_members row keeps the reach 054/PD-128 gave them. An author deleting their own thread goes through 081''s DELETE POLICY, not this function — a definer function is the wider hammer and the narrower right wins. One raise site: no such thread, not your club, a club you cannot see and a plain member all leave by the same door with one insufficient_privilege and one message. The right survives a block in either direction, which is why it is an RPC and not a DELETE policy arm: RLS filters a DELETE by what the caller may READ, so an admin who blocked the author would match zero rows and PostgREST would report success.';

-- ===========================================================================
-- §2. public.club_thread_reports
-- ===========================================================================
-- ** A new table rather than a widened `postcard_reports`, and the third reason
-- alone settles it. **
--
--   1. The subject column cannot be shared without going nullable.
--      `postcard_reports.postcard_id` is NOT NULL with an FK and a
--      `unique (reporter_id, postcard_id)`. Widening means dropping the NOT
--      NULL, adding a nullable `thread_id`, adding a CHECK that exactly one is
--      set, and replacing the unique constraint with two PARTIAL unique
--      indexes — every one a change to a live table riders write to today, for
--      a feature that touches none of its rows.
--   2. The audience predicates differ and cannot share a policy. `011`'s INSERT
--      inherits block, club and hide predicates by an EXISTS against
--      `postcards`, and its stated virtue is that it names none of them. A
--      thread report must EXISTS against `club_threads`, which inherits
--      MEMBERSHIP and a differently-shaped block arm. One table means a
--      branching `with check` that names both, and the property `011` was
--      written for is gone.
--   3. ** There is a LIVE reader and its join is unconditional. **
--      `private.postcard_report_queue` (`076`) inner-joins `public.postcards`
--      and `public.profiles`. A thread report landing in `postcard_reports`
--      would either break that view or — with a `left join` "fix" — quietly
--      vanish from the queue the operator reads. A report that lands in a table
--      nobody's query returns is worse than no table, and it is the exact
--      failure `011` spent sixty-five migrations in.
--   4. The repo's own shape is one table per subject: `postcard_likes`,
--      `postcard_comments`, `postcard_hides`, `postcard_reports`, and on the
--      thread side `club_thread_reads` and `092`'s `club_thread_waves`.
--
-- The cost, stated rather than hidden: two report tables mean two queues (see
-- §Operating it) and two places to keep the reason list in step with
-- `REPORT_REASONS`. `011` already records that the Zod enum and its CHECK are
-- kept in step by hand with no automated check, so the suite asserts the
-- CHECK's ACCEPTED SET from `pg_constraint`, which is the half a SQL test can
-- see.
create table public.club_thread_reports (
  id uuid default uuid_generate_v4() primary key,
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  thread_id uuid references public.club_threads(id) on delete cascade not null,
  reason text not null,
  note text,
  created_at timestamptz default now() not null,
  -- `011` §4's six, verbatim, and deliberately not extended. They are the
  -- common denominator of every platform's report sheet rather than a
  -- transcription of ours: there is no thread-report frame in the Figma
  -- snapshot at all (`npm run figma -- ls "*eport*"`), so the client ships
  -- one-tap and sends `other`, which is the only value that asserts nothing the
  -- rider did not say. Adding a value is a cheap drop-and-recreate of this one
  -- constraint; removing one is not, so the list stays short on purpose.
  constraint club_thread_reports_reason check (
    reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'other')
  ),
  -- Same bound and same trimmed/raw split as a comment body and a postcard
  -- report. The note is optional; an empty string is not a note.
  constraint club_thread_reports_note_length check (
    note is null or (length(btrim(note)) >= 1 and length(note) <= 1000)
  ),
  -- ** The anti-brigading key. ** Reporting the same thread twice is a
  -- duplicate, and a caller writing `on conflict do nothing` gets a clean no-op
  -- instead of a second row. Without it one rider could file ten thousand
  -- reports against one thread and the queue below would be reading a
  -- brigading tool rather than a signal. It also LEADS with `reporter_id`, so
  -- it is the index Postgres uses for the `profiles` cascade — `029`'s standing
  -- rule, satisfied without a second index.
  constraint club_thread_reports_one_per_rider unique (reporter_id, thread_id)
);

alter table public.club_thread_reports enable row level security;

-- For the `club_threads` cascade and for the queue's join. Neither the primary
-- key nor the unique index above serves it — the unique index leads with
-- `reporter_id`.
create index club_thread_reports_thread_id_idx
  on public.club_thread_reports (thread_id, created_at desc);

comment on table public.club_thread_reports is
  'Reports filed by riders against a club thread (094, PD-348). The audience predicate is INHERITED, not restated: the INSERT policy''s EXISTS against club_threads resolves under the caller''s own RLS, so 081''s membership conjunct and its block arm both apply and neither is named here. ** NOBODY IN THE CLUB READS THIS TABLE ** — not the thread''s author, not the club''s owner, not its admins; the product owner decided that on 2026-08-31. The reporter reads only their own rows and the reader is private.club_thread_report_queue, owner-only at the Supabase dashboard. A report is not editable and not withdrawable: no UPDATE policy, no UPDATE grant, no DELETE policy, no DELETE grant. RETENTION, stated at creation rather than left silent: indefinite, and it dies with its thread and with its reporter through two ON DELETE CASCADEs and nothing else. There is no scheduled deletion and no resolved_at; a different retention answer needs a mechanism, not a sentence.';

comment on column public.club_thread_reports.created_at is
  'Server-owned, and WITHHELD from the INSERT column grant (034 §4b, 081 §3). The triage queue orders by it, so a client-stamped value would pin a report to the top of the operator''s queue for ever.';

-- ===========================================================================
-- §3. Policies and grants
-- ===========================================================================
-- ** No membership conjunct on SELECT, deliberately. ** A report is the
-- reporter's own statement, and evidence that evaporates when the reporter
-- leaves the club is not evidence. The row holds a thread id, a reason and a
-- note — no thread content — so a reporter who has left, or who has since
-- blocked the author, leaks nothing about the club by reading it back. Adding
-- a conjunct here "for consistency" is the change this comment exists to stop.
--
-- ** This is also the own-row read arm in its correct position. ** PD-362
-- records seven policies in this schema that write `<parent EXISTS> and
-- (user_id = auth.uid() or not is_blocked(…))`, where the parent dominates and
-- the own-row branch is a no-op. There is no parent conjunct here at all: the
-- reporter's own id IS the whole predicate, so the arm cannot be shadowed.
create policy "Riders see only the thread reports they filed"
  on public.club_thread_reports for select to authenticated
  using (reporter_id = auth.uid());

-- ** Names no membership predicate, no club predicate and no block predicate,
-- and inherits all three. ** The EXISTS is evaluated under the CALLER's row
-- security, so "may I report this thread" resolves to "may I read this thread"
-- by construction and cannot drift from the policy `081` owns. Writing
-- `private.is_club_member(...)` here instead would be a second copy of `081`'s
-- audience that a future change to `081` cannot reach.
--
-- Two consequences, both designed:
--
--   * A NON-MEMBER of a PUBLIC club is refused. They can read the club row, and
--     the membership conjunct inside `081`'s SELECT is what stops them; this
--     policy carries that without naming it.
--   * ** Block-then-report is UNREACHABLE. ** A rider who blocks the author
--     first can no longer read the thread, so this EXISTS resolves to zero and
--     the report is refused. The identical property already holds for a
--     postcard under `011`. It is stated rather than fixed because every fix is
--     worse: a `security definer` reporting RPC would step past the block to
--     check the thread exists and would then have to decide what to tell a
--     caller about a thread they cannot see, and a block-arm exemption would
--     let a rider probe for the existence of threads by blocked authors. ** The
--     remedy is ordering in the UI, not a policy change ** — and on this screen
--     it costs nothing, the thread menu having no Block row.
--
-- A SELF-report is permitted and inert: nothing here excludes the author, and
-- the alternative conjunct would be a second subquery re-reading the author
-- identity, in a policy whose whole virtue is naming nothing, to prevent a row
-- that is unreachable from the UI and visible only to an operator who can
-- ignore it. `011` made the same choice.
create policy "Riders can report visible threads, as themselves"
  on public.club_thread_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (select 1 from public.club_threads d where d.id = club_thread_reports.thread_id)
  );

-- NO UPDATE AND NO DELETE, neither policy nor grant. `011`'s rule carries over
-- verbatim: a report is a statement of fact at a moment in time, and letting
-- the reporter rewrite or withdraw it makes the table useless as evidence to
-- the reader §5 gives it. The absence is asserted in BOTH directions in the
-- suite, because a well-meaning `grant all` restores only one of them.

-- ** `service_role` is named in the revoke AT CREATION. ** Supabase's project
-- default grants it everything on a new `public` table, and `076` §3b is the
-- worked example of noticing that sixty-five migrations late: it found
-- `service_role` holding SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
-- and TRIGGER on `postcard_reports`. The key that holds those privileges lives
-- in exactly one place — the `delete-account` function's secret store — so this
-- is not a live leak; it is a standing one, and the only thing between that key
-- and every reporter's identity is that nothing has asked.
--
-- Account deletion is unaffected, and `076` MEASURED that rather than reasoning
-- it: a referential cascade runs as the constraint's system trigger, not as the
-- deleting role, so it does not consult privileges at all. The suite repeats
-- that measurement, because getting it wrong takes account deletion down and
-- nothing in CI would notice.
revoke all on public.club_thread_reports from public, anon, authenticated, service_role;

-- ** Column-scoped INSERT, which is a deliberate departure from `011`. ** That
-- file granted INSERT at table level, so a client there can name `created_at`
-- and `id`. Here it cannot: `created_at` orders the operator's queue and `id`
-- is the server's. Nothing to `anon` — decision #1, and no route is created or
-- implied for it.
grant select on public.club_thread_reports to authenticated;
grant insert (reporter_id, thread_id, reason, note)
  on public.club_thread_reports to authenticated;

-- ===========================================================================
-- §4. The participation gate
-- ===========================================================================
-- `023`'s shape. ** The `when` clause is not decoration ** — it is what stops
-- the gate firing for the table owner, which is the role the RLS suite runs as
-- and the role a `security definer` body runs as.
--
-- ** The gate fires BEFORE the RLS WITH CHECK, and that is checked here rather
-- than assumed to be harmless. ** `093` shipped a membership oracle on exactly
-- this shape: an unconditional admissibility trigger let any signed-in rider
-- read club membership off the SQLSTATE. This trigger cannot, because it is
-- keyed on the CALLER's own `terms_accepted_at` — read from `auth.uid()`,
-- never from a column the caller writes — so an un-onboarded rider gets the
-- same `23514` for a thread they can read and a thread they cannot. The suite
-- asserts that by STRING EQUALITY between the two refusals.
drop trigger if exists enforce_participation_gate on public.club_thread_reports;
create trigger enforce_participation_gate
  before insert on public.club_thread_reports
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped from twenty-one, per `028`/`033`/`085`/`091`/`092`/`093`: this
-- comment is the `data` agent's first read via `list_tables` and no edit to
-- CLAUDE.md reaches it.
--
-- ** Composed from the LIVE comment, not from a copy in an earlier file. **
-- `092` and `093` each rewrote this same string and the last writer wins, so
-- the enumeration below extends `093`'s rather than reverting it. It is the
-- FILE order, which is what a replayed chain produces; the ABSOLUTE count on a
-- given project depends on which of `092`–`095` has applied there, which is why
-- the suite and the verification block assert the DELTA.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, twenty-two BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085), the seventeenth ride_invite_links (091), the eighteenth club_thread_waves and the nineteenth club_join_waves (092), the twentieth club_invites and the twenty-first club_invite_links (093), the twenty-second club_thread_reports (094); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ===========================================================================
-- §5. The reader — `076` line for line
-- ===========================================================================
-- Both objects live in `private` and the barrier is TWO layers, neither of
-- which is sufficient alone:
--
--   1. `anon` and `authenticated` hold no USAGE on `private` at all (`005`),
--      so the objects are unreachable before any grant on them is considered.
--   2. `service_role` DOES hold USAGE (`031`), so the revokes below name it
--      explicitly rather than relying on the schema.
--
-- And a third that is not a grant at all: PostgREST routes only to `public`, so
-- supabase-js's `.schema('private')` is refused before it reaches Postgres.
-- `031` is the worked example, from the other side.
--
-- ** The view runs as its OWNER, and therefore steps past every membership and
-- block predicate in the system. ** That is what it is for, and it is exactly
-- why no PostgREST role may reach it: it must not become a second way to read a
-- club's private conversation. It is not a NARROWER way to read threads, it is
-- a PRE-JOINED way to read what the owner could already read with a
-- hand-written join. Nobody else gains a byte.
--
-- `with (security_invoker = false)` is WRITTEN OUT. It is the default and it is
-- the entire reason the view can answer, so leaving it implicit would be a
-- load-bearing default nobody can see (`076` §1).
--
-- ** The reporter appears as a uuid and nothing more. ** No username, no email,
-- no join to `profiles` for them. The reported rider's name is context for
-- judging a thread; the reporter's is not needed to judge it, and a view that
-- ever escapes its schema then leaks less. The owner can always join `profiles`
-- by hand.
create or replace view private.club_thread_report_queue
with (security_invoker = false) as
  select
    r.id                as report_id,
    r.created_at        as reported_at,
    r.reason,
    r.note,
    r.reporter_id,
    d.id                as thread_id,
    d.title             as thread_title,
    d.created_at        as thread_created_at,
    (select count(*) from public.club_messages m
      where m.thread_id = d.id)             as message_count,
    c.id                as club_id,
    c.name              as club_name,
    c.is_public         as club_is_public,
    author.id           as author_id,
    author.username     as author_username,
    -- Both counts are OPEN reports only. Reports cascade with their thread, so
    -- a take-down zeroes the first and reduces the second; neither is a history.
    (select count(*) from public.club_thread_reports other
      where other.thread_id = d.id)         as reports_on_this_thread,
    (select count(*) from public.club_thread_reports other
       join public.club_threads other_d on other_d.id = other.thread_id
      where other_d.author_id = d.author_id) as reports_on_this_author
  from public.club_thread_reports r
  join public.club_threads d     on d.id = r.thread_id
  join public.clubs c            on c.id = d.club_id
  join public.profiles author    on author.id = d.author_id
  order by r.created_at desc;

comment on view private.club_thread_report_queue is
  'Triage queue for club-thread reports (094). reports_on_this_thread and reports_on_this_author count OPEN reports only — reports cascade with their thread, so a take-down erases that history. Readable only by the table owner at the Supabase dashboard: private is not routed by PostgREST and no client role holds USAGE on it. Runs as its owner by design, so it sees rows RLS would hide from the caller — a pre-joined view of what the owner could already read, never a new reach for anyone else, and never a second way to read a club''s private conversation. The reporter appears as a uuid only. Sibling of private.postcard_report_queue (076); two queues rather than one, because a union over two different subject shapes either loses columns or invents nullable ones.';

-- ** Not `security definer`, granted to nobody, and both are deliberate. ** Its
-- only caller is already the owner, and marking it definer would add an
-- `authenticated_security_definer_function_executable` advisor for a function
-- no `authenticated` session can execute. `076`'s function is the model and
-- `011` §1b's `moderate_comment` is the shape it departs from, for that reason.
--
-- ** It reads the evidence BEFORE the delete, because the delete destroys it. **
-- The reports cascade from the thread. Selecting them afterwards returns null
-- and looks exactly like a thread nobody had reported. The alternative — an
-- archive that outlives the thread — is a new store of exactly the personal
-- data `029`'s cascade exists to remove and `/legal/account-deletion` promises
-- is gone: an author's id, their words, a reporter's words about them,
-- surviving the account deletion that was supposed to erase all three. `076` D5
-- refused it and this refuses it identically.
--
-- ** Unlike `076` it returns the MESSAGES, capped. ** The reportable content of
-- a thread is mostly its replies rather than its title. 200 in `created_at`
-- order, with `messages_total` beside it: the cap keeps a result pane readable
-- and the count is what makes a truncation VISIBLE rather than silent.
create or replace function private.remove_reported_thread(target uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  evidence jsonb;
  removed integer;
begin
  select jsonb_build_object(
           'thread_id', d.id,
           'thread_title', d.title,
           'thread_created_at', d.created_at,
           'club_id', c.id,
           'club_name', c.name,
           'club_is_public', c.is_public,
           'author_id', d.author_id,
           'author_username', a.username,
           'reports', coalesce(
             -- Reporters by uuid here too, for the reason the view gives.
             (select jsonb_agg(jsonb_build_object(
                       'reported_at', r.created_at,
                       'reason', r.reason,
                       'note', r.note,
                       'reporter_id', r.reporter_id)
                     order by r.created_at)
                from public.club_thread_reports r
               where r.thread_id = d.id),
             '[]'::jsonb),
           'messages_total',
             (select count(*) from public.club_messages m where m.thread_id = d.id),
           'messages', coalesce(
             (select jsonb_agg(jsonb_build_object(
                       'created_at', m.created_at,
                       'author_id', m.author_id,
                       'body', m.body)
                     order by m.created_at)
                from (select m2.created_at, m2.author_id, m2.body
                        from public.club_messages m2
                       where m2.thread_id = d.id
                       order by m2.created_at
                       limit 200) m),
             '[]'::jsonb))
    into evidence
    from public.club_threads d
    join public.clubs c    on c.id = d.club_id
    join public.profiles a on a.id = d.author_id
   where d.id = target;

  if evidence is null then
    -- A thread that does not exist is a clean answer, not an error — `076`'s
    -- shape, for its reason: an operator acting on a queue row somebody already
    -- deleted has done nothing wrong.
    return jsonb_build_object('removed', false, 'reason', 'no such thread');
  end if;

  -- The cascade list is read off `pg_constraint` at write time, never
  -- remembered — `076`'s header records naming one of five. Children of
  -- `club_threads`: `club_messages`, `club_thread_reads`, `club_thread_waves`
  -- (`092`) and `club_thread_reports` (this file), all ON DELETE CASCADE.
  -- `036`'s `notifications` has no `thread_id` column and is not in the chain.
  -- Nothing under Storage hangs off a thread, so unlike `076` there is no
  -- object for the operator to sweep afterwards.
  delete from public.club_threads where id = target;
  get diagnostics removed = row_count;

  return evidence || jsonb_build_object('removed', removed > 0, 'removed_at', now());
end;
$$;

comment on function private.remove_reported_thread(uuid) is
  'Removes exactly one club thread and returns what it destroyed — the thread, its club, its author, the reports about it and up to 200 of its messages with a messages_total beside them, so a truncation is visible rather than silent. Reads the evidence BEFORE the delete because the cascade destroys it (076 D5''s retention decision, restated). Owner-only: private is not routed by PostgREST, execute is granted to nobody, and it is deliberately NOT security definer — its only caller is already the owner, and marking it definer would add an advisor for a function no authenticated session can execute. See 094.';

-- ** The grant IS the access control here. ** RLS is irrelevant to a view
-- running as its owner and to a function in `private` that is not published, so
-- it is stated absolutely rather than left to the schema's default, and
-- `service_role` is named because it is the one client-side role for which the
-- schema is not already the barrier.
revoke all on private.club_thread_report_queue from public, anon, authenticated, service_role;
revoke all on function private.remove_reported_thread(uuid) from public, anon, authenticated, service_role;

-- ===========================================================================
-- §6. The club_threads table comment stops saying "the club owner"
-- ===========================================================================
-- `082` set it and it was true for the whole life of the table. It is the first
-- thing anyone reads off `\d+ club_threads` or `list_tables`, so leaving it
-- would leave the database itself asserting the gate this file widens.
comment on table public.club_threads is
  'Titled threads inside a club (081 as club_discussions, renamed by 082/PD-313). The audience is CLUB MEMBERSHIP: private.is_club_member(club_id), which includes the owner through 054''s owner arm. ** The parent EXISTS against `clubs` is the REDUNDANT half here, the exact inverse of ride_messages (034) ** — clubs SELECT is `is_public OR owner_id = auth.uid() OR private.is_club_member(id)`, so on a PUBLIC club it admits every signed-in rider and the membership helper is the load-bearing conjunct. The redundant conjunct is written anyway, because the implication is a property of the current three-arm clubs policy which a later arm can break silently, and because using a private membership helper as a sole conjunct anywhere teaches the next table that the shape is safe. Not editable by anyone: no UPDATE policy and no UPDATE grant. Deleted by its author (081''s DELETE policy) or by anyone who ADMINISTERS the club — owner or admin — through public.moderate_club_thread, widened by 094. Reportable by any member who can read it, into public.club_thread_reports (094); nobody in the club reads those.';

-- ===========================================================================
-- §Operating it — because a queue nobody knows how to read is the same gap
--                 with more SQL in it
-- ===========================================================================
-- At the Supabase dashboard's SQL editor, which connects as the table owner:
--
--   -- what is waiting
--   select * from private.club_thread_report_queue;
--
--   -- act on one, KEEPING THE RESULT: it is the only copy of the evidence
--   select private.remove_reported_thread('<thread_id>');
--
-- There is no Storage step, unlike `076`: nothing under Storage hangs off a
-- thread. Removing a thread takes its messages, its read watermarks, its waves
-- and its reports with it, through the cascade — which is the whole blast
-- radius and is why the client puts this behind a confirmation naming it.
--
-- Leaving a report and taking no action needs no SQL at all — a report is not
-- state, it is a row that stays. ** There is deliberately no `resolved_at`. **
-- That is a moderation product's column: it needs an UPDATE grant, which `011`
-- and `076` both refuse, and it would make the queue a workflow with two
-- writers.
--
-- ** TWO queues, not one, and the union is here rather than as a view. ** A
-- `union all` over two different subject shapes either loses columns or invents
-- nullable ones, and each queue earns its columns by being about exactly one
-- thing. For an operator who wants both in one pane:
--
--   select 'postcard' as kind, report_id, reported_at, reason, note,
--          reporter_id, author_username
--     from private.postcard_report_queue
--   union all
--   select 'thread', report_id, reported_at, reason, note,
--          reporter_id, author_username
--     from private.club_thread_report_queue
--    order by reported_at desc;
--
-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- §1: the ACL survived the replace. The drop-and-recreate tripwire.
--   select has_function_privilege('anon',
--            'public.moderate_club_thread(uuid)', 'execute');              -- f
--   select has_function_privilege('authenticated',
--            'public.moderate_club_thread(uuid)', 'execute');              -- t
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.moderate_club_thread(uuid)'::regprocedure;
--                                          -- t, {"search_path=\"\""}
--   -- and the predicate is the helper, pinned by equality rather than `like`
--   select prosrc like '%private.is_club_admin_for(v_uid, d.club_id)%',
--          prosrc like '%c.owner_id%'
--     from pg_proc where oid = 'public.moderate_club_thread(uuid)'::regprocedure;
--                                                                  -- t, f
--
--   -- §3: the policy set, as a sorted COMMAND LIST rather than a count — a
--   -- count of 2 also passes for a set that swapped SELECT for UPDATE.
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'club_thread_reports';
--                                                        -- INSERT,SELECT
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'club_thread_reports'
--      and roles <> '{authenticated}';                                     -- 0
--
--   -- §3: grants, SCOPED TO THE GRANTEE (015's trap — a table-wide count reads
--   -- high because postgres and service_role hold everything by default)
--   select privilege_type from information_schema.table_privileges
--    where table_name = 'club_thread_reports' and grantee = 'authenticated'
--    order by 1;                                            -- INSERT, SELECT
--   select column_name from information_schema.column_privileges
--    where table_name = 'club_thread_reports' and grantee = 'authenticated'
--      and privilege_type = 'INSERT' order by 1;
--                                    -- note, reason, reporter_id, thread_id
--   select has_table_privilege('authenticated',
--            'public.club_thread_reports', 'update'),                      -- f
--          has_table_privilege('authenticated',
--            'public.club_thread_reports', 'delete'),                      -- f
--          has_table_privilege('anon',
--            'public.club_thread_reports', 'select'),                      -- f
--          has_table_privilege('service_role',
--            'public.club_thread_reports', 'select');                      -- f
--
--   -- §4: the gate, by TABLE NAME and by DELTA. Both, because a count alone
--   -- cannot tell a new gate from a moved one.
--   select count(*) from pg_trigger t
--    where t.tgname = 'enforce_participation_gate' and not t.tgisinternal
--      and t.tgrelid = 'public.club_thread_reports'::regclass;             -- 1
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate'
--      and not tgisinternal;                        -- the pre-flight count + 1
--
--   -- §5: private is unreachable, by role rather than by calling it as the
--   -- owner — 031 exists because 029 shipped a function nothing could call and
--   -- the suite, which runs as the table owner, did not notice.
--   select has_schema_privilege('authenticated', 'private', 'usage'),      -- f
--          has_schema_privilege('anon', 'private', 'usage'),               -- f
--          has_table_privilege('service_role',
--            'private.club_thread_report_queue', 'select'),                -- f
--          has_function_privilege('service_role',
--            'private.remove_reported_thread(uuid)', 'execute'),           -- f
--          has_function_privilege('authenticated',
--            'private.remove_reported_thread(uuid)', 'execute');           -- f
--
--   -- advisors: NO new finding. The published definer count is unchanged.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--                                              -- the pre-flight count, + 0
--
-- ===========================================================================
-- §Rollback
-- ===========================================================================
--   drop function private.remove_reported_thread(uuid);
--   drop view private.club_thread_report_queue;
--   drop table public.club_thread_reports;         -- takes its trigger with it
--   -- and re-create moderate_club_thread from 082 §6c verbatim, then restamp
--   -- the enforce_participation_gate comment back to twenty-one.
-- Nothing else moved, so the rollback is complete rather than approximate.
