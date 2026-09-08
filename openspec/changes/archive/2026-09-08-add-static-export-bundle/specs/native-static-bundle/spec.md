# native-static-bundle

## Purpose

What must hold of the fully-static bundle the native shell loads: what may be baked into a file
that ships on every device, what a prerendered document may contain, and how a route whose id
cannot be known at build time resolves without becoming an existence oracle.

Distinct from `client-render-shell`, which owns how a screen behaves once it is running, and from
`client-session-storage`, which owns the session. This capability owns the **artifact** — the
directory `npx cap sync` copies.

## ADDED Requirements

### Requirement: The bundle SHALL contain no rider data and no real resource id

Every file in the exported bundle SHALL be byte-identical for every rider, and SHALL NOT contain
any club name, ride title, postcard caption, comment, username, avatar path or signed Storage URL.
No real `clubs.id`, `rides.id` or `postcards.id` SHALL appear in the export, on any build, for any
reason. **"Every file" is the whole output tree and not only its HTML** — the export also emits
per-route RSC segment payloads, and those are the files the client router fetches on a navigation,
so a check scoped to `.html` inspects the documents while leaving the payloads unread.

The bundle is a file. It is installed on every device, it can be unzipped by anyone who has the
app, and it cannot be revoked. A real id in it discloses that a row existed on build day — which
is a disclosure about a *private* club to someone who was never a member, and about a rider's
postcard to someone they have blocked. The render model already makes this true, because every
dynamic page is `'use client'` and fetches in an effect; the requirement exists so that it stays
true when somebody later prerenders "just the public clubs" to make first paint faster.

#### Scenario: The bundle is the same for every role
- **WHEN** the bundle is built and inspected
- **THEN** the document emitted for a dynamic route SHALL be identical whatever rider, club, ride
  or postcard it might later display
- **AND** an owner, admin, member, non-member, blocked rider and signed-out visitor SHALL all
  receive the same bytes

#### Scenario: The check reads every emitted file
- **WHEN** the bundle is inspected for rider data or for a placeholder path
- **THEN** the check SHALL walk the whole output tree, including the router's payload files
- **AND** a check scoped to a single file extension SHALL be treated as not covering the bundle

#### Scenario: No real id is prerendered
- **WHEN** a build enumerates paths for a dynamic segment
- **THEN** it SHALL use a placeholder that names no row
- **AND** it SHALL NOT read the database, a fixture, a seed or a cached list to produce that
  enumeration

#### Scenario: A prerendered screen grants nothing
- **WHEN** a document for an owner-only route such as a club edit screen is present in the bundle
- **THEN** possession of that document SHALL confer no read and no write
- **AND** the screen SHALL render nothing to a rider whom RLS does not answer

### Requirement: The placeholder path SHALL NOT be reachable on the web deployment

A build that is not producing the native bundle SHALL prerender zero placeholder paths, and the
placeholder identifier SHALL NOT resolve to a usable screen on any deployed web origin.

Both long-lived branches auto-deploy from this repo and neither produces the bundle. An
unconditional placeholder would put a real, reachable, permanently-empty URL into production that
nothing asked for and nothing links to.

#### Scenario: The web build emits no placeholder
- **WHEN** the production or preview build runs without the native build flag
- **THEN** the parameter list for every dynamic segment SHALL be empty
- **AND** no emitted file SHALL carry the placeholder identifier in its path

#### Scenario: The placeholder id is a not-found, not an error
- **WHEN** any rider requests the placeholder identifier on a web origin
- **THEN** the screen SHALL render not-found, the same as for any other unusable id
- **AND** it SHALL NOT surface a database error, a PostgREST code or the failing relation

#### Scenario: A regression is detected by a test, not by a rider
- **WHEN** the flag is inverted, dropped, or leaks into a deployment target
- **THEN** an automated check SHALL fail
- **AND** the check SHALL assert both directions — that the empty case is empty *and* that the
  native case still produces a path — so that a guard which has silently stopped matching cannot
  pass

### Requirement: An unresolvable id SHALL be indistinguishable from a forbidden one

Any mechanism that maps a requested path onto a bundled document SHALL treat every identifier in a
dynamic segment identically, and SHALL NOT consult any list of real, known or permitted ids.

This is the same rule `client-render-shell` states for screens, applied one layer down. A shell
that serves a document for a club that exists and refuses one for a club that does not has
answered a question RLS spent an entire policy set refusing to answer, and it answers it before
any session is even read.

#### Scenario: The shell never learns which rows exist
- **WHEN** the shell resolves a path in a dynamic segment
- **THEN** it SHALL resolve on the shape of the path alone
- **AND** it SHALL NOT read the database, a manifest of ids, or any cached list

#### Scenario: A non-member deep-linking to a private club
- **WHEN** a non-member opens a link to a private club they cannot see
- **THEN** they SHALL reach the same unavailable screen a signed-in rider reaches for a club id
  that was never real
- **AND** neither the shell nor the screen SHALL reveal which of the two it was

