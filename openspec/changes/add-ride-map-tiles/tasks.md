## 0. Before any SQL — the questions, and what was already measured

- [x] 0.1 **Pre-flight, MEASURED 2026-08-09 against `zwprydcyryvudhurbnye` (PROD) via the Supabase
  MCP, RLS bypassed — true counts, not per-viewer:**

  | Fact | Value |
  |---|---|
  | `rides` columns | **11 — no latitude, no longitude, no image column**; `meeting_point text not null` |
  | `rides` grants to `authenticated` | **table-level** `arwdDxtm` in `relacl`; `attacl` empty on every column |
  | `profiles` grants | `dDxtm` table-level + 8 per-column ACLs — the `025` revoke-and-regrant precedent |
  | Storage buckets | **one**, `media`, **private**, `allowed_mime_types = ['image/jpeg']`, 5 MB |
  | `storage.objects` policies | **15** across 5 folders — 5 SELECT, 5 INSERT, 5 DELETE, all `authenticated`, **none UPDATE** |
  | The 5 SELECT policies' shape | **4 are `own-folder OR EXISTS(parent)` — a disjunction**; only `postcards` is the bare `EXISTS`. None is prefix-only |
  | The 5 INSERT/DELETE policies' shape | folder prefix and caller uid **only** |
  | `postcards` / `clubs` SELECT | `author_id = auth.uid() OR (…)` and `is_public OR owner_id = auth.uid() OR is_club_member(id)` — an **unconditional owner arm** in each, which is the test §D9 uses |
  | `rides` non-internal triggers | `enforce_participation_gate`, `enforce_ride_club_audience`, `notify_ride_created_in_club` |
  | `propagate_club_privacy_to_rides` | `update public.rides set is_public = false where club_id = new.id and is_public` — `is_public` only |
  | Migration files / applied | **41 files / 40 applied** — `041_postcard_ride_tag.sql` is unapplied and belongs to `tag-postcards-to-rides`. **`042` is this change's number** |
  | Security advisors | **8**, matching `CLAUDE.md`'s table |

  Three of these change the shape of the work. The **table-level grant** means the five new columns
  arrive client-writable (design.md §D2) — and is the reason the spend ledger is a separate
  append-only table rather than a counter column (§D10). The **SELECT/INSERT policy asymmetry**
  corrects the brief
  this change was written from: `CLAUDE.md` says Storage policies here check the path prefix only,
  which is true of writes and **false of reads** — the instrument this change needs already exists
  and must be copied from a SELECT policy, never from an INSERT one.

- [ ] 0.2 **Q1 — product owner, BLOCKING task 6.** What exact attribution string does Geoapify's
  current plan require, and does the underlying data carry a second obligation? Default while
  unanswered: **build the tile pipeline and do not render either tile** — paths stay NULL, both
  screens keep today's fallback, and nothing ships that could breach a licence. Note this repo
  already carries **one** unresolved attribution question (`places` / Overture); they are separate
  vendors and neither answer covers the other.
- [ ] 0.3 **Q2 — designer, BLOCKING task 6.2 only.** Where does the credit sit on the 80×148 strip?
  Default: a 14px bar across the bottom, `Grey/70%` scrim, `Poppins/10/Medium` in `White/100`,
  leaving 80×134 of map. If the answer is that it cannot be made legible, the strip renders no tile
  — that is the specified negative case, not a failure.
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
- [ ] 0.8 **Verify the vendor's response shape before `042` hardcodes a floor.** `rank.confidence`
  and the match-type vocabulary in `design.md` §D3 are **inferred, not measured** — this container
  has no egress to the vendor's docs. Capture one real geocode response and confirm the field
  names, the score range and the granularity values. If they differ, `design.md` §D3 is wrong and
  the migration must not be written from it.

## 1. `042` — the migration (purely additive, safe to apply first)

- [ ] 1.1 Write `supabase/migrations/042_ride_map_tiles.sql`. **Header must state the grant level
  read from `relacl` and `attacl`** and that the table-level grant is deliberately left in place —
  the columns arrive client-writable and that is accepted, per `design.md` §D2.
