# Tasks — the weekend digest, part 1

Specs: `specs/weekly-digest/spec.md`, `specs/database-enforced-integrity/spec.md` and
`specs/analytics-consent/spec.md`. `design.md` has the content rule (§D3), the body (§D4) and the
negative-case list the suite maps onto.

**The order matters in one place.** `129` applies to DEV before this branch's bundle can serve,
and to PROD before the promotion merges. The branch already calls `my_digest_opt_out` and
`set_digest_opt_out`.

## 1. `129` — the additive migration

- [x] 1.1 Take the number off DEV's `list_migrations` when the file is written. It was `128` on
      2026-09-22, with 131 rows, 128 files and 3 long-standing file-less rows. Count the
      file-less rows, not the gap.
- [x] 1.2 Add `profiles.digest_opt_out_at timestamptz`: nullable, no default, no backfill, with a
      column comment saying it is a preference, not a gate, and that nothing reads it until
      part 2. **No `grant` and no `revoke` on `public.profiles`.** The file says which of `025`'s
      three lists the column joins (none) and names the accessor.
- [x] 1.3 Add `public.my_digest_opt_out()` and `public.set_digest_opt_out(p_opt_out boolean)`,
      following `096`'s pair verbatim:
      - [x] `true` gives `coalesce(existing, now())`, and `false` gives NULL;
      - [x] each returns the effective value;
      - [x] no profile row gives `P0002`, and no session gives `42501`;
      - [x] grants: `revoke all … from public, anon` and `grant execute … to authenticated`.
- [x] 1.4 Add `private.weekend_digest_for(candidate uuid, at timestamptz, near_lat double
      precision, near_lon double precision)` per `design.md` §D3 and §D4:
      - [x] `security definer`, `stable`, `search_path = ''`;
      - [x] return columns `(section text, ordinal integer, ride_id uuid, club_id uuid, new_rides
            integer, new_threads integer)`;
      - [x] a NULL candidate returns zero rows;
      - [x] position: both NULL means no position; one NULL or out of range raises `22023`;
            otherwise round to 2 dp;
      - [x] the 8-day `departure_at` prefilter;
      - [x] haversine with 6371.0088 and `<= 100`;
      - [x] **no comment inside the body names** `auth.uid`, `rides_from` or `digest_opt_out_at`
            (the comment trap: `§129.6` strips `--` comments, but keep the body clean anyway);
      - [x] `revoke all … from public, anon, authenticated, service_role`.
- [x] 1.5 Add `public.my_weekend_digest(near_lat double precision default null, near_lon double
      precision default null)`:
      - [x] same return shape; `security definer`; `search_path = ''`;
      - [x] the body is exactly `select * from private.weekend_digest_for((select auth.uid()),
            pg_catalog.now(), near_lat, near_lon)`;
      - [x] grants: `revoke all … from public, anon` and `grant execute … to authenticated`.
- [x] 1.6 Header: additive, migration-first, and the reason. Include the definer justification
      for each of the four functions, and the note that no table, trigger, policy or table grant
      moves.

## 2. RLS suite `§129`

Each item is one labelled assertion or more. The numbers follow `design.md` §Roles and negative
cases.

- [x] 2.1 `129.1`:
      - [x] `has_column_privilege('authenticated', 'public.profiles', 'digest_opt_out_at', …)` is
            false for select, insert and update;
      - [x] `096.1`'s widths still read 10/8/8.
- [x] 2.2 `129.2`:
      - [x] identity args are `''` and `'p_opt_out boolean'`;
      - [x] setting twice keeps the first stamp;
      - [x] `false` clears it.
- [x] 2.3 `129.3`: each opt-out leaves the other unchanged, as two assertions, one per direction.
- [x] 2.4 `129.4` and `129.5`, both grantee-scoped `has_function_privilege`:
      - [x] `anon` has no EXECUTE on the three public RPCs;
      - [x] `authenticated`, `anon` and `service_role` have none on the private body.
- [x] 2.5 `129.6`:
      - [x] the body's comment-stripped `prosrc` matches none of `auth\.uid\(`,
            `private\.is_club_member\(`, `private\.is_ride_crew\(`, `\mrides_from\M` or
            `\mdigest_opt_out_at\M`;
      - [x] the wrapper's `prosrc` **equals** the delegation;
      - [x] **verified both ways** against a scratch body that names `rides_from`.
- [x] 2.6 Build the fixture: a small world with one timestamp, pinning `at` to a known Wednesday.
      It holds:
      - riders: owner, admin, member, non-member, club invitee, removed member, ride invitee,
        and a rider blocked in each direction;
      - clubs: one private club and one public club;
      - rides on that week's Saturday and Sunday, within and beyond 100 km;
      - one ride on the next week's Saturday, one on the Friday, and one already departed;
      - one ride with NULL coordinates;
      - one ride in `America/Los_Angeles` that is Friday locally and Saturday in Amsterdam;
      - a public ride inside the private club;
      - threads, some by the blocked rider.
