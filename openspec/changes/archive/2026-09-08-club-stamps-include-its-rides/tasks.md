## 0. Pre-flight — resolve before writing SQL

- [ ] 0.1 **Read PD-328 yourself, body AND comments.** This proposal was written with no Linear tool
  available at all, so the story and the five decision points are second-hand from the spawning
  brief. `get_issue PD-328` **and** `list_comments PD-328` — neither alone is the issue. Reconcile
  against `design.md` §Questions Closed **before** task 1.1. Also read **PD-309**, so
  `design.md` §Interaction with PD-309 is drawn against what that story says rather than against
  this file's reading of it.
- [ ] 0.2 Put `design.md` §Questions Closed Q1, Q3 and Q4 to the product owner, or accept the stated
  defaults on the record. **None of them is blocking.** Q2 and Q5 are answered and recorded, not
  asked.
- [ ] 0.3 Re-derive the migration number. This story is **`086`** and lands **after** PD-325's
  `085` on the same branch — the order matters only for the numbering, since neither touches the
  other's objects. Confirm with `list_migrations` against `ls supabase/migrations/`, and confirm the
  `080`–`084` gap has been promoted to PROD before either is added to it.
- [ ] 0.4 Record the **before** numbers: `get_advisors(security)` — expect **20** with `085` already
  applied on this branch, going to **21**; and the RLS suite's **label set** via
  `PGPASSWORD=postgres npm test 2>&1 | grep "NOTICE:  ok"`. Reconcile by label set, never by count.
  **Read those against the BRANCH, not against `development`** — `085` lands first here, so a fresh
  checkout's baselines are not this branch's.
- [ ] 0.5 Confirm from the catalog, not from this file, the four facts the design rests on:
  `has_column_privilege('authenticated','public.postcards','ride_id','SELECT')` is **false**;
  `public.ride_journal_postcard_ids`' body still restates `011`'s `postcards` SELECT qual and still
  gates on `private.can_read_ride`; `private.can_read_club` exists, is `security definer` and is
  executable by no client role; and `postcards` SELECT's qual still matches the pin the suite holds
  under `ride_journal_postcard_ids`' name. If the last has moved, this change re-pins **two**
  restatements and the reason is in `specs/database-enforced-integrity/`.
- [ ] 0.6 Measure the tag arm's exclusive contribution on DEV before building, so the change's own
  value is a number rather than an argument, and so PD-309's author has a baseline:

  ```sql
  select count(*) from public.postcards p
    join public.rides r on r.id = p.ride_id
   where r.club_id is not null and p.club_id is distinct from r.club_id;
  ```

## 1. Migration `086_club_stamp_postcard_ids.sql`

- [ ] 1.1 `public.club_stamp_postcard_ids(club uuid, before timestamptz default null, page_size int
  default 30) returns table (id uuid, from_ride boolean)` — `language sql`, `stable`,
  `security definer`, `set search_path = ''`, every name schema-qualified. Body per
  `design.md` §The accessor.
- [ ] 1.2 The outer gate `private.can_read_club((select auth.uid()), club)`, evaluated once per
  statement because it does not depend on `p` — `062`'s own note about the same shape. **Comment the
  rider it excludes by name**: `083`'s invitee, for whom `can_read_ride` is true and
  `can_read_club` is false. That comment is the only thing distinguishing this conjunct from
  decoration, and 3.4 is the assertion that proves it.
- [ ] 1.3 The two arms: `p.club_id = club` **or** an `exists` over `public.rides` with
  `r.id = p.ride_id and r.club_id = club and private.can_read_ride((select auth.uid()), r.id)`.
  Comment that `p.ride_id` is readable here and by no client, and that the per-ride gate is
  load-bearing for a **public** club holding a private ride, `022` rewriting rides only in the
  private direction.
- [ ] 1.4 `011`'s `postcards` SELECT qual, **copied verbatim from `062` §2**, including the
  unconditional author branch. Comment `009`'s reason for that branch and comment that this is a
  restatement that can go stale.
