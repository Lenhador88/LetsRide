-- 081: club Discussions — titled threads inside a club, their messages, and the
--      per-thread unread watermark.
--
-- Linear PD-307; the epic is PD-299 and the proposal is
-- openspec/changes/add-club-discussions/.
--
-- ---------------------------------------------------------------------------
-- THE AUDIENCE INVERSION — read this before touching any policy below
-- ---------------------------------------------------------------------------
-- Both content tables' SELECT policy is a three-part conjunction, and each part
-- answers a different question:
--
--   exists (select 1 from public.clubs c where c.id = ...)   may I see this club
--   private.is_club_member(club_id)                          am I in it
--   author_id = auth.uid() or not private.is_blocked(...)    may I see this
--                                                            rider's words
--
-- ** This is 034's conjunction with the strictness INVERTED, and that inversion
-- is the one thing a future edit must not carry over wrong. ** For
-- `ride_messages` the parent EXISTS is the strict half: `rides` SELECT carries a
-- block arm and a private-club arm that a `security definer` crew helper steps
-- straight past, so the helper alone was a leak and 034's header says so.
--
-- Here the parent is the LOOSE half. `clubs` SELECT is
--
--   is_public OR owner_id = auth.uid() OR private.is_club_member(id)
--
-- — measured on letsride-dev 2026-08-27 — so on a PUBLIC club the parent EXISTS
-- is satisfied by every signed-in rider in the app and contributes nothing.
-- `private.is_club_member` is the whole audience. An implementer who transfers
-- 034's *conclusion* ("the EXISTS is what protects you") rather than its
-- *reasoning* returns every public club's threads and messages to the entire
-- platform, silently, with green tests.
--
-- The RLS suite's §081.3 is the assertion that fails against exactly that
-- mistake: a signed-in NON-MEMBER of a PUBLIC club reads zero threads and zero
-- messages. §081.5 asserts each conjunct alone, so one case fails if the club
-- EXISTS is removed and a DIFFERENT case fails if the membership helper is.
--
-- ---------------------------------------------------------------------------
-- Why the redundant conjunct stays, stated truthfully rather than borrowed
-- ---------------------------------------------------------------------------
-- `private.is_club_member` currently IMPLIES the `clubs` SELECT policy: both of
-- its disjuncts (a `club_members` row, or `clubs.owner_id = candidate`) satisfy
-- a disjunct of the three-arm policy above. So the parent EXISTS is redundant
-- HERE, today. It is written anyway, and the reason is NOT 034's:
--
--   1. The implication is a property of the current three-arm `clubs` policy,
--      not of the helper. A block arm, a suspension arm or a narrowed owner arm
--      on `clubs` SELECT breaks it, and the conjunct becomes load-bearing with
--      nothing announcing the transition. `054`'s own recursion warning shows
--      `clubs` is live territory.
--   2. `private.is_ride_crew`'s comment says it is "half of a conjunction by
--      design; on its own it is a leak". Using a `private` membership helper as
--      a SOLE conjunct anywhere establishes by example that the shape is safe,
--      and the next child table copies the shape rather than the reasoning —
--      which is exactly how 034's first draft copied `is_club_member` and
--      shipped a leak.
--   3. It costs nothing measurable: no screen issues a request it refuses.
--
-- ** It must NOT be written as "the helper alone is a leak on clubs", because it
-- is not. ** `061` §2 records what a false stated justification costs: the next
-- session reads the reason, finds it does not hold, and removes the conjunct.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access        -> every policy `to authenticated`, anon revoked
--   #2 blocking is enforced in RLS -> private.is_blocked, never a blocks query
--   #5 onboarding is required      -> §3 adds the twelfth and thirteenth gate triggers
--   #7 username is the display name -> nothing here stores a name
--
-- Account-deletion reach (CLAUDE.md §Personal data): all three tables hang off
-- `public.profiles` with ON DELETE CASCADE, so `029`'s deletion path reaches
-- every row this migration can create with no new cleanup code. The watermark
-- table is the one that matters most — it records when a NAMED rider last read a
-- NAMED topic — and it is the omission an earlier draft of the design made.
-- Retention is indefinite and dies with the thread or the rider, which is
-- `ride_reads`' precedent and is stated rather than left silent.

-- ===========================================================================
-- §1. The tables
-- ===========================================================================

