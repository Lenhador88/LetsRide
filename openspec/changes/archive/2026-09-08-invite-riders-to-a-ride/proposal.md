# Invite riders to a ride — name a rider in the app, Accept or Decline from a notification

> Linear **PD-329**. The in-app half only; the shareable-link half is **PD-330** and reuses the
> accept path this change builds. This file is the specification and the issue must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*).

## ⚠ Read this first — what is second-hand

**The Linear connector was absent while this was written.** `mcp__Linear__get_issue` and
`mcp__Linear__list_comments` both returned `No such tool available`, and a keyword `ToolSearch`
(`+get_issue linear`) found nothing deferred, so this is the *absent* failure rather than the
`InputValidationError` deferred one. **The issue body and its comments were therefore not read.**

What that means for the reader, concretely:

- **The story, the decision table and the required negative cases below are second-hand**, taken
  from the spawning brief rather than from PD-329 itself. If the issue's own top comment corrects
  its body — which is how this repo records a correction — that correction is **not** reflected
  here. `get_issue PD-329` **and** `list_comments PD-329` are the commands that close the gap, and
  they should be run before task 1.1 writes any SQL.
- **Everything about the database is first-hand and measured**, from the repo's own migration
  chain, `supabase/tests/rls_test.sql` and `docs/reference/schema.md`, each claim carrying the file
  and line that produced it. The Supabase connector was also absent
  (`mcp__Supabase__execute_sql` → `No such tool available`), so **nothing here was verified against
  a live database**; the policy texts quoted are the ones the RLS suite pins textually, which is a
  stronger source than a live read for exactly the claims made here, and a weaker one for the
  applied-migration counts, which task 0.3 re-derives.

`CLAUDE.md` §Working Principles: *"Never let an inferred value pass silently as a known one."*
Nothing below is inferred and unmarked.

## Two things the brief asked for that this proposal does NOT build as asked

Surfaced rather than built around, per `CLAUDE.md` §Working With the Product Owner — a squad agent
raises the objection and the main thread holds it.

### 1. "Decline is a terminal state" is kept against the INVITER and relaxed for the INVITEE

The stated reason for terminality is anti-spam — *"or the same invite arrives again the next
day"* — and that reason is entirely about the **inviter**. Read literally, terminal-for-everyone
has a cost the reason does not pay for: a rider invited to a ride that is **not** public and
**not** in a club they belong to has exactly one route in, and a mis-tap on Decline locks them out
of it permanently, with no affordance anywhere to undo it and no way for the organizer to re-issue
(the `(ride_id, invitee_id)` unique index is what makes it permanent).

So the rule here is:

- **No inviter can clear, delete or re-send a `declined` invite.** The anti-spam property is
  preserved exactly — DELETE is scoped to `status = 'pending'`, so a declined row is immovable by
  the party the rule exists to constrain.
- **The invitee may reopen their own declined invite by accepting it.** `declined → accepted` is a
  permitted transition through `accept_ride_invite`, which only the invitee can call. No rider can
  be spammed by their own button.

If the product owner wants the literal reading, the change is one predicate —
`status = 'pending'` instead of `status in ('pending','declined')` in `accept_ride_invite`'s
`WHERE` — plus deleting one scenario. It is called out here rather than buried because it is the
one place this proposal reads past the words it was given.

### 2. "A pending invite grants READ" is specified as `pending` **or** `accepted`, not `pending` alone

`pending`-only is unbuildable as a whole: an invitee accepts, later leaves the crew
(`ride_members` DELETE is `auth.uid() = user_id`, unchanged), and the invite is no longer pending —
so the read arm goes dark, the ride vanishes, and they cannot rejoin, because `ride_members`
INSERT's own `EXISTS (rides …)` is evaluated under their RLS and now fails. The rider is evicted by
a policy from a ride they were invited to and accepted.

