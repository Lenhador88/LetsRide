-- 119: a deletion already in progress is visible to another rider's deletion,
-- so two riders erasing their accounts at the same moment can no longer destroy
-- a third rider's postcards.
--
-- PD-175, closing the race `032` §3 states precisely and deliberately leaves
-- open.
--
-- ---------------------------------------------------------------------------
-- The race, restated from `032` §3 because this file closes it
-- ---------------------------------------------------------------------------
--   1. Rider B's transfer RPC runs and commits — B owns nothing, returns nothing.
--   2. Rider A's transfer RPC selects B as successor for club C. Commits.
--   3. B's Edge Function reaches `deleteUser(B)`. C cascades away, and every
--      postcard every other member posted into C goes with it.
--
-- `032` chose not to fix it and said why: the window is open between two HTTP
-- calls in two different processes, so no single SQL statement spans it. It
-- named two mechanisms — a serialising advisory lock held across the whole Edge
-- Function invocation, or a deletion-in-progress marker on `profiles`.
--
-- ---------------------------------------------------------------------------
-- Why the marker, and not the advisory lock
-- ---------------------------------------------------------------------------
-- A session-level advisory lock cannot be held across the Edge Function's calls
-- at all: each PostgREST request is a separate pooled connection, so a lock
-- taken in the transfer RPC is released the moment that request returns —
-- which is the same boundary the race already crosses. A transaction-level one
-- is narrower still. The advisory lock `032` imagined needs a session the
-- function does not have, and a run that dies still holds it.
--
-- The marker needs no session, and a run that dies holds it only until the
-- window below expires.
--
-- ** THE EDGE FUNCTION IS NOT TOUCHED BY THIS FILE. ** It already calls the
-- transfer RPC first, before the Storage sweep and long before `deleteUser`, so
-- stamping inside `private.transfer_owned_clubs` is the earliest the marker can
-- exist without adding a round trip. `delete-account/index.ts` needs no
-- redeploy for this change, which also means this migration has no ordering
-- constraint against a deploy — see `CLAUDE.md` §The sequencing rule. It is
-- additive, no shipped client writes the column, and no bundle can observe it.
--
-- ---------------------------------------------------------------------------
-- What actually closes the window, and it is the lock `032` said was not enough
-- ---------------------------------------------------------------------------
-- The successor select already carries `for update of p`. `032` was right that
-- it did not close this race — it locked a row whose CONTENT said nothing about
-- a deletion. Now it does, and the two halves together are the fix:
--
--   * B's transfer stamps B's own `profiles` row and holds that row lock until
--     it commits.
--   * A's successor select reaches B as a candidate, blocks on that lock, and
--     — READ COMMITTED re-evaluates the qualifiers against the updated row
--     version once the lock is granted — re-reads B with the marker set and
--     skips it. `032` verified the skip-in-favour-of-the-next behaviour
--     directly: `explain` puts `LockRows` below `Limit`, so `limit 1` pulls the
--     next candidate rather than resolving to "no successor".
--
-- So a candidate whose deletion has merely STARTED is now skipped, where `032`
-- could only skip one whose deletion had already committed.
--
-- ---------------------------------------------------------------------------
-- The deadlock this admits, named rather than discovered later
-- ---------------------------------------------------------------------------
-- Two riders who each own a club AND are members of each other's can now
-- deadlock: each holds the lock on its own `profiles` row and waits for the
-- other's. ** Three or more concurrent deletions can form a longer wait cycle
-- than that two-rider one ** — same detection, same retry, same outcome, and
-- said here so the two-rider shape is not read as the only one. Postgres detects it and aborts one transaction, the transfer RPC
-- fails, the Edge Function throws and answers `deletion_failed` 500, and the
-- rider retries — by which time the other deletion has committed and the retry
-- finds a stamped, skippable row. Nothing is lost and nothing is half-done:
-- `032` §1 made the transfer idempotent for exactly this class of failure.
--
-- ** This is the deliberate trade and the alternative is worse. ** `for update
-- of p skip locked` removes the deadlock and replaces it with a silently wrong
-- answer: a candidate momentarily locked for an unrelated reason — a rider
-- editing their own bio — would be skipped, and a club whose ONLY remaining
-- member was that rider would take the ownerless or the delete arm when a
-- transfer was available. A loud, retryable error beats a quiet wrong outcome
-- in a function that exists to protect other riders' content.
--
-- ---------------------------------------------------------------------------
-- The window, which is the recovery story for a run that dies holding it
-- ---------------------------------------------------------------------------
-- `032` named this as the cost of the marker mechanism: "a new way to be stuck
-- if a run dies half way". A successful deletion removes the row, so the marker
-- outlives its run only when the run FAILED — and then the rider is still here,
-- still signed in, and would otherwise be skipped as a club successor for ever,
-- silently.
--
-- So the marker is consulted with a freshness window rather than as a boolean.
-- ** 15 minutes **, and the bound is STRUCTURAL rather than an estimate — which
-- matters, because the estimate is the weaker argument and it rots. The weak
-- form: the work between the stamp and `deleteUser` is a Storage
-- list-and-remove sweep, seconds for an ordinary rider. That is a guess about a
-- loop whose chunk count grows with the rider's object count
-- (`delete-account/index.ts`, one sequential `remove()` per `REMOVE_CHUNK`), so
-- it is not a ceiling. ** The form that holds: an Edge Function invocation
-- cannot outlive the platform's wall-clock limit for one, which is far under 15
-- minutes. ** So a marker older than the window ALWAYS belongs to a run that is
-- already dead, and never to one still in flight — whatever the rider's folder
-- looks like.
--
-- ** The residual, stated rather than implied: ** a rider whose deletion failed
-- and who retries more than 15 minutes later is racing again, exactly as they
-- were before this file.
--
-- ** One trap for whoever probes this window, met and recorded rather than
-- left for them. ** `now()` is the TRANSACTION timestamp, not the statement's.
-- So the obvious probe — narrow the window to zero and see the exclusion stop
-- — does nothing: a marker written by the same transaction that reads it is
-- EQUAL to `now()`, never less than it, so the candidate stays excluded and the
-- suite stays green. It reads exactly like a window that is not load-bearing.
-- Widen the window instead (`now() + interval '1 hour'` makes every marker read
-- stale) and the assertions go red immediately. None of this affects the real
-- path, where the marker is committed by ANOTHER transaction and is therefore
-- strictly older than the reader's `now()`. The window trades a permanent silent exclusion for a
-- re-opened window on the retry, which is the right way round — the first is
-- invisible and forever, the second is the status quo ante for one rider for
-- one call.

