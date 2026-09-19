-- 117: the welcome club hands back its flag when it goes ownerless, so that
-- `107`'s preservation arm covers it too and a rider erasing their account
-- stops destroying other riders' postcards in the ONE club most likely to
-- hold them.
--
-- PD-398, closing the follow-up `107` §4b filed against itself.
--
-- ---------------------------------------------------------------------------
-- The defect, and why `107` left it open
-- ---------------------------------------------------------------------------
-- `107` split `private.transfer_owned_clubs`' no-successor arm: a club whose
-- last member erases their account is KEPT, ownerless, when a postcard in it was
-- authored by somebody else, and deleted only when there is nothing third-party
-- to protect. The club carrying `clubs.is_default` — the welcome club — was
-- EXCLUDED from the keep arm:
--
--   elsif not club.is_default and exists (...postcard by another author...)
--
-- so it still deletes, and `postcards.club_id -> clubs` is ON DELETE CASCADE.
--
-- ** The exclusion was correct when it was written, and deleting it on its own
-- would be a data-EXPOSURE bug. ** `public.complete_onboarding` is
-- `security definer`, so `club_members`' INSERT policy — `107` §2b, which
-- refuses a membership row in an ownerless club — does not apply to it. At the
-- time `107` shipped, that function force-joined every completing rider to
-- `clubs.is_default` with no `owner_id` predicate. An ownerless welcome club
-- would therefore have been joined by every subsequent signup, each membership
-- row making `private.is_club_member` TRUE, and every preserved postcard in it
-- readable by the whole signup stream. That is worse than the loss it fixes.
--
-- ---------------------------------------------------------------------------
-- What has changed since, and what this file adds
-- ---------------------------------------------------------------------------
-- `107` §4b added the second lock inside `complete_onboarding` and `114` carries
-- it forward as the newest definition of that function:
--
--   insert into public.club_members (club_id, user_id, role)
--   select c.id, v_uid, 'member'
--     from public.clubs c
--    where c.is_default
--      and c.owner_id is not null          -- 107 §4b, carried by 114
--   on conflict do nothing;
--
-- So the force-join already refuses an ownerless welcome club, and `059`'s
-- "joined nothing" warning was widened in the same place to fire when no club
-- carries the flag WITH AN OWNER. ** This file does not touch
-- `complete_onboarding` ** — `114` stays its newest definition.
--
-- This file does three things:
--
--   1. Drops `not club.is_default` from the keep arm, so the welcome club's
--      third-party postcards are preserved exactly like any other club's.
--   2. ** Clears `is_default` in the same UPDATE that nulls the owner. ** A
--      preserved welcome club is an ORDINARY ownerless club from the moment it
--      is preserved: the state "carries `is_default` and has no owner" becomes
--      unreachable rather than merely guarded against.
--   3. Records the loss of the welcome club in `private.system_alerts`, because
--      a `raise warning` nobody reads was `059`'s own worst failure and is not
--      an answer to "the app now has no welcome club".
--
-- ---------------------------------------------------------------------------
-- §0. Why unflagging is the fix and not a tidy-up — three consequences
-- ---------------------------------------------------------------------------
--   * ** It is the third lock, and it is the only one that is structural. **
--     `107` §2a hides an ownerless club, §2b refuses the membership row, and
--     `114`'s predicate refuses the definer force-join. Unflagging removes the
--     SUBJECT of the force-join instead of guarding the door: `where c.is_default
--     and c.owner_id is not null` cannot match a row that no longer carries the
--     flag, whatever a later edit does to the second conjunct.
--   * ** It makes recovery possible at all. ** `clubs_one_default_club` (058) is
--     a partial UNIQUE index over the true rows, so while the dead club keeps
--     the flag NO replacement welcome club can be flagged. An operator would
--     have to unflag it by hand first, in a database whose only signal that
--     anything happened was a log line that expired a day later.
--   * ** It costs the ex-welcome club nothing. ** It is already invisible
--     (`107` §2a narrows the `is_public` arm with `owner_id is not null`),
--     already unjoinable (§2b), already uneditable and undeletable
--     (`auth.uid() = owner_id` is NULL, never TRUE), and its postcards are
--     already readable by their own authors alone. `is_default` bought it
--     nothing but the force-join. The audience of every preserved postcard moves
--     NARROWER — from "the club's members" to "its author" — which is `107`'s
--     whole security argument, now applying to one more club.
--
-- ** THE TWO REJECTED SHAPES, restated so they are not reached for again. **
--
--   * Hand the welcome club to a service or system account so it is never
--     ownerless. It needs a decision about what that account IS — an
--     `auth.users` row nobody signs in as, its erasure path, its appearance in
--     rosters — and this issue does not hold it. Not taken.
--   * Detach the welcome club's third-party postcards (`club_id = null`) and
--     delete the club. Rejected in `107` and still rejected: `club_id is null`
--     is the `postcards` SELECT policy's APP-WIDE arm, so detaching publishes
--     them to every signed-in rider. It is the exposure wearing the costume of
--     the fix, and it would need a new author-only column to be anything else.
--
-- ---------------------------------------------------------------------------
-- §0b. What this does NOT change, stated rather than discovered later
-- ---------------------------------------------------------------------------
--   * ** The keep arm keys on POSTCARDS alone ** — `107`'s scope, unchanged
--     here. A club (welcome or not) whose only third-party content is a
--     `club_threads` row still deletes, and the thread cascades with it.
--     `rls_test.sql` 081.16b is exactly that fixture and still reads 0 after
--     this file. Widening the arm to threads is a separate decision with its own
--     preservation semantics; it is named here rather than left to be found.
--   * ** No rider gains sight of anything. ** No policy, grant, view or column
--     in `public` moves in this file. The only new object is a table in
--     `private`, which PostgREST does not publish and `authenticated` has no
--     USAGE on (005).
--   * ** `complete_onboarding` is untouched. ** `114` is still its newest
--     definition, and this file deliberately does not restate it: re-creating a
--     100-line body to change nothing is how a `prosrc` reconciliation starts
--     reporting drift that is not there.
--
-- ---------------------------------------------------------------------------
-- §1. `private.system_alerts` — the absence is recorded, not merely warned
-- ---------------------------------------------------------------------------
-- ** The state this file makes reachable needs an operator action: flag a new
-- welcome club. ** Nothing else in the database can choose one — conscripting
-- some rider's public club into being the welcome club is the same mistake as
-- handing a departing owner's club to a stranger, which `107` rejected on the
-- owner's instruction.
--
-- A `raise warning` is not how that action gets started. Free-tier log retention
-- is about a day, the Management API caps a query at a 24-hour window, and
-- `scripts/db/logs-errors.mjs` reads REQUEST logs rather than Postgres severity
-- logs — so the warning `059` raises on every signup after the loss is
-- unreadable by anything in this repo and gone the next day. A row is not.
--
-- ** This table is not an audit trail and must not grow into one. ** It records
-- that a named, rare, operator-actionable event happened, with the club it
-- happened to, and no more. The CHECK is what keeps it that way: a new alert
-- key is a deliberate migration, which is also the review point at which
-- somebody would have to argue for putting a rider id in here.
--
-- ** IT HOLDS NO PERSONAL DATA, and that is why account deletion does not reach
-- it. ** `subject_id` is a CLUB id and never a rider id — the departing rider's
-- uid is not recorded, because the actionable fact is "the app has no welcome
-- club", not "who erased". Deliberately NO foreign key: the row outlives the
-- club it names (that is the point of an incident record), and an FK would
-- either cascade it away or block the deletion this function is performing.
-- RETENTION: indefinite, and stated rather than left silent — these rows are
-- operational records about the application, bounded by how many times the
-- welcome club can be lost, which is once per welcome club.
create table private.system_alerts (
  id uuid default uuid_generate_v4() primary key,
  -- Closed set, on purpose. See the header: this is the seam that keeps the
  -- table from becoming a free-text log.
  alert_key text not null
    constraint system_alerts_alert_key_known
    check (alert_key in ('welcome_club_kept_ownerless', 'welcome_club_deleted')),
  -- The CLUB the alert is about. Never a rider. Nullable because a future alert
  -- key may have no subject; no FK, deliberately — see the header.
  subject_id uuid,
  raised_at timestamptz default now() not null
);

