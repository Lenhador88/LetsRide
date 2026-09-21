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

**This change adds no arm.** `public.rides` SELECT and `private.can_read_ride` are untouched, and
an assertion pins both — a failing pin here means the change is wrong, not that the pin is stale.

**What it adds is a reader who is not in the policy at all.** `public.ride_invite_link_preview` is
`security definer`, so it bypasses row security by construction and hands eight named columns of a
ride to a rider holding a URL and nothing else. A read path *outside* the policy is precisely the
thing this requirement exists to stop going unwritten, so it is enumerated here as a role rather
than left to the new capability's own spec.

**Three properties make that reader safe, and all three are asserted:** the column list is fixed
in SQL and never `rides.*`, so a column added later is not disclosed by default; the block check is
**restated in the function's body**, because there is no policy underneath it to carry decision #2;
and the function returns zero rows for every non-live token, so it discloses nothing about which
tokens exist.

**The rule is stated in two places and both are normative.** `private.can_read_ride` (`060`) is a
candidate-relative restatement of this policy, maintained so a fan-out can ask the question for
somebody other than the caller. Any change to the policy SHALL be made to that function in the
same migration and in the same position.

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

#### Scenario: Invited rider, not yet crew
- **WHEN** a rider holding a `pending` or `accepted` invite reads a ride that is neither public
  nor in a club they belong to
- **THEN** it SHALL be returned, by the arm `083` added inside the block-dominated group

#### Scenario: Token holder, before claiming
- **WHEN** a signed-in rider holding a live token, and no other route to the ride, reads
  `public.rides` directly
- **THEN** zero rows SHALL be returned — **the token buys no policy reach**
- **AND** the only thing they may read is the eight-column preview, through the definer RPC

#### Scenario: Token holder, after claiming
- **WHEN** the same rider has claimed
- **THEN** they SHALL read the ride by the invite arm above and by no new mechanism, being
  indistinguishable in the policy from an accepted in-app invitee

#### Scenario: Former member who does not own the club
- **WHEN** a rider deletes their `club_members` row for a private club they do not own and then
  reads a ride in it
- **THEN** zero rows SHALL be returned immediately, because reach is keyed on the current row or
  on `clubs.owner_id` and never on membership history

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to, an invite, **or a live token**
- **THEN** zero rows SHALL be returned
- **AND** the token route SHALL be refused by a check in the RPC's own body, since no policy runs
  beneath a `security definer` function

#### Scenario: Blocked rider who owns the club
- **WHEN** the club's owner reads a ride in their own club whose organizer they have blocked, or
  who has blocked them
- **THEN** zero rows SHALL be returned
- **AND** ownership SHALL NOT override a block in either direction, blocking being symmetric even
  though the row is directional

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`, and no EXECUTE
  on either new RPC
- **AND** the owner arm SHALL NOT change this, since it resolves through `auth.uid()`, which is
  NULL with no session

#### Scenario: Invited rider who accepted and later left the crew
- **WHEN** an accepted invitee deletes their `ride_members` row and reads the ride
- **THEN** it SHALL still be returned, because `accepted` is a live invite
- **AND** they SHALL be able to rejoin, which depends on this — `ride_members` INSERT carries its
  own `EXISTS (rides …)` evaluated under their row security

#### Scenario: Invited rider who declined
- **WHEN** a rider who declined an invite reads the ride
- **THEN** zero rows SHALL be returned, unless another arm admits them
