-- 089 — A declined rider is told, and a private club's avatar is readable.
--       PD-335, the two decisions PD-325 deferred to the product owner.
-- ===========================================================================
--
-- Product owner, 2026-08-28: *"C declined rider gets told yet. D yes, avatars
-- can be seen."* Both halves of `085` that shipped on a stated default are now
-- decided, and both decisions reverse the default.
--
-- ===========================================================================
-- PART 1 — THE DECLINE IS TOLD, WITHOUT NAMING WHO REFUSED AND WITHOUT
--          COLLAPSING TWO CLUBS INTO ONE ROW
-- ===========================================================================
--
-- `085` wrote no decline notification, and `085.26` asserts that zero with the
-- reason: `036` §3's SELECT policy conjuncts
--
--   club_id is null or exists (select 1 from public.clubs scl where scl.id = …)
--
-- under the READER's own row security, and a declined requester holds no
-- `club_members` row for a private club. A decline notification carrying the
-- club would be written, never returned and never counted — silently, for
-- ever, looking correct to every reviewer and to every test that only checks
-- the row was inserted.
--
-- **Two ways round that were written up in PD-335 and NEITHER is what this
-- file does.** Both were put to the owner as costs, and being told a cost is
-- not approving it:
--
--   * **B, a subject-less notification** ("X declined your request", club_id
--     NULL). It names the ADMIN who refused — the one fact `085` refused a
--     `responded_by` column in order to withhold — and it is **lossy**:
--     `036`'s `notifications_event_key` is unique over
--     `(user_id, type, actor_id, postcard_id, comment_id, ride_id, club_id)`
--     with `NULLS NOT DISTINCT`, so with every subject NULL two declines from
--     two different clubs by the same admin collapse to ONE row and the second
--     is dropped with no error.
--   * **C, widening `036` §3's club conjunct**, or putting an arm for a live
--     request on `clubs` SELECT. The first makes EVERY `club_id`-carrying
--     notification resolve for any non-member holding one. The second is worse
--     than it looks: `clubs` SELECT is also what `016`'s two storage policies
--     delegate to, so an arm there ships the club's COVER as well — which the
--     owner explicitly excluded in the same sentence that admitted the avatar
--     ("The cover image is not included").
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES INSTEAD, AND WHY IT IS NOT C
-- ---------------------------------------------------------------------------
-- Three moves, and each one closes exactly one of the three objections:
--
-- **1. The club stays the subject, so nothing collapses.** `club_id` is set to
--    the club, exactly like `club_joined` and `085`'s two types, so the event
--    key is per club and two declines from two clubs are two rows by
--    construction rather than by luck.
--
-- **2. The ACTOR is the requester themselves, so nothing is disclosed.**
--    `notifications.actor_id` is NOT NULL and the recipient reads it — the
--    list embeds `actor:profiles!actor_id(...)` — so ANY other rider in that
--    column tells the requester something. The declining admin is the exact
--    disclosure `085` refused a column for. The club's OWNER would be a false
--    attribution (they may not have pressed anything) and still a disclosure
--    (`discoverable_private_clubs` deliberately does not return an owner). The
--    requester's own id is the only value that says nothing the reader does
--    not already know, and it is not a dead column: it is what makes this row
--    non-disclosing BY CONSTRUCTION rather than by the client choosing not to
--    render it. `089.4` asserts `user_id = actor_id` for this type, because a
--    client-side omission is a promise and a column value is a guarantee.
--
--    **A club refuses as a club**, which is also how it draws: the client puts
--    the club's name and avatar where every other row puts the actor's, so the
--    sentence reads "<Club> declined your request to join." with no rider in
--    it at all.
--
-- **3. ONE type-scoped disjunct on the club conjunct — not a widening of it.**
--
--      or (type = 'club_join_request_declined'
--          and private.club_takes_join_requests(notifications.club_id))
--
--    This is what makes it not C. Gated on the type, so no other
--    `club_id`-carrying notification resolves one row differently than it did
--    yesterday; and `clubs` SELECT, `private.can_read_club` and both `016`
--    policies are untouched by it, so nothing outside this table moves.
--    `089.2` pins `clubs` SELECT unchanged, exactly as `085.1` did.
--
--    **It is faithful to what the conjunct is FOR.** That conjunct asks "does
--    this row's subject resolve for this reader" — and for a declined
--    requester the club genuinely does resolve, through
--    `public.discoverable_private_clubs`, which `085` built as the one path by
--    which a non-member reads a private club. `085` is explicit that a
--    declined rider is deliberately NOT excluded from
--    `private.club_takes_join_requests` ("A DECLINED rider is deliberately NOT
--    excluded here"), which is precisely what makes this disjunct true for
--    them and false for everybody else.
--
--    Two consequences worth stating rather than discovering:
--      * if the club later becomes PUBLIC, the disjunct goes false and the row
--        stops being returned — `club_takes_join_requests_for` requires
--        `is_public = false`. That is the right answer, not a bug: the rider
--        can simply join, and the refusal no longer describes anything they
--        cannot undo.
--      * if either party BLOCKS the other, the disjunct goes false and the row
--        disappears, on top of the policy's own `is_blocked` conjunct. Also
--        right, and it is decision #2 arriving twice.
--
-- ---------------------------------------------------------------------------
-- THE TRAP IN THE RETRACTION, WHICH IS THE THING MOST LIKELY TO BE "TIDIED"
-- ---------------------------------------------------------------------------
-- `085`'s `private.retract_club_join_requested` already deletes by
-- `(type, actor_id, club_id)` and this new row shares its `actor_id`
-- (`old.user_id`) and its `club_id`. **Extending that function to cover both
-- types instead of adding a second one would delete this notification in the
-- same statement that writes it.** `087` hung it on the status transition, and
-- triggers on one event fire in NAME order:
-- `notify_club_join_request_declined` < `retract_club_join_requested_on_answer`
-- — so the write lands first and the widened retraction would take it straight
-- back out, leaving `085.26`'s zero standing and this whole change inert with
-- nothing red.
--
-- So the retraction here is its OWN function on its OWN trigger, and it fires
-- on DELETE only — which is the admin clearing a declined row (`085`'s "you
-- may ask again" affordance, whose surface is `088`'s Manage riders screen).
-- A rider who may ask again must not still be holding the refusal.
--
-- ---------------------------------------------------------------------------
-- ORDERING AND COST
-- ---------------------------------------------------------------------------
-- ** ADDITIVE IN SCHEMA AND STILL DESTRUCTIVE-LAST. ** This is the one place
-- the usual rule inverts, and the reason is in the CLIENT rather than in the
-- SQL. `notificationCopy` and `NotificationsListItem`'s `describe` are
-- EXHAUSTIVE switches over `NotificationType` with no `default` — which is
-- deliberate, because it is what makes TypeScript refuse a new type that
-- nobody has written a sentence for. At runtime it means an unknown type
-- returns `undefined` from `describe`, and the call site destructures it:
--
--   const { href, trailing } = describe(row)   // TypeError on undefined
--
-- So ONE decline landing in the window between this file applying and the new
-- bundle serving takes the whole notifications screen down for the rider it
-- addresses — and that rider is, by construction, the one this change exists
-- to tell.
--
-- **So `089` applies AFTER the deploy is confirmed serving**, on `070`'s and
-- `077`'s footing rather than `069`'s. "Merged" is not "deployed": confirm
-- `app-dev.letsride.social` (or the Preview alias) is on the promotion sha
-- before applying. `088` is genuinely additive and goes before.
--
-- The same change gives both switches a total fallback so the NEXT type has no
-- such window — but that is the new bundle's property and cannot rescue the one
-- already serving, which is exactly why the ordering is what it is rather than
-- the fallback being.
--
-- **`036`'s hand-exercise gate DOES fire.** This hangs two triggers on
-- `club_join_requests`, and one of them is on the DECLINE path, which is live
-- on DEV — so from the moment it applies, every decline runs new code inside
-- the admin's own transaction and a raise there takes their decline down with
-- it. Exercise a decline and a clear by hand on DEV, in a rolled-back
-- transaction, before applying to PROD.
--
-- **No new advisor.** Both new functions live in `private`, which PostgREST
-- does not publish, so the count stays where `088` left it — **24**, measured
-- on DEV with `088` applied: 21 `authenticated_security_definer_function_executable`,
-- 2 `rls_enabled_no_policy` and the leaked-password toggle.

-- ---------------------------------------------------------------------------
-- §1. The type, and its subject shape
-- ---------------------------------------------------------------------------
-- BOTH constraints in one block, on `085` §5.3's shape and for the reason
-- `036` gives: the flat list says which strings are legal, the shape says
-- which subject columns each carries, and a type in the first with no arm in
-- the second falls to `else false` and is refused on its first insert.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined',
             'club_join_requested', 'club_join_request_approved',
             'club_join_request_declined')
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
      -- The same shape as the two above and as club_joined — club_id ALONE.
      -- `085` chose that shape so no policy change was needed; this type keeps
      -- it and changes the policy anyway, because what moved is not the SHAPE
      -- but WHO the club resolves for. Keeping the shape is what makes the
      -- policy edit one disjunct instead of a fifth conjunct.
      when 'club_join_request_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- §2. The two policies — the SAME edit, three times
-- ---------------------------------------------------------------------------
-- `036` §4 requires the SELECT `using`, the UPDATE `using` and the UPDATE
-- `with check` to be TEXTUALLY IDENTICAL, and the suite asserts it, because
-- **no write path may reach a row no read path returns**: a wider UPDATE turns
-- "mark all read" into a disclosure channel, since the affected-row count is a
-- number the rider can compare against the list they were just shown.
--
-- So the disjunct below is pasted three times, unchanged. Do not "simplify"
-- one of them.
drop policy "Notifications are readable only by their recipient" on public.notifications;
drop policy "Riders mark only their own readable notifications read" on public.notifications;

create policy "Notifications are readable only by their recipient"
  on public.notifications for select to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id)))
  );

