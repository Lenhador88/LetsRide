# postcard-audience (delta)

## ADDED Requirements

### Requirement: A postcard's audience SHALL be resolved from its entry point and stored on its own row

The composer SHALL NOT ask the rider to choose an audience. The audience SHALL be derived from the
surface the composer was opened from and written into `postcards.club_id` at INSERT.

- Opened from Home → `club_id` NULL, the app-wide feed.
- Opened from a club → that club's id.
- Opened from a ride → the ride's `club_id` when it has one, and NULL when it does not.

The resolution SHALL happen **once**, at insert. No read path SHALL derive a postcard's audience
by resolving `ride_id` to a ride and that ride to a club.

#### Scenario: From Home
- **WHEN** a rider posts from Home
- **THEN** `club_id` SHALL be NULL
- **AND** every signed-in rider who has not blocked the author and has not hidden the postcard
  SHALL be able to read it

#### Scenario: From a club
- **WHEN** a rider posts from a club they are a member of
- **THEN** `club_id` SHALL be that club
- **AND** only that club's members SHALL be able to read it, plus the author

#### Scenario: From a ride that has a club
- **WHEN** a rider posts from a ride whose `club_id` is set
- **THEN** the postcard SHALL carry that `club_id` as its audience and that ride's id as its tag
- **AND** the audience SHALL be the club's members, **not** the ride's crew

#### Scenario: From a ride with no club
- **WHEN** a rider posts from a ride whose `club_id` is NULL
- **THEN** `club_id` SHALL be NULL and the postcard SHALL be app-wide
- **AND** the copy SHALL say so, rather than describing the crew

#### Scenario: The chain is not walked at read time
- **WHEN** a ride's `club_id` changes, by an organizer's edit or by a club deletion setting it NULL
- **THEN** the audience of every postcard already tagged to that ride SHALL be unchanged
- **AND** no policy, view or accessor SHALL exist that would have moved it

### Requirement: `ride_id` SHALL NOT appear in any audience predicate

`ride_id` is a tag. It decides who may **write** it — the ride must be visible to the tagger under
their own RLS, and `private.is_ride_crew` must be true — and it decides nothing about who may read
the row.

`ride_id` SHALL remain absent from every SELECT policy, from `authenticated`'s SELECT grant on
`postcards`, and from every UPDATE grant.

#### Scenario: The SELECT policy is unchanged
- **WHEN** the postcards SELECT policy is read back after this change
- **THEN** it SHALL be byte-identical to the policy before it
- **AND** it SHALL mention `ride_id` nowhere

#### Scenario: The column grants are unchanged
- **WHEN** `authenticated`'s column privileges on `postcards` are read back
- **THEN** `ride_id` SHALL be present on INSERT and absent from SELECT and UPDATE
- **AND** the UPDATE list SHALL be exactly `caption, club_id, image_path`, or narrower if question
  A is answered

#### Scenario: The tag's own write gate stands
- **WHEN** a rider tags a postcard to a ride
- **THEN** the ride SHALL be visible to them under their own RLS **and** `private.is_ride_crew`
  SHALL be true
- **AND** neither test alone SHALL be sufficient, a foreign key being validated with RLS bypassed
  and the crew helper being `security definer`

#### Scenario: A nonexistent and an invisible ride are refused identically
- **WHEN** a rider tags a postcard to a ride id that does not exist, or to one they cannot see
- **THEN** both SHALL be refused with `42501`
- **AND** the refusal SHALL NOT distinguish the two, since the distinction is an existence oracle

### Requirement: A rider who cannot write into the resolved audience SHALL be refused, and told why

When the resolved audience is a club the rider is not a member of, the post SHALL be refused. It
SHALL NOT fall back to the app-wide feed and SHALL NOT fall back to an untagged postcard.

The refusal SHALL be an explained state naming the club and the reason, reachable **before** the
submit rather than only as a failed insert. It SHALL NOT surface as the composer's generic
`'Could not post that. Try again.'`, which is false here: retrying cannot succeed.

#### Scenario: Crew who are not club members
- **WHEN** a rider who is crew of a public ride belonging to a club they are not a member of opens
  the composer from that ride
- **THEN** the composer SHALL show the refusal and its reason
- **AND** SHALL NOT offer a Post action that produces a `42501`

