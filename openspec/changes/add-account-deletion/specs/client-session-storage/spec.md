## MODIFIED Requirements

### Requirement: Sign-out SHALL destroy every local trace of the rider

Signing out SHALL discard the session, the query cache, cached images and cached signed URLs,
so that nothing belonging to the previous rider MUST survive on the device. **Account deletion
SHALL destroy exactly the same things, on the device that performed it, and SHALL NOT be
allowed to skip any of them because it took a different code path to get there.**

Today sign-out clears a cookie and the server holds nothing else. The client-rendered app holds
a query cache, signed image URLs, and — later — an offline store. A shared device is the normal
case for a motorcycle club, not an edge case.

**What account deletion changes about this requirement is the failure mode of the revocation
call, not the list of things to destroy.** `signOut()` on a live account either succeeds or
fails for lack of network; on a deleted account the server *refuses* it, because there is no
longer an account to revoke. Those are different errors and an implementation that treats the
refusal as "the deletion failed" leaves a rider signed in to an account that no longer exists,
holding a populated cache. The rule is the same rule — destroy locally regardless — stated for
the case where the server disagrees rather than the case where it is unreachable.

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

#### Scenario: A successful deletion destroys the same set as a sign-out
- **WHEN** an account deletion returns success on the rider's own device
- **THEN** the session, the session store entry, the query cache, cached images and cached
  signed URLs SHALL all be destroyed, by the same path an ordinary sign-out uses
- **AND** the destruction SHALL NOT be reimplemented alongside sign-out's, because two lists of
  what to clear drift and only one of them is exercised daily

#### Scenario: A revocation the server refuses is not a failed deletion
- **WHEN** the sign-out that follows a successful deletion is refused by the server, because the
  account it names no longer exists
- **THEN** local state SHALL still be destroyed and the rider SHALL still land on `/auth/login`
- **AND** the refusal SHALL NOT be surfaced as a deletion error, since the deletion already
  succeeded and reporting failure would invite a retry of an irreversible action

## ADDED Requirements

### Requirement: A session whose account no longer exists SHALL be destroyed, not merely redirected

When the app determines that the signed-in account is gone, it SHALL destroy the session store
entry and the query cache before rendering the signed-out screen, and MUST NOT rely on the
rider choosing to sign out.

This is the first requirement in this capability that is not about the device the rider acted
on. Deletion is an account-level event and sign-out is a device-level one, so a rider with two
devices deletes on one and the other is left holding a full session store and a full query
cache with nothing to tell it otherwise.

**The route guard already detects the state and deliberately does not act on it.**
`my_onboarding_state()` returns zero rows for a caller with no `profiles` row;
`onboardingStateFrom` maps that to `unavailable` and `resolveDestination` redirects to
`/auth/login?error=profile_unavailable`. A redirect is not a destruction: nothing in that branch
clears the cache or the store, and `signIn` does not clear either — only `signOut` does. Account
deletion is the first thing that makes that branch reachable against a real database, which the
guard's own comment says in as many words. So the branch stops being a deploy-mismatch
safety net and becomes a routine path with a data-retention consequence.

#### Scenario: A second device destroys its local state rather than sitting on it
- **WHEN** a device holding a session for a deleted account reads `my_onboarding_state()` and
  receives zero rows
- **THEN** the session store entry, the query cache and every cached signed URL SHALL be
  destroyed before the login screen renders
- **AND** the rider SHALL NOT have to press Sign out for that to happen, because the account
  they would be signing out of no longer exists

#### Scenario: The destruction does not need the network
- **WHEN** the same device is offline when it next launches, and its stored session cannot be
  refreshed
- **THEN** the local destruction SHALL still occur without a successful round trip
- **AND** the device SHALL NOT be left in a state a later launch can resurrect a cache from

#### Scenario: Zero rows is never read as un-onboarded
- **WHEN** the onboarding accessor returns zero rows
- **THEN** it SHALL be treated as an account that cannot be resolved, never as a rider who has
  not onboarded
- **AND** the rider SHALL NOT be routed into the consent prompt, where `accept_terms()` has no
  row to update, returns NULL without raising, and every submit fails with no exit

#### Scenario: One rider's deletion does not disturb any other rider's device
- **WHEN** a club owner, club admin, fellow member, non-member or a rider on either side of a
  block loads the app after someone else's account is deleted
- **THEN** their own session, session store entry and cache SHALL be untouched
- **AND** no signal SHALL reach their device that identifies whose account was deleted

#### Scenario: The secure store is included the day it exists
- **WHEN** the native shell provides `window.__letsrideSecureStore`
- **THEN** the destruction above SHALL clear the secure store entry as well as web storage
- **AND** a deletion path that clears only `localStorage` SHALL be treated as incomplete rather
  than as working-on-web
