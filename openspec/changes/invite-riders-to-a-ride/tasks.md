## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **Read PD-329 yourself, body AND comments.** This proposal was written with the Linear
  connector absent (`No such tool available`), so the story, the decision table and the negative-case
  list are second-hand from the spawning brief. `get_issue PD-329` **and** `list_comments PD-329` —
  neither alone is the issue, because this repo corrects a stale body by commenting on it. Reconcile
  against `proposal.md` §Two things and `design.md` §Questions Closed **before** task 1.1, and if the
  issue disagrees with either, stop and say so rather than building the reconciliation.
- [ ] 0.2 Resolve `design.md` §Questions Closed Q1–Q6 with the product owner, or accept the stated
  defaults on the record. **Q1 (platform-wide username search) is the only one that opens a new
  exposure surface** and is the one to put in front of them first; Q2 and Q3 change one predicate
  each; Q4–Q6 are safe to accept as defaults.
- [ ] 0.3 Re-derive the migration number: `list_migrations` on PROD (`zwprydcyryvudhurbnye`) and DEV
  (`fpmrimzxadewsaiwpsel`) against `ls supabase/migrations/`. Expect DEV `082`, PROD `079`, and a
  repo count that depends on what the branch already carries — 82 on `development`, 84 here.
  **Promote the `080`, `081`, `082` gap to PROD in filename order, per `docs/ENVIRONMENTS.md`
  §Migrations, before adding to it** — `082` renames what `081` creates, so the reverse errors, and
  the client calls RPCs that exist only after `082`. A second, unrelated story owns `084`; this one
  is `083`.
- [ ] 0.4 Record the **before** numbers so the after-numbers mean something: gate triggers
  (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal`
  — expect **13** on DEV), `get_advisors(security)` (expect **15**, going to **17** — two new WARNs, one per new RPC), and the RLS
  suite's **label set** via `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"` (reconcile by
  label set, never by count — a count cannot tell a rename from a loss).

  **Read those against the BRANCH, not against `development`.** This story shares a branch with
  PD-321, whose `084` lands a fourteenth gate trigger and 27 assertions of its own, so the baselines
  a fresh checkout gives (13 triggers, 2018 assertions) are `development`'s and not this branch's.
  With both migrations the gate count is **fifteen** and `ride_invites` is the **fourteenth**.
- [ ] 0.5 Read the **live** comment on `public.enforce_participation_gate()` before writing the
  restamp. It says **thirteen** and enumerates the recent additions by name. Do not grep for a
  number from `CLAUDE.md`.
- [ ] 0.6 Confirm the three facts the whole design rests on, from the catalog rather than from this
  file: `rides` SELECT's qual is still §060.1's pinned string; `private.can_read_ride` still restates
  it with `is_club_member_for`; `private.is_ride_crew`'s body still reads `rides.organizer_id` and
  `ride_members` only.
- [ ] 0.7 Confirm `private.is_blocked(x, x)` is false for a rider against themselves, since the
  `ride_invites` SELECT policy calls it once per party and one of the two is always the caller. If it
  is not false, the policy takes the `case` form instead and the assertion in 5.6 changes with it.

## 1. Migration `083_ride_invites.sql` — the table

- [ ] 1.1 Create `public.ride_invites` — `id uuid default uuid_generate_v4() primary key`,
  `ride_id uuid references public.rides(id) on delete cascade not null`,
  `invitee_id uuid references public.profiles(id) on delete cascade not null`,
  `inviter_id uuid references public.profiles(id) on delete cascade not null`,
  `status text default 'pending' not null`, `created_at timestamptz default now() not null`,
  `responded_at timestamptz`.
- [ ] 1.2 `unique (ride_id, invitee_id)`. **Not a wider key.** A repeat invite must be a `23505`, and
  a key including `inviter_id` or `status` permits a second row the day crew invites land.
- [ ] 1.3 CHECKs: `ride_invites_status_is_known` (`status in ('pending','accepted','declined')`);
  `ride_invites_no_self_invite` (`invitee_id <> inviter_id`); `ride_invites_response_coupling`
  (`(status = 'pending') = (responded_at is null)`, written so NULL cannot pass — use
  `is not distinct from` on any nullable comparison, `073`'s measured correction, because **a CHECK
  accepts NULL**).
