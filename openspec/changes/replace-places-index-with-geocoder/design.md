## Context

See `proposal.md` §Why for the motivation. What shapes the design rather than the decision:

- **The vendor is unreachable from here, and that is separate from what can be read about it.**
  `*.geoapify.com` is egress-blocked from the build container — `WebFetch` returns `EGRESS_BLOCKED`
  and so does `curl` through the agent proxy — so **not one request in this design has been issued**,
  exactly as `resolve-ride-location/gates.ts`'s header says of the code it already ships.

  **`WebSearch` is a different capability and it IS available to the main thread**, which is how the
  vendor's published quota, rate limit, credit cost and `place_id` format reached this file. An
  earlier draft of this bullet said the session had no `WebSearch` and used that to hand the licence
  questions to the owner; that was true of the subagent that drafted it and false of the thread that
  owns it, and the two statements disagreeing across files is exactly the defect this bullet exists
  to prevent. Q1 and Q2 in §Open Questions are re-scoped accordingly: they are blocked on reading a
  specific per-source table, not on having a search tool.

  Every value below is marked **measured**, **documentation-derived** or **assumed**, per CLAUDE.md's
  rule that an inferred value must never pass silently as a known one. Published documentation is the
  middle one: better than a guess, not a substitute for a response.
- **Deploying an Edge Function is an owner action.** No `supabase` CLI in the container and
  `deploy_edge_function` on the `deny` list. There is already a queue: PD-267 carries an undeployed
  `resolve-ride-location` (its `067` picked-start arm) plus the `src/lib/actions/rides.ts` guard that
  must come out in the same PR. This change puts a third item behind it, and unlike those two it is
  **on the critical path** rather than a fail-safe drift.
- **The existing metering precedent is `052`.** `ride_map_render_attempts` is a ledger whose ceiling
  lives in its own INSERT policy — measured on PROD today:
  `private.ride_map_renders_in_window(ride_id) < 10`, `security definer`, in `private`, counting a
  24-hour window. It exists because the same function, stateless and callable concurrently, could not
  count for itself. That is this design's rate limiter with the subject changed from a ride to a
  rider.
- **The current search has no client cache at all.** `keys.places.search` is declared in `keys.ts`
  and `grep -rn "keys.places" src/ | grep -v keys.ts` returns nothing: `PlaceSearchField` calls
  `searchPlaces` directly from an effect.
- **What is actually stored today**, measured on both projects: PROD 2 rides / 1 club, **zero**
  place ids on either. DEV 7 rides / 7 clubs, **one** ride carries an Overture id
  (`987a85c6…` → `90f7f9bc-9562-4af1-9c7d-8f0a2f8b85bd`, "De Hoorn, Alphen aan den Rijn", latitude
  52.1389771, longitude 4.6475534, `geocode_confidence` NULL — a genuine picked row). PROD holds 5
  profiles with a `location`, DEV 7.

## Goals / Non-Goals

**Goals:**

- A rider can find a residential street address, which is what the current index structurally cannot do.
- The vendor key and hostname stay out of the bundle, and rider IP addresses stay off the vendor.
- One signed-in rider cannot exhaust a quota every rider shares, and the enforcement survives someone
  calling PostgREST directly.
- The search surface tells its failure states apart, and no form is ever blocked by a third party.
- The 337 MB table leaves the database, on both projects, without taking a rider's stored location
  with it.

**Non-Goals:**

- Choosing the vendor. Settled by the product owner this session; Google and Mapbox stay rejected on
  the clauses in `scripts/places/README.md`.
- Reverse geocoding, structured address entry, recent-places history, ghost-text completion, offline
  search. Each is named in the spec as deliberately unbuilt.
- Establishing the paid-tier limits. The free plan's numbers are the ones this design is built
  against; the paid figures are **unknown**, and are left unknown rather than invented.
- Fixing `ride_map_render_attempts`' own missing retention. Named as a follow-up rather than widened
  into here.

## Decisions

### D1 — One Edge Function, two modes, and this repo's own result shape on the way out

`search-places` takes `{ mode: 'search' | 'locality', text, near? }` and returns
`PlaceSearchResult[]` / a single centroid — **our** types, not the vendor's.

Two modes rather than two functions because they share every expensive part: JWT verification, the
metering write, the key, the timeout, the CORS preflight, and the redaction rules. Two functions
would mean two deploys the owner has to run and two places for the ceiling to drift.

