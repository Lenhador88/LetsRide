-- 108: A ride gets titled THREADS — the threads, their messages, and the
--      per-thread unread watermark.
--
-- Linear PD-402; the proposal is
-- openspec/changes/retire-ride-chat-for-ride-threads/.
--
-- ===========================================================================
-- WHAT THIS FILE IS, AND WHAT IT IS NOT
-- ===========================================================================
-- This is migration A of two, and it is ** PURELY ADDITIVE **. It creates three
-- tables, five policies, two indexes per table, three functions and one
-- publication membership. It drops nothing, renames nothing, and changes no
-- existing policy, grant, CHECK or trigger except the enforce_participation_gate
-- COMMENT, which is restamped because it enumerates its triggers by table.
--
-- ** `public.ride_messages` and `public.ride_reads` are UNTOUCHED here. ** They
-- are dropped by 109, which is a separate file applied at a separate time, after
-- the bundle carrying the new surface is confirmed SERVING on the target project
-- — `READY` on the merge sha with `aliasError` null, which is NOT the same as
-- "merged". This repo has already applied a destructive file 102 seconds after a
-- merge, out from under a Preview still calling the function it dropped.
--
-- ** So this file must be INVISIBLE to the shipped bundle. ** Nothing it creates
-- is read or written by any code deployed today, and the old ride chat must keep
-- working across the whole gap. That is the property to check after applying,
-- and §Verification does.
--
-- ORDERING: migration-first. Nothing shipped writes these tables, so an early
-- apply breaks nothing; the reverse — a bundle calling ride_thread_unread()
-- before this lands — answers PGRST202 on the thread list. `069`'s rule in its
-- ordinary direction.
--
-- ===========================================================================
-- THE AUDIENCE — read this before touching any policy below
-- ===========================================================================
-- Both content tables' SELECT policy is a three-part conjunction, and each part
-- answers a different question:
--
--   exists (select 1 from public.rides r where r.id = ...)   may I see this ride
--   private.is_ride_crew(ride_id)                            am I ON it
--   author_id = uid or not private.is_blocked(uid, author_id) may I see this
--                                                             rider's words
--
-- ** This is 034's conjunction, unchanged, arriving at a second and a third
-- table. ** It is NOT 081's. The two files carry the same SHAPE and opposite
-- REASONING, and transferring the wrong one is the single most likely way this
-- change ships a leak:
--
--   * On `clubs` (081) the parent EXISTS is the LOOSE half. `clubs` SELECT
--     admits every signed-in rider to a public club, so `private.is_club_member`
--     is the load-bearing conjunct and the EXISTS is redundant-but-written.
--   * On `rides` (034) the parent EXISTS is the STRICT half. `rides` SELECT
--     carries a block arm, a private-club arm and — since `083` — a live-invite
--     arm, and `private.is_ride_crew` is `security definer` and steps past all
--     three. Read on letsride-dev 2026-09-06, the whole predicate:
--
--       (organizer_id = auth.uid())
--       OR ((NOT private.is_blocked(auth.uid(), organizer_id))
--            AND ((is_public AND (club_id IS NULL OR private.is_club_public(club_id)))
--                 OR (club_id IS NOT NULL AND private.is_club_member(club_id))
--                 OR private.has_live_ride_invite(id)))
--
-- ** 034's FIRST DRAFT read "a ride's chat is narrower than a ride" as "so use
-- the crew predicate INSTEAD of the EXISTS", and it shipped a leak. ** 034's own
-- header calls the reasoning "seductive" and the failure "silent". A build that
-- copies `082`'s `club_messages` policy and swaps the helper arrives at exactly
-- that draft. Two states it leaves live, both reachable today:
--
--   * A crew member who BLOCKS THE ORGANIZER loses the ride, the roster and the
--     detail screen, and keeps reading the conversation. Decision #2 names chat
--     in the list of things a block must remove SIMULTANEOUSLY.
--   * A crew member who LEAVES A PRIVATE CLUB keeps reading that club's ride's
--     conversation. `022` pins a private club's rides to is_public = false, so
--     `rides` hides them, and nothing removes the `ride_members` row. That one
--     is a leak rather than an inconsistency.
--
-- `private.is_ride_crew`'s own comment says it: "half of a conjunction by
-- design; on its own it is a leak". It is REUSED here with no change to its
-- body, signature or grant — `041` (postcard ride-tagging) and `051` (map tiles)
-- also call it, and any edit to it is an edit to those.
--
-- The suite asserts each conjunct IN ISOLATION, because a single combined
-- assertion cannot say which one did the work: 108.4 fails if the crew helper
-- goes, 108.9 and 108.10 fail if the `rides` EXISTS goes, and they fail
-- independently.
--
-- ---------------------------------------------------------------------------
-- The grandchild restates the WHOLE chain
-- ---------------------------------------------------------------------------
-- `ride_thread_messages` reaches `rides` through a join to `ride_threads` and
-- restates both outer conjuncts rather than hanging off a one-hop EXISTS against
-- the thread. `082`'s ruling for `club_messages`, for its reason: the inner
-- EXISTS does resolve under the caller's row security, so the thread's policy
-- composes correctly TODAY and the restatement is redundant a second time — but
-- without it the message table's audience is undiscoverable from its own policy
-- text, and a later change to the thread policy silently retargets it. The spec
-- asserts a direct-by-id message read for exactly this (108.13).
--
-- ---------------------------------------------------------------------------
-- Q1, answered by its stated default: the accepted invitee of a private club's
-- ride
-- ---------------------------------------------------------------------------
-- A rider who is not in a private club, but who accepted an invite to one of its
-- rides, satisfies both halves of this file's conjunction — and it is worth
-- being exact about WHICH row buys each half, because the two are unrelated and
-- one of them is easy to tidy away:
--
--   * `private.is_ride_crew` — bought by the `ride_members` row that
--     `join_ride_from_invite` writes on acceptance.
--   * the `EXISTS` against `rides` — bought by `private.has_live_ride_invite(id)`,
--     the arm the policy actually names, which delegates to
--     `private.has_live_ride_invite_for(auth.uid(), target_ride)` where the
--     `status in ('pending','accepted')` test lives. ** NOT by the
--     `ride_members` row. ** Read the live `rides` SELECT policy: its arms are
--     the organizer, and (not blocked) AND (public-and-club-visible OR
--     `is_club_member` OR a live invite). There is no `ride_members` arm at all,
--     so for this rider the ride is readable ONLY while their invite row
--     survives in `accepted`.
--
-- ** So clearing or archiving accepted invites would silently take this rider's
-- ride visibility, and every thread on it with it. ** That is a real hazard
-- rather than a hypothetical: `083`'s own comment says `status` "is NEVER a copy
-- of `ride_members`: nothing keeps the two in step and nothing should", which
-- makes tidying spent invite rows a natural-looking future change.
--
-- So they read and post in that ride's threads IN FULL, and reach no part of the
-- club: a thread row carries a `ride_id` and no club identifier, name or
-- description, and the club's own `club_threads` stay unreadable to them.
--
-- ** There is deliberately NO club-membership conjunct on either policy. ** This
-- is the one place this capability lets a rider outside a private club read text
-- written inside its orbit, it is the product owner's stated default, and it is
-- one conjunct per policy to reverse. 108.6 is the assertion that pins it.
--
-- ** A PENDING invite is a different rider and gets nothing. ** `083`'s arm
-- widens RIDE visibility and never THREAD visibility; the transition point is the
-- `ride_members` row rather than the invite's status, which is the right seam —
-- `083`'s own table comment says `status` "is the answer to the invitation and
-- NEVER a copy of ride_members: nothing keeps the two in step and nothing
-- should". A thread policy reading `ride_invites.status` would build exactly the
-- coupling that comment forbids. 108.5 is the assertion, and it is the only
-- situation in the app where a rider provably reaches a ride's detail screen and
-- must reach none of its conversation.
--
-- ===========================================================================
-- WHERE THE OWN-ROW ARM SITS, PER POLICY — decided, not inherited
-- ===========================================================================
-- In both SELECT policies the arm admitting a rider to their own row sits
-- INSIDE the block-dominated group and is NOT hoisted above `is_ride_crew` or
-- above the `rides` EXISTS:
--
--   <rides EXISTS> and is_ride_crew(...)
--     and (author_id = uid or not private.is_blocked(uid, author_id))
--
-- ** This is the OPPOSITE of what `102` did for three of the seven policies it
-- found in this shape, and the difference is deliberate. ** `102` hoisted three
-- and left four alone — `club_messages` among the four — because a sweep would
-- have got them wrong. The direction that matters here is the CEILING: hoisted
-- above `is_ride_crew` or above the EXISTS, the audience stops being an
-- INTERSECTION, which is this capability's central invariant. `docs/HANDOFF.md`
-- records that exact refusal for `ride_messages`.
--
-- ** The disjunct itself is a no-op and is written anyway, as a convention. **
-- `102`'s header is explicit: inside the block conjunct the own-row branch
-- rescues nothing, because `blocks_no_self_block` (`009` §1) already makes
-- `is_blocked(x, x)` false. So `author_id = auth.uid()` never changes a result
-- here and ** NO ASSERTION CAN DISTINGUISH ITS PRESENCE FROM ITS ABSENCE. ** It
-- is written because the three policies it is modelled on all carry it —
-- `034`'s `ride_messages` and both of `081`'s — and a policy that reads
-- differently from its neighbours invites a "fix". Do not write an assertion
-- claiming it does work; 108.14 pins the CEILING instead, which is assertable
-- and which is the failure that can actually happen.
--
-- The consequence, stated rather than left to be met in the field: an ex-crew
-- member reads nothing on that ride, INCLUDING their own rows. §4b's RPC is what
-- stops that from being a stranded row — it is not subject to the SELECT policy
-- at all, so the placement costs the rider nothing they cannot undo.
--
-- `ride_thread_reads` is the exception: `user_id = auth.uid()` at TOP level with
-- no visibility conjunct anywhere. A watermark is a fact about the READER rather
-- than about the content. See §3c for what that costs and for the one place it
-- departs from `081`.
--
-- ===========================================================================
-- NO DELETE POLICY, NO DELETE GRANT, NO UPDATE POLICY, NO UPDATE GRANT
-- ===========================================================================
-- On BOTH content tables. ** The absence IS the enforcement ** — `078`'s
-- `push_devices` shape — and it is asserted in both directions, because a
-- well-meaning `grant all` restores only one of them.
--
-- Deletion is `security definer` RPCs and nothing else (§4b, §4c). The reason is
-- MEASURED rather than argued: RLS applies the SELECT policy to a DELETE whose
-- WHERE names a column (measured on Postgres 17.6 and recorded in `081`):
--
--   delete from t where id = 1;             -->  row SURVIVES (SELECT applied)
--   delete from t where id = 1 returning 1; -->  row SURVIVES
--   delete from t;                          -->  row deleted (SELECT not applied)
--
-- `supabase-js` issues the first form. So a policy-based delete reports SUCCESS
-- against zero rows whenever the row is invisible to the very rider entitled to
-- remove it. `034` shipped that gap for both the author and the organizer, and
-- `102` deliberately left `ride_messages`' residual silent `DELETE 0` open
-- rather than break the intersection — the only policy-level fix being to hoist
-- the own-row arm above `is_ride_crew`, which is the ceiling violation above.
--
-- ** Building the replacement with `082`'s shape closes that defect at no extra
-- cost. ** It is a real bug fixed by the migration that replaces the table, and
-- it belongs in the PR body rather than being absorbed silently.
--
-- Nothing is EDITABLE either, and neither table carries an `updated_at`: a
-- column that cannot move documents an intention rather than a fact, which
-- `034` §1 and `081` §1 both refused for the same reason. Editing a title means
-- designing "edited" — whether it is disclosed, from when, and what it does to
-- the forty replies hanging off it — and none of that is drawn.
--
-- ---------------------------------------------------------------------------
-- ** WHO MAY REMOVE A THREAD — two arms, and neither is the crew **
-- ---------------------------------------------------------------------------
-- `public.moderate_ride_thread(uuid)` admits the ride's ORGANIZER and the
-- thread's own AUTHOR, and nobody else. `tasks.md` 2.16 names only the organizer
-- arm; read with 2.8's "no DELETE policy and no DELETE grant on either table"
-- that would leave an author unable to remove their own thread at all, which the
-- capability's spec forbids twice over:
--
--   * "Scenario: A thread's author removes their own thread — WHEN the rider who
--     started a thread removes it — THEN it SHALL be removed with its messages".
--   * And inside the organizer's own scenario, the exclusion names the author as
--     someone who is NOT refused: "a crew member who is neither the organizer
--     nor the thread's author SHALL be refused".
--
-- ** Both arms live in the ONE function rather than a second RPC, ** because the
-- spec says thread removal SHALL be `public.moderate_ride_thread(uuid)`,
-- singular — and because a fourth published `security definer` function would
-- move this file's advisor delta from the counted +2 to +3.
--
-- ** It is still NOT `private.is_ride_crew` (`design.md` D4). ** An ordinary crew
-- member who authored nothing is refused, which is exactly what the exclusion
-- above asserts. Crew is who may TALK; organizer-or-author is who may REMOVE.
-- And a club's owner or admin still gains nothing: the resource is the ride.
--
-- ---------------------------------------------------------------------------
-- ** ONE GAP THIS FILE LEAVES OPEN, NAMED RATHER THAN DISCOVERED **
-- ---------------------------------------------------------------------------
-- ** `ride_thread_reads` INSERT IS AN EXISTENCE ORACLE, and `081` closed the
-- same one. ** §3a's WITH CHECK carries no audience conjunct (`design.md` D6
-- and `tasks.md` 2.9 both specify top level, no visibility conjunct), so a
-- signed-in rider inserting a watermark for an arbitrary uuid learns whether it
-- names a real thread: a nonexistent id raises 23503 on the foreign key while an
-- existing-but-invisible one succeeds. `081` §2 put the full audience in the
-- WITH CHECK for precisely this — `015` §2's reason, which 081's header is
-- careful to say is NOT `034`'s.
--
-- The exposure is bounded by uuid unguessability and discloses only EXISTENCE,
-- never content, membership or authorship; and the spec pins only the SELECT
-- policy as conjunct-free. Closing it is one `exists (...)` in each of the two
-- write policies and changes no reachable client behaviour, because the client
-- marks a thread read only when it is crew. Raised rather than settled by the
-- build.
--
-- ===========================================================================
-- Settled decisions carried in here
-- ===========================================================================
--   #1 no anonymous access         -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS  -> private.is_blocked, never a blocks query
--   #5 onboarding is required       -> §3d adds the twenty-second and
--                                      twenty-third gate triggers
--   #7 username is the display name -> nothing here stores a name
--
-- ** The hand-exercise gate does NOT fire, and that is stated so the reader does
-- not have to work it out. ** CLAUDE.md requires exercising every affected write
-- path by hand on DEV before applying a migration that hangs triggers off an
-- ALREADY-SHIPPED write path, because from the moment it applies every such
-- write runs new code inside the rider's own transaction. §3d's two triggers sit
-- on tables created by this same file, which no deployed bundle can write, so
-- there is no shipped path to exercise. `094` is the counter-example — it
-- replaced a function owners call today and the gate fired for that reason.
--
-- ---------------------------------------------------------------------------
-- Personal data: retention and reach, decided here rather than retrofitted
-- ---------------------------------------------------------------------------
-- REACH. All three tables hang off `public.profiles` with ON DELETE CASCADE, so
-- `029`'s deletion path reaches every row this file can create with no new
-- cleanup code. The watermark table is the one that matters most — it records
-- when a NAMED rider last read a NAMED topic.
--
-- ** Two cascade consequences are two levels deep and invisible in any single
-- foreign key, so they are written out: **
--
--   * Deleting a THREAD'S AUTHOR removes the thread, and every message in it
--     goes with it INCLUDING messages authored by other riders. This is wider
--     than `ride_messages`, where only the leaver's own messages went. It is a
--     NEW consequence relative to the chat, which had no thread container; the
--     club already made this call (`club_threads.author_id` is ON DELETE
--     CASCADE) and this follows it.
--   * Deleting a rider who ORGANISES rides removes those rides
--     (`rides.organizer_id` is ON DELETE CASCADE) and every thread and message
--     on them with it.
--
-- RETENTION. Indefinite, and stated rather than left silent: a thread lives as
-- long as its ride, and nothing deletes a past ride. There is no scheduled
-- deletion and no expiry column. `proposal.md` Q6 carries that as an open
-- question owned by the product owner with this as its stated default; a
-- different answer needs a MECHANISM, not a sentence.
--
-- OFFLINE. `id` is client-suppliable on both content tables so a replayed
-- mutation is idempotent rather than a duplicate. Neither table gets an
-- `updated_at`, because neither is editable — see above.
--
-- ---------------------------------------------------------------------------
-- A note on `(select auth.uid())` in the policies below
-- ---------------------------------------------------------------------------
-- `034` and `081` write bare `auth.uid()` in their policy predicates. The
-- parenthesised form here is Supabase's documented initplan idiom — the planner
-- evaluates it once per statement rather than once per row — and is
-- SEMANTICALLY IDENTICAL. It is not a behaviour change and must not be read as
-- one; the assertions in the suite match on the surrounding predicate text
-- rather than on this spelling.
--
-- ===========================================================================
-- SECURITY ADVISORS: this file adds exactly TWO
-- ===========================================================================
-- `authenticated_security_definer_function_executable` fires once per PUBLIC
-- `security definer` function executable by `authenticated`. This file adds
-- three functions and only two are that:
--
--   public.delete_own_ride_thread_message(uuid)  definer, published  -> +1
--   public.moderate_ride_thread(uuid)            definer, published  -> +1
--   public.ride_thread_unread(uuid)              INVOKER             -> +0
--   public.stamp_ride_thread_read()              invoker, EXECUTE revoked -> +0
--
-- ** `ride_thread_unread` is `security invoker` DELIBERATELY, and making it a
-- definer would add a third advisor for nothing. ** Measured: its club sibling
-- `public.club_thread_unread` is `prosecdef = false`. Invoker is also what makes
-- §2's SELECT policies decide what counts — crew and blocks included — so there
-- is no second copy of the audience rule and a ride the caller cannot see
-- answers zero rows rather than raising.
--
-- Measured baseline 2026-09-06, BOTH projects at migration 107: 39 security
-- advisors each (36 `authenticated_security_definer_function_executable`, 2
-- `rls_enabled_no_policy`, 1 `auth_leaked_password_protection`). After this file
-- applies, the target project must read 41. A 42nd means a revoke did not land
-- or the reader was written `definer`.

