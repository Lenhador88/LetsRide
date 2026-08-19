# Tasks — replace the places index with a geocoder

## Where this change stands, 2026-08-19

**§3 through §8 have landed on DEV and in the repo. §0, §2 and PROD are the remainder** — and the
boxes below were not ticked as the three PRs merged, so re-derive rather than reading them. What is
measured:

```bash
ls scripts/places .github/workflows/places-load.yml     # both gone
grep -cE "'0(37|39|40|49|50):" supabase/tests/rls_test.sql   # 0 — retired sections
grep -c "069:" supabase/tests/rls_test.sql                   # 30 — replacement asserted
```

```
mcp__Supabase__execute_sql fpmrimzxadewsaiwpsel   -- DEV: places 0, retired fns 0, 14 MB
mcp__Supabase__execute_sql zwprydcyryvudhurbnye   -- PROD: places 1, retired fns 2, 350 MB
```

**The obvious fourth command reads 1, not 0, and the survivor is not a defect.**
`grep -rn "search_places\|locality_centroid" src/ | grep -vE ':[0-9]+:\s*(\*|//|/\*)'` returns
`src/lib/location/__tests__/rider-location.test.ts:325` — the retired name inside an `it(...)`
title, a string rather than a comment, so the comment filter cannot see it. CLAUDE.md's comment
trap one layer up. No call site survives.

**What is NOT done, and none of it is closed by the promotion:**

- **§0.4 and §0.5 are open vendor questions and survive PROD.** The credit cost of an autocomplete
  call and of the static map, and the plan terms for storing results indefinitely and rendering
  them on a non-Geoapify map. `shape.ts`'s ceiling block says its three vendor inputs are
  *"all three DOCUMENTATION-DERIVED and none measured"* — 0.4 is what would make them measured.
  Both need egress no session has.
