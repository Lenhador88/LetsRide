-- 096: a rider's analytics opt-out, and the replay link on feedback.
--
-- Linear PD-353, schema and consent half only. The proposal is
-- `openspec/changes/add-analytics-consent/`; `design.md` §D1-§D10 is the
-- reasoning and this header is the part that has to survive without it.
--
-- ---------------------------------------------------------------------------
-- §0a. What this file can and cannot do, said once and plainly (design §D8)
-- ---------------------------------------------------------------------------
-- **PostHog is a client-side SDK. Nothing in Postgres is in its path.** No
-- policy, CHECK or trigger here sits between a browser and `eu.i.posthog.com`,
-- so `analytics_opt_out_at` is a REMEMBERED PREFERENCE and a client that
-- ignores it captures anyway.
--
-- CLAUDE.md's "RLS enforces authorization, never validity" is the rule most
-- likely to be misapplied to this column. It is neither: it is a statement
-- about what a THIRD PARTY may be told. The two things this file does
-- guarantee are small and worth naming, because they are the whole of it:
--
--   1. no rider can learn another rider's preference, by any route; and
--   2. an opted-out rider's feedback row cannot carry a session id, whatever
--      the client sends.
--
-- Everything else about analytics is enforced in the bundle. A later session
-- reading `list_tables` must not read this column as an enforcement point,
-- which is why the sentence is in the column comment too.
--
-- ---------------------------------------------------------------------------
-- §0b. Pre-flight, measured 2026-09-01 against BOTH hosted projects
-- ---------------------------------------------------------------------------
-- Read out of the databases rather than off a file or a sentence, per the
-- proposal's §0. `fpmrimzxadewsaiwpsel` is DEV, `zwprydcyryvudhurbnye` is PROD.
--
--   migrations on disk ............................. 95 (this file is 096)
--   DEV list_migrations ends at .................... 095_an_owner_leaves_their_club
--   PROD list_migrations ends at ................... 091_ride_invite_links
--   profiles.analytics_opt_out_at exists ........... 0 on both (column absent)
--
-- `025`'s three grant lists for `authenticated`, read with
-- `has_column_privilege` over `pg_attribute` rather than from `025`'s text —
-- the only way to know a later migration has not already widened one:
--
--   column                    select insert update
--   id                          t      t      f
--   username                    t      t      t
--   bio                         t      t      t
--   bike_model                  t      t      t
--   created_at                  t      f      f
--   onboarding_completed_at     f      f      f
--   location                    t      t      t
--   terms_accepted_at           f      f      f
--   avatar_path                 t      t      t
--   cover_image_path            t      t      t
--   terms_version               f      f      f      <- 030, THE PRECEDENT
--
--   => SELECT 8 columns, INSERT 7, UPDATE 6, unchanged since 025.
--   => has_table_privilege('authenticated','public.profiles', …) is f,f,f,f.
--
-- `profiles` policies (design §D2 rests on both, so both were read):
--   SELECT "Profiles are viewable by signed-in riders"
--     ((auth.uid() = id) OR ((username IS NOT NULL)
--       AND (NOT private.is_blocked(auth.uid(), id))))   <- ADMITS OTHER ROWS
--   UPDATE "Users can update their own profile"
--     using (auth.uid() = id) with check (auth.uid() = id)
--   INSERT "Users can insert their own profile" with check (auth.uid() = id)
--
-- `feedback` today (084): exactly ONE trigger — `enforce_participation_gate`,
-- `tgtype` 7 = BEFORE INSERT FOR EACH ROW, `when (CURRENT_USER =
-- 'authenticated'::name)`. Grants: INSERT on `user_id, body, app_version,
-- route` and nothing else; `has_table_privilege('authenticated',
-- 'public.feedback', …)` is f,f,f,f on all four commands; one policy, INSERT.
--
--   enforce_participation_gate triggers ....... DEV 22, PROD 17
--
-- **That difference is expected and this file must not move either number.**
-- CLAUDE.md §Technology Decisions says seventeen "on BOTH projects" and is
-- stale for DEV: `092`-`095` added five (`club_join_waves`,
-- `club_thread_waves`, `club_invites`, `club_invite_links`,
-- `club_thread_reports`) and are not promoted yet. That is the ordinary
-- DEV-ahead state between a merge and its promotion, not a gap. §3.7 says why
-- this file adds none.
--
-- Nothing in `src/` reads `profiles` with `select('*')` — every call site uses
-- an explicit list (`OWN_PROFILE_COLUMNS`, `PUBLIC_PROFILE_COLUMNS`,
-- `VIEWED_PROFILE_COLUMNS`, or a named column). `030` had to check this before
-- it could be additive and so does this file: an ungranted column is INVISIBLE
-- rather than breaking only while every projection is explicit.
--
--   grep -rn "from('profiles')" -A3 src/lib/data/ src/lib/actions/ | grep "select("
--
-- ---------------------------------------------------------------------------
-- §0c. Additive in schema, NOT inert in behaviour — apply BEFORE the build
-- ---------------------------------------------------------------------------
-- Everything here is a new column, a grant on a new column, two new public
-- functions, one new `private` function and one new trigger. Nothing is
-- dropped, no existing policy changes and no grant is taken away. So this
-- applies on `069`'s side of the `069`/`070` pair: **migration first, deploy
-- second**. Both directions were checked rather than assumed:
--
--   * Migration first, older bundle still serving. The older bundle names none
--     of it. `sendFeedback` inserts four columns and the fifth is nullable with
--     no default, so it arrives NULL; §3.4's trigger then runs on every insert
--     and is a behavioural NO-OP against that bundle — `nullif(btrim(null),'')`
--     is NULL, and the opt-out branch nulls a NULL. Nothing changes for anyone.
--
--   * Build first, migration after. The new bundle calls
--     `my_analytics_opt_out()` against a database that has neither function ->
--     `PGRST202`, and under the proposal's fail-closed boot rule the SDK simply
--     stays capture-off: degraded, harmless. **`sendFeedback` is not
--     harmless** — it would name a column that does not exist -> `PGRST204`,
--     and FEEDBACK SUBMISSION GOES DOWN ENTIRELY for the length of the gap.
--     That is the decisive argument, and it is why "additive, so the order does
--     not matter" is wrong here.
--
-- **`084` could truthfully call itself inert and this file cannot.** §3.4 hangs
-- a trigger on a SHIPPED write path: from the moment this applies, every
-- rider's feedback insert runs new code inside their own transaction, and a
-- raise there takes their submission down. `036`'s hand-exercise gate therefore
-- fires, per project rather than per file — see the footer.
--
-- **No client ordering constraint**, unlike `089`/`092`/`093`: nothing here
-- widens an exhaustive client switch, so there is no "must not receive a row
-- while an older bundle serves" clause and this does not wait for a `READY`
-- deployment.
--
-- ---------------------------------------------------------------------------
-- §0d. Retention and reach, decided here rather than retrofitted
-- ---------------------------------------------------------------------------
-- Both new columns ride the cascade that already exists and neither adds a
-- retention surface of its own:
--
--   * `profiles.analytics_opt_out_at` lives exactly as long as the profile row,
--     which `029` deletes with the account. There is nothing to expire — a
--     preference with no rider is not a record of anything.
--   * `feedback.posthog_session_id` lives exactly as long as its feedback row,
--     which is `on delete cascade` on `feedback.user_id` (`084` §0b). So an
--     account deletion takes the replay pointers with the reports.
--
-- **What deletion does NOT reach is PostHog itself**, and that is stated here
-- because it is the one place the schema's contract is quietly incomplete:
-- `delete-account` removes the rows and nothing anywhere calls PostHog. The
-- recordings and events survive the account. That is `design.md` §Q1, it is the
-- product owner's to answer, and `/legal/privacy` is where the answer lands —
-- no column here can fix it. It is NOT blocking for this file: the client
-- calls `identify()` with the rider's `auth.uid()`, so the distinct id is a
-- value `delete-account` already holds and an erasure call added later needs no
-- new column.

