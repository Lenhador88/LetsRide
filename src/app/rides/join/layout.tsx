import type { Metadata } from 'next'

/**
 * `noindex, nofollow` for `/rides/join` — `115`, PD-430, `anonymous-ride-preview`'s
 * own requirement.
 *
 * ## Why a segment `layout.tsx` and not the page itself
 *
 * `page.tsx` is `'use client'`, and Next refuses a `metadata` export from a
 * client module — `src/app/layout.tsx`'s own header names this as the reason
 * every `metadata` export in this app lives in a layout rather than a page. A
 * route-segment `layout.tsx` need not be a client component, and this one holds
 * no state and reads nothing, so it stays a plain server component: `metadata`
 * is evaluated once, at build or request time, with no session to read either
 * way.
 *
 * ## Why this needed its own requirement rather than inheriting one
 *
 * Until `115` every route but `/auth/*` and `/legal/*` required a session, so a
 * crawler fetching anything got a shell with no data on it — `/rides/join`
 * rendered the generic invite sentence to anyone with no session. That
 * protection was an accident of the authenticated wall, not a property of this
 * route, and `115` removes the wall from exactly this one screen for a visitor
 * holding a live token. A property that held for another reason does not keep
 * holding on its own once that reason is gone.
 *
 * ## What this does and does not defend against
 *
 * The token is 32 random hex characters and there is no link to
 * `/rides/join?token=…` anywhere in the app or on the marketing site, so a
 * crawler cannot *walk* to a preview — that is the token's entropy, and this
 * directive is not a substitute for it. What it answers is a link somebody
 * *published*: pasted into a public forum, a shared document that gets
 * indexed, a chat export. `noindex, nofollow` is what stops that one published
 * URL from becoming a permanently searchable page naming a ride, its time and
 * its meeting point long after the link itself has expired or been revoked.
 *
 * **Present unconditionally, not only when a preview renders** — `object.robots`
 * form rather than a hand-written meta tag, so Next emits it on every request
 * to this segment regardless of whether the token is live, dead, absent or
 * malformed: the directive must not depend on which of those the page draws.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function RideJoinLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
