-- 078: push_devices — a table nobody may read. PD-301, child A of PD-291.
--
-- One row per app installation that has been handed a provider push token.
-- Additive and inert: nothing reads this table until `079` (child C) brings the
-- delivery path, and no client role can reach it in any way at any point.
--
-- ---------------------------------------------------------------------------
-- §1  The unique key is the INSTALLATION, and both alternatives leak
-- ---------------------------------------------------------------------------
-- `unique (installation_id)`. The provider token is a MUTABLE ATTRIBUTE of that
-- row and is part of no unique key. Design D3 is the argument; both rejected
-- shapes are restated here in D3's own words, because the parent issue's
-- wording asks for a different column list and this is where a future reader
-- will look for the reason it was not built:
--
--   unique (token)             -- rotation forks the device into two rows;
--                                 sign-out releases one
--   unique (user_id, token)    -- forks on a shared phone, from the first
--                                 sign-in, with no rotation needed
--
-- Walked out, because "forks into two rows" understates it. Under
-- `unique (token)`: rider A's device rotates T1 -> T2, so both rows are live and
-- owned by A. A signs out; a release naming the token the device currently
-- presents takes T2 and LEAVES T1. Rider B signs in; cold-start re-registration
-- re-homes T2 and cannot see T1. A's next like renders on B's lock screen —
-- with every RLS policy in this schema working exactly as designed — and the
-- window is not "until the next cold start" but up to the 60-day idle sweep.
--
-- `unique (user_id, token)` fails the same way faster: both rows are live from
-- the first sign-in on a shared phone, no rotation required.
--
-- `unique (installation_id)` is the only shape under which a release, a re-home
-- and a rotation each address exactly one row. Three properties follow, and
-- each closes one limb of the failure above:
--
--   * Rotation is an UPDATE, not an INSERT. One row per install, for the life
--     of the install, so a device can never be two rows and a release can never
--     be partial. `rls_test.sql` §078.4 asserts the row's `id` is unchanged
--     across a rotation, which is the assertion that would have caught the
--     first version of this decision — the shared-phone case passes under a
--     token-keyed table too, and only that one fails.
--   * Sign-out and cold-start re-homing are TOTAL. Both address the
--     installation, so whatever tokens that install has ever presented go
--     with it.
--   * Re-homing needs the installation id, which never leaves the device it
--     names. Unlike a token it is not handed to the app by an outside party and
--     not carried anywhere by a departing rider. The residual is stated rather
--     than claimed closed: a party who exfiltrated one could re-home that device
--     once, and what they gain is THEIR OWN notifications delivered to a phone
--     they do not hold, plus denial of push to whoever does. That is self-harm
--     plus a nuisance, not a disclosure — and §2's absent SELECT grant is what
--     keeps it that way.
--
-- ---------------------------------------------------------------------------
-- §2  Nobody reads a device token. Not the owner, not the app, not a club owner
-- ---------------------------------------------------------------------------
-- `authenticated` and `anon` hold NO privilege of any kind, and RLS is enabled
-- with NO POLICY AT ALL — `026`'s `password_reset_grants` shape. This is
-- stricter than every other table in this schema, `notifications` included:
-- that one is at least readable by its recipient.
--
-- The reason is that a device token is not a record ABOUT a rider, it is a
-- BEARER CREDENTIAL FOR A CHANNEL THAT REACHES THEIR LOCK SCREEN. Anything that
-- can read it can silence them, and under §3's registration rule it can also
-- steal their device's registration.
--
-- The absent SELECT grant and §3's re-homing RPC are ONE DECISION, not two.
-- The RPC is safe to expose precisely because no client can enumerate
-- installation ids; grant own-row SELECT later and §1's residual stops being
-- self-harm.
--
-- ** WHEN A "YOUR DEVICES" SCREEN IS EVENTUALLY WANTED, IT IS AN OWN-ROW
-- `security definer` RPC RETURNING `platform` AND `last_seen_at`, AND NEVER A
-- SELECT GRANT ON THIS TABLE. ** That sentence is written here so the screen
-- does not arrive as a grant.
--
-- The `rls_enabled_no_policy` INFO advisor this produces is CORRECT BY DESIGN
-- and belongs in `CLAUDE.md`'s expected-advisor table, because an advisor that
-- is expected but undocumented is indistinguishable from a new one.
--
-- ---------------------------------------------------------------------------
-- §3  Why registration is an RPC and not a client write
-- ---------------------------------------------------------------------------
-- A client upsert cannot express this and FAILS CLOSED. With an
-- `installation_id` conflict target and an own-row policy, the second rider's
-- `on conflict do update` meets a row their policy does not return — so it
-- writes nothing or raises `23505`, and either way the device is not re-homed
-- and the previous rider's pushes keep arriving. Failing closed is the wrong
-- direction for this one write.
--
-- So both entry points are `security definer`, take NO user id, derive their
-- subject from `auth.uid()` and nothing else — `moderate_comment`'s shape and
-- `delete-account`'s second rule — with `search_path` pinned, every name
-- schema-qualified, EXECUTE revoked from `public` and `anon`, and granted to
-- `authenticated` alone.
--
-- ---------------------------------------------------------------------------
-- §4  NO `enforce_participation_gate` TRIGGER ON THIS TABLE. Deliberate (D13)
-- ---------------------------------------------------------------------------
-- The instinct is to make `push_devices` the twelfth gated table. It must not
-- be, and putting one here would be WORSE than leaving it off, for a mechanical
-- reason:
--
--   Every one of the existing eleven triggers carries
--   `for each row when (current_user = 'authenticated')`. Inside a
--   `security definer` function `current_user` is the OWNER. This table is
--   written ONLY by `security definer` RPCs. So the trigger would never fire,
--   on any write, ever — while still appearing in
--   `select count(*) from pg_trigger where tgname = 'enforce_participation_gate'
--    and not tgisinternal`, making the count read twelve and the gate's
--   coverage read COMPLETE when it is not.
--
-- That is precisely the failure `CLAUDE.md` warns about — "a table added
-- without one looks exactly like this list being right" — arriving from the
-- opposite direction: a table added WITH one that does nothing. A gate that
-- cannot fire is worse than an absent one, because an absent one is visible.
--
-- The gate is therefore restated INSIDE `register_push_device`, as `CLAUDE.md`
-- requires of the three own-row RPCs that own the profile stamps: "Each
-- restates the invariants its triggers carry, and must." It raises
-- `check_violation`, so the client sees the same `23514` every other gated
-- write raises and no caller needs a second branch.
--
-- `release_push_device` is NOT gated, in any account state. Refusing a release
-- is refusing to stop sending someone push.
--
-- `rls_test.sql` §078.9 asserts the trigger's ABSENCE, so adding one later is a
-- red test rather than a silent no-op.
--
-- ---------------------------------------------------------------------------
-- §5  Retention and reach, decided here rather than retrofitted
-- ---------------------------------------------------------------------------
-- RETENTION — a device row is removed by exactly four mechanisms and by
-- nothing else:
--
--   1. `release_push_device(installation_id)` on sign-out;
--   2. `on delete cascade` from `profiles`, so account deletion takes every
--      device with no one having to remember this table exists;
--   3. a provider reporting the token permanently invalid — APNs `410
--      Unregistered` or `403 BadDeviceToken`, FCM `UNREGISTERED` or
--      `INVALID_ARGUMENT` — deleted immediately;
--   4. ** 60 days with no successful delivery and no re-registration **,
--      measured on the server-owned `last_seen_at`.
--
-- Mechanisms 3 and 4 need the delivery path and its schedule, which is `079`
-- (child C). ** Stated plainly rather than left to be discovered: until `079`
-- applies and its job is scheduled, 1 and 2 are the only two that run. ** That
-- is the honest position for an additive migration that cannot carry a
-- scheduler — `026` recorded the same kind of limit for the same kind of
-- reason — and it is bounded by the fact that nothing sends to these tokens
-- until `079` exists either.
--
-- A transport failure — 5xx, timeout, 429 — NEVER deletes a token. Deleting
-- live tokens on a provider outage silently unsubscribes every rider at once
-- and nothing would report it. That rule belongs to `079`; it is written here
-- because this is the file that defines what the four mechanisms are.
--
-- REACH — `user_id references public.profiles(id) on delete cascade`, and
-- `profiles.id references auth.users(id) on delete cascade` behind it, so the
-- deletion path reaches this table on the day it runs. The RLS suite asserts it
-- beside the existing `029` cascade assertions rather than in a section of its
-- own.
--
-- OFFLINE — the client-generated identifier this table needs is
-- `installation_id`, and it is the CONFLICT TARGET, which is exactly what makes
-- a replayed registration idempotent rather than a duplicate. `id` is
-- server-generated because no client ever names it. There is no `updated_at`
-- and the omission is deliberate: `last_seen_at` is that column under the name
-- that says what it measures, and nothing here is client-editable — the only
-- writers are the two functions below.
--
-- ---------------------------------------------------------------------------
-- §6  A plpgsql trap, measured rather than recalled
-- ---------------------------------------------------------------------------
-- The RPC parameter names are the WIRE CONTRACT — supabase-js passes named
-- arguments — so they are `installation_id`, `token` and `platform` rather than
-- this repo's usual `p_` prefix. Every one of those is also a column on this
-- table, and `on conflict (installation_id)` inside plpgsql therefore raises:
--
--   ERROR:  column reference "installation_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Measured on Postgres 16, 2026-08-25. It is a RUNTIME error, not a creation
-- error, so the function creates cleanly and fails on its first real call.
-- `on conflict on constraint push_devices_installation_id_key` names a
-- constraint rather than a column expression and is substitution-free, so it
-- is what the function below uses. Every parameter is referenced
-- function-qualified and every column alias-qualified, with
-- `#variable_conflict error` making that guarantee local to each function
-- rather than dependent on a cluster GUC (`043`'s reasoning, unchanged).

-- ---------------------------------------------------------------------------
-- §7  The table
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id uuid default uuid_generate_v4() primary key,

  -- Cascade: account deletion takes every device. See §5 REACH.
  user_id uuid references public.profiles(id) on delete cascade not null,

  -- Generated once on the device into the secure store that already holds the
  -- refresh token, so its lifetime is exactly "this install on this device".
  -- The unique key, and the only stable name a device has — see §1.
  installation_id text not null,

  -- A mutable attribute of the installation. NOT part of any unique key, and
  -- adding one is the change §1 exists to prevent.
  token text not null,

  platform text not null,

  created_at timestamptz default now() not null,

  -- Server-owned, and here that follows trivially from the absent grants rather
  -- than from a trigger: no client role can name this column in any statement,
  -- because no client role holds any privilege on this table at all. Stated
  -- rather than left as an accident of the table's shape (§2). Advanced by a
  -- re-registration and, from `079`, by each successful delivery — so the
  -- 60-day window measures DEVICE REACHABILITY, not app usage, and a rider on a
  -- three-week holiday is not silently unsubscribed.
  last_seen_at timestamptz default now() not null,

  constraint push_devices_installation_id_key unique (installation_id),

  constraint push_devices_platform_check check (platform in ('ios', 'android')),

  -- Bounds rather than validation. `018`'s rule is that no integrity rule may
  -- live only in a Zod schema; these are deliberately generous, because a
  -- refused registration is a rider who silently gets no push. An FCM
  -- registration token has no documented maximum and observed lengths run past
  -- 300 characters, so 4096 is a sanity ceiling on an unbounded client string
  -- and not a format claim.
  constraint push_devices_installation_id_shape
    check (length(installation_id) between 1 and 100),
  constraint push_devices_token_shape
    check (length(token) between 1 and 4096)
);