-- ---------------------------------------------------------------------------
-- §1. The column
-- ---------------------------------------------------------------------------
-- A nullable `timestamptz`, matching the repo's stamp idiom
-- (`terms_accepted_at`, `onboarding_completed_at`, `terms_version`) and
-- recording WHEN as well as WHETHER, which a boolean cannot.
--
-- **`_opt_out_at` rather than `_opted_in_at`, and the direction is load-bearing.**
-- PD-353's default is opted IN, so absence must mean "in". A column whose NULL
-- meant "off" would silently opt every existing rider out on the day it applies.
-- No backfill for the same reason: every existing row is correct as NULL.
--
-- **NO GRANT OF ANY KIND, and the absence IS the control** (design §D2). RLS is
-- row-level, not column-level, and §0b's SELECT policy admits every non-blocked
-- rider who has a username — so a policy that admits the row admits every column
-- of it. Putting this column in `025`'s `grant select (...)` would publish every
-- rider's analytics preference to every other rider, through every member list,
-- ride crew, postcard byline, comment author and chat participant in the app,
-- and through a bare `?select=analytics_opt_out_at` that needs no screen at all.
-- `PUBLIC_PROFILE_COLUMNS` narrows the projection in application code, and
-- PostgREST does not enforce a convention.
--
-- So `authenticated` holds no SELECT, no INSERT and no UPDATE on it — the exact
-- posture `030` gave `terms_version`, verified live in §0b rather than quoted.
-- §2's two accessors are the only reach.
--
-- **AND THIS FILE ISSUES NO `grant` OR `revoke` ON `public.profiles` AT ALL.**
-- That is the second half of the rule and the one that is easy to get wrong
-- while getting the first half right. `044`/`046` are this repo's worked example
-- of an absolute list silently reinstating what a later migration removed — no
-- error, nothing red — and `profiles` is on such a list. A file that
-- "helpfully" restates `025`'s three lists while adding a column is one
-- transcription slip away from re-granting something `042` or `047` revoked.
-- Widen with a bare additive `grant` naming only the new column, or do not touch
-- the lists at all. This file does the second.

