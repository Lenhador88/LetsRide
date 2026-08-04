'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bike, Home, MapPin, User } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Migrated v1 → v2 on contact (decision #4) because Home had to move from the
 * deleted `/dashboard` to `/postcards`. Colours and type are the verified v2
 * tokens; the *shape* — bar heights, icon size, whether the active tab is
 * tinted or underlined — is inferred, because the Figma nav frame could not be
 * opened. See docs/FIGMA-FIDELITY-TODO.md.
 *
 * The icons are still `lucide-react` and still v1. All five need replacing with
 * the `Element / Icon / *` set once it can be exported; that is one task, not
 * five, and is already registered. `Home` replaces `LayoutDashboard` here only
 * because the latter now names a screen that no longer exists.
 *
 * The design's five tabs are Home, Rides, Clubs, Inbox, Profile. Four of them
 * render here: Inbox has no route and no schema yet, so a tab for it would
 * 404. Friends is gone as of 013 — it was never in the design, and the tab and
 * the route were removed together so neither could strand the other.
 */
const navItems = [
  { href: '/postcards', label: 'Home', icon: Home },
  { href: '/rides', label: 'Rides', icon: MapPin },
  { href: '/clubs', label: 'Clubs', icon: Bike },
  { href: '/profile', label: 'Profile', icon: User },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <>
      <header className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center border-b border-border bg-surface px-4">
        <Link href="/postcards" className="flex items-center gap-2 font-semibold text-foreground">
          <Bike className="h-5 w-5" />
          <span>LetsRide</span>
        </Link>
      </header>

      <nav className="pb-safe fixed right-0 bottom-0 left-0 z-50 flex border-t border-border bg-surface">
        {navItems.map(({ href, label, icon: Icon }) => {
          // Exact match on the segment root, then a `/` boundary — plain
          // startsWith would light up Clubs for a hypothetical `/clubsomething`,
          // the same trap proxy.ts documents for `/legal`.
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              // min-h-11 is the 44px glove-friendly floor from CLAUDE.md.
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center gap-1 py-2 text-2xs font-medium transition-colors',
                active ? 'text-accent' : 'text-muted hover:text-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
