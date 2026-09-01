-- 100: the two club-thread fan-outs test the RECIPIENT'S membership, not the
--      thread's authorship.
--
-- Fixes a defect found in `098` at pre-merge review. `098` is applied to DEV and
-- is never edited; this file is the correction, and it is one `create or
-- replace` per fan-out plus two database comments. No DDL on any table, no
-- policy, no grant, no CHECK, no index, no new type, no new function and no
-- trigger DDL — `create or replace` keeps each function's OID and the two
-- triggers on `public.club_messages` and `public.club_thread_waves` reference
-- them by OID, so the existing bindings survive untouched.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, and the one sentence in `098` that produced it
-- ---------------------------------------------------------------------------
-- `098`'s `private.notify_club_thread_replied` and
-- `private.notify_club_thread_waved` resolve the recipient as
-- `club_threads.author_id` with no membership predicate:
--
--     from public.club_threads t
--    where t.id = new.thread_id
--      and t.author_id <> new.author_id
--      and not private.is_blocked(new.author_id, t.author_id)
--
-- `098_a_club_thread_notifies.sql` lines 519-526 justify the absence of a
-- type-scoped read disjunct like `089`'s and `093`'s with:
--
--     "the recipient AUTHORED the thread, which `club_threads` INSERT required
--      membership for, so the ordinary conjunct resolves at the moment the row
--      is written."
--
-- ** THAT SENTENCE IS FALSE, AND THIS HEADER EXISTS BECAUSE `098`'s WILL KEEP
-- ASSERTING IT. ** Membership was required when the THREAD was created. It is
-- not required when the REPLY is written, and those are two different instants
-- with an arbitrary amount of rider behaviour in between. `club_threads` holds
-- no foreign key to `club_members` on `author_id` — a thread belongs to a club,
-- not to a membership — so leaving a club deletes nothing an ex-member wrote.
--
-- ** THE BAD STATE IS REACHABLE IN ONE REQUEST, AND WAS MEASURED RATHER THAN
-- ARGUED. ** On DEV, 2026-09-01, in a rolled-back transaction, as
-- `authenticated`, through the app's own policies at every step:
--
--   A opens a thread in club C  ->  A deletes their own `club_members` row
--   (`club_members` DELETE is a bare `auth.uid() = user_id`)  ->  B replies,
--   and B waves.
--
--   rows WRITTEN to A ........................... 1 `club_thread_replied`
--                                                 1 `club_thread_waved`
--   rows A can READ ............................. 0
--   `club_threads` rows A can read .............. 0
--
-- Unreadable from the instant it is written, for ever, and accumulating one row
-- per distinct replier and one per distinct waver. `club_threads` SELECT is
-- `EXISTS(clubs) AND private.is_club_member(club_id) AND (author_id = auth.uid()
-- OR NOT private.is_blocked(...))` — the author's own-row test sits INSIDE the
-- block conjunct and the membership one dominates it — so `098`'s own new SELECT
-- conjunct on `notifications`, `exists (select 1 from public.club_threads st
-- where st.id = thread_id)`, can never return the row to A.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A DEFECT AND NOT THE EVICTION `098` DELIBERATELY CHOSE
-- ---------------------------------------------------------------------------
-- ** THESE ARE TWO DIFFERENT STATES AND COLLAPSING THEM IS HOW THE FIX GETS
-- TALKED OUT OF EXISTENCE. ** `openspec/changes/notify-a-club-thread/proposal.md`
-- Q8 was put to the product owner and answered: a notification that WAS readable
-- when it was written and stops being readable when its recipient leaves the
-- club is an EVICTION. Nothing deletes it, rejoining returns it with its
-- original `created_at` and read state, and `098.14` asserts exactly that. That
-- behaviour is correct and this file does not touch it — no row that `098` would
-- have written to a rider who was a member at the time stops being written here.
--
-- The state above is the other one. `.../specs/event-fanout-integrity/spec.md`:
--
--     "A row the policy drops on every read from the instant it is written SHALL
--      be treated as a defect in the fan-out, not as a row awaiting a policy
--      change."
--
-- WAS-READABLE-THEN-EVICTED stays. NEVER-READABLE is this file. The test that
-- separates them is whether the recipient could read the row at the instant of
-- the write, which is precisely what the predicate below now asks.
--
-- ** `097` MULTIPLIES THE POPULATION, WHICH IS WHY NO SINGLE STORY'S REVIEW
-- COULD SEE THIS. ** `097` makes the ex-member-authored thread a designed,
-- first-class state rather than an edge: a leave NULLs `introduces_user_id`, the
-- words survive, and every render is deliberately keyed on the text so an
-- ex-member's introduction keeps drawing and keeps attracting replies. `098`
-- shipped a fan-out at those threads a day later.
--
-- ---------------------------------------------------------------------------
-- THE PREDICATE, and why it is the RIGHT one rather than merely A one
-- ---------------------------------------------------------------------------
--     and private.is_club_member_for(t.author_id, t.club_id)
--
-- `085`'s subject-taking twin, against the RECIPIENT and the thread's own club.
-- It is not a membership-table lookup and must not be replaced by one. Read off
-- DEV with `pg_get_functiondef` rather than recalled:
--
--   private.is_club_member(target_club_id)
--     -> select private.is_club_member_for(auth.uid(), target_club_id);
--
--   private.is_club_member_for(candidate, target_club_id)
--     -> exists (select 1 from public.club_members
--                 where club_id = target_club_id and user_id = candidate)
--        or exists (select 1 from public.clubs
--                    where id = target_club_id and owner_id = candidate);
--
-- `club_threads` SELECT's resolving arm IS `private.is_club_member(club_id)`,
-- evaluated as the reader. So `is_club_member_for(t.author_id, t.club_id)` is
-- that arm with the reader named explicitly: the recipient set is now EQUAL to
-- the set the read policy returns the row to, rather than a superset of it.
--
-- ** THE OWNER ARM IS LOAD-BEARING AND A `club_members`-ONLY TEST WOULD BE A
-- SECOND DEFECT IN THE OPPOSITE DIRECTION. ** `095` lets a club's owner delete
-- their own `club_members` row, so an OWNERLESS OWNER — owns the club, holds no
-- membership row — is reachable in one request. They CAN still read their own
-- thread, through `is_club_member_for`'s second arm, so they must still be
-- notified. Measured on DEV in the same rolled-back transaction: an ownerless
-- owner authoring a thread in their own club is written 1 + 1 rows by a member's
-- reply and wave, and reads both. `exists (select 1 from club_members ...)` in
-- place of the call below silently stops notifying them.
--
-- ** `private.is_club_member` ITSELF IS UNUSABLE HERE — `036` trap (c), and
-- `055`'s header spells it out at length. ** It reads `auth.uid()` internally,
-- so it answers "is the CALLER a member" and would apply the actor's own answer
-- to every candidate. The actor is a member by construction here (`club_messages`
-- and `club_thread_waves` INSERT both require it), so it would be TRUE for every
-- write from a real session and NULL-ish — not TRUE — in psql, in `seed.sql`,
-- in the RLS suite and inside every `security definer` writer. That is a
-- predicate that passes every positive assertion while testing nothing, and
-- fails every one where there is no JWT. The subject-taking twin has no such
-- environment dependence, which is why `085` created it.
--
-- ** `auth.uid()` STILL APPEARS NOWHERE BELOW. ** `036` trap (b). The actor is
-- `new.author_id` / `new.user_id`, the recipient and the club are read off
-- `public.club_threads`, and the membership question is asked BY NAME.
--
-- ** NO `when` CLAUSE IS ADDED, because no trigger DDL is issued at all. **
-- `036` trap (a): a `when (current_user = 'authenticated')` copied from `023`'s
-- gate is false inside every `security definer` writer, and `public.introduce_to_club`
-- (`097`) creates `club_threads` rows from exactly such a body.
--
-- ---------------------------------------------------------------------------
-- WHAT DELIBERATELY DOES *NOT* GET THIS PREDICATE
-- ---------------------------------------------------------------------------
-- ** `private.retract_club_thread_waved` IS LEFT ALONE, AND "apply it
-- consistently" IS THE WRONG INSTINCT THERE. ** Its job is to remove a row that
-- was already written. Add the membership test to it and this sequence orphans a
-- row for ever: the author is a member, B waves (row written), the author LEAVES,
-- B un-waves — the retraction would find no recipient and delete nothing, and
-- the row survives its own subject. The retraction is scoped by `user_id`,
-- `type`, `actor_id` and `thread_id` and must stay a pure inverse of the write.
-- `100.6` asserts the un-wave still reaches the row across a leave.
--
-- The `notifications` SELECT and UPDATE policies are NOT touched. `098` re-created
-- both whole and this file adds no disjunct to either — the recipient set is
-- being narrowed to the set the policy already returns to, which is the repair
-- the spec prescribes; widening the policy instead would produce a notification
-- that renders over a thread screen still refusing the rider, which `036`
-- forbids.
--
-- ---------------------------------------------------------------------------
-- BLAST RADIUS — a purely-additive reading of this file is wrong
-- ---------------------------------------------------------------------------
-- Two live write paths run new code inside the rider's own transaction from the
-- moment this applies: `insert into club_messages` (a reply in a club thread)
-- and `insert into club_thread_waves` (a wave on one). A raise in either takes
-- that rider's write down with it. Both were exercised by hand on DEV first, as
-- `authenticated`, in a rolled-back transaction, with rows counted — including
-- the leave-then-reply sequence, the still-a-member control and the ownerless
-- owner. `036`'s hand-exercise gate.
--
-- Ordering against a deploy: NONE. No client code names either function, no
-- column moves, no RPC appears or disappears, and the change is invisible to a
-- serving bundle except that a rider who left a club stops accruing rows they
-- could never see. Safe on either side of the build.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- §1  Fan-out 1 — a reply notifies the rider who started the thread, IF they
--     are still in the club
-- ---------------------------------------------------------------------------
-- `098`'s body verbatim with one conjunct added. Everything else about it is
-- deliberate and preserved: AFTER not BEFORE, so a write refused by RLS, by a
-- CHECK or by the participation gate produces nothing; `on conflict do nothing`
-- rather than an exception handler, so `notifications_event_key`'s expected
-- collision is absorbed without also hiding a real fault; `return null` because
-- an AFTER ROW trigger's return value is ignored; and the block conjunct kept
-- even though `club_threads` SELECT already makes it unreachable, because
-- blocking is applied twice by standing rule.
create or replace function private.notify_club_thread_replied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, thread_id)
  select t.author_id, new.author_id, 'club_thread_replied', new.thread_id
    from public.club_threads t
   where t.id = new.thread_id
     and t.author_id <> new.author_id
     and private.is_club_member_for(t.author_id, t.club_id)
     and not private.is_blocked(new.author_id, t.author_id)
  on conflict do nothing;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- §2  Fan-out 2 — a thread wave, the same shape one table over