- [ ] 1.5 `before` as `(before is null or p.created_at < before)`; order `p.created_at desc,
  p.id desc`; `limit least(coalesce(page_size, 30), 100)`.
- [ ] 1.6 `from_ride` as `p.club_id is distinct from club`. **`is distinct from`, never `<>`** —
  `p.club_id` is nullable and `null <> club` is null, which would drop every app-wide postcard out
  of the result. Comment it; this is the same class as `073`'s measured CHECK correction.
- [ ] 1.7 `comment on function` in full: that it returns ids and a flag and never a row; that the
  caller re-reads under their own RLS so `postcards` SELECT is still the only authority on content;
  that its restated visibility is load-bearing only for the **correlation**; that there is still no
  postcard → ride read and the flag is not one; and which three predicates it composes and who each
  excludes.
- [ ] 1.8 `revoke all on function public.club_stamp_postcard_ids(uuid, timestamptz, int) from public,
  anon;` then `grant execute … to authenticated`. Postgres grants EXECUTE to PUBLIC on every new
  function unless told otherwise (`062` §2's note).
- [ ] 1.9 Write the verification footer, on `062`'s model: `prosecdef` true; `proconfig` is
  `{search_path=}`; `has_function_privilege` for `authenticated` (true) and `anon` (false);
  `pg_get_function_result` naming exactly `TABLE(id uuid, from_ride boolean)`;
  `authenticated`'s SELECT column list on `postcards` **unchanged**, as a sorted string;
  `has_column_privilege('authenticated','public.postcards','ride_id','SELECT')` still **false**;
  `md5(qual)` on `postcards` SELECT captured before and after and **equal**; and the advisor count.

## 2. Apply and verify

- [ ] 2.1 Apply `086` to DEV via `apply_migration`.
- [ ] 2.2 **No hand-exercise gate.** `086` creates one function and hangs no trigger on any shipped
  write path, so `036`'s rule does not fire. State that in the PR rather than leaving it unsaid —
  "it was not needed" and "we forgot" look identical afterwards.
- [ ] 2.3 Run the footer's queries. Every number must match.
- [ ] 2.4 A behavioural probe as `authenticated` with a rider's own id in `request.jwt.claims` — the
  HOSTED idiom, since `supabase/tests/` redefines `auth.uid()` to read `test.uid` and setting the
  claims there is read by nothing. In a transaction that is **rolled back**. Three shapes: a member
  of a club gets both arms; a non-member of a private club gets zero rows; `select ride_id from
  postcards limit 1` is still `42501`.
- [ ] 2.5 `get_advisors(security)` on DEV — **one** new
  `authenticated_security_definer_function_executable`. A second means something landed in `public`
  that should be in `private`.
- [ ] 2.6 `PGPASSWORD=postgres npm test` green, reconciled by **label set** against 0.4's.

## 3. RLS assertions — `supabase/tests/rls_test.sql`

Labelled `086.N`, with a fixture-id block at the head naming which rider each id is. `086` changes no
policy, so `openspec/config.yaml`'s pairing rule is discharged by these assertions on the accessor
itself — which is required regardless, because an accessor that restates a policy can go stale
exactly as `private.can_read_club` can.

Fixtures needed: a **private** club with a member, a non-member, and a ride; a **public** club with a
member, a non-member, a public ride and a **private** ride; a rider holding a live `ride_invites` row
for the private club's ride (`083`'s case); a blocked pair; a postcard the reader has hidden; a
postcard whose author has left the club; a postcard tagged to club A's ride but posted to club B; and
a postcard both scoped to a club and tagged to that club's own ride.

- [ ] 3.1 The audience arm alone still works: a member reads every `club_id`-scoped postcard they
  read today, and the result equals their own `.eq('club_id', …)` read — asserted as **equality**,
  not a spot check, so a regression in the restated qual is visible.
- [ ] 3.2 The tag arm works: a member reads a postcard whose `club_id` is NULL and whose `ride_id`
  names one of the club's rides, with `from_ride` **true**.
- [ ] 3.3 **A non-member of a private club reads zero rows**, including where they can otherwise read
  a postcard tagged to one of that club's rides.
