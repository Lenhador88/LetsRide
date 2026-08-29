## MODIFIED Requirements

### Requirement: Every mutation SHALL declare what it invalidates

Every function in `src/lib/actions/` SHALL name the cache keys it moves, from
`src/lib/query/keys.ts` and never inline, and SHALL name them at the call site so the claim is
readable in one `git grep`.

**A link claim is the widest single mutation in the app so far**, because it changes the rider's
relationship to a ride they had no relationship with a moment ago. It moves keys in two domains,
and PD-329's review already caught the near-identical miss once: an accept that left `/rides` and
Explore stale, so the rider arrived at a ride list that did not contain the ride they had just
joined.

`claimRideInviteLink` SHALL invalidate:

| Key | Why |
|---|---|
| `rides.all()` | prefix-reaches the ride detail, its crew, the rider's ride list and Explore. Over-invalidating is the safe direction, and the rider is about to navigate into all of them. |
| `invites.all()` | the preview for this token, and the rider's own invite list, which now holds an `accepted` row that was not there. |

`revokeRideInviteLink` and `createRideInviteLink` SHALL invalidate `rides.inviteLinks(rideId)`,
which sits under the ride detail prefix so `rides.all()` reaches it too.

**The claim has a property no other mutation here has: there may be no cached entry to
invalidate.** The rider may have had no session when the landing route first rendered, so the
invalidation cannot be relied on to *cause* a fetch — the destination screen must fetch on mount
like any other, and the invalidation exists to stop a **stale** entry from a previous session
being served.

#### Scenario: The rider arrives at a ride they are on
- **WHEN** a rider claims a link and is routed to `/rides/detail?id=…`
- **THEN** the ride SHALL render with them present in the crew, and SHALL NOT serve a cached copy
  from before the claim

#### Scenario: The ride list and Explore agree with the claim
- **WHEN** the rider then opens `/rides`
- **THEN** the ride SHALL appear in their list, and SHALL NOT still appear on `/rides/explore` as
  a ride they are not on

#### Scenario: A revoked link leaves the list immediately
- **WHEN** the organizer revokes a link
- **THEN** the ride's link list SHALL show it revoked without a manual refresh

#### Scenario: Keys are named from the contract
- **WHEN** either new key is used
- **THEN** it SHALL be spelled in `src/lib/query/keys.ts` with the reconciliation note that file's
  header exists for, and never inline in a component

## ADDED Requirements

### Requirement: A cached capability preview SHALL be keyed by its token and SHALL NOT outlive the session

`invites.link(token)` SHALL carry the token in the key, so two tokens cannot share an entry, and
SHALL sit under the `invites` prefix so `invites.all()` reaches it.

The preview SHALL be cleared by `clearQueryCache()` on sign-out along with everything else — it
describes a ride the next rider on the device may have no right to see, and a preview served from
cache to a different session is an anonymous read with extra steps.

**A dead token SHALL NOT be cached as a live one.** The preview returns zero rows for every dead
state, which is a **decided** answer and therefore `null` rather than `undefined`; only `null`
renders the invalid-link message, and `undefined` SHALL continue to mean "not yet".

#### Scenario: Two tokens do not share an entry
- **WHEN** a rider opens two different invite links in one session
- **THEN** each SHALL resolve to its own cache entry and its own ride

#### Scenario: A preview does not survive sign-out
- **WHEN** a rider signs out
- **THEN** no cached preview SHALL be readable by the next session on that device

#### Scenario: Zero rows is decided, not pending
- **WHEN** the preview returns zero rows
- **THEN** the screen SHALL render the invalid-link message, and SHALL NOT render a skeleton
  indefinitely
