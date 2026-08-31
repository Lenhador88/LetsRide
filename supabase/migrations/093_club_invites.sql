-- 093 — Share a public club, invite to a private one (PD-360, under PD-299)
-- ===========================================================================
--
-- Product owner, 2026-08-31: *"299, it seems like we should have share club if
-- its public, and invite if its private? Both should be workable within the app
-- and external (for eg. whatsapp link)."*
--
-- Proposal: openspec/changes/invite-riders-to-a-club/. `091` (PD-330) is the
-- built precedent for the token half and `085` (PD-325) for the club half; this
-- file is the two of them meeting, with one new rule of its own (§2a).
--
-- ---------------------------------------------------------------------------
-- ⚠ ONE DEFECT IN THE SPECIFIED DESIGN, MEASURED DURING PRE-FLIGHT AND FIXED
--   HERE RATHER THAN BUILT AROUND — see §3d
-- ---------------------------------------------------------------------------
-- tasks.md 3.4 specifies `private.enforce_club_invite_is_admissible()` as an
-- unconditional BEFORE INSERT trigger raising `check_violation` whenever the
-- invitee is inadmissible, *"because the policy cannot ask an invitee-side
-- question without granting an oracle"*. Written that way it IS the oracle.
--
-- ** A BEFORE ROW TRIGGER FIRES BEFORE THE RLS `WITH CHECK` EXPRESSION IS
-- EVALUATED. ** Measured on Postgres 17, 2026-08-31, on a scratch database: a
-- table with `with check (false)` and a BEFORE INSERT trigger that raises
-- returns the TRIGGER's 23514, never the policy's 42501. So an unauthorised
-- rider — any signed-in rider at all, member of nothing — could attempt an
-- insert naming any private club and any rider and read the answer off the
-- SQLSTATE: 23514 means "that rider is already a member / is the owner / has a
-- pending request", 42501 means "they are not". That is a membership oracle for
-- the whole private social graph, reachable by URL, in the one file whose
-- purpose is to keep private club membership private.
--
-- ** The fix is the first statement of the trigger body: if the CALLER has no
-- authority to invite into this club at all, the trigger says nothing and
-- returns, and the INSERT policy refuses them a statement later with 42501. **
-- The 23514 is then reachable only by a rider who may already read that club's
-- roster and its join requests through `085`'s own policies, so it discloses
-- nothing they did not have. Every case tasks.md 6.2 names is performed by such
-- a rider and still gets its 23514; `093.20` is the oracle detector, and it
-- compares the two refusals as STRINGS rather than by SQLSTATE.
--
-- ---------------------------------------------------------------------------
-- PRE-FLIGHT, MEASURED 2026-08-31 — the numbers this file's correctness rests
-- on, and what each one was read off
-- ---------------------------------------------------------------------------
-- Read live off DEV (fpmrimzxadewsaiwpsel) AND PROD (zwprydcyryvudhurbnye).
-- The two projects are byte-identical on every policy below.
--
--   * `clubs` SELECT       md5(qual) 4299c23bc61a3b5f53c580631cdf941c  — MUST NOT MOVE
--   * `club_members` SELECT md5(qual) 9d075352246e30fe8dcdd2da25669518 — MUST NOT MOVE
--   * `notifications` SELECT using   28ab04505c62f16147539f78b521a858 } all THREE
--   * `notifications` UPDATE using   28ab04505c62f16147539f78b521a858 } move, in
--   * `notifications` UPDATE with check 28ab04505c62f16147539f78b521a858 } §5.2
--
-- ** THE PROPOSAL SAYS "BOTH POLICIES MOVE, NOT ONE". IT IS THREE EXPRESSIONS,
-- NOT TWO. ** `pg_policies.with_check` on the UPDATE policy carries the same
-- md5 as its `qual`, because `036` §4 requires the SELECT `using`, the UPDATE
-- `using` and the UPDATE `with check` to be TEXTUALLY IDENTICAL — no write path
-- may reach a row no read path returns, or "mark all read" becomes a disclosure
-- channel through its affected-row count. `089` pasted its disjunct three times
-- and said so; this file pastes its own three times for the same reason. Do not
-- "simplify" one of them.
--
--   * participation-gate triggers: 17 on DEV and 17 on PROD, 19 in the local
--     suite, because `092` is on disk and unapplied to either project. ** THE
--     ASSERTION IS THE DELTA OF +2 AND THE TWO TABLE NAMES, NEVER THE
--     ABSOLUTE. ** `093.24`.
--   * `comment on function public.enforce_participation_gate()` re-read LIVE on
--     DEV rather than off any document — it says `seventeen` there and
--     `nineteen` in `092` on disk, and last writer wins on that string. This
--     file restamps it to TWENTY-ONE, continuing `092`'s enumeration.
--   * security advisors on DEV: 27 — 24 `authenticated_security_definer_
--     function_executable`, 2 `rls_enabled_no_policy`, 1
--     `auth_leaked_password_protection`. Expect 33 after this applies: SIX new
--     definer WARNs, one per new `public` function. The FOURTEEN new `private`
--     helpers add NONE, PostgREST not publishing that schema. A seventh means a
--     revoke did not land or something landed in `public` that belongs in
--     `private`.
--   * `notifications_type_check` and `notifications_subject_shape` both name
--     ELEVEN types; §5.1 takes both to THIRTEEN, in one block.
--   * `notifications_event_key` is unique over (user_id, type, actor_id,
--     postcard_id, comment_id, ride_id, club_id) with NULLS NOT DISTINCT —
--     which is why both new types carry `club_id` rather than being
--     subject-less.
--   * `club_members` column grants for `authenticated`: INSERT and UPDATE both
--     over `(club_id, role, user_id)`, SELECT over those plus `joined_at`. So
--     §1c's new column is unwritable by every client the moment it exists,
--     inherited rather than declared.
--   * `pgcrypto` is installed in `extensions` on both projects, so §1's
--     `create extension if not exists` is a no-op there.
--
-- ** ONE CLAIM IN `085`'s OWN HEADER IS STALE AND THIS FILE DOES NOT INHERIT
-- IT. ** `085` justifies refusing an approval into an owner-block with *"club_
-- members SELECT carries no block predicate, so the two would then appear on
-- each other's roster."* It does carry one, identically on both projects:
-- `(is_club_member OR EXISTS public club) AND (user_id = auth.uid() OR NOT
-- is_blocked(auth.uid(), user_id))`. The RULE `085` states is still right and
-- this file keeps it; only its stated reason has expired. The surviving reason
-- is larger than the roster: a membership admits a rider to the club's threads,
-- messages, rides and timeline, which is the shared space decision #2 exists to
-- keep two blocked riders out of.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING: additive in schema, and NOT inert
-- ---------------------------------------------------------------------------
-- Two reasons, and `036`'s hand-exercise gate covers both:
--
--   1. §5.2 REPLACES TWO LIVE POLICIES on `notifications`, a table every screen
--      reads. From the moment this applies, every rider's notifications list is
--      answered by a new expression.
--   2. `private.notify_club_joined` fires `after insert on club_members` with
--      NO `when` clause, so from the moment this applies it runs inside
--      `private.join_club_from_invite` — and a trigger that raises takes a
--      rider's accept or claim down with it. That is `085`'s own hazard, one
--      path over.
--
-- ** ITS ORDERING IS `089`'s, NOT `069`'s: THE BUNDLE SERVES FIRST AND THIS
-- FILE APPLIES AFTER. ** It is additive in SCHEMA and its ordering constraint
-- is in the CLIENT — two notification types arrive, and `notificationCopy` and
-- `NotificationsListItem`'s `describe` are exhaustive switches, so one
-- `club_invited` row landing while an older bundle is serving takes that
-- rider's notifications screen down.
--
-- Rollback, IN THIS ORDER:
--   1. drop the two fan-out triggers, then their functions
--      (notify_club_invited, notify_club_invite_declined);
--   2. drop the six public RPCs — revoke_club_invite_link,
--      claim_club_invite_link, club_invite_link_preview, my_live_club_invites,
--      decline_club_invite, accept_club_invite;
--   3. drop private.join_club_from_invite;
--   4. drop private.club_invite_link_reachable_by, then
--      private.live_club_invite_link (the second is called by the first);
--   5. drop the admissibility trigger and its function, then the remaining
--      helpers — has_live_club_invite, has_live_club_invite_for,
--      club_invite_is_answerable_for, club_takes_invites_for,
--      may_mint_club_link, may_mint_club_link_for, may_invite_to_club,
--      may_invite_to_club_for;
--   6. delete from public.notifications where type in ('club_invited',
--      'club_invite_declined')  -- BEFORE step 7, because the narrowed
--      notifications_type_check is validated against existing rows and one live
--      row of either type makes the `add constraint` fail (`092`'s step 3);
--   7. restore BOTH notifications policies and BOTH CHECKs to the form `092`
--      left — TWELVE types, `089` §2's policies verbatim plus `092`'s
--      `club_waved`. ** Not `089`'s eleven: ** `092` lands ahead of this file
--      and a rollback to eleven would drop its type as silently as this file
--      would have if it had not carried it forward;
--   8. drop public.club_members.invite_link_id and its index;
--   9. drop public.club_invite_links;
--  10. drop public.club_invites last;
--  11. restore the `nineteen` comment on public.enforce_participation_gate().
-- Dropping a table first leaves a helper referencing a missing relation.
--
-- ---------------------------------------------------------------------------
-- WHAT A TOKEN BUYS, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------------
-- ** This change adds NO audience arm to `clubs` SELECT and does not touch
-- `private.can_read_club` or `public.discoverable_private_clubs`. ** `085`'s
-- reasoning holds unchanged: an arm on `clubs` SELECT also moves `016`'s two
-- `storage.objects` policies and `036` §3's notifications conjunct, neither of
-- which any migration would mention. `093.16` pins both by equality and a
-- failure there means this file is wrong rather than that the pin is stale.
--
-- Possession of a live club token permits exactly two RPC calls:
--
--   * `public.club_invite_link_preview(t)` — SIX named columns of exactly one
--     club. No roster, no rider ids, no description, no cover, no owner, no
--     age, no coordinates.
--   * `public.claim_club_invite_link(t)` — joins that one club, and nothing
--     else.
--
-- After a claim the rider's reach is an ordinary `club_members` row. An
-- admitted claimer is byte-for-byte the same audience member as an approved
-- join request. The token is a way of reaching an existing grant, never a new
-- one. Both RPCs are granted to `authenticated` ALONE — decision #1 untouched.
--
-- ** A PUBLIC CLUB GETS NO TOKEN, AND THAT IS A DECISION RATHER THAN A GAP. **
-- `clubs` SELECT admits every signed-in rider to a public club and
-- `club_members` INSERT lets any of them join it, so the plain URL already
-- carries the whole grant a token could carry. §2b's `is_public = false`
-- conjunct is where that decision lives.
--
-- ---------------------------------------------------------------------------
-- WHAT REMOVAL DOES NOT DO — named here rather than discovered later
-- ---------------------------------------------------------------------------
-- `088`'s `remove_club_member` exists, so unlike `091` an admin CAN eject a
-- rider a link admitted. What it does not do is stop them coming back: nothing
-- records the removal, so a removed rider holding a live token walks straight
-- back in. The remedies are to REVOKE the link and to BLOCK. Closing it
-- properly is **PD-361** and nothing here builds it; the decision it needs
-- first — what a removal RECORDS — is that story's.

-- ===========================================================================
-- §1. The two tables and the one column
-- ===========================================================================
-- `pgcrypto` supplies `gen_random_bytes` and is ALREADY INSTALLED in
-- `extensions` on both hosted projects, so this is a no-op there. It is here
-- rather than in the test harness for `037`'s reason: a Supabase artifact
-- reproduced rather than a migration made conditional, so the statement is
-- identical in every environment.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- §1a. club_invites — the in-app half
-- ---------------------------------------------------------------------------
-- ** TWO TABLES, NOT ONE WITH A `direction` COLUMN. ** `club_invites` and
-- `085`'s `club_join_requests` are mirror images across the direction of the
-- ask, and it is the POLICIES that mirror: who may insert, who may answer, who
-- may clear, and which party a refusal is terminal against. Merging makes every
-- one of those a `case direction` inside a policy qual — which is
-- `notifications_subject_shape`'s shape applied to ACCESS CONTROL rather than
-- to column presence — and it makes an additive file into a destructive rewrite
-- of a live table's policy set. See design.md §One table or two.
create table public.club_invites (
  id uuid default uuid_generate_v4() primary key,

  club_id uuid references public.clubs(id) on delete cascade not null,

  -- BOTH ends cascade to profiles, because the row records a relationship
  -- between two IDENTIFIED riders and `029`'s erasure contract has to reach it
  -- from either. `club_join_requests` needs only one, its other party being a
  -- club rather than a second rider.
  invitee_id uuid references public.profiles(id) on delete cascade not null,
  inviter_id uuid references public.profiles(id) on delete cascade not null,

  status text default 'pending' not null,
  created_at timestamptz default now() not null,
  responded_at timestamptz,

  -- Not a wider key. One live invite per (club, rider) at a time is what bounds
  -- the re-send: a repeat is a 23505 in either status, and `036`'s event key
  -- absorbs a re-send by the same admin without a second notification.
  unique (club_id, invitee_id),

  constraint club_invites_no_self_invite
    check (invitee_id <> inviter_id),

  -- ** TWO VALUES, NOT THREE — `085`'s rule rather than `083`'s. ** For a RIDE
  -- the invite row IS the audience arm, so `083` keeps `accepted`. For a CLUB
  -- the MEMBERSHIP is the audience, so accepting DELETES this row: a surviving
  -- `accepted` row beside the unique key would make a club a rider once left
  -- un-invitable for ever, with no affordance anywhere to clear it.
  constraint club_invites_status_is_known
    check (status in ('pending', 'declined')),

  -- `is not distinct from`, never `=`. A CHECK accepts NULL, so the `=` form
  -- passes for a row satisfying neither side — `073`'s measured correction.
  constraint club_invites_response_coupling
    check ((status = 'pending') is not distinct from (responded_at is null))
);

alter table public.club_invites enable row level security;

-- `029`'s rule: every FK LEADS an index. `club_id` leads the unique index the
-- constraint above builds, which discharges the clubs cascade; these three are
-- the two profile cascades and the admin's per-club list.
create index club_invites_invitee_idx
  on public.club_invites (invitee_id, created_at desc, id desc);
create index club_invites_inviter_idx
  on public.club_invites (inviter_id);
create index club_invites_club_status_idx
  on public.club_invites (club_id, status, created_at desc, id desc);

comment on table public.club_invites is
  'One row per (club, invited rider) — 093, PD-360. THE MIRROR IMAGE OF club_join_requests ACROSS THE DIRECTION OF THE ASK, and two tables rather than one because it is the POLICIES that mirror: an authorised member inserts, the INVITEE answers, a refusal is terminal against the INVITER, and the club''s admins may clear one. AUDIENCE: the invitee, the inviter and the club''s ADMINS (private.is_club_admin), all dominated by a block conjunct on BOTH parties. The admin disjunct is not decoration — RLS filters a DELETE by what the caller may READ, so without it the DELETE policy''s admin arm is a silent DELETE 0 and the decided "an admin may clear a co-admin''s declined invite" cannot happen; 093.13 is the assertion. An ordinary MEMBER reads none, and NO ARM READS `clubs`, because one that did would hand every member of a public club the invites of a private one, and for a private club it would be circular. WHO MAY INSERT is decided by the club''s visibility AT THE MOMENT OF USE and never by a column here: private.may_invite_to_club_for is an ADMIN on a private club and ANY MEMBER on a public one, and it is re-derived at every accept and every claim, so an invite from a rider since demoted, since departed, or into a club that has since gone private stops working. ACCEPTING DELETES THE ROW and the club_members row becomes the record (085''s rule, not 083''s): for a club the MEMBERSHIP is the audience, and a surviving accepted row beside unique (club_id, invitee_id) would make a club a rider once left un-invitable for ever. `status` has TWO values. A PENDING INVITE GRANTS NOTHING AT ALL — an invitee reads no roster, no thread, no message, no ride and no postcard of the club, and the only policy that moves for them is `notifications`. RETENTION: indefinite and there is NO EXPIRY — an expiring invite would silently withdraw one rider''s offer in a way neither party is told about. Three on delete cascade FKs (club, invitee, inviter) are the whole retention window, and account deletion reaches this table from BOTH rider ends. There is deliberately NO responded_by and NO updated_at: the row has exactly one editable transition and responded_at records it.';

comment on column public.club_invites.status is
  'pending | declined. Written ONLY by the column default and public.decline_club_invite — authenticated holds no INSERT grant on this column and no UPDATE grant at all, and the table has no UPDATE policy. There is deliberately no `accepted`: accepting DELETES the row (085''s rule). A DECLINE IS TERMINAL AGAINST THE INVITER — the DELETE policy scopes their arm to `pending` — and REOPENABLE BY THE INVITEE ALONE, through public.accept_club_invite, which answers pending OR declined. A club''s admins may clear a declined row and re-send.';

comment on column public.club_invites.responded_at is
  'NULL exactly while `status` is pending, pinned by club_invites_response_coupling. Server-owned by the absent INSERT grant, like created_at, and written only by public.decline_club_invite.';

-- ---------------------------------------------------------------------------
-- §1b. club_invite_links — the capability half
-- ---------------------------------------------------------------------------
create table public.club_invite_links (
  id uuid default uuid_generate_v4() primary key,

  club_id uuid references public.clubs(id) on delete cascade not null,
  created_by uuid references public.profiles(id) on delete cascade not null,

  -- 128 bits, 32 lowercase hex. ** Server-owned by the GRANT rather than by
  -- this default: ** §3f's `grant insert` names `(id, club_id, created_by)` and
  -- nothing else, so there is no statement in which a client can choose or
  -- overwrite a token. A default alone would not do — it applies only when the
  -- column is omitted and PostgREST will happily name one. Guessing is treated
  -- as not an attack at 128 bits, so no rate limit or ledger is built for it.
  token text not null unique
    default encode(extensions.gen_random_bytes(16), 'hex'),

  -- ** A PLAIN COLUMN DEFAULT, AND NOT `091`'s BEFORE INSERT TRIGGER. ** `091`
  -- needed one because `least(rides.departure_at, …)` reads another table; a
  -- club has no departure and therefore no natural death, so the ceiling is
  -- absolute and reads nothing. It is server-owned the same way — by the absent
  -- grant, not by the default.
  --
  -- FOURTEEN DAYS is a product judgement (owner, 2026-08-31) and the SHAPE is
  -- the invariant: a ceiling written by the database and re-checked at every
  -- use. Two weekends plus a slip; re-issuing is one tap.
  expires_at timestamptz default (now() + interval '14 days') not null,

  created_at timestamptz default now() not null,

  -- Revoke is an UPDATE of this column and there is NO update grant and NO
  -- update policy — §4g's RPC is the only writer. A grant on `(revoked_at)`
  -- would let a client UN-revoke by writing NULL back.
  revoked_at timestamptz,

  constraint club_invite_links_token_shape check (token ~ '^[0-9a-f]{32}$')
);

alter table public.club_invite_links enable row level security;

-- club_id -> the admin's per-club list AND the clubs cascade.
-- created_by -> the profiles cascade, per `029`.
-- ** No second index on `token`: ** the unique constraint already builds one
-- and it serves every lookup this feature makes.
create index club_invite_links_club_idx on public.club_invite_links (club_id);
create index club_invite_links_created_by_idx on public.club_invite_links (created_by);

comment on table public.club_invite_links is
  'One row per shareable invite token into a PRIVATE club — 093, PD-360. POSSESSION OF THE TOKEN IS THE CREDENTIAL, the second such grant in this schema after ride_invite_links and the only other one that is not a fact about an identity. A live token buys exactly two RPC calls — club_invite_link_preview and claim_club_invite_link — and NO POLICY REACH: this file adds no arm to `clubs` SELECT and does not touch private.can_read_club (093.16). ONLY OWNERS AND ADMINS MINT, and only on a PRIVATE club: a public club''s plain URL already carries the whole grant a token could carry, so a token there would be a capability surface with no capability behind it. The minting set is exactly 085''s approval set on purpose — if an ordinary member could mint, a rider whose request an admin declined could get a link from a friendly member and be in, and the decline would be reversible by somebody with no authority to reverse it. AUDIENCE of the ROW: the club''s admins, through private.is_club_admin, so a link FOLLOWS THE CLUB rather than its minter and a co-admin who did not mint may still list and revoke it. No claimer ever reads the row, which is what makes every token a genuine bearer credential rather than a lookup key. A CLAIM ADMITS DIRECTLY — no admin approval — which is the product owner''s decision of 2026-08-31 together with its refinement that the rider must be able to BROWSE the club before anything is spent, and that the token is spent by a TAP and never by a render. RETENTION: the row is kept after the token dies, because club_members.invite_link_id points at it and the derived use count reads it; two on delete cascade FKs (club, minter) are the whole window, and a token is dead at created_at + 14 days, at revoke, when the club is deleted, or when the minter''s authority ends — whichever is first. REVOKING ADMITS NOBODY NEW AND EJECTS NOBODY; 088''s remove_club_member does eject, and does NOT bar re-entry through a live token (PD-361).';

comment on column public.club_invite_links.token is
  '128 bits from extensions.gen_random_bytes(16), 32 lowercase hex. Server-owned by the GRANT and not by this default — authenticated holds no INSERT grant on this column and no UPDATE grant at all, so no client can choose a token or rotate one onto an existing row. The `unique` constraint means a claim resolves to at most one link, so resolution never depends on ordering. Compared as TEXT everywhere, so a malformed string matches no row rather than raising a parse error that would confirm the format to a prober.';

comment on column public.club_invite_links.expires_at is
  'created_at + 14 days, absolute. A plain column DEFAULT rather than 091''s BEFORE INSERT trigger, because unlike a ride a club has no departure to read and therefore no natural death — which makes this ceiling the whole time-based control rather than a cap on a shorter one. Server-owned by the absent INSERT grant. AUTHORITATIVE for time and NOT for anything else: private.club_invite_link_reachable_by re-derives the MINTER''S AUTHORITY at every use, so a link outlives neither a demotion nor a departure however much of the fortnight is left.';

comment on column public.club_invite_links.revoked_at is
  'Set by public.revoke_club_invite_link and by nothing else — there is no UPDATE grant and no UPDATE policy, which is what stops a client writing NULL back to un-revoke. A revoked link previews nothing and admits nobody, immediately; the riders it already admitted are untouched, deliberately. Its UPDATE is what an in-flight claim serialises against, through the `for share` reachable_by takes on the same row.';

-- ---------------------------------------------------------------------------
-- §1c. club_members.invite_link_id — provenance, and nothing else
-- ---------------------------------------------------------------------------
-- ** `on delete set null`, never `cascade`. ** Deleting a link must not delete
-- the riders it admitted; that is the revoke decision expressed as a
-- referential action.
--
-- ** No grant, in either direction, and none is added. ** `048` made this
-- table's INSERT and UPDATE grants PER COLUMN over `(club_id, role, user_id)`,
-- so a new column is unwritable by every client the moment it exists — measured
-- in pre-flight rather than assumed. The table-level SELECT grant does cover
-- it, which is the intended half: whoever may already read the roster row may
-- read where it came from.
alter table public.club_members
  add column invite_link_id uuid references public.club_invite_links(id) on delete set null;

-- Discharges the new cascade, and serves the use count, which reads by it.
create index club_members_invite_link_idx on public.club_members (invite_link_id);

comment on column public.club_members.invite_link_id is
  'Which club invite link admitted this rider, or NULL for every other route in — 093, PD-360. PROVENANCE ONLY. NO POLICY, TRIGGER OR READ PREDICATE MAY BRANCH ON IT, and 093.29 asserts that none does: a rider admitted through a link must be indistinguishable from an accepted invitee, an approved requester and a rider who simply joined a public club EVERYWHERE access is decided, or the column becomes a second copy of a visibility decision. Its one purpose is deriving a link''s use count, which is the number of rows carrying it — read under the admin''s own block-dominated RLS, so a claimer who later blocks that admin stops being visible to them and the count GOES DOWN; a rider who leaves takes their row with them. That is decision #2 working as designed and the surface must not present the number as an immutable ledger. `on delete set null`: deleting a link removes the attribution and never the rider.';

-- ===========================================================================
-- §2. The helpers — one body per rule, and two entry points for the token
-- ===========================================================================
-- Every one is subject-taking with a caller-relative wrapper WHERE AND ONLY
-- WHERE an RLS expression needs one, on `060`'s pattern and `085`'s reasoning.
-- The `_for` twins are ORACLES — `may_invite_to_club_for` answers "is rider X
-- an admin of club Y" for any pair, `club_takes_invites_for` answers a
-- membership-and-block question for any pair — and they are safe only while no
-- client role can call them. §2h revokes; `093.31` asserts by ROLE NAME rather
-- than by attempting a call, because this suite runs as the table owner for
-- whom neither the schema barrier nor the EXECUTE barrier exists (`031`).

-- ---------------------------------------------------------------------------
-- §2a. AUTHORITY IS RE-DERIVED AT EVERY USE, NEVER TRUSTED FROM CREATION
-- ---------------------------------------------------------------------------
-- ** This is the rule the whole change turns on, and it is the one a reader is
-- most likely to optimise away, because at creation the INSERT policy already
-- checked it. ** It is `091`'s "departure is re-read at every use rather than
-- trusted from expires_at", one table over and with a sharper consequence, and
-- it is the schema's first grant whose validity is re-derived rather than fixed
-- at creation. Four cases would otherwise be silent holes:
--
--   * the inviter LEFT the club          -> refused; they no longer speak for it
--   * the inviter was DEMOTED by `088`   -> refused; demotion is the club
--                                           withdrawing exactly this authority
--   * the club flipped PUBLIC -> PRIVATE -> refused IF the inviter is an
--                                           ordinary member, allowed if an
--                                           admin. ** This is the case that
--                                           makes the rule non-optional: ** a
--                                           member's POINTER into a public club
--                                           must not silently become a GRANT
--                                           into a private one. `022`'s
--                                           propagate_club_privacy_to_rides is
--                                           the schema already doing this for
--                                           that club's rides.
--   * the club flipped PRIVATE -> PUBLIC -> allowed; it admits nothing the
--                                           plain URL does not
--   * the inviter DELETED their account  -> the row is already gone, by cascade
--
-- The disclosure this creates is small and considered: a rider can learn, from
-- their own invite disappearing, that whoever invited them is no longer
-- authorised. That is a fact about a club they were invited to, it is what the
-- product wants to tell them anyway, and the alternative is an Accept button
-- that always fails.
create or replace function private.may_invite_to_club_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_club_admin_for(candidate, target_club)
      or exists (
           select 1 from public.clubs c
            where c.id = target_club
              -- ON A PUBLIC CLUB AN ORDINARY MEMBER MAY INVITE, because there
              -- an invite is a POINTER rather than a grant: the recipient could
              -- already open the club and join it. One table, one row shape;
              -- what differs is what the row BUYS, and that is decided by the
              -- club's visibility at the moment it is used.
              and c.is_public
              and private.is_club_member_for(candidate, c.id)
         );
$$;

-- Body is EXACTLY the delegation and nothing else — `093.32` asserts it by
-- EQUALITY rather than by `like`, because `like '%..._for%'` is satisfied by a
-- comment mentioning the name (`060`'s reasoning, and CLAUDE.md's comment trap).
create or replace function private.may_invite_to_club(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.may_invite_to_club_for(auth.uid(), target_club);
$$;

-- ---------------------------------------------------------------------------
-- §2b. Who may MINT a link — narrower than who may invite, and deliberately
-- ---------------------------------------------------------------------------
-- `is_public = false` IS DECISION 1 and it is the only place that decision
-- lives: a public club's plain URL already carries the entire grant a token
-- could carry, so a token there would be a capability surface with no
-- capability behind it — a row, an expiry, a revoke, a use count, a claim RPC
-- and a landing route, buying a rider exactly the access they already had by
-- pasting the same club's URL, and creating a second, weaker way of describing
-- one permission.
--
-- `is_default = false` is `085`'s belt-and-braces verbatim: `058`'s welcome
-- club is public today, so the conjunct above already excludes it, and this
-- guards against somebody flipping it.
create or replace function private.may_mint_club_link_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.id = target_club
       and c.is_public = false
       and c.is_default = false
       and private.is_club_admin_for(candidate, c.id)
  );
$$;

create or replace function private.may_mint_club_link(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.may_mint_club_link_for(auth.uid(), target_club);
$$;

-- ---------------------------------------------------------------------------
-- §2c. The invitee-side admissibility question
-- ---------------------------------------------------------------------------
-- Every conjunct excludes somebody and the comment says who. ** IT TESTS NO
-- BLOCK, ** and §3d says why: a raise naming a block between the invitee and
-- the club's owner would tell an inviting member something about two OTHER
-- riders, and decision #2 forbids a block being revealed by any gap, count or
-- marker — an error string is a marker.
create or replace function private.club_takes_invites_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs c
     where c.id = target_club
       -- `058`'s welcome club: every rider is auto-joined at onboarding, so an
       -- invitation to it is meaningless.
       and c.is_default = false
       -- The owner is already inside it, by every definition this schema has.
       and c.owner_id <> candidate
       and not private.is_club_member_for(candidate, c.id)
       -- ** THE TWO MECHANISMS MEET AND ONE WINS DETERMINISTICALLY. ** A rider
       -- with a PENDING join request cannot be invited: the admin's remedy is
       -- the one already in front of them — APPROVE the request, which is the
       -- same outcome with the audit trail the rider started. It discloses
       -- nothing, because only a rider who may invite reaches this raise at all
       -- (§3d) and `085`'s SELECT policy already lets an admin read every
       -- request for their own club. On a PUBLIC club the conjunct is vacuous:
       -- club_takes_join_requests_for requires is_public = false, so no request
       -- can exist to collide with.
       --
       -- The converse is NOT symmetric and is not made so: a rider holding a
       -- live invite MAY still ask to join, because narrowing
       -- club_takes_join_requests_for would make the club vanish from an
       -- invited rider's Explore list — a visible change to a shipped screen
       -- for no safety gain. That function is untouched by this file.
       and not exists (
             select 1 from public.club_join_requests r
              where r.club_id = c.id
                and r.user_id = candidate
                and r.status = 'pending'
           )
  );
$$;

-- ---------------------------------------------------------------------------
-- §2d. ONE definition of "this invite is answerable by this rider"
-- ---------------------------------------------------------------------------
-- ** THREE CALLERS, ONE BODY: ** public.my_live_club_invites (what the invitee
-- is shown), public.accept_club_invite and public.decline_club_invite (what
-- they may act on), and — through §2e — the `notifications` policy arm. `091`'s
-- recorded defect is the specification here: centralising liveness while
-- leaving the CALLER predicate copied into two bodies gave the weaker treatment
-- to the more security-critical half, and there is no policy underneath a
-- `security definer` read to catch the drift.
--
-- `pending` OR `declined`, because THE INVITEE ALONE MAY REOPEN THEIR OWN
-- REFUSAL — `083`'s rule, and the accept RPC is the only door to it.
create or replace function private.club_invite_is_answerable_for(candidate uuid, invite uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.club_invites i
      join public.clubs c on c.id = i.club_id
     where i.id = invite
       and i.invitee_id = candidate
       and i.status in ('pending', 'declined')
       -- §2a, and this is where the re-derivation actually happens.
       and private.may_invite_to_club_for(i.inviter_id, i.club_id)
       -- Symmetric by construction (`009`), so one call covers a block in
       -- either direction and no directional `blocks` row is ever read here.
       and not private.is_blocked(candidate, i.inviter_id)
       -- A block with the club's OWNER refuses the accept, not only the invite.
       -- Without it an unblocked admin could admit a rider the owner has
       -- blocked — the rule `085` states, whose stated reason (that
       -- club_members SELECT carries no block predicate) has expired while the
       -- rule has not: a membership admits a rider to the club's threads,
       -- messages, rides and timeline.
       and not private.is_blocked(candidate, c.owner_id)
       -- ** THE PARTICIPATION GATE GOVERNS THE READ AS WELL AS THE WRITE. ** A
       -- `security definer` read has no policy beneath it, so a check absent
       -- here is absent everywhere; without it an account created by calling
       -- GoTrue's /auth/v1/signup directly and never calling accept_terms()
       -- could read a private club's name off an invite.
       and private.may_participate_for(candidate)
  );
$$;

-- ---------------------------------------------------------------------------
-- §2e. The notifications policy arm's predicate
-- ---------------------------------------------------------------------------
-- ** `in ('pending')` written as an INCLUSION, never `<> 'declined'`. ** A
-- fourth status added later must grant nothing by default, and an inequality
-- defaults to granting everything — `036`'s `else false` shape.
--
-- The consequence, stated because it is invisible from the policy: on a PRIVATE
-- club a `club_invited` notification becomes unreadable the moment the invite
-- is withdrawn, declined, or made unanswerable by a demotion or a block, and it
-- becomes readable again through the ORDINARY `clubs` conjunct the moment the
-- rider accepts, because they are then a member. On a PUBLIC club the ordinary
-- conjunct resolves throughout and this arm is never reached. So `090`'s
-- accepted cost — a withdrawn invite leaving a notification standing — applies
-- to public clubs only. A client marking the row read AFTER declining matches
-- zero rows and PostgREST reports success; nothing is stuck, because an
-- unreadable row is not counted either, but the mark-read must come first.
create or replace function private.has_live_club_invite_for(candidate uuid, target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_invites i
     where i.club_id = target_club
       and i.invitee_id = candidate
       and i.status in ('pending')
       and private.club_invite_is_answerable_for(candidate, i.id)
  );
$$;

create or replace function private.has_live_club_invite(target_club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_live_club_invite_for(auth.uid(), target_club);
$$;

-- ---------------------------------------------------------------------------
-- §2f. private.live_club_invite_link — the ONLY definition of "live"
-- ---------------------------------------------------------------------------
-- ** A statement about the LINK ALONE. ** It takes no caller, reads no
-- auth.uid(), and knows nothing about who is asking. Every time-and-state dead
-- state is decided here and nowhere else, so the preview and the claim cannot
-- disagree about a token. Returns zero rows for every dead state; never raises.
--
-- The join to `clubs` makes a DELETED club identical to a token that never
-- existed — although the cascade has already removed the link row by then, so
-- this is the second of two locks on that door.
create or replace function private.live_club_invite_link(t text)
returns table (link_id uuid, club_id uuid, created_by uuid, owner_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.club_id, l.created_by, c.owner_id
    from public.club_invite_links l
    join public.clubs c on c.id = l.club_id
   where l.token = t
     and l.revoked_at is null
     and now() < l.expires_at;
$$;

-- ---------------------------------------------------------------------------
-- §2g. private.club_invite_link_reachable_by — the ONLY definition of
--      "this caller may use this token", and both RPCs' only entry point
-- ---------------------------------------------------------------------------
-- A preview MORE permissive than its claim is a pure disclosure; a preview LESS
-- permissive is a rider staring at "no longer valid" for a link that works.
-- Neither is visible from either body alone and there is no policy under either
-- to catch it, which is why `093.27` reads `prosrc` for the ABSENCE of any
-- block or stamp test in the two public bodies.
--
-- ** `private.may_invite_to_club_for(created_by, club)` AND NOT
-- `may_mint_club_link_for`. ** The difference is deliberate and it is the
-- public-flip case: a club that has become PUBLIC since the link was minted is
-- still claimable, because the claim then admits nothing the plain URL would
-- not, and killing the token on that flip would be a surprise with no safety
-- behind it. Using the mint predicate here would kill it.
--
-- ** VOLATILE, and not by omission. ** `for share` below is refused outright in
-- a non-volatile function — `SELECT FOR SHARE is not allowed in a non-volatile
-- function` — which is what makes the two public RPCs volatile too. That has a
-- consequence rather than being cosmetic: PostgREST serves a `stable` function
-- over GET, which would put a live capability token in the query string of
-- /rest/v1/rpc/club_invite_link_preview and therefore into the project's own
-- request log. Volatile is POST-only.
create or replace function private.club_invite_link_reachable_by(
  t text, uid uuid, lock boolean default false)
returns table (link_id uuid, club_id uuid, created_by uuid, owner_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  -- ** THE LOCK, AND IT IS TAKEN BEFORE LIVENESS IS RESOLVED. ** Under READ
  -- COMMITTED — Postgres's default and Supabase's — a claim that resolved
  -- liveness a moment before a concurrent revoke committed would still admit
  -- the rider, and the admin's Revoke returned success. Unlike `091` an admin
  -- CAN then eject them (`088`), but they are not told they need to.
  --
  -- Locking on the token match ALONE — no liveness predicate — is deliberate:
  -- this statement must not become a second copy of §2f. revoke_club_invite_link
  -- UPDATEs this row, so the two serialise and the loser sees the committed
  -- outcome.
  --
  -- `for share`, not `for update`: concurrent claims of one link do not
  -- conflict with each other and must not block each other.
  if lock then
    perform 1 from public.club_invite_links l where l.token = t for share;
  end if;

  return query
  select k.link_id, k.club_id, k.created_by, k.owner_id
    from private.live_club_invite_link(t) k
   where private.may_invite_to_club_for(k.created_by, k.club_id)
     and not private.is_blocked(uid, k.created_by)
     and not private.is_blocked(uid, k.owner_id)
     and private.may_participate_for(uid)
     and uid <> k.owner_id
     and not private.is_club_member_for(uid, k.club_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- §2h. The grants — nothing to any client on a subject-taking twin
-- ---------------------------------------------------------------------------
revoke all on function private.may_invite_to_club_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.may_mint_club_link_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.club_takes_invites_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.club_invite_is_answerable_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_live_club_invite_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.live_club_invite_link(text) from public, anon, authenticated;
revoke all on function private.club_invite_link_reachable_by(text, uuid, boolean) from public, anon, authenticated;

-- The three wrappers ARE called from RLS expressions, which are evaluated as
-- the querying role, so they keep the grant `023` and `060` give theirs. Nothing
-- to `anon`, ever — decision #1.
revoke all on function private.may_invite_to_club(uuid) from public, anon;
grant execute on function private.may_invite_to_club(uuid) to authenticated;
revoke all on function private.may_mint_club_link(uuid) from public, anon;
grant execute on function private.may_mint_club_link(uuid) to authenticated;
revoke all on function private.has_live_club_invite(uuid) from public, anon;
grant execute on function private.has_live_club_invite(uuid) to authenticated;

comment on function private.may_invite_to_club_for(uuid, uuid) is
  'May this CANDIDATE send an in-app invite into this club? An ADMIN on a private club (085''s is_club_admin_for, which is clubs.owner_id UNION club_members with role in (owner, admin), and therefore 054''s ownerless owner too), or ANY MEMBER on a public one — because there an invite is a POINTER rather than a grant. 093, PD-360. ** IT IS RE-EVALUATED AT EVERY ACCEPT AND EVERY CLAIM, NEVER TRUSTED FROM CREATION, ** which is what makes an invite from a since-demoted or since-departed rider stop working and what stops a member''s pointer into a public club silently becoming a grant into a private one after a flip. It is the FIRST grant in this schema whose validity is re-derived at use rather than fixed at creation. Subject-taking, so the claim path can ask it about the link''s minter; granted to NO client role, because it answers for any pair and is therefore an admin oracle.';
comment on function private.may_invite_to_club(uuid) is
  'May the CALLER send an in-app invite into this club? Delegates to may_invite_to_club_for(auth.uid(), …) and does nothing else — 093.32 pins that body by EQUALITY, never by `like`, because a mention of the name in a comment satisfies a pattern match. Granted to authenticated because club_invites'' INSERT policy calls it and an RLS expression runs as the querying role.';
comment on function private.may_mint_club_link_for(uuid, uuid) is
  'May this CANDIDATE mint a capability link into this club? An admin, on a club that is PRIVATE and not the default one. 093, PD-360. THE `is_public = false` CONJUNCT IS DECISION 1 AND THIS IS THE ONLY PLACE IT LIVES: a public club''s plain URL already carries the entire grant a token could carry, so a token there would be a capability surface with no capability behind it and a second, weaker way of describing one permission. Narrower than may_invite_to_club_for on purpose, and NOT the predicate the claim path re-derives — a link on a club that has since become public stays claimable, because it then admits nothing the URL would not. The minting set is exactly 085''s approval set, so a declined rider cannot be let in by somebody with no authority to reverse the decline. Granted to no client role.';
comment on function private.may_mint_club_link(uuid) is
  'May the CALLER mint a capability link into this club? Delegates to may_mint_club_link_for(auth.uid(), …) and does nothing else — pinned by equality at 093.32. Granted to authenticated because club_invite_links'' INSERT policy calls it.';
comment on function private.club_takes_invites_for(uuid, uuid) is
  'May this CANDIDATE be invited to this club? Not the default club, not its owner, not already a member, and NO PENDING club_join_requests ROW for the pair — the last being where the two mechanisms meet, resolved in favour of the request the rider started, whose remedy is the Approve button already in front of the admin. On a public club that conjunct is vacuous, club_takes_join_requests_for requiring is_public = false. IT TESTS NO BLOCK, deliberately: it is asked by a BEFORE INSERT trigger whose raise a third rider would read, and a raise naming a block between the invitee and the club''s owner would disclose a block to somebody who is not party to it — decision #2 forbids a gap, a count or a marker, and an error string is a marker. Blocks are enforced instead at four places that disclose nothing: the INSERT policy (a block the inviter is a party to), the fan-out, the accessor and the accept. Granted to NO client role: it answers for any pair and is a membership oracle.';
comment on function private.club_invite_is_answerable_for(uuid, uuid) is
  'THE SINGLE DEFINITION OF "THIS INVITE IS ANSWERABLE BY THIS RIDER" — 093. Pending or declined (the invitee ALONE may reopen their own refusal), addressed to the candidate, the INVITER STILL AUTHORISED (may_invite_to_club_for, re-derived), neither block standing — with the inviter or with the club''s OWNER — and both participation stamps on the candidate. THREE CALLERS, ONE BODY: public.my_live_club_invites, public.accept_club_invite / public.decline_club_invite, and the notifications policy arm through private.has_live_club_invite. 091''s recorded defect is the specification here — centralising liveness while copying the CALLER predicate into two bodies gave the weaker treatment to the more security-critical half, with no policy underneath a definer read to catch the drift. THE STAMP TEST GOVERNS THE READ AS WELL AS THE WRITE. Granted to no client role.';
comment on function private.has_live_club_invite_for(uuid, uuid) is
  'Does this CANDIDATE hold a PENDING, answerable invite to this club? — 093. The predicate behind the notifications policy''s type-scoped club_invited arm, and the only reason that arm is safe: it is true for precisely the rider the notification addresses, for precisely as long as the invitation stands. `in (''pending'')` is written as an INCLUSION and never as `<> ''declined''`, so a fourth status added later grants nothing by default (036''s `else false` shape). Consequence, invisible from the policy: on a PRIVATE club the notification becomes unreadable when the invite is withdrawn, declined, or made unanswerable by a demotion or a block, and readable again through the ORDINARY clubs conjunct the moment the rider accepts and is a member. On a public club this arm is never reached. Granted to no client role.';
comment on function private.has_live_club_invite(uuid) is
  'Does the CALLER hold a pending, answerable invite to this club? Delegates to has_live_club_invite_for(auth.uid(), …) and does nothing else — pinned by equality at 093.32. Granted to authenticated because the notifications SELECT and UPDATE policies call it and an RLS expression runs as the querying role. It is caller-relative and therefore answers about nobody but the caller, which is what makes granting it safe where granting the _for twin would not be.';
comment on function private.live_club_invite_link(text) is
  'THE SINGLE DEFINITION OF "LIVE" for a club invite token — 093. A statement about the LINK alone: it takes no caller and reads no auth.uid(). Live when the token matches a row AND revoked_at is NULL AND now() < expires_at AND the club still exists. Returns ZERO ROWS for every dead state and RAISES NOTHING, so expired, revoked, deleted, malformed and unmatched are one outcome. Callable by NO client role; its only caller is private.club_invite_link_reachable_by. Change liveness HERE and nowhere else — 093.26 asserts the preview and the claim answer identically in every dead state, which is what makes that instruction enforceable.';
comment on function private.club_invite_link_reachable_by(text, uuid, boolean) is
  'THE SINGLE DEFINITION OF "THIS CALLER MAY USE THIS TOKEN" — 093 — and the ONLY entry point public.club_invite_link_preview and public.claim_club_invite_link have. Live (private.live_club_invite_link) AND the MINTER STILL AUTHORISED (may_invite_to_club_for, re-derived at every use, so a demotion or a departure kills every link that rider minted) AND not blocked in either direction with the minter OR with the club''s owner (private.is_blocked, symmetric) AND both participation stamps on the caller AND the caller is neither the owner nor already a member. It deliberately asks may_invite_to_club_for and NOT may_mint_club_link_for: a club that has become PUBLIC since minting stays claimable, because the claim then admits nothing the plain URL would not. NEITHER RPC BODY MAY RESTATE ANY OF THIS — 093.27 asserts it by reading prosrc — because a preview and a claim that disagree about the CALLER are invisible from either body alone and there is no policy under either. With lock => true it takes `for share` on the link row BEFORE resolving, so a revoke and an in-flight claim serialise; that is why it is VOLATILE, Postgres refusing FOR SHARE in a non-volatile function, and why both public RPCs are POST-only rather than served over GET with a live token in the query string. Callable by no client role.';

-- ===========================================================================
-- §3. Policies, grants and the two triggers
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §3a. club_invites SELECT — the two named parties, and NO arm reads `clubs`
-- ---------------------------------------------------------------------------
-- An arm making the row visible to anyone who can see the club would hand every
-- member of a PUBLIC club the invites of a private one it has nothing to do
-- with; and for a private club it would be circular anyway, since a non-member
-- cannot see the club. `085` made the same call for `club_join_requests` and it
-- is the same call here.
--
-- ** THE THIRD DISJUNCT IS `private.is_club_admin(club_id)` AND WITHOUT IT
-- §3c's ADMIN ARM IS DEAD CODE — MEASURED, NOT REASONED. ** tasks.md 3.1
-- specifies this policy as the two named riders alone while 3.3 gives the
-- club's admins a DELETE arm, and design.md's own answered question says *"an
-- admin may clear a co-admin's declined invite and re-send it — yes, decided
-- 2026-08-31."* Those cannot both hold: RLS applies the SELECT policy to a
-- `DELETE … where` (`081`, measured), so an admin who is neither the invitee
-- nor the inviter matches ZERO ROWS, PostgREST reports success, and the invite
-- stands. The RLS suite caught it; nothing in the DELETE policy shows it.
--
-- ** It is NOT the arm 3.1 refuses. ** That one is `exists (select 1 from clubs
-- where id = club_id)`, which under `clubs` SELECT is true for EVERY signed-in
-- rider on EVERY public club. `private.is_club_admin` is the club's owner union
-- its `owner`/`admin` members — the same set that already reads every
-- `club_join_requests` row for the club under `085`'s own SELECT policy, and
-- the same set that may answer one. This table is the mirror of that one and
-- the policies mirror with it.
--
-- ** What it discloses, stated: ** a club's admins can see the invites its
-- MEMBERS sent, which on a public club is a rider learning who somebody else
-- invited. That is administrative authority over the club's membership rather
-- than club content — the row carries a club, two rider ids, a status and two
-- timestamps and nothing else — and it is the price of a clearable refusal. An
-- ordinary member still reads none, and a pending invitee still reaches nothing
-- at all (`093.6`).
--
-- ** BOTH block conjuncts are at the TOP LEVEL and there is deliberately no
-- hoisted own-row arm on this table. ** `092` (PD-356) measured that an own-row
-- branch written INSIDE a block conjunct is a no-op — `blocks_no_self_block`
-- already makes `is_blocked(x, x)` false — while a parent EXISTS still
-- dominates it, so a rider loses the ability to DELETE their own row, silently,
-- RLS applying SELECT to a `DELETE … where`. Neither failure can arise here:
-- there is no parent EXISTS to dominate anything, and the only rider with a
-- DELETE arm on this table is the INVITER, whose readability is `inviter_id =
-- auth.uid()` with no club predicate at all — so an inviter who has since left
-- the club can still withdraw their own pending invite. `093.21` asserts that
-- withdrawal MATCHES the row rather than reporting a silent success.
--
-- The one thing the block conjuncts DO cost is deliberate and is `036` §4's
-- rule: an inviter blocked with their invitee can no longer withdraw the
-- invite. Without the conjunct on the DELETE, an affected-row count would be a
-- number an admin could compare against the list they were shown, which is
-- exactly how many rows a block is hiding from them.
create policy "Club invites are readable by their two riders and the club's admins"
  on public.club_invites for select to authenticated
  using (
    (
      invitee_id = auth.uid()
      or inviter_id = auth.uid()
      or private.is_club_admin(club_id)
    )
    and not private.is_blocked(auth.uid(), invitee_id)
    and not private.is_blocked(auth.uid(), inviter_id)
  );

-- ---------------------------------------------------------------------------
-- §3b. club_invites INSERT
-- ---------------------------------------------------------------------------
-- The block conjunct here is one the INVITER is a party to, so it discloses
-- nothing to anybody else — which is exactly why the invitee-side question
-- lives in §3d's trigger and carries no block of its own.
create policy "An authorised member invites a rider to their club"
  on public.club_invites for insert to authenticated
  with check (
    inviter_id = auth.uid()
    and private.may_invite_to_club(club_id)
    and not private.is_blocked(auth.uid(), invitee_id)
  );

-- ---------------------------------------------------------------------------
-- §3c. club_invites DELETE — a refusal is terminal against the INVITER
-- ---------------------------------------------------------------------------
-- The `status` scope is what makes it stick: the inviter may withdraw an
-- offer, never un-answer it. An admin may clear any row and re-send, mirroring
-- `085`'s "a refusal is clearable by the club" — bounded by the unique key (one
-- row per pair at a time) and by `notifications_event_key` (a re-send by the
-- SAME admin writes no new notification). The residual, N admins each notifying
-- once, is bounded by the admin count and accepted.
--
-- ** THE ADMIN ARM ONLY WORKS BECAUSE §3a CARRIES THE MATCHING SELECT
-- DISJUNCT. ** RLS filters a DELETE by what the caller may READ, so an arm here
-- with no arm there is a capability that reads as one and is not one — a silent
-- `DELETE 0` with PostgREST reporting success. That is `081`'s measured trap
-- and `092`'s hoisting lesson arriving at a different pair of policies, and
-- `093.13` is what fails if the SELECT disjunct is ever "tidied" away.
--
-- The block conjunct is narrower here than in §3a by one term, and the
-- composition is what makes that safe rather than an oversight: SELECT
-- dominates, so the effective delete set is the intersection and no row is
-- ever deletable-but-unreadable — `036` §4's rule, satisfied by construction.
create policy "An inviter withdraws a pending offer; the club's admins clear any"
  on public.club_invites for delete to authenticated
  using (
    (
      (inviter_id = auth.uid() and status = 'pending')
      or private.is_club_admin(club_id)
    )
    and not private.is_blocked(auth.uid(), invitee_id)
  );

-- ** NO UPDATE POLICY AND NO UPDATE GRANT, and the absence is the enforcement. **
-- `078`'s, `083`'s and `085`'s precedent. With RLS on, a command with no policy
-- is refused for every row, so `status` and `responded_at` are writable only by
-- §4c's RPC. Do not "complete" the CRUD set here. `093.30` asserts the absence
-- in BOTH directions per grantee, because a well-meaning `grant all` restores
-- only one of them.
revoke all on public.club_invites from anon, authenticated;
grant select, delete on public.club_invites to authenticated;
-- Per column. `status`, `created_at` and `responded_at` are on NO grant: a
-- default applies only when the column is omitted and PostgREST will happily
-- name one, so the default is not the guard — the absent grant is.
grant insert (id, club_id, invitee_id, inviter_id) on public.club_invites to authenticated;

-- ---------------------------------------------------------------------------
-- §3d. The admissibility trigger — and the ORACLE IT WOULD BE WITHOUT ITS
--      FIRST STATEMENT
-- ---------------------------------------------------------------------------
-- It exists because an INSERT policy cannot ask an INVITEE-side question
-- without `authenticated` holding EXECUTE on `club_takes_invites_for`, which is
-- a membership oracle for any pair. `enforce_ride_club_audience` and
-- `enforce_ride_timezone` are the same shape: a BEFORE trigger carrying a
-- cross-table rule a policy cannot express.
--
-- ** A BEFORE ROW TRIGGER FIRES BEFORE THE RLS `WITH CHECK` IS EVALUATED —
-- MEASURED ON POSTGRES 17, 2026-08-31. ** So without the first statement below,
-- ANY signed-in rider — member of nothing, admin of nothing — could attempt an
-- insert naming any private club and any rider and read the answer off the
-- SQLSTATE: 23514 "already a member / the owner / has a pending request" versus
-- 42501 "no". The trigger would have BECOME the oracle it exists to avoid
-- granting, for the whole private social graph, reachable by URL.
--
-- ** So: if the CALLER may not invite into this club at all, say nothing and
-- return. ** §3b's WITH CHECK refuses them a statement later with 42501, which
-- is the same answer they get for every other club and every other invitee. The
-- 23514 is then reachable only by a rider who may already read that club's
-- roster (club_members SELECT, through private.is_club_member) and its join
-- requests (`085`'s SELECT policy, through private.is_club_admin), so it
-- discloses nothing they did not have. `093.20` is the detector and it compares
-- the two refusals as STRINGS, not by SQLSTATE.
--
-- ** auth.uid() rather than new.inviter_id, and the difference is the whole
-- fix. ** A prober can put any rider's id in `inviter_id`; they cannot forge
-- auth.uid(). Reading NEW here would leave the oracle wide open.
--
-- ** NO `when (current_user = 'authenticated')` CLAUSE, and none is needed. **
-- auth.uid() is NULL wherever there is no JWT — a seed, a repair, psql, the
-- MCP — so may_invite_to_club_for(NULL, …) is false and the trigger returns
-- without enforcing, which is exactly what that clause buys the gate triggers.
--
-- ** It fires BEFORE enforce_participation_gate, ** triggers running in NAME
-- order and 'c' < 'p'. That is harmless because of the short-circuit: an
-- un-onboarded rider is an admin of nothing (clubs INSERT is itself gated), so
-- they take the early return and reach the gate's own 23514.
create or replace function private.enforce_club_invite_is_admissible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.may_invite_to_club_for((select auth.uid()), new.club_id) then
    return new;
  end if;

  if not private.club_takes_invites_for(new.invitee_id, new.club_id) then
    raise exception 'that rider cannot be invited to this club'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_club_invite_is_admissible() from public, anon, authenticated;

create trigger enforce_club_invite_is_admissible
  before insert on public.club_invites
  for each row execute function private.enforce_club_invite_is_admissible();

comment on function private.enforce_club_invite_is_admissible() is
  'BEFORE INSERT on club_invites: refuses an invite to the club''s owner, to an existing member, to the default club, or to a rider with a PENDING join request — 093. A trigger rather than a policy conjunct because the INSERT policy cannot ask an invitee-side question without granting authenticated EXECUTE on private.club_takes_invites_for, which is a membership oracle for any pair (enforce_ride_club_audience is the same shape). ** ITS FIRST STATEMENT IS LOAD-BEARING AND IS NOT A FAST PATH: ** a BEFORE ROW trigger fires BEFORE the RLS WITH CHECK is evaluated (measured, Postgres 17), so without it ANY signed-in rider could probe any private club for any rider''s membership by comparing 23514 against 42501. It therefore returns silently unless private.may_invite_to_club_for(auth.uid(), club) — auth.uid() and never new.inviter_id, which a prober can set to anything — and the raise is reachable only by a rider who may already read that roster and those requests. IT TESTS NO BLOCK: a raise naming a block between the invitee and the club''s owner would disclose a block to a third rider, which decision #2 forbids. No `when (current_user)` clause is needed, auth.uid() being NULL wherever there is no JWT.';

-- ---------------------------------------------------------------------------
-- §3e. club_invite_links policies — the row follows the CLUB, not its minter
-- ---------------------------------------------------------------------------
-- Written through private.is_club_admin rather than `created_by = auth.uid()`
-- so a co-admin who did not mint may still list and revoke — an administrative
-- object belongs to the club. It also means a demoted admin loses sight of the
-- links they minted, which is correct: the link is dead for them too, §2g
-- re-deriving their authority at every use.
create policy "Club invite links are readable by the club's admins"
  on public.club_invite_links for select to authenticated
  using (private.is_club_admin(club_id));

-- `may_mint_club_link` IS `is_club_admin` plus the two club conditions, so the
-- row still follows the club; the extra conjuncts are decision 1 (§2b).
create policy "A club's admins mint links into a private club"
  on public.club_invite_links for insert to authenticated
  with check (
    created_by = auth.uid()
    and private.may_mint_club_link(club_id)
  );

-- Deleting a link is a stronger revoke — the token stops resolving to anything
-- at all — and §1c's `on delete set null` is what guarantees it still removes
-- nobody.
create policy "A club's admins delete links into it"
  on public.club_invite_links for delete to authenticated
  using (private.is_club_admin(club_id));

-- ** NO UPDATE POLICY AND NO UPDATE GRANT. ** See §3c.
revoke all on public.club_invite_links from anon, authenticated;
grant select, delete on public.club_invite_links to authenticated;
grant insert (id, club_id, created_by) on public.club_invite_links to authenticated;

-- ---------------------------------------------------------------------------
-- §3f. The participation gate — the TWENTIETH and TWENTY-FIRST
-- ---------------------------------------------------------------------------
-- Inviting a rider and minting a bearer token are both participation, so `023`
-- refuses either without a consent stamp: an account created by calling
-- GoTrue's /auth/v1/signup directly and never calling accept_terms() must be
-- able to do neither.
--
-- ** THE `when` CLAUSE IS NOT DECORATION ** — `023` §2. It is what stops the
-- gate firing for the table owner, a seed and a repair statement, and it is
-- also why a `security definer` writer has to restate the rule in its own body:
-- inside such a body `current_user` is the OWNER, so the clause is never true.
-- §4a is that restatement. ** Do NOT add a compensating trigger to
-- club_members ** — `078.9` asserts that absence precisely because such a
-- trigger raises the gate count while gating nothing.
drop trigger if exists enforce_participation_gate on public.club_invites;
create trigger enforce_participation_gate
  before insert on public.club_invites
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.club_invite_links;
create trigger enforce_participation_gate
  before insert on public.club_invite_links
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped from nineteen, per `028`/`033`/`085`/`091`/`092`: this comment is
-- the `data` agent's first read via `list_tables` and no edit to CLAUDE.md
-- reaches it. ** The LIVE string on both hosted projects says `seventeen`,
-- because `092` is on disk and unapplied there — the enumeration below is the
-- FILE order, which is what a replayed chain produces, and the absolute count
-- on a project depends on which of `092`–`095` has applied. Assert the DELTA.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, twenty-one BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085), the seventeenth ride_invite_links (091), the eighteenth club_thread_waves and the nineteenth club_join_waves (092), the twentieth club_invites and the twenty-first club_invite_links (093); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ===========================================================================
-- §4. The write path and the six RPCs
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §4a. private.join_club_from_invite — the SINGLE place any invite path writes
--      a club_members row
-- ---------------------------------------------------------------------------
-- In `private`, so PostgREST cannot publish it and service_role cannot reach it
-- (`031`). It restates both gates in its own body, because a `security definer`
-- writer bypasses the trigger and the INSERT policy that would otherwise carry
-- them.
--
-- ** private.may_participate_for(rider) AND NEVER may_participate(). ** The
-- caller-relative form reads auth.uid(), which on the CLAIM path is the rider
-- and on the ACCEPT path is also the rider — but the ADMITTER is a third party
-- in both, and `085`'s recorded trap is exactly this substitution one function
-- over. Written subject-taking so the two can never be confused, and `093.23`
-- asserts an un-onboarded rider is refused on BOTH paths.
--
-- It returns FALSE rather than raising on every refusal, so the caller keeps
-- ONE observable failure and a block is not disclosed by a second error string
-- or a different SQLSTATE.
--
-- ** THE STATEMENT ORDER IS LOAD-BEARING. ** The membership row is written
-- BEFORE anything notifies, because `036` §3's notifications SELECT policy
-- needs the clubs row to resolve for the recipient and for a private club only
-- a member gets that; and the pending join request is deleted AFTER the
-- membership, so `085`/`087`'s retraction trigger fires on a rider who is
-- already in rather than leaving a window in which they are neither requested
-- nor a member.
create or replace function private.join_club_from_invite(
  rider uuid, target_club uuid, admitter uuid, link uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_owner      uuid;
  v_is_default boolean;
begin
  if not private.may_participate_for(rider) then
    return false;
  end if;

  select c.owner_id, c.is_default
    into v_owner, v_is_default
    from public.clubs c
   where c.id = target_club;

  -- `085`'s two guards verbatim. The default club is unreachable through both
  -- doors already — §2c excludes it from invites and §2b from links — so this
  -- is the third lock rather than the first.
  if v_owner is null or v_is_default then
    return false;
  end if;

  -- §2a, restated at the moment of the write: the admitter must STILL speak for
  -- the club. On the accept path the admitter is the inviter; on the claim path
  -- it is the link's minter.
  if not private.may_invite_to_club_for(admitter, target_club) then
    return false;
  end if;

  if private.is_blocked(rider, v_owner) then
    return false;
  end if;

  if private.is_blocked(rider, admitter) then
    return false;
  end if;

  -- 'member' as a LITERAL and NO role argument — `019`'s rule that `admin` is
  -- claimable by no client survives this new path because there is no input by
  -- which to attempt it. `on conflict do nothing`, so a second admission leaves
  -- the first row's role, joined_at and invite_link_id alone.
  insert into public.club_members (club_id, user_id, role, invite_link_id)
  values (target_club, rider, 'member', link)
  on conflict do nothing;

  -- AFTER the membership. `085`/`087`'s private.retract_club_join_requested
  -- fires on this DELETE and takes the admins' "X asked to join" notification
  -- with it; without the delete every admin keeps an actionable request line
  -- for a rider who is already in the club — `087`'s exact defect, arriving by
  -- a third route.
  delete from public.club_join_requests r
   where r.club_id = target_club
     and r.user_id = rider
     and r.status = 'pending';

  return true;
end;
$$;

revoke all on function private.join_club_from_invite(uuid, uuid, uuid, uuid) from public, anon, authenticated;

comment on function private.join_club_from_invite(uuid, uuid, uuid, uuid) is
  'The single place ANY invite path writes a club_members row — 093, PD-360; both public.accept_club_invite and public.claim_club_invite_link go through it and nothing else does. Restates the participation gate for the SUBJECT via private.may_participate_for — NEVER may_participate(), which is caller-relative and would answer for the wrong rider — and restates the admitter''s authority and both blocks, because a security definer writer bypasses the gate trigger and the club_members INSERT policy (which admits only a public or self-owned club, so an admin admitting into a PRIVATE one simply cannot insert the row from a client). Returns FALSE rather than raising on any refusal, so each caller keeps ONE observable failure and a block is not disclosed by a second error string. Writes ''member'' as a literal and takes NO role argument (019). `link` is PROVENANCE and is the only thing that ever writes club_members.invite_link_id; it is NULL on the accept path. Deletes any PENDING club_join_requests row for the pair AFTER the membership is written, so 085/087''s retraction clears the admins'' notification rather than leaving an actionable request for a rider who is already in. In `private`, so PostgREST cannot publish it and service_role cannot reach it (031).';

-- ---------------------------------------------------------------------------
-- §4b. accept_club_invite — the invitee alone, and one raise site
-- ---------------------------------------------------------------------------
-- Takes an INVITE id and never a rider id: the subject is auth.uid(), and "we
-- check the id matches the caller" is one refactor away from not doing that.
--
-- ONE raise site, so a nonexistent id, somebody else's invite, an invite from a
-- since-demoted admin, a block in either direction with the inviter, a block
-- with the club's OWNER and an un-onboarded caller are all one answer.
--
-- ** THERE IS NO `club_invite_accepted` NOTIFICATION AND ITS ABSENCE IS NOT AN
-- OVERSIGHT. ** private.notify_club_joined already fans `club_joined` out to
-- the owner and the admins on the club_members INSERT this performs, and a
-- second row would tell the same people the same thing. `091` made the
-- identical call about ride_joined. Reopen only if the product ever wants the
-- INVITER SPECIFICALLY told, which is a different recipient set.
create or replace function public.accept_club_invite(invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid     uuid := (select auth.uid());
  v_club    uuid;
  v_inviter uuid;
  v_joined  boolean := false;
begin
  select i.club_id, i.inviter_id
    into v_club, v_inviter
    from public.club_invites i
   where i.id = invite
     and private.club_invite_is_answerable_for(v_uid, i.id);

  if v_club is not null then
    v_joined := private.join_club_from_invite(v_uid, v_club, v_inviter);
  end if;

  if not v_joined then
    raise exception 'no answerable club invite with that id is yours to accept'
      using errcode = 'insufficient_privilege';
  end if;

  -- The invite has been answered; the club_members row is now the record.
  delete from public.club_invites i where i.id = invite;

  return v_club;
end;
$$;

-- ---------------------------------------------------------------------------
-- §4c. decline_club_invite — pending only, and no membership write
-- ---------------------------------------------------------------------------
-- The one place `status` and `responded_at` are ever written after the insert.
-- The refusal is terminal against the INVITER (§3c's DELETE scope) and
-- reopenable by the invitee alone, through §4b.
create or replace function public.decline_club_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  update public.club_invites i
     set status = 'declined',
         responded_at = now()
   where i.id = invite
     and i.status = 'pending'
     and private.club_invite_is_answerable_for(v_uid, i.id);

  if not found then
    raise exception 'no answerable club invite with that id is yours to decline'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- §4d. my_live_club_invites — what the invitee is shown
-- ---------------------------------------------------------------------------
-- ** A FIXED LIST OF NAMED COLUMNS, never club_invites.* or clubs.*, ** so a
-- column added to either table later is not disclosed by default. `093.15`
-- pins the return list against pg_get_function_result so a twelfth is a red
-- test rather than a code review.
--
-- ** IT DISCLOSES NOTHING `085`'s ACCESSOR DOES NOT ALREADY GIVE THIS RIDER,
-- WHICH IS THE NARROWNESS PROOF FOR THE IN-APP HALF. ** A live invitee is by
-- construction a non-owner, non-member of a non-default club who is not blocked
-- with its owner — which is exactly public.discoverable_private_clubs'
-- predicate — so name, avatar path, location and member count were already
-- theirs for the asking on a PRIVATE club, and on a PUBLIC one `clubs` SELECT
-- gives them the whole row. `is_public` is added because a club can flip and
-- the accessor implies its answer; the coordinates are NOT, because nothing
-- draws them. `093.14` asserts the equivalence rather than claiming it.
--
-- The inviter's username and avatar path are readable to the caller through
-- `profiles` SELECT already — its qual is `auth.uid() = id or (username is not
-- null and not is_blocked(auth.uid(), id))`, and §2d has already refused every
-- row where that block stands.
--
-- ** THE AVATAR WILL NOT SIGN FOR A PRIVATE CLUB, ** deliberately: `016`'s
-- storage policy runs its own EXISTS against `clubs` under the reader's RLS, so
-- signImagePaths returns null and the card draws initials — exactly as `085`
-- left it. The day a storage arm lands, `093.14` names it.
create or replace function public.my_live_club_invites()
returns table (
  invite_id           uuid,
  club_id             uuid,
  club_name           text,
  club_avatar_path    text,
  club_location_name  text,
  club_is_public      boolean,
  members_count       bigint,
  inviter_id          uuid,
  inviter_username    text,
  inviter_avatar_path text,
  status              text,
  created_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, c.id, c.name, c.avatar_path, c.location_name, c.is_public,
         -- An aggregate and NEVER a roster, computed in here because
         -- club_members SELECT returns an invitee zero rows for a private club.
         (select count(*) from public.club_members m where m.club_id = c.id),
         p.id, p.username, p.avatar_path,
         i.status, i.created_at
    from public.club_invites i
    join public.clubs c on c.id = i.club_id
    join public.profiles p on p.id = i.inviter_id
   where i.invitee_id = (select auth.uid())
     and private.club_invite_is_answerable_for((select auth.uid()), i.id)
   order by i.created_at desc, i.id desc;
$$;

-- ---------------------------------------------------------------------------
-- §4e. club_invite_link_preview — SIX named columns, zero rows for every
--      failure, and it raises nothing
-- ---------------------------------------------------------------------------
-- ** THE LIST IS RECONCILED AGAINST public.discoverable_private_clubs' SEVEN,
-- COLUMN BY COLUMN, BECAUSE BOTH FEED THE SAME SCREEN AND NEITHER HAS A POLICY
-- UNDERNEATH IT — so a difference between them is a DISCLOSURE DECISION and not
-- a mapping detail:
--
--   id / club_id     both — the screen needs it to claim and to navigate
--   name             both — the whole question the rider is answering
--   avatar_path      both — signs for NEITHER (016's storage EXISTS), so both
--                    draw initials
--   location_name    both — "the club I was told about" is usually a place
--   members_count    both — an aggregate, NEVER a roster
--   latitude/longitude  accessor ONLY. ClubPreviewScreen renders neither, and a
--                    token must not disclose a club's coordinates for a field
--                    nothing draws.
--   is_public        PREVIEW ONLY. The accessor returns private clubs by
--                    construction so it needs no flag; A TOKEN CAN OUTLIVE A
--                    FLIP, and without this the landing screen either drops its
--                    "Private club" line for everyone or asserts it for a club
--                    that is now public.
--
-- `t` is compared as text, so a malformed string simply matches no row. A parse
-- error would confirm the token format to a prober.
create or replace function public.club_invite_link_preview(t text)
returns table (
  club_id       uuid,
  name          text,
  avatar_path   text,
  location_name text,
  members_count bigint,
  is_public     boolean
)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.name, c.avatar_path, c.location_name,
         (select count(*) from public.club_members m where m.club_id = c.id),
         c.is_public
    from private.club_invite_link_reachable_by(t, (select auth.uid())) k
    join public.clubs c on c.id = k.club_id;
$$;

-- ---------------------------------------------------------------------------
-- §4f. claim_club_invite_link — one raise site, one entry point
-- ---------------------------------------------------------------------------
-- Takes the TOKEN and never a club id or a rider id.
--
-- ** THE CLAIM ADMITS DIRECTLY — NO ADMIN APPROVAL. ** Product owner,
-- 2026-08-31. The approval step in `085` exists to gate a RIDER-INITIATED join:
-- a stranger asking, and the admin's decision is the club's consent. A link is
-- the club INITIATING — an admin's affirmative act, given in advance to
-- whoever they hand the token to — so requiring a second consent from the same
-- authority asks the club to approve its own invitation. And a request-only
-- link would be the very thing decision 1 refuses: since `085` any signed-in
-- rider can already find any private club through discoverable_private_clubs
-- and ask, so a token whose only power is to write a club_join_requests row
-- grants nothing the app already grants for free.
--
-- ** THE TOKEN IS SPENT BY A TAP AND NEVER BY A RENDER, and no assertion in
-- this suite can see it. ** A stash is a string in a browser: the rider who
-- SIGNS IN is not necessarily the rider who OPENED the link, so an auto-claim
-- on session establishment would join a second rider to a private club they
-- were never told about — and at this layer that is a perfectly valid claim.
-- Only the client contract can refuse it (`RideInviteJoin`'s test is the
-- shape).
create or replace function public.claim_club_invite_link(t text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid    uuid := (select auth.uid());
  v_link   record;
  v_joined boolean := false;
begin
  -- ONE call, and every unreachable case comes back from it: dead link, minter
  -- demoted or departed, blocked either way with the minter or the owner,
  -- un-onboarded, already a member, the owner. `lock => true` is not optional —
  -- see §2g.
  select k.link_id, k.club_id, k.created_by
    into v_link
    from private.club_invite_link_reachable_by(t, v_uid, lock => true) k;

  if v_link.link_id is not null then
    v_joined := private.join_club_from_invite(
      v_uid, v_link.club_id, v_link.created_by, v_link.link_id);
  end if;

  -- ** ONE raise site. ** A second message, or a second SQLSTATE, is an oracle
  -- telling a prober which token strings are real.
  if not v_joined then
    raise exception 'no live club invite link with that token is usable by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- The claim clears what it makes moot. `join_club_from_invite` has already
  -- taken the pending join request (and its notification); this takes the
  -- standing invite, because a rider who is now a member must not go on being
  -- shown "you have been invited" to a club they are in. `club_takes_invites_for`
  -- refuses a NEW invite to a member, so nothing re-creates it.
  delete from public.club_invites i
   where i.club_id = v_link.club_id
     and i.invitee_id = v_uid;

  return v_link.club_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- §4g. revoke_club_invite_link — an RPC rather than an UPDATE grant
-- ---------------------------------------------------------------------------
-- A grant on `(revoked_at)` would let a client UN-revoke by writing NULL back,
-- and a table with no designed edit carries no UPDATE grant.
--
-- One raise site: "no such link", "not your club", "you are not an admin" and
-- "already revoked" are one answer.
create or replace function public.revoke_club_invite_link(link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  update public.club_invite_links l
     set revoked_at = now()
   where l.id = link
     and l.revoked_at is null
     and private.is_club_admin_for(v_uid, l.club_id);

  if not found then
    raise exception 'no revocable club invite link with that id is yours to revoke'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.accept_club_invite(uuid) from public, anon;
grant execute on function public.accept_club_invite(uuid) to authenticated;
revoke all on function public.decline_club_invite(uuid) from public, anon;
grant execute on function public.decline_club_invite(uuid) to authenticated;
revoke all on function public.my_live_club_invites() from public, anon;
grant execute on function public.my_live_club_invites() to authenticated;
revoke all on function public.club_invite_link_preview(text) from public, anon;
grant execute on function public.club_invite_link_preview(text) to authenticated;
revoke all on function public.claim_club_invite_link(text) from public, anon;
grant execute on function public.claim_club_invite_link(text) to authenticated;
revoke all on function public.revoke_club_invite_link(uuid) from public, anon;
grant execute on function public.revoke_club_invite_link(uuid) to authenticated;

comment on function public.accept_club_invite(uuid) is
  'The invitee accepts one invite addressed to them — 093, PD-360. Takes an INVITE id and never a rider id; the subject is auth.uid(). Answers PENDING or DECLINED, because the invitee alone may reopen their OWN refusal (083''s rule) and nobody else can. Resolves through private.club_invite_is_answerable_for and writes through private.join_club_from_invite, then DELETES the invite row — the club_members row is the record (085''s rule), and a surviving accepted row beside unique (club_id, invitee_id) would make a club a rider once left un-invitable. ONE RAISE SITE, so a nonexistent id, somebody else''s invite, an invite from a since-demoted or since-departed inviter, a block in either direction with the inviter OR with the club''s owner, and an un-onboarded caller are indistinguishable. THERE IS NO club_invite_accepted NOTIFICATION and that is not an oversight: private.notify_club_joined already fans club_joined out to the owner and the admins on the club_members INSERT this performs, and a second row would tell the same people the same thing (091 made the identical call about ride_joined).';
comment on function public.decline_club_invite(uuid) is
  'The invitee declines one PENDING invite addressed to them — 093. Same single raise site and same answerability predicate as accept. Writes no club_members row. It is the ONLY writer of club_invites.status and responded_at after the insert — there is no UPDATE grant and no UPDATE policy on that table. A refusal is TERMINAL AGAINST THE INVITER (the DELETE policy scopes their arm to pending) and reopenable by the invitee through accept; a club''s admins may clear it and re-send. It fans a club_invite_declined notification to the INVITER ALONE and never to the admin team: the invite was one rider''s act, and fanning a refusal to a whole team discloses one rider''s answer to people who did not ask. On a PRIVATE club the decline also makes the invitee''s own club_invited notification unreadable, private.has_live_club_invite_for being pending-scoped, so a client that marks it read must do so BEFORE calling this.';
comment on function public.my_live_club_invites() is
  'The caller''s own answerable club invites — 093. TWELVE NAMED COLUMNS and never club_invites.* or clubs.*; 093.15 pins the list so a thirteenth is a red test. Filtered by private.club_invite_is_answerable_for, the same body accept and decline use, so what is shown and what can be acted on cannot drift. IT DISCLOSES NOTHING public.discoverable_private_clubs DOES NOT ALREADY GIVE THIS RIDER — a live invitee is by construction a non-owner, non-member of a non-default club unblocked with its owner, which is that accessor''s predicate exactly — plus is_public, which a club can flip, and MINUS the coordinates, which nothing draws. The avatar path is returned and will NOT sign for a private club (016''s storage EXISTS), so the card draws initials, deliberately. A PENDING INVITE GRANTS NO OTHER READ: this file adds no arm to clubs SELECT (093.16), so the invitee still reads zero rosters, threads, messages, rides and postcards.';
comment on function public.club_invite_link_preview(text) is
  'What a club token holder is shown before they decide — 093. EXACTLY SIX NAMED COLUMNS of exactly one club: club_id, name, avatar_path, location_name, members_count and is_public. Never clubs.*, never a roster, never a rider id, never the description, cover, owner or age, and NEVER the coordinates — the landing screen renders neither, and a token must not disclose where a club is for a field nothing draws. is_public is here and is NOT in discoverable_private_clubs'' seven, because that accessor returns private clubs by construction while A TOKEN CAN OUTLIVE A FLIP, and the screen would otherwise assert something false. Returns ZERO ROWS for every unreachable case and RAISES NOTHING, so expired, revoked, club deleted, minter demoted or departed, blocked either way, un-onboarded, already a member, the owner, malformed and guessed are one outcome. Resolves through private.club_invite_link_reachable_by and nothing else: no is_blocked call and no profiles stamp test appears in this body, which 093.27 asserts. VOLATILE rather than STABLE deliberately — its entry point may take a row lock, and a stable function is served over GET by PostgREST, which would put a live capability token in the request log''s query string.';
comment on function public.claim_club_invite_link(text) is
  'Joins the caller to the link''s club — 093, PD-360. Takes the TOKEN and never a club id or a rider id. THE CLAIM ADMITS DIRECTLY, with NO admin approval (product owner, 2026-08-31): the approval in 085 gates a rider-initiated ask, while a link is the club initiating, and requiring a second consent from the same authority asks the club to approve its own invitation. Resolves through private.club_invite_link_reachable_by with lock => true and nothing else, then writes through private.join_club_from_invite, passing the link id so club_members.invite_link_id records provenance. Idempotent — club_members'' composite primary key means a second claim writes no second row and does not inflate the derived use count. It also DELETES any standing club_invites row for the pair, because a rider who is now a member must not go on being shown an invitation to a club they are in; the pending join request is cleared inside join_club_from_invite, which also retracts the admins'' notification. ONE RAISE SITE covering every dead state with one message and one SQLSTATE. THE TOKEN MUST BE SPENT BY A TAP AND NEVER BY A RENDER — an auto-claim on session establishment would admit whoever signs in next on a shared tab, which is a perfectly valid claim at this layer and therefore invisible to every assertion in supabase/tests/.';
comment on function public.revoke_club_invite_link(uuid) is
  'A club''s admin kills one link — 093. An RPC rather than an UPDATE grant, because a grant on (revoked_at) lets a client un-revoke by writing NULL back. Authorised by private.is_club_admin_for and NOT by created_by, so a co-admin who did not mint may revoke: a link is the club''s administrative object. ONE RAISE SITE: "no such link", "not your club" and "already revoked" are indistinguishable. ITS UPDATE IS WHAT AN IN-FLIGHT CLAIM SERIALISES AGAINST, through the `for share` reachable_by takes on the same row. IT REMOVES NOBODY: the riders the link already admitted keep their club_members rows, deliberately. Unlike a ride, a club DOES have a removal path — 088''s remove_club_member — but REMOVAL DOES NOT BAR RE-ENTRY THROUGH A LIVE TOKEN, because nothing records the removal; the admin''s remedies are to revoke this link and to block, and closing that gap properly is PD-361. The button''s copy must not imply that revoking ejects anyone.';

-- ===========================================================================
-- §5. Notifications
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §5.1  Both CHECKs, in the same block, from eleven types to thirteen
-- ---------------------------------------------------------------------------
-- `036`'s reason for the pair, and it is load-bearing rather than tidy: the
-- flat list says which strings are legal and the shape says which subject
-- columns each one carries. A bare `case` returns NULL for an unmatched type
-- and a CHECK passes on NULL, so a type added to the first with no arm in the
-- second would admit a row with no subject at all — which is why the `else
-- false` fallthrough must survive every rewrite.
--
-- ** BOTH NEW TYPES CARRY club_id ALONE, byte-identical to club_joined. ** That
-- is deliberate: `036` §3's SELECT policy tests each subject column with its
-- own conjunct, so a type reusing an existing shape needs no NEW conjunct — and
-- §5.2's change is a DISJUNCT INSIDE the existing club conjunct rather than a
-- new one. A subject-less type would have been lossy: notifications_event_key
-- is unique over all four subject columns with NULLS NOT DISTINCT, so two
-- invites from the same admin to the same rider for two different clubs would
-- collapse to one row and the second would be silently dropped.
--
-- ** BOTH LISTS BELOW ARE ABSOLUTE REWRITES, NOT DELTAS, SO THEY CARRY `092`'s
-- `club_waved` — AND THAT COUPLING IS THE `044`/`046` TRAP IN A NEW PLACE. **
-- `092` (PD-356) is a CONCURRENT change that lands ahead of this one in
-- filename order and adds `club_waved` to both constraints. An absolute rewrite
-- that omitted it would DROP a live notification type with no error and nothing
-- red — `044`/`046`'s recorded failure mode exactly, where an absolute grant
-- list reinstated what a later file had removed. This file was caught by the
-- RLS suite rather than by review, because the suite pins the constraint
-- definition by TEXT.
--
-- ** Carrying it is safe in the other direction too: ** applied to a database
-- where `092` has not landed, `club_waved` is a legal type with a shape arm and
-- no writer, which costs nothing. What is NOT safe is applying `093` before
-- `092` — `092` would then drop these two types again. Filename order is apply
-- order (`run.sh`), so a full in-order apply is always correct; the hazard is a
-- PARTIAL one, which is the only case `044`/`046` ever mattered in either.
--
-- THIRTEEN types here and FOURTEEN once `092` is in the chain. Neither number
-- is worth trusting: read the constraint.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in ('postcard_liked', 'postcard_commented', 'ride_joined',
             'club_joined', 'ride_created_in_club',
             'ride_invited', 'ride_invite_accepted', 'ride_invite_declined',
             'club_join_requested', 'club_join_request_approved',
             'club_join_request_declined',
             'club_waved',
             'club_invited', 'club_invite_declined')
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
      -- `092`'s, carried through this absolute rewrite. See the note above the
      -- type list: omitting it would silently drop a live type.
      when 'club_waved' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'club_invited' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      when 'club_invite_declined' then
        postcard_id is null     and comment_id is null
        and ride_id is null     and club_id is not null
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- §5.2  ** THE ASSERTION THIS WHOLE CHANGE RESTS ON: a club_invited
--       notification for a PRIVATE club is written and NEVER RETURNED without
--       the disjunct below **
-- ---------------------------------------------------------------------------
-- `036` §3's per-subject-column conjunct reads, under the RECIPIENT's own row
-- security:
--
--   club_id is null
--   or exists (select 1 from clubs scl where scl.id = notifications.club_id)
--   or (type = 'club_join_request_declined' and club_takes_join_requests(club_id))
--
-- and `clubs` SELECT is `is_public or owner_id = auth.uid() or
-- is_club_member(id)` — no invite arm and no block arm, read live off
-- pg_policies on DEV and PROD, byte-identical. ** An invitee to a private club
-- is not its owner and not a member, so the EXISTS is false and the
-- notification is written and then never returned, for ever ** — silently,
-- looking correct to every reviewer and to any test that only checks the row
-- was inserted. That is `085`'s recorded trap arriving on the exact surface
-- this change exists to build.
--
-- ** THE REMEDY IS `089`'s, TYPE-SCOPED, AND THIS IS ITS SECOND INSTANCE. **
-- The alternative — relaxing the club conjunct generally — would make EVERY
-- club_id-carrying notification a rider happens to hold resolve for a club they
-- cannot read, which is a widening with no statement behind it.
--
-- ** THREE EXPRESSIONS MOVE, NOT TWO. ** The SELECT `using`, the UPDATE
-- `using` AND the UPDATE `with check` are textually identical today (all three
-- md5 28ab04505c62f16147539f78b521a858 on DEV and PROD) and `036` §4 requires
-- them to stay so: no write path may reach a row no read path returns, or "mark
-- all read" becomes a disclosure channel through its affected-row count.
-- Moving only the read gives the invitee a notification they can see and can
-- NEVER MARK READ — a defect invisible in review, because the feature demo
-- works. `093.11` is the read case and `093.12` the mark-read case, and they
-- are two assertions rather than one.
--
-- ** THESE TWO PINS ARE SUPPOSED TO MOVE, WHICH IS THE OPPOSITE OF `091`. **
-- Every OTHER pin — `clubs` SELECT, private.can_read_club, club_join_requests'
-- three policies, club_members SELECT — must NOT, and a failure there means
-- this change is wrong rather than that the pin is stale. `093.16`.
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
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
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
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
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
             and private.club_takes_join_requests(notifications.club_id))
         or (type = 'club_invited'
             and private.has_live_club_invite(notifications.club_id)))
  );

-- ---------------------------------------------------------------------------
-- §5.3  The fan-outs
-- ---------------------------------------------------------------------------
-- Trap (a), `085` §5.4's first: ** NO `when (current_user = ...)` CLAUSE. **
-- Every GATE trigger in this repo carries one, and copying it onto a fan-out
-- whose writer is a `security definer` RPC disables it silently — which is the
-- bug `087` exists to fix. Here it is load-bearing on BOTH: decline_club_invite
-- is `security definer`, so `current_user` is the OWNER and such a clause would
-- turn the decline fan-out off entirely.
-- Trap (b): the actor and the recipient come from the ROW, never from
-- auth.uid() inside the trigger function — auth.uid() is NULL wherever there is
-- no JWT, and a comparison against NULL is not TRUE, which would filter out
-- every recipient in exactly the environment where this is asserted.
-- Trap (c): private.is_blocked is the only helper called, because it is the
-- only one that takes its subjects as arguments.

-- ** WHY THIS GUARD IS THE TWO BLOCKS AND NOT `085`'s can_read_club. ** That
-- guard exists to avoid writing a row the recipient's own policy can NEVER
-- return. Here §5.2's new arm is what returns it, so the club-resolvability
-- half is discharged by the policy rather than by a predicate here. What is NOT
-- discharged is a block with the club's OWNER — §3d deliberately keeps that out
-- of the admissibility trigger so an inviting member is told nothing about two
-- other riders, which means the INSERT can succeed for a rider who can never
-- accept, and this is the only place left to drop the row.
--
-- One case is a DELAY rather than a "never" and is deliberately allowed
-- through: an invitee who has not finished onboarding fails
-- club_invite_is_answerable_for's stamp test, so their row is unreadable until
-- they complete the wizard and then becomes readable. `036` §7.5's rule is
-- about rows that can never be returned.
create or replace function private.notify_club_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select new.invitee_id, new.inviter_id, 'club_invited', new.club_id
   where not private.is_blocked(new.invitee_id, new.inviter_id)
     and not exists (
           select 1 from public.clubs c
            where c.id = new.club_id
              and private.is_blocked(new.invitee_id, c.owner_id)
         )
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_club_invited
  after insert on public.club_invites
  for each row execute function private.notify_club_invited();

-- ** RECIPIENT: THE INVITER ALONE, NOT THE ADMIN TEAM. ** The invite was one
-- rider's act, and fanning a refusal out to every admin discloses one rider's
-- answer to people who did not ask for it.
--
-- The `when` is on the TRANSITION and on nothing else — `old.status is distinct
-- from new.status` — so a repair statement rewriting the row without moving
-- `status` notifies nobody.
create or replace function private.notify_club_invite_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, actor_id, type, club_id)
  select new.inviter_id, new.invitee_id, 'club_invite_declined', new.club_id
   where not private.is_blocked(new.invitee_id, new.inviter_id)
     -- The inviter reads this through 036 §3's ORDINARY club conjunct — they
     -- are a member or an admin — so can_read_club is the right guard here,
     -- unlike in notify_club_invited. It excludes an inviter who has left the
     -- club since, whose row would otherwise never be returned.
     and private.can_read_club(new.inviter_id, new.club_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger notify_club_invite_declined
  after update of status on public.club_invites
  for each row
  when (old.status is distinct from new.status and new.status = 'declined')
  execute function private.notify_club_invite_declined();

revoke all on function private.notify_club_invited() from public, anon, authenticated;
revoke all on function private.notify_club_invite_declined() from public, anon, authenticated;

comment on function private.notify_club_invited() is
  'Fan-out: an invite notifies the INVITEE and nobody else — 093. Actor is new.inviter_id and recipient new.invitee_id, BOTH READ FROM THE ROW and never from auth.uid(), which is NULL wherever there is no JWT (036 trap (b)). NO `when (current_user)` clause — 036 trap (a). ** ITS GUARD IS THE TWO BLOCKS AND NOT 085''s can_read_club, ** and the difference is the point: the club-resolvability half is discharged by 093 §5.2''s new type-scoped policy arm rather than by a predicate here, which is the whole reason that policy moved. What is not discharged is a block with the club''s OWNER, which private.enforce_club_invite_is_admissible deliberately does not test (it would disclose a block to a third rider), so the INSERT can succeed for a rider who could never accept and this is the only place left to drop the row. An UN-ONBOARDED invitee''s row IS written: their notification is unreadable until they finish the wizard and readable after, which is a delay rather than 036 §7.5''s never. `on conflict do nothing` absorbs a re-send by the same admin against notifications_event_key, which is what makes withdraw-and-re-send notify once rather than without limit — and is why there is NO RETRACTION TRIGGER here (090''s measured reason: with one, the deleted row never collides with the event key and every re-send notifies again).';
comment on function private.notify_club_invite_declined() is
  'Fan-out: a decline notifies the INVITER ALONE — 093 — and never the club''s admin team, because the invite was one rider''s act and a refusal fanned to a whole team discloses one rider''s answer to people who did not ask. Actor is the invitee and recipient the inviter, both from the ROW. Hung on `after update of status` with a WHEN on the TRANSITION (old.status is distinct from new.status and new.status = ''declined''), so a repair rewriting the row without moving status notifies nobody; the WHEN is on the transition and NOT on current_user, which would disable it entirely, decline_club_invite being security definer. Guarded by private.can_read_club because here the recipient DOES read through 036 §3''s ordinary club conjunct — they are a member or an admin — which is the opposite of notify_club_invited and worth reading as two different situations rather than an inconsistency.';

-- ---------------------------------------------------------------------------
-- §5.4  Two absences, both deliberate, both of which a later session will want
--       to "fix"
-- ---------------------------------------------------------------------------
-- ** NO RETRACTION TRIGGER FOR club_invited. ** `090` (PD-332) removed the ride
-- equivalent for a measured reason: WITH a retraction, withdraw-and-re-send
-- re-notifies WITHOUT LIMIT, because the deleted notification never collides
-- with notifications_event_key on the next insert. Not building one is a
-- decision, and it comes with `090`'s accepted cost — on a PUBLIC club a
-- withdrawn invite leaves a notification standing, which the client must
-- degrade to plain text rather than to a dead control, by reading the LIVE
-- invite through my_live_club_invites() rather than trusting the notification.
-- On a PRIVATE club the row simply stops resolving through §5.2's arm, so it
-- retracts itself.
--
-- ** NO club_invite_accepted TYPE. ** See §4b.

-- ===========================================================================
-- §Verification — run against the project after applying, do not assume
-- ===========================================================================
--
-- 1. The policies this change exists NOT to touch. A prose claim discharges
--    neither; capture both before and after.
--
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='clubs' and cmd='SELECT';
--   -- 4299c23bc61a3b5f53c580631cdf941c   (unchanged by 093)
--
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='club_members' and cmd='SELECT';
--   -- 9d075352246e30fe8dcdd2da25669518   (unchanged by 093)
--
--   select md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='private' and p.proname='can_read_club';
--   -- unchanged by 093
--
--   select policyname, md5(qual), md5(with_check) from pg_policies
--    where schemaname='public' and tablename='club_join_requests';
--   -- all three unchanged by 093
--
-- 2. The two policies that DO move, and all THREE of their expressions.
--
--   select cmd, md5(qual), md5(with_check) from pg_policies
--    where schemaname='public' and tablename='notifications';
--   -- SELECT: qual moved off 28ab04505c62f16147539f78b521a858, with_check NULL
--   -- UPDATE: qual AND with_check both moved, and EQUAL to each other and to
--   --         the SELECT qual. If the three are not equal, 036 §4 is broken.
--
-- 3. The grants, scoped to their grantee. `015`'s footer counted a privilege
--    table-wide and read 2 against a correct database, because postgres and
--    service_role hold everything by Supabase default.
--
--   select string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.table_privileges
--    where table_schema='public' and table_name in ('club_invites','club_invite_links')
--      and grantee='authenticated' group by table_name;
--   -- DELETE,INSERT,SELECT for both
--
--   select table_name, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name in ('club_invites','club_invite_links')
--      and grantee='authenticated' and privilege_type='INSERT' group by table_name;
--   -- club_invites:       club_id,id,invitee_id,inviter_id
--   -- club_invite_links:  club_id,created_by,id
--
--   select has_table_privilege('authenticated','public.club_invites','update'),
--          has_table_privilege('authenticated','public.club_invite_links','update'),
--          has_column_privilege('authenticated','public.club_invite_links','token','INSERT'),
--          has_column_privilege('authenticated','public.club_members','invite_link_id','INSERT'),
--          has_column_privilege('authenticated','public.club_members','invite_link_id','UPDATE');
--   -- f, f, f, f, f
--
--   select count(*) from information_schema.table_privileges
--    where table_schema='public' and table_name in ('club_invites','club_invite_links')
--      and grantee='anon';
--   -- 0
--
-- 4. FOURTEEN new security definer functions in `private` and SIX in `public`.
--    Enumerate rather than count — CLAUDE.md records `078`'s task list getting
--    exactly this arithmetic wrong, and a function created without
--    `security definer` would otherwise be a code review rather than a red
--    footer. (design.md says fifteen private; `set_club_invite_responded_at` is
--    not built, decline_club_invite writing both columns in one statement.)
--
--   select n.nspname, p.proname, p.prosecdef, p.proconfig, p.provolatile
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname, p.proname) in (
--            ('private','may_invite_to_club_for'), ('private','may_invite_to_club'),
--            ('private','may_mint_club_link_for'), ('private','may_mint_club_link'),
--            ('private','club_takes_invites_for'),
--            ('private','club_invite_is_answerable_for'),
--            ('private','has_live_club_invite_for'), ('private','has_live_club_invite'),
--            ('private','live_club_invite_link'),
--            ('private','club_invite_link_reachable_by'),
--            ('private','enforce_club_invite_is_admissible'),
--            ('private','join_club_from_invite'),
--            ('private','notify_club_invited'), ('private','notify_club_invite_declined'),
--            ('public','accept_club_invite'), ('public','decline_club_invite'),
--            ('public','my_live_club_invites'), ('public','club_invite_link_preview'),
--            ('public','claim_club_invite_link'), ('public','revoke_club_invite_link'))
--    order by 1, 2;
--   -- TWENTY rows; prosecdef t on every one; proconfig {search_path=} on every
--   -- one. provolatile: 'v' for club_invite_link_reachable_by,
--   -- club_invite_link_preview, claim_club_invite_link, revoke_club_invite_link,
--   -- accept_club_invite, decline_club_invite, join_club_from_invite and the two
--   -- fan-outs and the admissibility trigger; 's' for the rest.
--
-- 5. The oracles are reachable by NO client role, named by role rather than
--    attempted — `031`'s lesson, since this suite runs as the table owner for
--    whom neither barrier exists.
--
--   select has_function_privilege('authenticated','private.may_invite_to_club_for(uuid,uuid)','execute'),        -- f
--          has_function_privilege('authenticated','private.may_mint_club_link_for(uuid,uuid)','execute'),        -- f
--          has_function_privilege('authenticated','private.club_takes_invites_for(uuid,uuid)','execute'),        -- f
--          has_function_privilege('authenticated','private.club_invite_is_answerable_for(uuid,uuid)','execute'), -- f
--          has_function_privilege('authenticated','private.has_live_club_invite_for(uuid,uuid)','execute'),      -- f
--          has_function_privilege('authenticated','private.live_club_invite_link(text)','execute'),              -- f
--          has_function_privilege('authenticated','private.club_invite_link_reachable_by(text,uuid,boolean)','execute'), -- f
--          has_function_privilege('authenticated','private.join_club_from_invite(uuid,uuid,uuid,uuid)','execute'),       -- f
--          has_function_privilege('authenticated','private.may_invite_to_club(uuid)','execute'),                 -- t
--          has_function_privilege('authenticated','private.may_mint_club_link(uuid)','execute'),                 -- t
--          has_function_privilege('authenticated','private.has_live_club_invite(uuid)','execute'),               -- t
--          has_function_privilege('anon','public.claim_club_invite_link(text)','execute'),                       -- f
--          has_function_privilege('anon','public.club_invite_link_preview(text)','execute');                     -- f
--
-- 6. The two return lists are the disclosure.
--
--   select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='club_invite_link_preview';
--   -- TABLE(club_id uuid, name text, avatar_path text, location_name text,
--   --       members_count bigint, is_public boolean)   -- SIX
--
--   select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='my_live_club_invites';
--   -- TWELVE named columns; a thirteenth is a widening and owes its own reason
--
--   select position('is_blocked' in prosrc) + position('terms_accepted_at' in prosrc)
--     from pg_proc where proname in ('club_invite_link_preview','claim_club_invite_link')
--       and pronamespace = 'public'::regnamespace;
--   -- 0 for both. The caller predicate lives in ONE place.
--
-- 7. The gate, and the count that must NOT move on club_members.
--
--   select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
--   -- ** +2, and assert the DELTA and the two table names, never the absolute. **
--   -- 17 on DEV and PROD before 092/093; 19 in the local suite before 093.
--
--   select c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid
--    where t.tgname='enforce_participation_gate' and not t.tgisinternal
--      and c.relname in ('club_invites','club_invite_links');
--   -- both
--
--   select count(*) from pg_trigger
--    where tgrelid='public.club_members'::regclass and not tgisinternal;
--   -- UNCHANGED — 078.9's lesson: a compensating gate trigger here could never
--   -- fire, current_user inside a definer body being the owner, and would make
--   -- coverage read complete while gating nothing.
--
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid='public.club_invites'::regclass and not tgisinternal order by tgname;
--   -- FOUR: enforce_club_invite_is_admissible (before insert, NO when),
--   --   enforce_participation_gate (before insert, WHEN current_user),
--   --   notify_club_invite_declined (after update of status, WHEN on the
--   --   transition), notify_club_invited (after insert, NO when).
--
-- 8. The cascades and the notification CHECKs.
--
--   select conname, confdeltype from pg_constraint
--    where conrelid in ('public.club_invites'::regclass,'public.club_invite_links'::regclass)
--      and contype='f';
--   -- all 'c' (cascade)
--
--   select confdeltype from pg_constraint
--    where conrelid='public.club_members'::regclass and contype='f'
--      and conname like '%invite_link%';
--   -- 'n' — SET NULL, never cascade
--
--   select conname from pg_constraint where conrelid='public.notifications'::regclass
--      and contype='c' and pg_get_constraintdef(oid) like '%club_invited%';
--   -- notifications_subject_shape AND notifications_type_check, both naming
--   -- thirteen types
--
-- 9. Advisors: 27 before on DEV, 33 after. SIX new
--    `authenticated_security_definer_function_executable` WARNs, one per new
--    `public` definer function, and NONE for the fourteen in `private` —
--    PostgREST does not publish that schema. A thirty-fourth means a revoke did
--    not land, or something was created in `public` that belongs in `private`.
--      mcp__Supabase__get_advisors <ref> security
--
-- 10. ** `036`'s HAND-EXERCISE GATE APPLIES TO THIS FILE. ** It replaces two
--     live policies on `notifications` and hangs private.notify_club_joined —
--     `after insert on club_members`, no `when` clause — inside a new write
--     path, so a raise there takes a rider's accept or claim down with it.
--     Exercise on DEV in a ROLLED-BACK transaction, as `authenticated`, with
--     the fan-outs' rows COUNTED rather than assumed:
--       a. an ordinary club join by a rider — the unchanged path;
--       b. an accept into a PRIVATE club;
--       c. a claim into a PRIVATE club;
--       d. an accept into a club whose owner holds no club_members row (`054`'s
--          ownerless owner, who is an admin under is_club_admin_for);
--       e. a read of an existing rider's notifications list, and a mark-read on
--          it, because BOTH policies moved for everyone.
