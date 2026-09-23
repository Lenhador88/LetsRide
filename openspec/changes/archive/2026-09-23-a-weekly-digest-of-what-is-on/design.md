# Design — a weekly "what's on this weekend", part 1

## Context

Measured against DEV (`fpmrimzxadewsaiwpsel`) on **2026-09-22**. Each claim has its command
beside it, so a later reader can re-derive it instead of trusting it.

- **The migration number is `129`.** `list_migrations` ends at `128_a_consented_rider_may_search_places`.
  `supabase_migrations.schema_migrations` holds 131 rows against 128 files. The three extra rows
  are the long-standing hand-applied ones, so nothing else is in flight. Re-derive the number
  when the file is written.
- **The helpers the body composes exist with these signatures**
  (`pg_get_function_identity_arguments`). All are `security definer`, `stable`, with
  `search_path=""`:
  - `private.can_read_ride(candidate, target_ride)`, whose arms include `083`'s live-invite arm
    through `private.has_live_ride_invite_for`, for invites in `('pending','accepted')`;
  - `private.can_read_club(candidate, target_club)`;
  - `private.can_read_club_thread(candidate, target_thread)`;
  - `private.is_club_member_for(candidate, target_club_id)`, which covers membership and
    `owner_id`;
  - `private.is_blocked(a, b)`, which is symmetric: `blocker_id = a and blocked_id = b`, or the
    other way round.
- **`ride_members.status` is `going` or `maybe` and nothing else** (`ride_members_status_check`).
  So "has not answered going or maybe" means "holds no `ride_members` row".
- **Rides carry `latitude`, `longitude`, `timezone`, `departure_at`, `created_at`, `club_id` and
  `organizer_id`.** `organizer_id` is NOT NULL.
  - `timezone` is NULL or a zone `080`'s `enforce_ride_timezone` resolved against
    `pg_timezone_names` at write time, so `coalesce(r.timezone, 'Europe/Amsterdam')` is safe per
    row and needs no per-row catalogue lookup.
  - `created_at` has been server-owned since `045`, and `club_threads.created_at` is withheld from
    the INSERT grant. So nobody can backdate or forward-date "created in the last 7 days".
- **`profiles` has no `digest_opt_out_at`.** `authenticated`'s column grants on `profiles` are
  SELECT 10, INSERT 8 and UPDATE 8. `rides_from` from `127` is inside those widths, and they are
  exactly the widths `096.1` pins.
- **`authenticated` can already read every column this change surfaces.** On `rides` that
  includes `latitude` and `longitude`. On `clubs` it includes `name` and `avatar_path`. On
  `club_threads` it includes `created_at` and `author_id`. So a distance or a count adds no column
  the rider could not already read.
- **`design/` has no frame for this.** `npm run figma -- ls weekend` and `ls digest` both answer
  `0 of 451`.

## Decisions

### D1. Part 1 is the in-app half; part 2 is everything a send needs

The issue names its own seam: *"Only the send waits."* Part 1 ships the content rule, one shared
body, the in-app reader and screen, and the opt-out. Part 2 ships everything a scheduled send
needs, listed in `proposal.md` §Deferred to part 2.

**Part 2 gets no requirements here.** Archiving this change must not write unbuilt behaviour into
the standing specs. The earlier draft's `rider-home-anchor`, `event-fanout-integrity` and
`notifications` deltas are deleted for that reason, not because their content was wrong. Their
findings survive as constraints in the proposal.

### D2. The reader returns ids, order and counts, and the rows render under the caller's RLS

**Read decision D's reader as "ids, ordering keys and counts" rather than as ride and club
content.** Both readings satisfy D's bound, *"only columns a rider can already read from
`rides`/`clubs`"*. Only this one is consistent with two standing requirements:

- `database-enforced-integrity`: *"A merged view of several tables SHALL be assembled under the
  caller's own row security, and SHALL NOT be served by a `security definer` union"*. The one
  permitted narrowing is an accessor that returns identifiers and an ordering key.
- `candidate-relative-visibility`: a restated policy is acceptable because of the **direction of
  failure**. A stale restatement *"cannot produce a leak"* when RLS still decides every rendered
  row. It can produce one when a definer body returns the content itself.

