# Show private clubs in Explore, and let a rider ask to join one

> Linear **PD-325**. This file is the specification and the issue must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*). The admin surface for answering a request beyond the minimum built here is **PD-326
> Manage riders**; §Explicitly NOT in this change draws that line precisely.

## ⚠ Read this first — what is second-hand

**No Linear tool and no Supabase tool were available while this was written**, and no `ToolSearch`
either — the author's tool list held `Read`, `Write`, `Edit`, `Glob`, `Grep` and `Bash` and nothing
else, so the deferred-versus-absent probe `CLAUDE.md` §The Agent Squad prescribes **could not be
run at all**. That is a weaker diagnosis than "absent": it cannot distinguish a brief that never
carried the tools from a connector rotation.

Concretely, for the reader:

- **PD-325's issue body and its comments were not read.** The story, the six decision points and
  the required negative-case list are second-hand from the spawning brief. This repo corrects a
  stale body **by commenting on it**, so if the issue's top comment supersedes anything below, that
  correction is not reflected here. `get_issue PD-325` **and** `list_comments PD-325` — neither
  alone is the issue — are task 0.1, before any SQL is written.
- **Nothing was verified against a live database.** The policy texts, grants, helper bodies,
  trigger definitions and constraint shapes quoted below are read from the repo's own migration
  chain, `supabase/tests/rls_test.sql` and `docs/reference/schema.md`, each with the file that
  produced it. Where the brief supplied a measurement from DEV it is marked as such. The
  applied-migration position and every count are re-derived in task 0.3/0.4 rather than trusted.
- **The `openspec` CLI is not installed** (`npm run openspec -- list` → `sh: 1: openspec: not
  found`), so these artifacts were written by hand against the structure
  `openspec/changes/invite-riders-to-a-ride/` establishes. `openspec validate` has not run on them.

`CLAUDE.md` §Working Principles: *"Never let an inferred value pass silently as a known one."*
Nothing below is inferred and unmarked.

## Three things the brief asked for that this proposal does NOT build as asked

Surfaced rather than built around, per `CLAUDE.md` §Working With the Product Owner — a squad agent
raises the objection and the main thread holds it.

### 1. "The rider learns the answer" is HALF undeliverable, and the half that fails is the decline

The brief's decision point 4 asks for notifications on both ends: admins learn a request arrived,
the rider learns the answer. The approval half works. **The decline half cannot be delivered by a
notification at all**, and this is a mechanism rather than a preference:

`036` §3's `notifications` SELECT policy carries a per-column resolvability conjunct —

```sql
and (club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id))
```

— evaluated **under the reader's own row security**. A declined requester holds no `club_members`
row and does not own the club, so `clubs` SELECT returns nothing for it, the `EXISTS` is false, and
the row is **not returned and not counted**. It is not a bug that shows up as an error; the row is
written, sits in the table for ever, and is invisible. `openspec/specs/notifications/spec.md`
already states this as a requirement in the other direction — *"A non-member never receives a
private club's name … the club SHALL not resolve, the row SHALL not be returned"* — so a decline
notification carrying `club_id` is a row this repo's standing contract says must not be returned.

The three ways out and what each costs are in `design.md` §Why a decline is silent. **What this
proposal builds is the third: no decline notification.** The `club_join_requests` row is the record,
readable by the requester under its own SELECT policy, and the club simply stops appearing in their
Explore list. A decline is a quiet no.

If the product owner wants the rider told out loud, the change is **not** one predicate: it is
either a new notification type carrying **no** subject at all (which cannot name the club, and
therefore says "somebody declined something") or an arm on `clubs` SELECT, which §Explicitly NOT
in this change refuses and `design.md` §Why the accessor, not the policy prices.

### 2. "Owner and admins can approve" is OWNER-ONLY in practice, and will be until PD-326 ships

`019` makes `club_members.role = 'admin'` **insertable by nobody and writable by nobody** — there
is no UPDATE policy on `club_members` at all, which is the property `036` §7.6 relies on for
"nobody can promote an admin" — and `029`'s pre-flight measured **zero** `admin` rows. So on the
day this ships, the set "owner ∪ admins" is exactly "the owner".

This is not a reason to write the rule narrowly. Everything below names **owner or admin**, because
PD-326 is what makes the second half non-empty and a rule written as `owner_id = auth.uid()` is one
that PD-326 would have to find and widen. But two consequences must be stated rather than
discovered:

- **A club with one owner has one answerer.** If that owner never opens the app, every request to
  that club is pending for ever, with no expiry and no escalation. That is a stated retention
  decision (`specs/club-join-requests/` §Requests SHALL have a stated retention), not an oversight.
