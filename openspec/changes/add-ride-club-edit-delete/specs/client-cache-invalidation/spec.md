## ADDED Requirements

### Requirement: A mutation SHALL invalidate every key whose data the database changed, including rows it did not name

The standing contract is that every read key is spelled in `src/lib/query/keys.ts` and every
mutation invalidates the keys it affects. This change adds the first mutations whose effects reach
**rows the call never mentioned**, so "the keys it affects" is wider than "the keys for the row it
wrote".

- **`updateRide`** SHALL invalidate `rides.detail(rideId)` and `rides.all()`. `rides.all()` rather
  than `rides.list(filter)` alone, because a ride's `club_id` and `is_public` are editable and an
  edit can move it between filter segments — invalidating only the segment it *was* in leaves it
  visible in a list it no longer belongs to.
- **`deleteRide`** SHALL invalidate `rides.all()`, which subsumes `detail`, `crew` and `messages`
  through the shared prefix. It SHALL also invalidate `postcards.all()`, because
  `postcards.ride_id` is `ON DELETE SET NULL` and any postcard tagged to that ride has changed.
- **`updateClub`** SHALL invalidate `clubs.all()` — `yours`, `explore`, `mine` and `detail` are all
  reachable from a name, description or privacy change. **When `is_public` changed, it SHALL also
  invalidate `rides.all()`**, because `propagate_club_privacy_to_rides` rewrote ride rows the call
  never named. A club edit that refreshes only club screens leaves the rides list showing rides as
  public that the database has just made private.
- **`deleteClub`** SHALL invalidate `clubs.all()`, `rides.all()` and `postcards.all()`. All three
  are cascades or sweeps the client did not name: `club_members` and `feed_reads` (club screens),
  `rides` (deleted by the function), `postcards` (cascade).

#### Scenario: A club's privacy is toggled while the rides list is cached

- **WHEN** an owner sets `is_public = false` on a club with public rides
- **THEN** `rides.all()` SHALL be invalidated
- **AND** the rides list SHALL NOT continue to render those rides as public

#### Scenario: A ride is edited into a different club

- **WHEN** an organizer changes a ride's `club_id`
- **THEN** `rides.all()` SHALL be invalidated rather than only the filter segment it came from

### Requirement: A mutation that deletes the resource the current screen reads SHALL navigate before or with the invalidation

`deleteRide` and `deleteClub` are called from a screen whose own query key is about to resolve to
nothing. Invalidating first and navigating second re-runs the detail read against a deleted row,
which returns `null` and trips `notFound()` — a 404 flash on the way out of a successful action.

The delete actions SHALL navigate away from the deleted resource as part of the same interaction,
and the detail screen SHALL NOT be left mounted against an invalidated key for a deleted row.

#### Scenario: An organizer deletes the ride they are looking at

- **WHEN** deletion succeeds on `/rides/detail`
- **THEN** the rider SHALL land on the rides list
- **AND** SHALL NOT see a not-found screen in between