alter table public.push_devices enable row level security;

-- ---------------------------------------------------------------------------
-- §8  RLS on, and DELIBERATELY NO POLICY. Do not add one.
-- ---------------------------------------------------------------------------
-- The intended access is NONE. RLS is enabled so that the absence of policies
-- DENIES rather than allows, and the two functions below reach the table by
-- running as the owner, for whom policies do not apply.
--
-- ** A policy here would describe direct access that must not exist. ** If you
-- arrived at this file because something cannot read `push_devices`, that is
-- the design and not the defect — read §2, then write an own-row RPC. The
-- assertions in `rls_test.sql` §078.2 fail if a policy appears.
--
-- The revoke is EXPLICIT rather than relied upon as a default, because it is
-- not one: Supabase's project default is
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated`, which the test harness reproduces, so a new table arrives
-- fully granted and this line is what takes it away.
revoke all on public.push_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- §9  The index
-- ---------------------------------------------------------------------------
-- `user_id` leads, which is what the cascade from `profiles` needs — an
-- unindexed cascade FK is a sequential scan per departing rider, under a lock
-- (`029` §A asserts that no FK into `profiles` lacks a leading-column index,
-- and this table is now inside that derivation). `last_seen_at` follows so the
-- same index serves the ten-installation trim below, which reads one rider's
-- rows in that order.
create index push_devices_user_id_last_seen_at_idx
  on public.push_devices (user_id, last_seen_at desc);

comment on table public.push_devices is
  'One row per app installation holding a provider push token (078, PD-301). ** NOBODY MAY READ IT, INCLUDING THE RIDER IT BELONGS TO ** — `anon` and `authenticated` hold no privilege of any kind, RLS is on and there are no policies, because a device token is a bearer credential for a channel that reaches a lock screen rather than a record about a rider. Written only by register_push_device() and release_push_device(), both security definer and both subject to auth.uid() alone. Keyed `unique (installation_id)`, never on the token, which rotates — see the migration header §1. A row dies in exactly four ways: a release on sign-out; the cascade from profiles on account deletion; a provider reporting the token permanently invalid; or 60 days with no successful delivery and no re-registration. The last two arrive with 079.';

comment on column public.push_devices.installation_id is
  'The unique key. Generated once on the device with crypto.randomUUID() into the secure store that already holds the refresh token, so its lifetime is exactly this install on this device. It is also the idempotency key for a replayed registration.';

comment on column public.push_devices.token is
  'The APNs or FCM token. A MUTABLE ATTRIBUTE of the installation and part of no unique key: keying on it forks a device into two rows on rotation, and the orphaned row then delivers the previous rider''s notifications to whoever holds the phone next. Migration header §1.';

comment on column public.push_devices.last_seen_at is
  'Server-owned, and unwritable by any client because no client holds a grant on this table. Advanced by a re-registration and, from 079, by each successful delivery — so the 60-day retention window measures device reachability rather than app usage.';

comment on column public.push_devices.created_at is
  'When this installation first registered. Never advanced by a rotation or a re-home, which are both UPDATEs to an existing row — the RLS suite uses that to prove a rotation is not a fork.';

-- ---------------------------------------------------------------------------
-- §10  register_push_device — the only path by which a row is created
-- ---------------------------------------------------------------------------
-- Takes no user id and cannot be asked about anyone but its caller. Upserts on
-- the installation, which is what makes a re-home total (§1) and a replayed
-- offline write idempotent (§5).
create or replace function public.register_push_device(
  installation_id text,
  token text,
  platform text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'register_push_device requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- §4: the gate, restated here because a trigger carrying the standard
  -- `when (current_user = 'authenticated')` clause could never fire on this
  -- table. Same errcode as the trigger raises, so a client needs one branch.
  if not private.may_participate() then
    raise exception
      'complete onboarding and accept the terms before registering a device for push'
      using errcode = 'check_violation';
  end if;

  -- `on constraint`, not `(installation_id)` — see §6. Every one of the three
  -- parameters shares a name with a column here.
  insert into public.push_devices as d (user_id, installation_id, token, platform)
  values (v_uid,
          register_push_device.installation_id,
          register_push_device.token,
          register_push_device.platform)
  on conflict on constraint push_devices_installation_id_key do update
     set user_id      = excluded.user_id,
         token        = excluded.token,
         platform     = excluded.platform,
         last_seen_at = now();

  -- The cap, enforced here because a CHECK cannot count siblings. An uncapped
  -- rider is an unbounded delivery multiplier: every notification they receive
  -- becomes one provider call per row they have accumulated.
  --
  -- Ordered by `last_seen_at desc, id desc`. The tiebreak is arbitrary but
  -- TOTAL, which is the property that matters — `now()` is transaction time, so
  -- two registrations inside one transaction share a `last_seen_at` and
  -- something has to decide. In production they never do.
  delete from public.push_devices d
   where d.user_id = v_uid
     and d.id not in (
       select keep.id
         from public.push_devices keep
        where keep.user_id = v_uid
        order by keep.last_seen_at desc, keep.id desc
        limit 10
     );
end;
$$;

revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

comment on function public.register_push_device(text, text, text) is
  'Records or re-homes the CALLER''s device token, keyed on the installation id. Takes no user id — the subject is auth.uid() and nothing else. Refuses a caller who has not completed onboarding and accepted the terms with 23514 (the participation gate, restated here because a trigger could not fire on this table). Trims the caller to their ten most recently seen installations. Call it on EVERY cold start with a session, not only on first grant: that unconditional re-registration is what repairs a sign-out release that could not run.';

-- ---------------------------------------------------------------------------
-- §11  release_push_device — one device, one row, never gated
-- ---------------------------------------------------------------------------
-- Deliberately NOT "clear every row for auth.uid()". That alternative closes
-- the same hole and breaks a real case: a rider with a phone and a tablet who
-- signs out of one would be silently unsubscribed on the other.
create or replace function public.release_push_device(installation_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'release_push_device requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- No participation gate (§4). Scoped to the caller's own row, so a rider who
  -- signs out of a device that has since been re-homed to somebody else
  -- removes nothing — which is the correct answer.
  delete from public.push_devices d
   where d.user_id = v_uid
     and d.installation_id = release_push_device.installation_id;
end;
$$;

revoke all on function public.release_push_device(text) from public, anon;
grant execute on function public.release_push_device(text) to authenticated;

comment on function public.release_push_device(text) is
  'Removes the CALLER''s row for one installation. Never gated on participation — refusing a release is refusing to stop sending someone push. Called by signOut() BEFORE supabase.auth.signOut(), because it needs a live session; its failure must not block sign-out, which leaves a window lasting until the device is next opened with a session, closed by register_push_device() on cold start.';

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 0 — no policies at all. §8, and adding one is the repair to refuse.
--   select count(*) from pg_policies where tablename = 'push_devices';
--
-- Expected: t — RLS is on, so the absence of policies denies rather than allows
--   select relrowsecurity from pg_class where oid = 'public.push_devices'::regclass;
--
-- Expected: f, f, f, f — scoped to the grantee on purpose. The unscoped form
-- always returns rows, because postgres owns the table and service_role is
-- granted everything by Supabase default (015's footer got this wrong once).
--   select has_table_privilege('authenticated', 'public.push_devices', p)
--     from unnest(array['select','insert','update','delete']) p;
--
-- Expected: 0 — anon holds nothing
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'push_devices' and grantee = 'anon';
--
-- Expected: 0 — §4. Adding one raises the gate's coverage count while firing on
-- nothing.
--   select count(*) from pg_trigger where tgrelid = 'public.push_devices'::regclass
--     and tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- Expected: 11 — unchanged by this migration, for the same reason
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- Expected: t, t — both entry points are DEFINER
--   select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('register_push_device', 'release_push_device')
--    order by p.proname;
--
-- Expected: {search_path=""} on both — stored with the quotes, and an assertion
-- matching the unquoted form reads 0 and passes as "unpinned". A definer
-- function with a mutable search_path is the advisor finding this migration
-- must not add.
--   select proname, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('register_push_device', 'release_push_device');
--
-- Expected: f, f and t, t — anon cannot call either, authenticated can call both
--   select has_function_privilege('anon', 'public.register_push_device(text,text,text)', 'execute'),
--          has_function_privilege('anon', 'public.release_push_device(text)', 'execute'),
--          has_function_privilege('authenticated', 'public.register_push_device(text,text,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.release_push_device(text)', 'execute');
--
-- ---------------------------------------------------------------------------
-- The advisor sweep, and what to expect from it
-- ---------------------------------------------------------------------------
-- `rls_enabled_no_policy` (INFO) on `push_devices` is correct by design (§8)
-- and belongs in `CLAUDE.md`'s expected-advisor table beside
-- `password_reset_grants`.
--
-- ** COUNT THE `authenticated_security_definer_function_executable` WARNs
-- RATHER THAN READING A NUMBER HERE. ** That advisor fires once per
-- `security definer` function `authenticated` may execute, and this migration
-- adds two of exactly that shape — so the expected total moves, and a reader
-- who takes "one new advisor" literally will read two by-design WARNs as
-- regressions. Both are deliberate and both are narrow, which is the defence:
-- `register_push_device` writes one row for its caller and `release_push_device`
-- removes one, neither takes a user id, and neither returns anything at all —
-- so no `security definer` function added here can be asked a question about
-- another rider. `CLAUDE.md`'s table needs all three rows.
