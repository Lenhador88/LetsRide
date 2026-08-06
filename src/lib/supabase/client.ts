import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveSessionStore } from '@/lib/supabase/session-store'

/**
 * The one Supabase client this app has.
 *
 * ## Why `@supabase/supabase-js` and not `@supabase/ssr`
 *
 * `createBrowserClient` stored the session in cookies, and cookies existed so a
 * *server* could read it back — `proxy.ts` on every request, and every server
 * component through `lib/supabase/server.ts`. Group 6 deleted both. There is no
 * server left to hand a cookie to, and the app is becoming a native bundle where
 * there is no cookie jar at all.
 *
 * So the session moves to `session-store.ts`: the device secure store when the
 * native shell provides one, an explicitly-labelled `localStorage` otherwise
 * (tasks 4.1 and 4.2). That module owns the choice *and the naming of the
 * choice* — `describeSessionStore()` exists because "the browser build stores
 * tokens where JS can read them" is a claim the product owner accepted
 * explicitly, and a build that silently degraded from `secure` to `local` would
 * otherwise be indistinguishable from one that did not.
 *
 * **This is not an increase in exposure, and the risk register was wrong about
 * it.** `design.md` §Risks opens with "the refresh token becomes JS-readable",
 * presented as something this migration causes. It was already JS-readable:
 * `@supabase/ssr` set `sb-<ref>-auth-token` with `httpOnly=false`, because the
 * browser client had to read the session back out of `document.cookie`.
 * Measured with a real sign-in. What changes is the *store*, not the exposure —
 * and in a native shell the new store is strictly better.
 *
 * ## Memoised, and it has to be
 *
 * `resolveSupabase()` calls this on every read and every write, so an
 * un-memoised factory would build a fresh `GoTrueClient` per query — each with
 * its own auto-refresh timer, all contending on the same storage key and the
 * same `navigator.locks` name. `createBrowserClient` memoised internally, so
 * dropping it without replacing that is the kind of regression that surfaces as
 * intermittent hangs rather than as an error.
 *
 * ## `flowType: 'pkce'`, stated rather than inherited
 *
 * `@supabase/ssr` hardcoded PKCE; plain supabase-js defaults to implicit.
 * Password recovery depends on PKCE — `resetPasswordForEmail` stores a
 * `code_verifier` in this client's storage and `/auth/callback` exchanges it
 * back — so the default would silently break the one flow that cannot be
 * exercised by signing in.
 *
 * `detectSessionInUrl` is **off** deliberately. Left on, supabase-js exchanges a
 * `?code=` on whatever page happens to load carrying one, racing the explicit
 * exchange `/auth/callback` performs — and only the explicit one can decide
 * where to send the rider afterwards, or tell them the link had expired.
 */
let client: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (client) return client

  client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: resolveSessionStore().store,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    }
  )

  return client
}

/** Test seam, matching `resetSessionStoreForTests`. Nothing in the app calls it. */
export function resetClientForTests(): void {
  client = null
}
