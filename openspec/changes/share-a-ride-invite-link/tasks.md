# Tasks — an invite link for a ride

Ordered so the migration lands, is asserted and is exercised **before** any screen is built.
Sections 1–5 are one migration and its assertions; 6 is the gates; 7–9 are the app.

## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **Settle the archive order with `invite-riders-to-a-ride`.** This change's
  `specs/ride-invites/` delta modifies a capability that is **not yet in `openspec/specs/`** —
  PD-329's change is still active. Archive `invite-riders-to-a-ride` first, or this delta has no
  base text to attach to. Confirm with `npm run openspec -- list --json`. **The `openspec` CLI is
  not installed in every container** (`node_modules` absent → `openspec: not found`); if it is
  missing, `npm ci` first rather than skipping the check.
- [ ] 0.2 **Put §The gap revoke leaves open to the product owner.** `proposal.md`'s opening
  warning: there is **no** remove-rider path for a ride, so revoking a link cannot remove the
  riders it admitted and the organizer's only remedy is a block. Ask whether to file
  `remove_ride_member` as its own story. **Owner-only, and it does not block this build** — but
  the Revoke button's copy must not imply a removal that cannot happen.
- [ ] 0.3 Re-derive the migration number: `list_migrations` on DEV (`fpmrimzxadewsaiwpsel`) and
  PROD (`zwprydcyryvudhurbnye`) against `ls supabase/migrations/`. Measured 2026-08-29: 89 files,
  DEV `089`, PROD `079`. This change is **`090` unless PD-332 — building in the same session —
  has taken it**. Promote the ten-file DEV/PROD gap in filename order per `docs/ENVIRONMENTS.md`
  §Migrations before adding to it.
- [ ] 0.4 **Assert PD-332 has landed and `retract_ride_invited` is gone**:
  `select tgname from pg_trigger where tgrelid = 'public.ride_invites'::regclass and not
  tgisinternal`. Nothing here depends on that trigger, and a session that finds it still present
  should stop and reconcile rather than assume.
- [ ] 0.5 Record the **before** numbers so the after-numbers mean something, read against the
  **branch** rather than `development`: gate triggers (`select count(*) from pg_trigger where
  tgname = 'enforce_participation_gate' and not tgisinternal` — **16** on DEV, measured),
  `get_advisors(security)` (expected delta **+3**), and the RLS suite's **label set** via
  `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"` — reconcile by label set, never by
  count, because a count cannot tell a rename from a loss.
- [ ] 0.6 Read the **live** comment on `public.enforce_participation_gate()` before writing the
  restamp. Do not take a number from `CLAUDE.md`.
- [ ] 0.7 Confirm the four facts the design rests on, from the catalog rather than from this file:
  `pgcrypto` is installed (`extensions` schema on DEV — so `extensions.gen_random_bytes`);
  `rides.departure_at` is `not null`; `private.join_ride_from_invite` still restates the
  participation gate and calls `private.can_read_ride`; and `ride_members`' only DELETE policy is
  still `auth.uid() = user_id`.
- [ ] 0.8 Accept or overturn `design.md` §Questions Closed Q1–Q6. **All six are non-blocking and
  all have defaults**; Q1 (the 14-day ceiling) is the product judgement and Q6 is owner-only.

## 1. Migration — the table

- [ ] 1.1 Create `public.ride_invite_links`: `id uuid default uuid_generate_v4() primary key`,
  `ride_id uuid references public.rides(id) on delete cascade not null`,
  `created_by uuid references public.profiles(id) on delete cascade not null`,
  `token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')`,
  `expires_at timestamptz not null`, `created_at timestamptz default now() not null`,
  `revoked_at timestamptz`.
- [ ] 1.2 Add `constraint ride_invite_links_token_shape check (token ~ '^[0-9a-f]{32}$')`.
- [ ] 1.3 `alter table public.ride_invite_links enable row level security;`
- [ ] 1.4 Index `(ride_id)` — the organizer's list read and the ride cascade. The `unique` on
  `token` already serves every lookup; **add no second index on it.**
