# client-render-shell Specification

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
The behaviour every screen must exhibit once it renders in the browser from a static bundle
rather than arriving complete from the server. Owns the per-screen state contract — empty,
loading, error, offline, permission-denied, partial, stale — and the route guard's demotion
from a security boundary to a UX affordance.
## Requirements
### Requirement: Every screen SHALL have a defined first-paint state

Every screen SHALL render a loading state distinct from its empty state, and MUST NOT show an
empty state at any point during a successful load.

Server rendering means a page arrives with its data or not at all. The repo has exactly one
error boundary (`src/app/(app)/error.tsx`) and **no `loading.tsx` anywhere**, because until now
there was nothing to show between navigation and data. Client rendering gives every one of the
23 routes a first paint with no data in hand.

The design does not settle this. `npm run figma -- ls` returns **zero** frames matching
`offline` or `error` out of 438, and the only two matching `empty` are archived
(`View my own profile empty`, `Edit empty bio`). This is a gap in the design, not a licence to
invent one screen at a time.

#### Scenario: A screen never renders its empty state while loading
- **WHEN** a screen mounts and its data has not yet arrived
- **THEN** it SHALL render a loading state distinct from its empty state
- **AND** "no postcards yet" SHALL NOT appear at any point during a successful load

#### Scenario: A repeat fetch does not blank the screen
- **WHEN** data is already on screen and a refetch is in flight
- **THEN** the existing content SHALL remain visible
- **AND** any pending indicator SHALL NOT displace content the rider is reading

#### Scenario: The loading treatment is one decision, not twenty-three
- **WHEN** loading states are built
- **THEN** they SHALL come from a single shared treatment applied per screen shape (deck, list,
  detail, form), so that a design answer arriving later is one change rather than twenty-three

### Requirement: A failed read SHALL be distinguishable from an empty result

`unwrap`/`unwrapList` already throw on a PostgREST error rather than returning `[]`, precisely
so that "the query failed" cannot render as "you have nothing". That property SHALL survive the
move to client rendering, where the throw no longer lands on a Next.js error boundary by
default.

#### Scenario: A failed query offers a retry
- **WHEN** any read fails
- **THEN** the screen SHALL say it could not load and SHALL offer a retry that re-runs only the
  failed read
- **AND** it SHALL NOT display the PostgREST code or the failing relation to the rider

#### Scenario: A partial failure costs only its own region
- **WHEN** one read on a screen fails and others succeed — a signed image URL, a comment count,
  a club roster
- **THEN** the successful regions SHALL still render
- **AND** the failed region SHALL show its own error rather than replacing the screen

### Requirement: Permission-denied and empty SHALL be told apart where the rider can act on the difference

Where a rider could act differently on the two, the screen SHALL distinguish "there is nothing
here" from "you may not see this", and MUST NOT reveal which resources exist.

RLS returns zero rows for "there is nothing" and for "you may not see it". They are identical
from the client and always have been; client rendering does not create this, but it removes the
server-side vantage point from which a developer might have distinguished them.

#### Scenario: A private club is not described as an empty one
- **WHEN** a non-member opens a private club by id and the club row is not returned
- **THEN** the screen SHALL say the club is unavailable rather than showing an empty timeline,
  members list or rides list
- **AND** it SHALL NOT reveal whether the club exists

#### Scenario: A blocked rider sees an ordinary absence
- **WHEN** a blocked rider reaches a screen whose content is withheld by the block
- **THEN** the screen SHALL present an ordinary empty or unavailable state
- **AND** it SHALL NOT indicate that a block is the reason, in either direction

#### Scenario: A malformed id is a not-found, not an error
- **WHEN** a URL segment is not a UUID
- **THEN** the screen SHALL render not-found, matching today's behaviour where
  `rideIdSchema`/`postcardIdSchema` turn a `22P02` into a 404

### Requirement: Every screen SHALL define its offline behaviour

A read that fails for lack of connectivity SHALL be reported as offline rather than as a
generic error, and a write attempted offline MUST NOT be reported as succeeding.

Riders lose signal constantly; that is the premise of the whole native move. Today an offline
rider gets the browser's own failure page and the app never runs. In the shell, the app runs
and its reads fail.