Mapping the vendor's response to our shape inside the function is what keeps a vendor field name out
of the bundle and out of `PlaceSearchField`, which does not change at all except for copy. It also
means the client's contract — `id`, `label`, `meta`, `lat`, `lon` — survives, so
`placeLabel()`/`boundName()` and the four hidden inputs keep working unchanged.

*Alternative rejected:* return the vendor's JSON and map it in `lib/data/places.ts`. It is less code
and it puts the vendor's vocabulary in the bundle, which is the thing `no-geoapify-key.test.ts`
exists to prevent from happening by the other door.

### D2 — The file is split `index.ts` / `shape.ts`, for the reason `gates.ts` exists

`tsconfig.json` excludes `supabase/functions`, so nothing type-checks a Deno file. Every *decision* —
the request builders, the response mapping, the term bound, the ceiling constants — goes in
`shape.ts`, with no Deno global and no `jsr:` import, so a Vitest file under `src/__tests__/` can
import it and `tsc` follows it in. `index.ts` keeps only the wiring.

This is not a style preference: it is the only mechanism this repo has for testing anything in an
Edge Function, and `add-ride-map-tiles`' spec already requires the outbound request to be asserted
rather than described.

### D3 — Metering lives in Postgres, in an INSERT policy, and the function cannot bypass it

`069` adds:

```
public.place_search_attempts (id uuid pk default uuid_generate_v4(),
                              user_id uuid not null references profiles/auth.users,
                              attempted_at timestamptz not null default now())
```

**`id` MUST carry that default, and this sketch previously omitted it.** The proxy inserts
`{ user_id }` and supplies no id — copying `052`, which works only because
`ride_map_render_attempts.id` has `uuid_generate_v4()` (verified on DEV). A migration written from
the earlier sketch would take the grant on `id` as licence to require one, and the resulting NOT
NULL violation lands on the ledger-failure branch: **every search app-wide would read as a ceiling,
with no error visible anywhere.** Copy `052`'s column definition rather than this paragraph.

- RLS on. **INSERT** policy, all four conjuncts — `user_id = auth.uid()` **AND**
  `private.place_searches_in_window(auth.uid(), '1 hour') < PER_RIDER_HOURLY` **AND**
  `private.place_searches_in_window(auth.uid(), '24 hours') < PER_RIDER_DAILY` **AND**
  `private.place_searches_today() < APP_DAILY_SEARCH`.

  **Both per-rider ceilings are enforced here, and an earlier draft of this section carried only
  one.** §D4 derives `PER_RIDER_HOURLY` as the burst arm — 60 credits spent in a minute is the
  pattern a script makes, not a rider — and a constant with an arithmetic justification and no
  enforcement point is decoration. The window is a parameter of the one helper rather than two
  helpers, so the two ceilings cannot drift apart in implementation.
- **SELECT** policy: own rows only. No UPDATE grant, no DELETE grant, for any client role.
- Grants: table-level `select, insert` — **not** the per-column `insert (id, user_id)` an earlier
  revision of this bullet specified. `051` grants table-level for a stated reason and `069` follows
  it: the requirement is that a caller naming `attempted_at` has the value **replaced** by server
  time, and a column grant refuses the statement outright instead. The BEFORE INSERT trigger is the
  mandated mechanism, so the grant stays wide enough for it to be the thing observed — and the RLS
  suite asserts the replacement rather than the refusal.
- `enforce_participation_gate` hangs on it, which takes that trigger from **10 tables to 11**
  (measured 10 on PROD today). An account created by calling GoTrue directly and never accepting the
  terms therefore cannot spend a credit.
- Both counter functions are `security definer`, live in `private`, and are executable by no client
  role — a subject-taking counter a rider could call is an oracle for another rider's activity, which
  is `060`'s reason for keeping `is_club_member_for` unreachable.

The function writes the row **before** it calls the vendor and treats a refusal as the ceiling. This
is `052`'s ordering and `052`'s reason: a counter that rises on success misses the retry loop, which
is the only traffic that exhausts a quota.

*Alternatives rejected:* an in-memory counter in the function (stateless, multi-instance,
concurrency-bypassable); a service-role key so the function can meter privileged-ly (voids the whole
reason the function has no key); a Postgres advisory lock or `pg_cron` (neither is a durable count);
an external rate limiter (a tenth runtime dependency and a second place the ceiling can drift from).

