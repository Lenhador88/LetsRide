# Tasks — the weekend digest, part 1

Specs: `specs/weekly-digest/spec.md`, `specs/database-enforced-integrity/spec.md` and
`specs/analytics-consent/spec.md`. `design.md` has the content rule (§D3), the body (§D4) and the
negative-case list the suite maps onto.

**The order matters in one place.** `129` applies to DEV before this branch's bundle can serve,
and to PROD before the promotion merges. The branch already calls `my_digest_opt_out` and
`set_digest_opt_out`.

## 1. `129` — the additive migration

- [ ] 1.1 Take the number off DEV's `list_migrations` when the file is written. It was `128` on
      2026-09-22, with 131 rows, 128 files and 3 long-standing file-less rows. Count the
      file-less rows, not the gap.
- [ ] 1.2 Add `profiles.digest_opt_out_at timestamptz`: nullable, no default, no backfill, with a
      column comment saying it is a preference, not a gate, and that nothing reads it until
      part 2. **No `grant` and no `revoke` on `public.profiles`.** The file says which of `025`'s
      three lists the column joins (none) and names the accessor.
- [ ] 1.3 Add `public.my_digest_opt_out()` and `public.set_digest_opt_out(p_opt_out boolean)`,
      following `096`'s pair verbatim:
      - [ ] `true` gives `coalesce(existing, now())`, and `false` gives NULL;
      - [ ] each returns the effective value;
      - [ ] no profile row gives `P0002`, and no session gives `42501`;
      - [ ] grants: `revoke all … from public, anon` and `grant execute … to authenticated`.
- [ ] 1.4 Add `private.weekend_digest_for(candidate uuid, at timestamptz, near_lat double
      precision, near_lon double precision)` per `design.md` §D3 and §D4:
      - [ ] `security definer`, `stable`, `search_path = ''`;
      - [ ] return columns `(section text, ordinal integer, ride_id uuid, club_id uuid, new_rides
            integer, new_threads integer)`;
      - [ ] a NULL candidate returns zero rows;
      - [ ] position: both NULL means no position; one NULL or out of range raises `22023`;
            otherwise round to 2 dp;
      - [ ] the 8-day `departure_at` prefilter;
      - [ ] haversine with 6371.0088 and `<= 100`;
      - [ ] **no comment inside the body names** `auth.uid`, `rides_from` or `digest_opt_out_at`
            (the comment trap: `§129.6` strips `--` comments, but keep the body clean anyway);
      - [ ] `revoke all … from public, anon, authenticated, service_role`.
- [ ] 1.5 Add `public.my_weekend_digest(near_lat double precision default null, near_lon double
      precision default null)`:
      - [ ] same return shape; `security definer`; `search_path = ''`;
      - [ ] the body is exactly `select * from private.weekend_digest_for((select auth.uid()),
            pg_catalog.now(), near_lat, near_lon)`;
      - [ ] grants: `revoke all … from public, anon` and `grant execute … to authenticated`.
- [ ] 1.6 Header: additive, migration-first, and the reason. Include the definer justification
      for each of the four functions, and the note that no table, trigger, policy or table grant
      moves.

## 2. RLS suite `§129`

Each item is one labelled assertion or more. The numbers follow `design.md` §Roles and negative
cases.

- [ ] 2.1 `129.1`:
      - [ ] `has_column_privilege('authenticated', 'public.profiles', 'digest_opt_out_at', …)` is
            false for select, insert and update;
      - [ ] `096.1`'s widths still read 10/8/8.
- [ ] 2.2 `129.2`:
      - [ ] identity args are `''` and `'p_opt_out boolean'`;
      - [ ] setting twice keeps the first stamp;
      - [ ] `false` clears it.
- [ ] 2.3 `129.3`: each opt-out leaves the other unchanged, as two assertions, one per direction.
- [ ] 2.4 `129.4` and `129.5`, both grantee-scoped `has_function_privilege`:
      - [ ] `anon` has no EXECUTE on the three public RPCs;
      - [ ] `authenticated`, `anon` and `service_role` have none on the private body.
