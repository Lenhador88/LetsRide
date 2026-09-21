# Tasks — add-club-timeline (PD-299 #4)

**There is no migration in this change.** `openspec/config.yaml`'s tasks rule pairs new RLS
assertions with migrations, so §6 is client assertions instead — and §6.1 is the one that carries
the whole correctness of the change. The rename in §1 goes first, before any new file takes the
name it frees.

> **Built 2026-08-31.** Two tasks resolved differently from what is written below, and both
> are recorded in `design.md` §Two places the build deviates from this document rather than
> edited away here: **1.1's rename became a deletion** (`clubTimeline.ts` has no caller once a
> real timeline exists), and the **source bounds and display cap** differ from §D7's, which is
> what makes the coherence horizon inert at the numbers that ship.

## 0. Pre-flight — resolve before writing code

- [ ] 0.1 Re-read **PD-299**, body **and** comments. Read on 2026-08-31: status `Needs decision`,
  one comment (2026-08-27) closing question 1 and confirming #2–#5 stay on the epic. **There is no
  sub-issue for #4 yet** — opening one, with the five-rating block, is the main thread's, not this
  change's.
- [ ] 0.2 Re-derive the four source policies rather than trusting `proposal.md`'s table. Any
  change to one of them reopens the decision it supports:
  ```sql
  select tablename, policyname, qual from pg_policies
   where schemaname='public' and cmd='SELECT'
     and tablename in ('postcards','rides','club_threads','club_members');
  ```
  Measured on DEV 2026-08-31 — the two that decide §D2 are `club_members`' public-club disjunct
  (`EXISTS (select 1 from clubs c where c.id = club_id and c.is_public)`) and `club_threads`'
  bare `private.is_club_member(club_id)` with no such disjunct.
- [ ] 0.3 Confirm `joined_at` is still server-owned. If it appears in an INSERT or UPDATE grant,
  the "cannot be forged" requirement is false and this change needs a migration after all:
  ```sql
  select privilege_type, string_agg(column_name, ', ' order by column_name)
    from information_schema.column_privileges
   where table_schema='public' and table_name='club_members' and grantee='authenticated'
   group by 1;   -- expect INSERT/UPDATE without joined_at
  ```
- [ ] 0.4 Confirm `public.club_unread_counts` still counts postcards + rides and **not** threads
  or joins (`select prosrc from pg_proc …`). The `client-cache-invalidation` delta's stated
  divergence depends on it.
- [ ] 0.5 Read the frame before drawing anything. It is offline and cannot be rate limited:
  `npm run figma -- tree "Private club - Timeline"`, then `--all` for the layers Figma has toggled
  off. **Do not call the Figma API.**
- [ ] 0.6 Answer **Q1 in `design.md`** — thread entries placed by creation or by last message. It
  is the one blocking question and its other answer makes this change a migration.

## 1. The rename — its own commit, before anything else

- [ ] 1.1 `git mv src/components/clubs/clubTimeline.ts src/components/clubs/clubRideStrip.ts`.
  Rename `clubTimelineRides` → `clubRideStripRides`, `CLUB_TIMELINE_RIDES` →
  `CLUB_RIDE_STRIP_RIDES`, `CLUB_TIMELINE_PAST_MIN` → `CLUB_RIDE_STRIP_PAST_MIN`. Update the
  docstrings: they describe the ride strip and say "Timeline" for a sub-page that no longer
  exists.
- [ ] 1.2 Move its unit test with it and keep every case. The four slice behaviours it covers are
  unchanged by this story.
- [ ] 1.3 `npx tsc --noEmit && npm run lint && npm run test:unit` green on the rename alone.

## 2. Data — two reads, two keys, no migration

- [ ] 2.1 `getClubRecentJoins(clubId)` in `src/lib/data/clubs.ts` — `club_members` with the
  `PUBLIC_PROFILE_COLUMNS` embed, `.eq('club_id', …)`, `.order('joined_at', {ascending:false})`,
  its own bound. **Drop rows whose profile embed is absent**, exactly as `getClubMembers` does,
  and carry that rule's comment across. `clubIdSchema` guard before `resolveSupabase()`, per
  PD-142.
- [ ] 2.2 `getClubRecentRides(clubId)` — `rides` ordered `created_at DESC`, own bound. Write down
  at the site **why this is not `getRides({kind:'club'})`**: that function windows and orders on
  `departure_at`, so its rows are not the rows ordered by creation, and the two disagree for any
  ride announced long before it departs. `rides_club_id_created_at_idx` already covers it.
- [ ] 2.3 Neither function restates a membership, block, hide or club-visibility predicate.
  Assert this by reading the diff, and say so in each docstring the way `getClubThreads` does.
- [ ] 2.4 Two keys in `src/lib/query/keys.ts`, both children of `clubs.detail(clubId)`, each with
  the docstring that file's convention requires. No key for the merged stream.
- [ ] 2.5 Types in `src/types/index.ts` — a discriminated `ClubTimelineEntry` over the five kinds
  (`postcard`, `ride`, `thread`, `join`, `club-created`). Never inline.

## 3. The merge — the pure function, and the only place the horizon lives

- [ ] 3.1 `src/components/clubs/clubTimeline.ts` (the freed name) — `mergeClubTimeline`, pure,
  taking the source lists plus the club and returning `{ entries, complete }`.