-- ===========================================================================
-- §1. The tables
-- ===========================================================================

-- `id` has a default and is deliberately client-suppliable, per `034` and
-- `081`: an interrupted create retried with the same id lands as a 23505 the
-- action reads as success rather than double-posting. It discloses nothing —
-- RLS evaluates WITH CHECK BEFORE the index insert, so a caller who is not on
-- the crew is refused 42501 and never reaches 23505.
--
-- No `updated_at` and no UPDATE policy or grant anywhere in this file. See the
-- header.
create table public.ride_threads (
  id uuid default uuid_generate_v4() primary key,
  ride_id uuid references public.rides(id) on delete cascade not null,
  -- ON DELETE CASCADE, following `club_threads`. The cost is real and stays
  -- stated: because messages cascade from the thread, deleting a THREAD AUTHOR's
  -- account deletes a conversation other riders took part in — wider than
  -- `ride_messages`, where only the leaver's own messages went.
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  created_at timestamptz default now() not null,

  -- 80, which is `rides_title_length`'s bound from `018` and `club_threads`'
  -- from `081` — the repo's existing ceiling for a rider-authored title, so one
  -- Zod schema shape serves both domains.
  --
  -- ** The FLOOR is `~ '\S'` and deliberately NOT `length(btrim(title)) >= 1`. **
  -- `btrim` with no second argument strips SPACES ONLY — measured:
  --
  --   select length(btrim(E'\n\n')), length(btrim('   '));   -->  2 | 0
  --
  -- so the btrim form accepts a title of newlines while the Zod schema's
  -- `.trim()` refuses it: the client STRICTER than the database, which is the
  -- exact inversion CLAUDE.md's "no new integrity rule may live only in a Zod
  -- schema" exists to prevent. `~ '\S'` is "contains at least one non-whitespace
  -- character" and has no such gap.
  --
  -- The ceiling is on the RAW length so padding cannot smuggle a longer value
  -- past a trimmed check.
  constraint ride_threads_title_length check (
    title ~ '\S' and length(title) <= 80
  )
);

