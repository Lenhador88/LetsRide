/**
 * The route shapes that shipped before PD-142, and the one mapping that turns
 * each of them back into a route this app still has.
 *
 * ## Why this is a module rather than a list inside `next.config.ts`
 *
 * It had exactly one reader until universal links existed: `next.config.ts`
 * turns it into `redirects()`, so `app.letsride.social/postcards/<uuid>` — the
 * shape `ShareButton` handed out before PD-142 — resolves on the web. A static
 * export has no server, so that redirect is web-only by construction, and
 * inside the shell the same URL resolved to nothing. That was harmless while
 * nothing could deliver such a URL to the shell.
 *
 * **Universal links are what deliver it** (PD-205). Once
 * `apple-app-site-association` is served, a legacy link sitting in somebody's
 * WhatsApp opens the *installed app* instead of Safari, and the server redirect
 * that used to rescue it never runs. Without the mapping below, shipping
 * universal links would make those links **worse** than leaving them in the
 * browser: `boot-restore.ts` would drive the webview at a path the bundle never
 * prerendered, and its own loop guard would bound the failure at a blank
 * screen. So the two readers have to agree, and the only way to make them agree
 * is to give them one table.
 *
 * ## Constrained to a UUID, in both readers, for the same reason
 *
 * `next.config.ts`'s own header carries the measurement: an unconstrained
 * `/rides/:id` swallows `/rides/new`, `/clubs/:id` swallows `/clubs/explore`,
 * and `/rides/:id` swallows `/rides/detail` itself, sending every detail screen
 * to `/rides/detail?id=detail` in a loop. The pattern below is what stops that,
 * and `scripts/native/export-guards.mjs` asserts it against what Next actually
 * compiled rather than against this file.
 *
 * ## This file imports NOTHING, and that is the constraint
 *
 * `next.config.ts` imports it with a **relative** specifier, for the reason its
 * header gives about `--experimental-next-config-strip-types`: Node's native
 * type stripping does no path mapping, so an `@/` import here would not
 * resolve. **The real rule is stronger than "no `@/` imports", which is why it
 * is stated this way:** anything this file imports becomes a dependency of the
 * *build configuration*, loaded before the app is compiled, under a loader that
 * does no resolution of its own. Keep it at zero and the question never arises.
 * A violation reds `next build`, which CI runs, so this needs no tripwire test.
 */

/** The id shape every legacy detail URL carried. */
export const LEGACY_UUID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/**
 * `[base, tail]` for every detail URL that used to name its id in the path.
 *
 * `/postcards/<uuid>` → `/postcards/detail?id=<uuid>`, and so on. The ride chat
 * is deliberately **not** here — it is retired rather than moved, so its
 * destination is not `${base}/detail${tail}` and folding it in would produce a
 * redirect to a route that no longer exists. `RETIRED_CHAT_ROUTES` holds it.
 */
export const LEGACY_DETAIL_ROUTES: readonly (readonly [string, string])[] = [
  ['/postcards', ''],
  ['/rides', ''],
  ['/rides', '/crew'],
  ['/rides', '/edit'],
  ['/clubs', ''],
  ['/clubs', '/rides'],
  ['/clubs', '/members'],
  ['/clubs', '/about'],
  ['/clubs', '/edit'],
]

/**
 * The two shapes the retired ride chat shipped under — `108`, PD-402.
 *
 * Both land on the ride itself. A specific old thread cannot be resolved, `109`
 * having dropped the messages, and the ride's timeline is where the
 * conversations now are.
 */
export const RETIRED_CHAT_ROUTES = {
  /** The pre-PD-142 path-segment form: `/rides/<uuid>/chat`. */
  withId: '/rides',
  /** The form the app itself shipped until PD-402: `/rides/detail/chat`. */
  detail: '/rides/detail/chat',
} as const

/**
 * Where a legacy `pathname` should resolve, or `null` when it is not a legacy
 * shape at all.
 *
 * **A pure function on the pathname alone**, so it can answer inside the shell,
 * where there is no server and no `redirects()`. `null` means "this is an
 * ordinary route" — the overwhelmingly common answer, and the one that must not
 * rewrite anything.
 *
 * `search` is carried through on every arm, because Next appends an unspecified
 * incoming query to a redirect destination and the two readers must agree. It
 * is load-bearing for the retired-chat case, where `/rides/detail/chat?id=<uuid>`
 * has the id in the query already and nowhere else.
 *
 * **`search` is `URL.search`'s shape** — empty, or `?`-prefixed — and it is
 * normalised rather than assumed. The bare-string form is not reachable from
 * today's one caller, but this module has a second reader and a stated contract
 * that the two agree, so a caller passing `utm=x` gets `&utm=x` rather than a
 * destination with the parameter glued onto the id.
 */
export function legacyRouteTarget(pathname: string, search = ''): string | null {
  const uuid = new RegExp(`^(${LEGACY_UUID_PATTERN})$`)
  // Normalised rather than assumed: `?utm=x`, `utm=x` and `` all have to reach
  // the same destination, because a stripped `?` would otherwise glue the
  // parameter onto the id — `?id=<uuid>utm=x`.
  const params = search === '' || search === '?' ? '' : search.replace(/^\?/, '')
  /** Appended to a destination that already carries `?id=`. */
  const extra = params === '' ? '' : `&${params}`
  /** Appended to a destination that carries no query of its own. */
  const query = params === '' ? '' : `?${params}`

  if (pathname === RETIRED_CHAT_ROUTES.detail) {
    // The only arm whose destination has no `?id=` of its own — the id is in
    // the incoming query already, which is the whole point of this shape.
    return `/rides/detail${query}`
  }

  for (const [base, tail] of LEGACY_DETAIL_ROUTES) {
    // `/clubs/<uuid>/members` splits into a fixed head, the id, and a fixed
    // tail. Matching on the segments rather than with one big regex keeps the
    // id pattern as the only thing being tested, so a base or tail containing a
    // regex metacharacter could never widen the match.
    const prefix = `${base}/`
    if (!pathname.startsWith(prefix)) continue
    const rest = pathname.slice(prefix.length)
    const id = tail === '' ? rest : rest.endsWith(tail) ? rest.slice(0, -tail.length) : null
    if (id === null || !uuid.test(id)) continue
    // The incoming query rides along, because Next forwards unspecified query
    // params to a redirect destination and the two readers have to agree. Drop
    // it here and `/postcards/<uuid>?utm=x` keeps its `utm` on the web and
    // loses it in the shell — the exact divergence this shared table exists to
    // prevent. `id` is written first, so it wins `searchParams.get('id')` even
    // if the incoming query carries one of its own.
    return `${base}/detail${tail}?id=${id}${extra}`
  }

  const chatPrefix = `${RETIRED_CHAT_ROUTES.withId}/`
  const chatSuffix = '/chat'
  if (pathname.startsWith(chatPrefix) && pathname.endsWith(chatSuffix)) {
    const id = pathname.slice(chatPrefix.length, -chatSuffix.length)
    if (uuid.test(id)) return `/rides/detail?id=${id}${extra}`
  }

  return null
}
