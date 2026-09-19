-- 121: push delivery — the outbox, the payload gate, and the schedule.
-- PD-303, child C of PD-291. Successor to 078 (child A, the device table).
--
-- ** THE TASKS FILE CALLS THIS `079_push_delivery.sql`. THAT NUMBER WAS
-- CORRECT WHEN THE PROPOSAL WAS WRITTEN AND IS LONG GONE. ** `079` was spent
-- by `079_postcard_unread_count_excludes_the_author` on 2026-08-25, the same
-- day 078 landed. Measured rather than derived from the file tree: DEV's
-- migration rows top out at `120_consent_outlives_the_rider`, and `118` is
-- applied to DEV from an unmerged branch with no file on this one — so
-- `ls supabase/migrations/` skips it and would have handed out 121 twice.
-- CLAUDE.md's "migration drift runs in two directions" in one sentence.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE IS
-- ---------------------------------------------------------------------------
-- `036` created `public.notifications`: ids only, never denormalised text,
-- readable by its recipient under a SELECT policy that re-asks the whole
-- visibility question on every read. `078` created `public.push_devices`: one
-- row per installation, readable by nobody at all.
--
-- This file is the path between them, and its central problem is that
-- **`notifications` holds no text and a push IS text or it is nothing.** So a
-- string that the recipient's own policy would have rendered has to be
-- produced at the last possible moment and then leave the database's reach
-- permanently.
--
-- Four objects carry that:
--
--   * `public.push_deliveries`   — the outbox. Ids and bookkeeping, NO COPY.
--   * an AFTER INSERT trigger    — the enqueue. No network, ever.
--   * `public.push_payload_for`  — the gate and the copy, in one function.
--   * `public.claim_push_batch`  — the atomic claim, plus the two suppressions.
--
-- plus `complete_push_delivery`, `invalidate_push_device`, the retention sweep
-- and the Vault-gated schedule at §10.
--
-- ---------------------------------------------------------------------------
-- §0a  THE LATENCY THIS BUYS, AND THE CASE THAT REOPENS IT  (design D2)
-- ---------------------------------------------------------------------------
-- The enqueue is a trigger and the send is a schedule, because the two halves
-- have OPPOSITE failure requirements. `036` deliberately lets a fan-out failure
-- take the rider's transaction down — a notification that silently does not
-- happen is a gap with nothing to detect it. A push must never be able to do
-- that: a rider must be able to like a postcard while APNs is unreachable. And
-- a push must be re-checked immediately before it is sent, which a write-time
-- trigger cannot do by construction.
--
-- ** INTERVAL: ONE MINUTE ** (§10's schedule, Q1's recommended default). A push
-- is therefore up to a minute late. For every live notification type — a like,
-- a comment, an RSVP, a ride created, a club joined, an invite, a join request,
-- a wave, a thread reply — a minute is invisible.
--
-- It is NOT acceptable for a notification whose value depends on arriving
-- within seconds — *"the group is leaving"* — which does not exist in this
-- product yet. **That is the trigger that reopens this decision**, and it is
-- written here rather than left for the next session to rediscover.
--
-- ** AGE CUT: SIX HOURS ** (§7). A row older than that is SUPPRESSED, not sent.
-- The project is on the free tier and auto-pauses after ~7 days idle; a size
-- bound alone means a resumed project delivers a week of notifications in
-- installments, one batch at a time, which is worse than delivering none of
-- them. The entire value of this feature is timeliness. Stated here beside the
-- interval it is paired with, as `push-delivery` requires.
--
-- ---------------------------------------------------------------------------
-- §0b  THE RESIDUE: A DELIVERED PUSH CANNOT BE WITHDRAWN  (design D6)
-- ---------------------------------------------------------------------------
-- Once APNs or FCM accepts a push, its text is on a device and NO policy
-- change, block, membership change or deletion removes it. A rider blocked one
-- second after delivery stops being returned the in-app row on their next read
-- (`036` §3 decides it on every read) and keeps the notification in their
-- notification centre.
--
-- That asymmetry is a property of push, not a defect in this design, and it is
-- written down HERE so that a future session does not attempt a withdrawal
-- sweep. Such a sweep is a standing unbounded query re-evaluating every
-- delivered message against every rider's current visibility, to answer a
-- question the device has already shown to somebody. ** IT IS REFUSED. **
--
-- ---------------------------------------------------------------------------
-- §0c  APPLY ORDER — additive first, deploy, THEN schedule
-- ---------------------------------------------------------------------------
-- The trigger writes outbox rows from the instant this file applies. That is
-- safe and inert: rows accumulate, `claim_push_batch` drains them, and the
-- age cut at §7 keeps a backlog from ever being delivered late. What must NOT
-- happen is the schedule starting before `push-notify` is deployed, because
-- then the job posts to a URL that 404s once a minute.
--
--   1. this file applies            (additive, inert)
--   2. `push-notify` deploys        (owner, task 3.23)
--   3. `create extension pg_cron` / `pg_net`, then §10's block is re-run
--      and the schedule starts     (owner, tasks 3.22 / 3.24)
--
-- `023`/`025` and `069`/`070` taught this ordering twice already.

-- ===========================================================================
-- §1  THE OUTBOX — ids and bookkeeping, and NOT ONE CHARACTER OF COPY
-- ===========================================================================
-- `database-enforced-integrity`'s modified requirement makes this a RULE and
-- not a preference: a copy of a visibility decision MAY be produced and
-- transmitted, never STORED, and only under four conditions. Condition 1 is
-- this table's shape:
--
--   "It is never written to a table. No payload column, no rendered-copy
--    column, no cached string on the outbox row. The outbox carries a
--    notification id and delivery bookkeeping and nothing that names a club,
--    ride, postcard or rider."
--
-- ** THERE IS DELIBERATELY NO `last_error` COLUMN EITHER. ** A provider's error
-- body is the obvious thing to keep "for debugging", and it is the seam through
-- which a token or a rendered string lands in a table that promises to hold
-- neither. The Edge Function's own logs are where a failure is read. An
-- implementation that adds the column back is adding a payload column with a
-- different name.
--
-- The other three conditions are discharged elsewhere and named here so a
-- reviewer can check each: produced immediately before transmission (§6 is
-- called per claimed row, never at fan-out time); produced by ONE function
-- (§6, the only place `notifications` SELECT is restated); pinned textually
-- against the live policy (`rls_test.sql` §121.6).
create table public.push_deliveries (
  id uuid default uuid_generate_v4() primary key,

  -- UNIQUE, so the trigger is idempotent and a notification is pushed at most
  -- once however many times its enqueue runs. CASCADE, so the outbox never
  -- outlives its notification: `notifications` itself cascades from `profiles`
  -- twice over (recipient and actor) and from all five subject tables, so this
  -- table is reached by account deletion through that row and needs no FK of
  -- its own to `profiles`. `push-delivery`'s "the outbox does not outlive its
  -- notification".
  notification_id uuid not null unique
    references public.notifications(id) on delete cascade,

  -- pending    — enqueued, not yet claimed
  -- claimed    — a run holds it; `claimed_at` is when
  -- sent       — the run finished with nothing left to do. That INCLUDES a
  --              recipient with zero devices (§7): "a rider with no tokens is
  --              not a failure", so the row completes rather than failing.
  -- suppressed — deliberately not sent, and NEVER retried, because the answer
  --              will not improve: the visibility gate refused (§6), the rider
  --              had already read it, or it aged out. A suppression is not a
  --              failure and is classified alongside the visibility refusal.
  -- failed     — the transport gave up after `attempts` tries. No token is ever
  --              deleted for this reason (§9).
  state text not null default 'pending',

  attempts int not null default 0,

  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  completed_at timestamptz,

  constraint push_deliveries_state_check
    check (state in ('pending', 'claimed', 'sent', 'suppressed', 'failed')),

  -- Bounded rather than validated. The retry ceiling lives in
  -- complete_push_delivery (§8); this is the backstop that makes an unbounded
  -- retry loop a 23514 rather than a slowly growing number.
  constraint push_deliveries_attempts_check check (attempts between 0 and 50)
);

