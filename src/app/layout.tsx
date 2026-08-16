import type { Metadata, Viewport } from 'next'
import { Poppins } from 'next/font/google'
import { RouteGuard } from '@/components/auth/RouteGuard'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-poppins',
})

/**
 * **Every screen inherits this**, so it is also what unfurls when `ShareButton`
 * puts a postcard URL into someone's messages — postcards being the only
 * surface with a share affordance today. Nothing overrides it:
 * `git grep -ln "export const metadata\|generateMetadata" -- 'src/app/**\/*.tsx'`
 * names this file alone, because every page is `'use client'` and Next refuses a
 * `metadata` export from a client module. That is the reason today rather than a
 * guarantee — a route-segment `layout.tsx` need not be a client module, and two
 * of the three are not.
 *
 * The reader is therefore a rider who is not on LetsRide yet, and decision #1
 * lands them on `/auth/login`, which passes no `body` to `AuthScreen` and so
 * pitches nothing. Hence copy written for someone arriving with **nobody**,
 * rather than for someone who already has a crew to ride with.
 *
 * ## The OpenGraph block
 *
 * The two strings are constants because they are now written twice. Next does
 * not copy `title`/`description` into `openGraph`, and a hand-kept second copy
 * of a sentence is a sentence that drifts — an unfurler prefers `og:*`, so the
 * *stale* half would be the one riders actually read.
 *
 * **There is deliberately no `og:url`.** It is the one OpenGraph field that must
 * not be set from a root layout: it declares the canonical URL of the page being
 * unfurled, every screen inherits this object, and so a value here would tell
 * every crawler that a shared postcard link is really the site root. Some
 * unfurlers follow it and preview the wrong page. Omitted, they describe the URL
 * they actually fetched, which is correct for all 31 of them.
 *
 * `og:locale` is omitted for a different reason: i18n is on CLAUDE.md's
 * deliberately-undecided list, and picking `en_US` over `en_GB` here would be
 * inventing the answer in the least visible place available.
 */
const TITLE = 'LetsRide — Ride Together'
const DESCRIPTION = 'Find people to ride with, join a club, and plan your next motorcycle ride.'

/**
 * **`canonicalOrigin()` cannot serve this, and the difference is not cosmetic.**
 * That function resolves `window.location.origin` on the web, and `metadata` is
 * evaluated on the server — during the prerender pass, where there is no
 * `window` to read. Its configured override cannot stand in either: a web build
 * *refuses* `NEXT_PUBLIC_CANONICAL_ORIGIN` (`next.config.ts`), so on every host
 * that serves this app there is no configured value to fall back to.
 *
 * So this is the one origin in `src/` that has to be resolved at build time.
 * Vercel's own value is preferred because it follows a domain move with no code
 * change, which is the property §Branching & CI's zero-hardcoded-origin claim
 * exists to protect. The literal is a floor, not the answer: exposing system
 * environment variables is a dashboard setting, and CLAUDE.md's rule is that
 * code reads a dashboard setting rather than trusting it.
 *
 * A hardcoded floor is tolerable *here specifically* and would not be in
 * `ShareButton` or `signUp`. Those build URLs a rider is sent to, where a wrong
 * origin is a dead link in an email nobody sees fail. This builds a URL a
 * crawler fetches for a static brand asset that is byte-identical on every
 * deployment — so a Preview pointing at production's copy is correct rather than
 * merely harmless.
 */
const SHARE_ORIGIN = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://app.letsride.social'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(SHARE_ORIGIN),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'LetsRide',
    type: 'website',
    images: [
      {
        url: '/brand/og-card.png',
        width: 1200,
        height: 630,
        // Describes the artwork rather than repeating the title, which is
        // already rendered as live text beside it in every unfurl.
        alt: 'The LetsRide logo — a motorcycle seen head-on, in white on green.',
      },
    ],
  },
  twitter: {
    // `summary_large_image` rather than `summary`: the card is 1.91:1 artwork,
    // and `summary` crops it to a small square thumbnail.
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/brand/og-card.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#F2ECE6',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${poppins.variable}`}>
      <body className="min-h-full bg-background text-foreground font-sans antialiased">
        {/* The root layout and not `(app)`'s, because three of the rules the
            guard enforces are about paths outside that group: bouncing a
            signed-in rider off /auth/login, sending an un-onboarded one into
            the wizard, and resolving /. */}
        <RouteGuard>{children}</RouteGuard>
      </body>
    </html>
  )
}
