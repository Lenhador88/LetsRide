## 0. Before any SQL — the questions, and what was already measured

- [x] 0.1 **Pre-flight, MEASURED 2026-08-09 against `zwprydcyryvudhurbnye` (PROD) via the Supabase
  MCP, RLS bypassed — true counts, not per-viewer:**

  | Fact | Value |
  |---|---|
  | `rides` columns | **11 — no latitude, no longitude, no image column**; `meeting_point text not null` |
  | `rides` grants to `authenticated` | **STALE — was table-level `arwdDxtm` on 2026-08-09; `045` converted `rides` to PER-COLUMN grants on 2026-08-10.** The five new columns therefore arrive with NO UPDATE grant, and `051` §5 grants them explicitly. See `design.md` §D2's correction |
  | `profiles` grants | `dDxtm` table-level + 8 per-column ACLs — the `025` revoke-and-regrant precedent |
  | Storage buckets | **one**, `media`, **private**, `allowed_mime_types = ['image/jpeg']`, 5 MB |
  | `storage.objects` policies | **15** across 5 folders — 5 SELECT, 5 INSERT, 5 DELETE, all `authenticated`, **none UPDATE** |
  | The 5 SELECT policies' shape | **4 are `own-folder OR EXISTS(parent)` — a disjunction**; only `postcards` is the bare `EXISTS`. None is prefix-only |
  | The 5 INSERT/DELETE policies' shape | folder prefix and caller uid **only** |
  | `postcards` / `clubs` SELECT | `author_id = auth.uid() OR (…)` and `is_public OR owner_id = auth.uid() OR is_club_member(id)` — an **unconditional owner arm** in each, which is the test §D9 uses |
  | `rides` non-internal triggers | `enforce_participation_gate`, `enforce_ride_club_audience`, `notify_ride_created_in_club` |
  | `propagate_club_privacy_to_rides` | `update public.rides set is_public = false where club_id = new.id and is_public` — `is_public` only |
  | Migration files / applied | **41 files / 40 applied AS AT 2026-08-09 — both numbers are now stale.** Re-derive with `ls supabase/migrations/` and `list_migrations`; the chain reached `048` on 2026-08-10 and `042`–`048` are other changes' shipped work. **This change's number is whatever comes next, and it is NOT `042`** |
  | Security advisors | **8**, matching `CLAUDE.md`'s table |

  Three of these change the shape of the work. The **grant level** is the one that moved: it was
  table-level when this table was written, `045` made it per-column a day later, and the build
  found it. Either way it is the reason the spend ledger is a separate append-only table rather
  than a counter column (§D10) — a column on `rides` was resettable under the *old* grant, and the
  ledger is what survives the question rather than depending on the answer. The **SELECT/INSERT
  policy asymmetry**
  corrects the brief
  this change was written from: `CLAUDE.md` says Storage policies here check the path prefix only,
  which is true of writes and **false of reads** — the instrument this change needs already exists
  and must be copied from a SELECT policy, never from an INSERT one.

- [x] 0.2 **Q1 — product owner, BLOCKING task 6. ANSWERED 2026-08-11, and the fail-closed default
  is lifted.** This task was held open on one remaining unknown — *which* plan the account is on,
  since the obligations differ — and the product owner confirmed it the same day: **Free.**

  So both plan-dependent obligations bind, and task 6 has what it needs to render rather than
  falling back to "build the pipeline, render no tile".

  Source: Terms and Conditions, 2 February 2024, Version 5, KEPTAGO LTD, supplied by the product
  owner because `*.geoapify.com` is egress-blocked from this container.

  **Three attribution obligations, not one. The first is the one a session would miss**, because
  every secondary source describes attribution as a free-plan concern:

  1. **OpenStreetMap attribution is required ALWAYS** — verbatim: *"When using the Services, you
     must always provide OpenStreetMap attribution."* **Not conditional on the plan.** Upgrading to
     a paid plan does not remove it, so the white-label option removes only obligation 2.
  2. **Geoapify attribution is mandatory on the Free plan** — *"Geoapify attribution is mandatory
     when using Free subscription plan."* The documented string is
     `Powered by <a href="https://www.geoapify.com/">Geoapify</a>`.
  3. **Per-API additional attribution** — *"Different APIs may require additional attribution,
     which you must comply with as specified in their respective documentation."* Unread for the
     geocoding and Static Maps endpoints specifically; assume there may be more.

  **The Static Maps API burns map-style attribution into the returned PNG by default** (bottom-right).
  That is what discharges obligation 1 in practice — **so do not suppress it.** Suppressing it does
  not remove the obligation, it moves it onto us, and obligation 1 has no plan-level escape.

  This repo still carries **one** unresolved attribution question (`places` / Overture); it is a
  separate vendor and neither answer covers the other.
