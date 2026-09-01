# client-session-storage

## MODIFIED Requirements

### Requirement: Sign-out SHALL destroy every local trace of the rider

Signing out SHALL discard the session, the query cache, cached images, cached signed URLs **and
every stashed capability token**, so that nothing belonging to the previous rider survives on the
device.

**There are now two capability tokens of the same shape and they SHALL be cleared together.** The
ride invite token (`091`) and the club invite token both live in `sessionStorage`, both are 32
lowercase hex characters, and both are credentials as well as traces — possession is the whole grant.
One module SHALL own both keys, and `signOut` SHALL clear both by clearing that module rather than by
naming a key at the call site, because a second key named individually is a key the third one is
forgotten beside.

**`sessionStorage`, never `localStorage`**, for both: a credential whose security is possession must
not outlive its tab. On a shared device an abandoned sign-up would otherwise leave a live grant into
a private club sitting on somebody else's machine, with an expiry only the server knows about.

#### Scenario: Sign-out clears both stashes
- **WHEN** a rider holding a stashed ride token and a stashed club token signs out
- **THEN** both SHALL be gone, asserted by reading the storage keys rather than by calling the
  accessors

#### Scenario: The next rider inherits no token
- **WHEN** rider A abandons an invite flow and rider B signs in on the same device
- **THEN** B SHALL hold no stashed token from A, and no automatic claim SHALL occur under any
  circumstance

#### Scenario: A stash that cannot be written is not an error
- **WHEN** `sessionStorage` throws — a Safari private window, a third-party-blocked iframe
- **THEN** the failure SHALL be silent and the rider SHALL simply re-tap their own message, because
  the URL is the durable copy and a public screen must not be taken down for a convenience

### Requirement: A signed-out visitor SHALL reach no data

A visitor with no session SHALL be able to load the shell and MUST NOT be able to read any rider
data, from the network or from a cache.

**There are now two public routes that exist to hold a credential rather than to show anything**, and
the rule for both is identical: `/rides/join` (`091`) and `/clubs/join`. Each is in `PUBLIC_PATHS`
**and** in `needsOnboardingState()`'s set — two edits, because the latter's first line is
`if (!isPublicPath(pathname)) return true` and one edit alone strands a newly signed-up rider on a
screen whose only button raises `check_violation`.

With no session, `/clubs/join` SHALL render the shell, a **generic** sentence and the auth buttons.
It SHALL name **neither the club nor its minter**, and SHALL call neither RPC — both need
`auth.uid()` for their block and participation checks, so there is nothing to render before a session
exists and nothing anonymous to leak.

**The temptation this refuses is a product one**: a landing page naming the club would convert
better, and "they were sent the link, they already know". Anyone can hold a URL, and the club is
private by construction — naming it is the one disclosure a bearer token must not make for free.

#### Scenario: Three tokens, one screen
- **WHEN** a signed-out visitor opens `/clubs/join` with a live token, with a dead one, and with none
- **THEN** all three SHALL render the identical screen and issue no request that names the club

#### Scenario: No `anon` grant is added to enrich it
- **WHEN** the landing screen would be more persuasive with the club's name
- **THEN** the answer SHALL be to wait for the session, never to grant `anon` a read or to add an
  `anon`-executable preview

#### Scenario: The token leaves the address bar but not the log
- **WHEN** the landing screen has read the token
- **THEN** it SHALL drop the query string with `history.replaceState`
- **AND** the specification SHALL still state that the token reached the server that served the page
  — a capability URL is logged by whatever serves it, which is why expiry and revoke are the
  controls rather than secrecy of transport