alter table public.profiles add column analytics_opt_out_at timestamptz;

comment on column public.profiles.analytics_opt_out_at is
  'When this rider opted out of product analytics (096, PD-353). NULL means NOT opted out — the default, and the reason the column is named for the opt-out rather than the opt-in. Server-owned: authenticated holds no grant on any of select, insert or update, the same posture 030 gave terms_version, so the only reach is my_analytics_opt_out() and set_analytics_opt_out(). ** The database cannot enforce this preference. ** PostHog is a client-side SDK and nothing in Postgres is in its path; this column is a remembered preference the client is trusted to honour, and it is NOT an authorization gate — an opted-out rider loses no capability anywhere in the app.';

-- ---------------------------------------------------------------------------
-- §2. The two accessors — the whole of the client's reach
-- ---------------------------------------------------------------------------
-- Both are `security definer` for `030`'s reason: §1 withholds the column
-- grant, so an invoker-rights function could not see the column at all. Both
-- take NO rider id, so a foreign preference is unrepresentable rather than
-- merely refused — `accept_terms()`'s property, and the one that makes the
-- narrowness a defence rather than a claim.
--
-- **A NEW accessor rather than a fourth field on `my_onboarding_state()`**
-- (design §D3). That function's answer is cached for the page load in
-- `guard-cache.ts` on the stated ground that both stamps are IMMUTABLE for a
-- session's lifetime. This is a toggle — mutable by definition — so it would be
-- served stale, or force a fourth invalidation writer into a cache whose
-- generation counter exists because of PD-304's race. Nothing routes on it
-- either: `resolveDestination` has 54 cases and none would read it.
--
-- `set search_path = ''` with every non-`pg_catalog` name schema-qualified, per
-- `005`. (The task list wrote `public, pg_temp`; `''` is this repo's convention
-- and is strictly stronger, so the convention wins.)

create or replace function public.my_analytics_opt_out()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p.analytics_opt_out_at
    from public.profiles p
   where p.id = (select auth.uid());
$$;

comment on function public.my_analytics_opt_out() is
  'The CALLER''s own analytics opt-out stamp, and nobody else''s (096). NULL means not opted out — and a caller with no profile row gets NULL too, which is the same answer and is correct: a rider with no row is not opted out of anything. security definer because 025''s allowlist withholds the column grant and 096 never adds one; no arguments, so there is no row to choose but your own.';

revoke all on function public.my_analytics_opt_out() from public, anon;
grant execute on function public.my_analytics_opt_out() to authenticated;