- **`029`'s succession hands `clubs.owner_id` to a remaining member on account deletion**, so a
  club never ends up with no answerer through deletion. Verified from `032`'s body, not from a
  live database.

### 3. The card's avatar for a private club WILL NOT RENDER without a second, separate widening

The brief's decision point 1 names "name, avatar, location, member count" as the accessor's shape.
Three of those four are the accessor's to return. **The avatar is not**, and the accessor cannot
fix it: `016`'s `"Club avatars are readable with the club"` policy on `storage.objects` is

```sql
exists (select 1 from public.clubs c where c.avatar_path = storage.objects.name and …)
```

— again under the reader's own RLS, so a non-member of a private club cannot read the object and
`signImagePaths` returns null. `Avatar` then falls back to initials, silently and correctly.

So: **the accessor returns `avatar_path`, and `085` adds no storage policy.** Private clubs in
Explore draw the club's initials. `design.md` §The avatar that will not sign carries the one-arm
storage change that would fix it, so that adding it later is a policy edit and not a redesign, and
`tasks.md` 0.2 puts it to the owner with that default. It is called out here because "why is the
avatar missing" is the first thing anyone will ask of the shipped screen, and the answer is a
policy in a file nobody will think to open.

## Why

**A private club cannot be found, so it cannot be grown.** `clubs` SELECT is
`(is_public OR owner_id = auth.uid() OR private.is_club_member(id))` and `getExploreClubs` filters
`.eq('is_public', true)` on top of it, so a private club is invisible to everyone outside it and
the only way in is for a member to already know you. The design agrees with that today — the
`v2 / Component / List / Club` component set has **three** variants, not four, and
`Private + not Joined` is *not drawn*, which `ClubCard`'s own header records as "the design
agreeing with RLS rather than an oversight".

The product owner's request makes that fourth state occur, which means it is not a screen change:
it is the first time a rider reads anything about a club whose SELECT policy excludes them.

It needs a proposal rather than a ticket for the reason `openspec/config.yaml` states — *"a
visibility decision left unstated in a spec does not fail loudly, it silently becomes whatever the
migration author assumed"* — and the specific unstated thing here has a name: **how much of a
private club becomes visible in order to make it requestable.** Every plausible implementation
answers that differently, and one of them (widening `clubs` SELECT) answers it for nine other
policies at the same time without saying so.

## What Changes

**One migration, `085`.** 84 files in the repo, DEV at `084`, PROD at `079` — re-derive with
`list_migrations` against `ls supabase/migrations/` per `CLAUDE.md`'s own instruction not to read
the number off prose, and promote the `080`–`084` gap to PROD in filename order **before** adding
to it. `085` is additive in schema.

**It is NOT inert, and the hazard is one function.** `085` creates no trigger on an existing table
and replaces no existing policy — but the two `private.is_club_admin*` helpers it adds are called
from a new fan-out that fires on a new table, so nothing on a shipped write path changes. **The one
thing to check before trusting that** is task 6.2: `notify_club_joined` already fires
`after insert on public.club_members` with **no `when` clause**, so it fires *inside* the approval
RPC, which is new behaviour on an existing fan-out reached from a new caller. `036`'s
hand-exercise gate applies to that path specifically.

### New

- **`public.club_join_requests`** — `id`, `club_id`, `user_id`, `status`, `created_at`,
  `responded_at`. `unique (club_id, user_id)`, so a second request is a `23505` rather than a
  second row. RLS on, `to authenticated` only, INSERT granted **per column** over
  `(id, club_id, user_id)` so `status`, `created_at` and `responded_at` are server-owned. One
  participation-gate trigger, taking the count from **fifteen** to **sixteen** on DEV.
  **No `responded_by` column** — `design.md` §What the requester may learn says why storing which
  admin refused is a disclosure the requester's own SELECT policy would hand them.
- **`private.is_club_admin_for(candidate uuid, target_club uuid)`** — subject-taking,
  `security definer`, `stable`, `set search_path = ''`, granted to **no** client role.
  **`private.is_club_admin(target_club uuid)`** — the caller-relative wrapper whose body is
  *exactly* `select private.is_club_admin_for(auth.uid(), target_club);` and nothing else, on
  `060`'s `is_club_member` / `is_club_member_for` pattern, granted to `authenticated` because an
  RLS expression is evaluated as the querying role. **One body, two entry points, pinned by
  equality in the suite**, so an arm added to one and not the other cannot hide.
- **`private.club_takes_join_requests(candidate uuid, target_club uuid)`** — the discovery
  predicate: the club exists, is **not** public, is **not** `is_default`, the candidate is neither
  its owner nor a member, and neither party is blocked with `clubs.owner_id`. In `private`, so
  PostgREST cannot publish it and a rider cannot use it as a private-club oracle.
