'use client'

import { initErrorReporting } from '@/lib/observability/sentry'

/**
 * Where error reporting starts — PD-315.
 *
 * ## Module scope, not an effect, and this is the one place that is right
 *
 * `CLAUDE.md` §Technology Decisions says to read in an effect and never during
 * render. That rule is about **Supabase reads**: a read issued from a component
 * body runs in the SSR pass with no `localStorage` to find a session in, so it
 * is anonymous, and `anon` holds zero grants, so it fails closed at RLS.
 * `initErrorReporting` reads nothing, touches no database and holds no session
 * — it installs `window.onerror` — so none of that applies, and it guards
 * `typeof window` itself for the prerender pass.
 *
 * What module scope buys is the window an effect cannot cover. A client chunk
 * evaluates before React's first render; an effect runs after the first commit.
 * A throw *between* those two points takes the whole app down — it is the exact
 * failure `global-error.tsx` exists for — and an effect that never ran because
 * the render before it threw cannot report the throw that stopped it. Wiring
 * this in an effect would leave the single most important error class silently
 * unreported while looking completely correct.
 *
 * ## Why a component at all, if the work happens at import time
 *
 * Two reasons, and the second is the one that matters. A bare
 * `import '@/lib/observability/boot'` in the layout is legal and is what a
 * bundler is entitled to treeshake, since it has no observable value — and the
 * failure mode of that is, again, a feature that silently does nothing.
 * Rendering an element makes the import load-bearing. It is also the mount
 * point analytics needs (PD-353), which genuinely does run in an effect,
 * because it waits on a round trip.
 *
 * Renders `null`: there is nothing to draw, and it must never be able to affect
 * layout. It sits **outside** `RouteGuard` in the root layout so that a throw
 * inside the guard itself — which renders on every route, signed in or out — is
 * already being watched by the time it happens.
 */
initErrorReporting()

export function Observability() {
  return null
}
