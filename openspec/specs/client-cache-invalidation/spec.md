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

**The onboarding half of that list is one step shorter since PD-286**, and the scenario below is
rewritten rather than dropped. `setUsername` no longer hands off to a second wizard screen: it is
the terminal step, so its redirect is `/postcards` and the property worth asserting moves with it.
What has to survive is the *reason* the scenario existed — a wizard step whose success is
indistinguishable from its initial state strands the rider on it — not the number of steps.

#### Scenario: Success is distinguishable from the initial state
- **WHEN** a create action succeeds
- **THEN** the rider SHALL be navigated to the created resource or the list that now contains it
- **AND** the form SHALL NOT be left in a state indistinguishable from never having been
  submitted

#### Scenario: Onboarding still advances one step at a time
- **WHEN** the username step succeeds
- **THEN** the rider SHALL land on `/postcards`, because it is the last step of the wizard and
  commits `onboarding_completed_at` itself
- **AND** the rider SHALL NOT reach any app route before the username is set, which the route
  guard enforces as a redirect and `023`'s participation gate enforces as a refusal
- **AND** the redirect SHALL name a destination rather than a wizard step, leaving the guard to
  resolve where a rider actually belongs — the shape `acceptTerms` already uses

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

### Requirement: A key outside its domain's detail prefix SHALL be named at every call site that must move it, and its reach SHALL be documented in `keys.ts`

Where a screen is reached by an id that is not its domain's own root id — a thread opened by
its thread id, with no club id available until the read resolves — its cache key SHALL NOT be
nested under that domain's **detail** prefix, and no mutation SHALL rely on a `detail`-scoped
invalidation to reach it.

**The domain-wide prefix still reaches it, and a spec claiming otherwise would be wrong.**
`invalidate` matches structurally on prefix — `keyStartsWith` in `src/lib/query/queryClient.ts`
compares element by element — so `['clubs']` reaches `['clubs','threads',<id>,'messages']` just
as it reaches every other key under the domain. The true statement is narrower and is the one that
matters at the call site: the key is not under `['clubs','detail',<clubId>]`, so the club-scoped
invalidations that a thread mutation would naturally reach for do **not** move it, while the
domain-wide `clubs.all()` does.

That asymmetry SHALL be recorded in `keys.ts` as *which prefixes reach it*, stated positively, and
SHALL NOT be recorded as "no prefix reaches it" — `keys.ts`'s header is treated as authoritative by
every later reader, so a false claim there is worse than no claim.

#### Scenario: The thread key is named, not inherited
- **WHEN** a message is sent into a club thread
- **THEN** the action SHALL invalidate the thread's own key explicitly
- **AND** it SHALL NOT rely on a club-scoped `['clubs','detail',<clubId>]` invalidation, which does
  not reach it
- **AND** it SHALL NOT rely on the domain-wide `clubs.all()` either — which *would* reach it —
  because that refetches every club screen in the cache on every send

#### Scenario: A mutation that moves two unconnected keys names both
- **WHEN** a thread is deleted
- **THEN** the action SHALL invalidate both the club's Threads list key and the thread's own
  message key
- **AND** the club id needed for the first SHALL be carried by the action rather than re-read after
  the row is gone

#### Scenario: The reach is written down where the keys are, positively
- **WHEN** a key is added that sits outside its domain's detail prefix
- **THEN** `keys.ts` SHALL record **which prefixes reach it and which do not**, in the same table
  that reconciles the retired `revalidatePath` claims
- **AND** the record SHALL be verified against `keyStartsWith` rather than assumed from the key's
  shape, because prefix matching is structural and an eyeballed answer is how a false claim enters
  the contract
- **AND** the key SHALL NOT be renested under `detail` to hide the asymmetry, because the screen
  does not hold the club id at read time

### Requirement: An unread mark and the list it annotates SHALL be read under one predicate and invalidated together

Where a list is drawn with a per-row unread mark computed by a separate call, both SHALL be
computed under the caller's own row security through the same visibility predicate, and the mark's
key SHALL be nested under the list's key so that invalidating the list reaches the mark.

