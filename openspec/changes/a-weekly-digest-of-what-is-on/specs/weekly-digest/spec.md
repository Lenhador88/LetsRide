## Purpose

The one message this app sends that no other rider caused: a weekly "what's on this weekend",
assembled by a schedule rather than by an event. This capability owns who receives it and — far
more importantly — **who must not**; what it may name and what it must never name; the rule that
an empty digest is not sent at all; exactly-once-per-week; quiet hours in the rider's own zone;
and its own consent, which is not any other consent.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** Two exceptions are named as such: the
security-advisor sweep, and any assertion about a **grant**, which must name the role via
`has_table_privilege` / `has_function_privilege` rather than attempt a statement, because the
suite runs as the table owner for whom neither RLS nor the `private` USAGE barrier exists
(`031`'s lesson).

## ADDED Requirements

### Requirement: A rider with nothing to show SHALL receive NOTHING — no row, no notification, no push

Where `private.weekend_digest_for(candidate, at)` returns an empty content set, the assembly
SHALL insert **no** `public.rider_digests` row, and therefore no outbox row and no push. There
SHALL be no empty-state digest, no "quiet week" message, no "nothing near you — widen your
radius" prompt and no zero-count summary.

**This is the requirement most likely to be softened into a feature by someone who means well.**
An empty digest is the fastest route to an uninstall: it costs the rider a notification and gives
them nothing, and it does so *weekly*, which is the one cadence at which an unrewarding
interruption compounds. A rider with nothing to show has not failed and does not need telling.

Emptiness SHALL be an **ordinary outcome**, not an error: the assembly SHALL NOT raise, log a
warning, or record an attempt. Nothing anywhere SHALL count the riders who were skipped, because
a table of "riders with nothing near them" is a location-derived record about people with no
purpose that justifies keeping it.

#### Scenario: A rider with no qualifying rides and no club activity gets no row
- **WHEN** assembly evaluates a rider for whom the content set is empty
- **THEN** zero `rider_digests` rows SHALL exist for that rider and that period
- **AND** zero `push_deliveries` rows SHALL exist
- **AND** the assembly SHALL complete normally, and the next rider SHALL be evaluated

#### Scenario: Emptiness is re-evaluated every run, never cached as a verdict
- **WHEN** a rider is empty at 18:00 and a qualifying ride is created at 19:00, both inside their
  send window
- **THEN** the 20:00 run SHALL send them a digest
- **AND** nothing SHALL have recorded the earlier emptiness in a way that suppresses it

#### Scenario: A rider with club activity but no nearby rides still qualifies
- **WHEN** the rides half is empty and the club half is not
- **THEN** a digest SHALL be sent naming only what there is
- **AND** the absent half SHALL be omitted entirely rather than rendered as "0 rides near you"

#### Scenario: The in-app screen is the one place emptiness IS rendered
- **WHEN** a rider opens the digest screen themselves and the content set is empty
- **THEN** a designed empty state SHALL be drawn, because the rider asked
- **AND** this SHALL NOT be read as permission to send that state

### Requirement: The digest SHALL be a marker row and SHALL hold no copy of what it contained

`public.rider_digests` SHALL carry exactly `id`, `user_id`, `period_start`, `created_at` and
`read_at`. It SHALL carry **no** ride id, club id, count, title, body, rendered string or any
other description of its content.

The content SHALL be produced at read time and at send time by
`private.weekend_digest_for(candidate, at)` and SHALL never be written to any table. This is
`database-enforced-integrity`'s standing rule — a derived row SHALL NOT hold a copy of a
visibility decision — and `121 §1`'s first condition, applied one table over.

**A stored list is a second copy of a visibility decision and nothing re-checks it.** A ride id
pinned on Friday and rendered on Sunday names a ride whose club may since have gone private, whose
organiser may since have blocked the reader, or from which the reader may since have been removed.
The row would look correct to any reviewer, because the value in it was true when it was written.

#### Scenario: No column can hold a name, a title or a count
- **WHEN** the table is created
- **THEN** it SHALL carry no `ride_ids`, `club_ids`, `ride_count`, `title`, `body`, `summary`,
  `payload` or equivalent column
- **AND** the assertion SHALL be a column-list comparison, so a column added later fails it

#### Scenario: The screen and the push read the same body
- **WHEN** the in-app digest and the push copy are produced
- **THEN** both SHALL resolve through `private.weekend_digest_for`
- **AND** a second, separately-written content query SHALL NOT exist, because two bodies drift and
  the drift is invisible from either side

#### Scenario: A digest read after its subject changed shows the change
- **WHEN** a ride named in a rider's digest is cancelled, made private, or its club left, and the
  rider then opens the digest screen
- **THEN** that ride SHALL NOT be listed
- **AND** no gap, placeholder or count discrepancy SHALL indicate that something was removed

### Requirement: Exactly one digest per rider per period SHALL be a property of the schema

`public.rider_digests` SHALL carry `unique (user_id, period_start)`. Exactly-once SHALL NOT rest
on the assembly job running once, on a `where not exists` the author remembered, or on a cron
expression firing weekly.

The assembly job runs **hourly** (quiet hours require it — see the zone requirement below), so it
evaluates every rider up to 168 times per period. The unique key is what makes that safe.

#### Scenario: A second assembly run in the same period writes nothing
- **WHEN** assembly runs again for a rider who already holds a row for this `period_start`
- **THEN** the insert SHALL be a no-op — `on conflict do nothing` — and SHALL NOT raise
- **AND** no second outbox row SHALL be created

#### Scenario: Two overlapping runs cannot both insert
- **WHEN** two assembly invocations evaluate the same rider concurrently
- **THEN** at most one row SHALL exist afterwards
- **AND** the guarantee SHALL be the unique index, asserted directly by attempting the duplicate
  insert as the table owner and observing the conflict

#### Scenario: A new period is a new row
- **WHEN** the next period begins
- **THEN** the same rider SHALL be eligible again
- **AND** `period_start` SHALL be derived from a fixed rule rather than from "seven days since the
  last one", so a rider missed one week is not permanently shifted off the weekly rhythm

### Requirement: The digest SHALL NOT stack with transactional push about the same events

A rider SHALL NOT be pushed a digest naming an event they were already pushed about in the same
period, and SHALL NOT be pushed a digest they have already read in the app.

Two mechanisms, and they are separate:

1. **Already-read suppression** — `rider_digests.read_at` exists for this. `121 §7`'s claim-time
   filter (a) SHALL apply to a digest exactly as it applies to a notification: a rider who was in
   the app when the row landed, opened the digest and read it must not be pushed about it a minute
   later. At `121`'s one-minute interval this is the ordinary case, not an edge one.
2. **Event overlap** — a ride the rider was *already notified about* through `ride_invited`,
   `ride_created_in_club` or any other transactional type in the same period SHALL be excluded
   from the digest's ride list.

#### Scenario: A ride the rider was already told about is not repeated
- **WHEN** a rider received a `ride_created_in_club` notification for a ride this period, and that
  ride also qualifies as "near you this weekend"
- **THEN** the digest SHALL NOT list it
- **AND** if it was the only qualifying ride, the digest SHALL NOT be sent at all, by the
  emptiness rule

#### Scenario: A digest read in-app before the push tick is suppressed, not sent
- **WHEN** `rider_digests.read_at` is set before the claim
- **THEN** the outbox row SHALL be marked `suppressed` and never retried
- **AND** `suppressed` SHALL NOT be counted as a failure anywhere

#### Scenario: A ride the rider RSVP'd to is not offered to them
- **WHEN** a rider already holds a `ride_members` row for a qualifying ride, of either status
- **THEN** that ride SHALL NOT appear in their digest
- **AND** a rider who has RSVP'd to **every** qualifying ride SHALL fall into the emptiness rule
  and receive nothing

#### Scenario: A ride the rider organises is not offered to them
- **WHEN** a rider is the `organizer_id` of a qualifying ride
- **THEN** it SHALL NOT appear in their own digest, whether or not they hold a `ride_members` row
- **AND** the exclusion SHALL be by rider id rather than by role, matching
  `event-fanout-integrity`'s self-suppression rule

### Requirement: Blocking SHALL be tested explicitly inside the digest, in both directions

The assembly runs outside any rider's session, so `auth.uid()` is NULL and **RLS does none of this
work for free**. Every candidate row SHALL be tested against `private.is_blocked(recipient,
other)`, which is symmetric — its body is `blocker_id = a and blocked_id = b` **or**
`blocker_id = b and blocked_id = a` — so one call covers both directions of a directional row.

`private.is_club_member` and `private.is_ride_crew` read `auth.uid()` internally and answer only
for the caller. **Neither SHALL appear anywhere in the assembly or in
`private.weekend_digest_for`.** The candidate-relative forms — `private.can_read_ride(candidate,
ride)`, `private.can_read_club(candidate, club)`, `private.is_club_member_for(candidate, club)` —
are the only permitted shapes.

**`can_read_ride`'s own block arm is NOT sufficient and stating otherwise is the trap.** It
block-dominates the **organiser** alone. A club-activity line summarising threads, messages or
postcards authored by other riders is a disclosure about *those* riders, so the count SHALL be
filtered per author against `is_blocked(recipient, author)`.

#### Scenario: A ride organised by a blocked rider is absent
- **WHEN** a qualifying ride's organiser is blocked with the recipient in either direction
- **THEN** it SHALL NOT appear, and the assertion SHALL be run with the two riders exchanged,
  because the row is directional and the effect symmetric

#### Scenario: A club activity count excludes blocked authors
- **WHEN** a club the recipient belongs to gained five threads this period, two of them by a rider
  blocked with the recipient
- **THEN** the count SHALL be three
- **AND** it SHALL NOT be five with two rows filtered afterwards by a screen, which is decision
  #2's forbidden shape

#### Scenario: The digest cannot be used as a block oracle
- **WHEN** a rider compares what their digest names against what a screen shows them
- **THEN** no gap, count or marker SHALL disclose that a block exists, because a blocked rider's
  content is absent from **both** by the same predicate

#### Scenario: No caller-relative helper appears in the assembly
- **WHEN** the assembly and content functions are reviewed
- **THEN** `private.is_club_member(`, `private.is_ride_crew(` and `auth.uid()` SHALL appear in
  neither
- **AND** this SHALL be checkable by inspecting `prosrc`, not inferred from behaviour

### Requirement: A private club's name and a private ride's title SHALL NOT reach a rider through the digest

The digest SHALL name a ride only where `private.can_read_ride(recipient, ride)` is true, and a
club only where `private.can_read_club(recipient, club)` is true. There SHALL be no arm by which
a non-member learns a private club's name, its member count, its activity level or that it exists.

`is_public = true` on a ride or club means "visible to any signed-in rider" and never "visible to
the internet" (decision #1). The digest reaches signed-in riders only, so a public ride in a
public club is in scope; **a public ride in a private club is not**, which is `can_read_ride`'s
`r.is_public and (r.club_id is null or private.is_club_public(r.club_id))` arm and the reason
the helper is used rather than a hand-written `is_public` filter.

#### Scenario: A non-member is told nothing about a private club
- **WHEN** a private club near the recipient gains rides and threads this period
- **THEN** the recipient's digest SHALL name neither the club, its rides, nor any count derived
  from them
- **AND** the digest SHALL NOT differ in any observable way from the digest of a rider for whom
  that club does not exist

#### Scenario: A private club's ride is not rescued by `is_public`
- **WHEN** a ride in a private club carries `is_public = true` and the recipient is not a member
- **THEN** it SHALL NOT appear, because ride visibility is the conjunction and not the column

#### Scenario: A rider removed from a club loses its activity immediately
- **WHEN** a rider is removed from, or leaves, a private club between one run and the next
- **THEN** the following run SHALL name nothing from it
- **AND** a digest row already written SHALL render nothing from it either, because the content is
  re-derived at read time and never stored

#### Scenario: A rider holding a pending club invite gains nothing
- **WHEN** a rider holds a `pending` `club_invites` row for a private club
- **THEN** the digest SHALL name nothing from that club, because a pending invite grants no read
  of the roster, threads, messages, rides or postcards — only of `notifications`

### Requirement: A digest SHALL be readable by its rider and by nobody else

`public.rider_digests` SHALL be readable only by the rider named in `user_id`. `authenticated`
SHALL hold **no INSERT grant** and the table SHALL carry **no INSERT policy**; **no DELETE grant**
and no DELETE policy. UPDATE SHALL be confined to `read_at`, on the caller's own rows, and the
UPDATE policy's predicate SHALL be **identical** to the SELECT policy's in both `using` and
`with check`.

The absence of the INSERT grant is what makes the assembly the only writer. A rider who could
insert could award themselves a digest; one who could delete could erase the record that they
were sent one, which is the same objection `036` records for notifications.

#### Scenario: Another rider reads nothing
- **WHEN** any signed-in rider other than the row's owner reads `rider_digests` by any filter,
  including a known row id
- **THEN** zero rows SHALL be returned

#### Scenario: A rider cannot insert or delete one
- **WHEN** a rider attempts to insert a `rider_digests` row, for themselves or anyone else, or to
  delete their own
- **THEN** the statement SHALL be refused
- **AND** the refusal SHALL be backed by the **absent grant** as well as the absent policy, and the
  assertion SHALL name the role via `has_table_privilege('authenticated', …)`

#### Scenario: A rider may mark their own digest read and nothing else
- **WHEN** a rider updates any column other than `read_at`, or updates `read_at` on a row whose
  `user_id` is not their own
- **THEN** the write SHALL be refused by the absence of a column grant in the first case and match
  zero rows in the second

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for `rider_digests` arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on the table
- **AND** this change SHALL add none, per decision #1

#### Scenario: `service_role`'s grants are decided rather than defaulted
- **WHEN** the table's `service_role` grants are reviewed
- **THEN** the decision SHALL be recorded explicitly against `076 §3`'s criterion — are these rows
  ones the credential that bypasses RLS must not be able to enumerate — and the outcome SHALL be
  stated in the migration rather than inherited
- **AND** whichever way it goes, the assertion SHALL be **grantee-scoped**, because `postgres` and
  `service_role` hold everything by default

### Requirement: The send hour SHALL be decided in the rider's own zone, and the server's zone SHALL never be the answer

A digest SHALL be assembled for a rider only when the **rider's own local** time falls inside the
send window on their own local Thursday or Friday. The zone SHALL be resolved as
`profiles.home_timezone`, falling back to `APP_TIME_ZONE` (`Europe/Amsterdam`) where it is NULL.
The database server's zone (UTC on Supabase) SHALL never be used, and there is no device zone to
read because there is no device.

This is `rides.timezone`'s existing rule applied to a rider rather than to a meeting point: `null`
means *"we do not know"* and the fallback is named at the site rather than assumed.

Because riders are in different zones, **the assembly job SHALL run hourly** and each run SHALL
select only the riders whose local hour is inside the window. A weekly cron expression fires at one
instant, which is 19:00 for one rider and 03:00 for another.

#### Scenario: A rider is not woken
- **WHEN** the assembly runs at an hour that is outside a rider's local send window
- **THEN** that rider SHALL NOT be assembled a digest in that run
- **AND** no row and no outbox entry SHALL be created for them

#### Scenario: Two riders in different zones are each sent in their own evening
- **WHEN** two riders carry `home_timezone` values eight hours apart and both qualify
- **THEN** each SHALL be assembled in the run matching their own local window
- **AND** both SHALL hold exactly one row for the period

#### Scenario: A NULL zone falls back and the fallback is stated rather than hidden
- **WHEN** a rider's `home_timezone` is NULL
- **THEN** `APP_TIME_ZONE` SHALL be used
- **AND** the limit SHALL be recorded: a rider physically far from that zone receives the digest at
  an hour that is wrong for them, self-correcting the moment they pick a town
- **AND** the fallback window SHALL be chosen so that it is never the small hours **in the fallback
  zone itself**, so the worst case is a badly-timed digest and never a 03:00 one

#### Scenario: An unrecognised zone does not strand the rider
- **WHEN** `home_timezone` holds a string Postgres cannot resolve
- **THEN** the rider SHALL be evaluated in `APP_TIME_ZONE` rather than skipped or raised on
- **AND** a run SHALL NOT be taken down by one rider's bad value

### Requirement: The digest SHALL have its own opt-out, and it SHALL NOT be the analytics opt-out

`profiles.digest_opt_out_at` SHALL be a separate column from `profiles.analytics_opt_out_at`,
written by a separate RPC, surfaced by a separate control, and read by the assembly as a conjunct.
Neither SHALL be read, written or rendered as though it covered the other, **in either direction**.

They are two different consents about two different things, and the mechanisms differ in the way
that matters: `096` records that the database **cannot** enforce the analytics preference, because
PostHog is a client-side SDK and nothing in Postgres is in its path. The digest opt-out is the
opposite — the assembly runs in Postgres, so the preference is genuinely enforced.

The opt-out SHALL remain a **preference and never an authorization gate**: an opted-out rider
loses no capability, and SHALL still be able to open the in-app digest screen whenever they choose.

#### Scenario: An opted-out rider is assembled nothing
- **WHEN** `digest_opt_out_at` is not null
- **THEN** no `rider_digests` row SHALL be written for that rider, in any period
- **AND** the exclusion SHALL be a conjunct of the assembly query, asserted directly

#### Scenario: Opting out of analytics does not opt out of the digest
- **WHEN** a rider sets `analytics_opt_out_at` and leaves `digest_opt_out_at` null
- **THEN** they SHALL continue to receive digests
- **AND** the converse SHALL also hold, and both SHALL be asserted, because one assertion cannot
  say which column did the work

#### Scenario: An opted-out rider keeps the screen
- **WHEN** an opted-out rider opens the digest screen
- **THEN** the content SHALL be rendered normally
- **AND** nothing SHALL be gated, hidden or refused, because this is a preference about being
  *interrupted* and not about what may be seen

#### Scenario: The stamp is the caller's own and a foreign one is unrepresentable
- **WHEN** the opt-out is written
- **THEN** it SHALL be through an own-row `security definer` RPC taking **no rider id**
- **AND** setting it twice SHALL keep the first stamp, and clearing it SHALL set NULL

#### Scenario: Another rider cannot read the stamp
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** `digest_opt_out_at` SHALL NOT be returned, and the assertion SHALL be
  `has_column_privilege('authenticated', 'public.profiles', 'digest_opt_out_at', 'select')` being
  false rather than a narrowed projection

### Requirement: Riders who have not completed onboarding, or who are mid-deletion, SHALL be excluded

Assembly SHALL exclude any rider whose `onboarding_completed_at` is NULL and any rider whose
`deletion_started_at` is not NULL.

An un-onboarded rider is redirected back into the wizard by the route guard (decision #5) and
`023` refuses their content writes regardless, so a digest would be an interruption inviting them
to a screen they cannot reach. A rider mid-deletion has asked to leave; `119` stamps
`deletion_started_at` before anything else in the deletion path, and pushing them a digest during
that window is the worst possible moment to reappear.

A rider who has not accepted the terms SHALL likewise be excluded, by the same conjunct — consent
is gated ahead of the wizard, so `terms_accepted_at` NULL implies incomplete onboarding.

#### Scenario: An un-onboarded rider is assembled nothing
- **WHEN** `onboarding_completed_at` is NULL
- **THEN** no row SHALL be written for them

#### Scenario: A rider mid-deletion is assembled nothing
- **WHEN** `deletion_started_at` is not NULL
- **THEN** no row SHALL be written for them
- **AND** this SHALL hold for the whole window, including a stamp older than `119`'s fifteen
  minutes, because a stale marker means a *failed* deletion run and not a rider who changed
  their mind

#### Scenario: A rider whose deletion completes leaves nothing behind
- **WHEN** a rider's profile row is deleted
- **THEN** every `rider_digests` row SHALL be removed by `ON DELETE CASCADE`
- **AND** the outbox rows referencing them SHALL be removed by their own cascade, so account
  deletion needs no new step in the `delete-account` Edge Function

#### Scenario: A rider with no anchor is excluded and is not prompted
- **WHEN** a rider holds a town, or no town, and no `home_latitude`/`home_longitude`
- **THEN** the rides half SHALL be empty for them
- **AND** if the club half is also empty they SHALL receive nothing, with **no** "tell us where you
  ride from" push, because a digest is not a prompt and an interruption asking for data is the
  worst version of the empty digest this capability refuses

### Requirement: Assembly SHALL be gated so a replicated migration does not fire on DEV

The schedule SHALL be created in a migration, and it SHALL be gated on a per-project Vault secret,
`weekly_digest_enabled`, which the migration chain cannot replicate. A project where the owner has
not created it SHALL run the job and do nothing.

`docs/ENVIRONMENTS.md` §Scheduled jobs: *"If that is written as `pg_cron`, it lives in a migration,
and the chain replicates it to DEV — where it will also fire."* `121 §10` decided to gate in the
chain rather than schedule outside it, because a job outside the chain is invisible to
`db:drift`, to the RLS suite and to `reviewer`. **That decision is reapplied, not reopened.**

`121`'s gate is its three **network** secrets, and assembly has no network hop, so it would
otherwise be ungated. It therefore gets its own secret rather than borrowing one that describes a
different thing.

The migration SHALL apply cleanly with `pg_cron`, `pg_net` and `supabase_vault` **all absent**,
because none is installed on either project and the RLS suite runs the chain against a plain
Postgres 17 where none exists.

#### Scenario: A project with no secret assembles nothing
- **WHEN** `private.weekly_digest_tick()` runs where `weekly_digest_enabled` is absent
- **THEN** it SHALL return without writing a row
- **AND** it SHALL NOT raise

#### Scenario: The migration applies with no extensions present
- **WHEN** the chain is replayed against a plain Postgres 17
- **THEN** every `vault.`, `cron.` and `net.` reference SHALL be inside dynamic SQL behind a
  catalogue check, so no name is resolved that does not exist
- **AND** the `pg_cron` check SHALL be a `pg_proc`/`pg_namespace` lookup rather than
  `to_regproc('cron.schedule')`, which **raises** on pg_cron's ambiguous overload instead of
  returning NULL

#### Scenario: The block is re-runnable
- **WHEN** the owner installs `pg_cron` and re-runs the schedule block
- **THEN** it SHALL unschedule-if-present and then schedule, so running it twice is safe

#### Scenario: Assembly needs no sender of its own
- **WHEN** the delivery path is reviewed
- **THEN** assembly SHALL make no outbound call of any kind
- **AND** `121 §10`'s existing one-minute tick SHALL be the only thing that reaches a provider,
  so the digest inherits its age cut, its reclaim window and its at-most-once claim unchanged

### Requirement: The digest screen SHALL define every state it can be in

The in-app surface SHALL name an answer for each of: empty, loading (first paint and refetch),
error with a retry, offline, permission-denied, partial, and stale.

**Permission-denied and empty are indistinguishable from the client and need different UI** — RLS
returning zero rows looks exactly like there being no rows. For this screen the resolution is
stated rather than left to the implementer: `my_weekend_digest()` is an own-row RPC that the
caller can always execute, so a zero-length result is **always** "nothing to show" and never "not
allowed". There is no permission-denied state on this screen, and that is a property of the RPC's
shape rather than an assumption.

#### Scenario: Loading is gated on data, never on a loading flag
- **WHEN** the screen first renders
- **THEN** it SHALL gate on the data being `undefined`, not on `isLoading`, because on the first
  render there is no data *and* no fetch in flight

#### Scenario: `null` and `undefined` mean different things
- **WHEN** the read resolves
- **THEN** `undefined` SHALL render a skeleton and a decided empty answer SHALL render the empty
  state; only a decided "this does not exist" SHALL reach `notFound()`

#### Scenario: Offline degrades to the last answer, and says so
- **WHEN** the device has no connection
- **THEN** the screen SHALL render the last cached answer with a stale marker rather than an error,
  because riders lose signal constantly
- **AND** it SHALL NOT present a cached list as live

#### Scenario: A failed read offers a retry
- **WHEN** the read errors
- **THEN** an error state with a retry affordance SHALL be drawn, and the error SHALL NOT be
  rendered as emptiness

#### Scenario: Opening the screen marks the digest read
- **WHEN** a rider opens the digest for a period in which they hold a `rider_digests` row
- **THEN** `read_at` SHALL be stamped, and the cache entry SHALL be invalidated through a key
  spelled in `src/lib/query/keys.ts`
- **AND** a rider with no row for the period SHALL still be able to open the screen, stamping
  nothing

#### Scenario: The content read is not issued during a server render
- **WHEN** the screen is server-rendered on first load
- **THEN** the read SHALL be issued from an effect, never during render, because that pass is
  anonymous and the RPC would fail closed
