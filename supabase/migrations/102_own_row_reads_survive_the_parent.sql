-- 102 — the own-row read arm is hoisted out of the block conjunct (PD-362)
-- ===========================================================================
--
-- Found while building `092` (PD-356), which fixed its own two tables and said
-- plainly that the rest were somebody else's:
--
--     "Do not 'simplify' §3.1 to match postcard_likes, which carries the same
--      defect and is filed separately."
--
-- This is that file. `092` hoisted the arm on `club_thread_waves` and
-- `club_join_waves`; seven pre-existing SELECT policies still write it the
-- wrong way round:
--
--     using ( <parent EXISTS> and (own_id = auth.uid() or not is_blocked(...)) )
--
-- Two things are wrong with that shape. **Inside the block conjunct the own-row
-- branch is a no-op** — `blocks_no_self_block` (`009` §1) already makes
-- `is_blocked(x, x)` false, so it rescues nothing while reading as though it
-- does. And **the parent EXISTS still dominates**, so losing sight of the parent
-- loses your own row with it. `009`'s own `postcards` policy is the correct
-- shape and is in the same file as two of the defects:
--
--     using ( own_id = auth.uid() or (<parent EXISTS> and not is_blocked(...)) )
--
-- ** WHY THIS IS NOT COSMETIC: RLS FILTERS A DELETE BY WHAT THE CALLER MAY
-- READ ** (`081`, measured on `club_messages`). A row you cannot see is a row
-- you cannot delete, and PostgREST reports the no-op as success. So every one of
-- these policies silently disarms a DELETE policy that was written deliberately
-- without a visibility requirement.
--
-- ---------------------------------------------------------------------------
-- THREE ARE HOISTED, FOUR ARE DELIBERATELY LEFT ALONE
-- ---------------------------------------------------------------------------
-- The issue asked for a per-policy decision rather than a sweep, and the seven
-- do not want the same answer. Measured on `letsride-dev`, 2026-09-03, against
-- each table's DELETE policy — because the harm is only real where a DELETE
-- grant exists that does NOT itself require the parent to be visible.
--
-- ** HOISTED (3) — each has a DELETE policy with no visibility conjunct, so the
-- SELECT shape is the only thing refusing it, and it refuses silently: **
--
--   * `ride_members`   DELETE `using (auth.uid() = user_id)`
--     A rider blocked by the ride's ORGANIZER cannot see the ride at all —
--     `rides` SELECT is `organizer_id = auth.uid() or (not is_blocked(...) and
--     ...)`, so the block kills the whole second disjunct. They therefore cannot
--     read their own crew row, and **cannot leave the ride**. This app has no
--     way to eject a rider from a ride, so they cannot be removed either: they
--     are stuck in a crew with someone who has blocked them, still counted,
--     with a Leave control that reports success and does nothing.
--
--   * `postcard_likes`  DELETE `using (user_id = auth.uid())`
--     `009` wrote the requirement into that policy's own comment — "there is no
--     visibility requirement: a rider must be able to withdraw a like from a
--     postcard that has since gone out of view, **or the row is stranded**" —
--     and then defeated it in the SELECT policy forty lines earlier. Reachable
--     with no block anywhere: the liker simply LEAVES the club the postcard was
--     posted to. `unlikePostcard` is a bare `.delete().eq(...)`, the shape that
--     no-ops in silence.
--
--   * `postcard_comments`  DELETE `using (author_id = auth.uid() or <postcard
--     author>)` — no parent EXISTS on either arm.
--     PD-362 lists this one as "looks like a third real one and was NOT
--     measured". It is measured now and it is real, and `011` makes the same
--     mistake `009` did: its SELECT policy's own comment claims "Your own
--     comment is unconditional, so you never lose sight of what you wrote",
--     which is exactly what the shape below it prevents.
--
-- ** LEFT ALONE (4), each for its own reason — this is the half a sweep would
-- have got wrong: **
--
--   * `club_members` — a SEMANTIC NO-OP, so changing it buys nothing and costs a
--     review. `private.is_club_member(club_id)` resolves through
--     `is_club_member_for(auth.uid(), club_id)`, so any rider holding a
--     `club_members` row satisfies the parent for that row by construction. The
--     own-row read can never fail, and leaving a club always works. 102.4 pins
--     that behaviourally rather than trusting this paragraph.
--
--   * `club_messages` — **no DELETE policy exists at all**, so there is no
--     grant for the SELECT shape to disarm. Hoisting would only widen READ: an
--     ex-member would recover sight of their own messages in a club they left.
--
--   * `club_threads` — its DELETE policy independently requires
--     `private.is_club_member(club_id)`, so hoisting SELECT enables no delete
--     the database does not already refuse loudly. Hoisting would also
--     contradict a settled product decision: PD-367 Q8, answered by the product
--     owner, EVICTS a thread's author from their thread when they leave the club
--     (an eviction, not a deletion — rejoining restores the row intact).
--
--   * `ride_messages` — its DELETE policy carries `exists (select 1 from rides
--     r where r.id = ride_id)`, so the parent must be visible for the delete
--     regardless of what SELECT does. There IS a residual silent `DELETE 0`
--     here — a rider who leaves the crew of a ride they can still see — but it
--     is caused by the `private.is_ride_crew(ride_id)` conjunct rather than by
--     the block conjunct this file is about, and hoisting the own-row arm past
--     `is_ride_crew` would break the invariant `docs/reference/schema.md`
--     records for this table: its audience is an INTERSECTION and neither half
--     alone is it. Filed separately rather than absorbed here.
--
-- ---------------------------------------------------------------------------
-- WHAT THE HOIST DOES AND DOES NOT WIDEN
-- ---------------------------------------------------------------------------
-- It widens exactly one thing, on each of the three: **a rider can read the row
-- they themselves wrote, even when the parent has gone out of view.** It is
-- their own like, their own comment, their own crew membership — facts they
-- already hold. It does NOT expose the parent, and it does NOT expose anybody
-- else's row: every other rider's row still has to clear the parent EXISTS and
-- the block predicate, unchanged. 102.1–102.3 assert both directions.
--
-- ** IT ALSO WOULD HAVE WIDENED A WRITE, AND §1b IS WHY IT DOES NOT. ** On
-- `ride_members` alone, the hoisted SELECT policy is applied to the NEW row of an
-- UPDATE, and `048` grants UPDATE on `ride_id` — so the read change on its own
-- would have let a rider move their seat onto a private club's ride they cannot
-- see. §1b restates that refusal in the UPDATE policy's WITH CHECK, where it
-- belongs, instead of leaving it resting on a read policy's association. **This
-- is the finding of the change and it was caught by an existing assertion**
-- (077.4), not by reading the diff — which is the argument for measuring each of
-- the seven rather than sweeping them.
--
-- On `092`'s tables the same hoist flipped exactly four assertions in 2570 and
-- no others. Here it flipped **two** in 3280, both of which encoded the defect
-- rather than a requirement, and both now say so at their site: the hider's own
-- like in the 011 hide block (~line 1730, 0 -> 1), and 051's ex-member
-- precondition (~line 9516, 0 -> 1, which the change makes strictly stronger).
--
-- No grant changes, no table changes, no data changes: three SELECT policies and
-- one UPDATE policy are dropped and recreated. Every policy keeps its name, so
-- nothing that reads `pg_policies` by name moves.
--
-- ORDERING: this file is safe in either direction relative to the deploy. It
-- widens a read that no shipped bundle can currently obtain, narrows a write
-- path no shipped screen offers (nothing in `src/` moves a seat between rides —
-- `setRideAttendance` upserts status on one ride), and removes nothing. An older
-- bundle cannot observe it and a newer one needs no new column.

