# Tasks — a postcard's location is a place the rider names

Specs: `specs/photo-capture-metadata/spec.md`, `specs/database-enforced-integrity/spec.md`,
`specs/place-search/spec.md`. Mechanism, measurements, rejected alternatives and the five open
questions: `design.md`.

**Three ordering rules, and nothing else here is order-dependent:**

- **§1.2 is a GATE ahead of §1.8/§1.9.** Both grant lists are absolute and must be built from the
  live database, never from this file, `064` or `docs/reference/schema.md`. `044` and `046` are the
  worked example of an absolute list written from a document silently reinstating what a previous
  file removed, on this exact table, with nothing red.
- **`Q1` is a GATE ahead of §4.6** (the prefill). Everything else in §4 can be built while it is
  open; the prefill sends a coordinate off the device and `Hide`'s hint says it never does.
- **§2 (the proxy) must not gate §4.** The client half is specified to work with the mode
  undeployed, so build and merge in either order.

`036`'s hand-exercise gate does **not** apply: this migration adds no trigger and hangs nothing off
a shipped write path. Do not copy `063`'s §3.

> **Built 2026-08-20, and two things diverge from the list below — read them before the list.**
>
> **`taken_place_id` was specified, added by `072`, and dropped by `073`.** The `reviewer` pass on
> this proposal caught that a provider id resolves through a place-details lookup to the picked
> feature's exact geometry, so beside a deliberately 2dp-rounded coordinate it returns the precision
> the rounding exists to remove. Every task below naming that column is superseded; the proposal and
> the specs are corrected, the tasks are left as written because they are the record of what was
> done, not a plan still to follow.
>
> **`073` also fixes a real defect in `072`.** An arm of the coupling constraint comparing the
> nullable marker with `=` evaluates to NULL rather than FALSE, and **a CHECK accepts NULL** — so
> `072` alone admits a coordinate with no marker, which is exactly the shape `064`'s own assertion
> exists to refuse. Every marker test is `is not distinct from` now. `072` is unedited, per the
> never-edit-an-applied-migration rule. **The two promote together**; promoting `072` alone puts the
> hole on PROD.
>
> **`Q1` was answered by the product owner in session**: the town lookup fires when the rider taps
> `Town`, never on upload, and `Hide`'s hint is reworded to *"LetsRide never stores the location of
> this photo."* — scoped to this app rather than to the world. `design.md` §Q1 carries the reasoning
> and the false premise the question was first put on.

## 1. The migration — `supabase/migrations/072_postcard_location_is_a_named_place.sql`

- [x] 1.1 Confirm the number. `071` is the highest file and no in-flight proposal claims `072` —
      re-derive rather than inherit:
      `ls supabase/migrations/` against `mcp__Supabase__list_migrations` on **both** projects, and
      `grep -rhno "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/`.
      Expect DEV at `071` and PROD at `070`; DEV-ahead is the ordinary state, not drift.
- [x] 1.2 **GATE.** Read both absolute lists off the live database and build §1.8/§1.9 from the
      output, not from anything written down:

      ```sql
      select privilege_type, string_agg(column_name, ',' order by column_name)
        from information_schema.column_privileges
       where table_schema='public' and table_name='postcards'
         and grantee='authenticated' and privilege_type in ('INSERT','SELECT','UPDATE')
       group by privilege_type;
      ```

      Measured 2026-08-20 the two projects agree exactly, for the first time since `064` was
      written — `062` promoted with `070`, so PROD's SELECT list no longer carries `ride_id`.
      **Do not re-add `ride_id` to SELECT.** If any time has passed, re-read: this is the check,
      not the record of it.
- [x] 1.3 Add the two columns: `taken_place_name text null`, `taken_place_id text null`.
      The `taken_` prefix is `064`'s and is load-bearing — where the photo was taken is not where
      the postcard was posted.
- [x] 1.4 Add `postcards_taken_place_name_length` — `taken_place_name is null or
      char_length(taken_place_name) <= 200`, mirroring `clubs_location_name_length`.
- [x] 1.5 Add `postcards_taken_place_id_length` — `taken_place_id is null or
      char_length(taken_place_id) <= 512`, mirroring both other provider-id columns after `069`
      widened them from 100. **Do not trim toward the observed maximum**; `069`'s header explains
      why 512 is a bound rather than a fit.