alter table public.ride_threads enable row level security;

comment on table public.ride_threads is
  'Titled threads on a ride (108, PD-402). The audience is an INTERSECTION and NEITHER HALF ALONE IS IT: riders who can see the ride (an EXISTS against rides, resolved under the caller''s own row security) AND who are on its crew (private.is_ride_crew — organizer, or any ride_members row of either status). The crew helper is security definer and steps past the block arm, the private-club arm and 083''s live-invite arm of the rides policy, so using it on its own lets a rider who blocked the organizer, or who left the private club, keep reading — 034''s first draft shipped exactly that. ** This is the INVERSE of club_threads (081), where the parent EXISTS is the redundant half; do not transfer that file''s conclusion. ** An accepted-invite rider who is NOT in the ride''s private club reads these in full and reaches no part of the club (proposal.md Q1''s stated default); a PENDING invitee reads the ride and none of its threads, because 083''s arm widens ride visibility and never thread visibility. Not editable by anyone: no UPDATE policy and no UPDATE grant. ** No DELETE policy and no DELETE grant either ** — removal is public.moderate_ride_thread(uuid), whose two authority arms are the ride''s ORGANIZER and the thread''s own AUTHOR and nothing else: a crew member who is neither is refused, and a club''s owner or admin gains nothing here because a ride has no admin role.';

comment on column public.ride_threads.created_at is
  'Server-owned: WITHHELD from the INSERT column grant (108 §3b, following 034 §4b and 081 §3), because a default applies only when the column is OMITTED and PostgREST will happily send it. The thread list sorts on this, so a client-stamped value pins a thread to the top of a ride for ever.';

comment on column public.ride_threads.id is
  'Client-suppliable on purpose (034''s precedent): an interrupted create retried with the same id lands as 23505, which the action reads as success rather than double-posting. It discloses nothing — RLS evaluates WITH CHECK before the index insert, so a non-crew caller is refused 42501 and never reaches 23505.';

