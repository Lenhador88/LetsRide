# Design — an invite link for a ride

Companion to `proposal.md`. This file holds the *how*: the token's lifecycle, the auth round
trip, the orderings and the lock that are load-bearing, and the questions closed with a default.

## The token lifecycle, end to end

1. **Minted.** The organizer taps `Invite riders` → `Create a link`. One INSERT into
   `public.ride_invite_links` naming `(id, ride_id, created_by)` and nothing else. The database
   supplies `token` from a column default and `expires_at` from a BEFORE INSERT trigger reading
   `rides.departure_at`. The client never sees a token it chose.
2. **Shared.** `shareAppLink('/rides/join?token=' + token, ride.title)` — the existing helper,
   unchanged, a different URL and not a different mechanism. The rider's own phone sends the
   message; no messaging infrastructure is involved.
3. **Opened.** `/rides/join?token=…` is a **public** route. With no session it renders the shell,
   a generic sentence and two buttons; with a session it renders the preview.
4. **Claimed.** One tap on `Join this ride` → `claim_ride_invite_link(token)` → an `accepted`
   `ride_invites` row and a `ride_members` row → the rider lands on `/rides/detail?id=…`.
5. **Dead.** At `least(departure, created + 14 days)`, at revoke, or when the ride is deleted —
   whichever comes first. Death is a property of the link; the riders it admitted are unaffected.

## Where the credential lives between step 3 and step 4

This is the design question the issue names, and the answer is **both**, for different failures.

**The URL is the durable copy and the stash is the convenience.** The token rides in the URL
because the rider already has it there — it is in WhatsApp, permanently, and re-tapping the same
message is a recovery path that needs no engineering. The stash exists only so that the rider who
signs in *in this tab* is returned to where they were going.

- **`sessionStorage`, not `localStorage`.** A capability token must not outlive the tab. On a
  shared laptop, a `localStorage` stash left by an abandoned sign-up is a token sitting on someone
  else's machine with no expiry the device knows about.
- **One key, `letsride.pendingInviteToken`, cleared on sign-out** — `client-session-storage`'s
  standing *"Sign-out SHALL destroy every local trace of the rider"* reaches it, and a token is a
  trace.