- [ ] 1.2 Add **five** nullable columns to `public.rides`: `latitude double precision`,
  `longitude double precision`, `geocode_confidence real`, `map_card_path text`,
  `map_detail_path text`. NULL is the normal state, not an error.
- [ ] 1.3 Add the constraints:
  - the **coupling + floor** CHECK — either all of `latitude`/`longitude`/`geocode_confidence` are
    NULL, or all are present with the coordinates in range and `geocode_confidence >= <floor>`;
  - a **one-directional** CHECK — a tile path requires a coordinate, but a coordinate does **not**
    require a path, so a successful geocode with a failed upload stays writable;
  - a **path-pinning** CHECK on both path columns —
    `like 'ride-maps/' || organizer_id::text || '/%'` plus the filename shape, matching the pinning
    `profiles` and `clubs` already use.
- [ ] 1.4 Add `public.ride_map_render_attempts` — the append-only spend ledger (`design.md` §D10).
  `id uuid` PK, `ride_id uuid → rides(id) on delete cascade`, `attempted_at timestamptz`.
  - **Grants: `authenticated` gets INSERT and SELECT and nothing else.** No UPDATE grant, no UPDATE
    policy, no DELETE grant, no DELETE policy — the organizer must be able to raise their own count
    and must not be able to lower it.
  - INSERT policy: the caller organises the ride, **and** their row count inside the rolling window
    is below the ceiling (Q3). This `WITH CHECK` **is** the ceiling — bounded as described below,
    not exactly.
  - **This is the first policy in this repo whose predicate is an aggregate over its own table, and
    it overshoots under concurrency. Measure it rather than assume it when writing `042`.** Under
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
- [ ] 1.5 Add the stale-tile `BEFORE UPDATE` trigger clearing the five tile columns, scoped
  `WHEN (old.meeting_point IS DISTINCT FROM new.meeting_point)`. **The scope is not optional** —
  `propagate_club_privacy_to_rides` bulk-updates `rides` and an unscoped trigger wipes every tile in
  a club when it turns private. It is the **only** trigger this change puts on `rides`, and it
  clears columns rather than raising, so no ride write can be aborted by it. Revoke EXECUTE on every
  trigger function from `public, anon, authenticated` so they produce no security advisor.
- [ ] 1.6 Add the three `storage.objects` policies for `ride-maps/`. **Copy the SELECT shape from
  `Riders read postcard images their audience predicate allows`, not from any INSERT policy and not
  from "the five folders" generally** — four of the five carry an `own-folder OR EXISTS(parent)`
  disjunction. The policy is `EXISTS` against `rides` under caller RLS, matching `map_card_path` or
  `map_detail_path`, plus the uid-segment pin to `organizer_id`, **plus a deliberate own-folder arm**
  (`design.md` §D8/§D9) so an orphan stays listable and deletable by its organizer. INSERT and
  DELETE take the ordinary own-folder shape.
- [ ] 1.7 Add an index supporting the storage SELECT policy's lookup by path, so a tile fetch does
  not sequentially scan `rides`.
- [ ] 1.8 **Paired assertions in `supabase/tests/rls_test.sql`** — required by
  `openspec/config.yaml`; a policy change with no new assertion is not finished. Cover every row of
  the per-role table: organizer, crew (`going` and `maybe`), signed-in non-crew on a visible ride,
  non-member of a private club, ex-member with a surviving `ride_members` row, blocked in **both**
  directions, club owner, club admin, and the object no row names — asserting for that last one
  that **another** rider is refused **and** that the organizer is not. Also assert all three CHECKs,
  the stale-tile trigger firing on an address change and **not** firing on an `is_public` bulk
  update, and the ledger's `attempted_at` trigger discarding a client-supplied timestamp.
- [ ] 1.8a Assert the **left-the-club** path directly: an organizer whose ride keeps a `club_id`
  they are no longer a member of can SELECT the ride and is refused the UPDATE by the policy's
  `WITH CHECK` arm. This is the silent-failure path in `design.md` §D2 and nothing else covers it.