- **`public.discoverable_private_clubs(target_club uuid default null, page_size int default 50)`** —
  the one widened read. `security definer`, returns a **narrow** row per club:
  `id, name, avatar_path, location_name, latitude, longitude, members_count`. Nothing of the club's
  rides, postcards, threads, roster, description, cover, owner or `created_at`. `target_club`
  non-null narrows it to that one club, which is what serves the reduced detail screen — **one
  function, one body, two call shapes**, so the list and the screen cannot disagree about what a
  non-member may see.
- **`public.approve_club_join_request(request uuid)`** and
  **`public.decline_club_join_request(request uuid)`** — `security definer`,
  `set search_path = ''`, `#variable_conflict error`, each taking the **request id and never a
  rider id**, each re-checking `private.is_club_admin_for(auth.uid(), club_id)` in its own body,
  each with **one** raise site so "not yours", "no such request" and "already answered" are
  indistinguishable (`043`'s shape, `083`'s pair as the model).
- **`private.join_club_from_request(rider uuid, target_club uuid)`** — the single place that writes
  the `club_members` row on an approval path, restating the participation gate in its own body
  because the gate trigger on `club_members` carries `when (current_user = 'authenticated')` and
  cannot fire for a `security definer` writer (`078`, and `078.9`'s rule that a compensating
  trigger must **not** be added).
- **Two fan-outs and one retraction** on `club_join_requests`, and **two** new `notifications`
  types — `club_join_requested` and `club_join_request_approved` — extending
  `notifications_type_check` from **eight** strings to **ten** and adding two arms to
  `notifications_subject_shape`, each carrying `club_id` alone. **There is deliberately no
  `club_join_request_declined`**; see §1 above.
- **Screens**: a `Request to join` control on the Explore card for a private club, a **reduced club
  detail screen** for a private club a rider is not in, and the **minimum approval surface** — a
  pending-request list on the club detail visible to its owner and admins, with Approve and
  Decline on each row.

### Changed

- **`getExploreClubs`** reads the public page it reads today **and** calls
  `discoverable_private_clubs()`, merging both into one list under the existing
  `queryKeys.clubs.explore(...)` key. `.eq('is_public', true)` stays exactly where it is: it is
  the *public* half's definition, and `design.md` §Two halves, one list explains why removing it
  would be the re-filtering defect `getExploreClubs`' own header warns about.
- **`ClubCard`** gains the fourth variant. `Private club` on the type line is unchanged and stays
  the honest description; the trailing slot draws `Request to join`, then `Requested`, then
  nothing; and the riders row draws a **member count with no faces**, because the accessor returns
  no roster.
- **The club detail route serves two screens.** `getClub` still returns `null` for a private club a
  rider is not in — unchanged, and still indistinguishable from "no such club" — and the page then
  asks `getClubPreview(id)` before deciding on `notFound()`. **`viewer_role` and `isMember` are
  untouched**: the preview branch never computes them, because it never has a `ClubDetail`.

### Explicitly NOT in this change

- **Widening `clubs` SELECT.** Refused, and `design.md` §Why the accessor, not the policy
  enumerates what the alternative would have opened, policy by policy — that enumeration is the
  argument, not a footnote.
- **PD-326's roster management.** No role promotion, no removing a member, no transferring
  ownership, no member search. The pending-request list this change builds is the **minimum** that
  makes a request answerable, it lives where PD-326's list will live, and `design.md` §The seam
  PD-326 absorbs states exactly what PD-326 replaces and what it inherits.
- **A decline notification.** §1 above.
- **An expiry on a pending request.** Decided, not overlooked;
  `specs/club-join-requests/` §Requests SHALL have a stated retention records the decision and the
  trigger that would reopen it.
- **A block arm on `clubs` SELECT.** `060`'s own comment names that as a reachable future state and
  `085` does not bring it forward. The block check lives in the new accessor and the new table's
  policies only, so a blocked rider's view of a **public** club is byte-for-byte what it is today.
- **Push delivery of the two new types.** `deliver-push-notifications` owns that surface.
- **`club_unread_counts()` counting anything new.** Untouched.

## Capabilities

### New Capabilities

- `club-join-requests`: what a rider outside a private club may see of it, who may ask to join, who
  may answer, what every other role sees of a request in every state, and what a request does when
  the club is deleted, flips public, or when either party blocks the other or deletes their
  account.

### Modified Capabilities