The nesting SHALL be one-directional on purpose: invalidating the list reaches the mark, because
anything that changes the list can change the mark; invalidating the mark SHALL NOT reach the list,
because a watermark advancing changes no row.

#### Scenario: A new thread moves both
- **WHEN** the Threads list key is invalidated
- **THEN** the per-thread unread key SHALL be invalidated with it

#### Scenario: Marking a thread read does not refetch the list
- **WHEN** the watermark advances for one thread
- **THEN** the unread key alone SHALL be invalidated
- **AND** the list SHALL NOT be refetched, because no thread appeared, vanished or moved

#### Scenario: The mark obeys the same block rule as the list
- **WHEN** a rider has blocked the author of a thread's most recent message
- **THEN** the mark SHALL be computed by a `security invoker` reader so the same SELECT policy
  decides both
- **AND** no block filter SHALL be applied a second time in the data layer or the component

### Requirement: The guard cache SHALL be invalidated by whichever write is last, and the writer count SHALL be a measurement rather than a sentence

Every action that writes a stamp `resolveDestination` reads SHALL call
`invalidateOnboardingState()`, and when a step is removed the **surviving** last writer SHALL carry
the call. The number of such writers SHALL be verified by counting call sites, never by trusting
prose — including the prose in `CLAUDE.md`.

`guard-cache.ts` holds the session and both onboarding stamps for the page load rather than
re-reading them per navigation, which is what removed a round trip to `eu-west-1` from behind a
full-screen splash on every tab tap. The cost of that is a hard rule: *miss one and the rider
finishes a step and is sent straight back into it.* Today there are four writers — `signUp`,
`setUsername`, `acceptTerms`, `setLocation` — and this change deletes the one that is **last**,
which is the only position where a missed call is guaranteed to strand somebody rather than merely
risk it.

Three writers survive, and `setUsername` inherits the terminal position. It SHALL invalidate
**once, after both of its writes**, not between them: an invalidation issued after the username
UPDATE and before `complete_onboarding` re-populates the cache with a stamp that is about to change,
which is the same staleness the call exists to prevent, arriving one round trip earlier.

**The count is load-bearing outside the code.** `scripts/docs/registry.mjs`'s
`guard-cache-invalidators` claim greps the call sites and compares them against a number written in
`CLAUDE.md` §Critical: the route guard. Deleting `setLocation` without editing that sentence turns a
correct change into a failed `docs:check` — which is the check working, and is a task rather than a
surprise. Its own registry comment states the asymmetry to respect: it *"counts calls, not
writers"*, so it catches a deleted call and cannot catch a fifth writer added without one.

#### Scenario: The terminal step invalidates after its last write
- **WHEN** the username step writes the username and then commits the completion stamp
- **THEN** `invalidateOnboardingState()` SHALL be called once, after both writes have succeeded
- **AND** the rider SHALL land on `/postcards` without the guard bouncing them back into the wizard

#### Scenario: A partial failure leaves the cache no worse than the truth
- **WHEN** the username write succeeds and the completion call then fails
- **THEN** the cached state MAY still say "no username", and the guard's answer — the username
  step — SHALL be correct either way
- **AND** no code path SHALL cache a completion stamp that was never written

#### Scenario: The writer count is re-measured, not edited from memory
- **WHEN** an onboarding action is added or removed
- **THEN** the number in `CLAUDE.md` SHALL be re-derived with the registry's own command rather
  than adjusted by hand
- **AND** `npm run docs:check` SHALL pass before the change merges, because this claim's `kind` is
  a shell grep and therefore runs in CI's cheap set

#### Scenario: Sign-out still clears the whole cache
- **WHEN** a rider signs out
- **THEN** `clearGuardCache()` SHALL run, unchanged by this change
- **AND** the session half SHALL continue to have `onAuthStateChange` as its single writer

### Requirement: A new read key SHALL be placed under a prefix its writers already invalidate

A cache key earns its place by the prefix that sweeps it. Where an existing action already
invalidates a prefix that covers a new key, the key SHALL be placed under that prefix and the
action SHALL NOT gain a new `invalidate` call — an added call site that a prefix already reaches
is dead code, which is the reasoning `keys.ts` records for `postcards.journal`.

