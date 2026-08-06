## Purpose

The behaviour every screen must exhibit once it renders in the browser from a static bundle
rather than arriving complete from the server. Owns the per-screen state contract — empty,
loading, error, offline, permission-denied, partial, stale — and the route guard's demotion
from a security boundary to a UX affordance.

## ADDED Requirements

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
the guard MUST gain no read or write they did not already have.

`proxy.ts` becomes client-side. Anything it enforces that RLS does not also enforce becomes
unenforced. The audit found exactly one such thing — the onboarding gate — and
`database-enforced-integrity` carries the requirement that closes it.

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