- **§2.2 is not satisfied, and it is `070`'s own precondition 1 on PROD.** `search-places` is
  deployed v1 on both projects at 15:51Z/15:52Z and the deployed source is `71053cd` (#273) —
  **#274, #275 and #276 are all undeployed**, `classifyLedgerError` among them. So the deployed
  build answers a `23514` gate refusal with **502 `unavailable`**, telling the rider search is
  broken rather than that a limit was reached. **A redeploy is owed on both projects** and it is
  an owner action; verify by content, not by a moved digest.

  **What the deployed v1 does NOT do is fail** — verified against the deployed source rather than
  reasoned: its only database access is the ledger insert, no `.rpc(`, no `.from('places')`, and
  every behavioural constant matches HEAD. So `070`'s precondition 1 is met and dropping `places`
  is safe; the misclassification is the whole defect.

  **But v1 fails CLOSED on that ledger insert, and the insert precedes the vendor call.** So on a
  project where `place_search_attempts` does not exist yet, every search returns 502 — dead, not
  degraded. That is what makes `069`-before-the-build a hard ordering constraint on PROD rather
  than a preference, and the window is rider-visible.
- **PROD:** promote, apply `069` **before** the promotion build is serving traffic, apply `070`
  only **after** it is. `070`'s header is explicit that merged is not deployed, and DEV is the
  worked example of getting that backwards — its `070` landed 102 seconds after the merge commit.
- **§9's live exercises are unrun on either project.**

## 0. Measure the vendor before anything is written

**No task here can issue a live vendor call** — `*.geoapify.com` is egress-blocked from every build
container, so 0.1, 0.3, 0.4 and 0.6 still need the owner or a machine with egress, and they are what
stop the change being built on assumptions.

**`WebSearch` IS available to the main thread**, which is how 0.2 and part of 0.1 below are already
answered. A finding sourced from vendor documentation is evidence, not an exercise of the API — it is
labelled as such per CLAUDE.md §Working Principles, and a live call still supersedes it.

- [x] 0.1 Issue one Autocomplete call for `Willem Claijstraat Berkhout` and one for `Berkhout`, and
      record the responses verbatim in this file. **This is the premise of the change** — if the
      vendor cannot find a residential street either, stop and report rather than build.

      **ANSWERED, 2026-08-19. THE PREMISE HOLDS.** `autocomplete?text=Willem Claijstraat Berkhout`
      returns exactly one feature and it is the street:

      | Field | Value |
      |---|---|
      | `name` / `street` | `Willem Claijstraat` |
      | `result_type` | **`street`** |
      | `rank.confidence` / `confidence_street_level` | 1 / 1 |
      | `postcode` / `city` / `hamlet` | `1647 AM` / `Berkhout` / `Oosteinde` |
      | coordinate | 52.6419786 / 5.0005068 |
      | `address_line1` / `address_line2` | `Willem Claijstraat` / `1647 AM Berkhout, Netherlands` |

      The vendor also parsed the query structurally — `parsed: {street, city, expected_type:
      "street"}` — so it understood the shape of the request rather than fuzzy-matching it.

      **This is the whole justification for the change, and it is now measured rather than
      reasoned.** The retired index returns nothing for this term: `search_places('Willem
      Claijstraat Berkhout')` = `[]`, and `street ilike '%claijstraat%'` = 0 rows nationally.
      `toPlaceResult` maps the response to label `Willem Claijstraat` / meta `1647 AM Berkhout,
      Netherlands` with no code change.

      **The town half proves nothing on its own and is recorded so nobody mistakes it for the
      premise.** `autocomplete?text=Berkhout` returns one feature — the village, `result_type:
      "city"`, confidence 1, population 2215, `address_line2` = `NH, Netherlands`. Correct, and
      `search_places('Berkhout')` already returns five rows today, so a town resolving was never in
      question.

      Two things these two responses settle in passing:

      - **Autocomplete returns ONE feature for a specific term**, not the five the unfiltered
        `geocode/search` returned for `Amsterdam`. So the five-spread-candidates shape belongs to
        that endpoint rather than to autocomplete — which weakens, without killing, the hypothesis
        on PD-267 that `resolve-ride-location`'s separation gate has been refusing every tile, since
        that function calls the unfiltered endpoint. It also means this street would sail through
        all three of those gates: street-level, confidence 1, one candidate so nothing to separate.
      - **`rank` carries `confidence_city_level` as well as `confidence_street_level`**, and a city
        result carries only the former. `resolve-ride-location`'s `GeocodeFeature` reads only the
        street-level field; the granularity gate rejects a city before confidence is consulted, so
        nothing is broken — but the vocabulary is wider than that type documents.

- [x] 0.2 Record the length and character set of the returned `place_id`, and the longest one across
      the two responses. This sets the CHECK in 3.2 (`design.md` §D6).

      **MEASURED across three samples, 2026-08-19** — two live, one documented:

      | Sample | Total | Prefix | Name | + `geoapify:` | Fits the 100 CHECK? |
      |---|---|---|---|---|---|
      | `Shell Energy & Chemicals Park Rheinland Werk Wesseling` | **182** | 74 hex | 54 B | **191** | no |
      | `Shell Deutschland Oil GmbH, Werk Süd, Hafen` | 162 | 74 hex | 44 B | 171 | no |
      | `Monument du Général Kléber` | 126 | 68 hex | 29 B | 135 | no |
      | `Amsterdam-Purmerend` | 112 | 74 hex | 19 B | 121 | no |
      | `Willem Claijstraat` | 110 | 74 hex | 18 B | 119 | no |
      | `Shell Pernis` | 98 | 74 hex | 12 B | 107 | no |
      | `Berkhout` | 90 | 74 hex | 8 B | **99** | **yes** |
      | `Jumbo` | 84 | 74 hex | 5 B | **93** | **yes** |

      **All seven live samples carry a 74-hex prefix**, so `74 + 2 × name bytes` holds without
      exception across them; only the documented sample's 68 does not fit. Longest observed is
      **191 stored**, from a real result the picker would offer — so 512 has roughly 2.7× headroom
      over anything seen, which is the right amount for a bound whose input is a place name.

      **The address that started this change is one of the failing cases.** `Willem Claijstraat`
      stores as 119 characters — so the very pick the product owner went looking for is the one
      today's schema would refuse, while the village two fields away in the same result would have
      gone through.

      **The break against today's CHECK is INTERMITTENT, and that is worse than universal.** An
      earlier revision of this task said every pick would raise `23514`. It will not: `Berkhout`
      stores in 99 characters and fits. So on the current schema a rider picking a short-named place
      succeeds and one picking a long-named place gets a raw constraint error, with nothing about
      the two attempts looking different to them. A break that fires on *some* places cannot be
      found by trying it once, and would survive a manual smoke test that happened to pick a
      village. `069` widening both columns to 512 stays load-bearing.

      All three live samples agree on a 74-hex prefix, so `74 + 2 × name bytes` holds across them;
      the documented sample's 68 does not fit and is left unexplained rather than reasoned away.
      **512 must not be trimmed toward the observed maximum** — the formula is only as good as the
      longest name anyone has seen, and a 200-byte name reaches 474.

      **The formula recorded here on the documentation pass was WRONG, and how it was wrong is the
      reusable part.** That pass read the vendor's 126-character sample as a 34-byte binary prefix
      (68 hex) plus the place name as hex-encoded UTF-8, and took 68 for a constant. The live
      response carries a **74-hex prefix** for a 19-byte name: the formula predicts 106 and the real
      answer is 112. So the prefix varies with something the id does not disclose, and length is
      **not** predictable from the name.

      That strengthens the 512 bound rather than weakening it — there is no formula to size a
      tighter one from. It is also exactly the shape CLAUDE.md warns about: a value derived from one
      documented sample, labelled documentation-derived, and wrong the first time a real response
      arrived. The label is what made it cheap to correct.

- [x] 0.3 Record the `formatted` / `address_line1` / `address_line2` fields for both, so 1.3's mapping
      to `label`/`meta` is written against a real payload rather than a documented one.

      **Confirmed against the live response, 2026-08-19.** Every field `shape.ts`'s
      `AutocompleteFeature` names is present and where it expects it: `properties.place_id`, `lat`,
      `lon`, `name`, `formatted`, `address_line1`, `address_line2`. `toPlaceResult` is correct as
      written and needs no change. Sample: `name` = `Amsterdam-Purmerend`, `address_line1` =
      `Amsterdam-Purmerend`, `address_line2` = `Jaagweg, 1441 JD Purmerend, Netherlands`.

      **Three things the payload carries that this design did not know about**, none blocking and
      the second worth its own follow-up:

      1. **`datasource.attribution` / `.license` / `.url` are per result** — `© OpenStreetMap
         contributors`, `Open Database License`, pointing at openstreetmap.org/copyright. The vendor
         states the obligation in-band rather than only in its terms, which feeds Q1/Q2 and confirms
         the OSM credit already on `/legal/attributions` is the right one.
      2. **`timezone.name` is in every feature** (`Europe/Brussels` here). CLAUDE.md records the
         ride-time model as an interim — *"the correct model is wall-clock at the meeting point,
         which needs a zone column on `rides`"* — and this supplies that zone free, on a call already
         being made. Out of scope here; it removes the blocker from whatever picks that up.
      3. **`address_line2` always ends in the country**, where the retired `search_places()` built
         meta as `street, locality` with none. Every Meta line gains `, Netherlands`. Not worth
         stripping — §D8 keeps foreign results deliberately findable and the country is what
         distinguishes them — but it is a visible change to the result row.

      **A quality warning, and it is the one to carry into 0.6:** `text=Amsterdam` returned five
      `Amsterdam-Purmerend` bus stops in Purmerend and Ilpendam, every one `confidence: 1`, and **not
      the city of Amsterdam**. That is the unfiltered `geocode/search` endpoint, which is precisely
      why `buildLocalityUrl` sets `type=city` — so the locality mode is already right. The search
      mode applies no such filter by design, so this is direct evidence that the vendor's own
      ordering can bury the obvious answer under near-duplicate amenities.

- [ ] 0.4 Confirm autocomplete costs 1 credit and record the per-call credit cost of the static map
      endpoint, so §D4's arithmetic is measured rather than derived.
- [ ] 0.5 Read the plan terms for **storing** results indefinitely and for showing results **in a
      list** (Q1, Q2). Record the answer with its source; mark INFERRED if it stays unread. Start from
      what PD-114's comments already establish — ODbL/OSM-derived storage rights that do not lapse,
      and a required Geoapify credit alongside OpenStreetMap's on the free plan — rather than
      re-running the provider research, which has now been done twice.
- [x] 0.6 **Branded POI coverage, against the retired index rather than in the abstract** (Q2b). Run
      `Shell Pernis Werk`, `Jumbo Maastricht` and two of the owner's own habitual meeting points
      through Autocomplete, and the same terms through `search_places()` on DEV. Record both result
      sets. PD-114's research rates this vendor's POI layer *"patchy — only if it's present in the
      OpenStreetMap database"*; this is the task that turns that into a number before a rider finds it.

      **ANSWERED 2026-08-19, and the concern is NOT borne out. The full switch ships as scoped.**
      Run through the **deployed function** rather than against the vendor directly, so this
      exercises the real mapping and the real ceilings as well as the vendor.

      | Term | `search_places()` on DEV | `search-places` |
      |---|---|---|
      | `Shell Pernis Werk` | **0 rows** | 5, and `Shell Pernis`, Vondelingenweg 601, Rotterdam is **first** |
      | `Jumbo Maastricht` | 5 stores | 5 stores, all with postcodes |
      | `Willem Claijstraat Berkhout` | **0 rows** | the street |

      **`Shell Pernis Werk` is the design's own sample and the retired index cannot answer it at
      all** — which inverts the risk this task was written to measure. `Jumbo Maastricht` is a draw
      on count and marginally better on content: the new set is five real stores with postcodes,
      where the old set spends one slot on `Jumbo Online HUB Maastricht`, a distribution hub nobody
      meets at, and another on a near-duplicate of the Mosae Forum store.

      **The one real regression is noise on a sparse term, and it is `design.md` §D8 working as
      designed.** `Shell Pernis Werk` returns two German `Werk` sites and two petrol stations in
      Martin, Tennessee below the correct first hit. There is no country filter — deliberately, so a
      ride into Belgium or Germany stays findable — and the vendor pads to `limit` rather than
      returning only good matches. Ranked below the right answer, so it costs a rider nothing.

      **PD-114's "patchy" rating stands unrefuted for the general case** and is simply not what
      these terms show. Four terms is not a survey; what it establishes is that the specific fear —
      that branded POI search would collapse — does not happen on the samples the design itself
      chose.

## 1. PR 1 — the Edge Function, and nothing else

- [x] 1.1 `supabase/functions/search-places/shape.ts` — no Deno global, no `jsr:` import, no network
      call: the endpoint constants, the URL builders for both modes, the term bound, the vendor→
      `PlaceSearchResult` mapping, and the ceiling constants with §D4's arithmetic in the comment.
- [x] 1.2 `supabase/functions/search-places/index.ts` — the wiring only: CORS preflight, POST-only,
      bearer extraction, `getUser(token)` against the auth server, `is_anonymous` refusal, the
      metering insert under the **caller's** JWT, the vendor call with a bounded timeout, the mapping,
      the response. No service-role key. No user id read from the body.
- [x] 1.3 Order of operations, asserted by the tests in 1.5 and stated in the file header: verify →
      meter → call → map. Nothing billable happens before the metering row is accepted.

      **Verified live against DEV, and it caught a real defect.** The first draft classified a
      failed ledger insert on one bit — policy refusal or not — and the participation gate raises
      **`23514`** (`check_violation`), not `42501`. So a rider who had not accepted the terms was
      told *search is unavailable*: an outage they would retry for ever, rather than a state of
      their own account. Now three outcomes, in `classifyLedgerError` in `shape.ts` where a test can
      reach them: `42501`/`PGRST301` → `ceiling`, `23514` → `forbidden`, everything else →
      `unavailable`.

      **This is exactly what the split in §D2 is for.** The classification is a *decision*, so it
      belongs in `shape.ts`; leaving it in `index.ts` is what let the first version ship untested,
      since nothing type-checks or tests that file.
- [x] 1.4 Log lines carry an outcome and a reason code only, and **never** the term (§D10).

      **No uuid-redaction helper was copied, and that is stronger than this task asked for rather
      than a shortfall.** `resolve-ride-location` needs one because it logs about a specific ride
      and an id can reach a message; this function logs nothing derived from input at all — one
      helper, a fixed vocabulary, no interpolation — so there is nothing to redact. Reworded rather
      than left ticked against a helper that does not exist.
- [x] 1.5 `src/__tests__/place-search-shape.test.ts` — imports `shape.ts` so `tsc` follows it in.
      Assert: the outbound URL carries the key and the bias but no rider identity; a vendor payload
      maps to the documented `PlaceSearchResult` fields; an over-long term is bounded; a vendor
      response missing coordinates is dropped rather than mapped to `NaN`.
- [x] 1.6 Extend `src/__tests__/no-geoapify-key.test.ts` to cover the new function directory, keeping
      its self-check (that the detector still catches a real instance) intact and its exemption list
      from growing beyond the one test file that must name the host.
- [x] 1.7 PR 1 body states plainly that the client still calls `search_places()` and that this PR
      changes no rider-visible behaviour.

## 2. Deploy — OWNER ACTION, on the critical path

- [ ] 2.1 **Owner:** `supabase functions deploy search-places` against DEV (`fpmrimzxadewsaiwpsel`)
      and PROD (`zwprydcyryvudhurbnye`), and `supabase secrets set GEOAPIFY_API_KEY=…` on each if the
      secret is not already project-wide. No session can do this — `deploy_edge_function` is on
      `.claude/settings.json`'s `deny` list and there is no CLI in the container.
- [ ] 2.2 Verify **by content**, not by a moved digest: `get_edge_function` on both refs, confirming
      the deployed source carries the metering write and both modes. A moved `ezbr_sha256` proves a
      deploy happened, never which build (PD-249).

      **Partly done, 2026-08-19 — the owner deployed and the reachable half is verified live.**
      `*.supabase.co` is NOT egress-blocked from a session (only `*.geoapify.com` is), so the
      deployed function can be called from here. Against DEV:

      | Probe | Result |
      |---|---|
      | `OPTIONS` preflight | **204** with CORS headers |
      | `POST`, no bearer | **401** |
      | `POST`, publishable key as bearer | **401** `{"error":"unauthorized"}` |

      **The third probe is the one worth having.** The publishable key is a structurally valid JWT,
      so a decode-only check accepts it — that is exactly the bypass rule 3 exists to close, and it
      is now verified against the running deploy rather than asserted from the source.

      **The rest is now verified too, 2026-08-19, end to end against DEV.** `069` is applied there,
      so a probe rider was made through GoTrue (DEV autoconfirms), onboarded, and used to drive the
      deployed function:

      | Probe | Result |
      |---|---|
      | Search before `accept_terms` | refused, no vendor call |
      | Search before `complete_onboarding` | refused, no vendor call |
      | Ledger insert direct through PostgREST, fully onboarded | **201**, `attempted_at` server-stamped |
      | Search, fully onboarded | **200** with mapped results |

      So the whole chain holds: JWT verified against GoTrue, participation gate refusing before
      anything billable, ledger row accepted under the caller's own JWT, vendor called, response
      mapped to this repo's own shape. **The one thing this probe found is finding-shaped and is
      fixed in this branch** — see 1.2's note on `classifyLedgerError`.

      Still unverified: the ceilings actually firing at 20/60/2000, which needs 20 calls and 20
      credits and is not worth spending to watch a `WITH CHECK` do arithmetic; and everything on
      PROD, where `069` is not yet applied.
- [ ] 2.3 Note in the PR that this queues **behind PD-267**, which already carries two undeployed
      function changes. If the wait is long, re-read `design.md` §D7's rejected fallback — it is the
      escape hatch, and taking it is a decision, not a drift.

## 3. PR 2 — `069`, additive only

- [ ] 3.1 `supabase/migrations/069_place_search_metering.sql`: `public.place_search_attempts`
      (`id`, `user_id`, `attempted_at default now()`), RLS on, index on `(user_id, attempted_at)`.
- [ ] 3.2 In the same file: raise `rides_start_place_id_length` and `clubs_location_place_id_length`
      to the bound measured in 0.2. **Append a new constraint and drop the old one by name** — never
      edit `066`/`067`.
- [ ] 3.3 `private.place_searches_in_window(rider uuid, window interval)` and
      `private.place_searches_today()` — `security definer`, `set search_path to ''`, EXECUTE revoked
      from `anon` and `authenticated`.
- [ ] 3.4 The INSERT policy carrying both ceilings and `user_id = auth.uid()`; the SELECT policy
      limited to own rows; **no** UPDATE and **no** DELETE grant for any client role; column grants
      `insert (id, user_id)` only, so `attempted_at` cannot be back-dated.
- [ ] 3.5 Hang `enforce_participation_gate` on the table (10 → 11 triggers; re-derive with
      `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal`).
- [ ] 3.6 The retention sweep of §D11 — a statement-level trigger deleting the inserting rider's own
      rows older than 7 days, bounded by 3.1's index.
- [ ] 3.7 **Paired with 3.1–3.6:** a `069` section in `supabase/tests/rls_test.sql`. At minimum: RLS
      on; policy count and commands; grants **by grantee** (`postgres`/`service_role` hold everything
      by default, so a table-wide count reads a false pass); a rider cannot insert for another rider;
      cannot back-date; cannot update or delete; sees only their own rows; the ceiling **admits** at
      the boundary and **refuses** past it (both, or the assertion is vacuous); the participation gate
      refuses an unstamped account; neither counter function is executable by a client role; the
      widened length CHECKs admit a bound-length id and refuse one character more.
- [ ] 3.8 Mutation-test at least the ceiling and the gate by hand, in a rolled-back transaction —
      deleting the ceiling conjunct must turn the suite red on a named line.
- [ ] 3.9 Apply `069` to DEV with `apply_migration`, then check the security advisors. Expect **two
      new** `authenticated_security_definer_function_executable` WARNs **only if** the counters are
      reachable — they must not be, so expect **none**, and treat any new advisor as a defect.

## 4. PR 2 — the client

- [ ] 4.1 Rewrite `src/lib/data/places.ts`: `searchPlaces(term, near, signal)` invokes the proxy;
      `getLocalityCentroid(q)` invokes it in `locality` mode. Keep the existing degrade-to-`null`
      contract on the centroid and the `AbortError` rethrow on the search — both doc blocks explain
      why, and neither reason changed.
- [ ] 4.2 Delete `PLACE_SEARCH_MAX_TOKENS` and `boundTerm()`, and the parts of
      `src/lib/data/__tests__/places.test.ts` that cover them. Replace with a character bound and its
      test. **Keep `PLACE_SEARCH_MIN_CHARS` at 4 and rewrite its doc block** — the number survives and
      its entire justification changes from sequential-scan cost to credit cost.
- [ ] 4.3 Give `keys.places.search` its first caller: route the sheet's search through `useQuery` (or
      an explicit cache read/write) so a retyped term is free, and state the entry's lifetime beside
      the key with the reason it is that number.