- [ ] 3.2 Implement exactly `design.md` §D7: saturation per source, horizon =
  **max** of the saturated sources' oldest timestamps, `ts DESC` then `id DESC`, display cap, and
  the club-creation entry **only** when `complete`.
- [ ] 3.3 A source that **failed** is treated as saturated at the newest timestamp it could have
  returned, per the `client-render-shell` delta's partial-state requirement. This is the branch a
  build most easily omits, because a failed read looks like an empty one.
- [ ] 3.4 Docstring says, in one sentence, why this is pure and not three lines in the page —
  `clubRideStripRides`' own header is the model.

## 4. The screen

- [ ] 4.1 Re-lay `src/app/(app)/clubs/detail/page.tsx` into the four bands: identity (type line,
  location, description, Members rail), upcoming-rides strip, action layer, timeline. Update the
  docstring — it records the 2026-08-18 merge and must now record what this supersedes and what it
  keeps (no sub-page switcher, 96px header, `/members` and `/rides` retained).
- [ ] 4.2 `ClubActionLayer` — Plan a ride, Add a postcard, Threads. **Member-only in its
  entirety**; a non-member gets `ClubMembershipButton` in its place. The Threads tile carries the
  aggregate unread mark derived from the map the screen already reads.
- [ ] 4.3 `ClubEventRow` — 28px avatar, one `Poppins/14/Regular` sentence, `Time Since` in
  `Poppins/12/Regular`, `Grey/10` fill. Measured from the frame; use `formatRelativeTime`, which
  takes no zone because it measures elapsed instants.
- [ ] 4.4 The dividers are the frame's: 16px between an events group and a postcard, 8px between
  consecutive events.
- [ ] 4.5 Re-point `ClubPostcardCarousel` and `ClubThreadsSection` rather than deleting them.
  `ClubThreadsSection`'s non-member docstring is the source of the generalised rule and its
  reasoning moves to the timeline rather than being lost.
- [ ] 4.6 The handoff row, in the incomplete state only: `See all postcards`, `All rides`,
  `All threads`, `All members`. No infinite scroll, no "load more".
- [ ] 4.7 **`ClubPreviewScreen` is untouched.** Verify the timeline component is not imported into
  that branch at all, rather than gated inside it.
- [ ] 4.8 Icons from `@/components/icons/generated`. Primary buttons are near-black `Grey/100`,
  never green.

## 5. Invalidation

- [ ] 5.1 Each action-layer write invalidates every key its rows appear under, per the
  `client-cache-invalidation` delta — including the two new ones.
- [ ] 5.2 Add a comment at `getClubRecentJoins` and beside `unreadByClub` naming the other's
  predicate, so the badge/timeline divergence is stated at both ends.
- [ ] 5.3 Confirm `MarkClubSeen` is unchanged and that nothing reads `feed_reads.last_seen_at`.
  A "new since" divider is a stated non-goal; half-building it is the failure mode.

## 6. Tests — client, because there is no migration

- [ ] 6.1 **Unit tests for `mergeClubTimeline`, and this is the gate.** One case each for: the
  horizon being the **later** of two saturated sources' oldest rows; an unsaturated source
  imposing none; the `id` tiebreak on a shared instant; the creation entry present in the
  complete state and **absent** in the truncated one; a failed source treated as saturated; the
  display cap. **Verify each both ways** per `CLAUDE.md` §Working Principles — swap `max` for
  `min` and confirm the horizon cases fail, since a `min` implementation renders plausibly
  against any small fixture.
- [ ] 6.2 A component test for the non-member branch: assert that **no source read is issued** and
  that no entry, count or empty-state sentence is rendered. Assert the ABSENCE, on
  `RideInviteJoin`'s precedent — the defect here is a stream that renders, so an assertion that
  something renders cannot see it.
- [ ] 6.3 A component test that every destination keeps an entrance in the shortest-stream state
  and in the complete-tail state — PD-125's defect is a screen nobody can reach, and this change
  removes four `See all` links.
- [ ] 6.4 `npm run walk` reaches `/clubs/detail` already; confirm it still renders and that the
  new route entrances are discovered. `WALK_FIXTURES=1` creates the club the detail route needs.
- [ ] 6.5 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 6.6 `npm run docs:check` after §7, since two documentation claims move.

## 7. Documentation

- [ ] 7.1 `docs/FIGMA-FIDELITY-TODO.md` §Club detail — replace the *"Timeline's activity feed is
  not built"* entry. It is now built for joins, ride creations, thread starts and postcards, and
  its two remaining gaps are named: **"went on a ride"** (drawn in the frame, not built) and
  **"a rider left"** (no row, never buildable under this design). Add the three compositions that
  are ours because the frame predates them — the identity band at the top, the action layer, and
  the thread event — plus the two deviations that are the product owner's.
- [ ] 7.2 `docs/reference/product-scope.md` Clubs row — *"the Timeline's activity feed (no table
  behind joins/leaves)"* is no longer accurate. It closes for joins, and leaves are a stated
  non-goal rather than an unbuilt half.
- [ ] 7.3 Do **not** edit `CLAUDE.md` or `docs/HANDOFF.md` from an agent; the main thread owns
  both.
