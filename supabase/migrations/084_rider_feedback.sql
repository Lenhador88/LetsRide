-- 084: rider feedback — one write-only table, and nothing that reads it.
--
-- Linear PD-321. Product owner, 2026-08-27: *"The app should have a place to add
-- feedback. For now we can have an option on the profile 3 dots menu."*
--
-- ---------------------------------------------------------------------------
-- Purely additive, and inert until the code ships
-- ---------------------------------------------------------------------------
-- Unlike `036`, nothing existing executes anything this file creates: no
-- trigger hangs off a shipped write path, no policy on an existing table
-- changes, and no grant is taken away. The one trigger below fires only on
-- INSERTs into a table that did not exist a statement earlier. So this is safe
-- to apply at any moment, in either direction relative to the deploy — the
-- shape `034` had and `036` explicitly did not.
--
-- ---------------------------------------------------------------------------
-- §0. The shape of the decision: this table is written and never read
-- ---------------------------------------------------------------------------
-- **`authenticated` gets a column-level INSERT grant and NO SELECT grant at
-- all**, which is `password_reset_grants`' (`026`) and `push_devices`' (`078`)
-- shape rather than a new one. Nobody in the app reads feedback, so a read
-- policy would be the thing that granted reach — and a rider being able to
-- re-read their own submissions is a feature nothing has asked for that would
-- have to be designed against blocks, moderation and deletion.
--
-- **Where anyone ever reads these rows is deliberately out of scope**, and it
-- is Linear PD-322, in `Needs decision`. The table is where feedback lands, not
-- how it reaches a human. Today that human is the product owner in the Supabase
-- dashboard, as the table owner — a role no grant here touches.
--
-- **The absent SELECT grant is what makes the absent SELECT policy safe, and
-- the two must move together.** Granting own-row SELECT later without writing
-- the policy would return nothing; writing the policy without the grant would
-- return `42501`. Whoever builds the reading story changes both, in one file,
-- and re-reads §3's advisor note while they are there.
--
-- ---------------------------------------------------------------------------
-- §0b. Retention: the cascade window, and nothing else
-- ---------------------------------------------------------------------------
-- Stated at creation because CLAUDE.md requires it of any table holding
-- rider-authored text. A feedback row lives exactly as long as its author's
-- profile — `on delete cascade` — and nothing else deletes one. There is no
-- `pg_cron` and no scheduled Edge Function in this project, so a time-based
-- sweep cannot be enforced by this migration and is therefore not claimed by
-- it (`036`'s own reasoning, and its warning that a number nothing implements
-- becomes a fact nobody rechecks).
--
-- **Cascade rather than `on delete set null`, and the choice is not obvious.**
-- Keeping the text with a NULL author would preserve the report — which is what
-- the team wants — and it would also keep free text a rider wrote after they
-- asked for their account to be erased, in a column no cascade can reach and
-- nothing redacts. `029`'s account-deletion contract settles it: the row goes.
-- The cost is real and is accepted rather than hidden — a tester who deletes
-- their account takes their bug reports with them.

