# Design — a weekly "what's on this weekend"

## Context

Everything below rests on measurements taken against DEV (`fpmrimzxadewsaiwpsel`) on
**2026-09-19**, not on recollection. The commands are beside each claim so a later reader can
re-derive rather than trust.

**The migration number is `125`.** `list_migrations` reads `124 reports_reach_a_human`, applied
07:39:16Z from slot-1's branch whose file is not in this tree. So
`ls supabase/migrations/ | tail -1` answers `123_report_a_postcard_comment` and would hand out a
number already spent — `CLAUDE.md`'s "migration drift runs in two directions", live.

**`profiles` carries no coordinate.**

```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='profiles';
-- id, username, bio, bike_model, created_at, onboarding_completed_at, location,
-- terms_accepted_at, avatar_path, cover_image_path, terms_version,
-- analytics_opt_out_at, home_country, deletion_started_at
```

`clubs` carries `latitude`/`longitude`/`location_name`/`location_place_id`; `rides` carries
`latitude`/`longitude`/`departure_at`/`timezone`/`is_public`/`club_id`/`organizer_id`. Only the
rider has none.

**"Near you" is a client-side computation today.** `src/lib/location/use-rider-position.ts` →
`resolveRiderLocation()` → `distanceKm()`, haversine in JS over a bounded page. The chain's first
source is a **silent device GPS read** and its second is `getLocalityCentroid()`, which calls the
`search-places` Edge Function from the browser. A scheduled job in Postgres has neither: no
`navigator.geolocation`, and no route to an Edge Function without `pg_net`.

**`profiles.location` is readable by other riders and this is the trap.**

```sql
select privilege_type, string_agg(column_name, ',' order by column_name)
  from information_schema.column_privileges
 where table_schema='public' and table_name='profiles' and grantee='authenticated'
 group by privilege_type;
-- SELECT: avatar_path,bike_model,bio,cover_image_path,created_at,home_country,id,location,username
-- UPDATE: avatar_path,bike_model,bio,cover_image_path,home_country,location,username
```

`location` is in both lists. A home *coordinate* added by reflex to the same allowlist is read by
every non-blocked rider through a bare `?select=home_latitude,home_longitude` that needs no screen
at all — and RLS is row-level, so the `profiles` SELECT policy admits the whole row. See D4.

## Goals / Non-Goals

**Goals**

- A rider to whom nothing happened has a reason to open the app on a Friday evening.
- The selection is a **database** question, answerable with no device, no session and no network.
- Every "must not" is a testable statement about a role and a resource, assertable in
  `supabase/tests/rls_test.sql`.
- The shipping half is genuinely completable by one `data` pass and one `feature` pass.

**Non-Goals**

- **Sending anything.** No APNs, no FCM, no `pg_cron`, no `pg_net`, no Vault secrets. The send
  half is specified in full and built later, for exactly PD-303's reason.
- **Email.** `CLAUDE.md` lists email delivery beyond Supabase's auth mails as deliberately
  undecided. A digest is the single most tempting place to invent it. It is not invented here.
- **A daily or real-time digest.** Weekly, and the cadence is a decision rather than a parameter.
- **Ranking or personalisation beyond distance and membership.** No score, no model, no
  "recommended for you".
- **A second notification inbox.** The in-app digest is one screen, not a feed.
- **Changing `public.notifications` in any way.** See D2.

## Decisions

### D1. The rider anchor is STORED, and resolving each rider's town at digest time is REFUSED

**Decision.** `125` adds `home_latitude`, `home_longitude` and `home_timezone` to `profiles`,
written at the moment the town is picked, from values the picker already holds.

**The rejected alternative is "resolve every rider's town when the digest runs", and the number
that kills it is the metering ceiling.** `supabase/functions/search-places/shape.ts`:

```
export const PER_RIDER_HOURLY = 20
export const PER_RIDER_DAILY  = 60
export const APP_DAILY_SEARCH = 2000   // "Leaves 1,000 credits/day for geocoding and tiles."
```

