# A weekly "what's on this weekend" — part 1: the content rule, the reader and the opt-out

PD-450, split at the issue's own seam: *"Only the send waits."* This change is **part 1**. Part 2
is the send, recorded below as §Deferred to part 2, and **gets no requirements here**, so
archiving this change writes nothing unbuilt into the standing specs.

## Why

Every notification this app produces is reactive: another rider did something first. A rider to
whom nothing happened gets nothing, which is most riders in most weeks. A weekly round-up of rides
near them this weekend, plus what moved in their clubs, is the one return trigger that does not
depend on someone else acting.

The send needs push delivery (PD-303), which is deployed and inert. What does not need it is the
part that decides what the round-up **says** and **who must not see what**. That part is also
readable in-app today. It is where every negative case in the issue lives, so it is built first.

## What Changes

1. **`129` adds `private.weekend_digest_for(candidate, at, near_lat, near_lon)`.** It is the one
   body that states the content rule (`design.md` §D3). It is candidate-relative, tests blocks
   itself in both directions, calls only already-pinned audience helpers, and never reads
   `auth.uid()`, `rides_from` or the opt-out. No client role can execute it.
2. **`129` adds `public.my_weekend_digest(near_lat, near_lon)`**, the in-app reader. It passes
   `auth.uid()` and `now()`, and `authenticated` alone may call it. It returns ids, order and
   counts. The client reads the ride and club rows for those ids under its own RLS (`design.md`
   §D2).
3. **`129` adds `profiles.digest_opt_out_at`**, with **no grant or revoke on `profiles`**, and two
   own-row RPCs to reach it: `my_digest_opt_out()` and `set_digest_opt_out(p_opt_out boolean)`. It
   is its own consent, independent of `096`'s analytics opt-out in both directions.
4. **`/rides/weekend`**, a new screen, is entered from one static row on `/rides/explore`
   (`design.md` §D6). The screen has these states:
   - skeleton;
   - content;
   - empty ("Nothing near you this weekend");
   - no position, which offers a tap into `TownQuestionSheet`;
   - error with retry;
   - offline.
5. **`NotificationsSheet` becomes honest.** The branch's copy says a round-up is put together
   weekly, and nothing is. It becomes, for example: *"A Friday-evening round-up of rides near you
   this weekend, once push notifications are switched on. You can turn it off now."* Its test is
   fixed. It fails `tsc` today at `NotificationsSheet.dom.test.tsx(77,57)`.

**The content rule, in one paragraph.**

- **Rides:** those in this weekend in their own zone, within 100 km of the position the caller
  passes (rounded to 2 dp by the body), readable by the rider, not organised by them, not already
  answered by them, and not organised by anyone blocked with them. At most 5, soonest first.
- **Clubs:** those the rider belongs to, with counts of the last 7 days' new upcoming rides and
  new threads. The rider's own rows, and rows by anyone blocked with them, are excluded. A club
  appears only if its total is above zero, busiest first, at most 5.
- **Nothing to show:** zero rows.
- **No position:** no rides, and the clubs section still shows.

## Capabilities

### New Capabilities

- `weekly-digest` states:
  - the content rule;
  - the body's reachability and discipline;
  - the reader's shape and grants;
  - the opt-out and its independence;
  - the honesty of the opt-out's copy;
  - the screen's states and entry.

### Modified Capabilities

- `database-enforced-integrity`: *"Consent and lifecycle timestamps SHALL NOT be readable by
  other riders"* now names `analytics_opt_out_at` and `digest_opt_out_at` beside the two stamps
  it named before, and says how a stamp's own rider reaches it.
- `analytics-consent`: the analytics opt-out SHALL NOT be conflated with the round-up's opt-out,
  in either direction.

`rider-position-question` is **not** modified, because the resolver does not change. Neither are
`notifications` and `event-fanout-integrity`. Part 1 writes no notification and no fan-out.

## Impact

- **Schema.** `supabase/migrations/129_*.sql` (re-derive the number off DEV's `list_migrations`
  when writing it; it is `129` as of 2026-09-22). It adds one column, four functions, and no
  table, trigger, policy or grant on a table.
  - **Additive, migration-first.** The branch's bundle already calls `my_digest_opt_out` and
    `set_digest_opt_out`. Served ahead of `129`, `NotificationsSheet` lands on `ErrorState`.
