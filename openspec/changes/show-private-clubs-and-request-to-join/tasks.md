## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **Read PD-325 yourself, body AND comments.** This proposal was written with no Linear tool
  available at all, so the story, the six decision points and the negative-case list are
  second-hand from the spawning brief. `get_issue PD-325` **and** `list_comments PD-325` — neither
  alone is the issue, because this repo corrects a stale body by commenting on it. Reconcile against
  `proposal.md` §Three things and `design.md` §Questions Closed **before** task 1.1, and if the
  issue disagrees with either, stop and say so rather than building the reconciliation.
  Also read **PD-326** so the seam in `design.md` §The seam PD-326 absorbs is drawn against what
  that story actually says rather than against this file's reading of it.
- [ ] 0.2 Put `design.md` §Questions Closed Q1–Q6 to the product owner, or accept the stated
  defaults on the record. **Q4 (is a decline told to the rider) and Q5 (does the reduced screen
  exist) are the two blocking ones** and go first; Q1, Q2, Q3 and Q6 are safe to accept as
  defaults. Q7 is answered and recorded, not asked.
- [ ] 0.3 Re-derive the migration number: `list_migrations` on PROD (`zwprydcyryvudhurbnye`) and DEV
  (`fpmrimzxadewsaiwpsel`) against `ls supabase/migrations/`. Expect 84 files, DEV `084`, PROD
  `079`. **Promote the `080`–`084` gap to PROD in filename order, per `docs/ENVIRONMENTS.md`
  §Migrations, before adding to it** — `082` renames what `081` creates so the reverse errors, and
  `083` replaces `private.can_read_ride`, which every existing fan-out calls inside a rider's own
  RSVP transaction, so `036`'s hand-exercise gate must be run again on PROD for that promotion.
  This story is `085`; PD-328 on the same branch is `086`.