Where no existing prefix covers it, the writer SHALL be given the invalidation explicitly, and
the reason SHALL be recorded beside the key.

#### Scenario: The hidden-postcards key needs no new invalidation
- **WHEN** the hidden-postcards list is added
- **THEN** its key SHALL sit under the `postcards` prefix
- **AND** `hidePostcard` and `unhidePostcard` SHALL be unchanged, because both already call
  `invalidate(queryKeys.postcards.all())` and `invalidate` matches structurally by prefix
- **AND** hiding a postcard SHALL add it to the list without a manual refresh, which is the case
  a key placed outside that prefix would silently miss

#### Scenario: The blocked-riders key is already swept
- **WHEN** a rider blocks or unblocks someone
- **THEN** `blockRider` and `unblockRider` SHALL remain unchanged, because both invalidate
  `EVERYTHING` — the empty prefix, which reaches every key by construction
- **AND** the list SHALL reflect the change without a navigation
- **AND** the key SHALL additionally be swept by `updateProfile`'s existing `profile.all()`,
  which costs one re-read of a short list and cannot make it stale

#### Scenario: Neither key survives a sign-out
- **WHEN** a rider signs out
- **THEN** `clearQueryCache()` SHALL discard both, as it does every key
- **AND** neither list SHALL be visible to the next rider who signs in on the same device
- **AND** both keys hold own-row data only, so no value in either is shared across viewers

### Requirement: Each timeline source SHALL keep its own cache key, and a write from the create bar SHALL invalidate every source it moves

The timeline is a merge of reads that other screens also make, so it SHALL NOT be given a cache
entry of its own holding the merged result. Two shapes under one key is the collision
`keys.ts`'s own header warns against, and here it would put a 40-entry merged stream and a
30-row postcard feed behind whichever screen loaded first.

The postcards source SHALL keep reading `postcards.feed(filterSegment.club(id))` and the rides
strip `rides.list(filterSegment.club(id))`, unchanged, so the club detail and
`/postcards?club=<id>` and `/clubs/detail/rides` stay in agreement about their contents. The two
new reads SHALL take new keys under `clubs.detail(clubId)` — the same nesting `members`,
`threads` and `joinRequests` use — so any invalidation of `clubs.all()` reaches them for free.

A write made from the create bar SHALL invalidate every key its rows appear under, including
the ones it did not previously have to name:

- creating a ride in the club → the club's rides list **and** the new recent-rides key
- posting a postcard to the club → the club's postcard feed key
- starting a thread → `clubs.detail(clubId).threads` **and** its unread child
- joining or leaving → the new recent-joins key **and** `clubs.detail(clubId).members`, which
  the Members rail reads

#### Scenario: A newly created ride appears in both places it is drawn
- **WHEN** a member creates a ride from the create bar
- **THEN** the upcoming-rides strip and the timeline SHALL both show it without a reload
- **AND** the two SHALL NOT disagree, because each reads its own key and both are invalidated

#### Scenario: The merged stream is not cached
- **WHEN** the timeline renders
- **THEN** no cache key SHALL hold the merged result
- **AND** the merge SHALL be recomputed from the source entries on each render, being a pure
  function of them

#### Scenario: A new key is reachable from the club prefix
- **WHEN** any club mutation invalidates `clubs.all()` or `clubs.detail(clubId)`
- **THEN** both new keys SHALL be reached, being children of `clubs.detail(clubId)`

### Requirement: A count that summarises a DIFFERENT predicate from the list it sits beside SHALL say so where it is defined

`client-cache-invalidation` already requires that a count and the list it summarises be
invalidated together and read through the same predicate. The club badge on `/clubs` and this
timeline are **not** that pair, and the difference SHALL be recorded rather than left to be read
as agreement.

Measured: `public.club_unread_counts` counts `postcards` created since the watermark whose
`author_id` is not the caller, plus `rides` created since the watermark. It counts **no threads
and no joins**, where the timeline draws all four. So a club whose only recent activity is three
new threads shows no badge and a timeline with three entries, and that is correct behaviour under
both definitions.

This change SHALL NOT alter the function — doing so is a migration, and a join is not news
addressed to a rider, while threads already carry a finer per-thread watermark the badge would
double-count. The divergence SHALL be stated at both `club_unread_counts` and the timeline's own
module so neither is read as the other's summary.

