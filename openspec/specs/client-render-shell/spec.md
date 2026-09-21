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

### Requirement: A surface backed by a third party SHALL distinguish refusal, exhaustion and outage from emptiness

The standing rules already separate *failed* from *empty*, and *offline* from *generic error*. A
metered third-party dependency adds two states neither of those covers, and both look exactly like
zero rows from the client:

- **This rider has been refused for now** — they have used their share, the app has not failed, and
  waiting fixes it.
- **The application has been refused for now** — nothing about this rider's behaviour is relevant, and
  waiting fixes it for reasons they cannot influence.

The two SHALL NOT be collapsed into each other, because one is a fact about the rider and the other is
not, and a message blaming a rider for the application's spending is a message they will act on
wrongly. The second SHALL be presented as unavailability.

Neither SHALL be presented as "nothing matched", which sends the rider to correct a spelling that was
already correct.

A screen carrying such a surface SHALL remain usable in every one of these states: the surface is an
accelerator on a form, and a form SHALL never be blocked by a third party's availability or by a
budget.

#### Scenario: Five zero-row causes render as five different screens
- **WHEN** the surface has nothing to show
- **THEN** it SHALL render the state matching the cause: below the minimum, searching, nothing matched,
  unavailable, or this rider has searched a lot just now
- **AND** the offline case SHALL be reported as offline, per the standing requirement, rather than as
  any of the other four

#### Scenario: The vendor is never named in an error a rider reads
- **WHEN** any of these states renders
- **THEN** it SHALL NOT contain a vendor name, a status code, a quota number, or a retry-after value
- **AND** it SHALL say what the rider can do instead, which is always "type it yourself" where the field
  accepts text

#### Scenario: The form outlives the surface
- **WHEN** the third-party surface is in any failure state
- **THEN** the form it sits on SHALL still submit
- **AND** everything already typed SHALL survive opening, failing and closing the surface

### Requirement: A newly-required form field SHALL refuse in the shape the form already refuses, and its pre-fill SHALL NOT manufacture an answer

Where a change makes an existing optional field required, the refusal SHALL use the mechanism that
form already uses for its other required fields, and any pre-fill SHALL leave the rider's answer
unmade until the rider makes it.

`CreateClubForm`'s location field is the case, and both halves have a wrong-looking-correct
alternative.

**The refusal is schema-and-focus, not a disabled submit.** The form's header records the disabled
submit as tried and reverted — *"a disabled submit here read as the resting state of an untouched
form and left the tab order early"* — on a form with six controls. The onboarding town step does the
opposite, correctly, because it has one control and one question. Two screens in one change doing
opposite things is only safe if the reason is written down.

**The pre-fill is a search term, never a value.** A rider's resolved position cannot become a pick:
`RiderLocation` is `{ lat, lon, source }` and a `PlaceValue` needs a `name` and a `placeId` too, so
any seeded *value* would be fabricated. Seeding the *term* on first focus keeps the rider's pick the
rider's, spends no metered credit for a rider who never touches the field, and never displays text a
submit would not store.

#### Scenario: Submitting with no location
- **WHEN** the rider submits the create-club form having picked no place
- **THEN** the action SHALL refuse before any write, with the message **"Pick where your club is
  based."**, and no `clubs` row SHALL be inserted
- **AND** the submit button SHALL NOT have been disabled — it stays gated on `busy` alone, as it is
  today
- **AND** focus SHALL move to the **visible search input**, which requires the form to reach past the
  hidden `location_name` field; a refusal whose focus move silently does nothing SHALL be treated as
  a defect rather than as acceptable

#### Scenario: A place typed and never picked
- **WHEN** the rider types a place name, does not choose a suggestion, and submits
- **THEN** the submit SHALL be refused with the same message, and nothing SHALL be stored
- **AND** the four hidden fields SHALL be empty, because in place mode they read through the pick and
  the visible input carries no `name`
- **AND** the typed draft SHALL revert on blur, so the rider is never shown a location a submit would
  not store

#### Scenario: A partial set of hidden fields
- **WHEN** fewer than all four of `location_name`, `location_place_id`, `latitude` and `longitude`
  arrive
- **THEN** `readClubLocation` SHALL return `null` — not a partial object and not an error — and the
  create gate SHALL then refuse it with the same message
- **AND** the emptiness test SHALL stay on the **string**, never on the parsed number, because
  `Number('')` is `0` and `0` is a real coordinate
- **AND** the new gate SHALL NOT be implemented as a truthiness test on a coordinate, which would
  refuse a genuine club on the equator or the prime meridian

#### Scenario: The pre-fill when the rider has a town
- **WHEN** the rider's `profiles.location` holds a town and they focus the location field for the
  first time