-- ---------------------------------------------------------------------------
-- Pre-flight, measured against BOTH projects 2026-09-19
-- ---------------------------------------------------------------------------
--                                            DEV      PROD
--   profiles ................................. 30        3
--   clubs .................................... 17        2
--   clubs with more than one member ........... 8        1
--   club_members rows ........................ 39        3
--   profiles already carrying a marker ........ 0        —  (column does not exist)
--
-- A count that is 0 today is not a count that is 0 at apply time — re-run it
-- then. The eight multi-member clubs on DEV are the rows this change can
-- actually reach: a club with one member has no successor to choose between.
--
-- ---------------------------------------------------------------------------
-- The interleaving itself, exercised in TWO SESSIONS — not inferred
-- ---------------------------------------------------------------------------
-- The RLS suite cannot see this and must not be read as if it could: it runs
-- both calls inside ONE psql transaction, which is exactly why `032`'s
-- idempotency assertion proved nothing about the race. Run against a local
-- cluster carrying the full migration chain, 2026-09-19, on a club whose owner
-- A is leaving and whose other members are B (admin, so first by `029`'s
-- ordering) and C (member):
--
--   control, no marker anywhere ..................... the select returns B
--
--   session 1:  begin; update profiles set deletion_started_at = now()
--               where id = B;   -- held open, NOT committed
--   session 2:  the successor select, verbatim, with `for update of p`
--               -> BLOCKS for 2033 ms, which is session 1's remaining hold
--   session 1:  commit
--   session 2:  returns ** C **, not B
--
-- So the select waited for the uncommitted stamp, re-read the row under READ
-- COMMITTED, and skipped the candidate it would otherwise have chosen. That is
-- the cross-transaction property `032` §3 said the lock did not have, and the
-- marker is what gives it one. Both sessions rolled back.