- [ ] 3.4 **`083`'s invitee reads zero rows for that private club**, despite `can_read_ride` being
  true for them. **Mutation-test it**: remove the outer club gate, confirm this goes red, revert. An
  assertion for a predicate that has never been seen to fail is not coverage, and this is the only
  rider for whom that gate is not redundant.
- [ ] 3.5 A non-member of a **public** club reads postcards tagged to its **public** rides and
  **zero** tagged to its private ride. Two assertions; the second is what the per-ride gate buys.
- [ ] 3.6 A blocked author's postcard is absent from the accessor's result **and** from the re-read.
  Two assertions — the accessor may not rely on the re-read.
- [ ] 3.7 A hidden postcard is absent.
- [ ] 3.8 The reader's **own** postcard is present even when they have left the club it was posted to
  and even when they have hidden it from themselves. `009`'s unconditional author branch.
- [ ] 3.9 A postcard tagged to club A's ride and posted to club B appears on A's strip for a member
  of both, and **not** for a member of A alone.
- [ ] 3.10 `from_ride` is **false** for a postcard both scoped to the club and tagged to one of its
  rides, and **true** for a NULL-`club_id` one — the `is distinct from` assertion.
- [ ] 3.11 Ordering: two postcards written in one transaction tie on `created_at` and come back in
  `id desc` order.
- [ ] 3.12 The cap: `page_size` 10000 returns no more than the internal cap; a negative one does not
  error. `before` excludes the boundary row's successors, matching what `getFeed` does today.
- [ ] 3.13 `anon` holds no EXECUTE, asserted by `has_function_privilege` and **not** by calling it —
  `031`'s lesson, since the suite runs as the table owner for whom neither barrier exists.
- [ ] 3.14 `select (ride_id)` is still revoked from `authenticated`, and `authenticated`'s SELECT
  column list on `postcards` is unchanged, asserted as a sorted string rather than a count.
- [ ] 3.15 **Pin `postcards` SELECT's qual as whole text under this function's name**, in addition to
  the existing pin under `ride_journal_postcard_ids`' name. The failure message SHALL name both
  accessors and instruct that both bodies move, never that the string be re-pinned — PD-211's shape.
- [ ] 3.16 The accessor's result is a **subset** of what the caller's own `postcards` read returns,
  asserted as set containment over the whole fixture, so "it is a filter, not a grant" is proven
  rather than described.

## 4. Types, reads and the merge

- [ ] 4.1 `src/types/index.ts`: `Postcard.from_ride: boolean`. Not optional — an optional boolean on
  a type this widely constructed makes "false" and "not asked" indistinguishable at every call site,
  which is the `null`/`undefined` confusion in a smaller place.
- [ ] 4.2 `src/lib/data/postcards.ts`: rewrite `getClubFeed` on `getRideJournal`'s shape — the RPC
  for the ids, `.in('id', ids.slice(0, limit))`, `.order('created_at', desc)`, `.order('id', desc)`,
  `.limit(limit)`. Carry `from_ride` onto each returned `Postcard` from the id map.
  **Guard `clubId` with `clubIdSchema` first**, the same guard `getRideJournal` carries for its
  ride id and for the same reason: a non-uuid reaches `.eq` as `22P02`, PostgREST turns it into a
  400 and `unwrapList` throws, which is an error boundary where a not-found belongs.
