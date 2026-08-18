# Tasks — capture a photo's time and place at upload

Specs: `specs/photo-capture-metadata/spec.md`, `specs/database-enforced-integrity/spec.md`.
Mechanism, measurements and the rejected alternatives: `design.md`.

**Two ordering rules, and nothing else here is order-dependent:**

- **§1.2 (the live grant lists) is a gate ahead of §1.10/§1.11 (writing them).** An absolute
  re-grant list built from a document instead of the database is the silent failure recorded in
  `docs/reference/migrations.md` §The ordering chain, on the one table it has already happened to
  — and PROD's list currently differs from DEV's, which is the live instance of the trap.
- **§4.1 (the EXIF read) must be wired before `compressImage`, not after.** After it there is
  nothing left to read, for ever, and the failure is silent.

`036`'s hand-exercise gate does **not** apply — this migration adds no trigger and hangs nothing
off a shipped write path. Do not copy `063`'s §3.

## 1. The migration — `supabase/migrations/064_postcards_capture_time_and_place.sql`

- [ ] 1.1 Derive the file number from `ls supabase/migrations/` against
      `mcp__Supabase__list_migrations` on **both** projects. `063` is the highest file at proposal
      time and no in-flight proposal claims `064`
      (`grep -rhno "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/`) — verify, do not inherit.
      **This is the one pre-flight check still genuinely open at write time**; §2 carries the
      others, already measured.
- [ ] 1.2 **GATE.** Build §1.7/§1.8's lists from the grant lists measured on DEV (§2.2), and
      re-read them if any time has passed — never from a document, including this one:

      ```sql
      select privilege_type, string_agg(column_name, ',' order by column_name)
        from information_schema.column_privileges
       where table_schema='public' and table_name='postcards'
         and grantee='authenticated' and privilege_type in ('INSERT','SELECT','UPDATE')
       group by privilege_type;
      ```

      **PROD's SELECT list still carries `ride_id` and `064` must NOT reinstate it.** PROD is at
      `059`, `062` is unpromoted, and that is ordinary DEV-ahead rather than drift — `064` lands
      after `062` in filename order and fixes it there too. Anyone reading PROD's current list and
      "correcting" `ride_id` back into the re-grant would silently undo `062`.
- [ ] 1.3 Add the **five** columns: `taken_at timestamptz null`,
      `taken_at_offset_minutes smallint null`, `taken_latitude double precision null`,
      `taken_longitude double precision null`, `taken_location_precision text null`.
      The offset column is `Q1`'s answer and is **not** deferrable: an offset is unrecoverable
      after the fact, so a later migration cannot backfill it — and it would be a second
      revoke-and-regrant of this table's lists, the pair `044`/`046` already cost this repo once
      (`design.md` §D7).
- [ ] 1.4 Add the capture-time CHECK — `taken_at is null or (taken_at >= timestamptz '1995-01-01'
      and taken_at <= now())`. `now()` is permitted because the predicate only ever becomes more
      true (`design.md` §D4). The floor is **1995**, not 1900: measured, a 1900 floor admits both
      epoch-0 and 1904 Mac dates, which are the two values it was written to catch
      (`design.md` §D5). It must equal the reader's clamp constant (§3.3).
- [ ] 1.5 Add the offset CHECK — `taken_at_offset_minutes is null or taken_at_offset_minutes
      between -1440 and 1440`. **Deliberately permissive**: `OffsetTimeOriginal` is `±HH:MM`, so a
      camera with a wrong setting can legitimately write `+23:00`, and a CHECK tight to the real
      world (`-720 … 840`) would refuse a rider's post over a setting they cannot see. The
      reader's clamp is what keeps garbage out; this bounds the column.
- [ ] 1.6 Add the time-coupling CHECK — `(taken_at is null) = (taken_at_offset_minutes is null)`.
      One writer, which always knows an offset, so the coupled shape is free — and no reader ever
      has to guess what a bare instant's wall clock was.
- [ ] 1.7 Add the coordinate coupling-and-bounds CHECK in **one** constraint, copying
      `rides_geocode_coupling` (`051`) rather than inventing a second idiom: all three location
      columns NULL, **or** all three set with latitude in `[-90, 90]` and longitude in
      `[-180, 180]`.
