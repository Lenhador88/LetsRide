import type { Metadata, Viewport } from 'next'
import { Poppins } from 'next/font/google'
import { RouteGuard } from '@/components/auth/RouteGuard'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-poppins',
})

export const metadata: Metadata = {
  title: 'LetsRide — Ride Together',
  description: 'Plan motorcycle rides, join clubs, and ride with your crew.',
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