The read arm is therefore `status in ('pending', 'accepted')`, written as an explicit list rather
than as `status <> 'declined'` so that a fourth status added later fails **closed**. `design.md` §The state machine
carries the state table.

## Why

There is no way to get a named rider onto a ride. The social graph is clubs plus blocking
(`013` dropped `friendships`), so today a ride reaches people through a club they already belong to
or through `is_public`, which means *every signed-in rider*. Between "everyone" and "a club" there
is nothing — and "three of us are riding on Sunday" is the most ordinary thing this app is for.

It needs a proposal rather than a ticket because **an invite is a grant of read on a resource whose
visibility is currently decided by three settled predicates**, and adding a fourth is the exact
class of change `openspec/config.yaml` exists for: *"a visibility decision left unstated in a spec
does not fail loudly — it silently becomes whatever the migration author assumed."* The specific
unstated thing here is that an invite to a **private club's** ride hands a non-member of that club
a readable row, which is a real widening of a private club's reach and is the intended behaviour.

## What Changes

**One migration, `083`.** 82 files in the repo, DEV at `082`, PROD at `079` — re-derive with
`list_migrations` against `ls supabase/migrations/` per `CLAUDE.md`'s own instruction not to read
the number off prose, and promote the `080`/`081`/`082` gap in filename order **before** adding to
it. Nothing in `083` is destructive, so it does not need `069`/`070`'s additive-before /
destructive-after split.

**It does hang a trigger on an already-shipped write path, and `036`'s hand-exercise gate
therefore fires.** `notify_ride_invite_answered` is on `public.ride_invites`, which is new — but
`083` also re-creates `private.can_read_ride`, which every existing `notifications` fan-out calls
inside the RSVP and ride-creation write paths. A raise there takes a rider's own RSVP down with
it. Task 6.2 is the hand-exercise, in a rolled-back transaction on DEV, and it is not optional.

### New

- **`public.ride_invites`** — `id`, `ride_id`, `invitee_id`, `inviter_id`, `status`, `created_at`,
  `responded_at`. `unique (ride_id, invitee_id)`, so a repeat invite is a `23505` and not a way to
  ring someone's phone twice. `check (invitee_id <> inviter_id)`. RLS on, `to authenticated` only,
  INSERT granted **per column** so `status`, `created_at` and `responded_at` are server-owned.
  One participation-gate trigger, taking the count from thirteen to **fourteen** on DEV.
- **`private.has_live_ride_invite_for(candidate uuid, target_ride uuid)`** — subject-taking,
  `security definer`, `stable`, `set search_path = ''`, granted to no client role.
  **`private.has_live_ride_invite(target_ride uuid)`** — the caller-relative wrapper, whose body is
  *exactly* `select private.has_live_ride_invite_for(auth.uid(), target_ride);` and nothing else,
  on `060`'s `is_club_member` / `is_club_member_for` pattern, granted to `authenticated` because an
  RLS expression is evaluated as the querying role. **One body, two entry points, pinned by
  equality in the suite** so an arm added to one and not the other cannot hide.
- **`public.accept_ride_invite(invite uuid)`** and **`public.decline_ride_invite(invite uuid)`** —
  `security definer`, `set search_path = ''`, `#variable_conflict error`, each re-checking
  `invitee_id = auth.uid()` in its own body, each with **one** raise site so "not yours" and "no
  such invite" are indistinguishable (`043`'s shape).
- **`private.join_ride_from_invite(rider uuid, target_ride uuid)`** — the single place that writes
  the `ride_members` row on an invite path, restating the participation gate and the ride's
  readability in its own body. **This is PD-330's seam**: `accept_ride_invite` is its only caller
  today, and a token-bearing claim becomes its second without touching the write.
- **Two fan-out triggers and one retraction trigger** on `ride_invites`, and **three new
  `notifications` types** — `ride_invited`, `ride_invite_accepted`, `ride_invite_declined` —
  extending `notifications_type_check` from five strings to **eight** and adding three arms to
  `notifications_subject_shape`, each carrying `ride_id` alone.
