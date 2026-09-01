'use client'

import { useEffect } from 'react'

import { reportError } from '@/lib/observability/sentry'

/**
 * The root layout itself throwing — the one failure no other boundary can see.
 *
 * `error.tsx` catches what is rendered *below* the layout it sits in, so a
 * throw in `layout.tsx` (or in `RouteGuard`/`UpdateGate`, which it renders
 * directly) escapes every boundary in the app. Next's answer is this file, and
 * it comes with a hard constraint: **it replaces the root layout**, so it has
 * to render its own `<html>` and `<body>` and it cannot use anything the layout
 * provides.
 *
 * ## Why this is inline styles and not the design system
 *
 * `globals.css` is imported by the root layout. This renders *instead of* that
 * layout, in the exact case where the layout did not survive its own render, so
 * neither the Tailwind stylesheet nor the `next/font` class on `<html>` can be
 * relied on. A `className="text-muted"` here would be unstyled text on a white
 * page precisely when it fired — which is the failure this file exists to stop,
 * wearing the design system's clothes.
 *
 * So the values are written out. **They are the v2 tokens, not new colours**:
 * `#F2ECE6` is `Grey/5` (`--color-background`), `#1A1A1A` is `Grey/100`
 * (`--color-foreground`, and the primary button fill — near-black, never
 * green), `#666666` is `Grey/80` (`--color-muted`), and white-on-`#1A1A1A` is
 * the existing primary-button pairing. No pairing here is new, so nothing here
 * needs a contrast check that `design/TOKENS.md` has not already had.
 *
 * There is no `reset` affordance beyond a reload: `reset()` re-renders the same
 * root layout that just failed, and `router.refresh()` needs a router this tree
 * does not have. A reload is the honest control, and it is also the one that
 * recovers from a stale or half-fetched chunk, which is the likeliest cause of
 * a root layout failing on a device.
 *
 * Silent about *why*, like every other error surface here. The digest is the
 * exception, for the reason `(app)/error.tsx` gives.
 *
 * ## It reports, and until PD-315 it did not even log
 *
 * This was the one boundary that did nothing at all with the error object — not
 * even a `console.error` — so the single failure no other boundary can see was
 * also the only one leaving no trace anywhere. It reports under
 * `boundary: 'global'`, which is worth separating in the issue list: everything
 * else here is one screen failing, and this is the app not starting.
 *
 * **One residual, stated because it looks covered and is not.** Reporting is
 * started by a module the root layout imports, so it is running by the time any
 * *render* fails. A failure to load that chunk in the first place is earlier
 * than that, and nothing in a client bundle can report it — the reporter is in
 * the bundle. Vercel's own logs are the only witness to that case, and in the
 * shell there is none.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error('The root layout failed to render:', error)
    reportError(error, { boundary: 'global', digest: error.digest })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          backgroundColor: '#F2ECE6',
          color: '#1A1A1A',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: '2.25rem', fontWeight: 600 }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: '1.25rem', color: '#666666' }}>
          We could not start the app. It is usually temporary — try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            height: '2.5rem',
            padding: '0 1rem',
            borderRadius: '0.5rem',
            border: 'none',
            backgroundColor: '#1A1A1A',
            color: '#FFFFFF',
            fontSize: '0.875rem',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ margin: 0, fontSize: '0.625rem', lineHeight: '1rem', color: '#666666' }}>
            Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