-- `id` has a default and is deliberately client-suppliable, per 034: an
-- interrupted create retried with the same id lands as a 23505 the action reads
-- as success rather than double-posting.
--
-- No `updated_at`, and no UPDATE policy or grant anywhere in this file. Editing
-- a thread title means designing "edited" — whether it is disclosed, from when,
-- and what it does to the forty replies hanging off it — and none of that is
-- drawn. A title that silently changes after forty riders have replied retitles
-- their replies too. An `updated_at` with no UPDATE grant behind it is a dead
-- column that reads as live, which 034 §1 refused for the same reason.
create table public.club_discussions (
  id uuid default uuid_generate_v4() primary key,
  club_id uuid references public.clubs(id) on delete cascade not null,
  -- ON DELETE CASCADE, decided as D1 in design.md §Questions Closed rather than
  -- inherited. The cost is real and stays stated: because messages cascade from
  -- the thread, deleting a THREAD AUTHOR's account deletes a conversation other
  -- riders took part in — wider than `ride_messages`, where only the leaver's
  -- own messages go. The alternative (SET NULL, a nullable author, a "deleted
  -- rider" byline and a surviving thread) was declined, not deferred.
  author_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  created_at timestamptz default now() not null,

  -- 80, which is `rides_title_length`'s bound from `018` rather than a number
  -- measured off a frame — the repo's existing ceiling for a rider-authored
  -- title.
  --
  -- ** The FLOOR is deliberately NOT copied from 018. ** That file uses
  -- `length(btrim(title)) >= 1`, and `btrim` with no second argument strips
  -- SPACES ONLY — measured on Postgres 16 for 034:
  --
  --   select length(btrim(E'\n\n')), length(btrim('   '));   -->  2 | 0
  --
  -- so the btrim form accepts a title of newlines while the Zod schema's
  -- `.trim()` refuses it: the client stricter than the database, which is the
  -- exact inversion CLAUDE.md's "no new integrity rule may live only in a Zod
  -- schema" exists to prevent. `~ '\S'` is "contains at least one non-whitespace
  -- character" and has no such gap.
  --
  -- The ceiling is on the RAW length so padding cannot smuggle a longer value
  -- past a trimmed check.
  constraint club_discussions_title_length check (
    title ~ '\S' and length(title) <= 80
  )
);

alter table public.club_discussions enable row level security;

comment on table public.club_discussions is
  'Titled discussion threads inside a club (081, PD-307). The audience is CLUB MEMBERSHIP: private.is_club_member(club_id), which includes the owner through 054''s owner arm. ** The parent EXISTS against `clubs` is the REDUNDANT half here, the exact inverse of ride_messages (034) ** — clubs SELECT is `is_public OR owner_id = auth.uid() OR private.is_club_member(id)`, so on a PUBLIC club it admits every signed-in rider and the membership helper is the load-bearing conjunct. The redundant conjunct is written anyway, because the implication is a property of the current three-arm clubs policy which a later arm can break silently, and because using a private membership helper as a sole conjunct anywhere teaches the next table that the shape is safe. Not editable by anyone: no UPDATE policy and no UPDATE grant. Deleted by its author (policy) or by the club owner (public.moderate_club_discussion).';

comment on column public.club_discussions.created_at is
  'Server-owned: withheld from the INSERT column grant (081 §3, following 034 §4b), because a default applies only when the column is OMITTED and PostgREST will happily send it. The Discussions list sorts on this, so a client-stamped value pins a thread to the top of a club for ever and the only remedy is a delete.';

-- `club_messages` restates the WHOLE chain rather than hanging off the thread
-- with a bare EXISTS. The inner EXISTS against `club_discussions` does run under
-- the caller's row security, so the thread's own policy composes correctly today
-- and the two inner conjuncts are strictly redundant a second time. They are
-- written anyway: without them the message table's audience is undiscoverable
-- from its own policy text, and a later change to the thread policy silently
-- retargets it.
--
-- A `private.is_club_discussion_member(discussion uuid)` helper making that one
-- call was considered and rejected — it would hide the two-hop chain inside a
-- definer body nobody reads at review time, and a definer function reading
-- `club_discussions` sees neither the block arm nor the club conjunct.
create table public.club_messages (
  id uuid default uuid_generate_v4() primary key,
  discussion_id uuid references public.club_discussions(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete cascade not null,
  body text not null,
  created_at timestamptz default now() not null,

  -- 1000, matching `ride_messages`, and the DIRECTION is the argument: a chat
  -- thread holds far more rows than a comment thread, so its per-row bound
  -- should be tighter than a comment's rather than looser. `~ '\S'` for the
  -- floor, for the reason spelled out on the title constraint above.
  constraint club_messages_body_length check (
    body ~ '\S' and length(body) <= 1000
  )
);

alter table public.club_messages enable row level security;

comment on table public.club_messages is
  'Messages inside a club discussion (081, PD-307). A GRANDCHILD: its SELECT policy restates the full audience — the clubs EXISTS, private.is_club_member, and its own block arm on club_messages.author_id — rather than relying on the one-hop EXISTS against club_discussions, so the audience is discoverable from the policy text and a change to the thread policy cannot silently retarget it. The block arm is on the MESSAGE''s author, not inherited from the thread: a thread by an unblocked author can hold messages by a blocked one. ** There is NO DELETE POLICY and NO DELETE GRANT, and that is the enforcement rather than an oversight ** — deletion is public.delete_own_club_message(uuid). RLS applies the SELECT policy to a DELETE whose WHERE names a column (measured, Postgres 17.6), so a rider blocked by the thread''s author would silently be unable to erase their own words through a policy. No UPDATE policy and no UPDATE grant either.';

comment on column public.club_messages.created_at is
  'Server-owned: withheld from the INSERT column grant (081 §3, following 034 §4b). The thread is ordered by it, so a client-stamped value pins a message to the end of every member''s thread for ever.';

comment on column public.club_messages.id is
  'Client-suppliable on purpose (034''s precedent): an interrupted send retried with the same id lands as 23505, which sendClubMessage reads as success rather than double-posting. It discloses nothing — RLS evaluates WITH CHECK before the index insert, so a non-member is refused 42501 and never reaches 23505.';

-- The per-thread read watermark. `061` transferred, with `068` and `079`
-- already applied rather than inherited-then-repaired.
--
-- ** BOTH key columns carry a foreign key, and the `profiles` one is the half
-- that would have been a privacy defect rather than a correctness one. ** A row
-- here says "this named person last read this named topic". Without the
-- `profiles` FK it survives their account deletion for ever, `029` working
-- purely by cascade with nothing reporting the gap.
--
-- ** `user_id` LEADS the primary key and that ordering is load-bearing: ** `029`
-- asserts from `pg_constraint` that no foreign key into `profiles` lacks a
-- leading-column index, so `(discussion_id, user_id)` would fail the suite.
--
-- ** No `unique nulls not distinct`. ** `015` needs that clause because
-- `feed_reads.club_id IS NULL` MEANS the app-wide feed. There is no app-wide
-- discussion; both key columns are NOT NULL, so a real primary key is available,
-- and a clause expressing a rule this table does not have teaches the next
-- reader that the audience is nullable.
create table public.club_discussion_reads (
  user_id uuid references public.profiles(id) on delete cascade not null,
  discussion_id uuid references public.club_discussions(id) on delete cascade not null,
  last_read_at timestamptz default now() not null,

  primary key (user_id, discussion_id)
);

alter table public.club_discussion_reads enable row level security;

comment on table public.club_discussion_reads is
  'Per-discussion read watermark (081, PD-307). One row per (rider, thread); last_read_at is server-imposed by public.stamp_club_discussion_read() on INSERT and UPDATE, never client-supplied — not for tamper-resistance but because it is compared against club_messages.created_at, which is server-owned, and a comparison spanning a phone''s clock and the database''s is wrong in a way nothing logs (068). Readable ONLY by the row''s owner: this app has no read receipts, and that is a refusal rather than an omission. Per THREAD rather than per club, because a per-club watermark would make reading thread A mark thread B read. Bounded by threads opened rather than by membership, which is weaker than feed_reads and ride_reads and is named rather than discovered. Retention is indefinite: it dies with the thread or the rider, through the two cascades and nothing else.';

-- ===========================================================================
-- §1b. Indexes
-- ===========================================================================

-- The Discussions list's only query: one club's threads, newest first, keyset
-- paged. `id` is in the sort and therefore in the index because `created_at` is
-- not a total order — two rows inserted in one transaction carry an identical
-- `now()`, sort arbitrarily, and break a keyset cursor at the boundary.
create index club_discussions_club_id_idx
  on public.club_discussions (club_id, created_at desc, id desc);

-- Not for a screen — for the ON DELETE CASCADE from `profiles`. Account
-- deletion has to find this rider's threads, and `029` asserts the index exists
-- rather than trusting it.
create index club_discussions_author_id_idx
  on public.club_discussions (author_id);

-- One thread's messages, oldest first — a conversation reads from the top.
-- `exists` in club_discussion_unread short-circuits on the first row through
-- this index, which is what makes the unread answer O(1) in thread length.
create index club_messages_discussion_id_idx
  on public.club_messages (discussion_id, created_at, id);

-- The cascade from `profiles`, as above.
create index club_messages_author_id_idx
  on public.club_messages (author_id, created_at desc);

-- The cascade a THREAD deletion runs. The primary key leads with `user_id`, so
-- deleting one discussion has nothing to find its watermarks by without this —
-- mirroring `ride_reads_ride_id_idx`, and unlike `feed_reads`, which still has
-- the gap.
create index club_discussion_reads_discussion_id_idx
  on public.club_discussion_reads (discussion_id);

-- ===========================================================================
-- §2. Policies
-- ===========================================================================

-- The three conjuncts, in the order the header explains them. The block arm is
-- about the AUTHOR: in a club two riders are both in, a rider you blocked must
-- not appear. Symmetric through the helper, so one directional `blocks` row
-- holds in both directions and no call site may re-check the reverse — 009's
-- rule.
--
-- A blocked rider's thread is hidden WHOLE, conversation included (D2). That
-- hides messages from riders the viewer has not blocked, and it is decision #2
-- read literally; the alternative — render the thread, suppress the byline — is
-- a second visibility rule to keep in step and leaks that a hidden rider exists.
-- It is also what makes §4's delete_own_club_message necessary.
--
-- Your own thread is unconditional WITHIN the membership check, so you never
-- lose sight of what you wrote while you are in the club. Note what that does
-- not say: a rider who LEAVES loses every thread and message in the club
-- including their own, and they stay for everyone else. A conversation is not
-- retracted because one participant left.
create policy "Club discussions are readable by that club's members"
  on public.club_discussions for select to authenticated
  using (
    -- Redundant TODAY and written anyway — see the header for the three reasons,
    -- none of which is "the helper alone is a leak", because on `clubs` it is
    -- not.
    exists (select 1 from public.clubs c where c.id = club_discussions.club_id)
    and private.is_club_member(club_id)
    and (
      author_id = auth.uid()
      or not private.is_blocked(auth.uid(), author_id)
    )
  );

-- Any member, of any `role`. Not owner-only, and no `club_members.role`
-- predicate anywhere in this file:
--
--   * Owner-only makes Discussions dead in the club that needs it most — the
--     Welcome club (058) is auto-joined by every rider and its owner may be an
--     arbitrary rider who inherited it through 029's succession.
--   * There is no admin writer. `club_members.role` has admitted `admin` since
--     001 and nothing has ever written it, so "owner or admin" resolves to
--     "owner" and a role predicate would be dead code that reads as live.
--   * A thread is strictly less consequential than a ride, and any member may
--     already create a ride in a club they belong to.
--
-- ** No block arm, deliberately. ** A blocked pair who are both members may both
-- post into the same thread, and each sees only their own. Refusing the insert
-- would disclose the existence of the block to the poster; blocking removes
-- visibility and does not evict either party from a shared space, exactly as it
-- does on a ride they are both on.
create policy "Club members open their own threads, as themselves"
  on public.club_discussions for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.clubs c where c.id = club_discussions.club_id)
    and private.is_club_member(club_id)
  );