- [ ] 1.8 Add the precision CHECK — `taken_location_precision is null or
      taken_location_precision in ('region','precise')`. Keep it separate from §1.7 so a refusal
      names which rule fired.
- [ ] 1.9 Add the **region rounding CHECK** —
      `taken_location_precision <> 'region' or (taken_latitude = round(taken_latitude::numeric, 2)::float8
      and taken_longitude = round(taken_longitude::numeric, 2)::float8)`. **Verified on DEV
      2026-08-18** across `52.37, 4.895, -0.01, 0, 52.3702, 179.99, -89.99, 1.005, 123.456789`:
      accepts anything already at two decimal places, rejects anything else, idempotent. Put the
      reason in the header, because the obvious worry is the wrong one: the predicate asks whether
      the value **is** at two places, never whether it equals Postgres's rounding of an original
      the database never saw — so JS's `4.89` and Postgres's `4.90` for `4.895` **both pass**, and
      any `integer / 100` passes. There is nothing to reconcile between the two rounding
      implementations and nobody should try (`design.md` §D2).
- [ ] 1.10 `revoke insert on public.postcards from authenticated;` then an **absolute**
      `grant insert (...)` naming §1.2's six columns **plus the five new ones** — eleven. The
      revoke cascades the column grants (`044` measured it), so the list is the whole surface and
      an omitted column holds nothing.
- [ ] 1.11 `revoke select on public.postcards from authenticated;` then an **absolute**
      `grant select (...)` naming `062`'s seven columns **plus the five new ones** — twelve, and
      **still no `ride_id`** (§1.2). Omitting one is a screen on the error boundary, not a compile
      error.
- [ ] 1.12 **Do NOT issue any UPDATE statement.** Not a revoke, not a grant, not "for
      completeness". All three verbs are column-level, so the five columns arrive with no UPDATE
      and the insert-only decision costs nothing (`design.md` §D6, measured). Re-issuing an
      absolute UPDATE list from a stale document is how `044`'s list reinstates `id` and
      `author_id`, with no error and nothing red.
- [ ] 1.13 No grant of any kind to `anon` — decision #1, and `007` revoked the last of them.
- [ ] 1.14 No policy is touched in any verb. Capture the four quals' md5 before applying and put
      the comparison in the file's footer, the way `044` §4 does.
- [ ] 1.15 No index. State in the header why: `postcards_ride_id_idx` already reduces a Journal to
      a handful of rows and sorting those is a sort over tens, so an index on `(ride_id, taken_at)`
      would serve a query that does not exist at a scale that does not exist.
- [ ] 1.16 `comment on column` for all five — a database comment is the `data` agent's first read
      via `list_tables` and the one piece of documentation no edit to `CLAUDE.md` reaches
      (`028`, `033`). Each says: that the value is a **claim** supplied by the client, that it is
      insert-only and why; for the coordinates, that the rider chose the precision on the device
      and the precise value was never sent unless the marker says `precise`; and for the offset,
      that it is the offset the instant was resolved in — `OffsetTimeOriginal` or the device's own
      at the capture date — so the camera's wall clock is `taken_at` shifted by it.
- [ ] 1.17 Header comment: the three modes and why the reduction is client-side; why `now()` in a
      CHECK is safe here and not in general; why the floor is 1995; why the offset column could
      not wait; why the region CHECK is not a rounding-parity check; that UPDATE is deliberately
      untouched and re-issuing it is the trap; and the rollback SQL from `design.md`
      §Migration Plan **including its second half** — a bare `drop column` leaves the recorded
      grant lists silently pruned.
- [ ] 1.18 Footer verification block, to be run against the project after applying, not assumed:
      the two grant lists scoped to `authenticated`; `has_table_privilege(...,'insert'/'select')`
      both false; `has_column_privilege('authenticated', …, 'UPDATE')` false for all five; the six
      constraints present by name; `anon` at zero rows; the policy md5s unchanged.

## 2. Against the hosted projects

Both refs are reachable and the coordinating session has already run two of these. Recorded with
their results rather than left open.

