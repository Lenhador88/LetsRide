import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * The one deliberate exception to decision #1 (no anonymous access): a rider
 * has to be able to read these before completing signup. Static copy only —
 * these pages read no data, and `/legal/*` is one of the public paths in
 * `src/lib/auth/guard.ts`. Protection is a denylist of those, not an allowlist
 * of protected routes, so a new route is gated unless it is added there.
 */

/**
 * **`/legal/terms` publishes a home address, so this segment must not be
 * indexed** (PD-459, PD-462).
 *
 * The operator disclosure art. 3:15d BW requires is a legal name and a
 * geographic address, and the product owner's is a residence rather than a
 * service address. "Public" and "crawlable" are not the same exposure and only
 * one of them is reversible: a search result and an archive outlive the
 * decision that put the string there, and PD-462 is precisely the decision that
 * may take it back out. The clock on that starts at **merge**, not at store
 * submission.
 *
 * **Where the address actually is, measured rather than assumed** — because the
 * obvious answer is wrong and would send the next reader looking in the wrong
 * file. `RouteGuard` renders the splash during the prerender pass, so
 * `.next/server/app/legal/terms.html` holds the shell and **not** the page
 * body: `grep -c "Willem Claijstraat" .next/server/app/legal/terms.html` is 0.
 * The string is in a static JS chunk (`.next/static/chunks/*.js`, one
 * occurrence), which is served to anyone and which a JS-executing crawler
 * renders exactly as a rider's browser does. So "it is not in the HTML" is true
 * and is not reassurance.
 *
 * It is also why this directive works as well as it does: the `noindex` is in
 * the **shell's** head, which a crawler reads before deciding whether to render
 * the page at all.
 *
 * **`index: false` does not make the pages unreachable, which is the point** —
 * App Store Review Guideline 1.2 and Play's User Data policy both want these
 * URLs openable by a reviewer, and both still are. Nothing here has any reason
 * to rank in a search engine.
 *
 * Same shape and same reasoning as `src/app/rides/join/layout.tsx` (`115`,
 * PD-430): `object.robots` on the SEGMENT rather than a hand-written meta tag
 * on one page, so it covers every page under `/legal/` including ones nobody
 * has written yet, and does not depend on what any of them happens to render.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto flex max-w-[358px] flex-col gap-6">
        <Link href="/auth/signup" className="text-sm font-medium text-muted">
          Back
        </Link>
        <article className="flex flex-col gap-4 text-sm text-foreground">{children}</article>
      </div>
    </div>
  )
}