-- `CLAUDE.md`: every new table gets RLS in the same migration, no exceptions.
-- It is belt and braces here rather than the barrier, and ** the barrier is not
-- the same one for the two kinds of role ** — measured on DEV rather than
-- assumed, because the natural sentence ("private has no USAGE for anyone") is
-- false for one of them:
--
--   has_schema_privilege('anon',         'private', 'usage')   -- f
--   has_schema_privilege('authenticated','private', 'usage')   -- f
--   has_schema_privilege('service_role', 'private', 'usage')   -- ** t **
--   has_table_privilege ('service_role', 'private.system_alerts', 'select') -- f
--   select rolbypassrls from pg_roles where rolname = 'service_role';       -- t
--
-- So for the two CLIENT roles the schema is the barrier and PostgREST publishes
-- `public` alone. For `service_role` the barrier is the absent TABLE grant and
-- nothing else — it holds USAGE on `private` and it BYPASSES RLS, so a row
-- security policy here would protect nothing from it. Supabase's default
-- privileges are set on `public`, which is why a table created in `private`
-- arrives with no grant for it: that is the mechanism `CLAUDE.md`'s
-- "a new table KEEPS its service_role grants" sentence is about, and this table
-- is outside its scope rather than an exception to it.
alter table private.system_alerts enable row level security;

