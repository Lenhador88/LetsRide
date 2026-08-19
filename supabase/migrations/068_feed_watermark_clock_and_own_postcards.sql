-- 068: the feed watermark gets the server's clock, and stops badging a rider
--      for their own postcard.
--
-- Linear PD-253. Two defects, both in 015, both named by 061 and neither fixed
-- there — 061 §3 records the first ("that is this defect, shipped") and 061 §4
-- the second ("a candidate defect in 015, recorded here and not fixed here").
-- This file is the fix 061 said it was not.
--
-- Nothing about the SHAPE of 015 changes: `feed_reads` is still a per-audience
-- watermark, still bounded by membership rather than by content, and
-- `club_unread_counts()` is still SECURITY INVOKER so RLS decides what it
-- counts. No column is added, no policy is rewritten, no grant moves.

-- ---------------------------------------------------------------------------
-- §1. The clock — both sides of the comparison must come from one
-- ---------------------------------------------------------------------------
--
-- `markClubSeen` and `markFeedSeen` both send `new Date().toISOString()` into
-- `feed_reads.last_seen_at`. §2 compares that value against
-- `postcards.created_at` and `rides.created_at`, and both of those are
-- server-generated: 044 withholds the INSERT grant on `postcards.created_at`
-- and 045 does the same for `rides.created_at`, precisely so that a device
-- clock can never order the feed.
--
-- **The argument is not tamper-resistance**, and writing it that way is how the
-- next session decides the fix is optional. A rider who forges their own
-- watermark suppresses their own badge, which is self-harm and nobody else's
-- problem. It is that a comparison with one clock on each side is wrong in a way
-- nothing logs: a handset running ten minutes fast silently marks read every
-- postcard and every ride arriving in the next ten minutes, and a slow one
-- re-lights a badge over content already seen. Nothing errors, nothing appears
-- in a log, and the wrong answer follows the DEVICE rather than the account —
-- so it does not reproduce for anyone trying to investigate it.
--
-- 061 §3 made this exact argument for `ride_reads.last_read_at` and imposed the
-- value with a BEFORE INSERT OR UPDATE trigger. The mechanism transfers whole;
-- what follows is why each of the alternatives is not the tool, because each one
-- looks like it would work.
--
-- **A DEFAULT cannot do this job.** `feed_reads.last_seen_at` already carries
-- `default now()` from 015 and the defect shipped anyway: a default applies only
-- when the column is OMITTED, and both callers name it. This is the trap worth
-- naming first, because the column already looks defended.
--
-- **Withholding the column grant — 044/045's mechanism — is not it either, and
-- the obvious reason for that is FALSE.** It is tempting to write "the upsert's
-- UPDATE arm names `last_seen_at`, so revoking the grant would fail 42501". It
-- would not: PostgREST builds `on conflict … do update set` over the columns
-- present in the request BODY, so a client that omits the column needs no
-- privilege on it and nothing raises. 061 §3 already refused that sentence and
-- it is refused again here rather than inherited.
--
-- The real reason is narrower, and it is the same one: what ADVANCES the value
-- on the UPDATE arm is this trigger, and what makes the statement reach the
-- trigger at all is PostgREST's SET-list construction — an external tool's
-- behaviour, not a database guarantee, and one the RLS suite cannot observe
-- because it speaks SQL rather than HTTP.
--
-- **Which is why `markClubSeen` and `markFeedSeen` keep SENDING the column.**
-- That is the half of this change most likely to be "tidied" later, so it is
-- written down in both places: the client's value is discarded, and the client
-- sends it anyway so that `last_seen_at` is in the request body, therefore in
-- PostgREST's `do update set` list, therefore in a statement that reaches this
-- trigger on every visit after the first. Dropping it from the body would leave
-- an ON CONFLICT arm whose SET list is the two key columns and nothing else —
-- which the database would still stamp, but only if PostgREST emits a DO UPDATE
-- at all for such a payload. Nothing in this repo can gate that behaviour, and
-- a watermark that silently stops advancing looks exactly like a badge that
-- will not clear. The two visible mechanisms are the body and the trigger;
-- neither is inferred.
--
-- **Both arms, not just INSERT.** A BEFORE INSERT trigger alone would impose the
-- value on a rider's first visit to an audience and keep the client's on every
-- visit after — which is the worst of the three available behaviours, because it
-- works on fresh rows and drifts in use, and an INSERT-only assertion passes
-- against it.
--
-- ---------------------------------------------------------------------------
-- What this does NOT fix, stated rather than implied
-- ---------------------------------------------------------------------------
-- **A watermark already written from a skewed clock is not repaired by this
-- trigger, and no backfill could repair it.** The value on disk is the only
-- record of what that handset believed; the instant the rider actually looked at
-- the screen was never recorded anywhere, by anything, so there is nothing to
-- restore it from. A row reading ten minutes into the future is
-- indistinguishable from a rider who genuinely looked ten minutes from now,
-- which no query can rule out.
--
-- The fix is therefore forward-only: every write from the moment this applies is
-- server-stamped, and every row already on disk keeps whatever the phone said
-- until the rider's next visit overwrites it. That is a real window — a badge
-- suppressed or re-lit for one rider on one audience — and it closes on their
-- next visit rather than on a deploy. It is the reason not to write a backfill,
-- not an excuse for not writing one: a backfill would have to invent the missing
-- instant, and an invented timestamp is the same defect with a server's name on
-- it.