-- The author, and nobody else. The club OWNER's moderation right is
-- public.moderate_club_discussion (§4) rather than a second arm here, because a
-- policy arm cannot survive a block: RLS filters a DELETE by what the caller may
-- READ, so an owner who blocked the thread's author matches zero rows and
-- PostgREST reports success.
--
-- ** The same inversion does NOT reach the author, and that is verified rather
-- than assumed by symmetry with §4. ** This USING clause contains no
-- self-EXISTS; its only subquery is against `clubs`, which carries no block
-- predicate; and the SELECT policy that attaches to the delete exempts the
-- author through its own `author_id = auth.uid()` arm. So an author can always
-- see, and therefore delete, their own thread — while blocking, and while
-- blocked by, any other member.
create policy "Thread authors delete their own threads"
  on public.club_discussions for delete to authenticated
  using (
    exists (select 1 from public.clubs c where c.id = club_discussions.club_id)
    and private.is_club_member(club_id)
    and author_id = auth.uid()
  );

-- NO UPDATE POLICY on club_discussions. Absence is the enforcement, and it is
-- asserted in both directions (no policy, no grant) because a well-meaning
-- `grant all` restores only one of them. The remedy for a thread you regret is
-- deletion and re-creation.

-- The two-hop chain, written out. See the table comment for why it is not
-- reduced to a bare EXISTS against the thread.
create policy "Club messages are readable by that club's members"
  on public.club_messages for select to authenticated
  using (
    exists (
      select 1 from public.club_discussions d
       where d.id = club_messages.discussion_id
         and exists (select 1 from public.clubs c where c.id = d.club_id)
         and private.is_club_member(d.club_id)
    )
    and (
      author_id = auth.uid()
      or not private.is_blocked(auth.uid(), author_id)
    )
  );

