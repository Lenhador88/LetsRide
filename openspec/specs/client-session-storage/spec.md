# client-session-storage Specification

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
How a rider's session is held, proved and discarded once there is no server to set an httpOnly
cookie. Covers the move to device secure storage, the replacement for the password-recovery
marker, and what sign-out must destroy on a device two people share.
## Requirements
### Requirement: Session tokens SHALL be held in device secure storage

The session lives in a storage adapter passed to `@supabase/supabase-js`
(`src/lib/supabase/session-store.ts`). It SHALL be the platform secure store — Keychain on iOS,
the Android Keystore-backed store — and SHALL NOT be `localStorage`, `sessionStorage` or
IndexedDB.

**KNOWN GAP, deliberate and open: this requirement is not met today.** The store resolves to
`window.__letsrideSecureStore` when a native shell provides it and falls back to `localStorage`
otherwise — and there is no native shell yet, so the fallback is what every rider gets. The
seam and its test exist (`session-store.test.ts` asserts that when a secure store is present
**nothing** lands in `localStorage`); the implementation behind the seam is the `native` agent's
work. Recorded as a gap rather than quietly relaxing the requirement.

The publishable key is not what changes here — it already ships in the bundle and is designed
to. The refresh token is the thing to protect, and note it is **not** newly exposed:
`@supabase/ssr` set its cookie with `httpOnly=false` because the browser client had to read the
session back out of `document.cookie`. Measured with a real sign-in. What moved is the store.

#### Scenario: The token is not in web storage
- **WHEN** the app is running in the native shell
- **THEN** no session, access token or refresh token SHALL be retrievable from
  `localStorage`, `sessionStorage` or a cookie

#### Scenario: Web builds are honest about the weaker guarantee
- **WHEN** the same bundle runs in a plain browser, where no secure store exists
- **THEN** the fallback SHALL be stated as a known weakening rather than presented as
  equivalent, and the browser build SHALL NOT be offered as the recommended way to use the app

#### Scenario: Injected script cannot be treated as survivable
- **WHEN** any third-party script, `dangerouslySetInnerHTML`, remote font, analytics tag or
  untrusted iframe is proposed for the authenticated tree
- **THEN** it SHALL be refused, because with a JS-readable refresh token, script injection is
  account takeover rather than a nuisance
- **AND** the webview SHALL apply a content security policy that permits only the app's own
  origin and the Supabase project origin

### Requirement: A password reset SHALL require proof of the emailed link

Setting a new password SHALL require a grant that only following a recovery link can produce,
and that grant MUST NOT be forgeable by the client.

It exists because a recovery link yields an *ordinary* session: without a grant, anyone already
holding one — a borrowed phone, a shared laptop — could set a new password without knowing the
current one.

**The mechanism changed during implementation and the spec's original one is gone.** The
proposal described an `lr-recovery` httpOnly cookie set by `/auth/callback` after a code
exchange; that cookie and that Route Handler both died with the server render, exactly as this
paragraph predicted they would. The shipped grant is `026`'s check of Supabase's own `amr`
claim, verified in Postgres (`src/lib/auth/recovery.ts`) — which is stronger, because it is not
forgeable by a client that owns its own storage, and a cookie set by JavaScript would have been.

**Its real closure is still an owner action:** GoTrue's `PUT /auth/v1/user` accepts a password
change from any live session, measured, so `026` gates the app's front door and
`UpdatePasswordRequireCurrentPassword` in the Supabase dashboard is what shuts the back one.

#### Scenario: An ordinary session cannot change the password
- **WHEN** a rider with a normal signed-in session opens the reset screen directly
- **THEN** the password change SHALL be refused

#### Scenario: The recovery grant is spent by use
- **WHEN** a rider follows a recovery link and completes the reset
- **THEN** a second attempt on the same grant SHALL be refused
- **AND** the grant SHALL expire on its own within fifteen minutes, matching today's cookie

#### Scenario: The marker is not client-writable
- **WHEN** the marker is reimplemented for the native shell
- **THEN** it SHALL NOT be a value the client can set for itself; a flag in device storage that
  the app writes after seeing a recovery link is not a control, it is a comment

### Requirement: Sign-out SHALL destroy every local trace of the rider

Sign-out SHALL leave nothing on the device that identifies the rider or grants reach: no session,
no cached rows, no stamps, and **no capability token**.

A stashed invite token is a trace and a credential at once. It is not the signing-out rider's
property in any meaningful sense — it came from a message — but leaving it behind means the next
rider on that device inherits a spendable grant.

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

### Requirement: An analytics identity SHALL NOT outlive the session that created it

Sign-out already destroys every local trace of the rider — the query cache, the guard cache, the
session store and the cached rider location all clear. An analytics SDK holds a **fifth** trace and
it is the one nobody thinks of: a distinct id, an opted-in posture, and in PostHog's case an active
session recording.