#### Scenario: Offline is reported as offline
- **WHEN** a read fails because the device has no connectivity
- **THEN** the screen SHALL say so specifically rather than showing the generic error state
- **AND** it SHALL retry automatically when connectivity returns, without the rider navigating

#### Scenario: A write attempted offline does not silently vanish
- **WHEN** a rider submits a mutation with no connectivity
- **THEN** the app SHALL either refuse it with a clear message or hold it explicitly
- **AND** it SHALL NOT report success for a write the database never received

#### Scenario: The queue is named as out of scope
- **WHEN** durable offline queuing is proposed
- **THEN** it SHALL be deferred to the follow-on this migration enables, and until it ships the
  refusal path above is the behaviour

### Requirement: The route guard SHALL be a UX affordance and SHALL NOT be relied on for access control

Every rule the guard enforces SHALL already be guaranteed in Postgres, and a rider who defeats
the guard MUST gain no read or write they did not already have. **The guard SHALL agree with the
router about what a pathname is**: any build option that changes the shape of the pathname the
router produces SHALL be accompanied by a matching change to how the guard matches it, in the same
change, with tests covering both shapes.

`proxy.ts` is deleted; the decision is `src/lib/auth/guard.ts`, a pure function applied by
`src/components/auth/RouteGuard.tsx`. Anything it enforces that RLS does not also enforce is
unenforced. The audit found exactly one such thing — the onboarding gate — and
`database-enforced-integrity` carries the requirement that closed it, shipped as `023`.

**The added clause is not hypothetical.** The guard's public-path list is exact-string matching,
and `RouteGuard` renders the splash *instead of* children for as long as it has a destination. A
build option that appends a trailing slash to every path makes `usePathname()` return a string the
list does not contain, while the router normalises the guard's own answer straight back to the
path it is already on — so the destination never clears, and the splash is permanent. Measured
2026-08-10 against a static export: a cold start at `/`, `/auth/login/` or `/onboarding/terms/`
never renders a login form or a consent prompt. Every one of the 36 guard cases passed, because
every one of them feeds a slashless path. That is the property this clause exists to catch: the
guard being *unusable* is not a state its own tests can currently reach, and no other gate in this
repo renders a screen.

#### Scenario: Every guard rule has a database counterpart
- **WHEN** the client guard redirects a rider
- **THEN** the same outcome SHALL already be guaranteed by RLS, a constraint or a trigger for
  every rule except pure navigation convenience
- **AND** a rider who defeats the guard SHALL gain no read or write they did not already have

#### Scenario: The public path list keeps its denylist shape
- **WHEN** the guard is reimplemented
- **THEN** it SHALL remain a denylist of public paths rather than an allowlist of protected
  ones, so a new route is guarded by default
- **AND** `/auth/reset-password` SHALL remain reachable with a live session, because a recovery
  link establishes one before the screen loads

#### Scenario: The onboarding resume position is still read from the database
- **WHEN** the guard decides where an incomplete rider resumes
- **THEN** it SHALL read `profiles.onboarding_completed_at`, never `user_metadata`, which the
  client can write

#### Scenario: The guard cannot be made to render its splash forever
- **WHEN** the guard resolves a destination and the router navigates to it
- **THEN** the pathname the guard next reads SHALL be one it can decide is a destination already
  reached
- **AND** no build option SHALL be adopted that leaves any public path, auth entry path or
  onboarding step permanently undecidable

#### Scenario: A path-shape change is tested in both shapes
- **WHEN** a build option changes the pathname shape the router produces
- **THEN** the guard's cases SHALL cover both shapes for every public path, both auth entry paths
  and every onboarding step
- **AND** a suite that passes only in the shape the app no longer uses SHALL be treated as
  untested rather than as green

### Requirement: Ride times SHALL render identically on every device

A ride SHALL show the same wall-clock string on every device, and the viewer's own time zone
MUST NOT be adopted as part of this migration.

`APP_TIME_ZONE` pins the three `formatRide*` helpers to `Europe/Amsterdam` because a server
component rendering in the viewer's zone is a hydration mismatch. Client rendering removes the
mismatch as a mechanism and leaves the underlying question — whose clock a ride is stated in —
open and now visible.