#### Scenario: The badge and the timeline are allowed to disagree, in writing
- **WHEN** three threads are started in a club and nothing else happens
- **THEN** the club's badge on `/clubs` SHALL remain absent
- **AND** the timeline SHALL show three entries
- **AND** both modules SHALL carry a comment naming the other's predicate

#### Scenario: The timeline does not spend the club watermark differently than today
- **WHEN** a member opens the club detail
- **THEN** `MarkClubSeen` SHALL advance `feed_reads.last_seen_at` exactly as it does today
- **AND** the timeline SHALL NOT read that watermark, draw a "new since" boundary, or depend on
  the order in which the mark and the reads complete

### Requirement: Two reads that share a cache key SHALL be widened together, or the key SHALL be split before either moves

Where two functions are documented as returning the same list and share one key, a change that
widens one SHALL widen the other in the same commit. Splitting the key instead SHALL be permitted
only where the two lists are *intended* to differ, and SHALL then be justified as a product decision
rather than as a caching one.

`getClubFeed(clubId)` and `getFeed({}, { kind: 'club', id })` share
`postcards.feed(filterSegment.club(id))` and are documented in
`src/app/(app)/clubs/detail/page.tsx` as *"the same select, order, limit and predicate"*. That
sentence is a **contract**, not a description, and this change keeps it true by making one function
the implementation of both.

#### Scenario: One key, one list, whatever the navigation order
- **WHEN** a rider loads the club detail and then `/postcards?club=<id>`, or the reverse
- **THEN** the two screens SHALL render the same postcards
- **AND** the entry served from cache SHALL be correct for the screen that asks second

#### Scenario: The shared-key note is updated, not left standing
- **WHEN** the widening lands
- **THEN** the comment asserting the two reads are identical SHALL be edited to say what they now
  return
- **AND** it SHALL NOT be annotated with a correction paragraph — `CLAUDE.md` §Working Principles, which
  says to replace a wrong claim rather than narrate it

#### Scenario: A split key would have been a product decision
- **WHEN** the alternative is reviewed
- **THEN** it SHALL be recorded that giving `getClubFeed` its own key makes the strip and its own
  `See all` show legitimately different lists, which is a worse outcome than the defect it avoids

### Requirement: A widened read SHALL have its existing invalidation claims RE-DERIVED against the wider list, not assumed to still hold

This change adds no mutation and no new key, and the existing claims are believed sufficient. That
belief SHALL be re-derived against `keys.ts`'s stated prefix reach rather than assumed, because the
set of writes that can change this list has grown: **tagging a postcard to a ride now changes which
club strips contain it**, which was previously true of no write at all.

The re-derivation, stated so a reviewer can check it rather than take it: `createPostcard` and
`invalidatePostcard` both claim `queryKeys.postcards.all()`, and `postcards.feed(club:<id>)` sits
under that prefix for **every** club, so a postcard created with a `ride_id` naming a club's ride
already invalidates that club's strip without knowing which club it is. `deletePostcard` and the
like/unlike pair reach it the same way.

Where a future write reaches the tag without claiming the whole prefix, the claim SHALL be widened
rather than a club id guessed from a second read.

#### Scenario: The prefix claim is confirmed to reach the widened list
- **WHEN** a postcard is created tagged to a ride of a club the author is not posting to
- **THEN** that club's strip SHALL redraw with the postcard on it, without a reload
- **AND** the claim doing that work SHALL be `postcards.all()`, named explicitly in the review rather
  than inferred

#### Scenario: The narrower-looking claim is refused
- **WHEN** somebody proposes resolving the ride's club so the invalidation can name
  `postcards.feed(club:<that id>)` precisely
- **THEN** it SHALL be refused: it costs a round trip, it under-invalidates whenever the postcard is
  tagged to a ride whose club differs from its audience, and `invalidatePostcard`'s own header
  already records that naming keys precisely *"would under-invalidate by exactly the amount that is
  hard to see"*

