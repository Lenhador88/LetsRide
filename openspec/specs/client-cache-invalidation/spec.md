# client-cache-invalidation Specification

> **Provenance — read before quoting this file.** These requirements were folded out of
> `migrate-to-client-rendered-shell`'s delta specs when it was archived on 2026-08-06, and that
> was this repo's first archive, so this is the first time standing specs have existed at all.
>
> **The `### Requirement:` statements are the contract.** The prose under each one is the
> *original argument* for it, written before the change shipped, and it therefore sometimes
> describes the world as it was. Passages known to have gone stale have been corrected in place
> and say so; anything still phrased as "today" or "becomes" that is not marked is unverified —
> check it against the code before relying on it. Where this file and `CLAUDE.md` disagree about
> what the code *does*, `CLAUDE.md` and the code win; where they disagree about what it *must*
> do, this file does.

## Purpose
What a screen shows after a mutation, and how it learns that data changed elsewhere, now that
`revalidatePath` no longer exists. The 33 call sites that used to state which screens a write
invalidates had to survive the move without becoming a component-by-component guess. The
contract that replaced them is `src/lib/query/keys.ts`, whose header carries the table
reconciling every one of the 33 against the key that replaced it.
## Requirements
### Requirement: Every mutation SHALL declare what it invalidates

Every function in `src/lib/actions/` SHALL name the cache keys it moves, from
`src/lib/query/keys.ts` and never inline, and SHALL name them at the call site so the claim is
readable in one `git grep`.

**A link claim is the widest single mutation in the app so far**, because it changes the rider's
relationship to a ride they had no relationship with a moment ago. It moves keys in two domains,
and PD-329's review already caught the near-identical miss once: an accept that left `/rides` and
Explore stale, so the rider arrived at a ride list that did not contain the ride they had just
joined.

`claimRideInviteLink` SHALL invalidate:

| Key | Why |
|---|---|
| `rides.all()` | prefix-reaches the ride detail, its crew, the rider's ride list and Explore. Over-invalidating is the safe direction, and the rider is about to navigate into all of them. |
| `invites.all()` | the preview for this token, and the rider's own invite list, which now holds an `accepted` row that was not there. |

`revokeRideInviteLink` and `createRideInviteLink` SHALL invalidate `rides.inviteLinks(rideId)`,
which sits under the ride detail prefix so `rides.all()` reaches it too.

**The claim has a property no other mutation here has: there may be no cached entry to
invalidate.** The rider may have had no session when the landing route first rendered, so the
invalidation cannot be relied on to *cause* a fetch — the destination screen must fetch on mount
like any other, and the invalidation exists to stop a **stale** entry from a previous session
being served.

#### Scenario: The rider arrives at a ride they are on
- **WHEN** a rider claims a link and is routed to `/rides/detail?id=…`
- **THEN** the ride SHALL render with them present in the crew, and SHALL NOT serve a cached copy
  from before the claim

#### Scenario: The ride list and Explore agree with the claim
- **WHEN** the rider then opens `/rides`
- **THEN** the ride SHALL appear in their list, and SHALL NOT still appear on `/rides/explore` as
  a ride they are not on

#### Scenario: A revoked link leaves the list immediately
- **WHEN** the organizer revokes a link
- **THEN** the ride's link list SHALL show it revoked without a manual refresh

#### Scenario: Keys are named from the contract
- **WHEN** either new key is used
- **THEN** it SHALL be spelled in `src/lib/query/keys.ts` with the reconciliation note that file's
  header exists for, and never inline in a component

#### Scenario: The invalidation set is derived, not reinvented
- **WHEN** an action is migrated
- **THEN** its new invalidation SHALL cover at least the routes its `revalidatePath` calls named
- **AND** any route deliberately dropped SHALL be recorded with its reason, since three of
  today's calls target routes chosen by convention rather than necessity
#### Scenario: A mutation's own screen updates without a navigation
- **WHEN** a rider likes, joins, leaves, hides, blocks, reports, comments or posts
- **THEN** the screen they are on SHALL reflect the change without a manual refresh
#### Scenario: A failed mutation leaves no false state behind
- **WHEN** a mutation fails after an optimistic update
- **THEN** the optimistic change SHALL be reverted and the failure SHALL be shown
- **AND** a like, join or RSVP SHALL NOT remain visually applied after the write was refused

### Requirement: Counts SHALL stay per-viewer and SHALL NOT be cached across viewers

Every cache key SHALL be scoped to the signed-in rider, and no cached value MUST survive a
sign-out.

Likes and comments deliberately carry no denormalised count, because the correct count is
per-viewer: blocks and hides change it. A shared cache keyed only by postcard id would leak one
viewer's count to another.

