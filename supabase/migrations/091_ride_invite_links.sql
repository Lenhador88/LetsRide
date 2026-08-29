-- 091: ride invite links — a bearer token that reaches an EXISTING grant, and
-- never a new one.
--
-- Linear PD-330. The proposal is openspec/changes/share-a-ride-invite-link/,
-- and its six delta specs are the contract this file implements. `083` (PD-329)
-- built the in-app half and pre-declared this seam in its own §5: a
-- token-bearing claim becomes `private.join_ride_from_invite`'s second caller
-- WITHOUT touching the write. That is exactly what happens below.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING: additive in schema, and NOT inert
-- ---------------------------------------------------------------------------
-- The table, its policies, the two `private` helpers and the three RPCs all
-- hang off a relation that did not exist a statement earlier, so none of them
-- can fire for anyone today. **§5's re-creation of `notify_ride_invited` is the
-- exception and it is the whole hazard.** That trigger sits on `ride_invites`,
-- a LIVE write path since `083`, so from the moment this applies every in-app
-- invite an organizer sends runs the re-created trigger inside their own
-- transaction — and a trigger that raises takes that rider's write down with
-- it.
--
-- That is `036`'s rule: DEV first, every affected write path exercised by hand
-- in a rolled-back transaction, and only then PROD.
--
-- Rollback, IN THIS ORDER:
--   1. drop the three public RPCs — revoke_ride_invite_link,
--      claim_ride_invite_link, ride_invite_link_preview;
--   2. drop private.ride_invite_link_reachable_by, then
--      private.live_ride_invite_link (the second is called by the first);
--   3. restore `notify_ride_invited` WITHOUT its WHEN clause — `083` §6c
--      verbatim, which reinstates the "you have been invited" message on a
--      claim, so it only makes sense together with step 5;
--   4. drop public.ride_invites.link_id and its index;
--   5. drop public.ride_invite_links last.
-- Dropping the table first leaves `link_id` referencing a missing relation.
--
-- ---------------------------------------------------------------------------
-- What a token buys, and what it does not
-- ---------------------------------------------------------------------------
-- **This change adds no audience arm to any policy.** `public.rides` SELECT is
-- untouched and `private.can_read_ride` is untouched — the suite pins both by
-- equality at `091.14`, and a failure there means this file is wrong rather
-- than that the pin is stale.
--
-- Possession of a live token permits exactly two RPC calls:
--
--   * `public.ride_invite_link_preview(t)` — EIGHT named columns of exactly one
--     ride. No roster, no ids, no club name, no second ride, no `rides.*`.
--   * `public.claim_ride_invite_link(t)` — joins that one ride, and nothing
--     else.
--
-- After a claim the rider's reach comes from the `ride_invites` row they now
-- hold, through `083`'s existing live-invite arm. An admitted link-claimer is
-- byte-for-byte the same audience member as an accepted in-app invitee, which
-- is already specified and already asserted. **The token is a way of reaching
-- an existing grant, never a new one.**
--
-- Both RPCs are granted to `authenticated` ALONE. Decision #1 is untouched:
-- `anon` gains nothing here, on the table or on any function.
--
-- ---------------------------------------------------------------------------
-- The three things this file's correctness turns on
-- ---------------------------------------------------------------------------
-- 1. **ONE definition of reach.** `private.ride_invite_link_reachable_by` is
--    the only entry point either public RPC has for deciding whether a caller
--    may use a token: live link, AND not blocked in either direction, AND both
--    participation stamps. Neither RPC body contains an `is_blocked` call or a
--    `profiles` stamp test — `091.13` asserts that by reading `prosrc`, because
--    a preview more permissive than the claim is a pure disclosure and a
--    preview less permissive is a rider staring at "no longer valid" for a
--    link that works, and neither is visible from either body alone.
--
--    **The gate governs the READ as well as the write, and that is the point.**
--    A `security definer` read has no policy underneath it, so a check absent
--    from the body is absent everywhere. Without the stamp test an account
--    created by calling GoTrue's `/auth/v1/signup` directly and never calling
--    `accept_terms()` — the precise threat `023` exists for — could hold a
--    forwarded token and read a private ride's title, meeting point, departure,
--    organizer and crew count.
--
-- 2. **Every dead token is indistinguishable from every other and from a
--    guess.** The preview returns ZERO ROWS and raises nothing; the claim has
--    exactly ONE raise site, one message, one SQLSTATE. Expired, revoked,
--    ride deleted, ride departed, blocked either way, un-onboarded, malformed
--    and unmatched all arrive at it. A second raise, or a distinct message, is
--    an oracle.
--
-- 3. **`for share` on the link row while the claim resolves reach.** Under READ
--    COMMITTED — Postgres's default and Supabase's — a claim that resolves
--    liveness a moment before a concurrent revoke commits would otherwise go on
--    to write the invite row and the crew row: the organizer's Revoke returns
--    success and a rider is admitted anyway. **On most features that would be
--    an acceptable race. Here it is not, because THIS APP HAS NO WAY TO EJECT A
--    RIDER FROM A RIDE** — `ride_members` DELETE is `auth.uid() = user_id` and
--    `088`'s three RPCs are club-scoped — so the rider admitted in that window
--    is permanent while the organizer has been told the opposite.
--
--    `for share` rather than `for update`: concurrent claims of one link must
--    not block each other, and they conflict only with the revoke's UPDATE.
--
-- ---------------------------------------------------------------------------
-- REVOKE DOES NOT REMOVE THE RIDERS A LINK ALREADY ADMITTED, AND NOTHING CAN
-- ---------------------------------------------------------------------------
-- Stated here because a reader of `revoke_ride_invite_link` will otherwise
-- assume the opposite, and because the brief this file was built from asserted
-- that `088` (PD-326) is the remove-rider path. **It is not.** `088` removes
-- CLUB members and says so in its own header — a removed club member's
-- `ride_members` rows are untouched. `public.ride_members`' only DELETE policy
-- is `Users can leave rides`, qual `auth.uid() = user_id`, unchanged since
-- `001` and read live off `pg_policy` on DEV.
--
-- So: revoking kills the token and admits nobody new; riders already in stay
-- in, deliberately (a mis-tap must not silently eject people who are already
-- planning to be there). The organizer's only lever against a specific rider is
-- a BLOCK, which is symmetric and removes the two riders from each other's
-- feeds, search, chat and member lists everywhere — a sledgehammer for "not on
-- this one ride". That gap is PRE-EXISTING, this change makes it reachable by
-- strangers for the first time, and closing it is not in scope here. The
-- Revoke button's copy must not imply a removal that cannot happen.
--
-- ---------------------------------------------------------------------------
-- Deliberate deviations from openspec/changes/share-a-ride-invite-link/tasks.md
-- ---------------------------------------------------------------------------
-- **Task 4.1 asks for `ride_invite_link_preview` to be `stable`. It cannot be,
-- and the reason is measured rather than argued.** Its only entry point,
-- `private.ride_invite_link_reachable_by`, takes `for share` when asked to, and
-- Postgres refuses that outright:
--
--     ERROR:  SELECT FOR SHARE is not allowed in a non-volatile function
--
-- so `reachable_by` is necessarily VOLATILE. A `stable` preview calling it
-- would be a label that is simply untrue, and the label has a consequence
-- rather than being cosmetic: **PostgREST serves a `stable` function over GET**,
-- which would put a live capability token in the query string of
-- `/rest/v1/rpc/ride_invite_link_preview` and therefore into the project's own
-- request log. Volatile is POST-only. Both RPCs are volatile below.
--
-- **Task 6.2b / the `ride-invite-links` spec's un-onboarded CLAIM scenario says
-- that claim raises `check_violation` from `private.join_ride_from_invite`. It
-- cannot, and the two halves of the spec disagree about it.** Once the
-- participation gate lives in `reachable_by` — which the same spec requires, so
-- the PREVIEW is gated too — an un-onboarded caller gets zero rows from the one
-- entry point and never reaches `join_ride_from_invite` at all. It therefore
-- reaches the SINGLE raise site with `insufficient_privilege`, exactly like
-- every other unreachable case, which is what task 4.4 demands
-- ("every unreachable case comes back from that one call and reaches the SAME
-- raise") and is strictly MORE uniform than the scenario asks for. `091.12`
-- asserts what this file does. `private.join_ride_from_invite` keeps its own
-- restatement of the gate regardless — it is untouched by this file, it is the
-- last statement before a `ride_members` row, and it still guards
-- `accept_ride_invite`; `091.17` pins that it is still there.

-- ===========================================================================
-- §1. The table
-- ===========================================================================
-- `pgcrypto` is what supplies `gen_random_bytes`, and it is ALREADY INSTALLED in
-- `extensions` on both hosted projects (`list_extensions` on DEV, 2026-08-29),
-- so this line is a no-op there. It is here rather than in
-- `supabase/tests/harness.sql` for `037`'s reason: a Supabase artifact
-- reproduced rather than a migration made conditional, so the statement is
-- identical in every environment. `with schema extensions` because
-- `extension_in_public` is a security advisor and everything below
-- schema-qualifies the call.
create extension if not exists pgcrypto with schema extensions;

-- **`token` is server-owned by the GRANT rather than by its default**, exactly
-- as `083` §4 owns `status`: §3's `grant insert` names `(id, ride_id,
-- created_by)` and nothing else, so there is no statement in which a client can
-- choose or overwrite a token. A default alone would not do — it applies only
-- when the column is omitted, and PostgREST will happily name one.
--
-- 128 bits, 32 lowercase hex characters. That is treated as sufficient that
-- guessing is not an attack, and no rate limit, ledger or lockout is built for
-- the claim path on the strength of guessing alone.
create table public.ride_invite_links (
  id uuid default uuid_generate_v4() primary key,

  -- Cascade: deleting a ride takes every link to it, and every token then
  -- behaves exactly as one that never existed. `029`'s erasure contract reaches
  -- this table from both ends — this one and `created_by` below.
  ride_id uuid references public.rides(id) on delete cascade not null,

  created_by uuid references public.profiles(id) on delete cascade not null,

  token text not null unique
    default encode(extensions.gen_random_bytes(16), 'hex'),

  -- NOT NULL with no default, filled by §1b's BEFORE INSERT trigger. A default
  -- cannot do this: it has to read `rides.departure_at`, which is another
  -- table. NOT NULL is checked after BEFORE triggers run, so the two compose.
  expires_at timestamptz not null,

  created_at timestamptz default now() not null,

  -- Revoke is an UPDATE of this column and there is NO update grant and NO
  -- update policy — §4's RPC is the only writer. A grant on `(revoked_at)`
  -- would let a client UN-revoke by writing NULL back.
  revoked_at timestamptz,

  constraint ride_invite_links_token_shape check (token ~ '^[0-9a-f]{32}$')
);

alter table public.ride_invite_links enable row level security;

-- Indexes, and which foreign key each one discharges.
--
--   ride_id     -> ride_invite_links_ride_idx, the organizer's per-ride list
--                  AND the ride cascade.
--   created_by  -> ride_invite_links_created_by_idx, the profile cascade, per
--                  `029`'s standing rule that every FK into `profiles` LEADS an
--                  index.
--
-- **No second index on `token`.** The `unique` constraint above already builds
-- one and it serves every lookup this feature makes.
--
-- Neither carries trailing sort columns, unlike `083`'s `ride_invites` list
-- index. A ride has a handful of links, not a roster of them, so the ordering
-- is a sort over a few rows rather than a scan to avoid.
create index ride_invite_links_ride_idx on public.ride_invite_links (ride_id);
create index ride_invite_links_created_by_idx on public.ride_invite_links (created_by);

comment on table public.ride_invite_links is
  'One row per shareable invite token for a ride — 091, PD-330. POSSESSION OF THE TOKEN IS THE CREDENTIAL, which is the only grant in this schema that is not a fact about an identity. A live token buys exactly two RPC calls — ride_invite_link_preview and claim_ride_invite_link — and NO policy reach: this table adds no audience arm to `rides` and does not touch private.can_read_ride. Only the ride''s organizer mints, lists or revokes one. A link is open by design (one token admits any number of riders), so expiry and revoke are the only two controls and both are mandatory. REVOKING ADMITS NOBODY NEW AND EJECTS NOBODY: there is no remove-rider path for a ride anywhere in this schema.';

comment on column public.ride_invite_links.token is
  '128 bits from extensions.gen_random_bytes(16), 32 lowercase hex. Server-owned by the GRANT and not by this default — `authenticated` holds no INSERT grant on this column and no UPDATE grant at all, so no client can choose a token or rotate one onto an existing row. The `unique` constraint means a claim resolves to at most one link, so resolution never depends on ordering.';

comment on column public.ride_invite_links.expires_at is
  'least(rides.departure_at, created_at + 14 days), written by set_ride_invite_link_expiry and by nothing else. ADVISORY RATHER THAN AUTHORITATIVE: private.live_ride_invite_link re-reads rides.departure_at at every use, because a ride edited to depart EARLIER must shorten its links without this column being rewritten. Compared on instants — rides.timezone (080) governs how a departure is RENDERED, never when it OCCURS.';

comment on column public.ride_invite_links.revoked_at is
  'Set by public.revoke_ride_invite_link and by nothing else — there is no UPDATE grant and no UPDATE policy, which is what stops a client writing NULL back to un-revoke. A revoked link previews nothing and admits nobody, immediately; the riders it already admitted are untouched, deliberately.';

-- ---------------------------------------------------------------------------
-- §1b. The expiry trigger, and the participation gate
-- ---------------------------------------------------------------------------
-- **Not a column default.** A default cannot read `rides.departure_at`.
--
-- Unconditional rather than `when new.expires_at is null`: the value is the
-- database's, and a statement outside the grant — a seed, a repair — must not
-- be able to mint a link that outlives its ride either.
--
-- `least()` ignores NULLs, so a `ride_id` matching no row would fall through to
-- the ceiling. That row is refused a statement later by the foreign key, which
-- is checked after BEFORE triggers run.
--
-- **Fourteen days is a product judgement and the SHAPE is the invariant.** Two
-- weekends plus a slip: it covers "I'll ask the guys this weekend" and the week
-- where nobody replies. Re-issuing is one tap, so the ceiling costs a tap and
-- buys a hard stop on a URL that will outlive everyone's memory of it.
create or replace function private.set_ride_invite_link_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.expires_at := least(
    (select r.departure_at from public.rides r where r.id = new.ride_id),
    now() + interval '14 days'
  );
  return new;
end;
$$;

revoke all on function private.set_ride_invite_link_expiry() from public, anon, authenticated;

create trigger set_ride_invite_link_expiry
  before insert on public.ride_invite_links
  for each row execute function private.set_ride_invite_link_expiry();

comment on function private.set_ride_invite_link_expiry() is
  'Fills ride_invite_links.expires_at with least(rides.departure_at, now() + 14 days) — 091. A BEFORE INSERT trigger rather than a column default, because a default cannot read another table. NO `when (current_user = ...)` clause: this is a data-integrity rule about what the column MEANS, not a rule about what riders may write, so it must fire for a seed and a repair too.';

-- The participation gate. `when (current_user = 'authenticated')` is not
-- decoration — `023` §2: this is a rule about what RIDERS may write, so it must
-- not refuse the app's own accessors, a seed or a repair statement.
--
-- Minting a link IS participation, which is why the trigger is here at all.
drop trigger if exists enforce_participation_gate on public.ride_invite_links;
create trigger enforce_participation_gate
  before insert on public.ride_invite_links
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- Restamped from sixteen, per `028`/`033`: this comment is the `data` agent's
-- first read via `list_tables` and no edit to CLAUDE.md reaches it.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, seventeen BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069), the twelfth club_threads and the thirteenth club_messages (081, the twelfth renamed from club_discussions by 082), the fourteenth ride_invites (083), the fifteenth feedback (084), the sixteenth club_join_requests (085), the seventeenth ride_invite_links (091); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ===========================================================================
-- §2. ride_invites.link_id — provenance, and nothing else
-- ===========================================================================
-- **`on delete set null`, never `cascade`.** Deleting a link must not delete
-- the riders it admitted; that is the revoke decision expressed as a
-- referential action.
--
-- **No grant, in either direction.** `083` §4 grants INSERT per column over
-- `(id, ride_id, invitee_id, inviter_id)` and this column is not added to it,
-- so no client can claim an admission came through a link when it did not, or
-- launder one that did. There is no UPDATE grant on this table at all. The
-- table-level SELECT grant does cover it, which is the intended half: whoever
-- may already read the invite row may read where it came from.
alter table public.ride_invites
  add column link_id uuid references public.ride_invite_links(id) on delete set null;

-- Discharges the new cascade, and serves the use count, which reads by it.
create index ride_invites_link_idx on public.ride_invites (link_id);

comment on column public.ride_invites.link_id is
  'Which invite link admitted this rider, or NULL for an in-app invite — 091, PD-330. PROVENANCE ONLY. NO POLICY, TRIGGER OR READ PREDICATE MAY BRANCH ON IT, and 091.15 asserts that none does: a rider admitted through a link must be indistinguishable from an accepted in-app invitee EVERYWHERE access is decided, or the column becomes a second copy of a visibility decision. Its one purpose is deriving a link''s use count, which is the number of rows carrying it — read under the organizer''s own block-dominated RLS, so a claimer who later blocks the organizer stops being visible to them and the count GOES DOWN. That is decision #2 working as designed and the surface must not present the number as an immutable ledger. `on delete set null`: deleting a link removes the attribution and never the rider.';

-- ===========================================================================
-- §3. Policies, grants, and the two predicates
-- ===========================================================================
-- SELECT: the ride's organizer. A link is the organizer's administrative
-- object, and no claimer ever needs to read the row — §4's RPCs read it as the
-- owner. Written as an EXISTS on `rides` rather than `created_by = auth.uid()`
-- so it follows the RIDE rather than the minter.
--
-- **Every EXISTS below is evaluated under the caller's own row security**, an
-- RLS expression running as the querying role. That is the composition rather
-- than a convenience: an organizer who could not read their own ride could not
-- mint into it either.
create policy "Ride invite links are readable by the ride's organizer"
  on public.ride_invite_links for select to authenticated
  using (
    exists (
      select 1 from public.rides r
       where r.id = ride_id and r.organizer_id = auth.uid()
    )
  );

-- INSERT: the organizer, as themselves.
--
-- **Organizer-only is a decision, not a limitation to route around.** Handing N
-- riders the power to mint bearer tokens for a private ride is a different
-- security statement from handing one, so widening to the crew is a separate
-- change with its own scenarios rather than a default smuggled in here.
create policy "A ride's organizer mints links to it"
  on public.ride_invite_links for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.rides r
       where r.id = ride_id and r.organizer_id = auth.uid()
    )
  );

-- DELETE: the organizer. Deleting a link is a stronger revoke — the token stops
-- resolving to anything at all — and §2's `on delete set null` is what
-- guarantees it still removes nobody.
create policy "A ride's organizer deletes links to it"
  on public.ride_invite_links for delete to authenticated
  using (
    exists (
      select 1 from public.rides r
       where r.id = ride_id and r.organizer_id = auth.uid()
    )
  );

-- ** NO UPDATE POLICY AND NO UPDATE GRANT, and the absence is the enforcement. **
-- `078`'s and `083`'s precedent. With RLS on, a command with no policy is
-- refused for every row, so `revoked_at` is writable only by §4's RPC and
-- `token` is not writable by anyone.
revoke all on public.ride_invite_links from anon, authenticated;
grant select, delete on public.ride_invite_links to authenticated;
-- Per column. `token`, `expires_at`, `created_at` and `revoked_at` are on NO
-- grant: a default applies only when the column is omitted, and a client can
-- name one.
grant insert (id, ride_id, created_by) on public.ride_invite_links to authenticated;

-- ---------------------------------------------------------------------------
-- §3b. private.live_ride_invite_link — the ONLY definition of "live"
-- ---------------------------------------------------------------------------
-- **A statement about the LINK ALONE.** It takes no caller, reads no
-- `auth.uid()`, and knows nothing about who is asking. Every dead state is
-- decided here and nowhere else, so the preview and the claim cannot disagree
-- about a token.
--
-- `now() < r.departure_at` is re-read rather than trusted from `expires_at`,
-- because a ride edited to depart earlier must shorten its links immediately.
-- The join to `rides` is also what makes a DELETED ride identical to a token
-- that never existed — although the cascade has already removed the link row by
-- then, so this is the second of two locks on that door.
--
-- Returns zero rows for every dead state. It never raises.
create or replace function private.live_ride_invite_link(t text)
returns table (link_id uuid, ride_id uuid, created_by uuid, organizer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.ride_id, l.created_by, r.organizer_id
    from public.ride_invite_links l
    join public.rides r on r.id = l.ride_id
   where l.token = t
     and l.revoked_at is null
     and now() < l.expires_at
     and now() < r.departure_at;
$$;

revoke all on function private.live_ride_invite_link(text) from public, anon, authenticated;

comment on function private.live_ride_invite_link(text) is
  'THE SINGLE DEFINITION OF "LIVE" for a ride invite token — 091. A statement about the LINK alone: it takes no caller and reads no auth.uid(). A link is live when the token matches a row AND revoked_at is NULL AND now() < expires_at AND the ride still exists AND now() < rides.departure_at. Departure is RE-READ rather than trusted from expires_at, so a ride moved earlier shortens its links without the column being rewritten. Returns zero rows for every dead state and never raises, so expired, revoked, deleted, departed, malformed and unmatched are one outcome. Callable by NO client role; its only caller is private.ride_invite_link_reachable_by. Change liveness HERE and nowhere else — 091.11 asserts the preview and the claim answer identically in every dead state, which is what makes that instruction enforceable.';

-- ---------------------------------------------------------------------------
-- §3c. private.ride_invite_link_reachable_by — the ONLY definition of
--      "this caller may use this token", and the RPCs' only entry point
-- ---------------------------------------------------------------------------
-- **Centralising liveness while leaving the caller predicate copied into two
-- bodies was the original defect**, and it gave the weaker treatment to the
-- more security-critical half: a preview more permissive than the claim shows a
-- stranger a private ride they then cannot join — a pure disclosure with no
-- product benefit — and a preview less permissive is a rider staring at "no
-- longer valid" for a link that works. Neither is visible from either body
-- alone, and there is no policy under either to catch it.
--
-- Three conjuncts and they are all here:
--
--   * live, through §3b;
--   * `not private.is_blocked(uid, organizer_id)` — SYMMETRIC, so one call
--     covers a block in either direction, and never a directional `blocks` row;
--   * both participation stamps on the caller's `profiles` row. **The gate
--     governs the READ as well as the write.** A `security definer` read has no
--     policy beneath it, so a check absent here is absent everywhere.
--
-- **VOLATILE, and not by omission.** `for share` below is refused outright in a
-- non-volatile function — measured: `SELECT FOR SHARE is not allowed in a
-- non-volatile function`. That is what makes the two public RPCs volatile too.
create or replace function private.ride_invite_link_reachable_by(
  t text, uid uuid, lock boolean default false)
returns table (link_id uuid, ride_id uuid, created_by uuid, organizer_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
begin
  -- ** THE LOCK, AND IT IS TAKEN BEFORE LIVENESS IS RESOLVED. ** Under READ
  -- COMMITTED a claim that resolved liveness a moment before a concurrent
  -- revoke committed would still admit the rider, and BECAUSE NOTHING IN THIS
  -- APP CAN EJECT A RIDER FROM A RIDE that admission is permanent while the
  -- organizer's Revoke returned success.
  --
  -- Locking on the token match ALONE — no liveness predicate — is deliberate:
  -- this statement must not become a second copy of §3b. `revoke_ride_invite_link`
  -- UPDATEs this row, so the two serialise and the loser sees the committed
  -- outcome: the FOR SHARE waits for an uncommitted revoke, and the fresh
  -- snapshot the next statement takes is what then reads `revoked_at`.
  --
  -- `for share`, not `for update`: concurrent claims of one link do not
  -- conflict with each other and must not block each other.
  if lock then
    perform 1 from public.ride_invite_links l where l.token = t for share;
  end if;

  return query
  select k.link_id, k.ride_id, k.created_by, k.organizer_id
    from private.live_ride_invite_link(t) k
   where not private.is_blocked(uid, k.organizer_id)
     and exists (
       select 1 from public.profiles p
        where p.id = uid
          and p.terms_accepted_at is not null
          and p.onboarding_completed_at is not null
     );
end;
$$;

revoke all on function private.ride_invite_link_reachable_by(text, uuid, boolean)
  from public, anon, authenticated;

comment on function private.ride_invite_link_reachable_by(text, uuid, boolean) is
  'THE SINGLE DEFINITION OF "THIS CALLER MAY USE THIS TOKEN" — 091 — and the ONLY entry point public.ride_invite_link_preview and public.claim_ride_invite_link have. Live (private.live_ride_invite_link) AND not blocked in either direction (private.is_blocked, symmetric) AND both participation stamps on the caller. THE GATE GOVERNS THE READ, not only the write: a security definer read has no policy beneath it, so without the stamp test an account created by calling GoTrue''s /auth/v1/signup directly could read a private ride off a forwarded token. NEITHER RPC BODY MAY RESTATE ANY OF THIS — 091.13 asserts that by reading prosrc, because a preview and a claim that disagree about the CALLER are invisible from either body alone. With lock => true it takes `for share` on the link row BEFORE resolving, so a revoke and an in-flight claim serialise; that is why it is VOLATILE, Postgres refusing FOR SHARE in a non-volatile function. Callable by no client role.';

-- ===========================================================================
-- §4. The three RPCs
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- §4a. The preview — EIGHT named columns, zero rows for every failure
-- ---------------------------------------------------------------------------
-- `085`'s `discoverable_private_clubs` shape: a fixed list of named columns, no
-- roster, one raise-free failure mode, and the caller predicate answered in
-- one place because there is no policy underneath a definer read to do it.
--
-- **Never `rides.*`**, so a column added to `rides` later is not disclosed by
-- default. **No club name** — a private club's name is not something a bearer
-- token should disclose, and the club is not what the rider is deciding about.
-- **A crew COUNT and never a roster.**
--
-- `t` is compared as text, so a malformed string simply matches no row. A parse
-- error would confirm the token format to a prober.
create or replace function public.ride_invite_link_preview(t text)
returns table (
  ride_id uuid,
  title text,
  departure_at timestamptz,
  timezone text,
  meeting_point text,
  organizer_username text,
  organizer_avatar_path text,
  crew_count integer
)
language sql
security definer
set search_path = ''
as $$
  select r.id, r.title, r.departure_at, r.timezone, r.meeting_point,
         p.username, p.avatar_path,
         (select count(*)::int from public.ride_members m where m.ride_id = r.id)
    from private.ride_invite_link_reachable_by(t, (select auth.uid())) k
    join public.rides r on r.id = k.ride_id
    join public.profiles p on p.id = r.organizer_id;
$$;

-- ---------------------------------------------------------------------------
-- §4b. The claim — one raise site, and the statement order is load-bearing
-- ---------------------------------------------------------------------------
-- **Takes the TOKEN and never a ride id or a rider id.** The subject is
-- `auth.uid()` and the resource is the link.
--
-- ** THE ORDER IS LOAD-BEARING AND REVERSING IT FAILS SILENTLY. **
-- `private.join_ride_from_invite` re-checks `private.can_read_ride` in its own
-- body, because a `security definer` writer bypasses the `ride_members` INSERT
-- policy that would otherwise ask. For a PRIVATE, CLUBLESS ride the only arm
-- that can make `can_read_ride` true for a stranger is `083`'s live-invite arm
-- — which is true only once the invite row exists. Called first it returns
-- false, writes nothing, and admits nobody, on exactly the rides this feature
-- exists for, with no error raised.
--
-- ** THE BLOCK AND GATE CHECKS COME BEFORE THE WRITE, through the ONE call to
-- reachable_by. ** `can_read_ride` would still catch a blocked rider — the
-- invite arm sits inside its block-dominated group — but only AFTER a stray
-- `accepted` row had been written, and a later unblock would then silently
-- admit them. Checking first leaves no residue.
create or replace function public.claim_ride_invite_link(t text)
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
  -- ONE call, and every unreachable case comes back from it: dead link, blocked
  -- either way, un-onboarded. `lock => true` is not optional here — see §3c.
  select k.link_id, k.ride_id, k.created_by
    into v_link
    from private.ride_invite_link_reachable_by(t, v_uid, lock => true) k;

  if v_link.link_id is not null then
    -- `inviter_id` is NOT in the update list: where two paths could admit the
    -- same rider the FIRST row wins and keeps its original inviter. A rider who
    -- already held a `pending` or `declined` in-app invite and comes in through
    -- the link takes this branch — `083`'s rule that the invitee alone may
    -- reopen their own refusal, and following a link they were given is their
    -- own affirmative act.
    --
    -- The unique key is what makes the derived use count honest: a rider
    -- claiming twice produces no second row, so re-opening a link cannot
    -- inflate it.
    insert into public.ride_invites
      (ride_id, invitee_id, inviter_id, status, responded_at, link_id)
    values (v_link.ride_id, v_uid, v_link.created_by, 'accepted', now(), v_link.link_id)
    on conflict (ride_id, invitee_id) do update
      set status       = 'accepted',
          responded_at = now(),
          link_id      = coalesce(public.ride_invites.link_id, excluded.link_id);

    -- `083` §5, UNMODIFIED. It gains a caller and nothing else — including its
    -- own restatement of the participation gate, which is the last statement
    -- before a `ride_members` row.
    v_joined := private.join_ride_from_invite(v_uid, v_link.ride_id);
  end if;

  -- ** ONE raise site. ** Expired, revoked, ride deleted, ride departed,
  -- blocked in either direction, un-onboarded, malformed and unmatched all
  -- arrive here with one message and one SQLSTATE. `043`'s and `083`'s shape: a
  -- second message would be an oracle telling a prober which token strings are
  -- real.
  if not v_joined then
    raise exception 'no live invite link with that token is usable by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  return v_link.ride_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- §4c. The revoke — an RPC rather than an UPDATE grant
-- ---------------------------------------------------------------------------
-- A grant on `(revoked_at)` would let a client UN-revoke by writing NULL, and a
-- table with no designed edit carries no UPDATE grant.
--
-- One raise site: "no such link", "not your ride" and "already revoked" are one
-- answer. **It removes nobody** — see this file's header.
create or replace function public.revoke_ride_invite_link(link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid uuid := (select auth.uid());
begin
  update public.ride_invite_links l
     set revoked_at = now()
   where l.id = link
     and l.revoked_at is null
     and exists (
       select 1 from public.rides r
        where r.id = l.ride_id and r.organizer_id = v_uid
     );

  if not found then
    raise exception 'no revocable invite link with that id belongs to the caller'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.ride_invite_link_preview(text) from public, anon;
grant execute on function public.ride_invite_link_preview(text) to authenticated;
revoke all on function public.claim_ride_invite_link(text) from public, anon;
grant execute on function public.claim_ride_invite_link(text) to authenticated;
revoke all on function public.revoke_ride_invite_link(uuid) from public, anon;
grant execute on function public.revoke_ride_invite_link(uuid) to authenticated;

comment on function public.ride_invite_link_preview(text) is
  'What a token holder is shown before they decide — 091. EXACTLY EIGHT NAMED COLUMNS of exactly one ride: id, title, departure_at, timezone, meeting_point, the organizer''s username and avatar path, and a crew COUNT. Never rides.*, never a roster, never a rider id, never a second ride, and NEVER THE CLUB''S NAME — a private club''s name is not something a bearer token should disclose. Returns ZERO ROWS for every unreachable case and RAISES NOTHING, so expired, revoked, deleted, departed, blocked, un-onboarded, malformed and guessed are one outcome. Resolves through private.ride_invite_link_reachable_by and nothing else: no is_blocked call and no profiles stamp test appears in this body, which 091.13 asserts. VOLATILE rather than STABLE deliberately — its entry point may take a row lock, and a stable function is served over GET by PostgREST, which would put a live capability token in the request log''s query string.';

comment on function public.claim_ride_invite_link(text) is
  'Joins the caller to the link''s ride — 091. Takes the TOKEN and never a ride id or a rider id; the subject is auth.uid(). Writes an `accepted` ride_invites row THEN calls private.join_ride_from_invite, IN THAT ORDER: that function re-checks can_read_ride, and on a private clubless ride the live-invite arm is the only thing that can make it true, so the reverse order admits nobody and raises nothing. Idempotent — the unique (ride_id, invitee_id) key means a second claim writes no second row and does not inflate the derived use count, and join_ride_from_invite''s `on conflict do nothing` leaves an existing RSVP''s status and joined_at alone. ONE RAISE SITE covering dead link, blocked either way and un-onboarded with one message and one SQLSTATE; the organizer claiming their OWN link is refused separately by ride_invites'' check (invitee_id <> inviter_id) with 23514, which is the CHECK rather than a second raise, and the surface must read its own organizer status rather than rely on it. Resolves through private.ride_invite_link_reachable_by with lock => true and nothing else.';

comment on function public.revoke_ride_invite_link(uuid) is
  'The organizer kills one link — 091. An RPC rather than an UPDATE grant, because a grant on (revoked_at) lets a client un-revoke by writing NULL back. ONE RAISE SITE: "no such link", "not your ride" and "already revoked" are indistinguishable. ITS UPDATE IS WHAT AN IN-FLIGHT CLAIM SERIALISES AGAINST, through the `for share` reachable_by takes on the same row. IT REMOVES NOBODY: the riders the link already admitted keep their ride_invites and ride_members rows, deliberately, and NOTHING IN THIS SCHEMA CAN REMOVE A RIDER FROM A RIDE — 088 is club-scoped and ride_members DELETE is `auth.uid() = user_id`. The organizer''s only lever against a specific rider is a block. The button''s copy must not imply otherwise.';

-- ===========================================================================
-- §5. The fan-out narrowing — the one live write path this file touches
-- ===========================================================================
-- `083` §6c hung `notify_ride_invited` on `after insert on ride_invites` with
-- no WHEN clause, which was exact while `pending` was the only status any
-- insert could carry — true while the column grant and the INSERT policy were
-- the only writers. **§4b is a second writer and it inserts `accepted` rows**,
-- so without narrowing a rider who joins a ride by tapping a link they were
-- sent is told *"you have been invited to a ride"* about a ride they are
-- already on.
--
-- **`036`'s actor-is-not-recipient guard does not catch it, and that is the
-- part worth writing down.** The row's actor is the link's `created_by` — the
-- organizer — and its recipient is the claimer, so the two genuinely differ.
-- The guard is working; the event is simply not an event.
--
-- **A WHEN clause rather than an early `return` in the body**, for two reasons:
-- it is visible in `pg_get_triggerdef`, so `091.16` can pin the narrowing
-- itself rather than inferring it from an absent notification; and the function
-- is not entered at all, so a later edit to the body cannot silently widen it.
--
-- It is a NO-OP for the in-app path — `083` §4's column grant and INSERT policy
-- already make `pending` the only reachable status at insert — so this states
-- an invariant that was previously implicit and holds it against a second
-- writer. **`private.notify_ride_invited()`'s BODY IS UNCHANGED.**
--
-- **`notify_ride_invite_answered` is deliberately left alone.** A rider holding
-- a `pending` or `declined` in-app invite who comes in through the link takes
-- §4b's conflict branch, that trigger fires, and the organizer is told their
-- invite was accepted. THAT IS TRUE — they did invite that rider by name and
-- that rider did accept — and how they accepted is not a distinction the
-- organizer needs. So one tap produces two notifications on that branch and one
-- on the other, and both are truthful; collapsing them would break `055`'s crew
-- fan-out or leave an outstanding invite with no notification answering it.
--
-- **No new notification type, and none is needed.** The organizer already
-- learns through `ride_joined`, which `055` fans out on the `ride_members`
-- INSERT the claim performs. `ride_invite_accepted` would be the WRONG message
-- on a stranger's claim: it asserts the organizer invited that rider by name.
drop trigger notify_ride_invited on public.ride_invites;

create trigger notify_ride_invited
  after insert on public.ride_invites
  for each row when (new.status = 'pending')
  execute function private.notify_ride_invited();

-- ===========================================================================
-- §Verification — run against the project after applying, do not assume
-- ===========================================================================
--
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--   -- 17, up from 16. ride_invite_links is the seventeenth.
--
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.ride_invites'::regclass and not tgisinternal
--    order by tgname;
--   -- THREE, unchanged in NAME: enforce_participation_gate,
--   --   notify_ride_invite_answered, notify_ride_invited — and the last now
--   --   carries WHEN (new.status = 'pending'::text). Read the DEFINITION, not
--   --   the count: the count was 3 before this file too.
--
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.ride_invite_links'::regclass and not tgisinternal
--    order by tgname;
--   -- TWO: enforce_participation_gate (before insert, WHEN current_user) and
--   --   set_ride_invite_link_expiry (before insert, NO when clause).
--
--   select policyname, cmd, roles::text from pg_policies
--    where schemaname = 'public' and tablename = 'ride_invite_links'
--    order by cmd;
--   -- THREE, every one {authenticated}: DELETE, INSERT, SELECT. No UPDATE.
--
--   select has_table_privilege('authenticated', 'public.ride_invite_links', 'update'),
--          has_table_privilege('anon',          'public.ride_invite_links', 'select'),
--          has_column_privilege('authenticated', 'public.ride_invite_links', 'token', 'INSERT'),
--          has_column_privilege('authenticated', 'public.ride_invites', 'link_id', 'INSERT');
--   -- f, f, f, f — asserted PER GRANTEE, because postgres and service_role
--   --   hold everything by Supabase default.
--
--   select p.proname, p.prosecdef, p.proconfig, p.provolatile
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.proname in ('live_ride_invite_link', 'ride_invite_link_reachable_by',
--                        'set_ride_invite_link_expiry', 'ride_invite_link_preview',
--                        'claim_ride_invite_link', 'revoke_ride_invite_link')
--    order by n.nspname, p.proname;
--   -- SIX, all prosecdef = t, all proconfig = {"search_path="}.
--   --   provolatile: live_ride_invite_link 's', the other five 'v'.
--
--   select position('is_blocked' in prosrc) + position('terms_accepted_at' in prosrc)
--     from pg_proc where proname in ('ride_invite_link_preview', 'claim_ride_invite_link')
--       and pronamespace = 'public'::regnamespace;
--   -- 0 for both. The caller predicate lives in ONE place.
--
--   select md5(prosrc) from pg_proc
--    where proname = 'can_read_ride' and pronamespace = 'private'::regnamespace;
--   -- a9b2954b27c970d9b19cd781fbe181c7 — UNCHANGED. This file does not touch
--   --   it, and a different value means the change is wrong.
--
--   select qual from pg_policies
--    where schemaname = 'public' and tablename = 'rides' and cmd = 'SELECT';
--   -- byte-identical to what 083 left. This file adds NO audience arm.
--
--   -- Advisors: 27, up from 24 — three new
--   -- `authenticated_security_definer_function_executable` WARNs, one each for
--   -- ride_invite_link_preview, claim_ride_invite_link and
--   -- revoke_ride_invite_link. The three `private` functions add none, being
--   -- unpublishable by PostgREST. Anything else is unexpected.
--   --   mcp__Supabase__get_advisors <ref> security