#### Scenario: No silent widening
- **WHEN** the refusal state is reached
- **THEN** no path SHALL write the postcard with `club_id` NULL
- **AND** no path SHALL write it with `ride_id` NULL

#### Scenario: The database refuses it regardless of the UI
- **WHEN** a hand-rolled request inserts a postcard whose `club_id` names a club the author is not
  a member of
- **THEN** the postcards INSERT policy SHALL reject it with `42501`
- **AND** that policy SHALL remain the enforcement, the composer's control being a convenience

#### Scenario: The upload is not spent on a refusal that was knowable
- **WHEN** the composer can determine before submit that the audience will refuse the author
- **THEN** it SHALL say so before the image is uploaded, or SHALL account for the orphaned Storage
  object it creates

#### Scenario: The loss is permanent and is stated
- **WHEN** a rider is refused from a ride's journal
- **THEN** the copy SHALL NOT imply the postcard can be attached to that ride later
- **AND** `ride_id` SHALL remain absent from every UPDATE grant, so no later attachment is possible

### Requirement: The composer's audience line SHALL describe the row that will be written

The line SHALL state the **audience**, not the source: *"Only &lt;club&gt; members see this"*,
never *"Club postcard — &lt;club&gt;"*.

It SHALL be computed from the resolved `club_id` — the value that will actually be inserted — by a
pure function with its own test, following `resolveLocationCopy`'s contract and for the same
reason: a composer whose copy describes a row it will not write is a defect that cannot be seen by
looking at the screen.

#### Scenario: A clubless ride does not say "the crew"
- **WHEN** the composer is opened from a ride with no club
- **THEN** the line SHALL say every signed-in rider can see it
- **AND** SHALL NOT say the crew, the ride, or the people on it

#### Scenario: A club ride does not say "the crew" either
- **WHEN** the composer is opened from a ride whose club the rider belongs to
- **THEN** the line SHALL name the club's members
- **AND** SHALL NOT imply the audience is the crew, which is neither a subset nor a superset of it

#### Scenario: Every state has a sentence
- **WHEN** any of the five entry-point states is rendered — Home, a club, a clubless ride, a club
  ride the rider belongs to, a club ride they do not
- **THEN** the line SHALL be defined for it
- **AND** a test SHALL cover each, including the refusal

#### Scenario: The line never over-promises privacy
- **WHEN** the audience is a club
- **THEN** the line SHALL claim only that non-members cannot see it
- **AND** SHALL NOT claim the postcard is private, hidden, or limited to the crew

## MODIFIED Requirements

### Requirement: Postcard visibility SHALL be stated per role

Every role that can reach a postcard SHALL have its access stated so each line maps onto an
assertion. The set is unchanged by this change — what changes is which rows land in which audience
— so the statement is restated here in full, against the live policy.

#### Scenario: Author
- **WHEN** the author reads their own postcard
- **THEN** it SHALL be returned regardless of `club_id`, including a postcard posted to a club they
  have since left, and regardless of any block

#### Scenario: Any signed-in rider, app-wide postcard
- **WHEN** a signed-in rider reads a postcard with `club_id` NULL
- **THEN** it SHALL be returned, unless they are blocked by the author or have hidden it

#### Scenario: Club member
- **WHEN** a member of the postcard's club reads it
- **THEN** it SHALL be returned, unless blocked or hidden
- **AND** a club **owner** holding no `club_members` row SHALL count as a member, per `054`

#### Scenario: Club admin
- **WHEN** a rider whose `club_members.role` is `admin` reads a postcard in that club
- **THEN** it SHALL be returned exactly as for a member
- **AND** the role SHALL confer no moderation power over it — postcard writes stay `author_id`-keyed

#### Scenario: Non-member of the postcard's club
- **WHEN** a signed-in rider who is not a member of the postcard's club reads it
- **THEN** zero rows SHALL be returned
- **AND** this SHALL hold even where they can see the ride the postcard is tagged to, and even
  where they are crew of it

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the author reads the postcard, by any route including a club they
  both belong to
- **THEN** zero rows SHALL be returned, and blocking SHALL remain symmetric

#### Scenario: A viewer who hid it
- **WHEN** a rider who has written a `postcard_hides` row for the postcard reads it
- **THEN** zero rows SHALL be returned, independently of the audience

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no privilege on `postcards` in any
  verb and no policy targets it
- **AND** the visitor SHALL continue to reach the app shell and `/legal/*` and no data