#### Scenario: The pin holds until a zone column exists
- **WHEN** a ride is rendered on a device in any time zone
- **THEN** it SHALL show the same wall-clock string as today
- **AND** the viewer's own zone SHALL NOT be adopted as part of this migration, because that is
  a product decision about what a departure time means, not a rendering one

#### Scenario: Writes stay consistent with reads
- **WHEN** a ride is created from the client
- **THEN** the zone-less `datetime-local` value SHALL be resolved as wall-clock in
  `APP_TIME_ZONE` exactly as `wallClockToUtc` does today, and SHALL NOT be resolved in the
  device's zone

### Requirement: A privacy control SHALL NOT render a guessed position

A control that states what the app does with a rider's data SHALL render its true position or no
position at all. It SHALL NOT paint a default while the real answer is in flight.

The standing rule — *gate a screen on its data, never on `isLoading`* — is the mechanism, and here
it has a consequence the ordinary screens do not: a toggle that flashes **on** before an
opted-out rider's preference resolves has told them something false about their own privacy, and
a rider who taps it in that window believes they have just opted out when they have opted **in**.
The two-tap race is the whole reason this requirement exists.

`undefined` is "not read yet"; `null` is the decided answer "not opted out". Conflating them is
what draws the guess.

**Every state, because a settings row has all of them:**

| State | Required behaviour |
|---|---|
| Empty | Does not occur. There is always an answer — a stamp or NULL — for any row that exists |
| Loading | The row renders with its label and a **disabled, position-less** control, or a skeleton. Never a toggle in a default position |
| Error | The accessor failed. The row says so and offers a retry. **No toggle is drawn**, and the analytics client stays capture-off |
| Offline | The write is refused with a message. The control SHALL NOT flip optimistically — an opt-out that appears to land and never does is the worst outcome this screen can produce |
| Permission denied | Cannot occur for a rider's own row; if the RPC answers `42501` or `PGRST202` — a deploy mismatch — it is the **error** state, never "not opted out" |
| Partial | Does not occur; one value, one call |
| Stale | The preference may have been changed on another device. The screen SHALL re-read on mount and SHALL invalidate its key on write, so the window is one navigation rather than one session |

#### Scenario: The toggle is not drawn before the preference is known
- **WHEN** the settings surface first paints and `my_analytics_opt_out()` has not answered
- **THEN** the control SHALL be disabled and SHALL show no on/off position
- **AND** a tap in that window SHALL do nothing rather than write the position it appeared to show

#### Scenario: A failed read is not drawn as an answer
- **WHEN** the preference read errors
- **THEN** the row SHALL show an error with a retry
- **AND** it SHALL NOT fall back to rendering "analytics on", which is both the wrong claim and the
  opposite of the capture-off posture the client is actually in

#### Scenario: Offline refuses rather than pretends
- **WHEN** a rider toggles the control with no connectivity
- **THEN** the control SHALL return to its stored position and the rider SHALL be told the change
  did not save
- **AND** no local-only "opted out" state SHALL be retained that the client then honours, because a
  preference that exists on one device and not in the database is exactly the durability this
  change was written to provide

### Requirement: The build-time prerender pass SHALL survive the removal of the runtime server

Removing the runtime server SHALL NOT be treated as removing the prerender pass. A component body
SHALL continue to execute once, at build time, in an environment with no session and no browser
storage, and the tripwire that fails the build when a read is issued from a component body SHALL
remain in place.

This is the rule most likely to be quietly repealed by a change whose whole subject is "there is no
server any more", and repealing it would reintroduce the exact failure the tripwire was built for:
a read issued during render runs as `anon`, `anon` holds zero grants, and the screen fails closed
and silently. Measured 2026-08-10: a fully-static export of this app ran the prerender pass over
every route and emitted 33 documents. What the export removes is the process that would have run
that pass again per request — not the pass.

#### Scenario: Reads stay out of render
- **WHEN** any screen is built for the static bundle
- **THEN** a read issued from a component body SHALL fail the build with a named error
- **AND** reads SHALL continue to be issued only from an effect or an event handler

#### Scenario: The rule is not relaxed by prose
- **WHEN** a change describes the app as having no server
- **THEN** it SHALL state that the prerender pass still runs
- **AND** it SHALL NOT be read as licence to relax the read-in-an-effect rule in any file, brief or
  spec