So `public.my_weekend_digest` returns `section`, `ordinal`, `ride_id`, `club_id`, `new_rides` and
`new_threads`. `src/lib/data/digest.ts` then reads the ride rows (`RIDE_SELECT`) and the club rows
(`CLUB_EMBED_COLUMNS`) by id, under the caller's own RLS, and drops any id RLS does not return.

- **Cost:** two parallel reads after the RPC.
- **Gain:** a defect in the body can leak an id and a count, but not a title or a club name.
- **Unchanged:** decision D's "one body, two entry points". Part 2's assembler reads the same
  body. Its payload has no session and must join content candidate-relatively anyway, as
  `push_payload_for` does.

**If the main thread meant content columns**, the alternative is a MODIFIED delta that carves a
second exception into the merged-view requirement. That is a decision about a standing security
rule, not something to infer, so it is not written here.

### D3. The content rule

`at` is the evaluation instant: `now()` in-app, and part 2's send time later. `Z(r)` is
`coalesce(r.timezone, 'Europe/Amsterdam')`, the repo's existing ride-zone rule. No rider zone
exists in part 1.

**This weekend.** A ride is in this weekend when all three hold:

1. `r.departure_at > at`;
2. `extract(isodow from (r.departure_at at time zone Z(r))::date) in (6, 7)`;
3. `date_trunc('week', (r.departure_at at time zone Z(r))::date)` equals
   `date_trunc('week', (at at time zone Z(r))::date)`. `date_trunc('week')` is Monday-based
   (ISO).

So Monday to Friday means the coming weekend, and Saturday or Sunday means what is left of the
current one. Both dates come from the ride's own zone. As a sargable prefilter on `071`'s index,
`departure_at < at + interval '8 days'` is always implied, because the last admissible instant
is less than 8 days after `at`.

**Near.** A position is near a ride when the ride has a coordinate and the great-circle distance
from the position to it is at most `NEARBY_RADIUS_KM` = 100. Use `distance.ts`'s formula and
constant: haversine in the `atan2` form, mean radius 6371.0088 km, inclusive `<=`. That keeps the
SQL boundary and `isNearby` from disagreeing about a ride at the edge. A ride with NULL
coordinates is never near.

**The rides section.** It holds rides that are this weekend and near the position, and meet all
of these:

- `private.can_read_ride(candidate, r.id)`;
- `r.organizer_id <> candidate`;
- `not exists` a `ride_members` row for `(r.id, candidate)`;
- `not private.is_blocked(candidate, r.organizer_id)`.

Order by `departure_at`, then distance, then `id`, and cap at 5. The block test is redundant with
`can_read_ride` today and is required anyway. The body tests blocking itself, and the RLS suite
proves each exclusion separately (see D4).

**The clubs section.** It covers every club `c` where `private.is_club_member_for(candidate, c.id)`
holds. For each club:

- `new_rides` counts rides `r` that meet all of these:
  - `r.club_id = c.id`;
  - `r.created_at > at - interval '7 days'`;
  - `r.departure_at > at`;
  - `r.organizer_id <> candidate`;
  - `not private.is_blocked(candidate, r.organizer_id)`;
  - `private.can_read_ride(candidate, r.id)`.
- `new_threads` counts threads `t` that meet all of these:
  - `t.club_id = c.id`;
  - `t.created_at > at - interval '7 days'`;
  - `t.author_id <> candidate`;
  - `not private.is_blocked(candidate, t.author_id)`;
  - `private.can_read_club_thread(candidate, t.id)`.

Keep a club only when `new_rides + new_threads > 0`. Order by that total descending, then
`c.name`, then `c.id`, and cap at 5. Introduction threads (`097`) are threads and count. The Welcome
club counts like any other club (see Q3).

**Empty and no position.**

- When both sections are empty, the body returns **zero rows**. It never returns a row with a
  zero count.
- When both position arguments are NULL, the rides section is empty and the clubs section is
  still computed.

### D4. The shared body and its discipline

`private.weekend_digest_for(candidate uuid, at timestamptz, near_lat double precision, near_lon
double precision)` is the only place D3 is written.

- **Definition and grants.** `security definer`, `stable`, with `search_path` pinned empty and
  every reference schema-qualified. `revoke all … from public, anon, authenticated, service_role`.
- **Candidate-relative.** It never calls `auth.uid()`, and never calls `private.is_club_member(`
  or `private.is_ride_crew(`, which read `auth.uid()` internally. `candidate is null` returns zero
  rows, so a call with no JWT subject is empty rather than an error.