- **THEN** that town SHALL become the input's text and the lookup's term, and the suggestion list
  SHALL open on real results the rider can pick from
- **AND** no lookup SHALL have been performed before that focus, because a lookup spends a metered
  credit whose ledger row is written before the vendor is called
- **AND** the rider SHALL still have to pick; no value SHALL be selected on their behalf

#### Scenario: The pre-fill when there is nothing to seed
- **WHEN** the rider has no `profiles.location`, or the read has not settled, or they have declined
  device location
- **THEN** the field SHALL behave exactly as it does today — empty, no seed, no lookup — and the form
  SHALL be fully usable
- **AND** the pre-fill SHALL NOT fall back to a device fix, SHALL NOT raise an OS permission prompt,
  and SHALL NOT perform an IP lookup

#### Scenario: The seed never becomes a stored answer
- **WHEN** a rider focuses the field, sees the seeded term, and blurs without picking
- **THEN** the field SHALL be empty, because the draft is dropped on blur — which is the truth about
  their answer rather than a loss of one
- **AND** the submit SHALL be refused if they then submit, exactly as if they had never focused it

#### Scenario: Editing a club is untouched
- **WHEN** a club owner edits a club that carries no location, changing only its name
- **THEN** the edit SHALL succeed, no location SHALL be required, and the field SHALL carry no
  refusal
- **AND** an owner adding a location on edit SHALL still be able to, through the same field and the
  same four names

### Requirement: A screen for a resource the reader may not read SHALL be a separate render branch, not the full screen with every section empty

Where a route can be reached by a reader whose row security refuses most of what the route draws,
the route SHALL render a **distinct branch** that issues only the reads that can succeed, rather
than the full screen with each gated section falling to its empty state.

The reason is `client-render-shell`'s own standing requirement that permission-denied and empty be
told apart: a full screen with four empty sections asserts four false facts about the resource —
that it has no rides, no postcards, no threads and, by the roster's absence, no members — each of
which the reader is in no position to know.

The branch SHALL be selected on a **decided** answer, never on a falsy one. `null` from the primary
read is decided; `undefined` is "not yet".

#### Scenario: The private club preview renders no query that can return zero rows
- **WHEN** a rider who is not a member reaches a private club's detail route
- **THEN** the screen SHALL issue exactly two reads — the ordinary club read, which decides `null`,
  and the preview accessor — and no others
- **AND** `getClubFeed`, `getClubMembers`, `getRides` and the threads read SHALL NOT be called at all

#### Scenario: The 404 still exists and is still indistinguishable
- **WHEN** the id names no club, or a private club the reader may not discover
- **THEN** **both** reads SHALL answer `null` and the route SHALL `notFound()`
- **AND** a nonexistent club and an undiscoverable one SHALL reach the same screen, per decision #1

#### Scenario: Neither read's `undefined` triggers a 404
- **WHEN** either read is still in flight
- **THEN** the route SHALL render its skeleton and SHALL NOT call `notFound()`
- **AND** the preview read SHALL be disabled entirely until the primary read has decided, so it is
  never issued for a club the reader can see

#### Scenario: The branch states why it is empty
- **WHEN** the preview branch renders
- **THEN** it SHALL carry one sentence naming the club's privacy as the reason
- **AND** it SHALL NOT render any existing empty-state string, including "This club has not
  ridden, yet!" and "This club has not written a description, yet!"

#### Scenario: Membership-gated affordances are absent, not disabled
- **WHEN** the preview branch renders
- **THEN** the create-ride row, the add-postcard tile, the thread composer, the options menu and
  every `See all` SHALL be **absent**
- **AND** the reason SHALL be this screen's own recorded rule: a control that always fails RLS is
  worse than no control

#### Scenario: `viewer_role` gains no third value
- **WHEN** the two branches are compared
- **THEN** `isMember` SHALL be computed only on the full branch, from a real `ClubDetail`
- **AND** no existing gate on it SHALL change meaning

#### Scenario: The header works on both branches
- **WHEN** the preview branch renders its header
- **THEN** the club's name SHALL be shown from the preview and the avatar SHALL fall back to
  initials
- **AND** back SHALL return to the list the rider came from, as it does on the full branch

### Requirement: A list assembled from two reads SHALL NOT present one of them as the whole answer when the other fails

Where a screen merges two independent reads into one list, a failure of either SHALL be visible.
Rendering the surviving half alone is indistinguishable, to the rider, from there being nothing
more to find.

#### Scenario: The private half fails
- **WHEN** `discoverable_private_clubs` errors and the public page succeeds
- **THEN** the screen SHALL surface the failure with a retry rather than render the public clubs as
  a complete list