#### Scenario: No key is added without a reader
- **WHEN** the change is reviewed
- **THEN** no new entry SHALL appear in `src/lib/query/keys.ts`
- **AND** a key nothing fills SHALL be treated as worse than none, because it carries an
  invalidation claim about an entry that never exists

### Requirement: A cache entry holding a signed URL SHALL NOT outlive the signature

Where a cached value contains a signed Storage URL, the entry SHALL be treated as expiring when the
signature does. A stale signature SHALL produce a re-mint, never a rendered broken image and never
a silent blank.

**A signed URL is the one cached value in this app that stops working on a clock rather than on an
event.** Every other staleness rule here is about a *write* somewhere making a cached read wrong,
and the fix is invalidation on that write. Nothing writes when a signature expires. A cache tuned
only for the write case holds a dead URL indefinitely, and the symptom is an image that vanishes
from a screen nobody touched.

#### Scenario: An expired signature re-mints rather than renders
- **WHEN** a cached value's signed URL has passed its expiry
- **THEN** the URL SHALL be re-minted under the current session before use
- **AND** the screen SHALL NOT render a broken image, an empty container where an image was, or a
  retry the rider has to press

#### Scenario: The signature's lifetime bounds the entry, not the other way round
- **WHEN** a cache entry's lifetime and a signature's lifetime disagree
- **THEN** the shorter one SHALL govern
- **AND** an entry SHALL NOT be extended by a refetch that reuses the URL it already held

#### Scenario: A signed URL is never cached across riders
- **WHEN** a value containing a signed URL is cached
- **THEN** its key SHALL be scoped to the signed-in rider
- **AND** it SHALL NOT survive a sign-out, because the URL keeps working after the session that
  minted it is gone

#### Scenario: Expiry is not revocation, and the cache does not pretend otherwise
- **WHEN** a rider loses access to the row an object hangs off
- **THEN** invalidating the cache entry SHALL NOT be treated as having revoked their access
- **AND** the outstanding URL SHALL be understood to work until it expires, which is a property of
  Storage that no cache rule can change

#### Scenario: A missing derivative is a normal cached value, not a cache miss
- **WHEN** a cached row carries a NULL object path — no tile was ever rendered for it
- **THEN** that NULL SHALL be cached as the answer it is
- **AND** it SHALL NOT trigger a refetch on every render, because "no tile" is the steady state of
  most rows rather than a gap waiting to be filled

### Requirement: A mutation SHALL invalidate every key whose data the database changed, including rows it did not name

The standing contract is that every read key is spelled in `src/lib/query/keys.ts` and every
mutation invalidates the keys it affects. This change adds the first mutations whose effects reach
**rows the call never mentioned**, so "the keys it affects" is wider than "the keys for the row it
wrote".

- **`updateRide`** SHALL invalidate `rides.detail(rideId)` and `rides.all()`. `rides.all()` rather
  than `rides.list(filter)` alone, because a ride's `club_id` and `is_public` are editable and an
  edit can move it between filter segments — invalidating only the segment it *was* in leaves it
  visible in a list it no longer belongs to.
- **`deleteRide`** SHALL invalidate `rides.all()`, which subsumes `detail`, `crew` and `messages`
  through the shared prefix. It SHALL also invalidate `postcards.all()`, because
  `postcards.ride_id` is `ON DELETE SET NULL` and any postcard tagged to that ride has changed.
- **`updateClub`** SHALL invalidate `clubs.all()` — `yours`, `explore`, `mine` and `detail` are all
  reachable from a name, description or privacy change. **When `is_public` changed, it SHALL also
  invalidate `rides.all()`**, because `propagate_club_privacy_to_rides` rewrote ride rows the call
  never named. A club edit that refreshes only club screens leaves the rides list showing rides as
  public that the database has just made private.
- **`deleteClub`** SHALL invalidate `clubs.all()`, `rides.all()` and `postcards.all()`. All three
  are cascades or sweeps the client did not name: `club_members` and `feed_reads` (club screens),
  `rides` (deleted by the function), `postcards` (cascade).

#### Scenario: A club's privacy is toggled while the rides list is cached

- **WHEN** an owner sets `is_public = false` on a club with public rides
- **THEN** `rides.all()` SHALL be invalidated
- **AND** the rides list SHALL NOT continue to render those rides as public

