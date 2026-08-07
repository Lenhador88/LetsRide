import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { installSecureStore } from '@/lib/native/secure-store'
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
 * **One thing did move that the risk register misses, and it belongs here rather
 * than in a footnote.** The PKCE `code_verifier` was held in the *server*
 * client's httpOnly cookie jar, because the server asked for the recovery link.
 * The browser asks now, so the verifier lands in the same `localStorage` as the
 * session — genuinely JS-readable where it was not before. It is useless without
 * the emailed single-use code, so it is a small reduction rather than a hole,
 * but it is a reduction and "nothing got worse" would be the wrong summary.
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

/**
 * Reads one of the two `NEXT_PUBLIC_SUPABASE_*` variables, or fails with the
 * variable's name.
 *
 * These were `process.env.X!` — a non-null assertion, which TypeScript erases.
 * A missing variable therefore inlined as `undefined` and surfaced as
 * supabase-js's own `supabaseUrl is required`, from inside a dependency, on a
 * page that has nothing to do with configuration. `RouteGuard` mounts in the
 * root layout, so it fires during static prerendering and takes `next build`
 * down with a message naming neither the variable nor the environment.
 *
 * Not hypothetical: splitting the Vercel variables between the PROD and DEV
 * projects (2026-08-06) briefly left Preview holding the URL and not the key,
 * which is exactly this. The names are read explicitly rather than via a
 * variable because Next inlines `process.env.X` by literal match at build time
 * — `process.env[name]` is not substituted and would be `undefined` in the
 * browser however the deployment is configured.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Both NEXT_PUBLIC_SUPABASE_URL and ` +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined for every Vercel ' +
        'environment the app builds in — Production, Preview and Development. ' +
        'See docs/ENVIRONMENTS.md.'
    )
  }
  return value
}

export function createClient(): SupabaseClient {
  if (client) return client

  // Before `resolveSessionStore()`, and deliberately here rather than in a
  // layout or an effect: the store resolves once per page load and never
  // re-resolves, so anything that installs later loses to whichever client was
  // constructed first — silently, with the session in `localStorage`. This is
  // the only call site that cannot be beaten to it. A no-op off-native.
  installSecureStore()

  client = createSupabaseClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
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
