import type { UseQueryResult } from '@/lib/query/useQuery'

/**
 * The gate a screen with more than one read puts in front of its content.
 *
 * Most converted screens issue two or three `useQuery` calls — the feed and its
 * filter bar, the ride and its crew — and each one needs the same three-way
 * answer: is anything still loading, did anything fail, and what does "try
 * again" retry. Written inline that is four lines per screen, fifteen times,
 * and the retry is the line that gets it wrong: retrying only the query the
 * screen happened to name leaves the other one in its error state with no
 * affordance to clear it.
 *
 * So `refetch` here re-runs **every** query passed in, not only the failed one.
 * That is deliberate and it is the opposite of `ErrorState`'s scoped retry,
 * which exists for a control failing inside an otherwise-loaded screen. When
 * the whole screen is the error state, the whole screen is what retries — a
 * fresh query that already holds data and is inside its stale window is a
 * no-op, so the cost of the wider retry is zero.
 *
 * `isLoading` is true only while there is nothing to show. A background refetch
 * of a screen that already has data is `isRefetching` on the individual query
 * and deliberately invisible here, so revalidating never flashes a skeleton
 * over content the rider is reading.
 *
 * The first error wins rather than being collected. Two reads failing in the
 * same instant is one outage, and the screen has room for one message.
 */
export function combineQueries(...queries: readonly UseQueryResult<unknown>[]): {
  isLoading: boolean
  error: Error | null
  refetch: () => void
} {
  return {
    isLoading: queries.some((query) => query.isLoading),
    error: queries.find((query) => query.error !== null)?.error ?? null,
    refetch: () => {
      for (const query of queries) query.refetch()
    },
  }
}