- [ ] 1.4 Indexes: `(invitee_id, created_at desc, id desc)` — the invitee's list and the `profiles`
  cascade path in one; `(inviter_id)` for the other cascade; and `(ride_id, created_at desc, id desc)`
  for the organizer's list. The unique index already leads with `ride_id`; `029`'s rule is that every
  FK column **leads** an index, so state in a comment which index discharges which FK.
- [ ] 1.5 `alter table public.ride_invites enable row level security`.
- [ ] 1.6 Write the table and column comments. They are the `data` agent's first read via
  `list_tables` and no edit to `CLAUDE.md` reaches them (`028`, `033`). Say: that a live invite
  (`pending` **or** `accepted`) is a **fourth arm of `rides` SELECT**; that the arm sits inside the
  block-dominated group and why; that `status` is the answer to the invitation and **never** a copy
  of `ride_members`; and that decline is terminal against the inviter and reopenable by the invitee.

## 2. Migration `083` — the helper pair and the two policy copies

- [ ] 2.1 `private.has_live_ride_invite_for(candidate uuid, target_ride uuid) returns boolean` —
  `language sql`, `stable`, `security definer`, `set search_path = ''`, every name schema-qualified.
  Body: `exists (select 1 from public.ride_invites i where i.ride_id = target_ride and i.invitee_id =
  candidate and i.status in ('pending','accepted'))`. **`in`, never `<> 'declined'`** — a fourth
  status must grant nothing. **`auth.uid()` appears nowhere in this body**, and 5.4 asserts it.
- [ ] 2.2 `private.has_live_ride_invite(target_ride uuid)` — the caller-relative wrapper, body
  **exactly** `select private.has_live_ride_invite_for(auth.uid(), target_ride);` and nothing else,
  on `060`'s `is_club_member` pattern.
- [ ] 2.3 Grants: `revoke all on function private.has_live_ride_invite_for(uuid, uuid) from public,
  anon, authenticated` — **no client role**, it is an invite oracle; `revoke all on function
  private.has_live_ride_invite(uuid) from public, anon` then `grant execute … to authenticated`,
  because an RLS expression is evaluated as the querying role.
- [ ] 2.4 **Recreate `rides` SELECT with the fourth arm INSIDE the block-dominated group.** Drop and
  recreate by name; the new qual is `design.md` §Where the invite arm sits, verbatim. Comment the
  placement and what the top-level alternative would do.
- [ ] 2.5 **`create or replace private.can_read_ride` with the same arm in candidate form** —
  `private.has_live_ride_invite_for(candidate, r.id)`, in the same position. **This is the task that
  is easiest to skip and is not optional**: §060.1's own message says to update the helper rather
  than re-pin the string, and PD-211 is what happens when only the policy moves. `create or replace`
  preserves the OID and the existing privileges; re-issue the `revoke` anyway so the file is correct
  in isolation on a scratch replay.
- [ ] 2.6 Refresh the comment on `private.can_read_ride` so it names four arms rather than three.

## 3. Migration `083` — policies and grants on `ride_invites`

- [ ] 3.1 SELECT: `(invitee_id = auth.uid() or inviter_id = auth.uid()) and not
  private.is_blocked(auth.uid(), invitee_id) and not private.is_blocked(auth.uid(), inviter_id)`.
  **No arm reading `rides.organizer_id`** — comment that it would be dead code today and arrives with
  crew invites, `club_members.role`'s precedent.
- [ ] 3.2 INSERT `with check`: `inviter_id = auth.uid() and exists (select 1 from public.rides r where
  r.id = ride_id and r.organizer_id = auth.uid()) and not private.is_blocked(auth.uid(), invitee_id)`.
  The `EXISTS` is evaluated under the caller's own RLS, which is the composition, not a convenience.
- [ ] 3.3 DELETE `using`: `inviter_id = auth.uid() and status = 'pending'`. Comment that this is what
  makes decline terminal against the inviter.