### Requirement: A decided-null SHALL render not-found identically in the bundle and on the web

A screen that resolves a decided `null` SHALL render the same not-found treatment whether it is
running from the static bundle or from the web deployment, and that treatment MUST NOT depend on
an HTTP status code.

There is no server in the bundle to send a 404, so "not found" is entirely a client-side render
into the nearest boundary. That already works, because these screens call it from a client
component today — but it means the *status code* is not part of the contract and nothing may start
depending on it. Two riders opening the same deleted ride, one in the app and one in a browser,
must see the same thing.

#### Scenario: A deleted resource looks the same in both
- **WHEN** a rider opens a ride, club or postcard that no longer exists
- **THEN** the screen SHALL render not-found
- **AND** it SHALL render the same content in the bundle as on the web

#### Scenario: Not-found is distinguishable from not-yet
- **WHEN** a detail screen has issued its read and has no answer
- **THEN** it SHALL render its loading treatment rather than not-found
- **AND** only a decided `null` SHALL reach not-found, so no load flashes a 404

#### Scenario: The not-found treatment is the product's, or the gap is recorded
- **WHEN** no application-owned not-found boundary exists
- **THEN** the framework's default SHALL be recognised as a stated gap rather than as a designed
  screen
- **AND** the gap SHALL be recorded where the next reader will find it rather than left to be
  discovered on a device

### Requirement: The wizard SHALL have exactly one resume target, and every path under `/onboarding` SHALL resolve to it

For a rider with a session, a consent stamp and no completion stamp, `resolveDestination` SHALL
resolve a single resume path, SHALL return `null` only for that path, and SHALL redirect **every
other** path under `/onboarding` to it — including paths the app no longer serves.

This is the case that strands a rider, and it is invisible to every gate in the repo. The guard's
onboarding branch today returns `null` — *stay here* — for `/onboarding/location` whenever
`has_username` is true. Delete that route and leave the branch as it is, and a rider who reaches
that URL after the deploy (a bookmark, a tab left open across the deploy, a native shell restoring
its last path, a browser back button) gets a 404 body **with the guard actively deciding they
belong there**. `tsc`, ESLint, Vitest, `next build` and the RLS suite all stay green through it,
which is the class of defect `CLAUDE.md` records the walk existing for.

Stating it as *"every other path redirects"* rather than *"`/onboarding/location` redirects"* is
the whole point: `isOnboarding` is `pathname.startsWith('/onboarding')`, so the rule covers the
next step this wizard gains or loses without anyone remembering to come back here.

The one-way stamp is what makes a single resume target safe. Completion is stored rather than
derived (`003` §3), so a rider who later clears their location in the profile editor is not thrown
back into a wizard — which was the original reason for storing it, and is why removing a step from
the wizard cannot re-gate anybody.

#### Scenario: A stale path under `/onboarding` redirects instead of rendering nothing
- **WHEN** a rider with a username and no completion stamp loads `/onboarding/location` after the
  route is deleted
- **THEN** the guard SHALL redirect them to the resume step
- **AND** this SHALL hold for any unknown path under `/onboarding`, not only the deleted one

#### Scenario: The resume target is the same for every incomplete rider
- **WHEN** the guard resolves a resume step for a rider with a consent stamp and no completion
  stamp
- **THEN** it SHALL be `/onboarding/username` whether or not they already have a username
- **AND** `/onboarding/terms` SHALL still redirect onward for a rider whose consent is already
  recorded, unchanged

#### Scenario: Consent is still gated ahead of the wizard
- **WHEN** a rider has no `terms_accepted_at`
- **THEN** they SHALL be sent to `/onboarding/terms` before any wizard step, unchanged, because
  `023` refuses to stamp completion while the consent stamp is NULL

#### Scenario: A completed rider is never sent back into the wizard
- **WHEN** a rider whose `onboarding_completed_at` is set loads any `/onboarding` path
- **THEN** they SHALL be redirected to `/postcards`, unchanged
- **AND** having a NULL `profiles.location` — whether never set, or cleared in the profile editor
  once this change makes that field optional — SHALL NOT change that answer, because completion is
  stored rather than derived (`003` §3)

