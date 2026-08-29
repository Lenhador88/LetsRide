# An invite link for a ride — pasteable into WhatsApp, with an expiry, a revoke and a use count

> Linear **PD-330**, the link half of the invite pair. **PD-329** built the in-app half and is
> `Deployed to DEV`; this change reuses its accept path and adds a second caller to
> `private.join_ride_from_invite` **without touching the write**, exactly as `083`'s own comment
> pre-declares. This file is the specification and the issue must not restate it (`CLAUDE.md`
> §The roadmap lives in Linear: *"A Linear issue that grows a specification is a bug."*).

## ⚠ Read this first — one thing the brief asserts that is not true

Surfaced rather than built around, per `CLAUDE.md` §Working With the Product Owner. **The
decision itself is not reopened**; what is wrong is the remedy it points at.

### "Revoking does not remove riders already admitted — that is what the remove-rider path (`088`, PD-326) is for"

**`088` removes CLUB members. There is no remove-rider path for a ride, and `088` says so in its
own header.** Measured, not inferred:

- `088_manage_club_riders.sql` line 116 states of a removed club member: *"**Their `ride_members`
  rows are untouched**, so they stay in the crew of"* — the migration removes a `club_members` row
  and nothing else. Its three RPCs are `remove_club_member`, `promote_club_member` and
  `demote_club_admin`, each taking a **club** and a rider.
