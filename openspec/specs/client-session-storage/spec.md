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

