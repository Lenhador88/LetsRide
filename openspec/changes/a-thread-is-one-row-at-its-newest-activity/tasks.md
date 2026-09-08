# Tasks

Order matters in one place only: **`116` is migration-first** — additive, and the client reads the
column. Apply to DEV, confirm the build serving, then the client work. Nothing here is
deploy-first, and no destructive step exists.

## 1. Migration `116` — the activity column

- [ ] 1.1 `supabase/migrations/116_a_thread_sits_at_its_newest_activity.sql`. Header states the
      decision (owner, 2026-09-07: newest activity, not creation date), and why the trigger is
      `security definer` — `design.md` §D2, the failure being a total loss of the reply path rather
      than a skipped bump.
- [ ] 1.2 `alter table public.club_threads add column last_activity_at timestamptz not null default now()`,
      same on `public.ride_threads`. The default is a placeholder for the row-creation path only —
      1.4's trigger and 1.5's backfill are what make it correct — and the column comment says so.
- [ ] 1.3 **Do not add a SELECT grant.** Measured: both tables carry a *table-level* SELECT grant to
      `authenticated`, so the new column is readable on creation. Adding one is redundant, not
      wrong, but it would teach the next reader the `097` shape, which does not apply here.
      Verify rather than trust: `has_column_privilege('authenticated', 'public.club_threads', 'last_activity_at', 'SELECT')`.
- [ ] 1.4 `private.bump_thread_activity()` — `security definer`, owner `postgres`, pinned
      `search_path`, `AFTER INSERT FOR EACH ROW` on `public.club_messages` and on
      `public.ride_thread_messages` (one function per table, or one parameterised by `TG_ARGV`;
      whichever, each updates exactly one row by `new.thread_id` and exactly one column).
      Body: `set last_activity_at = greatest(last_activity_at, new.created_at)`.
- [ ] 1.5 Backfill both tables from each thread's newest message, in the same file:
      `update … set last_activity_at = greatest(t.created_at, m.newest)` from a grouped subquery,
      leaving threads with no messages at their `created_at`.
- [ ] 1.6 Indexes: `(club_id, last_activity_at desc, id desc)` on `club_threads` and
      `(ride_id, last_activity_at desc, id desc)` on `ride_threads` — the thread source's ordering
      and its paging bound both use them.
- [ ] 1.7 **Do not** add an UPDATE grant, an UPDATE policy, or any DELETE-side recompute. Do not
      touch `081` or `108`.
- [ ] 1.8 Apply to DEV. Read the security advisors afterwards and account for the new
      `security definer` function against the existing per-migration accounting — the local suite
      runs on plain Postgres and cannot see it.

## 2. RLS assertions — paired with task 1, per `openspec/config.yaml`

- [ ] 2.1 `authenticated` holds no INSERT and no UPDATE on `last_activity_at`, both tables.
      **Grantee-scoped** (`has_column_privilege` under a savepoint, or a grantee-filtered
      `information_schema.column_privileges` count) — never a bare call, since the suite runs as the
      table owner for whom no barrier exists.
- [ ] 2.2 Neither thread table has an UPDATE policy. Assert the absence, so a later change that adds
      one has to confront this.
- [ ] 2.3 A member's / crew member's message insert advances the parent thread's
      `last_activity_at` — the definer function works under the caller's own privileges.
- [ ] 2.4 A message carrying a `created_at` older than the thread's current value leaves it
      unchanged (`greatest`).
- [ ] 2.5 A message insert refused by the participation gate leaves the column unchanged and aborts
      the statement.
- [ ] 2.6 Deleting a message does **not** change `last_activity_at`.
- [ ] 2.7 An announcement thread (`introduces_user_id is not null`) is stamped like any other — the
      trigger does not special-case the marker.
- [ ] 2.8 `081` and `108` still refuse a non-member / non-crew rider zero rows, and a blocked rider
      in both directions, with the column present. `anon` still holds nothing on either table.
- [ ] 2.9 `PGPASSWORD=postgres npm test` green before any task here is claimed complete. Compare
      **label sets** against the previous run, not counts.

## 3. Types and the two data modules