`APP_DAILY_SEARCH` is **application-wide across every rider**, not per rider, and it is enforced
in `069`'s `place_search_attempts` INSERT policy. A weekly digest for 5,000 riders needs 5,000
locality lookups in one job. That is **two and a half days of the entire application's place-search
budget spent in one run** — and the budget it starves is the one `114` made mandatory, because
onboarding cannot be completed without either a picked town or a country fallback. The failure
mode is not "the digest is slow"; it is *no new rider anywhere can finish onboarding*, which is
the precise state `src/app/onboarding/town/page.tsx`'s header already names as the reason that
screen has a country escape at all.

**And it is not merely expensive — it is unreachable.** `getLocalityCentroid()` is
`supabase.functions.invoke('search-places', …)` from the browser. Postgres cannot call it without
`pg_net`, which is not installed on either project. A design that needs `pg_net` for *assembly*
has bought a network dependency for a job that is otherwise pure SQL, and inherits `121` §10's
entire Vault-secret apparatus for it.

**The credit is already being spent at the pick.** `PlaceSearchResult` carries `lat`, `lon`,
`countryCode` **and** `timezone`; `PlaceValue` carries all four through to the form. Both writers
already have the coordinate in hand and discard it —
`TownQuestionSheet.tsx:109` calls `setRiderTown(place.name, place.countryCode)`, and
`src/app/onboarding/town/page.tsx` renders `<input type="hidden" name="town" value={place.name}/>`
and nothing else. Storing what is already paid for costs zero additional vendor credits.

**Considered alternative, and it stays considered: derive the anchor from the rider's clubs.**
For a rider with no town but at least one club membership, `clubs.latitude`/`longitude` is a real
signal — it is where they actually ride. Trade-off: it is a **guess about a person derived from a
group**, so it is wrong for the rider who joined a club two countries away, it moves when the club
edits its location, and it gives the rider nothing to correct because they never entered it. It
also silently makes club membership a location disclosure. **Rejected as an automatic fallback;
recorded as a candidate for a future "we think you ride from ‹town›, is that right?" prompt**,
which is a question to the rider rather than an inference about them. The town question row
(`rider-position-question`) is where such a prompt would live and it already exists.

**The second-order consequence, which is the part that gets forgotten.**
`profiles.location` has **TWO** writers:

```bash
grep -rn "\.update({[^}]*location" src/lib/actions/*.ts    # profile.ts, onboarding.ts
```

