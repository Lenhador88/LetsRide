## MODIFIED Requirements

### Requirement: Permission-denied and empty SHALL be told apart where the rider can act on the difference

Where a rider could act differently on the two, the screen SHALL distinguish "there is nothing
here" from "you may not see this", and MUST NOT reveal which resources exist. **Content that has
been deleted is a third case and SHALL NOT be rendered as either of the first two**, and the
copy for it MUST NOT say that an account was deleted.

RLS returns zero rows for "there is nothing" and for "you may not see it". They are identical
from the client and always have been; client rendering does not create this, but it removes the
server-side vantage point from which a developer might have distinguished them.

**Account deletion turns a fourth cause of zero rows from exotic into routine.** A shared
postcard link, an open ride page, a byline tapped from a cached deck, a comment thread left open
— each can now resolve to nothing because the author left, rather than because the viewer is
forbidden or because the id was never real. The rule adopted is the one already settled for
private clubs, reveal nothing about existence, plus one addition in the other direction: the
copy says the content is *unavailable* and never that a rider was deleted, because naming the
deletion discloses something about a person to someone they may have blocked. "Unavailable" is
also what satisfies the repo's existing convention that a decided `null` is a not-found — the
screen may be a not-found screen, but its words may not be "you do not have permission" and may
not be "this account was deleted".

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

#### Scenario: Deleted content is unavailable, not forbidden and not named
- **WHEN** any signed-in rider opens a link to a postcard, ride, comment thread or profile whose
  owner has deleted their account
- **THEN** the screen SHALL say the content is unavailable
- **AND** it SHALL NOT say the rider lacks permission, which is a different and wrong
  explanation of the same zero rows
- **AND** it SHALL NOT say that an account was deleted, in copy, in a toast, or in a URL
  parameter

#### Scenario: The four causes are indistinguishable to every role
- **WHEN** a club owner, a club admin, a fellow member, a non-member, or a rider on either side
  of a block reaches the same missing resource
- **THEN** each SHALL see the same unavailable treatment
- **AND** no role SHALL be able to tell "never existed" from "deleted" from "withheld by a
  block" from "not permitted", because any difference between them is a disclosure

#### Scenario: The deck skips a card that has gone rather than blanking
- **WHEN** a card in a loaded deck refers to a postcard removed since the fetch
- **THEN** the deck SHALL skip it without leaving a blank position
- **AND** this SHALL hold given that the deck only moves forward, so a blank position cannot be
  returned to

### Requirement: Every screen SHALL define its offline behaviour

A read that fails for lack of connectivity SHALL be reported as offline rather than as a
generic error, and a write attempted offline MUST NOT be reported as succeeding. **An
irreversible destructive write SHALL be refused outright and MUST NOT be held**, which removes
the second of the two options this requirement otherwise offers.

Riders lose signal constantly; that is the premise of the whole native move. Today an offline
rider gets the browser's own failure page and the app never runs. In the shell, the app runs
and its reads fail.

**Account deletion is the first mutation for which "hold it explicitly" is the wrong answer.**
The choice between refusing and queuing was written for ordinary writes, where a held write is
a kindness. A queued account deletion executes minutes or hours later against a rider who has
moved on, cannot be recalled once it starts, and destroys other riders' view of a club in the
process. Narrowing the choice here — rather than in the deletion flow's own spec — is what stops
a future offline queue from sweeping deletion in along with everything else, since that work
will be specified against this requirement and not against the deletion flow.

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

#### Scenario: An irreversible destructive write is refused rather than held
- **WHEN** a rider confirms account deletion with no connectivity
- **THEN** it SHALL be refused with a plain message and SHALL NOT be queued, retried in the
  background, or marked pending
- **AND** this SHALL remain true after a durable offline queue exists, so the queue SHALL carry
  an explicit exclusion rather than inheriting the deletion by default

#### Scenario: A deletion interrupted mid-call is not resolved optimistically
- **WHEN** connectivity is lost after the destructive call was sent and before a response
  arrives
- **THEN** the screen SHALL report an indeterminate outcome and offer a retry, and SHALL NOT
  claim either success or failure
- **AND** the retry SHALL be safe, because the same call against an account that is already gone
  succeeds rather than erroring

### Requirement: The route guard SHALL be a UX affordance and SHALL NOT be relied on for access control

Every rule the guard enforces SHALL already be guaranteed in Postgres, and a rider who defeats
the guard MUST gain no read or write they did not already have. **A guard branch that becomes
reachable in production SHALL have its database counterpart asserted rather than assumed.**

`proxy.ts` is deleted; the decision is `src/lib/auth/guard.ts`, a pure function applied by
`src/components/auth/RouteGuard.tsx`. Anything it enforces that RLS does not also enforce is
unenforced. The audit found exactly one such thing — the onboarding gate — and
`database-enforced-integrity` carries the requirement that closed it, shipped as `023`.

**Account deletion makes the guard's `unavailable` branch reachable for the first time.** It was
written to survive a deploy mismatch, where a missing accessor answers an error; a deleted
account reaches it a different way, by the accessor returning zero rows for a caller with no
`profiles` row. The two must keep the same destination, and the reason is worth stating as a
requirement rather than as a comment: read as "not onboarded", zero rows sends the rider into
the consent prompt, where the own-row accessor has no row to update, returns NULL without
raising, and every submit fails with no exit. Redirecting is also not the whole answer — the
destruction of what the device is still holding belongs to `client-session-storage`, and this
requirement's job is only to say the guard must not be the thing relied on.

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

#### Scenario: A deleted account resolves to unavailable, never to un-onboarded
- **WHEN** the onboarding accessor returns zero rows because the caller's `profiles` row is gone
- **THEN** the guard SHALL treat it as unavailable and send the rider to the signed-out entry
  point, falling through on the two auth entry paths so it cannot redirect to itself
- **AND** it SHALL NOT be treated as an un-onboarded rider, which would route them into a wizard
  whose every submit fails

#### Scenario: Defeating the guard after a deletion still reaches nothing
- **WHEN** a rider holding an unexpired access token for a deleted account bypasses the guard
  and loads any authenticated route directly
- **THEN** every write SHALL be refused by the database, and every read SHALL return only what
  any signed-in rider could already read, for at most the token's remaining lifetime
- **AND** that window SHALL be stated with its bound rather than described as zero

#### Scenario: The public deletion page does not become a data route
- **WHEN** the web-accessible deletion page is added under the public prefix
- **THEN** it SHALL remain in the guard's denylist of public paths and SHALL read no table
- **AND** no other route SHALL be made public to support it, so the denylist grows by exactly
  one entry