create function public.stamp_feed_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

comment on function public.stamp_feed_read() is
  'Imposes feed_reads.last_seen_at from the server clock on INSERT and UPDATE (068). Not tamper-resistance — it is that the value is compared against postcards.created_at and rides.created_at, which 044 and 045 make server-generated, and a comparison spanning two clocks is wrong in a way nothing logs. Mirrors 061''s stamp_ride_read.';

-- `security invoker` (the default): it reads nothing and writes nothing but NEW,
-- so it needs no elevated rights, and an invoker function raises no
-- `authenticated_security_definer_function_executable` advisor — the count in
-- CLAUDE.md's advisor table must read the same after this migration as before
-- it. EXECUTE is revoked anyway, matching `public.stamp_ride_read()` and
-- `public.enforce_participation_gate()`: Postgres checks EXECUTE on a trigger
-- function at CREATE TRIGGER time rather than at fire time, which is what makes
-- that revoke free rather than breaking.
revoke all on function public.stamp_feed_read() from public, anon, authenticated;

create trigger stamp_feed_read
  before insert or update on public.feed_reads
  for each row
  execute function public.stamp_feed_read();

-- Not a participation-gate trigger, and the gate's count must be unchanged by
-- this file — 023's own reason for excluding `feed_reads` is that a watermark
-- produces nothing anyone sees. Ten at the time of writing:
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;

-- ---------------------------------------------------------------------------
-- §2. Your own postcard does not badge your own club
-- ---------------------------------------------------------------------------
--
-- 015 §4 counts every postcard in the club newer than the watermark, the
-- reader's own included. A postcard is authored from `/postcards/new` rather
-- than from inside a club, so the rider posts, lands back on a list, and the
-- club they just posted to is wearing a badge for the thing they wrote. There is
-- no race to win and no navigation to lose: it is reachable every time.
--
-- 061 §4 carries `author_id <> auth.uid()` on `ride_has_unread` for exactly this
-- reason and names the divergence as a candidate defect here. This is that arm,
-- transferred.
--
-- **Where the predicate sits is load-bearing.** It is inside the capped
-- subquery, above the `limit 100`, so the cap counts qualifying rows rather than
-- rows-then-filter — outside it, a rider who posted the last hundred postcards
-- in a club would cap the count at 100 and then subtract their way to zero,
-- which reads as "the badge is broken" rather than as a cap.
--
-- What that costs, stated because 015's own comment claims O(1): the cap bounds
-- the COUNT at 100 qualifying rows, and the scan now also skips however many of
-- the caller's own postcards it passes on the way. A rider who is the only
-- author in a busy club walks the whole club's index range to return zero. That
-- is bounded by one rider's own output in one club, it reads through
-- `postcards_club_id_idx (club_id, created_at desc)` that 009 created, and the
-- alternative — a partial index on `(club_id, created_at, author_id)` — would be
-- an index built for a badge nobody has measured as slow.
--
-- ---------------------------------------------------------------------------
-- The rides arm is NOT given the same exclusion, and that is a decision
-- ---------------------------------------------------------------------------
-- `rides.organizer_id <> auth.uid()` would be the symmetric change, one line
-- away, and it is deliberately not made here. PD-253 names the postcard arm and
-- only the postcard arm, and the two are not obviously the same rule: creating a
-- ride in a club is the one act in this app that FANS OUT (055 notifies the
-- crew, 060 pins who may be notified), so "the organizer's own ride briefly
-- badges their own club" may well be wanted — it is the same row the rest of the
-- club is being badged for. Deciding that silently, inside a migration whose
-- story does not mention it, is how a product rule gets set by a diff.
--
-- Recorded here rather than fixed here, in 061 §4's own words and for its own
-- reason: the next session that wants it has the line, and the reason it was not
-- taken is on the record instead of being re-derived as an oversight.
--
-- Reproduced whole from 015 §4; every comment carried across, and the two
-- deliberately kept because they are still the reason the code is shaped this
-- way.