`setRiderTown` (`src/lib/actions/profile.ts`, PD-419/PD-445) and `setHomeTown`
(`src/lib/actions/onboarding.ts`, the wizard's step 2). **Anything keyed to the stored town must
be written in both**, and there is no single writer to hang the guarantee on — the same sentence
`setRiderTown` already carries about `recordAnswered()`. A unit test asserting *both* modules
write the anchor is task 4.6.

**And the guard-cache rule is adjacent but does NOT apply.** Any new writer of a stamp the route
guard's decision reads owes `invalidateOnboardingState()`. The decision reads three fields —
`terms_accepted_at`, `onboarding_completed_at`, `has_username` — and **none of the four new
columns is one of them**, so `125` adds no invalidation obligation. Both writers already call it
for their own reasons and must keep doing so; this change neither adds nor removes a call.
Re-derive rather than trust:

```bash
git grep -c "invalidateOnboardingState()" -- 'src/lib/actions/*.ts' \
  | grep -v __tests__ | awk -F: '{n += $2} END {print n}'   # 4, before and after
```

### D2. The digest is NOT a `public.notifications` row — and that is forced, not preferred

**Decision.** A new table, `public.rider_digests`.

**Three independent measurements each close the door on their own.**

1. **`notifications.actor_id` is `NOT NULL`.** A weekly digest has no actor. Nobody did anything,
   which is the entire point of the story.

2. **The actor conjunct in `036`'s SELECT policy is UNCONDITIONAL.** The live qual is

   ```
   user_id = auth.uid()
   and not private.is_blocked(auth.uid(), actor_id)
   and exists (select 1 from public.profiles ap where ap.id = notifications.actor_id)
   and (postcard_id is null or exists (...))
   and (comment_id  is null or exists (...))
   and (ride_id     is null or exists (...))
   and (club_id     is null or exists (...))
   ```

   Note the shape difference: the four subject conjuncts each carry an `is null or` escape and the
   **actor conjunct does not**. So making `actor_id` nullable is not enough — `exists (… where
   ap.id = NULL)` is false, and the row would be **written, never returned, never counted,
   silently, for ever**. That is precisely the failure `event-fanout-integrity` calls *"a row
   nobody can ever read is a defect, not a latent feature"*, and the one `089` had to fix for the
   declined-requester case with a **type-scoped arm** rather than by relaxing the conjunct.

3. **Cardinality.** A digest names *many* rides and *many* clubs. `notifications`'s subject shape
   is four nullable single-value columns plus `thread_id`, pinned by `notifications_subject_shape`
   whose `else` arm is `false`. There is no honest way to put a list in it. `036:148` says the
   per-column form exists so the policy and the shape "cannot drift apart"; a list-valued subject
   is exactly the drift.

**Considered alternative (b): reopen `036`** — nullable `actor_id` plus a type-scoped arm in the
policy, the way `089` did for `club_join_request_declined`. Cheaper to render, because the digest
would appear in the existing notification list with no new screen. **Rejected**, on three counts:
it edits the SELECT policy every other notification type reads, for one type's benefit; it would
be the *second* type-scoped escape arm in a policy whose own contract says the gate is written
**per column so it cannot become a type dispatch** (`121 §6`'s header is explicit that getting
that backwards "is a live leak"); and (3) above is not fixed by it at all. A separate table is the
conservative direction, and this story should not be the one that makes a decision of that blast
radius on the side.

**What the choice buys, stated so it is checkable.** `notifications_type_check` does not move.
`notifications_subject_shape` does not move. The SELECT, UPDATE and cascade behaviour of
`notifications` do not move. `public.push_payload_for`'s per-type CASE gains **no arm**, so its
load-bearing `else … raise` and the textual pin behind it in `rls_test.sql §121.6` are untouched.
Assertion 125.1 is the direct check: the `md5` of `notifications`'s SELECT qual and of both CHECK
constraint definitions are unchanged by this migration.

**Considered sub-alternative: an envelope PLUS an items child table.** Store the chosen ride ids
and club ids on Friday so the digest a rider opens on Sunday is the one they were sent.
**Rejected** — see D5. It stores a copy of a visibility decision, and a digest pinned to Friday's
list is a *worse* product for a screen called "this weekend".

### D3. Delivery widens the OUTBOX, not the notification

`public.push_deliveries.notification_id` is `not null unique references public.notifications(id)`.
A digest has no notification. So the waiting half makes the outbox two-armed:

- `notification_id` becomes nullable; `digest_id uuid references public.rider_digests(id) on
  delete cascade` is added, nullable, with its own `unique`;
- `check (num_nonnulls(notification_id, digest_id) = 1)` — exactly one subject, the
  `notifications_subject_shape` idiom one table over;
- `claim_push_batch` returns `digest_id` as a second output column and claims from both arms
  under the same `for update skip locked`, the same six-hour age cut and the same ten-minute
  reclaim. **All three numbers stay tied together**, as `121 §0a` requires.
- a sibling `public.push_payload_for_digest(digest_id uuid)`, `security definer`,
  `grant execute … to service_role` and revoked from every other role, whose gate is
  `rider_digests`'s own SELECT policy restated candidate-relative and whose copy is produced by
  the same shared body the screen reads (D6).

**The already-read suppression transfers unchanged and is the reason `rider_digests` carries
`read_at`.** `claim_push_batch`'s filter (a) — *"a rider who was in the app when the row landed,
saw it and tapped it must not get a push about it forty seconds later"* — is not an edge case at
a one-minute interval, and it must apply to a digest too.

**`complete_push_delivery` and `invalidate_push_device` are unchanged.** So is the Edge
Function's `.from()`-free property: everything still arrives through the four (now five) RPCs.

### D4. The anchor columns are granted to NOBODY, and the reason is a column that already is

The reflex is to add `home_latitude`/`home_longitude` to `025`'s `grant select (...)` list beside
`location`, because they say the same kind of thing. **They do not.**

`profiles.location` is a *town name* a rider typed into a public-facing profile field. A centroid
is a **coordinate about a person**, and the `rider-position-question` capability's own reasoning
already draws this line: `LOCATION_PRECISION_DP = 2` exists because a device fix is *"defence in
depth, not de-identification"*, and its comment says in as many words that *"persisting an
approximate rider location anywhere needs its own decision, not an inference from this one."*
This is that decision, and it goes the tight way.

**Decision.** `authenticated` holds **no** SELECT, INSERT or UPDATE on `home_latitude`,
`home_longitude`, `home_timezone` or `digest_opt_out_at`. The reach is four own-row
`security definer` RPCs, `096`'s shape verbatim:

| Function | Who | What |
|---|---|---|
| `public.my_home_anchor()` | `authenticated` | the caller's own anchor, and nobody else's |
| `public.set_home_anchor(lat, lon, tz)` | `authenticated` | the caller's own, and takes **no rider id** |
| `public.my_digest_opt_out()` | `authenticated` | the caller's own stamp |
| `public.set_digest_opt_out(bool)` | `authenticated` | the caller's own, idempotent |

Taking no rider id is the load-bearing half: a foreign write is *unrepresentable* rather than
merely refused (`096`'s own words for `set_analytics_opt_out`).

**`125` issues no `grant` or `revoke` on `public.profiles` at all**, which is `096 §1`'s rule —
`025`'s three grant lists are an absolute allowlist and an ungranted column is invisible, so
widening them is the only way to get this wrong and the file simply does not contain the
statement. This is additive and has no destructive side.

**Consequence that must be stated rather than discovered:** `resolveRiderLocation`'s profile
source changes from `getMyLocationText()` + `getLocalityCentroid()` to `my_home_anchor()` — one
round trip instead of two and **zero vendor credits** — and it must keep the geocoder call as the
fallback for the population that has a town and no anchor, which on the day `125` applies is
**every profile in the database**. Nothing is backfilled (D8).

### D5. The content is PRODUCED, never STORED — the row is a marker

`database-enforced-integrity`'s standing requirement is *"A derived row SHALL NOT hold a copy of a
visibility decision"*, and `121 §1` discharges it for the outbox with four conditions, of which
the first is *"It is never written to a table. No payload column, no rendered-copy column, no
cached string."*

`rider_digests` carries: `id`, `user_id`, `period_start date`, `created_at`, `read_at`. **That is
the whole table.** No ride ids, no club ids, no counts, no title, no body. A row means *"this
rider was sent the digest for the week beginning `period_start`"* and says nothing about what was
in it.

Three reasons, and the third is the one that decides it:

1. A stored list is a second copy of a visibility decision that nothing re-checks — a private
   club's ride pinned on Friday and read on Sunday by a rider removed on Saturday.
2. `unique (user_id, period_start)` is then the **entire** "exactly one per week" rule, enforced
   by the schema. An assembly job that runs twice writes nothing the second time, and a job that
   runs hourly (which it must — D7) is safe by construction rather than by a `where not exists`
   the author remembered.
3. **A live list is the better product.** The screen is called *this weekend*. A rider opening it
   on Saturday morning wants the rides that are still on, not a snapshot of Friday.

### D6. One body, two entry points — the reader and the assembler cannot disagree

`private.weekend_digest_for(candidate uuid, at timestamptz)` is the **only** place the content
rule is written. It is candidate-relative in the strict sense
`event-fanout-integrity` requires: every predicate takes the rider as an argument, and
`private.is_club_member` / `private.is_ride_crew` — which read `auth.uid()` internally and answer
only for the caller — appear nowhere in it.

Two callers:

- `public.my_weekend_digest()` — `security definer`, granted to `authenticated`, takes **no rider
  id**, calls the body with `auth.uid()`. This is what the screen reads.
- the assembly job, and later `push_payload_for_digest`, calling it with the candidate.

**This discharges `database-enforced-integrity`'s "A policy restated for a candidate SHALL be
changed in lockstep with the policy, and the two SHALL share one body where they can."** They can
here, so they do, and the drift risk `060`/`121 §4` accept for the `can_read_*` family does not
arise: there is one body, not two.

**It restates `rides` SELECT and `clubs` SELECT through the existing candidate-relative helpers**
— `private.can_read_ride(candidate, ride)`, `private.can_read_club(candidate, club)`,
`private.is_club_member_for(candidate, club)` — rather than writing its own predicates. Those are
`060`'s family, already pinned textually against the live policies in `rls_test.sql §121.6b`, so a
policy rewrite fails there rather than silently here.

**And it tests `private.is_blocked(candidate, other)` explicitly, in both directions at once**
(the helper is symmetric: `blocker_id = a and blocked_id = b` **or** `blocker_id = b and
blocked_id = a`, verified from `pg_get_functiondef`). This is not redundant with `can_read_ride`,
which block-dominates only the **organiser**: a ride whose organiser is unblocked can still be a
ride the digest must not surface, because a digest line naming a ride reveals nothing about a
blocked third party — but a **club activity** line naming *"3 new posts in ‹club›"* summarises
rows authored by riders the recipient may have blocked, and a count that includes them is a
disclosure with no row to point at. So club activity counts are filtered per author.

### D7. Cadence: assembly runs HOURLY, the digest is WEEKLY, and the gate is a fourth Vault secret

**Hourly, and this is forced by quiet hours rather than chosen.** Riders are in different zones.
A weekly job fires at one instant, which is 19:00 for one rider and 03:00 for another — and *"a
digest at 03:00 is an uninstall"*. So `private.weekly_digest_tick()` runs **hourly** and each run
selects only riders whose **own local** time is inside the send window on their own local
Thursday or Friday. `unique (user_id, period_start)` is what makes 168 runs a week produce at most
one row per rider.

**The zone ladder, and the honest limit.** `profiles.home_timezone` → `APP_TIME_ZONE`
(`Europe/Amsterdam`). **The rider's device zone is never consulted**, because there is no device;
and the server's zone is never the answer, which on Supabase is UTC. The limit is stated rather
than hidden: a rider in Auckland with no `home_timezone` is evaluated in Amsterdam's zone and
receives the digest at an hour that is wrong for them. Two things bound that. First, the fallback
window is chosen so it is *never* the small hours in the fallback zone itself, so the worst case
is a badly-timed digest and never a 03:00 one for the population the fallback actually describes.
Second, the state is self-correcting: the moment the rider picks a town, `home_timezone` is
written from the same pick at no extra credit. `rides.timezone`'s existing rule is the precedent
and it is followed rather than reinvented — `null` means *"we do not know"*, and the fallback is
named at the site.

**`pg_cron`, but NOT `pg_net` and NOT the network secrets.** Assembly makes no outbound call: it
writes rows, and `121` §10's existing one-minute tick drains them. So the digest needs **no sender
of its own**.

**But `121`'s gate is exactly those network secrets, so the assembly job needs its own.**
`docs/ENVIRONMENTS.md` §Scheduled jobs, which `121 §10` quotes rather than paraphrases: *"a
`pg_cron` job written in a migration replicates to DEV — where it will also fire."* If assembly
were left ungated, the chain would replicate it to DEV, DEV would write envelopes, and `121`'s
tick would push them the moment anyone registers a real device against DEV.

**Decision: a fourth Vault secret, `weekly_digest_enabled`, created per project by the owner.**
Same mechanism as `121` for the same reason — **Vault secrets do not replicate through the
migration chain** — and `121 §10`'s measured limitation carries over verbatim rather than being
re-litigated: Postgres on Supabase exposes no self-identifying project reference (`cluster_name`
is `main` and `current_database()` is `postgres` on both), so a secret cannot be checked against
the database's own identity. This secret is a **presence** gate and is honest about being one.
A second, independent guard already exists and is not ours: nothing is delivered unless `121`'s
three network secrets are also present on that project, and the DEV function's `APNS_HOST` points
at the APNs sandbox.

**It must apply cleanly with `pg_cron` absent**, which is required twice over — neither project
has it, and the RLS suite runs the chain against a plain Postgres 17 where `cron`, `net` and
`supabase_vault` all do not exist. Every `vault.`, `cron.` and `net.` reference is inside dynamic
SQL behind a catalogue check, `121`'s shape exactly — **including its trap**: `to_regproc('cron.schedule')`
**raises** on pg_cron's ambiguous overload rather than returning NULL, so the check is a
`pg_proc`/`pg_namespace` lookup.

### D8. Nothing is backfilled, and the state that creates is the one to design for

Every profile in the database has a town and **no** anchor on the day `125` applies (30 rows on
DEV, `select count(*) from profiles`). There is no backfill because backfilling means 30 — then
thousands — of `search-places` calls, which is D1's rejected alternative under a different name.

So *"a rider with a town and no anchor"* is not an edge case; it is **the entire population at
t=0** and a permanent population thereafter (a rider who completed onboarding through the country
fallback when the geocoder was down has a country, no town and no anchor). Three consequences, all
specified rather than left to be discovered:

- The digest **excludes** them. They are in the "nothing to show" case, and the rule there is that
  they receive nothing at all — not an apology, not a prompt.
- `resolveRiderLocation`'s profile source keeps the geocoder fallback for them, so no screen
  regresses.
- The anchor fills itself as riders next touch their town, through either writer. **No migration
  and no prompt** — but the town question row already exists and already asks *"Still in ‹town›?"*,
  and that row is the natural, gesture-initiated route. The question row must NOT be re-armed to
  open automatically to harvest anchors: `rider-position-question`'s first requirement forbids it
  and this change does not reopen it.

## Risks / Trade-offs

**A digest that is always empty is a feature nobody sees.** With 32 rides and 17 clubs on DEV the
selection will return nothing for most riders, so the in-app surface will be an empty state in
practice for some time. That is the correct behaviour and it is also **untestable by looking**.
Mitigation: the RLS-suite assertions are the proof, not the screen, and `WALK_FIXTURES` gets a
ride placed near the walk rider's anchor (task 5.4).

**The anchor is as good as the geocoder's centroid, which is a town, not a house.** A rider in a
village 15 km outside a named town gets that town's centre. For a "rides within N km" question
that is fine; it would not be fine for anything claiming precision, and nothing here does.

**A per-viewer count summarising rows the viewer cannot all see is a disclosure surface.** The
club-activity line is a count, and a count that moves when a rider is blocked or a thread is
deleted is a marker. Mitigated by computing it through the same candidate-relative body the list
uses — `client-cache-invalidation`'s standing rule that *"a count and the list it summarises SHALL
be invalidated together and read through the same predicate"*, applied to a count with no list
beside it.

**The outbox widening (D3) touches a table `121` deliberately revoked from every role including
`service_role`.** The widening must not add a grant, and the CHECK must not be satisfiable by
both arms. Both are assertions, not review items (tasks 6.4, 6.5).

**Storing a rider's approximate home is new personal data and the privacy copy has to move with
it.** `/legal/privacy` names the two push retention windows in its own words; it says nothing
about a stored coordinate. Task 4.9 is that sentence, and it is not optional — a GPS-adjacent
value with no stated window is exactly what `CLAUDE.md` calls *"a permanent record of where
someone was."* The window decided here is **the profile's own lifetime**: the anchor dies with the
profile row, with the town being cleared, and by nothing else. There is no sweep, because a
current town is not stale data.

**Opt-out semantics differ from `096`'s in the one way that matters, and conflating them is the
named failure.** `096`'s comment is explicit that *"the database cannot enforce this preference"*
— PostHog is a client-side SDK and nothing in Postgres is in its path. **The digest opt-out is the
opposite**: the selection runs in Postgres, so `digest_opt_out_at is null` is a conjunct of the
assembly query and the preference is genuinely enforced. That asymmetry is why they must be two
columns and two RPCs. It does **not** make the digest opt-out an authorization gate — an
opted-out rider loses no capability anywhere, can still open the in-app digest screen whenever
they like, and `database-enforced-integrity`'s *"A rider's preference SHALL NOT become an
authorization gate"* holds unchanged.
