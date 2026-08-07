/**
 * Every cache key the app uses, in one place.
 *
 * ## Why this file is the contract and not a convenience
 *
 * Before the client-rendered shell, freshness was claimed by 33 `revalidatePath`
 * calls across 8 Server Action files. Those claims are the app's entire model of
 * "what is now stale", and they were readable in one `git grep`. Moving to a
 * client cache without a single place to read them back would turn a checkable
 * property into 33 independent guesses, and the failure mode — a screen quietly
 * showing yesterday's data — is one no test currently catches (design.md §Risks).
 *
 * So: reads name their key from here, writes name their invalidation from here,
 * and `__tests__/keys.test.ts` pins the mapping. A key spelled inline in a
 * component is a bug even when it happens to be the right string.
 *
 * ## How prefix invalidation is meant to be used
 *
 * `invalidate` matches on prefix, so `invalidate(postcards.all())` reaches every
 * feed page, every filter set and every individual card. **Over-invalidating is
 * the safe direction** — it costs a refetch, where under-invalidating costs
 * correctness — so where a `revalidatePath` claim was ambiguous, this file
 * widens rather than narrows, and says so at the site.
 *
 * ## The count
 *
 * There were **33** `revalidatePath` call sites, not the 41 quoted in
 * `design.md`, `tasks.md` and `docs/HANDOFF.md`. All three cite
 * `git grep -c revalidatePath -- 'src/lib/actions/*.ts'`, which counts *lines
 * containing the word* — and 8 of those are the `import { revalidatePath } from
 * 'next/cache'` line at the top of each of the 8 files. 33 + 8 = 41. This is the
 * same counting trap CLAUDE.md documents three times over (the `lucide-react`
 * importer count, the v1-token count, the `next/headers` count), reproduced by
 * the very plan that warns about it. Re-derive against the last commit that had
 * them, which is the only place they exist now:
 *
 *     git show c2688c5~1:src/lib/actions/clubs.ts | grep -c "revalidatePath("
 *
 * ## The reconciliation — task 5.9
 *
 * Every one of the 33 is accounted for below. **Nothing was dropped.** Two
 * claims narrowed and four widened, each for a reason recorded at its own call
 * site; the rest are direct translations.
 *
 * | Was | Is now |
 * |---|---|
 * | `auth.signOut` — `('/', 'layout')` | `clearQueryCache()`. The one that must **destroy**, not refresh: refetching on a shared device repopulates rider A's screens while B signs in |
 * | `blocks` — `('/', 'layout')`, both actions | `invalidate(EVERYTHING)`. The empty prefix, and task 5.10's requirement that a block reach *every* cached view — no single domain prefix can, since the blocked rider appears under all four |
 * | `createClub` — `/clubs`, `/clubs/explore` | `clubs.all()` — **wider**: it also reaches `clubs.mine()`, the club picker on the create-ride and create-postcard forms, which neither path covered because no route drew it |
 * | `markClubSeen` — `/clubs` | `clubs.yours()` — **narrower**, deliberately. Explore is the one club list with no counter to move; `getExploreClubs` passes no unread argument at all |
 * | `markFeedSeen` — `/postcards` | `postcards.filters()` — **narrower**. The watermark moves the "All new" tile's count and nothing else; refetching the deck would replace the cards under a rider looking at the exhausted state |
 * | `joinClub` / `leaveClub` — `/clubs`, `/clubs/explore`, `` `/clubs/${id}` `` | `clubs.all()` **plus** `postcards.feed(club:<id>)` **plus** `rides.list(club:<id>)`. The third path was a *route*, and re-rendering it refetched three reads spanning three domains — see `invalidateClubMembership` for the bug the naive translation caused |
 * | `addComment` / `deleteComment` — `/postcards`, `` `/postcards/${id}` `` | `postcards.all()`. **`deleteComment`'s is now unconditional**, which closes a recorded KNOWN GAP for free: the path needed an id the caller could not always read |
 * | `hidePostcard` / `unhidePostcard` — `/postcards` | `postcards.all()` |
 * | `likePostcard` / `unlikePostcard` — `/postcards`, `` `/postcards/${id}` ``, `` `/clubs/${club}` `` | `postcards.all()` + `clubs.detail(club)` |
 * | `createPostcard` — same three | same |
 * | `deletePostcard` — same three | same |
 * | `updateProfile`, `setProfileImage`, `addCountry`, `removeCountry` — `/profile` ×4 | `profile.all()` ×4 |
 * | `setRideAttendance` — `/rides`, `` `/rides/${id}` ``, `` `/rides/${id}/crew` `` | `rides.all()` — **wider**: it also reaches `rides.filters()`, whose attendee collage an RSVP moves and which `revalidatePath('/rides')` only covered by accident of rendering on that route |
 * | `createRide` — `/rides` | `rides.all()` **plus** `clubs.detail(club_id)` — **wider**, and a real gap closed: a ride created into a club appears on that club's Rides sub-page, which the original never reached. `/rides/new` only began offering `club_id` on 2026-08-05 and the claim was never extended with it |
 *
 * `tasks.md` says "actions/rides.ts's 5 invalidations"; the file had **4**.
 *
 * `__tests__/keys.test.ts` is what keeps this honest going forward: it asserts
 * no `revalidatePath` survives to be a silent no-op, and that every
 * `invalidate()` argument comes from this file rather than being spelled inline.
 */