- [x] 0.2b **Raised by the primary terms; DECIDED by the product owner 2026-08-11: "let's just
  store the images for now… we will check that better when we start having users on the app."**

  **Proceed with render-once-and-store as designed.** The exposure is bounded and the reasoning is
  sound: `places` aside, this app has **4 accounts on PROD and no riders**, so there is no volume of
  stored tiles to unwind and no production usage to be out of compliance on. The residual questions
  are filed as their own story rather than held here.

  **What the measured response adds, and it materially improves the position on item 1:** every
  feature carries `datasource.license` = **`Open Database License`** with
  `attribution` = `© OpenStreetMap contributors`. So the *geocoding* results are ODbL — a licence
  that does permit storage and redistribution, with attribution, rather than a vendor clause that
  has to be found. That is a stronger footing than the Terms' silence, and it is per-result rather
  than inferred. **It does not cover the rendered PNG**, which is the Static Maps product and may
  carry different underlying sources.

  Items 1 and 2 below are retained verbatim as the record of what was decided against, not as open
  work. **Item 3 stays genuinely open** and is the one to carry into the story.

  1. **There is no caching or storage clause in the Terms, in either direction.** `PD-164` §3 is
     recorded as having *"confirmed in the primary terms"* that we may store the rendered PNG
     indefinitely, serve it to multiple end users, with no subscription tether — and **the Terms
     contain no such clause**. They are silent on caching. Silence is not prohibition, and the
     absence of a retention limit is genuinely favourable, but *"confirmed in the primary terms"*
     overstates it: the licence granted is a bare *"non-exclusive, non-transferable,
     non-sublicensable license to use and access our services."* Either `PD-164` read the pricing
     page or an API doc rather than the Terms, or the claim is wrong. **The whole render-once-and-
     store architecture rests on this.** Settle where that permission is actually written before
     tiles reach riders.
  2. **Free-plan production use carries undocumented limits.** Verbatim: *"The commercial use of
     the Free-package is allowed in the development and, with some limitations, in the production
     phase. Please contact us for details."* The limits are not stated anywhere in the Terms, and
     this app is heading for production with real riders. **Owner action: email info@geoapify.com
     and get the production limits in writing**, or price the paid plan. Note the paid plan does
     not remove obligation 1 above. **Plan CONFIRMED 2026-08-11: Free.** So `0.2` obligation 2 (the
     `Powered by Geoapify` credit) does apply and needs a home, and these undocumented production
     limits are live rather than hypothetical.
  3. **What Geoapify retains of a submitted address is still unread.** The Terms delegate this
     entirely — *"Please read Privacy Policy for information about Geoapify's privacy and data
     protection practices"* — so the third question this task set is answered by
     `geoapify.com/privacy-policy/`, not here. It matters because `meeting_point` is frequently a
     home address and **our own `/legal/privacy` now makes a factual claim about this flow**. Read
     it before the function is deployed, and correct our page if it retains more than transiently.
- [ ] 0.3 **Q2 — designer, BLOCKING task 6.2 only. PARTIALLY ANSWERED 2026-08-11. Product owner:
  "do according to Figma… just make the most reasonable choice for now, we can modify/move later."**

  **A first pass at this closed the task with "one shared `Powered by Geoapify` on the ride detail
  panel, none on the cards". That contradicts this change's own merged spec** — 
  `specs/ride-map-tiles/spec.md` §*The 80×148 strip carries the credit as part of its design*:
  *"a single shared credit elsewhere on the screen SHALL NOT be accepted as covering the tiles,
  because a list is scrolled and a card is what a rider sees."* Recorded rather than silently
  corrected, because the grant of discretion is real and it is still not a licence to overrule a
  merged requirement.

  **What the owner's decision does settle:** the design carries no credit area, and none needs
  drawing — the Static Maps PNG arrives with attribution burned into the image itself, which is
  *composed into the strip* exactly as the spec requires, per tile, surviving a scroll. So the
  14px scrim-bar default is dropped in favour of not suppressing the vendor's own credit. **That
  is the whole reason suppression is off the table** (0.2 obligation 1).

  **What is still open, and only task 6 can answer it:** whether the burned-in credit is legible at
  80×148. That is precisely the spec's *A credit that cannot fit means no tile* scenario — if it is
  not legible, the strip renders the pin fallback and no tile, and that is the specified outcome,
  not a failure. Do not resolve it by shrinking, clipping or truncating.

  **Do not treat the free-plan `Powered by Geoapify` credit as covering tile attribution.** It is a
  service-level obligation (0.2 obligation 2) and needs its own legible home; the spec's rejection
  of a shared credit is about the tile's data attribution and is unaffected by where that string
  sits. Task 6.2 is unchanged and still instructs the per-tile build.
- [ ] 0.4 **Q3 — product owner, non-blocking.** Render ceiling per ride. Default: **10 render
  attempts per ride per rolling 24 hours**, enforced by the append-only ledger in task 1.4. High
  enough that no honest organizer meets it, low enough to bound a loop. The window is genuinely
  rolling — one row per attempt is what a rolling window is (`design.md` §D10).
- [ ] 0.5 **Q4 — product owner, non-blocking.** Signed-URL TTL for tiles. Default: **the shortest
  TTL already used for images in this app** — match it rather than inventing a second number, and
  record what it is. This bounds the revocation window in `stored-media-visibility`.