-- ---------------------------------------------------------------------------
-- §1. The column
-- ---------------------------------------------------------------------------
-- No client can read or write it, and that needs no revoke: `025` made every
-- `authenticated` grant on `profiles` COLUMN-SCOPED — SELECT, INSERT and UPDATE
-- each name an explicit list — so a column added here is outside all three by
-- construction, and `anon` holds nothing on this table at all. Measured against
-- DEV before writing this, per grantee, and asserted in the suite rather than
-- left to that reasoning.
alter table public.profiles
  add column deletion_started_at timestamptz;

comment on column public.profiles.deletion_started_at is
  'When this rider''s account deletion began — stamped by private.transfer_owned_clubs, the deletion''s first database call (119, PD-175). NOT a client column and not part of any grant: `025` made every authenticated grant on this table column-scoped, so this one is unreachable by SELECT, INSERT and UPDATE alike without a revoke, and anon holds nothing here. It exists for ONE reader — the successor select in that same function, which skips a candidate whose marker is set and younger than 15 minutes, closing the race 032 §3 states. A successful deletion takes the row with it, so a set marker means either a deletion in flight or one that FAILED; the 15-minute window is what stops the second case excluding a still-present rider from club succession for ever. It is never an oracle: no client can read it, and the only behaviour it changes is which member inherits a club.';

-- ---------------------------------------------------------------------------
-- §2. The stamp and the exclusion
-- ---------------------------------------------------------------------------
-- `create or replace` over `117`'s body, which is the current definition —
-- `032` is no longer it. Two edits and nothing else: the UPDATE at the top, and
-- the marker conjunct in the successor select. Every other line is `117`
-- verbatim, including its comments, so a diff of this file against `117` shows
-- the change and nothing but.
create or replace function private.transfer_owned_clubs(departing uuid)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  club record;
  successor uuid;
