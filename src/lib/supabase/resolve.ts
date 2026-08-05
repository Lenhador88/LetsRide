import { resolveSupabase } from '#supabase/data-client'

/**
 * The one Supabase client every `src/lib/data/` read resolves at call time.
 *
 * **Why this exists.** The app is migrating to a client-rendered shell (see
 * CLAUDE.md §Technology Decisions). The 19 read functions in `lib/data/` have to
 * keep working from a server component *today* and from a client component
 * *after* the render migration, without changing a single signature — that
 * boundary staying still is the whole reason the migration is bounded. So the
 * environment is resolved here, once, rather than being threaded through
 * nineteen call sites.
 *
 * ## How the environment is decided — and why not the way the plan said
 *
 * `design.md` D1 specifies a **runtime** test: "the server client when there is
 * no `document`, the browser client when there is". **That does not build**, and
 * the reason is worth carrying forward rather than rediscovering.
 *
 * `lib/supabase/server.ts` imports `next/headers`, which Next refuses to bundle
 * into a client graph. Guarding it behind `typeof document === 'undefined'` and
 * a dynamic `await import()` does not help: the bundler resolves the import
 * statically, so the module lands in the client graph regardless of whether the
 * branch can ever be taken there. Measured on Next 16.2.9 / Turbopack — a `'use
 * client'` page importing one read function fails the build with import traces
 * through **both** `[Client Component Browser]` and `[Client Component SSR]`.
 * A runtime branch cannot fix a build-time reachability rule.
 *
 * So the split is made where the bundler makes it: the **`react-server` export
 * condition**, via the `#supabase/data-client` subpath import declared in
 * `package.json`. Next applies that condition to every server layer — server
 * components, Server Actions and Route Handlers — and to neither client layer.
 * The two halves are `resolve.rsc.ts` and `resolve.browser.ts`, and each is
 * compiled only into the graph that can run it.
 *
 * The intent D1 argues for is unchanged, and so is everything it rules out:
 * nineteen signatures stay still, no `data/server/` + `data/client/` pair, no
 * client passed as a first argument. What changed is that the discriminator is
 * resolved at build time instead of at runtime, which is strictly better here —
 * `next/headers` never reaches the browser bundle at all, rather than reaching
 * it behind a branch.
 *
 * ## What each layer gets
 *
 * | Layer | Condition | Client |
 * |---|---|---|
 * | Server component | `react-server` | server (cookie session) |
 * | Server Action | `react-server` | server — `actions/onboarding.ts` calls `isUsernameTaken` |
 * | Route Handler | `react-server` | server |
 * | Client component, browser | — | browser |
 * | Client component, SSR pass | — | browser, with no session |
 *
 * The last row is the one to know about. A `'use client'` component is still
 * server-rendered by Next until Phase 6, and in that pass the browser client
 * constructs fine but has no `document.cookie` to read a session from — so a
 * read issued from a component *body* is anonymous, and `anon` holds zero
 * grants, so it fails closed at RLS. **Read in an effect or an event handler,
 * never during render.** That is the normal shape for client data fetching
 * anyway; it is written down because the failure is a runtime one that `tsc`,
 * ESLint and `next build` all stay green through — the same class of failure
 * that shipped `/postcards/new` dead.
 *
 * The server half dies in Phase 6 with `lib/supabase/server.ts`, not before: 18
 * server pages and 26 server components still call this layer.
 */
export { resolveSupabase }

/**
 * The client type the data layer's internal helpers pass around.
 *
 * Previously each of `clubs.ts`, `media.ts`, `postcards.ts` and `rides.ts`
 * declared its own `type SupabaseServerClient = Awaited<ReturnType<typeof
 * createClient>>`, which pinned four private aliases to the *server* client's
 * identity. One name, one place, and it no longer says "server" — because after
 * this change it is not one.
 */
export type DataClient = Awaited<ReturnType<typeof resolveSupabase>>
