# Design — a thread is one row, at its newest activity

Everything below is measured against `letsride-dev` (`fpmrimzxadewsaiwpsel`) and the tree at
`origin/development` on **2026-09-08**, and each claim carries the command that re-derives it.

## D0 — Seven existing changes were checked. None owns this.

The repo has 44 open changes against 7 archived, so a duplicate is the expensive failure mode. Each
candidate was read, not merely listed:

| Change | What it owns | Why it is not this |
|---|---|---|
| `add-club-timeline` | The stream, its five sources, the coherence horizon, the `thread` and `reply` event kinds | **It is what creates the two rows.** This change removes one of the kinds it added, but the requirement it would edit (§*The stream SHALL be totally ordered…*) is already MODIFIED by two other open changes |
| `club-timeline-engagement` | The wave, the comment glyph, `ClubThreadActivity` (count, faces, `partial`) | Supplies the count this change moves onto one row. Says nothing about position |
| `page-the-club-timeline-on-scroll` | Paging by lowering the horizon; `absorbClubTimelineWindow`; `resolveThreadCount` | The closest of the seven, and the one this change **breaks** — see §D4. It assumes a row's position is immutable |
| `add-club-threads` | `club_threads` / `club_messages`, `081`, `082` | Schema and policies. No sort key for activity |
| `notify-a-club-thread` | `098`'s reply fan-out | A notification, not a position. Its trigger on `club_messages` is a sibling of this change's, not a substitute |
| `retire-ride-chat-for-ride-threads` | `ride_threads`, `108`, and the ride timeline's two thread sources | §*A thread SHALL appear on the ride's timeline…* mandates **two** sources each contributing a row. That requirement is MODIFIED by this change |
| `an-introduction-appears-only-as-its-announcement` | PD-372's announcement exclusion, in the query | Supplies the exclusion this change must not break. See §D5 |

```bash
grep -rl "last_activity_at" openspec/changes/ openspec/specs/   # 0 before this change
```

## D1 — The migration number is `116`, and the issue body says `115`

The body predicted `115`; `115_a_stranger_sees_the_ride` took it between the issue being written and
this proposal. Checked in **both** directions, per `CLAUDE.md` §Working Principles:

```bash
ls supabase/migrations/*.sql | wc -l     # 115
ls supabase/migrations/ | tail -1        # 115_a_stranger_sees_the_ride.sql
```

`list_migrations fpmrimzxadewsaiwpsel` — newest row `a_stranger_sees_the_ride`. PROD
(`zwprydcyryvudhurbnye`) sits at `112` per `CLAUDE.md`, and was **not** re-measured here because
nothing in this change depends on the answer beyond the promotion order, which is the merging
session's. No row is applied anywhere without a file behind it in the `113`–`116` range, so `116` is
free.

## D2 — The trigger MUST be `security definer`, and this is the finding that turns a silent no-op into a broken write path

Measured, and it is not what a reader assumes:

```sql
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema='public' and table_name in ('club_threads','ride_threads')
   and grantee in ('authenticated','anon');
-- club_threads: authenticated DELETE, authenticated SELECT
-- ride_threads: authenticated SELECT
-- anon: nothing, on either table
```

Three consequences, in order of how easy each is to get wrong:

1. **SELECT is table-wide, so the new column is readable with no extra grant.** `club_threads`'
   INSERT is column-scoped (`author_id, club_id, id, title`) and `ride_threads`' likewise
   (`author_id, id, ride_id, title`), but SELECT appears in `role_table_grants` — a table-level
   grant — so `last_activity_at` is SELECTable by `authenticated` the moment it exists. This is the
   opposite of `097`, whose header records having to grant SELECT on its two new columns
   explicitly, and a migration author who copies `097` will add a redundant grant. Harmless, but
   state it rather than let the next reader re-derive the wrong shape.
2. **Neither table has an UPDATE grant to `authenticated`, and neither has an UPDATE policy at
   all.** So the column is server-owned by construction — the standing
   `database-enforced-integrity` requirement *"A table with no designed edit SHALL carry no UPDATE
   grant"* already covers it, and this change must not weaken it.