#### Scenario: A blocked rider deep-linking to a ride
- **WHEN** a rider who is blocked by the organizer opens a link to that ride
- **THEN** they SHALL reach an ordinary unavailable screen
- **AND** nothing in the shell's routing SHALL indicate that a block is the reason, in either
  direction

### Requirement: The bundle SHALL be produced by a build the web deployment cannot accidentally run

The native build SHALL be selected by an explicit signal that is set in no deployment target, and
the web build's output SHALL be unaffected by the presence of that mechanism beyond effects that
are stated and verified.

A build carries what it was built with, permanently — both Supabase variables are already
build-time-inlined for the same reason. A native-shaped build reaching a web origin is a green
deploy of an app with no server behind its dynamic routes, which is the worst available failure
because every other signal looks healthy.

#### Scenario: The web build is unchanged in output
- **WHEN** the native build mechanism is added
- **THEN** the deployed web application SHALL behave identically for every rider
- **AND** any change to how the framework classifies or caches a route SHALL be measured, stated
  in the change, and reflected in whatever documented command previously measured it

#### Scenario: A route that becomes cacheable carries nothing per-viewer
- **WHEN** adding the mechanism reclassifies a route into one the deployment may hold
- **THEN** the held document SHALL contain no rider data and no per-viewer decision
- **AND** that SHALL be asserted for each affected route rather than inherited from the render
  model, because it ceases to be true the moment any of them reads during render

#### Scenario: A leaked build flag fails loudly
- **WHEN** the native build signal is present in a build intended for a web origin
- **THEN** an automated check SHALL fail before deployment
- **AND** the failure SHALL NOT depend on a human noticing a changed route table

### Requirement: A released bundle SHALL be built against the production backend, and that SHALL be asserted rather than assumed

The backend URL and key a bundle carries are fixed at build time and SHALL NOT be treated as
configurable afterwards. A bundle submitted to a store SHALL be built from the production branch
against the production project, and the identifier it carries SHALL be checked against the
production one before submission.

The web deployment already has this rule — a build permanently carries whichever database it was
built against, which is why a preview is never promoted. A bundle is the same rule with the escape
hatch removed: there is no promote, no redeploy and no environment variable that can move an
installed app, so the only correction is a new binary through a store review. The development
project also autoconfirms email addresses, so a development-built release additionally lets anyone
sign up with an address they do not control.

#### Scenario: The submitted bundle points at production
- **WHEN** a bundle is prepared for a store submission
- **THEN** the backend identifier embedded in its output SHALL be the production one
- **AND** the check SHALL read the built output rather than infer the answer from which branch the
  build ran on

#### Scenario: A non-production bundle never reaches a store
- **WHEN** a bundle is built for local testing or for a device check
- **THEN** it MAY point at the development project
- **AND** it SHALL NOT be submittable without failing the assertion above

### Requirement: URLs that leave the app SHALL NOT be derived from the runtime origin

Any URL that is shared, emailed or otherwise resolved outside the running application SHALL be
built from a configured canonical origin. The runtime origin SHALL be used only where the URL never
leaves the process.

Inside the shell the runtime origin is the webview's, not the product's. A link built from it is
dead the moment it is shared, and — the case that actually stops a rider — an authentication
redirect built from it points at an origin the auth provider's allowlist does not contain, so a new
rider can never confirm their signup and an existing one can never reset their password. This is
invisible on the web, where the runtime origin is the product's, and invisible in any check that
greps for hardcoded origins, because the value is computed rather than written.

#### Scenario: A shared link resolves for the recipient
- **WHEN** a rider shares content from inside the shell
- **THEN** the URL SHALL name the product's own origin
- **AND** it SHALL resolve for a recipient who is not on that device

#### Scenario: An authentication email lands somewhere real
- **WHEN** a rider signs up or requests a password reset from inside the shell
- **THEN** the redirect the provider is given SHALL be an origin on its allowlist
- **AND** a rider SHALL NOT be left holding a link to an address that only exists on their own
  device

#### Scenario: The web build is unaffected
- **WHEN** the canonical origin is introduced
- **THEN** the web build SHALL resolve it to the same value it uses today
- **AND** the change SHALL NOT require a deployment origin to be hardcoded in the application

### Requirement: The output directory the shell copies SHALL be the one the build writes

The directory named as the shell's web root SHALL be the directory the build actually produces,
and any change to one SHALL change the other in the same commit.

An empty web root is copied without complaint and fails at launch, on a device, as a white screen
with no error to read — which is the most expensive place in this epic to discover a one-word
mistake. The framework makes this easy to get wrong: setting a custom build directory silently
*becomes* the export directory and the conventional one is then never created at all.

#### Scenario: The two names agree
- **WHEN** the native build completes
- **THEN** the directory the shell is configured to copy SHALL exist and SHALL contain the
  application's entry document
- **AND** a build that produces no such directory SHALL be treated as a failed build rather than
  as a successful one with an empty result