- **Screens**: an invite surface on the ride (a rider picker plus the ride's invite list), and
  **Accept / Decline controls on the notification row itself**, read from the live invite row and
  never from the notification.

### Changed

- **`rides` SELECT gains a fourth audience arm**, *inside* the block-dominated group and never
  beside `organizer_id = auth.uid()`. `design.md` §Where the invite arm sits gives the exact text and the reason the
  position is the whole security statement.
- **`private.can_read_ride` gains the same arm in its candidate-relative form, in the same
  position.** It is a second implementation of the `rides` SELECT policy and
  `supabase/tests/rls_test.sql` §060.1 pins that policy's qual **by equality**; changing one and
  not the other is PD-211's exact shape, which cost a fan-out filtering against a policy that no
  longer existed. Task 2.4 and assertion 083.6 exist for this and for nothing else.

### Explicitly NOT in this change

- **The shareable link (PD-330).** No token column, no `link` status, no unauthenticated route —
  decision #1 is untouched and a claim will still require a session. The accept path is shaped so
  the link half adds a caller and not a second write.
- **Crew members inviting.** Organizer only; `design.md` §Who may invite states why and what the widening
  costs. It is a `with check` predicate change with no schema impact — `055`'s precedent — so it
  lands later in one `create policy`, with its own scenarios.
- **An expiry on a pending invite.** Decided, not overlooked; `design.md` §Retention, expiry and the cascade window states the decision,
  what was considered, and the trigger that would reopen it (PD-330, where a token with no expiry
  is a bearer credential rather than a row).
- **`private.is_ride_crew` gaining an invite arm.** Refused, permanently, and asserted against:
  it is what keeps an invitee out of the ride's chat. See `specs/ride-chat/`.
- **A trigger on `ride_members` that resolves a matching invite.** Refused; `design.md` §Why nothing hangs off
  prices it. The invite's `status` records the answer to the *invitation*, never a copy of membership.
- **Push delivery of the new types.** `deliver-push-notifications` owns that surface; three new
  types arriving in the table is not three new pushes until that change says so.

## Capabilities

### New Capabilities

- `ride-invites`: who may invite whom to a ride, what a pending or accepted invite grants, who may
  answer and how, what each role sees of an invite in every state, and what an invite does when the
  ride is deleted, made public, moved into a private club, or when either rider blocks the other or
  deletes their account.

### Modified Capabilities

- `database-enforced-integrity`: *"Ride visibility SHALL be stated per role"* enumerates six roles
  and none of them is *invited and not yet crew*. That requirement exists because the policy *"has
  never been written down role by role, which is what allowed the private-club case above to go
  unnoticed"* — adding an arm without adding the role is that failure repeating.
- `event-fanout-integrity`: *"The recipient set SHALL be computed by direct query, never through a
  caller-relative helper"* is written for fan-outs that compute a **set**. All three fan-outs here
  address exactly one named rider read out of `NEW`, which is a case the requirement's wording does
  not reach, and the safe-looking shortcut it invites — "there is no set, so trap (c) does not
  apply" — is how a caller-relative helper gets used for the resolvability check instead.
- `notifications`: the type list and the subject shape are part of the contract, and this is the
  first notification a rider can **act on** from the row. Nothing in the standing spec says where
  an action's enabled/disabled state may be read from, and the wrong answer (the notification's own
  `type`) is the cheap one.
- `ride-chat`: *"Chat visibility SHALL be the intersection of ride visibility and crew membership,
  never crew membership alone"* is stated with the crew half as the strict one. The invitee is the
  first rider for whom the **ride** half passes on a private ride while the crew half fails, which
  makes the requirement's second half load-bearing for the first time and creates a standing
  temptation to "fix the inconsistency" in `private.is_ride_crew`.
