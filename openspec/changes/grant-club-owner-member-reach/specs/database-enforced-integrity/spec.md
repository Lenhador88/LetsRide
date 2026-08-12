# database-enforced-integrity (delta)

> **⚠ COORDINATION.** This delta modifies `Ride visibility SHALL be stated per role`. No other
> active change touches that requirement as of 2026-08-12 — `enforce-creator-membership` and
> `add-account-deletion` both contend for `Club membership role SHALL NOT be self-assignable`,
> which this change does not touch. Re-check with
> `grep -rn "Ride visibility SHALL be stated per role" openspec/changes/` before archiving:
> archiving replaces a requirement wholesale, so whichever change archives second silently
> discards the first one's edit.

## MODIFIED Requirements

### Requirement: Ride visibility SHALL be stated per role

Every role that can reach a ride SHALL have its access stated, so each line maps onto an
assertion. The policy exists and has never been written down role by role, which is what
allowed the private-club case above to go unnoticed.

**A club's owner is one of those roles and was omitted.** The original six scenarios named
organizer, club member, non-member with a public ride, non-member with a private club's ride,
blocked rider and signed-out visitor — five of which `openspec/config.yaml` requires, with
**owner and admin absent**. `private.is_club_member` reads `club_members` only, so an owner
holding no membership row fell through every scenario here and lost their own private club's
rides in both directions. The two scenarios below close that, and are stated in terms of
`clubs.owner_id` rather than of any membership row so they remain true whether or not the row
exists.

#### Scenario: Organizer
- **WHEN** the organizer reads their own ride
- **THEN** it SHALL be returned regardless of `is_public`, `club_id` or club visibility

#### Scenario: Club member
- **WHEN** a member of the ride's club reads it
- **THEN** it SHALL be returned

#### Scenario: Club owner holding no membership row
- **WHEN** the rider named by `clubs.owner_id` reads a ride in that club while holding no
  `club_members` row for it
- **THEN** it SHALL be returned, on the same terms as for a member, regardless of the club's
  `is_public`
- **AND** that rider SHALL be able to create a ride in that club
- **AND** neither SHALL depend on the owner-membership row existing

#### Scenario: Club admin
- **WHEN** a rider holding `club_members.role = 'admin'` reads a ride in that club
- **THEN** it SHALL be returned because they hold a membership row, and for no other reason
- **AND** no admin-specific arm SHALL exist in any ride policy, since `admin` has no
  representation outside `club_members`

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public = true`
- **THEN** it SHALL be returned, since decision #1 makes "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through
  `ride_members`
- **AND** this SHALL hold for a rider who owns some *other* club

#### Scenario: Former member who does not own the club
- **WHEN** a rider deletes their `club_members` row for a private club they do not own and then
  reads a ride in it
- **THEN** zero rows SHALL be returned immediately, because reach is keyed on the current row or
  on `clubs.owner_id` and never on membership history

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to
- **THEN** zero rows SHALL be returned

#### Scenario: Blocked rider who owns the club
- **WHEN** the club's owner reads a ride in their own club whose organizer they have blocked, or
  who has blocked them
- **THEN** zero rows SHALL be returned
- **AND** ownership SHALL NOT override a block in either direction, blocking being symmetric even
  though the row is directional

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`
- **AND** the owner arm SHALL NOT change this, since it resolves through `auth.uid()`, which is
  NULL with no session