- [x] 1.6 Drop and re-add `postcards_taken_location_coupling` with the five arms in
      `design.md` §D3. Dropping and re-adding a constraint in a **new** file is not editing an
      applied migration — `067` set that precedent explicitly. Keep the range bounds `064` carried
      (`-90..90`, `-180..180`) in every arm that has a coordinate; retyping a constraint is exactly
      where a bound gets lost.
- [x] 1.7 Drop `postcards_region_location_is_rounded` and add
      `postcards_coarse_location_is_rounded` covering `'region'` **and** `'place'`, permitting a
      NULL coordinate. Keep the predicate's shape — *is the stored value at 2 decimal places*,
      never *does it equal the database's own rounding of some original* — which is what makes the
      JS/Postgres halfway-case disagreement (4.895 → 4.89 vs 4.90) unable to fail it.
- [x] 1.8 Issue the absolute INSERT grant: §1.2's list plus `taken_place_name, taken_place_id`.
- [x] 1.9 Issue the absolute SELECT grant: §1.2's list plus the same two.
- [x] 1.10 **Issue no UPDATE statement of any kind.** Leaving it alone is what produces the
      insert-only outcome; touching it is `044`/`046`'s trap. Say so in the file header, as `064`
      does, so the next reader does not "complete" the file.
- [x] 1.11 Grant nothing to `anon` — decision #1, and `007` revoked the last of them.
- [x] 1.12 Write no `UPDATE`, `DELETE` or `INSERT` against `postcards`. There is no backfill;
      `design.md` §D9 is the reasoning and the spec carries it as a requirement.
- [x] 1.13 Column comments on both new columns, in `064`'s register: what the value is, what it is
      **not** (a join key), that the audience is the postcard's, that it is insert-only, and that
      `'region'` is legacy. A comment is the `data` agent's first read and the one piece of
      documentation no edit to `CLAUDE.md` can reach.
- [x] 1.14 File header: what is wrong, why this is a privacy change rather than a schema chore,
      the measured grant lists with their date and project refs, what the file does **not** do
      (no policy, no trigger, no index, no backfill), and the verification block below.

## 2. The proxy — `supabase/functions/search-places/`

- [x] 2.1 `shape.ts`: widen `SearchMode` to include `'reverse'`, and widen `ProxyRequest` to carry
      a coordinate. Keep the rule that **no subject is read from the body** — there is still no
      field for a user id.
- [x] 2.2 `shape.ts`: range-check the inbound coordinate with the same four comparisons
      `parseRequest` already applies to the search bias, and refuse rather than collapse to null —
      a reverse lookup with no coordinate has nothing to do.
- [x] 2.3 `shape.ts`: `isSearchable`'s per-mode floor has no meaning for a coordinate. Give the
      reverse mode its own predicate rather than widening the term floor, so the search mode's
      4-character rule cannot be loosened by accident.
- [x] 2.4 `shape.ts`: the reverse endpoint URL builder and the response mapper. **Write the
      response type from documentation and label it as such** — `*.geoapify.com` is egress-blocked
      from this container, so it cannot be measured here, and `AutocompleteFeature`'s own header
      records the same limitation. Map to the existing result shape; drop a feature that lacks an
      id, a label or a valid coordinate rather than coercing it.
- [x] 2.5 `index.ts`: route the new mode after the ledger insert, alongside the other two. Change
      nothing about the order of operations.
- [x] 2.6 `src/__tests__/place-search-shape.test.ts`: cases for the new mode's parse, its range
      refusal, its mapper and its drop rules. `tsconfig.json` excludes `supabase/functions`, so
      this test is the only thing that type-checks any of it.
- [x] 2.7 **Replace §2.4's documented type with a measured payload** the first time anyone can
      reach the provider. Until then it is the single most likely thing in the directory to be
      wrong; note it in the file, as `shape.ts` already does for autocomplete.
- [x] 2.8 **Deploying is an owner action** — no CLI in the container, and `deploy_edge_function` is
      on the `deny` list. State in the PR that the repo is ahead of both deploys on merge, and that
      the client is specified to work without it. It should ride PD-267's redeploy rather than
      asking for a second one.

## 3. `src/lib/data/places.ts`

- [x] 3.1 `reversePlace(lat, lon)` — sends the **rounded** coordinate, per
      `specs/photo-capture-metadata` "Only a coarse coordinate SHALL leave the device for a
      lookup". Rounding at the call site, not at the caller, so no future caller can forget.
- [x] 3.2 It **degrades to `null` on every failure and throws none of the four typed errors**,
      following `getLocalityCentroid` and for its stated reason: nothing renders a distinct message
      per failure for a lookup the rider did not ask for.
