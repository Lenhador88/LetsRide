import type { UseQueryResult } from '@/lib/query/useQuery'

/**
 * The failure half of the gate a screen with more than one read puts in front
 * of its content.
 *
 * Most converted screens issue two or three `useQuery` calls — the feed and its
 * filter bar, the ride and its crew — and each needs the same two answers about
 * the set as a whole: did anything fail, and what does "try again" retry.
 * Written inline that is the same four lines fifteen times, and the retry is the
 * line that gets it wrong: retrying only the query the screen happened to name
 * leaves the other one in its error state with no affordance to clear it.
 *
 * So `refetch` re-runs **every** query passed in, not only the failed one. That
 * is deliberate and it is the opposite of `ErrorState`'s scoped retry, which
 * exists for a control failing inside an otherwise-loaded screen. When the whole
 * screen is the error state, the whole screen is what retries — a query that
 * already holds data and is inside its stale window is a no-op, so the wider
 * retry costs nothing.
 *
 * The first error wins rather than being collected. Two reads failing in the
 * same instant is one outage, and the screen has room for one message.
 *
 * ## Why there is no `isLoading` here
 *
 * The obvious companion — `queries.some(q => q.isLoading)` — is a trap, and it
 * is the kind that renders rather than throws. `isLoading` is
 * `data === undefined && isFetching`, and `useQuery` starts its fetch in an
 * **effect**: on the first render pass there is no data *and* no fetch in
 * flight, so `isLoading` is `false`. A screen written as
 *
 *     if (gate.isLoading) return <Skeleton />
 *     return <Deck postcards={feed.data} />   // undefined on the first tick
 *
 * falls straight through on that tick with `undefined` where its data should
 * be. Gate on the data instead — `if (!feed.data || !filters.data)` — which is
 * true on the first tick, true while loading, and false exactly when there is
 * something to draw. It also keeps a background refetch invisible, because the
 * previous data is still there.
 */
export function combineQueries(...queries: readonly UseQueryResult<unknown>[]): {
  error: Error | null
  refetch: () => void
} {
  return {
    error: queries.find((query) => query.error !== null)?.error ?? null,
    refetch: () => {
      for (const query of queries) query.refetch()
    },
  }
}