- [ ] 3.4 **No UPDATE policy and no UPDATE grant.** Absence is the enforcement; the two RPCs are the
  only writers of `status`. Comment the absence, `078`'s precedent.
- [ ] 3.5 `revoke all on public.ride_invites from anon, authenticated`; then `grant select, delete on
  public.ride_invites to authenticated` and **per-column** `grant insert (id, ride_id, invitee_id,
  inviter_id)`. **`status`, `created_at` and `responded_at` on none of them.** Comment that a
  `default` applies only when the column is omitted and PostgREST will happily name it.
- [ ] 3.6 `enforce_participation_gate` BEFORE INSERT trigger on `public.ride_invites`,
  `for each row when (current_user = 'authenticated')`. The `WHEN` clause is not decoration
  (`023` §2). Expected total **14**.
- [ ] 3.7 Restamp the comment on `public.enforce_participation_gate()` from thirteen to **fourteen**
  and add `ride_invites` to its enumeration.

## 4. Migration `083` — the write path and the fan-outs

- [ ] 4.1 `private.join_ride_from_invite(rider uuid, target_ride uuid)` — `security definer`,
  `set search_path = ''`, `#variable_conflict error`, in `private` so PostgREST cannot publish it and
  `service_role` cannot reach it. It SHALL: restate the participation gate for `rider`
  (`terms_accepted_at is not null and onboarding_completed_at is not null`), re-check
  `private.can_read_ride(rider, target_ride)`, then
  `insert into public.ride_members (ride_id, user_id, status) values (…, 'going') on conflict do
  nothing`. **Comment `078`'s reason for the restatement**: the gate trigger on `ride_members`
  carries `when (current_user = 'authenticated')` and `current_user` here is the owner, so it cannot
  fire — and **do not add a second trigger to compensate**, which would raise the count while gating
  nothing (`078.9`).
- [ ] 4.2 `public.accept_ride_invite(invite uuid)` — `security definer`, `set search_path = ''`,
  `#variable_conflict error`. One `update … set status = 'accepted', responded_at = now() where id =
  invite and invitee_id = auth.uid() and status in ('pending','declined') returning ride_id`, then
  `private.join_ride_from_invite(auth.uid(), that ride)`. **One raise site**, so "not yours", "no such
  invite", "already accepted" and "blocked" are indistinguishable (`043`'s shape).
- [ ] 4.3 `public.decline_ride_invite(invite uuid)` — same shape, `status = 'declined'`, `where …
  status = 'pending'`, one raise site, no membership write.
- [ ] 4.4 Grants on both RPCs: `revoke all from public, anon`, `grant execute to authenticated`.
  Expect **two** new security advisors from these, and none from the three `private` functions.
- [ ] 4.5 `notifications_type_check` — drop and recreate naming **eight** types.
  `notifications_subject_shape` — drop and recreate with three new arms, each
  `postcard_id is null and comment_id is null and ride_id is not null and club_id is null`, and the
  `else false` arm intact. **Both in the same statement block**; `036`'s comment says why the second
  is load-bearing rather than tidy.
- [ ] 4.6 `private.notify_ride_invited()` — `after insert on public.ride_invites`, `security definer`,
  `set search_path = ''`, **no `when` clause** (trap (a)), **`auth.uid()` nowhere** (trap (b)), actor
  from `new.inviter_id`. Guards: `new.invitee_id <> new.inviter_id`,
  `not private.is_blocked(new.invitee_id, new.inviter_id)`, and
  `private.can_read_ride(new.invitee_id, new.ride_id)` — the **candidate-relative** form (trap (c)),
  which is also the self-consistency check that fails if 2.4 and 2.5 drift. `on conflict do nothing`.
- [ ] 4.7 `private.notify_ride_invite_answered()` — `after update of status on public.ride_invites`,
  guarded on `old.status is distinct from new.status`, writing `ride_invite_accepted` or
  `ride_invite_declined` to `new.inviter_id` with `new.invitee_id` as actor. Same three guards, with
  `private.can_read_ride(new.inviter_id, new.ride_id)`. **No `when (current_user = …)` clause** — its
  only writers are `security definer` RPCs, for which `current_user` is the owner, so such a clause
  would disable it entirely.