- **It survives onboarding.** A brand-new rider must complete the wizard before anything can be
  claimed (decision #5, and `023` refuses the write regardless), so the stash has to live across
  three or four screens in the same tab. `sessionStorage` does.

### The four abandonment cases, and what each renders

| What the rider does | What happens |
|---|---|
| Abandons sign-up and closes the tab | Stash dies with the tab. The link in WhatsApp still works. **Nothing is stuck.** |
| Signs up in a **different browser** (the confirmation email opens elsewhere — PROD has email confirmation ON) | Stash is not there. They land signed-in on `/postcards`. They re-tap the WhatsApp link and it claims. This is why the URL is the durable copy. |
| Is **already signed in** when they tap | No round trip at all. Preview renders immediately, one tap claims. |
| Abandons, and a **different rider** signs in on the same browser | See below — this is the case that decides the next section. |

## The wizard detour costs the rider nothing

`/rides/join` goes into **both** `PUBLIC_PATHS` and `needsOnboardingState()`'s set. The two answer
different questions — *may this be reached without a session* and *must decision #5 be evaluated
here* — and `guard.ts` keeps them separate, but `needsOnboardingState`'s first line is
`if (!isPublicPath(pathname)) return true`, so making the route public silently answers the second
question `false` unless it is added there too.

**Left at one edit, the feature's main flow dead-ends.** The stamps are never read,
`guard-cache.ts` never fetches them, the state is `{ kind: 'session' }`, `resolveDestination`
returns "stay" — and a rider who has just signed up sits on the preview tapping a Join button that
raises `check_violation` every time, with no route into the wizard and nothing on screen saying
why.

**The objection to sending them to the wizard is that they lose the ride they were looking at, and
it does not apply here.** A signed-out visitor already sees no ride data — the preview needs
`auth.uid()` for its block and gate checks, so there is nothing to render before a session exists
and nothing to preserve across the wizard. The rider sees the same generic invite copy before
onboarding as after; only the preview arrives later.

**What must survive is the stash, and that is the part to build deliberately.** The token sits in
`sessionStorage` across the whole wizard, and the screen the rider lands on when onboarding
completes consumes it and returns them to `/rides/join`. Without that step the flow ends at
`/postcards` with a live token still in `sessionStorage` and nothing reading it — which is the
same dead end one screen further along, and harder to spot because nothing errors.

## A claim is always a tap, never automatic

**Refused permanently: claiming on session establishment.** It is the obvious optimisation — the
rider signed in *because* of this link, so spend the stash the moment a session appears — and it
is wrong in a way that is invisible when it happens.

A stash is a string in a browser. The rider who *signs in* is not necessarily the rider who
*opened the link*: an abandoned sign-up followed by a different rider signing into the same tab
auto-joins that second rider to a private ride they were never told about, silently, with a
`ride_members` row and a `ride_joined` notification to the organizer naming them.

Requiring a tap makes that unreachable by construction. Whoever is signed in sees the preview,
sees whose ride it is, and decides. It costs one tap and removes an entire class of bug that no
assertion in `supabase/tests/` could ever catch, because at the database layer the wrong-rider
claim is a perfectly valid claim.

**Corollary the spec asserts:** no effect anywhere may call `claim_ride_invite_link` outside a
user-initiated event handler.

## The caller predicate belongs beside the link predicate

The first draft centralised **liveness** in `private.live_ride_invite_link` and pinned it with an
assertion, then wrote the **block check** independently into each of the two RPC bodies — and
omitted the **participation gate** from the read path altogether. That is the weaker treatment for
the more security-critical predicate, and the omission it produced was a real exposure: an account
created by calling GoTrue's `/auth/v1/signup` directly and never calling `accept_terms()` could
hold a forwarded token and read a private ride.

**Both halves of the question are answered in one place now.** `private.live_ride_invite_link(t)`
stays as it was and answers *is this link alive* — a fact about the link, knowing nothing about
who is asking. `private.ride_invite_link_reachable_by(t, uid)` wraps it and answers *may this
caller use it* — live, **and** `not private.is_blocked(uid, organizer_id)`, **and** both
participation stamps present. The preview and the claim resolve through the second and never
through the first.

**Why one function rather than two disciplined copies.** The argument that keeps liveness
centralised is that the preview and the claim must not disagree about a token; the caller
predicate has exactly the same property and a worse failure mode. A preview more permissive than
the claim shows a stranger a private ride they then cannot join — a pure disclosure with no
product benefit — and a preview less permissive is a rider staring at "no longer valid" for a
link that works. Neither is visible from either body alone, and there is no policy under either to
catch it. Splitting a predicate across two `security definer` bodies means the next person to add
a third caller has two places to copy from and no way to know they missed one.

**The gate is checked at read *and* at write, and the write check is not redundant.**
`private.join_ride_from_invite` keeps its own restatement — this change does not touch it — because
it is the last line before a `ride_members` row and it protects `accept_ride_invite` too. The read
check is not a substitute for it; it closes a different door.

## Revoke has to be atomic with a claim

`private.live_ride_invite_link` is `stable` and takes no lock. Under READ COMMITTED — Postgres's
default and Supabase's — a claim that resolves liveness a moment before a concurrent
`revoke_ride_invite_link` commits still goes on to write the invite row and the crew row. The
organizer's Revoke returns success; a rider is admitted anyway.

**On most features that would be an acceptable race.** Here it is not, and the reason is
specifically this change's own scope: **there is no eject path** (§The gap revoke leaves open), so
the rider admitted in that window is permanent, and the organizer has been told the opposite.

`ride_invite_link_reachable_by` therefore takes **`for share` on the `ride_invite_links` row** when
called from the claim path, and `revoke_ride_invite_link` updates that row — so the two serialise
and the loser sees the committed outcome. `for share` rather than `for update`: concurrent claims
of the same link must not block each other, and they do not conflict with one another, only with
the revoke.

**The residual window is narrower and is stated rather than closed:** a claim that has already
committed is not undone by a revoke that follows it. That is decision 3 working as intended.

## The invite row is written first

`claim_ride_invite_link` inserts the `ride_invites` row **before** calling
`private.join_ride_from_invite`, and reversing it silently breaks the private case.

`join_ride_from_invite` re-checks `private.can_read_ride(rider, ride)` in its own body, because a
`security definer` writer bypasses the `ride_members` INSERT policy that would otherwise ask. For
a private, clubless ride the *only* arm that can make `can_read_ride` true for a stranger is
`083`'s live-invite arm — which is true only once the invite row exists. Called first, it returns
`false`, writes nothing, and the rider joins nothing, on exactly the rides this feature exists for.

**The block check is therefore done explicitly in the claim RPC, before anything is written.**
`can_read_ride` would still catch a blocked rider — the invite arm sits inside the block-dominated
group, so the whole group collapses — but only *after* a stray `accepted` row had been written.
Checking first leaves no residue and keeps the failure identical to every other dead-token
failure.

## The two orderings, side by side

| Ordering | Consequence if reversed |
|---|---|
| Invite row **before** `join_ride_from_invite` | Private clubless rides admit nobody. Fails silently — the RPC returns, no error, no crew row. |
| Block check **before** the invite row | A blocked rider leaves an `accepted` invite row behind. Grants nothing (the policy is block-dominated) but is residue, and a later unblock would silently admit them. |

## The `WHEN` clause on `notify_ride_invited`

`notify_ride_invited` is `AFTER INSERT ON public.ride_invites FOR EACH ROW` — read live off
`pg_trigger` on DEV. Every row this change inserts is `accepted`, with `inviter_id` = the link's
creator and `invitee_id` = the claimer, so `036`'s actor-is-not-recipient guard does not fire and
the claimer receives *"you have been invited to a ride"* about a ride they just joined themselves.

`WHEN (NEW.status = 'pending')` is the fix, and it is correct for the in-app path too: `083`'s own
INSERT policy plus its column grants mean an in-app invite can only ever be inserted `pending`, so
the clause is a no-op there. It states an invariant that was previously implicit.

**The `ON CONFLICT DO UPDATE` branch is a different matter and is left alone.** A rider who already
holds a `pending` or `declined` in-app invite and comes in through the link takes the UPDATE
branch, which fires `notify_ride_invite_answered` and tells the organizer their invite was
accepted. **That is true** — the organizer did invite them, and they did accept. It stays.

## What the organizer is told, and why it differs by claimer

Not a defect, and written down because it is otherwise re-derived by whoever next reads the
fan-outs and assumes one event produces one shape.

| Who claims | Branch | The organizer receives |
|---|---|---|
| A rider with no prior invite | INSERT, `accepted` | `ride_joined` alone. `notify_ride_invited` is suppressed by its `WHEN` clause. |
| A rider holding a `pending` or `declined` invite | `ON CONFLICT DO UPDATE` | **`ride_invite_accepted` and `ride_joined`** — two notifications for one tap. |

Both are truthful. In the second case the organizer really did invite that rider by name, and they
really did accept; the fact that they accepted by following a link rather than by tapping Accept
is not a distinction the organizer needs. The asymmetry exists because `ride_invite_accepted`
answers *"did the person I invited reply"*, a question that has no meaning for a stranger.

**Collapsing them would be worse than the asymmetry.** Suppressing `ride_joined` on the conflict
branch breaks the crew fan-out `055` owns for every other join; suppressing
`ride_invite_accepted` leaves an outstanding invite in the organizer's list with no notification
ever answering it.

## The gap revoke leaves open

Priced here because `proposal.md`'s warning names it and something has to hold the detail.

**RESOLVED 2026-08-30 — the gap stays open on purpose (PD-351, closed as decided).** The product
owner chose blocking as the remedy rather than building a ride-scoped removal, and the deciding
fact was measured on DEV rather than argued: `ride_members`' INSERT policy is `auth.uid() =
user_id` AND an `EXISTS` against `rides` under the caller's own row security — **any ride a rider
can see, they can join**. So a removal on a public ride is a revolving door, and on a private one
it would have to settle the rider's `accepted` invite in the same statement, since
`has_live_ride_invite` would otherwise keep the ride visible and this same policy would let them
back in. Making a removal actually stick therefore costs a second visibility mechanism beside
blocks, which is larger than what it buys today. **Reopen when** a real organizer asks, or when the
link starts admitting riders the organizer did not choose individually. Everything below stands as
the description of what is missing and why.

An organizer who revokes a link cannot remove the riders it admitted. `ride_members` DELETE is
`auth.uid() = user_id`; `ride_invites` has no UPDATE grant and its DELETE policy is scoped to
`pending`; `088`'s three RPCs are club-scoped. The only lever is a block, which is symmetric,
permanent from the UI's point of view, and removes the two riders from each other's feeds, search,
chat and member lists everywhere in the product — a sledgehammer for "not on this one ride".

This is **pre-existing** — it has been true since `001` — and the link makes it *reachable by
strangers* for the first time, which is what changes its priority rather than its nature. It is
not in scope here. Task 0.2 asks the owner whether to file `remove_ride_member` as its own story;
the shape would be `088`'s exactly, one raise site, organizer-only, taking a ride and a rider.

## What a club variant would reuse

Written down so decision 5 is an extension point rather than a deferral.

**Reusable as-is (four pieces):** the token column shape and its default; the
server-owns-it-by-grant pattern; `private.live_ride_invite_link`'s structure, one definition of
liveness called by both a preview and a claim; and the landing route with its public-path entry,
stash and always-a-tap rule.

**Genuinely club-specific (two):** *the expiry*, because a club has no departure and therefore no
natural death — a club link needs an absolute policy answer, not a `least()`; and *the claim's
terminal state*, because `085` gave private clubs a **join request with an approval step**, and a
bearer token that writes a `club_members` row directly bypasses an admin decision the product
deliberately introduced. The likely correct answer there is that a club link creates a
`club_join_requests` row rather than a membership — which is a different write, and is why this is
not one story.

## Risks

- **A definer read with a predicate missing is an exposure reachable by URL.** There is no policy
  underneath `ride_invite_link_preview`, so every check it does not make is a check nobody makes.
  This bit twice in the first draft — the block check was written into two bodies instead of one,
  and the participation gate was left out of the read path entirely. Both are now facts about
  `private.ride_invite_link_reachable_by`, asserted at `091.7` and `091.12`.
- **The token in the address bar, and it does reach a server.** `GET /rides/join?token=…` is a
  real request to Vercel on the web build, so the token lands in its access log, in the browser's
  history, and in any `Referer` the page emits. Inherent to a capability URL and bounded by expiry
  and revoke rather than removed. Mitigation: the landing screen calls `history.replaceState` to
  drop the query string once it has read it. **An earlier draft claimed the token was never in a
  page request to our own API, on the strength of `output: 'export'`. That was wrong** — see
  `proposal.md` §The `output: 'export'` re-derivation trap; the export config is the Capacitor build's, not the web
  build's. Nothing about the design changed, but a false safety property is worse than a stated
  exposure.
- **A lazy re-pin.** The suite pins policy quals by equality. This change is not supposed to move
  `rides` SELECT or `private.can_read_ride` at all, so if a pin fails, **the change is wrong** —
  do not re-pin. Task 6.4.
- **`link_id` on `ride_invites` is a column on a table PD-329 shipped four days ago.** Additive
  and nullable, but it means the two changes' specs must be read together, which is the archive
  ordering in task 0.1.

## Questions closed with a default

Each is answerable, none blocks the build, and the default is what gets built if nobody replies.

- **Q1 — the 14-day ceiling.** Default: 14 days. Owner's to change; it is a product judgement.
  Changing it is one interval literal in the trigger. **Non-blocking.**
- **Q2 — does the preview show the club's name for a ride in a private club?** **Closed: no.**
  A private club's name is not something a bearer token should disclose, and the club is not what
  the rider is deciding about — they are deciding whether to join a ride, which the eight columns
  already answer. `085`'s `discoverable_private_clubs` is not the precedent it looks like: that
  function answers a signed-in rider asking about clubs *in general*, under its own page cap and
  ordering, and it is a deliberate discovery surface. A token is not a discovery surface.
  **The eight-column list in `specs/ride-invite-links/` is the contract and it carries no club
  column.** An earlier draft of this file closed Q2 the other way while the column list already
  said no, which is the contradiction reviewers should keep catching: the requirement says
  "exactly these named columns", so a prose answer that adds a ninth is not a default, it is a
  spec that disagrees with itself.
- **Q3 — does the preview show a crew count?** Default: **yes, a count and never a roster.** It is
  what makes "is this the right ride" answerable. **Non-blocking.**
- **Q4 — how many live links may one ride have?** Default: **many, and the surface lists them.**
  A cap would be an invisible limit, which is decision 4's own argument. **Non-blocking.**
- **Q5 — may a crew member create a link?** Default: **no, organizer only**, matching `083`'s
  invite policy exactly. Widening it is a `with check` change with its own scenarios, and handing
  N riders the ability to mint bearer tokens for a private ride is a different security statement
  from handing one. **Non-blocking.**
- **Q6 — should `remove_ride_member` be filed?** Owner's alone. **Non-blocking here, and the
  answer does not change anything in this change** — but it is the honest counterpart to the
  Revoke button. See §The gap revoke leaves open.
