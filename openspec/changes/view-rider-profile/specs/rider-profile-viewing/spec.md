## Purpose

Governs the screen on which one signed-in rider views another rider: who may reach it, exactly
which columns of that rider it may show, what it must never show or imply, and how it behaves in
every state including the ones where the answer is zero rows.

## ADDED Requirements

### Requirement: The route SHALL address a rider by immutable id

The screen SHALL be reached at `/profile/detail?id=<uuid>`, addressing the subject by
`profiles.id`. It SHALL NOT address them by username.

A username is unique but **mutable** — `database-enforced-integrity` states a rider *"SHALL change
it to another valid value"* and only forbids returning it to NULL — so a username URL rots the day
its subject renames, silently resolving to nothing or, after a rename cycle, to somebody else. The
id is immutable, is already present in every byline payload via `PUBLIC_PROFILE_COLUMNS`, and
matches all ten existing detail routes.

#### Scenario: A valid id for a visible rider

- **WHEN** a signed-in rider opens `/profile/detail?id=<uuid>` for a rider the `profiles` SELECT
  policy admits to them
- **THEN** the screen SHALL render that rider's profile

#### Scenario: A malformed id is a not-found

- **WHEN** the `id` parameter is absent, empty, or not a UUID
- **THEN** the screen SHALL render not-found, through the id schema the read already carries,
  matching `rideIdSchema`/`clubIdSchema` behaviour and `client-render-shell`'s *A malformed id is
  a not-found, not an error*
- **AND** it SHALL NOT surface a Postgres `22P02` as an error state

#### Scenario: A well-formed id for a rider who is not visible

- **WHEN** the `id` is a valid UUID and the read returns zero rows, for any reason
- **THEN** the screen SHALL render one single not-found state
- **AND** that state SHALL be byte-identical regardless of *which* reason applies, so that it
  cannot be used to test whether a given id exists

### Requirement: The audience SHALL be every signed-in rider with a username, minus blocks, and SHALL NOT require a shared club

The set of riders who may view a given subject SHALL be decided by the `profiles` SELECT policy
and by nothing in the client, and the screen SHALL NOT add, narrow or duplicate any audience term
of its own. Measured on DEV `fpmrimzxadewsaiwpsel`, that policy is
`(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))`.

**A shared club is NOT required**, and this is stated positively because it is the rule a reviewer
is most likely to assume in the opposite direction: club membership gates a *club's* content, not
a rider's identity.

#### Scenario: Any signed-in rider, sharing no club with the subject

- **WHEN** a signed-in rider with no `club_members` row in common with the subject opens the
  subject's profile, and the subject has a username and no block exists in either direction
- **THEN** the profile SHALL render

#### Scenario: Club owner, admin, member and non-member

- **WHEN** a rider holding `club_members.role` of `owner`, `admin` or `member`, or holding no
  membership at all, opens the subject's profile
- **THEN** all four SHALL see exactly the same columns, because no role confers any additional
  reach into another rider's identity
- **AND** none of them SHALL be offered any affordance to edit the subject

#### Scenario: The viewer has blocked the subject

- **WHEN** rider A has blocked rider B, and A opens B's profile by id
- **THEN** zero rows SHALL be returned and the not-found state SHALL render
- **AND** the screen SHALL NOT indicate that a block is the reason, per `client-render-shell`'s
  *A blocked rider sees an ordinary absence*

#### Scenario: The subject has blocked the viewer

- **WHEN** rider B has blocked rider A, and A opens B's profile by id
- **THEN** the outcome SHALL be identical to the previous scenario, because `private.is_blocked`
  matches the pair in either order — the row is directional, the effect is symmetric

#### Scenario: The subject has no username

- **WHEN** the subject's `username` is NULL — a rider who accepted terms but has not yet passed
  the username step, which is reachable because the participation gate checks consent rather than
  username
- **THEN** zero rows SHALL be returned and the not-found state SHALL render
- **AND** no link to that rider SHALL be rendered anywhere, because their author embed resolves to
  null and the byline falls back to plain text

#### Scenario: The subject does not exist

- **WHEN** the `id` is a well-formed UUID matching no `profiles` row
- **THEN** the not-found state SHALL render, indistinguishable from every other zero-row case

#### Scenario: The subject deleted their account

- **WHEN** a rider deletes their account and another rider opens a previously working link to them
- **THEN** the not-found state SHALL render, because `profiles` is removed and there is no
  tombstone
