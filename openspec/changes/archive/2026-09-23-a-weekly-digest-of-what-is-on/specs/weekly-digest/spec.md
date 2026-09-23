## ADDED Requirements

### Requirement: The weekend digest SHALL be defined by one candidate-relative body that no client role can reach

The content of the weekend digest SHALL be computed in exactly one place:
`private.weekend_digest_for(candidate uuid, at timestamptz, near_lat double precision, near_lon
double precision)`. It SHALL be `security definer` with `search_path` pinned empty, and every
reference in it SHALL be schema-qualified. EXECUTE SHALL be revoked from `public`, `anon`,
`authenticated` and `service_role`.

The body SHALL be candidate-relative:

- It SHALL NOT call `auth.uid()`, `private.is_club_member(` or `private.is_ride_crew(`.
- Every audience decision SHALL be a call to an existing pinned helper: `private.can_read_ride`,
  `private.can_read_club_thread`, `private.is_club_member_for` or `private.is_blocked`.
- It SHALL test blocking itself, in both directions, and SHALL NOT rely on a caller's RLS.

It SHALL NOT read:

- `profiles.rides_from`, which is never a position;
- `profiles.digest_opt_out_at`, which is a preference and not a content rule.

A NULL `candidate` SHALL yield zero rows.

#### Scenario: No client role can execute the body
- **WHEN** EXECUTE on `private.weekend_digest_for` is checked for `authenticated`, `anon` and
  `service_role`
- **THEN** `has_function_privilege` SHALL be false for each
- **AND** the assertion SHALL name the role rather than attempt the call, because the suite runs
  as the owner

#### Scenario: The body is checkably candidate-relative
- **WHEN** the body's `prosrc` is read with `--` comments stripped
- **THEN** it SHALL contain none of `auth.uid(`, `private.is_club_member(`,
  `private.is_ride_crew(`, `rides_from` or `digest_opt_out_at`
- **AND** the assertion SHALL be verified both ways: it SHALL fail against a scratch body that
  names one of them

#### Scenario: No subject, no content
- **WHEN** the body is called with a NULL candidate
- **THEN** it SHALL return zero rows and SHALL NOT raise

### Requirement: "This weekend" SHALL be decided in each ride's own zone

A ride SHALL be in "this weekend" at instant `at` only when all three conditions below hold,
where `Z` is `coalesce(rides.timezone, 'Europe/Amsterdam')`:

1. its `departure_at` is after `at`;
2. its local date in `Z` is a Saturday or a Sunday;
3. that local date falls in the same ISO week (Monday to Sunday) as `at`'s local date in the same
   `Z`.

No rider zone SHALL be consulted, and the database server's zone SHALL NOT be used.

#### Scenario: A weekday means the coming weekend
- **WHEN** `at` is a Wednesday in the ride's zone and the ride departs that week's Saturday
- **THEN** the ride SHALL be in this weekend
- **AND** a ride departing the following week's Saturday SHALL NOT be

#### Scenario: A weekend day means what is left of it
- **WHEN** `at` is Saturday afternoon in the ride's zone
- **THEN** a ride departing that Sunday SHALL be in this weekend
- **AND** a ride that departed that Saturday morning SHALL NOT be

#### Scenario: The ride's own zone decides, not Amsterdam's
- **WHEN** a ride's `timezone` is `America/Los_Angeles` and it departs Friday 20:00 local, which
  is Saturday in `Europe/Amsterdam`
- **THEN** it SHALL NOT be in this weekend

### Requirement: "Near" SHALL be measured from a position the caller passes, rounded by the body

A ride SHALL be near only when it has a start coordinate and lies within `NEARBY_RADIUS_KM` =
100 km of the position passed as `near_lat` and `near_lon`. The comparison is inclusive. The
distance SHALL be computed with the haversine formula and the 6371.0088 km mean radius that
`src/lib/location/distance.ts` uses.

The body SHALL round the position to 2 decimal places before it uses it, whoever the caller is:

- Both arguments NULL SHALL mean "no position".
- Exactly one NULL, or a value outside `[-90, 90]` × `[-180, 180]` (including `NaN` and
  infinities), SHALL raise `22023`.

A ride with NULL coordinates SHALL NOT be near anything.

#### Scenario: A ride past the radius is not near
- **WHEN** a qualifying ride lies 101 km from the passed position
- **THEN** it SHALL NOT appear, and one at 99 km SHALL

#### Scenario: A ride with no coordinate is not near
- **WHEN** a qualifying ride has NULL `latitude` and `longitude`
- **THEN** it SHALL NOT appear in the rides section

#### Scenario: No position empties the rides section only
- **WHEN** both position arguments are NULL
- **THEN** no ride row SHALL be returned
- **AND** the clubs section SHALL still be computed and returned

#### Scenario: A malformed position is refused
- **WHEN** exactly one position argument is NULL, or either is `NaN` or out of range
- **THEN** the call SHALL raise `22023`

### Requirement: The rides section SHALL exclude what the rider cannot read, organises, has answered or shares a block with

A ride SHALL appear in the rides section only when it is in this weekend, near the position, and
meets all of the following for the candidate:

- `private.can_read_ride(candidate, ride)` is true;
- the candidate is not its `organizer_id`;
- the candidate holds no `ride_members` row for it (neither `going` nor `maybe`);
- `private.is_blocked(candidate, organizer_id)` is false.

The section SHALL be ordered by `departure_at`, then distance, then `id`, and SHALL hold at most
5 rides.

#### Scenario: A blocked organiser's ride is absent in both directions
- **WHEN** the candidate has blocked a qualifying ride's organiser, and separately when that
  organiser has blocked the candidate
- **THEN** the ride SHALL NOT appear in either case

#### Scenario: A public ride in a private club is absent for a non-member
- **WHEN** a qualifying ride has `is_public = true` in a private club the candidate is not a member
  of, and the candidate holds no live invite to it
- **THEN** it SHALL NOT appear
- **AND** it SHALL appear for a member of that club

#### Scenario: A live ride invite makes the ride eligible, and a declined one does not
- **WHEN** the candidate holds a `pending` `ride_invites` row for a qualifying ride in a private club
- **THEN** the ride SHALL appear, because `083`'s arm already lets the candidate read it
- **AND** after the invite is declined it SHALL NOT appear

#### Scenario: A ride the rider organises or answered is absent
- **WHEN** the candidate organises a qualifying ride, or holds a `going` or `maybe` row for one
- **THEN** that ride SHALL NOT appear

### Requirement: The clubs section SHALL name only the rider's own clubs and SHALL count only rows the rider can read from riders they share no block with

A club SHALL appear in the clubs section only when `private.is_club_member_for(candidate, club)` is
true. For each club, two counts are computed.

`new_rides` SHALL count rides that meet all of these:

- the ride is in that club;
- it was created in the 7 days before `at`;
- it departs after `at`;
- the candidate did not organise it;
- its organiser is not blocked with the candidate;
- `private.can_read_ride(candidate, ride)` is true.

`new_threads` SHALL count `club_threads` that meet all of these:

- the thread is in that club;
- it was created in the 7 days before `at`;
- the candidate did not write it;
- its author is not blocked with the candidate;
- `private.can_read_club_thread(candidate, thread)` is true.

A club SHALL appear only when the two counts sum to more than zero. The section SHALL be ordered
by that sum descending, then club name, then club id, and SHALL hold at most 5 clubs.

The body SHALL read no admin-only table, so owner, admin and member receive identical counts for
the same club.

#### Scenario: A private club's activity never reaches a non-member
- **WHEN** a private club gains rides and threads this week and the candidate is not a member
- **THEN** no row SHALL name that club, and no count SHALL include its rows

#### Scenario: A pending club invite grants nothing
- **WHEN** the candidate holds a `pending` `club_invites` row for a private club
- **THEN** the clubs section SHALL NOT name that club

#### Scenario: A removed member loses the club on the next read
- **WHEN** the candidate is removed from a club (a `club_removals` row, no `club_members` row)
- **THEN** the next call SHALL NOT name that club, or count anything from it

#### Scenario: Blocked authors are not counted, in either direction
- **WHEN** a club the candidate belongs to gained five threads this week, two of them by a rider
  blocked with the candidate in either direction
- **THEN** `new_threads` SHALL be 3
- **AND** the same SHALL hold for `new_rides` and a blocked organiser

#### Scenario: The rider's own activity is not news to them
- **WHEN** the candidate created a ride or a thread in their club this week
- **THEN** neither SHALL be counted

#### Scenario: An admin sees what a member sees
- **WHEN** an admin and a plain member of the same club, with no blocks, are evaluated at one `at`
- **THEN** their rows for that club SHALL be identical

### Requirement: A rider with nothing to show SHALL get zero rows, and nothing SHALL synthesise an empty digest

When both sections are empty, the body SHALL return zero rows. It SHALL NOT return a row with a
zero count, a placeholder or a "quiet week" marker. Zero rows is the whole signal. The in-app
screen renders its empty state from it, and no consumer SHALL turn it into content.

#### Scenario: Nothing to show is zero rows
- **WHEN** the candidate has no qualifying ride and no club with activity
- **THEN** the body SHALL return zero rows

#### Scenario: A club with no activity gets no row
- **WHEN** a club the candidate belongs to had nothing new this week
- **THEN** no row SHALL name it, rather than a row with both counts at zero

### Requirement: The reader SHALL answer only for its caller, and SHALL return identifiers, order and counts rather than content

`public.my_weekend_digest(near_lat double precision default null, near_lon double precision default
null)` SHALL be `security definer` with `search_path` pinned empty. Its body SHALL be exactly a
delegation: `private.weekend_digest_for((select auth.uid()), pg_catalog.now(), near_lat,
near_lon)`. That text SHALL be pinned by equality. EXECUTE SHALL be revoked from `public` and
`anon` and granted to `authenticated`.

It SHALL return only `section`, `ordinal`, `ride_id`, `club_id`, `new_rides` and `new_threads`. The
client SHALL read the ride and club rows for those ids under its own RLS. An id the caller's RLS
does not return SHALL be dropped without a gap. RLS remains the last gate on everything that
renders.

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** EXECUTE on `my_weekend_digest` is checked for `anon`
- **THEN** it SHALL be false
- **AND** a signed-out visit to `/rides/weekend` SHALL be redirected to `/auth/login`, reaching the
  shell and no data

