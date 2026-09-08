## MODIFIED Requirements

### Requirement: Ride visibility SHALL be stated per role

Every role that can reach a ride SHALL have its access stated, so each line maps onto an
assertion. The policy exists and has never been written down role by role, which is what
allowed the private-club case above to go unnoticed.

**A fourth audience arm is added by `083`, and adding an arm without adding the role to this list
is that same failure repeating.** The arm admits a rider holding a live invite — `status` `pending`
or `accepted` — and it sits **inside** the group governed by
`NOT private.is_blocked(auth.uid(), organizer_id)`, never beside the organizer arm. That placement
is the whole security statement: at the top level the same predicate is a block bypass, and the
difference between the two is one level of parenthesis.

**The rule is now stated in two places and both are normative.** `private.can_read_ride` (`060`) is
a candidate-relative restatement of this policy, maintained so a fan-out can ask the question for
somebody other than the caller. Any change to the policy SHALL be made to that function in the same
migration and in the same position, and `supabase/tests/rls_test.sql` §060.1 — which pins this
policy's qual by equality — SHALL be re-pinned **and** the helper updated, never the string alone.

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
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through
  `ride_members`

#### Scenario: Invited rider, not yet crew
- **WHEN** a rider holding a `pending` invite reads a ride that is neither public nor in a club they
  belong to
- **THEN** it SHALL be returned, and its crew SHALL be readable through `ride_members`
- **AND** nothing hanging off `private.is_club_member` or `private.is_ride_crew` SHALL become
  readable — not the club, not its other rides, not its members, not the ride's chat

#### Scenario: Invited rider who accepted and later left the crew
- **WHEN** an accepted invitee deletes their `ride_members` row and reads the ride
- **THEN** it SHALL still be returned, because `accepted` is a live invite
- **AND** they SHALL be able to rejoin, which depends on this — `ride_members` INSERT carries its
  own `EXISTS (rides …)` evaluated under their row security

#### Scenario: Invited rider who declined
- **WHEN** a rider who declined an invite reads the ride
- **THEN** zero rows SHALL be returned, unless another arm admits them

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to **and including a live invite**
- **THEN** zero rows SHALL be returned
- **AND** the invite case SHALL be asserted separately from the club case, because a single
  assertion cannot say which conjunct did the work and the invite arm is the one whose placement
  can be got wrong

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`

## ADDED Requirements

### Requirement: A policy restated for a candidate SHALL be changed in lockstep with the policy, and the two SHALL share one body where they can

Where a `security definer` function restates a row-security policy so that it can be evaluated for a
rider other than the caller, the restatement SHALL be treated as part of the policy. A change to
either SHALL change both, in the same migration.

Where the restated predicate is a **helper**, the caller-relative and candidate-relative forms SHALL
be **one body with two entry points**: the caller-relative wrapper's `prosrc` SHALL be exactly a
delegation passing `auth.uid()` as the candidate, and the candidate-relative body SHALL mention
`auth.uid()` nowhere. Two independently-written bodies SHALL NOT be accepted, however similar.

Both SHALL be pinned by **equality** in the RLS suite, never by `like`. A substring match is
satisfied by the mention alone, so an arm added to the wrapper and not to the body passes it while
leaving the restatement silently narrower than the policy — with the policy's own pinned qual
unchanged, so that assertion does not fire either.

#### Scenario: A wrapper that grows an arm is caught
- **WHEN** an arm is added to a caller-relative wrapper and not to the shared body
- **THEN** the equality pin on the wrapper's `prosrc` SHALL fail
- **AND** a `like` assertion naming the shared body SHALL be recorded as insufficient, because it
  passes in exactly this case

#### Scenario: The restatement is verified by agreement, not only by text
- **WHEN** the suite verifies a candidate-relative restatement
- **THEN** it SHALL assert that the policy and the restatement return the same answer for each named
  role the policy enumerates
- **AND** the text pin and the agreement assertion SHALL both exist, because the first catches a
  rewrite and the second catches a rewrite that is textually different and semantically wrong

#### Scenario: The candidate-relative form is reachable by no client role
- **WHEN** grants on a candidate-relative visibility helper are examined
- **THEN** `authenticated` and `anon` SHALL hold no `execute`, because such a function answers
  questions about other riders and is therefore a block oracle
- **AND** only the caller-relative wrapper SHALL be granted, because an RLS expression is evaluated
  as the querying role

### Requirement: A status column SHALL NOT be a copy of a fact another table owns

Where a column records an answer, a decision or a state, it SHALL NOT be maintained as a mirror of a
row in another table. The other table SHALL be read live at the point the answer is rendered.

A trigger SHALL NOT be hung on an existing, already-shipped write path in order to keep such a
mirror in step. That is `036`'s hand-exercise hazard — new code inside every rider's own transaction
on a live path, where a raise takes their write down — spent on maintaining a duplicate.

#### Scenario: An invite's status answers the invitation, not the membership
- **WHEN** a rider joins a ride by a route other than answering their invite
- **THEN** the invite's `status` SHALL remain unchanged
- **AND** the surface SHALL render their membership by reading the crew, not by reading the status

#### Scenario: No trigger is added to the crew table
- **WHEN** the triggers on `public.ride_members` are examined after the migration
- **THEN** they SHALL be exactly those that existed before it
