## MODIFIED Requirements

### Requirement: Ride visibility SHALL be stated per role

Every role that can reach a ride SHALL have its access stated, so each line maps onto an
assertion. The policy exists and has never been written down role by role, which is what
allowed the private-club case above to go unnoticed.

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

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public = true`
- **THEN** it SHALL be returned, since decision #1 makes "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through `ride_members`

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

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to, an invite, **or a live token**
- **THEN** zero rows SHALL be returned
- **AND** the token route SHALL be refused by a check in the RPC's own body, since no policy runs
  beneath a `security definer` function

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`, and no EXECUTE
  on either new RPC

### Requirement: A column the server owns SHALL NOT be writable by a client that can insert the row

A column whose value is a server decision SHALL be withheld by the **grant**, not by a default and
not by a trigger alone. A default applies only when the column is omitted, and PostgREST will
happily name one.

**This change adds the sharpest instance of that rule in the schema: a secret.**
`public.ride_invite_links.token` is the credential itself, so a client able to name it could mint
a link with a token it chose — a predictable or reused string, or one already pasted somewhere —
and the entropy guarantee would be worth nothing. `expires_at` is the same argument one step down:
a client able to name it sets its own ceiling.

#### Scenario: The token is withheld by the grant
- **WHEN** `information_schema.column_privileges` is read for `authenticated` on
  `public.ride_invite_links`
- **THEN** INSERT SHALL be held on `(id, ride_id, created_by)` only
- **AND** `token`, `expires_at`, `created_at` and `revoked_at` SHALL NOT appear

#### Scenario: Naming the column is refused, not ignored
- **WHEN** an insert names `token`
- **THEN** it SHALL fail with `42501` rather than silently taking the default

### Requirement: A table with no designed edit SHALL carry no UPDATE grant

Where a table has exactly one designed mutation, that mutation SHALL be a `security definer` RPC
and the table SHALL carry no UPDATE grant and no UPDATE policy for any client role.

**`public.ride_invite_links` has exactly one: revoke.** A column grant on `(revoked_at)` would let
a client write NULL and **un-revoke** a link the organizer killed, and would let them write a
future timestamp. `public.revoke_ride_invite_link` is therefore the only path, with one raise site
so a caller learns nothing about a link that is not theirs.

#### Scenario: Revoke is not reversible by a client
- **WHEN** any rider attempts to UPDATE `ride_invite_links` by any route
- **THEN** it SHALL be refused, asserted per grantee with `has_table_privilege` rather than by a
  grant-row count, since `postgres` and `service_role` hold everything by Supabase default