-- Same conjunction as SELECT, and needed for the same reason rather than for
-- symmetry: a rider who cannot see a thread must not be able to post into it.
-- The one case it touches is a rider blocked by the thread's author, who cannot
-- reach the thread's screen at all — and there the inversion is the CORRECT
-- answer.
create policy "Club members post into their club's threads, as themselves"
  on public.club_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.club_discussions d
       where d.id = club_messages.discussion_id
         and exists (select 1 from public.clubs c where c.id = d.club_id)
         and private.is_club_member(d.club_id)
    )
  );

-- ---------------------------------------------------------------------------
-- NO DELETE POLICY AND NO DELETE GRANT ON club_messages — the enforcement
-- ---------------------------------------------------------------------------
-- This is 078's `push_devices` shape: the absence of a client path IS the
-- mechanism, and it is asserted in both directions.
--
-- ** A policy-based delete cannot satisfy the requirement, and the reason is
-- MEASURED rather than argued. ** RLS applies the SELECT policy to a DELETE
-- whose WHERE names a column. Measured on this project, Postgres 17.6, with a
-- row the caller owns but cannot select and a DELETE policy that permits it:
--
--   delete from t where id = 1;             -->  row SURVIVES (SELECT applied)
--   delete from t where id = 1 returning 1; -->  row SURVIVES
--   delete from t;                          -->  row deleted (SELECT not applied)
--
-- `supabase-js` issues the first form. So the reachable case is: A opens thread
-- T, B replies, A blocks B. B can no longer see T or their own reply in it, so
-- B's delete matches zero rows, PostgREST reports SUCCESS, and B's words stay
-- visible to every unblocked member — while this capability's own stated remedy
-- for a message you regret is deletion.
--
-- ** Relaxing the DELETE USING clause therefore fixes nothing, and a
-- `private.discussion_club(discussion)` helper feeding it — the fix the first
-- review proposed — changes no observable outcome, because the SELECT policy
-- hides the row before USING is ever reached. It is deliberately NOT adopted;
-- adding a conjunct whose stated benefit does not exist is what this change's
-- own spec forbids. **
--
-- Deletion is public.delete_own_club_message(uuid), §4b: security definer,
-- re-checking `author_id = auth.uid()` in its own body. 011 §1b named exactly
-- this class of problem — "RLS filters a DELETE by what the caller may READ".

-- NO UPDATE POLICY on club_messages either, for the reason on club_discussions.

-- ---------------------------------------------------------------------------
-- The watermark's three policies
-- ---------------------------------------------------------------------------
-- SELECT is `user_id = auth.uid()` and nothing wider, and the narrowness is a
-- DECISION. A watermark is behavioural personal data about an identified person
-- — when they last looked at a named conversation — so "the thread's author can
-- see I read at 03:40" is a fact about one rider on one night. This app has no
-- read receipts, and the policy is where that is refused rather than merely
-- unbuilt: the data to draw a "seen by" row is unreachable, so adding one is a
-- migration and a conversation.
create policy "Riders see only their own discussion watermarks"
  on public.club_discussion_reads for select to authenticated
  using (user_id = auth.uid());

-- The write predicate carries the full audience conjunction.
--
-- ** 034's reason for the conjunction does NOT transfer, and inheriting it would
-- be worse than inheriting nothing: a WITH CHECK grants no reads. ** What DOES
-- transfer is 015 §2's: without an audience predicate the foreign key turns an
-- INSERT into an existence oracle, because a nonexistent discussion id raises
-- 23503 while an existing-but-invisible one succeeds. The full conjunction is
-- chosen over the membership helper alone for audience equality (no row can
-- ever assert that a rider read a thread they cannot open), for the instrument
-- reason in the header, and because it costs nothing measurable.
create policy "Riders mark only their own discussions read"
  on public.club_discussion_reads for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.club_discussions d
       where d.id = club_discussion_reads.discussion_id
         and exists (select 1 from public.clubs c where c.id = d.club_id)
         and private.is_club_member(d.club_id)
    )
  );