- [ ] 2.5 `129.6`:
      - [ ] the body's comment-stripped `prosrc` matches none of `auth\.uid\(`,
            `private\.is_club_member\(`, `private\.is_ride_crew\(`, `\mrides_from\M` or
            `\mdigest_opt_out_at\M`;
      - [ ] the wrapper's `prosrc` **equals** the delegation;
      - [ ] **verified both ways** against a scratch body that names `rides_from`.
- [ ] 2.6 Build the fixture: a small world with one timestamp, pinning `at` to a known Wednesday.
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
- [ ] 2.7 `129.7` to `129.16`, and `129.18`, against that fixture, calling
      `private.weekend_digest_for` as the owner with each candidate. Blocks are asserted with the row in each direction.
      **Mutation-test** the block conjuncts and the membership gate in a scratch copy: each
      assertion must go red, then revert.
- [ ] 2.8 `129.19`: an opted-out rider and a twin who is not opted out get identical rows.
- [ ] 2.9 `129.17`: a NULL candidate returns zero rows, and one-NULL and `NaN` positions raise
      `22023`.
- [ ] 2.10 The participation-gate totals stay **23**. Re-derive them with the count query in
      `docs/reference/schema.md` §The participation gate. No new gated table.
- [ ] 2.11 `npm test` is green, and the new labels are listed in the PR.

## 3. DEV — the hand-exercise gate, then apply

- [ ] 3.1 On DEV, as `authenticated`, in one **rolled-back** transaction (`set local role
      authenticated` plus `request.jwt.claims`):
      - [ ] call `my_weekend_digest` with a position and without one;
      - [ ] call `set_digest_opt_out(true)` twice, then `false`, then `my_digest_opt_out()`;
      - [ ] confirm `analytics_opt_out_at` did not move;
      - [ ] confirm `select digest_opt_out_at from profiles` answers `42501`.
- [ ] 3.2 Apply `129` to DEV. Read `list_migrations` back.
- [ ] 3.3 `get_advisors(security)` shows exactly **+3** `authenticated_security_definer_function_executable`
      WARNs (the three public functions) and no new class. Record them in
      `docs/reference/migrations.md` §Security advisors.

## 4. Data layer

- [ ] 4.1 Types in `src/types/index.ts`:
      - [ ] `WeekendDigest = { rides: RideListItem[]; clubs: WeekendDigestClub[] }`;
      - [ ] `WeekendDigestClub = { club: EmbeddedClub; newRides: number; newThreads: number }`.
      Reuse existing shapes rather than inventing new ones.
- [ ] 4.2 `src/lib/data/digest.ts`, `getWeekendDigest(near: RiderPosition | null)`:
      - [ ] `rpc('my_weekend_digest', near ? { near_lat, near_lon } : {})`;
      - [ ] then, in parallel:
        - [ ] rides by id with `RIDE_SELECT`, through `toRideListItem`, `withRideDistance` and
              `resolveRideMapUrls`;
        - [ ] clubs by id with `CLUB_EMBED_COLUMNS`, with avatar URLs resolved as elsewhere;
      - [ ] order by `ordinal`, and drop any id RLS did not return;
      - [ ] any failed read rejects. There is no partial result.
- [ ] 4.3 `src/lib/data/__tests__/digest.test.ts`:
      - [ ] drops a withheld id and keeps the order;
      - [ ] each of the three failures rejects;
      - [ ] no position sends `{}`;
      - [ ] **verified both ways**.
- [ ] 4.4 `src/lib/query/keys.ts`:
      - [ ] `rides.weekend(near)` is `['rides','weekend', 'lat,lon' | 'unlocated']`;
      - [ ] `rides.weekendAll()` is `['rides','weekend']`;
      - [ ] document the reach: `rides.all()` covers RSVPs, the membership helper covers joining
            and leaving, and the rider's own ride and thread writes owe nothing.
- [ ] 4.5 `invalidateClubMembership` in `src/lib/actions/clubs.ts` gains
      `invalidate(queryKeys.rides.weekendAll())`. Check that `lib/actions/__tests__`' cache-claim
      checks still pass.

## 5. The screen and the row