### D4 — Two ceilings, with the arithmetic written down, and a reserve for the map

**Vendor inputs — DOCUMENTATION-DERIVED, not measured, and the distinction is load-bearing because
every ceiling below is sized against them.** All three come from the vendor's own published pages,
read via `WebSearch` on 2026-08-19: the free plan is 3,000 credits/day
(<https://www.geoapify.com/pricing/>), the free-plan rate limit is 5 requests/second (same page),
and an Autocomplete request costs 1 credit — the same as a Geocoding or Reverse Geocoding request
(<https://apidocs.geoapify.com/docs/geocoding/pricing/>). **Paid tier: unknown, and left unknown
rather than invented.**

A published figure is evidence; it is not an exercise of the API, and it can be stale or
plan-specific in ways only a real response header shows. Task 0.4 is what converts these into
measured values, and until it is ticked no number in this section may be described as measured. That
is CLAUDE.md's standing rule that an inferred value must never pass silently as a known one.
PD-114's own 2026-08-08 provider table says the same of its whole contents: *"Every figure in
that table is search-derived."*

**Derived, and stated as arithmetic rather than as a round number:**

- A completed field costs roughly 3–8 credits — 250 ms debounce, 4-character floor, one credit per
  pause, plus one for a correction.
- `resolve-ride-location` costs up to 3 credits per attempt (one geocode plus two static maps) and
  `052` permits 10 attempts per ride per 24 h, so a single heavily-edited ride can cost 30.
- Recommended starting values, owner-tunable, both named constants with this paragraph beside them:
  **`PER_RIDER_DAILY = 60`** (about ten completed fields — well past honest use, well short of
  draining anything), **`PER_RIDER_HOURLY = 20`** (the burst arm, because 60 spent in one minute is
  the pattern a script makes), and **`APP_DAILY_SEARCH = 2000`**, leaving **1,000 credits/day
  reserved** for geocoding and tiles.

The reserve is the part that is not obvious. Search fails **loudly** — the rider reads a message.
`resolve-ride-location` fails **open**: every vendor failure returns `rendered: false`, the ride
saves, no map appears and nobody is told. So an unrationed typeahead does not degrade itself first;
it silently degrades the thing with no error path at all.

### D5 — `getLocalityCentroid` becomes the proxy's second mode; it does not go away

The brief's framing — a search bias — understates it. `resolveRiderLocation()` feeds `/clubs` and
`/clubs/explore`, where `ExploreClubsStrip` and `near-label.ts` draw "X km away" and order clubs
near-first. The device source only ever succeeds when permission is **already** granted, because the
app deliberately never prompts. So for most riders the profile centroid *is* their location, and
dropping it takes distances off a shipped screen for everybody who has not granted GPS.

It is metered under the same ledger — same vendor, same credit — and cached under the existing
`riderLocation()` key with the existing memoisation, so the cost is **at most one credit per rider
per WebView lifetime**, not one per screen.

*The follow-up, with its trigger:* if the application ceiling starts being reached on an ordinary
day, resolve the centroid **once at write time** and store it in two nullable columns on `profiles`,
so Explore costs nothing at all. That is a migration, two grants and a coupling CHECK, and it is not
worth doing before the credit line is visible. It is named here so the next session finds a decision
rather than an omission.

*Alternative rejected:* drop the profile source and let Explore fall back to unordered. It is a
silent regression of PD-259's shipped feature, for a saving of one credit per rider per session.

### D6 — The stored id gains a namespace, and its length bound is known to break the current CHECK

The column is loose `text` with no FK, deliberately (`066` and `067` both say so). Removing the index
removes the last thing that could ever resolve it, which changes nothing about how it is read — it is
already provenance, and `067`'s CHECK uses `start_place_id IS NOT NULL` as *the* marker for "a rider
chose this point".

New picks store **`geoapify:<place_id>`**. The prefix costs nine characters and buys the ability to
tell, for ever, which provider issued any given id — which is the thing `067`'s CHECK would otherwise
silently reinterpret.

**The bound is the dangerous part.** `CLUB_LOCATION_PLACE_ID_MAX` is 100 and
`rides_start_place_id_length` matches. A Geoapify `place_id` is materially longer than an Overture
GERS uuid, and **its length cannot be measured from this container**. If it exceeds 100, every pick
raises `23514` on both tables the day this ships, and the rider can neither see nor shorten the
value. So `069` raises both bounds, and the number comes from **task 1.1** — one live call, made by
whoever can reach the vendor — not from this file. Recommended default if the measurement cannot be
obtained in time: **512**, which is generous against every opaque id format this class of vendor
uses and still bounds a client-controlled column.

*Alternative rejected:* store no id and add a boolean "picked" column. It reopens `067`'s explicit
"no enum, no second statement of the same fact" decision and needs its own migration on two tables.

### D7 — Three PRs, and the destructive one is last by construction

**PR 1 — the function.** `supabase/functions/search-places/`, its unit tests, the tripwire extension,
and nothing else. It changes no rider-visible behaviour. **The owner deploys it to DEV and PROD.**

**PR 2 — the switch.** `069` (additive: the ledger, the ceilings, the raised bounds), the client
moving to the proxy, the cache, the floors, the copy, the attribution, the docs. Merging deploys to
DEV against a project where the function is already answering.

**PR 3 — the removal.** `070` drops `places`, `search_places` and `locality_centroid`; the assertion
sections, `scripts/places/`, and the workflow are deleted with them. Applied to DEV after PR 2 is
live there, and to PROD after PR 2 promotes.

This is `021`/`025`'s additive-first, deploy, destructive-last, applied to a deploy nobody in a
session can perform. The failure mode being avoided is precise: a client calling a function that is
not deployed shows every rider a broken search on a surface that worked yesterday, and no gate in
this repo would see it — the RLS suite, `tsc`, ESLint, Vitest and `next build` all stay green.

*Alternative considered and rejected:* have `searchPlaces` try the proxy and fall back to
`search_places()` when the function is absent, collapsing PR 1 and PR 2 into one. It is about fifteen
lines and it removes the ordering hazard entirely — but it also means the first real exercise of the
new path might be silently skipped in favour of the old one, and a fallback that has to be deleted in
PR 3 anyway is a temporary code path with a permanent risk of being kept. **Reconsider it if the
owner cannot deploy PR 1 promptly**, since the alternative is the search sitting dark on DEV.

### D8 — No country filter; bias only

Today's search is NL-only by accident: the extract is an NL extract. A hard `countrycode` filter
would preserve that accident as a rule and return zero results for a ride into Belgium or Germany,
which reads as "no matches" and is unfixable by the rider.

So the request biases toward the rider's coordinate when one is known, and filters by nothing. This
**widens** behaviour, which is the safe direction: nothing that used to be findable stops being
findable.

### D9 — A vendor 429 is an outage, and the proxy does not try to be clever about it

The vendor's 5 requests/second is a **global** limit, not a per-rider one, so ten riders typing at
once can exceed it while every one of them is far below their own ceiling. The proxy is
multi-instance and cannot coordinate; a retry would spend a credit to make the burst worse.

So: every non-2xx from the vendor, 429 included, becomes a single "unavailable" outcome — the same
shape `resolve-ride-location`'s `fetchJson` already uses, for the same stated reason ("the
rider-visible outcome is identical to an outage"). No retry, no backoff, no `Retry-After` shown to a
rider.

**A failed ledger insert splits the other way, on the error code, and the split is not optional.**
Collapsing the rider's ceiling, the application ceiling and the participation gate into one
`ceiling` outcome is deliberate — they are three conjuncts of one policy and the function does not
get to know which one bound. Collapsing *those* with a missing table or a schema-cache miss is not,
and it is exactly the state PR 1 deploys into: `069` is PR 2, so between the owner's deploy and
that migration every search would tell the rider they had hit a limit they have not reached, and
PR 2's client renders that as the rider's fault. So `42501`/`PGRST301` is the ceiling and anything
else — `42P01`, `PGRST205`, no code at all — is `unavailable`. Matched on the code, never the
message, which is a vendor string that can change under us.

### D10 — Nothing logs the term, and the metering row cannot become a search log

`attempted_at` and `user_id`, and no text column — not now and not as a "temporary" debugging aid. A
term on this surface is frequently a home address; a table of terms keyed to riders is a location
history with extra steps, and the moment the column exists something will start reading it.

The function's log lines carry an outcome and a reason code, following `resolve-ride-location`'s
`noTile(reason)`, whose comment already says exactly this. Its uuid redaction helper is copied rather
than shared, because the two functions deploy independently.

### D11 — Retention: seven days, swept by the insert that follows

Rows expire after **7 days**, comfortably past the 24-hour counting window so no expiry can move a
ceiling decision. The sweep is a row-level `after insert` trigger deleting **the inserting rider's
own** expired rows — row-level and not the statement-level an earlier revision of this paragraph
specified, because a statement-level trigger has no `NEW` and so could not scope the delete to the
inserting rider at all — bounded by the `(user_id, attempted_at)` index, so its cost never grows with the
table and one rider's sweep cannot fail another rider's search.

**Insert-driven, so it bounds an ACTIVE rider's rows rather than promising nothing outlives seven
days.** A rider who searches once and never returns keeps those rows, because the only thing that
deletes them is their own next insert. Accepted at this size and stated rather than hidden: the rows
hold a user id and a timestamp and nothing else — no term, no coordinate — so what persists is "this
rider looked something up on this day", and deleting the account still takes them all. Closing it
properly wants a scheduled job, which is an Edge Function on a cron and therefore an owner deploy;
it is not worth one on its own. **If a term or a coordinate is ever added to this table, that trade
stops being acceptable.**

This deliberately does *not* reach `ride_map_render_attempts`, which has no retention at all today —
that is a real gap and it is somebody's follow-up, not a widening of this change.

## Risks / Trade-offs

- **Branded POI coverage may get worse while addresses get better, and that is the real trade.**
  PD-114's second research pass rates this vendor's POI layer *"patchy — only if it's present in the
  OpenStreetMap database"*, where the retired index carries Foursquare-, Meta- and Microsoft-sourced
  rows. `Shell Pernis Werk` is the design's own sample and `Jumbo Maastricht` is the documented
  behaviour of `search_places()`. → **Mitigation: measure it first (task 0.6).** A collapse in branded
  search is a product finding, not an implementation detail — the addresses still justify the switch,
  but the owner should know the price before it is paid, not after a rider reports it.
- **The storage licence is search-derived rather than read, and it is favourable.** PD-104 chose this
  vendor partly *because* it is OSM-derived and its storage rights do not lapse, and PD-114's second
  pass says so in as many words. Nobody has read the clause verbatim — every provider host is
  egress-blocked and this session had no `WebSearch` either. → **Mitigation: it stays labelled
  INFERRED**, and it is narrower than it looks: `resolve-ride-location` has stored geocoded
  coordinates from this vendor since 2026-08-09, so this change *widens* an established practice to
  picked points and club locations rather than introducing one.
- **The `place_id` length is unmeasured and can break every pick on both tables.** → Task 1.1 measures
  it before `069` is written; 512 is the fallback default.
- **The premise itself is unexercised.** Nobody has confirmed the vendor returns
  "Willem Claijstraat Berkhout". It is a geocoder and it should — but "should" is what the last index
  was chosen on. → One live autocomplete call, task 0.1, before any code is written.
- **The quota is small and shared.** 3,000 credits/day is roughly 350–700 completed searches
  app-wide, before the map's reserve. → The reserve and the two ceilings are the mitigation; the
  trigger for the paid plan is the application ceiling being reached on an ordinary day, and there is
  **no alerting** to notice it, which is a stated gap.
- **The owner's deploy queue is already backed up** (PD-267, two undeployed function changes). This
  change cannot land its client half until a *third* deploy runs. → PR 1 is small and standalone
  precisely so it can be deployed independently; D7's rejected fallback is the escape hatch if the
  wait is long.
- **`070` is irreversible in a session.** Reloading the index means a 99 MB extract through a workflow
  this change deletes. → It is a separate PR, after the replacement is live on that project; and
  `git show <sha> -- scripts/places/` recovers the loader if it is ever needed.
- **Nothing renders any of this in CI.** The only gate that renders anything is `npm run walk`, which
  no session can run — it needs two environment variables nobody can hand it (PD-268). So the six
  states of the sheet are reasoned and reviewed rather than exercised, and that fact belongs in the
  PR body, as PD-114's did.

## Migration Plan

1. Measure the vendor: one autocomplete call for the owner's street, one for a town, and read the
   `place_id` length. Owner or anyone with egress.
2. PR 1 — the function and its tests. Merge. **Owner deploys to DEV, then PROD.**
3. Verify the deploy **by content**, not by a moved digest: `get_edge_function` on both refs, checking
   the deployed source carries the metering write and both modes. `ezbr_sha256` moving proves a deploy
   happened, never which build — PD-249's lesson.
4. PR 2 — `069` applied to DEV, the client switched, docs and copy. Merge to `development` (deploys
   DEV), verify, then **apply `069` to PROD BEFORE promoting to `main`**, and only then promote.

   **This inverts `docs/ENVIRONMENTS.md` §Migrations' numbered order on purpose, and the inversion
   is the correctness argument rather than a shortcut.** That list puts the promotion merge at step
   4 and the PROD apply at step 5, which suits a migration whose code must ship first. `069` is the
   other kind: it widens the `place_id` CHECK from 100 to 512, and PR 2 also ships the client that
   writes `geoapify:<place_id>` at 126 characters and up. Merging to `main` IS the PROD code deploy
   — Vercel auto-deploys from it — so following that order literally leaves a window in which
   **every pick on PROD raises `23514` on both `rides` and `clubs`**, on a value the rider can
   neither see nor shorten. ENVIRONMENTS.md's own table one paragraph above that list says so for
   this migration's type: *additive — apply, then deploy the code*. This change's own
   `specs/database-enforced-integrity/spec.md` states it as a requirement — the constraint is
   widened in a migration that lands **before** the code that writes one.

   The DEV half already had this order; only the PROD half inverted it.
5. PR 3 — `070` applied to DEV once PR 2 is live there; deletions; assertion sections removed. Promote,
   apply `070` to PROD.
6. Rollback: before step 5, reverting the client to `search_places()` restores the previous behaviour
   entirely, because `069` is purely additive. After step 5 there is no rollback — which is why step 5
   is its own PR.

## Open Questions

Each carries a recommended default so the build is never blocked on an answer, and names who can
actually answer it.

- **Q1 — May we store geocoded coordinates and place names from this vendor indefinitely?**
  *Non-blocking, but confirm before PROD.* **Owner**, or anyone with egress. **Substantially
  answered already**: PD-114's research pass records that ODbL/OSM-derived providers are the only
  ones whose storage rights do not lapse, and PD-104 chose this vendor partly for that. **Default:**
  proceed, mark the position INFERRED rather than settled, and record it beside the attribution the
  way PD-191's storage half already is.
- **Q2 — Does showing results in a list oblige more than a rendered tile does?**
  *Blocking before PROD.* **Owner.** PD-114 already records that the free plan requires a Geoapify
  credit **on top of** OpenStreetMap's, which is the floor; what is unread is whether a list obliges
  anything beyond a credit. **Default:** pay both credits visibly in the sheet footer, which is
  strictly more than the link paid today and therefore cannot fall short of whatever the answer is.
- **Q2b — Does branded POI search survive the switch?** *Blocking before the client half, and it is a
  product question rather than a technical one.* **Owner decides what to do about the answer; anyone
  with egress can produce it** (task 0.6). **Default:** ship anyway and record the regression — a
  rider who cannot find their own street today is worse off than one who has to type "Shell
  Pernis Werk" in full.
- **Q3 — How long is a `place_id`?** *Blocking before `069`.* **Anyone with egress.**
  **Default:** 512.
- **Q4 — What are the paid-tier limits and price?** *Non-blocking.* **Owner.** **Default:** record
  as unknown; do not size the ceilings against a guess.
- **Q5 — Are the recommended ceilings right?** *Non-blocking.* **Owner**, tunable in a one-line
  migration. **Default:** 20/hour, 60/day per rider, 2,000/day app-wide.
- **Q6 — Should the centroid be stored on `profiles`?** *Non-blocking.* **Any session, later.**
  **Default:** no, until the application ceiling is reached on an ordinary day.
- **Q7 — Is the free-tier database still the plan?** *Non-blocking, but the arithmetic changes.*
  **Owner.** Dropping 337 MB takes the database from 96% of the 500 MB ceiling to about 3%, which
  removes the strongest existing argument for paying — while the vendor quota becomes the new
  ceiling. **Default:** stay on free until either ceiling is hit; note that free-tier auto-pause
  after ~7 days idle remains the unrelated pre-launch blocker it already is.
