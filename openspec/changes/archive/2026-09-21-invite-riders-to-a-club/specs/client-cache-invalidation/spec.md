# client-cache-invalidation

## ADDED Requirements

### Requirement: An admission SHALL invalidate both domains it moves, and the arriving screen SHALL NOT be one of them

Accepting an invite and claiming a link each change **two** domains in one tap: the rider's club
membership and the club's own roster and counts. Every key covering either SHALL be named by the
mutation that moved it.

The five keys this change adds SHALL be spelled in `src/lib/query/keys.ts`, each with the docstring
that file's convention requires, and **no key SHALL be written inline in a component even when the
string happens to be right**:

| Key | What it holds | Who invalidates it |
|---|---|---|
| `clubs.invites(clubId)` | the club's outgoing invites, for an admin | send, withdraw, clear |
| `clubs.inviteLinks(clubId)` | the club's links with their expiry and use count | mint, revoke, delete |
| `invites.clubPending()` | the rider's own answerable invites | accept, decline |
| `invites.clubLink(token)` | one token's preview — **the token is IN the key**, so two links opened in one session cannot share an entry | the claim |
| `invites.clubSearch(clubId, query)` | the rider picker's hits, keyed on the query as well as the club | sending an invite, which must take that rider out of the picker |

An accept or a claim SHALL additionally invalidate the rider's **club list** and the club's own
detail, membership count and roster — the cross-domain half, and the half PD-329's review already
caught once for rides.

**The claim has no prior screen to invalidate from**, because the rider may have had no session when
anything was cached. It SHALL therefore navigate to the club rather than relying on an invalidation
to repaint a screen the rider is leaving.

#### Scenario: An accept updates every surface that named the rider's membership
- **WHEN** an invitee accepts
- **THEN** `/clubs`, the club's detail, its roster, its member count and the rider's own invite list
  SHALL all reflect it without a manual refresh

#### Scenario: A withdrawn invite leaves no stale control
- **WHEN** an admin withdraws an invite
- **THEN** the club's invite list SHALL be invalidated
- **AND** the invitee's notification row SHALL stop offering Accept and Decline, because those
  controls read the live invite through the accessor rather than the notification that announced it

#### Scenario: A failed claim leaves no false state
- **WHEN** the claim is refused
- **THEN** no optimistic membership SHALL remain on screen, and the landing screen SHALL move to its
  dead-link state rather than showing a half-joined club

#### Scenario: The preview is not cached across tokens or across viewers
- **WHEN** two links are opened in one session, or one link is opened by two riders on one device
- **THEN** each SHALL resolve its own entry, because the token is part of the key and the cache is
  cleared on sign-out