- [ ] 0.6 **Q5 — product owner, non-blocking, but it must be answered before real riders use it.**
  Retention. Default: **a tile lives as long as its ride, indefinitely**, since nothing deletes a
  past ride. Stated as a decision rather than left silent.
- [ ] 0.7 **Q6 — product owner / OWNER ACTION, non-blocking for the build.** The privacy policy must
  name Geoapify as a processor before real meeting points are geocoded, since `meeting_point` is
  frequently a home address. Label `Owner only` in Linear.
- [x] 0.8 **Verify the vendor's response shape before the migration hardcodes a floor. MEASURED
  2026-08-11 against a real response** (`Stationsplein 1, Amsterdam`), supplied by the product
  owner. This closes the task and **contradicts `design.md` §D3 in two places.**

  ### What the response actually carries

  | Path | Value seen | Note |
  |---|---|---|
  | `properties.rank.confidence` | `1` | **0–1 confirmed.** The `>= 0.70` floor is on the right scale |
  | `properties.rank.confidence_street_level` | `1` | present, as documented |
  | `properties.rank.confidence_city_level` | `1` | present |
  | `properties.rank.confidence_building_level` | `1` | present |
  | `properties.rank.match_type` | `full_match` | describes **how the query matched** |
  | `properties.rank.importance` | `0.00008268` | not a quality score — do not gate on it |
  | `properties.rank.popularity` | `8.995` | ~0–10, not 0–1 |
  | `properties.result_type` | `building` | **the granularity field, and it is NOT inside `rank`** |
  | `properties.lat` / `.lon` | `52.3784733` / `4.9031499` | top level of `properties`, not only in `geometry` |
  | `properties.datasource.license` | `Open Database License` | see 0.8b |
  | `properties.datasource.attribution` | `© OpenStreetMap contributors` | the exact string to render |
  | `properties.timezone.name` | `Europe/Brussels` | see 0.8c |

  **§D3 error 1 — the granularity gate reads the wrong field.** §D3 gates on a `match_type`
  vocabulary. `match_type` says how the *query* matched; `properties.result_type` says what kind of
  thing came back (`building` here). **The street-level gate must read `result_type`**, with
  `rank.confidence_street_level` as the corroborating signal. Gating on `match_type` would accept a
  `full_match` on a city.

  **§D3 error 2 — and this one is the reason this task existed.** See 0.8b.

- [x] 0.8b **DISCHARGED by the spec amendment — retained as the record of the measurement, not as open work. Note the rule stated below was superseded on review: see 4.5b, which keys on distance rather than on a tie.** Originally BLOCKING task 1 and task 5. A confidence floor cannot do the job §D3 gives it, and
  the measured response proves it rather than suggesting it.**

  The query `Stationsplein 1, Amsterdam` returned **two features**:

  | # | Formatted | `confidence` | `confidence_building_level` | `match_type` |
  |---|---|---|---|---|
  | 1 | Stationsplein 1, 1012 AB **Amsterdam** | `1` | `1` | `full_match` |
  | 2 | Stationsplein 1, 1382 AD **Weesp** | `1` | `1` | `full_match` |

  **They are 12.2 km apart and both are maximally confident.** Weesp merged into the Amsterdam
  *municipality* in 2022, so feature 2 carries `municipality: Amsterdam` and is a legitimate
  full-confidence match for the typed text.

  **Every gate this change specifies passes both of them.** `confidence >= 0.70`: both. Street-level
  granularity: both. Fail-closed `<= 1.0` upper arm: both. A pipeline that takes `features[0]`
  silently sends a rider 12.2 km wrong **with the highest possible confidence score attached**, and
  the stored coordinate then looks exactly like a good one.

  This is the same failure `PD-149` describes for the picker (*a nearby street can crowd out a
  famous landmark of the same name*) and the one **`PD-114`** named — *"a guess that can silently
  centre the tile on the wrong Shell station"* — which is PD-114's characterisation of **this**
  change's approach, not a note this issue made about itself. It was read as a low-confidence
  problem in both places. **It is not — it is an ambiguity problem, and confidence is silent on
  ambiguity.**

  **Required change before the migration is written:** the gate must reject on *ambiguity* as well
  as on confidence. Minimum viable rule — **if more than one returned feature ties at the top
  `confidence`, resolve nothing**: leave the coordinate NULL and fall back to today's text panel.
  That is the same fail-closed direction the rest of this change takes, and it is cheap. Do not
  break the tie on `importance` or `popularity`; both are vendor-relevance signals, neither knows
  which town the rider meant.

  Note this makes the coupling CHECK a weaker line of defence than §D3 assumed, and moves the real
  work into the Edge Function. Task 1.1 must state that explicitly rather than implying the CHECK
  bounds correctness.

- [ ] 0.8c **Non-blocking, and it belongs to a different story — file it, do not build it here.**
  The response carries `properties.timezone.name` = `Europe/Brussels`. `CLAUDE.md` §Technology
  Decisions records ride times pinned to `APP_TIME_ZONE` as *"a documented interim"* whose correct
  model is *"wall-clock at the meeting point, which needs a zone column on `rides`"* — and this is
  exactly that zone, arriving free with a geocode we are already making. Worth a story; out of
  scope here.