**There are two unread counts now, not one, and the second is read on every tab-root screen.**
`club_unread_counts()` is read on one screen; the notification badge is read on four, which makes
the per-rider scoping rule load-bearing in a place the original scenario did not contemplate — a
count leaked across a sign-out would follow the next rider onto the first screen they open rather
than onto one they might never visit.

#### Scenario: Cache keys include the viewer
- **WHEN** any list, count or roster is cached
- **THEN** the key SHALL be scoped to the signed-in rider
- **AND** no cached value SHALL be reused across a sign-out and sign-in

#### Scenario: Blocking removes content already on screen
- **WHEN** a rider blocks another rider from the postcard overflow menu
- **THEN** the blocked rider's postcards, comments, likes and roster rows SHALL disappear from
  every cached view the blocker holds, not only from the next fetch
- **AND** the deck SHALL NOT skip past the card that was open, which is the behaviour the deck
  fix of 2026-08-05 established

#### Scenario: Unread counts follow the same rule
- **WHEN** `club_unread_counts()` is read
- **THEN** its result SHALL be cached per rider only, since the function is `security invoker`
  precisely so blocks and hides apply to it

#### Scenario: The notification badge follows it on four screens rather than one
- **WHEN** the unread notification count is read from any tab-root screen
- **THEN** its result SHALL be cached per rider only, for the same reason and by the same
  mechanism — the count function is `security invoker` so that blocks and subject resolvability
  apply to it
- **AND** `clearQueryCache()` on sign-out SHALL be what enforces it, rather than a per-key
  expiry, because a shared device is the case this protects and an expiry is a race

### Requirement: Stale data SHALL be bounded and visible

Every screen SHALL revalidate when the app is foregrounded. Freshness SHALL be expressed as a
revalidation rule, and a subscription SHALL be permitted only for a stream that has been
explicitly specified as live — never as the default mechanism for keeping a screen fresh.

No screen currently knows that data changed elsewhere; the server re-rendered on navigation and
the question never arose. A cached client can hold a list open for as long as the rider leaves
the app running.

**The `Real-time is not assumed` scenario deferred this decision to "the Inbox epic", and that
epic has now made it.** Per-ride chat is the first stream in this app specified as live. What
changes is narrow and is stated as a narrowing rather than a relaxation: one named stream may
carry a subscription, and everything else stays on revalidation. A subscription is an
optimisation **on top of** the revalidation rule and never a replacement for it — a client that
trusts an event stream to have filled a gap shows a thread with a hole in it and no indication
that anything is missing, because missed events are never replayed.

The rest of the subscription contract — lifecycle, channel naming, publication membership,
per-subscriber authorization, optimistic reconciliation — is **not** this capability's, and is
deliberately not restated here. It lives in `realtime-subscriptions`, so that the second live
stream in this app inherits it rather than rediscovering it.

#### Scenario: Returning to the app refreshes what is on screen
- **WHEN** the app is foregrounded after being backgrounded
- **THEN** the visible screen SHALL revalidate its data
- **AND** this SHALL hold for a screen carrying a subscription exactly as it does for one that
  does not

#### Scenario: A ride whose details changed is not acted on stale
- **WHEN** a rider RSVPs to a ride whose departure time or meeting point has changed since the
  screen loaded
- **THEN** the write SHALL still be attempted against the current row, and the screen SHALL
  reflect the current values afterwards rather than the ones it was showing

#### Scenario: Real-time is not assumed
- **WHEN** freshness is specified for a screen
- **THEN** it SHALL be expressed as a revalidation rule by default
- **AND** a subscription SHALL be added only where a specification names that stream as live,
  which today is the per-ride message thread and nothing else
- **AND** the existence of one subscription SHALL NOT be read as permission to add others, since
  each carries a socket, a lifecycle and a per-subscriber authorization question of its own

#### Scenario: A live screen still revalidates
- **WHEN** a screen holds a subscription and the socket reconnects, or the app is foregrounded
- **THEN** the screen SHALL refetch its current state rather than assuming the events it missed
  will arrive
- **AND** the refetch SHALL reconcile with what the client already holds, matched by id, rather
  than replacing it and losing the rider's position

#### Scenario: A cache key fed by a subscription obeys every other rule unchanged
- **WHEN** a subscription writes into the query cache
- **THEN** it SHALL write through the same keys spelled in `src/lib/query/keys.ts`, never a
  string composed at the subscription site
- **AND** the key SHALL be scoped to the signed-in rider and SHALL NOT survive a sign-out, per
  the per-viewer rule this capability already carries

### Requirement: Redirect-after-write SHALL survive the loss of server redirects

