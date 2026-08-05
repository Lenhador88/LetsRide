import { createClient } from '@/lib/supabase/client'

/**
 * The default half of `#supabase/data-client` — every graph that is not
 * `react-server`, which means a client component in the browser *and* the same
 * component during Next's SSR pass. See `resolve.ts`.
 *
 * **The `document` check is not an environment switch; it is a tripwire.** The
 * export condition already decided which client this is. What it cannot decide
 * is *when* a client component asked, and there is exactly one wrong answer:
 * during render, on the server, where `createBrowserClient` finds no
 * `document.cookie`, builds a session-less client, and — with `anon` holding
 * zero grants — fails closed at RLS on every read. That failure is silent, and
 * arrives as an empty screen or a `42501` a long way from its cause.
 *
 * Throwing restores the loudness that moving to a build-time condition cost.
 * Before this change a `'use client'` page importing a read function failed
 * `next build` outright, because `next/headers` was reachable from a client
 * graph. Now it builds — which is the entire point — so this is what turns "read
 * during render" back into an error you meet immediately. Static prerendering
 * runs the SSR pass, so a page that gets it wrong still fails the build rather
 * than production.
 */
export async function resolveSupabase() {
  if (typeof document === 'undefined') {
    throw new Error(
      'lib/data was read during a server render of a client component. There is no ' +
        'session there, so the read would fail closed at RLS. Move the read into an ' +
        'effect or an event handler — see src/lib/supabase/resolve.ts.'
    )
  }

  return createClient()
}