-- ---------------------------------------------------------------------------
-- `club_thread_waves` names its rider `user_id` where `club_messages` names
-- theirs `author_id`; that remains the only difference between the two bodies,
-- and the new conjunct is character-for-character the same in both because it is
-- about the RECIPIENT, who is `club_threads.author_id` either way.
create or replace function private.notify_club_thread_waved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, thread_id)
  select t.author_id, new.user_id, 'club_thread_waved', new.thread_id
    from public.club_threads t
   where t.id = new.thread_id
     and t.author_id <> new.user_id
     and private.is_club_member_for(t.author_id, t.club_id)
     and not private.is_blocked(new.user_id, t.author_id)
  on conflict do nothing;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- §3  The revokes, re-issued
-- ---------------------------------------------------------------------------
-- `create or replace` PRESERVES existing privileges, so against a database
-- carrying `098` these are no-ops. They are re-issued for the reason `099`
-- re-issues its own: it costs nothing and it makes this file correct in
-- isolation, including on the scratch database the RLS suite replays the chain
-- onto. `031`'s lesson is that the assertion which catches a regression here
-- names a ROLE rather than calling the function; `100.5` does.
revoke all on function private.notify_club_thread_replied() from public, anon, authenticated, service_role;
revoke all on function private.notify_club_thread_waved()   from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- §4  The comments — the one piece of documentation no edit to a doc file can
--     reach
-- ---------------------------------------------------------------------------
-- `098` left both functions uncommented, so `098`'s false justification lives
-- only in a file nobody reads at debug time. These put the corrected rule where
-- `\df+` and `obj_description` will show it. `028`, `033` and `055` are the
-- precedent; `100.7` asserts them.
comment on function private.notify_club_thread_replied() is
  'Notifies club_threads.author_id when someone else replies. The recipient must '
  'STILL be in the club at the instant of the reply — private.is_club_member_for '
  '(the subject-taking twin, which unions the clubs.owner_id arm so an ownerless '
  'owner still qualifies), never private.is_club_member, which reads auth.uid() '
  'and would answer for the ACTOR. Authoring the thread is NOT sufficient: '
  'club_threads has no FK to club_members, so a rider who leaves keeps their '
  'threads, and club_threads SELECT would drop the notification on every read '
  'from the instant it was written. 100, correcting 098.';
comment on function private.notify_club_thread_waved() is
  'Notifies club_threads.author_id when someone else waves the thread. Same '
  'recipient rule and same reason as private.notify_club_thread_replied: the '
  'recipient must still be in the club at the instant of the wave, tested with '
  'private.is_club_member_for against the thread''s author and the thread''s club. '
  'private.retract_club_thread_waved deliberately carries NO such test — it is '
  'the inverse of a write that already happened, and a membership test there '
  'would orphan a row whose recipient left between the wave and the un-wave. '
  '100, correcting 098.';
