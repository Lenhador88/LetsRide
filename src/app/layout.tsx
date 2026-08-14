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
 * **This description is the only pitch the app ever makes.** Every page is
 * `'use client'`, and Next refuses a `metadata` export from a client module, so
 * every screen inherits these two strings — including the postcard, ride and
 * club URLs that `ShareButton` puts into someone's messages. The unfurl a
 * non-rider sees is this, and the screen they land on is a bare `Login` form
 * (decision #1), so nothing downstream gets a second chance to explain the app.
 *
 * It is therefore written for the rider who arrives with **nobody**, which is
 * the majority of anyone reaching a shared link. The previous line ended "ride
 * with your crew" and presupposed the one thing they came here to find.
 *
 * "Join a club" stays because it is not a feature among three — it is the only
 * discovery path the app actually has. `getRides` scopes to organised, joined
 * and club rides with no public browse, so a club is how a rider with no
 * contacts reaches anything at all. Copy that demoted it would be aspirational
 * rather than true.
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
