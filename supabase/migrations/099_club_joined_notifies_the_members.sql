-- 099: `club_joined` fans out to the whole membership, not just the owner and
--      the admins.
--
-- Linear PD-368. `036` §7.6 shipped this type to `clubs.owner_id` unioned with
-- the `owner`/`admin` membership rows, and said so in its own comment —
-- "Ordinary members are NOT notified. A club with any real membership would
-- otherwise notify everyone on every join." That sentence describes the
-- decision, not a constraint; the product owner has since asked for the wider
-- set, and it is a recipient-set change with no schema impact. So this file is
-- exactly `055`'s shape one table over: one `create or replace`, one refreshed
-- comment, one re-issued revoke, and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHAT DOES NOT CHANGE, and the list is the point
-- ---------------------------------------------------------------------------
-- No DDL on any table. **No new type**, so `notifications_type_check` (14 types,
-- read off DEV 2026-09-01) and `notifications_subject_shape` are untouched — an
-- ordinary member's copy differs from an admin's at RENDER time, if it differs
-- at all, which needs no column and no fifteenth type. No policy is created or
-- dropped. No grant moves. No CHECK moves. No trigger is recreated: `create or
-- replace` keeps the function's OID and `notify_club_joined` on
-- `public.club_members` references it by OID, so the existing binding survives
-- and re-issuing the `create trigger` would be both unnecessary and an error.
--
-- The `revoke` at the foot is re-issued anyway. `create or replace` PRESERVES
-- existing privileges, so it is a no-op against a database carrying `036` —
-- which is the reason to keep it rather than to drop it: it costs nothing and it
-- makes this file correct in isolation, including on the scratch database the
-- RLS suite replays the chain onto.
--
-- ---------------------------------------------------------------------------
-- `036` §7's inherited contract, restated because this file is where it is
-- easiest to break
-- ---------------------------------------------------------------------------
--   * Fan-out stays TRIGGER-ONLY. `authenticated` holds no INSERT grant on
--     `notifications` (`036` §5), which is the outer gate; the absent INSERT
--     policy is the inner one. Widening the recipient set changes neither.
--   * `auth.uid()` APPEARS NOWHERE BELOW. The actor is `new.user_id` and the
--     candidates come from `clubs` and `club_members`. `036` trap (b): a
--     self-suppression written against `auth.uid()` is NULL in the RLS suite, in
--     psql, in `seed.sql` and inside every `security definer` writer that
--     reaches this trigger — which is not TRUE, which filters out every
--     recipient. The fan-out would write nothing in exactly the environment that
--     asserts it, and every negative assertion would pass vacuously.
--   * `private.is_club_member` IS UNUSABLE HERE, and it is the obvious wrong
--     reach for this particular change because its NAME is now the recipient
--     set. It reads `auth.uid()` internally, so it answers "is the CALLER in
--     this club" and never "is this CANDIDATE in it". A fan-out calling it
--     computes the actor's own membership once — always TRUE here, since the
--     actor just inserted their own row — and applies that one answer to every
--     candidate, making the recipient set everybody. `036` trap (c). The
--     membership arm below is therefore a direct query against
--     `public.club_members`, exactly as it already was.
--   * `security definer`, `set search_path = ''`, every name schema-qualified,
--     and the function stays in `private` so PostgREST cannot publish it and
--     `service_role` cannot reach it.
--   * NO `when` CLAUSE, and none is added: the trigger is untouched. `036` trap
--     (a) — a fan-out must fire for every writer, including `seed.sql` and the
--     THREE `security definer` functions that write `club_members` rows. Counted
--     off DEV 2026-09-01 rather than listed from memory — `select proname from
--     pg_proc where prosrc ilike '%insert into public.club_members%'` returns
--     `public.complete_onboarding` (058), `private.join_club_from_request` (085)
--     and `private.join_club_from_invite` (093). `accept_club_invite` and
--     `claim_club_invite_link` are PUBLIC WRAPPERS that delegate to the last of
--     those, which is why counting the RPCs a rider calls gives a bigger and
--     wrong number. A `when (current_user = 'authenticated')` clause copied from
--     `023`'s gate would be false inside all three, because `current_user` in a
--     definer body is the owner.
--   * `on conflict do nothing` STAYS. `notifications_event_key` is
--     `(user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)`
--     `nulls not distinct`, so leave-and-rejoin cannot stack a second row in any
--     member's list any more than it could in an admin's.
--   * INSERT only. A role change is an UPDATE and there is no trigger on it, so
--     `088`'s promote/demote still notifies nobody through this path.
--
-- ---------------------------------------------------------------------------
-- ** THE `058` DEFAULT-CLUB GUARD IS WHAT MAKES THIS SAFE AT ALL, AND IT IS THE
-- ONE PROPERTY THIS FILE MUST NOT LOSE. **
-- ---------------------------------------------------------------------------
-- `058` auto-joins EVERY rider to the club carrying `clubs.is_default` on the
-- transition into onboarding completion, and `058` §4 silenced this fan-out for
-- that club because otherwise its owner receives one `club_joined` row per
-- signup, for ever.
--
-- **Widening the recipient set turns that one-account defect into an app-wide
-- one.** Without the early return, every signup would notify every rider who has
-- ever signed up: N-1 rows per join, so O(N^2) rows in total, growing for ever,
-- addressed to people who did not ask and cannot opt out. It is `059`'s
-- app-wide-broadcast hazard arriving through the other club fan-out — and unlike
-- `059`'s, this one fires with no rider action beyond finishing the wizard.
--
-- So the guard is carried forward VERBATIM and stays FIRST in the body. An early
-- return rather than a conjunct on the recipient set, per `058` §4, so the
-- lookup happens once per join instead of once per candidate — which matters
-- more now that the candidate count is the whole roster.
--
-- `099`'s deliverable is the assertion that this still holds. It is written to
-- fail if the guard is removed, and that was verified BOTH WAYS: with the `if
-- exists ... return null` block deleted on a scratch database, the default-club
-- assertion goes red (and takes the surrounding section with it); restored, the
-- suite is green. A guard asserted only in the direction it already passes is
-- not asserted.
--
-- ---------------------------------------------------------------------------
-- THE ACTOR IS EXCLUDED AFTER THE UNION, NEVER INSIDE AN ARM
-- ---------------------------------------------------------------------------
-- `036` §7.6 pays for this lesson on THIS function and the widening does not
-- retire it — it makes it easier to get wrong, because the membership arm now
-- yields every rider rather than two roles.
--
-- A rider can qualify through BOTH arms: as `clubs.owner_id` and as their own
-- `club_members` row. That is the club-creation path — `createClub` inserts the
-- creator's own `owner` row — so filtering the actor inside the membership arm
-- only leaves them in through the owner arm, and **every club creation
-- immediately tells its creator that they joined their own club.** Filter inside
-- the owner arm only and the membership arm does the same. `036`'s existing
-- assertion "nobody is ever notified of their own action" is the tripwire, and
-- it stays true only because the exclusion sits in the outer WHERE.
--
-- ---------------------------------------------------------------------------
-- IS THE WIDENED ARM SAFE FOR THIS TYPE? — YES, PROVABLY, and `036` §7.5 is why
-- the question has to be asked PER TYPE rather than reasoned by analogy
-- ---------------------------------------------------------------------------
-- `036` §7.5 REFUSES the equivalent union for `ride_created_in_club`, and that
-- refusal is the most important line in that file: a recipient whose own SELECT
-- policy discards the row gets a notification that is unreadable from the
-- instant it is written, for ever, with nothing to raise and no count to move.
-- **A row nobody can ever read is worse than no row.** So a wider recipient set
-- is not safe-by-default; it is safe or not depending on the SUBJECT's policy.
--
-- The subject here is the CLUB, and the whole of `clubs` SELECT, read verbatim
-- from `pg_policies` on DEV (fpmrimzxadewsaiwpsel) on 2026-09-01 immediately
-- before this file was written, is:
--
--     (is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))
--
-- The third disjunct is the widened arm's own predicate. `private.is_club_member
-- (id)` is `private.is_club_member_for(auth.uid(), id)` since `060`, whose body
-- is `exists (club_members where club_id = target and user_id = candidate) or
-- exists (clubs where id = target and owner_id = candidate)`. So for every rider
-- this file newly admits — a rider holding a `club_members` row for this club —
-- the first EXISTS is TRUE by construction, the disjunct is TRUE, and their own
-- SELECT policy resolves the club.
--
-- **The recipient set is therefore a SUBSET of what the read policy admits, not
-- a guess at it.** No member can be written a row their own policy discards.
-- That is the property `036` §7.5 refuses a widening without, and here it holds
-- by construction rather than by luck.
--
-- It is also ASSERTED rather than merely argued, in three places, because this
-- derivation is exactly the kind that goes stale:
--
--   * behaviourally — §099.5 reads the row back AS each new recipient, under
--     their own `test.uid`, which is the only check that can see an unreadable
--     row at all;
--   * structurally — `060.1b` already pins `clubs` SELECT's `qual` TEXTUALLY,
--     so a block arm added there (which decision #2's own logic argues for) goes
--     red before it can produce one; and
--   * §099.9 pins the membership disjunct by name, so this file's own argument
--     fails loudly if the disjunct it rests on is the thing that moves.
--
-- **`private.can_read_club(candidate, club)` is deliberately NOT added as a
-- fourth conjunct here, and that is a judgement rather than an oversight.**
-- `060` built it and `085`'s `notify_club_join_requested` carries it over the
-- same subject, on the grounds that it "excludes nobody today" and guards the
-- day the roster admits a rider the club policy does not. That reasoning
-- applies here too and would cost one extra call per candidate. It is left out
-- because the subset argument above is exact rather than approximate — the
-- conjunct could not exclude anybody this file admits without `clubs` SELECT's
-- membership disjunct changing first, and `060.1b` already fails on exactly
-- that change. Adding it is a one-line follow-up if a reviewer prefers the
-- measured form over the argued one; it is recorded here so the next session
-- meets the fork with the reasoning rather than re-deriving it.
--
-- ---------------------------------------------------------------------------
-- THE `clubs.owner_id` ARM STAYS, EVEN THOUGH `054` MAKES AN OWNER A MEMBER
-- ---------------------------------------------------------------------------
-- `054` seeds the creator's `owner` membership row, so the owner is normally in
-- the widened arm already and the union arm looks redundant. It is not, and
-- `095` is why: `leave_owned_club` lets an owner leave their own club while
-- keeping ownership, and `club_members` DELETE is a bare `auth.uid() = user_id`
-- with no owner carve-out. Such an OWNERLESS OWNER holds no membership row and
-- would drop out of a membership-only set.
--
-- Writing them a row is safe for this type — `clubs` SELECT's SECOND disjunct is
-- `owner_id = auth.uid()`, at the top level of an OR with no membership conjunct
-- over it — which is the same asymmetry `036` §7.6 already recorded and the
-- reason `ride_created_in_club` could not have the arm before `060`. Dropping
-- the arm as redundant is the tempting tidy-up; §099.6 exercises it in isolation
-- on a club whose owner holds no membership row, so it is the assertion that
-- fails if anyone takes it.
--
-- ---------------------------------------------------------------------------
-- THERE IS NO ROLE PREDICATE, WHICH IS A DIFFERENT CHOICE FROM `055`'s
-- ---------------------------------------------------------------------------
-- `055` kept `status in ('going','maybe')` even though it was total against
-- `ride_members_status_check`, because that recipient set is "everyone Going or
-- Maybe" rather than "every row in the table". **Here the recipient set IS every
-- row**, so a role list would be a second place to edit and a second thing to
-- get wrong — `role in ('owner','admin','member')` is total against
-- `club_members_role_check` today (`CHECK (role = ANY (ARRAY['owner','admin',
-- 'member']))`, read off DEV 2026-09-01) and would silently stop being so.
--
-- **Dropping the filter widens the arm from two of three roles to all three.**
-- The guard against a fourth arriving unnoticed is therefore in the suite rather
-- than in the body: §099.8 asserts the role domain is still exactly those three
-- values, so a migration adding a `banned` or `pending` role turns this file's
-- silence into a FAILING TEST rather than a silent widening that hands a removed
-- rider every join. That is `055`'s treatment of `ride_members_status_check`,
-- with the predicate on the other side.
--
-- ---------------------------------------------------------------------------
-- VOLUME: linear per join, quadratic per club, deliberately unbounded, with a
-- NAMED TRIGGER for when that stops being acceptable
-- ---------------------------------------------------------------------------
-- **One join now writes N-1 rows inside the joining rider's own transaction**,
-- where N is the club's membership. A club that fills to N members writes about
-- N^2/2 `club_joined` rows over its life.
--
-- Measured on DEV 2026-09-01: the largest NON-DEFAULT club has **3** members, so
-- the widest join this change can currently produce writes 2 rows. The default
-- club has 6 and writes 0, per the guard above. At today's sizes this is
-- nothing.
--
-- **The number to watch is club size, not the row count.** `036` §7 already
-- accepts and measured a 500-member club fan-out on ride creation, so this sits
-- inside an envelope this schema has priced. The day a club reaches the low
-- thousands, a join becomes a thousand-row insert on a rider's critical path and
-- this wants a queue or a digest — not an index, since the reads are already
-- served by `notifications_user_created_idx`. `036` avoids unbounded fan-outs
-- everywhere else, so this is a deliberate exception with a stated trigger
-- rather than an oversight to rediscover.
--
-- Retention is unchanged and is still the cascade window: every row here dies
-- with its club, its actor or its recipient. Widening the recipient set adds no
-- personal-data category, no column and no table, so `036`'s retention statement
-- and the account-deletion reach both carry over untouched.

-- ---------------------------------------------------------------------------
-- The function
-- ---------------------------------------------------------------------------
-- Structurally identical to `055`'s `notify_ride_joined` and to its own previous
-- body: a UNION of two arms in a subquery, with BOTH the actor exclusion and the
-- block check in the outer WHERE. Only the membership arm's `where` loses a
-- line.
create or replace function private.notify_club_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 058 §4, carried forward VERBATIM and deliberately still first. Every rider
  -- joins the default club at onboarding, so a fan-out here addresses the whole
  -- signup stream — at 036's recipient set that was one account's notification
  -- list; at 099's it is every rider who has ever signed up. See the header.
  if exists (select 1 from public.clubs c
              where c.id = new.club_id
                and c.is_default) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, club_id)
  select candidates.recipient, new.user_id, 'club_joined', new.club_id
    from (
      -- Kept even though 054 makes an owner a member: 095 lets an owner LEAVE
      -- their own club, and clubs SELECT's owner_id arm means such an ownerless
      -- owner still resolves the subject. See the header.
      select c.owner_id as recipient
        from public.clubs c
       where c.id = new.club_id
      union
      -- 099: no role predicate. The recipient set is every member, so the guard
      -- against a fourth role arriving is the domain assertion at 099.8 rather
      -- than a list here that would silently stop being total.
      -- Index-served by club_members_pkey (club_id, user_id) — leading column.
      select m.user_id
        from public.club_members m
       where m.club_id = new.club_id
    ) candidates
   -- AFTER the union, never inside an arm: the club's creator qualifies through
   -- both, and filtering inside one leaves them in through the other.
   where candidates.recipient <> new.user_id
     -- Blocking, symmetric from one directional row, so one call per candidate
     -- covers both directions. The rider's own join still succeeds — a block
     -- suppresses the notification, not the action.
     and not private.is_blocked(new.user_id, candidates.recipient)
  on conflict do nothing;
  return null;
end;
$$;

-- The previous text said "notifies the club's owner and its admins", which this
-- file makes false. A database comment is the one piece of documentation no edit
-- to CLAUDE.md can reach (`028` and `033` exist because of exactly that), so it
-- changes in the same statement that makes it wrong.
comment on function private.notify_club_joined() is
  'Fan-out: a join notifies the club''s WHOLE MEMBERSHIP — every club_members row, unioned with clubs.owner_id, minus the actor and minus anyone blocked with them (099, widening 036 §7.6 from owner+admins). EXCEPT for the club carrying clubs.is_default, which still notifies NOBODY (058 §4): every rider joins that one on completing onboarding, so the widened fan-out there would be an app-wide O(N^2) broadcast. The membership arm carries NO role predicate — the set is every member — so 099.8 asserts club_members_role_check is still exactly three values. The widened arm is SAFE for this type because it is a strict subset of clubs SELECT''s third disjunct, private.is_club_member(id), so no member can be written a row their own policy discards; the owner union is safe for the separate reason that clubs SELECT carries an owner_id = auth.uid() arm, which is what keeps 095''s ownerless owner in. Exclusion of the actor happens AFTER the union, or every club creation notifies its own creator. Volume is linear per join and quadratic per club by decision, not by oversight.';

-- Re-issued rather than assumed. `create or replace` preserves privileges, so
-- this is a no-op against any database carrying `036` — and it is what makes
-- this file correct standing alone. Asserted by naming the ROLE with
-- `has_function_privilege`, never by attempting the call: the suite runs as the
-- table owner, for whom the barrier does not exist (`031`'s lesson).
revoke all on function private.notify_club_joined() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying
-- ---------------------------------------------------------------------------
--   -- t, {"search_path=\"\""} — still a definer with the path pinned. Note the
--   -- stored form: `set search_path = ''` records as `search_path=""`, NOT as
--   -- `search_path=`. Expecting the latter fails against a correct function,
--   -- which is how 055's own assertion was first written.
--   select prosecdef, proconfig from pg_proc
--    where oid = 'private.notify_club_joined()'::regprocedure;
--
--   -- f, f, f — no client role, and not service_role either
--   select has_function_privilege('authenticated','private.notify_club_joined()','execute'),
--          has_function_privilege('anon','private.notify_club_joined()','execute'),
--          has_function_privilege('service_role','private.notify_club_joined()','execute');
--
--   -- 0 — auth.uid() appears nowhere in the body
--   select count(*) from pg_proc
--    where oid = 'private.notify_club_joined()'::regprocedure
--      and prosrc like '%auth.uid()%';
--
--   -- 1 — the 058 guard survived the redefinition. This is THE query to run:
--   -- the widening is invisible without it and the guard is what bounds it.
--   select count(*) from pg_proc
--    where oid = 'private.notify_club_joined()'::regprocedure
--      and prosrc like '%is_default%';
--
--   -- 0 — and the role predicate is really gone, which is the widening itself.
--   select count(*) from pg_proc
--    where oid = 'private.notify_club_joined()'::regprocedure
--      and prosrc like '%m.role%';
--
--   -- 1 row — still bound, still carrying NO when clause. The tgname filter is
--   -- REQUIRED and not tidiness: club_members carries enforce_participation_gate
--   -- AND 054's protect_club_owner_membership, so the unfiltered query returns
--   -- THREE rows with no_when_clause reading false — a correct database that
--   -- reads as a failed apply, at exactly the moment (the PROD promotion) this
--   -- block is run.
--   select tgname, tgqual is null as no_when_clause from pg_trigger
--    where tgrelid = 'public.club_members'::regclass and not tgisinternal
--      and tgname = 'notify_club_joined';
--
--   -- 2 rows, naming 14 types between them — the type CHECK is untouched and no
--   -- fifteenth type was added. The 14 is the type count INSIDE the CHECK, not a
--   -- row count.
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('notifications_type_check','notifications_subject_shape');
--
--   -- CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
--   -- Three values. A fourth means the membership arm silently widened again.
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'club_members_role_check';
--
--   -- 2 — SELECT and UPDATE only. No policy moved.
--   select cmd from pg_policies
--    where schemaname='public' and tablename='notifications';
--
--   -- 22 — the participation-gate count is unmoved; this file adds no table.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- And `get_advisors(security)` must still return THIRTY-FOUR
-- `authenticated_security_definer_function_executable` (the baseline after
-- `097`). This file adds no function to `public` and moves no grant, so a
-- thirty-fifth is a failed apply rather than a finding to file.