On sign-out the analytics client SHALL reset its identity and return to the capture-off posture, in
the same path as the other four. On sign-in it SHALL start capture-off again and re-read the
preference for the rider who just arrived, rather than inheriting whatever the previous rider left.

**The failure this prevents is a shared device**, which is not hypothetical for a pilot: rider A
opts out and signs out, rider B signs in on the same phone. Without a reset, B's screen is recorded
against A's distinct id if A was capturing, or B is silently under-captured if A was not. The
second is merely wrong; the first records a rider who never had a chance to say no, under somebody
else's name.

**The two directions fail differently and both are covered on purpose.** Reset-on-sign-out alone
leaves the sign-in path trusting whatever the SDK persisted client-side, which a fresh install does
not have and a shared device has wrongly.

#### Scenario: Sign-out clears the analytics identity
- **WHEN** a rider signs out
- **THEN** the analytics client SHALL reset — dropping the distinct id and any in-flight recording —
  and SHALL stop capturing
- **AND** this SHALL happen in the same place as `clearQueryCache`, `clearGuardCache`,
  `clearSessionStore` and `clearRiderLocation`, so a future sign-out path cannot forget one of five
  while remembering four

#### Scenario: A second rider on one device inherits nothing
- **GIVEN** rider A signed out on a device where analytics was capturing
- **WHEN** rider B signs in on the same device
- **THEN** the client SHALL be capture-off until B's own `my_analytics_opt_out()` returns NULL
- **AND** no event attributed to B SHALL carry A's distinct id

#### Scenario: The reset is asserted where it can actually be seen
- **WHEN** this requirement is tested
- **THEN** it SHALL be asserted in Vitest against the analytics seam — sign-out calls reset, and a
  `capture` after it is a no-op — because `npm run walk` runs against DEV, DEV has no PostHog key,
  and a walk assertion that "nothing was left behind" would pass on a device where nothing could
  ever have been written
- **AND** the walk's existing sign-out phase SHALL NOT be extended with an assertion that is
  vacuous by construction, which is the trap a flag defaulting off already set once


### Requirement: A device-local deferral record SHALL hold no rider data, SHALL fail open, and SHALL NOT survive sign-out

A record kept on the device to postpone a question SHALL contain only what postponing needs — a
timestamp and a count. It SHALL NOT hold a town, a coordinate, a rider id, an email or any other
value belonging to the rider. It SHALL be removed at sign-out. Every read and every write SHALL fail
in the direction that **asks again**.

The three properties are one requirement because each defeats a different failure:

- **No rider data**, because a device-local copy of a profile field outlives the session that wrote
  it and is readable by the next rider on the phone, in plain text, with no policy over it.
- **Cleared at sign-out**, because a boolean that outlived a rider was nearly harmless while it meant
  "the one automatic ask was spent" and is not harmless once it means *"this device answered, do not
  ask for up to six months"*. Rider B on a shared phone inherits rider A's silence and is never asked
  about their own town.
- **Fails open**, because the alternative reading of an unreadable store — *treat it as answered* —
  removes the question for that rider for ever, with no signal anywhere that it happened. A private
  window, a browser blocking site data and some WebView previews all **throw** rather than returning
  null.

A failed *write* is the residual and it is priced rather than recovered: the question returns on the
next visit. A failed *clear* after the rider answered is the one direction that fails closed, and it
is accepted because the question has just been answered — only the ladder position is wrong.

#### Scenario: The record carries nothing about the rider
- **WHEN** a deferral is stored
- **THEN** the persisted value SHALL contain only a timestamp and a non-negative count
- **AND** the town the question was about SHALL NOT be among the persisted fields

#### Scenario: The next rider on the device is asked
- **WHEN** rider A defers the question and signs out, and rider B signs in on the same device
- **THEN** B SHALL be asked according to B's own state, with no interval inherited from A

#### Scenario: An unreadable store asks rather than assumes
- **WHEN** reading the record throws, returns nothing, or returns a value that is not a record with
  a finite timestamp and a non-negative integer count
- **THEN** it SHALL be treated as absent and the question SHALL be asked
- **AND** the shape SHALL be validated rather than only the parse, because a stored `1` parses
  successfully and is not a record

#### Scenario: A retired key is removed rather than left unread
- **WHEN** a storage key's meaning is retired by a change
- **THEN** the key SHALL be removed from the device rather than merely stopped being read
- **AND** no behaviour SHALL be derived from its presence afterwards

#### Scenario: A clock that moves backwards does not silence the question for ever
- **WHEN** the stored timestamp is in the future relative to the device clock
- **THEN** the record SHALL be treated as absent and the question SHALL be asked