-- The grandchild. Its SELECT policy restates the WHOLE chain rather than hanging
-- off the thread with a bare EXISTS — see the header, and `082`'s ruling.
--
-- A `private.is_ride_thread_crew(thread uuid)` helper making that one call was
-- considered and rejected for `081`'s reason and one more: it would hide the
-- two-hop chain inside a definer body nobody reads at review time, and a definer
-- function reading `ride_threads` sees neither the block arm nor the `rides`
-- conjunct — which is the very substitution that made `034`'s first draft a leak.
create table public.ride_thread_messages (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references public.ride_threads(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now() not null,

  -- 1000, matching `ride_messages` (034) and `club_messages` (081). The
  -- DIRECTION is the argument: a conversation holds far more rows than a comment
  -- thread, so its per-row bound should be tighter than a comment's rather than
  -- looser. `~ '\S'` for the floor, for the reason on the title constraint above.
  constraint ride_thread_messages_body_length check (
    body ~ '\S' and length(body) <= 1000
  )
);

alter table public.ride_thread_messages enable row level security;

comment on table public.ride_thread_messages is
  'Messages inside a ride thread (108, PD-402). A GRANDCHILD: its SELECT policy RESTATES the full audience — the rides EXISTS, private.is_ride_crew reached through the thread''s ride_id, and its own block arm on ride_thread_messages.author_id — rather than relying on the one-hop EXISTS against ride_threads, so the audience is discoverable from its own policy text and a change to the thread policy cannot silently retarget it. The block arm is on the MESSAGE''s author, not inherited from the thread: a thread by an unblocked author can hold messages by a blocked one. ** There is NO DELETE POLICY and NO DELETE GRANT, and that is the enforcement rather than an oversight ** — deletion is public.delete_own_ride_thread_message(uuid). RLS applies the SELECT policy to a DELETE whose WHERE names a column (measured, Postgres 17.6), so a rider blocked by the thread''s author, or one who has left the crew, would silently be unable to erase their own words through a policy — which is the residual DELETE 0 that 102 had to leave open on ride_messages and that this table does not have. No UPDATE policy and no UPDATE grant either.';

comment on column public.ride_thread_messages.created_at is
  'Server-owned: WITHHELD from the INSERT column grant (108 §3b, following 034 §4b). The thread is ordered by it with an id tiebreak, so a client-stamped value pins a message to the end of every crew member''s thread for ever, and a keyset cursor over it would skip or repeat rows.';

comment on column public.ride_thread_messages.id is
  'Client-suppliable on purpose (034''s precedent), and the second half of the ordering key: (created_at, id) is the tiebreak used by the index, the read query and the pagination cursor alike, because created_at is not a total order — two rows inserted in one transaction carry an identical now().';

-- The per-thread read watermark. `061`'s and `081`'s shape, with `068` and `079`
-- applied at birth rather than inherited-then-repaired.
--
-- ** BOTH key columns carry a foreign key, and the `profiles` one is the half
-- that would be a privacy defect rather than a correctness one. ** A row here
-- says "this named person last read this named topic". Without the `profiles`
-- FK it survives their account deletion for ever, `029` working purely by
-- cascade with nothing reporting the gap.
--
-- ** `user_id` LEADS the primary key and that ordering is load-bearing: ** `029`
-- asserts from `pg_constraint` that no foreign key into `profiles` lacks a
-- leading-column index, so `(thread_id, user_id)` would fail the suite.
--
-- ** No `unique nulls not distinct`. ** `015` needs that clause because
-- `feed_reads.club_id IS NULL` MEANS the app-wide feed. There is no app-wide
-- ride thread; both key columns are NOT NULL, so a real primary key is
-- available, and a clause expressing a rule this table does not have teaches the
-- next reader that the audience is nullable.
--
-- ** This is the junction `design.md` D12 predicts, and it is harmless: **
-- primary key (user_id, thread_id) is exactly the union of its two foreign keys,
-- so PostgREST counts it as a relationship between `profiles` and `ride_threads`
-- — a pair no shipped bundle can already embed, because `ride_threads` is
-- created by this same file. `ride_threads` itself is NOT a junction: its
-- primary key is `id`, so holding keys to `rides` and `profiles` does not make it
-- one, and `src/lib/data/columns.ts` names "any third table holding a key to
-- both" as the tempting-and-FALSE rule with `postcards` as the counter-example.
-- Verified after apply in §Verification.
create table public.ride_thread_reads (
  user_id uuid references public.profiles(id) on delete cascade not null,
  thread_id uuid references public.ride_threads(id) on delete cascade not null,
  last_read_at timestamptz default now() not null,

  primary key (user_id, thread_id)
);

alter table public.ride_thread_reads enable row level security;

comment on table public.ride_thread_reads is
  'Per-thread read watermark on a ride (108, PD-402). One row per (rider, thread); last_read_at is server-imposed by public.stamp_ride_thread_read() on INSERT and UPDATE, never client-supplied — not for tamper-resistance but because it is compared against ride_thread_messages.created_at, which is server-owned, and a comparison spanning a phone''s clock and the database''s is wrong in a way nothing logs (068). Readable ONLY by the row''s owner: this app has no read receipts, and that is a refusal rather than an omission. ** Its three policies are `user_id = auth.uid()` at TOP LEVEL with no ride-visibility conjunct anywhere ** (design.md D6) — a watermark is a fact about the READER rather than about the content, so it discloses nothing and it does not strand when the rider leaves the crew. The cost is stated in 108''s header: the un-audienced WITH CHECK makes the INSERT an existence oracle for a thread id, which 081 §2 closed on club_thread_reads and this deliberately does not. Retention is indefinite: it dies with the thread or the rider, through the two cascades and nothing else.';

-- ===========================================================================
-- §1b. Indexes
-- ===========================================================================

-- The thread list's only query: one ride's threads, newest first.
create index ride_threads_ride_id_idx
  on public.ride_threads (ride_id, created_at desc);

-- Not for a screen — for the ON DELETE CASCADE from `profiles`. Account deletion
-- has to find this rider's threads, and `029` asserts the index exists rather
-- than trusting it. `notifications`' "every cascade path SHALL be indexed".
create index ride_threads_author_id_idx
  on public.ride_threads (author_id);

-- One thread's messages, newest first, keyset paged. ** The tiebreak must match
-- the read query and the cursor ** — `created_at` is not a total order, so two
-- rows inserted in one transaction carry an identical `now()`, sort arbitrarily,
-- and break a keyset cursor at the page boundary. `exists` in
-- ride_thread_unread short-circuits on the first row through this index, which
-- is what makes the unread answer O(1) in thread length.
create index ride_thread_messages_thread_id_idx
  on public.ride_thread_messages (thread_id, created_at desc, id desc);

-- The cascade from `profiles`, as above.
create index ride_thread_messages_author_id_idx
  on public.ride_thread_messages (author_id);

-- The cascade a THREAD deletion runs. The primary key leads with `user_id`, so
-- deleting one thread has nothing to find its watermarks by without this —
-- mirroring `club_thread_reads_thread_id_idx` and `ride_reads_ride_id_idx`.
create index ride_thread_reads_thread_id_idx
  on public.ride_thread_reads (thread_id);

-- ===========================================================================
-- §2. Policies on the two content tables
-- ===========================================================================

-- The three conjuncts, in the order the header explains them.
--
-- The block arm is about the AUTHOR: on a ride two riders are both on, a rider
-- you blocked must not appear. Symmetric through the helper, so one directional
-- `blocks` row holds in BOTH directions and no call site may re-check the
-- reverse — `009`'s rule, and never a query against `blocks` from a policy
-- (decision #2), because the blocked party cannot read that row.
--
-- A blocked rider's thread is hidden WHOLE, conversation included. That hides
-- messages from riders the viewer has not blocked, and it is decision #2 read
-- literally; the alternative — render the thread, suppress the byline — is a
-- second visibility rule to keep in step and leaks that a hidden rider exists.
-- It is also part of what makes §4b's RPC necessary.
--
-- Your own thread is unconditional WITHIN the crew check, and the own-row arm is
-- NOT hoisted above it. See the header for why, and for why no assertion can
-- detect the arm itself.
create policy "Ride threads are readable by that ride's crew"
  on public.ride_threads for select to authenticated
  using (
    -- ** Under the CALLER's row security, so this IS the rides SELECT policy —
    -- every arm of it, including the three a `security definer` crew helper
    -- steps past. Removing it is 034's first draft and it is a LEAK, not a
    -- tidy-up. ** 108.9 and 108.10 are the assertions that fail.
    exists (select 1 from public.rides r where r.id = ride_threads.ride_id)
    and private.is_ride_crew(ride_id)
    and (
      author_id = (select auth.uid())
      or not private.is_blocked((select auth.uid()), author_id)
    )
  );

-- "Cannot start a thread on a ride you are not on", as the same conjunction.
-- A rider who can SEE a public ride but has not RSVP'd is refused here, which is
-- the whole point of the table having its own predicate — and the same
-- conjunction is needed for the same reason rather than for symmetry: without
-- it, a rider who blocked the organizer or left the private club could post into
-- a ride they cannot see.
--
-- ** No block arm on the INSERT, deliberately. ** A blocked pair who are both on
-- the crew may both post, and each sees only their own. Refusing the write would
-- disclose the existence of the block to the poster; blocking removes visibility
-- and does not evict either party from a shared space.
create policy "Ride crew open their own threads, as themselves"
  on public.ride_threads for insert to authenticated
  with check (
    author_id = (select auth.uid())
    -- Why the EXISTS is here: see the SELECT policy above. Same conjunction,
    -- same reason.
    and exists (select 1 from public.rides r where r.id = ride_threads.ride_id)
    and private.is_ride_crew(ride_id)
  );

-- NO DELETE POLICY and NO UPDATE POLICY on ride_threads. The absence is the
-- enforcement — see the header. Removal is public.moderate_ride_thread(uuid).

-- The two-hop chain, written out. The inner EXISTS resolves under the caller's
-- row security, so `ride_threads`' own policy composes correctly today and the
-- two inner conjuncts are strictly redundant a second time. They are written
-- anyway: without them this table's audience is undiscoverable from its own
-- policy text, and a later change to the thread policy silently retargets it.
-- 108.13 asserts a direct-by-id read for exactly that.
create policy "Ride thread messages are readable by that ride's crew"
  on public.ride_thread_messages for select to authenticated
  using (
    exists (
      select 1 from public.ride_threads t
       where t.id = ride_thread_messages.thread_id
         -- ** The rides EXISTS, restated one hop down and under the caller's own
         -- row security. Not decoration: a one-hop EXISTS against ride_threads
         -- alone would make this table's audience a silent function of somebody
         -- else's policy. **
         and exists (select 1 from public.rides r where r.id = t.ride_id)
         and private.is_ride_crew(t.ride_id)
    )
    and (
      author_id = (select auth.uid())
      or not private.is_blocked((select auth.uid()), author_id)
    )
  );

create policy "Ride crew post into their ride's threads, as themselves"
  on public.ride_thread_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    -- The same restated chain, so a rider cannot post into a thread they cannot
    -- read. The one case it touches is a rider blocked by the thread's author,
    -- who cannot reach the thread's screen at all — and there the refusal is the
    -- CORRECT answer.
    and exists (
      select 1 from public.ride_threads t
       where t.id = ride_thread_messages.thread_id
         and exists (select 1 from public.rides r where r.id = t.ride_id)
         and private.is_ride_crew(t.ride_id)
    )
  );

-- NO DELETE POLICY and NO UPDATE POLICY on ride_thread_messages either.
-- Deletion is public.delete_own_ride_thread_message(uuid), §4b.

-- ===========================================================================
-- §3. The watermark's policies, the grants and the triggers
-- ===========================================================================

-- §3a. The watermark's three policies.
--
-- ** All three are `user_id = auth.uid()` at TOP LEVEL, with no ride-visibility
-- and no crew conjunct anywhere. ** `design.md` D6: a watermark is a fact about
-- the READER rather than about the content, so it discloses nothing about a ride
-- and it must not strand when the rider leaves the crew.
--
-- SELECT's narrowness is a DECISION rather than an omission. A watermark is
-- behavioural personal data about an identified person — when they last looked
-- at a named conversation — so "the thread's author can see I read at 03:40" is
-- a fact about one rider on one night. This app has no read receipts, and the
-- policy is where that is refused: the data to draw a "seen by" row is
-- unreachable, so adding one is a migration and a conversation.
--
-- ** This DEPARTS from `081` on the two write policies, and the cost is named in
-- the header rather than left to be discovered: ** `club_thread_reads`' WITH
-- CHECK carries the full club audience, for `015` §2's reason — without an
-- audience predicate the foreign key turns an INSERT into an existence oracle,
-- because a nonexistent thread id raises 23503 while an existing-but-invisible
-- one succeeds. That oracle is reintroduced here. It discloses existence only,
-- never content or membership, and closing it is one `exists (...)` per write
-- policy that changes no reachable client behaviour.
create policy "Riders see only their own ride thread watermarks"
  on public.ride_thread_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Riders mark only their own ride threads read"
  on public.ride_thread_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

-- The upsert's UPDATE arm. USING scopes which rows may be REACHED and WITH CHECK
-- what they may BECOME; both are the same predicate here because there is only
-- one.
create policy "Riders advance only their own ride thread watermarks"
  on public.ride_thread_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- NO DELETE POLICY and no DELETE grant on ride_thread_reads. The honest reason
-- is that deleting a watermark means "mark this unread again", and no screen
-- draws that. ** It is NOT `015`'s stated reason and that sentence must not be
-- carried across: ** leaving the crew does not cascade this row away. The
-- foreign key is to `ride_threads`, so the row stands until the thread or the
-- rider goes, and rejoining REUSES it — which is precisely why §4a's comparison
-- point takes `greatest(last_read_at, joined_at)` rather than preferring the
-- stale pre-departure watermark.

-- ---------------------------------------------------------------------------
-- §3b. Grants
-- ---------------------------------------------------------------------------
-- RLS needs BOTH a table grant and a permitting policy. Note what is NOT
-- granted: DELETE and UPDATE on either content table, DELETE on the watermark,
-- and anything at all to `anon` — decision #1, and no route is created or
-- implied for it.
revoke all on public.ride_threads, public.ride_thread_messages,
             public.ride_thread_reads from anon, authenticated;

grant select on public.ride_threads to authenticated;
grant select on public.ride_thread_messages to authenticated;
grant select, insert, update on public.ride_thread_reads to authenticated;

-- INSERT is granted per COLUMN and `created_at` is not one of them, following
-- `034` §4b rather than relying on `default now()`: a default applies only when
-- the column is OMITTED, and PostgREST will happily name it. ** The default is
-- the value; the grant is the guarantee. ** `id` IS granted — the client chooses
-- it on purpose, so an interrupted write can be retried idempotently.
grant insert (id, ride_id, author_id, title) on public.ride_threads to authenticated;
grant insert (id, thread_id, author_id, body) on public.ride_thread_messages to authenticated;

-- UPDATE on the watermark is granted at TABLE level rather than per column, for
-- `061` §5's reason: there is nothing to withhold. `user_id` and `thread_id` are
-- pinned by the policy and `last_read_at` by §3c's trigger, so a column list
-- would restate what two other mechanisms already enforce and would break the
-- upsert's UPDATE arm besides.

-- ---------------------------------------------------------------------------
-- §3c. The watermark's clock
-- ---------------------------------------------------------------------------
-- BOTH arms, not just INSERT. A BEFORE INSERT trigger alone would impose the
-- value on a rider's first visit to a thread and keep the CLIENT's on every
-- visit after — the worst of the three available behaviours, because it works on
-- fresh rows and drifts in use. This is `068`'s fix applied at birth.
--
-- ** Withholding the column grant would NOT do this job, and the obvious reason
-- for that is false. ** It is tempting to write "the upsert's UPDATE arm must
-- name `last_read_at`, so revoking the grant would fail 42501". It would not:
-- PostgREST builds `on conflict ... do update set` from the columns present in
-- the request BODY, so a client that omits the column needs no privilege on it
-- and nothing raises (`061` §3's measured correction). The trigger is the
-- mechanism; the grant is not.
--
-- `security invoker` (the default): it reads nothing and writes nothing but NEW,
-- so it needs no elevated rights, and an invoker function raises no
-- `authenticated_security_definer_function_executable` advisor. EXECUTE is
-- revoked anyway — Postgres checks EXECUTE on a trigger function at CREATE
-- TRIGGER time, not at fire time, which is what makes that revoke free.
create function public.stamp_ride_thread_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_read_at := now();
  return new;
end;
$$;

comment on function public.stamp_ride_thread_read() is
  'Imposes ride_thread_reads.last_read_at from the server clock on INSERT and UPDATE (108). Not tamper-resistance — forging your own watermark suppresses your own dot — but because the value is compared against ride_thread_messages.created_at, which 108 §3b makes server-owned, and a comparison spanning two clocks is wrong in a way nothing logs (068).';

revoke all on function public.stamp_ride_thread_read() from public, anon, authenticated;

create trigger stamp_ride_thread_read
  before insert or update on public.ride_thread_reads
  for each row
  execute function public.stamp_ride_thread_read();

-- ---------------------------------------------------------------------------
-- §3d. The twenty-second and twenty-third participation-gate triggers
-- ---------------------------------------------------------------------------
-- A thread and a message are content writes, exactly as a ride message is
-- (`034` §5) and a club thread is (`081` §3). Two tables, so TWO triggers —
-- reading a sweep as one is the mistake `078`'s own task list made and `081`'s
-- header records.
--
-- The WHEN clause is not decoration: `023` §2 measured that a `security definer`
-- function sees `current_user` as its OWNER, so a guard inside the body would be
-- true on every call and the gate would never fire. It is evaluated in the
-- caller's context, before the function is entered. This is also why no content
-- write in this change goes through a definer RPC.
drop trigger if exists enforce_participation_gate on public.ride_threads;
create trigger enforce_participation_gate
  before insert on public.ride_threads
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.ride_thread_messages;
create trigger enforce_participation_gate
  before insert on public.ride_thread_messages
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- ** NO gate trigger on ride_thread_reads, and the suite asserts the ABSENCE. **
-- `023`'s stated reason for excluding `feed_reads`, `061`'s for `ride_reads` and
-- `081`'s for `club_thread_reads`: a watermark produces nothing anyone sees.
-- Asserting the absence is `078`'s lesson inverted — a count that quietly reads
-- complete is worse than one that reads short.

-- The comment on the gate function is the `data` agent's first read via
-- `list_tables`, and no edit to CLAUDE.md reaches it — `028` and `033` exist for
-- exactly this. ** Composed from the LIVE comment on letsride-dev 2026-09-06,
-- not from a copy in an earlier file: ** `092`, `093`, `094` and `101` each
-- rewrote this same string and the last writer wins, so this extends `101`'s
-- rather than reverting it.
--
-- ** The count moves 21 -> 23 here and 23 -> 22 when 109 drops ride_messages. **
-- 109 restamps it again; it is deliberately not pre-adjusted, because a comment
-- describing a state the database is not yet in is worse than one a later file
-- corrects.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, twenty-three BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085), the seventeenth ride_invite_links (091), the eighteenth club_join_waves (092), the nineteenth club_invites and the twentieth club_invite_links (093), the twenty-first club_thread_reports (094), the twenty-second ride_threads and the twenty-third ride_thread_messages (108); the five uncovered INSERT-policy tables are named in 023''s header with their reasons. 101 (PD-373) dropped club_thread_waves, which 092 made the EIGHTEENTH and which was the other half of 092''s pair — so club_join_waves moves up into that ordinal and every entry after it shifts down by one. The ordinals are positions in this list and nothing more: no trigger moved, and club_join_waves keeps its gate. ** 109 drops ride_messages and this count returns to twenty-two. **';

-- ===========================================================================
-- §4. The reader, the two definer RPCs, and the publication
-- ===========================================================================

-- §4a. The unread answer, one call for a whole ride's thread list.
--
-- Four properties, each carrying its precedent:
--
--   1. ** SECURITY INVOKER ** — so §2's SELECT policies decide what counts, the
--      crew rule and blocks included. No block filter appears here, in
--      `lib/data/` or in a component: one copy of the rule, in the policy that
--      already owns it. A ride the caller cannot see answers zero rows,
--      identically to a ride that does not exist, so the RPC is not an existence
--      oracle. If it ever flips to `definer` it starts answering `true` for
--      threads the caller cannot read; the suite asserts `prosecdef` is false,
--      and a definer here would also add a third security advisor for nothing.
--      Measured: `public.club_thread_unread` is `prosecdef = false`.
--   2. ** author_id <> auth.uid() ** — `079`'s fix applied at birth. Your own
--      message never lights your own dot, and the answer is then correct
--      independently of whether the watermark won a race with the navigation.
--   3. ** greatest(last_read_at, joined_at), NOT a coalesce between them. ** A
--      watermark row SURVIVES leaving the crew: the FK is to `ride_threads`, so
--      nothing cascades it away, and rejoining reuses it. With `last_read_at`
--      merely first in a coalesce, a rider who read a thread in March, left, and
--      rejoined in September is compared against their March watermark and is
--      badged with every message sent while they were away. `greatest` takes
--      whichever is later. Measured: `greatest` IGNORES NULL —
--      `greatest(ts, null)` returns `ts` — and is NULL only when every argument
--      is, so the outer coalesce still falls through to the third arm.
--   4. ** The third arm is load-bearing TODAY. ** A ride's ORGANIZER may hold no
--      `ride_members` row at all — `034`'s header records the state as reachable
--      on demand, and `private.is_ride_crew`'s organizer arm exists because of
--      it. Without this arm their comparison point is NULL, every
--      `created_at > NULL` is NULL, and the host is the one crew member whose
--      dot never lights, silently and for ever.
--
-- All three arms are on the DATABASE's clock: `048` made membership timestamps
-- server-owned and §3b's column grant does the same for `ride_threads.created_at`.
-- A comparison spanning two clocks through the FALLBACK would be the same defect
-- wearing a fallback's clothes.
--
-- Boolean rather than a count, for `061`'s reason: `exists` short-circuits, so
-- it is O(1) in thread length through ride_thread_messages_thread_id_idx, with
-- no `limit` to justify and no number for someone to render later.
create function public.ride_thread_unread(ride uuid)
returns table (thread_id uuid, has_unread boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id,
         exists (
           select 1
             from public.ride_thread_messages m
            where m.thread_id = t.id
              and m.author_id <> auth.uid()
              and m.created_at > coalesce(
                    greatest(
                      (select w.last_read_at from public.ride_thread_reads w
                        where w.user_id = auth.uid() and w.thread_id = t.id),
                      (select k.joined_at from public.ride_members k
                        where k.ride_id = t.ride_id and k.user_id = auth.uid())
                    ),
                    t.created_at
                  )
         )
    from public.ride_threads t
   where t.ride_id = ride;
$$;

comment on function public.ride_thread_unread(uuid) is
  'Which of this ride''s threads hold a message the caller has not read (108)? ** SECURITY INVOKER **, so 108 §2''s SELECT policies decide what counts — the ride EXISTS, private.is_ride_crew and blocks included — and a ride the caller cannot see answers zero rows rather than raising. It therefore adds NO security advisor; making it definer would add one and would start answering true for threads the caller cannot read. Excludes the caller''s own messages (079''s fix at birth). The comparison point is coalesce(greatest(last_read_at, joined_at), created_at): GREATEST rather than a coalesce between the first two, because a watermark survives leaving the crew and a rejoiner would otherwise be badged with the whole back catalogue; the third arm is what keeps a ride ORGANIZER holding no ride_members row from being the one crew member whose dot never lights.';

-- ---------------------------------------------------------------------------
-- §4b. Erasing your own message, which a block and a departure must not be able
--      to take away
-- ---------------------------------------------------------------------------
-- See the header for the measurement that makes this necessary rather than
-- merely tidy: `ride_thread_messages` carries no DELETE policy and no DELETE
-- grant at all, and this function is the only path.
--
-- ** Authorship is the WHOLE test — no crew conjunct and no ride conjunct. **
-- Your own words are always retractable, including after you leave the crew and
-- including after somebody blocks you. That is the point: `102` recorded a
-- residual silent `DELETE 0` on `ride_messages` for exactly the rider who left
-- the crew of a ride they can still see, and could not fix it without breaking
-- the intersection invariant. This closes it by not being a policy at all —
-- `security definer` runs the body with RLS bypassed, so the SELECT policy never
-- attaches. Adding a crew requirement here would recreate the stranded row.
--
-- One raise site, so "not yours" and "no such message" are indistinguishable and
-- the function is not an existence oracle. There is deliberately no separate
-- "requires a session" raise: a NULL `auth.uid()` matches no `author_id`, so it
-- leaves by the same door.
create function public.delete_own_ride_thread_message(message uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  -- The whole access control. `security definer` bypasses RLS, so this
  -- predicate is the only thing between a caller and another rider's words.
  select m.id
    into v_id
    from public.ride_thread_messages m
   where m.id = message
     and m.author_id = v_uid
     for update;

  if not found then
    raise exception 'no message with that id was written by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.ride_thread_messages m where m.id = v_id;
end;
$$;

comment on function public.delete_own_ride_thread_message(uuid) is
  'Deletes exactly one message the CALLER wrote (108). Exists because a policy-based delete cannot satisfy the rule: RLS applies the SELECT policy to a DELETE whose WHERE names a column (measured, Postgres 17.6), so a rider blocked by the thread''s author — or one who has simply left the crew — cannot see their own reply and the delete matches zero rows while PostgREST reports success. That is the residual silent DELETE 0 that 102 recorded on ride_messages and deliberately left open rather than break the audience intersection; this table does not have it. Takes no user id and acts only for its caller (078''s push_devices shape). ** Authorship is the whole test: no crew conjunct and no ride conjunct **, because requiring current crew membership is what created the stranded row. One raise site, so "not yours" and "no such message" are indistinguishable.';

-- ---------------------------------------------------------------------------
-- §4c. Removing a thread — the organizer, and the thread's own author
-- ---------------------------------------------------------------------------
-- ** TWO authority arms and no third: `rides.organizer_id = auth.uid()` OR
-- `ride_threads.author_id = auth.uid()`. ** A ride has an organizer and no other
-- role — `ride_members.status` admits `going` and `maybe` only, there is no role
-- column, and PD-351 records that nothing can even remove a rider from a ride —
-- so the moderation authority is the organizer (`design.md` D4,
-- `proposal.md` Q2). The AUTHOR arm is a different right arriving at the same
-- function: `081` gave `club_threads` a DELETE POLICY for its author, and 2.8
-- forbids one here, so without this disjunct an author could delete their thread's
-- messages one by one and never the thread. The spec requires it — see the
-- header for both citations, including the exclusion that names the author as
-- someone who is NOT refused.
--
-- ** It is NOT `private.is_ride_crew`, and the distinction is the point: crew is
-- who may TALK, organizer-or-author is who may REMOVE. ** An ordinary crew
-- member who authored nothing is refused. Keeping the predicates distinct is
-- what stops a future edit from widening removal to the whole crew by
-- pattern-matching on the read policy — which is easy to do here, because
-- `is_ride_crew`'s FIRST disjunct is `rides.organizer_id = auth.uid()`, so the
-- two agree on the organizer and differ on everyone else.
--
-- ** A club's OWNER or ADMIN gains nothing here, and refusing that is deliberate
-- rather than an omission. ** `094` makes the club admin the moderation
-- authority over CLUB threads, so a build porting `094` is actively invited to
-- give them a ride thread too. The answer is no: it would make the authority
-- depend on a relationship the thread does not carry, it would let a club admin
-- remove a thread on a ride they are not on and cannot read — and therefore
-- cannot even enumerate to act on — and it fails the private-club-invitee case in
-- reverse, moderating a rider by someone with no connection to them.
--
-- An RPC rather than a DELETE policy arm, for the reason in the header: RLS
-- filters a DELETE by what the caller may READ, so an organizer who has blocked
-- the thread's author cannot see that thread and a policy-arm delete keyed on
-- its id matches zero rows — silently. ** The organizer being able to remove a
-- thread whose author has blocked them is the whole reason this is a function **,
-- and it is the case a DELETE policy provably could not serve.
--
-- `043`'s shape, including ONE raise site, so "no such thread", "not your ride"
-- and "not your thread" are indistinguishable and a caller learns nothing about
-- a ride they do not organize.
create function public.moderate_ride_thread(thread uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  -- The whole access control is this disjunction. There is no policy backstop
  -- behind these two lines: `security definer` runs the body with RLS bypassed,
  -- so they are the only thing between a caller and another ride's
  -- conversation. They are the lines to read first in any future edit.
  --
  -- ** A crew member who is neither is REFUSED, which is what keeps this from
  -- being the read policy's crew helper wearing a different spelling. ** That
  -- helper's name is deliberately absent from this body: the suite asserts it is
  -- not here by matching `prosrc`, and a mention in a comment would satisfy that
  -- match and make the assertion vacuous (085.28's rule).
  select t.id
    into v_id
    from public.ride_threads t
    join public.rides r on r.id = t.ride_id
   where t.id = thread
     and (r.organizer_id = v_uid or t.author_id = v_uid)
     for update of t;

  if not found then
    raise exception 'no thread with that id was written by the caller or sits on a ride they organize'
      using errcode = 'insufficient_privilege';
  end if;

  -- One row. The FK cascades take the messages and the watermarks.
  delete from public.ride_threads t where t.id = v_id;
end;
$$;

comment on function public.moderate_ride_thread(uuid) is
  'Deletes exactly one thread on a ride the caller ORGANIZES, or one the caller WROTE (108, PD-402). ** TWO authority arms and no third: rides.organizer_id = auth.uid() OR ride_threads.author_id = auth.uid(). ** NOT private.is_ride_crew — a crew member who is neither the organizer nor the author is refused, and crew is who may talk while organizer-or-author is who may remove (design.md D4) — and NOT the club''s owner or admins, because the resource is the ride and a ride has no admin role. The author arm is here rather than in a DELETE policy because 108 grants no DELETE on this table at all, and rather than in a second RPC because the spec names this function, singular, and a fourth published definer function would move the counted +2 advisor delta to +3. security definer and an RPC rather than a policy arm, because RLS filters a DELETE by what the caller may READ: an organizer who has blocked the thread''s author cannot see the row, so a policy-arm delete would match zero rows and PostgREST would report success — removing a thread whose author has blocked them is the case a DELETE policy could not serve and the whole reason this exists. One raise site, so "no such thread", "not your thread", "not your ride" and "a ride you cannot see" all leave by the same door. The messages and watermarks go by cascade, INCLUDING other riders'' messages inside the thread.';

-- ---------------------------------------------------------------------------
-- §4d. Function grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on every new function unless told otherwise,
-- and the harness reproduces Supabase's default function grants for the same
-- reason. ** Reachability is asserted by naming a ROLE, never by calling the
-- function: ** the suite runs as the table owner, for whom no barrier exists —
-- `031` exists because `029` shipped a function nothing could call.
revoke all    on function public.ride_thread_unread(uuid) from public, anon;
grant execute on function public.ride_thread_unread(uuid) to authenticated;

revoke all    on function public.delete_own_ride_thread_message(uuid) from public, anon;
grant execute on function public.delete_own_ride_thread_message(uuid) to authenticated;

revoke all    on function public.moderate_ride_thread(uuid) from public, anon;
grant execute on function public.moderate_ride_thread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §4e. Realtime
-- ---------------------------------------------------------------------------
-- Membership of `supabase_realtime` is what makes a subscription fire. It is a
-- publication, not a policy, and that distinction is the trap: a client
-- subscribing to a table OUTSIDE the publication CONNECTS, REPORTS SUBSCRIBED,
-- AND SILENTLY NEVER RECEIVES ANYTHING — indistinguishable from a quiet
-- conversation. So it belongs in the migration chain beside the policies rather
-- than as a dashboard click.
--
-- ** `ride_threads` is deliberately NOT added, ** and the decision is recorded
-- here so a later session finds it in the file rather than in a channel that
-- reports SUBSCRIBED and never fires. `081` made the same call for
-- `club_threads`: a thread appearing live is not required by any screen, the
-- list revalidates by its own cache key, and one channel per thread on a list
-- screen multiplies subscriptions by the thread count.
--
-- ** `ride_messages` STAYS in the publication until 109 drops the table. ** Both
-- it and `ride_thread_messages` being members is the EXPECTED state for the
-- length of the gap between the two migrations, not drift — the old chat has to
-- keep working. `109`'s `drop table` takes the membership with it, so a
-- preceding `alter publication ... drop table` there would be redundant.
--
-- Realtime evaluates §2's SELECT policy per subscriber, so the crew and block
-- rules govern delivery too and there is no second copy of them. That is an
-- argument for keeping the rule in one place, not a reason to trust it untested:
-- `.claude/agents/realtime.md` requires confirming a blocked rider receives
-- SILENCE rather than inferring it from the policy, and the RLS suite cannot
-- make that assertion because plain Postgres has no Realtime.
--
-- Default replica identity, deliberately. `full` is needed only to carry the OLD
-- row on UPDATE and DELETE; this table has no UPDATE at all, and the subscriber
-- reads INSERT. Setting it `full` would put every column of every deleted row
-- into the WAL for a payload nothing reads.
alter publication supabase_realtime add table public.ride_thread_messages;

-- ===========================================================================
-- §Verification — run against the project after applying, do not assume
-- ===========================================================================
--
-- `apply_migration` takes SQL as an argument rather than a path, so the file and
-- the database can disagree by exactly one clause — and `022` shipped that
-- defect once, on `security definer` itself. Every number below is a PREDICTION.
--
--   -- 7 — 2 on ride_threads (select, insert), 2 on ride_thread_messages
--   -- (select, insert), 3 on ride_thread_reads (select, insert, update).
--   -- As a sorted COMMAND LIST rather than a count: a count also passes for a
--   -- set that swapped SELECT for UPDATE.
--   select tablename, string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('ride_threads','ride_thread_messages','ride_thread_reads')
--    group by 1 order by 1;
--   -- ride_thread_messages | INSERT,SELECT
--   -- ride_thread_reads    | INSERT,SELECT,UPDATE
--   -- ride_threads         | INSERT,SELECT
--
--   -- 0 — every policy is `to authenticated`, decision #1
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('ride_threads','ride_thread_messages','ride_thread_reads')
--      and roles::text[] <> array['authenticated'];
--
--   -- t, t, t — RLS is ON on all three
--   select relname, relrowsecurity from pg_class
--    where oid in ('public.ride_threads'::regclass,
--                  'public.ride_thread_messages'::regclass,
--                  'public.ride_thread_reads'::regclass);
--
--   -- ** THE LEAK CHECK. ** Both SELECT policies carry the rides EXISTS AND the
--   -- crew helper. This is the one that catches 034's first draft.
--   select polname,
--          pg_get_expr(polqual, polrelid) like '%FROM rides r%'      as rides_exists,
--          pg_get_expr(polqual, polrelid) like '%is_ride_crew%'      as crew,
--          pg_get_expr(polqual, polrelid) like '%is_blocked%'        as block
--     from pg_policy
--    where polrelid in ('public.ride_threads'::regclass,
--                       'public.ride_thread_messages'::regclass)
--      and polcmd = 'r';
--   -- both rows: t | t | t
--
--   -- 0 — anon holds nothing on any of the three, table-level or column-level
--   select count(*) from information_schema.role_table_grants
--    where table_name in ('ride_threads','ride_thread_messages','ride_thread_reads')
--      and grantee = 'anon';
--   select count(*) from information_schema.column_privileges
--    where table_name in ('ride_threads','ride_thread_messages','ride_thread_reads')
--      and grantee = 'anon';
--
--   -- ENUMERATED, not counted: a table-level grant and a complete column grant
--   -- are indistinguishable by count.
--   --   ride_threads ........... author_id, id, ride_id, title
--   --   ride_thread_messages ... author_id, body, id, thread_id
--   -- NEITHER carries created_at.
--   select table_name, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_name in ('ride_threads','ride_thread_messages')
--      and grantee = 'authenticated' and privilege_type = 'INSERT'
--    group by 1 order by 1;
--
--   -- f, f, f, f, f — the enforcement. SCOPED to the grantee: an unscoped count
--   -- reads 2 against a correct database, postgres and service_role holding
--   -- everything by Supabase default.
--   select has_table_privilege('authenticated','public.ride_threads','delete'),
--          has_table_privilege('authenticated','public.ride_threads','update'),
--          has_table_privilege('authenticated','public.ride_thread_messages','delete'),
--          has_table_privilege('authenticated','public.ride_thread_messages','update'),
--          has_table_privilege('authenticated','public.ride_thread_reads','delete');
--
--   -- 1, 1, 0 — ride_thread_messages IS in the publication, ride_messages STILL
--   -- is (the expected state until 109), ride_threads is NOT. The third is what
--   -- stops a later session subscribing to a table that will never fire.
--   select count(*) filter (where tablename = 'ride_thread_messages'),
--          count(*) filter (where tablename = 'ride_messages'),
--          count(*) filter (where tablename = 'ride_threads')
--     from pg_publication_tables where pubname = 'supabase_realtime';
--
--   -- f, t, t, f — the reader is INVOKER, both RPCs are DEFINER, the trigger
--   -- function needs no elevated rights. All four carry search_path="".
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('ride_thread_unread','delete_own_ride_thread_message',
--                      'moderate_ride_thread','stamp_ride_thread_read')
--    order by proname;
--
--   -- t, t — the pragma survived the round trip into both definer bodies
--   select proname, prosrc like '%#variable_conflict error%' from pg_proc
--    where proname in ('delete_own_ride_thread_message','moderate_ride_thread');
--
--   -- BOTH authority arms are present and the crew helper is NOT, pinned by
--   -- EQUALITY on the predicate rather than by a loose `like` on a column name
--   -- (085.28's rule: a mention of the name in a comment satisfies a pattern
--   -- match). The third column is the one that stops removal being widened to
--   -- the whole crew.
--   select prosrc like '%(r.organizer_id = v_uid or t.author_id = v_uid)%',
--          prosrc like '%is_ride_crew%'
--     from pg_proc where oid = 'public.moderate_ride_thread(uuid)'::regprocedure;
--   -- t | f
--
--   -- t/f pairs — reachability BY ROLE, never by calling it as the owner (031)
--   select has_function_privilege('authenticated','public.ride_thread_unread(uuid)','execute'),
--          has_function_privilege('anon',         'public.ride_thread_unread(uuid)','execute'),
--          has_function_privilege('authenticated','public.delete_own_ride_thread_message(uuid)','execute'),
--          has_function_privilege('anon',         'public.delete_own_ride_thread_message(uuid)','execute'),
--          has_function_privilege('authenticated','public.moderate_ride_thread(uuid)','execute'),
--          has_function_privilege('anon',         'public.moderate_ride_thread(uuid)','execute'),
--          has_function_privilege('authenticated','public.stamp_ride_thread_read()','execute');
--   -- t | f | t | f | t | f | f
--
--   -- 23 — the gate reaches both content tables now. TWO more, not one: the
--   -- trigger sweep fires once per table, which is what 078's task list got wrong.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- 0 — and ride_thread_reads did NOT acquire one
--   select count(*) from pg_trigger
--    where tgrelid = 'public.ride_thread_reads'::regclass
--      and tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- 3 — the watermark trigger is BEFORE and fires on both INSERT and UPDATE.
--   -- tgtype bit 2 is BEFORE, bit 4 INSERT, bit 16 UPDATE.
--   select (tgtype & 4 > 0)::int + (tgtype & 16 > 0)::int + (tgtype & 2 > 0)::int
--     from pg_trigger where tgname = 'stamp_ride_thread_read' and not tgisinternal;
--
--   -- 2, both 'c' — BOTH foreign keys on the watermark table, ON DELETE CASCADE.
--   -- The profiles one is the half whose absence would keep behavioural personal
--   -- data about a deleted rider indefinitely.
--   select conname, confrelid::regclass::text, confdeltype from pg_constraint
--    where conrelid = 'public.ride_thread_reads'::regclass and contype = 'f'
--    order by conname;
--
--   -- 0 — no FK created by this file is anything but ON DELETE CASCADE, which is
--   -- what makes the account-deletion reach complete with no new cleanup code.
--   select count(*) from pg_constraint
--    where contype = 'f' and confdeltype <> 'c'
--      and conrelid in ('public.ride_threads'::regclass,
--                       'public.ride_thread_messages'::regclass,
--                       'public.ride_thread_reads'::regclass);
--
--   -- ** THE JUNCTION CHECK (design.md D12). ** ride_thread_reads appears;
--   -- ride_threads MUST NOT. If ride_threads appears, its primary key was
--   -- written as (ride_id, author_id) or similar instead of `id`, and THAT is
--   -- the thing to stop on.
--   with fk as (select conrelid t, confrelid tgt, conkey cols, conname from pg_constraint
--               where contype = 'f'),
--        pk as (select conrelid t, conkey cols from pg_constraint where contype = 'p')
--   select a.t::regclass from fk a
--     join fk b on a.t = b.t and a.conname < b.conname join pk on pk.t = a.t
--    where a.tgt <> b.tgt
--      and (select array_agg(distinct x order by x) from unnest(a.cols || b.cols) x)
--        = (select array_agg(x order by x) from unnest(pk.cols) x);
--
--   -- ** THE OLD CHAT STILL WORKS. ** This file must be invisible to the shipped
--   -- bundle, so nothing about ride_messages or ride_reads may have moved.
--   select (select count(*) from pg_policies where tablename = 'ride_messages'),   -- 3
--          (select count(*) from pg_policies where tablename = 'ride_reads'),      -- 3
--          to_regprocedure('public.ride_has_unread(uuid)') is not null,            -- t
--          to_regprocedure('public.stamp_ride_read()') is not null;                -- t
--
-- And the advisors: `get_advisors(security)` must return FORTY-ONE, up from
-- thirty-nine (measured on both projects 2026-09-06 at migration 107). ** TWO
-- new `authenticated_security_definer_function_executable` WARNs, not one nor
-- three ** — the advisor fires once per function, so
-- `delete_own_ride_thread_message` and `moderate_ride_thread` add one each, and
-- `ride_thread_unread` is INVOKER and adds none. A forty-second means a revoke
-- did not land, or the reader was written `definer`.
--
-- ===========================================================================
-- §Rollback
-- ===========================================================================
--   alter publication supabase_realtime drop table public.ride_thread_messages;
--   drop function public.moderate_ride_thread(uuid);
--   drop function public.delete_own_ride_thread_message(uuid);
--   drop function public.ride_thread_unread(uuid);
--   drop table public.ride_thread_reads;      -- takes its trigger with it
--   drop function public.stamp_ride_thread_read();
--   drop table public.ride_thread_messages;   -- takes its gate trigger with it
--   drop table public.ride_threads;           -- takes its gate trigger with it
--   -- and restamp the enforce_participation_gate comment back to twenty-one,
--   -- removing the twenty-second and twenty-third entries.
--
-- Nothing else moved, so the rollback is complete rather than approximate. Note
-- the ORDER: the watermark table must go before its stamp function, and both
-- content tables before nothing — `ride_thread_messages` cascades from
-- `ride_threads`, so dropping the parent first would take it anyway.