import type { QueryKey } from '@/lib/query/queryClient'

/**
 * The filter segment inside `postcards.feed(…)` and `rides.list(…)`.
 *
 * Both keys type that segment as `string | null`, because a feed filter is two
 * fields (`kind` and `id`) and a cache key is flat. Which left five screens
 * building `` `club:${id}` `` by hand — and then `joinClub` needing to build the
 * *same* string to invalidate what they read. That is the drift this whole file
 * exists to prevent, one level down from the keys: two spellings that must match
 * exactly, with nothing forcing them to, and a mismatch that costs correctness
 * silently rather than failing.
 *
 * `kind` is part of the string rather than dropped, because a rider and a club
 * can hold the same uuid in principle, and two different feeds sharing one cache
 * entry surfaces as somebody else's postcards.
 */
export const filterSegment = {
  club: (clubId: string): string => `club:${clubId}`,
  rider: (riderId: string): string => `rider:${riderId}`,
  /** `/rides?mine` — the one filter with no id at all. */
  mine: (): string => 'mine',
} as const

export const queryKeys = {
  /** `revalidatePath('/profile')` — 4 sites in actions/profile.ts. */
  profile: {
    all: (): QueryKey => ['profile'],
    me: (): QueryKey => ['profile', 'me'],
    countries: (userId: string): QueryKey => ['profile', 'countries', userId],
  },

  /**
   * `revalidatePath('/clubs')`, `('/clubs/explore')` and `` (`/clubs/${id}`) `` —
   * 10 sites in actions/clubs.ts. The list and the explore list are always
   * invalidated together in the original, so they share the `clubs` prefix
   * deliberately rather than by accident.
   */
  clubs: {
    all: (): QueryKey => ['clubs'],
    yours: (): QueryKey => ['clubs', 'yours'],
    explore: (): QueryKey => ['clubs', 'explore'],
    /** The club-picker options on the create-ride and create-postcard forms. */
    mine: (): QueryKey => ['clubs', 'mine'],
    detail: (clubId: string): QueryKey => ['clubs', 'detail', clubId],
    members: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'members'],
  },

  /**
   * `revalidatePath('/postcards')` and `` (`/postcards/${id}`) `` — 9 sites in
   * actions/postcards.ts, 2 in comments.ts, 2 in moderation.ts.
   *
   * Comments hang off the postcard's own prefix so that deleting a postcard
   * drops its thread from the cache in the same call, which the route-based
   * version got for free by invalidating the page.
   */
  postcards: {
    all: (): QueryKey => ['postcards'],
    /** `filter` is the serialised rider/club filter, or null for the whole feed. */
    feed: (filter: string | null): QueryKey => ['postcards', 'feed', filter],
    filters: (): QueryKey => ['postcards', 'filters'],
    detail: (postcardId: string): QueryKey => ['postcards', 'detail', postcardId],
    comments: (postcardId: string): QueryKey => ['postcards', 'detail', postcardId, 'comments'],
  },

  /**
   * `revalidatePath('/rides')`, `` (`/rides/${id}`) `` and
   * `` (`/rides/${id}/crew`) `` — 4 sites in actions/rides.ts.
   *
   * The crew is a child of the ride for the same reason comments are a child of
   * the postcard: `joinRide` invalidated all three routes together, and nesting
   * makes that one call instead of three that can drift apart.
   */
  rides: {
    all: (): QueryKey => ['rides'],
    list: (filter: string | null): QueryKey => ['rides', 'list', filter],
    filters: (): QueryKey => ['rides', 'filters'],
    detail: (rideId: string): QueryKey => ['rides', 'detail', rideId],
    crew: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'crew'],
    /**
     * The ride's chat thread (`034`). A child of the ride for the same reason
     * `crew` is: it is scoped to one ride and dies with it.
     *
     * **`sendRideMessage` deliberately invalidates only this key**, and that is
     * the first narrow claim in this file that is narrow on purpose rather than
     * inherited from a `revalidatePath`. A message changes nothing else — not
     * the rides list, not the card, not the crew — so `rides.all()` would
     * refetch four screens on every keystroke-ended send. The unread badge
     * (Linear PD-120) will be the first thing that widens it, and it should
     * widen it here rather than at the call site.
     */
    messages: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'messages'],
  },
} as const

/**
 * The `revalidatePath('/', 'layout')` replacement — 1 site in actions/auth.ts
 * (sign-out) and 1 in actions/blocks.ts.
 *
 * Both mean "everything you were shown may no longer be yours to see", and
 * neither is a route-shaped claim. Blocking is the load-bearing one: task 5.10
 * requires the blocked rider's content to leave **every cached view the blocker
 * holds**, not merely the next fetch, and a prefix invalidation cannot express
 * that because the blocked rider appears under `postcards`, `rides`, `clubs`
 * *and* `profile`. Sign-out additionally has to destroy rather than refresh —
 * see `clearQueryCache` in queryClient.ts.
 */
export const EVERYTHING: QueryKey = []
