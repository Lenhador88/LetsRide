# A club's stamps include the photos taken on its own rides

> Linear **PD-328**. This file is the specification and the issue must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear). It ships on one branch with **PD-325**
> (`show-private-clubs-and-request-to-join`), which is `085`; this one is `086` and lands second.

## ⚠ Read this first — what is second-hand

**No Linear tool and no Supabase tool were available while this was written**, and no `ToolSearch`
either, so the deferred-versus-absent probe `CLAUDE.md` §The Agent Squad prescribes could not be
run. `proposal.md` of the sibling change carries the same note in full.

- **PD-328's issue body and its comments were not read.** The story and the five decision points
  are second-hand from the spawning brief. `get_issue PD-328` **and** `list_comments PD-328` are
  task 0.1.
- **Nothing was verified against a live database.** `062`'s accessor body, `011`'s postcards SELECT
  qual, the column grants and `getClubFeed`'s query shape are read from the repo. Counts are
  re-derived in task 0.3.
- **The design snapshot WAS read, offline, and it says there is nothing to read.** `npm run figma --
  ls` finds no stamp component and no "from a ride" marker anywhere;
  `v2 / Component / Postcard` draws a `User + Club` row (`User name` · `in` · `Club name`) and
  nothing about rides. The stamp itself is not in Figma at all — it arrived on 2026-08-27 from a
  product-owner instruction. §Design says what follows from that.

## One thing the brief asked for that this proposal answers differently

Surfaced rather than built around, per `CLAUDE.md` §Working With the Product Owner.

### The two id sets are merged in SQL, not in the client

Decision point 3 asks how `getClubFeed` merges the `club_id = clubId` rows with the accessor's rows.
**It does not merge them: the accessor returns the union already merged and ordered**, and
`getClubFeed` becomes structurally identical to `getRideJournal`.

Merging two independently-capped client arrays is *correct* — merging two sorted lists each of
length ≥ 30 and taking 30 gives the right 30 — but it costs two round trips, two caps, two places
for the ordering rule to live, and it cannot page: `before` applied to two lists separately does not
compose into one keyset window. The union in SQL costs one `order by` and gives one cap, one order
and one predicate. The brief's own constraint — `FEED_PAGE_SIZE` applied to the **ids** — is
satisfied more strictly this way, since the cap is applied before the ids ever reach a query string.

## The defect this change would introduce if it changed only `getClubFeed`

`getClubFeed(id)` and `getFeed({}, { kind: 'club', id })` are **the same select, order, limit and
predicate, and they deliberately share one cache key** — `postcards.feed(filterSegment.club(id))`.
`src/app/(app)/clubs/detail/page.tsx` says so in a comment, and the club strip's `See all` opens
`/postcards?club=<id>`, which is the second of those two reads.

So widening only `getClubFeed` puts **two different lists under one key**. Whichever screen loaded
first wins, the strip and its own `See all` disagree by however many ride postcards exist, and the
disagreement flips depending on navigation order. That is PD-254's crew count and PD-258's near
count in a third shape, and it is invisible to `tsc`, ESLint, the unit tests and the walk.

**Both reads move together.** `getFeed`'s `kind === 'club'` branch delegates to `getClubFeed`, which
becomes the single implementation of "one club's postcards". The key stays shared and stays honest.

## Why

**A club's Postcards strip is missing the photos from the club's own rides.** `getClubFeed` filters
`.eq('club_id', clubId)`, and `club_id` is the *audience* — so a rider who posts a photo from a club
ride to the app-wide feed, or to a different club, has posted a picture of that club's ride that the
club's own page will never show. Product owner: *"Club postcards (the stamp preview) will also
display postcards from the rides of that respective club (also some sort of indication that that
postcard comes from a ride)."*

It needs a proposal rather than a ticket because **the filter cannot be written in the client**.
`062` revoked `select (ride_id)` on `postcards` from `authenticated` precisely so the raw uuid could
not be used to group postcards, and **Postgres checks a column privilege to FILTER as well as to
return** — so `.eq('ride_id', …)` wants the identical grant the exposure did. That is PD-166's
recorded fork, and `ride_journal_postcard_ids` is the shape the owner chose. This change needs the
same shape, one level up, and it is the first thing to compose *three* visibility predicates in one
accessor rather than two.

## What Changes

**One migration, `086`.** Additive, and **inert**: it creates one function and touches no policy, no
grant, no trigger and no existing function. `036`'s hand-exercise gate does not fire.

### New

- **`public.club_stamp_postcard_ids(club uuid, before timestamptz default null, page_size int
  default 30)`** — `returns table (id uuid, from_ride boolean)`, `language sql`, `stable`,
  `security definer`, `set search_path = ''`, revoked from `public` and `anon`, granted to
  `authenticated`. It answers **ids and one boolean**, never a row: the caller re-reads the
  postcards through the ordinary `POSTCARD_SELECT` path under their own RLS, so the `postcards`
  SELECT policy still decides every row that renders. `062`'s shape exactly, plus a club arm and a
  per-row flag.
