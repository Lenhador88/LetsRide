## Purpose

How a rider's session is held, proved and discarded once there is no server to set an httpOnly
cookie. Covers the move to device secure storage, the replacement for the password-recovery
marker, and what sign-out must destroy on a device two people share.

## ADDED Requirements

### Requirement: Session tokens SHALL be held in device secure storage

`@supabase/ssr` stores the session in httpOnly cookies, which JavaScript cannot read. The
client-rendered shell has no such cookie, so the session moves into a storage adapter passed to
`@supabase/supabase-js`. It SHALL be the platform secure store — Keychain on iOS, the Android
Keystore-backed store — and SHALL NOT be `localStorage`, `sessionStorage` or IndexedDB.

The publishable key is not what changes here. It already ships in the bundle and is designed
to; the refresh token is what becomes JS-readable, and it is the thing to protect.

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

`updatePassword` gates on `lr-recovery`, an httpOnly cookie set by `/auth/callback` after a
successful code exchange and cleared by the reset. It exists because a recovery link yields an
ordinary session: without it, anyone already holding a session — a borrowed phone, a shared
laptop — could set a new password without knowing the current one. Neither the Route Handler
nor the httpOnly cookie survives into the native shell.

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

Signing out SHALL discard the session, the query cache, cached images and cached signed URLs,
so that nothing belonging to the previous rider MUST survive on the device.

Today sign-out clears a cookie and the server holds nothing else. The client-rendered app holds
a query cache, signed image URLs, and — later — an offline store. A shared device is the normal
case for a motorcycle club, not an edge case.

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

A visitor with no session SHALL be able to load the shell and MUST NOT be able to read any
rider data, from the network or from a cache.

Decision #1 is unchanged: `anon` holds zero table grants and every route except `/auth/*` and
`/legal/*` requires a session. What changes is that a static bundle is served to anyone who
asks, so the shell itself is now public even though nothing in it is.

#### Scenario: The shell renders, the data does not
- **WHEN** a signed-out visitor loads any authenticated route
- **THEN** no rider data SHALL be rendered from any source, including a cache left by a
  previous session
- **AND** every request the shell makes SHALL be refused by RLS rather than filtered by the
  client

#### Scenario: No anonymous grant is introduced to make first paint faster
- **WHEN** a screen would benefit from data before the session is restored
- **THEN** the answer SHALL be to wait for the session, not to grant `anon` a read