-- The write. An RPC rather than a column UPDATE grant, for three reasons
-- (design §D4), the first of which would have been found later and painfully:
--
--   1. A grant would create a WRITABLE-BUT-UNREADABLE column. `authenticated`
--      would hold UPDATE and no SELECT, so a plain `.update()` works while any
--      `.select()` chained onto it returns 42501. `084`'s `sendFeedback`
--      docstring already carries a warning about exactly this shape, because it
--      caught someone; reproducing it on `profiles` — the table every screen
--      touches — is inviting the same afternoon back.
--   2. A grant means touching `025`'s lists. §1's whole point. An RPC does not.
--   3. The stamp stays client-forgeable. `012` needed a trigger to stop a client
--      back-dating `terms_accepted_at`; with no grant there is nothing to
--      correct, because column privileges are checked against the columns named
--      in SET BEFORE any BEFORE trigger runs (`025` §DEFECT 2c). Refusal beats
--      correction, and here refusal is free.
--
-- Idempotent in the opt-out direction, `accept_terms()`'s shape: a second
-- `true` keeps the FIRST stamp rather than moving it, so the record says when
-- the rider decided, not when they last looked at the screen. `false` clears it
-- outright — an opt-in leaves no residue, because a stamp that survived an
-- opt-in would be a preference the rider cannot actually undo.
--
-- It returns the EFFECTIVE value so the caller writes its cache from the
-- answer rather than from what it hoped, which is what makes an optimistic
-- toggle unnecessary.

create or replace function public.set_analytics_opt_out(p_opt_out boolean)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_stamp timestamptz;
begin
  if v_uid is null then
    raise exception 'set_analytics_opt_out requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- A NULL argument is not a third position, it is a client bug. Refuse it
  -- rather than resolve it: `case when null then` would fall to the ELSE and
  -- silently record an OPT-IN for a rider whose intent is unknown, which is the
  -- one direction this file must never guess in.
  if p_opt_out is null then
    raise exception 'set_analytics_opt_out requires true or false'
      using errcode = 'null_value_not_allowed';
  end if;

  update public.profiles p
     set analytics_opt_out_at = case
           when p_opt_out then coalesce(p.analytics_opt_out_at, pg_catalog.now())
           else null
         end
   where p.id = v_uid
  returning p.analytics_opt_out_at into v_stamp;

  -- No row means no profile for a live session, which `handle_new_user` makes
  -- unreachable in practice. It raises rather than returning NULL because NULL
  -- is a MEANINGFUL answer here — "not opted out" — so a silent no-op would
  -- tell a rider who just tapped "opt out" that they are opted in, and the
  -- client would turn capture on. An error keeps it off (the fail-closed rule).
  if not found then
    raise exception 'set_analytics_opt_out found no profile for the caller'
      using errcode = 'no_data_found';
  end if;

  return v_stamp;
end;
$$;

comment on function public.set_analytics_opt_out(boolean) is
  'Records the CALLER''s analytics opt-out, and nobody else''s (096, PD-353). true stamps now() and is idempotent — a second call keeps the first stamp, accept_terms()''s shape; false clears it to NULL. Takes no rider id, so a foreign preference is unrepresentable rather than merely refused, and returns the effective value so the caller can write its cache from the answer. security definer because 025''s allowlist withholds the UPDATE grant on the column and 096 never adds one. This is a PREFERENCE and never an authorization gate: a rider who is opted out can still do everything any other rider can, and a rider who has not accepted the terms can still opt out.';

