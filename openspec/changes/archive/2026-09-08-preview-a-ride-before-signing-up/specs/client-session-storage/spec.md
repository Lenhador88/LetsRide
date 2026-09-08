# client-session-storage

## MODIFIED Requirements

### Requirement: A signed-out visitor SHALL reach no data

A visitor with no session SHALL be able to load the shell and MUST NOT be able to read any rider
data, from the network or from a cache — **with exactly one exception, which SHALL be named here
rather than discovered in a migration.**

Decision #1 is narrowed by one function and otherwise unchanged: **`anon` holds zero table grants**,
no policy names `anon`, and every route except `/auth/*`, `/legal/*` and `/rides/join` requires a
session. What changed when the shell became static is that a bundle is served to anyone who asks, so
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