create table public.feedback (
  id uuid default uuid_generate_v4() primary key,

  -- The author. Cascade, per §0b. NOT NULL, so there is no anonymous row and
  -- the INSERT policy below always has something to pin against.
  user_id uuid references public.profiles(id) on delete cascade not null,

  -- What the rider typed. Bounded here rather than only in Zod, per CLAUDE.md:
  -- a rule that lives only in a schema is advisory, because a rider can simply
  -- not run your validation — and now that the client owns the mutation path
  -- that is a one-line `curl` away.
  --
  -- Trimmed floor, raw ceiling — `018`'s asymmetry, for `011`'s reason: a
  -- whitespace-only body is not feedback, while trimming before the ceiling
  -- would let a 2000-character body plus trailing spaces through a check the
  -- column then has to store.
  body text not null,

  -- Context, so a report is actionable. Both are written by the app rather than
  -- typed, both are nullable because a client that omits them must still be
  -- able to file, and both are bounded because the client is the one supplying
  -- them and CLAUDE.md's rule does not stop applying to a string the app wrote.
  --
  -- `app_version` is `APP_VERSION` from src/lib/version.ts — the same value the
  -- native update gate compares against, so a report can be placed against a
  -- build.
  app_version text,

  -- The route the rider was on: `window.location.pathname`, and deliberately
  -- **not** the query string. Every detail route in this app carries its
  -- subject's id in `?id=`, so storing the search would put the id of a ride, a
  -- club, a postcard or another rider into a table whose entire premise is that
  -- nothing in the app can read it back — context nobody asked for, on the one
  -- table with no audience to justify it. The path alone says which screen.
  route text,

  -- Server time, and unforgeable rather than merely defaulted: §2's grant does
  -- not name this column, so there is no statement in which a client could set
  -- it. `045`'s mechanism, applied at creation instead of retrofitted.
  created_at timestamptz default now() not null,

  constraint feedback_body_length
    check (length(btrim(body)) >= 1 and length(body) <= 2000),

  -- Generous ceilings on two values the app writes; they exist to bound a
  -- forged insert, not to express a format. A semver string is well under 40
  -- and the longest route in this app is well under 200.
  constraint feedback_app_version_length
    check (app_version is null or length(app_version) <= 40),
  constraint feedback_route_length
    check (route is null or length(route) <= 200)
);

alter table public.feedback enable row level security;

comment on table public.feedback is
  'Rider-submitted feedback (084, PD-321). WRITE-ONLY from the app: `authenticated` holds a column-level INSERT grant and NO SELECT grant, so no rider — including the author — can read a row back, and there is deliberately no SELECT policy. Where these rows are read by a human is a separate decision and is not built; today it is the table owner in the dashboard. Retention is the cascade window: a row dies with its author and nothing else deletes one.';

comment on column public.feedback.route is
  'The pathname the rider was on when they wrote it — never the query string, because every detail route in this app carries its subject id there and this table has no audience that could justify holding one.';

comment on column public.feedback.created_at is
  'Server-owned, and unwritable by any client because the INSERT grant in 084 §2 does not name this column.';

-- ---------------------------------------------------------------------------
-- §1. INSERT — your own row, and no other statement of any kind
-- ---------------------------------------------------------------------------
-- One policy, one command. `user_id = auth.uid()` is the same pin every
-- rider-authored table in this schema carries, and it is what makes a
-- client-owned mutation path safe: the id comes from the session, so a caller
-- naming somebody else's is refused rather than believed.
--
-- **There is no SELECT, UPDATE or DELETE policy, and their absence is the
-- contract rather than an omission to fill in later.** With RLS on, a command
-- with no policy is refused for every row — so feedback cannot be edited after
-- the fact, cannot be withdrawn, and cannot be read back. §4 asserts all four.
create policy "Riders file their own feedback"
  on public.feedback for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- §2. Grants — explicit revoke, then INSERT on four columns
-- ---------------------------------------------------------------------------
-- The revoke is explicit rather than relied upon as a default, for `078`'s
-- reason: this project carries `alter default privileges in schema public grant
-- all on tables to anon, authenticated`, so a freshly created table arrives
-- FULLY GRANTED and this line is what takes it away. Without it the column list
-- below would be belt against no braces at all, and `select` would work.
revoke all on public.feedback from anon, authenticated;

-- Four columns, and the two the client must not name — `id` and `created_at` —
-- are absent. A column-level grant is the enforcement; the action's explicit
-- payload is the belt.
grant insert (user_id, body, app_version, route) on public.feedback to authenticated;

-- `service_role` keeps Supabase's default grants, unlike `078`, and the
-- difference is the credential rather than the table. `078` revoked them
-- because a push token is a credential and the one service-role key in this
-- project (supabase/functions/delete-account/) had no business reaching it.
-- Feedback is not a credential, that function does not read this table, and
-- whoever builds the reading story may well want a function that does — so
-- there is nothing here for a revoke to protect, and revoking would read as a
-- rule that had one.

