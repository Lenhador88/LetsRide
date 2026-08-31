-- 092 — a rider waves at an arrival and at a conversation (PD-356, PD-299)
-- ===========================================================================
--
-- Product owner, 2026-08-31: *"an announcement, 'person X joined the club',
-- should also be some kind of discussion? People should then be able to say
-- welcome, etc… Also we may want to give a wave to those announcements?"* and
-- *"So maybe threads have the same wave, comment and share icons below?"*
--
-- Proposal: openspec/changes/club-timeline-engagement/. It extends PD-355
-- (`openspec/changes/add-club-timeline/`), which made the club detail a stream
-- of things that happened and left every entry on it inert.
--
-- Two narrow tables, six policies, two participation-gate triggers, one
-- fan-out, one retraction, and one new `notifications` type. Nothing else.
--
-- ---------------------------------------------------------------------------
-- "WAVE" IS THIS APP'S WORD FOR A LIKE, AND `postcard_likes` IS THIS SAME
-- TABLE UNDER THE OLDER NAME
-- ---------------------------------------------------------------------------
-- `LikeButton` renders `WaveIcon` — the motorcycle wave rather than a heart
-- (PD-228) — so the reaction this file adds is the one the app already has, on
-- two surfaces that did not have it. `009` §4 is the shape and this file
-- transfers its reasoning rather than re-deriving it: a composite-key table, an
-- `EXISTS` against the parent evaluated under the caller's own RLS, a symmetric
-- block arm on the REACTOR with an own-row escape hatch, a per-viewer count,
-- and no denormalised total anywhere.
--
-- The cost of the name is stated rather than hidden: the schema now holds two
-- names for one concept, and a session grepping `likes` finds one half. Both
-- `comment on table` statements below name `postcard_likes`, which is what
-- makes the split discoverable from either end. `postcard_likes` is NOT
-- renamed — renaming an applied table is a migration whose only benefit is
-- tidiness.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING: additive in SCHEMA, ordered by the CLIENT
-- ---------------------------------------------------------------------------
-- Every table, policy, grant and trigger below hangs off a relation that did
-- not exist a statement earlier, so **no existing write path runs new code**.
-- `036`'s hand-exercise gate still applies in its narrow form — the fan-out is
-- live for every wave from the moment this applies — but the four triggers this
-- file creates sit on two brand-new tables and none of them can fire for a
-- write anybody is making today.
--
-- **The ordering constraint is in the CLIENT, and it is `089`'s rule.**
-- `notificationCopy` and `NotificationsListItem`'s `describe` are exhaustive
-- switches, so ONE `club_waved` row landing while an older bundle is serving
-- takes that rider's whole notifications screen down. Apply this file only
-- after the bundle that knows the type is CONFIRMED SERVING on that project —
-- a `READY` deployment on the merge sha with `aliasError` null. "Merged" is not
-- "deployed"; `070`'s DEV apply landed 102 seconds after its merge commit, out
-- from under a Preview still calling what it had just dropped.
--
-- The one existing object this file modifies is `notifications`' pair of CHECK
-- constraints. That is a `drop constraint` / `add constraint` on a live table
-- and it is additive in the only sense that matters: the new predicate accepts
-- every row the old one did.
--
-- Rollback, IN THIS ORDER:
--   1. drop trigger retract_club_waved on public.club_join_waves;
--      drop trigger notify_club_waved  on public.club_join_waves;
--   2. drop function private.retract_club_waved(), private.notify_club_waved();
--   3. delete from public.notifications where type = 'club_waved';  -- BEFORE 4
--   4. restore both CHECK constraints to their eleven-type form (§2 records the
--      exact prior text, measured on DEV 2026-08-31);
--   5. drop table public.club_join_waves, public.club_thread_waves;
--   6. restore the `seventeen` comment on public.enforce_participation_gate().
-- Nothing else is owed: the two SELECT policies go with their tables at step 5.
-- Step 3 before step 4 is not optional: the narrowed `notifications_type_check`
-- is validated against existing rows and a live `club_waved` row makes the
-- `add constraint` fail.
--
-- ---------------------------------------------------------------------------
-- ** THE SELECT POLICIES DEPART FROM tasks.md §3.1's ORIGINAL SHAPE, ON THE
-- PRODUCT OWNER'S DECISION, AND THE DEPARTURE IS THE POINT **
-- ---------------------------------------------------------------------------
-- The `club-timeline-engagement` capability requires: *"A wave SHALL be
-- withdrawable by its author regardless of whether its subject is still
-- visible"* — scenario: *"the delete SHALL match the row rather than reporting
-- a silent success against zero rows"*.
--
-- `design.md` §D7 argued that holds for free because *"`user_id = auth.uid()`
-- is a disjunct of the SELECT policy"*. ** IT WAS NOT ONE. ** §3.1 as first
-- written put it inside the block arm — `<parent EXISTS> AND (user_id =
-- auth.uid() OR NOT is_blocked(...))` — where the parent `EXISTS` dominates it.
-- And it was a NO-OP even there: `blocks_no_self_block` (`009` §1) already
-- makes `is_blocked(x, x)` false, so a rider's own row was never the row that
-- arm could rescue. It read as a protection and was not one.
--
-- MEASURED on this chain (Postgres 16) before the fix: a rider blocked by a
-- thread's author, AND a rider who had merely LEFT the club, both read zero of
-- their own waves and both got `DELETE 0` with the row surviving — `081`'s
-- `club_messages` trap, on a table that was supposed to escape it. The rider's
-- toggle flips, the row stays, and every other member still sees the wave.
--
-- ** SO THE ARM IS HOISTED TO A DISJUNCT OF THE WHOLE POLICY ** — `009`'s own
-- `postcards` shape, where the author branch comes first and is unconditional
-- for exactly this reason. §3.1 carries the full argument at the site.
--
-- It discloses NOTHING new: the added disjunct returns only rows where
-- `user_id = auth.uid()`, the INSERT policy pins that column to the caller, and
-- no other writer exists — so every row it admits is one the caller wrote and
-- already knows about. Verified: the rider still cannot read the parent, and
-- still reads no other rider's wave.
--
-- ** THE BLAST RADIUS IS MEASURED RATHER THAN ARGUED. ** Against the whole RLS
-- suite the hoist moves exactly FOUR assertions and nothing else in 2566, and
-- all four are the ones describing the old behaviour. `092.6` now pins the
-- fixed behaviour, including the un-hoist detector named there.
--
-- ** `postcard_likes` CARRIES THE IDENTICAL LATENT DEFECT AND IS DELIBERATELY
-- NOT TOUCHED HERE ** — `009`'s policy has the same arm in the same wrong
-- place. It is filed separately; fixing it in this file would put an unrelated
-- policy change behind this change's ordering constraint.