create policy "Riders mark only their own readable notifications read"
  on public.notifications for update to authenticated
  using (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id)))
  )
  with check (
    user_id = auth.uid()
    and not private.is_blocked(auth.uid(), actor_id)
    and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
    and (postcard_id is null or exists (select 1 from public.postcards sp where sp.id = notifications.postcard_id))
    and (comment_id is null or exists (select 1 from public.postcard_comments sc where sc.id = notifications.comment_id))
    and (ride_id is null or exists (select 1 from public.rides sr where sr.id = notifications.ride_id))
    and (club_id is null
         or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)
         or (type = 'club_join_request_declined'
             and private.club_takes_join_requests(notifications.club_id)))
  );

comment on column public.notifications.actor_id is
  'The rider the notification is ABOUT, read live and never snapshotted. Exactly one type sets it to the RECIPIENT themselves — club_join_request_declined (089) — and that is the whole of how a decline is told without naming who refused: notifications.actor_id is readable by its recipient through the list''s own profiles embed, so any other rider in this column discloses something. A club refuses as a club, and the client draws the club where every other row draws the actor. 089.4 asserts user_id = actor_id for that type, because a client that declines to render a column is a promise and a column value is a guarantee.';

-- ---------------------------------------------------------------------------
-- §3. The fan-out, and its retraction
-- ---------------------------------------------------------------------------
-- Trap (a), `085` §5.4's first: NO `current_user` guard. Every GATE trigger in
-- this repo carries `when (current_user = 'authenticated')`, and copying it
-- onto a fan-out whose only writer is a `security definer` RPC disables it
-- silently — which is the bug `087` exists to fix, arriving by a third route.
-- The `when` below is on the TRANSITION and on nothing else.
create or replace function private.notify_club_join_request_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Recipient and actor are the SAME rider, deliberately. See §2's column
  -- comment: any other actor tells the requester something, and the one thing
  -- `085` refused a `responded_by` column to withhold is which admin refused.
  --
  -- No per-recipient `can_read_club` guard, unlike `notify_club_join_requested`
  -- — that helper restates `clubs` SELECT, which is exactly the predicate this
  -- type's row is NOT resolved by. §2's disjunct is the readability check for
  -- this row, and `private.club_takes_join_requests_for(new.user_id, …)` was
  -- true a moment ago or there would have been no request to decline.
  --
  -- `on conflict do nothing` on `085`'s own reasoning: the event key
  -- (requester, type, requester, club) is stable, and a club that clears a
  -- refusal, is asked again and refuses again would otherwise raise a bare
  -- 23505 from inside the admin's decline and take their write down with it.
  insert into public.notifications (user_id, actor_id, type, club_id)
  values (new.user_id, new.user_id, 'club_join_request_declined', new.club_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_club_join_request_declined
  after update of status on public.club_join_requests
  for each row
  -- The transition, never the value: an UPDATE that leaves `status` where it
  -- was must notify nothing. `is distinct from` rather than `<>` for `087`'s
  -- reason — either side could be NULL to a future writer even though the
  -- column is NOT NULL today.
  when (new.status = 'declined' and old.status is distinct from new.status)
  execute function private.notify_club_join_request_declined();

-- ** ITS OWN FUNCTION, AND THE HEADER SAYS WHY IN FULL. ** Widening
-- `085`'s `private.retract_club_join_requested` to cover this type instead
-- would delete this row in the same transaction that writes it, because `087`
-- put that function on the status transition too and `n` sorts before `r`.
create or replace function private.retract_club_join_request_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- DELETE only — the admin clearing a refused row, which is `085`'s "you may
  -- ask again" affordance and `088`'s surface. A rider who may ask again must
  -- not still be holding the refusal.
  --
  -- No `when` clause on the trigger, so this also runs for a withdrawal, an
  -- approval and a cascade — each of which matches zero rows here, because the
  -- scope carries the type. Bounded and redundant rather than wrong, exactly
  -- as `085`'s own retraction is.
  --
  -- Scoped by `user_id` as well, which `085`'s is not: that one retracts a
  -- FAN-OUT addressed to every admin, and this one addresses exactly one
  -- rider, so the recipient is part of this event's key rather than a
  -- narrowing of it.
  delete from public.notifications n
   where n.type = 'club_join_request_declined'
     and n.user_id = old.user_id
     and n.actor_id = old.user_id
     and n.club_id = old.club_id;
  return null;
end;
$$;

create trigger retract_club_join_request_declined
  after delete on public.club_join_requests
  for each row execute function private.retract_club_join_request_declined();

revoke all on function private.notify_club_join_request_declined() from public, anon, authenticated;
revoke all on function private.retract_club_join_request_declined() from public, anon, authenticated;

comment on function private.notify_club_join_request_declined() is
  'Fan-out of one: a decline tells the requester, and nobody else (089, PD-335). Recipient and actor are BOTH new.user_id — the requester — which is what tells them without naming the admin who refused; the client draws the club in the actor''s place. Carries club_id, so 036''s event key is per club and two declines from two clubs are two rows rather than one collapsed one. Readable through 089 §2''s type-scoped disjunct, which resolves the club through private.club_takes_join_requests rather than through clubs SELECT — 085 deliberately does not exclude a declined rider from that helper, which is the property this depends on.';
comment on function private.retract_club_join_request_declined() is
  'Retraction: an admin CLEARING a declined request removes the refusal notification with it (089), so a rider who may ask again is not still holding the "no". Its own function rather than a widening of 085''s retract_club_join_requested, and that is load-bearing: 087 put that one on the status transition too, triggers fire in name order, and n < r — so a widened version would delete this row in the same transaction that writes it, leaving the change inert with nothing red. Scoped by user_id as well as type, actor_id and club_id, because this event addresses one rider rather than a club''s whole admin set.';

-- ===========================================================================
-- PART 2 — A PRIVATE CLUB'S AVATAR IS READABLE
-- ===========================================================================
--
-- Written out in advance at
-- `openspec/changes/show-private-clubs-and-request-to-join/design.md`
-- §The avatar that will not sign, so this is the edit that file described
-- rather than a new design.
--
-- `016`'s policy delegates to `clubs` SELECT, so for a private club a
-- discoverer reads nothing, `signImagePaths` returns null, and the card draws
-- initials. `085.6` pins that behaviour, which is why this change replaces
-- that assertion rather than merely adding one.
--
-- **The accepted cost, restated because the owner accepted it explicitly:**
-- every private club's avatar OBJECT becomes readable to every signed-in rider
-- who is not blocked with its owner. That is the same audience the club's
-- name, town and member count already reach through
-- `discoverable_private_clubs`, so it is consistent — but it is bytes rather
-- than a string, and `storage.objects` is the table this repo has been most
-- careful with.
--
-- **The COVER is deliberately not included.** Product owner, same sentence: an
-- avatar is the club's identity and a cover is its content. `089.8` asserts
-- the covers policy is byte-for-byte unchanged, because the obvious tidy-up is
-- to apply the same arm to both.
-- ** THE PRE-WRITTEN ARM DOES NOT WORK, AND IT FAILS SILENTLY. ** design.md's
-- block is `or exists (select 1 from public.clubs c where … and
-- private.club_takes_join_requests(auth.uid(), c.id))`, and it is wrong twice:
--
--   1. `club_takes_join_requests` is the ONE-argument wrapper; the two-argument
--      form is `..._for`, which `085` revokes from `authenticated`. A
--      storage.objects policy runs as the querying role, so the literal block
--      raises 42501 on every club-avatar read for every rider.
--   2. **The one that matters.** That `exists` reads `public.clubs` UNDER THE
--      READER'S OWN RLS — which is the entire reason `016`'s second disjunct
--      fails for a private club in the first place. Adding a conjunct INSIDE a
--      subquery that already returns zero rows changes nothing at all: the
--      policy compiles, the suite goes green if its fixture cannot observe the
--      answer, and the card still draws initials.
--
-- So the club lookup has to happen somewhere RLS does not apply, which means a
-- `security definer` helper rather than an inline `exists`. It is
-- caller-relative — it reads `auth.uid()` itself and takes no subject — for
-- `085` §2's reason: the subject-taking form would be a membership and block
-- oracle for any pair, and this one answers only about the caller.
--
-- It discloses nothing the policy does not: it returns true for exactly the
-- object paths the policy is about to return, so a caller who probes it learns
-- what a `select` would have told them anyway.
create or replace function private.club_avatar_is_discoverable(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.avatar_path = object_name
       -- The owner-folder binding, restated rather than inherited — 010 §2's
       -- line and 016's second lock on the same door. Without it, attaching a
       -- VICTIM's object path to a club you own would make that object readable
       -- to everyone who can discover the club.
       and (storage.foldername(object_name))[2] = c.owner_id::text
       and private.club_takes_join_requests_for((select auth.uid()), c.id)
  );
$$;

revoke all on function private.club_avatar_is_discoverable(text) from public, anon;
grant execute on function private.club_avatar_is_discoverable(text) to authenticated;

comment on function private.club_avatar_is_discoverable(text) is
  'Is this storage object path the avatar of a private club the CALLER may discover (089, PD-335)? Exists because 016''s policies read public.clubs under the reader''s own RLS, so an inline conjunct on a subquery that already returns zero rows for a private club would change nothing and go green. Caller-relative and takes no subject, on 085 §2''s rule: the subject-taking form would be a membership and block oracle for any pair. Answers only about the caller, and only what the policy it feeds is about to return anyway. In `private`, so PostgREST never publishes it and it adds no advisor.';

drop policy "Club avatars are readable with the club" on storage.objects;

create policy "Club avatars are readable with the club"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'club-avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.clubs c
        where c.avatar_path = storage.objects.name
          and (storage.foldername(storage.objects.name))[2] = c.owner_id::text
      )
      -- The third disjunct — 089, PD-335. A definer helper rather than a
      -- fourth inline `exists`, for the reason written out above it: the two
      -- disjuncts beside this one read `clubs` under the reader's RLS, which
      -- is exactly what a private club refuses. The helper carries the
      -- owner-folder binding itself.
      or private.club_avatar_is_discoverable(storage.objects.name)
    )
  );