#### Scenario: The unavailable and gone states are untouched
- **WHEN** `my_onboarding_state()` errors, or answers zero rows for a rider with no `profiles` row
- **THEN** the guard SHALL behave exactly as before — `/auth/login?error=profile_unavailable`,
  falling through on the two auth entry paths so it cannot redirect to itself for ever
- **AND** zero rows SHALL still NOT be read as "not onboarded"

### Requirement: A wizard step that commits a stamp SHALL be retry-safe from its own screen

Where a screen performs more than one write and the last one commits an onboarding stamp, a failure
of any write SHALL leave the rider on a screen from which resubmitting the same input completes the
job, with no state they must undo and no screen they must reach some other way.

The username step becomes the step that commits `onboarding_completed_at`, and it does so with two
round trips: a `profiles` UPDATE, then `complete_onboarding`. There is a window between them. The
window is acceptable **only because the recovery is the screen the rider is already on** — the
guard's resume target for a rider with a username and no stamp is `/onboarding/username`, and
resubmitting the same name updates their own row (no unique violation against itself; `038` permits
a rename and refuses only a removal) before re-running the RPC.

The alternative — one RPC that takes the username too — is rejected in `design.md` §D2: it moves
charset, reserved-name and `23505`-to-field-message handling into SQL, making a second copy of
rules that already live in `checkUsername` and `003` §4.

#### Scenario: The completion call fails after the username lands
- **WHEN** the `profiles` UPDATE succeeds and `complete_onboarding` then fails
- **THEN** the rider SHALL see an error on the username screen and SHALL remain un-onboarded
- **AND** resubmitting the same username SHALL succeed and complete onboarding
- **AND** the guard SHALL send them back to that same screen on any navigation in between

#### Scenario: Offline at the completing step
- **WHEN** the rider submits with no connectivity
- **THEN** the screen SHALL show a retryable error and SHALL NOT report success
- **AND** nothing SHALL be queued for later, because the participation gate makes a rider with no
  stamp unable to write anything the queue could hold

#### Scenario: The first-paint state of the wizard is unchanged
- **WHEN** the username screen loads
- **THEN** it SHALL render its form immediately with no data read of its own, unchanged — the
  screen has no query, so it has no empty, loading, partial or stale state
- **AND** the live availability check SHALL remain advisory, with its own unanswered state
  (`usernameCheckUnanswered`), unchanged

#### Scenario: Permission-denied is not reachable here and is not invented
- **WHEN** any read on this screen returns zero rows
- **THEN** it SHALL be treated as it is today; this change adds no read whose empty result could
  mean "not allowed", so no new empty-versus-denied distinction is introduced

### Requirement: A persistent overlay SHALL NOT permanently occlude content or an interactive element

A control that floats over a screen's scroll rather than reserving space beside it SHALL be defined
against the end of that scroll. Either the screen reserves clearance so nothing ends underneath the
control, or the control's occlusion is bounded so that no **interactive** element is permanently
unreachable. Which of the two a screen takes SHALL be a stated decision rather than a consequence of
its CSS.

A bar reserves its space and therefore cannot occlude anything; that property is what makes the
existing bottom bars safe, and it is what a floating control gives up. The trade is not free in the
direction usually assumed: derived with the same `16 pad + control + 8` rule the existing tokens
use, a 56px control reserves **80px** against the 64px `--navbar-action` bar it replaces, so a
screen that reserves clearance gains no vertical space at all — it gains horizontal space, because
the control spans a fraction of the width the bar did. The space the reserve-nothing option saves is
exactly the space the last row loses.

This is not a rule about floating buttons. It applies to any persistently-drawn overlay a screen
adds over its own scroll.

#### Scenario: The end of a scroll is reachable
- **WHEN** a rider scrolls a list to its last row on a screen carrying a persistent overlay
- **THEN** every interactive target in that row SHALL be reachable without the overlay covering it
- **AND** where clearance is reserved, the amount SHALL be derived from the overlay's own geometry
  rather than borrowed from a differently-sized control

#### Scenario: Clearance is reserved only when the overlay is drawn
- **WHEN** the overlay's gate is false, or still unresolved
- **THEN** the screen SHALL reserve no clearance for it
- **AND** the clearance SHALL be read from the same decision that draws the overlay, so the two
  cannot disagree