-- ---------------------------------------------------------------------------
-- §3. The participation gate — the fourteenth trigger
-- ---------------------------------------------------------------------------
-- A rider who has not accepted the terms has no business writing rows, and
-- feedback is a content write like any other (`023`).
--
-- **`when (current_user = 'authenticated')` IS correct here**, unlike `036`'s
-- fan-outs where it is a trap. The distinction is `023`'s own: this is a rule
-- about what RIDERS may write, so it must not refuse the app's own accessors, a
-- seed or a repair statement. A fan-out is the opposite — it must fire for
-- every writer — which is why `036` §7 carries a trap warning about copying
-- exactly this clause.
--
-- Nothing here can be enforced from inside a `security definer` RPC, which is
-- why the write is a plain client INSERT rather than a function: inside a
-- definer body `current_user` is the owner, so this trigger could never fire
-- (`078` §9 asserts that absence for `push_devices` for the same reason).
drop trigger if exists enforce_participation_gate on public.feedback;
create trigger enforce_participation_gate
  before insert on public.feedback
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- The function comment carries the count, because CLAUDE.md's own number is not
-- reachable from the database and `list_tables` does not show a trigger. `081`
-- set it to thirteen; this file makes it fourteen.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, fourteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081), the fourteenth feedback (084); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ---------------------------------------------------------------------------
-- §4. Indexes
-- ---------------------------------------------------------------------------
-- Newest first, which is the only order anyone will ever read this table in —
-- including the dashboard query that is the reading story today. One index on a
-- table with no client reader is cheap; the alternative is a sequential scan
-- growing without bound.
create index feedback_created_at_idx
  on public.feedback (created_at desc);

-- **The FK index, and it is required rather than an optimisation.** `029`'s
-- derived assertion refuses any foreign key into `profiles` with no
-- leading-column index behind it, because that is what makes an account
-- deletion's cascade a lookup rather than a scan of every table that references
-- a rider. A composite `(user_id, created_at)` would satisfy it too; a bare
-- `user_id` is what the cascade actually uses, and nothing reads this table per
-- rider.
create index feedback_user_id_idx
  on public.feedback (user_id);

-- ---------------------------------------------------------------------------
-- §5. Verification — run against the project after applying
-- ---------------------------------------------------------------------------
--   -- f, f, f, f — and the INSERT one is false BY DESIGN: the grant is on four
--   -- columns, and a column-level grant does not satisfy a table-level check.
--   -- Scoped to the grantee, because the unscoped `information_schema` count
--   -- reads high against a correct database — postgres and service_role hold
--   -- everything by Supabase default (015's footer got this wrong once).
--   select has_table_privilege('authenticated', 'public.feedback', 'select'),
--          has_table_privilege('authenticated', 'public.feedback', 'insert'),
--          has_table_privilege('authenticated', 'public.feedback', 'update'),
--          has_table_privilege('authenticated', 'public.feedback', 'delete');
--
--   -- t — the column-level half of the pair above, and the one that says the
--   -- table is writable at all.
--   select has_any_column_privilege('authenticated', 'public.feedback', 'insert');
--
--   -- f, f — anon reaches nothing at all
--   select has_table_privilege('anon', 'public.feedback', 'select'),
--          has_table_privilege('anon', 'public.feedback', 'insert');
--
--   -- t, f — the two columns the client may not name
--   select has_column_privilege('authenticated', 'public.feedback', 'body', 'INSERT'),
--          has_column_privilege('authenticated', 'public.feedback', 'created_at', 'INSERT');
--
--   -- 1, and its cmd is INSERT. NOT zero policies: `rls_enabled_no_policy`
--   -- fires only when a table has none at all, so this table does NOT add a
--   -- third INFO advisor beside password_reset_grants and push_devices.
--   select count(*), min(cmd) from pg_policies where tablename = 'feedback';
--
--   -- 14 — 081's thirteen plus this one. Count it rather than read it off a
--   -- comment; a table added without one looks exactly like the list being
--   -- right.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