alter table public.push_deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- §2  RLS ON, NO POLICY, AND NO GRANT TO ANY ROLE — INCLUDING service_role
-- ---------------------------------------------------------------------------
-- `026`'s `password_reset_grants` shape, restated by `078` §8 and followed here
-- for the third time. The intended access is NONE. RLS is enabled so that the
-- absence of policies DENIES rather than allows.
--
-- ** A POLICY HERE WOULD DESCRIBE DIRECT ACCESS THAT MUST NOT EXIST. ** If you
-- arrived at this file because something cannot read `push_deliveries`, that is
-- the design and not the defect. `rls_test.sql` §121.2 fails if a policy
-- appears.
--
-- The revoke is EXPLICIT rather than relied upon as a default, because it is
-- not one: Supabase's project default is `alter default privileges in schema
-- public grant all on tables to anon, authenticated`, which the test harness
-- reproduces, so a new table arrives fully granted and this line takes it away.
revoke all on public.push_deliveries from anon, authenticated;

-- ** service_role TOO, AND THIS ONE IS A JUDGEMENT RATHER THAN A DEFAULT. **
-- CLAUDE.md: a new table KEEPS Supabase's default `service_role` grants, and
-- revoking is the exception for a restricted-readership sink — rows the one
-- credential that bypasses RLS must not be able to enumerate (`076` §3). Three
-- tables are revoked today; this is the fourth, and the argument is in two
-- halves because the read half alone would not carry it.
--
--   READ. The rows are a per-rider delivery log. On their own they are ids and
--   timestamps, but `service_role` can read `notifications` unrevoked, so the
--   join is one statement away and it answers "who was told what, and when did
--   their phone light up" for every rider at once. That is the social graph
--   with timestamps on it, which is exactly the class `076` §3 revoked
--   `postcard_reports` for.
--
--   WRITE, which is the half that decides it. A table grant here is an UPDATE
--   grant, and `state` is the only thing standing between a suppressed
--   notification and a delivered one. Flipping a `suppressed` row back to
--   `pending` re-delivers a push the visibility gate REFUSED — the one
--   mechanism in this file whose whole job is to not send. A grant that can
--   undo a suppression makes §6 advisory.
--
-- It costs the delivery path nothing: every row it needs arrives through the
-- four RPCs below, each granted to `service_role` BY NAME. And it makes the
-- Edge Function's `.from()`-free property ENFORCED rather than conventional —
-- `push-delivery` asks for a grep proving zero `.from(` calls, and this line is
-- what makes that grep a description of the door rather than of the habit.
--
-- It does not touch the cascade from `notifications`: a referential action runs
-- as the constraint's system trigger and does not consult privileges at all,
-- which `076` measured in a rolled-back transaction rather than reasoned about.
revoke all on public.push_deliveries from service_role;

-- The claim's access path: `where state = 'pending' order by created_at`. Also
-- the sweep's, which reads completed rows by age.
create index push_deliveries_state_created_at_idx
  on public.push_deliveries (state, created_at);

comment on table public.push_deliveries is
  'The push outbox: one row per notification, written by an AFTER INSERT trigger on public.notifications and drained by a scheduled Edge Function (121, PD-303). ** IT HOLDS NO COPY. ** No payload column, no rendered string, no club, ride, postcard or rider name — database-enforced-integrity permits a copy of a visibility decision to be PRODUCED AND TRANSMITTED and never STORED, and this table is condition 1 of that carve-out. Readable and writable by NO role, service_role included: RLS is on, there is no policy, and every grant is revoked. The delivery path reaches it through claim_push_batch() and complete_push_delivery(), both granted to service_role by name. A row dies with its notification (cascade) or in the 7-day sweep at §9.';

comment on column public.push_deliveries.state is
  'pending -> claimed -> one of sent / suppressed / failed. `sent` means the run finished with nothing left to do, which INCLUDES a recipient who has registered no device — a rider with no tokens is not a failure. `suppressed` means deliberately not sent and never retried, because the answer will not improve: the visibility gate refused, the rider had already read it, or it aged out. `failed` means the transport gave up; NO token is ever deleted for that reason.';

comment on column public.push_deliveries.attempts is
  'Incremented by each claim, not by each provider call. The retry ceiling is in complete_push_delivery(); the CHECK is the backstop that turns an unbounded retry loop into a 23514.';

-- ===========================================================================
-- §3  THE ENQUEUE — a trigger, and its ABSENT `when` CLAUSE IS DELIBERATE
-- ===========================================================================
-- ** NO `when (current_user = 'authenticated')` CLAUSE, AND THE ABSENCE IS
-- RECORDED BECAUSE AN ABSENT GUARD IS INDISTINGUISHABLE FROM A FORGOTTEN
-- ONE. ** `023`'s participation gate carries that clause because a GATE must
-- skip privileged writers; a FAN-OUT must fire for every writer. This trigger
-- is the second kind. It fires for a client-driven fan-out, for a seed, for the
-- table owner, and for any future `security definer` RPC that inserts a
-- notification — `event-fanout-integrity`'s standing rule.
--
-- It makes NO outbound call of any kind and performs NO readability check. Both
-- are somebody else's job: the network is §10's, the readability is §6's, and
-- the reason they are not here is that a check performed at fan-out time
-- answers a question about the past (`036` §3's whole premise).
--
-- `security definer` rather than invoker. Every path that inserts a
-- notification today is itself a definer function running as the owner, so an
-- invoker trigger would work — right up until it does not. `022` shipped
-- exactly that divergence: applied with `security definer`, committed without
-- it, and the repo's copy silently skipped every row the club owner did not
-- organise. One clause, and it was the security-relevant one.
create function private.enqueue_push_delivery()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- `on conflict do nothing` rather than a plain insert: the unique key on
  -- notification_id is what makes "at most one push per notification" a
  -- property of the SCHEMA rather than of this trigger firing exactly once.
  insert into public.push_deliveries (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;

  return null;
end;
$$;

revoke all on function private.enqueue_push_delivery() from public, anon, authenticated;

create trigger enqueue_push_delivery
  after insert on public.notifications
  for each row
  execute function private.enqueue_push_delivery();

comment on function private.enqueue_push_delivery() is
  'AFTER INSERT on public.notifications: writes exactly one push_deliveries row and nothing else. NO outbound call — an HTTP request inside a rider''s like, comment, RSVP or ride creation is design D2''s rejected alternative, and pg_net''s asynchronous variant is worse rather than better because it cannot raise and parks its failures in net._http_response where nothing in this repo reads them. NO readability check either: that is re-asked at send time by public.push_payload_for(), because a fan-out-time answer is an answer about the past. Its trigger carries NO `when (current_user = ...)` clause, deliberately: a gate skips privileged writers, a fan-out fires for every writer.';

-- ===========================================================================
-- §4  THE CANDIDATE-RELATIVE PREDICATES — completing the family `060` started
-- ===========================================================================
-- `060` gave this repo three: `is_club_member_for`, `can_read_ride`,
-- `can_read_club`. Each asks "would THIS NAMED rider's own SELECT policy return
-- this row", with the candidate where `auth.uid()` stands in the policy. §6
-- needs four more, one per remaining subject column, in exactly that shape:
-- candidate as an argument, `security definer`, `search_path` pinned, revoked
-- from every client role, and a comment naming the policy it restates and where
-- that policy's qual is pinned in the suite.
--
-- ** EACH IS A BLOCK ORACLE AND IS REACHABLE BY NO CLIENT ROLE. **
-- `can_read_profile(x, y)` returning false for a rider with a username tells
-- the caller that x and y are blocked with each other, which decision #2
-- requires must never be revealed by any gap, count or marker.
--
-- ** THEY RESTATE POLICIES AND CAN GO STALE. ** That risk is accepted here for
-- the reason `060` accepted it, and the mitigation is the same: the policies
-- are pinned textually in `supabase/tests/rls_test.sql` §121.6b, so a rewrite
-- fails there rather than silently here.

-- profiles SELECT:
--   (auth.uid() = id) or (username is not null and not is_blocked(auth.uid(), id))
create function private.can_read_profile(candidate uuid, target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = target_profile
       and (
         p.id = candidate
         or (p.username is not null and not private.is_blocked(candidate, p.id))
       )
  );
$$;

revoke all on function private.can_read_profile(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_profile(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this profile? A restatement of profiles SELECT with the candidate in place of auth.uid(). The ACTOR is a rendered resource on every notification row — every copy begins with their username — which is why 036 §3 makes it a conjunct regardless of type, and why 121 §6 does. NOT redundant with the block conjunct beside it: a rider can null their own username in one request, so there is a second way out of profiles SELECT that has nothing to do with blocking (036 §3 conjunct 3 measured it). Reachable by no client role — it is a block oracle. IT RESTATES A POLICY AND CAN GO STALE: profiles SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §121.6b.';

-- postcards SELECT:
--   (author_id = auth.uid())
--   or (not is_blocked(auth.uid(), author_id)
--       and (club_id is null or private.is_club_member(club_id))
--       and not exists (postcard_hides h where h.postcard_id = id and h.user_id = auth.uid()))
create function private.can_read_postcard(candidate uuid, target_postcard uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.postcards pc
     where pc.id = target_postcard
       and (
         -- Unconditional and FIRST, exactly as in the policy: an author
         -- resolves their own postcard even when they have hidden it, because
         -- postcard_hides is an input to the other arm only. 036 §3 notes that
         -- it is the ORDERING of these arms that makes an author still read
         -- notifications about a postcard they hid.
         pc.author_id = candidate
         or (
           not private.is_blocked(candidate, pc.author_id)
           and (pc.club_id is null or private.is_club_member_for(candidate, pc.club_id))
           and not exists (
             select 1
               from public.postcard_hides h
              where h.postcard_id = pc.id
                and h.user_id = candidate
           )
         )
       )
  );
$$;

revoke all on function private.can_read_postcard(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_postcard(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this postcard? A restatement of postcards SELECT with the candidate in place of auth.uid(), the third member of 060''s family. The author arm is FIRST and unconditional, which is what keeps an author reading notifications about a postcard they have hidden — postcard_hides is an input to the other arm only, and 036 §3 asserts that ordering rather than assuming it. Reachable by no client role — it is a block oracle. IT RESTATES A POLICY AND CAN GO STALE: postcards SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §121.6b.';

-- postcard_comments SELECT:
--   (author_id = auth.uid())
--   or (exists (postcards p where p.id = postcard_id) and not is_blocked(auth.uid(), author_id))
--
-- That EXISTS runs under the CALLER's own row security, so the candidate-
-- relative form of it is can_read_postcard — not a bare existence check, which
-- would return true for a postcard in a private club the candidate left.
create function private.can_read_comment(candidate uuid, target_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.postcard_comments cm
     where cm.id = target_comment
       and (
         cm.author_id = candidate
         or (
           private.can_read_postcard(candidate, cm.postcard_id)
           and not private.is_blocked(candidate, cm.author_id)
         )
       )
  );
$$;

revoke all on function private.can_read_comment(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_comment(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this comment? A restatement of postcard_comments SELECT with the candidate in place of auth.uid(). Its EXISTS on postcards runs under the CALLER''s row security in the live policy, so the faithful candidate-relative form is private.can_read_postcard and NOT a bare existence check — a bare check returns true for a postcard in a private club the candidate has left, which is the whole class of defect 060 exists to close. Reachable by no client role. IT RESTATES A POLICY AND CAN GO STALE: postcard_comments SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §121.6b.';

-- club_threads SELECT:
--   exists (clubs c where c.id = club_id)
--   and private.is_club_member(club_id)
--   and (author_id = auth.uid() or not is_blocked(auth.uid(), author_id))
--
-- ** NOT IN THE TASKS LIST, AND REQUIRED. ** Task 3.4 names three helpers,
-- written when `notifications` had four subject columns. `081`/`082` added a
-- FIFTH — `thread_id` — and the live SELECT qual carries a fifth conjunct for
-- it. A gate with four conjuncts against a policy with five is the exact
-- divergence D5 is about, one column over instead of one type over.
create function private.can_read_club_thread(candidate uuid, target_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.club_threads t
     where t.id = target_thread
       -- The policy's own first conjunct is an EXISTS on clubs under the
       -- caller's row security, which is can_read_club candidate-relative.
       and private.can_read_club(candidate, t.club_id)
       and private.is_club_member_for(candidate, t.club_id)
       and (t.author_id = candidate or not private.is_blocked(candidate, t.author_id))
  );
$$;

revoke all on function private.can_read_club_thread(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_club_thread(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this club thread? A restatement of club_threads SELECT with the candidate in place of auth.uid(). Not in PD-303''s task list, which was written when notifications had four subject columns: 081/082 added thread_id and the live SELECT qual carries a fifth conjunct for it, so a payload gate without this one is short a conjunct. Reachable by no client role. IT RESTATES A POLICY AND CAN GO STALE: club_threads SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §121.6b.';

-- ===========================================================================
-- §5  031's LESSON, APPLIED PROSPECTIVELY
-- ===========================================================================
-- Every function the Edge Function calls is in `public` and granted to
-- `service_role` BY NAME. Never `private`: `service_role` holds USAGE on
-- `private` but no EXECUTE on anything in it, and PostgREST routes only to
-- `public`, so `.schema('private')` is refused before it reaches Postgres.
-- `029` shipped a function nothing could call and `031` is where that was
-- found. The four below — push_payload_for, claim_push_batch,
-- complete_push_delivery, invalidate_push_device — are the Edge Function's
-- ENTIRE database reach. It issues no `.from()` against any table.
--
-- Every grant assertion for them names the ROLE
-- (`has_function_privilege('service_role', …, 'EXECUTE')`) rather than
-- attempting a call, because the RLS suite runs as the table owner for whom
-- neither the schema barrier nor the EXECUTE barrier exists.

-- ===========================================================================
-- §6  public.push_payload_for — THE GATE AND THE COPY, IN ONE FUNCTION
-- ===========================================================================
-- ** THE VISIBILITY GATE IS PER COLUMN, MIRRORING `notifications` SELECT'S OWN
-- QUAL. IT IS NOT A `case type` DISPATCH, AND GETTING THAT BACKWARDS IS A LIVE
-- LEAK. ** `036` states the subject shapes once so its SELECT policy "can be
-- written per COLUMN rather than per type and the two cannot drift apart", and
-- the live qual is independent `<column> is null or exists (…)` conjuncts
-- evaluated on EVERY row whatever its type. A type-keyed gate reads as
-- equivalent and is not: adding a type changes `notifications_type_check` and
-- `notifications_subject_shape` and does NOT change the column conjuncts, so a
-- pin on the policy stays green while the type-keyed gate has no branch for the
-- new type. Child D (`ride_upcoming`) is exactly that change.
--
-- ** MEASURED 2026-09-19, AND IT CORRECTS THE PROPOSAL: THE LIVE QUAL HAS FIVE
-- SUBJECT CONJUNCTS, NOT FOUR, AND TWO OF THEM CARRY TYPE-KEYED ARMS. ** The
-- proposal was written against `036`'s original text — four columns and five
-- types. What is actually on the database is:
--
--   * a FIFTH subject column, `thread_id` (`081`/`082`), with its own conjunct;
--   * SIXTEEN types in `notifications_type_check`, not five;
--   * and inside the `club_id` conjunct, two arms keyed on `type`:
--
--       or (type = 'club_join_request_declined' and club_takes_join_requests(club_id))
--       or (type = 'club_invited'               and has_live_club_invite(club_id))
--
-- Those two exist because a rider declined from, or invited to, a PRIVATE club
-- cannot read the club through `clubs` SELECT and must still be told. They are
-- part of the policy, so they are part of the mirror — mirroring the policy per
-- column is the rule, and the rule is not violated by the policy's own arms
-- appearing in it. What is forbidden is DISPATCHING the gate on type; this
-- reproduces the qual conjunct for conjunct, with the candidate-relative form
-- of each helper (`_for` variants, which `085` and `093` already provide).
--
-- ** THE COPY DISPATCH IS PER TYPE, BECAUSE IT IRREDUCIBLY IS, AND ITS `else`
-- ARM RAISES. ** `036:151-155`'s reasoning one function along: a bare CASE with
-- no ELSE returns NULL for an unmatched type, and NULL copy is either a crash
-- in the sender or an empty notification on a lock screen. The two halves fail
-- on DIFFERENT inputs — an unknown type passes the gate and dies here.
--
-- ** THE COPY IS THE STRING THE RECIPIENT'S OWN SCREEN WOULD HAVE DRAWN. **
-- `src/components/notifications/copy.ts` is the reference and every arm below
-- matches it. The one non-obvious consequence: the client renders
-- `row.club?.name ?? 'a club'`, and that embed does NOT resolve for a club the
-- reader cannot read — which is precisely the two escape-arm types above. So
-- the club name here is read ONLY when `can_read_club` is true for the
-- recipient, and falls back to the same literal otherwise. Without that, a push
-- for `club_invited` would transmit a private club's NAME to Apple for a rider
-- whose own screen shows "a club". Same for the thread and the ride, which have
-- no escape arm and therefore always resolve.
--
-- ** RETURNS NOTHING WHEN THE GATE REFUSES ** — zero rows, which the caller
-- marks `suppressed` and never retries, because the answer will not improve.
-- It stores nothing, anywhere, before or after sending.
--
-- ** THE RETURNED ID COLUMN IS `id`, NOT `notification_id`, AND THAT IS FORCED
-- RATHER THAN CHOSEN. ** Postgres refuses a function whose IN parameter and OUT
-- column share a name — 42P13, "parameter name used more than once", at CREATE
-- time. The INPUT keeps the name the tasks list specifies, because the argument
-- name is the wire contract supabase-js sends; the output takes `id`.
create function public.push_payload_for(notification_id uuid)
returns table (
  id              uuid,
  recipient_id    uuid,
  type            text,
  title           text,
  body            text,
  postcard_id     uuid,
  comment_id      uuid,
  ride_id         uuid,
  club_id         uuid,
  thread_id       uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  n public.notifications%rowtype;
  v_club_name   text;
  v_ride_title  text;
  v_thread_name text;
  v_actor       text;
  v_title       text;
  v_body        text;
begin
  select * into n
    from public.notifications x
   where x.id = push_payload_for.notification_id;

  if not found then
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- THE GATE. Conjunct for conjunct against `notifications` SELECT's qual,
  -- with n.user_id — the recipient — where auth.uid() stands. Reordered for
  -- nothing: the order below is the policy's order.
  -- -------------------------------------------------------------------------
  if not (
    not private.is_blocked(n.user_id, n.actor_id)
    and private.can_read_profile(n.user_id, n.actor_id)
    and (n.postcard_id is null or private.can_read_postcard(n.user_id, n.postcard_id))
    and (n.comment_id  is null or private.can_read_comment(n.user_id, n.comment_id))
    and (n.ride_id     is null or private.can_read_ride(n.user_id, n.ride_id))
    and (n.club_id     is null
         or private.can_read_club(n.user_id, n.club_id)
         or (n.type = 'club_join_request_declined'
             and private.club_takes_join_requests_for(n.user_id, n.club_id))
         or (n.type = 'club_invited'
             and private.has_live_club_invite_for(n.user_id, n.club_id)))
    and (n.thread_id is null or private.can_read_club_thread(n.user_id, n.thread_id))
  ) then
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- THE RESOLVED NAMES. Each read only where the recipient's own policy would
  -- have resolved the embed — see the header. `v_club_name` stays NULL for a
  -- club reached through one of the two escape arms, so the copy falls back to
  -- the same literal the screen draws and the name never leaves the database.
  -- -------------------------------------------------------------------------
  select p.username into v_actor
    from public.profiles p where p.id = n.actor_id;

  if n.club_id is not null and private.can_read_club(n.user_id, n.club_id) then
    select c.name into v_club_name from public.clubs c where c.id = n.club_id;
  end if;

  if n.ride_id is not null then
    select r.title into v_ride_title from public.rides r where r.id = n.ride_id;
  end if;

  if n.thread_id is not null then
    select t.title into v_thread_name from public.club_threads t where t.id = n.thread_id;
  end if;

  -- -------------------------------------------------------------------------
  -- THE COPY DISPATCH, PER TYPE. `src/components/notifications/copy.ts` arm for
  -- arm. The `else` RAISES — see the header.
  -- -------------------------------------------------------------------------
  v_title := v_actor;

  case n.type
    when 'postcard_liked' then
      v_body := 'liked your postcard.';
    when 'postcard_commented' then
      v_body := 'commented on your postcard.';
    when 'ride_joined' then
      -- Reader-dependent, exactly as on the screen: one fan-out addresses the
      -- whole crew AND the organizer, and no single sentence is true for both.
      v_body := case
        when exists (select 1 from public.rides r
                      where r.id = n.ride_id and r.organizer_id = n.user_id)
        then 'joined your ride.'
        else 'joined a ride you also joined.'
      end;
    when 'ride_created_in_club' then
      v_body := 'created a ride in ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_joined' then
      v_body := 'joined club ' || coalesce(v_club_name, 'a club') || '.';
    when 'ride_invited' then
      v_body := 'invited you to ' || coalesce(v_ride_title, 'a ride') || '.';
    when 'ride_invite_accepted' then
      v_body := 'accepted your invite to ' || coalesce(v_ride_title, 'a ride') || '.';
    when 'ride_invite_declined' then
      v_body := 'declined your invite to ' || coalesce(v_ride_title, 'a ride') || '.';
    when 'club_join_requested' then
      v_body := 'asked to join ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_join_request_approved' then
      v_body := 'let you into ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_join_request_declined' then
      -- ** THE ONE ARM WHOSE TITLE IS NOT THE ACTOR. ** The stored actor is the
      -- RECIPIENT themselves, so a push titled with their own username reads
      -- "you declined your request". The screen draws the club in the actor
      -- slot for this type and so does this. When the club does not resolve —
      -- the ordinary case, since it is reached through the join-request escape
      -- arm — the title falls back to the app's own name rather than to the
      -- literal "a club", which would title a push with an indefinite article.
      v_title := coalesce(v_club_name, 'LetsRide');
      v_body  := 'declined your request to join.';
    when 'club_waved' then
      v_body := 'waved you a welcome to ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_invited' then
      v_body := 'invited you to ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_invite_declined' then
      v_body := 'declined your invite to ' || coalesce(v_club_name, 'a club') || '.';
    when 'club_thread_replied' then
      v_body := 'replied to ' || coalesce(v_thread_name, 'your post') || '.';
    when 'club_thread_waved' then
      -- `101` retired the thread wave: its table, both fan-outs and every
      -- writer are gone, and MEASURED 2026-09-19 no function on the database
      -- names this type. The type survives in notifications_type_check because
      -- `101` deliberately left rows already written readable. So this arm
      -- renders history and can never be reached by a new row — which is a
      -- reason to KEEP it, not to drop it: the `else` below raises, and a
      -- surviving old row would otherwise take a delivery run down.
      v_body := 'waved at ' || coalesce(v_thread_name, 'your post') || '.';
    else
      -- ** THE LOAD-BEARING ARM. ** 036's notifications_subject_shape carries
      -- `else false` because "a bare CASE with no ELSE returns NULL for an
      -- unmatched type, and a CHECK passes on NULL". The same hazard, one
      -- function along: NULL copy is a crash in the sender or an empty
      -- notification on a lock screen. A seventeenth type turns the RLS suite
      -- red at §121.6's pin on notifications_type_check BEFORE it can reach
      -- here — that pin and this arm are one mechanism.
      raise exception
        'push_payload_for has no copy for notification type %; add an arm to 121 §6 and re-pin notifications_type_check in rls_test.sql §121.6',
        n.type
        using errcode = 'check_violation';
  end case;

  -- A NULL title is the same defect as NULL copy, one field over, and it is
  -- reachable: can_read_profile admits an own-row actor with a NULL username.
  if v_title is null or v_body is null then
    raise exception 'push_payload_for produced an empty payload for notification %', n.id
      using errcode = 'check_violation';
  end if;

  return query select n.id, n.user_id, n.type, v_title, v_body,
                      n.postcard_id, n.comment_id, n.ride_id, n.club_id, n.thread_id;
end;
$$;

revoke all on function public.push_payload_for(uuid) from public, anon, authenticated;
grant execute on function public.push_payload_for(uuid) to service_role;

comment on function public.push_payload_for(uuid) is
  'Renders the push for one notification, or returns ZERO ROWS if the recipient''s own SELECT policy would no longer return it. Granted to service_role alone. Two separable halves: a visibility gate written PER COLUMN mirroring notifications SELECT''s live qual conjunct for conjunct (five subject columns, and the club conjunct''s two type-keyed escape arms are the policy''s own, not a type dispatch), and a copy dispatch PER TYPE whose else arm RAISES rather than returning NULL. Zero rows is a SUPPRESSION and never a retry: the answer will not improve. It stores nothing — database-enforced-integrity permits a copy of a visibility decision to be produced and transmitted, never stored. IT RESTATES A POLICY AND CAN GO STALE: notifications SELECT''s qual AND notifications_type_check are BOTH pinned textually in supabase/tests/rls_test.sql §121.6, because the qual is the half that does not move when a type is added.';

-- ===========================================================================
-- §7  public.claim_push_batch — the atomic claim, and the two suppressions
-- ===========================================================================
-- ** `for update skip locked` IS WHAT GUARANTEES AT-MOST-ONCE. ** A retried
-- batch, an overlapping schedule run or a function that timed out after sending
-- must not produce a second push, and the CLAIM is the thing that guarantees
-- it — never a check the sender performs afterwards.
--
-- Two filters beyond `pending`, both SUPPRESSIONS and neither a failure:
--
--   (a) `n.read_at is not null` — a rider who was in the app when the row
--       landed, saw it and tapped it must not get a push about it forty
--       seconds later. ** With a one-minute interval this is the ORDINARY case,
--       not an edge one. **
--
--   (b) the AGE CUT, six hours (§0a). Older rows are marked `suppressed` and
--       never sent. A size bound alone delivers a week of backlog in
--       installments after a free-tier resume, which is worse than delivering
--       none of it.
--
-- Both are applied to the CLAIMED CANDIDATES rather than table-wide, so one run
-- is bounded whatever the backlog — `event-fanout-integrity`'s "bounded and
-- SHALL NOT be assumed small", one table further down. Oldest first, so a
-- backlog drains through the age cut at `batch_size` a minute instead of
-- standing in front of the rows that are still worth sending.
--
-- ** A RECIPIENT WITH ZERO DEVICES COMPLETES RATHER THAN FAILING. ** Most
-- riders will have no token for most of this feature's life. Such a row is
-- marked `sent` here and NOT returned, so the property is provable in the RLS
-- suite without a provider.
create function public.claim_push_batch(batch_size int)
returns table (
  delivery_id     uuid,
  notification_id uuid,
  recipient_id    uuid,
  installation_id text,
  token           text,
  platform        text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_limit int := least(greatest(coalesce(claim_push_batch.batch_size, 50), 1), 500);
  v_claimed uuid[];
begin
  -- ** THREE STATEMENTS, NOT ONE, AND THE SPLIT IS LOAD-BEARING. ** The
  -- tokenless completion below touches rows the claim above has just written,
  -- and two data-modifying CTEs in ONE statement do not see each other's
  -- effects: "trying to update the same row twice in a single statement is not
  -- supported. Only one of the modifications takes place, but it is not easy
  -- (and sometimes not possible) to reliably predict which one." Written as one
  -- statement this reads as tidier and silently loses either the claim or the
  -- completion.
  with candidates as (
    select d.id, n.read_at, d.created_at
      from public.push_deliveries d
      join public.notifications n on n.id = d.notification_id
     where d.state = 'pending'
     order by d.created_at
     limit v_limit
       for update of d skip locked
  ),
  classified as (
    select c.id,
           case
             when c.read_at is not null then 'suppressed'
             when c.created_at < now() - interval '6 hours' then 'suppressed'
             else 'claimed'
           end as next_state
      from candidates c
  ),
  moved as (
    update public.push_deliveries d
       set state        = cl.next_state,
           attempts     = d.attempts + case when cl.next_state = 'claimed' then 1 else 0 end,
           claimed_at   = case when cl.next_state = 'claimed' then now() else d.claimed_at end,
           completed_at = case when cl.next_state = 'claimed' then null else now() end
      from classified cl
     where d.id = cl.id
     returning d.id as moved_id, cl.next_state as moved_state
  )
  select array_agg(m.moved_id) filter (where m.moved_state = 'claimed')
    into v_claimed
    from moved m;

  -- A claimed row whose recipient holds no device row completes immediately.
  -- Done here rather than by the sender, so "a rider with no tokens is not a
  -- failure" is a property of the CLAIM and assertable in plain SQL, with no
  -- provider and no round trip.
  update public.push_deliveries d
     set state = 'sent', completed_at = now()
    from public.notifications n
   where d.id = any (v_claimed)
     and n.id = d.notification_id
     and not exists (
       select 1 from public.push_devices pd where pd.user_id = n.user_id
     );

  return query
  select d.id, d.notification_id, n.user_id, pd.installation_id, pd.token, pd.platform
    from public.push_deliveries d
    join public.notifications n on n.id = d.notification_id
    join public.push_devices pd on pd.user_id = n.user_id
   where d.id = any (v_claimed)
     and d.state = 'claimed';
end;
$$;

revoke all on function public.claim_push_batch(int) from public, anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;

comment on function public.claim_push_batch(int) is
  'Claims up to batch_size pending outbox rows (bounded to 500) with `for update skip locked`, and returns one row per (delivery, device) pair for their recipients. Granted to service_role alone. The CLAIM is what guarantees at-most-once delivery — never a check the sender performs afterwards. Two suppressions are applied at claim time and neither is a failure: a notification the rider has already READ (with a one-minute interval this is the ordinary case), and one older than the SIX-HOUR age cut (a resumed free-tier project must not deliver a week of notifications in installments). A claimed row whose recipient has registered no device is marked `sent` here and not returned, because a rider with no tokens is not a failure. Oldest first, so a backlog drains through the age cut rather than standing in front of rows still worth sending.';

-- ===========================================================================
-- §8  public.complete_push_delivery — the three outcomes, and the token touch
-- ===========================================================================
-- The classifier lives in the Edge Function (`push-delivery`'s three-outcome
-- table); this is where its verdict lands. `search-places` is this repo's
-- worked example of getting a classifier wrong — `isPolicyRefusal` matched
-- 42501 only, the participation gate raises 23514, and a refusal fell to the
-- outage branch. Here the same mistake silently unsubscribes every rider on
-- whichever platform is having an outage, which is why ** NO OUTCOME IN THIS
-- FUNCTION DELETES A TOKEN. ** Deleting one is §9's, called only for a
-- provider's PERMANENT refusal.
--
--   'sent'       — done. `delivered` advances last_seen_at on those devices.
--   'suppressed' — the payload gate returned nothing, or the sender chose not
--                  to send. Never retried.
--   'retry'      — transport. Returns the row to `pending` until the attempt
--                  ceiling, then `failed`. Backoff is the schedule interval.
--   'failed'     — give up now.
create function public.complete_push_delivery(
  delivery_id uuid,
  outcome text,
  delivered_installations text[] default '{}'
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_attempts int;
  v_next text;
begin
  if complete_push_delivery.outcome not in ('sent', 'suppressed', 'retry', 'failed') then
    raise exception 'complete_push_delivery: unknown outcome %', complete_push_delivery.outcome
      using errcode = 'check_violation';
  end if;

  select d.attempts into v_attempts
    from public.push_deliveries d
   where d.id = complete_push_delivery.delivery_id;

  if v_attempts is null then
    return null;
  end if;

  -- Five attempts, then stop. An unbounded retry is an unbounded provider bill
  -- and a row that never leaves the table.
  v_next := case
    when complete_push_delivery.outcome = 'retry' and v_attempts < 5 then 'pending'
    when complete_push_delivery.outcome = 'retry' then 'failed'
    else complete_push_delivery.outcome
  end;

  update public.push_deliveries d
     set state        = v_next,
         claimed_at   = case when v_next = 'pending' then null else d.claimed_at end,
         completed_at = case when v_next = 'pending' then null else now() end
   where d.id = complete_push_delivery.delivery_id;

  -- D7: last_seen_at measures DEVICE REACHABILITY rather than app usage, so a
  -- successful delivery advances it and a rider on a three-week holiday is not
  -- swept. Scoped to the installations the sender reports delivered — never to
  -- every device of the recipient, which would keep a dead token alive off a
  -- sibling's success.
  if array_length(complete_push_delivery.delivered_installations, 1) is not null then
    update public.push_devices pd
       set last_seen_at = now()
     where pd.installation_id = any (complete_push_delivery.delivered_installations);
  end if;

  return v_next;
end;
$$;

revoke all on function public.complete_push_delivery(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.complete_push_delivery(uuid, text, text[]) to service_role;

comment on function public.complete_push_delivery(uuid, text, text[]) is
  'Records the sender''s verdict on one claimed outbox row and returns the state it landed in. Granted to service_role alone. Outcomes: sent, suppressed (never retried — the payload gate refused), retry (back to pending until five attempts, then failed) and failed. ** NO OUTCOME HERE DELETES A TOKEN ** — that is invalidate_push_device(), for a provider''s PERMANENT refusal only, because folding a transport error into the dead-token branch silently unsubscribes every rider on whichever platform is having an outage. delivered_installations advances push_devices.last_seen_at for exactly the devices that took the push, so the 60-day window measures device reachability rather than app usage.';

-- ===========================================================================
-- §9  public.invalidate_push_device — the ONLY route from a refusal to a delete
-- ===========================================================================
-- Called for APNs 410 `Unregistered` / 403 `BadDeviceToken` and FCM
-- `UNREGISTERED` / `INVALID_ARGUMENT`, and for NOTHING else. A 5xx, a timeout,
-- a 429 or a TLS failure retries with backoff and leaves the row alone.
--
-- Unscoped by user, deliberately: the caller is the delivery function, which
-- knows the installation because it just tried to reach it, and the row's owner
-- is irrelevant to the fact that the provider has refused the token.
create function public.invalidate_push_device(installation_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  delete from public.push_devices pd
   where pd.installation_id = invalidate_push_device.installation_id;
end;
$$;

revoke all on function public.invalidate_push_device(text) from public, anon, authenticated;
grant execute on function public.invalidate_push_device(text) to service_role;

comment on function public.invalidate_push_device(text) is
  'Deletes one device row, and is the ONLY route by which a provider refusal removes one — the third of the four ways a push_devices row dies (078). Granted to service_role alone. Call it for a PERMANENT refusal only: APNs 410 Unregistered / 403 BadDeviceToken, FCM UNREGISTERED / INVALID_ARGUMENT. A transport failure — 5xx, 429, timeout, TLS — must leave every token alone, because deleting live tokens during a provider outage silently unsubscribes every rider on that platform and nothing would report it.';

-- ===========================================================================
-- §9b  public.sweep_push_retention — the fourth way a device row dies
-- ===========================================================================
-- ** SIXTY DAYS, IMPLEMENTED RATHER THAN ASSERTED. ** `036` refused to write a
-- retention number because nothing could enforce one: "no pg_cron and no
-- scheduled Edge Function exist in this project, so a 90-day claim would be an
-- unlabelled guess promoted to a fact in the one artifact a future session
-- reads as authoritative." This file builds the scheduler, so the number is
-- enforced by the mechanism below rather than stated in a comment.
--
--   * device rows with no successful delivery and no re-registration for 60
--     days (Q5's default). Long enough that a rider on holiday is not silently
--     unsubscribed, short enough that a sold phone stops receiving.
--   * outbox rows in a terminal state for 7 days. The outbox must not become a
--     permanent parallel log of every interaction in the app.
--
-- Personal data, both windows, and both are the PERSONAL-DATA RETENTION this
-- schema owes at creation rather than as a retrofit. Account deletion reaches
-- both tables through cascades: push_devices from profiles directly (078), and
-- push_deliveries from notifications, which itself cascades from profiles on
-- BOTH user_id and actor_id.
create function public.sweep_push_retention()
returns table (devices_removed int, deliveries_removed int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_devices int;
  v_deliveries int;
begin
  with gone as (
    delete from public.push_devices pd
     where pd.last_seen_at < now() - interval '60 days'
     returning 1
  )
  select count(*)::int into v_devices from gone;

  with gone as (
    delete from public.push_deliveries d
     where d.state in ('sent', 'suppressed', 'failed')
       and d.completed_at < now() - interval '7 days'
     returning 1
  )
  select count(*)::int into v_deliveries from gone;

  return query select v_devices, v_deliveries;
end;
$$;

revoke all on function public.sweep_push_retention() from public, anon, authenticated;
grant execute on function public.sweep_push_retention() to service_role;

comment on function public.sweep_push_retention() is
  'Retention, run by the scheduled job at §10 and callable by service_role. Deletes device rows idle 60 days — the fourth of the four ways a push_devices row dies, and the window 078 stated and could not yet enforce — and terminal outbox rows completed more than 7 days ago, so the outbox never becomes a permanent parallel log of every interaction in the app. Both windows are also written into /legal/privacy, in the same words.';

-- ===========================================================================
-- §10  THE SCHEDULE — gated on Vault, and apply-clean without either extension
-- ===========================================================================
-- ** `docs/ENVIRONMENTS.md` §Scheduled jobs, QUOTED RATHER THAN PARAPHRASED,
-- because this change is the first to trip it: **
--
--   "Ride reminders need a schedule. **If that is written as `pg_cron`, it
--    lives in a migration, and the chain replicates it to DEV — where it will
--    also fire.** A reminder job running on both databases means DEV sending
--    real notifications to whatever addresses its seed holds. `pg_net` carries
--    the same hazard for outbound HTTP.
--
--    Neither extension is installed today (`list_extensions` — both present,
--    both `installed_version: null`), so this has not bitten. The mitigation
--    has to be something the chain *cannot* replicate: gate the job on a
--    per-project value in Vault, which is already installed, or schedule it
--    outside the chain entirely. **Decide which before the first scheduled job
--    is written, not after it has fired from the wrong database.**"
--
-- ** DECIDED: GATE ON VAULT, IN THE CHAIN. ** Scheduling outside the chain is
-- rejected on reviewability rather than effort — such a job is invisible to
-- `db:drift`, to the RLS suite and to `reviewer`, so no later session can find
-- out it exists. In-chain and gated is worse only in that it requires the gate
-- to be right; out-of-chain is worse in that nothing can ever check it.
--
-- Vault secrets do NOT replicate through the migration chain. That is the whole
-- gate: a project where the owner has not created them runs the job and does
-- nothing.
--
-- ** THE LIMITATION, MEASURED RATHER THAN REASONED AROUND (2026-09-19). **
-- D14 asks the job to return without doing anything when the Vault key "does
-- not name the project it is running on". Postgres on Supabase exposes NO
-- self-identifying project reference: `cluster_name` is 'main' on both
-- projects, `current_database()` is 'postgres' on both, and there is no
-- `app.settings.*` or `supabase.*` GUC —
--
--   select name, setting from pg_settings
--    where name in ('cluster_name','application_name','data_directory')
--       or name like 'app.%' or name like 'supabase%';
--   -- DEV: cluster_name=main, application_name=<client>, data_directory=/data/pgdata
--
-- So the database cannot check a secret against its own identity. What it CAN
-- check is that TWO independently-created per-project secrets agree, which
-- catches the failure the section is actually about: a DEV secret set
-- copy-pasted from PROD. `push_delivery_project_ref` must appear as the host
-- label of `push_delivery_endpoint`, or the job refuses. Stated as a limit
-- rather than presented as the full check.
--
-- The second independent guard is Q2's: the DEV function's `APNS_HOST` secret
-- points at the APNs SANDBOX. Two things have to be wrong before a real rider's
-- phone rings from DEV, and 3.26a checks them independently rather than
-- together.
--
-- ** NO KEY OF ANY KIND IS IN THIS FILE. ** The three secrets are created by
-- the owner, on each project, with `vault.create_secret()`:
--
--   push_delivery_project_ref    the project's own ref, e.g. fpmrimzxadewsaiwpsel
--   push_delivery_endpoint       https://<ref>.functions.supabase.co/push-notify
--   push_delivery_service_key    the service-role JWT the function verifies
--
-- ** AND IT APPLIES CLEANLY WITH NEITHER `pg_cron` NOR `pg_net` INSTALLED **,
-- which is required twice over: neither is installed on DEV or PROD (owner
-- action, task 3.22), and the RLS suite runs this chain against a plain
-- Postgres 17 where neither exists and `supabase_vault` does not either. Every
-- reference to `vault.`, `net.` and `cron.` below is inside dynamic SQL behind
-- a catalogue check, so nothing in this file resolves a name that is absent.
create function private.push_delivery_tick()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref      text;
  v_endpoint text;
  v_key      text;
begin
  -- Retention runs FIRST and unconditionally: it is local, it makes no
  -- outbound call, and it is not a per-project hazard. A project whose secrets
  -- are absent still expires its own stale rows.
  perform public.sweep_push_retention();

  -- The Vault gate. `to_regclass` returns NULL rather than raising when the
  -- extension is absent, which is what keeps this apply-clean on a plain
  -- Postgres.
  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'push_delivery_project_ref'$q$ into v_ref;
  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'push_delivery_endpoint'$q$ into v_endpoint;
  execute $q$select decrypted_secret from vault.decrypted_secrets
            where name = 'push_delivery_service_key'$q$ into v_key;

  -- Absent on a project the owner has not configured — the primary gate, and
  -- the one the migration chain cannot replicate.
  if v_ref is null or v_endpoint is null or v_key is null then
    return;
  end if;

  -- The two per-project secrets must agree. See the header: this is what
  -- stands in for "names the project it is running on", which Postgres cannot
  -- answer for itself.
  if position('//' || v_ref || '.' in v_endpoint) = 0 then
    raise warning
      '121: push delivery is NOT running — push_delivery_endpoint does not name push_delivery_project_ref. One of the two Vault secrets was copied from the other project.';
    return;
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    raise warning '121: pg_net is not installed, so the schedule cannot reach the function (task 3.22).';
    return;
  end if;

  -- The function takes NO arguments from any caller and refuses every caller
  -- whose verified JWT does not carry role: service_role (design D11). The body
  -- is empty by design.
  execute format(
    'select net.http_post(url => %L, headers => %L::jsonb, body => %L::jsonb, timeout_milliseconds => 20000)',
    v_endpoint,
    json_build_object('Content-Type', 'application/json',
                      'Authorization', 'Bearer ' || v_key)::text,
    '{}'
  );
end;
$$;

revoke all on function private.push_delivery_tick() from public, anon, authenticated, service_role;

comment on function private.push_delivery_tick() is
  'The scheduled job (121 §10, PD-303). Sweeps retention unconditionally, then — ONLY when three per-project Vault secrets are present and the endpoint names the ref — posts to the push-notify Edge Function through pg_net. In `private` and granted to NOBODY, service_role included: its only caller is pg_cron, which runs as the superuser. ** GATED ON VAULT because docs/ENVIRONMENTS.md §Scheduled jobs says a pg_cron job written in a migration replicates to DEV and fires there ** — Vault secrets do not replicate, so an unconfigured project does nothing. Postgres exposes no self-identifying project ref (measured: cluster_name is `main` on both), so "names the project it is running on" is implemented as two independently-created secrets agreeing, which catches the copy-pasted secret set. Q2''s APNs sandbox host on DEV is the second, independent guard.';

-- ---------------------------------------------------------------------------
-- The schedule itself, skipped when `pg_cron` is absent.
-- ---------------------------------------------------------------------------
-- ** RE-RUN THIS BLOCK AFTER `create extension pg_cron` (task 3.24). ** It is
-- idempotent: unschedule-if-present, then schedule. Nothing here resolves a
-- `cron.` name unless the extension is installed, because every reference is
-- inside `execute`.
do $schedule$
begin
  -- `to_regproc('cron.schedule')` is the natural spelling and it is WRONG here:
  -- pg_cron ships two overloads of that name, and to_regproc RAISES on an
  -- ambiguous one rather than returning NULL. The catalogue lookup answers the
  -- question that was actually being asked.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cron' and p.proname = 'schedule'
  ) then
    raise notice '121: pg_cron is not installed — the push delivery schedule was NOT created. That is expected today (task 3.22 is an owner action) and this migration is complete without it. Re-run the do-block at 121 §10 after `create extension pg_cron;`.';
    return;
  end if;

  begin
    execute $c$select cron.unschedule('push-delivery')$c$;
  exception when others then
    null;  -- not scheduled yet; the point is to be re-runnable
  end;

  -- One minute (Q1's default, D2's stated latency). Sub-minute scheduling is a
  -- tuning change from here rather than a redesign.
  execute $c$select cron.schedule('push-delivery', '* * * * *',
                                  'select private.push_delivery_tick()')$c$;
end
$schedule$;

-- ===========================================================================
-- §Verification — run these against the project after applying, do not assume
-- ===========================================================================
--
-- Expected: 0 — no policies at all (§2). Adding one is the repair to refuse.
--   select count(*) from pg_policies where tablename = 'push_deliveries';
--
-- Expected: t — RLS on, so the absence of policies denies rather than allows
--   select relrowsecurity from pg_class where oid = 'public.push_deliveries'::regclass;
--
-- Expected: f for every cell — scoped to the grantee on purpose, since postgres
-- owns the table and an unscoped form always returns true
--   select r, p, has_table_privilege(r, 'public.push_deliveries', p)
--     from unnest(array['authenticated','anon','service_role']) r,
--          unnest(array['select','insert','update','delete']) p;
--
-- Expected: 4 kept · 4 revoked — CLAUDE.md's service_role census moves by one
--   select count(*) filter (where sr) as kept, count(*) filter (where not sr) as revoked,
--          string_agg(relname, ', ' order by relname) filter (where not sr) as revoked_tables
--     from (select c.relname, has_table_privilege('service_role', c.oid, 'SELECT') as sr
--             from pg_class c join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname='public' and c.relkind='r') t;
--
-- Expected: t,t,t,t then f,f,f,f then f,f,f,f — 031's shape, by grantee
--   select has_function_privilege('service_role', f, 'execute')
--     from unnest(array['public.push_payload_for(uuid)',
--                       'public.claim_push_batch(int)',
--                       'public.complete_push_delivery(uuid,text,text[])',
--                       'public.invalidate_push_device(text)']) f;
--
-- Expected: {search_path=""} on all five public functions — stored WITH the
-- quotes, and an assertion matching the unquoted form reads 0 and passes as
-- "unpinned"
--   select proname, prosecdef, proconfig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('push_payload_for','claim_push_batch','complete_push_delivery',
--                      'invalidate_push_device','sweep_push_retention');
--
-- Expected: 1 — the enqueue trigger exists, and it carries no WHEN clause
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.notifications'::regclass and tgname = 'enqueue_push_delivery';
--
-- Expected: 0 — no cron job today, and that is the correct state until the
-- owner installs the extension and re-runs §10's block
--   select count(*) from pg_extension where extname in ('pg_cron','pg_net');
--
-- ---------------------------------------------------------------------------
-- The advisor sweep, and what to expect from it
-- ---------------------------------------------------------------------------
-- ** ONE new INFO: `rls_enabled_no_policy` on `push_deliveries` ** (§2), which
-- is correct by design and belongs in CLAUDE.md's expected-advisor table beside
-- `push_devices` and `password_reset_grants`.
--
-- ** AND NO NEW `authenticated_security_definer_function_executable` WARN. **
-- That advisor fires once per `security definer` function `authenticated` may
-- execute, and this file adds NINE definer functions of which `authenticated`
-- may execute exactly ZERO — every one is granted to `service_role` by name or
-- to nobody at all. `078` added two and moved that count by two; this one must
-- not move it at all. A WARN appearing here means a grant was written wrong.