#### Scenario: A call with no subject is empty
- **WHEN** the reader is called with no JWT subject, as by `service_role` or in the RLS suite
- **THEN** it SHALL return zero rows

#### Scenario: The wrapper cannot grow an arm unnoticed
- **WHEN** the wrapper's `prosrc` is compared with the delegation text
- **THEN** it SHALL be equal, and a `like` match SHALL NOT be accepted in its place

#### Scenario: An id RLS withholds renders nothing
- **WHEN** the reader names a ride id the caller's `rides` SELECT does not return
- **THEN** the data function SHALL omit it, keep the others in the reader's order, and render no
  placeholder

#### Scenario: No column is returned that the rider cannot already read
- **WHEN** the reader's result columns are listed
- **THEN** they SHALL be exactly the six above, and a column added later SHALL fail the assertion

### Requirement: The digest SHALL have its own opt-out, readable and writable by that rider alone, and it SHALL NOT be a gate

`profiles.digest_opt_out_at` SHALL be nullable, with no default and no backfill. The migration
SHALL issue no `grant` or `revoke` on `public.profiles`, so `authenticated` holds no SELECT,
INSERT or UPDATE on the column. `096.1`'s widths stay 10/8/8.

The only reach SHALL be two own-row `security definer` RPCs, each taking no rider id, with
EXECUTE revoked from `public` and `anon` and granted to `authenticated`:

- `public.my_digest_opt_out()` returns the stamp;
- `public.set_digest_opt_out(p_opt_out boolean)` records it:
  - `true` stamps `now()` and keeps an existing stamp;
  - `false` sets NULL.

The column SHALL be independent of `analytics_opt_out_at` in both directions. The stamp SHALL NOT
change what the reader returns or what any screen shows.

#### Scenario: Another rider cannot read or write it
- **WHEN** grants on `profiles.digest_opt_out_at` are checked for `authenticated`
- **THEN** `has_column_privilege` SHALL be false for select, insert and update
- **AND** the RPCs' identity arguments SHALL be `''` and `'p_opt_out boolean'`, so a foreign stamp
  is unrepresentable

#### Scenario: Setting it twice keeps the first stamp
- **WHEN** a rider calls `set_digest_opt_out(true)` twice
- **THEN** the stamp SHALL equal the first call's
- **AND** `set_digest_opt_out(false)` SHALL then return and store NULL

#### Scenario: Opting out of one does not opt out of the other
- **WHEN** a rider sets the digest opt-out
- **THEN** `analytics_opt_out_at` SHALL be unchanged
- **AND** the converse SHALL be asserted separately

#### Scenario: An opted-out rider keeps the screen
- **WHEN** an opted-out rider and an otherwise identical rider who is not opted out call the reader
- **THEN** both SHALL receive the same rows

### Requirement: The opt-out control SHALL NOT promise a send that does not exist

While no digest is delivered, the opt-out control's copy SHALL say that the round-up arrives
once push notifications are switched on, and that it can be turned off now. It SHALL NOT state or
imply that anything is assembled or sent today.

#### Scenario: The copy is honest about today
- **WHEN** `NotificationsSheet` renders
- **THEN** its copy SHALL name what the round-up will contain and that it depends on push being
  switched on
- **AND** it SHALL NOT claim that a round-up is put together or sent now

### Requirement: The weekend screen SHALL define every state, and SHALL be entered by a tap from outside a tab root's strip slot

`/rides/weekend` SHALL read the position and the digest in effects, never during render. It
SHALL gate on data, never on `isLoading`, and SHALL render a decided answer for each state:

- skeleton;
- content;
- empty, which reads "Nothing near you this weekend";
- no position, which is distinct from empty;
- error with retry;
- offline.

Ride times SHALL be formatted by the `formatRide*` helpers with `rides.timezone`.

The screen SHALL be reached from a single row that is not in the strip slot of `/rides` or
`/clubs`. Nothing SHALL open the town question on the rider's behalf.

#### Scenario: Empty and no position are different screens
- **WHEN** the position is known and both sections are empty
- **THEN** the empty state SHALL render
- **AND** when the position is `null` the no-position state SHALL render instead, with the clubs
  section beneath it when that is non-empty

#### Scenario: The town question opens only on a tap
- **WHEN** the no-position state renders
- **THEN** `TownQuestionSheet` SHALL NOT open until the rider taps the row

#### Scenario: An error is not emptiness
- **WHEN** the reader or either hydration read fails
- **THEN** an error state with a retry SHALL render, and the empty state SHALL NOT

#### Scenario: Offline shows the last answer and says so
- **WHEN** the device is offline and a previous answer is cached
- **THEN** the cached answer SHALL render beneath the offline banner

#### Scenario: A tab root keeps one row
- **WHEN** `src/__tests__/one-question-row.test.ts` runs
- **THEN** it SHALL pass unchanged, and neither tab root SHALL render the weekend row in its strip
  slot
