## Purpose

The only thing in this system that runs with rights no rider has. Removing an `auth.users` row
needs the Auth admin API, which needs the service-role key — so this capability is a security
boundary before it is a feature, and every requirement below is about keeping its blast radius to
one account.

Decision #8 permits exactly this shape: "more server compute, same database … Route Handlers or
Supabase Edge Functions for work the client cannot do". It does **not** permit the third reading —
a service-role backend that owns the database — and nothing here moves toward one.

## ADDED Requirements

### Requirement: The deletion function SHALL delete the caller and SHALL accept no identifier

The function SHALL derive the account to delete from the verified JWT and from nothing else.

A privileged endpoint that takes a user id is account deletion as a service for whoever finds the
URL. "We check that the id matches the caller" is one careless refactor away from not checking;
removing the parameter removes the class of bug rather than guarding it.

#### Scenario: The caller's own account is deleted
- **WHEN** a rider with a valid, non-anonymous session invokes the function
- **THEN** the account identified by the token's subject SHALL be deleted

#### Scenario: An identifier in the request body is ignored, not honoured
- **WHEN** a request carries a user id, email or username in its body, query string or headers
- **THEN** the function SHALL ignore it entirely
- **AND** the function's signature SHALL have no parameter it could bind to, so a future caller
  cannot start supplying one

#### Scenario: An unverified or forged token is refused
- **WHEN** a request arrives with a missing, expired, malformed or forged JWT
- **THEN** the function SHALL refuse before performing any work
- **AND** it SHALL verify the token itself rather than trusting an upstream gateway to have done
  so, because the gateway's configuration is not in this repository

#### Scenario: An `anon` token is refused
- **WHEN** a request arrives bearing the publishable key as its authorization, which every client
  bundle already contains
- **THEN** it SHALL be refused, because that token identifies no subject
- **AND** decision #1 SHALL hold: no anonymous caller gains any capability here

#### Scenario: The function does no reading a rider could have done themselves
- **WHEN** the confirmation screen needs the counts of clubs, rides and RSVPs at stake
- **THEN** those SHALL be read by the client under its own RLS session
- **AND** the privileged function SHALL NOT become a general-purpose reader, which is the first
  step toward the service-role backend decision #8 rules out

### Requirement: The service-role credential SHALL exist only inside the function

The service-role key SHALL live in the Edge Function's own secret store and MUST NOT appear in
the repository, the client bundle, the Vercel environment or any `NEXT_PUBLIC_*` variable.

#### Scenario: The key is not in the repository
- **WHEN** the repository is searched
- **THEN** no service-role key SHALL be present in any file, fixture, test, example env file or
  comment
- **AND** `.env.local.example` SHALL NOT gain a placeholder for one, because a named placeholder
  is an invitation

#### Scenario: The key is not in the client bundle
- **WHEN** the production bundle is inspected
- **THEN** it SHALL contain only the publishable key it already ships
- **AND** no `NEXT_PUBLIC_*` variable SHALL ever hold a service-role credential

#### Scenario: The key is not in the web deployment
- **WHEN** Vercel's environment is inspected
- **THEN** it SHALL hold no service-role key, because nothing rendered or served from there needs
  one
- **AND** the credential SHALL live in the Edge Function's own secret store

#### Scenario: The privileged surface stays one function
- **WHEN** future work needs elevated rights — push delivery, ride reminders, scheduled jobs
- **THEN** each SHALL be its own narrowly-scoped function
- **AND** this one SHALL NOT be extended into a general admin endpoint

### Requirement: The function SHALL be idempotent and SHALL fail without leaving an inconsistent account

Repeated invocations SHALL converge on the same outcome, and a failure MUST NOT leave a club
half-transferred, a cascade half-applied, or an account that exists in one layer and not another.

Deletion is a single call over a mobile connection. The states that matter are the ones where it
does not cleanly return.

#### Scenario: Deleting an already-deleted account succeeds
- **WHEN** the token's subject has no `auth.users` row — a retry, a second device, a response the
  client never received
- **THEN** the function SHALL return success
- **AND** it SHALL NOT return an error, which would leave a rider holding a dead session on a
  screen whose only action fails

#### Scenario: A failure before the auth delete leaves everything intact
- **WHEN** the club transfer or the Storage sweep fails
- **THEN** no rows and no auth record SHALL have been removed, and the caller SHALL receive a
  retryable error
- **AND** the club transfer and the row cascade SHALL be one database transaction, so a
  half-transferred club is not a reachable state

#### Scenario: The one genuinely partial state is named rather than denied
- **WHEN** Storage objects are deleted and the subsequent auth delete fails
- **THEN** the account SHALL remain intact with some images missing, and a retry SHALL complete
  the deletion
- **AND** this SHALL be documented as the deliberately-chosen half to lose: images without rows
  are orphans, rows without images render broken

#### Scenario: A concurrent second invocation does not double-transfer a club
- **WHEN** two deletion calls for the same account run concurrently
- **THEN** exactly one SHALL perform the work and the other SHALL observe the account already
  gone
- **AND** no club SHALL be transferred twice or to a rider who is themselves mid-deletion

#### Scenario: Two riders deleting at once do not hand a club to each other
- **WHEN** the only two members of a club both delete their accounts concurrently
- **THEN** the outcome SHALL be a deleted club, not a club owned by a nonexistent rider
- **AND** the transfer SHALL never select a candidate whose own `profiles` row is being removed in
  the same transaction

### Requirement: A residual access token SHALL be able to read for at most its remaining lifetime and SHALL write nothing

An access token issued before the deletion SHALL grant no write of any kind afterwards, and its
remaining read window MUST be stated with its bound rather than assumed to be zero.

Deleting the auth row invalidates refresh tokens. An access token already issued remains
cryptographically valid until it expires — up to an hour by default.

#### Scenario: A residual token cannot create anything
- **WHEN** a client holding a still-valid access token for a deleted account attempts to insert
  into any table
- **THEN** the write SHALL fail — every INSERT policy's subject now has no `profiles` row, so each
  foreign key raises `23503`
- **AND** with `023` applied, `private.may_participate()` SHALL return false first, giving two
  independent refusals

#### Scenario: A residual token's reads are bounded and stated
- **WHEN** the same client issues reads
- **THEN** it SHALL be able to read only what any signed-in rider can read, for at most the
  token's remaining lifetime
- **AND** this window SHALL be recorded as an accepted property with its bound, not described as
  zero

#### Scenario: The deleting device does not rely on the window closing
- **WHEN** the deletion succeeds on the rider's own device
- **THEN** the client SHALL clear its session, cache, cached images and secure storage
  immediately, without waiting for any token to expire
- **AND** it SHALL do so even when the sign-out network call fails