-- ---------------------------------------------------------------------------
-- 1. ride_members — the one that decides the priority
-- ---------------------------------------------------------------------------
-- The EXISTS still inherits the `rides` policy for everybody else's crew row,
-- which is what `009` intended by it. Your own row no longer rides on that.
drop policy "Ride rosters follow ride visibility" on public.ride_members;

create policy "Ride rosters follow ride visibility"
  on public.ride_members for select to authenticated
  using (
    ride_members.user_id = auth.uid()
    or (
      exists (select 1 from public.rides r where r.id = ride_members.ride_id)
      and not private.is_blocked(auth.uid(), ride_members.user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 1b. ** THE SEAT-MOVE REFUSAL MUST BE RESTATED HERE, OR §1 WIDENS A WRITE **
-- ---------------------------------------------------------------------------
-- ** THIS IS THE ONLY PART OF 102 THAT IS NOT A READ CHANGE, AND WITHOUT IT §1
-- IS A PRIVILEGE ESCALATION. ** Caught by 077.4's existing assertion, which
-- names the mechanism in its own comment:
--
--     "the thing that refuses a move onto an invisible ride was never the
--      trigger — it is the SELECT policy applied to the NEW row."
--
-- `048` grants UPDATE on `ride_members.ride_id`, so a rider can move their own
-- seat between rides. The UPDATE policy is a bare `auth.uid() = user_id` on both
-- sides and carries NO visibility requirement, so what actually refused a move
-- onto a ride the rider cannot see was Postgres applying the SELECT policy to
-- the new row — and the old SELECT policy refused it only because its parent
-- EXISTS dominated. Hoist the own-row arm and the new row satisfies
-- `user_id = auth.uid()` on its own, the SELECT check passes, and **a non-member
-- can move their seat onto a private club's ride**, putting themselves in a crew
-- the INSERT policy would never have let them join.
--
-- So the refusal moves to where it was always meant to be: an explicit
-- WITH CHECK on the UPDATE policy, evaluated under the caller's own RLS. It no
-- longer depends on the incidental shape of a read policy — which is the fragile
-- coupling 077.4 was already uneasy about ("worth re-asserting precisely because
-- removing the trigger is the moment someone would assume otherwise").
--
-- The USING side is deliberately left bare. Leaving a ride and changing status
-- are different capabilities: DELETE has no visibility requirement by design
-- (that is §1's whole point), and a rider whose ride has gone out of view can
-- still leave it. What they cannot do is move a seat ONTO something invisible.
--
-- `postcard_likes` and `postcard_comments` need no counterpart: neither has an
-- UPDATE policy or an UPDATE grant (009 — "a like has no mutable column"; 011 —
-- "there is no UPDATE grant"), and both INSERT policies carry their own parent
-- EXISTS. `ride_members` is the only one of the three with a mutable key.
drop policy "Users can update their own ride status" on public.ride_members;

create policy "Users can update their own ride status"
  on public.ride_members for update to authenticated
  using (ride_members.user_id = auth.uid())
  with check (
    ride_members.user_id = auth.uid()
    and exists (select 1 from public.rides r where r.id = ride_members.ride_id)
  );

comment on policy "Users can update their own ride status" on public.ride_members is
  'THE WITH CHECK''S `exists` AGAINST rides IS LOAD-BEARING AND MUST NOT BE SIMPLIFIED AWAY — 102, PD-362. 048 grants UPDATE on ride_id, so this policy governs a SEAT MOVE as well as a status change. Before 102 the move onto an invisible ride was refused only as a side effect of the SELECT policy being applied to the NEW row, and that policy''s parent EXISTS dominating; 102 hoists the own-row arm out of the block conjunct, so the new row would now pass the SELECT check on `user_id = auth.uid()` alone and a non-member could move their seat onto a private club''s ride. The EXISTS runs under the caller''s own RLS, so it means "a ride you can actually see". The USING side stays bare on purpose: leaving a ride you can no longer see must keep working, which is what 102 §1 is for.';

-- ---------------------------------------------------------------------------
-- 2. postcard_likes — the shape 092 refused to copy
-- ---------------------------------------------------------------------------
drop policy "Likes follow postcard visibility" on public.postcard_likes;

create policy "Likes follow postcard visibility"
  on public.postcard_likes for select to authenticated
  using (
    postcard_likes.user_id = auth.uid()
    or (
      exists (select 1 from public.postcards p where p.id = postcard_likes.postcard_id)
      and not private.is_blocked(auth.uid(), postcard_likes.user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. postcard_comments — the third one, measured here for the first time
-- ---------------------------------------------------------------------------
-- The block clause remains about the COMMENTER, not the postcard, exactly as
-- 011 wrote it. Only the association changes.
drop policy "Comments follow postcard visibility" on public.postcard_comments;

create policy "Comments follow postcard visibility"
  on public.postcard_comments for select to authenticated
  using (
    postcard_comments.author_id = auth.uid()
    or (
      exists (select 1 from public.postcards p where p.id = postcard_comments.postcard_id)
      and not private.is_blocked(auth.uid(), postcard_comments.author_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Record the shape at the objects, so the next reader is not left to infer it
-- ---------------------------------------------------------------------------
-- These three comments are what a session grepping for the defect reaches
-- first, and they are the reason a later "tidy-up" cannot quietly un-hoist:
-- the suite's 102.5 asserts each of them is present.
comment on policy "Ride rosters follow ride visibility" on public.ride_members is
  'THE OWN-ROW BRANCH IS A DISJUNCT OF THE WHOLE POLICY AND MUST STAY THERE — 102, PD-362. Inside the block conjunct it is a NO-OP (blocks_no_self_block already makes is_blocked(x, x) false) and the parent EXISTS dominates, so a rider blocked by the ride''s ORGANIZER could not read their own crew row and therefore could not LEAVE THE RIDE: RLS filters a DELETE by what the caller may read (081), so the bare `auth.uid() = user_id` DELETE policy matched nothing and PostgREST reported success. Everybody else''s crew row still inherits the rides policy through the EXISTS, which is what 009 intended by it.';

comment on policy "Likes follow postcard visibility" on public.postcard_likes is
  'THE OWN-ROW BRANCH IS A DISJUNCT OF THE WHOLE POLICY AND MUST STAY THERE — 102, PD-362. This is the table 092''s club_thread_waves comment named as carrying the defect. 009''s DELETE policy here says in its own comment that there is deliberately no visibility requirement, "or the row is stranded"; un-hoisted, this SELECT policy re-imposed exactly that requirement, because RLS filters a DELETE by what the caller may read (081). Reachable with NO BLOCK ANYWHERE — the liker leaves the club the postcard was posted to. The block arm remains about the LIKER, not the postcard.';

comment on policy "Comments follow postcard visibility" on public.postcard_comments is
  'THE OWN-ROW BRANCH IS A DISJUNCT OF THE WHOLE POLICY AND MUST STAY THERE — 102, PD-362. 011''s own comment on this policy claimed "Your own comment is unconditional, so you never lose sight of what you wrote", which the pre-102 shape prevented: the parent EXISTS dominated, so a commenter who left the club could neither read nor delete their own comment, the DELETE policy''s `author_id = auth.uid()` arm matching nothing. The block arm remains about the COMMENTER, not the postcard. public.moderate_comment() still serves the POSTCARD AUTHOR''S invisible case and is untouched — that arm is a different actor and a different reason.';

-- ---------------------------------------------------------------------------
-- Verification (run against the project after applying)
-- ---------------------------------------------------------------------------
--   select tablename, qual from pg_policies
--    where schemaname = 'public' and cmd = 'SELECT'
--      and tablename in ('ride_members','postcard_likes','postcard_comments');
--   -- each qual must OPEN with the own-row disjunct, not with the EXISTS.
--
--   -- and the four left alone must still carry the old shape:
--   select tablename, qual from pg_policies
--    where schemaname = 'public' and cmd = 'SELECT'
--      and tablename in ('club_members','club_messages','club_threads','ride_messages');