- [ ] 1.5 Index `(created_by)` — discharges the profile cascade, per the standing rule that every
  cascade path is indexed.
- [ ] 1.6 BEFORE INSERT trigger setting
  `new.expires_at := least((select r.departure_at from public.rides r where r.id = new.ride_id),
  now() + interval '14 days')`. **Not a default** — a default cannot read another table.
- [ ] 1.7 Add `enforce_participation_gate` BEFORE INSERT. Expect the count to go **16 → 17**.
- [ ] 1.8 Restamp the comment on `public.enforce_participation_gate()`, extending its enumeration
  by `ride_invite_links`.

## 2. Migration — `ride_invites.link_id`

- [ ] 2.1 `alter table public.ride_invites add column link_id uuid references
  public.ride_invite_links(id) on delete set null;` — **`set null`, never `cascade`.**
- [ ] 2.2 Index `(link_id)` — the use count reads by it, and it discharges the new cascade.
- [ ] 2.3 **Do not add `link_id` to any grant.** Confirm `information_schema.column_privileges`
  still shows INSERT on `(id, ride_id, invitee_id, inviter_id)` for `authenticated` and no UPDATE
  at all.
- [ ] 2.4 Comment the column: provenance only, and no policy, trigger or helper may branch on it.

## 3. Migration — policies, grants and the liveness helper

- [ ] 3.1 `grant select, insert (id, ride_id, created_by), delete on public.ride_invite_links to
  authenticated;` — **no UPDATE, and `token`/`expires_at`/`created_at`/`revoked_at` outside the
  insert list.** Revoke everything from `anon`.
- [ ] 3.2 SELECT policy: the ride's organizer, `to authenticated`. A link is the organizer's
  administrative object; no claimer needs to read the row, because the RPCs read it as owner.
- [ ] 3.3 INSERT policy: `created_by = auth.uid()` **and** an `EXISTS` against `public.rides`
  where `organizer_id = auth.uid()`, evaluated under the caller's own row security.
- [ ] 3.4 DELETE policy: organizer only. Deleting a link is a stronger revoke and must not remove
  its riders — `2.1`'s `set null` is what guarantees that.
- [ ] 3.5 `private.live_ride_invite_link(t text)` — `security definer`, `stable`,
  `set search_path = ''`, `#variable_conflict error`. Returns the link row joined to its ride where
  `token = t` **and** `revoked_at is null` **and** `now() < expires_at` **and**
  `now() < rides.departure_at`. `revoke all ... from public, anon, authenticated`.
  **This is the only definition of "live" in the change.**
- [ ] 3.6 Comment it saying so, and naming its two callers.

## 4. Migration — the three RPCs

- [ ] 4.1 `public.ride_invite_link_preview(t text)` — `security definer`, `stable`,
  `set search_path = ''`, `returns table (...)` with the **eight named columns**: ride id, title,
  `departure_at`, `timezone`, `meeting_point`, organizer username, organizer avatar path, crew
  count. **Never `rides.*`.**
- [ ] 4.2 In its body: resolve through `private.live_ride_invite_link`, then **restate the block
  check** — `not private.is_blocked(auth.uid(), r.organizer_id)`. Return zero rows for every
  failure; **raise nothing.**
- [ ] 4.3 `public.claim_ride_invite_link(t text)` — `security definer`, `volatile`,
  `set search_path = ''`, `#variable_conflict error`, returns the ride id. **One raise site.**
- [ ] 4.4 Its body, in this order and no other: `auth.uid()`; resolve liveness; block check;
  **then** the `ride_invites` upsert; **then** `private.join_ride_from_invite(v_uid, v_ride)`.
  Every one of the first three failures reaches the **same** raise.
  See `design.md` §The two orderings — reversing either fails silently.