- **A "from a ride" marker on `PostcardStamp`**, behind a `fromRide?: boolean` prop defaulting to
  false. `BikeIcon` at `h-3 w-3` in the byline row, after the truncated username, `shrink-0`, with
  an accessible label. **No ride is named**; §The marker names nothing has the reasoning and the
  cost.

### Changed

- **`getClubFeed`** becomes `getRideJournal`'s shape: one RPC for the id list, `.in('id', ids)` for
  the rows, `order created_at desc, id desc`, `limit FEED_PAGE_SIZE`. It carries the `from_ride`
  flag onto each `Postcard` it returns.
- **`getFeed`'s `kind === 'club'` branch delegates to `getClubFeed`** and stops writing
  `.eq('club_id', filter.id)` of its own. This is what keeps the shared cache key honest.
- **`Postcard`** gains `from_ride: boolean`, set by `getClubFeed` and false everywhere else.
- **`ClubPostcardCarousel`** passes `fromRide={postcard.from_ride}` to each stamp. `RideJournal` does
  not — on a ride's own Journal every stamp is from that ride and the marker would be noise.

### Explicitly NOT in this change

- **A postcard → ride read of any kind.** No accessor returns a ride id, a ride title, or anything
  that names *which* ride. `062`'s column comment calls that inverse read *"absent rather than
  merely awkward"* and this change keeps it absent. §The marker names nothing states what that
  costs.
- **Widening any grant.** `select (ride_id)` stays revoked from `authenticated`. The accessor is a
  **filter**, never a grant, and the suite asserts both halves.
- **Changing `club_unread_counts()`.** A club's unread badge still counts `club_id`-scoped postcards
  and threads only, so a club whose only new photo came from a ride shows a new stamp and no badge.
  Stated rather than fixed; §Two boundaries this change does not move prices it.
- **Changing `getPostcardFilters`.** The filter bar's club tiles are derived from `row.club`, so a
  ride postcard with a NULL `club_id` still carries no club tile. Same reasoning.
- **Paging the club strip.** The strip is a preview bounded at `FEED_PAGE_SIZE`; `before` exists on
  the accessor so `/postcards?club=<id>` keeps the paging it has, and nothing new pages.
- **PD-309.** §Interaction with PD-309 states what each of the two changes still does after the
  other lands.

## Capabilities

### New Capabilities

- `club-postcard-strip`: what a club's postcard surfaces show, which postcards they may show to
  which reader, how the two arms compose, and what the marker may say — for every role that can
  reach a club: member, admin, owner, non-member of a public club, non-member of a private club,
  blocked rider, and signed-out visitor.

### Modified Capabilities

- `database-enforced-integrity`: `062` established "ids only, never a widened grant" for one
  accessor with two predicates. This is the second, with three, and the rule that needs stating is
  that **each composed predicate must be justified individually** — the outer club gate here
  excludes nobody the per-ride gate would not, *except* for one rider (`083`'s invitee), and that
  exception is exactly why it is not redundant.
- `client-cache-invalidation`: two reads under one key must move together or the key lies. This is
  the first change where widening one of a pair *is itself* the defect.

## Impact

**Database** — `supabase/migrations/086_club_stamp_postcard_ids.sql`; assertions in
`supabase/tests/rls_test.sql`, labelled `086.N`, reconciled by **label set** rather than by count.
**No policy changes**, so `openspec/config.yaml`'s pairing rule is satisfied by the accessor's own
assertions rather than by a policy delta — and the assertions are still required, because an
accessor that restates a policy can go stale exactly as `private.can_read_club` can.

**Security advisors** — **one** new `authenticated_security_definer_function_executable` WARN. With
`085` on the same branch the expected total is **21**, from seventeen on `development`. Count them
off `get_advisors(security)` rather than off this paragraph.

**Participation gate** — unchanged. No new table.

**Reads** — `getClubFeed` and `getFeed` in `src/lib/data/postcards.ts`. **Writes** — none.

**Cache** — **no new key.** `postcards.feed(filterSegment.club(id))` is the existing key and both
reads keep using it; that is the whole point of moving them together.

**Types** — `Postcard.from_ride: boolean` in `src/types/index.ts`, and a `fromRide?: boolean` prop
on `PostcardStamp`.

**Design** — **no frame exists for the marker.** The stamp is not in the Figma file at all, and
`v2 / Component / Postcard`'s only provenance row is `User name · in · Club name`. The marker is
assembled from a measured icon (`BikeIcon`, the Rides tab's own glyph) at the byline's type scale,
and the deviation is logged in `docs/FIGMA-FIDELITY-TODO.md` rather than invented and called
measured.

**Tests** — `PostcardStamp` has a component test (2026-08-27, the byline, the `Rider` fallback and
the button-versus-anchor branch). It gains assertions for the marker in both states; the existing
ones must not be rewritten to accommodate it.

**Dependencies** — none added.

**Docs** — `docs/reference/schema.md`'s `postcards` row gains a sentence naming the second accessor
and restating that there is still no postcard → ride read. `CLAUDE.md`'s advisor table by one.
**Main thread writes those, and the doc edit stays scoped to that one row.**