- **AND** no dangling link SHALL survive elsewhere, because `postcards.author_id`,
  `postcard_comments.author_id`, `ride_messages.author_id`, `ride_members.user_id` and
  `club_members.user_id` are all `ON DELETE CASCADE`, so the postcards and comments carrying those
  bylines are removed with the rider

#### Scenario: A signed-out visitor

- **WHEN** a request for this route arrives with no session
- **THEN** the route guard SHALL send them to `/auth/login`, the route being protected by default
  under the guard's public-path denylist
- **AND** a visitor who defeats the guard SHALL still read nothing, because `anon` holds zero
  grants on `profiles` — decision #1, asserted rather than granted

#### Scenario: The subject is the viewer

- **WHEN** a rider opens `/profile/detail?id=<their own id>`
- **THEN** they SHALL be redirected to `/profile`
- **AND** the redirect SHALL be decided from the session id before the profile read is issued, so
  that the owner screen is never rendered twice in two different shapes

### Requirement: The screen SHALL show exactly seven columns of the subject, and SHALL name them

The screen SHALL read `id, username, avatar_path, cover_image_path, bio, location, created_at` and
no others. Each is already granted to `authenticated` by `025`, so this requires no migration; the
allowlist is a **projection** decision, not a permission one, and it is written down because
nothing in the database would refuse a wider one.

`terms_accepted_at`, `onboarding_completed_at` and `terms_version` SHALL NOT be read. They carry
no grant to `authenticated` at all, so naming one turns the whole read into a `42501` — the
allowlist is what keeps the screen working, as well as what keeps it honest.

#### Scenario: The projection is a subset of the grant

- **WHEN** the viewed-profile column allowlist is compared against `025`'s
  `grant select (...) on public.profiles to authenticated`
- **THEN** every column in the allowlist SHALL appear in the grant
- **AND** the check SHALL be a test that reads the migration, not a comment asserting it

#### Scenario: Consent and lifecycle stamps are never shown

- **WHEN** the screen renders any "member since" or account-age affordance
- **THEN** it SHALL derive it from `created_at` only
- **AND** SHALL NOT read `onboarding_completed_at` or `terms_accepted_at`, which
  `database-enforced-integrity` requires stay unreadable by other riders

#### Scenario: The wider projection does not leak into shared contexts

- **WHEN** a member list, ride crew, postcard byline or filter tile renders a rider
- **THEN** it SHALL keep using the four-column `PUBLIC_PROFILE_COLUMNS`
- **AND** the seven-column allowlist SHALL be used only by this screen, so that a bio is not
  shipped to every list that draws a name

### Requirement: The subject's clubs SHALL NOT be listed

The screen SHALL NOT render the clubs the subject belongs to.

A club roster's visibility is its own predicate, and a list of a rider's clubs is a re-derivation
of it from the other side: listing them would tell a non-member that the subject belongs to a
private club, which no policy on `club_members` intends to disclose. The design's header does not
draw a clubs section, so this costs nothing today — it is written down so that adding one later is
a decision rather than a fill-in-the-blank.

#### Scenario: A private club is not disclosed by the profile

- **WHEN** the subject is a member of a private club that the viewer is not a member of
- **THEN** the profile screen SHALL NOT reveal that membership by any affordance, including a
  count, a badge or an avatar strip

### Requirement: The timeline SHALL be the subject's postcards filtered by the viewer's own audience

The screen SHALL render the subject's postcards using the existing rider feed filter, so that the
`postcards` SELECT policy decides the contents per viewer.

#### Scenario: A club postcard the viewer cannot see

- **WHEN** the subject has authored a postcard scoped to a club the viewer is not a member of
- **THEN** that postcard SHALL NOT appear in the timeline
- **AND** this SHALL be enforced by the policy's `club_id IS NULL OR private.is_club_member(club_id)`
  arm, never by a client-side filter

#### Scenario: A postcard the viewer has hidden

- **WHEN** the viewer has hidden one of the subject's postcards
- **THEN** it SHALL be absent from the timeline, by the same policy that hides it in the feed

#### Scenario: The postcard count is per-viewer

- **WHEN** the screen displays any count of the subject's postcards
- **THEN** that count SHALL be computed from the rows this viewer can actually see
- **AND** it SHALL NOT be presented as a fact about the rider, nor cached across viewers, per
  `client-cache-invalidation`'s *Counts SHALL stay per-viewer*

### Requirement: The screen SHALL define every state it can be in

The screen SHALL render a defined state for each of first paint, decided-absent, empty, error,
offline, partial and stale, and SHALL NOT leave any of them to whatever a component happens to do
with missing data.

#### Scenario: First paint

