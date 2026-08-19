/**
 * Barrel for the query cache. Unlike `lib/data/` and `lib/actions/`, which
 * are organised by domain and imported file-by-file, this is one cohesive
 * utility with a small public surface — `import { useQuery, invalidate }
 * from '@/lib/query'` reads better than naming which internal file each
 * lives in.
 */
export { useQuery, type UseQueryOptions, type UseQueryResult } from '@/lib/query/useQuery'
export { combineQueries } from '@/lib/query/combine'
export {
  clearQueryCache,
  DEFAULT_STALE_TIME,
  getSnapshot,
  invalidate,
  setQueryData,
  type QueryKey,
  type QuerySnapshot,
} from '@/lib/query/queryClient'
