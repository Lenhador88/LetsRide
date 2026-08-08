-- 036: Notifications — one table, one read policy, and six fan-out triggers.
--
-- Linear PD-118; the proposal is openspec/changes/add-notifications/, and the
-- two capability specs under specs/notifications/ and
-- specs/event-fanout-integrity/ are the contract this file implements.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING: additive in schema, and NOT inert
-- ---------------------------------------------------------------------------
-- Every migration this repo has applied lately has been safe to run at any
-- moment because nothing existing executed it. `034` added a table that sat
-- unused until the code shipped, which is why it could go to PROD ahead of the
-- promotion. **This one is the opposite and the reading a reviewer will default
-- to — "purely additive" — is wrong.**
--
-- Six of the triggers below hang off five write paths that are shipped and in
-- daily use:
--
--     postcard_likes     INSERT and DELETE  -> like / unlike
--     postcard_comments  INSERT             -> comment
--     ride_members       INSERT             -> RSVP
--     rides              INSERT             -> create a ride
--     club_members       INSERT             -> join a club, and create a club
--
-- From the moment this applies, every one of those runs new code **inside the
-- rider's own transaction**, and a fan-out that raises takes that rider's write
-- down with it. That is deliberate (§D8: a swallowed fan-out failure is a gap
-- with nothing to detect it), and it is why the order is DEV first, all five
-- paths exercised by hand, then PROD — the reverse of `034`.
--
-- Rollback is: drop the six triggers FIRST, then their functions, then the
-- table. Dropping the table alone leaves triggers whose functions reference a
-- missing relation, which turns every like into an error.
--
-- ---------------------------------------------------------------------------
-- Why this table needs a proposal and none of the other fifteen did
-- ---------------------------------------------------------------------------
-- **A notification is a second copy of a visibility decision, and it outlives
-- the decision that produced it.** A club_members row is re-checked on every
-- read. A notification row is written once, at fan-out, and read for ever
-- afterwards — by which time the rider may have left the club, blocked the
-- actor, or lost the ride. So this is the first table in the schema whose
-- correctness at write time says nothing about its correctness at read time,
-- and §3's SELECT policy re-asks the whole question on every read.
--
-- It also inverts the pin every other table in this schema relies on. Postcards,
-- rides, likes, comments and messages all pin their rows to their writer —
-- `auth.uid() = author_id` — and that pin is what makes a client-owned mutation
-- path safe. A notification is addressed to **somebody else**, which no policy
-- in this schema can express and no client may be trusted to do. Hence a
-- `security definer` trigger, and hence §5's absent INSERT grant.
--
-- ---------------------------------------------------------------------------
-- RETENTION: as long as the subject exists
-- ---------------------------------------------------------------------------
-- Stated here in those words because a table recording that a named rider
-- interacted with another named rider's content at a named instant is personal
-- data, and CLAUDE.md requires a window at creation rather than retrofitted.
--
-- **The window is the cascade window.** A row dies with its subject, its actor
-- and its recipient — six `on delete cascade` foreign keys — and with nothing
-- else. There is no `pg_cron` and no scheduled Edge Function in this project, so
-- a time-based sweep cannot be enforced by this migration and is therefore not
-- claimed by it. An earlier draft carried "90 days as the intent" beside this
-- sentence: two windows in two files, and a number nothing implements becomes a
-- fact nobody rechecks. The sweep is a filed follow-up and it carries no number.
--
-- Unlike every other retention claim one could write, this one is *verifiable*:
-- delete a postcard, a comment, a ride, a club, an actor or a recipient and
-- count. §7 asserts each.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access         -> both policies `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS  -> private.is_blocked at fan-out AND at read
--   #5 onboarding gates participation -> see §6 on the gate this table does NOT carry
--   #7 username is the display name -> nothing here stores a name (§2)
--   #8 Supabase with RLS is the backend -> no service-role path writes a row

-- ---------------------------------------------------------------------------
-- §1. The table
-- ---------------------------------------------------------------------------
-- **The subject is four typed nullable FK columns, not a polymorphic
-- `subject_id` + `subject_type`.** The polymorphic shape is what the issue
-- sketched and it is internally contradictory: a polymorphic column can carry no
-- foreign key, so "on delete cascade on every FK" — which the same issue
-- requires, correctly — is unsatisfiable in it. Deleting a postcard would leave a
-- notification pointing at nothing, with no constraint to notice and no cascade
-- to clean it. The three alternatives are all worse: five hand-written cleanup
-- triggers doing what one FK does by definition; tolerating dangling rows and
-- filtering at read, which *appears* to work while the table grows for ever with
-- rows nothing can delete; or a trigger-maintained `subject_exists` boolean,
-- which is a denormalised copy of a fact and is the exact thing §2 forbids.
--
-- The costs are real and are stated rather than hidden: four columns where one
-- would do, a CHECK per type that must be extended whenever a type is added, and
-- a uniqueness index spanning seven columns. All three fail *at the point of
-- change* — adding a type without extending the CHECK is refused immediately —
-- which is the property the polymorphic version lacks.
--
-- **No `updated_at`, deliberately, and this is the one place the repo's own
-- convention has to be argued rather than followed.** CLAUDE.md asks for
-- `updated_at` on anything editable so a sync layer has something to resolve
-- against. The only editable column here is `read_at`, which *is* a timestamp
-- and is its own resolution marker; and there is no client INSERT at all, so the
-- offline-replay case the convention exists for cannot arise. Adding the column
-- would mean either granting the client UPDATE on it — a second writable column
-- on a table whose premise is that riders cannot write — or a trigger to
-- maintain a value nothing reads. `034` refused the same column for the same
-- reason: a dead column that reads as live is a trap for the next session.
create table public.notifications (
  id uuid default uuid_generate_v4() primary key,

  -- The recipient. Cascade, so a departing rider takes every notification TO
  -- them; `actor_id` cascades so they also take every notification ABOUT them,
  -- out of every other rider's list. Both directions are required by the
  -- account-deletion contract and neither is visible in the other's key.
  user_id  uuid references public.profiles(id) on delete cascade not null,
  actor_id uuid references public.profiles(id) on delete cascade not null,

  type text not null,

  -- The subject columns. Each nullable, each cascading, and which of them are
  -- non-NULL is fixed per type by notifications_subject_shape below.
  postcard_id uuid references public.postcards(id)         on delete cascade,
  comment_id  uuid references public.postcard_comments(id) on delete cascade,
  ride_id     uuid references public.rides(id)             on delete cascade,
  club_id     uuid references public.clubs(id)             on delete cascade,

  -- Server time, always, and unforgeable for a reason stronger than `034`'s: a
  -- default only applies when the column is omitted and a client can name it,
  -- but here the client holds no INSERT grant of any kind (§5), so there is no
  -- statement in which it could name anything. Ordering never depends on a
  -- device clock.
  created_at timestamptz default now() not null,

  -- NULL is unread. The only column a rider may write, and only their own — §5
  -- grants UPDATE on this column alone, §4 scopes it to their own rows.
  read_at timestamptz,

  constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club')
  ),

  -- Which subject columns each type carries, stated once, here, so the SELECT
  -- policy in §3 can be written per COLUMN rather than per type and the two
  -- cannot drift apart.
  --
  -- `else false` is load-bearing rather than defensive tidiness: a bare CASE
  -- with no ELSE returns NULL for an unmatched type, and a CHECK passes on NULL.
  -- So without it, adding a sixth type to the CHECK above and forgetting this
  -- one would silently admit a row with no subject at all — which the policy
  -- would then return with nothing to render. With it, that mistake is a 23514
  -- on the first insert.
  constraint notifications_subject_shape check (
    case type
      when 'postcard_liked' then
        postcard_id is not null and comment_id is null
        and ride_id is null     and club_id is null
      when 'postcard_commented' then
        postcard_id is not null and comment_id is not null
        and ride_id is null     and club_id is null
      when 'ride_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'club_joined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'ride_created_in_club' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is not null
      else false
    end
  )
);

alter table public.notifications enable row level security;

comment on table public.notifications is
  'One row per (recipient, event), written ONLY by the six fan-out triggers in 036 — `authenticated` holds no INSERT grant at all, which is what makes the trigger the only writer. Readable by its recipient and by nobody else, including the actor. Ids only, never denormalised text: a name snapshot is a second copy of a visibility decision that nothing re-checks. Retention is the cascade window — a row lives as long as its subject, its actor and its recipient do, and nothing else deletes one.';

comment on column public.notifications.club_id is
  'The club this notification concerns. A SUBJECT for club_joined, and CONTEXT for ride_created_in_club, whose copy names the club while its destination is the ride — which is why that type sets both this and ride_id, and why the SELECT policy requires BOTH to resolve. Note the deliberate disagreement with rides.club_id, which is ON DELETE SET NULL: deleting a club leaves the ride alive and takes this row, because "created a ride in <club>" is unrenderable once the club is gone.';

comment on column public.notifications.read_at is
  'NULL is unread. The only column `authenticated` may write, via a column-level UPDATE grant (§5) scoped to their own rows by a policy identical to SELECT''s (§4). Setting it back to NULL is permitted: it affects only the rider''s own read state and no other rider can observe it.';

-- ---------------------------------------------------------------------------
-- §2. No denormalised text. Ever.
-- ---------------------------------------------------------------------------
-- There is no `club_name`, `ride_title`, `actor_username`, `body` or `title`
-- column above, and that is the single most important thing about the shape.
--
-- A `title text` snapshot would remove one join per row and would be wrong the
-- moment any membership changed: a rider who left a private club would keep
-- reading its name out of a row they own, for ever, with nothing to re-check it
-- and nothing in review to notice — because the value really was true when it
-- was written. Every rendered string naming a club, ride, postcard or rider is
-- read from that resource, at render time, under the reader's own row security.
--
-- The render cost is one embed on a bounded page. The alternative cost is a leak
-- that looks correct in the table.

-- ---------------------------------------------------------------------------
-- §3. SELECT — the recipient, and only while every rendered resource resolves
-- ---------------------------------------------------------------------------
-- Four conjuncts, and the last three are the ones a later reviewer will try to
-- remove as redundant. Each is here because a fan-out-time check answers "is
-- this visible now" and the row is read at a *later* now.
--
--   1. `user_id = auth.uid()` — the recipient, and nobody else. This is
--      narrower than every other table in this schema, all of which admit some
--      second party. The actor learns nothing: not that the row exists, not that
--      it was delivered, not that it was read. A postcard's author cannot
--      enumerate who was notified about their own postcard.
--
--   2. `not private.is_blocked(auth.uid(), actor_id)` — blocking applied a
--      SECOND time, at read. Fan-out already refuses to write for a blocked
--      pair; this is what handles a block created AFTER the row, which a
--      fan-out-only design fails silently. Symmetric from one directional row,
--      so one call covers both directions (decision #2).
--
--   3. `exists (... profiles ...)` — the ACTOR is a rendered resource. Every
--      row's copy begins with the actor's username, so a row whose actor does
--      not resolve renders nothing and must not be returned or counted.
--
--      **This is not redundant with conjunct 2, and the reason is a live hole
--      in another table.** `profiles` SELECT is
--      `(auth.uid() = id) or (username is not null and not is_blocked(...))`,
--      and any rider can null their own username in ONE request:
--      `has_column_privilege('authenticated','public.profiles','username',
--      'UPDATE')` is true, the CHECK is `username is null or username ~ ...`
--      which NULL passes, and `enforce_onboarding_completion` pins completion
--      and returns early for an already-onboarded rider before it ever reaches
--      the column. All measured 2026-08-07. So there is a second way out of
--      `profiles` SELECT that has nothing to do with blocking. Without this
--      conjunct the row is counted and cannot be drawn — a badge over an empty
--      row. The hole itself is filed rather than fixed here: a column-privilege
--      change on `profiles` is not this migration's blast radius, and this
--      contract behaves correctly whether it is open or shut.
--
--   4. `<column> is null or exists (...)` per subject column — the subject, or
--      subjectS. **Written per COLUMN rather than per TYPE on purpose**, because
--      notifications_subject_shape already fixes which columns each type
--      carries, so the column form IS the per-type table and cannot drift from
--      it. Reproduced here so the equivalence is checkable by eye:
--
--        postcard_liked        -> profiles, postcards
--        postcard_commented    -> profiles, postcards AND postcard_comments
--        ride_joined           -> profiles, rides
--        club_joined           -> profiles, clubs
--        ride_created_in_club  -> profiles, rides AND clubs
--
--      **A type is not limited to one subject table, and specifying it as one is
--      how a leak gets specified.** `ride_created_in_club` renders two
--      resources: the club's name in the copy, the ride as the destination.
--      Naming one table per type forces a choice and both choices are wrong —
--      `clubs` alone leaks a public club's PRIVATE ride (the row renders
--      "created a ride in <club>" for a ride the rider cannot open), and `rides`
--      alone leaves the club name unrenderable. It is a conjunction.
--
--      **Do not collapse it on the grounds that ride-visibility implies
--      club-visibility.** That holds against the `rides` policy as it reads
--      today, and that policy has already been rewritten twice — by 017 and by
--      022 — with nothing constraining it to keep the property. The conjunction
--      is cheap and does not go stale; the derivation does.
--
-- Every EXISTS runs under the CALLER's own row security, so each one re-uses the
-- subject's real SELECT policy rather than restating any of it. That is
-- `postcard_comments` inheriting its postcard's audience via EXISTS (011),
-- applied once per typed subject column.
--
-- **Why this composes rather than locking a recipient out of their own
-- notification** — the own-row arm of each parent policy is what makes it work,
-- and it is worth checking rather than assuming:
--
--   postcard_liked / _commented : `postcards` SELECT's FIRST arm is
--       `author_id = auth.uid()`, ahead of hides and blocks. So an author who
--       has HIDDEN their own postcard still reads every notification about it —
--       `postcard_hides` is an input to the *other* arm only. Asserted, because
--       it is only the ordering of that policy's arms that makes it come out
--       this way.
--   ride_joined                 : `rides` SELECT's first arm is
--       `organizer_id = auth.uid()`.
--   club_joined                 : `clubs` SELECT is
--       `is_public or owner_id = auth.uid() or is_club_member(id)` — the owner
--       arm is what makes §7's owner union safe for THIS type.
--   ride_created_in_club        : `rides` SELECT's club arm is
--       `club_id is not null and private.is_club_member(club_id)`, which has NO
--       owner arm — which is why the owner union is NOT safe for that type. See
--       §7.5.
--
-- **Do not remove any of these as "redundant with the fan-out check".** The
-- fan-out check is a statement about the past. At least four assertions in
-- supabase/tests/rls_test.sql fail without conjuncts 3 and 4.
create policy "Notifications are readable only by their recipient"
  on public.notifications for select to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id))
  );

-- ---------------------------------------------------------------------------
-- §4. UPDATE — the SAME predicate, in both USING and WITH CHECK
-- ---------------------------------------------------------------------------
-- Identical to §3, deliberately and not for symmetry. **No write path may reach
-- a row no read path returns.**
--
-- The obvious alternative — `user_id = auth.uid()` alone, so that "mark all
-- read" also clears evicted rows — is a disclosure channel. Under the wider
-- policy, `update notifications set read_at = now() where read_at is null`
-- touches rows SELECT hides, and the affected-row count is a number the rider
-- can compare against the list they were just shown. The difference is the count
-- of hidden rows, and the commonest reason a row is hidden is a block — which
-- decision #2 requires must never be revealed by any gap, count or marker. A
-- policy wider on write than on read IS that marker.
--
-- Its justification does not survive inspection either: an evicted row is in
-- neither the count nor the list, so leaving it unread has no observable effect,
-- and if the eviction is later reversed — block lifted, club rejoined, username
-- restored — the row returning UNREAD is the correct answer, because the rider
-- genuinely never saw it. "Marking a row the rider cannot see is inert" is an
-- argument that the widening buys nothing, not an argument for it.
--
-- Whether PostgREST surfaces the affected-row count on a PATCH is deliberately
-- NOT load-bearing here. A write reaching a row a read cannot is a contract
-- defect whether or not today's client library happens to expose the number, and
-- building on the library's current behaviour is how the defect returns with the
-- next @supabase/supabase-js minor.
--
-- The suite asserts the three expressions are textually identical, so a later
-- edit to one of them fails rather than drifting.
create policy "Riders mark only their own readable notifications read"
  on public.notifications for update to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id))
  )
  with check (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id))
  );

-- NO INSERT POLICY AND NO DELETE POLICY, and both absences are decisions.
--
-- INSERT: the client owns the mutation path now, so a client that can insert a
-- notification can FORGE one — "Zola liked your postcard" from a rider who did
-- not — and can decline to write the ones it should. Fan-out is an integrity
-- rule, and no integrity rule in this repo may live only in client code.
--
-- DELETE: `Inbox - Notifications` draws no dismiss, swipe or clear affordance on
-- any row, and a rider who could delete a notification could delete the evidence
-- that they were told something. Rows leave by cascade and by the §7.4
-- retraction, both of which are the database's decision rather than a rider's.

-- ---------------------------------------------------------------------------
-- §5. Grants — and the ABSENT INSERT grant is the actual enforcement
-- ---------------------------------------------------------------------------
-- RLS needs BOTH a table grant and a permitting policy, so the missing grant is
-- the outer gate and the missing policy the inner one. The grant is the half
-- that matters: **a policy written too permissively by a later migration cannot
-- open a door the grant never fitted.**
--
-- This is also the half the RLS suite cannot test by attempting a statement. The
-- suite runs as the TABLE OWNER, for whom neither the grant nor RLS applies, so
-- an attempted insert would SUCCEED and prove the opposite of what it claims.
-- Every grant assertion for this table names the ROLE —
-- `has_table_privilege('authenticated', 'public.notifications', 'INSERT')` —
-- which is 031's lesson and the exact shape of the bug 029 shipped.
--
-- UPDATE is a COLUMN grant on `read_at` alone, following 025's precedent on
-- `profiles` and 034's on `ride_messages`: one statement, refused at the door
-- with 42501 rather than silently rewritten, and nothing to keep in step. So a
-- rider cannot change `type`, `actor_id`, `user_id`, `created_at` or any subject
-- id on their own row — refused by the absence of a column grant, before any
-- policy is consulted.
--
-- Note the reading trap in the verification query below: a column-level UPDATE
-- grant does NOT appear in information_schema.role_table_grants at all, so that
-- view shows exactly one row (SELECT) and concluding "marking read is broken"
-- from it is wrong. Same shape as 034 §4b.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- §6. The participation gate this table deliberately does NOT carry
-- ---------------------------------------------------------------------------
-- 023 put `enforce_participation_gate` on eight tables and 034 added a ninth.
-- `notifications` is not a tenth, and the omission is deliberate twice over:
--
--   1. No client can insert at all (§5), so there is no rider write to gate.
--   2. **It would never fire even if it were attached.** The gate's trigger
--      carries `when (current_user = 'authenticated')`, and inside a
--      `security definer` function `current_user` is the OWNER — so on the only
--      insert path this table has, that clause is false. A gate that cannot
--      fire is worse than no gate, because it reads as coverage.
--
-- `enforce_participation_gate`'s own comment still says "nine BEFORE INSERT
-- triggers ... the five uncovered INSERT-policy tables are named in 023's
-- header", and both halves stay true after this migration: no trigger is added,
-- and `notifications` has no INSERT policy, so it is a third category rather
-- than a sixth uncovered table. Left unedited on purpose — 028 and 033 exist
-- because a database comment is the one piece of documentation no edit to
-- CLAUDE.md can reach, so it should change only when it becomes false.

-- ---------------------------------------------------------------------------
-- §7. Fan-out — five writers and one retraction
-- ---------------------------------------------------------------------------
-- Every function below is `security definer`, `set search_path = ''`, fully
-- schema-qualified, lives in `private`, and has EXECUTE revoked from `public`,
-- `anon` and `authenticated`.
--
-- **Definer rights are necessary, not stylistic, for two independent reasons.**
-- `authenticated` holds no INSERT grant (§5), so an invoker-rights trigger is
-- refused outright; and the row is addressed to somebody ELSE, so RLS must be
-- bypassed — which the owner's rights do because `relforcerowsecurity` is false
-- on all sixteen public tables. That bypass is the entire mechanism by which a
-- row addressed to a third party can be written at all.
--
-- **`private` rather than `public`**, so PostgREST cannot publish them and
-- `service_role` cannot reach them. 023 put its gate in `public` with EXECUTE
-- revoked and it adds no advisor, so either works; `private` is belt and braces,
-- matching is_blocked, is_club_member, is_club_public, is_ride_crew and
-- may_participate. The security-advisor count must therefore stay at EIGHT — a
-- new `authenticated_security_definer_function_executable` WARN means a function
-- landed in `public` or a revoke did not, and is a failed apply rather than a
-- finding to file.
--
-- ===========================================================================
-- THREE TRAPS THIS SCHEMA HAS ALREADY PAID FOR. Read before editing anything
-- below.
-- ===========================================================================
--
-- (a) **NO `when (current_user = ...)` CLAUSE ON ANY OF THE SIX TRIGGERS**, and
--     no `if current_user <> 'authenticated'` guard in any body. That clause is
--     CORRECT on 023's participation gate — a rule about what riders may write
--     must not refuse the app's own accessors — and WRONG here. A fan-out is not
--     a rule about the client; it must fire for every writer, including a seed,
--     a `security definer` RPC, a future admin task and `psql`. A notification
--     that silently does not happen for a privileged write is a gap with nothing
--     to detect it. Both shapes exist in this schema and both are right where
--     they are, which is exactly why the omission is recorded rather than left
--     to be inferred — an absent guard is otherwise indistinguishable from a
--     forgotten one.
--
-- (b) **`auth.uid()` APPEARS NOWHERE BELOW.** The actor comes from the inserted
--     row — `postcard_likes.user_id`, `postcard_comments.author_id`,
--     `ride_members.user_id`, `rides.organizer_id`, `club_members.user_id` —
--     and never from the session. This is a correctness bug waiting in the test
--     suite, not a style preference: `auth.uid()` is NULL wherever there is no
--     JWT (the RLS suite, psql, a seed, the Supabase MCP), so a self-suppression
--     written `where recipient <> auth.uid()` evaluates to NULL, which is not
--     TRUE, which filters out EVERY recipient. The fan-out would write nothing
--     in exactly the environment where it is asserted: every "the actor is not
--     notified" assertion passes vacuously while every "the recipient IS
--     notified" assertion fails looking like a policy problem. Reading NEW is
--     not weaker — each of those columns is already pinned to `auth.uid()` by
--     its own table's INSERT policy — and it is available in every context.
--
-- (c) **`private.is_club_member` AND `private.is_ride_crew` MUST NOT BE USED
--     HERE.** Both read `auth.uid()` internally, so each answers "is the CALLER
--     a member" and never "is this CANDIDATE a member". A fan-out reaching for
--     one computes the actor's own membership once and applies that single
--     answer to every candidate: the recipient set becomes either everybody or
--     nobody — and it looks correct in a one-member test, which is the worst
--     possible failure profile. Only `private.is_blocked(a, b)` and
--     `private.is_club_public(club)` take their subject as an argument, and they
--     are the only two a fan-out may call. §7.5's recipient set is therefore a
--     direct query against `club_members`.
--
-- Every fan-out uses `on conflict do nothing` rather than an
-- `exception when others` handler: the one expected collision (§8's uniqueness
-- index) is absorbed without a handler that would also hide a real fault. A
-- fan-out that raises takes the rider's transaction with it, deliberately — see
-- the header.
--
-- Every one is a single set-based statement rather than a loop. A 500-member
-- club creating a ride writes 500 rows in one statement inside the organizer's
-- own transaction while they wait; accepted at this size and recorded as a
-- measured expectation rather than an assumption. Revisit at four figures.
--
-- AFTER, not BEFORE: the parent row must exist before the FK resolves, and a
-- write refused by RLS, a CHECK or the participation gate must produce nothing
-- — which AFTER gives for free, because it never runs. `return null` because an
-- AFTER ROW trigger's return value is ignored.

-- --- §7.1  postcard_liked ---------------------------------------------------
create function private.notify_postcard_liked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, postcard_id)
  select p.author_id, new.user_id, 'postcard_liked', new.postcard_id
    from public.postcards p
   where p.id = new.postcard_id
     -- Self-suppression by rider id, from the row. Liking your own postcard
     -- notifies nobody.
     and p.author_id <> new.user_id
     -- Blocking, applied the FIRST of its two times. Symmetric, so this one
     -- call covers a block in either direction. The rider's own like still
     -- succeeds — a block suppresses the notification, not the action.
     and not private.is_blocked(new.user_id, p.author_id)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §7.2  postcard_unliked (the retraction) --------------------------------
-- Unliking retracts the notification rather than leaving one for an event that
-- has been undone. This is the ONLY retraction in the set and it is the
-- exception rather than a pattern to generalise — see §7.6 on why leaving a club
-- or a ride retracts nothing. The argument for this one is harassment, not
-- truthfulness: a like is a one-tap toggle, so without a retraction it is an
-- unbounded notification generator aimed at another rider.
--
-- ** SCOPED BY ALL FOUR KEY COLUMNS — user_id, type, actor_id, postcard_id —
-- AND NEVER BY A SUBSET. ** A delete scoped by `type + postcard_id` alone is a
-- write ONE RIDER CAN AIM AT ANOTHER RIDER'S ROW, in the one table in this
-- schema whose entire premise is that no rider can write to it: rider A unliking
-- would delete rider B's notification for the same postcard. A holds no grant on
-- `notifications` — but the trigger does, and the trigger is running on A's
-- delete. That is a forged write with the grant model perfectly intact, and it
-- is reachable with one tap by anyone who can see the postcard. `actor_id` is
-- what makes it A's own row; `user_id` is what stops a future type notifying
-- more than one recipient from being cleared wholesale.
--
-- The scope costs nothing: (user_id, type, actor_id, postcard_id) is a prefix of
-- §8's uniqueness index, so it is an index lookup either way.
--
-- ** IT ALSO FIRES ON CASCADED DELETES, AND THAT IS BOUNDED RATHER THAN
-- IGNORED. ** A postcard being deleted, or an account deletion reaching
-- `postcard_likes.user_id`, removes rows here too — once per row, inside the
-- deletion's own transaction. Harmless: the postcards join finds nothing once
-- the parent is gone, and the same notification rows are removed by
-- `notifications.postcard_id`'s and `.actor_id`'s own cascades anyway, so the
-- retraction is at worst redundant and never wrong.
--
-- ** DO NOT ADD A `pg_trigger_depth()` OR `TG_OP` GUARD TO SKIP THE CASCADE
-- CASE. ** A guard that skips the cascade case is one refactor away from
-- skipping the rider case, and the rider case is the whole feature.
create function private.retract_postcard_liked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   using public.postcards p
   where p.id = old.postcard_id
     and n.user_id = p.author_id
     and n.type = 'postcard_liked'
     and n.actor_id = old.user_id
     and n.postcard_id = old.postcard_id;
  return null;
end;
$$;

-- --- §7.3  postcard_commented -----------------------------------------------
-- The subject is the COMMENT, so two comments produce two rows and the
-- uniqueness index does not collapse them. That is correct: the recipient has
-- two things to read. It is also why `comment_id` is in the key at all.
create function private.notify_postcard_commented()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, postcard_id, comment_id)
  select p.author_id, new.author_id, 'postcard_commented', new.postcard_id, new.id
    from public.postcards p
   where p.id = new.postcard_id
     and p.author_id <> new.author_id
     and not private.is_blocked(new.author_id, p.author_id)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §7.4  ride_joined ------------------------------------------------------
-- The ORGANIZER only, per the proposal's Q1 default. The design fans this out to
-- every attendee — "joined a ride you also joined." — and organizer-only is the
-- quieter start; widening it is a recipient-set change with no schema impact, so
-- it can land later without a migration. The copy that goes with the narrower
-- set is "joined your ride."
--
-- INSERT only, so a going<->maybe change notifies nobody: a status change is an
-- UPDATE and there is no trigger on it. Leaving and rejoining does not re-notify
-- either — §8's index catches the second insert.
--
-- An organizer RSVPing to their own ride notifies nobody, whether the row is
-- inserted by the rider or seeded by a future creator-membership trigger.
create function private.notify_ride_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, ride_id)
  select r.organizer_id, new.user_id, 'ride_joined', new.ride_id
    from public.rides r
   where r.id = new.ride_id
     and r.organizer_id <> new.user_id
     and not private.is_blocked(new.user_id, r.organizer_id)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §7.5  ride_created_in_club ---------------------------------------------
-- ** RECIPIENTS ARE `club_members` ALONE — NOT UNIONED WITH `clubs.owner_id`.
-- THE ASYMMETRY WITH §7.6 IS DELIBERATE AND IS THE MOST IMPORTANT LINE IN THIS
-- FILE. **
--
-- The two recipient sets read as interchangeable and are not, and what differs
-- is the SUBJECT's policy rather than anything about the club:
--
--   `clubs` SELECT  = is_public or owner_id = auth.uid() or is_club_member(id)
--                                  ^^^^^^^^^^^^^^^^^^^^^ an owner arm
--   `rides` SELECT's only club arm =
--                     club_id is not null and private.is_club_member(club_id)
--   `private.is_club_member` body  =
--                     exists (select 1 from club_members
--                              where club_id = target and user_id = auth.uid())
--                                  <-- NO owner arm
--
-- A club's owner may hold no `club_members` row, and it takes ONE request rather
-- than a failed pair: `club_members` DELETE is a bare `(auth.uid() = user_id)`
-- with no owner carve-out, so any owner can leave their own club and keep
-- ownership deliberately. (`createClub`'s two non-transactional inserts are a
-- second route to the same state, not the only one.) A membership-only set does
-- drop such an owner — and for THIS type dropping them is correct, because the
-- read policy drops them too. Writing them a row produces one their own SELECT
-- policy discards on every read, for ever, for exactly the rider the union would
-- have been added for. **A row nobody can ever read is worse than no row:
-- nothing raises, no count moves, no assertion fails, and it accumulates until
-- its subject is deleted.**
--
-- ** THIS IS A CONSEQUENCE OF A PRE-EXISTING DEFECT, NOT A RULING THAT OWNERS DO
-- NOT WANT THE NOTIFICATION. ** An ownerless owner cannot see their own private
-- club's rides at all today, notifications or not, and `rides` INSERT's own
-- `with check` — `club_id is null or private.is_club_member(club_id)` — refuses
-- them a ride in their own club as well. Filed rather than fixed here.
-- `openspec/changes/enforce-creator-membership/` closes it from the other end by
-- seeding the row and guarding the delete; when it lands every owner holds a
-- membership row, the two sets coincide, and this narrowing becomes invisible
-- rather than needing reversal. **Neither change is sequenced on the other.**
--
-- Widening the SELECT policy to admit the owner is NOT the repair: it would make
-- the notification resolve while the ride's own screen still returns not-found.
-- A notification must never be the one surface that can see further than the app.
--
-- The `club_id is null` guard is in the BODY rather than as a trigger `when`
-- clause, and that is not arbitrary: keeping all six triggers free of any `when`
-- clause at all makes trap (a) above assertable as a flat "zero of the six carry
-- one", with nothing to mistake for a CURRENT_USER guard. It is belt and braces
-- either way — `where m.club_id = new.club_id` yields zero rows for a NULL club,
-- since NULL = anything is NULL — so a ride with no club writes nothing and its
-- creation succeeds normally. A public ride is NOT fanned out to every signed-in
-- rider; a ride with no club has no audience to address.
create function private.notify_ride_created_in_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is null then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, ride_id, club_id)
  select m.user_id, new.organizer_id, 'ride_created_in_club', new.id, new.club_id
    -- Index-served by club_members_pkey (club_id, user_id) — leading column.
    from public.club_members m
   where m.club_id = new.club_id
     -- By rider id, not by role: the organizer may hold any role.
     and m.user_id <> new.organizer_id
     and not private.is_blocked(new.organizer_id, m.user_id)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §7.6  club_joined ------------------------------------------------------
-- ** RECIPIENTS ARE `clubs.owner_id` UNION the `owner`/`admin` members — and
-- here the union IS safe, for the reason §7.5 spells out: `clubs` SELECT carries
-- an `owner_id = auth.uid()` arm, so the row resolves for an owner holding no
-- membership row. What differs between the two types is the subject's policy,
-- not the club. **
--
-- Ordinary members are NOT notified. A club with any real membership would
-- otherwise notify everyone on every join.
--
-- ** THE EXCLUSION IS AFTER THE UNION, NOT INSIDE ONE ARM OF IT. ** A rider can
-- qualify through both arms — as `clubs.owner_id` and as an `owner`-role
-- membership row — and excluding inside one arm leaves them in through the
-- other. This is exactly the club-creation path: `createClub` inserts the
-- creator's own `owner` row, so without suppression after the union **every club
-- creation immediately tells its creator that they joined their own club**,
-- which is the most visible possible defect and the easiest to ship.
--
-- The `admin` arm is unreachable through the client today and is built and
-- asserted anyway: `club_members` INSERT admits `member`, or `owner` for the
-- club's own `owner_id`, and there is NO UPDATE policy on the table at all — so
-- nobody can insert an admin and nobody can promote one, and zero exist
-- (measured 2026-08-07). It ships the day invitations do.
--
-- Leaving a club retracts nothing: the notification survives the actor's
-- departure, and the recipient keeps reading "joined club <club>" about a rider
-- who has since left. That is correct — the row records an EVENT AT AN INSTANT,
-- which `created_at` is, and not a standing claim about the present. No
-- `after delete` trigger is added on `club_members` or `ride_members`, because a
-- retraction hanging off a DELETE the ACTOR controls is a rider-aimed delete of
-- another rider's row in a table no rider may write — the hazard §7.2's scoping
-- exists to bound, accepted once for likes and not a second time.
create function private.notify_club_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select candidates.recipient, new.user_id, 'club_joined', new.club_id
    from (
      select c.owner_id as recipient
        from public.clubs c
       where c.id = new.club_id
      union
      select m.user_id
        from public.club_members m
       where m.club_id = new.club_id
         and m.role in ('owner', 'admin')
    ) candidates
   where candidates.recipient <> new.user_id
     and not private.is_blocked(new.user_id, candidates.recipient)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §7.7  Comments and grants on the fan-out functions ---------------------
comment on function private.notify_postcard_liked() is
  'Fan-out: a like notifies the postcard''s author (036). Actor from NEW.user_id, never auth.uid(). security definer because authenticated holds no INSERT grant on notifications and the row is addressed to somebody else.';
comment on function private.retract_postcard_liked() is
  'Retraction: an unlike removes exactly the row the matching insert wrote (036), scoped by all four of user_id, type, actor_id and postcard_id. A subset scope would let one rider''s unlike delete another rider''s notification. Also fires on cascaded deletes, which is bounded and redundant rather than wrong — do not add a pg_trigger_depth guard.';
comment on function private.notify_postcard_commented() is
  'Fan-out: a comment notifies the postcard''s author (036). Subject is the comment, so two comments produce two rows.';
comment on function private.notify_ride_joined() is
  'Fan-out: an RSVP notifies the ride''s organizer and nobody else (036). INSERT only, so a going<->maybe change notifies nobody.';
comment on function private.notify_ride_created_in_club() is
  'Fan-out: a club ride notifies that club''s MEMBERS — deliberately NOT unioned with clubs.owner_id, unlike club_joined. rides SELECT''s only club arm is private.is_club_member, which has no owner arm, so a row written to an ownerless owner is one their own policy drops on every read, for ever. See 036 §7.5.';
comment on function private.notify_club_joined() is
  'Fan-out: a join notifies the club''s owner and its admins (036). The owner union IS safe here because clubs SELECT carries an owner_id = auth.uid() arm — the asymmetry with ride_created_in_club is about the subject''s policy, not the club. Exclusion of the actor happens AFTER the union, or every club creation notifies its own creator.';

-- Unreachable from any client role, and from `service_role` too. 031 granted
-- service_role USAGE on `private` so the deletion Edge Function could reach one
-- named function; every other helper there keeps its own revoke, and these six
-- are no exception. Revoking from `public` is what does the work, because
-- EXECUTE is granted to PUBLIC by default on function creation.
--
-- Asserted by naming the role with `has_function_privilege`, never by attempting
-- the call — the suite runs as the table owner, for whom the barrier does not
-- exist.
revoke all on function private.notify_postcard_liked()        from public, anon, authenticated;
revoke all on function private.retract_postcard_liked()       from public, anon, authenticated;
revoke all on function private.notify_postcard_commented()    from public, anon, authenticated;
revoke all on function private.notify_ride_joined()           from public, anon, authenticated;
revoke all on function private.notify_ride_created_in_club()  from public, anon, authenticated;
revoke all on function private.notify_club_joined()           from public, anon, authenticated;

-- --- §7.8  The six triggers -------------------------------------------------
-- ** NONE OF THESE CARRIES A `when` CLAUSE, AND THE OMISSION IS THE POINT. **
-- See trap (a) at the top of §7: copying 023's
-- `when (current_user = 'authenticated')` would be correct on a participation
-- gate and wrong here — the fan-out must fire for every writer, including the
-- seed the RLS suite runs as. Zero of the six is assertable as a flat count.
create trigger notify_postcard_liked
  after insert on public.postcard_likes
  for each row execute function private.notify_postcard_liked();

create trigger retract_postcard_liked
  after delete on public.postcard_likes
  for each row execute function private.retract_postcard_liked();

create trigger notify_postcard_commented
  after insert on public.postcard_comments
  for each row execute function private.notify_postcard_commented();

create trigger notify_ride_joined
  after insert on public.ride_members
  for each row execute function private.notify_ride_joined();

create trigger notify_ride_created_in_club
  after insert on public.rides
  for each row execute function private.notify_ride_created_in_club();

create trigger notify_club_joined
  after insert on public.club_members
  for each row execute function private.notify_club_joined();

-- ---------------------------------------------------------------------------
-- §8. Uniqueness — NULLS NOT DISTINCT, and it is load-bearing
-- ---------------------------------------------------------------------------
-- Most rows leave most subject columns NULL. **A plain UNIQUE treats two NULLs
-- as different, so the constraint would NEVER FIRE** and a like/unlike loop
-- would stack rows in another rider's list without limit — a harassment vector
-- behind no rate limit, and nothing in this app rate-limits anything. This is
-- 015's `feed_reads` lesson exactly, where a plain UNIQUE would have inserted a
-- second app-wide row on every visit. Postgres 15+; the project is on 17.
--
-- The typed-column shape gives the right collapse granularity for free: likes
-- collapse per postcard (comment_id NULL on both), comments do NOT collapse
-- because comment_id differs per comment. Two different riders doing the same
-- thing produce two rows, because actor_id is in the key.
--
-- Column order is not cosmetic. `(user_id, type, actor_id, postcard_id, ...)`
-- makes §7.2's four-column retraction an index-prefix lookup rather than a scan.
create unique index notifications_event_key
  on public.notifications
     (user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- §9. Indexes — the list, and one per cascade path
-- ---------------------------------------------------------------------------
-- Eight in total: the primary key, §8's uniqueness index, the list index below,
-- and one for each of the five foreign-key columns §8's index does not already
-- lead with. (`proposal.md` §Impact said "seven" while its own enumeration
-- listed eight; corrected there to eight on 2026-08-07. Edited here before the
-- PROD apply, which is the only window in which editing an applied migration
-- is free: DEV had already recorded the previous text, so DEV's stored
-- statement is one revision behind its file — the same asymmetry `034` carries,
-- and harmless for the same reason, since PROD gets the file verbatim.)
--
-- The list index carries `id desc` as a third column, and it is not decoration:
-- `created_at` is not a total order, and a single club fan-out writes every one
-- of its rows in ONE statement, so `now()` is identical across all of them. A
-- keyset cursor over `created_at` alone would skip or repeat rows at exactly
-- that boundary. The read orders by both, so the index has to carry both to stay
-- covering — `034` reasoned identically for `ride_messages`. It still LEADS with
-- `(user_id, created_at desc)`, which is what serves the unread count.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);

-- ** EVERY CASCADE PATH INTO THIS TABLE IS INDEXED, AND THE FOUR SUBJECT ONES
-- ARE THIS MIGRATION'S OWN DECISION RATHER THAN A CLAIM OF COMPLIANCE. **
--
-- `add-account-deletion` carries a standing rule — "every foreign key
-- referencing public.profiles SHALL have an index Postgres can use", and "when a
-- future migration adds a table referencing profiles it SHALL add the index in
-- the same file". `036` is the first table that rule applies to and it adds TWO
-- such keys. `user_id` is served by the list index above. `actor_id` is NOT
-- served by §8's uniqueness index, because it sits THIRD there and a non-leading
-- column cannot lead a lookup — so without the index below, every account
-- deletion is a sequential scan of every notification in the table.
--
-- The four subject keys reference postcards, postcard_comments, rides and clubs
-- rather than profiles, so that rule's literal text does not cover them. They
-- sit on the SAME cascade one level further down — deleting a rider cascades to
-- their postcards and rides, and each of those cascades here — so they are
-- indexed for the requirement's reason rather than under its letter.
--
-- ** These are not the speculative indexes `event-fanout-integrity` forbids. **
-- That prohibition is on an index for a READ QUERY no screen issues. A cascade
-- is a delete path with a standing requirement behind it, not a query anyone
-- chose to write. The two requirements collided in draft and neither named the
-- other; both do now.
--
-- ** Partial, on the column being non-NULL. ** Most rows leave most subject
-- columns NULL, so four plain indexes would enter every row into all four. A
-- partial index enters only the rows that use it, holding the fan-out's write
-- amplification at four entries per row (PK, uniqueness, list, actor) plus ONE
-- subject entry — two for `ride_created_in_club`, which sets both — instead of
-- eight. 015's `rides (club_id, created_at desc) where club_id is not null` is
-- the precedent already in this schema.
create index notifications_actor_id_idx
  on public.notifications (actor_id);

create index notifications_postcard_id_idx
  on public.notifications (postcard_id) where postcard_id is not null;

create index notifications_comment_id_idx
  on public.notifications (comment_id) where comment_id is not null;

create index notifications_ride_id_idx
  on public.notifications (ride_id) where ride_id is not null;

create index notifications_club_id_idx
  on public.notifications (club_id) where club_id is not null;

-- ---------------------------------------------------------------------------
-- §10. The unread count — SECURITY INVOKER, and that is the whole design
-- ---------------------------------------------------------------------------
-- ** `security definer` here is the badge-that-never-clears bug. ** A definer
-- count steps past the block predicate AND every resolvability conjunct in §3,
-- so it counts rows the list will never show: a dot the rider cannot clear, over
-- a screen that is empty, with no way for them to resolve it and no way to
-- report it usefully. Invoker rights mean the count reads through the SAME
-- policy the list reads through, so blocks, resolvability and recipient scoping
-- apply without being restated anywhere — the count and the list agree BY
-- CONSTRUCTION rather than by two implementations agreeing.
--
-- `club_unread_counts()` is `security invoker` for exactly this reason
-- (`prosecdef false`, measured) and copying it is the intended shape. It is also
-- why this adds no security advisor while sitting in `public` where PostgREST
-- publishes it: it can return nothing the caller could not already read.
--
-- Rejected: a denormalised `unread_count` on `profiles` — wrong for the same
-- reason likes and comments carry no denormalised count, and worse here, because
-- the correct value changes when NEITHER party acts (a block, a membership
-- change). Rejected: counting client-side from the fetched list — the list is
-- paginated and the count is not a property of a page. Rejected: a
-- `mark_notifications_read()` definer RPC — it buys no security, since the rider
-- may already write their own read state and §4 scopes it, while adding a
-- seventh `authenticated_security_definer_function_executable` advisor.
--
-- The `limit` bounds the scan exactly as `club_unread_counts` does. The design
-- draws a DOT with no text child — `v2 / Component / Notification`, 16x16
-- `Warning/100` — so the cap is invisible to the rider today; the capped integer
-- costs one limit over the same index and the Inbox epic will want the number.
-- `user_id = auth.uid()` restates the policy's own first conjunct on purpose:
-- it is what lets the planner use notifications_user_created_idx.
create function public.unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from (
      select 1
        from public.notifications n
       where n.user_id = auth.uid()
         and n.read_at is null
       limit 100
    ) capped;
$$;

comment on function public.unread_notification_count() is
  'Unread notifications for the caller, capped (036). SECURITY INVOKER, so it reads through the same SELECT policy the list does and the badge cannot disagree with the screen — a definer count would step past the block and resolvability conjuncts and produce a dot the rider can never clear.';

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
-- The suite runs on plain Postgres as the table owner, so it cannot see role
-- grants, exposed RPC endpoints or Supabase defaults. Each of these predicts a
-- number:
--
--   -- 2 — SELECT and UPDATE, both `to authenticated`. No INSERT, no DELETE.
--   select cmd, roles::text from pg_policies
--    where schemaname = 'public' and tablename = 'notifications';
--
--   -- 1 — the UPDATE predicate is the SELECT predicate, in USING and WITH CHECK
--   select count(distinct e) from (
--     select qual from pg_policies where tablename='notifications' and cmd='SELECT'
--     union all select qual from pg_policies where tablename='notifications' and cmd='UPDATE'
--     union all select with_check from pg_policies where tablename='notifications' and cmd='UPDATE'
--   ) t(e);
--
--   -- 0 — anon holds nothing, decision #1
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'notifications' and grantee = 'anon';
--
--   -- 1 — SELECT only. UPDATE is a COLUMN grant and does NOT appear here at
--   -- all; reading 1 and concluding "marking read is broken" is the wrong
--   -- conclusion. Same trap as 034 §4b.
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'notifications' and grantee = 'authenticated';
--
--   -- read_at, and nothing else
--   select column_name from information_schema.column_privileges
--    where table_name = 'notifications' and grantee = 'authenticated'
--      and privilege_type = 'UPDATE';
--
--   -- f, f, t, f — no insert, no delete, read_at writable, type not
--   select has_table_privilege('authenticated','public.notifications','insert'),
--          has_table_privilege('authenticated','public.notifications','delete'),
--          has_column_privilege('authenticated','public.notifications','read_at','update'),
--          has_column_privilege('authenticated','public.notifications','type','update');
--
--   -- 6 triggers, and 0 of them carrying a WHEN clause
--   select count(*) from pg_trigger
--    where tgrelid in ('public.postcard_likes'::regclass,
--                      'public.postcard_comments'::regclass,
--                      'public.ride_members'::regclass,
--                      'public.rides'::regclass,
--                      'public.club_members'::regclass)
--      and not tgisinternal and tgname like 'notify_%' or tgname = 'retract_postcard_liked';
--   select count(*) from pg_trigger
--    where not tgisinternal and tgqual is not null
--      and (tgname like 'notify_%' or tgname = 'retract_postcard_liked');
--
--   -- t x5 — every fan-out function is a definer, and f x18 — none reachable
--   select proname, prosecdef, proconfig from pg_proc
--    where pronamespace = 'private'::regnamespace
--      and (proname like 'notify_%' or proname = 'retract_postcard_liked');
--   select has_function_privilege('authenticated','private.notify_club_joined()','execute'),
--          has_function_privilege('anon','private.notify_club_joined()','execute'),
--          has_function_privilege('service_role','private.notify_club_joined()','execute');
--
--   -- f — the count is INVOKER, not DEFINER
--   select prosecdef from pg_proc where proname = 'unread_notification_count';
--
--   -- t — the uniqueness index treats NULLs as equal
--   select indnullsnotdistinct from pg_index
--    where indexrelid = 'notifications_event_key'::regclass;
--
--   -- 8 indexes
--   select count(*) from pg_indexes
--    where schemaname='public' and tablename = 'notifications';
--
--   -- 6 — every FK column leads an index of its own
--   select count(*) from pg_constraint c
--    where c.conrelid = 'public.notifications'::regclass and c.contype = 'f'
--      and exists (select 1 from pg_index i
--                   where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
--
--   -- t — RLS is on
--   select relrowsecurity from pg_class
--    where oid = 'public.notifications'::regclass;
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- EIGHT. A ninth means a function landed in `public` or a revoke did not, and is
-- a failed apply rather than a finding to file.
--
-- Then exercise all five write paths by hand — like, comment, RSVP, create a
-- ride in a club, join a club — and confirm each still SUCCEEDS and each writes
-- the rows above. That step is the whole reason this migration goes to DEV
-- first, and no query in this footer substitutes for it.