- [x] 3.3 Read the unsupported-mode code off the error body through `edgeFunctionErrorCode` and
      latch it in module state for the page load, so a stale deploy costs one probe rather than one
      per postcard. Latch it for **that code only** — an outage must stay retryable, and the
      existing comment about module state dying on every page load is the reason this latch is
      sound where the ceiling-scope inference was not.
- [x] 3.4 A unit test for the latch: two calls, one probe. This is the whole degradation contract
      and it is invisible in any other gate.

## 4. The composer — `src/components/postcards/CreatePostcardForm.tsx`

- [x] 4.1 Render the `Location` block unconditionally, not behind `upload.status === 'done'`.
      Remove the "This photo has no location." sentence — the rider can now supply one.
- [x] 4.2 Add `PlaceSearchField` between the label and the mode control, **with no `names` prop**,
      so it writes no form fields of its own. The working tree already carries the change making
      `names` optional; verify it is still optional before relying on it.
      `maxNameLength` is 200, matching §1.4.
- [x] 4.3 Rename the middle mode and rewrite all three hint pairs to `design.md` §D1. These strings
      are contract and are asserted as written, as `064`'s were.
- [x] 4.4 Offer the precise mode only when the photo carried a coordinate — **removed, not
      disabled**, per `064` §D8's rule applied one level down.
- [x] 4.5 Extend the resolver in `src/lib/media/location.ts` to take the named place as well as the
      capture, and to produce the whole tuple — name, id, coordinate, marker — **together or not at
      all**. One function, not a branch at the call site: that is the file's founding rule and the
      reason a precise value can never be stored under a coarse marker. Round the place's
      coordinate here.
- [x] 4.6 **BLOCKED ON `Q1`.** Prefill the input from the photo: one lookup per file, none for a
      photo with no coordinate, memoised for the page load on the rounded coordinate, silent on
      every failure. If `Q1` comes back "no prefill", ship §4.1–§4.5 and leave the input empty for
      the rider to type — the change is coherent without this task.
- [x] 4.7 Clear the mode **and** the location on a new file, per §D11. The mode reset already
      exists; extend it and extend its comment to say why the name goes too.
- [x] 4.8 Pass no `recents` — §D12.
- [x] 4.9 Render the hidden inputs from the resolver only, and none at all under `Hide`. Assert
      the absence, not the emptiness.
- [x] 4.10 `Q4`: two labels or one. Ship the two-label version pending an answer.

## 5. Validation and the action

- [x] 5.1 `src/lib/validation/postcards.ts`: `postcardPlaceNameSchema` (≤ 200, empty → null) and
      `postcardPlaceIdSchema` (≤ 512, empty → null). Zod carries the **message**; §1 carries the
      guarantee.
- [x] 5.2 Widen `postcardLocationPrecisionSchema` to `['region', 'place', 'precise']` — `'region'`
      stays parseable because rows carry it, even though this client stops writing it.
- [x] 5.3 Replace the coupling refine with one per arm of §1.6, so an honest client meets a field
      error rather than a raw `23514` it cannot explain. Keep the rounding refine and widen it to
      both coarse markers, mirroring §1.7.
- [x] 5.4 `src/lib/actions/postcards.ts`: read the two new fields off `FormData` and name the two
      new columns on the insert. Nothing else changes — the action still validates and inserts what
      it was given and **does not reduce**, because a reduction there would imply the precise value
      already travelled.
- [x] 5.5 Unit tests for every arm, including the ones that must be **refused**: a `'place'` marker
      with no name, a `'precise'` marker with a provider id, an unrounded `'place'` coordinate, a
      half coordinate pair.

## 6. The RLS suite — `supabase/tests/rls_test.sql`

*Required by `openspec/config.yaml`: a migration with no new assertion is not finished.*

- [x] 6.1 The two whole-list grant pins for `postcards` INSERT and SELECT will fire on this
      migration — that is what they are for. Update the counts and prefix the labels `064/072:`.
      **Reconcile by label set against `origin/development`, never by arithmetic**: a count cannot
      tell a rename from a loss.
- [x] 6.2 The `pg_get_constraintdef` pin for `postcards_taken_location_coupling` moves. Update it
      to the new definition; do not relax it to a `LIKE`.
- [x] 6.3 `postcards_region_location_is_rounded` is **gone by name**. Grep the suite for it and
      repoint every assertion at `postcards_coarse_location_is_rounded`. A session diffing label
      sets will find the old name simply absent; reinstating it turns a correct database red.