## 1. The migration (purely additive, safe to apply first)

- [x] 1.1 Write the migration. **Re-derive its number** — `ls supabase/migrations/` — this task
  said `042`, which is now a different change's applied migration (`042_revoke_profiles_delete_grant.sql`), and the chain reached `048` on 2026-08-10. **Header must state the grant level read
  from `relacl` and `attacl`** and that the table-level grant is deliberately left in place — the
  columns arrive client-writable and that is accepted, per `design.md` §D2.

  **The header must also state what the CHECK does NOT do, and this is stronger than it was.**
  `design.md` §D3 originally read as though the confidence floor bounded correctness. It does not:
  `0.8b` measured two candidates 12.2 km apart both at `confidence: 1`, so **the coupling CHECK
  cannot distinguish a right coordinate from a wrong one at all** — it enforces only that a
  coordinate is accompanied by a confidence at or above the floor, and a tile path by a coordinate.
  The ambiguity gate and the granularity gate both live in the Edge Function, and the schema cannot
  see either. Say that in the header rather than letting the next reader infer a guarantee from a
  constraint. The relevant scenario is *The granularity gate is a function-side rule and is not
  overclaimed*, and it now covers ambiguity too.
- [x] 1.2 Add **five** nullable columns to `public.rides`: `latitude double precision`,
  `longitude double precision`, `geocode_confidence real`, `map_card_path text`,
  `map_detail_path text`. NULL is the normal state, not an error.
- [x] 1.3 Add the constraints. **Two things about the floor comparison, both measured on Postgres
  17 against DEV rather than reasoned about:**

  - **Cast the literal to the column's type.** `select (0.70::real >= 0.70)` returns **false** —
    `real` cannot represent `0.70` and the bare literal is `numeric`, so Postgres widens the `real`
    and the comparison fails. A candidate whose confidence is *exactly* the stated floor therefore
    violates its own CHECK, and the failure is not a filter but a write error: the Edge Function's
    `UPDATE` raises, on a path no scenario covers, skipping the compensating delete in 4.8. Write
    `>= 0.70::real`, or make the column `numeric`.
  - **Add the upper arm.** `geocode_confidence <= 1.0` was described in 0.8b as an existing
    fail-closed defence and is not in this list. The scale is plausible rather than validated, so
    the arm is what makes a mis-scaled vendor value fail closed — no tiles ever, rather than wrong
    ones.

  The constraints:
  - the **coupling + floor** CHECK — either all of `latitude`/`longitude`/`geocode_confidence` are
    NULL, or all are present with the coordinates in range and `geocode_confidence >= <floor>`;
  - a **one-directional** CHECK — a tile path requires a coordinate, but a coordinate does **not**
    require a path, so a successful geocode with a failed upload stays writable;
  - a **path-pinning** CHECK on both path columns —
    `like 'ride-maps/' || organizer_id::text || '/%'` plus the filename shape, matching the pinning
    `profiles` and `clubs` already use.