- [ ] 4.4 `PlaceSearchField`: the six states of the spec's table, each with its own copy. The
      application-wide ceiling renders as *unavailable*; the rider's own renders as *you have searched
      a lot just now*; offline renders as offline.
- [ ] 4.5 Verify — do not assume — that every failure path leaves the form intact: the typed meeting
      point, the club name, an uploaded image, and any pick already made. PD-199 is the defect shape.
- [ ] 4.6 Raise `CLUB_LOCATION_PLACE_ID_MAX` in `src/lib/validation/clubs.ts` and the ride equivalent
      to match 3.2, and update the comment that says the number is a copy of the database's rule.
- [ ] 4.7 Confirm `resolveRiderLocation()`'s callers still work end to end — `/clubs`,
      `/clubs/explore`, `ExploreClubsStrip`, `near-label.ts` — with the centroid now coming from the
      proxy. This is the regression the spec's locality requirement exists to prevent.

## 5. PR 2 — copy, attribution and privacy

- [ ] 5.1 `CreateRideForm` and `EditRideForm`: placeholder becomes **"Search for a town or place"**
      (they say "Search location"; the component default and the club form already say the right
      thing).
- [ ] 5.2 Add one line of helper copy under the ride's location field saying a typed meeting point is
      fine — the field already accepts one and nothing on screen says so.