begin
  -- 119: the marker, stamped before anything else this function does and
  -- therefore before anything else the deletion does — this is its first
  -- database call. It holds a row lock on the departing rider's profile until
  -- this transaction commits, which is the half that makes another deletion's
  -- `for update of p` below actually close the race rather than merely order
  -- it. Unconditional: a rider who owns no club still has to be skippable as
  -- somebody else's successor, and the loop below would not run for them.
  update public.profiles
     set deletion_started_at = now()
   where id = departing;

  for club in
    -- 107 adds `is_default` to this list; 117 makes it writable as well as read
    -- — see §2 for why the welcome club is no longer excluded from the arm
    -- below, and why it hands the flag back when it is kept.
    select c.id, c.avatar_path, c.cover_image_path, c.is_default
      from public.clubs c
     where c.owner_id = departing
     order by c.id
     for update
  loop
    -- Emitted BEFORE the branch, so the bytes are surrendered on all three
    -- outcomes: transfer, ownerless, and deletion.
    if club.avatar_path is not null then
      object_path := club.avatar_path;
      return next;
    end if;
    if club.cover_image_path is not null then
      object_path := club.cover_image_path;
      return next;
    end if;

    -- admin, then member, then anything else — total over the enum, so a stray
    -- second 'owner' row sorts last rather than being picked at random.
    --
    -- `for update of p` makes the selection sound WITHIN this transaction: a
    -- candidate whose own deletion is committing concurrently is skipped in
    -- favour of the next, rather than being misread as "no successor".
    --
    -- ** 119 makes it sound ACROSS transactions too, which 032 §3 said it was
    -- not. ** The conjunct below reads a marker the other deletion has already
    -- stamped; the lock is what guarantees this select waits for that stamp to
    -- commit and then re-reads it, instead of passing the row a moment before
    -- it is set. Neither half works alone.
    select m.user_id into successor
      from public.club_members m
      join public.profiles p on p.id = m.user_id
     where m.club_id = club.id
       and m.user_id <> departing
       -- 119: never hand a club to somebody who is already erasing their own
       -- account. Fresh markers only — see the header: a stale one belongs to a
       -- run that died, and its rider is still here and still eligible.
       and (p.deletion_started_at is null
            or p.deletion_started_at < now() - interval '15 minutes')
     order by case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
              m.joined_at,
              m.user_id
     limit 1
       for update of p;

    if successor is not null then
      -- The welcome club transferred to a successor KEEPS its flag and its new
      -- owner, and raises no alert: nothing was lost.
      update public.clubs
         set owner_id         = successor,
             avatar_path      = null,
             cover_image_path = null
       where id = club.id;

      update public.club_members
         set role = 'owner'
       where club_id = club.id
         and user_id = successor;

      -- DEMOTED, not deleted — 032 §1. This transaction commits before the rest
      -- of the deletion runs, so the row has to survive a failure in between.
      update public.club_members
         set role = 'member'
       where club_id = club.id
         and user_id = departing;

    elsif exists (
      -- 107: a postcard by anyone other than the departing rider is third-party
      -- content, and destroying it is what this change exists to stop.
      --
      -- `author_id <> departing` is the whole test and it is neither vacuous nor
      -- universal. No arm of this branch can see a postcard by a surviving
      -- MEMBER — there are no members left, which is why this arm ran at all —
      -- so every row it matches is by a rider who has already left. The
      -- departing rider's own postcards are excluded because they are going with
      -- the account, correctly and by the profiles cascade.
      --
      -- ** 117 REMOVED `not club.is_default` from this test. ** The welcome club
      -- was excluded because complete_onboarding force-joined every new rider to
      -- clubs.is_default through a security definer path no policy governs, so
      -- an ownerless one would have handed its preserved postcards to the whole
      -- signup stream. 114 carries 107 §4b's `and c.owner_id is not null` on
      -- that join, and the UPDATE below takes the flag off the club outright —
      -- so the subject of that force-join no longer exists, rather than being
      -- guarded against.
      --
      -- ** 119 does not widen this arm, and the reading that it does is wrong. **
      -- A member skipped for a fresh marker leaves `successor` NULL only when
      -- they were the LAST candidate, and then the club reaches this arm one
      -- deletion earlier than it would have — kept ownerless with its
      -- third-party postcards intact, which is the outcome this arm exists to
      -- produce. The rider whose marker caused the skip is erasing their account
      -- moments later regardless, so the alternative was never "they keep it".
      select 1 from public.postcards p
       where p.club_id = club.id
         and p.author_id <> departing
    ) then
      -- The club survives with no owner. One statement — see the header.
      --
      -- ** `is_default = false` IS THE 117 FIX, and it belongs in THIS statement
      -- rather than a second one. ** A preserved welcome club is an ordinary
      -- ownerless club from this moment: invisible (107 §2a), unjoinable (§2b),
      -- uneditable, undeletable, its postcards readable by their authors alone.
      -- Writing `false` over a club that never carried the flag is a no-op and
      -- is deliberately unconditional — a branch here would be a second place
      -- for the two arms to disagree.
      update public.clubs
         set owner_id         = null,
             avatar_path      = null,
             cover_image_path = null,
             is_default       = false
       where id = club.id;

      -- No ride is deleted here. See the header: `032` §2's stranding premise
      -- does not hold when the club survives.

      -- 117: the app has just lost its welcome club. Recorded rather than
      -- warned — see §1. Never conditional on the insert succeeding: this
      -- function runs inside the account-deletion transaction and a failure
      -- here must take that transaction down, exactly as a failure in any other
      -- statement of it would, because a silent half-erasure is worse than a
      -- retried one.
      if club.is_default then
        insert into private.system_alerts (alert_key, subject_id)
        values ('welcome_club_kept_ownerless', club.id);
      end if;

    else
      -- 032's arm, verbatim. Nothing third-party to protect, so `009`'s original
      -- answer is still the right one.
      --
      -- Only the rides that `SET NULL` would turn into zombies. A public ride
      -- survives the club perfectly well; deleting it destroys another rider's
      -- content for no reason D3 ever gave. 032 §2.
      delete from public.rides
       where club_id = club.id
         and is_public = false;
      delete from public.clubs where id = club.id;

      -- 117: the welcome club can still reach this arm — when nothing
      -- third-party is in it to preserve — and the app has lost it just as
      -- surely. Same alert, different key, same operator action.
      if club.is_default then
        insert into private.system_alerts (alert_key, subject_id)
        values ('welcome_club_deleted', club.id);
      end if;
    end if;

    successor := null;
  end loop;
