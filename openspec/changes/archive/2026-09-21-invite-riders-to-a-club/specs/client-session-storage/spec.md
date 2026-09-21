# client-session-storage

## MODIFIED Requirements

### Requirement: Sign-out SHALL destroy every local trace of the rider

Sign-out SHALL leave nothing on the device that identifies the rider or grants reach: no session,
no cached rows, no stamps, and **no capability token**.

A stashed invite token is a trace and a credential at once. It is not the signing-out rider's
property in any meaningful sense — it came from a message — but leaving it behind means the next
rider on that device inherits a spendable grant.

**There are now two capability tokens of the same shape and they SHALL be cleared together.** The
ride invite token (`091`) and the club invite token both live in `sessionStorage`, both are 32
lowercase hex characters, and both are credentials as well as traces — possession is the whole grant.
One module SHALL own both keys, and `signOut` SHALL clear both by clearing that module rather than by
naming a key at the call site, because a second key named individually is a key the third one is
forgotten beside.

**`sessionStorage`, never `localStorage`**, for both: a credential whose security is possession must
not outlive its tab. On a shared device an abandoned sign-up would otherwise leave a live grant into
a private club sitting on somebody else's machine, with an expiry only the server knows about.

#### Scenario: A stashed invite token does not survive sign-out
- **WHEN** a rider signs out with `letsride.pendingInviteToken` set
- **THEN** the key SHALL be absent afterwards, alongside the session and the query cache

#### Scenario: The next rider sees nothing of the last one
- **WHEN** rider A signs out and rider B signs in on the same device
- **THEN** no cached row, list, image or signed URL belonging to A SHALL be readable or
  renderable by B
- **AND** this SHALL hold even with the device offline at the moment B signs in

#### Scenario: Cached private-club imagery does not outlive membership
- **WHEN** a rider leaves a club, or is signed out
- **THEN** cached image bytes for that club's postcards SHALL be discarded
- **AND** the one-hour signed-URL TTL SHALL NOT be lengthened to make caching easier, since the
  signature is the only protection on an image once it leaves RLS's reach

#### Scenario: A failed sign-out does not leave a half-signed-in device
- **WHEN** the token revocation call fails because the device is offline
- **THEN** local state SHALL still be destroyed and the rider SHALL still land signed out
- **AND** the still-valid refresh token SHALL be discarded rather than retried later

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
data, from the network or from a cache — **with exactly one exception, which SHALL be named here
rather than discovered in a migration.**

Decision #1 is narrowed by one function and otherwise unchanged: **`anon` holds zero table grants**,
no policy names `anon`, and every route except `/auth/*`, `/legal/*`, `/rides/join` and
`/clubs/join` requires a session. What changed when the shell became static is that a bundle is served to anyone who asks, so
the shell itself is public even though almost nothing in it is.

**The exception is `public.ride_invite_link_public_preview(t)`** (`115`, PD-430): EXECUTE on one
`security definer` function, reachable only by a 128-bit bearer token, returning the title, start
time, zone, meeting point and organiser username of exactly one ride. It exists because a stranger
tapping a shared invite link was being asked to create an account to find out what they were
invited to.

**Three properties bound it, and all three SHALL hold:**

1. **A credential, not a visibility class.** The function reads no `is_public` and lists nothing.
   Without a token there is no call to make and no ride to name — **a ride with `is_public = true`
   and no live link SHALL show a signed-out visitor nothing**, exactly as before this change, so
   `is_public` keeps meaning "visible to any signed-in rider".
2. **Strictly less than the token already buys, and checkable in one comparison.** Every column the
   anonymous function returns SHALL also be returned by `public.ride_invite_link_preview`, which
   `091` already grants to any holder of the same token *before* they claim anything — its gate is
   the participation stamps, not ride membership. The anonymous projection is a strict subset of a
   projection that already ships, so the exception discloses no fact to a stranger that the token
   did not already disclose to its holder. Claiming buys strictly more again: the crew, the thread
   and every message.
3. **No table, no policy, no write.** `has_table_privilege('anon', …, 'SELECT')` stays `false` for
   every table; no policy is added or widened; the function writes nothing, so an anonymous caller
   leaves no row anywhere and there is no personal data about them to retain. **The other side of
   that is an accepted cost, recorded rather than left to be found**: an anonymous read is
   attributable to nobody, where every authenticated use of a link writes a `ride_invites` row
   carrying its `link_id`. It is bounded by the link's expiry, the organiser's revoke and the
   token's entropy, and **no ledger SHALL be built to close it** — the only keys available are an IP
   address or a device fingerprint, each of which is personal data with its own retention window.

**The route that renders this exception SHALL declare `noindex, nofollow`.** Until now the
authenticated wall kept crawlers away from every route as a side effect; this change removes the
wall from one screen, so the property SHALL be restated as a requirement rather than inherited.

**Anything beyond those three is a new decision.** A second `anon`-executable function, a column
added to this one **that is not already in `public.ride_invite_link_preview`'s projection**, a
listing or search reachable without a token, or any grant to `anon` on a table SHALL be proposed on
its own terms and SHALL NOT be justified by citing this exception.

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

#### Scenario: The shell renders, the data does not
- **WHEN** a signed-out visitor loads any authenticated route
- **THEN** no rider data SHALL be rendered from any source, including a cache left by a previous
  session
- **AND** every request the shell makes SHALL be refused by RLS rather than filtered by the client

#### Scenario: No anonymous grant is introduced to make first paint faster
- **WHEN** a screen would benefit from data before the session is restored
- **THEN** the answer SHALL be to wait for the session, not to grant `anon` a read
- **AND** the invite-preview exception SHALL NOT be cited as precedent, because it is gated on a
  bearer token rather than on being early

#### Scenario: The exception is one function, checked per grantee
- **WHEN** the set of functions in `public` on which `anon` holds EXECUTE is enumerated
- **THEN** it SHALL contain exactly `ride_invite_link_public_preview`
- **AND** the enumeration SHALL be scoped to the `anon` grantee, because `postgres` and
  `service_role` hold everything by Supabase default

#### Scenario: A signed-out visitor with no token still reaches nothing
- **WHEN** a signed-out visitor loads `/rides/join` with no token, or any other route
- **THEN** no ride, club, rider or postcard SHALL be named, and no table SHALL return a row

#### Scenario: The cache does not leak between a stranger and a session
- **WHEN** a signed-out visitor previews a ride and then signs in as a different rider
- **THEN** the anonymous preview SHALL be held under its own cache key and SHALL NOT be served to the
  signed-in session, and sign-out SHALL clear it exactly as it clears every other cached read

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