-- ---------------------------------------------------------------------------
-- §4. Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
--   -- The three expressions stay textually identical (036 §4).
--   select count(distinct e) from (
--     select qual as e from pg_policies
--      where schemaname='public' and tablename='notifications' and cmd='SELECT'
--     union all
--     select qual from pg_policies
--      where schemaname='public' and tablename='notifications' and cmd='UPDATE'
--     union all
--     select with_check from pg_policies
--      where schemaname='public' and tablename='notifications' and cmd='UPDATE'
--   ) t;
--   -- 1
--
--   -- The policy this change exists NOT to touch. Capture before and after.
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='clubs' and cmd='SELECT';
--   -- 4299c23bc61a3b5f53c580631cdf941c   (unchanged by 085, and by 089)
--
--   select count(*) from pg_trigger
--    where tgrelid = 'public.club_join_requests'::regclass and not tgisinternal;
--   -- SIX: enforce_participation_gate, notify_club_join_requested,
--   --      notify_club_join_request_declined, retract_club_join_requested,
--   --      retract_club_join_requested_on_answer,
--   --      retract_club_join_request_declined.
--
--   select count(*) from pg_trigger
--    where tgrelid = 'public.club_join_requests'::regclass and not tgisinternal
--      and tgqual is not null;
--   -- THREE, up from 087's two: the gate's current_user guard, 087's status
--   -- transition, and 089's notify transition. The two DELETE-arm retractions
--   -- must never acquire one.
--
--   select count(*) from pg_policies where schemaname = 'storage'
--     and tablename = 'objects' and policyname like 'Club %';
--   -- 6 — UNCHANGED. This file replaces one avatar policy and creates none.
--
--   -- Advisors: 24, UNCHANGED by this file. Both of its functions are in
--   -- `private`, which PostgREST does not publish. 21 of the 24 are the
--   -- definer-executable WARN, and `088` is what took that from 18 to 21.