- **It never reads `profiles.rides_from`.** `#483`'s rule is that `rides_from` is never a
  position. `src/__tests__/rides-from-is-not-a-position.test.ts` cannot see SQL, so the suite
  asserts this on the body's `prosrc` (comment-stripped), verified both ways.
- **It never reads `digest_opt_out_at`.** The opt-out is not a content rule and never an
  authorization gate. Part 2's assembler applies it as its own conjunct.
- **It rounds and validates the position:**
  - both arguments NULL means no position;
  - exactly one NULL raises `22023`;
  - a value outside `[-90, 90]` × `[-180, 180]` raises `22023`. This includes `NaN` and
    `±Infinity`, since `NaN` sorts above every number and both fall outside the range test.
  - otherwise it computes with `round(x::numeric, 2)`.

  So the body, not the client, holds precision at ~1 km, whoever calls it.
- **It uses only pinned helpers for audience.** `can_read_ride`, `can_read_club_thread` and
  `is_club_member_for` are already pinned against their policies (`rls_test.sql` `§060`,
  `§121.6b`). A policy rewrite fails there, not silently here. No audience predicate is written
  by hand.

`public.my_weekend_digest(near_lat double precision default null, near_lon double precision
default null)` has the same return shape.

- **Body.** `security definer`, since its callee is revoked, with `search_path` pinned empty. Its
  body is exactly `select * from private.weekend_digest_for((select auth.uid()), pg_catalog.now(),
  near_lat, near_lon)`, pinned by equality.
- **Grants.** `revoke all … from public, anon` and `grant execute … to authenticated`.
- **`service_role`.** It keeps Supabase's default EXECUTE, as `096`'s RPCs do, and gets zero rows
  because it carries no subject.

### D5. The opt-out

- **The column.** `profiles.digest_opt_out_at timestamptz`, nullable, with no default and no
  backfill.
- **No grants.** `129` issues **no `grant` and no `revoke` on `public.profiles`**. `025`'s
  allowlist leaves the column invisible, and `096.1`'s 10/8/8 stay 10/8/8.
- **The RPCs.** `public.my_digest_opt_out() returns timestamptz` and
  `public.set_digest_opt_out(p_opt_out boolean) returns timestamptz` follow `096`'s shape verbatim:
  - `true` is `coalesce(existing, now())`, so a second call keeps the first stamp;
  - `false` sets NULL;
  - they take no rider id;
  - no profile row gives `P0002`, and no session gives `42501`.

  The parameter name `p_opt_out` is fixed by the branch's `setDigestOptOut`.
- **Independence.** Setting either opt-out leaves the other unchanged, asserted in both
  directions.
- **What it does in part 1.** The stamp is recorded and nothing reads it except its own accessor.
  Nothing is sent, so there is nothing to stop yet. `NotificationsSheet` says so rather than
  implying otherwise (see the proposal).
- **Retention.** The profile row's lifetime. Clearing the preference sets NULL, and account
  deletion takes the row. The stamp is a preference, not location data.

### D6. The surface: `/rides/weekend`, entered from one row on `/rides/explore`

**The placement.**

- **Route.** `src/app/(app)/rides/weekend/page.tsx`, `'use client'`. It needs a session through
  the guard's denylist, because it is not a public path.
- **Door.** One static row on `/rides/explore`, directly under `LocationQuestionRow` and outside
  the list gate. It shows `CalendarIcon`, the text "This weekend", and a trailing chevron.

**Why this placement:**

1. **The tab roots stay at one row.** `one-question-row.test.ts` needs no exception, and the
   owner's *"2 labels on the top"* is not reopened on `/rides` or `/clubs`.
2. **Explore is where "near you" already lives.** It reads the same `riderLocation` key, so
   arriving is a cache hit and both screens measure from one position.
3. **The row is static.** It carries no count and needs no read, so it has no loading state,
   cannot jump the list below it, and never renders a "0".

Part 2's push will deep-link straight to `/rides/weekend`, so the door's discoverability matters
most before part 2 lands. The alternative placement is Q1.

**The states.** Reads go through `useQuery` (effect-driven, never during render):

- the position on `queryKeys.riderLocation()` with `resolveRiderLocation`, as Explore reads it;
- the digest on `queryKeys.rides.weekend(position)`, held with a `null` key until the position
  is decided (`near.data !== undefined || !!near.error`).