- **WHEN** the screen mounts and the profile read has not answered
- **THEN** it SHALL render a skeleton
- **AND** it SHALL gate on the absence of data, never on `isLoading`, which is `false` on the
  first render pass before the effect has started the fetch

#### Scenario: Decided-absent versus not-yet

- **WHEN** the profile read returns `null`
- **THEN** the screen SHALL render not-found
- **AND** `undefined` SHALL render the skeleton instead, so that a detail screen does not flash a
  404 on every load

#### Scenario: The subject has no bio, no cover and no countries

- **WHEN** the subject has completed onboarding but filled in nothing optional
- **THEN** the screen SHALL render the avatar, username and timeline without empty section
  headings
- **AND** an absent cover SHALL render the banner's fallback treatment rather than a broken image

#### Scenario: The subject has no postcards visible to this viewer

- **WHEN** the timeline read returns zero rows
- **THEN** the screen SHALL render an empty timeline state beneath a fully-rendered header
- **AND** that state SHALL NOT claim the rider has posted nothing, because the viewer's audience
  is what produced the zero

#### Scenario: The profile read fails

- **WHEN** the profile read fails for a reason other than zero rows
- **THEN** the screen SHALL render an error state offering a retry
- **AND** it SHALL NOT be conflated with not-found

#### Scenario: Offline

- **WHEN** the read fails for lack of connectivity
- **THEN** the screen SHALL report offline rather than not-found, per `client-render-shell`'s
  *Every screen SHALL define its offline behaviour*

#### Scenario: Partial

- **WHEN** the profile resolves but the timeline read fails
- **THEN** the header SHALL stay rendered and the failure SHALL be confined to the timeline
  section, which SHALL offer its own retry

#### Scenario: Stale after a block

- **WHEN** the viewer blocks the subject while the subject's profile is cached
- **THEN** the cached row SHALL be evicted, which `blockRider`'s existing blanket invalidation
  already performs
- **AND** a subsequent read SHALL return zero rows from the database rather than being filtered by
  the component

### Requirement: The links reaching this screen SHALL be stated, and SHALL NOT render for an unresolvable author

Every surface linking to this screen SHALL be named in this spec, and each link SHALL be gated on
its subject resolving, so that a rider the viewer cannot see produces plain text rather than a
link to a screen that will render not-found.

#### Scenario: The postcard byline

- **WHEN** a postcard's author resolves
- **THEN** the avatar and the username SHALL together form one link to that author's profile
- **AND** the link SHALL NOT alter the byline's drawn appearance — no underline and no colour of
  its own — matching how the club link on the same row was built

#### Scenario: An unresolvable author

- **WHEN** a postcard's author embed is null, which happens when the author's username is NULL
  and the `profiles` policy therefore withholds the row while the postcard itself remains visible
- **THEN** the byline SHALL render its existing plain-text fallback and SHALL NOT be a link
- **AND** no empty tap target SHALL be rendered, for the same reason the club link is gated on the
  club's name rather than on the club

#### Scenario: The byline link inside the swipe deck

- **WHEN** a rider swipes a postcard starting from the byline
- **THEN** the swipe SHALL be swallowed and SHALL NOT navigate
- **AND** a tap SHALL navigate, on the same mechanism that already makes the club link and
  `CommentsLink` safe inside the deck

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

The design frame `Profile / View someone else's profile / Profile - Prescoll header` (`2084:9006`)
draws four affordances this system has no data for. They SHALL be absent, and SHALL NOT be
rendered as zeroes or empty states, because an empty header stating `0 followers` asserts a fact
about the rider where the truth is a fact about the app.

#### Scenario: Follow, and the follower count

- **WHEN** the profile header is built
- **THEN** it SHALL NOT render a Follow button and SHALL NOT render a followers count
- **AND** no table, column or action implementing following SHALL be added, because `013` dropped
  `friendships` on 2026-08-04 and the social graph is deliberately clubs plus blocking — a
  follower graph is that dropped concept returning under another name

#### Scenario: The motorcycles count and the Garage switcher

- **WHEN** the profile header is built
- **THEN** it SHALL NOT render a motorcycles count and SHALL NOT render the Timeline/Garage
  switcher
- **AND** the reason SHALL be recorded as the Garage epic being unbuilt, `bike_model` being a
  single text column standing in for it rather than an implementation of it

#### Scenario: The navigation bar

- **WHEN** the screen renders the app's navigation
- **THEN** it SHALL render the app's four tabs
- **AND** SHALL NOT reproduce the five-tab bar in the frame, whose Inbox tab was removed by PD-100