- `client-cache-invalidation`: one accept moves four keys across two domains — the invite list, the
  notification list and its unread count, the ride, and the ride's crew — and the ride key is the
  one a rider *arrives at*, so getting it wrong shows them a ride they have just joined with
  themselves absent from the crew.

## Impact

**Database** — `supabase/migrations/083_ride_invites.sql`; assertions in
`supabase/tests/rls_test.sql` (suite is **2018** today — re-derive with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and reconcile by **label set**, never
by count, because a count cannot tell a rename from a loss). `083` **re-pins two strings the suite
asserts by equality** — `rides` SELECT's qual at §060.1, and this change's own new delegation pin —
so a green suite after a lazy re-pin is the failure mode to watch: the instruction at §060.1 is to
*update the helper in the same change rather than re-pin the string*, and here both are required
because the policy genuinely changes.

**Security advisors** — **two** new `authenticated_security_definer_function_executable` WARNs,
for `accept_ride_invite` and `decline_ride_invite`, and **none for the two `private` helpers or
`join_ride_from_invite`**, which live in `private` and are therefore not PostgREST-exposed
(`034` §1's measured reason).

**Measured on DEV after applying: seventeen, from fifteen** — fourteen definer WARNs, the two
`rls_enabled_no_policy` INFOs, and the leaked-password toggle. This paragraph said *eighteen* while
the proposal was being written, which was arithmetic rather than a measurement and was wrong by
one; it is corrected here rather than annotated, and the reason it is worth correcting at all is
that an expected total is what tells the next session whether a new WARN is theirs. `feedback`
(`084`, same branch) adds none: `rls_enabled_no_policy` fires only on a table with NO policies, and
it has an INSERT one. Count them off `get_advisors(security)` rather than off this paragraph.

**Participation gate** — one new trigger, on `ride_invites` INSERT. Expected **fourteen** on DEV.
The comment on `public.enforce_participation_gate()` must be restamped and its enumeration
extended, per `028` and `033`: it is the `data` agent's first read via `list_tables` and no edit to
`CLAUDE.md` reaches it. **`join_ride_from_invite` is `078`'s case exactly** — a gate trigger on
`ride_members` cannot fire for a `security definer` writer, because every gate trigger carries
`when (current_user = 'authenticated')` and `current_user` inside a definer function is the owner —
so the gate is **restated in that function's body**, and an assertion pins the restatement.

**Reads** — new `src/lib/data/ride-invites.ts` through `resolveSupabase`. **Writes** — new
`src/lib/actions/ride-invites.ts`, plain async functions. No component calls `supabase.from()`.

**Cache** — three new keys in `src/lib/query/keys.ts`, with the reconciliation note that file's
header exists for, and a documented cross-domain invalidation from `accept_ride_invite`.

**Validation** — no new text column, so no new Zod schema for content. `rideInviteIdSchema` joins
the id schemas in `src/lib/validation/rides.ts`, and the picker's query string gets a minimum
length there, mirroring the cap the read enforces.

**Types** — `RideInvite`, `RideInviteStatus`, `RideInviteListItem` and `RiderSearchResult` in
`src/types/index.ts`. `NotificationType` grows by three, which is a compile-time fan-out into
`notificationCopy` — the `switch` there is exhaustive, so `tsc` names every site that must answer.

**Design** — **no v2 frame exists for an invite flow.** `npm run figma -- ls` is task 8.1's first
command and the composition must be assembled from measured components (the crew rail, the
notification row, the club members list) rather than invented and called measured.

**Dependencies** — none added. Nine runtime dependencies before and after
(`node -p "Object.keys(require('./package.json').dependencies).length"`).

**Docs** — `CLAUDE.md`'s advisor table to eighteen and its participation-gate paragraph to
fourteen tables; `docs/reference/schema.md` gains a `ride_invites` row and its `rides` row gains
the fourth SELECT arm; `docs/reference/product-scope.md`'s Rides row loses invitations as a gap.
**Main thread writes those, not a subagent.**