revoke all on function public.set_analytics_opt_out(boolean) from public, anon;
grant execute on function public.set_analytics_opt_out(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- §3. `feedback.posthog_session_id` — the replay link (design §D5, §D6)
-- ---------------------------------------------------------------------------
-- PD-353: *"The postcard thing is broken" is unactionable alone and completely
-- actionable beside ninety seconds of footage.* This column is the pointer.

alter table public.feedback add column posthog_session_id text;

-- **200, not 40, and the looseness is deliberate.** A PostHog session id is a
-- 36-character UUID today. A CHECK expressing that would be correct and would
-- be a LIVE OUTAGE WAITING ON A VENDOR: the day PostHog lengthens the id, every
-- feedback insert answers 23514 and the rider cannot file at all — breaking the
-- shipped feature this column exists to improve. PD-353's first rule is that
-- feedback must still send when analytics did not load, and a constraint that
-- breaks feedback when analytics merely CHANGED is the same defect with a
-- slower fuse. The CHECK bounds a forged insert; it does not express a format —
-- `084`'s own words about `app_version` and `route`, and 200 is `route`'s
-- ceiling reused.
--
-- **No lower bound**, unlike `body`. A blank or whitespace-only id is a client
-- bug and should cost the replay link, not the report, so §3.4 normalises it to
-- NULL instead of refusing it.
alter table public.feedback
  add constraint feedback_posthog_session_id_length
  check (posthog_session_id is null or length(posthog_session_id) <= 200);

comment on column public.feedback.posthog_session_id is
  'The PostHog session id the rider was in when they filed this (096, PD-353) — an id, never a replay URL, so an expired or deleted recording is a null result rather than a broken link. Best-effort: nullable, unbounded below, and bounded above only to stop a forged insert. For a rider with analytics_opt_out_at set it is stored as NULL by private.strip_feedback_session_id() rather than refused, because an opt-out must never cost a rider the ability to report a bug. Write-only like the rest of this table: 084 grants no SELECT and writes no SELECT policy, and 096 adds neither.';

-- The grant is ONE BARE ADDITIVE STATEMENT naming only the new column. `084`'s
-- four-column list is deliberately NOT restated — §1's rule, second table.
grant insert (posthog_session_id) on public.feedback to authenticated;

-- **No SELECT grant and no SELECT policy.** `084`'s write-only shape is the
-- contract, and its header is explicit that the absent grant and the absent
-- policy must move together. They do not move here, so the session id is
-- unreadable by every client role including the author of the row — which is
-- also the second door by which a rider might have learned another rider's
-- preference, and it stays shut by inheritance rather than by anything new.

-- §3.4. The sanitiser: the one place the opt-out becomes a database fact.
--
-- Without it, "an opted-out rider's feedback carries no session id" is a
-- promise made by `src/lib/actions/feedback.ts`, and CLAUDE.md is unambiguous
-- that a rule reaching only the client is advisory now that the client owns the
-- mutation path — a forged insert against the publishable key is one `curl`. It
-- is also the difference between a requirement that maps onto an assertion in
-- `supabase/tests/rls_test.sql` and one that maps onto nothing.
--
-- **It never raises, and that is a rule rather than an implementation detail.**
-- PD-353's first rule outranks the link: an opted-out rider must still be able
-- to send feedback. A raising trigger would make opting out of analytics
-- silently disable bug reporting — a preference becoming an authorization gate,
-- which §1's column comment forbids in as many words.
--
-- `security definer` and in `private` for two separate reasons: it reads
-- `profiles.analytics_opt_out_at`, on which `authenticated` holds no grant, so
-- an invoker-rights function could not see the column at all; and PostgREST
-- does not publish `private`, so it adds NO advisor (`085`'s eight private
-- functions added zero between them).
--
-- A CHECK could not do this: a CHECK cannot reference another table, so it
-- cannot see the author's preference, and it would refuse rather than
-- normalise — the wrong failure direction.

create or replace function private.strip_feedback_session_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.posthog_session_id := nullif(pg_catalog.btrim(new.posthog_session_id), '');

  if new.posthog_session_id is not null
     and exists (
       select 1
         from public.profiles p
        where p.id = new.user_id
          and p.analytics_opt_out_at is not null
     )
  then
    new.posthog_session_id := null;
  end if;

  return new;
end;
$$;

comment on function private.strip_feedback_session_id() is
  'Normalises feedback.posthog_session_id on the way in (096): a blank or whitespace-only id becomes NULL, and an id belonging to a rider with analytics_opt_out_at set is dropped outright. It NEVER raises — an opt-out must not cost a rider the ability to file a bug report, and PD-353 requires feedback to send even when analytics did not load. security definer and in private because it reads a profiles column no client role holds a grant on, and because private adds no PostgREST-published advisor.';

revoke all on function private.strip_feedback_session_id() from public, anon, authenticated;

-- **NO `when (current_user = 'authenticated')` CLAUSE, and that is the
-- interesting half.** `084`'s gate trigger on this same table carries one and is
-- right to: it expresses a rule about what RIDERS may write, so it must not
-- refuse a seed, a repair statement or an accessor. This trigger expresses a
-- rule about the ROW — an opted-out rider's id does not get stored, by whatever
-- route the row arrives — so it must fire for every writer, including the table
-- owner in the dashboard and any future `security definer` path. That is
-- `036` §7's trap read in both directions on one table.
--
-- **Ordering.** Postgres fires BEFORE ROW triggers in NAME order, so
-- `enforce_participation_gate` runs before `strip_feedback_session_id` ('e'
-- before 's'). Neither depends on the other — the gate either raises, and
-- nothing is stored, or passes, and the sanitiser normalises — so this is stated
-- for the next reader rather than relied upon.
drop trigger if exists strip_feedback_session_id on public.feedback;
create trigger strip_feedback_session_id
  before insert on public.feedback
  for each row execute function private.strip_feedback_session_id();

-- §3.7. **No participation-gate trigger is added, and the absence is
-- deliberate rather than an omission.** `feedback` already carries one (`084`,
-- the fifteenth), it is BEFORE INSERT FOR EACH ROW, and it fires on the whole
-- row regardless of which columns a statement names — so a new column needs
-- nothing from it. The count stays at DEV 22 / PROD 17 (§0b), and the RLS suite
-- asserts that it did. `078` §9 is the precedent for asserting an absence: a
-- gap that reads as covered is how the next one gets inherited.
--
-- The `enforce_participation_gate` comment is therefore NOT restamped — the
-- number it carries has not moved.

-- ---------------------------------------------------------------------------
-- §4. Advisors — what this file is expected to add, and nothing else
-- ---------------------------------------------------------------------------
-- **+2 `authenticated_security_definer_function_executable` (WARN)**, one per
-- new PUBLIC `security definer` function: `my_analytics_opt_out` and
-- `set_analytics_opt_out`. `private.strip_feedback_session_id` adds NONE —
-- PostgREST does not publish `private`, which is why `085`'s eight private
-- functions moved the count by zero and why it goes up by the number of PUBLIC
-- functions rather than the number of functions.
--
-- Both are in the same family as the twenty-four already there and both are
-- narrow by design: no arguments (or one boolean), no rider id, one row, the
-- caller's own. Narrowness is the defence.
--
-- No new `rls_enabled_no_policy` INFO: this file creates no table. No table
-- loses RLS, no view is created, and nothing is exposed to `anon`.
--
-- Re-derive with `get_advisors(security)` rather than trusting this arithmetic;
-- CLAUDE.md's cell has read low before.
--
-- ---------------------------------------------------------------------------
-- §5. Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
-- Every privilege check is SCOPED TO ITS GRANTEE. `postgres` and `service_role`
-- hold everything by Supabase default, so a table-wide count reads 2 against a
-- correct database — the mistake `015`'s footer made and documented.
--
--   -- f, f, f — the whole of §1's control, and the requirement's own scenario.
--   select has_column_privilege('authenticated','public.profiles','analytics_opt_out_at','select'),
--          has_column_privilege('authenticated','public.profiles','analytics_opt_out_at','insert'),
--          has_column_privilege('authenticated','public.profiles','analytics_opt_out_at','update');
--
--   -- t, t, t, t — the over-tightening guard. If any is false this file
--   -- touched a grant list it must not have, and the app cannot render a
--   -- byline. (025's footer, same shape.)
--   select has_column_privilege('authenticated','public.profiles','username','select'),
--          has_column_privilege('authenticated','public.profiles','avatar_path','select'),
--          has_column_privilege('authenticated','public.profiles','location','select'),
--          has_column_privilege('authenticated','public.profiles','username','update');
--
--   -- f — no table-level grant was restored while adding a column.
--   select has_table_privilege('authenticated','public.profiles','select');
--
--   -- 8, 7, 6 — 025's three lists, unchanged in width.
--   select count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'select')),
--          count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'insert')),
--          count(*) filter (where has_column_privilege('authenticated','public.profiles',attname,'update'))
--     from pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped;
--
--   -- t, t — both accessors are callable by riders ...
--   select has_function_privilege('authenticated','public.my_analytics_opt_out()','execute'),
--          has_function_privilege('authenticated','public.set_analytics_opt_out(boolean)','execute');
--   -- f, f, f — ... and by nobody else on the client side.
--   select has_function_privilege('anon','public.my_analytics_opt_out()','execute'),
--          has_function_privilege('anon','public.set_analytics_opt_out(boolean)','execute'),
--          has_function_privilege('authenticated','private.strip_feedback_session_id()','execute');
--
--   -- t, t — both are security definer, and t — so is the sanitiser.
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('my_analytics_opt_out','set_analytics_opt_out','strip_feedback_session_id');
--   -- proconfig must read {"search_path=\"\""} on all three — the STORED
--   -- form of `set search_path = ''` carries the quotes, so a check written
--   -- against a bare `search_path=` matches nothing and reads as unpinned.
--
--   -- t — the new feedback column is insertable ...
--   select has_column_privilege('authenticated','public.feedback','posthog_session_id','insert');
--   -- f, f — ... and neither readable nor updatable, by anyone client-side.
--   select has_column_privilege('authenticated','public.feedback','posthog_session_id','select'),
--          has_column_privilege('authenticated','public.feedback','posthog_session_id','update');
--   -- f, f, f, f — 084's table-level shape is untouched. INSERT is false BY
--   -- DESIGN: the grant is per column and a column grant does not satisfy a
--   -- table-level check.
--   select has_table_privilege('authenticated','public.feedback','select'),
--          has_table_privilege('authenticated','public.feedback','insert'),
--          has_table_privilege('authenticated','public.feedback','update'),
--          has_table_privilege('authenticated','public.feedback','delete');
--
--   -- t, t, t, t, t — 084's four INSERT columns survive the additive grant.
--   select has_column_privilege('authenticated','public.feedback','user_id','insert'),
--          has_column_privilege('authenticated','public.feedback','body','insert'),
--          has_column_privilege('authenticated','public.feedback','app_version','insert'),
--          has_column_privilege('authenticated','public.feedback','route','insert'),
--          has_column_privilege('authenticated','public.feedback','posthog_session_id','insert');
--   -- f, f — and the two the client still may not name.
--   select has_column_privilege('authenticated','public.feedback','id','insert'),
--          has_column_privilege('authenticated','public.feedback','created_at','insert');
--
--   -- 2 triggers on feedback: enforce_participation_gate (tgtype 7, WITH the
--   -- when clause) and strip_feedback_session_id (tgtype 7, when clause NULL).
--   select tgname, tgtype, pg_get_expr(tgqual, tgrelid) from pg_trigger
--    where tgrelid='public.feedback'::regclass and not tgisinternal order by tgname;
--
--   -- DEV 22, PROD 17 — unchanged. This file adds no gate trigger (§3.7).
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;
--
--   -- 1, INSERT — 084's single policy, untouched.
--   select count(*), min(cmd) from pg_policies where tablename='feedback';
--
-- **`036`'s HAND-EXERCISE GATE, per project and not per file.** §3.4 hangs a
-- trigger on a live write path, so before this is trusted on a project, run all
-- four cases by hand as `authenticated` in a ROLLED-BACK transaction and COUNT
-- the rows rather than assuming:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a consented rider>"}';
--   insert into public.feedback (user_id, body, posthog_session_id)
--     values ('<that rider>','hand exercise, opted in','0198f3c2-...');
--   -- then, as the owner: the id survived
--   insert into public.feedback (user_id, body, posthog_session_id)
--     values ('<an opted-out rider>','hand exercise, opted out','0198f3c2-...');
--   -- the row EXISTS and its posthog_session_id is NULL. The insert must NOT
--   -- have raised — that is the assertion, not the NULL.
--   insert into public.feedback (user_id, body) values ('<rider>','no id at all');
--   insert into public.feedback (user_id, body, posthog_session_id)
--     values ('<rider>','blank id','   ');           -- stored NULL, succeeds
--   rollback;
--
-- Note the identity idiom: `request.jwt.claims` is correct against the HOSTED
-- database, where `auth.uid()` reads it. The local suite in `supabase/tests/`
-- redefines `auth.uid()` to read `test.uid`, so an assertion written the hosted
-- way there passes while proving nothing.
