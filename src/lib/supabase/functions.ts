import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * The one place `lib/actions/` reaches to tell an Edge Function's own JSON
 * error body apart from a transport failure — `resolve.ts`'s sibling
 * doorway, so `@supabase/supabase-js` is imported directly here and nowhere
 * outside `lib/supabase/` (CLAUDE.md §What Not To Do).
 *
 * `supabase.functions.invoke()` returns `{ error }` for three different
 * failure shapes (`FunctionsHttpError`, `FunctionsRelayError`,
 * `FunctionsFetchError`), and only the first carries a response the function
 * itself wrote — `error.context` is the raw `Response`. This reads the JSON
 * body's `error` field off that response, and returns `null` for anything
 * that is not one: a network failure, a relay error, or a body that failed
 * to parse. The caller's job is to treat `null` as the same retryable
 * failure regardless of which of those three produced it.
 */
export async function edgeFunctionErrorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null

  try {
    const body = (await error.context.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