#### Scenario: Two overlays on one screen do not share a corner
- **WHEN** a screen can draw both a persistent overlay and a fixed bottom bar
- **THEN** the screen SHALL either draw at most one of them at a time, or offset the overlay by the
  bar's height
- **AND** where both are drawn, the overlay SHALL NOT cover a control the bar carries, including one
  that reaches the same corner because it spans the screen's width
- **AND** which of the two a screen takes SHALL be one decision the screen reads, never a condition
  restated at each control

#### Scenario: A composition that changes under the rider changes its clearance with it
- **WHEN** the rider's own write replaces one bottom control with another of a different height
- **THEN** the clearance the page reserves SHALL change in the same render as the control
- **AND** the change SHALL follow the read that confirmed the write, so a failed write moves neither

#### Scenario: An overlay does not paint over the navigation bar
- **WHEN** a persistent overlay is stacked
- **THEN** it SHALL sit below the navigation bar's layer, so the tabs stay reachable if the two ever
  overlap
- **AND** because a transformed ancestor becomes the containing block for a fixed descendant, the
  overlay SHALL be mounted where no ancestor transform can reparent it, and this SHALL be verified by
  rendering rather than by reading the markup

#### Scenario: The occlusion decision is recorded with its cost
- **WHEN** a screen chooses to let content run underneath a persistent overlay
- **THEN** the choice SHALL be recorded with what it costs — which rows are covered and whether any
  of them is interactive
- **AND** it SHALL NOT be inferred from the absence of a clearance class

### Requirement: A screen assembled from several independently-audienced reads SHALL define every state ONCE, for the whole screen

The club detail today makes six independent decisions about what a rider who cannot see a
section's rows is told, and two of them already refuse to lie — `ClubThreadsSection` renders
*"Join the club to read and start threads."* and `ClubPostcardCarousel` renders *"Postcards in
this club are for its members."* Merging those sections into one stream deletes the six
decisions and leaves one. It SHALL be made deliberately, for all seven states.

| State | Behaviour |
|---|---|
| Empty | **unreachable by construction** for a member: a brand-new club always holds its owner's `club_members` row and the club's own `created_at`, so the shortest stream is two entries. The screen SHALL therefore have no empty state and SHALL render the shortest stream under the club's own band, which reads as a beginning rather than as a failure |
| Loading | gate on the **data**, never on `isLoading` — `useQuery` starts its fetch in an effect, so the first render pass has no data *and* no fetch in flight. A skeleton stream, and the identity band and rides strip SHALL be allowed to paint ahead of it rather than being held behind one gate |
| Error | a failed timeline read SHALL show a retryable error **in place of the stream only**. It SHALL NOT take the club down: the identity band, the rides strip and the Members rail SHALL still render, the same call `ClubMemberRail` and `ClubThreadsSection` already make |
| Offline | the stream SHALL render from cache when there is one, unchanged and unmarked, and SHALL show the same retryable error as any failed read when there is not. Nothing here is queued: every entry is a record of something that already happened |
| Permission denied | **a refusal, never an empty stream.** For a non-member of a public club the reads SHALL NOT be issued at all, so the refusal is reachable without a round trip and is not an interpretation of an empty result. See the `club-timeline` capability |
| Partial | **the normal case, and the one that must not be silent.** One source failing SHALL NOT blank the stream; the stream SHALL render from the sources that answered **and SHALL be treated as saturated at that point**, so the coherence horizon truncates rather than the merge silently omitting a source's whole history |
| Stale | the stream is read on load and SHALL NOT subscribe. A write made from the create bar SHALL invalidate it — see the `client-cache-invalidation` delta |

#### Scenario: One failed source does not silently delete a kind of event
- **WHEN** the threads read fails and the other three answer
- **THEN** the stream SHALL render without thread entries
- **AND** the failed source SHALL be treated as saturated at the newest timestamp it could have
  returned, so the stream does not extend into a range it cannot vouch for
- **AND** the screen SHALL NOT claim the club has no threads

#### Scenario: The screen never renders `undefined` on first paint
- **WHEN** the first render pass runs, before the effect that starts the fetches
- **THEN** the screen SHALL render its skeleton, gated on the absence of data rather than on
  `isLoading`, which is `false` at that moment