- [x] 6.4 Assert each refused arm of §1.6 and each accepted one — including the **positive** at a
      200-character name and a 512-character provider id, because a one-sided rejection test passes
      unchanged against a database where `072` never applied (`057`'s lesson).
- [x] 6.5 Assert the coarse-rounding constraint fires for `'place'` as well as `'region'`, and
      passes for a `'place'` row with NULL coordinates.
- [x] 6.6 Assert UPDATE is still exactly `caption, club_id, image_path`, and that neither new
      column holds UPDATE for `authenticated`.
- [x] 6.7 Assert `anon` holds nothing on either column in any verb, **naming the role** — a
      table-wide count reads non-zero against a correct database because `postgres` and
      `service_role` hold everything by Supabase default.
- [x] 6.8 Assert the visibility table in `specs/database-enforced-integrity`: author, club member,
      non-member, ownerless club owner, app-wide reader, blocked rider in **both** directions, and
      a rider who hid the postcard. The blocked case is the one most often missed.
- [x] 6.9 Assert no policy on `postcards` moved — capture `qual`/`with_check` digests before
      applying and compare after.
- [x] 6.10 Assert a legacy `'region'` row survives: insert one before the constraint swap in a
      rolled-back transaction and show it still satisfies every constraint after.
- [x] 6.11 **Mutation-test at least two of these** rather than reading them green: drop the
      `'place'` arm from the rounding constraint and show §6.5 fails; drop the name requirement
      from the coupling and show §6.4 fails.

## 7. Apply, verify, promote

- [x] 7.1 Apply `072` to DEV. Re-read both grant lists and confirm **UPDATE has not moved**.
- [x] 7.2 Confirm the four constraints exist by name and that
      `postcards_region_location_is_rounded` does not.
- [x] 7.3 `get_advisors(security)` on DEV — this file adds no function, no view and nothing
      `security definer`, so the count must not move. Anything new means something landed that the
      file did not describe.
- [x] 7.4 `PGPASSWORD=postgres npm test` green, and reconcile the assertion count by **label set**
      against `origin/development`, recording the new/relabelled split in `docs/HANDOFF.md`'s
      assertion row.
- [ ] 7.5 `npm run db:drift` — the repo, DEV and PROD agree on the chain. **NOT RUN, and not
      runnable from a session**: it needs `PROD_DATABASE_URL` and `DEV_DATABASE_URL`, which are
      passwords no session holds. What was checked instead is the weaker thing that IS available —
      `list_migrations` against `ls supabase/migrations/`, recorded in `docs/HANDOFF.md` §Migrations
      as repo 73 / DEV 75 rows / PROD 70, one chain. Do not read the tick above this line as
      drift having been ruled out the way `db:drift` rules it out.
- [ ] 7.6 Promote to PROD in filename order with everything else in the gap, per
      `docs/ENVIRONMENTS.md` §Migrations. Nothing here is destructive to a running client — an old
      client's rows satisfy arms 1, 4 and 5 — so the additive-first ordering constraint is the
      ordinary one rather than `069`/`070`'s.

## 8. The walk and the docs

- [x] 8.1 `npm run walk` with fixtures, through the relay. **Ran 2026-08-20, green** — exit 0,
      `18/18 screens rendered clean`, `44/44 guard, navigation and sign-out checks correct`, and
      `/postcards/new` confirmed rendering the Location block with **no photo chosen**, checked
      against the live DOM rather than inferred from the source. The 44 is **four below** the
      handoff's 48/48 baseline and the walk says why itself — the freshly-minted account owns no
      ride or club, so `provision()` did not fire (DEV already had both from other accounts) and
      the edit-retention phase correctly refused to test somebody else's. A shrink is a skip rather
      than a pass, so it is recorded here rather than read as clean. Original task text: The create-postcard phase must reach the
      composer with the block rendered before a photo is chosen — a screen that throws on load is
      invisible to `tsc`, ESLint, Vitest, `next build` and the RLS suite.
- [x] 8.2 Update `docs/reference/schema.md`'s `postcards` row: the two columns, the new grant
      lists, the replaced and renamed constraints, and the sentence about `Region` being 2 decimal
      places, which becomes the coarse-marker rule. That row currently states the old middle mode
      as fact.
- [x] 8.3 `npm run docs:check` — several claims in `CLAUDE.md` and `docs/HANDOFF.md` measure things
      this change moves.
- [ ] 8.4 Record in the PR body which of `Q1`–`Q5` were answered and by whom, and which shipped on
      their recommended default.
