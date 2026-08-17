-- 060: a fan-out addresses only riders whose own SELECT policy resolves the
--      subject. PD-211.
--
-- Two recipient sets had drifted from their subject's read policy, in opposite
-- directions, and `036` §7.5 already names the class both belong to:
--
--     "A row nobody can ever read is worse than no row: nothing raises, no
--      count moves, no assertion fails, and it accumulates until its subject is
--      deleted."
--
--   §4  TOO WIDE. `055` widened `ride_joined` to the whole crew, and `rides`
--       SELECT has no crew arm — so two measured routes produce a row that is
--       unreadable from the instant it is written.
--   §5  TOO NARROW. `036` §7.5 withheld `ride_created_in_club` from an
--       ownerless club owner, justified by `private.is_club_member` having no
--       owner arm. `054` gave it one. The justification is void and the
--       narrowing has become a gap.
--
-- Both are repaired by the same primitive, which is why they are one file: a
-- predicate that takes its SUBJECT as an argument instead of reading
-- `auth.uid()`, so a fan-out can ask "can THIS candidate resolve the subject"
-- rather than "can the caller". That is the shape `036` trap (c) demands of any
-- predicate applied per candidate, and neither half can be built without it.
--
-- ---------------------------------------------------------------------------
-- NO READ POLICY IS WIDENED BY THIS FILE, AND NO POLICY IS RECREATED
-- ---------------------------------------------------------------------------
-- That is the property a reviewer checks fastest. This file creates three
-- functions, replaces three, and issues no DDL on any table, no policy, no
-- trigger, no grant to a client role and no CHECK. Nothing a rider can see
-- widens; two things a rider is TOLD ABOUT change, one narrowing and one
-- widening, and both move toward what that rider's own policy already allows.
--
-- The application changes not at all: no new column, no new notification type
-- (`notifications_type_check` stays at five), no query shape, no cache key.
--
-- ---------------------------------------------------------------------------
-- THE CHEAPER END OF §4 IS REFUSED, AND NOT ON COST — IT IS WRONG
-- ---------------------------------------------------------------------------
-- PD-211 offers a second way to close §4: give `rides` SELECT a crew arm, so a
-- crew member resolves the ride by virtue of being on it and the fan-out needs
-- no change at all. `055`'s header floats it as "cheaper and may be the real
-- answer". It is not, and the two reasons are measured rather than aesthetic.
-- They are recorded here because the next session to read PD-211 will meet the
-- same fork and the cheap end still reads as the obvious one.
--
-- **(1) It either breaks blocking or does not do the job.** `rides` SELECT,
-- read verbatim off DEV (fpmrimzxadewsaiwpsel) on 2026-08-17, immediately
-- before this file was written:
--
--     ((organizer_id = auth.uid())
--      OR ((NOT private.is_blocked(auth.uid(), organizer_id))
--          AND (((is_public AND ((club_id IS NULL)
--                                OR private.is_club_public(club_id))))
--               OR ((club_id IS NOT NULL) AND private.is_club_member(club_id)))))
--
-- A crew arm added as a top-level disjunct — the natural place, beside the
-- organizer arm — sits OUTSIDE the `NOT private.is_blocked(...)` conjunct. A
-- rider who blocked the organizer would then read the ride again through a
-- roster row that blocking does not remove, which decision #2 forbids: a
-- blocked rider disappears from ride crews. `054` §Blocking is unaffected makes
-- the same argument from the other side — every occurrence of that membership
-- predicate sits UNDER a block conjunct, and the only disjuncts that escape one
-- test the viewer's own identity. A crew arm tests a roster row, not an
-- identity.
--
-- Put the crew arm under the block conjunct instead and it closes the
-- left-the-club route while leaving the blocked route exactly where it was —
-- the same half-repair `055` refused, arriving by a different door and reading
-- as complete.
--
-- **(2) It silently widens two audiences that are not this file's to widen.**
-- `034`'s `ride_messages` policies are an INTERSECTION, and `034`'s own comment
-- says why: an `exists` against `rides` under the caller's RLS **AND**
-- `private.is_ride_crew(ride_id)`, because the crew helper alone "lets an
-- ex-club-member read a private ride's chat" — a leak `034` shipped in draft
-- and fixed. A crew arm in `rides` SELECT collapses that intersection into its
-- crew half, restoring the leak in the one place it was already paid for.
-- `041`'s postcard ride-tag WITH CHECK carries the same conjunction and would
-- go the same way.
--
-- So the fan-out narrows to the readable set, and `rides` SELECT is untouched.
-- `055.7`'s assertion that it has NO crew arm therefore stays, and stops being
-- a note about a gap: it is now load-bearing for `034` and `041`.
--
-- ---------------------------------------------------------------------------
-- THE RESIDUAL HAZARD, STATED RATHER THAN HIDDEN: §3 AND §3b RESTATE POLICIES
-- ---------------------------------------------------------------------------
-- Everything below is said of `can_read_ride` and holds identically for §3b's
-- `can_read_club`, whose own pin is §060.1b.
--
-- `private.can_read_ride` is a second implementation of `rides` SELECT, and
-- `036` §3 warns against exactly that — "the conjunction is cheap and does not
-- go stale; the derivation does". There is no way around it in plain SQL: a
-- policy can only be evaluated for the caller, and a fan-out needs the answer
-- for somebody else. So the restatement is accepted and fenced instead:
--
--   * `rides` SELECT's `qual` is pinned TEXTUALLY in the suite (§060.1), with a
--     label naming this function, and matched WHOLE rather than with `like` —
--     a pattern match is what let this class of drift live, since `055.7`'s two
--     `like` assertions were both true throughout the period the fan-out was
--     wrong. That policy has been rewritten twice already
--     — `017` and `022` — so this is a when, not an if. A rewrite now fails the
--     suite and arrives here to update the helper in the same change.
--   * The helper reuses the policy's own helper functions rather than inlining
--     what they do. `private.is_club_public` is already candidate-independent
--     and is called directly; the membership arm gets §1's split so that ONE
--     body serves both the caller-relative and the candidate-relative reading.
--     Only `is_blocked` was already subject-taking.
--
-- What is deliberately NOT done: making `rides` SELECT call `can_read_ride`
-- with `auth.uid()`, which would collapse the two into one expression. It would
-- put a `security definer` function in front of the whole rides feed, recreate
-- the policy this file promises not to touch, and — because that helper reads
-- `public.rides` itself — create the self-edge `054`'s RECURSION WARNING exists
-- to keep out of that policy. The pinned text is the cheaper fence.
--
-- ---------------------------------------------------------------------------
-- THE DIRECTION OF FAILURE, AND WHAT A NARROWED FAN-OUT COSTS
-- ---------------------------------------------------------------------------
-- §4 removes rows that were being written. Nobody loses a notification they
-- could see: every row it stops writing is one `036` §3 conjunct 4 discarded on
-- every read. What genuinely changes is the REVERSAL — under `055` the row
-- existed and became readable if the rider unblocked or rejoined the club;
-- after this file there is nothing to become readable, so a rider who unblocks
-- gets no backlog.
--
-- That is the correct behaviour and it is not new: every other fan-out in `036`
-- suppresses at fan-out time when a block stands, and `036` §7.1 states the
-- rule — "a block suppresses the notification, not the action". `ride_joined`
-- was the odd one out only because its own block test named the ACTOR while the
-- unreadable-row route ran through the ORGANIZER. `036` §7.6's "leaving a club
-- retracts nothing" argues the same instant-vs-standing-claim point from the
-- other direction: a notification records an event at an instant, and one never
-- delivered is not owed later.
--
-- ---------------------------------------------------------------------------
-- COST
-- ---------------------------------------------------------------------------
-- §1 puts one extra function call inside `private.is_club_member`, which ten
-- policies evaluate. Neither function was inlinable before — a `security
-- definer` SQL function never is — so this is one added call per evaluation,
-- not a change of plan shape. Both remain `stable`, so a repeated evaluation
-- within one statement is still cached. Accepted at this size and recorded as a
-- measured expectation rather than an assumption.
--
-- §4 and §5 each add one `can_read_ride` call per CANDIDATE, inside the joining
-- rider's own transaction. Each call is two indexed lookups at worst
-- (`rides_pkey`, then `club_members_pkey` or `blocks`). `055`'s volume note is
-- unchanged and its ceiling — a 500-member club fan-out — is where to look
-- first if this is ever felt.