- `public.ride_members`'s only DELETE policy is `Users can leave rides`, qual `auth.uid() =
  user_id` — read live off `pg_policy` on DEV, unchanged since `001`.
- `083`'s own §5b comment already says this in as many words: *"AND AN ORGANIZER CANNOT UNDO AN
  ACCEPTED INVITE. DELETE is scoped to `pending`, there is no UPDATE grant or policy, and
  `accepted` grants read for ever by design. **Their only exit is a block.**"*

So decision 3 is built as stated — **revoke kills the token and admits nobody new; riders already
in stay in** — but the sentence explaining it must not point at `088`. The accurate statement,
and the one this proposal carries: *an organizer who revokes a link has no way to remove the
riders it already admitted; their only remedy today is a block, which is decision #2 doing
something it was not designed for.* That is a real product gap and it is **not** in this change's
scope to close. `design.md` §The gap revoke leaves open prices it, and task 0.2 asks the owner
whether they want a `remove_ride_member` story filed. **Building the link without saying this
would ship a Revoke button whose tooltip is a lie.**

## Everything below is first-hand

The Linear connector answered: PD-330's body **and** its one comment were read, as were PD-329's
body and its three comments. The Supabase connector answered: DEV (`fpmrimzxadewsaiwpsel`) was
read live for the migration chain, the gate-trigger count, the `ride_invites` triggers, the
`ride_members` DELETE policy, the installed extensions and `rides`' column list. Nothing in this
file is inferred and unmarked.

## Why

PD-329 made it possible to get a named rider onto a ride, and that reaches only riders who are
already on LetsRide and already findable by username. **The way a ride actually gets organised is
one message in a group chat**, and that message has to work for the four people in it who have
never opened the app. This is the only mechanic in the product that reaches someone who is not a
rider yet.

It needs a proposal rather than a ticket because **it is the one design in this app where
possession is the credential**. Every other grant in this schema is a fact about an identity —
you are the organizer, you are in the club, you hold an invite row. A token in a URL is a grant
to *whoever holds the string*, and a URL pasted into a group chat is forwarded, screenshotted and
archived by every device in it. `openspec/config.yaml`'s stake applies with unusual force: a
visibility decision left unstated here does not become a wrong policy, it becomes a **permanent
open door** that nothing in the schema can distinguish from an intended one.

## The five decisions, and what each one costs

Settled by the product owner and enumerated here with their reasoning, not reopened.

### 1. The link is open, not single-rider

One token admits any number of riders. This is the whole point — it is pasted into a group chat,
and a single-rider token would need the organizer to know who is in that chat, which is exactly
the knowledge the in-app invite already requires and the link exists to avoid.

**What it costs, stated:** the token cannot be bound to an identity at creation, so it cannot be
revoked *per recipient*, and a forwarded link is indistinguishable from the original. Expiry and
revoke are the only two controls, which is why both are mandatory rather than nice to have.

### 2. Expiry — the ride's departure, and a **14-day** ceiling from creation

`expires_at` is set by the database at creation to `least(ride.departure_at, now() + interval '14
days')`, and **liveness re-checks `rides.departure_at` at every use** rather than trusting the
stored value, because a ride can be edited to depart earlier after its link was made.

**Why the ride's departure.** A ride is the thing being joined; once it has left there is nothing
to admit anyone to. This half needs no argument.

**Why a ceiling at all, and why 14 days.** Without one, a link for a ride three months out is an
open door for three months, sitting in a WhatsApp scroll that will outlive everyone's memory of
it. Fourteen days is **two weekends plus a slip** — it covers "I'll ask the guys this weekend",
and the one week where nobody replies and it gets raised again. Shorter (48 hours, a week) breaks
the ordinary case of a ride planned a fortnight out and turns re-issuing into a chore; longer
stops being a bound in any meaningful sense. **Re-issuing is free** — the organizer makes a new
link in one tap — so the ceiling costs a tap and buys a hard stop on a leaked URL.

**The number is the one thing here a reviewer should push on.** It is a product judgement, not a
security threshold; the *shape* (`least(departure, ceiling)`, re-checked live) is the part that
must not change.

### 3. Revoke — the organizer kills a link; riders already in stay in

`revoked_at` on the link. A revoked token admits nobody and previews nothing, immediately.

**Riders already admitted are untouched, deliberately.** They hold a `ride_members` row and an
`accepted` invite row, and both are facts about a rider who joined a ride, not about a URL. Making
revoke retroactive would mean a mis-tap silently ejecting people who are already planning to be
there, and would give the organizer a button that does something different from what it says.

**See the warning at the top of this file**: the path that *should* handle "this specific rider
must go" does not exist for rides. Revoke is not a substitute for it and this change does not
build it.

### 4. Use count — recorded and shown; **no max-uses ceiling**

The organizer sees how many riders came in through each link.

**No cap, and PD-293 is the precedent.** `077_ride_capacity_is_dropped.sql` removed the ride
rider limit because a cap nobody can see is worse than no cap — riders hit an invisible wall with
no explanation and no recourse. A max-uses ceiling on a link is that failure in a worse place: the
rider who hits it is a stranger who has just installed the app, and the message they get is
"this link is no longer valid", indistinguishable from expiry and revoke. The organizer's control
is revoke, which is deliberate and visible to them.

**The count is derived, not counted.** `ride_invites.link_id` records which link admitted each
rider, and the count is the number of those rows. A counter column can drift from the rows it
claims to describe; a derived count cannot. It also makes "the same rider opens the link twice"
free — the unique key means there is no second row, so there is no second use.

**One honest consequence, enumerated as a negative case rather than buried**: the count is read
under the organizer's own RLS, and `ride_invites`' SELECT policy is block-dominated. If a rider
who joined through the link later blocks the organizer, that row stops being readable and **the
count goes down**. That is decision #2 working as designed, and the surface must not present the
number as an immutable ledger.

### 5. Clubs are out of scope, and here is why that is not a deferral

PD-299 records that `ClubOptionsMenu` already offers a Share row whose link RLS refuses. **This
change does not fix it, and does not build a second invite system to fix it later.**

The reason is that the two are not the same shape. A ride is a single resource with one organizer,
a departure that supplies a natural expiry, and an existing `ride_invites` row that already
carries the grant. A club has owners *and* admins (`019`), no departure and therefore no natural
expiry, a membership that grants reach to every ride, thread and roster inside it, and — since
`085` — a *join request* flow with an approval step that a bearer token would bypass entirely.
A club link is therefore a **policy question about `085`'s approval step**, not a token question.

What this change does instead is shape the mechanism so a club variant is a later *extension*
rather than a second design: the liveness definition lives in one `private` helper, the claim is
one RPC over one token column, and nothing in the token machinery names a ride except the foreign
key. `design.md` §What a club variant would reuse writes down which four pieces are reusable and
which two are genuinely club-specific, so the next session extends rather than invents.

## What the token buys — the narrowness proof

**This is the part reviewers should check first.** Possession of a live token permits exactly two
RPC calls and nothing else:

| Holding a live token lets you | It does NOT let you |
|---|---|
| Call `ride_invite_link_preview(token)` and receive **eight named columns** of exactly one ride | Read a `rides` row through RLS — **this change adds no audience arm to any policy** |
| Call `claim_ride_invite_link(token)` and join that one ride | Read the crew roster, the chat, the club, the club's other rides, or any second ride |
| | Learn anything at all without a session — both RPCs are granted to `authenticated` only |
| | Defeat a block, in either direction |

**`rides` SELECT is not touched by this change, and neither is `private.can_read_ride`.** After a
claim the rider's reach comes from the `ride_invites` row they now hold, through `083`'s existing
fourth arm — so an admitted link-claimer is byte-for-byte the same audience member as an accepted
in-app invitee, already specified and already asserted. That is the whole security argument for
this change being additive: **the token is a way of reaching an existing grant, never a new one.**

The preview is the one genuinely new read path, and it is a `security definer` function, so it
bypasses RLS by construction. It is therefore held to `085`'s `discoverable_private_clubs` shape:
a fixed list of named columns, no roster, no ids of other riders, one raise-free failure mode,
and the block check **restated in its own body** because there is no policy underneath it to do
the job.

## What Changes

**One migration.** 89 files in the repo, DEV at `089`, PROD at `079` — measured against DEV's
`list_migrations` on 2026-08-29. This change is **`090`** *unless* PD-332, building in the same
session, has taken that number; task 0.3 re-derives rather than trusting this sentence, and
`CLAUDE.md`'s ten-file DEV/PROD gap is promoted in filename order before anything is added to it.

**It is additive in schema and NOT inert**, for one reason: it re-creates the `notify_ride_invited`
trigger on `ride_invites`, a live write path since `083`. `036`'s hand-exercise gate therefore
fires — task 6.2, on DEV, in a rolled-back transaction.

**It assumes PD-332 has landed and `083`'s retraction trigger is gone.** Nothing in this change
reads, writes or depends on `retract_ride_invited`. Task 0.4 asserts its absence rather than
hoping.

### New

- **`public.ride_invite_links`** — `id`, `ride_id`, `created_by`, `token`, `expires_at`,
  `created_at`, `revoked_at`. RLS on, `to authenticated` only.
  - **`token` is server-owned by the GRANT, not by a default alone**, exactly as `083` §4 owns
    `status`: `grant insert` names `(id, ride_id, created_by)` and nothing else, so there is no
    statement in which a client can choose or overwrite a token. Its value comes from a column
    default of `encode(extensions.gen_random_bytes(16), 'hex')` — **128 bits, 32 lowercase hex
    characters**, `pgcrypto` confirmed installed in `extensions` on DEV. A `unique` index and a
    `check (token ~ '^[0-9a-f]{32}$')` pin the shape.
  - **`expires_at` is set by a BEFORE INSERT trigger**, not a default, because it reads
    `rides.departure_at` — a default cannot.
  - One **participation-gate** trigger, taking the count from **sixteen** to **seventeen** on DEV
    (measured live, not read off `CLAUDE.md`).
- **`public.ride_invites.link_id`** — a nullable FK to `ride_invite_links(id)`, `on delete set
  null`. Nullable because every in-app invite has none; `set null` because deleting a link must
  not delete the riders it admitted, which is decision 3 expressed as a referential action.
- **`private.live_ride_invite_link(t text)`** — **the single definition of "live"**, returning the
  link row or nothing. `security definer`, `stable`, `set search_path = ''`, granted to no client
  role. Both public RPCs call it, so expiry, revoke, ride-deletion and ride-departure cannot mean
  one thing to the preview and another to the claim. `083`'s one-body-two-entry-points property,
  applied to a definition instead of a subject.
- **`public.ride_invite_link_preview(t text)`** — `security definer`, returns **zero rows** for
  every non-live case, so expired, revoked, deleted, departed, blocked and guessed are one
  outcome. Eight named columns, enumerated in `specs/ride-invite-links/`.
- **`public.claim_ride_invite_link(t text)`** — `security definer`, takes the **token** and never
  a ride id or a rider id, **one raise site** on `083`'s `accept_ride_invite` footing. Writes the
  `ride_invites` row, then calls `private.join_ride_from_invite` — **in that order, and the order
  is load-bearing**; `design.md` §Why the invite row is written first.
- **`public.revoke_ride_invite_link(link uuid)`** — `security definer`, one raise site. Exists as
  an RPC rather than an UPDATE grant because a grant on `(revoked_at)` lets a client un-revoke by
  writing NULL, and `522`'s standing rule is that a table with no designed edit carries no UPDATE
  grant.
- **A public landing route, `/rides/join`** — added to `PUBLIC_PATHS` in `src/lib/auth/guard.ts`.
  **The token is a query parameter, not a path segment, and that is forced rather than chosen**:
  `next.config.ts` ships `output: 'export'`, and a dynamic segment needs `generateStaticParams`,
  which cannot enumerate secrets.

### Changed

- **`notify_ride_invited` gains `WHEN (NEW.status = 'pending')`.** Without it, a claim inserts an
  `accepted` row and the fan-out tells the claimer *"you have been invited to a ride"* — about a
  ride they just joined by their own tap, naming the organizer as actor so `036`'s
  actor-is-not-recipient guard does not catch it. This is the single defect most likely to be
  discovered in a screenshot rather than in review.
- **No new notification type, and none is needed.** The organizer already learns through
  `ride_joined`, which `055` fans out to the crew on the `ride_members` INSERT the claim performs.
  `ride_invite_accepted` would be the *wrong* message — it asserts the organizer invited that
  rider by name, which on a link claim is false.

### Explicitly NOT in this change

- **A max-uses ceiling.** Decision 4, with PD-293's reasoning.
- **Removing a rider a revoked link admitted.** No such path exists for a ride; see the warning at
  the top. Not deferred quietly — task 0.2 puts it to the owner as its own story.
- **A club invite link.** Decision 5.
- **Universal links.** The link opens the **web app, not the shell**, until PD-205 ships. Stated
  here and in the PR body rather than discovered: a rider with the app installed who taps the
  link in WhatsApp gets a browser, signs in there, and claims there. The claim is durable — the
  `ride_members` row is in the database — so the ride is on their ride list when they next open
  the shell. **Acceptable, and the one line of it that matters is that nothing is lost.**
- **Push delivery.** `deliver-push-notifications` owns that surface, and this change adds no type.
- **Auto-claiming on session establishment.** Refused permanently, and asserted against; see
  `design.md` §Why the claim is always a tap.

## Capabilities

### New Capabilities

- `ride-invite-links`: what a token is, what holding one grants and what it never grants, how it
  is generated, when it dies, who may create and revoke one, what the organizer sees of its use,
  and what every one of the eleven non-live cases renders — for every role that can hold a URL:
  signed-out visitor, un-onboarded rider, ordinary signed-in rider, existing crew member, the
  organizer, a blocked rider in either direction, and a rider who has already claimed it.

### Modified Capabilities

- `ride-invites`: the capability PD-329 added states that only the ride's organizer creates an
  invite and that the invitee alone changes its status. A link claim writes an `accepted` row for
  a rider **nobody named**, with `inviter_id` set to the link's creator — which is a second
  writer of that table and a second producer of `accepted`. Left unstated, the next reader of
  that spec concludes the claim path violates it.
  **This capability is not yet in `openspec/specs/`** — `invite-riders-to-a-ride` is still an
  active change. Task 0.1 covers the ordering.
- `database-enforced-integrity`: *"Ride visibility SHALL be stated per role"* enumerates six roles
  and the preview RPC creates a seventh reader — a rider who is not any of them and sees eight
  columns of a ride through a definer function that bypasses the policy entirely. A read path that
  is *outside* the policy is exactly the thing that requirement exists to prevent going unwritten.
  The requirement's own reason says so: the policy *"has never been written down role by role,
  which is what allowed the private-club case above to go unnoticed."*
- `client-session-storage`: *"A signed-out visitor SHALL reach no data"* is the rule the landing
  route is most likely to break, because the tempting design shows the ride title on the
  sign-in prompt to make the link feel worth following. It also does not yet say anything about
  storing a **capability token** on the device — what may hold one, for how long, and that it must
  never be spent by a rider other than the one who chose to spend it.
- `client-cache-invalidation`: one claim moves keys across two domains and the rider **arrives at
  the ride** immediately afterwards, which is the case PD-329's review already caught once —
  `/rides` and Explore left stale after an accept. A claim additionally has no prior screen to
  invalidate *from*, because the rider may have had no session when the read was cached.
- `event-fanout-integrity`: the `WHEN` clause above is a fan-out that must **not** fire for a row
  it structurally matches. The standing requirements cover who the recipient is and that a rider
  is never notified of their own action; none of them covers *a trigger whose own event is
  sometimes not an event at all*.

## Impact

**Database** — one migration (`090` unless PD-332 took it) and assertions in
`supabase/tests/rls_test.sql`. Re-derive the suite size with
`PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` and **reconcile by label set, never by
count** — a count cannot tell a rename from a loss.

**Security advisors** — **three** new `authenticated_security_definer_function_executable` WARNs,
one each for `ride_invite_link_preview`, `claim_ride_invite_link` and `revoke_ride_invite_link`.
**`private.live_ride_invite_link` adds none**, being unpublishable by PostgREST. Per `CLAUDE.md`'s
own instruction, task 0.5 records the **before** number off `get_advisors(security)` rather than
trusting an absolute here; the expected **delta is +3**.

**Participation gate** — one new trigger, on `ride_invite_links` INSERT. **Sixteen today on DEV,
measured**; seventeen after. The comment on `public.enforce_participation_gate()` must be
restamped and its enumeration extended, per `028` and `033` — it is the `data` agent's first read
and no edit to `CLAUDE.md` reaches it.

**`claim_ride_invite_link` is `078`'s case exactly.** A gate trigger cannot fire for a
`security definer` writer, because every gate trigger carries `when (current_user =
'authenticated')` and `current_user` inside a definer body is the owner. The gate is therefore
carried by `private.join_ride_from_invite`, which already restates it — this change adds a caller,
not a second copy — and an assertion pins that it is still there.

**Reads** — `src/lib/data/ride-invite-links.ts` through `resolveSupabase`. **Writes** —
`src/lib/actions/ride-invite-links.ts`, plain async functions. No component calls
`supabase.from()`.

**Cache** — two new keys in `src/lib/query/keys.ts` with the reconciliation note that file's
header exists for, plus a documented cross-domain invalidation from the claim.

**Validation** — `rideInviteTokenSchema` in `src/lib/validation/rides.ts`, 32 lowercase hex.
Per `CLAUDE.md`, Zod owns the **message** and the database owns the **guarantee**: the CHECK on
`token` and the absence of an INSERT grant on it are what make the shape true.

**Types** — `RideInviteLink`, `RideInviteLinkPreview` and `RideInviteLinkClaim` in
`src/types/index.ts`. `NotificationType` does **not** grow.

**Design** — **no v2 frame exists for an invite link or its landing screen.** `npm run figma -- ls`
is task 8.1's first command and the composition is assembled from measured components (the ride
card, the crew rail's avatar stack, `SectionHeader`) rather than invented and called measured.

**Dependencies** — none added. Nine runtime dependencies before and after
(`node -p "Object.keys(require('./package.json').dependencies).length"`).

**Docs** — `CLAUDE.md`'s advisor table `+3` and its participation-gate paragraph to seventeen
tables; `docs/reference/schema.md` gains a `ride_invite_links` row and its `ride_invites` row gains
`link_id`; `docs/reference/product-scope.md`'s Rides row. **Main thread writes those, not a
subagent.**