-- Absolute rather than a delta: nothing in this schema is client-reachable and
-- this file should not depend on a default privilege to keep it that way. There
-- are no policies either, so even a re-grant reads nothing for a role that does
-- not bypass RLS.
revoke all on table private.system_alerts from public, anon, authenticated;

comment on table private.system_alerts is
  'Operator-actionable incidents the database raises about ITSELF (117, PD-398). ** NOT AN AUDIT TRAIL AND NOT A LOG **: one row per named, rare event that needs a human to do something, with a closed set of alert_key values enforced by a CHECK so a new kind of alert is a deliberate migration. ** IT HOLDS NO PERSONAL DATA ** — subject_id is a CLUB id and never a rider id, which is why account deletion does not reach this table and why it needs no retention sweep; RETENTION is indefinite. Today it has exactly one writer, private.transfer_owned_clubs, and exactly two keys: welcome_club_kept_ownerless (the club carrying clubs.is_default lost its last member while third-party postcards survived in it, so 117 kept it ownerless and TOOK THE FLAG BACK) and welcome_club_deleted (the same club had nothing third-party to protect and 032''s delete arm removed it). Either way the app now has NO welcome club and every completing rider joins nothing — 059''s warning still fires on each signup, and this row is what survives the day of log retention that warning does not. THE ACTION IS THE SAME FOR BOTH KEYS: flag a replacement club by hand (058 §6). Nobody reads this table from the app — PostgREST publishes public alone, anon and authenticated hold no USAGE on private, and there is no grant and no policy. service_role is the role the obvious sentence gets wrong: it DOES hold USAGE on private and it bypasses RLS, so what stops it is the absent table grant, which a table created in private gets by default because Supabase sets its default privileges on public. Read by the table owner at the dashboard. There is no scheduled reader and that gap is named in 117''s header rather than implied.';

comment on column private.system_alerts.subject_id is
  'The club the alert is about (117). ** NEVER A RIDER ID ** — see the table comment. No foreign key on purpose: the row must outlive the club it names, and an FK would cascade the record away with the very deletion that raised it.';

-- One row per welcome club, ever. The index is for the operator reading the
-- newest first, not for a hot path.
create index system_alerts_raised_at_idx
  on private.system_alerts (raised_at desc);

-- ---------------------------------------------------------------------------
-- §2. The keep arm covers the welcome club, and takes its flag back
-- ---------------------------------------------------------------------------
-- Body carried forward VERBATIM from `107` apart from four changes, so it stays
-- diffable against that file:
--
--   1. `not club.is_default and` is gone from the `elsif`.
--   2. `is_default = false` joins the keep arm's single UPDATE.
--   3. Each of the two no-successor arms records its alert when the club it
--      just disposed of was the welcome club.
--   4. The comments that described the exclusion are replaced rather than left
--      to contradict the code.
--
-- ** ONE `update`, STILL. ** `107`'s reason holds and now has a second clause
-- riding on it: row CHECKs are evaluated per statement, so nulling `owner_id`
-- in one statement and clearing `is_default` in another would put an
-- intermediate row through `clubs_default_club_is_public` (058) and through
-- `016`'s ownership path CHECK. `not is_default or is_public` happens to hold
-- for that intermediate row today — the welcome club is public by constraint —
-- which is exactly the kind of neighbouring guarantee `107` §3d refuses to rely
-- on. One statement has no intermediate row at all.
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
    -- favour of the next, rather than being misread as "no successor". It does
    -- NOT prevent selecting someone whose deletion starts a moment later — see
    -- 032 §3, which states that race rather than pretending it is closed.
    select m.user_id into successor
      from public.club_members m
      join public.profiles p on p.id = m.user_id
     where m.club_id = club.id
       and m.user_id <> departing
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
  'Hand every club this rider owns to its longest-tenured remaining admin, else its longest-tenured remaining member (029/032). ** 107: when no member remains, the club is KEPT with owner_id NULL if any postcard in it was authored by somebody else, and deleted only when there is nothing third-party to protect. 117 (PD-398) EXTENDS THAT ARM TO THE WELCOME CLUB and clears clubs.is_default in the same statement that nulls the owner ** — 107 excluded it because complete_onboarding force-joins every new rider to clubs.is_default through a security definer path no policy governs; 114 carries 107 §4b''s `and c.owner_id is not null` on that join, and taking the flag back removes the subject of the force-join rather than guarding the door, and frees the partial unique index so a replacement welcome club can be flagged at all. Either no-successor arm writes private.system_alerts when the club it disposed of carried the flag, because the app then has NO welcome club and only an operator can choose the next one. THE ARM STILL KEYS ON POSTCARDS ALONE: a club whose only third-party content is a club_threads row still deletes. Returns the Storage object paths it surrendered so the caller can delete the bytes. Exists so one rider erasing their account does not destroy other riders'' postcards through the clubs -> postcards cascade — which 029 §2 believed impossible on a premise (a memberless club''s postcards are "entirely their own by construction") that is false, because nothing removes a postcard when its author leaves a club. security definer because it rewrites rows across three tables under nobody''s ownership; in `private` so PostgREST never publishes it.';

