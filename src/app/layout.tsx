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
 * Only `<meta name="description">` is emitted — there is no OpenGraph block, so
 * an unfurler reading `og:*` alone shows no description at all.
 */
export const metadata: Metadata = {
  title: 'LetsRide — Ride Together',
  description: 'Find people to ride with, join a club, and plan your next motorcycle ride.',
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