-- The upsert's UPDATE arm.
--
-- ** USING is `user_id = auth.uid()` ALONE, and the asymmetry is deliberate —
-- 061's, for 061's reason. ** USING scopes which rows may be REACHED and WITH
-- CHECK what they may BECOME. Putting the audience conjuncts in USING as well
-- would mean a rider who has since left the club cannot reach their own stale
-- row — which changes nothing they can do, since the WITH CHECK refuses the
-- write either way, and makes the policy harder to read than the rule it
-- encodes.
create policy "Riders advance only their own discussion watermarks"
  on public.club_discussion_reads for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.club_discussions d
       where d.id = club_discussion_reads.discussion_id
         and exists (select 1 from public.clubs c where c.id = d.club_id)
         and private.is_club_member(d.club_id)
    )
  );

-- NO DELETE POLICY and no DELETE grant on club_discussion_reads.
--
-- The honest reason is that deleting a watermark means "mark this unread again",
-- and no screen draws that.
--
-- ** It is NOT 015's stated reason, and that sentence must not be carried
-- across: leaving a club does not cascade this row away. ** The foreign key is
-- to `club_discussions`, so the row stands until the thread or the rider goes,
-- and rejoining REUSES it — which is precisely why §4's comparison point takes
-- `greatest(last_read_at, joined_at)` rather than preferring the stale
-- pre-departure watermark.

-- ===========================================================================
-- §3. Grants and triggers
-- ===========================================================================

-- RLS needs BOTH a table grant and a permitting policy. Note what is not
-- granted: DELETE on club_messages and on club_discussion_reads, UPDATE on
-- either content table, and anything at all to `anon` — decision #1.
revoke all on public.club_discussions, public.club_messages,
             public.club_discussion_reads from anon, authenticated;

grant select, delete on public.club_discussions to authenticated;
grant select on public.club_messages to authenticated;
grant select, insert, update on public.club_discussion_reads to authenticated;

-- INSERT is granted per COLUMN and `created_at` is not one of them, following
-- 034 §4b rather than relying on `default now()`: a default applies only when
-- the column is OMITTED, and PostgREST will happily name it. The default is the
-- value; the grant is the guarantee. `id` IS granted — the client chooses it on
-- purpose, so an interrupted write can be retried idempotently.
grant insert (id, club_id, author_id, title) on public.club_discussions to authenticated;
grant insert (id, discussion_id, author_id, body) on public.club_messages to authenticated;

-- UPDATE on the watermark is granted at TABLE level rather than per column, for
-- 061 §5's reason: there is nothing to withhold. `user_id` and `discussion_id`
-- are pinned by the WITH CHECK and `last_read_at` by the trigger below, so a
-- column list would restate what two other mechanisms already enforce and would
-- break the upsert's UPDATE arm besides.

-- ---------------------------------------------------------------------------
-- The twelfth and thirteenth participation-gate triggers
-- ---------------------------------------------------------------------------
-- A thread and a message are content writes, exactly as a ride message is
-- (034 §5). Two tables, so TWO triggers — reading a sweep as one is the mistake
-- 078's own task list made.
--
-- The WHEN clause is not decoration: 023 §2 measured that a `security definer`
-- function sees `current_user` as its OWNER, so a guard inside the body would be
-- true on every call and the gate would never fire. It is evaluated in the
-- caller's context, before the function is entered. This is also why no content
-- write in this change goes through a definer RPC.
drop trigger if exists enforce_participation_gate on public.club_discussions;
create trigger enforce_participation_gate
  before insert on public.club_discussions
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.club_messages;
create trigger enforce_participation_gate
  before insert on public.club_messages
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- ** NO gate trigger on club_discussion_reads, and the suite asserts the
-- ABSENCE. ** 023's stated reason for excluding `feed_reads` and 061's for
-- `ride_reads`: a watermark produces nothing anyone sees, and a rider who has
-- not consented cannot be a club member in the first place — the gate is on
-- `clubs` and `club_members` — so the WITH CHECK above already refuses them.
-- Asserting the absence is 078's lesson inverted: a count that quietly reads
-- complete is worse than one that reads short.

