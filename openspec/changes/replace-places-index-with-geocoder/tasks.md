## 0. Measure the vendor before anything is written

**No task here can issue a live vendor call** — `*.geoapify.com` is egress-blocked from every build
container, so 0.1, 0.3, 0.4 and 0.6 still need the owner or a machine with egress, and they are what
stop the change being built on assumptions.

**`WebSearch` IS available to the main thread**, which is how 0.2 and part of 0.1 below are already
answered. A finding sourced from vendor documentation is evidence, not an exercise of the API — it is
labelled as such per CLAUDE.md §Working Principles, and a live call still supersedes it.

- [ ] 0.1 Issue one Autocomplete call for `Willem Claijstraat Berkhout` and one for `Berkhout`, and
      record the responses verbatim in this file. **This is the premise of the change** — if the
      vendor cannot find a residential street either, stop and report rather than build.

      **Partially answered, 2026-08-19, and the answer is supporting evidence rather than the
      exercise this task asks for.** The street is real and is in the Dutch BAG: `Willem Claijstraat`,
      Berkhout, municipality of Koggenland, postcodes `1647 AM` / `1647 AL`, house numbers 1–30. NL's
      BAG is imported into OpenStreetMap, and this vendor's geocoder is OSM- plus
      OpenAddresses-derived, so the street should resolve. **"Should" is what the retired index was
      chosen on** — keep this task open until a real call returns a real payload.
- [ ] 0.2 Record the length and character set of the returned `place_id`, and the longest one across
      the two responses. This sets the CHECK in 3.2 (`design.md` §D6; default 512 if it cannot be
      obtained).

      **Partly answered from the vendor's own Places documentation, 2026-08-19 — enough to establish
      the break, not enough to close the task.** The documented sample `place_id` is **126 lowercase
      hex characters**, already past the 100-character CHECK that `066` and `067` put on
      `clubs.location_place_id` and `rides.start_place_id`. So the break is established rather than
      hypothetical: on the current schema **every pick would raise `23514` on both tables**.

      **It is variable-length, and the tail is the place NAME.** Decoding that sample splits it into
      a 34-byte binary prefix (68 hex characters) and the name as hex-encoded UTF-8 — the tail
      decodes in full to `Monument du Général Kléber`, 29 bytes, and 68 + 2 × 29 = 126. Length is
      therefore `68 + 2 × name bytes`, so a long Dutch name
      (`Gemeentelijk Monument Sint-Janskerk, 's-Hertogenbosch`) reaches ~175 before the `geoapify:`
      namespace prefix §D6 adds. **The 512 default is the right bound and must not be trimmed toward
      the observed 126** — that is one sample of a formula, not a maximum the vendor states.

      **This stays `[ ]` on purpose.** The task asks for the length across the two responses from
      0.1, and 0.1 has not run; a documented sample is evidence, not the exercise. A later session
      reading `[x]` would take a formula for a measurement.

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
- [x] 1.4 Log lines carry an outcome and a reason code only. Copy `resolve-ride-location`'s uuid
      redaction; **never** log the term (§D10).
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

      The genuinely stale claim is in `scripts/places/README.md` §Why this is not a geocoding API
      (*"no keystroke leaves our infrastructure"*), and it goes with the directory in 8.1 rather than
      needing an edit here.
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
- [ ] 8.7 **Repoint this change's own `§` references before 8.4 deletes their target.** `proposal.md`
      and `design.md` both cite `scripts/places/README.md` §Why this is not a geocoding API.
      `scripts/docs/crossrefs.mjs` resolves every file-qualified `§` in every tracked `.md`, and
      `crossrefs.test.mjs` asserts **zero** unresolvable paths outside `openspec/specs/` — so deleting
      that README turns the unit suite red on this change's own artifacts. Rewrite the two citations
      to name the commit instead of the file (`git show <sha> -- scripts/places/README.md`), in the
      same commit as the deletion.

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
