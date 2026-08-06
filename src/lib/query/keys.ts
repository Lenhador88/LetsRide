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
 * There are **33** `revalidatePath` call sites, not the 41 quoted in
 * `design.md`, `tasks.md` and `docs/HANDOFF.md`. All three cite
 * `git grep -c revalidatePath -- 'src/lib/actions/*.ts'`, which counts *lines
 * containing the word* — and 8 of those are the `import { revalidatePath } from
 * 'next/cache'` line at the top of each of the 8 files. 33 + 8 = 41. This is the
 * same counting trap CLAUDE.md documents three times over (the `lucide-react`
 * importer count, the v1-token count, the `next/headers` count), reproduced by
 * the very plan that warns about it. Re-derive with the anchored form:
 *
 *     git grep -o "revalidatePath(" -- 'src/lib/actions/*.ts' | wc -l
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