3. **Therefore the trigger function cannot be `security invoker`.** A trigger function runs as the
   calling role by default, so its `UPDATE club_threads SET last_activity_at = …` would be refused
   for `authenticated` twice over — no column grant, no UPDATE policy. That is not a silent skipped
   bump: the `UPDATE` raises `42501`, the enclosing `INSERT` on `club_messages` aborts, and **every
   reply in the app stops working**. The function goes in `private`, `security definer`, owned by
   `postgres`, matching `private.notify_club_thread_replied` (`prosecdef = true`, measured) which
   already fires `AFTER INSERT` on the same table for the same reason.

The existing triggers this sits beside:

```
club_messages         BEFORE INSERT  enforce_participation_gate   (public, secdef)
club_messages         AFTER  INSERT  notify_club_thread_replied   (private, secdef)
ride_thread_messages  BEFORE INSERT  enforce_participation_gate   (public, secdef)
```

`AFTER INSERT` rather than `BEFORE`: the gate is a `BEFORE` trigger that raises, so a refused insert
never reaches an `AFTER` trigger, and the bump can never record activity that did not happen.

## D3 — `greatest(...)`, and why the guard is not decoration

`last_activity_at = greatest(last_activity_at, new.created_at)` rather than `= new.created_at`.
`club_messages.created_at` defaults to `now()` but is not server-owned the way
`postcards.created_at` is (`044`), and a backdated or clock-skewed row must not be able to pull a
thread's position *backwards*. `greatest` makes the column monotonic, which is also what lets the
backfill and the trigger run in either order without a wrong answer.

The `AFTER` trigger writes one row of one table per message insert, on the primary key, and both
message tables already carry an `AFTER INSERT` trigger each — the added cost is one index-scan
update per reply.

## D4 — `absorbClubTimelineWindow` breaks. This is the most dangerous thing in the change.

**The club's accumulated source keeps rows by TIME INTERVAL and replaces them by ID, and that is
only correct while a row's position cannot move.** Measured, `src/lib/data/club-timeline.ts:369`:

```ts
const windowIds = new Set(window.rows.map(id))
const outside = accumulated.rows.filter((row) => {
  if (!insideWindow(at(row))) return true        // kept, whatever its id
  if (!windowIds.has(id(row))) removed = true
  return false
})
return { source: { rows: [...outside, ...window.rows], horizon }, removed }
```

A row the window did not cover is kept **without its id being consulted**, and the window's rows are
then concatenated. Two reachable failures once `at` becomes `last_activity_at`:

**The duplicate.** A thread `T` sits deep, held in the accumulated source from window 2 at
`X < h1`. A member replies. `createClubMessage` invalidates, window 1 refetches, and `T` comes back
at `Y >= h1`. Folding window 2 back in: `T`'s fresh row at `Y` is *outside* window 2's interval
`[h2, h1]`, so it is kept; window 2's stale row for `T` at `X` is then appended. **`T` appears
twice, at two positions, under one key `thread:<id>`** — a duplicate React key, and precisely the
"one conversation, two rows" defect this change exists to remove, reintroduced by paging and
invisible on any club small enough not to page.

**The disappearance.** `T` sits below `h1` when window 1 is read, then bumps above `h1` before
window 2 is fetched. Window 2 asks for `last_activity_at <= h1` and no longer contains `T`; window 1
never did. **`T` vanishes from the timeline until window 1 refetches** — a thread disappearing
because someone replied to it, which is the exact inverse of the feature.

Both are deterministic, not races: `ClubTimeline.tsx:308` re-folds the window list from scratch on
every render, so each window holds the rows as they were at its own fetch.

**The fix is a rule, not a patch.** The absorb must drop any accumulated row whose id the incoming
window supplies, regardless of interval, and the merge must not be able to receive two rows with one
key. Stated as a requirement in `specs/club-timeline/spec.md`, with the two scenarios above, because
no gate in this repo can see it: `tsc`, ESLint, the RLS suite and the walk are all green on a
timeline that draws a thread twice.

The ride is unaffected — it does not page, and `mergeRideTimeline` reads each source whole.

## D5 — Announcements: the READ keeps the exclusion, the trigger stamps uniformly

`getClubThreads` filters `.is(ANNOUNCEMENT_MARKER, null)` and `getClubThreadReplies` filters
`.is('thread.introduces_user_id', null)` — both **in the query**, PD-372's fix, and both stay
exactly as they are.