- [ ] 3.1 `last_activity_at` onto `ClubThreadListItem` and `RideThreadListItem` in
      `src/types/index.ts`; add it to `THREAD_SELECT` and `TIMELINE_THREAD_SELECT`. **Keep
      `created_at` selected** — `resolveThreadCount` needs it (`design.md` §D7).
- [ ] 3.2 `getClubThreads`: order `last_activity_at desc, id desc`; the `until` bound becomes
      `.lte('last_activity_at', until)`. The announcement filter stays in the query, unchanged.
- [ ] 3.3 `getRideThreadCreations`: same ordering change; `boundedHorizon` reads
      `row.last_activity_at`.
- [ ] 3.4 Both timelines' thread-source horizons are measured on `last_activity_at`. Ordering
      column, bound column and horizon column are one column — the requirement, not a preference.
- [ ] 3.5 Remove the `reply` arm from `ClubTimelineEvent` and `RideTimelineEvent`, and stop building
      reply entries in both merges. `grep -n "kind: 'reply'" src/lib/data/club-timeline.ts src/lib/data/ride-timeline.ts` → 0.
- [ ] 3.6 Remove the reply source's horizon from both merges' horizon lists. Keep the reply **read**
      and keep its horizon feeding `resolveThreadCount`.
- [ ] 3.7 `resolveThreadCount` keeps comparing the thread's `created_at` against the reply horizon.
      Add a test that fails if `last_activity_at` is substituted — a bumped old thread must render a
      floor, not an exact total.
- [ ] 3.8 The ride gains per-thread reply counts and the `partial` flag from its collapse. The
      horizon stays measured on the message **window**, before the collapse.

## 4. `absorbClubTimelineWindow` — the correctness fix

- [ ] 4.1 De-duplicate by row identity: drop any accumulated row whose id the incoming window
      supplies, regardless of interval, before concatenating. `design.md` §D4.
- [ ] 4.2 Unit test the **duplicate**: a thread held in a deep window, bumped above the first
      window's horizon, with the first window refetched — one row out, at the new position. The test
      must fail against today's interval-only rule.
- [ ] 4.3 Unit test the **loss**: a thread below the first window's horizon that bumps above it
      before a deeper window is fetched is present once the first window refetches.
- [ ] 4.4 Assert no two merged entries share a key, on both timelines.

## 5. The two row components

- [ ] 5.1 `ClubTimelineThreadRow` now takes a thread entry only. `anchorKey` is `thread:<id>`,
      `clubThreadFromTimeline` round-trips it, and the anchor hunt still lands (PD-366).
- [ ] 5.2 `RideTimelineThreadRow` gains the comment glyph, the count and the `partial` treatment.
      Rewrite its header: the paragraph explaining why it has no count is being answered, not
      deleted — say what now makes the number safe.
- [ ] 5.3 `groupClubTimeline` / `groupRideTimeline`: the `thread` group no longer needs the
      `'thread' | 'reply'` union.
- [ ] 5.4 A stale `reply:<message id>` fragment stays an ordinary no-op — no throw, no error state,
      no report. Assert it.

## 6. Cache claims

- [ ] 6.1 `invalidateThreadMessage` in both `src/lib/actions/club-threads.ts` and
      `src/lib/actions/ride-threads.ts` also invalidates `clubs.threads(clubId)` /
      `rides.threads(rideId)`. Update each function's header — it currently explains why the reply
      key is the one that matters, and that reason has changed.
- [ ] 6.2 The action-module test that reads each writer's cache claim covers the thread-source key.

## 7. Gates

- [ ] 7.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 7.2 `npx vitest run src/lib/data/__tests__/club-timeline.test.ts src/lib/data/__tests__/ride-timeline.test.ts`.
- [ ] 7.3 `PGPASSWORD=postgres npm test`.
- [ ] 7.4 The walk against DEV: a thread created then replied to draws **one** row on the club detail
      and one on the ride detail, carrying the comment glyph and its count, positioned at the reply.
- [ ] 7.5 `npm run db:drift` — repo, DEV and PROD reconciled; `116` recorded in
      `docs/reference/migrations.md` §Applied state by the session that applies it.

## 8. Archive

- [ ] 8.1 `/opsx:archive` this change at the wrap-up of the session that ships it, or say in the PR
      body why it stays open.