- [ ] 5.3 Replace `PlaceDataCredit` in `PlaceSearchField`: credit the new provider and OpenStreetMap,
      still as a `next/link` to `/legal/attributions` (a document navigation would reload the bundle
      and take the half-filled form with it). Keep it a separate component so
      `renderToStaticMarkup` can still test it.
- [ ] 5.4 `/legal/attributions`: broaden the existing Geoapify/OSM line to cover search as well as
      tiles, rather than adding a second block that can drift. Remove the Overture section **in PR 3**,
      with the data — not here.
- [ ] 5.5 `/legal/privacy`: **broaden the page, do NOT rewrite it as though it were false.**
      `acae465` (#268, PD-249) already corrected it on 2026-08-19 — it names Geoapify as a processor
      and says *"your device never contacts Geoapify"*, which stays **true** under this change,
      because the proxy is precisely what keeps the device off the vendor. What changes is the scope
      of what that processor receives: **search terms as they are typed**, not only the meeting point
      a rider saved. Say that, and say the term is not retained on our side.

      The genuinely stale claim was under "Why this is not a geocoding API" in the now-deleted
      `scripts/places/README.md` (*"no keystroke leaves our infrastructure"* — read it with
      `git show f6e62ce -- scripts/places/README.md`), and it went with the directory in 8.4 rather
      than needing an edit here.
- [ ] 5.6 Update `src/types/index.ts`'s `PlaceSearchResult` doc block: it documents the Postgres
      ranking contract, the per-token AND and the proximity bias's sharp edge, none of which survives.

## 6. PR 2 — docs

- [ ] 6.1 `docs/reference/schema.md`: the `places` row becomes "retired in `070`" rather than being
      deleted while the table still exists; add `place_search_attempts`.
- [ ] 6.2 `CLAUDE.md`: the participation-gate list (ten → eleven, with the count command beside it),
      and a line under §Supabase Rules noting there are now **three** Edge Functions.
- [ ] 6.3 `docs/HANDOFF.md`: the applied-migration state and the deploy queue.
- [ ] 6.4 Run `npm run docs:check` and fix what moves — `migrations-count-*` at minimum, and
      `unit-tests-count-*`/`unit-tests-files-*` once 4.2 lands.

## 7. PR 2 — gates and merge

- [ ] 7.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `next build`,
      `PGPASSWORD=postgres npm test`.
- [ ] 7.2 Reconcile the RLS suite **by label set**, not by count — a count cannot tell a rename from a
      loss. Record the new labels and any relabels in the PR body.
- [ ] 7.3 `reviewer` before the PR, per CLAUDE.md. The diff touches `src/`, `supabase/` and
      `supabase/functions/`, so the data-exposure and client-bundle passes both fire.
- [ ] 7.4 Merge to `development`, confirm the DEV deploy, and move the Linear issue to
      `Deployed to DEV`.
- [ ] 7.5 Promote to `main` and apply `069` to PROD in the promotion's own order
      (`docs/ENVIRONMENTS.md` §Migrations, step 5).

## 8. PR 3 — the removal, after the replacement is live

- [ ] 8.1 **Precondition, checked rather than assumed:** the proxy is deployed on the target project
      **and** the client calling it is live there. `070` is irreversible in a session — reloading the
      index is a 99 MB extract through a workflow this PR deletes.
- [ ] 8.2 `supabase/migrations/070_retire_places_index.sql`: `drop function public.search_places`,
      `drop function public.locality_centroid`, `drop table public.places`. Confirm the reclaimed
      space afterwards — 337 MB on PROD, 338 MB on DEV, of a ~350 MB database.
- [ ] 8.3 **Paired with 8.2:** delete the `037`, `039`, `040`, `049` and `050` assertion sections from
      `supabase/tests/rls_test.sql`, the fixtures they insert, and the `places` note in
      `supabase/tests/harness.sql`. Reconcile by label set and state in the PR body that every removed
      label is removed because its subject no longer exists — **reinstating any of them turns a correct
      database red**.
- [ ] 8.4 Delete `scripts/places/` and `.github/workflows/places-load.yml`. Note in the commit message
      that `git show <sha> -- scripts/places/` recovers the loader if the index is ever wanted back.
- [ ] 8.5 Remove the Overture section from `/legal/attributions` and the Overture paragraphs from
      `CLAUDE.md` §Supabase Rules and `docs/reference/schema.md`. The credit is wrong the moment the
      data is gone: it names contributors who supplied nothing to what a rider is looking at.
- [ ] 8.6 Apply `070` to DEV, run the suite, check the advisors; then promote and apply to PROD.
- [x] 8.7 **Repoint this change's own `§` references before 8.4 deletes their target.** `proposal.md`
      and `tasks.md` itself (this section, 5.5's note) both cited the deleted README under its "Why
      this is not a geocoding API" heading. `scripts/docs/crossrefs.mjs` resolves every file-qualified
      `§` in every tracked `.md`, and `crossrefs.test.mjs` asserts **zero** unresolvable paths outside
      `openspec/specs/` — so deleting that README turned the unit suite red on this change's own
      artifacts, caught by `npm run test:unit` rather than by inspection. Rewritten to name the commit
      instead of the file: `git show f6e62ce -- scripts/places/README.md`.

      **A third citation existed and was not one of the "two" this task named** — `docs/reference/
      schema.md`'s `places` row also cited the README under §Attribution. Found the same way: the test
      failure lists every unresolved citation by file and line, so trust that list over a task written
      before the count was known. Fixed alongside the schema.md rewrite (task 6.1/8.5).

## 9. What only a live exercise can close

- [ ] 9.1 Six states on a real device or a real browser against DEV: below minimum, searching, no
      matches, unavailable, rider ceiling, offline. **`npm run walk` cannot do this** — no session can
      run it (PD-268) — so say so in the PR body rather than implying coverage, as PD-114's PR did.
- [ ] 9.2 Exercise the ceiling for real against DEV: 61 searches from one account, and confirm the
      62nd is refused, costs no credit, and renders the rider-ceiling message rather than an error.
- [ ] 9.3 Create a club with search deliberately unavailable and confirm it saves with all four
      location columns NULL and no message that reads as a failure.
- [ ] 9.4 Open the DEV ride carrying the Overture id (`987a85c6…`) after `070` and confirm it renders
      unchanged — name, coordinate, tile — and is still treated as *picked* rather than *geocoded*.
