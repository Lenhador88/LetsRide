/**
 * Turns a failed read into a thrown error instead of an empty result.
 *
 * Every read function in this directory used to write
 * `const { data } = await query; return data ?? []`, which is not a default —
 * it is a lie. "No postcards exist" and "the query failed" are different
 * answers, and collapsing them means the feed renders its empty state to every
 * rider with nothing in the logs.
 *
 * That is not hypothetical. Migration 011 added a `comments_count` embed on
 * `postcard_comments`; deploying that code before the table existed would have
 * failed the whole feed query in PostgREST, and the home screen would have said
 * "No postcards yet" rather than erroring. CI was green either way. The hazard
 * was caught by reading the code, which is the wrong thing to have to rely on.
 *
 * Throwing is the honest failure. A server component that cannot answer should
 * not pretend the answer is nothing — `src/app/(app)/error.tsx` catches it and
 * offers a retry, which is a truthful screen.
 *
 * Structural type rather than `PostgrestError` so this file imports nothing
 * from `@supabase/supabase-js` — the same reason `columns.ts` stays
 * import-free.
 */
type QueryResult<T> = {
  data: T | null
  error: { message: string; code?: string; details?: string | null } | null
}

export class DataReadError extends Error {
  readonly code?: string

  constructor(what: string, cause: { message: string; code?: string; details?: string | null }) {
    super(`Could not read ${what}: ${cause.message}${cause.code ? ` (${cause.code})` : ''}`)
    this.name = 'DataReadError'
    this.code = cause.code
  }
}

/**
 * `what` is a human phrase used in the message — "the postcard feed", "your
 * clubs". It is what a person reading a Vercel log sees first, so it should say
 * which read failed, not which function did.
 */
export function unwrap<T>(result: QueryResult<T>, what: string): T | null {
  if (result.error) throw new DataReadError(what, result.error)
  return result.data
}

/** The list form: a failed read throws, an empty result is genuinely empty. */
export function unwrapList<T>(result: QueryResult<T[]>, what: string): T[] {
  if (result.error) throw new DataReadError(what, result.error)
  return result.data ?? []
}