-- `private` has no USAGE for `authenticated` (005), so this is belt and braces —
-- and belt and braces is the point for a function that deletes clubs. Restated
-- because `create or replace` preserves grants and this file should not depend
-- on that.
revoke all on function private.transfer_owned_clubs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- §3. Verification
-- ---------------------------------------------------------------------------
-- Hand-exercised on DEV, as the owner, inside transactions that were rolled
-- back — `CLAUDE.md`'s rule for a change to an already-shipped write path. It
-- runs against the LIVE welcome club rather than a fixture: DEV's five
-- club-attached postcards are all in it, and its own owner authored every one
-- of them, so the third-party postcard has to be staged inside the transaction.
--
-- ** Measured 2026-09-18, in this order. ** The baseline is the half that says
-- the defect was real rather than theoretical:
--
--   A. BASELINE, against the function as `107` left it — a flagged club whose
--      owner is its only member, holding one postcard by somebody else:
--        club rows after the transfer ................... 0   (deleted)
--        that third party's postcard .................... 0   (destroyed)
--
--   B. THE LIVE SHAPE, after this file applied — the welcome club's nine other
--      memberships deleted (everybody left), ONE of its five postcards
--      re-attributed to a rider who is not the owner, then the transfer and the
--      `profiles` cascade in the order `delete-account` uses:
--        club rows ...................................... 1   (kept)
--        owner_id is null ............................... t
--        is_default ..................................... f   ** the fix **
--        clubs carrying the flag, anywhere .............. 0
--        the third party's postcard ..................... 1   (preserved)
--        the departing owner's own four .................. 0   (profiles cascade)
--        members ........................................ 0
--        private.system_alerts ......... welcome_club_kept_ownerless, one row
--
--   C. THE DELETE ARM, the same transaction with NOTHING third-party staged:
--        club rows ...................................... 0   (032's arm, unchanged)
--        private.system_alerts ......... welcome_club_deleted, one row
--
--   D. THE SUCCESSOR ARM, which this file does not touch — the welcome club
--      with its ten memberships intact:
--        club rows 1 · is_default t · owner changed t · alerts 0 · 2 paths
--
--   Every one of the four rolled back, and DEV was re-read afterwards: one
--   flagged club, same owner, 5 postcards, 10 members, 30 profiles, and zero
--   rows in private.system_alerts.
--
-- After applying, confirm the object rather than the statement:
--
--   select prosecdef, proconfig, prosrc like '%is_default       = false%'
--     from pg_proc where oid = 'private.transfer_owned_clubs(uuid)'::regprocedure;
--   -- t | {search_path=""} | t
--
-- ** AND THE COMMENT TRAP, WHICH THIS FILE WALKED INTO ONCE BEFORE IT APPLIED. **
-- The obvious check for "the exclusion is gone" is the wrong one, because the
-- comment six lines above the `elsif` QUOTES the clause it removed, and
-- `prosrc` carries a function's comments:
--
--   select prosrc like '%not club.is_default%' from pg_proc
--    where oid = 'private.transfer_owned_clubs(uuid)'::regprocedure;
--   -- ** t **, and it was t before this file too. Proves nothing.
--
--   select prosrc like '%elsif not club.is_default%' as excludes_welcome_club,
--          prosrc like '%elsif exists (%'           as arm_is_unconditional
--     from pg_proc where oid = 'private.transfer_owned_clubs(uuid)'::regprocedure;
--   -- f | t  — measured on DEV 2026-09-18. Both halves, because either one
--   --          alone stays green if the arm is rewritten in another shape.
--
-- The standing health question, which is what an operator asks after an alert:
--
--   select count(*) from public.clubs where is_default and owner_id is not null;
--   -- 1. Anything else means every completing rider is joining nothing.
--
--   select alert_key, subject_id, raised_at
--     from private.system_alerts order by raised_at desc;
--
-- ** THERE IS NO SCHEDULED READER FOR THAT TABLE, and this file does not
-- pretend otherwise. ** The two candidates both sit outside the database: the
-- log digest workflow (`.github/workflows/log-digest.yml`) reads the Management
-- API, which no build container can reach, and a CI health probe needs database
-- credentials CI does not have while PD-371 stands. The row is what makes either
-- one a ten-line change when it is decided; the alternative was a warning that
-- expires in a day.