-- ---------------------------------------------------------------------------
-- §0 PRE-FLIGHT, MEASURED ON `letsride-dev` (fpmrimzxadewsaiwpsel) 2026-08-31
-- ---------------------------------------------------------------------------
-- Every decision in this file rests on the state below, so it is recorded here
-- rather than in a report that does not travel with the file. Each line carries
-- the command that re-derives it.
--
--   select tablename, policyname, cmd, qual from pg_policies
--    where schemaname='public' and tablename in ('club_threads','club_members');
--
--   club_threads SELECT  "Club threads are readable by that club's members"
--     EXISTS(clubs c WHERE c.id = club_threads.club_id)
--     AND private.is_club_member(club_id)
--     AND (author_id = auth.uid() OR NOT private.is_blocked(auth.uid(), author_id))
--
--   club_members SELECT  "Club rosters follow club visibility"
--     (private.is_club_member(club_id)
--      OR EXISTS(clubs c WHERE c.id = club_members.club_id AND c.is_public))
--     AND (user_id = auth.uid() OR NOT private.is_blocked(auth.uid(), user_id))
--
-- ** THE PUBLIC-CLUB DISJUNCT ON THE SECOND AND ITS ABSENCE ON THE FIRST IS THE
-- ASYMMETRY THE WHOLE ROLE TABLE RESTS ON. ** A non-member of a PUBLIC club can
-- read that club's roster and therefore, in principle, waves on its joins; the
-- same rider reads NONE of its threads and therefore no thread wave. The two
-- halves differ, the difference is inherited rather than written here, and it
-- is not an oversight. It is also empty in practice — `ClubTimeline` issues no
-- member-only read for a non-member — but the POLICY is the boundary and the
-- screen is only the affordance.
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.club_members'::regclass and contype='p';
--   -- club_members_pkey  PRIMARY KEY (club_id, user_id)
--
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;   -- 17
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.notifications'::regclass and contype='c';
--   -- eleven types in notifications_type_check; eleven arms plus ELSE false in
--   -- notifications_subject_shape. Both reproduced verbatim in §2.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- * **No trigger on `club_members` minting a `club_threads` row.** The
--   auto-created welcome thread was declined on the merits, not deferred —
--   `design.md` §D2. `club_threads.author_id` is NOT NULL with no default and
--   every candidate author is wrong: the joiner may delete the thread others
--   welcomed them in (cascading their messages away), and the club owner as
--   author means the app has published a rider's username into a title no verb
--   can edit, that the named rider cannot delete, and that keeps naming them
--   after they leave. `058`'s welcome club would mint one thread per signup
--   besides, and carving it out leaves the rider with the emptiest app as the
--   only one guaranteed no welcome. The words half is a rider-initiated,
--   pre-filled compose with zero schema (§D3).
-- * **No `thread_id` column on `notifications`.** A thread wave notifies
--   nobody (§Q2). The column would owe an index, a shape arm and a cascade
--   path, for a signal the thread's own screen already shows.
-- * **No denormalised count.** `009` refused a `like_count` column and the
--   refusal transfers verbatim; see §1's table comments for the three
--   consequences that follow and what they forbid.
-- * **No `security definer` RPC and therefore NO NEW SECURITY ADVISOR.** Both
--   fan-out functions live in `private`, which PostgREST does not publish. A
--   new `authenticated_security_definer_function_executable` after this applies
--   means something landed in the wrong schema.
-- * **No moderation verb.** A wave is one bit from one rider with no text in
--   it. A block already removes it from the blocker's view and their count, and
--   `moderate_club_thread` deletes the thread, which cascades its waves.
-- * **No push.** `078`'s `push_devices` and `deliver-push-notifications` are
--   untouched; `club_waved` is in no delivery set. A welcome is a warm signal
--   and a push is an interruption, and adding the type to a delivery set is the
--   one-line change that would ship a per-signup interruption class into the
--   welcome club.
-- * **No rate limit**, and it is named rather than silent: `036` §8 already
--   records that nothing in this app rate-limits anything. The unique keys mean
--   a wave cannot stack, so the exposure is a wave/un-wave loop re-lighting one
--   notification — exactly the bound `postcard_likes` has carried since `036`.
--   This is the SECOND acceptance of that bound.

-- ===========================================================================
-- §1. The two tables
-- ===========================================================================
-- Two, not one. A single `club_waves` with two nullable subject columns is
-- `notifications`' own idiom and was weighed seriously; it loses to the
-- asymmetry below. The join subject needs a TWO-column foreign key and the
-- thread subject a ONE-column one, so one table carrying both must either
-- denormalise `club_id` onto thread waves — a copy of `club_threads.club_id`,
-- which `database-enforced-integrity` refuses in "A derived row SHALL NOT hold
-- a copy of a visibility decision" — or drop the composite key and accept the
-- orphan §D4 describes. It would also need `nulls not distinct` on its
-- uniqueness index, which `036` §8 records as a trap that "would NEVER FIRE"
-- if forgotten, for a benefit two primary keys give for free.
--
-- The cost of two tables is stated: the block arm, the gate trigger, the
-- grants, the indexes and the assertions are written twice. That is the cheap
-- kind of duplication — two policies each doing one obvious thing, rather than
-- one policy doing two.

