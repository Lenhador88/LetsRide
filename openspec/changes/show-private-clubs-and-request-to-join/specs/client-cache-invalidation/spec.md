## ADDED Requirements

### Requirement: A mutation that moves a rider between two halves of one list SHALL invalidate the list itself, not the half

`getExploreClubs` returns one array assembled from two reads — the public `clubs` page and
`discoverable_private_clubs` — under **one** key, `queryKeys.clubs.explore(...)`. Every mutation
below SHALL claim that key by name, and SHALL NOT claim a narrower one on the reasoning that only
one half changed.

| Mutation | Claims |
|---|---|
| `requestToJoinClub(clubId)` | `clubs.explore(...)` — the card's control changes; and `clubs.joinRequests(clubId)` for the admin list |
| `withdrawJoinRequest(clubId)` | the same two |
| `approveClubJoinRequest(requestId)` | **`clubs.all()`** — the club moves from Explore to Your clubs, the roster gains a member, the detail's `viewer_role` changes, and the club picker on the create-ride and create-postcard forms gains an option; plus `postcards.feed(club:<id>)` and `rides.list(club:<id>)`, exactly as `invalidateClubMembership` already does; plus both notification keys |
| `declineClubJoinRequest(requestId)` | `clubs.explore(...)`, `clubs.joinRequests(clubId)` and both notification keys |

`approveClubJoinRequest` SHALL reuse `invalidateClubMembership` rather than enumerate club keys of
its own. An enumeration looks narrower and misses `clubs.mine()`, which is the picker nobody
remembers, and that is the recorded reason `joinClub` claims the whole `clubs` prefix.

#### Scenario: An approval reaches every club surface
- **WHEN** an approval succeeds
- **THEN** Your clubs, Explore, the club detail, the roster, the club picker, the club's postcard
  feed and the club's ride list SHALL all be invalidated
- **AND** the invalidation SHALL be justified against `keys.ts`'s stated prefix reach, not against
  intuition

#### Scenario: A request does not claim the membership keys
- **WHEN** a request is made or withdrawn
- **THEN** `postcards.feed(club:<id>)` and `rides.list(club:<id>)` SHALL NOT be invalidated, because
  no membership moved and nothing behind those keys can have changed

#### Scenario: The approving admin's own view moves too
- **WHEN** an admin approves from the club detail
- **THEN** the pending-request list, the roster and the member count SHALL all redraw from one call

### Requirement: A key SHALL NOT be added without a reader, and the preview key SHALL be separate from the detail key

`queryKeys.clubs.preview(clubId)` SHALL be its own key and SHALL NOT share
`queryKeys.clubs.detail(clubId)`. The two hold different shapes — a `ClubDetail` and a narrow
`ClubPreview` — and a shared key would serve whichever landed first to whichever screen asked
second.

`queryKeys.clubs.joinRequests(clubId)` SHALL sit under the club, so `clubs.detail(clubId)`'s prefix
reaches it and an approval that claims `clubs.all()` reaches it too.

No key SHALL be added for which no read exists. A key nothing fills is worse than none: it carries
an invalidation claim about an entry that never exists.

#### Scenario: The preview and the detail cannot serve each other
- **WHEN** a rider is approved into a club whose preview they had loaded
- **THEN** the detail read SHALL run fresh rather than being served the preview's narrower shape

#### Scenario: The prefix reach is documented positively
- **WHEN** the three new keys are added
- **THEN** `keys.ts`'s header SHALL state which prefixes reach each of them, stated positively, in
  the table that file already carries for exactly this purpose

### Requirement: A count and the list it summarises SHALL be read through the same predicate

Any badge showing an admin how many requests are pending SHALL be derived from the same read that
draws the list, in the same round trip — never from a separate `count` query.

`club_unread_counts()` SHALL NOT be extended to include join requests by this change, and the
omission SHALL be stated: a club's unread badge counts postcards and threads, and a pending request
is a different kind of thing addressed to a different subset of the club.

#### Scenario: The badge and the list agree by construction
- **WHEN** the request section renders
- **THEN** its count SHALL be the length of the array it renders
- **AND** there SHALL be no second query that could disagree with it one tap away

#### Scenario: The club badge is unchanged
- **WHEN** a request arrives for a club
- **THEN** `club_unread_counts()` SHALL return what it returns today
- **AND** the admin SHALL learn of the request through the notification list, which is the surface
  that already exists for events addressed to one rider