| State | Condition | What renders |
|---|---|---|
| Skeleton | position undecided, or digest `data === undefined` | `SkeletonList` + `LoadingRegion` "Loading this weekend". Gated on data, never `isLoading` |
| Content | at least one section non-empty | Rides section is headed with `nearLabel` wording and drawn with `RideCard`s. `formatRide*` is used with `ride.timezone`, as `RideCard` already does. `MapAttribution` shows when any card has a tile. Clubs section: one row per club, "‹n› new rides · ‹m› new threads" (a zero half omitted), linking to the club. An empty section is omitted entirely |
| Empty | position present, both sections empty | "Nothing near you this weekend" |
| No position | position `null` (or its read errored) | A distinct row, "Set where you ride from to see rides near you this weekend". A **tap** opens `TownQuestionSheet`, never automatically. The clubs section still renders beneath it when non-empty |
| Error | digest read, or either hydration read, rejects | `ErrorState` with retry. Never rendered as emptiness |
| Offline | `useOnlineStatus()` false | `OfflineState` banner above whatever the cache holds. With nothing cached, the read errors into the Error state, and `connectivity.ts` retries on `online` |
| Permission denied | — | Not a state. The RPC is own-row and always executable, so zero rows means nothing to show. An id that RLS withholds at hydration is dropped with no gap |
| Partial | — | Not rendered. `getWeekendDigest` is all-or-nothing, and a failure in any of its three reads is the Error state |
| Stale | — | See D7 |

### D7. The cache key and what moves it

- **The key.** `queryKeys.rides.weekend(near)` is `['rides', 'weekend', 'lat,lon' | 'unlocated']`,
  plus the prefix `queryKeys.rides.weekendAll()` for invalidation.
- **RSVPs.** The key is under `rides`, so `setRideAttendance`'s `rides.all()` removes a ride the
  rider has just joined.
- **Membership.** `invalidateClubMembership` does **not** reach `rides.all()`, so it gains
  `invalidate(queryKeys.rides.weekendAll())` to move the clubs section on a join or leave.
- **Blocks.** `blockRider` and `unblockRider` already invalidate everything.
- **The rider's own writes.** Their own rides and threads are excluded by D3, so creating either
  never moves their own digest, and no claim is owed there.
- **Other riders' writes.** These are bounded by the cache's stale window, as on every list.

## Roles and negative cases

In the table, "own" means the caller's own row or answer. "✓" means included. The rides and clubs
columns describe what the digest names for a rider in that role relative to the resource.