- [x] 2.7 `129.7` to `129.16`, and `129.18`, against that fixture, calling
      `private.weekend_digest_for` as the owner with each candidate. Blocks are asserted with the row in each direction.
      **Mutation-test** the block conjuncts and the membership gate in a scratch copy: each
      assertion must go red, then revert.
- [x] 2.8 `129.19`: an opted-out rider and a twin who is not opted out get identical rows.
- [x] 2.9 `129.17`: a NULL candidate returns zero rows, and one-NULL and `NaN` positions raise
      `22023`.
- [x] 2.10 The participation-gate totals stay **23**. Re-derive them with the count query in
      `docs/reference/schema.md` §The participation gate. No new gated table.
- [ ] 2.11 `npm test` is green, and the new labels are listed in the PR. **Not run here: there is
      no Postgres on this Mac.** The block was run instead against DEV in a rolled-back
      transaction, in the hosted identity idiom, with the assertions recording rather than
      raising: 88 passed, 0 failed. CI's RLS job (Postgres 17) is the gate.

## 3. DEV — the hand-exercise gate, then apply

- [x] 3.1 On DEV, as `authenticated`, in one **rolled-back** transaction (`set local role
      authenticated` plus `request.jwt.claims`):
      - [x] call `my_weekend_digest` with a position and without one;
      - [x] call `set_digest_opt_out(true)` twice, then `false`, then `my_digest_opt_out()`;
      - [x] confirm `analytics_opt_out_at` did not move;
      - [x] confirm `select digest_opt_out_at from profiles` answers `42501`.
- [x] 3.2 Apply `129` to DEV. Read `list_migrations` back.
- [x] 3.3 `get_advisors(security)` shows exactly **+3** `authenticated_security_definer_function_executable`
      WARNs (the three public functions) and no new class. Record them in
      `docs/reference/migrations.md` §Security advisors.

## 4. Data layer

- [x] 4.1 Types in `src/types/index.ts`:
      - [x] `WeekendDigest = { rides: RideListItem[]; clubs: WeekendDigestClub[] }`;
      - [x] `WeekendDigestClub = { club: EmbeddedClub; newRides: number; newThreads: number }`.
      Reuse existing shapes rather than inventing new ones.
- [x] 4.2 `src/lib/data/digest.ts`, `getWeekendDigest(near: RiderPosition | null)`:
      - [x] `rpc('my_weekend_digest', near ? { near_lat, near_lon } : {})`;
      - [x] then, in parallel:
        - [x] rides by id with `RIDE_SELECT`, through `toRideListItem`, `withRideDistance` and
              `resolveRideMapUrls`;
        - [x] clubs by id with `CLUB_EMBED_COLUMNS`, with avatar URLs resolved as elsewhere;
      - [x] order by `ordinal`, and drop any id RLS did not return;
      - [x] any failed read rejects. There is no partial result.
