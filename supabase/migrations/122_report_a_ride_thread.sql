-- 122: A ride thread can be REPORTED, and the report has a reader. PD-454.
--
-- Additive in every statement. One new table, two policies, one gate trigger,
-- two objects in `private` that no client role can reach, and two comment
-- restamps. Nothing is dropped, nothing is narrowed, no existing row changes
-- shape and no existing policy is touched.
--
-- ---------------------------------------------------------------------------
-- THE NUMBER: the tasks file says `118` and `118` IS SPENT
-- ---------------------------------------------------------------------------
-- `openspec/changes/report-ride-threads-and-postcard-comments/tasks.md` and its
-- proposal both say `118` then `119`, correctly, on 2026-09-18. Re-derived
-- 2026-09-19 in BOTH directions, which is the only way this question has an
-- answer (`CLAUDE.md` §Working Principles, "migration drift runs in two
-- directions"):
--
--   ls supabase/migrations/*.sql | wc -l        -- 120 files, ending 121
--   ls supabase/migrations/ | grep 118          -- nothing. No file holds it.
--   list_migrations fpmrimzxadewsaiwpsel        -- 123 rows, and one of them is
--                                                 `118_the_terms_name_a_person`
--                                                 (20260918203612)
--
-- ** `118` is applied to DEV from PR #462, which is still open. ** The database
-- has already spent the number; no file on `development` carries it, so a
-- `ls`-only reading hands it out twice and the second apply is the one that
-- cannot be fixed by applying anything. `121`'s own header records the same
-- trap from the other side, which is how it was caught here. So: `122` then
-- `123`, and the required order is unchanged — see §ORDERING below.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE IS
-- ---------------------------------------------------------------------------
-- App Store Review Guideline 1.2 asks a user-generated-content app for four
-- things: a filter, a way to report, a way to block, and action on what is
-- reported. This project has reporting on a postcard (`011`, with a reader
-- since `076`) and on a club thread (`094`, reader in the same file). A RIDE
-- thread — `108`'s copy of the club's threads, a persistent titled object every
-- rider on a crew reads — has a ⋯ menu offering deletion and nothing else.
-- `src/components/rides/RideThreadOptions.tsx`'s own header records that as a
-- deferral rather than a decision, naming the store submission as the trigger.
-- This is that trigger arriving.
--
-- ** `094` is the shape, line for line, and it is READ rather than recalled. **
-- `076`'s title is the whole rule: reports have a reader. `011` shipped a
-- report table with no reader and it took sixty-five migrations to close, so the
-- queue and the take-down ship in THIS file, in `private`, revoked from every
-- client role including `service_role`.
--
-- ** There is still no admin role and no moderator claim. ** `011`, `076` and
-- `094` each declined to invent one; so does this. The reader is the project
-- owner at the Supabase dashboard, which is a connection as the table owner — a
-- role that already sees every row in this database and gains nothing here.
--
-- ---------------------------------------------------------------------------
-- A NEW TABLE, NEVER A WIDENED `postcard_reports` — `094` §2 RE-CHECKED
-- ---------------------------------------------------------------------------
-- Its four reasons, re-checked against THIS subject rather than assumed, and
-- the third still settles it on its own:
--
--   1. The subject column cannot be shared without going nullable.
--      `postcard_reports.postcard_id` is NOT NULL with an FK and a
--      `unique (reporter_id, postcard_id)`; widening means dropping the NOT
--      NULL, adding a nullable `thread_id`, adding a CHECK that exactly one is
--      set and replacing the unique constraint with two PARTIAL unique indexes
--      — every one a change to a live table riders write to today, for a
--      feature that touches none of its rows.
--   2. The audience predicates differ and cannot share a policy. `011`'s
--      INSERT inherits block, club and hide through an EXISTS against
--      `postcards`; a ride-thread report must EXISTS against
--      `public.ride_threads`, which inherits an INTERSECTION (ride visibility
--      AND crew) and a differently-shaped block arm. One table means a
--      branching `with check` naming both audiences, and the property `011` and
--      `094` were written for is gone.
--   3. ** There is a LIVE reader and its join is unconditional. **
--      `private.postcard_report_queue` (`076`) inner-joins `public.postcards`.
--      A ride-thread report landing in `postcard_reports` either breaks the
--      operator's queue or — with a `left join` "fix" — quietly vanishes from
--      it. A report in a table no query returns is the exact failure `011`
--      spent sixty-five migrations in.
--   4. The repo's own shape is one table per subject: `postcard_likes`,
--      `postcard_comments`, `postcard_hides`, `postcard_reports`,
--      `club_thread_reports`, and on this side `ride_thread_reads`.
--
-- The cost, stated rather than hidden: a third report table means a third queue
-- (§Operating it carries the union) and a third place the reason list must stay
-- in step with `REPORT_REASONS`. `011` records that the Zod enum and the CHECK
-- are kept in step by hand with no automated check, so the suite asserts the
-- CHECK's ACCEPTED SET out of `pg_constraint` — the half a SQL test can see.
--
-- ---------------------------------------------------------------------------
-- THE INHERITED AUDIENCE — read off `pg_policies` on DEV 2026-09-19
-- ---------------------------------------------------------------------------
-- This is the predicate the report INSERT inherits, so any change to it moves
-- who may report. Quoted rather than paraphrased:
--
--   ride_threads SELECT
--     EXISTS (SELECT 1 FROM rides r WHERE r.id = ride_threads.ride_id)
--     AND private.is_ride_crew(ride_id)
--     AND (author_id = (SELECT auth.uid())
--          OR NOT private.is_blocked((SELECT auth.uid()), author_id))
--
-- ** It is an INTERSECTION and neither half alone is it ** (`108`'s own table
-- comment says so, and calls itself the INVERSE of `club_threads`): the parent
-- EXISTS resolves under the caller's row security and carries the block arm on
-- the ORGANISER, the private-club arm and `083`'s live-invite arm; the crew
-- helper is `security definer` and steps past all three. So the single EXISTS
-- this file writes carries BOTH halves, because it resolves the whole
-- `ride_threads` policy and not one conjunct of it.
--
-- Two refusals follow from that without being named anywhere below:
--
--   * A rider who can see the ride perfectly well but is NOT on its crew is
--     refused — `private.is_ride_crew` is the load-bearing conjunct here, the
--     exact inverse of `club_threads`.
--   * A rider holding a PENDING ride invite is refused. `083`'s
--     `private.has_live_ride_invite` widens RIDE visibility and never thread
--     visibility, so they read the ride and none of its conversation.
--
-- Children of `public.ride_threads`, read off `pg_constraint` on DEV 2026-09-19
-- rather than remembered (`076`'s header records naming one of five):
-- `ride_thread_messages` (thread_id) and `ride_thread_reads` (thread_id), both
-- ON DELETE CASCADE. `ride_thread_reports` below makes three.
--
-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — MEASURED ON DEV 2026-09-19, not recalled
-- ---------------------------------------------------------------------------
-- Through the Supabase MCP `execute_sql` against DEV `fpmrimzxadewsaiwpsel`
-- (a privileged role, so these are true counts). PROD `zwprydcyryvudhurbnye`
-- is four files behind and this file is NOT applied there.
--
--                                                     DEV before this file
--   migration rows / files on disk                    123 rows / 120 files
--   enforce_participation_gate triggers                22
--   public security-definer fns exec by authenticated  38
--   public tables                                      34, of which 4 have
--                                                      service_role revoked
--   views in private                                   2
--   security advisor findings                          46
--
-- ** Only the DELTA is claimed, per `094`. ** This file claims + 1 gate
-- trigger, + 0 published definer functions, + 1 revoked table, + 1 private
-- view, + 0 advisor findings.
--
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--
-- ---------------------------------------------------------------------------
-- SECURITY ADVISORS: this file adds ZERO, and the mechanism is the reason
-- ---------------------------------------------------------------------------
-- `authenticated_security_definer_function_executable` fires once per PUBLIC
-- `security definer` function executable by `authenticated`. This file creates
-- no `public` function at all, so that count cannot move — 38 before, 38 after.
-- `anon_security_definer_function_executable` (`115`'s named exception) is
-- likewise untouched at 1. `security_definer_view` does not reach `private` and
-- PostgREST does not route to it, so the queue raises nothing.
-- `rls_enabled_no_policy` does not fire either, and that is worth stating
-- because it is the one a new table plausibly trips: the table below has RLS on
-- AND two policies, unlike `push_devices`, `push_deliveries`, `club_removals`
-- and `password_reset_grants`, which are the four `public` entries in that INFO
-- class today. A new WARN after applying this file means something landed in
-- `public` by mistake.
--
-- ---------------------------------------------------------------------------
-- ORDERING: additive, MIGRATION-FIRST, and `122` before `123`
-- ---------------------------------------------------------------------------
-- Migration first, bundle second. The client half writes a table that does not
-- exist yet, so the reverse ordering gives a rider a Report control answering
-- `PGRST205` behind "Could not send that report." for the length of a deploy.
-- Applied ahead of the bundle nothing is broken: a capability is merely not yet
-- drawn.
--
-- ** Neither this file nor `123` adds a second PostgREST relationship to an
-- embed any bundle uses, so there is no deploy-first side to weigh ** — and
-- that is checked against the repo's measured criterion rather than the looser
-- "no bundle embeds these tables", which `src/lib/data/columns.ts` §Embed hints
-- records as FALSE (PD-363). A table becomes a junction, adding a relationship
-- between the two tables it points at, when it carries two foreign keys AND a
-- primary key that is exactly the union of their columns. §1's table has a
-- single-column `id` primary key with `unique (reporter_id, thread_id)` as a
-- SEPARATE constraint — identical to `club_thread_reports`, which added no
-- relationship — so it does not qualify. ** A future report table given a
-- composite primary key instead would silently become a junction and break
-- every unhinted `profiles` embed on the tables it points at. **
--
-- ** `122` before `123`, and the reason is one COMMENT rather than one
-- object. ** The two files share no table, view, function or policy. They do
-- both restamp `public.enforce_participation_gate()`'s comment, where the last
-- writer wins: this file makes it twenty-three and `123` twenty-four, each
-- composed from the LIVE comment (`092`/`093`'s recorded trap). Applied in the
-- other order the enumeration is wrong and nothing fails.
--
-- ** `036`'s hand-exercise gate does NOT fire. ** No trigger is hung on an
-- already-shipped write path — the gate trigger is on the new table — and no
-- function anyone calls today is replaced. All three objects are new. This is
-- the ordinary additive case, unlike `094`, which had to exercise a live
-- `moderate_club_thread`.

-- ===========================================================================
-- §1. public.ride_thread_reports
-- ===========================================================================
create table public.ride_thread_reports (
  id uuid default uuid_generate_v4() primary key,
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  thread_id uuid references public.ride_threads(id) on delete cascade not null,
  reason text not null,
  note text,
  created_at timestamptz default now() not null,

  -- `011` §4's six, carried over from `094` verbatim and deliberately not
  -- extended. They are the common denominator of every platform's report sheet
  -- rather than a transcription of ours: there is no report frame anywhere in
  -- the Figma snapshot (`npm run figma -- ls "*eport*"` returns 0 of 451, and so
  -- do `"*omment*"` and `"*hread*"`), so the client ships one-tap and sends
  -- `other` — the only value that asserts nothing the rider did not say. Adding
  -- a value is a cheap drop-and-recreate of this one constraint; removing one
  -- is not, so the list stays short on purpose.
  constraint ride_thread_reports_reason check (
    reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'other')
  ),
  -- Same bound and same trimmed/raw split as a comment body, a postcard report
  -- and a club-thread report. The note is optional; an empty string is not a
  -- note. The FLOOR is on the trimmed length and the CEILING on the raw one, so
  -- padding cannot smuggle a longer body past a trimmed check.
  constraint ride_thread_reports_note_length check (
    note is null or (length(btrim(note)) >= 1 and length(note) <= 1000)
  ),
  -- ** The anti-brigading key. ** Reporting the same thread twice is a
  -- duplicate, and a caller writing `on conflict do nothing` gets a clean no-op
  -- instead of a second row and instead of an error shown to the rider. Without
  -- it one rider could file ten thousand reports against one thread and §3's
  -- queue would be reading a brigading tool rather than a signal. It also LEADS
  -- with `reporter_id`, so it is the index Postgres uses for the `profiles`
  -- cascade — `029`'s standing rule, satisfied without a second index.
  constraint ride_thread_reports_one_per_rider unique (reporter_id, thread_id)
);

alter table public.ride_thread_reports enable row level security;

-- For the `ride_threads` cascade and for §3's join. Neither the primary key nor
-- the unique index above serves it — the unique index leads with `reporter_id`.
create index ride_thread_reports_thread_id_idx
  on public.ride_thread_reports (thread_id, created_at desc);

comment on table public.ride_thread_reports is
  'Reports filed by riders against a ride thread (122, PD-454). The audience predicate is INHERITED, not restated: the INSERT policy''s EXISTS against public.ride_threads resolves under the caller''s own RLS, so 108''s INTERSECTION applies in full — ride visibility (with its block arm on the organiser, its private-club arm and 083''s live-invite arm) AND private.is_ride_crew AND the block arm on the thread''s author — and none of it is named here. A rider who can see the ride but is not on its crew is refused; so is a rider holding a PENDING invite, 083 widening ride visibility and never thread visibility. ** NOBODY ON THE CREW READS THIS TABLE ** — not the thread''s author, not the ride''s organiser, and no club owner or admin, a ride having no admin role at all (108). The product owner decided that for club threads on 2026-08-31 and it is reapplied rather than reopened. The reporter reads only their own rows; the reader is private.ride_thread_report_queue, owner-only at the Supabase dashboard. A report is not editable and not withdrawable: no UPDATE policy, no UPDATE grant, no DELETE policy, no DELETE grant. RETENTION, stated at creation rather than left silent: indefinite, and it dies with its thread and with its reporter through two ON DELETE CASCADEs and nothing else. There is no scheduled deletion, no resolved_at and no take-down ledger; a different retention answer needs a mechanism, not a sentence.';

comment on column public.ride_thread_reports.created_at is
  'Server-owned, and WITHHELD from the INSERT column grant (034 §4b, 081 §3, 094 §3). The triage queue orders by it, so a client-stamped value would pin a report to the top of the operator''s queue for ever.';

-- ===========================================================================
-- §2. Policies, grants and the gate
-- ===========================================================================
-- ** No crew conjunct on SELECT, deliberately. ** A report is the reporter's own
-- statement, and evidence that evaporates when the reporter walks away is not
-- evidence. The row holds a thread id, a reason and a note — no thread content —
-- so a rider who has LEFT the crew, or who has since blocked the author, leaks
-- nothing about the ride by reading their own row back. Adding a conjunct here
-- "for consistency" is the change this comment exists to stop.
--
-- ** This is also the own-row read arm in its correct position. ** PD-362
-- records seven policies in this schema that write `<parent EXISTS> and
-- (user_id = auth.uid() or not is_blocked(...))`, where the parent dominates and
-- the own-row branch is a no-op. There is no parent conjunct here at all: the
-- reporter's own id IS the whole predicate, so the arm cannot be shadowed.
create policy "Riders see only the ride thread reports they filed"
  on public.ride_thread_reports for select to authenticated
  using (reporter_id = auth.uid());

-- ** Names no crew predicate, no ride predicate and no block predicate, and
-- inherits all three. ** The EXISTS is evaluated under the CALLER's row
-- security, so "may I report this thread" resolves to "may I read this thread"
-- by construction and cannot drift from the policy `108` owns. Writing
-- `private.is_ride_crew(...)` here instead would be a second copy of `108`'s
-- audience that a future change to `108` cannot reach — `034`'s first draft is
-- this repo's own story about that.
--
-- Two consequences, both designed:
--
--   * A rider who is NOT ON THE CREW is refused, including one who can read the
--     ride row perfectly well. `private.is_ride_crew` inside `108`'s SELECT is
--     what stops them, and this policy carries it without naming it. A PENDING
--     invitee is the same refusal by the same route.
--   * ** Block-then-report is UNREACHABLE. ** A rider who blocks the author
--     first can no longer read the thread, so this EXISTS resolves to zero rows
--     and the report is refused — in BOTH directions, `private.is_blocked`
--     being symmetric though the row is directional. The identical property
--     already holds for a postcard (`011`) and a club thread (`094`). It is
--     STATED because it is a trap, not because it is desirable, and it is not
--     fixed because every fix is worse: a `security definer` reporting RPC would
--     step past the block to confirm the thread exists and would then have to
--     decide what to tell a caller about a row they cannot see, and a block-arm
--     exemption would let a rider probe for the existence of content by riders
--     who blocked them. ** The remedy is ordering in the UI. ** On a ride thread
--     the cost is the report, leaving blocking and leaving the crew, which is
--     the position `retire-ride-chat-for-ride-threads` Q4 already accepted.
--
-- A SELF-report is permitted and inert: nothing here excludes the author, and
-- the alternative conjunct would be a second subquery re-reading the author
-- identity inside a policy whose whole virtue is naming nothing, to prevent a
-- row that is visible only to an operator who can ignore it. `011` and `094`
-- made the same call. ** The affordance is simply not drawn for the author — a
-- menu row is a display hint, never an authorization. **
create policy "Riders can report visible ride threads, as themselves"
  on public.ride_thread_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (select 1 from public.ride_threads t where t.id = ride_thread_reports.thread_id)
  );

-- NO UPDATE AND NO DELETE, neither policy nor grant. `011`'s rule, carried
-- through `094`: a report is a statement of fact at a moment in time, and
-- letting the reporter rewrite or withdraw it makes the table useless as
-- evidence to the reader §3 gives it. ** The absence IS the enforcement, and it
-- is asserted in BOTH directions in the suite, because a well-meaning
-- `grant all` restores only one of them. **

-- ** `service_role` is named in the revoke AT CREATION, and the judgement is
-- written down because there is no mechanical test for it. ** `076` §3's
-- criterion is: rows the one credential that bypasses RLS must not be able to
-- enumerate. A row here is ONE RIDER'S ACCUSATION AGAINST ANOTHER and it
-- carries the reporter's uuid; enumerating them is exactly the reporter-safety
-- failure this file's SELECT policy exists to prevent, and on a four-rider crew
-- a single leaked reporter_id names a person rather than narrowing a list. So:
-- revoked. `CLAUDE.md` §Supabase Rules' census read 30 kept / 4 revoked on DEV
-- 2026-09-19 (`club_thread_reports`, `postcard_reports`, `push_deliveries`,
-- `push_devices`); this file makes it five and `123` six.
--
-- The key that holds those default privileges lives in exactly one place — the
-- `delete-account` function's secret store — so this is not a live leak; it is a
-- standing one, and the only thing between that key and every reporter's
-- identity is that nothing has asked.
--
-- ** Account deletion is unaffected, and `076` MEASURED that rather than
-- reasoning it: ** a referential cascade runs as the constraint's system
-- trigger, not as the deleting role, so it does not consult privileges at all.
-- `095` measured the same thing from the other side (it runs as the owner of the
-- REFERENCING table whoever issues the parent delete). The suite repeats the
-- measurement, because getting it wrong takes account deletion down and nothing
-- in CI would notice.
revoke all on public.ride_thread_reports from public, anon, authenticated, service_role;

-- ** Column-scoped INSERT, a deliberate departure from `011` and a copy of
-- `094` §3. ** `011` granted INSERT at table level, so a client there can name
-- `created_at` and `id`. Here it cannot: `created_at` orders the operator's
-- queue and `id` is the server's. Nothing to `anon` — decision #1, and no route
-- is created or implied for it.
grant select on public.ride_thread_reports to authenticated;
grant insert (reporter_id, thread_id, reason, note)
  on public.ride_thread_reports to authenticated;

-- `023`'s shape. ** The `when` clause is not decoration ** — it is what stops
-- the gate firing for the table owner, which is the role the RLS suite runs as
-- and the role a `security definer` body runs as.
--
-- ** The gate fires BEFORE the RLS WITH CHECK, and that is checked here rather
-- than assumed harmless. ** `093` shipped a membership oracle on exactly this
-- shape: an unconditional admissibility trigger let any signed-in rider read
-- club membership off the SQLSTATE. This trigger cannot, because it is keyed on
-- the CALLER's own `terms_accepted_at` — read from `auth.uid()`, never from a
-- column the caller writes — so an un-onboarded rider gets the same `23514` for
-- a thread they can read and a thread they cannot. The suite asserts that by
-- STRING EQUALITY between the two refusals, which is the only comparison that
-- can see the two diverge.
drop trigger if exists enforce_participation_gate on public.ride_thread_reports;
create trigger enforce_participation_gate
  before insert on public.ride_thread_reports
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped per `028`/`033`/`085`/`091`/`092`/`093`/`094`: this comment is the
-- `data` agent's first read via `list_tables` and no edit to CLAUDE.md reaches
-- it.
--
-- ** Composed from the LIVE comment read off pg_proc, not from a copy in an
-- earlier file ** (`092`/`093`'s recorded trap; `094` was the last writer).
--
-- ** And the live headline was ONE HIGH, which is why the count below is a
-- measurement rather than an increment of the string. ** The live stamp said
-- twenty-three while `select count(*) from pg_trigger where tgname =
-- 'enforce_participation_gate' and not tgisinternal` answered TWENTY-TWO on
-- DEV 2026-09-19: `109` dropped `ride_messages`, the ninth, and recorded it as a
-- trailing sentence — "109 drops ride_messages and this count returns to
-- twenty-two" — instead of folding it into the enumeration the way `101`'s drop
-- of `club_thread_waves` was folded in. So the enumeration below removes
-- `ride_messages`, shifts every ordinal after it down by one exactly as `101`'s
-- drop did, replaces the trailing sentence with one line covering both drops,
-- and states twenty-three as 22 + this file's one. No trigger moved.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, twenty-three BEFORE INSERT triggers — the ninth is ride_map_render_attempts (051), the tenth place_search_attempts (069), the eleventh club_threads and the twelfth club_messages (081, the eleventh renamed from club_discussions by 082), the thirteenth ride_invites (083), the fourteenth feedback (084), the fifteenth club_join_requests (085), the sixteenth ride_invite_links (091), the seventeenth club_join_waves (092), the eighteenth club_invites and the nineteenth club_invite_links (093), the twentieth club_thread_reports (094), the twenty-first ride_threads and the twenty-second ride_thread_messages (108), the twenty-third ride_thread_reports (122); the five uncovered INSERT-policy tables are named in 023''s header with their reasons. The ordinals are positions in this list and nothing more, and TWO tables have been dropped out of the middle of it: club_thread_waves, which 092 made the eighteenth and 101 (PD-373) dropped, and ride_messages, which 034 made the ninth and 109 dropped — each time every entry after it shifted down by one, and no trigger moved. ** 122 read the count off pg_trigger rather than off this string: the previous stamp said twenty-three while the live count was twenty-two, ride_messages'' removal having been recorded as a trailing sentence instead of folded into the enumeration. Twenty-three is 094''s query run on DEV 2026-09-19, plus this file''s one trigger. **';

-- ===========================================================================
-- §3. The reader, in the same file — `076`/`094` line for line
-- ===========================================================================
-- Both objects live in `private` and the barrier is THREE layers, none of them
-- sufficient alone:
--
--   1. `anon` and `authenticated` hold no USAGE on `private` at all (`005`),
--      so the objects are unreachable before any grant on them is considered.
--   2. `service_role` DOES hold USAGE (`031`), so the revokes below name it
--      explicitly rather than relying on the schema.
--   3. PostgREST routes only to `public`, so supabase-js's `.schema('private')`
--      is refused before it reaches Postgres. `031` is the worked example, from
--      the other side: a worker in `private` turned out to be uncallable by
--      `service_role` for exactly this reason.
--
-- ** The view runs as its OWNER and therefore steps past every crew, club, hide
-- and block predicate in the system. ** That is what it is for, and it is
-- precisely why no PostgREST role may reach it: it must not become a second way
-- to read a ride's private conversation. It is NOT a narrower way to read one —
-- it is a PRE-JOINED way to read what the owner could already read with a
-- hand-written join. Nobody else gains a byte, and no route from the app to
-- either object is created, implied or left open.
--
-- `with (security_invoker = false)` is WRITTEN OUT. It is the default AND the
-- entire reason the view can answer, so leaving it implicit would be a
-- load-bearing default nobody can see (`076` §1) — and it is what a future
-- session reaching for `security_invoker = true` to "make it safer" runs into.
--
-- ** The reporter appears as a uuid and nothing more. ** No username, no email,
-- no join to `profiles` for them. The reported rider's name is context for
-- judging a thread; the reporter's is not needed to judge it, and a view that
-- ever escapes its schema then leaks less. The owner can always join `profiles`
-- by hand. No column of `auth.users` appears here at all.
create or replace view private.ride_thread_report_queue
with (security_invoker = false) as
  select
    r.id                as report_id,
    r.created_at        as reported_at,
    r.reason,
    r.note,
    r.reporter_id,
    t.id                as thread_id,
    t.title             as thread_title,
    t.created_at        as thread_created_at,
    (select count(*) from public.ride_thread_messages m
      where m.thread_id = t.id)              as message_count,
    rd.id               as ride_id,
    rd.title            as ride_title,
    rd.departure_at     as ride_departure_at,
    rd.is_public        as ride_is_public,
    organiser.id        as organiser_id,
    organiser.username  as organiser_username,
    author.id           as author_id,
    author.username     as author_username,
    -- Both counts are OPEN reports only. Reports cascade with their thread, so
    -- a take-down zeroes the first and reduces the second; neither is a history,
    -- and a repeat offender therefore under-counts. `076` D5's decision,
    -- restated: the alternative is a moderation archive with a lawful basis and
    -- a retention window, which is a product rather than a column.
    (select count(*) from public.ride_thread_reports other
      where other.thread_id = t.id)          as reports_on_this_thread,
    (select count(*) from public.ride_thread_reports other
       join public.ride_threads other_t on other_t.id = other.thread_id
      where other_t.author_id = t.author_id) as reports_on_this_author
  from public.ride_thread_reports r
  join public.ride_threads t        on t.id = r.thread_id
  join public.rides rd              on rd.id = t.ride_id
  join public.profiles organiser    on organiser.id = rd.organizer_id
  join public.profiles author       on author.id = t.author_id
  order by r.created_at desc;

comment on view private.ride_thread_report_queue is
  'Triage queue for ride-thread reports (122, PD-454). reports_on_this_thread and reports_on_this_author count OPEN reports only — reports cascade with their thread, so a take-down erases that history and a repeat offender under-counts (076 D5''s retention decision, restated rather than fixed). Readable ONLY by the table owner at the Supabase dashboard: private is not routed by PostgREST, anon and authenticated hold no USAGE on the schema (005), and service_role, which does hold USAGE (031), is refused by an explicit revoke. Runs as its owner by design, so it sees rows RLS would hide from the caller — a PRE-JOINED view of what the owner could already read with a hand-written join, never a narrower one, and ** never a second way to read a ride''s private conversation **. The reporter appears as a uuid only: the reported rider''s username is context for judging the content, the reporter''s is not needed to judge it, and a view that ever escapes its schema then leaks less. No column of auth.users appears here. message_count is what lets an operator see the proportionality before acting — the take-down is thread-granular, so one abusive line costs the whole crew the conversation. Third sibling of private.postcard_report_queue (076) and private.club_thread_report_queue (094); three queues rather than one, because a union over three subject shapes either loses columns or invents nullable ones. §Operating it in 122 carries the union for an operator who wants one pane.';

-- ** Not `security definer`, granted to nobody, and both are deliberate. **
--
-- Not definer because THERE IS NOTHING TO ESCALATE TO: the only caller is the
-- owner, who already holds BYPASSRLS, so the marking would buy the function
-- exactly nothing while adding a second thing about it that has to be
-- explained. The advisor is NOT the reason —
-- `authenticated_security_definer_function_executable` fires per PUBLIC definer
-- function EXECUTABLE BY `authenticated`, and a `private` function with its
-- EXECUTE revoked is executable by nobody, so marking it definer would add no
-- finding either. The precedent is read rather than reasoned:
-- `private.remove_reported_postcard` (`076`) and `private.remove_reported_thread`
-- (`094`) both have `prosecdef = false`, measured on DEV 2026-09-19.
--
-- ** NAME CHECK: `private.remove_reported_thread(uuid)` is `094`'s CLUB
-- function and still exists. ** This one is
-- `private.remove_reported_ride_thread(uuid)`. The two subjects are different
-- tables with different cascades and a collision would have silently replaced
-- the club's take-down, since the signature is otherwise identical.
--
-- ** It reads the evidence BEFORE the delete, because the delete destroys it. **
-- The reports cascade from the thread; selecting them afterwards returns null
-- and looks exactly like a thread nobody had reported. The alternative — an
-- archive that outlives the thread — is a new store of exactly the personal data
-- `029`'s cascade exists to remove and `/legal/account-deletion` promises is
-- gone: an author's id, their words, a reporter's words about them, surviving
-- the account deletion that was supposed to erase all three. `076` D5 refused it
-- and this refuses it identically.
--
-- ** The messages come back CAPPED, with a total beside them. ** The reportable
-- content of a thread is mostly its replies rather than its title. 200 in
-- `created_at` order, with `messages_total`: the cap keeps a result pane
-- readable and the count is what makes a truncation VISIBLE rather than silent.
-- It is also the proportionality the operator needs — this take-down is
-- thread-granular, inherited from `094` rather than introduced here, so acting
-- on one line in a 200-message crew conversation costs the whole crew the
-- thread, and nobody should do that without the size of it in front of them.
create or replace function private.remove_reported_ride_thread(target uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  evidence jsonb;
  removed integer;
begin
  select jsonb_build_object(
           'thread_id', t.id,
           'thread_title', t.title,
           'thread_created_at', t.created_at,
           'ride_id', rd.id,
           'ride_title', rd.title,
           'ride_departure_at', rd.departure_at,
           'ride_is_public', rd.is_public,
           'organiser_id', rd.organizer_id,
           'organiser_username', o.username,
           'author_id', t.author_id,
           'author_username', a.username,
           'reports', coalesce(
             -- Reporters by uuid here too, for the reason the view gives.
             (select jsonb_agg(jsonb_build_object(
                       'reported_at', r.created_at,
                       'reason', r.reason,
                       'note', r.note,
                       'reporter_id', r.reporter_id)
                     order by r.created_at)
                from public.ride_thread_reports r
               where r.thread_id = t.id),
             '[]'::jsonb),
           'messages_total',
             (select count(*) from public.ride_thread_messages m where m.thread_id = t.id),
           'messages', coalesce(
             (select jsonb_agg(jsonb_build_object(
                       'created_at', m.created_at,
                       'author_id', m.author_id,
                       'body', m.body)
                     order by m.created_at)
                from (select m2.created_at, m2.author_id, m2.body
                        from public.ride_thread_messages m2
                       where m2.thread_id = t.id
                       order by m2.created_at
                       limit 200) m),
             '[]'::jsonb))
    into evidence
    from public.ride_threads t
    join public.rides rd    on rd.id = t.ride_id
    join public.profiles o  on o.id = rd.organizer_id
    join public.profiles a  on a.id = t.author_id
   where t.id = target;

  if evidence is null then
    -- A thread that does not exist is a clean answer, not an error — `076`'s
    -- shape, for its reason: an operator acting on a queue row somebody already
    -- deleted has done nothing wrong, and a subject deleted after being reported
    -- leaves the queue silently by the same cascade.
    return jsonb_build_object('removed', false, 'reason', 'no such ride thread');
  end if;

  -- The cascade list is read off `pg_constraint` at write time, never
  -- remembered — `076`'s header records naming one of five. Children of
  -- `public.ride_threads` on DEV 2026-09-19: `ride_thread_messages`,
  -- `ride_thread_reads`, and `ride_thread_reports` from this file, all three
  -- ON DELETE CASCADE. `036`'s `notifications` has no `thread_id` column and is
  -- NOT in the chain. Nothing under Storage hangs off a thread, so unlike `076`
  -- there is no object for the operator to sweep afterwards.
  delete from public.ride_threads where id = target;
  get diagnostics removed = row_count;

  return evidence || jsonb_build_object('removed', removed > 0, 'removed_at', now());
end;
$$;

comment on function private.remove_reported_ride_thread(uuid) is
  'Removes exactly one RIDE thread and returns what it destroyed — the thread, its ride, its organiser, its author, the reports about it and up to 200 of its messages with a messages_total beside them, so a truncation is visible rather than silent and the operator sees the proportionality before acting. Reads the evidence BEFORE the delete because the cascade destroys it (076 D5''s retention decision, restated). A target that does not exist returns {"removed": false, "reason": "no such ride thread"} rather than raising, because an operator acting on a queue row somebody already deleted has done nothing wrong. Owner-only: private is not routed by PostgREST, EXECUTE is granted to nobody, and it is deliberately NOT security definer — its only caller already holds BYPASSRLS, so the marking would buy nothing and add a second thing to explain (076 and 094''s functions are both prosecdef = false). ** Not to be confused with private.remove_reported_thread(uuid), which is 094''s CLUB take-down; the signatures are otherwise identical. ** Thread-granular by inheritance from 094: removing one abusive message means destroying the whole conversation, which is a product decision nobody has reopened. See 122.';

-- ** The grant IS the access control here. ** RLS is irrelevant to a view
-- running as its owner and to a function in `private` that is not published, so
-- it is stated absolutely rather than left to the schema's default, and
-- `service_role` is named because it is the one client-side role for which the
-- schema is not already the barrier. Neither object is a write surface for any
-- role but the owner.
revoke all on private.ride_thread_report_queue from public, anon, authenticated, service_role;
revoke all on function private.remove_reported_ride_thread(uuid) from public, anon, authenticated, service_role;

-- ===========================================================================
-- §4. `public.ride_threads`' table comment names the report table
-- ===========================================================================
-- `108` set it and it was complete for the whole life of the table. It is the
-- first thing anyone reads off `\d+ ride_threads` or `list_tables`, so leaving
-- it would leave the database itself asserting that deletion is the only
-- remedy. ** Composed from the LIVE comment, with the report sentence appended
-- and nothing else changed. **
comment on table public.ride_threads is
  'Titled threads on a ride (108, PD-402). The audience is an INTERSECTION and NEITHER HALF ALONE IS IT: riders who can see the ride (an EXISTS against rides, resolved under the caller''s own row security) AND who are on its crew (private.is_ride_crew — organizer, or any ride_members row of either status). The crew helper is security definer and steps past the block arm, the private-club arm and 083''s live-invite arm of the rides policy, so using it on its own lets a rider who blocked the organizer, or who left the private club, keep reading — 034''s first draft shipped exactly that. ** This is the INVERSE of club_threads (081), where the parent EXISTS is the redundant half; do not transfer that file''s conclusion. ** An accepted-invite rider who is NOT in the ride''s private club reads these in full and reaches no part of the club (proposal.md Q1''s stated default); a PENDING invitee reads the ride and none of its threads, because 083''s arm widens ride visibility and never thread visibility. Not editable by anyone: no UPDATE policy and no UPDATE grant. ** No DELETE policy and no DELETE grant either ** — removal is public.moderate_ride_thread(uuid), whose two authority arms are the ride''s ORGANIZER and the thread''s own AUTHOR and nothing else: a crew member who is neither is refused, and a club''s owner or admin gains nothing here because a ride has no admin role. ** Reportable by any rider who can read it, into public.ride_thread_reports (122, PD-454), and NOBODY ON THE CREW READS THOSE ** — not the author, not the organiser, no club owner or admin; the reporter reads their own row and the operator reads private.ride_thread_report_queue. Reporting is a third right, separate from both deletion arms, and it never implies either: a report leaves the thread exactly as visible as it was.';

-- ===========================================================================
-- §Operating it — because a queue nobody knows how to read is the same gap
--                 with more SQL in it
-- ===========================================================================
-- At the Supabase dashboard's SQL editor, which connects as the table owner:
--
--   -- what is waiting
--   select * from private.ride_thread_report_queue;
--
--   -- act on one, KEEPING THE RESULT: it is the only copy of the evidence
--   select private.remove_reported_ride_thread('<thread_id>');
--
-- There is no Storage step, unlike `076`: nothing under Storage hangs off a
-- thread. Removing a thread takes its messages, its read watermarks and its
-- reports with it through the cascade — which is the whole blast radius, and it
-- is why `message_count` is in the queue: acting on one line in a long crew
-- conversation destroys the conversation.
--
-- Leaving a report and taking no action needs no SQL at all — a report is not
-- state, it is a row that stays. ** There is deliberately no `resolved_at`. **
-- That is a moderation product's column: it needs an UPDATE grant, which `011`,
-- `076` and `094` all refuse, and it would make the queue a workflow with two
-- writers.
--
-- ** THREE queues after this file and FOUR after `123`, not one, and the union
-- is here rather than as a view. ** A `union all` over four subject shapes
-- either loses columns or invents nullable ones, and each queue earns its
-- columns by being about exactly one thing. For an operator who wants one pane
-- (the fourth line becomes available with `123`):
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
--          reporter_id, author_username
--     from private.postcard_comment_report_queue
--    order by reported_at desc;
--
-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- §2: the policy set, as a sorted COMMAND LIST rather than a count — a
--   -- count of 2 also passes for a set that swapped SELECT for UPDATE.
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'ride_thread_reports';
--                                                        -- INSERT,SELECT
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'ride_thread_reports'
--      and roles <> '{authenticated}';                                     -- 0
--
--   -- §2: grants, SCOPED TO THE GRANTEE (015's trap — a table-wide count reads
--   -- high because postgres and service_role hold everything by default)
--   select privilege_type from information_schema.table_privileges
--    where table_name = 'ride_thread_reports' and grantee = 'authenticated'
--    order by 1;                                                    -- SELECT
--   select column_name from information_schema.column_privileges
--    where table_name = 'ride_thread_reports' and grantee = 'authenticated'
--      and privilege_type = 'INSERT' order by 1;
--                                    -- note, reason, reporter_id, thread_id
--   select has_table_privilege('authenticated',
--            'public.ride_thread_reports', 'update'),                      -- f
--          has_table_privilege('authenticated',
--            'public.ride_thread_reports', 'delete'),                      -- f
--          has_table_privilege('anon',
--            'public.ride_thread_reports', 'select'),                      -- f
--          has_table_privilege('service_role',
--            'public.ride_thread_reports', 'select');                      -- f
--
--   -- the census CLAUDE.md §Supabase Rules carries: 30 kept / 5 revoked after
--   -- this file, 30 / 6 after 123.
--
--   -- §2: the gate, by TABLE NAME and by DELTA. Both, because a count alone
--   -- cannot tell a new gate from a moved one.
--   select count(*) from pg_trigger t
--    where t.tgname = 'enforce_participation_gate' and not t.tgisinternal
--      and t.tgrelid = 'public.ride_thread_reports'::regclass;             -- 1
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate'
--      and not tgisinternal;                             -- 22 + 1 = 23 on DEV
--
--   -- §3: private is unreachable, BY ROLE rather than by calling it as the
--   -- owner — 031 exists because 029 shipped a function nothing could call and
--   -- the suite, which runs as the table owner, did not notice.
--   select has_schema_privilege('authenticated', 'private', 'usage'),      -- f
--          has_schema_privilege('anon', 'private', 'usage'),               -- f
--          has_table_privilege('service_role',
--            'private.ride_thread_report_queue', 'select'),                -- f
--          has_function_privilege('service_role',
--            'private.remove_reported_ride_thread(uuid)', 'execute'),      -- f
--          has_function_privilege('authenticated',
--            'private.remove_reported_ride_thread(uuid)', 'execute');      -- f
--   select prosecdef from pg_proc
--    where oid = 'private.remove_reported_ride_thread(uuid)'::regprocedure; -- f
--   -- and 094's club take-down is STILL THERE, unreplaced
--   select count(*) from pg_proc
--    where oid = 'private.remove_reported_thread(uuid)'::regprocedure;      -- 1
--   select reloptions from pg_class
--    where oid = 'private.ride_thread_report_queue'::regclass;
--                                            -- {security_invoker=false}
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
--   drop function private.remove_reported_ride_thread(uuid);
--   drop view private.ride_thread_report_queue;
--   drop table public.ride_thread_reports;         -- takes its trigger with it
--   -- restamp public.enforce_participation_gate()'s comment back to
--   -- twenty-two, dropping the twenty-third entry, and restamp
--   -- public.ride_threads' comment back to 108's text by removing the final
--   -- report sentence.
-- Nothing else moved, so the rollback is complete rather than approximate. It
-- is also independent of `123`: the two files share no object.