- [ ] 4.5 The upsert: `insert ... (ride_id, invitee_id, inviter_id, status, responded_at, link_id)
  values (v_ride, v_uid, v_link.created_by, 'accepted', now(), v_link.id)
  on conflict (ride_id, invitee_id) do update set status = 'accepted', responded_at = now(),
  link_id = coalesce(public.ride_invites.link_id, excluded.link_id)` — **`inviter_id` is not in
  the update list**, so the first invite keeps its inviter.
- [ ] 4.6 **Do not modify `private.join_ride_from_invite`.** It gains a caller and nothing else.
- [ ] 4.7 `public.revoke_ride_invite_link(link uuid)` — `security definer`, one raise site, sets
  `revoked_at = now()` where the caller organizes the link's ride and `revoked_at is null`.
- [ ] 4.8 Grants: `revoke all ... from public, anon` and `grant execute ... to authenticated` on
  all three. Comment each, naming the raise-site rule and what it deliberately does not disclose.

## 5. Migration — the fan-out narrowing

- [ ] 5.1 `drop trigger notify_ride_invited on public.ride_invites;` then recreate it
  `AFTER INSERT ... FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION
  private.notify_ride_invited();`. **The function body is unchanged.**
- [ ] 5.2 Leave `notify_ride_invite_answered` alone — the conflict branch's notification is true.
- [ ] 5.3 Add no notification type. Confirm `notifications_type_check` still holds `083`'s eight.
- [ ] 5.4 Header the migration with its rollback, **in order**: drop the three public RPCs, then
  `private.live_ride_invite_link`, then restore `notify_ride_invited` without its `WHEN`, then drop
  `ride_invites.link_id`, then the table last. Dropping the table first leaves `link_id`
  referencing a missing relation.

## 6. Assertions and gates — before any UI

- [ ] 6.1 Add assertions to `supabase/tests/rls_test.sql`, **one per negative case in
  `specs/ride-invite-links/`**, labelled `090.N`:
  expired · revoked · deleted ride · departed ride · ride moved earlier · blocked A→B ·
  blocked B→A · already crew · the organizer's own link · malformed token · unmatched token ·
  un-onboarded claimer · the same rider twice · a claim after a `pending` invite · a claim after a
  `declined` invite · revoke does not eject · deleting a link nulls `link_id` and keeps the rows ·
  no client can name `token`, `expires_at` or `link_id` · no UPDATE grant on either table
  (per grantee, `has_table_privilege`) · `anon` reaches neither table nor any RPC ·
  the preview returns no roster · the preview reaches no second ride ·
  a token holder reads zero rows from `rides` before claiming.
- [ ] 6.2 Assert the **preview and the claim agree** for the same token in every dead state — this
  is what pins the one-definition-of-liveness property.
- [ ] 6.3 Assert `pg_get_triggerdef(notify_ride_invited)` contains the `WHEN` clause, **by reading
  the definition** and not only by observing that no notification appeared.
- [ ] 6.4 Assert `public.rides`' SELECT qual is **byte-identical** to its pre-change pinned string
  and `private.can_read_ride`'s `prosrc` is unchanged. **A failure here means the change is wrong
  — do not re-pin.**
- [ ] 6.5 Assert no policy qual or `prosrc` anywhere references `link_id`.
- [ ] 6.6 Assert `private.join_ride_from_invite` still contains its participation-gate check on
  both `profiles` stamps.
- [ ] 6.7 `PGPASSWORD=postgres npm test` green, reconciled against 0.5's **label set**.
- [ ] 6.8 Apply to DEV, then re-measure: gate triggers **17**, `get_advisors(security)` **+3** and
  no advisor outside the expected three.
- [ ] 6.9 **`036`'s hand-exercise gate** — this change re-creates a trigger on the live
  `ride_invites` INSERT path. On DEV, in a **rolled-back transaction**, exercise: an in-app invite
  (still notifies), a claim by a stranger, a claim by an already-invited rider, a claim by an
  un-onboarded rider, and a revoke. **Not optional.**