| Role | `digest_opt_out_at` column | opt-out RPCs | `my_weekend_digest` | `weekend_digest_for` | Club section for club C | Public ride R in private club C |
|---|---|---|---|---|---|---|
| Owner of C | no grant | own only | EXECUTE | none | ✓ counts, own rows excluded | ✓ unless organiser |
| Admin of C | no grant | own only | EXECUTE | none | ✓ same counts as a member | ✓ |
| Member of C | no grant | own only | EXECUTE | none | ✓ | ✓ |
| Non-member of private C | no grant | own only | EXECUTE | none | absent | absent |
| Pending club invitee | no grant | own only | EXECUTE | none | absent | absent |
| Removed member | no grant | own only | EXECUTE | none | absent from the next read | absent |
| Live ride invitee to R | no grant | own only | EXECUTE | none | absent | ✓ (readable through `083`'s arm) |
| Blocked with the organiser or author (either direction) | no grant | own only | EXECUTE | none | their rows are not counted | absent if they organise R |
| `anon` | no grant | no EXECUTE | no EXECUTE | none | — | — |
| `service_role` | default | default EXECUTE, no subject | default EXECUTE, zero rows | **none** | — | — |

Each negative case below maps to an assertion or a test. Labels are provisional and the suite
numbers them.

1. `authenticated` holds no SELECT, INSERT or UPDATE on `profiles.digest_opt_out_at`. The check
   is `has_column_privilege`, with widths still 10/8/8 (`129.1`).
2. The opt-out RPCs take no rider id: the identity args are `''` and `'p_opt_out boolean'`.
   Setting twice keeps the first stamp, and `false` clears (`129.2`).
3. Each opt-out leaves the other unchanged, asserted both ways (`129.3`).
4. `anon` has no EXECUTE on `my_weekend_digest`, `my_digest_opt_out` or `set_digest_opt_out`
   (`129.4`).
5. No client role has EXECUTE on `private.weekend_digest_for`. That covers `authenticated`,
   `anon` and **`service_role`** (`129.5`).
6. The body's comment-stripped `prosrc` contains none of `auth.uid(`,
   `private.is_club_member(`, `private.is_ride_crew(`, `rides_from` or `digest_opt_out_at`. The
   wrapper's `prosrc` equals the delegation (`129.6`).
7. A ride organised by a rider blocked with the candidate is absent, asserted with the block row
   in each direction (`129.7`).
8. A club count excludes rides and threads by a rider blocked with the candidate, in each
   direction (`129.8`).
9. A non-member of a private club gets no club row for it, and no ride from it. That includes a
   `is_public = true` ride in that club (`129.9`).
10. A pending **club** invitee gets nothing from that club. A **declined ride** invitee does not
    get the ride (`129.10`).
11. A member removed from a club (a `club_removals` row, no `club_members` row) gets nothing from
    it on the next call (`129.11`).
12. The organiser never sees their own ride, and their own rides and threads never count
    (`129.12`).
13. A ride the candidate answered `going` or `maybe` is absent (`129.13`).
14. Each of these is absent (`129.14`):
    - a ride with NULL coordinates;
    - a ride past 100 km;
    - a ride on a weekday;
    - a ride on next week's weekend;
    - a ride already departed;
    - a ride that is Saturday in `APP_TIME_ZONE` but Friday in its own `timezone`.
15. No position returns no ride rows and still returns club rows (`129.15`).
16. Nothing to show returns zero rows. A club with zero activity never gets a row (`129.16`).
17. A NULL candidate returns zero rows, and a malformed position raises `22023` (`129.17`).
18. An admin of a club gets exactly the member's counts. The body reads no join requests,
    reports or other admin-only rows (`129.18`).
19. An opted-out rider's reader answer equals a non-opted-out twin's. The preference is not a
    gate (`129.19`).
20. **Unit** tests:
    - `getWeekendDigest` drops an id RLS did not return and keeps the RPC's order;
    - any failure of its three reads rejects;
    - `NotificationsSheet`'s copy promises no send.
21. **Walk.** `/rides/weekend` renders, and a signed-out visit is redirected to `/auth/login`,
    so the visitor reaches the shell and no data.

## Risks / Trade-offs

- **The screen will usually be empty on DEV.** Measured on 2026-09-22 with D3's "this weekend"
  predicate: 32 rides, 15 upcoming, and **0** in this weekend's window. Assertions `129.7` to
  `129.18` are the proof. `WALK_FIXTURES` gains a ride near the walk rider,
  departing this coming Saturday (task 5.4).
- **The counts are computed by the definer body, not by RLS.** Each count covers rows the
  candidate can read, through the same pinned helpers as the lists they summarise. The residual
  risk is the pin itself, which already exists.
- **The haversine runs per candidate ride inside the 8-day window.** At 10,000 rides the window
  prefilter bounds it to a week of departures. A bounding-box prefilter is the next step if
  `explain` says so, and PostGIS is not.

## Open questions

Each has a recommended default, so the build does not wait on it.

- **Q1: Door placement.**
  - Non-blocking. The product owner or designer answers.
  - Default: `/rides/explore` under `LocationQuestionRow` (D6).
  - Alternative: a row on `/rides` below `RideFilterBar`, outside the strip slot. It is more
    visible, but it is a second row on a tab root the owner has already trimmed.
- **Q2: Copy.** The row says "This weekend". The empty state says "Nothing near you this
  weekend". The no-position row says "Set where you ride from to see rides near you this
  weekend".
  - Non-blocking. The product owner answers.
  - Default: as written.
- **Q3: The Welcome club (`is_default`) counts like any club.**
  - Non-blocking now. It becomes blocking for part 2, where it decides whether an "empty" week
    ever exists for a rider in a busy Welcome club. The product owner answers.
  - Default: count it, per decision C, which has no carve-out.
- **Q4: Should `/legal/privacy` gain a line?**
  - Non-blocking. The main thread answers.
  - Default: **no line in part 1.** The reader stores nothing. The 2-dp position reaches only our
    own Supabase project as an RPC argument and reaches no third party. The opt-out stamp is a
    preference.
  - Part 2's stored anchor owes a line.
