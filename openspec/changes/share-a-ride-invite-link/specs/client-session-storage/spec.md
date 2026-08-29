## MODIFIED Requirements

### Requirement: A signed-out visitor SHALL reach no data

A visitor with no session SHALL be able to load the shell and MUST NOT be able to read any
rider data, from the network or from a cache.

Decision #1 is unchanged: `anon` holds zero table grants and every route except `/auth/*` and
`/legal/*` requires a session. What changes is that a static bundle is served to anyone who
asks, so the shell itself is now public even though nothing in it is.

**A third public route joins them: `/rides/join`.** It is added to `PUBLIC_PATHS` deliberately —
the guard is a denylist, so this is the only opening this change makes — and it exists for one
reason: the page must mount in order to stash the token before the auth round trip. It is public
so it can *hold* a credential, never so it can *show* anything.

**Public SHALL NOT be read as exempt from decision #5.** The route is added to
`needsOnboardingState()` in the same change, so a signed-in rider mid-wizard is still sent to
their resume step from it. A route that is public *and* outside that set is one where the guard
never reads the onboarding stamps at all, which is how a rider ends up parked on a screen whose
only action the database refuses.

**The temptation this requirement exists to refuse is specific and it is a product one**: an
invite landing page that names the ride would convert better, and a rider who was sent the link
"already knows" what it is. Neither is a reason. Anyone can hold a URL, and the ride may be a
private club's; showing its title to an unauthenticated holder is exactly the anonymous read this
app does not have.

#### Scenario: The shell renders, the data does not
- **WHEN** a signed-out visitor loads any authenticated route
- **THEN** no rider data SHALL be rendered from any source, including a cache left by a
  previous session
- **AND** every request the shell makes SHALL be refused by RLS rather than filtered by the client

#### Scenario: No anonymous grant is introduced to make first paint faster
- **WHEN** a screen would benefit from data before the session is restored
- **THEN** the answer SHALL be to wait for the session, not to grant `anon` a read

#### Scenario: The invite landing route shows nothing without a session
- **WHEN** a signed-out visitor opens `/rides/join?token=<live token>`
- **THEN** the ride's title, departure, meeting point, organizer and crew count SHALL NOT be
  rendered
- **AND** neither `ride_invite_link_preview` nor `claim_ride_invite_link` SHALL be called
- **AND** the copy SHALL be generic enough that it is identical for a live token and a dead one,
  since the visitor's screen cannot tell them apart without asking the database

### Requirement: Sign-out SHALL destroy every local trace of the rider

Sign-out SHALL leave nothing on the device that identifies the rider or grants reach: no session,
no cached rows, no stamps, and **no capability token**.

A stashed invite token is a trace and a credential at once. It is not the signing-out rider's
property in any meaningful sense — it came from a message — but leaving it behind means the next
rider on that device inherits a spendable grant.

#### Scenario: A stashed invite token does not survive sign-out
- **WHEN** a rider signs out with `letsride.pendingInviteToken` set
- **THEN** the key SHALL be absent afterwards, alongside the session and the query cache

## ADDED Requirements

### Requirement: A capability token held on the device SHALL be tab-scoped and spendable only by an explicit action

A credential whose whole security is possession SHALL be held in `sessionStorage` and SHALL NOT be
held in `localStorage`, a cookie, IndexedDB or the query cache.

`sessionStorage` is the choice because it dies with the tab. A token in `localStorage` outlives
the browsing session, the rider's attention and their intent — on a shared machine it is a grant
sitting on someone else's device with an expiry only the server knows about.

**It SHALL be spent only from a user-initiated event handler.** No effect, no route-guard branch,
no `onAuthStateChange` listener and no session-restore path SHALL consume a stashed token.

This is the rule that makes the wrong-rider claim unreachable. Rider A opens a link, abandons
sign-up, and rider B signs in in the same tab: an automatic claim joins rider B to a private ride
they were never told about, writes their `ride_members` row and notifies the organizer with their
name. At the database layer that is a **valid** claim — the caller is authenticated, onboarded and
unblocked, and the token is live — so no policy, trigger or RLS assertion can distinguish it. Only
the client contract can.

The stash SHALL be a convenience and never the only copy. The URL is the durable credential, so a
lost stash SHALL always be recoverable by re-opening the original link, and no additional recovery
mechanism SHALL be built.

#### Scenario: The stash is tab-scoped
- **WHEN** a token is stashed and a second tab is opened to the app
- **THEN** the second tab SHALL NOT see it

#### Scenario: Nothing claims on session establishment
- **WHEN** a session appears by any route — sign-in, sign-up, email confirmation, token refresh,
  or restoring a session on load
- **THEN** no claim SHALL be issued, and the rider SHALL be shown the preview with a control to
  act on

#### Scenario: A different rider is not admitted silently
- **WHEN** a stash exists and a rider other than the one who opened the link signs in
- **THEN** they SHALL be joined to nothing until they tap, and the screen SHALL make clear whose
  ride they are being offered

#### Scenario: The stash survives onboarding
- **WHEN** a brand-new rider stashes a token and completes the onboarding wizard in the same tab
- **THEN** the token SHALL still be readable afterwards, since the participation gate makes
  claiming impossible until the wizard finishes