#### Scenario: The public half fails
- **WHEN** the reverse happens
- **THEN** the same rule SHALL apply

#### Scenario: The strip's claim stays true
- **WHEN** `ExploreClubsStrip` draws its `near <place>` clause
- **THEN** it SHALL be derived from the same merged array `/clubs/explore` renders under the same
  key, so the row and its destination cannot disagree — the property PD-258 and PD-254 both cost a
  defect to establish

#### Scenario: An unknown request status draws no control
- **WHEN** the per-rider request-status read has not resolved, or failed
- **THEN** the private card SHALL draw **no** trailing control, rather than `Request to join`
- **AND** the reason SHALL be that offering a control which turns out to be a duplicate is a
  promise the database will refuse with `23505`

### Requirement: A screen whose entire content is destructive controls SHALL define every state, and its permission-denied state SHALL be a refusal rather than an empty list

Manage riders SHALL define all seven states, and two of them differ from every other screen in this
app because the screen has no read-only value at all.

| State | Behaviour |
|---|---|
| Empty | a club with one member is the **normal** state, not an edge case. The roster draws the owner alone with no controls on them, and the requests section is **absent** rather than empty — `085`'s rule, because "no requests" on every club detail an admin opens is noise |
| Loading | gate on the **data**, never on `isLoading`: `useQuery` starts its fetch in an effect, so the first render pass has no data and no fetch in flight. A skeleton roster, not a spinner over a blank screen |
| Error | the roster read failing SHALL show a retryable error, **not** an empty roster — an empty roster on a management screen reads as "this club has nobody in it", which is a statement the screen has not verified |
| Offline | every control SHALL be disabled, never queued. Removing a rider is a promise to the rest of the club and the three RPCs are not writes to be optimistic about — `ClubJoinRequestsSection`'s existing rule, extended |
| Permission denied | A **redirect to the club**, with a banner stating the RULE and never a change — the screen knows *you may not manage this* and not *you used to*, and the same state is reached by a member following a shared link and by a rider whose cache predates their own promotion. Never an empty or read-only screen — a *Manage riders* whose every control refuses is PD-125's unreachable screen arriving from the other side. Not `notFound()`: reaching this screen means `getClub` returned a club, so the reader can already see it and the "no such club, or not one you may see" conflation has nothing left to protect |
| Partial | the roster resolving while the requests read fails SHALL render the roster and omit the requests section, matching `085`'s existing behaviour — a failed additive read draws nothing rather than an error over a screen that already rendered |
| Stale | after any successful mutation the roster, the club detail and the requests list SHALL be invalidated together; see the `client-cache-invalidation` delta |

#### Scenario: Denied is not empty
- **WHEN** an ordinary member navigates directly to the route
- **THEN** the screen SHALL not render, and the rider SHALL NOT be shown a roster with inert
  controls or an empty list
- **AND** the RPCs SHALL refuse independently, so the client gate can be wrong without the boundary
  being wrong

#### Scenario: A one-member club renders correctly rather than emptily
- **WHEN** the club has only its owner
- **THEN** the roster SHALL draw that one row with no destructive control on it, and the requests
  section SHALL be absent

#### Scenario: The screen never renders `undefined` on first paint
- **WHEN** the first render pass runs, before the effect that starts the fetch
- **THEN** the screen SHALL render its skeleton, gated on the absence of data rather than on
  `isLoading`, which is `false` at that moment

### Requirement: A destructive control SHALL name what it actually does, including when what it does is reversible

Removal SHALL be confirmed, and the confirmation SHALL state the outcome honestly rather than
implying permanence it does not have.

On a **public** club the removed rider rejoins in one tap through the existing INSERT policy, and the
confirmation SHALL say so in one clause. On a **private** club they must request again and an admin
must answer, and the confirmation SHALL NOT carry the public clause.

The confirmation SHALL NOT claim the rider is told, because they are not, and SHALL NOT claim their
content is removed, because it is not: their postcards, threads and messages stay in the club and
stay visible to it.

#### Scenario: The public and private copy differ
- **WHEN** the confirmation is shown for a public club and for a private one
- **THEN** only the public one SHALL say the rider can join again at any time

#### Scenario: The confirmation does not overstate the blast radius
- **WHEN** the confirmation is read
- **THEN** it SHALL NOT say or imply that the rider's postcards, threads or messages are removed,
  and SHALL NOT say the rider will be notified

### Requirement: A notification row whose subject cannot be reached by its ordinary embed SHALL still render completely or not at all