#### Scenario: A failed stream does not take the club down
- **WHEN** every timeline read fails but `getClub` succeeded
- **THEN** the identity band, the upcoming-rides strip and the Members rail SHALL render
- **AND** a retryable error SHALL occupy the stream's place alone

### Requirement: Permission-denied SHALL NOT be rendered as a partial result when partial fidelity inverts the message

`client-render-shell` already requires that permission-denied and empty be told apart where the
rider can act on the difference. A merged stream adds a third case those two do not cover: a
result that is **neither** denied nor empty, but so partial that it asserts the opposite of what
is true.

A screen SHALL apply this test: **a partial view is honest when partial fidelity preserves the
message, and dishonest when it inverts it.** Where it inverts, the screen SHALL refuse rather
than render partially.

Worked both ways on the club detail, so the test is not abstract: a rides strip showing 2 of a
club's 5 rides still says *this club rides*, and stays; a stream showing 3 of 300 events says
*nothing happens here* about a busy club, and goes.

#### Scenario: The rule is applied per section, not per screen
- **WHEN** a non-member opens a public club
- **THEN** the upcoming-rides strip and the Members rail SHALL render, both being honest at
  partial fidelity
- **AND** the timeline SHALL be replaced by a refusal, being dishonest at partial fidelity
- **AND** the two decisions SHALL be reachable independently, so a later change to one does not
  silently move the other


### Requirement: A control's states SHALL be a function of its own inputs, and SHALL NOT be gated on an unrelated read

A control whose visibility is decided by its own data SHALL be mounted where that decision is the
only gate on it. It SHALL NOT be nested inside a branch belonging to a different read, so that its
seven states are not silently multiplied by another read's three.

`/clubs/explore` draws the location row above its list branch and `/rides/explore` draws it inside
the success branch, over identical inputs. The consequence is invisible in review and precise in
effect: a rider whose ride list is failing, or still loading, is not asked the question that would
fix the distances in that list — on one screen, and not on the other.

The general form matters more than the instance. A screen assembles several reads; nesting one
control under another's gate makes its state table the product of two, and only one of those tables
is ever written down.

**Every state, for this control:**

| State | Required behaviour |
|---|---|
| Empty | Not applicable to the row itself. Its "empty" is a settled `null` position with no town, which is a **visible** state — the question — rather than an absence |
| Loading | Any of the permission, the position or the town unsettled: the row draws **nothing**. Never a placeholder and never a skeleton — a 56px skeleton that resolves to nothing is a worse first paint than nothing |
| Error | The town or position read failed. The row draws nothing rather than asking the wrong question against a missing input, and the screen's own error state owns the message |
| Offline | The row may draw; both sheets refuse gracefully. The town write reports its failure and stores nothing, and the device request simply produces no fix. **No dismissal is recorded for a sheet the rider closed because the write failed** |
| Permission denied | Two different denials share this row and must not be conflated: the **OS** permission (`denied`) is a visible state with its own route, while an RLS refusal on the town read is indistinguishable from an empty answer at the client and is therefore treated as **unsettled**, drawing nothing |
| Partial | The position settled and the town did not, or the reverse. Nothing draws until both do, because the pair decides *which question* is asked |
| Stale | The town may have been changed on another device or on the profile screen in the same session. The row re-reads its keys on mount and its writer invalidates them, so the window is one navigation |

#### Scenario: The control renders on a screen whose list failed
- **WHEN** a screen's primary list read errors or is still in flight
- **THEN** a control gated only on its own inputs SHALL still render according to those inputs
- **AND** it SHALL NOT be mounted inside the list's success branch

#### Scenario: Two screens drawing one control agree on where it goes
- **WHEN** the same control is drawn by more than one screen
- **THEN** its placement relative to those screens' own gates SHALL be the same on each
- **AND** a difference SHALL be a stated decision rather than a consequence of where the JSX was
  pasted

#### Scenario: A control whose copy depends on an input waits for that input
- **WHEN** an input decides **which** of two messages a control shows, rather than decorating one
- **THEN** the control SHALL draw nothing until that input has settled
- **AND** the input SHALL be a required prop, so a caller that omits it renders nothing rather than
  the wrong message
