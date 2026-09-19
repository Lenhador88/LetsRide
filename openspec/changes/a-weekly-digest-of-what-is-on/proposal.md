# A weekly "what's on this weekend"

## Why

Every notification this app produces is **reactive**. All sixteen types in
`notifications_type_check` are written by an `AFTER INSERT` trigger on a row another rider
wrote — a like, a comment, an RSVP, a ride created, a join request, a thread reply. A rider to
whom nothing happened gets nothing, and that is most riders in most weeks. Out of season it is
nearly all of them.

A weekly digest is the one return trigger that does not depend on another rider acting first.
One notification, once a week, Thursday or Friday evening: rides near you this weekend, and what
moved in your clubs since the last one. The same content readable in-app at any time.

**It is possible now and was not a month ago.** `113`/`114`/PD-445 made every new rider answer
where they ride from, and `051` gave rides a coordinate. *"Near you"* is a real query rather
than a guess — **for a rider in a session**. It is not yet a real query for a **scheduled job**,
and closing that gap is half of what this change is.

## What Changes

**The rider anchor — the part with no alternative.** `profiles` carries `location` (a free-text
town) and `home_country`, and **no coordinate at all**. Today *"near you"* is computed on the
client from the device's GPS position (`src/lib/location/use-rider-position.ts` →
`distance.ts`), falling back to geocoding the stored town through the `search-places` Edge
Function. A scheduled job has neither: no device, and no route to that function from inside
Postgres. So `125` persists the town's centroid and its IANA zone on `profiles` —
`home_latitude`, `home_longitude`, `home_timezone` — written at the moment the town is picked,
from the coordinate the picker already holds. `design.md` §D1 has the rejected alternative and
the metering number that kills it.

- **`profiles` gains four columns**: `home_latitude`, `home_longitude`, `home_timezone` and
  `digest_opt_out_at`. **None of the four is granted to `authenticated` in any of SELECT,
  INSERT or UPDATE**, and that is the load-bearing decision rather than a default:
  `profiles.location` — a town name — *is* readable by every non-blocked rider today, and a
  ~1 km home coordinate is a materially different disclosure wearing the same column's clothes.
  Own-row RPCs are the only reach, `096`'s shape exactly.
- **`setRiderTown` and `setHomeTown` both write the anchor.** `profiles.location` has **two**
  writers and anything keyed to the stored town must be written in both. A town written without
  its anchor is detectable rather than silent (see the CHECK below).
- **The anchor is coupled to the town by the database**, not by the two callers agreeing:
  a CHECK that the pair arrives together and that an anchor implies a town, plus a `BEFORE
  UPDATE` trigger that clears the anchor when the town is cleared — otherwise `setRiderTown(null)`
  raises at a rider who tapped *Remove*.
- **A weekly digest opt-out**, its own consent, **explicitly not** `096`'s `analytics_opt_out_at`.
  Two different things, and one of them the database can actually enforce.
- **`public.rider_digests`** — a **new table**, one row per (rider, ISO week), and **NOT a
  `public.notifications` row**. That is a forced choice rather than a preference and `design.md`
  §D2 carries it: `notifications.actor_id` is `NOT NULL`, a digest has no actor, and `036`'s
  SELECT policy carries
  `exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)`
  **unconditionally** — so even a nullable actor would produce a row written, never returned and
  never counted, silently, for ever. A digest also names *many* rides and *many* clubs, which the
  single-subject `postcard_id`/`ride_id`/`club_id`/`thread_id` shape cannot express.
- The row is a **marker**, not content: no copy, no ride ids, no club ids, no text.
  `unique (user_id, period_start)` is what makes *exactly one per week* a property of the schema
  rather than of a job running once.
- **`public.my_weekend_digest()`** — the content, computed live under the caller's own identity,
  never stored. Both the in-app surface and (later) the push copy read one shared body, so the
  two cannot say different things.
- **`private.weekend_digest_for(candidate)`** — that shared body, candidate-relative and
  block-tested in both directions, because the assembly runs outside any rider's session and RLS
  is not there to do it for free.
- **The in-app surface**: the same content, readable at any time, with every state named.
- **The send half does not ship**, for exactly the reason PD-303's does not: no APNs/FCM
  credentials, no `pg_cron`, no `pg_net`, no Vault secrets. `tasks.md` splits this so it is
  unmistakable, and the specs cover both halves so the waiting half is not re-decided later.