- [x] 2.1 **Live grant lists, measured 2026-08-18** on DEV (`fpmrimzxadewsaiwpsel`), grantee
      `authenticated`: INSERT `author_id, caption, club_id, id, image_path, ride_id`; SELECT
      `author_id, caption, club_id, created_at, id, image_path, updated_at`; UPDATE
      `caption, club_id, image_path`. **PROD (`zwprydcyryvudhurbnye`) is identical except SELECT
      still carries `ride_id`**, because PROD is at `059` and `062` is unpromoted — see §1.2.
- [x] 2.2 **The region rounding CHECK, verified on DEV 2026-08-18** across nine values — accepts
      two-decimal values, rejects everything else, idempotent. Detail and the misreading it
      invites are in §1.9 and `design.md` §D2.
- [ ] 2.3 `list_migrations` on both refs against `ls supabase/migrations/` — the file number, and
      what else is sitting in the DEV-ahead gap. Still open; it can only be answered at write
      time.
- [ ] 2.4 `get_advisors(security)` after applying to DEV. Expect **no change** — this file adds no
      function, no view and nothing `security definer`. A new WARN means something landed that the
      file does not describe.

## 3. `src/lib/media/exif.ts` — the reader

- [ ] 3.1 Parse only what is needed: the JPEG segment walk to APP1/`Exif`, the TIFF header, the
      Exif IFD for `DateTimeOriginal` (0x9003) and `OffsetTimeOriginal` (0x9011), and the GPS IFD
      for `GPSLatitude`/`GPSLatitudeRef`/`GPSLongitude`/`GPSLongitudeRef`. Return `null` for
      everything it cannot read; **never throw**, for any input. **No new dependency** — re-derive
      the count with `node -p "Object.keys(require('./package.json').dependencies).length"`.
- [ ] 3.2 **Q1 is answered — replace `exif.ts`'s current resolution.** It shipped in `e4d8cab`
      using `wallClockToUtc` (`APP_TIME_ZONE`), which against this change's `taken_at <= now()`
      leaves `taken_at` **silently NULL** for every rider east of Amsterdam posting promptly
      (`design.md` §D7, with the Helsinki case). The answer is: `OffsetTimeOriginal` when present,
      and otherwise **the device's own offset at the capture date** — and either way the offset
      used is returned alongside the instant, for §1.3's column. **Do not edit
      `src/lib/utils.ts`** — PD-262 owns that file this session, and `wallClockToUtc` stays
      correct for the `datetime-local` it was written for.
- [ ] 3.3 **Two sign-and-date traps, both silent.** The offset must be the device's offset **at
      the capture date**, derived from a `Date` built on the capture wall clock — a July photo
      uploaded in December records `+120`, not `+60`, so `new Date().getTimezoneOffset()` is
      wrong. And `getTimezoneOffset()` returns minutes **behind** UTC (Amsterdam in summer answers
      `-120` for UTC+2), so it must be negated to mean what the column means. Neither shows up
      until a renderer draws a time hours out; both are unit tests in §9.
- [ ] 3.4 Clamp: return `null` when the resolved instant is in the future or below the floor —
      and return `null` for **both** `taken_at` and the offset, together. The coupling CHECK
      (§1.6) refuses a half pair, so dropping only the instant turns a garbage tag back into a
      refused post, which is the outcome the clamp exists to prevent. Export the floor as a named
      constant and restate its value in `064`'s header; §1.4 and this must be the same number.
- [ ] 3.5 Never return an offset without an instant either — an `OffsetTimeOriginal` on a file
      with no readable `DateTimeOriginal` is discarded, for the same coupling reason.
- [ ] 3.6 Convert GPS rationals to signed decimal degrees, applying `S`/`W` refs as negation.
- [ ] 3.7 Export `roundToRegion(value)` as `Number(value.toFixed(2))` — not
      `Math.round(v * 100) / 100`, which can leave a float artefact that later gets rendered
      (`design.md` §D2). It must produce a value the region CHECK (§1.9) accepts; it does, because
      that CHECK asks only whether the value is at two decimal places.