create or replace function public.club_unread_counts()
returns table (club_id uuid, unread integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with watermarks as (
    select
      m.club_id as cid,
      coalesce(r.last_seen_at, m.joined_at) as since
    from public.club_members m
    left join public.feed_reads r
      on r.user_id = m.user_id
     and r.club_id = m.club_id
    where m.user_id = auth.uid()
  )
  select
    w.cid,
    (
      select count(*)::integer
      from (
        select 1
        from public.postcards p
        where p.club_id = w.cid
          and p.created_at > w.since
          and p.author_id <> auth.uid()
        limit 100
      ) capped_postcards
    )
    +
    (
      select count(*)::integer
      from (
        select 1
        from public.rides d
        where d.club_id = w.cid
          and d.created_at > w.since
        limit 100
      ) capped_rides
    )
  from watermarks w
$$;

comment on function public.club_unread_counts() is
  'Unread activity per joined club — new postcards plus new rides since the rider''s watermark, or since they joined. SECURITY INVOKER, so RLS decides what counts. Excludes the reader''s own postcards (068); the rides arm deliberately does not exclude the reader''s own rides — see 068 §2.';

-- ---------------------------------------------------------------------------
-- §3. Grants
-- ---------------------------------------------------------------------------
--
-- Nothing moves. `create or replace function` preserves the ACL, so 015's
-- `grant execute … to authenticated` and its revoke from `public, anon` still
-- stand — which is asserted below rather than assumed, because "preserved" is a
-- property of the statement rather than of anything visible in this file.
--
-- The table's grants are untouched too, and deliberately: `authenticated` keeps
-- table-level UPDATE, including on `last_seen_at`. §1 says why — the column must
-- be nameable for the upsert's body to carry it, and the trigger is what makes
-- the value true.

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 3 — the trigger is BEFORE and fires on both arms. `tgtype` bit 2 is
-- BEFORE, bit 4 INSERT, bit 16 UPDATE.
--   select (tgtype & 4 > 0)::int + (tgtype & 16 > 0)::int + (tgtype & 2 > 0)::int
--     from pg_trigger where tgname = 'stamp_feed_read' and not tgisinternal;
--
-- Expected: f — the trigger function needs no elevated rights
--   select prosecdef from pg_proc where proname = 'stamp_feed_read';
--
-- Expected: f — the counter is still INVOKER, so blocks and hides still apply
--   select prosecdef from pg_proc where proname = 'club_unread_counts';
--
-- Expected: t then f — the replace preserved 015's grants
--   select has_function_privilege('authenticated', 'public.club_unread_counts()', 'execute'),
--          has_function_privilege('anon', 'public.club_unread_counts()', 'execute');
--
-- Expected: t — the upsert's UPDATE arm still needs it, per §1
--   select has_table_privilege('authenticated', 'public.feed_reads', 'update');
--
-- Expected: f — still no way to reset a watermark. Scoped to the grantee: the
-- unscoped form reads 2 against a correct database, which is the mistake 015's
-- own footer made.
--   select has_table_privilege('authenticated', 'public.feed_reads', 'delete');
--
-- Expected: unchanged — feed_reads does not join the participation gate. Ten at
-- the time of writing.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- Expected: the same 10 advisors as before, with auth_leaked_password_protection
-- still the only outstanding one. An eleventh means the revoke above did not
-- land, or the trigger function was written `definer`.
--   mcp__Supabase__get_advisors  type=security
--
-- And the one the database cannot answer on its own: a real round trip through
-- PostgREST proving the UPDATE arm still advances the watermark. It is not in
-- the RLS suite because the suite speaks SQL rather than HTTP — see §1.