- [ ] 0.4 Record the **before** numbers so the after-numbers mean something: gate triggers
  (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal`
  — expect **15** on DEV), `get_advisors(security)` (expect **17**, going to **20** — three new
  WARNs, one per new `public` definer function), and the RLS suite's **label set** via
  `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"`. Reconcile by label set, never by count:
  a count cannot tell a rename from a loss.
- [ ] 0.5 Read the **live** comment on `public.enforce_participation_gate()` before writing the
  restamp. Do not grep a number out of `CLAUDE.md`.
- [ ] 0.6 Confirm from the catalog, not from this file, the four facts the whole design rests on:
  `clubs` SELECT's qual is still `(is_public or owner_id = auth.uid() or private.is_club_member(id))`
  and is pinned at §060.1b; `club_members` has **no UPDATE policy**; `notify_club_joined`'s trigger
  carries **no `when` clause**; and `036`'s `notifications` SELECT qual still carries the per-column
  `club_id` `EXISTS`. The last is what makes `proposal.md` §1 true, and if it has changed the
  decline decision is reopened.
- [ ] 0.7 Confirm `private.is_blocked(x, x)` is false for a rider against themselves — the
  `club_join_requests` SELECT policy calls it once per row and one party is always the caller. If it
  is not false, the policy takes a `case` form instead and assertion 7.12 changes with it.
- [ ] 0.8 Measure how many `club_members` rows carry `role = 'admin'` on DEV and PROD. `029` measured
  **zero** and `019` makes the value insertable by no client. If it is still zero, `proposal.md` §2
  stands as written and every admin assertion needs a fixture row created directly.

## 1. Migration `085_club_join_requests.sql` — the table

- [ ] 1.1 Create `public.club_join_requests` — `id uuid default uuid_generate_v4() primary key`,
  `club_id uuid references public.clubs(id) on delete cascade not null`,
  `user_id uuid references public.profiles(id) on delete cascade not null`,
  `status text default 'pending' not null`, `created_at timestamptz default now() not null`,
  `responded_at timestamptz`.
- [ ] 1.2 `unique (club_id, user_id)`. **Not a wider key.** A key including `status` would permit a
  second row per rider and destroy the anti-treadmill property that makes a refusal stick.
- [ ] 1.3 CHECKs: `club_join_requests_status_is_known` (`status in ('pending','declined')` — **two
  values, not three**; approval deletes the row, `design.md` §The state machine);
  `club_join_requests_response_coupling`
  (`not ((status = 'pending') is distinct from (responded_at is null))` — written with
  `is distinct from` because **a CHECK accepts NULL**, `073`'s measured correction).
- [ ] 1.4 **No `responded_by` column.** Comment the absence and why: the requester reads every
  column on their own row, so it would tell them which admin refused them
  (`design.md` §What the requester may learn).
- [ ] 1.5 Indexes: `(user_id, created_at desc, id desc)` — the rider's own rows and the `profiles`
  cascade path in one; `(club_id, status, created_at desc, id desc)` for the admin's pending list
  and the `clubs` cascade. The unique index already leads with `club_id`; `029`'s rule is that every
  FK column **leads** an index, so state in a comment which index discharges which FK.
- [ ] 1.6 `alter table public.club_join_requests enable row level security`.
- [ ] 1.7 Write the table and column comments — the `data` agent's first read via `list_tables`, and
  no edit to `CLAUDE.md` reaches them (`028`, `033`). Say: that a private club is discoverable ONLY
  through `public.discoverable_private_clubs` and that `clubs` SELECT is untouched; that approval
  DELETES the row and the `club_members` row is the record; that a declined row is immovable by the
  requester and clearable by an admin; that there is no expiry and why; and that there is no
  decline notification and why (`036` §3's club conjunct).

## 2. Migration `085` — the helpers

- [ ] 2.1 `private.is_club_admin_for(candidate uuid, target_club uuid) returns boolean` —
  `language sql`, `stable`, `security definer`, `set search_path = ''`, every name schema-qualified.
  Body: `exists (select 1 from public.clubs c where c.id = target_club and c.owner_id = candidate)
  or exists (select 1 from public.club_members m where m.club_id = target_club and m.user_id =
  candidate and m.role in ('owner','admin'))`. **`auth.uid()` appears nowhere**, and 7.28 asserts it.
  Comment that this union is `notify_club_joined`'s recipient set restated, and that 7.24 asserts
  the two agree.
- [ ] 2.2 `private.is_club_admin(target_club uuid)` — the caller-relative wrapper, body **exactly**
  `select private.is_club_admin_for(auth.uid(), target_club);` and nothing else, on `060`'s pattern.
- [ ] 2.3 `private.club_takes_join_requests(candidate uuid, target_club uuid) returns boolean` —
  same modifiers. Body per `design.md` §Why the accessor, not the policy: not public, not default,
  not owned by the candidate, not a membership, not blocked with `clubs.owner_id`. Comment each
  conjunct with what it excludes, and comment that the block conjunct is on the **owner** and on
  nobody else.
- [ ] 2.4 Grants: `revoke all on function private.is_club_admin_for(uuid, uuid) from public, anon,
  authenticated` — **no client role**, it is an admin oracle. Same for
  `private.club_takes_join_requests`. `revoke all on function private.is_club_admin(uuid) from
  public, anon` then `grant execute … to authenticated`, because an RLS expression is evaluated as
  the querying role.

## 3. Migration `085` — the accessor

- [ ] 3.1 `public.discoverable_private_clubs(target_club uuid default null, page_size int default 50)
  returns table (id uuid, name text, avatar_path text, location_name text, latitude double
  precision, longitude double precision, members_count bigint)` — `language sql`, `stable`,
  `security definer`, `set search_path = ''`.
- [ ] 3.2 Body: select from `public.clubs c` where `private.club_takes_join_requests((select
  auth.uid()), c.id)` and `(target_club is null or c.id = target_club)`, with `members_count` as a
  scalar subquery `count(*)` over `public.club_members`, ordered `c.created_at desc, c.id desc`,
  limited `least(coalesce(page_size, 50), 100)`.
  **`returns table`, never `returns setof public.clubs`** — the second makes every future
  `alter table public.clubs add column` a widening with no diff to notice it in.
- [ ] 3.3 Comment it in full: that this is the ONLY path by which a non-member reads a private club;
  that the seven-column list IS the disclosure and adding to it needs its own migration; that
  `clubs` SELECT and `private.can_read_club` are deliberately untouched; and that the two Storage
  policies are untouched, so the avatar will not sign and the card draws initials
  (`design.md` §The avatar that will not sign, which carries the arm that would change that).
- [ ] 3.4 `revoke all on function public.discoverable_private_clubs(uuid, int) from public, anon;`
  then `grant execute … to authenticated`. Expect **one** new advisor from this.

## 4. Migration `085` — policies, grants and the gate

- [ ] 4.1 SELECT: `(user_id = auth.uid() or private.is_club_admin(club_id)) and not
  private.is_blocked(auth.uid(), user_id)`. Comment that no arm reads `clubs` — an arm making the
  row visible to anyone who can see the club would hand a public club's whole membership the
  requests of a private one it has nothing to do with.
- [ ] 4.2 INSERT `with check`: `user_id = auth.uid() and private.club_takes_join_requests(auth.uid(),
  club_id)`.
- [ ] 4.3 DELETE `using`: `(user_id = auth.uid() and status = 'pending') or
  private.is_club_admin(club_id)`. Comment that the first disjunct's `status` scope is what makes a
  refusal stick against the requester, and that the second is the "you may ask again" affordance,
  whose *surface* is PD-326's.
- [ ] 4.4 **No UPDATE policy and no UPDATE grant.** Absence is the enforcement; the two RPCs are the
  only writers of `status`. Comment the absence, `078`'s precedent.
- [ ] 4.5 `revoke all on public.club_join_requests from anon, authenticated`; then
  `grant select, delete on public.club_join_requests to authenticated` and **per-column**
  `grant insert (id, club_id, user_id)`. **`status`, `created_at` and `responded_at` on none of
  them.** Comment that a `default` applies only when the column is omitted and PostgREST will
  happily name it.
- [ ] 4.6 `enforce_participation_gate` BEFORE INSERT trigger on `public.club_join_requests`,
  `for each row when (current_user = 'authenticated')`. The `WHEN` clause is not decoration
  (`023` §2). Expected total **16**.
- [ ] 4.7 Restamp the comment on `public.enforce_participation_gate()` from fifteen to **sixteen**
  and add `club_join_requests` to its enumeration.

## 5. Migration `085` — the write path, the RPCs and the fan-outs

- [ ] 5.1 `private.join_club_from_request(rider uuid, target_club uuid) returns boolean` —
  `security definer`, `set search_path = ''`, `#variable_conflict error`, in `private` so PostgREST
  cannot publish it and `service_role` cannot reach it (`031`). It SHALL: restate the participation
  gate for `rider` (`terms_accepted_at is not null and onboarding_completed_at is not null`),
  re-check that the club is still not `is_default`, then
  `insert into public.club_members (club_id, user_id, role) values (target_club, rider, 'member')
  on conflict do nothing`. **`'member'` as a literal**; the function takes no role argument.
  **Comment `078`'s reason for the restatement** — the gate trigger on `club_members` carries
  `when (current_user = 'authenticated')` and `current_user` here is the owner, so it cannot fire —
  and **do not add a second trigger to compensate**, which would raise the count while gating
  nothing (`078.9`).
  Return `false` rather than raising for a blocked or ungated rider, so the caller's single raise
  site is the only error the client ever sees (`083` 5.15's reasoning: a SQLSTATE-only comparison
  passes green with a block oracle present).
- [ ] 5.2 `public.approve_club_join_request(request uuid)` — `security definer`,
  `set search_path = ''`, `#variable_conflict error`. In order: read the request by id where
  `status = 'pending'` **and** `private.is_club_admin_for(auth.uid(), club_id)` **and** not
  `private.is_blocked(auth.uid(), user_id)`; call `private.join_club_from_request`; delete the
  request row; write the `club_join_request_approved` notification. **One raise site.** Comment that
  the order is load-bearing: the notification's own guard and the SELECT policy's `EXISTS` both
  need the membership row to exist first (`design.md` §The ordering rule).
- [ ] 5.3 `public.decline_club_join_request(request uuid)` — same shape, one
  `update … set status = 'declined', responded_at = now() where id = request and status = 'pending'`
  guarded identically, **no membership write and no notification**. One raise site.
- [ ] 5.4 Grants on both RPCs: `revoke all from public, anon`, `grant execute to authenticated`.
  Expect **two** more advisors from these, and none from the four `private` functions.
- [ ] 5.5 `notifications_type_check` — drop and recreate naming **ten** types.
  `notifications_subject_shape` — drop and recreate with two new arms, each
  `postcard_id is null and comment_id is null and ride_id is null and club_id is not null`, and the
  `else false` arm intact. **Both in the same statement block**; `036`'s comment says why the second
  is load-bearing rather than tidy.
- [ ] 5.6 `private.notify_club_join_requested()` — `after insert on public.club_join_requests`,
  `security definer`, `set search_path = ''`, **no `when` clause** (trap (a)), **`auth.uid()`
  nowhere** (trap (b)), actor from `new.user_id`. Recipients: a **direct query** unioning
  `clubs.owner_id` with `club_members where role in ('owner','admin')` — the same union
  `notify_club_joined` uses — excluding the actor, excluding
  `private.is_blocked(new.user_id, recipient)`, and guarded per recipient by
  `private.can_read_club(recipient, new.club_id)`. **`private.is_club_admin_for`, never
  `private.is_club_admin`** (trap (c)). `on conflict do nothing`.
- [ ] 5.7 `private.retract_club_join_requested()` — `after delete on public.club_join_requests`,
  deleting exactly the `club_join_requested` rows the fan-out would have written, matched on the
  full event key **including `type`** (`retract_postcard_liked`'s shape). It must not touch
  `club_join_request_approved` or `club_joined`.
- [ ] 5.8 **No decline fan-out**, and a comment where a reader would expect one, naming `036` §3's
  `club_id` conjunct and `openspec/specs/notifications/spec.md`'s standing requirement. This is the
  single most likely thing for a later session to "fix".
- [ ] 5.9 `revoke all` on both fan-out functions from every role; they are reached only as triggers.
- [ ] 5.10 Write the verification footer: policy count and per-verb list on `club_join_requests`;
  `anon` grant count **0**; the **enumerated** INSERT columns;
  `has_table_privilege('authenticated','public.club_join_requests','update')` = **false**;
  `prosecdef` true on the seven new definer functions;
  `has_function_privilege('authenticated','private.is_club_admin_for(uuid,uuid)','execute')` =
  **false** and the wrapper = **true**; `discoverable_private_clubs`' return list as seven named
  columns out of `pg_get_function_result`; gate trigger count **16**; advisor count **20**; both FKs
  present with `confdeltype = 'c'`; `notifications` CHECKs naming ten types; and **`clubs` SELECT's
  qual md5 unchanged**, captured before and after — a prose claim does not discharge that one.

## 6. Apply and verify

- [ ] 6.1 Apply `085` to DEV via `apply_migration`. Well under `036`'s 61 KB, so no reduction
  technique is needed.
- [ ] 6.2 **Hand-exercise the affected write path in a rolled-back transaction on DEV**, per `036`.
  The path is narrow but real: `notify_club_joined` fires `after insert on club_members` with no
  `when` clause, so it now runs inside `join_club_from_request`, and a raise there takes the whole
  approval down. Exercise: an ordinary club join by a rider (unchanged path), an approval into a
  private club, and an approval into a club whose owner holds no membership row (`054`'s case).
- [ ] 6.3 Run the footer's verification queries. Every number must match; a mismatch is investigated
  before any code lands.
- [ ] 6.4 `get_advisors(security)` on DEV — expect **20**, from seventeen: three new
  `authenticated_security_definer_function_executable` WARNs, and **none** for the four `private`
  functions. A twenty-first means a revoke did not land or something was created in `public` that
  should be in `private`.
- [ ] 6.5 `PGPASSWORD=postgres npm test` green, reconciled by **label set** against 0.4's.
- [ ] 6.6 `npm run db:drift` if `PROD_DATABASE_URL`/`DEV_DATABASE_URL` are available; otherwise
  substitute `list_migrations` against `ls supabase/migrations/` and record the gap explicitly.

## 7. RLS assertions — `supabase/tests/rls_test.sql`

Every task here is required: `openspec/config.yaml` and `CLAUDE.md` both say a policy change with no
new assertion is not finished. Each maps to a scenario in `specs/club-join-requests/spec.md`. Label
them `085.N`, on the existing convention, with a fixture-id block at the head naming which rider
each id is.

Fixtures needed: a private club with an owner, an **admin** (created directly — `019` makes the role
insertable by no client), an ordinary member, a requester, a second requester, a rider blocked with
the owner, a rider blocked with an admin, an onboarded-but-unstamped rider, a public club as the
control, and the `is_default` club.

- [ ] 7.1 **`clubs` SELECT's qual is unchanged**, by equality against §060.1b's pin. The assertion
  this whole change exists not to need.
- [ ] 7.2 **`private.can_read_club`'s `prosrc` is unchanged**, by equality. Failure message names
  `060`'s warning that it restates a policy and can go stale.
- [ ] 7.3 **`club_members`' INSERT policy qual is unchanged**, by equality.
- [ ] 7.4 The accessor returns the private club to a non-member, and returns **exactly seven
  columns** — asserted against `pg_get_function_result`, so a widening of the return list is a red
  test rather than a code review.
- [ ] 7.5 The same rider reads **zero rows** from each of `clubs`, `club_members`, `rides`,
  `postcards`, `club_threads`, `club_messages`, `feed_reads` and `club_thread_reads` for that club —
  **eight separate assertions**, one per table. A single combined one cannot say which predicate did
  the work.
- [ ] 7.6 The same rider reads zero rows from `storage.objects` for the club's avatar and cover
  paths. Two assertions, and they are what pins `design.md` §The avatar that will not sign, so that
  the day the arm lands the test names it.
- [ ] 7.7 The accessor returns **no** public club, **no** `is_default` club, and **no** club the
  caller owns or belongs to. Four assertions.
- [ ] 7.8 The accessor's `page_size` cap: a caller passing 10000 gets no more than the cap; a caller
  passing a negative number does not error.
- [ ] 7.9 `anon` holds no EXECUTE on the accessor or either RPC, asserted by
  `has_function_privilege` and **not** by calling them — `031`'s lesson, since the suite runs as the
  table owner for whom neither barrier exists.
- [ ] 7.10 Blocking, from **one** directional `blocks` row, both directions: the club is absent from
  the accessor; the INSERT is refused; a pending request is invisible to both parties; and a third
  rider's request to the same club is unaffected. Five assertions.
- [ ] 7.11 **A block with an ordinary member changes nothing** — the club is still discoverable and
  requestable. The assertion that fails if somebody "tidies" the block conjunct to cover all members.
- [ ] 7.12 SELECT per role, one assertion each: the requester sees their own row in `pending` and in
  `declined`; the owner sees it; an admin sees it; **an ordinary member sees zero**; a member of
  another club sees zero; any other signed-in rider sees zero; `anon` holds no grant. Plus:
  `private.is_blocked(x, x)` is false, asserted directly.
- [ ] 7.13 INSERT: the requester succeeds; a foreign `user_id` is refused; naming `status`,
  `created_at` or `responded_at` is refused with `42501`; a member, an admin and the owner are each
  refused; a **public** club is refused; the `is_default` club is refused; an un-onboarded rider is
  refused with `23514`.
- [ ] 7.14 `23505` on a repeat request in **each** status — pending and declined — because the
  anti-treadmill property depends on both.
- [ ] 7.15 DELETE: the requester deletes their own `pending` row; the same delete matches **zero
  rows** for their `declined` one; an admin deletes either; an ordinary member matches zero; a third
  rider matches zero.
- [ ] 7.16 `approve_club_join_request`: the owner succeeds and a `club_members` row appears with
  `role = 'member'` and the request row is **gone**; an admin succeeds identically; an ordinary
  member, the requester themselves, and an owner of a different club each raise with **the same
  message text** a nonexistent id raises; a second approve raises identically; approving a rider
  who is already a member leaves their existing row's `role` and `joined_at` untouched and still
  removes the request.
- [ ] 7.17 **A blocked requester cannot be approved**, and the refusal is compared on the **message
  text**, not only the SQLSTATE. `private.join_club_from_request` returns `false` rather than raising
  for exactly this reason.
- [ ] 7.18 `decline_club_join_request`: an admin succeeds, `status` and `responded_at` both move, and
  **no `club_members` row appears**; a second decline raises; the requester cannot decline their own.
- [ ] 7.19 **The gate, restated**: an un-onboarded rider cannot be approved, **and** the
  `enforce_participation_gate` trigger count on `club_members` is unchanged — the two halves of
  `078`'s lesson, asserted separately.
- [ ] 7.20 `role` cannot be forced: an approval never produces an `admin` row, and `019`'s rule that
  `admin` is insertable by no client role still holds after this change, asserted through every path
  including the new RPC.
- [ ] 7.21 Cascades: deleting the club removes its requests and every notification carrying that
  `club_id`; the requester's account deletion removes their requests; the owner's account deletion
  **leaves the club and its requests standing**, transferred by `029`/`032`, and the new owner can
  answer them.
- [ ] 7.22 Visibility changes: flipping the club public leaves a pending request answerable and
  removes the club from the accessor; a rider who joins directly while holding a pending request is
  handled by `on conflict do nothing` and the request is still removable; flipping back to private
  leaves requests untouched.
- [ ] 7.23 Fan-out `club_join_requested`: written on insert to the owner and to admins with the
  requester as actor; **not** written to an ordinary member; **not** written to an admin blocked with
  the requester while the other admins still receive it; retracted on delete, matched on `type`;
  **not** retracted when only a `club_join_request_approved` row exists for the same pair.
- [ ] 7.24 **Set equality**: the recipients of `club_join_requested` equal the recipients of
  `club_joined` for the same club, minus the actor in each case. Asserted as set equality, because
  the defect guarded against is the two drifting.
- [ ] 7.25 Fan-out `club_join_request_approved`: written to the requester with the approver as actor,
  **and readable by them immediately afterwards** — the assertion that fails if the RPC's statements
  are reordered. **Mutation-test it**: move the notification write above the membership write,
  confirm this goes red, revert. An assertion for an ordering defect that has never been seen to
  fail is not coverage.
- [ ] 7.26 **A decline writes zero notifications.** The assertion that pins `proposal.md` §1.
- [ ] 7.27 `notifications`: both CHECKs name ten types and two new shapes; each new type with a NULL
  `club_id` or a non-NULL `postcard_id`/`comment_id`/`ride_id` is refused `23514`; the SELECT policy's
  qual is **unchanged** by equality; `authenticated` still holds no INSERT grant.
- [ ] 7.28 `private.is_club_admin`'s `prosrc` equals the delegation **exactly** (equality, never
  `like` — `060`'s reasoning: `like '%..._for%'` is satisfied by the mention alone), and
  `private.is_club_admin_for`'s body mentions `auth.uid()` **nowhere**.
- [ ] 7.29 An ownerless owner — a `clubs.owner_id` with no `club_members` row — is an admin under
  `is_club_admin_for`, matching `054`'s treatment of the same rider in `private.is_club_member`.
- [ ] 7.30 `anon` holds zero grants on `club_join_requests`, and no policy on it names a role other
  than `authenticated`.

## 8. Types, validation, reads and writes

- [ ] 8.1 `src/types/index.ts`: `ClubJoinRequestStatus`, `ClubJoinRequest`,
  `ClubJoinRequestListItem` (the request plus the requester's public profile), `ClubPreview` (the
  accessor's seven columns plus a signed `avatar_url` that will be null), and
  `ClubListItem.request_status?: ClubJoinRequestStatus | null`. Extend `NotificationType` with the
  two new strings — the `switch`es in `src/components/notifications/copy.ts` and
  `NotificationsListItem.tsx`'s `describe` are exhaustive, so `tsc` names every site that must
  answer. Domain types are never inlined.
- [ ] 8.2 `src/lib/validation/clubs.ts`: `clubJoinRequestIdSchema`, beside `clubIdSchema`. Zod owns
  the message; the database owns the guarantee.
- [ ] 8.3 `src/lib/data/clubs.ts`: `getClubPreview(id)` calling
  `discoverable_private_clubs(target_club)`, returning `ClubPreview | null` — `null` for a decided
  absence, `undefined` never. Guard the id with `clubIdSchema` first, the same guard `getClub` and
  `getRideForEdit` carry and for the same reason (PD-142).
- [ ] 8.4 `src/lib/data/clubs.ts`: `getExploreClubs` calls the accessor as a second read and merges.
  **`.eq('is_public', true)` stays.** Keep the page-scoped membership exclusion for the public half
  exactly as it is — the recorded defect there is that a membership-list-scoped exclusion returns
  *wrong* rows past `CLUB_MEMBERSHIP_LIMIT`, and nothing here changes that. Add the third bounded
  read for the caller's own request rows, filtered `club_id in (<the private ids on this page>)`.
  Update that function's header to describe what it now returns: *the newest fifty public clubs plus
  the newest fifty requestable private ones, nearest first*.
- [ ] 8.5 `src/lib/data/club-join-requests.ts` through `resolveSupabase`:
  `getClubJoinRequests(clubId)` (pending rows plus the requester's public profile, for the admin
  section) and `getMyClubJoinRequests(clubIds)` (the per-card status). Return `[]` for "none", never
  `null` — there is no "no such club" case for either to report.
- [ ] 8.6 `src/lib/actions/club-join-requests.ts`: `requestToJoinClub(clubId)`,
  `withdrawJoinRequest(clubId)`, `approveClubJoinRequest(requestId)` (**RPC**),
  `declineClubJoinRequest(requestId)` (**RPC**). Plain async functions, `useActionState`-compatible.
  `23505` from the insert is "already requested", not an error.
- [ ] 8.7 `withdrawJoinRequest` must not chain `.select()` onto its delete — `RETURNING` re-attaches
  the SELECT policy, which is the mechanism that makes a delete match zero rows and still report
  success (`add-club-threads` 7.4b's measured finding).
- [ ] 8.8 No component calls `supabase.from()`; nothing outside `lib/data/` and `lib/actions/`
  reaches Supabase except through `@/lib/supabase/client`, whose file list is a review heuristic and
  is not widened by this change.

## 9. Cache keys

- [ ] 9.1 Add `clubs.preview(clubId)`, `clubs.joinRequests(clubId)` and `clubs.myJoinRequests()` to
  `src/lib/query/keys.ts`. No key written inline in a component, ever. **Add no key without a
  reader.**
- [ ] 9.2 `clubs.preview` is `['clubs','preview',clubId]` and **not** a child of
  `clubs.detail(clubId)` — the two hold different shapes and a shared key would serve whichever
  landed first. `clubs.joinRequests` **is** a child of `clubs.detail(clubId)`, so an approval
  claiming `clubs.all()` reaches it. Document both in the header's prefix-reach table, stated
  positively.
- [ ] 9.3 Wire the invalidations per `specs/client-cache-invalidation/`. `approveClubJoinRequest`
  reuses `invalidateClubMembership` rather than enumerating club keys — an enumeration looks
  narrower and misses `clubs.mine()`, the picker on the create-ride and create-postcard forms, which
  is the recorded reason `joinClub` claims the whole prefix.

## 10. Screens

- [ ] 10.1 **Read the design from `design/` first.** `npm run figma -- tree "v2 / Component / List /
  Club" --all` confirms three variants and no `Private + not Joined`; there is no frame for a
  reduced club screen and none for a request list. Assemble from measured components — the
  `Button / Link / Primary` in the card's trailing slot (65×32, `Accent Brand/100`,
  Poppins/14/Semibold), `ClubMembershipButton`'s full-width `Button / Regular`,
  `v2 / Component / List / User` for request rows — and **log the deviation in
  `docs/FIGMA-FIDELITY-TODO.md`** rather than inventing and calling it measured. Icons from
  `@/components/icons/generated`; primary buttons near-black `Grey/100 #1A1A1A`, never green.
- [ ] 10.2 `ClubCard`: the fourth variant. Its header comment currently states that
  `Private + not Joined` "cannot occur" — **that comment must be replaced, not annotated**
  (`CLAUDE.md` §Working Principles — replace a wrong claim, do not narrate it). The trailing slot draws `Request to join`, then
  `Requested` as plain text, then nothing; the riders row draws the member count with **no faces**,
  because the accessor returns no roster; the `Private club · <location>` type line is unchanged.
- [ ] 10.3 The card's stretched `<Link>`: keep it if Q5's answer is the reduced screen, remove it for
  private cards if not. Whichever, `preventDefault`/`stopPropagation` on the request control stays —
  the navigation is an overlay *under* the control and without it a tap would both request and
  navigate, and the request would be invisible because the page changed.
- [ ] 10.4 `JoinClubButton` gains a request mode, or a sibling `RequestToJoinButton` is added beside
  it. Prefer the sibling: `JoinClubButton`'s header is explicit that the Explore control and the
  detail control are *different controls in the design, not one component with a prop*, and the same
  argument applies again here.
- [ ] 10.5 `ClubMembershipButton` is untouched. The reduced screen gets its own full-width control,
  for the same reason.
- [ ] 10.6 `ExploreClubsList`: no change to the near/rest split — private clubs carry coordinates
  from the accessor and sort through the existing comparator. Confirm the `Near <place>` heading
  still counts exactly what it lists after the merge; that agreement is PD-258's trap and it is
  re-derived from the merged array, not from either half.
- [ ] 10.7 `ExploreClubsStrip`: no change. It draws no count, and its `near` clause is derived from
  `explore.data` — the same merged array under the same key — so the row and its destination still
  cannot disagree.
- [ ] 10.8 `src/app/(app)/clubs/detail/page.tsx`: the second render branch per
  `design.md` §The reduced club screen. **`if (club.data === null && preview.data === null)
  notFound()`**, with the preview query disabled until the primary read has decided. Do not touch
  `isMember` or `viewer_role`.
- [ ] 10.9 The admin request section on the **full** branch, above Members, rendered only when the
  viewer is an owner or admin and only when there is at least one pending row. Approve and Decline
  per row, each absent rather than disabled when unavailable.
- [ ] 10.10 `notificationCopy` gains two arms and `describe` gains two cases — both destinations are
  the club. Follow the `club_joined` precedent: resolve the sentence against live subject data,
  never against a column stamped on the notification. `club_join_requested` renders Approve/Decline
  beside the row through a component that reads the **live request row**, on `RideInviteActions`'
  shape, returning null for every other case.
- [ ] 10.11 Every screen: gate on **data**, never `isLoading`; `null` is decided and `undefined` is
  "not yet"; skeleton at the content's own padding; an error state with retry that is not an empty
  list; a **partial** state where an unknown request status draws no control; offline disables the
  controls with a reason and **does not queue** the answer.
- [ ] 10.12 Add nothing to `src/lib/routes.ts` — the reduced screen reuses `routes.club(id)`. Confirm
  the walk's route list still covers it, and that a private club id is reachable in the walk's
  fixtures or record that it is not.

## 11. Verify and document

- [ ] 11.1 `npx tsc --noEmit` clean; `npm run lint`; `npm run test:unit` with no file lost;
  `npm run build` green; `npm run docs:check`;
  `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs`.
- [ ] 11.2 `npm run walk` against DEV through `scripts/supabase-relay.mjs`. Chromium in this
  container cannot reach Supabase directly — read the relay's header first.
- [ ] 11.3 `docs/reference/schema.md`: a `club_join_requests` row carrying its audience predicate,
  both cascades, the retention decision and the state table; **and one sentence each** on the
  `clubs` row (a private club's name is now reachable through `discoverable_private_clubs`, and
  `clubs` SELECT is unchanged) and the `club_members` row (a third writer,
  `join_club_from_request`). **Keep the edit to those three rows** — another session holds
  `docs/reference/` territory for other files.
- [ ] 11.4 `CLAUDE.md`: the advisor table by three, naming all three new `public` RPCs; the
  participation-gate paragraph to **sixteen** tables with `club_join_requests` named; and the
  `security definer` RPC list. **Main thread writes these, not a subagent.**
- [ ] 11.5 `docs/HANDOFF.md`: the applied-migration position after `085`, the PROD promotion order,
  and — under Known issues — that a private club's avatar draws initials until the storage arm in
  `design.md` §The avatar that will not sign lands, and that `admin` is still insertable by nobody
  so every "or admin" rule here is owner-only until PD-326. **Main thread writes this.**
- [ ] 11.6 Run `reviewer` on the proposal **before** the migration is written (it is the only
  artifact in this pipeline with no automated gate), and again on the final diff, once, immediately
  before the PR.