**Decision: the trigger does not special-case the marker.** An announcement thread's
`last_activity_at` is stamped like any other and is simply never read, because the read that would
have ordered on it excludes the row before ordering. The alternative — a trigger that skips threads
with `introduces_user_id is not null` — puts a **presentation** rule in the database, and it would
be wrong the day `097`'s marker is NULLed when the subject leaves the club: the thread would
silently become a timeline thread row carrying a `last_activity_at` frozen at its creation, sorting
it into the wrong place for reasons nothing in the schema explains. `ANNOUNCEMENT_MARKER`'s own
header already records that the filter is presentation and never audience; this keeps that true in
both directions.

## D6 — What a bumped thread leaks, and why it is judged acceptable

`last_activity_at` is a property of the thread, not of the reader, so a message the reader cannot
see can move a thread they can see. The set of such messages is exactly one: a message whose author
has blocked the reader, or whom the reader has blocked — `082` and `108` make a message's audience
the thread's audience *plus* the symmetric block arm, so there is no other row.

The reader therefore learns that *somebody* posted in a thread they can already read, at a time they
can already see the thread. They learn no author, no body and no count — the reply source that feeds
the count is block-filtered by the same policies, so the number does not move either. This is the
same shape as `ride_members` moving a ride's position when a blocked rider joins, and is accepted on
the same grounds. It is recorded here rather than left implicit because "a sort key is not an
audience predicate" is true and is also the sentence under which a real leak would hide.

## D7 — `resolveThreadCount` still compares `created_at`, never `last_activity_at`

The exact-versus-floor rule asks whether every one of a thread's messages lies inside the reply
source's accumulated coverage, and that depends on when the thread **started**:

```ts
const exact = repliesHorizon === null || (threadCreatedAt !== undefined && threadCreatedAt >= repliesHorizon)
```

With one row per thread now positioned at `last_activity_at`, the obvious tidy-up is to feed the
row's own `at` into that comparison, since it is right there on the event. **It is wrong**, silently
and in the direction that lies: an old thread that just bumped has `last_activity_at >= horizon`
while half its messages sit below it, so the row would render `3 replies` as an exact total when the
true number is thirty. The thread's `created_at` must therefore still be carried on the row and used
here — which is also why `created_at` cannot be dropped from `THREAD_SELECT` once ordering moves off
it.

## D8 — A reply must invalidate the thread source, and today it does not

Measured, `src/lib/actions/club-threads.ts:279` and `src/lib/actions/ride-threads.ts:155`:

```ts
function invalidateThreadMessage(threadId: string, clubId?: string) {
  invalidate(queryKeys.clubs.threadMessages(threadId))
  if (clubId) invalidate(queryKeys.clubs.threadReplies(clubId))
}
```

Correct today: the reply source carries the reply row, so invalidating it is what moves the
timeline. **After this change the reply source carries only the count, and the thread source carries
the position** — so a reply would update the number on a row that does not move, until something
else refetched the thread source. Both functions must also invalidate `clubs.threads(clubId)` /
`rides.threads(rideId)`. The same applies to the erase path, which shares the helper.

This is a `client-cache-invalidation` requirement rather than a task note, because the standing spec
already says every mutation declares what it invalidates, and this change moves what one mutation
moves.

## D9 — Ordering stops being immutable for one row type

Every other row on both timelines sits where it happened, for ever: a postcard at its capture, a
join at its `joined_at`, a ride at its `created_at`, the club's founding at the floor. **A thread row
is the first that moves**, and a later reader will be surprised by it — most likely while debugging
why a stream they believed was a log is not one.

Three consequences follow and are specified rather than left to be rediscovered:

- The merge's horizon cut (`event.at >= horizon`) is now a statement about **activity**, not about
  creation. A thread created in March can legitimately appear above a horizon at yesterday. The
  foot's *"the stream is cut"* sentence stays true precisely because the ordering dimension and the
  horizon dimension are the same one — which is why the thread source's horizon must be measured on
  `last_activity_at` and its paging bound (`.lte(...)`) applied to the same column. Measuring the
  horizon on one column while ordering on another is the silent version of this change's whole bug.
- The reply source draws nothing, so **its horizon leaves the merge's horizon list**. A source that
  contributes no row must not cut the stream — otherwise a club with one busy conversation reports
  itself incomplete and withholds its founding entry for rows that were never going to be drawn. Its
  horizon is still read by `resolveThreadCount`, which is a different question about a different
  thing.
- `absorbClubTimelineWindow`'s invariant is the casualty — §D4.