end;
$$;

comment on function private.transfer_owned_clubs(uuid) is
  'Hand every club this rider owns to its longest-tenured remaining admin, else its longest-tenured remaining member (029/032). ** 107: when no member remains, the club is KEPT with owner_id NULL if any postcard in it was authored by somebody else, and deleted only when there is nothing third-party to protect. 117 (PD-398) EXTENDS THAT ARM TO THE WELCOME CLUB and clears clubs.is_default in the same statement that nulls the owner. ** ** 119 (PD-175) STAMPS profiles.deletion_started_at FOR THE DEPARTING RIDER BEFORE ANYTHING ELSE AND REFUSES A SUCCESSOR WHOSE OWN MARKER IS SET AND YOUNGER THAN 15 MINUTES ** — that is the fix for the race 032 §3 states and leaves open, where B''s deletion commits, A''s deletion then picks B as successor, and B''s deleteUser cascades the club away with every other member''s postcards. The stamp and the pre-existing `for update of p` are one mechanism and neither half works alone: the lock is what makes A''s select wait for B''s stamp to commit and re-read it, rather than passing the row a moment before it is set. The 15-minute window is the recovery story for a run that DIED holding the marker — a successful deletion takes the row with it, so a stale marker always means a failed run whose rider is still here and still eligible. The cost is a rare deadlock between two riders who each own a club and are members of each other''s, which Postgres detects and which is retryable because 032 §1 made this function idempotent; `skip locked` would remove it and replace it with a silently wrong successor, which is worse. THE NO-SUCCESSOR ARM STILL KEYS ON POSTCARDS ALONE: a club whose only third-party content is a club_threads row still deletes. Returns the Storage object paths it surrendered so the caller can delete the bytes. security definer because it rewrites rows across four tables under nobody''s ownership; in `private` so PostgREST never publishes it.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- The grants `029` and `031` established are unchanged by a `create or replace`.
-- Expect f, f, t:
--
--   select has_function_privilege('authenticated', 'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('anon',          'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('service_role',  'private.transfer_owned_clubs(uuid)', 'execute');
--
-- The column is outside every client grant. Expect f for all six:
--
--   select has_column_privilege('authenticated', 'public.profiles', 'deletion_started_at', 'select'),
--          has_column_privilege('authenticated', 'public.profiles', 'deletion_started_at', 'insert'),
--          has_column_privilege('authenticated', 'public.profiles', 'deletion_started_at', 'update'),
--          has_column_privilege('anon',          'public.profiles', 'deletion_started_at', 'select'),
--          has_column_privilege('anon',          'public.profiles', 'deletion_started_at', 'insert'),
--          has_column_privilege('anon',          'public.profiles', 'deletion_started_at', 'update');
