# Manage riders — a club gets more than one person who can act, and a refused rider is told

> Linear **PD-326** (*Manage riders*) and **PD-335** (*two decisions PD-325 left to you*), built
> together on `pedro88email/pd-326-manage-riders`. This file is the specification and neither issue
> may restate it (`CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a
> specification is a bug."*).
>
> **PD-335's two questions are ANSWERED, 2026-08-28, by the product owner** — *"C declined rider
> gets told yet. D yes, avatars can be seen."* They are designed here, not re-litigated.

## What was read, and what was measured

Both Linear issues were read **body and comments** (`get_issue` + `list_comments`), and everything
below marked *measured* was read off `letsride-dev` (`fpmrimzxadewsaiwpsel`) or
`letsride` (`zwprydcyryvudhurbnye`) through `execute_sql` / `list_migrations` on 2026-08-28. Nothing
here is inferred and unmarked.

**The `openspec` CLI is still not installed** — `npm run openspec -- list --json` returns
`sh: 1: openspec: not found`, and `node_modules/@fission-ai/openspec` holds no `bin` this project can
run — so these artifacts were written by hand against the structure
`openspec/changes/show-private-clubs-and-request-to-join/` establishes. `openspec validate` HAS since run on them and the change validates. Same artifact, per `CLAUDE.md` §Working Principles' *fix the tool, don't route around it*;
recorded rather than passed over.

## Four things that contradict what a reader would otherwise assume

Surfaced first, because each one changes a decision.

### 1. `openspec/specs/` holds EIGHT standing capabilities, not four

`client-render-shell`, `client-cache-invalidation`, `client-session-storage`,
`database-enforced-integrity`, **`event-fanout-integrity`, `notifications`,
`realtime-subscriptions` and `ride-chat`**. The deltas below are written against all of the ones
they touch, including the four that a stale "four exist" reading would have skipped — and
`notifications` is the one this change **modifies rather than extends**, so skipping it would have
been the whole defect.

### 2. `design.md` §The avatar that will not sign's SQL does not compile against shipped `085`

The one-disjunct arm PD-335 tells the build to lift verbatim reads

```sql
and private.club_takes_join_requests(auth.uid(), c.id)
```

— the **two-argument** form. `085` shipped the two-argument function as
`private.club_takes_join_requests_for(uuid, uuid)` and **revoked EXECUTE on it from
`authenticated`** (measured: `has_function_privilege('authenticated',
'private.club_takes_join_requests_for(uuid,uuid)','execute')` is false, and `085.28` pins the pair).
A `storage.objects` policy is evaluated as the querying role, so that arm would raise `42501` on
every avatar read for every rider — a *worse* failure than the initials it replaces, and one no test
that only inspects the policy text would catch.

**The arm that works is the one-argument caller-relative wrapper**, `private.club_takes_join_requests(c.id)`,
which `085` grants to `authenticated` precisely so RLS expressions can reach it. §The avatar that
ships in `design.md` carries the corrected SQL.

### 3. The standing `notifications` spec forbids exactly what PD-335 orders

`openspec/specs/notifications/spec.md` §*A rider SHALL NOT learn a private club's name … from a
notification* carries the scenario *"A non-member never receives a private club's name — THEN the
club SHALL not resolve, the row SHALL not be returned, and the club's name SHALL never reach their
device."* Telling a declined rider is a **MODIFIED** requirement, not an added one, and this change
carries that delta. Shipping the decline without it would leave a standing contract the code
contradicts, which is the state `openspec/config.yaml` exists to prevent.

**And a second, unarchived contract says the same thing harder.**
`openspec/changes/show-private-clubs-and-request-to-join/specs/notifications/spec.md` states
*"there SHALL be no `club_join_request_declined` type."* That change is **not archived** (it is on
this same branch), so the archive order is load-bearing:
`show-private-clubs-and-request-to-join` **first**, then this one — otherwise the standing spec is
folded out carrying a requirement that shipped code already breaks. `tasks.md` 9.3.

### 4. `moderate_club_thread` is owner-only, so "admin" is narrower than the word suggests

Measured from `prosrc`: `public.moderate_club_thread(thread uuid)` gates on
`c.owner_id = v_uid` and admits no admin arm. So an admin created by this change can accept, remove
and be answered to — and **cannot delete a thread in their own club**. That is left alone
deliberately (§Explicitly NOT in this change) and stated here because "promote to admin" reads as a
general grant and is not one.

## Why

**A club has exactly one person who can act, and no way to remove anyone.** Measured today:

- `club_members` has **three** policies — SELECT, INSERT, DELETE — and **no UPDATE policy at all**
  (measured against `pg_policies`). `036` §7.6 relies on that absence for *"nobody can promote an
  admin"*, and `019` records it as design.md Q10's answer rather than an omission.
- `club_members` DELETE is `auth.uid() = user_id`: **you may leave, nobody may remove you.**
- `048`'s per-column UPDATE grant over `(club_id, user_id, role)` is real and **entirely dead** —
  the grant exists, the policy that would let it fire does not. `048`'s own header says it was
  narrowed *"so a future member-promotion policy cannot inherit `joined_at` for free"*. This is that
  future.

So a private club whose owner stops opening the app has a request queue nobody can answer, a roster
nobody can correct, and — until this change — an `029` succession path whose first arm has never
been reachable, because no `admin` row has ever existed.

And separately, **a refused rider currently learns nothing.** `085` shipped a silent decline
because `036` §3's club conjunct would have made a decline notification a row written and never
returned. The product owner has now asked for the rider to be told **without** either cost the
alternatives carried, and §The mechanism, adversarially in `design.md` is the answer and its proof.

## What Changes

### Two migrations, `088` and `089`, and the split is not stylistic

**Measured 2026-08-28: 87 files in `supabase/migrations/`; DEV at `087`; PROD at `079`.** So
`080`–`087` are owed to PROD in filename order **before** either of these is added to the chain —
`085` and `083` both drag `036`'s hand-exercise gate with them, and `082` renames what `081`
creates so the reverse errors. Re-derive with `list_migrations` against `ls`; do not read the
numbers off this paragraph.

| File | Contents | Apply relative to the deploy |
|---|---|---|
| `088_club_roster_administration.sql` | three `security definer` RPCs, the dead-grant revoke, the comments | **BEFORE** the build serves |
| `089_a_declined_rider_is_told.sql` | the eleventh notification type, `036` §3/§4's one type-scoped disjunct, the fan-out, `016`'s avatar arm | **AFTER** the build is confirmed serving |

**`089` is additive in schema and belongs in the destructive-last slot anyway**, which is
`CLAUDE.md`'s rule read as written — *"the additive-first rule is about which side fails safe, not
about a fixed order"*. The reason is measurable in `src/`: `notificationCopy` and
`NotificationsListItem`'s `describe` are exhaustive `switch`es with no `default`. A row of a type
the serving bundle does not know returns `undefined` from `describe`, and
`const { href, trailing } = describe(row)` **throws** — so applying `089` ahead of the deploy means
any Decline pressed in that window takes the *whole notifications list* down for the rider it
addresses. Nothing else in this change has that property; `088` only creates functions nothing
calls yet.

### `088` — the roster becomes administrable

- **`public.remove_club_member(target_club uuid, rider uuid)`** — an owner removes anyone but
  themselves; an admin removes **members only**. `security definer`, `set search_path = ''`,
  `#variable_conflict error`, **one raise site**, so "not a member", "not your club", "you are not
  an admin" and "they are an admin and so are you" are one indistinguishable
  `insufficient_privilege`. It also **deletes any `club_join_requests` row** for that pair, which
  §Removal must not be undoable by an approval explains and which fires `085`'s retraction for free.
- **`public.promote_club_member(target_club uuid, rider uuid)`** and
  **`public.demote_club_admin(target_club uuid, target_rider uuid)`** — promotion is open to
  **owner or admin** (PD-326's own title) and demotion is **owner, or the admin stepping down**, each writing a
  **literal** role and taking **no role argument**, which is `019`'s rule and `085`'s
  (*"there is no input by which to attempt it"*) carried into the first path that ever writes
  `admin`.
- **`revoke update on public.club_members from authenticated`, with nothing re-granted.** `048`'s
  list becomes an absence rather than a dead grant, on `078`'s shape — the RPCs are now the only
  writers, and a dead grant beside a live writer is a loaded gun for whichever later migration adds
  an UPDATE policy for an unrelated reason.
- **No UPDATE policy on `club_members`.** The absence stays the enforcement. `036` §7.6's premise
  survives this change intact and `088` asserts it.

### `089` — the rider is told, and the avatar ships

- **An eleventh type, `club_join_request_declined`**, carrying **`club_id` alone** — `club_joined`'s
  existing subject shape, so `notifications_subject_shape` gains one arm and nothing else moves.
- **`actor_id` is the REQUESTER, not the declining admin.** That is the whole of how this discloses
  nothing: `NOTIFICATION_SELECT` embeds `actor:profiles!actor_id(...)`, so any other choice hands
  the requester the identity `085` refused a `responded_by` column to withhold. §The mechanism,
  adversarially defends it and names the two candidates it beats.
- **ONE type-scoped disjunct** on `036` §3's club conjunct and on `036` §4's two identical copies:
  `or (type = 'club_join_request_declined' and private.club_takes_join_requests(notifications.club_id))`.
  Type-scoped, so **no other `club_id`-carrying notification resolves any differently** — this is
  not PD-335's option C.
- **A fan-out** `private.notify_club_join_request_declined()` on `after update of status`, guarded
  per recipient by the readability predicate itself, and **the retraction is already built**:
  `087`'s `retract_club_join_requested_on_answer` fires on the same event and `085`'s `type`
  conjunct is what stops it eating the row this one writes.
- **`016`'s club-avatar SELECT policy gains a third disjunct**, one-argument form per §2 above. The
  covers policy is **untouched** — *an avatar is the club's identity, a cover is its content*, the
  product owner's words.
- **`085.6` inverts.** That assertion pins the avatar *not* signing; it is replaced rather than
  deleted, and its cover half stays exactly as written.

### Screens

- **A `Manage riders` row in `ClubOptionsMenu`**, gated on `viewer_is_owner || viewer_role ===
  'admin'`, opening `/clubs/detail/riders`.
- **`ClubJoinRequestsSection` MOVES** off the club detail and onto that screen — same route data,
  same `queryKeys.clubs.joinRequests(clubId)`, same `getClubJoinRequests`, per `085`'s own
  instruction to absorb rather than duplicate. Plus the **`Clear`** control on a declined row that
  `085`'s DELETE policy already permits and `087`'s header names as PD-326's.
- **Per-rider controls** on the roster, each gated by the same rule its RPC enforces, with the RPC
  as the boundary and the gate as an affordance.
- **`notificationCopy` and `describe` gain the eleventh arm**, and it is the one row in the list
  whose leading name and avatar are the **club** rather than the actor — because the actor is the
  reader, and because *a club refuses as a club*.

### Explicitly NOT in this change

- **Ownership transfer.** `clubs` UPDATE is `auth.uid() = owner_id` in USING **and** WITH CHECK, so
  an owner cannot hand `owner_id` to anyone even today; `029` is the only writer. Widening that is
  its own story with its own negative cases.
- **Widening `moderate_club_thread` to admins** (§4 above), and **widening `delete_owned_club`**.
  Deleting a club stays the owner's alone.
- **A block conjunct on the three new RPCs.** Derived, not copied — see §The block conjunct `085`
  has and these RPCs must not in `design.md`.
- **A notification on promotion or removal.** Decided, with the reason for each, in
  §Does anything notify.
- **A cooldown or tombstone after removal.** A removed rider rejoins a public club in one tap. The
  tool for keeping somebody out is `blocks`.
- **Roster pagination.** `CLUB_ROSTER_LIMIT` is 200 and truncates; unchanged, and named so it is not
  read as fixed.
- **Push delivery of the new type.** `deliver-push-notifications` owns that surface.

## Capabilities

### New Capabilities

- `club-membership-administration`: who may change another rider's standing in a club, what each
  role may and may not do to each other role, what a removed rider keeps and loses, and what is
  observable to whom afterwards.

### Modified Capabilities

- **`notifications`** — *"A rider SHALL NOT learn a private club's name … from a notification"*
  gains its first carve-out, and it must be written as one rather than assumed: the name still never
  comes off the row, it comes from `discoverable_private_clubs` under a live predicate that goes
  false the moment the rider is blocked. That is the requirement's *actual* invariant and this
  change preserves it exactly.
- **`event-fanout-integrity`** — the first fan-out in this repo whose **actor is its own recipient**,
  and the first whose recipient-readability guard is a *disjunction* of two predicates rather than
  one. Both need stating or the next fan-out copies the wrong half.
- **`database-enforced-integrity`** — *"Club membership role SHALL NOT be self-assignable"* is
  written against a world where nothing writes `admin`. Something does now, and the requirement has
  to say that the writer is a definer RPC taking no role argument rather than a policy.
- **`client-render-shell`** — Manage riders is a screen whose entire content is destructive
  controls, and whose permission-denied case is reachable by URL. It owes the empty/denied
  distinction explicitly.
- **`client-cache-invalidation`** — one removal moves the roster, the club detail, the requests
  list, the notification list and the removed rider's own club lists, across two riders' caches.
- **`club-join-requests`** (PD-325's unarchived capability) — the `Clear` surface it deferred, and
  the decline notification it forbade.

## Impact

**Database** — `supabase/migrations/088_club_roster_administration.sql`,
`supabase/migrations/089_a_declined_rider_is_told.sql`; assertions in `supabase/tests/rls_test.sql`
under `088.*` and `089.*`. Re-derive the suite size with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and reconcile by **label set**, never by
count.

**Security advisors** — **21 today, 24 after** — measured by enumeration rather than by trusting
`CLAUDE.md`'s table: 18 `authenticated_security_definer_function_executable` (one per `public`
`security definer` function `authenticated` may execute; the 18 were listed off `pg_proc` on
2026-08-28), 2 `rls_enabled_no_policy`, 1 `auth_leaked_password_protection`. `088` adds **three**,
one per new `public` definer function. **`089` adds none** — its fan-out lives in `private`, which
PostgREST does not publish, which is the same reason `083`'s three private functions raised the
count by two rather than five. A twenty-fifth means a revoke did not land or something was created
in `public` that belongs in `private`.

**Participation gate** — **unchanged at sixteen.** Neither file adds a gated table and neither may
add a compensating trigger to `club_members`: `078.9`'s rule, because `current_user` inside a
definer body is the owner and such a trigger raises the count while gating nothing.

**`036`'s hand-exercise gate — it fires for `089` and not for `088`.**
`089` hangs a fan-out on `after update of status on club_join_requests`, whose live writer is
`decline_club_join_request` — a shipped write path on DEV since 2026-08-28 — so from the moment it
applies, every Decline runs new code inside the admin's own transaction and a raise there takes
their answer down with it. `088` hangs no trigger at all (measured: `club_members` carries exactly
two triggers, both on INSERT), but its removal path *reaches* `085`/`087`'s retraction through a
new caller, so it gets the same rolled-back-transaction exercise for a weaker reason. Both lists
are in `tasks.md` §7.

**Reads** — `getClubMembers` unchanged in shape; new `getClubRoster` is **not** added — the Manage
riders screen reuses `getClubMembers` and `queryKeys.clubs.members(clubId)` rather than opening a
second read of the same rows. `getNotificationsPage` gains the raw `club_id` column in
`NOTIFICATION_SELECT` (the client already holds table-wide SELECT) and one resolution pass for
declined clubs — §Naming the club in a decline row prices the two candidates.

**Writes** — `removeClubMember`, `promoteClubMember`, `demoteClubAdmin` in
`src/lib/actions/clubs.ts`, plus `clearClubJoinRequest` in
`src/lib/actions/club-join-requests.ts`. Plain async functions; no component calls
`supabase.from()`.

**Cache** — no new key. `queryKeys.clubs.members`, `.detail`, `.joinRequests`, `.all()` and
`queryKeys.notifications.*` already exist; the invalidation *claims* are new and go in `keys.ts`'s
reconciliation table.

**Types** — `NotificationType` grows by one, which `tsc` turns into a compile-time list of every
site that must answer (both exhaustive switches, and `NotificationRow`'s consumers).
`ClubRosterMember` is unchanged — `role` already admits `'admin'`.

**Design** — **no v2 frame exists for a Manage riders screen or for a per-rider destructive
control.** Compose from measured components (`v2 / Component / List / User` for the rows,
`ContextMenu` for the per-rider actions, the existing confirmation sheet shape) and log it in
`docs/FIGMA-FIDELITY-TODO.md` rather than inventing and calling it measured.

**Dependencies** — none added. Nine before and after
(`node -p "Object.keys(require('./package.json').dependencies).length"`).

**Docs** — `CLAUDE.md`'s advisor table from 21 to 24 with the three named; `docs/reference/schema.md`'s
`club_members` and `club_join_requests` rows. **Main thread writes those, not a subagent.**