- [x] 1.4 Add `public.ride_map_render_attempts` — the append-only spend ledger (`design.md` §D10).
  **The ceiling as specified here and in §D10 is NOT implementable**: a `count(*)` over the ledger
  inside the ledger's own INSERT policy raises `infinite recursion detected in policy`, so no
  insert could ever succeed. `052` moves the count into `private.ride_map_renders_in_window()`.
  Original text follows for the reasoning, not as an instruction:
  `id uuid` PK, `ride_id uuid → rides(id) on delete cascade`, `attempted_at timestamptz`.
  - **Grants: `authenticated` gets INSERT and SELECT and nothing else.** No UPDATE grant, no UPDATE
    policy, no DELETE grant, no DELETE policy — the organizer must be able to raise their own count
    and must not be able to lower it.
  - INSERT policy: the caller organises the ride, **and** their row count inside the rolling window
    is below the ceiling (Q3). This `WITH CHECK` **is** the ceiling — bounded as described below,
    not exactly.
  - **This is the first policy in this repo whose predicate is an aggregate over its own table, and
    it overshoots under concurrency. Measure it rather than assume it when writing the migration.** Under
    READ COMMITTED two concurrent inserts each evaluate the `count(*)` before either commits, both
    see `ceiling − 1`, both pass, and the window ends with `ceiling + 1` rows. **The failure is
    permissive, not restrictive**, which is the direction that does not announce itself. The
    overshoot is bounded by the number of genuinely concurrent callers — one extra geocode for a
    double-tapped button — and is accepted at that size. Note the tension it resolves rather than
    removes: the ceiling lives in the policy *because* the function is stateless and may be called
    concurrently, so concurrency is the reason for the design and also its one soft edge. Tightening
    it needs `SERIALIZABLE` or an advisory lock, and neither is worth one geocode.
  - **The RLS suite cannot demonstrate this** — it runs serially, so an assertion written there will
    pass whatever the concurrent behaviour is. Do not read a green suite as evidence about it.
  - SELECT policy: rows for rides the caller organises, and nobody else's.
  - **The ceiling's correctness depends on this SELECT policy, and the coupling is silent.** The
    `count(*)` inside `WITH CHECK` runs under the caller's own RLS, so it counts only rows SELECT
    admits. Today they coincide — the caller is the organizer and SELECT is organizer-scoped — so
    the count is right. **Narrowing SELECT later, for any unrelated reason, silently under-counts
    and widens the ceiling, with no test failing.** Any change to it must re-check the ceiling.
  - `attempted_at` written by a `BEFORE INSERT` trigger, **not** a DEFAULT — a client that can
    backdate a row out of the window has no ceiling (`034`'s ruling).
  - Join `enforce_participation_gate`, taking it from nine tables to ten.
  - Index `(ride_id, attempted_at desc)` so the ceiling's count never scans.
  - **The ceiling must never be enforced by a trigger on `rides`.** A `BEFORE UPDATE` trigger that
    raises aborts the whole statement, so an organizer at their ceiling could not edit their own
    ride's address at all — see task 1.8b.
- [x] 1.5 Add the stale-tile `BEFORE UPDATE` trigger clearing the five tile columns, scoped
  `WHEN (old.meeting_point IS DISTINCT FROM new.meeting_point)`. **The scope is not optional** —
  `propagate_club_privacy_to_rides` bulk-updates `rides` and an unscoped trigger wipes every tile in
  a club when it turns private. It is the **only** trigger this change puts on `rides`, and it
  clears columns rather than raising, so no ride write can be aborted by it. Revoke EXECUTE on every
  trigger function from `public, anon, authenticated` so they produce no security advisor.
- [x] 1.6 Add the three `storage.objects` policies for `ride-maps/`. **Copy the SELECT shape from
  `Riders read postcard images their audience predicate allows`, not from any INSERT policy and not
  from "the five folders" generally** — four of the five carry an `own-folder OR EXISTS(parent)`
  disjunction. The policy is `EXISTS` against `rides` under caller RLS, matching `map_card_path` or
  `map_detail_path`, plus the uid-segment pin to `organizer_id`, **plus a deliberate own-folder arm**
  (`design.md` §D8/§D9) so an orphan stays listable and deletable by its organizer. INSERT and
  DELETE take the ordinary own-folder shape.
- [x] 1.7 Add an index supporting the storage SELECT policy's lookup by path, so a tile fetch does
  not sequentially scan `rides`.
- [x] 1.8 **Paired assertions in `supabase/tests/rls_test.sql`** — required by
  `openspec/config.yaml`; a policy change with no new assertion is not finished. Cover every row of
  the per-role table: organizer, crew (`going` and `maybe`), signed-in non-crew on a visible ride,
  non-member of a private club, ex-member with a surviving `ride_members` row, blocked in **both**
  directions, club owner, club admin, and the object no row names — asserting for that last one
  that **another** rider is refused **and** that the organizer is not. Also assert all three CHECKs,
  the stale-tile trigger firing on an address change and **not** firing on an `is_public` bulk
  update, and the ledger's `attempted_at` trigger discarding a client-supplied timestamp.
- [x] 1.8a Assert the **left-the-club** path directly: an organizer whose ride keeps a `club_id`
  they are no longer a member of can SELECT the ride and is refused the UPDATE by the policy's
  `WITH CHECK` arm. This is the silent-failure path in `design.md` §D2 and nothing else covers it.
- [x] 1.8b Assert the ledger, and assert the thing it must **not** do:
  - an organizer at the ceiling is refused a ledger INSERT;
  - the same organizer, in the same state, **successfully updates their ride's `meeting_point`** —
    this is the guarantee that a spend control never aborts a ride write, and it is invisible from
    the ledger's own tests;
  - DELETE and UPDATE on the ledger are refused for the organizer's own rows, asserted by naming
    the **role**'s privilege rather than by calling it, since the suite runs as the table owner for
    whom no barrier exists;
  - another rider reads zero ledger rows for a ride they do not organise.
- [x] 1.9 Assert the storage policies **per folder**, not by reusing another folder's coverage, per
  `stored-media-visibility`.
- [x] 1.10 `PGPASSWORD=postgres npm test` green. Reconcile by **label set**, not by count — a count
  cannot tell a rename from a loss.
- [x] 1.11 Apply the migrations to **DEV**. Re-derived with `list_migrations` against
  `ls supabase/migrations/`: DEV carries 53, ending `053_ride_map_ledger_comment_and_052_verification`.
- [ ] 1.11b **PROD is deliberately NOT applied yet, and this box stays open until it is.** PROD sits
  at `050`; `051`–`053` are DEV-only. They are additive and safe to apply, but nothing reads the
  tile columns until §2–3 ship, so applying them to production now buys a schema riders cannot
  reach and a second thing to keep level. Apply with the code, per CLAUDE.md's additive-first
  ordering — and re-derive rather than trusting this line.
- [x] 1.12 Check security advisors after applying. **Expect nine, unchanged** — seven
  `authenticated_security_definer_function_executable`, one `rls_enabled_no_policy`, one
  `auth_leaked_password_protection`. A new WARN means a `revoke` did not land. Measured on DEV
  2026-08-12 after `053`: nine, and the ceiling helper adds none because a function in `private` is
  not on PostgREST's search path — the same reason `034`'s `is_ride_crew` added none.

## 2. Types and reads — still no tiles anywhere

- [x] 2.1 Add the tile fields to `src/types/index.ts`. Nothing inline. `RideListItem.map_card_url`
  and `RideDetail.map_detail_url` — **URLs, not paths**, on the `avatar_url` precedent: the data
  layer keeps one promise (*this is something you can put in `src`*) and the Storage path never
  reaches a component. `latitude`, `longitude` and `geocode_confidence` are deliberately NOT on
  either type and not selected: they are the render function's inputs, and decision #3 leaves no
  client-side map to hand a coordinate to.
- [x] 2.2 Extend `RIDE_SELECT` and the list select so the paths arrive with the ride. Keep it to
  `src/lib/data/`; components never call Supabase. `RIDE_SELECT` takes `map_card_path` and
  `getRide`'s select takes `map_detail_path` — one column each, the one its screen draws.
  **Verified against DEV** that `authenticated` holds a column-level SELECT on all five columns
  `051` added, since `045` made `rides` per-column and `051` §5 grants only UPDATE explicitly.
- [x] 2.3 Resolve paths to signed URLs beside the existing `signImagePaths`, per viewer, never
  cached across riders. `resolveRideMapUrls` in `src/lib/data/media.ts`, the same mutate-in-place
  shape as `resolveAvatarUrls`, both columns in one batched `createSignedUrls`. Issued
  concurrently with the avatar pass in `getRides` and `getRide`, and it returns **without a
  request** while every path is NULL — which is every ride today.
- [x] 2.4 Unit tests for the resolver, including that a NULL path yields no URL and no fetch.
  Nine cases in `src/lib/data/__tests__/media.test.ts`, two of them asserting `createSignedUrls`
  is never called (one row, and a whole page of thirty). Three more in
  `__tests__/rides.test.ts` pin `toRideListItem`: no URL for a tile-less ride, the signed URL
  copied through, and an unsigned path read as no tile rather than rendered.

## 3. The two screens — fallback preserved, tile drawn when present

- [x] 3.1 `RideCard`: draw the tile in the 80×148 strip when a path is present; keep today's pin
  container exactly as-is when it is not. Update the doc comment, which currently states there is
  no data behind the strip. The no-tile branch renders the **identical** element it rendered
  before — same container, same `absolute inset-0 m-auto h-6 w-6 text-foreground` pin — and the
  tile branch adds an `object-cover` image under a `White/100` disc behind the pin, which is
  17.4:1 whatever the map is. Doc comment rewritten; it now names no-tile as the ordinary state
  rather than a gap.
- [x] 3.2 `RideMap`: draw the tile behind the existing content in the 358×160 panel. **The whole
  panel stays the anchor** and `Get directions` stays — that was a real iPad bug fix, not a
  decoration. Keep the blank-`meeting_point` early return. Both kept, untouched. The tile and its
  scrim are two extra absolutely-positioned layers that exist **only** when a tile shows, so the
  no-tile DOM is unchanged apart from the address and pin carrying `relative` — inert, and needed
  only so in-flow content paints above a positioned sibling.
- [x] 3.3 Contrast: the address currently sits at 12.65:1 on `bg-track`. Over a photographic tile
  that guarantee is gone — the text needs a scrim or a treatment that holds the ratio. This is a new
  colour pairing and therefore a mandatory reviewer contrast pass. `bg-scrim` (`Grey/70%`, the
  token this system already uses to put text on a photo) with `White/100` text and pin: a 70%
  black scrim bounds the composite at `#4D4D4D` however bright the tile, so the floor is **8.0:1**
  rather than "whatever the map is". The `Get directions` chip is unchanged — `White/100` fill,
  `Grey/100` text, 17.4:1 — and paints above the scrim. **Still owed the reviewer pass**, which is
  9.2's, and the brightness cost of a 70% scrim is a design call worth putting to the designer.
- [x] 3.4 A failed image load falls back to the no-tile rendering rather than breaking the row.
  `onError` flips a `useState` in each component and every tile-dependent class keys off it, so a
  broken URL lands on exactly the fallback rendering rather than on a half-styled one. Both
  components gained `'use client'` with that state; both are imported only from client pages.
- [x] 3.5 Neither screen gates on the tile. Gate on the ride's data, never on a loading flag. The
  tile is a field on the ride, resolved before the row is returned, so there is no second
  loading state to gate on — and `RidePage` still gates on `ride.data`, unchanged.
- [x] 3.6 Update `docs/FIGMA-FIDELITY-TODO.md` §Rides list and §Ride detail — the two unchecked map
  entries. Do not delete them; check them off with what shipped, and leave the `ends_at`, two-line
  address and `max_riders` entries alone. Both struck through with what shipped, both keeping the
  standing note that **nothing writes the columns yet**. The 390×200 banner entry stayed open and
  lost only its claim that the strip's migration would cover it — `051` gave `rides` map tiles,
  not a rider's own photo.

**At the end of group 3 everything is merged and live, every tile is NULL, and both screens render
exactly what they render today.** That is the intended intermediate state.

## 4. The Edge Function — written, not deployed

- [ ] 4.1 `supabase/functions/resolve-ride-location/`. Follow `delete-account/` as the pattern,
  including its header conventions.
- [ ] 4.2 **Verify the JWT itself** rather than trusting the gateway. Assert in review that a
  request bearing the **publishable key** is refused — it is a valid JWT and sails past a
  decode-only check.
- [ ] 4.3 **No service-role key.** Construct the Supabase client with the caller's forwarded token
  and use it for the ride read, both uploads and the column write. `design.md` §D2 records the
  fallback if this is ever refused, and it is not a service-role key.
- [ ] 4.4 Take **only** a ride id. Establish entitlement by reading the ride under the caller's own
  RLS and comparing `organizer_id` to the verified subject — no organizer id, club id or uid from
  the request body.
- [ ] 4.4a **Pre-flight the club-membership arm before spending anything.** After the ride read,
  check `club_id IS NULL OR <caller holds a club_members row for it>` under the caller's own JWT,
  and stop before the geocode if it fails. `private.is_club_member` is unreachable — PostgREST
  routes only to `public` — so read `club_members` directly. Without this, an organizer who left
  the club pays for a geocode and two renders and then has the column write refused.
- [ ] 4.4b **Insert the ledger row before the vendor call**, and abandon the render if that insert
  is refused. Inserting first is what makes the ceiling count **attempts** rather than successes: a
  geocode that returns nothing, returns a city, or times out writes no columns and issues no ride
  UPDATE at all, so a count that rose on a column write would never see it — and that organizer,
  retrying an address that will not resolve, is exactly the one the ceiling exists to bound.
- [ ] 4.5 **Request more than one candidate, and state the number.** Nothing in this change
  specified the geocoder *request* until now, and the omission was load-bearing: this change bounds
  vendor spend everywhere else, so narrowing the call to a single result is the natural
  optimisation — and it leaves the separation gate in 4.5b structurally unable to fire while every
  scenario in the spec still passes.

- [ ] 4.5a Geocode, then apply **three** gates in this order. Failing any one: write nothing,
  return success, do not render, leave the columns NULL. A render costs a call for an image that
  must not be shown.

  1. **Granularity — read `properties.result_type`, NOT `rank.match_type`.** `match_type` describes
     how the query matched and returns `full_match` for a city, so gating on it admits exactly the
     city-level match the spec rejects. **Establish the vocabulary before writing this gate** —
     `building` is the only value anyone has observed, and the gate has to sort `street`, `amenity`,
     `postcode`, `suburb`, `locality` and `district` onto two sides of a line. Use
     `rank.confidence_street_level` as corroboration only.
  2. **Numeric floor** on `rank.confidence`. The scale is plausible rather than validated — see
     `design.md` §What was measured — so treat `0.70` as provisional.
  3. **Separation, among the survivors of 1 and 2 only.** See 4.5b.

  **The order is correctness, not cost.** Testing separation first measures distance between
  candidates granularity is about to discard: `[building, city]` is an ordinary response for a
  street address in a named city, and separation-first rejects it though exactly one usable
  candidate existed.

- [ ] 4.5b **The separation gate: if any two surviving candidates lie further apart than the stated
  threshold, resolve nothing.** Keyed on **distance**, never on a tie in the confidence score.

  The measured case ties at exactly `1` because confidence **saturates**, which is a property of the
  ceiling and not of ambiguity — the same two towns returned as `1.00` and `0.97` carry the
  identical harm and would pass a tie test. In the other direction, a vendor merging datasources
  returns one building twice, tied exactly and 0 m apart, and a count-based rule would refuse a
  perfectly unambiguous address for ever.

  Pick the threshold against what it protects — how far wrong a rider can be sent before the tile is
  worse than no tile — and write it down with its unit and its reasoning, as the confidence floor is.

  **Never break a disagreement on `rank.importance` or `rank.popularity`.** Both are vendor
  relevance signals — how prominent a place is — and neither knows which town the rider meant.
  Picking the more prominent one stores a coordinate indistinguishable from a correct one, which is
  the whole failure this gate exists to prevent.

- [ ] 4.5c **Assert the gate against the measured case AND against the outbound request.** The
  `Stationsplein 1, Amsterdam` response is the regression fixture: two buildings 12.2 km apart. But
  a fixture is a *response*, so a test built only from one passes green against a pipeline whose
  real call asked for a single candidate — the exact failure 4.5 exists to prevent. Assert the
  request too.

- [ ] 4.6 Render both tiles as **JPEG** at 2× device pixel ratio, z13 for 80×148 and ~z15 for
  358×160. **Not PNG** — the bucket allows `image/jpeg` only and refuses the rest above every
  policy.
- [ ] 4.7 Upload, then write the columns. Every vendor and upload failure returns success to the
  caller with NULL columns; the ride write must never fail because a map did not render.
- [ ] 4.8 **On a refused column write, delete the objects just uploaded.** That is the only moment
  their paths are still known — the row never recorded them and the trigger would not have kept
  them. Not tidy-up; the compensating action for the mid-flight membership change 4.4a cannot
  catch. Generate the object names in the function so they are in hand throughout.
- [ ] 4.9 Key-absence tripwire test in the shape of `src/__tests__/no-service-role-key.test.ts`,
  **including that the detector still catches a real key** — a guard that has quietly stopped
  matching passes for ever and looks exactly like a clean repo.
- [ ] 4.10 Note in the function header that **nothing type-checks it**: `tsconfig.json` excludes
  `supabase/functions`, so this is the least-guarded code in the repo and a second reviewer pass on
  it is worth more than a test that cannot run.

## 5. Wiring the call

- [ ] 5.1 Call the function from `src/lib/actions/rides.ts` after a create, and after an update that
  changed `meeting_point`. Fire-and-forget: never block the redirect, never surface a map error.
- [ ] 5.1a **Delete the existing tile objects BEFORE issuing the UPDATE that changes
  `meeting_point`.** The stale-tile trigger NULLs the path columns in that same statement, so
  afterwards nothing knows their names. Same ordering as the ride-delete path — objects first, then
  the row that names them (`design.md` §D8).
- [ ] 5.1b Same ordering in the ride **delete** action: remove both objects, then delete the row.
- [ ] 5.2 Invalidate `rides.all()` and `rides.detail(id)` when a render reports that it wrote paths.
  No new key — the paths ride on rows those keys already cover.
- [ ] 5.3 Extend `keys.ts`'s header table only if a claim changes. Do not add a key for a field.

## 6. Attribution — gated on Q1 and Q2

- [ ] 6.1 Render the credit on the 358×160 panel, clear of the `Open in Google Maps` button.
- [ ] 6.2 Render the credit **into** the 80×148 strip. If it cannot be legible at the design
  system's smallest token, **the strip renders no tile** — ship the fallback, and record the
  decision rather than shrinking type below the system's floor.
- [ ] 6.3 Do not render a tile anywhere until Q1 is answered.

## 7. Coordination — do not let these land silently

- [ ] 7.1 **`add-account-deletion`**: its Storage sweep must include `ride-maps/<uid>/`. That change
  is active and does not know about a sixth prefix. Raise it there rather than assuming it is
  covered.
- [ ] 7.2 **`add-account-deletion`** also modifies
  `Storage object ownership SHALL remain database-enforced`. Whichever of the two archives second
  must re-read the standing spec as the first left it and rewrite its delta against **that** text.
  The banner is at the top of `specs/database-enforced-integrity/spec.md`.
- [ ] 7.3 **`tag-postcards-to-rides`** owns `041` and adds the requirement this change is an
  instance of. This change does **not** depend on it: the migration states its grant level either way.
- [ ] 7.4 **PD-114 (place picker)** writes the same `latitude`/`longitude` columns with a
  known-good coordinate. Do not add a second coordinate column for it; a picked place overwrites the
  geocoded guess in place and the confidence column records which it was.

## 8. Deploy — the ordering, and the one owner action

- [ ] 8.1 **The migration first, on BOTH projects, on its own.** Purely additive; nothing reads the
  columns yet. **"Nothing reads them" stopped being true when §2 shipped**, and that turns this from
  housekeeping into the gate on the promotion: `RIDE_SELECT` now names `map_card_path`, PROD sits at
  `050` without it, and a `development → main` promotion would 400 every rides read — green through
  CI, green through the merge, broken only for riders. 1.11b is the open box, and `051` is 40 KB, so
  it needs the reduce-and-diff-against-DEV technique in `CLAUDE.md` §Applying a migration too large
  to pass as a string rather than a hand transcription.
- [ ] 8.2 Groups 2–5 merge to `development` and deploy. Tiles are NULL everywhere and both screens
  render the fallback. **This state is correct and shippable indefinitely.** §2–3 are merged and are
  exactly this state.
- [ ] 8.3 **OWNER ACTION — deploy the Edge Function. §6's attribution must be settled and rendered
  BEFORE this step, not merely before §6 is ticked** — this is the moment a tile first exists, so it
  is the moment an uncredited tile first reaches a rider. There is no `supabase` CLI in this container
  and the Supabase MCP has no deploy tool, so no session can do it. Same blocker as PD-86. Label
  `Owner only` in Linear and set the Geoapify key in the function's secret store — never in `src/`,
  `.env.local.example`, Vercel or any `NEXT_PUBLIC_*`.
- [ ] 8.4 After deployment, exercise one real ride create and one real address edit on DEV and
  confirm: tiles appear, an edit clears then replaces them, and a non-organizer's call is refused.
- [ ] 8.5 **There is no destructive step in this change.** The additive-first / deploy /
  destructive-last rule is satisfied trivially because the table-level grant is left in place —
  stated explicitly so nobody goes looking for the revoke that `025`'s precedent might suggest.

## 9. Review

- [ ] 9.1 `reviewer` on the proposal **before** any code — the first of its two passes, and the only
  gate this artifact has, since `openspec/` sits in CI's denylist.
- [ ] 9.2 `reviewer` on the final diff immediately before the PR. Scope includes the RLS and
  data-exposure passes (`supabase/**` and `src/**`), and the contrast pass is **mandatory** because
  task 3.3 introduces a new colour pairing.