#### Scenario: A ride is edited into a different club

- **WHEN** an organizer changes a ride's `club_id`
- **THEN** `rides.all()` SHALL be invalidated rather than only the filter segment it came from

### Requirement: A mutation that deletes the resource the current screen reads SHALL navigate before or with the invalidation

`deleteRide` and `deleteClub` are called from a screen whose own query key is about to resolve to
nothing. Invalidating first and navigating second re-runs the detail read against a deleted row,
which returns `null` and trips `notFound()` — a 404 flash on the way out of a successful action.

The delete actions SHALL navigate away from the deleted resource as part of the same interaction,
and the detail screen SHALL NOT be left mounted against an invalidated key for a deleted row.

#### Scenario: An organizer deletes the ride they are looking at

- **WHEN** deletion succeeds on `/rides/detail`
- **THEN** the rider SHALL land on the rides list
- **AND** SHALL NOT see a not-found screen in between

### Requirement: A read-state write SHALL NOT invalidate the content it marks read

Where a mutation records that a rider has *seen* something, it SHALL invalidate the badge derived
from that record and SHALL NOT invalidate the content the badge summarises.

**This is the one invalidation in the app that must be asymmetric, and getting it symmetric is
expensive rather than merely wasteful.** Existing rules push in one direction — over-invalidating is
the safe direction, because a refetch is cheaper than a correctness bug — and a read-state write is
where that stops being true. The write fires while the rider is looking at the content: `015`
already found this twice and narrowed both call sites for it, recording that refetching `/postcards`
on `markFeedSeen` would *"replace the cards under a rider looking at the exhausted state"*.

A live thread makes it worse than wasteful. The mark advances on every arriving message, so a
symmetric invalidation turns each delivered message into a refetch that marks it read that triggers
another refetch — one extra round trip per message on the screen the rider is actively reading, for
data that just arrived.

The direction that must hold is the other one: a write that produces new content SHALL reach the
badge, and it SHALL do so through the key structure rather than through a second key named at the
call site.

#### Scenario: Marking seen refetches the badge only
- **WHEN** a rider's read-state watermark is written
- **THEN** only the key holding the derived unread answer SHALL be invalidated
- **AND** the list, thread or feed that the watermark refers to SHALL NOT be invalidated

#### Scenario: A new message reaches the badge without the call site naming it
- **WHEN** content is written into a surface that carries a read watermark
- **THEN** the badge's cached answer SHALL be invalidated
- **AND** the widening SHALL be expressed in `src/lib/query/keys.ts` by nesting the badge's key
  under the content's key, never by adding a second `invalidate` argument at the call site

#### Scenario: The asymmetry is recorded where the narrow claim is made
- **WHEN** an invalidation is deliberately narrower than the prefix above it
- **THEN** the reason SHALL be recorded at that call site
- **AND** it SHALL NOT be readable as an oversight, because every other narrow claim in this app is
  one that widened from a `revalidatePath`

### Requirement: A badge SHALL NOT be cached across riders, and its key SHALL be scoped to the resource it decorates

An unread answer SHALL be cached per rider and per resource, and SHALL NOT survive a sign-out.

The existing per-viewer rule already covers `club_unread_counts()` and the notification count. This
adds the case those two do not have: an answer that is **per rider and per ride at once**, computed
through a policy carrying a symmetric block arm, so two crew members on the same ride at the same
moment can hold different correct answers about the same thread.

#### Scenario: Two crew members hold different answers about the same thread
- **WHEN** one crew member has blocked another and that other rider posts
- **THEN** the blocker's cached answer SHALL be `false` while another crew member's is `true`
- **AND** neither SHALL be treated as authoritative about the ride, matching the rule already stated
  for the chat's crew count

#### Scenario: Sign-out destroys it
- **WHEN** a rider signs out
- **THEN** `clearQueryCache()` SHALL be what removes the cached answer, rather than a per-key expiry
- **AND** no unread answer SHALL be reused across a sign-out and sign-in on a shared device

### Requirement: A read that costs money SHALL be cached, with a stated lifetime, and SHALL NOT outlive the session

