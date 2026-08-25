## MODIFIED Requirements

### Requirement: Sign-out SHALL destroy every local trace of the rider

Signing out SHALL discard the session, the query cache, cached images and cached signed URLs,
so that nothing belonging to the previous rider MUST survive on the device. **It SHALL also
release this device's push registration on the server**, which is the first thing sign-out is
responsible for that does not live on the device at all.

Today sign-out clears a cookie and the server holds nothing else. The client-rendered app holds
a query cache, signed image URLs, and — later — an offline store. A shared device is the normal
case for a motorcycle club, not an edge case.

**The push registration is the first item on this list whose survival harms the *next* rider
rather than the last one.** Everything else sign-out destroys protects the person walking away: their cache,
their images, their session. A surviving device registration does them no harm at all — it delivers their
notifications, correctly addressed, to a phone that now belongs to somebody else. It is the only
route in this app by which one rider's content reaches another rider's screen with every RLS
policy working as designed, which is why it belongs in this requirement rather than in a
push-specific corner of the specification.

**Ordering is part of the requirement, not an implementation detail.** The release is an
authenticated call, so it runs **before** the token revocation — the mirror of the existing rule
that `clearSessionStore()` runs *after* the revocation because clearing first would take away the
refresh token the revocation needs.

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

#### Scenario: The push registration is released before the session is revoked
- **WHEN** a rider signs out on a device that has registered for push
- **THEN** the release call SHALL be made while the session is still live
- **AND** no further push addressed to that rider SHALL reach that device

#### Scenario: A failed release does not block the sign-out, and its window is stated
- **WHEN** the release call fails — the device is offline, which is the ordinary case for a rider
  walking away from a bike
- **THEN** the rider SHALL still be signed out and SHALL still land on `/auth/login`, per the
  scenario above
- **AND** the resulting exposure SHALL be stated as *until this device is next opened with a
  session* rather than described as closed
- **AND** it SHALL be closed at that other end by an unconditional re-registration on cold start,
  which re-homes the device to whoever is signed in — because nothing can release a device without
  a session, and no amount of client retry changes that
- **AND** that bound SHALL depend on the registration row being keyed on the **installation**: a
  token-keyed row is released and re-homed one token at a time, so a device that has rotated its
  token keeps an orphan row and the real bound becomes the idle sweep

#### Scenario: A stale registration is not treated as a per-notification problem
- **WHEN** a mitigation is proposed inside the delivery path — checking that the token still
  belongs to the notification's recipient
- **THEN** it SHALL be refused as a mitigation for this case
- **AND** the reason SHALL be that the delivery path selects devices *by* recipient, so the check
  passes in exactly the case that is broken: the row's `user_id` is the previous rider, and it is
  the *device* that has changed hands
