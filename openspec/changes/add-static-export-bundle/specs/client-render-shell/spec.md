## MODIFIED Requirements

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

## ADDED Requirements

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