- [ ] 5.1 `src/app/(app)/rides/weekend/page.tsx`, `'use client'`, `Header` titled "This weekend"
      with `backHref="/rides/explore"`:
      - [ ] position via `useQuery(queryKeys.riderLocation(), resolveRiderLocation)`;
      - [ ] digest via `useQuery(decided ? queryKeys.rides.weekend(position) : null, …)`;
      - [ ] every state in `design.md` §D6, gated on data;
      - [ ] rides render as `RideCard`s, with `MapAttribution` when any card has a tile;
      - [ ] club rows link to the club, with a zero half omitted.
- [ ] 5.2 The no-position row: a **tap** opens `TownQuestionSheet`. After a save, the
      `riderLocation` invalidation that `setRiderTown` already performs moves the key.
      A component test pins that nothing opens without the tap.
- [ ] 5.3 `/rides/explore`: one static row (`CalendarIcon`, "This weekend", chevron), directly
      under `LocationQuestionRow` and outside the list gate, linking to `/rides/weekend`.
      `src/__tests__/one-question-row.test.ts` stays unchanged and green.
- [ ] 5.4 `scripts/walk.mjs`:
      - [ ] add `/rides/weekend` to the route list;
      - [ ] `WALK_FIXTURES` gains one ride near the walk rider departing the coming Saturday;
      - [ ] a signed-out visit is redirected to `/auth/login`.

## 6. `NotificationsSheet`

- [ ] 6.1 Replace the intro and empty-week copy with copy that is honest about today, for
      example: *"A Friday-evening round-up of rides near you this weekend, once push
      notifications are switched on. You can turn it off now."* No sentence may say a round-up
      is put together or sent now. Fix the branch's comments in five places: `NotificationsSheet.tsx`,
      `ProfileMenu.tsx`, `setDigestOptOut` in `actions/profile.ts`, `getDigestOptOut` in
      `data/profile.ts`, and `keys.ts`'s `digestOptOut`. They cite a migration number that is now
      spent (use `129`), and say a job reads the column, when no job exists until part 2.
- [ ] 6.2 Fix `NotificationsSheet.dom.test.tsx`:
      - [ ] give the `vi.fn` a parameter (`async (_optOut: boolean) => ({ error: null })`), which
            clears `tsc`'s `(77,57)` *Expected 0 arguments, but got 1*;
      - [ ] replace the `/phone|push notification/` negative pin with pins on the new copy: it
            names push as a condition, and it does not claim anything is assembled now;
      - [ ] re-measure the header's mutation counts rather than editing them by hand.

## 7. Privacy page

- [ ] 7.1 Confirm the reader stores nothing: `129`'s functions contain no `insert`, `update` or
      `delete`, checked on `prosrc`. If so, `/legal/privacy` gains **no line** in part 1
      (`design.md` Q4). The stored anchor in part 2 owes one.

## 8. Docs

- [ ] 8.1 `docs/reference/schema.md`:
      - [ ] add `digest_opt_out_at` to the `profiles` row, with no grant and its accessors;
      - [ ] the four functions, their grants, and the ids-only reader shape with its reason.
- [ ] 8.2 `docs/reference/migrations.md`:
      - [ ] `129`'s applied-state entry per project, in apply order;
      - [ ] migration-first, and why;
      - [ ] the advisor delta.

## 9. Gates and counts

- [ ] 9.1 Run `npx tsc --noEmit`, `npm run lint` and `npm run test:unit`. `tsc` must be clean,
      including the `(77,57)` fix.
- [ ] 9.2 Re-derive every count this change moves, and give the numbers to the main thread,
      which owns `CLAUDE.md`:
      - [ ] RLS assertions: `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`;
      - [ ] component tests: `git ls-files 'src/**/*.test.tsx' | wc -l`;
      - [ ] jsdom tests: `git grep -l "@vitest-environment jsdom" -- 'src/**/*.test.tsx'`;
      - [ ] advisors.
- [ ] 9.3 `npm run docs:check`, `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs`, and
      the walk against DEV.
- [ ] 9.4 Archive this change with `/opsx:archive` at the wrap-up of the session that merges it,
      and only with the RLS suite green. `129` goes to PROD ahead of the promotion PR, per
      `docs/ENVIRONMENTS.md` §Migrations.