A successful create SHALL navigate the rider to the created resource or the list containing it,
and MUST NOT leave the form indistinguishable from never having been submitted.

Twelve action call sites end in `redirect()` from `next/navigation` — signup, both onboarding
steps, password update, sign-out, club creation, ride creation, postcard creation. A client
mutation cannot redirect from the server, and the redirect is load-bearing in at least two
places: it is what makes "posted" distinguishable from "not submitted yet" when both states
are `{ error: null }`.

#### Scenario: Success is distinguishable from the initial state
- **WHEN** a create action succeeds
- **THEN** the rider SHALL be navigated to the created resource or the list that now contains it
- **AND** the form SHALL NOT be left in a state indistinguishable from never having been
  submitted

#### Scenario: Onboarding still advances one step at a time
- **WHEN** the username step succeeds
- **THEN** the rider SHALL land on the location step, and SHALL NOT be able to reach it before
  the username is set, matching the guard's current rule

### Requirement: A count and the list it summarises SHALL be invalidated together and read through the same predicate

Where a screen shows both a count and the list it counts, the two SHALL share a cache key prefix
so that no invalidation can reach one without the other, and both SHALL be produced by reads
subject to the same row security.

**A badge that disagrees with its list is a defect the rider cannot clear and cannot report
usefully.** It has two independent causes and this repo has the ingredients for both: a
`security definer` count reads past predicates the list obeys, and two cache keys under different
prefixes drift the moment one action invalidates only the cheaper one. `club_unread_counts()`
already avoids the first by being `security invoker`; nothing yet states it as a rule.

#### Scenario: One invalidation reaches both
- **WHEN** anything invalidates a count
- **THEN** the list it summarises SHALL be invalidated in the same call, by prefix
- **AND** a call site SHALL NOT be able to name one without the other

#### Scenario: A definer-rights count is refused as a mechanism
- **WHEN** a count is implemented
- **THEN** it SHALL NOT bypass any predicate the corresponding list obeys
- **AND** `security definer` SHALL NOT be used to make a count cheaper, because the saving is a
  badge that never clears on a screen that is empty

#### Scenario: The rider never sees a nonzero badge over an empty list
- **WHEN** the count and the list are both fresh
- **THEN** a nonzero count SHALL imply at least one row in the list
- **AND** the reverse SHALL hold for zero

#### Scenario: Agreement is a property of the predicate, not of a filter the renderer applies
- **WHEN** a row is counted but cannot be rendered — its actor or its subject does not resolve for
  the reader
- **THEN** the repair SHALL be to add the missing conjunct to the **predicate both reads share**, so
  the row is in neither
- **AND** dropping it in the component SHALL NOT be the repair, because that produces a nonzero
  count over a shorter list, which is precisely what this requirement forbids
- **AND** "render nothing for that row" SHALL be recognised as the same defect written as an
  instruction: a list of ten that draws nine is a list of nine with a wrong badge

#### Scenario: A failed count shows nothing rather than a stale value
- **WHEN** a count read fails
- **THEN** the badge SHALL be absent
- **AND** it SHALL NOT render the last successful value, because a dot the rider cannot clear by
  visiting the screen is worse than a missing one

### Requirement: A cached row whose subject the reader may no longer see SHALL be evicted by the database, not by the component that renders it

Where a cached list holds rows that point at another resource, the decision to drop a row whose
target has become invisible SHALL be made by the query, and no component SHALL filter a list for
visibility.

Decision #2 already forbids client-side block filtering. This extends the same rule to the wider
case that notifications introduce: a row can become unrenderable because the *reader's own*
relationship to the subject changed — they left a club, a club turned private — with no block
anywhere. A component filtering that case would make the count and the list disagree by
construction, and would put a visibility rule in the one place this project has decided it must
never live.

#### Scenario: The query decides, not the renderer
- **WHEN** a list contains a row whose subject the reader can no longer read
- **THEN** the row SHALL be absent from the query result
- **AND** no component, data function or action SHALL drop it after the fact

#### Scenario: An eviction is not a deletion
- **WHEN** a row stops being returned because the reader's relationship to its subject changed
- **THEN** the underlying row SHALL survive
- **AND** it SHALL be returned again if that relationship is restored, with its original ordering
  and read state

#### Scenario: A membership change invalidates everything that could depend on it
- **WHEN** a rider joins or leaves a club
- **THEN** every cached list whose contents can be gated by that membership SHALL be invalidated,
  not only the club's own screens
- **AND** over-invalidating SHALL be the chosen direction, matching the existing rule that a
  refetch is cheaper than a correctness bug

### Requirement: A mutation that crosses domains SHALL reach every key it moves, in every domain