- [ ] 4.3 `getFeed`'s `kind === 'club'` branch delegates: `return getClubFeed(filter.id, { before,
  limit })`, and the `.eq('club_id', filter.id)` line goes. Update that function's header — it says
  the feed "deliberately has no `club_id` filter", which stays true of the app-wide path and now has
  a delegation beside it.
- [ ] 4.4 Update the shared-key comment in `src/app/(app)/clubs/detail/page.tsx` to say what the two
  reads now return. **Replace it, do not annotate it** (`CLAUDE.md` §Working Principles — replace a wrong claim, do not narrate it).
- [ ] 4.5 `attachLikeState` is unchanged and still runs over the re-read rows, so likes, comments,
  `is_liked`, `is_own` and the signed image URL all come from the ordinary path.
- [ ] 4.6 No component calls `supabase.from()`; nothing outside `lib/data/` and `lib/actions/`
  reaches Supabase except through `@/lib/supabase/client`.

## 5. The marker

- [ ] 5.1 **Read the design first.** `npm run figma -- ls` finds no stamp component and no
  provenance marker; `npm run figma -- tree "v2 / Component / Postcard" --all` shows the only
  provenance row is `User name · in · Club name`. **Log the deviation in
  `docs/FIGMA-FIDELITY-TODO.md`** — assembled from a measured icon at a measured type scale, not
  invented and called measured.
- [ ] 5.2 `PostcardStamp` gains `fromRide?: boolean`, defaulting to false. The marker is a
  `BikeIcon` at `h-3 w-3` in `text-muted`, `shrink-0`, **at the end of the byline row** after the
  truncated username. Document in the component's header why it is not a corner badge (the
  `stamp-edge` mask bites exactly the corners a badge wants, and the shadow is a `filter:
  drop-shadow` chosen to follow the notch) and why it is not a third row (`STAMP_TILE_WIDTH` plus
  `aspect-square` size the neighbouring tiles on two strips against this tile's height).
- [ ] 5.3 The provenance is folded into the existing `aria-label`, not added as a second labelled
  element.
- [ ] 5.4 `ClubPostcardCarousel` passes `fromRide={postcard.from_ride}`. **`RideJournal` does not** —
  every stamp there is from that ride. Comment the asymmetry in both files.
- [ ] 5.5 `PostcardStamp`'s existing component test keeps every assertion it has — the byline, the
  `Rider` fallback for an author the profiles policy withholds, and the button-under-provider versus
  anchor-without-provider branch. **Add two**: the marker present when `fromRide` is true, absent
  when the prop is not passed. Rendered through `renderToStaticMarkup` in the `node` environment,
  like the other four component tests; nothing here needs a layout or an event.
- [ ] 5.6 `ClubPostcardCarousel`'s header records the trade it already carries ("the byline, caption,
  likes and comments … are not readable on a tile"). Extend it: the provenance is now readable and
  the *ride's identity* deliberately is not.

## 6. Verify and document

- [ ] 6.1 `npx tsc --noEmit` clean; `npm run lint`; `npm run test:unit` with no file lost and the
  four existing component tests intact; `npm run build` green; `npm run docs:check`;
  `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs`.
- [ ] 6.2 `npm run walk` against DEV through `scripts/supabase-relay.mjs`. Read the relay's header
  first — Chromium in this container cannot reach Supabase directly.
- [ ] 6.3 Check the club strip and `/postcards?club=<id>` **in both navigation orders** in a real
  browser. This is the one defect in this change that every automated gate is blind to: `tsc`,
  ESLint, Vitest, `next build` and the RLS suite all stay green while two lists disagree under one
  cache key.
- [ ] 6.4 `docs/reference/schema.md`: the `postcards` row gains a sentence naming
  `public.club_stamp_postcard_ids` beside `ride_journal_postcard_ids`, and **restating** that there
  is still no postcard → ride read and that the `from_ride` flag is not one. **Keep the edit to that
  one row** — another session holds `docs/reference/` territory for other files.
- [ ] 6.5 `CLAUDE.md`: the advisor table by one, naming the new function. **Main thread writes this,
  not a subagent.**
- [ ] 6.6 `docs/HANDOFF.md`: the applied-migration position after `086`, and — under Known issues —
  the two boundaries this change does not move (`club_unread_counts()` and `getPostcardFilters`),
  with the query from task 0.6 so the next session can re-measure rather than re-argue. **Main
  thread writes this.**
- [ ] 6.7 Run `reviewer` on the proposal **before** the migration is written, and again on the final
  diff, once, immediately before the PR. Both changes ship in **one** PR, so the second pass reads
  `085` and `086` together — which is the pass that would catch the two migrations disagreeing about
  what a private club discloses.