-- ---------------------------------------------------------------------------
-- §1  ONE MEMBERSHIP BODY, TWO ENTRY POINTS
-- ---------------------------------------------------------------------------
-- `private.is_club_member(club)` is caller-relative: it resolves `auth.uid()`
-- internally, which is right for a policy and useless to a fan-out. `036` trap
-- (c) is explicit that a fan-out calling it computes ONE answer — the caller's
-- — and applies it to every candidate, making the recipient set everybody or
-- nobody.
--
-- The obvious fix is to write the membership test out again inside
-- `can_read_ride`. That would be a THIRD copy of a rule this repo has already
-- watched drift: PD-211 exists because `036` §7.5 encoded a claim about this
-- very function's body and `054` changed the body underneath it. So the body
-- moves once, into the subject-taking function, and the caller-relative name
-- becomes a one-line wrapper over it.
--
-- ** `is_club_member`'s SIGNATURE, OID AND GRANTS ARE UNCHANGED. ** `create or
-- replace` preserves all three, so none of its ten calling policies is
-- recreated and none changes meaning. `054`'s behavioural assertions all run
-- against the wrapper untouched, which is what proves the split is behaviour-
-- preserving rather than a claim that it is.
create function private.is_club_member_for(candidate uuid, target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- 054's body verbatim, with `candidate` where the caller's own id stood.
  -- (The displaced expression is deliberately not NAMED here: `prosrc` is what
  -- §060.3 greps to prove this body is subject-taking, and a comment mentioning
  -- it reads exactly like the thing it replaced. CLAUDE.md calls that the
  -- comment trap; this assertion caught it on the first run.)
  --
  -- Membership first: it is the common case, and `or` short-circuits, so a
  -- rider who holds a row never pays for the `clubs` lookup. Two independent
  -- EXISTS clauses rather than a join, for the same reason.
  select exists (
    select 1 from public.club_members
     where club_id = target_club_id
       and user_id = candidate
  ) or exists (
    select 1 from public.clubs
     where id = target_club_id
       and owner_id = candidate
  );
$$;

-- ** NOT GRANTED TO ANY CLIENT ROLE, AND THAT IS A SECURITY PROPERTY RATHER
-- THAN TIDINESS. ** `is_club_member` is granted to `authenticated` because a
-- policy expression is evaluated as the querying role and would fail without
-- it. This one takes its subject as an argument, so a rider holding EXECUTE
-- could ask whether ANY OTHER RIDER belongs to any club — a membership oracle
-- for private clubs, answerable one call at a time. The nested call inside the
-- wrapper needs no grant: the wrapper is `security definer`, so its body runs
-- as the owner.
--
-- Revoking from `public` is what does the work — EXECUTE is granted to PUBLIC
-- by default on creation, which is also how `service_role` would otherwise
-- reach it through the USAGE `031` granted it on this schema.
revoke all on function private.is_club_member_for(uuid, uuid) from public, anon, authenticated;

comment on function private.is_club_member_for(uuid, uuid) is
  'Club membership for a NAMED rider: a club_members row, or clubs.owner_id (054''s owner arm). This holds the body; private.is_club_member(uuid) is a wrapper passing auth.uid(). Split by 060 so a fan-out can test a CANDIDATE — 036 trap (c) — without a second copy of the rule that could drift from the first. Reachable by no client role: it would answer "does rider X belong to private club Y" for any X.';

create or replace function private.is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_club_member_for(auth.uid(), target_club_id);
$$;

comment on function private.is_club_member(uuid) is
  'Is the CALLER a member of this club — a club_members row, or the club''s owner_id (054). The body lives in private.is_club_member_for(candidate, club) since 060; this is the caller-relative entry point the ten calling policies use, and its signature, OID and grants are unchanged by that split. Do NOT call this from a fan-out: it resolves auth.uid(), so it answers for the caller and never for a candidate — 036 trap (c).';

-- `create or replace` preserves privileges, so this is a no-op against any
-- database carrying `005`. Re-issued so the file is correct standing alone,
-- including on a scratch database replaying the chain.
revoke all on function private.is_club_member(uuid) from public;
grant execute on function private.is_club_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §2  (intentionally empty — `private.is_club_public` already takes no subject)
-- ---------------------------------------------------------------------------
-- Recorded rather than omitted, because "why is only one of the two helpers
-- split" is the first question §3 raises. `private.is_club_public(club)` reads
-- `clubs.is_public` and nothing about anybody, so it is already correct for a
-- candidate and is called unchanged below. `private.is_blocked(a, b)` was
-- subject-taking from `002`.

-- ---------------------------------------------------------------------------
-- §3  private.can_read_ride(candidate, target_ride)
-- ---------------------------------------------------------------------------
-- `rides` SELECT with `candidate` substituted for `auth.uid()`, arm for arm and
-- in the same order, so the two can be read against each other by eye. The
-- header's residual-hazard note is the contract for keeping them together.
--
-- The parameter is `target_ride` rather than `ride` for the same reason `054`
-- uses `target_club_id`: a parameter sharing a name with a column in scope is
-- an ambiguity error waiting for the first body edit that adds a join.
--
-- ** NOT GRANTED TO ANY CLIENT ROLE. ** Same reasoning as §1 and it bites
-- harder: this one is a block oracle. `can_read_ride(x, r)` flipping to false
-- for a public ride tells the caller that x and r's organizer are blocked with
-- each other, which decision #2 requires must never be revealed by any gap,
-- count or marker. Reachable only from the two fan-outs, which are `security
-- definer` and run this as the owner.
create function private.can_read_ride(candidate uuid, target_ride uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rides r
     where r.id = target_ride
       and (
         -- Unconditional, exactly as in the policy: an organizer resolves their
         -- own ride whatever its is_public, whatever its club, and whether or
         -- not they hold a ride_members or club_members row.
         r.organizer_id = candidate
         or (
           not private.is_blocked(candidate, r.organizer_id)
           and (
             (r.is_public and (r.club_id is null or private.is_club_public(r.club_id)))
             or (r.club_id is not null and private.is_club_member_for(candidate, r.club_id))
           )
         )
       )
  );
$$;

revoke all on function private.can_read_ride(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_ride(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this ride? A restatement of rides SELECT with the candidate in place of auth.uid(), for fan-outs that must not write a row the recipient can never read (036 §7.5). Reachable by no client role — it is a block oracle. IT RESTATES A POLICY AND CAN GO STALE: rides SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §060.7, naming this function, so a rewrite fails there rather than silently here.';

-- ---------------------------------------------------------------------------
-- §3b  private.can_read_club(candidate, target_club)
-- ---------------------------------------------------------------------------
-- ** `ride_created_in_club` HAS TWO SUBJECTS, AND FILTERING ONLY ON THE RIDE
-- WOULD RE-COMMIT THIS FILE'S OWN DEFECT ONE TABLE OVER. ** `036` §3's
-- resolvability conjuncts are per column and independent — conjunct 4 requires
-- the `rides` row resolve, conjunct 5 requires the `clubs` row resolve — and a
-- `ride_created_in_club` row carries BOTH `ride_id` and `club_id`. So the
-- recipient must resolve both, and a fan-out that checks one has reasoned about
-- the other.
--
-- `036` §3 forbids that reasoning by name: **"Do not collapse it on the grounds
-- that ride-visibility implies club-visibility. That holds against the `rides`
-- policy as it reads today, and that policy has already been rewritten twice —
-- by 017 and by 022 — with nothing constraining it to keep the property. The
-- conjunction is cheap and does not go stale; the derivation does."** Writing
-- the second call is the cheap half of that sentence.
--
-- ** NO CANDIDATE IS EXCLUDED BY THIS TODAY, AND THAT IS THE POINT. ** Every
-- candidate in §5 is a `club_members` row or `clubs.owner_id`, and `clubs`
-- SELECT has an arm for each, so this conjunct removes nobody. It is written
-- because the reachable future state is nameable rather than hypothetical:
-- `041` records that `private.is_club_member` avoids `is_ride_crew`'s gap "only
-- because `clubs` carries no block predicate", and decision #2's own logic
-- argues for adding one. The day it arrives, a member blocked with the CLUB
-- OWNER but not with the RIDE ORGANIZER passes `can_read_ride`, fails `clubs`
-- SELECT, and gets a row nobody can ever read — `036` §7.5 verbatim, which is
-- the exact state §7.5 was already in when it was written.
--
-- Same posture as §3: definer, empty path, revoked from every client role, and
-- its policy text pinned in the suite (§060.1b) because it restates one.
create function private.can_read_club(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clubs c
     where c.id = target_club
       and (
         c.is_public
         or c.owner_id = candidate
         or private.is_club_member_for(candidate, c.id)
       )
  );
$$;

revoke all on function private.can_read_club(uuid, uuid) from public, anon, authenticated;

comment on function private.can_read_club(uuid, uuid) is
  'Would this NAMED rider''s own SELECT policy return this club? A restatement of clubs SELECT with the candidate in place of auth.uid(), the twin of private.can_read_ride. It exists because a ride_created_in_club notification carries BOTH ride_id and club_id and 036 §3 requires both subjects resolve — checking only the ride derives the club, which 036 §3 forbids by name. Excludes nobody today; it is the conjunct that keeps that true if clubs SELECT ever gains a block arm. Reachable by no client role. IT RESTATES A POLICY AND CAN GO STALE: clubs SELECT''s qual is pinned textually in supabase/tests/rls_test.sql §060.1b.';

-- ---------------------------------------------------------------------------
-- §4  ride_joined — the crew arm stops writing rows the crew cannot read
-- ---------------------------------------------------------------------------
-- ** ONE SUBJECT HERE, NOT TWO. ** A `ride_joined` row sets `ride_id` and
-- leaves `club_id` NULL, so `036` §3's conjunct 5 is vacuous for it and the
-- ride is the whole subject. §3b's second call belongs to §5 alone; adding it
-- here would filter on a column this type does not carry.
-- `055`'s function with ONE conjunct added to the outer WHERE. Everything else
-- is carried verbatim, and the list of what must not move is `055`'s own:
--
--   * The union of `rides.organizer_id` with the Going/Maybe crew.
--   * The actor exclusion AFTER the union, never inside an arm — a rider can
--     qualify through both, and the organizer's own RSVP is exactly that path.
--     The new conjunct goes in the same place and for the same reason.
--   * `not private.is_blocked(new.user_id, ...)` — the ACTOR's block test,
--     which is a different question from the new one. This one asks whether the
--     recipient wants to hear from the joiner; `can_read_ride` asks whether the
--     recipient can resolve the RIDE, which turns on the ORGANIZER. On a ride
--     the actor did not organize those are two different pairs of riders, so
--     neither conjunct implies the other and both stay.
--   * `auth.uid()` appears nowhere, `is_ride_crew` is not reached for, no `when`
--     clause is added, `on conflict do nothing` stays, INSERT only,
--     `status in ('going','maybe')`.
--   * `create or replace` keeps the OID, so the trigger binding on
--     `public.ride_members` survives and no trigger DDL is issued.
--
-- ** THE ORGANIZER ARM IS UNAFFECTED IN PRACTICE AND THE CONJUNCT IS STILL
-- APPLIED TO IT. ** `can_read_ride` is unconditionally true for a ride's own
-- organizer, so filtering the whole union rather than the crew arm alone costs
-- one call and cannot drop them. Filtering only the crew arm would be the same
-- inside-an-arm mistake `055`'s header spends a section on, and would leave the
-- organizer's readability resting on a claim about the policy instead of on a
-- measurement of it — which is the entire defect this file repairs.
create or replace function private.notify_ride_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, ride_id)
  select candidates.recipient, new.user_id, 'ride_joined', new.ride_id
    from (
      select r.organizer_id as recipient
        from public.rides r
       where r.id = new.ride_id
      union
      -- Index-served by ride_members_pkey (ride_id, user_id) — leading column.
      select m.user_id
        from public.ride_members m
       where m.ride_id = new.ride_id
         and m.status in ('going', 'maybe')
    ) candidates
   -- AFTER the union, never inside an arm: the organizer's own RSVP qualifies
   -- through both, and filtering inside one leaves them in through the other.
   where candidates.recipient <> new.user_id
     -- Blocking, symmetric from one directional row, so one call per candidate
     -- covers both directions. The rider's own RSVP still succeeds — a block
     -- suppresses the notification, not the action.
     and not private.is_blocked(new.user_id, candidates.recipient)
     -- 060: and the recipient must be able to RESOLVE THE RIDE. A ride_members
     -- row does not imply that — blocking removes nobody from a roster and
     -- leaving a club removes nobody either — so without this the crew arm
     -- writes rows 036 §3 conjunct 4 discards for ever. Subject-taking by
     -- necessity: 036 trap (c).
     and private.can_read_ride(candidates.recipient, new.ride_id)
  on conflict do nothing;
  return null;
end;
$$;

comment on function private.notify_ride_joined() is
  'Fan-out: an RSVP notifies the ride''s WHOLE CREW — everyone Going or Maybe, unioned with rides.organizer_id, minus the actor, minus anyone blocked with them, and (060) minus anyone whose own SELECT policy does not resolve the ride. That last filter is private.can_read_ride(candidate, ride), and it closes 055''s two KNOWN GAPs: a crew member who blocked the organizer, and one who left the club whose private ride it is. Both kept a ride_members row and neither could read the ride. The actor is excluded AFTER the union or an organizer RSVPing to their own ride notifies themselves. INSERT only, so a going<->maybe change notifies nobody. Volume is quadratic in crew size by decision, not by oversight.';

revoke all on function private.notify_ride_joined() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- §5  ride_created_in_club — the owner arm `036` §7.5 withheld, and the
--     measurement that replaces its justification
-- ---------------------------------------------------------------------------
-- ** BOTH OF §7.5's SURVIVING TEXTS ARE NOW FALSE, AND NEITHER CAN BE EDITED.
-- ** This repo never edits an applied migration, so the correction lives here:
--
--   1. `036` §7.5's prose — "the most important line in this file" — which says
--      `rides` SELECT's only club arm has no owner arm.
--   2. The LIVE `comment on function`, which `059` re-issued carrying the same
--      sentence forward. `059`'s edit was about the default club and it copied
--      the stale half without re-checking it, which is precisely how a
--      justification outlives its premise.
--
-- `054` gave `private.is_club_member` an owner arm, so an ownerless owner now
-- resolves their own private club's rides — asserted since `054` under the
-- `036/054:` label. Withholding the notification is no longer a consequence of
-- the read policy; it is a gap in front of it.
--
-- ** THE UNION IS NOT THE FIX ON ITS OWN — THE FILTER IS. ** Adding
-- `clubs.owner_id` to the candidate set would swap one claim about another
-- function's body for a fresher claim about the same body, and PD-211 exists
-- because that claim went stale once already. So the recipients are unioned
-- WIDE and then filtered by `can_read_ride`, which measures the thing §7.5 was
-- reasoning about. An owner arriving through the union arrives because their
-- policy resolves the ride, not because this file believes it does — and if
-- `054` were ever reverted, this fan-out narrows again by itself.
--
-- What that filter also buys, unasked: a club member who could not resolve the
-- ride is no longer written a row either. That set is empty today — a club
-- member resolves any ride in their club through the same predicate, and the
-- blocked ones are already excluded by the conjunct above — so this is a
-- structural guarantee rather than a behaviour change, and §060.5 asserts the
-- ordinary member still gets their row.
--
-- ** `059`'s DEFAULT-CLUB EARLY RETURN IS CARRIED VERBATIM. ** Losing it would
-- restore an app-wide broadcast that any rider can fire at will by creating a
-- ride in the welcome club — `059` §1 calls it worse than the defect `058` §4
-- refused to ship. It is the single most dangerous thing about editing this
-- function, and `create or replace` gives no warning that a clause has gone.
create or replace function private.notify_ride_created_in_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is null then
    return null;
  end if;

  -- 059: the default club's membership is every rider in the app, so this
  -- fan-out is an app-wide broadcast any rider can fire at will. See the
  -- migration header; this is 058 §4's rule applied to the fan-out 058 missed.
  if exists (select 1 from public.clubs c
              where c.id = new.club_id
                and c.is_default) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, ride_id, club_id)
  select candidates.recipient, new.organizer_id, 'ride_created_in_club', new.id, new.club_id
    from (
      -- Index-served by club_members_pkey (club_id, user_id) — leading column.
      select m.user_id as recipient
        from public.club_members m
       where m.club_id = new.club_id
      union
      -- 060: the club's owner, who may hold no membership row. 036 §7.5
      -- withheld this arm because is_club_member had no owner arm; 054 gave it
      -- one, and the filter below is what proves it rather than asserting it.
      select c.owner_id
        from public.clubs c
       where c.id = new.club_id
    ) candidates
   -- AFTER the union: an owner who also holds a membership row qualifies
   -- through both arms, so an exclusion inside one leaves them in through the
   -- other. 036 §7.6 pays for this lesson on club_joined.
   where candidates.recipient <> new.organizer_id
     and not private.is_blocked(new.organizer_id, candidates.recipient)
     -- 060: and only if their own SELECT policy resolves the ride. This is what
     -- replaces §7.5's reasoning about is_club_member's body with a measurement
     -- of it.
     and private.can_read_ride(candidates.recipient, new.id)
     -- 060: AND the club, because this type carries club_id as well and 036 §3
     -- tests the two subjects independently. Removes nobody today — see §3b for
     -- why it is written anyway, and for the reachable state that needs it.
     and private.can_read_club(candidates.recipient, new.club_id)
  on conflict do nothing;
  return null;
end;
$$;

comment on function private.notify_ride_created_in_club() is
  'Fan-out: a club ride notifies that club''s members UNIONED WITH clubs.owner_id (060), minus the organizer, minus anyone blocked with them, and minus anyone whose own SELECT policy does not resolve the ride OR the club — both, because this type carries ride_id and club_id and 036 §3 tests them independently. 036 §7.5 withheld the owner arm because private.is_club_member had no owner arm and a row written to an ownerless owner would be unreadable for ever; 054 gave it one, so that justification is void — and the read is now MEASURED per candidate by private.can_read_ride rather than reasoned about, so the arm narrows again by itself if 054 is ever reverted. Since 059 it returns early for the club carrying clubs.is_default: every rider is a member of that one, so this fan-out would be an app-wide broadcast that any rider could fire at will by creating a ride there.';

revoke all on function private.notify_ride_created_in_club() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying
-- ---------------------------------------------------------------------------
--   -- t,t / t,t — both new helpers are definers with the path pinned. Note the
--   -- stored form: `set search_path = ''` records as `search_path=""`.
--   select proname, prosecdef, proconfig from pg_proc
--    where oid in ('private.can_read_ride(uuid,uuid)'::regprocedure,
--                  'private.is_club_member_for(uuid,uuid)'::regprocedure);
--
--   -- 0 — no client role, and not service_role either, on either helper
--   select count(*) from (values ('authenticated'),('anon'),('service_role')) r(role)
--    cross join (values ('private.can_read_ride(uuid,uuid)'),
--                       ('private.is_club_member_for(uuid,uuid)')) f(fn)
--    where has_function_privilege(r.role, f.fn, 'execute');
--
--   -- t — the ONE grant that must survive: policies evaluate as the caller
--   select has_function_privilege('authenticated','private.is_club_member(uuid)','execute');
--
--   -- 0 — auth.uid() appears in neither fan-out body (036 trap (b))
--   select count(*) from pg_proc
--    where oid in ('private.notify_ride_joined()'::regprocedure,
--                  'private.notify_ride_created_in_club()'::regprocedure)
--      and prosrc like '%auth.uid()%';
--
--   -- 2 — both fan-outs now call the subject-taking predicate
--   select count(*) from pg_proc
--    where oid in ('private.notify_ride_joined()'::regprocedure,
--                  'private.notify_ride_created_in_club()'::regprocedure)
--      and prosrc like '%can_read_ride%';
--
--   -- t — and the club fan-out checks its SECOND subject too
--   select prosrc like '%can_read_club%' from pg_proc
--    where oid = 'private.notify_ride_created_in_club()'::regprocedure;
--
--   -- The other pinned policy text, §060.1b's
--   select qual from pg_policies
--    where schemaname = 'public' and tablename = 'clubs' and cmd = 'SELECT';
--
--   -- t — 059's early return survived the replace. This is the clause whose
--   -- loss is silent and worst; check it explicitly rather than by reading.
--   select prosrc like '%is_default%' from pg_proc
--    where oid = 'private.notify_ride_created_in_club()'::regprocedure;
--
--   -- 2 rows, both `tgqual is null` — the bindings survive, no trigger DDL was
--   -- issued, and neither gained a WHEN clause. The tgname filter is REQUIRED:
--   -- ride_members and rides both carry enforce_participation_gate.
--   select tgname, tgqual is null as no_when_clause from pg_trigger
--    where not tgisinternal
--      and tgname in ('notify_ride_joined','notify_ride_created_in_club');
--
--   -- 10 — the policies calling is_club_member, unchanged in count and in text
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and (qual like '%is_club_member%' or with_check like '%is_club_member%');
--
--   -- The pinned policy text §060.7 asserts. If this has changed, can_read_ride
--   -- is stale and must be updated in the same change.
--   select qual from pg_policies
--    where schemaname = 'public' and tablename = 'rides' and cmd = 'SELECT';