-- The comment on the gate function is the `data` agent's first read via
-- `list_tables`, and no edit to CLAUDE.md reaches it — 028 and 033 exist for
-- exactly this. It says ELEVEN today, not nine.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, thirteen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_discussions and the thirteenth club_messages (081); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ---------------------------------------------------------------------------
-- The watermark's clock
-- ---------------------------------------------------------------------------
-- BOTH arms, not just INSERT. A BEFORE INSERT trigger alone would impose the
-- value on a rider's first visit to a thread and keep the client's on every
-- visit after — the worst of the three available behaviours, because it works on
-- fresh rows and drifts in use. This is 068's fix applied at birth.
--
-- ** Withholding the column grant would NOT do this job, and the obvious reason
-- for that is false. ** It is tempting to write "the upsert's UPDATE arm must
-- name `last_read_at`, so revoking the grant would fail 42501". It would not:
-- PostgREST builds `on conflict ... do update set` from the columns present in
-- the request BODY, so a client that omits the column needs no privilege on it
-- and nothing raises (061 §3's measured correction).
--
-- `security invoker` (the default): it reads nothing and writes nothing but NEW,
-- so it needs no elevated rights, and an invoker function raises no
-- `authenticated_security_definer_function_executable` advisor. EXECUTE is
-- revoked anyway — Postgres checks EXECUTE on a trigger function at CREATE
-- TRIGGER time, not at fire time, which is what makes that revoke free.
create function public.stamp_club_discussion_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_read_at := now();
  return new;
end;
$$;

comment on function public.stamp_club_discussion_read() is
  'Imposes club_discussion_reads.last_read_at from the server clock on INSERT and UPDATE (081). Not tamper-resistance — forging your own watermark suppresses your own dot — but because the value is compared against club_messages.created_at, which 081 §3 makes server-owned, and a comparison spanning two clocks is wrong in a way nothing logs (068).';

revoke all on function public.stamp_club_discussion_read() from public, anon, authenticated;

create trigger stamp_club_discussion_read
  before insert or update on public.club_discussion_reads
  for each row
  execute function public.stamp_club_discussion_read();

-- ===========================================================================
-- §4. The reader, the two definer RPCs, and the publication
-- ===========================================================================

-- The unread answer, one call for a whole club's list.
--
-- Four properties, each carrying its precedent:
--
--   1. ** SECURITY INVOKER ** — so §2's SELECT policy on `club_messages` decides
--      what counts, blocks included. No block filter appears here, in
--      `lib/data/` or in the component: one copy of the rule, in the policy that
--      already owns it. A club the caller cannot see answers zero rows,
--      identically to a club that does not exist, so the RPC is not an existence
--      oracle. If it ever flips to `definer` it starts answering `true` for
--      threads the caller cannot read; the suite asserts `prosecdef` is false.
--   2. ** author_id <> auth.uid() ** — 079's fix applied at birth. Your own
--      message never lights your own dot, and the answer is then correct
--      independently of whether the watermark won a race with the navigation.
--   3. ** greatest(last_read_at, joined_at), NOT a three-arm coalesce between
--      them, and 061 would be WRONG here. ** A watermark row SURVIVES leaving
--      the club: the FK is to `club_discussions`, so nothing cascades it away,
--      and rejoining reuses it. With `last_read_at` merely first in a coalesce,
--      a rider who read a thread in March, left, and rejoined in September is
--      compared against their March watermark and is badged with every message
--      sent while they were away. `greatest` takes whichever is later, so the
--      rejoin advances the comparison point without a write. Measured on this
--      Postgres: `greatest` IGNORES NULL — `greatest(ts, null)` returns `ts` —
--      and is NULL only when every argument is, so the outer coalesce still
--      falls through to the third arm exactly as before.
--   4. ** The third arm is load-bearing TODAY ** — 061 §4's reason arriving
--      through a different door. A club OWNER may hold no `club_members` row:
--      054 exists because that state is reachable through createClub's two
--      un-transacted inserts, or through the owner simply leaving, `club_members`
--      DELETE being `auth.uid() = user_id` with no owner carve-out. Without this
--      arm their comparison point is NULL, every `created_at > NULL` is NULL,
--      and the owner is the one member whose dot never lights, silently and for
--      ever.
--
-- All three arms are on the DATABASE's clock: 048 made `club_members.joined_at`
-- server-owned and §3's column grant does the same for
-- `club_discussions.created_at`. A comparison spanning two clocks through the
-- FALLBACK would be the same defect wearing a fallback's clothes.
--
-- Boolean rather than a count, for 061's reason: `exists` short-circuits, so it
-- is O(1) in thread length through club_messages_discussion_id_idx, with no
-- `limit 100` to justify and no number for someone to render later. PLURAL where
-- 061 was singular, and 061's own reasoning says why that is not a
-- contradiction: N was 1 there because the dot sat on one ride's header; N is
-- the list here.
create function public.club_discussion_unread(club uuid)
returns table (discussion_id uuid, has_unread boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id,
         exists (
           select 1
             from public.club_messages m
            where m.discussion_id = d.id
              and m.author_id <> auth.uid()
              and m.created_at > coalesce(
                    greatest(
                      (select w.last_read_at from public.club_discussion_reads w
                        where w.user_id = auth.uid() and w.discussion_id = d.id),
                      (select k.joined_at from public.club_members k
                        where k.club_id = d.club_id and k.user_id = auth.uid())
                    ),
                    d.created_at
                  )
         )
    from public.club_discussions d
   where d.club_id = club;
$$;

comment on function public.club_discussion_unread(uuid) is
  'Which of this club''s threads hold a message the caller has not read (081)? SECURITY INVOKER, so 081 §2''s SELECT policies decide what counts — club membership and blocks included — and a club the caller cannot see answers zero rows rather than raising. Excludes the caller''s own messages (079''s fix at birth). The comparison point is coalesce(greatest(last_read_at, joined_at), created_at): GREATEST rather than a coalesce between the first two, because a watermark survives leaving the club and a rejoiner would otherwise be badged with the whole back catalogue; the third arm is what keeps a club owner holding no club_members row from being the one member whose dot never lights.';

-- The club owner's one moderation right.
--
-- An RPC rather than a second arm on the DELETE policy, for 034's recorded gap
-- reaching a case 034 did not have. RLS filters a DELETE by what the caller may
-- READ, so an owner who has blocked a thread's author cannot see that thread and
-- a policy-arm delete keyed on its id matches zero rows — silently. 034 accepted
-- that because "the block itself already removes the messages from the blocker's
-- view, which is the remedy a rider actually reaches for". ** That argument does
-- not transfer to a THREAD: ** a thread is a persistent titled object in the
-- owner's club, and blocking its author hides it from the owner while every
-- other member keeps reading it. The block is not the remedy, so the moderation
-- right must not depend on the owner being able to see the row.
--
-- 043's shape exactly, including ** ONE raise site, so "no such thread" and "not
-- your club" are indistinguishable ** and a caller learns nothing about a club
-- they do not own. There is deliberately no separate "requires a session" raise:
-- a NULL `auth.uid()` matches no `owner_id`, so it falls into the same refusal
-- rather than becoming a second, distinguishable answer.
--
-- The ownership test is the function's OWN job. `security definer` runs the body
-- with RLS bypassed, so `c.owner_id = v_uid` below is the entire access control
-- and is the line to read first in any future edit.
--
-- Message-level owner moderation stays deferred — no control is drawn — and its
-- shape is public.moderate_club_message(uuid), the same pattern.
create function public.moderate_club_discussion(discussion uuid)
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
  select d.id
    into v_id
    from public.club_discussions d
    join public.clubs c on c.id = d.club_id
   where d.id = discussion
     and c.owner_id = v_uid
     for update of d;

  if not found then
    raise exception 'no discussion with that id sits in a club owned by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- One row. The FK cascade takes the messages and the watermarks.
  delete from public.club_discussions d where d.id = v_id;
end;
$$;

comment on function public.moderate_club_discussion(uuid) is
  'Deletes one thread in a club the CALLER owns (081). security definer and an RPC rather than a second arm on the DELETE policy, because RLS filters a DELETE by what the caller may READ: an owner who has blocked the thread''s author cannot see the row, so a policy-arm delete matches zero rows and PostgREST reports success. Re-checks clubs.owner_id = auth.uid() internally — RLS does not apply inside the body, so that check is the whole access control. One raise site, so "no such thread" and "not your club" are indistinguishable (043''s shape). The messages and watermarks go by cascade.';

-- ---------------------------------------------------------------------------
-- §4b. Erasing your own message, which a block must not be able to take away
-- ---------------------------------------------------------------------------
-- See §2's block comment for the measurement that makes this necessary rather
-- than merely tidy: `club_messages` carries no DELETE policy and no DELETE grant
-- at all, and this function is the only path.
--
-- ** Authorship is the WHOLE test — no club-membership conjunct. ** Your own
-- words are always retractable, including after you leave. That diverges from
-- `ride_messages`, where a leaver cannot delete, and the divergence is
-- deliberate: a ride's chat disappears with the ride, while a club thread is a
-- permanent titled surface other members keep reading. Stated rather than
-- inherited.
--
-- One raise site, so "not yours" and "no such message" are indistinguishable and
-- the function is not an existence oracle.
create function public.delete_own_club_message(message uuid)
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
  select m.id
    into v_id
    from public.club_messages m
   where m.id = message
     and m.author_id = v_uid
     for update;

  if not found then
    raise exception 'no message with that id was written by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.club_messages m where m.id = v_id;
end;
$$;

comment on function public.delete_own_club_message(uuid) is
  'Deletes exactly one message the CALLER wrote (081). Exists because a policy-based delete cannot satisfy the rule: RLS applies the SELECT policy to a DELETE whose WHERE names a column (measured, Postgres 17.6), so a rider blocked by the thread''s author cannot see their own reply and the delete matches zero rows while PostgREST reports success. Takes no user id and acts only for its caller — 078''s push_devices shape. Authorship is the whole test: no club-membership conjunct, so a rider who has left the club can still retract their own words, a deliberate divergence from ride_messages. One raise site, so "not yours" and "no such message" are indistinguishable.';

-- ---------------------------------------------------------------------------
-- §4c. Function grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on every new function unless told otherwise,
-- and the harness reproduces Supabase's default function grants for the same
-- reason. Reachability is asserted by naming a ROLE, never by calling the
-- function: the suite runs as the table owner, for whom no barrier exists —
-- 031 exists because 029 shipped a function nothing could call.
revoke all on function public.club_discussion_unread(uuid) from public, anon;
grant execute on function public.club_discussion_unread(uuid) to authenticated;

revoke all on function public.moderate_club_discussion(uuid) from public, anon;
grant execute on function public.moderate_club_discussion(uuid) to authenticated;

revoke all on function public.delete_own_club_message(uuid) from public, anon;
grant execute on function public.delete_own_club_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §4d. Realtime
-- ---------------------------------------------------------------------------
-- Membership of `supabase_realtime` is what makes a subscription fire. It is a
-- publication, not a policy, and that distinction is the trap: a client
-- subscribing to a table outside the publication CONNECTS, REPORTS SUBSCRIBED,
-- AND SILENTLY NEVER RECEIVES ANYTHING — indistinguishable from a quiet
-- conversation. So it belongs in the migration chain beside the policies rather
-- than as a dashboard click.
--
-- ** club_discussions is deliberately NOT added, and the decision is recorded
-- here so a later session finds it in the file rather than in a channel that
-- reports SUBSCRIBED and never fires. ** A thread appearing live is not required
-- by any screen; the list revalidates by its own cache key, and one channel per
-- thread on a list screen multiplies subscriptions by the thread count.
--
-- Realtime evaluates §2's SELECT policy per subscriber, so the membership and
-- block rules govern delivery too and there is no second copy of them. That is
-- an argument for keeping the rule in one place, not a reason to trust it
-- untested: .claude/agents/realtime.md requires confirming a blocked rider
-- receives silence rather than inferring it from the policy, and the RLS suite
-- cannot make that assertion because plain Postgres has no Realtime.
--
-- Default replica identity, deliberately. `full` is needed only to carry the OLD
-- row on UPDATE and DELETE; this table has no UPDATE at all, and the subscriber
-- reads INSERT. Setting it `full` would put every column of every deleted row
-- into the WAL for a payload nothing reads.
alter publication supabase_realtime add table public.club_messages;

-- ===========================================================================
-- §Verification — run against the project after applying, do not assume
-- ===========================================================================
--
-- `apply_migration` takes SQL as an argument rather than a path, so the file and
-- the database can disagree by exactly one clause — and 022 shipped that defect
-- once, on `security definer` itself. Every number below is a prediction.
--
--   -- 8 — 3 on club_discussions (select, insert, delete), 2 on club_messages
--   -- (select, insert), 3 on club_discussion_reads (select, insert, update)
--   select tablename, cmd, count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('club_discussions','club_messages','club_discussion_reads')
--    group by 1, 2 order by 1, 2;
--
--   -- 0 — every policy is `to authenticated`, decision #1
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('club_discussions','club_messages','club_discussion_reads')
--      and roles::text[] <> array['authenticated'];
--
--   -- 0 — anon holds nothing on any of the three
--   select count(*) from information_schema.role_table_grants
--    where table_name in ('club_discussions','club_messages','club_discussion_reads')
--      and grantee = 'anon';
--
--   -- ENUMERATED, not counted: a table-level grant and a complete column grant
--   -- are indistinguishable by count.
--   --   club_discussions ....... id, club_id, author_id, title
--   --   club_messages .......... id, discussion_id, author_id, body
--   -- NEITHER carries created_at.
--   select table_name, column_name from information_schema.column_privileges
--    where table_name in ('club_discussions','club_messages')
--      and grantee = 'authenticated' and privilege_type = 'INSERT'
--    order by 1, 2;
--
--   -- f — the enforcement. Scoped to the grantee: an unscoped count reads 2
--   -- against a correct database, postgres and service_role holding everything.
--   select has_table_privilege('authenticated', 'public.club_messages', 'delete');
--
--   -- f, f — no UPDATE anywhere on either content table
--   select has_table_privilege('authenticated', 'public.club_discussions', 'update'),
--          has_table_privilege('authenticated', 'public.club_messages', 'update');
--
--   -- 1, 0 — membership AND non-membership. The second is the one that stops a
--   -- later session subscribing to a table that will never fire.
--   select count(*) filter (where tablename = 'club_messages'),
--          count(*) filter (where tablename = 'club_discussions')
--     from pg_publication_tables where pubname = 'supabase_realtime';
--
--   -- f, t, t, f — the reader is INVOKER, both RPCs are DEFINER, the trigger
--   -- function needs no elevated rights. All four carry search_path=""
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('club_discussion_unread','moderate_club_discussion',
--                      'delete_own_club_message','stamp_club_discussion_read')
--    order by proname;
--
--   -- t, t — the pragma survived the round trip into both definer bodies
--   select proname, prosrc like '%#variable_conflict error%' from pg_proc
--    where proname in ('moderate_club_discussion','delete_own_club_message');
--
--   -- t/f pairs — reachability BY ROLE, never by calling it as the owner (031)
--   select has_function_privilege('authenticated', 'public.club_discussion_unread(uuid)', 'execute'),
--          has_function_privilege('anon',          'public.club_discussion_unread(uuid)', 'execute'),
--          has_function_privilege('authenticated', 'public.moderate_club_discussion(uuid)', 'execute'),
--          has_function_privilege('anon',          'public.moderate_club_discussion(uuid)', 'execute'),
--          has_function_privilege('authenticated', 'public.delete_own_club_message(uuid)', 'execute'),
--          has_function_privilege('anon',          'public.delete_own_club_message(uuid)', 'execute');
--
--   -- 0 — no `nulls not distinct` index on the watermark table. 015 needs that
--   -- clause for a nullable key column; there is none here, and a clause
--   -- expressing a rule this table does not have invites the next reader to
--   -- infer one.
--   select count(*) from pg_index
--    where indrelid = 'public.club_discussion_reads'::regclass and indnullsnotdistinct;
--
--   -- 2, both 'c' — BOTH foreign keys on the watermark table, ON DELETE
--   -- CASCADE. The profiles one is the half whose absence would keep
--   -- behavioural personal data about a deleted rider indefinitely.
--   select conname, confrelid::regclass::text, confdeltype from pg_constraint
--    where conrelid = 'public.club_discussion_reads'::regclass and contype = 'f'
--    order by conname;
--
--   -- 0 — neither new FK into clubs or club_discussions is ON DELETE SET NULL,
--   -- which is the property 043's whole existence rests on.
--   select count(*) from pg_constraint
--    where contype = 'f' and confdeltype <> 'c'
--      and conrelid in ('public.club_discussions'::regclass,
--                       'public.club_messages'::regclass,
--                       'public.club_discussion_reads'::regclass);
--
--   -- 13 — the gate reaches both content tables now. TWO more, not one: the
--   -- advisor and the trigger sweep both fire once per table, which is what
--   -- 078's own task list got wrong.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- 0 — and club_discussion_reads did NOT acquire one
--   select count(*) from pg_trigger
--    where tgrelid = 'public.club_discussion_reads'::regclass
--      and tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- 3 — the watermark trigger is BEFORE and fires on both INSERT and UPDATE.
--   -- tgtype bit 2 is BEFORE, bit 4 INSERT, bit 16 UPDATE.
--   select (tgtype & 4 > 0)::int + (tgtype & 16 > 0)::int + (tgtype & 2 > 0)::int
--     from pg_trigger where tgname = 'stamp_club_discussion_read' and not tgisinternal;
--
-- And the advisors: `get_advisors(security)` must return FIFTEEN, up from
-- thirteen. ** TWO new `authenticated_security_definer_function_executable`
-- WARNs, not one ** — the advisor fires once per function, so
-- `moderate_club_discussion` and `delete_own_club_message` add one each, and
-- `club_discussion_unread` is INVOKER and adds none. A sixteenth means a revoke
-- did not land, or the reader was written `definer`.