- **RLS suite.** `§129` covers every negative case in `design.md` §Roles and negative cases. The
  participation-gate count stays **23**, because no gated table is added.
- **Security advisors.** There are **3** new `authenticated_security_definer_function_executable`
  WARNs, each deliberate: `my_weekend_digest`, `my_digest_opt_out` and `set_digest_opt_out`. No
  new class.
- **Client.** The client changes are:
  - `src/lib/data/digest.ts` (new);
  - `src/lib/query/keys.ts` (`rides.weekend`, `rides.weekendAll`);
  - `src/lib/actions/clubs.ts` (`invalidateClubMembership` gains one claim);
  - `src/types/index.ts`;
  - `src/app/(app)/rides/weekend/page.tsx` (new);
  - `src/app/(app)/rides/explore/page.tsx` (the row);
  - `src/components/profile/NotificationsSheet.tsx` and its test;
  - `scripts/walk.mjs`.
- **Docs.** `docs/reference/schema.md` and `docs/reference/migrations.md`.
- **Not touched.** Also no dependency, no feature flag, and no Edge Function:
  - `public.notifications`;
  - `push_deliveries`;
  - `push_payload_for`;
  - `claim_push_batch`;
  - any `pg_cron`, Vault or network object.

## Deferred to part 2

**What part 2 is:**

- the stored home anchor;
- `rider_digests` (the one-per-rider-per-week marker);
- scheduled assembly;
- the Vault gate;
- widening the push outbox to a second subject;
- the push payload;
- quiet hours in the rider's zone.

Part 2 needs its own proposal, and **that proposal SHALL meet each constraint below**. They are
the findings of this change's first review, and none of them is optional.

1. **The anchor is never the raw pick.** The typeahead has no `type=city` filter, so a rider who
   picks a street would store an address-level home coordinate. The anchor SHALL come from
   `search-places`' `locality` mode (which does filter to `type=city`), or SHALL be rounded **in
   the database** to 2 dp. It SHALL NOT be copied from the picked place's coordinate.
2. **Town and anchor move together, or the anchor is cleared.** `authenticated` can UPDATE
   `profiles.location` directly, so an anchor written beside it goes stale on a town change. Part
   2 SHALL have:
   - **one** writer that sets town and anchor together;
   - a clear-on-change trigger on `location` with **no `current_user` role guard**, so it binds
     every writer;
   - the hand-exercise gate on DEV as `authenticated` in a rolled-back transaction, because it
     hangs a trigger off a shipped write path.
3. **Client writers.** `setHomeTown` SHALL post the pick's lat/lon to that writer, and SHALL call
   `clearRiderLocation()`, which `setRiderTown` already does and `setHomeTown` does not.
4. **No rider is pushed at night for want of a zone.** A rider whose zone is unknown SHALL NOT be
   pushed outside daytime hours in `APP_TIME_ZONE`. The earlier draft would have pushed a
   null-zone rider at about 02:00.
5. **Empty means no send.** Where `private.weekend_digest_for` returns zero rows for a candidate,
   the assembler SHALL write no marker, no outbox row and no push. Zero rows is the whole signal,
   and nothing SHALL synthesise a "quiet week".
6. **The assembler reads the same body.** It SHALL call `private.weekend_digest_for` with the
   stored anchor and SHALL add only its own conjuncts: the opt-out, onboarding, and deletion in
   progress. The body stays the content rule.
7. **`rides_from` is never a position, in SQL too.** Part 2's assembler and payload SHALL be
   covered by the same comment-stripped `prosrc` guard as `§129`. The `src/` test
   `rides-from-is-not-a-position.test.ts` cannot see SQL.
8. **Migration-first.** Part 2's migration applies before the bundle that writes the anchor
   serves, because a bundle that writes a column ahead of it gets `PGRST204`. Anything else it
   changes is sequenced by `CLAUDE.md`'s rule: ask which side fails safe.
9. **The privacy page moves with the anchor.** A stored coordinate about a rider needs a stated
   retention window and a `/legal/privacy` line at creation.
10. **`NotificationsSheet`'s copy is revisited** when the first digest can actually be sent.