**`public.notifications` is NOT touched, and that is the point of choosing a separate table.**
`notifications_type_check` does not move, `notifications_subject_shape` does not move, the SELECT
policy's five subject conjuncts do not move, and `121 §6`'s `push_payload_for` gains **no CASE
arm** — so its `else` raise and the textual pin behind it stay exactly as `121` left them. The
waiting half instead widens the **outbox**: `push_deliveries` gains a second, mutually exclusive
subject arm and `claim_push_batch` a second source, which is a change to delivery plumbing rather
than to the contract every other notification type reads. `design.md` §D3.

## Capabilities

### New Capabilities
- `weekly-digest`: who receives the weekly digest and who must not; what it may contain and what
  it must never name; exactly-once-per-week; quiet hours in the rider's own zone; the opt-out;
  and the rule that a rider with nothing to show receives **nothing at all**.
- `rider-home-anchor`: the stored town centroid and zone on `profiles` — who writes it, who may
  read it, who must never read it, when it is cleared, and how long it is kept.

### Modified Capabilities
- `notifications`: an **authorless** message is not a notification, and the spec SHALL say so
  rather than leave the next author to discover it from a `NOT NULL`. The requirement added is a
  **negative**: `public.notifications` SHALL carry no type whose row has no actor, no type naming
  more than one instance of a subject, and no type reaching the rider through anything but one of
  the fan-out triggers. Anything else is a different table.
- `event-fanout-integrity`: *"Fan-out SHALL be performed by a database trigger and by nothing
  else"* is amended. A digest has no parent row, so there is no insert to hang a trigger on. A
  **second fan-out class** — scheduled selection — is admitted, with the guarantees that replace
  "the trigger fires once": a unique key instead of an idempotent trigger, a candidate-relative
  body shared with the reader instead of a policy the caller's session evaluates, and an
  emptiness rule that makes writing no row the ordinary outcome rather than an error.
- `database-enforced-integrity`: `digest_opt_out_at` joins the set of lifecycle timestamps no
  other rider may read, and the home anchor is added as a **new class** of rider personal data —
  a coordinate *about a rider* rather than about a place — with its grant decision stated
  explicitly and a retention window stated at creation.
- `analytics-consent`: a second consent exists. The analytics opt-out SHALL NOT be read, written
  or rendered as though it covered anything else, in either direction.
- `rider-position-question`: the profile source of `resolveRiderLocation` reads the **stored**
  anchor rather than geocoding the town on every cold resolve, and the question row's *"Still in
  ‹town›?"* rule has to hold for a rider carrying a town with **no** anchor — a state every
  profile in the database is in on the day `125` applies.

## Impact

**Schema** — `125_a_weekly_digest.sql` (the number is `125`: DEV's `list_migrations` reads
`124 reports_reach_a_human`, applied 07:39Z 2026-09-19 from a branch whose file is not in this
tree, so `ls supabase/migrations/ | tail -1` answers `123` and would hand out a number already
spent). Four columns on `profiles`, one new table, one trigger, four functions, two CHECKs.

**RLS suite** — `supabase/tests/rls_test.sql` gains a `§125` block. Every policy this change
writes owes an assertion; every revoke owes a **grantee-scoped** one, since the suite runs as
the table owner.

**Client** — `src/lib/actions/profile.ts` (`setRiderTown`), `src/lib/actions/onboarding.ts`
(`setHomeTown`), `src/lib/actions/notification-preferences.ts` (new), `src/lib/data/digest.ts`
(new), `src/lib/location/rider-location.ts` (the profile source), `src/lib/query/keys.ts`,
`src/components/digest/`, `src/components/profile/`, `src/app/(app)/profile/`,
`src/types/index.ts`.

**Not touched** — `public.notifications` in any form; and `push_deliveries`, `push_payload_for`,
`claim_push_batch` and the Vault-gated schedule all stay as `121` left them until the waiting
half. No dependency is added. No feature flag: the in-app surface either renders or does not, and
a flag defaulting off would make it untestable.

**The send needs no sender.** `121` §10 already owns the one-minute tick that drains
`push_deliveries`, so the waiting half adds a weekly **assembly** and nothing else. Assembly is
pure SQL with no network hop, so it needs `pg_cron` but **not** `pg_net` and **not** the three
network Vault secrets — and it therefore needs its own gate, because `121`'s gate is those
secrets. `design.md` §D7.

**Owner actions** — PD-303's list is unchanged (APNs/FCM credentials, `create extension pg_cron`,
`create extension pg_net`, the three `push_delivery_*` Vault secrets) and this change adds
exactly **one**: a fourth Vault secret, `weekly_digest_enabled`, created per project. It is the
only thing standing between a replicated migration and DEV assembling digests for riders whose
phones are real.
