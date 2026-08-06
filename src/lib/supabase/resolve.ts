import type { createClient } from '@/lib/supabase/client'

/**
 * The one Supabase client every `src/lib/data/` read and every
 * `src/lib/actions/` write resolves at call time.
 *
 * ## What this used to be, and why the shape is worth keeping
 *
 * Through groups 3 to 5 this was a *conditional* doorway. The 19 read functions
 * had to work from a server component today and from a client component after
 * the render migration, without changing a signature — so the environment was
 * resolved here, once, rather than threaded through nineteen call sites. The
 * discriminator was the **`react-server` export condition**, declared as the
 * `#supabase/data-client` subpath import in `package.json`, with halves
 * `resolve.rsc.ts` and `resolve.browser.ts`.
 *
 * Group 6 removed the server half, so the condition has nothing left to
 * discriminate and both it and the import map are gone. **The indirection is
 * not.** Every caller still goes through this one name, and that is what made
 * the whole migration a change to one file instead of to twenty-nine `.from()`
 * call sites — the property worth keeping whatever replaces the client next: a
 * Capacitor-provided one, a test double, a second project.
 *
 * The measurement that shaped it is worth carrying forward even though the code
 * it justified is deleted, because it will otherwise be rediscovered the
 * expensive way. `lib/supabase/server.ts` imported `next/headers`, and Next
 * refuses to bundle that into a client graph **whether or not the branch
 * importing it can ever be taken**. A `typeof document` guard around a dynamic
 * `import()` does not help, because the bundler resolves the specifier
 * statically. That is why the split was ever a build-time condition rather than
 * a runtime `if`.
 *
 * ## The one rule that outlives the server half
 *
 * **Read in an effect or an event handler, never during render.** A `'use
 * client'` component is *still server-rendered* by Next — group 6 retired the
 * server *data* path, not the SSR pass, which goes with the native shell — and
 * in that pass the browser client has no `localStorage` to find a session in. A
 * read issued from a component body is therefore anonymous, and `anon` holds
 * zero grants, so it fails closed at RLS.
 *
 * `resolve.browser.ts` throws a named error when that happens, which is what
 * turns a silent empty screen into a build failure: static prerendering runs the
 * SSR pass, so a page that gets it wrong fails `next build` with the message
 * rather than failing in production. `useQuery` obeys the rule by construction —
 * it only ever fetches inside `useEffect`.
 */
export { resolveSupabase } from '@/lib/supabase/resolve.browser'

/**
 * The client type the data layer's internal helpers pass around.
 *
 * Previously each of `clubs.ts`, `media.ts`, `postcards.ts` and `rides.ts`
 * declared its own `type SupabaseServerClient = Awaited<ReturnType<typeof
 * createClient>>`, which pinned four private aliases to the *server* client's
 * identity. One name, one place, and it no longer says "server" — because there
 * is not one.
 */
export type DataClient = Awaited<ReturnType<typeof createClient>>