- [ ] 3.8 Export from `src/lib/media/index.ts` alongside the existing surface.

## 4. `src/lib/media/upload.ts`

- [ ] 4.1 `uploadPostcardImage` reads the EXIF off the **original `File`** and returns it beside
      the path — `{ path, capture }`, where `capture` carries the instant, its offset and the two
      coordinates. **Before `compressImage`**, which is the whole contract.
- [ ] 4.2 A failed or empty read SHALL NOT fail the upload. Nulls are an ordinary outcome, not an
      error path.
- [ ] 4.3 Leave `uploadAvatarImage`, `uploadCoverImage` and both club uploads alone. Nothing reads
      capture metadata off an avatar, and adding it there would ship a coordinate to a surface
      with no design and no decision.

## 5. `src/components/postcards/CreatePostcardForm.tsx`

- [ ] 5.1 Hold the capture result in component state, keyed to the currently-picked file. Reset to
      `Hide` and discard the previous metadata whenever the photo changes.
- [ ] 5.2 The Location block: `LocationOutlineIcon` at `h-5 w-5 text-muted` (matching
      `rides/detail/page.tsx:203`, the app's other location row), the label `Location`, then
      `<ButtonGroup>` with `Hide` / `Region` / `Precise`, then the hint. **Reuse `ButtonGroup`
      unmodified** — it is the v2 segmented control and no new primitive is needed.
- [ ] 5.3 The three hint strings, verbatim, with the lead clause emphasised. They are contract and
      are asserted; do not reword them.
- [ ] 5.4 The no-location state: keep the icon and label, replace control and hint with
      "This photo has no location." **Not a disabled `ButtonGroup`** (`design.md` §D8).
- [ ] 5.5 Hidden inputs carry the **reduced** value for the selected mode and are absent entirely
      under `Hide`. The precise value stays in component state and never enters the DOM
      (`design.md` §D10). This is what makes the rule checkable rather than asserted.
- [ ] 5.6 `taken_at` and `taken_at_offset_minutes` travel in their own hidden inputs whenever the
      instant was read — both or neither, per the coupling CHECK — and **independently of the
      location mode**: the three modes govern place, not time (`design.md` §D13, and **Q3** if the
      owner overrules).
- [ ] 5.7 **Do not reword the `Hide` hint to a broader claim.** It says the photo's *location*
      never leaves the phone, which stays true with `taken_at` uploaded; "nothing about this photo
      leaves your phone" would be false and is forbidden by a requirement until **Q3** is
      answered.
- [ ] 5.8 Do not persist the mode anywhere. No `localStorage`, no secure storage, no profile
      column.
- [ ] 5.9 The block renders only once a photo is picked, and the composer stays usable if the read
      is slow or fails.

## 6. Validation, action and types

- [ ] 6.1 `src/lib/validation/postcards.ts`: five fields mirroring the CHECKs, `FormData` strings
      in and typed values out, absent fields becoming `null` the way `postcardClubIdSchema` does.
      Zod owns the **message**; the CHECK owns the guarantee.
- [ ] 6.2 **Both** pairing rules are expressed in the schema as refinements — the coordinate
      triple and the `taken_at`/offset pair. They are the rules a malformed submission is most
      likely to hit, and a Zod message beats a raw `23514`.
- [ ] 6.3 `createPostcard` carries the five values into the insert and **rounds nothing**
      (`design.md` §D10).
- [ ] 6.4 No new cache key and no new invalidation. `postcards.all()` plus the club detail already
      cover the row this writes.
- [ ] 6.5 `src/types/index.ts`: add `PhotoLocationPrecision = 'region' | 'precise'` and the
      capture input type, which carries the offset as well as the instant. **Do not add fields to
      `Postcard`** — no read returns them (`design.md` §D11).
- [ ] 6.6 `src/lib/data/columns.ts`: a comment recording that the five columns are granted and
      deliberately **not** projected, and why. Do not touch `POSTCARD_SELECT`.

## 7. Follow-ups to FILE, not to build

- [ ] 7.1 File the "widen or clear, never sharpen" affordance: a BEFORE UPDATE trigger allowing
      `precise` → `region` → NULL and refusing the reverse, a grant on the three columns, and the
      edit screen it needs. Named in `design.md` §D6 with why it is not this change.
- [ ] 7.2 Note in the PD-257 issue that the Journal inherits the ordering rule
      (`photo-capture-metadata`, *The Journal SHALL sort on the capture time…*) and that its sort
      direction must be settled with `tag-postcards-to-rides` (**Q4**).
- [ ] 7.3 Carry **Q3** (does `Hide` cover time) and **Q5** (does a rider need to see their own
      published location before PD-257) to the owner. Neither blocks; both are hers alone, and
      both get cheaper to answer now than after a screen renders any of this.
      `proposal.md` §Open questions for the owner has them phrased to lift verbatim into the PR
      body or the Linear comment. **Q1 and Q2 are closed** — answered by the coordinating session
      on 2026-08-18 and recorded as assumptions in `design.md` §Questions, either of which she may
      still overturn.

## 8. RLS suite — `supabase/tests/rls_test.sql`

Required by `openspec/config.yaml`: *a policy change with no new assertion is not finished*, and a
grant change is the same rule. **Every privilege assertion names the grantee** — a table-wide
count reads 2 against a correct database because `postgres` and `service_role` hold everything by
Supabase default (`015`'s footer, `031`'s lesson).

- [ ] 8.1 **REWRITE the existing assertion at `rls_test.sql:9818`** — the exact INSERT list
      `author_id,caption,club_id,id,image_path,ride_id` becomes the eleven-column list. This is a
      real behaviour change to a passing test, not a rename.
- [ ] 8.2 **The existing assertion at `rls_test.sql:8949` must stay GREEN** — UPDATE is exactly
      `caption,club_id,image_path`. If it goes red, §1.12 was violated and the migration walked
      into the `044`/`046` trap. Do not "fix" it by widening the expected list.
- [ ] 8.3 **Assert `ride_id` is still ABSENT from the SELECT grant** — `062` removed it, PROD's
      current list still has it because `062` is unpromoted, and this is the assertion that
      catches a re-grant list built from PROD (§1.2).
- [ ] 8.4 Five new per-column SELECT assertions, one per new column, joining `062`'s block at
      `14330`–`14343` in the same shape — an omission then fails here rather than as a screen on
      the error boundary.
- [ ] 8.5 Five new per-column UPDATE assertions, each **false**. Assert by naming the role, never
      by attempting the write: the suite runs as the table owner, for whom no grant exists to fail
      (`031`/`029`).
- [ ] 8.6 `anon` holds nothing on the five columns, on every verb, asserted both by counting its
      rows in `column_privileges` and by `has_column_privilege` on each verb — `041`'s pair, and
      the two catch different mistakes.
- [ ] 8.7 The capture-time CHECK: a future `taken_at` refused; `now() - interval '1 minute'`
      admitted; a value below the floor refused; NULL admitted. Every fixture here must supply the
      offset too, or §8.9's coupling refuses it first and the assertion passes for the wrong
      reason — which is the one way this block can go quietly wrong.
- [ ] 8.8 The offset CHECK: `1441` refused, `-1441` refused, `1440` and `-1440` admitted, and
      `+23:00`-worth (`1380`) admitted — the permissiveness is deliberate (§1.5) and an assertion
      is what stops someone tightening it to `-720 … 840` later.
- [ ] 8.9 The time-coupling CHECK: `taken_at` with a NULL offset refused; an offset with a NULL
      `taken_at` refused; both NULL admitted; both set admitted.
- [ ] 8.10 The coordinate coupling CHECK, **one assertion per half-state**: latitude alone,
      longitude alone, both coordinates with no marker, a marker with no coordinates. Four
      refusals, plus the two legal shapes admitted.
- [ ] 8.11 The bounds: latitude `91` refused, longitude `181` refused, `-90`/`180` admitted.
- [ ] 8.12 The precision marker: `'exact'` refused, `'region'` and `'precise'` admitted.
- [ ] 8.13 The region rounding CHECK: `region` with `52.3702` refused; `region` with `52.37`
      admitted; **`precise` with `52.3702` admitted** — the constraint applies only to `region`
      rows, and asserting that is what stops it being widened into a rule that refuses precise
      coordinates. Also assert `region` with a value at two places that is *not* Postgres's
      rounding of anything (`4.89`) is admitted, which pins the reading in §1.9.
- [ ] 8.14 The audience, under `set role authenticated` with real fixtures, one assertion per
      role — author reads their own; a club member reads a club postcard's columns; a **non-member
      gets no row**; a **blocked** rider gets no row with the block written in each direction; a
      rider holding a `postcard_hides` row gets no row; a club `admin` reads exactly what a
      `member` does. The negatives are the ones `openspec/config.yaml` exists for.
- [ ] 8.15 The four policy quals are byte-identical to before — the same md5 comparison `044` §4
      uses. This change touches no policy and the assertion is what keeps that true.
- [ ] 8.16 Compare **label sets**, not counts, against the previous run when reconciling the suite:
      a count cannot tell a rename from a loss (`CLAUDE.md`).

## 9. Unit tests — `src/lib/media/__tests__/`

- [ ] 9.1 Byte fixtures: a JPEG with `DateTimeOriginal` and a GPS IFD; one with time and no GPS;
      one with GPS and no time; one with neither; a truncated Exif segment; a non-JPEG. All six
      return without throwing.
- [ ] 9.2 **The ordering guard**: feed `compressImage`'s output back into `readExifCapture` and
      assert nulls. It is the same claim as "read before compressing", written so it fails if the
      two calls are ever swapped.
- [ ] 9.3 Zone resolution: `OffsetTimeOriginal` present wins and is what gets recorded; absent
      resolves in the device zone and records the device's offset. Assert **offsets rather than
      strings**, and do not let `TZ=UTC` in `vitest.config.ts` let a naive implementation pass —
      `wallClockToUtc`'s own tests carry that lesson.
- [ ] 9.4 **The two traps in §3.3, each its own test.** A capture date in a different DST period
      from "now" records the offset of the **capture** date; and the recorded sign is UTC-relative
      (Amsterdam summer records `+120`, not `-120`). Both need a non-UTC `TZ` to be meaningful.
- [ ] 9.5 The clamp: a future instant and a below-floor instant both return `null` — **and the
      offset comes back `null` with each of them**, never one without the other. Plus: a file with
      `OffsetTimeOriginal` and no readable `DateTimeOriginal` returns both `null`.
- [ ] 9.6 `roundToRegion`: 2 decimals, both signs, and no residual float artefact in the output.
      Include `4.895`, whose JS answer (`4.89`) differs from Postgres's (`4.90`) and which the
      region CHECK accepts either way — the test pins the behaviour so nobody later "fixes" it
      toward Postgres.
- [ ] 9.7 GPS ref handling: `S` and `W` negate.

## 10. Verify and document

- [ ] 10.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`,
      `PGPASSWORD=postgres npm test`, `npm run build`.
- [ ] 10.2 `npm run docs:check` — this change edits `docs/` and CI runs the claims job on that.
- [ ] 10.3 **A real photo through the real composer**, off an actual phone, on DEV via the walk's
      relay. Nothing in this proposal was rendered in a browser; the byte fixtures are not the
      same claim (`design.md` §Verification). This is a gate on "does it work at all".
- [ ] 10.4 `docs/reference/schema.md` — the `postcards` per-column grant table gains five rows and
      the audience paragraph gains the sentence that the columns' audience *is* the postcard's,
      with no narrower one available.
- [ ] 10.5 `docs/HANDOFF.md` — the migration count and its verification command, and the three
      open questions (Q3, Q4, Q5) with their recommended defaults. Note that Q1 and Q2 were
      answered by a session rather than by the owner, so a later reader knows they are assumptions
      rather than instructions.
- [ ] 10.6 **Do not touch** `src/components/clubs/`, `src/app/(app)/clubs/`,
      `src/components/rides/RideChip.tsx`, `src/lib/routes.ts`, `src/lib/utils.ts` or
      `docs/FIGMA-FIDELITY-TODO.md` — PD-262 owns all six this session.
