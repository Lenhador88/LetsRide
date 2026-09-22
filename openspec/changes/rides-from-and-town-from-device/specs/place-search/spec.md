## RENAMED Requirements

- FROM: `### Requirement: The proxy SHALL verify its caller itself, and SHALL refuse every caller who is not an onboarded rider`
- TO: `### Requirement: The proxy SHALL verify its caller itself, and SHALL refuse every caller who has not accepted the terms`

## MODIFIED Requirements

### Requirement: The proxy SHALL verify its caller itself, and SHALL refuse every caller who has not accepted the terms

The function SHALL verify the JWT against the auth server rather than trusting the gateway, exactly
as `delete-account` does and for the same reason: the publishable key is itself a valid JWT and
sails past a decode-only check. It SHALL hold no service-role key, and SHALL take no user id in its
request body — the subject comes from the verified token and from nowhere else.

**The negative cases, stated per role.** Nothing in place lookup is rider content, so most roles
resolve identically — which is the point of writing them down rather than assuming it:

| Caller | May search |
|---|---|
| Signed-out visitor | **No.** No session, no token, refused before any spend. Decision #1; `anon` holds no grant on the ledger either |
| A token that is not a user session (the publishable key) | **No.** Refused by verifying against the auth server rather than decoding |
| An anonymous Supabase user | **No.** Refused on `is_anonymous`, as `resolve-ride-location` already refuses |
| A rider with `terms_accepted_at` NULL | **No.** The consent gate (`128`) refuses the metering row, and no metering row means no vendor call. This closes a real hole: an account created by calling `/auth/v1/signup` directly never accepts terms, and today such an account can still set a username and upload an avatar |
| A rider who has accepted the terms but not finished onboarding | **Yes**, within the ceilings below. This rider is on the wizard's town step, whose submit is what writes the completion stamp, so a gate requiring that stamp refused every lookup there (`128`) |
| Any onboarded rider | **Yes**, within the ceilings below. Searching is not a membership-gated act |
| A club owner, admin or member | **Yes**, and no more than any other rider. Lookup grants no elevated ceiling and no elevated results |
| A non-member of the club being created or edited | **Yes.** A rider searching for a place to attach to a club they are creating is not yet a member of it |
| A blocked rider, in either direction | **Yes**, unchanged. Place lookup returns reference data about the world and names no rider, so blocking has no surface here — and SHALL NOT be given one, because a lookup that behaved differently for a blocked pair would leak the existence of the block |

#### Scenario: A signed-out caller spends nothing
- **WHEN** the proxy is called with no token, an expired token, or the publishable key
- **THEN** it SHALL refuse with an unauthorized response
- **AND** it SHALL NOT call the vendor, SHALL NOT write a metering row, and SHALL NOT disclose which of
  the three it refused for

#### Scenario: An account without consent cannot search
- **WHEN** a rider whose consent stamp is NULL calls the proxy with a valid session
- **THEN** the metering row SHALL be refused by the consent gate
- **AND** the proxy SHALL return the same exhausted-or-refused outcome it returns for a ceiling, without
  the vendor being called
- **AND** the rider SHALL NOT be told which gate refused them

#### Scenario: The wizard's town step can search
- **WHEN** a rider who has accepted the terms and has no completion stamp searches for a town, or
  reverse-geocodes a device fix, on the onboarding town step
- **THEN** the metering row SHALL be accepted, subject to the same per-rider and application-wide
  ceilings as any other rider
- **AND** no table other than `place_search_attempts` SHALL move from the participation gate

#### Scenario: The request body carries no identity
- **WHEN** the proxy's request body is inspected
- **THEN** it SHALL contain the search text, the mode, and at most a coarse bias coordinate
- **AND** a user id, club id or ride id in that body SHALL be ignored if present rather than trusted