- [ ] 1.8b Assert the ledger, and assert the thing it must **not** do:
  - an organizer at the ceiling is refused a ledger INSERT;
  - the same organizer, in the same state, **successfully updates their ride's `meeting_point`** —
    this is the guarantee that a spend control never aborts a ride write, and it is invisible from
    the ledger's own tests;
  - DELETE and UPDATE on the ledger are refused for the organizer's own rows, asserted by naming
    the **role**'s privilege rather than by calling it, since the suite runs as the table owner for
    whom no barrier exists;
  - another rider reads zero ledger rows for a ride they do not organise.
- [ ] 1.9 Assert the storage policies **per folder**, not by reusing another folder's coverage, per
  `stored-media-visibility`.
- [ ] 1.10 `PGPASSWORD=postgres npm test` green. Reconcile by **label set**, not by count — a count
  cannot tell a rename from a loss.
- [ ] 1.11 Apply `042` to DEV, then PROD. Re-derive with `list_migrations` against
  `ls supabase/migrations/` rather than trusting any number in a document.
- [ ] 1.12 Check security advisors after applying. **Expect eight, unchanged.** A new WARN means a
  `revoke` did not land.

## 2. Types and reads — still no tiles anywhere

- [ ] 2.1 Add the tile fields to `src/types/index.ts`. Nothing inline.
- [ ] 2.2 Extend `RIDE_SELECT` and the list select so the paths arrive with the ride. Keep it to
  `src/lib/data/`; components never call Supabase.
- [ ] 2.3 Resolve paths to signed URLs beside the existing `signImagePaths`, per viewer, never
  cached across riders.
- [ ] 2.4 Unit tests for the resolver, including that a NULL path yields no URL and no fetch.

## 3. The two screens — fallback preserved, tile drawn when present

- [ ] 3.1 `RideCard`: draw the tile in the 80×148 strip when a path is present; keep today's pin
  container exactly as-is when it is not. Update the doc comment, which currently states there is
  no data behind the strip.
- [ ] 3.2 `RideMap`: draw the tile behind the existing content in the 358×160 panel. **The whole
  panel stays the anchor** and `Get directions` stays — that was a real iPad bug fix, not a
  decoration. Keep the blank-`meeting_point` early return.
- [ ] 3.3 Contrast: the address currently sits at 12.65:1 on `bg-track`. Over a photographic tile
  that guarantee is gone — the text needs a scrim or a treatment that holds the ratio. This is a new
  colour pairing and therefore a mandatory reviewer contrast pass.
- [ ] 3.4 A failed image load falls back to the no-tile rendering rather than breaking the row.
- [ ] 3.5 Neither screen gates on the tile. Gate on the ride's data, never on a loading flag.
- [ ] 3.6 Update `docs/FIGMA-FIDELITY-TODO.md` §Rides list and §Ride detail — the two unchecked map
  entries. Do not delete them; check them off with what shipped, and leave the `ends_at`, two-line
  address and `max_riders` entries alone.

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
- [ ] 4.5 Geocode, then apply the granularity gate and then the numeric floor. Below either: write
  nothing, return success, do not render — a render costs a call for an image that must not be
  shown.
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
  instance of. This change does **not** depend on it: `042` states its grant level either way.
- [ ] 7.4 **PD-114 (place picker)** writes the same `latitude`/`longitude` columns with a
  known-good coordinate. Do not add a second coordinate column for it; a picked place overwrites the
  geocoded guess in place and the confidence column records which it was.

## 8. Deploy — the ordering, and the one owner action

- [ ] 8.1 **`042` first**, on its own. Purely additive; nothing reads the columns yet.
- [ ] 8.2 Groups 2–5 merge to `development` and deploy. Tiles are NULL everywhere and both screens
  render the fallback. **This state is correct and shippable indefinitely.**
- [ ] 8.3 **OWNER ACTION — deploy the Edge Function.** There is no `supabase` CLI in this container
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