- `database-enforced-integrity`: *"Club membership role SHALL NOT be self-assignable"* is written
  against a world where the only writer of `club_members` is the rider themselves plus
  `complete_onboarding`. This change adds a third writer that inserts a row for **somebody else**,
  which is the first time that requirement's `auth.uid() = user_id` framing is not the whole story.
  *"A private club's ride SHALL NOT be publicly visible"* also needs the boundary restating: the
  club's **name** now reaches a non-member and its rides still do not, and stating only the second
  half is how the first gets assumed.
- `notifications`: the type list and the subject shape are part of the contract, and the
  *"A rider SHALL NOT learn a private club's name … from a notification"* requirement is the one
  this change comes closest to breaking — it does not, and the reason it does not (the name arrives
  through an accessor, never through a notification row) has to be written down or the next change
  will read the accessor as permission.
- `event-fanout-integrity`: *"The recipient set SHALL be computed by direct query, never through a
  caller-relative helper"* — `private.is_club_admin` is a **new** caller-relative helper and the
  request fan-out's recipient set is exactly the set it describes, which is trap (c) with a fresh
  function to fall into. And an existing fan-out (`notify_club_joined`) acquires a
  `security definer` caller for the first time.
- `client-cache-invalidation`: one approval moves keys across three domains and one of them is the
  **Explore list**, which is the key a rider is *looking at* when they tap.
- `client-render-shell`: the reduced club screen is the first screen in this app whose defining
  property is that **it asks no question that could return zero rows**, which is a different answer
  to *"Permission-denied and empty SHALL be told apart"* than any existing screen gives.

## Impact

**Database** — `supabase/migrations/085_club_join_requests.sql`; assertions in
`supabase/tests/rls_test.sql` (re-derive the suite size with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and reconcile by **label set**, never by
count, because a count cannot tell a rename from a loss).

**Security advisors** — **three** new `authenticated_security_definer_function_executable` WARNs,
for `discoverable_private_clubs`, `approve_club_join_request` and `decline_club_join_request`, and
**none** for the four `private` functions, which PostgREST does not publish (`083`'s measured
reason, and the mistake `078`'s task list made was reading a sweep of two as one). Count them off
`get_advisors(security)` rather than off this paragraph.

**Participation gate** — one new trigger, on `club_join_requests` INSERT. Expected **sixteen** on
DEV. The comment on `public.enforce_participation_gate()` must be restamped and its enumeration
extended, per `028` and `033`: it is the `data` agent's first read via `list_tables` and no edit to
`CLAUDE.md` reaches it. **`join_club_from_request` is `078`'s case exactly** — the gate trigger on
`club_members` cannot fire for a definer writer — so the gate is **restated in that function's
body** and an assertion pins the restatement *and* pins that no second trigger was added.

**Reads** — new `src/lib/data/club-join-requests.ts` through `resolveSupabase`, plus
`getClubPreview` and a changed `getExploreClubs` in `src/lib/data/clubs.ts`. **Writes** — new
`src/lib/actions/club-join-requests.ts`, plain async functions. No component calls
`supabase.from()`.

**Cache** — three new keys in `src/lib/query/keys.ts`, with the reconciliation note that file's
header exists for, and a documented cross-domain invalidation from the approval.

**Validation** — no new rider-authored text column, so no new content schema.
`clubJoinRequestIdSchema` joins the id schemas in `src/lib/validation/clubs.ts`.

**Types** — `ClubJoinRequest`, `ClubJoinRequestStatus`, `ClubPreview` and a
`ClubListItem.request_status` field in `src/types/index.ts`. `NotificationType` grows by two, which
is a compile-time fan-out into `notificationCopy` and `NotificationsListItem`'s `describe` — both
`switch`es are exhaustive, so `tsc` names every site that must answer.

**Design** — **no v2 frame exists for a `Private + not Joined` club card, for a reduced club
screen, or for a request list.** `v2 / Component / List / Club` has three variants and the fourth
is the one this change creates. The composition must be assembled from measured components — the
`Button / Link / Primary` in the card's trailing slot (65×32, `Accent Brand/100`,
Poppins/14/Semibold), `ClubMembershipButton`'s full-width `Button / Regular`,
`v2 / Component / List / User` for the request rows — and logged in
`docs/FIGMA-FIDELITY-TODO.md` rather than invented and called measured.

**Dependencies** — none added. Nine runtime dependencies before and after
(`node -p "Object.keys(require('./package.json').dependencies).length"`).

**Docs** — `CLAUDE.md`'s advisor table by three and its participation-gate paragraph to sixteen
tables; `docs/reference/schema.md` gains a `club_join_requests` row and its `clubs` and
`club_members` rows each gain a sentence. **Main thread writes those, not a subagent, and the doc
edit stays scoped to those three rows** — another session holds `docs/reference/` territory for
other files.