- [ ] 4.8 `private.retract_ride_invited()` — `after delete on public.ride_invites`, deleting exactly
  the `ride_invited` row the fan-out would have written, matched on the full event key
  (`retract_postcard_liked`'s shape). It must **not** touch the answer notifications.
- [ ] 4.9 `revoke all` on all three fan-out functions from every role; they are reached only as
  triggers.
- [ ] 4.10 Write the verification footer: policy count and per-verb list on `ride_invites`; `anon`
  grant count **0**; the **enumerated** INSERT columns; `has_table_privilege('authenticated',
  'public.ride_invites','update')` = **false**; `prosecdef` true on the five new definer functions;
  `has_function_privilege('authenticated','private.has_live_ride_invite_for(uuid,uuid)','execute')`
  = **false** and the wrapper = **true**; gate trigger count **14**; advisor count **17**; the three
  FKs present with `confdeltype = 'c'`; and both CHECK constraints on `notifications` naming eight
  types.

## 5. RLS assertions — `supabase/tests/rls_test.sql`

Every task here is required: `openspec/config.yaml` and `CLAUDE.md` both say a policy change with no
new assertion is not finished. Each maps to a scenario in `specs/ride-invites/spec.md`.

- [ ] 5.1 **Re-pin §060.1 to the new `rides` SELECT qual, in the same commit that changes the
  policy.** Read that assertion's message first — it instructs you to update the helper rather than
  re-pin the string, and here both are required. A re-pin with 2.5 skipped is the exact defect the
  pin exists to catch.
- [ ] 5.2 **Agreement, not two expectations**: for one ride, assert that `rides` SELECT returning a
  row and `private.can_read_ride` answering true agree for the organizer, a signed-in non-member of a
  public ride, a member of the ride's private club, a pending invitee, an accepted invitee, a
  declined invitee, and a blocked rider. Seven pairs, asserted as agreement.
- [ ] 5.3 The wrapper's `prosrc` equals the delegation **exactly** (equality, never `like` —
  `060`'s own reasoning: `like '%..._for%'` is satisfied by the mention alone).
- [ ] 5.4 `private.has_live_ride_invite_for`'s body mentions `auth.uid()` **nowhere**. **And neither
  does `private.can_read_ride`'s** — that is where trap (c) can now enter, and nothing pinned it
  before: a builder writing the caller-relative `has_live_ride_invite(r.id)` inside `can_read_ride`
  passes §060.1, 5.3, 5.4 and even 5.2, because in 5.2 the caller **is** the candidate. The failure
  surfaces only in the fan-out, where `ride_invited` is then silently never written.
- [ ] 5.5 **`private.is_ride_crew`'s `prosrc` is unchanged**, by equality, mentioning `ride_invites`
  nowhere. Failure message names `ride_reads`' write predicate and postcard ride-tagging as the two
  other surfaces an invite arm would open.
- [ ] 5.6 Invite visibility per role: invitee sees their own in every status; inviter sees theirs; a
  crew member who is neither sees zero; a club member sees zero; any other signed-in rider sees zero;
  `anon` holds no grant.
- [ ] 5.7 Blocking, both directions from **one** directional `blocks` row: neither party sees the
  invite; a third rider's invites are unaffected.
- [ ] 5.8 A blocked invitee reads **zero** `rides` rows despite a `pending` invite — the assertion
  that fails if the arm is placed at the top level. **Mutation-test it**: move the arm, confirm this
  goes red, revert. An assertion for a placement defect that has never been seen to fail is not
  coverage.
- [ ] 5.9 INSERT: the organizer succeeds; a crew member is refused; a club member is refused; a
  foreign `inviter_id` is refused; naming `status`, `created_at` or `responded_at` is refused with
  `42501`; a self-invite is refused by the CHECK.
- [ ] 5.10 `23505` on a repeat invite in **each** status — pending, accepted and declined — because
  the anti-treadmill property depends on all three.
- [ ] 5.11 DELETE: the inviter deletes a `pending` invite; the same delete matches **zero rows** for
  an `accepted` and for a `declined` one; the invitee cannot delete their own invite; a third rider
  cannot.
- [ ] 5.12 `accept_ride_invite`: the invitee succeeds and a `ride_members` row appears with
  `status = 'going'`; the organizer gets `insufficient_privilege` identical to a nonexistent id; a
  second accept raises identically; **a `declined → accepted` reopen succeeds**; accepting when
  already crew leaves the existing crew row's `status` and `joined_at` untouched. **The reopen's
  fixture must be a PRIVATE, invite-only ride** — on a public one it passes green through a
  reordering of the RPC's two statements, which is the one thing about that function that is
  load-bearing and invisible.
- [ ] 5.13 `decline_ride_invite`: the invitee succeeds and **no** `ride_members` row appears; a second
  decline raises; the organizer cannot decline.
- [ ] 5.14 **The gate, restated**: a rider with `terms_accepted_at` NULL calling `accept_ride_invite`
  is refused, **and** the trigger count on `ride_members` is unchanged — the two halves of `078`'s
  lesson, asserted separately.
- [ ] 5.15 **A blocked invitee cannot accept**: block after the invite, then accept, and get the same
  error a nonexistent id gives — **compared on the MESSAGE TEXT, not only the SQLSTATE**. Both
  refusals are `insufficient_privilege`, so a SQLSTATE-only assertion passes green with a block
  oracle present. `private.join_ride_from_invite` returns `false` rather than raising for exactly
  this reason; the gate's own raise is fine, being a fact about the caller themselves.
- [ ] 5.16 The read arm: `pending` grants the ride; `accepted` grants it **after the crew row is
  deleted**, and the rider can then rejoin through the ordinary `ride_members` INSERT; `declined`
  grants nothing.
- [ ] 5.17 Walk `design.md` §Where the invite arm sits' radius table one row at a time — a single
  assertion cannot say which predicate did the work. **Negatives**: `clubs`, that club's other
  rides, `club_members`, `club_threads`, `ride_messages`. **Positives, asserted as positives**:
  `ride_members`, the `ride-maps` Storage object, and `public.ride_journal_postcard_ids` — a suite
  that only proves the negatives cannot tell an intended reach from one nobody noticed.
- [ ] 5.18 Visibility changes: making the ride public leaves the invite pending and answerable;
  moving it into a private club leaves the invitee reading the ride and no part of the club.
- [ ] 5.19 Cascades: deleting the ride removes its invites and every notification carrying that
  `ride_id`; the **invitee's** account deletion removes invites addressed to them; the **inviter's**
  removes invites they sent. All three asserted, none visible in another's.
- [ ] 5.20 Fan-out `ride_invited`: written on insert to the invitee with the inviter as actor;
  **not** written for a blocked pair; retracted on delete; **not** retracted when an answer
  notification exists for the same pair and ride.
- [ ] 5.21 Fan-out answers: accept writes `ride_invite_accepted` to the inviter, decline writes
  `ride_invite_declined`; **both fire from inside a `security definer` RPC**, asserted directly,
  because a `when` clause added later would silently stop them; an update that does not move `status`
  writes nothing.
- [ ] 5.22 `notifications`: both CHECKs name eight types and three shapes; each new type with a NULL
  `ride_id` or a non-NULL `postcard_id`/`comment_id`/`club_id` is refused `23514`; a `ride_invited`
  row whose ride became invisible **after** it was written is neither returned nor counted;
  `authenticated` still holds no INSERT grant.
- [ ] 5.23 `anon` holds zero grants on `ride_invites`, and no policy on it is written for a role other
  than `authenticated`.

## 6. Apply and verify

- [ ] 6.1 Apply `083` to DEV via `apply_migration`. Well under `036`'s 61 KB, so no reduction
  technique is needed.
- [ ] 6.2 **Hand-exercise the live write paths in a rolled-back transaction on DEV, before trusting
  the apply.** `083` replaces `private.can_read_ride`, which the existing `notify_ride_joined` and
  `notify_ride_created_in_club` fan-outs call **inside a rider's own RSVP and ride-creation
  transaction** — `036`'s rule, and a raise there takes that rider's write down with it. Exercise: an
  RSVP to a public ride, an RSVP to a club ride, creating a ride in a club, and joining a club.
- [ ] 6.3 Run the footer's verification queries. Every number must match; a mismatch is investigated
  before any code lands.
- [ ] 6.4 `get_advisors(security)` on DEV — **measured seventeen**, from fifteen: two new
  `authenticated_security_definer_function_executable` WARNs for `accept_ride_invite` and
  `decline_ride_invite`, and **none** for the three `private` functions. An eighteenth means a
  revoke did not land or something was created in `public` that should be in `private`.
- [ ] 6.5 `PGPASSWORD=postgres npm test` green, reconciled by **label set** against 0.4's.
- [ ] 6.6 `npm run db:drift` if `PROD_DATABASE_URL`/`DEV_DATABASE_URL` are available; otherwise
  substitute `list_migrations` against `ls supabase/migrations/` and record the gap explicitly, as
  `add-club-threads` task 6.5 did.

## 7. Types, validation, reads and writes

- [ ] 7.1 `src/types/index.ts`: `RideInviteStatus`, `RideInvite`, `RideInviteListItem` (the invite
  plus the invitee's public profile plus a live `isCrew` flag), `RiderSearchResult`. Extend
  `NotificationType` with the three new strings — the `switch` in
  `src/components/notifications/copy.ts` is exhaustive, so `tsc` will name every site that must
  answer. Domain types are never inlined.
- [ ] 7.2 `src/lib/validation/rides.ts`: `rideInviteIdSchema`, and `riderSearchQuerySchema` with the
  two-character minimum. Zod owns the message; the database owns the guarantee, and here the search
  bound has **no** database counterpart, so say so at the schema rather than letting a reader assume
  one.
- [ ] 7.3 `src/lib/data/ride-invites.ts` through `resolveSupabase`: `getMyPendingInvites()` (excluding
  rides the caller is already crew on, by `not exists` in the query — a query shape, never a status
  check), `getRideInvites(rideId)` (with the live crew join for the joined marker),
  `getRideInvite(id)`, and `searchRidersToInvite(rideId, query)` (prefix-anchored, capped, ordered by
  `username`, excluding existing crew and existing invitees client-side). Return `null` for a decided
  absence; `undefined` is "not yet".
- [ ] 7.4 `src/lib/actions/ride-invites.ts`: `inviteRiderToRide(rideId, inviteeId)`,
  `acceptRideInvite(inviteId)` (**RPC**), `declineRideInvite(inviteId)` (**RPC**),
  `revokeRideInvite(inviteId)`. Plain async functions, `useActionState`-compatible. `23505` from the
  invite is "already invited", not an error.
- [ ] 7.5 `revokeRideInvite` must not chain `.select()` onto its delete — `RETURNING` re-attaches the
  SELECT policy, which is the mechanism that makes a delete match zero rows and still report success
  (`add-club-threads` 7.4b's measured finding).
- [ ] 7.6 No component calls `supabase.from()`; nothing outside `lib/data/` and `lib/actions/` reaches
  Supabase except through `@/lib/supabase/client`, whose file list is a review heuristic and is not
  widened by this change.

## 8. Cache keys

- [ ] 8.1 Add `rides.invites(rideId)`, `rides.inviteSearch(rideId, query)` and
  `invites.pending()` to `src/lib/query/keys.ts`. No key written inline in a component, ever.
- [ ] 8.2 Document in the `keys.ts` header **which prefixes reach the pending-invite key**, stated
  positively. It sits outside the `rides` domain deliberately — it is the *rider's* list, not a
  ride's — so `rides.all()` does not reach it and `invites.all()` does.
- [ ] 8.3 Wire the invalidations. `acceptRideInvite` moves **five** keys across two domains:
  `invites.pending()`, `notifications.list()`, `notifications.unread()`, `keys.ride(rideId)` and the
  ride's crew key. **The ride key is the one that gets missed** — comment it at the call site, because
  the rider is navigated straight to a screen that reads it. `declineRideInvite` moves three and
  deliberately not the ride. `inviteRiderToRide` and `revokeRideInvite` move `rides.invites(rideId)`.

## 9. Screens

- [ ] 9.1 **Read the design from `design/` first — `npm run figma -- ls` for anything matching
  `invite`.** If no v2 frame exists, say so in the PR and assemble the composition from measured
  components (the crew rail, the notification row, the club members list), never invented and called
  measured. `--all` on any `tree`. Icons from `@/components/icons/generated`; primary buttons
  near-black `Grey/100 #1A1A1A`, never green.
- [ ] 9.2 The invite entry point on the ride, visible to the organizer alone, and absent — not
  disabled — for everyone else. A disabled control is a promise.
- [ ] 9.3 The rider picker: prefix search, two-character minimum, capped, no paging, existing crew and
  existing invitees excluded, and an empty result that does not distinguish a blocked rider from a
  nonexistent one.
- [ ] 9.4 The ride's invite list for the organizer: each row rendering **joined** from the live crew
  read and never from the invite's status, `declined` shown as declined with no re-send affordance,
  and Revoke on pending rows only.
- [ ] 9.5 **Accept / Decline on the notification row**, with the enabled state read from the live
  invite row and never from the notification's `type`. A row whose invite is gone, answered elsewhere
  or hidden by a block renders as text with no controls.
- [ ] 9.6 `notificationCopy` gains three arms. Follow the `ride_joined` precedent: resolve the
  sentence against live subject data, never against a column stamped on the notification.
- [ ] 9.7 Every screen: gate on **data**, never `isLoading`; `null` is decided and `undefined` is "not
  yet"; skeleton at the content's own padding; an error state with retry that is not an empty list; a
  partial state where a failed crew read leaves the list rendering unmarked; offline disables the
  controls with a reason and **does not queue** the answer.
- [ ] 9.8 Add any new route to `src/lib/routes.ts` using `DETAIL_ID_PARAM`, and to the walk's route
  list, so a screen that throws on load is caught by the only gate that renders anything.

## 10. Verify and document

- [ ] 10.1 `npx tsc --noEmit` clean; `npm run lint`; `npm run test:unit` with no file lost;
  `npm run build` green with any new route prerendered static; `npm run docs:check`;
  `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs`.
- [ ] 10.2 `npm run walk` against DEV through `scripts/supabase-relay.mjs`. Chromium in this container
  cannot reach Supabase directly — read the relay's header first.
- [ ] 10.3 `docs/reference/schema.md`: a `ride_invites` row carrying the audience predicate, the three
  cascades, the retention decision and the state table; **and an edit to the `rides` row** recording
  the fourth SELECT arm and that an invite is a route into a private club's ride that did not exist
  before.
- [ ] 10.4 `docs/reference/product-scope.md`: the Rides row loses invitations as a gap.
- [ ] 10.5 `CLAUDE.md`: advisor table to **eighteen** naming both new RPCs; participation-gate
  paragraph to **fifteen** tables — `ride_invites` (`083`) is the fourteenth and `feedback` (`084`,
  PD-321, same branch) the fifteenth, so writing "fourteen" here re-creates the exact defect that
  paragraph warns about; and the `security definer` RPC list gains the two. **Main thread writes
  these, not a subagent.**
- [ ] 10.6 `docs/HANDOFF.md`: the applied-migration position after `083`, the PROD promotion order
  (`080`, `081`, `082`, then `083`, all additive, all before the promotion build serves), and — under
  Known issues — that PD-330's link half reuses `private.join_ride_from_invite` and that an expiry
  decision is owed **there** rather than here. **Main thread writes this.**
- [ ] 10.7 Run `reviewer` on the proposal **before** the migration is written (it is the only artifact
  in this pipeline with no automated gate), and again on the final diff, once, immediately before
  the PR.