Every read this cache holds today is free at the point of use: a repeated query costs a round trip to
our own database. A read that bills a third party per request is a different kind of read, and the
cache stops being a latency optimisation and becomes a spend control.

Such a read SHALL be issued through the cache under a key spelled in `keys.ts`, like every other
read. **A declared key with no caller is worse than no key**, because it reads as coverage: the
place-search key exists today and nothing uses it, so retyping a term re-issues the query.

The key SHALL carry every input that changes the answer — the term and any bias — because two
different questions cached under one key show whichever answered first to both.

The entry SHALL have a stated lifetime chosen against how fast the answer actually changes, not
against the default. A place does not move; a rider's typing does.

A cached third-party response SHALL be destroyed at sign-out with the rest of the cache. A search
term is frequently a home address, so a residual entry is a previous rider's address readable by the
next rider on the same device.

#### Scenario: A repeated question is not repeated to the vendor
- **WHEN** the same term and the same bias are requested again within the entry's lifetime
- **THEN** the cached answer SHALL be returned
- **AND** no request SHALL reach the vendor and no metered attempt SHALL be recorded

#### Scenario: The lifetime is a decision with a reason
- **WHEN** the entry's lifetime is read
- **THEN** it SHALL be stated beside the key with the reason it is that number
- **AND** it SHALL NOT be inherited from whatever the cache defaults to

#### Scenario: Sign-out leaves no terms behind
- **WHEN** a rider signs out
- **THEN** every cached term and result SHALL be cleared by the existing sign-out sweep
- **AND** nothing SHALL persist them outside the cache — not local storage, not the session store, and
  not a module-level variable that survives the navigation

#### Scenario: A failed metered read is not cached as an answer
- **WHEN** a metered read fails, is refused by a ceiling, or is aborted
- **THEN** the failure SHALL NOT be stored as the answer for that key
- **AND** a later identical request SHALL be free to try again, once, rather than being served a
  cached failure for the entry's whole lifetime

### Requirement: A form's accelerator read SHALL be cached under a named key and SHALL be moved by the writes that change it

The recents list is read while a rider is filling a form, on focus, and re-read on every subsequent
focus of that field. It SHALL be cached, its key SHALL be spelled in `src/lib/query/keys.ts` like
every other key, and it SHALL NOT be fetched with a key written inline at the call site — a key that
happens to be right is still a key nothing can reconcile.

**The key SHALL be filed under the domain that owns the rows it reads**, so the writes that change it
already reach it. Recents are derived from `rides`, and creating, editing and deleting a ride each
already invalidate the whole `rides` prefix; a key nested there is therefore moved by all three with
**no new invalidation call site**. Over-invalidating is the safe direction — an RSVP will also
refetch it, costing one small read and never a wrong answer.

A stale recents list SHALL be bounded rather than perfect: it is an accelerator, and the worst
outcome of a stale one is that a rider taps search instead. It SHALL NOT be revalidated on a timer,
polled, or subscribed to.

The list SHALL be **destroyed** rather than refreshed when the session ends, for the reason sign-out
destroys the cache rather than invalidating it: on a shared device, refetching would repopulate one
rider's meeting points while another signs in.

#### Scenario: Creating a ride moves the list
- **WHEN** a rider creates a ride with a picked start
- **THEN** the next focus of a start field SHALL offer that start, without a page reload
- **AND** the freshness SHALL come from the ride domain's existing invalidation rather than from a new
  claim made by the recents read

#### Scenario: Editing or deleting a ride moves it too
- **WHEN** a rider changes a ride's start, types over it, or deletes the ride
- **THEN** the recents list SHALL reflect that on its next read
- **AND** no invalidation SHALL be needed that the ride's own write does not already make

#### Scenario: The key is declared, not spelled
- **WHEN** the recents read is issued
- **THEN** its key SHALL come from `keys.ts`
- **AND** the mapping test that forbids inline keys SHALL cover it like every other read

#### Scenario: Sign-out destroys it
- **WHEN** a rider signs out
- **THEN** the cached recents SHALL be destroyed with the rest of the cache rather than invalidated
- **AND** the next rider on the device SHALL NOT be able to read them from anywhere

### Requirement: A mutation that moves a rider between two halves of one list SHALL invalidate the list itself, not the half