The `club_join_request_declined` row's `club:clubs(...)` embed returns null by construction — the
reader is not a member — so the row SHALL resolve its club through
`public.discoverable_private_clubs` before rendering, and SHALL degrade to the drawn fallback
("A club") rather than to a blank name or an id if that resolution fails.

The row SHALL take its destination from the notification's own `club_id` **column**, which the
client already holds SELECT on, rather than from the embed.

#### Scenario: The name is resolved, not left empty
- **WHEN** a decline row is rendered
- **THEN** the club's name SHALL be drawn from the accessor
- **AND** if the accessor returns nothing the row SHALL still render, with the fallback string and
  a working destination

#### Scenario: The list does not crash on a type it does not know
- **WHEN** any future notification type reaches a bundle whose `switch` has no arm for it
- **THEN** the failure mode SHALL be recorded rather than assumed benign: `describe` returns
  `undefined` today and the destructuring throws, taking the whole list down — which is why `089`
  applies **after** the build serves, and which SHALL be re-checked before any later type is added

### Requirement: A decoration on a list SHALL NOT gate the list, and its failure SHALL cost marks rather than rows

Where a screen enriches rows it has already fetched with a second, smaller read — a wave count, an
unread map, a like state — the enrichment SHALL be a decoration and SHALL NOT become a
prerequisite:

| State | Behaviour |
|---|---|
| Empty | zero decorations render as **absence**, never as `0`. A row of zeroes on every entry is noise that makes the first real value harder to see |
| Loading | the rows render immediately with the decoration's control disabled and no value. The list SHALL NOT be gated on the decoration read, nor on `isLoading` |
| Error | **marks, not rows** — the rows render undecorated and no error state is shown for the list. `getClubThreadUnread`'s existing behaviour of resolving to `{}` is the model |
| Offline | the decoration renders from cache when there is one and is absent when there is not. A **write** to it SHALL NOT be queued: a reaction is an expression at a moment, and replaying it on reconnect makes the app act for the rider later, possibly after they have blocked its subject |
| Permission denied | the control SHALL be **absent**, not disabled and not erroring. The write policy's predicate is the read policy's, so a row the rider can see is one they can act on and the case is empty by construction. A refusal SHALL NOT be rendered as a message naming a block |
| Partial | one decoration read failing SHALL NOT affect another. Two kinds of subject decorate independently |
| Stale | read on load, no subscription. The rider's own toggle is optimistic and locally authoritative until the write answers; another rider's arrives on the next load |

#### Scenario: A failed decoration read never blanks the list
- **WHEN** the decoration read errors and the list read succeeded
- **THEN** every row SHALL render
- **AND** no error state, retry affordance or skeleton SHALL replace the list

#### Scenario: The list is not gated on the decoration
- **WHEN** the list read has resolved and the decoration read has not
- **THEN** the rows SHALL be on screen
- **AND** the decoration's control SHALL be present and disabled rather than absent, so the row's
  height does not change when the value arrives

#### Scenario: A zero decoration draws nothing
- **WHEN** a row has no reactions
- **THEN** no numeral SHALL be drawn
- **AND** the arrival of the first one SHALL NOT shift the controls beside it under a rider's thumb

### Requirement: An optimistic control SHALL state what it is, and SHALL NOT be queued when the write fails

A two-state reaction toggle SHALL follow `LikeButton`'s established rules rather than being
re-derived:

- **`aria-pressed` is the non-visual signal**, and the accessible name is therefore **constant** —
  it states what the control is, never what the next tap does. A control that both reports
  `pressed` and renames itself to the undo action announces "Unwave, 5 waves, pressed": a control
  named for undoing, reported as done.
- **A refused write rolls the local state back and surfaces its message without reflowing the
  row**, so a failed tap cannot move the controls beside it.
- **Nothing is retried or queued.**

Where the same behaviour is now needed on more than one surface it SHALL be **extracted**, not
copied. Two optimistic toggles with two copies of the rollback and the `aria-pressed` rule is two
places for the accessibility rule to be dropped from, and the second copy is always the one written
in a hurry.

#### Scenario: The accessible name does not flip
- **WHEN** a rider waves and un-waves
- **THEN** the control's accessible name SHALL be unchanged in both states
- **AND** `aria-pressed` SHALL be the only thing that moves

#### Scenario: A refused write does not move the row
- **WHEN** a wave write is refused
- **THEN** the toggle SHALL revert and a message SHALL appear without changing the row's height
- **AND** no retry SHALL be scheduled

#### Scenario: The toggle exists once
- **WHEN** the change is complete
- **THEN** the postcard's and the timeline's toggles SHALL share one implementation
- **AND** the rollback and `aria-pressed` rules SHALL exist in exactly one place