-- --- §1.1  club_thread_waves ------------------------------------------------
-- (thread_id, user_id) composite PK, matching postcard_likes / ride_members /
-- club_members. It is also the idempotency mechanism: a caller writing
-- `on conflict do nothing` can double-tap without an error and without a second
-- row to clean up.
--
-- `created_at` is SERVER-OWNED BY THE GRANT rather than by its default (§3,
-- and `034` §4b): a default applies only when the column is OMITTED, and
-- PostgREST will happily name it if a client asks. The absent grant is the
-- guard.
create table public.club_thread_waves (
  thread_id uuid references public.club_threads(id) on delete cascade not null,
  user_id   uuid references public.profiles(id)     on delete cascade not null,
  created_at timestamptz default now() not null,
  primary key (thread_id, user_id)
);

alter table public.club_thread_waves enable row level security;

-- --- §1.2  club_join_waves --------------------------------------------------
-- ** THE COMPOSITE FOREIGN KEY IS THE SINGLE MOST IMPORTANT LINE IN THIS FILE.
-- ** It is available only because `club_members`' primary key is
-- `(club_id, user_id)` — measured in §0.
--
-- The defect it prevents, stated exactly. The obvious design keys the subject
-- as a bare `subject_user_id → profiles`. `add-club-timeline` already specifies
-- that leaving a club deletes the `club_members` row and takes the join entry
-- with it, and that a rejoin "is indistinguishable from a first join". Under
-- the bare key the wave rows SURVIVE the leave: they decorate an entry that no
-- longer renders, they are unreachable from any screen, and on a rejoin they
-- COME BACK — a rider welcomed in March silently shown as welcomed again in
-- September by riders who did nothing in September.
--
-- The composite key makes the cascade exact: leave -> the membership row goes
-- -> its waves go -> the rejoin starts at zero.
--
-- `user_id` — the WAVER — keeps its own key into `profiles`, so deleting the
-- waver's account removes their waves everywhere, independently of any
-- membership. The two keys answer different questions and neither substitutes
-- for the other.
--
-- `role` moving does not disturb any of this: `088`'s `promote_club_member` and
-- `demote_club_admin` write `club_members.role`, which is not in the primary
-- key, so a promotion touches no wave row.
create table public.club_join_waves (
  club_id         uuid not null,
  subject_user_id uuid not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  primary key (club_id, subject_user_id, user_id),
  constraint club_join_waves_subject_is_a_membership
    foreign key (club_id, subject_user_id)
    references public.club_members (club_id, user_id) on delete cascade
);

alter table public.club_join_waves enable row level security;

-- --- §1.3  Indexes, and which cascade each one discharges -------------------
-- `029`'s standing rule: every foreign key referencing `public.profiles` has an
-- index Postgres can use, added in the same migration as the table. On BOTH
-- tables here the primary key leads with another column — `thread_id` and
-- `club_id` — so neither serves the `profiles` cascade and both need their own
-- or every account deletion is a sequential scan.
--
-- The trailing `created_at desc` is `009`'s `postcard_likes_user_id_idx` shape:
-- it also serves "what has this rider waved", which a profile surface would
-- want, at no extra cost to the cascade the index exists for.
--
-- ** No index is added for the two OTHER cascade paths, and that is measured
-- rather than an omission. ** `club_thread_waves`' key into `club_threads`
-- leads its primary key, and `club_join_waves`' composite key into
-- `club_members` is a PREFIX of `(club_id, subject_user_id, user_id)`. Both are
-- served by the primary key index already.
create index club_thread_waves_user_idx
  on public.club_thread_waves (user_id, created_at desc);
create index club_join_waves_user_idx
  on public.club_join_waves (user_id, created_at desc);

-- --- §1.4  What each table is, including its retention ----------------------
comment on table public.club_thread_waves is
  'One rider''s wave on one club thread — 092, PD-356. THE SAME CONCEPT AS postcard_likes UNDER THE APP''S OWN WORD FOR IT: LikeButton renders WaveIcon (PD-228), so `wave` is the product noun and `like` is the older schema noun, and the schema now holds both. Audience is INHERITED, never restated: the SELECT policy is `user_id = auth.uid() OR (EXISTS against club_threads AND NOT is_blocked(auth.uid(), user_id))`, the EXISTS evaluated under the caller''s own RLS and the block arm on the WAVER. THE OWN-ROW BRANCH IS A DISJUNCT OF THE WHOLE POLICY AND MUST STAY THERE: inside the block arm it is a NO-OP, because blocks_no_self_block already makes is_blocked(x, x) false, and the parent EXISTS then dominates — so a rider blocked by the thread''s author, or one who has merely LEFT the club, could neither read nor DELETE the wave they placed, RLS applying SELECT to a DELETE ... where (081). postcard_likes has it in the wrong place; do not copy that shape back. 092.6 is the un-hoist detector. It names no membership, club-visibility, role or thread-author predicate because club_threads SELECT already carries every one of them. THE COUNT IS PER-VIEWER AND IS NEVER STORED (009''s refusal of a like_count column, transferred): it is an aggregate over the rows RLS returns, so two members of one club MAY see different totals on one thread and neither is told why, a rider blocked by every other member still reads their own count as 1, and a wave placed before a block SURVIVES the block. Three things follow and are forbidden: a wave count MUST NOT order, rank or sort any list; MUST NOT provide a cursor or page boundary; and MUST NOT feed a threshold, badge or label implying a shared judgement. A self-wave is PERMITTED here and refused on club_join_waves — see that table. RETENTION: indefinite, and the row dies with its subject or its reactor and by nothing else — two cascades, club_threads(id) and profiles(id), and no scheduled job. There is no notification on this table at all.';