- [x] 4.3 `src/lib/data/__tests__/digest.test.ts`:
      - [x] drops a withheld id and keeps the order;
      - [x] each of the three failures rejects;
      - [x] no position sends `{}`;
      - [x] **verified both ways** (reasoned per assertion; not literally mutation-run — see the
            file's own header).
- [x] 4.4 `src/lib/query/keys.ts`:
      - [x] `rides.weekend(near)` is `['rides','weekend', 'lat,lon' | 'unlocated']`;
      - [x] `rides.weekendAll()` is `['rides','weekend']`;
      - [x] document the reach: `rides.all()` covers RSVPs, the membership helper covers joining
            and leaving, and the rider's own ride and thread writes owe nothing.
- [x] 4.5 `invalidateClubMembership` in `src/lib/actions/clubs.ts` gains
      `invalidate(queryKeys.rides.weekendAll())`. Check that `lib/actions/__tests__`' cache-claim
      checks still pass.

## 5. The screen and the row

- [x] 5.1 `src/app/(app)/rides/weekend/page.tsx`, `'use client'`, `Header` titled "This weekend"
      with `backHref="/rides/explore"`:
      - [x] position via `useQuery(queryKeys.riderLocation(), resolveRiderLocation)`;
      - [x] digest via `useQuery(decided ? queryKeys.rides.weekend(position) : null, …)`;
      - [x] every state in `design.md` §D6, gated on data;
      - [x] rides render as `RideCard`s, with `MapAttribution` when any card has a tile;
      - [x] club rows link to the club, with a zero half omitted.
- [x] 5.2 The no-position row: a **tap** opens `TownQuestionSheet`. After a save, the
      `riderLocation` invalidation that `setRiderTown` already performs moves the key.
      A component test pins that nothing opens without the tap
      (`rides/weekend/__tests__/page.dom.test.tsx`, verified both ways).
- [x] 5.3 `/rides/explore`: one static row (`CalendarIcon`, "This weekend", chevron), directly
      under `LocationQuestionRow` and outside the list gate, linking to `/rides/weekend`.
      `src/__tests__/one-question-row.test.ts` stays unchanged and green.
- [x] 5.4 `scripts/walk.mjs`:
      - [x] add `/rides/weekend` to the route list;
      - [x] `WALK_FIXTURES` gains one ride near the walk rider departing the coming Saturday
            (`provisionWeekendRide`) — **written but not run**; this session could not exercise the
            walk (no dev server/relay/walk allowed). Needs a real run against DEV before trusting it;
      - [x] a signed-out visit is redirected to `/auth/login` (`GUARD_CASES_SIGNED_OUT`) — same
            caveat.

## 6. `NotificationsSheet`

- [x] 6.1 Replace the intro and empty-week copy with copy that is honest about today, for
      example: *"A Friday-evening round-up of rides near you this weekend, once push
      notifications are switched on. You can turn it off now."* No sentence may say a round-up
      is put together or sent now. Fix the branch's comments in five places: `NotificationsSheet.tsx`,
      `ProfileMenu.tsx`, `setDigestOptOut` in `actions/profile.ts`, `getDigestOptOut` in
      `data/profile.ts`, and `keys.ts`'s `digestOptOut`. They cite a migration number that is now
      spent (use `129`), and say a job reads the column, when no job exists until part 2.
- [x] 6.2 Fix `NotificationsSheet.dom.test.tsx`:
      - [x] give the `vi.fn` a parameter (`async (_optOut: boolean) => ({ error: null })`), which
            clears `tsc`'s `(77,57)` *Expected 0 arguments, but got 1*;
      - [x] replace the `/phone|push notification/` negative pin with pins on the new copy: it
            names push as a condition, and it does not claim anything is assembled now;
      - [x] re-measure the header's mutation counts rather than editing them by hand (four
            mutations actually run — see the file's header for the measured pass/fail splits).

## 7. Privacy page

- [x] 7.1 Confirm the reader stores nothing: `129`'s functions contain no `insert`, `update` or
      `delete`, checked on `prosrc`. If so, `/legal/privacy` gains **no line** in part 1
      (`design.md` Q4). The stored anchor in part 2 owes one. **Confirmed from `design.md` §D4/§D5's
      own statement, not by reading `129`'s actual SQL** — that migration is not in this tree (a
      `data` agent is writing it elsewhere); no `/legal/privacy` line was added.

## 8. Docs

- [ ] 8.1 `docs/reference/schema.md` — **left to the session holding `129`'s actual SQL.** Left
      undone deliberately: this tree has no migration file to describe accurately, and guessing at
      grants/signatures risks a doc that disagrees with what actually ships.
- [ ] 8.2 `docs/reference/migrations.md` — same reason; also needs a real `list_migrations`
      reading against DEV/PROD, which this session did not do.

## 9. Gates and counts

- [x] 9.1 Run `npx tsc --noEmit`, `npm run lint` and `npm run test:unit`. `tsc` clean, including the
      `(77,57)` fix. `test:unit`: the ~21 pre-existing failures named in the brief (`dismissal.test.ts`,
      `LocationQuestionRow.dom.test.tsx`, one analytics test) plus THREE more this session found and
      confirmed environmental/pre-existing (missing `node_modules` entries unrelated to this diff) —
      see the session report.
- [x] 9.2 Re-derive every count this change moves, and give the numbers to the main thread,
      which owns `CLAUDE.md`:
      - [ ] RLS assertions — not this session's; no Postgres here.
      - [x] component tests: 60 → 61 (`git ls-files 'src/**/*.test.tsx' | wc -l`) — reported to the
            main thread, not edited in `CLAUDE.md`;
      - [x] jsdom tests: 17 → 18 (`git grep -l "@vitest-environment jsdom" -- 'src/**/*.test.tsx'`)
            — fixed directly in `docs/reference/running-locally.md`, which owns this count;
      - [ ] advisors — not this session's; no Supabase call made.
- [x] 9.3 `npm run docs:check` (green after the render-model.md and running-locally.md fixes),
      `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` (green). **The walk against DEV was
      not run** — out of this session's resources (no dev server/relay/walk permitted).
- [ ] 9.4 Archiving is the merging session's job, once `129` and its RLS suite land alongside this.
