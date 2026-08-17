# database-enforced-integrity (delta)

> **⚠ COORDINATION — this delta collides with `grant-club-owner-member-reach` and the collision is
> deliberate.** Both modify `Ride visibility SHALL be stated per role`. Archiving replaces a
> requirement **wholesale**, so whichever archives second silently discards the first one's edit.
> The requirement below therefore **contains that change's `Club owner holding no membership
> row`, `Club admin`, `Former member who does not own the club` and `Blocked rider who owns the
> club` scenarios — with one strengthening line added to `Former member who does not own the
> club`, noted rather than claimed as verbatim** (a second strengthening line is in `Blocked
> rider`, which is a standing scenario neither change introduced). So this delta is a **superset**
> and archiving in either order preserves both.
>
> Re-check before archiving — the copy is a snapshot and goes stale the moment that change edits
> its delta again. Both commands below must print **nothing** against healthy files:
>
> ```bash
> # A. Every scenario heading in the other delta is present in this one.
> comm -23 \
>   <(grep '^#### Scenario:' openspec/changes/grant-club-owner-member-reach/specs/database-enforced-integrity/spec.md | sort) \
>   <(grep '^#### Scenario:' openspec/changes/align-fanout-recipients-with-readability/specs/database-enforced-integrity/spec.md | sort)
>
> # B. No LINE of the other delta's scenarios has been lost from this one.
> #    Added lines are fine — that is what "superset" means — so only `^<` is a failure.
> scen() { awk -v want="#### Scenario: $2" '/^#### Scenario: /{inblk=($0==want)} inblk' "$1"; }
> for s in "Club owner holding no membership row" "Club admin" \
>          "Former member who does not own the club" "Blocked rider who owns the club"; do
>   diff <(scen openspec/changes/grant-club-owner-member-reach/specs/database-enforced-integrity/spec.md "$s") \
>        <(scen openspec/changes/align-fanout-recipients-with-readability/specs/database-enforced-integrity/spec.md "$s") \
>     | grep '^<' && echo "LOST FROM: $s"
> done
> ```
>
> **Both patterns are `^`-anchored, and that is load-bearing rather than tidy.** An earlier
> revision of this block used `sed -n '/#### Scenario: Club owner holding no membership row/,…'`
> — an **unanchored** address, which also matches the copy of the command inside this very
> blockquote, so the range opened at the fence and the check emitted 44 lines and exited 1 against
> two correct files. That is the comment trap at a `sed` address, and **a check that fires against
> a healthy repo is worse than no check**, because the next reader learns to ignore it. Every line
> inside this quote begins with `> `, so an anchored pattern cannot match the commands themselves.
> The old range also **ended** at `Non-member, public`, which excluded two of the four scenarios it
> claimed to verify while sweeping in one this delta alone adds.
>
> **`grant-club-owner-member-reach` should archive first** — it is at 42/44 tasks and its
> migration (`054`) is already applied.

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
rides in both directions. The scenarios below close that, and are stated in terms of
`clubs.owner_id` rather than of any membership row so they remain true whether or not the row
exists.

**A ride's crew is NOT one of those roles, and that omission cost a second defect.** Nothing here
said so, and *"a rider on this ride's crew"* reads as a role that can obviously see the ride.
It cannot: `rides` SELECT resolves through organizer, public, or club member, and **neither
`ride_members` nor `private.is_ride_crew` appears in its `qual`** — transcribed from `055`'s
migration header and from `supabase/tests/rls_test.sql` §055.7, and **confirmed against DEV
(`fpmrimzxadewsaiwpsel`) on 2026-08-17**, where the policy text is verbatim as `055` recorded it.
A `ride_members` row survives every event that takes the ride away —
blocking removes nobody from a roster, and leaving a club reaches nothing on `ride_members` — so
*"holds a crew row"* and *"can see the ride"* are **independent**. A fan-out addressing the crew
therefore addressed riders the read policy discards, permanently and with nothing to raise. The
negative scenario below states that so it is a contract rather than an observation.

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

#### Scenario: Crew member with no other route to the ride
- **WHEN** a rider holding a `ride_members` row reads that ride while satisfying none of the
  organizer, public or club-member arms — because they blocked the organizer, or because they
  left the ride's private club
- **THEN** zero rows SHALL be returned, and crew membership SHALL NOT be a route to a ride
- **AND** `rides` SELECT SHALL carry **no** `ride_members` arm and **no** `private.is_ride_crew`
  arm, which SHALL be asserted as an absence rather than assumed from the policy reading
  correctly today
- **AND** the reason SHALL be recorded: two audiences narrower than the crew — `034`'s
  `ride_messages` SELECT/INSERT and `041`'s postcard ride-tag `WITH CHECK` — are expressed as an
  **intersection** of an RLS-filtered `EXISTS` against `rides` with `private.is_ride_crew`, so a
  crew arm here would make the `EXISTS` implied by the crew conjunct and collapse both to crew
  membership alone, restoring the ex-club-member chat leak `034` shipped in draft and fixed
- **AND** anything needing to know whether a **specific other** rider can see a ride SHALL ask a
  candidate-relative predicate instead, per the `candidate-relative-visibility` capability, rather
  than widening this policy

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
- **AND** this SHALL hold even while they still hold a `ride_members` row for that ride

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to
- **THEN** zero rows SHALL be returned
- **AND** this SHALL hold even while they still hold a `ride_members` row for that ride

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

#### Scenario: The policy text itself is pinned, because a fan-out now restates it
- **WHEN** `rides` SELECT is reviewed, refactored or replaced
- **THEN** its full `qual` text SHALL be pinned by an assertion whose label names
  `private.can_read_ride`, so a rewrite fails the suite with a pointer at the function that
  restates it rather than silently turning a fan-out's recipient set into a wrong answer
- **AND** the pin SHALL be understood as deliberately brittle: it fails on a cosmetic reformat as
  well as on a semantic change, which costs one session five minutes and is the cheaper of the two
  errors
- **AND** `clubs` SELECT SHALL carry the **twin** pin, labelled with `private.can_read_club`,
  because `ride_created_in_club` restates both policies and one pin covers only one of them
- **AND** neither pin SHALL be read as covering the helper bodies its policy text delegates to —
  an arm added to `private.is_club_member` leaves both `qual` texts byte-identical, so that
  function carries its own pin, by equality
- **AND** the two structural pins that already exist — that the policy leads with an unconditional
  organizer arm, and that it has no crew arm — SHALL remain, because neither catches a rewrite of
  the middle of the policy