comment on table public.club_join_waves is
  'One rider''s wave welcoming another rider''s membership of a club — 092, PD-356. THE SAME CONCEPT AS postcard_likes UNDER THE APP''S OWN WORD FOR IT (see club_thread_waves). ** THE SUBJECT IS A MEMBERSHIP, NOT A RIDER: (club_id, subject_user_id) is a composite foreign key into club_members(club_id, user_id) ON DELETE CASCADE, ** available because that table''s primary key is (club_id, user_id). Keyed to profiles alone the rows would outlive the timeline entry they decorate, be unreachable from every screen, and REAPPEAR on a rejoin, showing a rider as welcomed by riders who did nothing. Audience is INHERITED: `user_id = auth.uid() OR (EXISTS against club_members AND NOT is_blocked(auth.uid(), user_id))` — the EXISTS under the caller''s own RLS, the block arm on the WAVER, and nothing else. The own-row branch is a disjunct of the WHOLE policy for the reason club_thread_waves'' comment gives, and BOTH sides of the EXISTS are table-qualified because club_members has a column of each name and an unqualified comparison is a tautology. THE COUNT IS PER-VIEWER AND IS NEVER STORED, with the same three consequences and the same three prohibitions as club_thread_waves. A SELF-WELCOME IS REFUSED by the INSERT policy (user_id <> subject_user_id) while a self-wave on a thread is permitted, and the asymmetry is deliberate: endorsing your own topic is coherent, welcoming yourself expresses nothing, and refusing it in the WITH CHECK keeps a self-addressed row out of the fan-out''s path. A wave here notifies the SUBJECT and nobody else; un-waving retracts that notification. RETENTION: indefinite, and the row dies with the MEMBERSHIP it decorates, with the subject''s account or with the reactor''s — three cascades (club_members, and profiles reached both through club_members and directly through user_id) and no scheduled job. Every club_members row predating 092 is wavable the moment this applies; NOTHING IS BACKFILLED and nothing needs to be.';