`getExploreClubs` returns one array assembled from two reads — the public `clubs` page and
`discoverable_private_clubs` — under **one** key, `queryKeys.clubs.explore(...)`. Every mutation
below SHALL claim that key by name, and SHALL NOT claim a narrower one on the reasoning that only
one half changed.

| Mutation | Claims |
|---|---|
| `requestToJoinClub(clubId)` | `clubs.explore(...)` — the card's control changes; and `clubs.joinRequests(clubId)` for the admin list |
| `withdrawJoinRequest(clubId)` | the same two |
| `approveClubJoinRequest(requestId)` | **`clubs.all()`** — the club moves from Explore to Your clubs, the roster gains a member, the detail's `viewer_role` changes, and the club picker on the create-ride and create-postcard forms gains an option; plus `postcards.feed(club:<id>)` and `rides.list(club:<id>)`, exactly as `invalidateClubMembership` already does; plus both notification keys |
| `declineClubJoinRequest(requestId)` | `clubs.explore(...)`, `clubs.joinRequests(clubId)` and both notification keys |

`approveClubJoinRequest` SHALL reuse `invalidateClubMembership` rather than enumerate club keys of
its own. An enumeration looks narrower and misses `clubs.mine()`, which is the picker nobody
remembers, and that is the recorded reason `joinClub` claims the whole `clubs` prefix.

#### Scenario: An approval reaches every club surface
- **WHEN** an approval succeeds
- **THEN** Your clubs, Explore, the club detail, the roster, the club picker, the club's postcard
  feed and the club's ride list SHALL all be invalidated
- **AND** the invalidation SHALL be justified against `keys.ts`'s stated prefix reach, not against
  intuition

#### Scenario: A request does not claim the membership keys
- **WHEN** a request is made or withdrawn
- **THEN** `postcards.feed(club:<id>)` and `rides.list(club:<id>)` SHALL NOT be invalidated, because
  no membership moved and nothing behind those keys can have changed

#### Scenario: The approving admin's own view moves too
- **WHEN** an admin approves from the club detail
- **THEN** the pending-request list, the roster and the member count SHALL all redraw from one call

### Requirement: A key SHALL NOT be added without a reader, and the preview key SHALL be separate from the detail key

`queryKeys.clubs.preview(clubId)` SHALL be its own key and SHALL NOT share
`queryKeys.clubs.detail(clubId)`. The two hold different shapes — a `ClubDetail` and a narrow
`ClubPreview` — and a shared key would serve whichever landed first to whichever screen asked
second.

`queryKeys.clubs.joinRequests(clubId)` SHALL sit under the club, so `clubs.detail(clubId)`'s prefix
reaches it and an approval that claims `clubs.all()` reaches it too.

No key SHALL be added for which no read exists. A key nothing fills is worse than none: it carries
an invalidation claim about an entry that never exists.

#### Scenario: The preview and the detail cannot serve each other
- **WHEN** a rider is approved into a club whose preview they had loaded
- **THEN** the detail read SHALL run fresh rather than being served the preview's narrower shape

#### Scenario: The prefix reach is documented positively
- **WHEN** the three new keys are added
- **THEN** `keys.ts`'s header SHALL state which prefixes reach each of them, stated positively, in
  the table that file already carries for exactly this purpose

### Requirement: A count and the list it summarises SHALL be read through the same predicate

Any badge showing an admin how many requests are pending SHALL be derived from the same read that
draws the list, in the same round trip — never from a separate `count` query.

`club_unread_counts()` SHALL NOT be extended to include join requests by this change, and the
omission SHALL be stated: a club's unread badge counts postcards and threads, and a pending request
is a different kind of thing addressed to a different subset of the club.

#### Scenario: The badge and the list agree by construction
- **WHEN** the request section renders
- **THEN** its count SHALL be the length of the array it renders
- **AND** there SHALL be no second query that could disagree with it one tap away

#### Scenario: The club badge is unchanged
- **WHEN** a request arrives for a club
- **THEN** `club_unread_counts()` SHALL return what it returns today
- **AND** the admin SHALL learn of the request through the notification list, which is the surface
  that already exists for events addressed to one rider