Where one write changes what more than one domain's screens show, the action SHALL invalidate every
affected key — **through the narrowest claim that provably reaches all of them**, which is a
domain-wide prefix wherever a write is already in that domain's blast radius.

**This requirement was written as "name every key explicitly and SHALL NOT rely on a domain-wide
prefix", and the `reviewer` pass on the built code is what corrected it** — a rare case of the
implementation being right and the specification wrong, so it is recorded rather than quietly
reversed. Enumerating is only safer where the enumeration is complete, and here it was not:
accepting an invite writes a `ride_members` row, which is byte for byte the state change
`setRideAttendance` makes, and that action has always invalidated the whole `['rides']` prefix
because a joined ride is *"always in the blast radius"*. Naming `rides.detail(id)` and the crew key
instead left `rides.list(filter)` and `rides.explore(...)` untouched, so a rider who accepted from
the notification panel and returned to the Rides tab inside the stale window found the ride they had
just joined missing from `Your rides` and a public one still sitting in Explore.

The rule that survives, and it is the load-bearing half: **a claim SHALL be justified against
`keys.ts`'s stated prefix reach and never against intuition.** A domain-wide prefix is correct when
the write is in that domain; it is wrong when it merely looks adjacent — `invites.pending()` is not
under `['rides']` and must still be named.

#### Scenario: Accepting from the notification list reaches every affected key
- **WHEN** `acceptRideInvite` succeeds
- **THEN** the invite list key and the notifications keys SHALL be invalidated by name, being in
  neither the rides domain nor reachable from it
- **AND** the rides domain SHALL be claimed by its prefix, which reaches the ride, its crew, its
  invite list, the tab's own lists and Explore — the last two being what an enumeration missed
- **AND** every claim SHALL be named through `keys.ts`, never written inline

#### Scenario: Declining claims the ride, and no list
- **WHEN** `declineRideInvite` succeeds
- **THEN** the invite list, the notification list and its unread count SHALL be invalidated
- **AND** the **ride** key SHALL be invalidated, because a declined invite grants nothing and the
  cached ride the rider opened from the notification is an entry they can still read
- **AND** no rides **list** key is owed, because a pending invitee holds no `ride_members` row, so
  the ride was never in `Your rides` nor out of Explore

#### Scenario: Revoking moves the invitee's keys through the database, not the cache
- **WHEN** the organizer revokes an invite
- **THEN** the organizer's own invite list SHALL be invalidated
- **AND** the invitee's stale copy SHALL be corrected by the read policy on their next fetch, not by
  any client-side eviction, consistent with the standing requirement that a cached row whose subject
  the reader may no longer see is evicted by the database

### Requirement: An optimistic answer to an invite SHALL NOT be shown before the write lands

Accept and Decline SHALL NOT be rendered optimistically. The invite's status, the crew row and the
ride's readability are all decided by the database — an accept can be refused by a block, by the
participation gate, or by the ride having been deleted — so a locally-flipped status is a claim the
client is not entitled to make.

#### Scenario: The control shows pending until the server answers
- **WHEN** the rider presses Accept
- **THEN** the control SHALL show a pending state and SHALL NOT render the accepted outcome
- **AND** on failure the row SHALL return to its previous state with the invite re-read

#### Scenario: Offline, the controls do not queue
- **WHEN** the rider is offline
- **THEN** Accept and Decline SHALL be disabled with a reason and SHALL NOT be queued for replay,
  because a queued accept that is refused on reconnect leaves a rider believing they are on a ride

### Requirement: A cached capability preview SHALL be keyed by its token and SHALL NOT outlive the session

`invites.link(token)` SHALL carry the token in the key, so two tokens cannot share an entry, and
SHALL sit under the `invites` prefix so `invites.all()` reaches it.

The preview SHALL be cleared by `clearQueryCache()` on sign-out along with everything else — it
describes a ride the next rider on the device may have no right to see, and a preview served from
cache to a different session is an anonymous read with extra steps.

**A dead token SHALL NOT be cached as a live one.** The preview returns zero rows for every dead
state, which is a **decided** answer and therefore `null` rather than `undefined`; only `null`
renders the invalid-link message, and `undefined` SHALL continue to mean "not yet".

#### Scenario: Two tokens do not share an entry
- **WHEN** a rider opens two different invite links in one session
- **THEN** each SHALL resolve to its own cache entry and its own ride

#### Scenario: A preview does not survive sign-out
- **WHEN** a rider signs out
- **THEN** no cached preview SHALL be readable by the next session on that device

#### Scenario: Zero rows is decided, not pending
- **WHEN** the preview returns zero rows
- **THEN** the screen SHALL render the invalid-link message, and SHALL NOT render a skeleton
  indefinitely