-- ===========================================================================
-- §2. The twelfth notification type
-- ===========================================================================
-- BOTH constraints in one block, on `085` §5.3's shape and for the reason `036`
-- gives: the flat list says which strings are legal, the shape says which
-- subject columns each carries, and a type in the first with no arm in the
-- second falls to `else false` and is refused on its first insert. **Verify the
-- `else false` survives any future rewrite of this block** — it is what makes a
-- forgotten arm loud rather than silent.
--
-- ** `club_waved`'s subject shape is IDENTICAL to `club_joined`'s ** — club_id
-- set, the other three NULL — so `notifications_event_key` collapses it per
-- (recipient, type, actor, club) with NO new column, NO ninth index and no
-- change to that index at all.
--
-- ** No arm is added to the `notifications` SELECT policy and none is needed. **
-- `036` §3's club conjunct is `club_id is null or exists (select 1 from clubs
-- scl where scl.id = notifications.club_id)`, evaluated under the READER's own
-- row security, and `clubs` SELECT is `is_public or owner_id = auth.uid() or
-- private.is_club_member(id)`. The recipient of a `club_waved` row holds the
-- `club_members` row the wave is keyed to — the composite foreign key
-- guarantees it — so the EXISTS resolves for them at the moment the row is
-- written. This is `085`'s trap read the right way round: that file could NOT
-- add a decline notification precisely because its recipient held no such row.
--
-- Where the row LATER becomes unreadable it drops rather than being cleaned up:
-- a recipient who leaves a PRIVATE club stops satisfying `clubs` SELECT and the
-- notification disappears from their list. That is the standing behaviour and
-- no second retraction trigger compensates for it — though in practice §4.3's
-- retraction reaches it anyway, because leaving cascades the wave rows away.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined',
             'club_join_requested', 'club_join_request_approved',
             'club_join_request_declined',
             'club_waved')
  );

alter table public.notifications
  drop constraint notifications_subject_shape;
alter table public.notifications
  add constraint notifications_subject_shape check (
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
      when 'ride_invited' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'ride_invite_accepted' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'ride_invite_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is not null and club_id is null
      when 'club_join_requested' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'club_join_request_approved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'club_join_request_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      -- club_id ALONE, byte-identical to club_joined's arm three cases up. That
      -- is the whole reason this type needs no new column and no ninth index:
      -- the subject of a welcome is the club the rider was welcomed into, and
      -- WHICH JOIN it was is already determined by (recipient, actor, club).
      when 'club_waved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      else false
    end
  );

-- ===========================================================================
-- §3. Policies and grants
-- ===========================================================================
-- ** EVERY `EXISTS` BELOW IS SCHEMA- AND TABLE-QUALIFIED ON BOTH SIDES, AND ON
-- club_join_waves THAT IS LOAD-BEARING RATHER THAN STYLISTIC. ** Inside
-- `exists (select 1 from public.club_members m where …)` an unqualified
-- `club_id` or `user_id` resolves to the INNER relation, which has columns of
-- both names — so `m.club_id = club_id` is a tautology and `m.user_id =
-- user_id` is another, and the EXISTS degenerates into "does this club have any
-- member row I can read". It would pass every single-fixture test.
-- `postcard_likes` never had this hazard, its parent sharing no column name
-- with it, so the shape being copied does not carry the warning.

-- --- §3.1  SELECT: the parent, and the reactor's block arm. NOTHING ELSE ----
-- The EXISTS subquery is evaluated under the querying rider's own RLS, so wave
-- visibility tracks subject visibility EXACTLY rather than restating it —
-- `009`'s stated reason, transferred: "Restating it would be two predicates
-- that have to be kept in step, and the one that drifts is the one nobody
-- reads."
--
-- ** WHY NO MEMBERSHIP, CLUB-VISIBILITY, ROLE OR PARENT-AUTHOR-BLOCK CONJUNCT
-- APPEARS. ** Each parent policy already carries all of them (§0, quoted from
-- `pg_policies` rather than from a migration file). A rider blocked with a
-- thread's author cannot read the THREAD, so the EXISTS is false and the wave
-- is gone; a rider blocked with a join's subject cannot read the MEMBERSHIP,
-- likewise. Adding those conjuncts here would be a second copy of a rule that
-- lives one table away, free to drift, and drifting silently.
--
-- ** And per `081`'s lesson, this comment does NOT claim the parent alone is a
-- leak, because on these two tables it is not. ** `081`'s header records what a
-- false stated justification costs: the next session reads the reason, finds it
-- does not hold, and removes the conjunct. Here the parent EXISTS carries the
-- whole audience and the block arm carries something the parent CANNOT — the
-- identity of the REACTOR, who is a different rider from the thread's author or
-- the join's subject. On a thread both riders can see, a rider you blocked must
-- not appear among its waves. That is what the second conjunct is for, and it
-- is the only thing it is for.
--
-- ** THE OWN-ROW DISJUNCT IS A DISJUNCT OF THE WHOLE POLICY, NOT OF THE BLOCK
-- ARM, AND THAT IS THE ONE THING IN THIS FILE MOST LIKELY TO BE "SIMPLIFIED"
-- BACK. ** The obvious shape — and the one this change was first specified with
-- — is `<parent EXISTS> and (user_id = auth.uid() or not is_blocked(...))`.
-- It is wrong twice over:
--
--   1. ** Inside the block conjunct the arm is a NO-OP. ** `blocks_no_self_block`
--      (`009` §1) already refuses a self-block, so `is_blocked(x, x)` is false
--      for every x and `not is_blocked(auth.uid(), user_id)` is ALREADY true
--      whenever `user_id = auth.uid()`. The disjunct rescues nothing there. It
--      reads as a protection and is not one, which is exactly why it survived
--      review and shipped in `postcard_likes`.
--   2. ** The parent EXISTS still dominates it. ** So a rider blocked by a
--      thread's author — or one who has simply LEFT the club, needing no block
--      at all — cannot READ the wave they placed, and therefore cannot DELETE
--      it either: RLS applies SELECT to a `DELETE … where` (`081`, measured),
--      so the statement matches zero rows and PostgREST reports success. The
--      row survives and every other member goes on seeing it.
--
-- Hoisted, the own-row branch comes FIRST and is unconditional, which is
-- `009`'s `postcards` shape verbatim and for the identical stated reason: "so a
-- rider can always reach their own postcards — including ones posted to a club
-- they have since left, which they would otherwise lose access to without ever
-- being told."
--
-- ** It widens nothing. ** The branch admits only rows where `user_id =
-- auth.uid()`; §3.2 pins that column to the caller and no other writer exists,
-- so every row it returns is one the caller wrote and already knows about. It
-- discloses no thread, no membership and no other rider's wave — measured, and
-- pinned at `092.6`.
--
-- It is also why a rider blocked by every other member of a club still reads
-- their own count as 1 (§D6's second consequence), and it is what makes §3.3's
-- DELETE reachable at all — see there.
create policy "Thread waves follow thread visibility"
  on public.club_thread_waves for select to authenticated
  using (
    user_id = auth.uid()
    or (
      exists (
        select 1 from public.club_threads t
         where t.id = club_thread_waves.thread_id
      )
      and not private.is_blocked(auth.uid(), user_id)
    )
  );

create policy "Join waves follow roster visibility"
  on public.club_join_waves for select to authenticated
  using (
    user_id = auth.uid()
    or (
      exists (
        select 1 from public.club_members m
         where m.club_id = club_join_waves.club_id
           and m.user_id = club_join_waves.subject_user_id
      )
      and not private.is_blocked(auth.uid(), user_id)
    )
  );

-- --- §3.2  INSERT: the SAME EXISTS, plus authorship -------------------------
-- "Cannot wave what you cannot see" is the same predicate as SELECT rather than
-- a second one, so the two cannot fall out of step. `009` §4's insert policy is
-- the model, including what it omits: no block conjunct is written here either,
-- because the parent EXISTS inherits the parent's own block arm for free.
--
-- ** `user_id <> subject_user_id` IS ON club_join_waves ALONE, AND THE
-- ASYMMETRY IS DELIBERATE — DO NOT REMOVE IT FOR CONSISTENCY. ** A wave on a
-- THREAD is an endorsement of a topic, which a rider may coherently feel about
-- their own; `postcard_likes` permits a self-like for the same reason. A wave
-- on a JOIN is *welcome*, addressed to a person — addressed to oneself it
-- expresses nothing. Refusing it in the WITH CHECK keeps a self-addressed row
-- out of §4.2's path entirely rather than relying on the fan-out to exclude it,
-- which is belt and braces on the one path in this file that writes to somebody
-- else's notification list. §4.2 excludes it as well, and neither is redundant:
-- the policy stops the row existing, the fan-out exclusion is the standing rule
-- that a rider is never notified of their own action and holds if a future path
-- ever writes the row by some other means.
create policy "Riders wave visible threads, as themselves"
  on public.club_thread_waves for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.club_threads t
       where t.id = club_thread_waves.thread_id
    )
  );

create policy "Riders welcome visible joins, as themselves and never themselves"
  on public.club_join_waves for insert to authenticated
  with check (
    user_id = auth.uid()
    and user_id <> subject_user_id
    and exists (
      select 1 from public.club_members m
       where m.club_id = club_join_waves.club_id
         and m.user_id = club_join_waves.subject_user_id
    )
  );

-- --- §3.3  DELETE: the author's own row, with NO visibility conjunct --------
-- `009`'s exact rule and its exact reason: "a rider must be able to withdraw a
-- like from a postcard that has since gone out of view, or the row is
-- stranded." A rider who waves a thread and is then blocked by its author can
-- still withdraw the wave.
--
-- ** THIS POLICY IS ONLY REACHABLE BECAUSE §3.1'S OWN-ROW BRANCH IS HOISTED,
-- AND THAT IS ASSERTED RATHER THAN ASSUMED. ** `081` measured, on Postgres
-- 17.6, that RLS applies the SELECT policy to a `DELETE` whose WHERE names a
-- column — so a row the caller owns but cannot SEE survives its own delete,
-- silently, with PostgREST reporting success. That is why `club_messages` has
-- no DELETE policy at all and a definer RPC instead.
--
-- These two tables escape it, but ONLY in §3.1's hoisted shape: with the
-- own-row test back inside the block conjunct it is a no-op (see §3.1), the
-- parent EXISTS dominates, and this policy silently stops matching for a rider
-- blocked by the parent's author or one who has left the club. `092.6` pins the
-- hoist by DELETING as a rider who has left and requiring the row to go.
--
-- Un-hoisting therefore breaks the delete path SILENTLY while looking like a
-- tightening, and relaxing THIS policy would not repair it, because SELECT is
-- applied first. The DELETE policy has no visibility conjunct and needs none;
-- everything above is about the SELECT policy attached to it.
create policy "Riders withdraw only their own thread wave"
  on public.club_thread_waves for delete to authenticated
  using (user_id = auth.uid());

create policy "Riders withdraw only their own join wave"
  on public.club_join_waves for delete to authenticated
  using (user_id = auth.uid());

-- --- §3.4  No UPDATE policy and no UPDATE grant, on either table ------------
-- A wave has no mutable column. `009` says the same of `postcard_likes` and
-- `blocks`. The absence is asserted in BOTH directions, because a well-meaning
-- `grant all on … to authenticated` restores only one of the two and leaves the
-- other looking correct.

-- --- §3.5  Grants -----------------------------------------------------------
-- RLS needs BOTH a table grant and a permitting policy, so the grant is a
-- second, independent layer — the one that still holds if a future policy is
-- written too permissively (`007`'s argument, applied at creation time).
--
-- Revoke first rather than trusting the default ACL: two exist for schema
-- `public` on the hosted projects and which applies depends on the role that
-- created the table. Nothing is granted to `anon` — decision #1, and this file
-- adds no anon reach anywhere.
--
-- INSERT is PER COLUMN and `created_at` is on neither list, which is what makes
-- it server-owned. The default is not the guard; the absent grant is. A caller
-- writing an upsert must use `on conflict do nothing` and never `do update` —
-- the latter needs UPDATE and refuses with 42501.
revoke all on public.club_thread_waves from anon, authenticated;
revoke all on public.club_join_waves   from anon, authenticated;

grant select, delete on public.club_thread_waves to authenticated;
grant select, delete on public.club_join_waves   to authenticated;

grant insert (thread_id, user_id)
  on public.club_thread_waves to authenticated;
grant insert (club_id, subject_user_id, user_id)
  on public.club_join_waves   to authenticated;

-- ===========================================================================
-- §4. Triggers
-- ===========================================================================
-- Four, and the two SHAPES in this section are opposites that are each correct
-- where they are. §4.1's gate carries `when (current_user = 'authenticated')`;
-- §4.4's fan-outs carry NO `when` clause at all. An absent guard is otherwise
-- indistinguishable from a forgotten one, which is why both are stated.

-- --- §4.1  The participation gate — the eighteenth and nineteenth -----------
-- A wave is a rider-authored act, visible to others and — in the join case —
-- addressed to a named person. `023` refuses content writes without a consent
-- stamp, and an account created by calling GoTrue's /auth/v1/signup directly
-- and never calling accept_terms() must be unable to wave.
--
-- ** THE `when` CLAUSE IS NOT DECORATION ** — `023` §2. It is what stops the
-- gate firing for the table owner, for a seed and for a repair statement, and
-- it is also why a `security definer` writer would have to restate the rule in
-- its own body: inside such a body `current_user` is the OWNER, so a guard
-- written there is true on every call and gates nothing. Neither table has such
-- a writer today — every row is an ordinary client INSERT.
drop trigger if exists enforce_participation_gate on public.club_thread_waves;
create trigger enforce_participation_gate
  before insert on public.club_thread_waves
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.club_join_waves;
create trigger enforce_participation_gate
  before insert on public.club_join_waves
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped from seventeen, per `028`/`033`/`085`/`091`: this comment is the
-- `data` agent's first read via `list_tables` and no edit to CLAUDE.md reaches
-- it.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, nineteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085), the seventeenth ride_invite_links (091), the eighteenth club_thread_waves and the nineteenth club_join_waves (092); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- --- §4.2  The fan-out: a welcome addressed to the joiner alone -------------
-- ** ONE RECIPIENT, READ FROM THE ROW. ** The club's owner, its admins and its
-- other members receive nothing: a welcome is addressed to the person who
-- arrived, and fanning it out to the roster would make every wave in a
-- forty-member club forty notifications about somebody else's greeting.
--
-- `auth.uid()` appears nowhere below — `036` trap (b). The actor is
-- `new.user_id` and the recipient `new.subject_user_id`, both from NEW, because
-- `auth.uid()` is NULL wherever there is no JWT (the RLS suite, psql, a seed,
-- the Supabase MCP) and a comparison against NULL is not TRUE, which would
-- filter out every recipient in exactly the environment where this is asserted.
-- Reading NEW is not weaker: `user_id` is pinned to `auth.uid()` by §3.2's own
-- INSERT policy.
--
-- No caller-relative helper is called — `036` trap (c). `private.is_club_member`
-- reads `auth.uid()` internally, so it answers "is the CALLER a member" and
-- never "is this CANDIDATE a member". Only `private.is_blocked(a, b)` takes its
-- subject as arguments, and it is the only helper here.
--
-- `on conflict do nothing` rather than an exception handler: the one expected
-- collision is `036` §8's uniqueness index, absorbed without a handler that
-- would also hide a real fault. A fan-out that raises takes the rider's own
-- transaction with it, deliberately.
--
-- AFTER, not BEFORE: the parent row must exist before the foreign keys resolve,
-- and a write refused by RLS, a CHECK or the participation gate must produce
-- nothing — which AFTER gives for free, because it never runs. `return null`
-- because an AFTER ROW trigger's return value is ignored.
--
-- ** THE BLOCK CONJUNCT IS REDUNDANT TODAY AND IS WRITTEN ANYWAY. ** Stated
-- honestly, per `081`'s lesson about false justifications: §3.2's EXISTS
-- against `club_members` already carries that table's symmetric block arm on
-- `user_id`, so a rider blocked with the subject cannot create the wave at all
-- and this line can never be what refuses one. It is NOT true that "the policy
-- alone is a leak". Three reasons it stays regardless: the implication is a
-- property of the CURRENT `club_members` SELECT policy rather than of this
-- table, and a widened arm there would break it with nothing announcing the
-- transition; the standing requirement is that blocking is applied twice, at
-- fan-out and at read, and a fan-out leaning on a sibling table's policy is
-- applying it once; and it costs nothing measurable.
--
-- The self-exclusion is likewise doubled with §3.2's `user_id <>
-- subject_user_id` and likewise not redundant: `036` §7.6 places the actor
-- exclusion where a future writer cannot route around it.
create function private.notify_club_waved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select new.subject_user_id, new.user_id, 'club_waved', new.club_id
   where new.subject_user_id <> new.user_id
     and not private.is_blocked(new.user_id, new.subject_user_id)
  on conflict do nothing;
  return null;
end;
$$;

-- --- §4.3  The retraction ---------------------------------------------------
-- Un-waving retracts the notification rather than leaving one for an event that
-- has been undone. `036` §7.2 is the model and its argument transfers exactly:
-- the reason is harassment, not truthfulness — a wave is a one-tap toggle, so
-- without a retraction it is an unbounded notification generator aimed at
-- another rider.
--
-- ** SCOPED BY ALL FOUR KEY COLUMNS — user_id, type, actor_id, club_id — AND
-- NEVER BY A SUBSET. ** A delete scoped by `type + club_id` alone is a write
-- ONE RIDER CAN AIM AT ANOTHER RIDER'S ROW, in the one table in this schema
-- whose entire premise is that no rider can write to it: rider A un-waving
-- would delete rider B's notification for the same joiner. A holds no grant on
-- `notifications` — but this trigger does, and it is running on A's delete.
-- `actor_id` is what makes it A's own row; `user_id` is what stops a future
-- multi-recipient type being cleared wholesale. The scope costs nothing:
-- (user_id, type, actor_id, …) is a prefix of `036` §8's uniqueness index.
--
-- The three columns not named — postcard_id, comment_id, ride_id — are NULL on
-- every `club_waved` row by §2's shape arm, so naming `type` is what fixes
-- them. That is `retract_postcard_liked`'s own reasoning.
--
-- ** IT ALSO FIRES ON CASCADED DELETES, AND HERE THAT IS USEFUL RATHER THAN
-- MERELY HARMLESS. ** A subject LEAVING the club deletes their `club_members`
-- row, which cascades the waves, which fires this — so the recipient is not
-- left holding a welcome to a membership that no longer exists. (The
-- notifications read policy would have withheld it anyway once `clubs` SELECT
-- stopped resolving for them on a private club; on a PUBLIC club it would not
-- have, and this is what closes that.) An account deletion reaching either
-- `profiles` key does the same, redundantly with `notifications`' own cascades.
--
-- ** DO NOT ADD A `pg_trigger_depth()` OR `TG_OP` GUARD TO SKIP THE CASCADE
-- CASE. ** A guard that skips the cascade case is one refactor away from
-- skipping the rider case, and the rider case is the whole feature.
create function private.retract_club_waved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.user_id  = old.subject_user_id
     and n.type     = 'club_waved'
     and n.actor_id = old.user_id
     and n.club_id  = old.club_id;
  return null;
end;
$$;

comment on function private.notify_club_waved() is
  'Fan-out: waving a rider''s join notifies THAT RIDER and nobody else (092) — not the club owner, not its admins, not its other members. Recipient and actor both come from NEW, never from auth.uid(), which is NULL wherever there is no JWT. security definer because no client role holds INSERT on notifications and the row is addressed to somebody else. The is_blocked conjunct is REDUNDANT TODAY — club_join_waves INSERT''s EXISTS already inherits club_members'' block arm — and is written anyway because that implication is a property of the club_members policy rather than of this table. A THREAD wave notifies nobody at all; there is deliberately no notify_club_thread_waved.';
comment on function private.retract_club_waved() is
  'Retraction: un-waving a join removes exactly the row the matching insert wrote (092), scoped by all four of user_id, type, actor_id and club_id. A subset scope would let one rider''s un-wave delete another rider''s notification — 036 §7.2''s lesson. Also fires on cascaded deletes, which here is USEFUL: leaving the club cascades the wave rows away and takes the welcome notification with them. Do not add a pg_trigger_depth guard.';

-- Unreachable from any client role, and from `service_role` too. Revoking from
-- `public` is what does the work, because EXECUTE is granted to PUBLIC by
-- default on function creation. Asserted by naming the role with
-- `has_function_privilege`, never by attempting the call — the suite runs as
-- the table owner, for whom the barrier does not exist.
revoke all on function private.notify_club_waved()  from public, anon, authenticated;
revoke all on function private.retract_club_waved() from public, anon, authenticated;

-- --- §4.4  The two fan-out triggers -----------------------------------------
-- ** NEITHER CARRIES A `when` CLAUSE, AND THE OMISSION IS THE POINT. **
-- `036` §7.8: copying `023`'s `when (current_user = 'authenticated')` is
-- correct on §4.1's participation gate and WRONG here — a fan-out is not a rule
-- about the client, it must fire for every writer including a seed, a
-- `security definer` RPC, a future admin task, psql, and above all the seed the
-- RLS suite runs as. A notification that silently does not happen for a
-- privileged write is a gap with nothing to detect it.
create trigger notify_club_waved
  after insert on public.club_join_waves
  for each row execute function private.notify_club_waved();

create trigger retract_club_waved
  after delete on public.club_join_waves
  for each row execute function private.retract_club_waved();

-- ---------------------------------------------------------------------------
-- Verification (run against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- Every case below is also an assertion in supabase/tests/rls_test.sql, which
-- applies this whole chain to a scratch database on every PR. They are repeated
-- here because that suite runs on plain Postgres and cannot see role grants,
-- PostgREST exposure or Supabase defaults — the exact gap that let 003's revoke
-- pass locally and stay broken in production.
--
-- Shape — expect two tables, both with rls enabled:
--
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relname in ('club_thread_waves', 'club_join_waves');
--
-- Expect exactly SIX policies across the two, three each, and all
-- `{authenticated}`. No UPDATE policy on either:
--
--   select tablename, cmd, policyname, roles from pg_policies
--    where schemaname='public'
--      and tablename in ('club_thread_waves','club_join_waves')
--    order by tablename, cmd;
--
-- Expect zero rows — anon must hold no privilege on either table, and no
-- UPDATE for anyone but postgres/service_role:
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema='public'
--      and table_name in ('club_thread_waves','club_join_waves')
--      and (grantee = 'anon'
--           or (grantee = 'authenticated' and privilege_type = 'UPDATE'));
--
-- Expect `created_at` on NEITHER insert list:
--
--   select table_name, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema='public' and grantee='authenticated'
--      and table_name in ('club_thread_waves','club_join_waves')
--    order by table_name, privilege_type, column_name;
--
-- Expect 19 — the gate count, re-derived rather than read off the comment:
--
--   select count(*) from pg_trigger
--    where tgname='enforce_participation_gate' and not tgisinternal;
--
-- ... and by NAME on both, because a flat count cannot tell a new table's gate
-- from one that moved:
--
--   select c.relname, t.tgname, pg_get_triggerdef(t.oid)
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where t.tgname='enforce_participation_gate'
--      and c.relname in ('club_thread_waves','club_join_waves');
--
-- Expect the composite foreign key, verbatim:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.club_join_waves'::regclass and contype='f';
--   -- club_join_waves_subject_is_a_membership
--   --   FOREIGN KEY (club_id, subject_user_id)
--   --   REFERENCES club_members(club_id, user_id) ON DELETE CASCADE
--
-- Expect NO NEW SECURITY ADVISOR. Both new functions are in `private`, which
-- PostgREST does not publish, so `get_advisors(security)` must return exactly
-- what it returned before this applied. A new
-- `authenticated_security_definer_function_executable` means a function landed
-- in the wrong schema.
--
-- ---------------------------------------------------------------------------
-- 036'S HAND-EXERCISE GATE — do this on DEV before PROD, and on PROD too
-- ---------------------------------------------------------------------------
-- The fan-out is live for every wave from the moment this applies. Exercise it
-- by hand, in a ROLLED-BACK transaction, as `authenticated`, and COUNT the rows
-- rather than assuming them:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<waver>","role":"authenticated"}';
--     insert into public.club_join_waves (club_id, subject_user_id, user_id)
--       values ('<club>', '<joiner>', '<waver>');
--     -- expect exactly 1, addressed to <joiner>:
--     select count(*), user_id, actor_id from public.notifications
--      where type='club_waved' and club_id='<club>' group by user_id, actor_id;
--     delete from public.club_join_waves
--      where club_id='<club>' and subject_user_id='<joiner>' and user_id='<waver>';
--     -- expect 0:
--     select count(*) from public.notifications
--      where type='club_waved' and club_id='<club>';
--     -- and a THREAD wave must write NOTHING:
--     insert into public.club_thread_waves (thread_id, user_id)
--       values ('<thread>', '<waver>');
--     select count(*) from public.notifications where type='club_waved';
--   rollback;
--
-- NEGATIVE: a non-member of a PUBLIC club reads zero thread waves and cannot
-- write one. Expect zero rows, then 42501:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<non-member>","role":"authenticated"}';
--     select count(*) from public.club_thread_waves;
--     insert into public.club_thread_waves (thread_id, user_id)
--       values ('<thread in that public club>', '<non-member>');
--   rollback;
--
-- NEGATIVE: a self-welcome is refused (42501), a self-wave on a thread is not:
--
--   insert into public.club_join_waves (club_id, subject_user_id, user_id)
--     values ('<club>', '<self>', '<self>');            -- 42501
--   insert into public.club_thread_waves (thread_id, user_id)
--     values ('<own thread>', '<self>');                -- succeeds
--
-- NEGATIVE: an account with terms_accepted_at NULL cannot wave. Expect 23514
-- from the participation gate on BOTH tables.
--
-- NEGATIVE: leaving the club takes the join's waves and their notifications:
--
--   delete from public.club_members where club_id='<club>' and user_id='<joiner>';
--   select count(*) from public.club_join_waves
--    where club_id='<club>' and subject_user_id='<joiner>';        -- 0
--   select count(*) from public.notifications
--    where type='club_waved' and user_id='<joiner>' and club_id='<club>';  -- 0