## 7. Data, actions, types and cache

- [ ] 7.1 `src/lib/data/ride-invite-links.ts` through `resolveSupabase` — `getRideInviteLinks(rideId)`
  (with the derived use count via the embedded `ride_invites(count)`) and
  `getRideInviteLinkPreview(token)`.
- [ ] 7.2 `src/lib/actions/ride-invite-links.ts` — `createRideInviteLink`, `revokeRideInviteLink`,
  `claimRideInviteLink`. Plain async functions; no `'use server'`.
- [ ] 7.3 Types in `src/types/index.ts`: `RideInviteLink`, `RideInviteLinkPreview`,
  `RideInviteLinkClaim`. **`NotificationType` does not change.**
- [ ] 7.4 `rideInviteTokenSchema` in `src/lib/validation/rides.ts` — 32 lowercase hex. Zod owns the
  message; the CHECK and the absent grant own the guarantee.
- [ ] 7.5 Keys in `src/lib/query/keys.ts`: `rides.inviteLinks(rideId)` and `invites.link(token)`,
  each with the reconciliation note that file's header exists for.
- [ ] 7.6 Invalidations per `specs/client-cache-invalidation/`: the claim moves `rides.all()` and
  `invites.all()`; create and revoke move `rides.inviteLinks(rideId)`.

## 8. Screens

- [ ] 8.1 `npm run figma -- ls` **first** — there is no v2 frame for this flow. Assemble from
  measured components (`RideCard`, the crew rail's avatar stack, `SectionHeader`) rather than
  inventing and calling it measured. Use `--all` on any `tree`, or a hidden layer ships.
- [ ] 8.2 The organizer's link surface on `/rides/detail/invite` — create, list with expiry and use
  count, share (`shareAppLink`, unchanged) and revoke. Revoke's confirmation copy **must not imply
  it removes anyone** (0.2).
- [ ] 8.3 `/rides/join` landing route, token as a **query parameter** — `output: 'export'` forbids
  a dynamic segment for a secret. All seven states from `specs/ride-invite-links/`'s table.
- [ ] 8.4 Add `/rides/join` to `PUBLIC_PATHS` in `src/lib/auth/guard.ts` and add guard cases in
  `src/lib/auth/guard.test.ts`: public with no session, and an un-onboarded rider still routed to
  their resume step.
- [ ] 8.5 The stash — `sessionStorage`, one key, cleared on sign-out, `history.replaceState` to
  drop the token from the visible URL. **Never `localStorage`.**
- [ ] 8.6 **The claim is a tap, always.** No effect, guard branch or `onAuthStateChange` listener
  calls it. A component test asserting the Join control is the only caller.
- [ ] 8.7 Gate every screen on its **data**, never on `isLoading`; `null` renders the dead-link
  message, `undefined` renders the skeleton.

## 9. Wrap-up

- [ ] 9.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 9.2 `npm run walk` with credentials — add `/rides/join` to the route list. A shrunken `N/N`
  is a skip, not a pass.
- [ ] 9.3 `npm run docs:check` after the doc edits, and
  `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` for the section pointers.
- [ ] 9.4 Docs, **main thread not a subagent**: `CLAUDE.md`'s advisor table `+3` and its
  participation-gate paragraph to seventeen; `docs/reference/schema.md` gains `ride_invite_links`
  and `ride_invites.link_id`; `docs/reference/product-scope.md`'s Rides row.
- [ ] 9.5 PR body states the two things meant to be read rather than discovered: **the link opens
  the web app, not the shell, until PD-205**, and **revoke does not remove admitted riders and
  nothing today can**.
- [ ] 9.6 `reviewer` on the final diff, then merge to `development`, then `Deployed to DEV` on
  PD-330.
