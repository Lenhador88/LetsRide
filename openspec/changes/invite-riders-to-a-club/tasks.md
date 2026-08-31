# Tasks — invite-riders-to-a-club (PD-360, under the PD-299 epic)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing a policy is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight and §8 is the ordering, which is the one part that cannot be reordered for convenience.

> **Nothing here is blocked.** Q1 and Q6 were answered by the product owner on 2026-08-31 — the
> ceiling is **14 days**, and the claim **admits directly, with no admin approval**, subject to the
> browse-then-join refinement in `design.md` §The landing screen is the club's own preview screen.
> Q2–Q5 are closed with the defaults; Q5's gap is filed as **PD-361** and nothing is built for it
> here.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 Read **PD-360** and **PD-299**, bodies **and** comments. Read 2026-08-31: PD-360 is
  `Development (AI)` with **no** comments and carries the shape and the two deciding negative cases;
  PD-299 is `Needs decision` with one comment closing its question 1 (Threads) and explicitly leaving
  2 and 3 open. **The sub-issue already exists — do not open another.** PD-299 stays open: this
  change closes its #2 and #3 and nothing else.
- [ ] 0.2 Re-derive the four policies this change reasons about. Any difference reopens a decision:
  ```sql
  select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename in ('clubs','club_members','club_join_requests','notifications')
   order by tablename, cmd;
  ```
  Measured on DEV **and** PROD 2026-08-31, and the two projects are **byte-identical** on all four —
  `clubs` SELECT is `is_public OR owner_id = auth.uid() OR private.is_club_member(id)` (**no block
  arm, no invite arm**); `club_members` SELECT **does** carry a block conjunct, so `085`'s header
  claim that it does not is stale (`proposal.md`'s second warning); `notifications` SELECT and UPDATE
  carry **identical** quals including `089`'s type-scoped `club_join_request_declined` disjunct.
  The pins, so a difference is visible in one line rather than by reading four quals:
  ```sql
  select tablename, cmd, md5(qual) from pg_policies
   where schemaname='public'
     and (tablename in ('clubs','club_members') and cmd='SELECT'
          or tablename='notifications' and cmd in ('SELECT','UPDATE'));
  -- clubs        SELECT 4299c23bc61a3b5f53c580631cdf941c   (085's own recorded pin — must NOT move)
  -- club_members SELECT 9d075352246e30fe8dcdd2da25669518   (must NOT move)
  -- notifications SELECT 28ab04505c62f16147539f78b521a858  } equal to each other, and BOTH move
  -- notifications UPDATE 28ab04505c62f16147539f78b521a858  } together in §5.2
  ```
- [ ] 0.3 Confirm the migration number. `093` is the intended one; `092`, `094` and `095` are held by
  three concurrent changes, so re-derive rather than trust: `ls supabase/migrations/ | tail -5`, and
  `list_migrations` against both refs. **91 applied on DEV and 91 on PROD, measured 2026-08-31** —
  level, which is the exception rather than the resting state.
- [ ] 0.4 Record the gate-trigger count **before**, so the after-count means something. **17 on DEV,
  17 on PROD.** Assert the **delta of +2 and the two table names**, never the absolute — `092` takes
  it to 19 before this file:
  ```sql
  select count(*) from pg_trigger where tgname='enforce_participation_gate' and not tgisinternal;
  ```
- [ ] 0.5 Record the security-advisor count **before**. Expected delta **+6**, one
  `authenticated_security_definer_function_executable` per new `public` definer function and **none**
  for the fifteen in `private` — `085` is the worked example, eleven functions for three advisors.
  `mcp__Supabase__get_advisors <ref> security`.
- [ ] 0.6 Read both `notifications` CHECK constraints verbatim; §5 rewrites them and they are existing
  objects on a live table:
  ```sql
  select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.notifications'::regclass and contype='c';
  ```
  **Eleven types today.** Confirm `notifications_event_key` is still `NULLS NOT DISTINCT` over the
  four subject columns — the collapse §5.5 depends on:
  ```sql
  select indexdef from pg_indexes where indexname='notifications_event_key';
  ```
- [ ] 0.7 Confirm `club_members`' column grants, because §1.3 adds a column to a live table and its
  unwritability is inherited rather than declared. Measured: `authenticated` holds INSERT on
  `(club_id, role, user_id)` and no table-level UPDATE, so a new column is unwritable by default:
  ```sql
  select privilege_type, string_agg(column_name, ',' order by column_name)
    from information_schema.column_privileges
   where table_schema='public' and table_name='club_members' and grantee='authenticated'
   group by privilege_type;
  ```
- [ ] 0.8 Confirm `pgcrypto` is installed in `extensions` on both projects (`091` recorded it on DEV);
  `create extension if not exists pgcrypto with schema extensions` is a no-op there and keeps the file
  correct on a scratch replay.
- [ ] 0.9 Read the design offline. **Do not call the Figma API.** `npm run figma -- ls "*nvite*"`,
  then `tree` and `--all` on anything that matches. Expect **no v2 frame** for a club invite, its link
  section or its landing screen — `091` found only `Invite riders` / `Invite riders - Filled` on the
  OLD stylesheet and an archived `Join ride without account`. Assemble from measured components and
  say so in the PR rather than calling it measured.
- [ ] 0.10 Read the three files this change **reuses rather than rebuilds** —
  `src/components/clubs/ClubPreviewScreen.tsx`, `ClubDetailHeader.tsx` and `ClubPreview` in
  `src/types/index.ts`. Measured 2026-08-31: the screen draws the header, a `Private club` line, the
  location, `N riders`, the private-club sentence and one action block driven by `request_status`;
  it renders **neither latitude nor longitude**, which is why §4.6 drops them; and
  `ClubDetailHeader` mounts `ClubOptionsMenu` only on its `ClubDetail` arm, so a token holder gets no
  options menu for free.
- [ ] 0.11 Read `src/components/clubs/ClubOptionsMenu.tsx` and the club thread screen's menu **at the
  moment you start** — both are being edited by concurrent work (a `Threads` row landed 2026-08-31),
  so the file is not what any earlier reading of it said.

## 1. `093` — the two tables and the one column

- [ ] 1.1 `club_invites (id, club_id, invitee_id, inviter_id, status, created_at, responded_at)`.
  `club_id → clubs(id) on delete cascade`; `invitee_id` and `inviter_id → profiles(id) on delete
  cascade`, **both**, because the row records a relationship between two identified riders and
  `029`'s erasure contract has to reach it from both ends. `unique (club_id, invitee_id)`,
  `check (invitee_id <> inviter_id)`, `check (status in ('pending','declined'))` — **two values, not
  three**, per `085`: accepting deletes the row — and
  `check ((status = 'pending') is not distinct from (responded_at is null))`, `is not distinct from`
  rather than `=` per `073`.
- [ ] 1.2 `club_invite_links (id, club_id, created_by, token, expires_at, created_at, revoked_at)`.
  `token` defaults to `encode(extensions.gen_random_bytes(16), 'hex')` with `unique` and
  `check (token ~ '^[0-9a-f]{32}$')`; `expires_at` defaults to `now() + interval '14 days'` —
  **a column default, not `091`'s trigger**, because there is no second table to read. Both are
  server-owned by the **absent grant**, never by the default: a default applies only when the column
  is omitted and PostgREST will happily name it.
- [ ] 1.3 `alter table public.club_members add column invite_link_id uuid references
  public.club_invite_links(id) on delete set null`. **`set null`, never cascade** — deleting a link
  must not delete the riders it admitted. No grant is added in either direction; §0.7 is why that is
  already true.
- [ ] 1.4 Indexes, each named with the FK it discharges (`029`: every FK into `profiles` **leads** an
  index). `club_invites`: the unique index leads with `club_id`; add `(invitee_id, created_at desc,
  id desc)` — also the invitee's own list — and `(inviter_id)`, and `(club_id, status, created_at
  desc, id desc)` for the admin's list. `club_invite_links`: `(club_id)` and `(created_by)`; **no
  second index on `token`**, the unique constraint already builds one. `club_members`:
  `(invite_link_id)`, which discharges the new FK and serves the use count.
- [ ] 1.5 `alter table … enable row level security` on both.
- [ ] 1.6 `comment on table` for each and `comment on column` for `status`, `token`, `expires_at`,
  `revoked_at` and `club_members.invite_link_id`. Each SHALL state its retention explicitly and
  `invite_link_id`'s SHALL carry `091`'s provenance rule verbatim: no policy, trigger or read
  predicate may branch on it, and the derived count can go **down**.

## 2. `093` — the helpers, one body and two entry points

- [ ] 2.1 `private.may_invite_to_club_for(candidate, club)` — `is_club_admin_for(candidate, club) or
  (the club is public and is_club_member_for(candidate, club))`. **No client grant**: it answers for
  any pair and is an admin oracle. Wrapper `private.may_invite_to_club(club)` is **exactly** the
  delegation, granted to `authenticated` because an RLS expression runs as the querying role — and
  pinned by **equality**, never `like`, per `060`/`085.28`: a comment mentioning the name satisfies a
  pattern match.
- [ ] 2.2 `private.may_mint_club_link_for(candidate, club)` — `is_club_admin_for(…) and not the club
  is public`, plus its wrapper. The `not is_public` conjunct is decision 1 and carries its own comment
  saying why a public club gets no token.
- [ ] 2.3 `private.club_takes_invites_for(candidate, club)` — the invitee-side admissibility: the club
  exists, `is_default = false`, `candidate <> owner_id`, not already a member, **and no `pending`
  `club_join_requests` row for the pair**. **No client grant**, and **no block conjunct** — see 3.4.
- [ ] 2.4 `private.club_invite_is_answerable_for(candidate, invite)` — pending or declined, addressed
  to the candidate, `may_invite_to_club_for(inviter, club)` still true, neither block standing, both
  stamps. **One body, three callers** (the accessor, the accept, and the notification arm's wrapper).
- [ ] 2.5 `private.has_live_club_invite_for(candidate, club)` and its wrapper
  `private.has_live_club_invite(club)` — the notification policy arm's predicate. `in ('pending')`
  written as an inclusion, **never** `<> 'declined'`: a fourth status added later must grant nothing
  by default, and an inequality defaults to granting everything (`036`'s `else false` shape).
- [ ] 2.6 `private.live_club_invite_link(t)` — **the single definition of "live"**, a statement about
  the link alone: token matches, `revoked_at is null`, `now() < expires_at`, the club still exists.
  No caller, no `auth.uid()`, zero rows for every dead state, never raises.
- [ ] 2.7 `private.club_invite_link_reachable_by(t, uid, lock default false)` — **the single
  definition of "this caller may use this token"**, and the only entry point either RPC has. Live,
  minter still authorised, not blocked with the minter, not blocked with the owner, both stamps, not
  already a member, not the owner. `if lock then perform 1 from club_invite_links where token = t for
  share; end if` **before** liveness resolves. **VOLATILE** — Postgres refuses `FOR SHARE` in a
  non-volatile function, and `stable` would also let PostgREST serve it over GET with a live token in
  the query string.
- [ ] 2.8 `revoke all` from `public, anon, authenticated` on every `_for` twin and on every helper
  that takes no caller. Grant EXECUTE to `authenticated` **only** on the wrappers an RLS expression
  calls. Assert by **role name** (`has_function_privilege`), never by calling — the suite runs as the
  table owner, for whom neither barrier exists (`031`).

## 3. `093` — policies, grants, and the two triggers

- [ ] 3.1 `club_invites` SELECT: `(invitee_id = auth.uid() or inviter_id = auth.uid()) and not
  is_blocked(auth.uid(), invitee_id) and not is_blocked(auth.uid(), inviter_id)`. **No arm reads
  `clubs`** — comment why: it would hand every member of a public club the invites of a private one,
  and for a private club it is circular.
- [ ] 3.2 `club_invites` INSERT: `inviter_id = auth.uid() and private.may_invite_to_club(club_id) and
  not private.is_blocked(auth.uid(), invitee_id)`. Per-column grant over `(id, club_id, invitee_id,
  inviter_id)` — `status`, `created_at` and `responded_at` on none of them.
- [ ] 3.3 `club_invites` DELETE: `((inviter_id = auth.uid() and status = 'pending') or
  private.is_club_admin(club_id)) and not private.is_blocked(auth.uid(), invitee_id)`. The `status`
  scope is what makes a refusal stick against the inviter; the block conjunct is `036` §4's rule —
  without it an affected-row count is a number an admin can compare against the list they were shown.
- [ ] 3.4 `private.enforce_club_invite_is_admissible()` — `security definer` BEFORE INSERT, raising
  `check_violation` when `club_takes_invites_for(new.invitee_id, new.club_id)` is false. It exists
  because the policy cannot ask an invitee-side question without granting an oracle
  (`enforce_ride_club_audience` is the same shape). **It tests no block**, and its comment says why: a
  raise naming a block between the invitee and the club's owner would disclose a block to a third
  rider, which decision #2 forbids by any gap, count or marker.
- [ ] 3.5 `club_invite_links` SELECT / INSERT / DELETE, all `private.is_club_admin(club_id)`-based, so
  the row follows the **club** and not `created_by`; INSERT additionally `created_by = auth.uid() and
  private.may_mint_club_link(club_id)`. Per-column grant over `(id, club_id, created_by)`.
- [ ] 3.6 **No UPDATE policy and no UPDATE grant on either table**, and the absence is the
  enforcement. Assert in both directions per grantee — a well-meaning `grant all` restores only one
  of them.
- [ ] 3.7 `revoke all … from anon, authenticated` first, then the grants above. Nothing to `anon`,
  ever — decision #1.
- [ ] 3.8 `enforce_participation_gate` on **both** tables, `before insert … for each row when
  (current_user = 'authenticated')`. The `when` clause is not decoration (`023` §2). Restamp
  `comment on function public.enforce_participation_gate()` with the new count and both names — it is
  the `data` agent's first read through `list_tables` and no edit to `CLAUDE.md` reaches it.

## 4. `093` — the write path and the six RPCs

- [ ] 4.1 `private.join_club_from_invite(rider, target_club, admitter)` — the **single** place any
  invite path writes a `club_members` row. Restates, in order: `may_participate_for(rider)` (**never**
  the caller-relative `may_participate()`, `085`'s trap), `may_invite_to_club_for(admitter,
  target_club)`, `is_blocked(rider, owner_id)`, `is_blocked(rider, admitter)`. Writes `'member'` as a
  **literal** with no role argument (`019`), `on conflict do nothing`. **Returns `false` rather than
  raising** on every refusal, so the caller keeps one observable failure. Then deletes any `pending`
  `club_join_requests` row for the pair — **after** the membership insert, so `085`/`087`'s retraction
  clears the admins' notification.
- [ ] 4.2 `public.accept_club_invite(invite uuid)` — takes an **invite id, never a rider id**; answers
  `pending` **or** `declined` (the invitee alone may reopen their own refusal); calls 4.1; **then**
  deletes the invite row; **one raise site**.
- [ ] 4.3 `public.decline_club_invite(invite uuid)` — `pending` only; sets `status` and
  `responded_at`; writes no membership; **one raise site**.
- [ ] 4.4 `public.my_live_club_invites()` — the invitee's answerable invites, filtered by 2.4. A fixed
  list of **named columns**, never `club_invites.*` or `clubs.*`. Assert it discloses nothing
  `discoverable_private_clubs` does not already give that rider.
- [ ] 4.5 `public.claim_club_invite_link(t text)` — resolves through
  `club_invite_link_reachable_by(t, uid, lock => true)` and nothing else, then calls 4.1 with the
  link's `created_by` as admitter, writing `club_members.invite_link_id`. **One raise site.** Takes
  the token and never a club id or a rider id.
- [ ] 4.6 `public.club_invite_link_preview(t text)` — **six named columns**: `club_id`, `name`,
  `avatar_path`, `location_name`, `members_count`, `is_public`. `returns table`, never `setof
  public.clubs`. Zero rows for every dead state, **raises nothing**. `t` compared as text, so a
  malformed string matches no row rather than confirming the format.
  **Reconcile the list against `discoverable_private_clubs`' seven in the migration comment**, per
  `design.md` §The landing screen is the club's own preview screen: both feed the same screen, both
  are `security definer` with no policy underneath, so a difference between them is a **disclosure
  decision** and not a mapping detail. This one drops `latitude`/`longitude` (the screen draws
  neither) and adds `is_public` (the accessor's predicate implies it; a token can outlive a flip).
- [ ] 4.7 `public.revoke_club_invite_link(link uuid)` — an RPC rather than an UPDATE grant, because a
  grant on `(revoked_at)` lets a client un-revoke by writing NULL. One raise site. Its comment states
  that it **removes nobody** and that `088`'s removal does **not** bar re-entry through a live token.
- [ ] 4.8 `revoke all … from public, anon` then `grant execute … to authenticated` on all six.
  **Neither 4.5 nor 4.6 may contain an `is_blocked` call or a `profiles` stamp test** — assert by
  reading `prosrc`, `091.13`'s shape.

## 5. `093` — notifications

- [ ] 5.1 Widen `notifications_type_check` with `club_invited` and `club_invite_declined`, and
  `notifications_subject_shape` with two arms requiring `club_id is not null` and the other three
  NULL — **identical to `club_joined`'s**, so `036` §3's per-column conjuncts already cover them.
  **Both CHECKs in the same block**; verify the `else false` fallthrough survives the rewrite.
- [ ] 5.2 Add **one** type-scoped disjunct to the `notifications` **SELECT** policy:
  `or (type = 'club_invited' and private.has_live_club_invite(club_id))` — `089`'s pattern, its second
  instance. **And the identical change to the UPDATE policy**, in the same statement block: the two
  quals are byte-identical today and moving only the read gives the invitee a notification they can
  see and can never mark read.
  **These two pins are SUPPOSED to move.** Every other pin — `clubs` SELECT, `private.can_read_club`,
  `club_join_requests`' three policies — must **not**, and a failure there means this change is wrong
  rather than that the pin is stale.
- [ ] 5.3 `private.notify_club_invited()` — `after insert on club_invites`, recipient `new.invitee_id`
  read from the row, actor `new.inviter_id`, guarded on `not is_blocked(invitee, inviter)`, `not
  is_blocked(invitee, owner)` and the resolvability check, `on conflict do nothing`.
- [ ] 5.4 `private.notify_club_invite_declined()` — `after update of status`, guarded on the value
  actually moving (`old.status is distinct from new.status`) and on `new.status = 'declined'`.
  Recipient is the **inviter alone**, not every admin: the invite was one rider's act and fanning a
  refusal to a whole admin team discloses one rider's answer to people who did not ask.
- [ ] 5.5 **No retraction trigger, and the absence is deliberate** — `090`'s measured reason. Write it
  in the migration: with one, withdraw-and-re-send re-notifies without limit because the deleted row
  never collides with `notifications_event_key`. A later session's first instinct will be to "fix"
  the omission.
- [ ] 5.6 **No `club_invite_accepted` type.** `private.notify_club_joined` already fans `club_joined`
  out to the owner and admins on the `club_members` INSERT the accept performs. Comment it, because
  the symmetry with `083` makes its absence look like an oversight.
- [ ] 5.7 Neither fan-out carries a `when (current_user = …)` clause — `036` trap (a), and here it is
  load-bearing: `decline_club_invite` is `security definer`, so `current_user` is the owner and such a
  clause would disable the decline fan-out entirely. Neither reads `auth.uid()` — trap (b).
  `revoke all` on both from `public, anon, authenticated`.

## 6. RLS assertions — paired with §§1–5, per `openspec/config.yaml`

Each is a statement about a **role** and a **resource**. Verify every one **both ways** per
`CLAUDE.md` §Working Principles: confirm it fails against the mistake it names.

- [ ] 6.1 A `member` of a **private** club cannot insert an invite; an `admin` and the `owner` can.
  A `member` of a **public** club **can**. A non-member cannot, for either kind.
- [ ] 6.2 An invite to the club's owner, to an existing member, to the default club, and to a rider
  with a **pending join request** are each refused with `23514` by the admissibility trigger; a
  self-invite is refused by the CHECK.
- [ ] 6.3 A repeat invite is `23505`; no second notification is written.
- [ ] 6.4 A pending invitee reads **zero** rows from `club_members`, `club_threads`, `club_messages`,
  the club's rides and its postcards. (Fails if any arm was added to `clubs` SELECT.)
- [ ] 6.5 `clubs` SELECT's qual and `private.can_read_club`'s `prosrc` are **byte-identical** to the
  values the suite already pins. So are `club_join_requests`' three policies.
- [ ] 6.6 The invitee reads exactly one `club_invited` notification for a **private** club — the
  assertion that fails without §5.2 — **and** can mark it read, which is the assertion that fails when
  only the SELECT policy moves. Two cases, not one.
- [ ] 6.7 A rider holding **no** live invite reads zero `club_invited` rows for that club; and the row
  becomes unreadable the moment the invite is withdrawn, the inviter is demoted, or either block is
  placed. Four cases against one predicate.
- [ ] 6.8 Blocking, in **both** directions and at all four sites: the INSERT policy refuses; the
  fan-out writes nothing; the accessor returns nothing; the accept raises. A rider blocked with the
  **owner** but not with the inviter is refused at the accept with the same single message.
- [ ] 6.9 Accepting writes exactly **one** `club_members` row with `role = 'member'`, deletes the
  invite, deletes a pending request, retracts the admins' `club_join_requested` notification, and
  fans out exactly one `club_joined`. Count each; do not assume.
- [ ] 6.10 An accept by an **un-onboarded** rider writes nothing, and the refusal comes from
  `may_participate_for` inside the writer — asserted for the claim path too, where the caller-relative
  form would have answered for the wrong rider.
- [ ] 6.11 The inviter cannot delete a `declined` invite; an admin can; the invitee can reopen their
  own refusal through accept.
- [ ] 6.12 A `member` cannot mint a link; an `admin` and the `owner` can; **a mint on a public club is
  refused**. A co-admin who did not mint can list and revoke.
- [ ] 6.13 Eleven dead-token states — expired, revoked, club deleted, minter demoted, minter departed,
  blocked with minter, blocked with owner, un-onboarded, already a member, the owner, malformed —
  return **zero rows** from the preview and the **identical message and SQLSTATE** from the claim.
  Compare the **message**, not only the SQLSTATE: a SQLSTATE-only comparison passes green with an
  oracle present.
- [ ] 6.14 The preview's return list is exactly six named columns, asserted against
  `pg_get_function_result` so a seventh is a red test.
- [ ] 6.15 Neither public RPC's `prosrc` contains `is_blocked` or `terms_accepted_at`.
- [ ] 6.16 A claim writes one membership carrying `invite_link_id`; a second claim by the same rider
  writes nothing and does not move the derived count; deleting the link nulls the column and keeps
  every membership.
- [ ] 6.17 **No policy, trigger or helper references `invite_link_id`** — read `pg_policies` quals and
  `prosrc`, so provenance cannot become an audience test.
- [ ] 6.18 `anon` holds **no** privilege on either new table and EXECUTE on none of the six RPCs; no
  policy targets a role other than `authenticated`.
- [ ] 6.19 No UPDATE grant and no UPDATE policy on either table, asserted per grantee in both
  directions.
- [ ] 6.20 Every `_for` twin is unreachable by `authenticated` and every wrapper an RLS expression
  calls is reachable — by `has_function_privilege`, never by calling (`031`).
- [ ] 6.21 Each wrapper's body is **exactly** the delegation, pinned by equality rather than `like`
  (`085.28`).
- [ ] 6.22 `enforce_participation_gate` is present **by table name** on both new tables and the flat
  count rose by exactly **two**. Both, because a count alone cannot tell a new gate from a moved one.
- [ ] 6.23 The trigger count on `club_members` is **unchanged** — `078.9`'s lesson.
- [ ] 6.24 Every FK into `profiles` and into `clubs` on the new tables **leads** an index — the
  `pg_constraint` / `pg_index` form, never a timing.
- [ ] 6.25 Cascades: deleting the club, the invitee, the inviter and the minter each removes what it
  should and nothing it should not; a deleted link leaves its memberships standing.
- [ ] 6.26 Re-run the whole suite and **compare label sets, not counts** — a count cannot tell a
  rename from a loss.

## 7. Client

- [ ] 7.1 `src/lib/data/club-invites.ts` and `src/lib/data/club-invite-links.ts` through
  `resolveSupabase`. Neither restates a membership, block, visibility or role predicate; each
  docstring says so, and says which side is definer-read (no policy underneath) and which is
  policy-read.
- [ ] 7.2 `src/lib/actions/club-invites.ts` and `…/club-invite-links.ts` — plain async functions, one
  per mutation, each naming exactly what it invalidates.
- [ ] 7.3 **One shared component owns the `is_public` branch** — `ClubShareOrInviteItem` — mounted by
  `ClubOptionsMenu` **and** by the club thread screen's menu, which PD-356 added knowingly carrying
  the defect. Three states: public → `Share club`; private + admin → `Invite riders`; private +
  non-admin → **nothing**. An **unknown** visibility renders nothing. `is_public` is already on
  `ClubDetail`; if the thread screen does not hold it, add it to that screen's existing club read
  rather than issuing a second query.
- [ ] 7.4 Five keys in `src/lib/query/keys.ts`, each with the docstring that file's convention
  requires and the token **in** the preview key. No key written inline in a component.
- [ ] 7.5 `/clubs/join` — a top-level route beside `/rides/join`, not under `(app)`: the `(app)`
  layout is the authenticated shell and drawing four tabs for a visitor offers four taps that all
  bounce. **Two guard edits**: `PUBLIC_PATHS` **and** `needsOnboardingState()`.
- [ ] 7.6 Generalise `src/lib/invites/pending-token.ts` to hold **two** keys, one per token kind, and
  make `signOut` clear the module rather than a named key.
- [ ] 7.7 The landing screen **is `ClubPreviewScreen`**, not a bespoke invite card — the product
  owner's browse-then-join refinement, `design.md` §The landing screen is the club's own preview
  screen. Four parts, and each fails silently if missed:
  - **7.7a** The signed-in branch renders `ClubPreviewScreen` fed by `club_invite_link_preview`.
    The screen gains **one optional `action` prop**; `085`'s call site passes nothing and is
    unchanged. On the token path the action is `Join club`, and it must win over `request_status`
    entirely — a rider holding **both** a pending request and a token sees `Join club`, because the
    claim is the immediate route and it clears the request.
  - **7.7b** The `Private club` line and the private-club sentence become **conditional on
    `is_public`**. They are unconditional today and correct today, because `085`'s accessor cannot
    return a public club; a token can, if the club flipped after the link was minted.
  - **7.7c** `Join club` sits in a **sticky bottom action of the screen's own** — **not** the
    Navbar's 152px slot, which renders only inside `(app)`. Mounting the app shell on this public
    route would draw four tabs that all bounce to the login screen for the visitor the route exists
    for.
  - **7.7d** **No `useEffect`, no auth-state listener, one claim call site, inside a handler.**
    Signed out renders a generic screen naming neither club nor minter, mounts **no**
    `ClubPreviewScreen` (there is nothing to show and its back arrow would bounce) and issues no RPC.
    `undefined` is a skeleton, `null` is one dead-link message, a thrown read is an error with a
    retry.
- [ ] 7.8 `ClubInviteActions` on the notification row reads the **live** invite through
  `my_live_club_invites()` and renders `null` when there is none — `RideInviteActions`' shape, and
  what makes `090`'s standing notification degrade to plain text.
- [ ] 7.9 `notificationCopy`, `NotificationsListItem`'s `describe` and `NotificationType` gain both
  types. All three are exhaustive; missing one is a runtime break in the two that are not typed.
- [ ] 7.10 Icons from `@/components/icons/generated`. Primary buttons near-black `Grey/100`, never
  green.

## 8. Ordering — the one part that cannot be reordered

- [ ] 8.1 Merge to `development`. Vercel builds the Preview against `letsride-dev`.
- [ ] 8.2 **Confirm DEV is serving the new bundle** — a `READY` deployment on the merge sha,
  `aliasError` null — **then** apply `093` to DEV. `089`'s rule: additive in schema, ordered by the
  **client**, because `notificationCopy` and `describe` are exhaustive switches and one `club_invited`
  row under an older bundle takes that rider's notifications screen down.
- [ ] 8.3 **`036`'s hand-exercise gate, on DEV, in a rolled-back transaction, as `authenticated`.**
  This file is additive and **not inert**: it replaces two live `notifications` policies, and
  `private.notify_club_joined` fires `after insert on club_members` with no `when` clause, so it now
  runs inside `private.join_club_from_invite` and a raise there takes a rider's accept down with it.
  Exercise: (a) an ordinary club join, the unchanged path; (b) an accept into a private club; (c) a
  claim into a private club; (d) an accept into a club whose owner holds no `club_members` row
  (`054`'s ownerless owner); (e) a read of an existing rider's notifications list, because the SELECT
  policy moved for everyone.
- [ ] 8.4 `get_advisors(security)` on DEV. Expect **+6**, one per new `public` definer function and
  **none** for the fifteen in `private`. A seventh means a revoke did not land or something was
  created in `public` that belongs in `private`.
- [ ] 8.5 Promote to `main`. Confirm production is **serving** the new bundle, then apply `093` to
  PROD, then repeat 8.3 and 8.4 there.
- [ ] 8.6 **This change has no destructive statement**, so the additive-first/destructive-last split
  has nothing on its second half. The rollback order is stated in the file's header instead, and it
  is: the two fan-out triggers first, then their functions, then the six RPCs, then
  `join_club_from_invite`, then the helpers, then restore both `notifications` policies and both
  CHECKs to their eleven-type form, then `club_members.invite_link_id`, then `club_invite_links`, then
  `club_invites`. Dropping a table first leaves a helper referencing a missing relation.
- [ ] 8.7 Record the applied state with the command that checks it — `list_migrations` against both
  refs, against `ls supabase/migrations/` — never a number typed by hand.

## 9. Tests

- [ ] 9.1 `PGPASSWORD=postgres npm test` — the RLS suite, green, with §6's assertions in it.
- [ ] 9.2 A component test for `ClubShareOrInviteItem` asserting the **absence** of any row for a
  private club's ordinary member, and that both callers render the same three states. An assertion
  that something renders cannot see a row that should not.
- [ ] 9.3 A component test for the landing screen on
  `src/components/rides/__tests__/RideInviteJoin.test.tsx`'s model — the one test in the repo that
  asserts an **absence in the source** — checking on **comment-stripped source** that there is no
  `useEffect`, no `onAuthStateChange` listener and exactly one claim call site, and in markup that
  the signed-out screen renders no club data for any token. **Strip the comments first**: that
  component's own docstring says "there is no `useEffect` in this file", which failed the first
  version of its test against a correct file. Verify both ways — inserting a real claiming effect
  must fail every source case.
- [ ] 9.4 A component test for `ClubPreviewScreen`'s two new behaviours: that the `action` slot
  replaces the request block entirely (asserted as the **absence** of `Request to join club` when an
  action is supplied), and that the `Private club` line is **absent** for `is_public: true`. Both are
  one-line reversals that screenshot plausibly against a private club, which is every club `085`
  sends to that screen.
- [ ] 9.5 A unit test that `signOut` clears **both** stashes, asserted by reading the storage keys
  rather than by calling the accessors.
- [ ] 9.6 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 9.7 `npm run walk` reaches `/clubs/detail` and `/clubs/join`; confirm both render. The landing
  route is public, so the walk's signed-out phase can reach it.
- [ ] 9.8 `npm run docs:check` after §10.

## 10. Documentation

- [ ] 10.1 `docs/reference/schema.md` — two new table rows and the `club_members` column, each with
  its audience predicate, its cascade behaviour and its per-column grants. The `club_invites` row must
  state that **accepting deletes it** and why, because that is the counter-intuitive one and that file
  exists for exactly those.
- [ ] 10.2 `docs/reference/product-scope.md` — the Clubs row: what invites now cover and what they
  deliberately do not (no token on a public club, no removal-proof link, no invite expiry).
- [ ] 10.3 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` from an agent; the main thread owns both.
  The advisor count `+6`, the gate-trigger paragraph `+2` and the notification-type count all move,
  and all three are that thread's to write.
