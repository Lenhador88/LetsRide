'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BikeIcon, ClubsIcon, HomeIcon, ProfileIcon } from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Navigation / Bar`, measured from the committed snapshot.
 *
 * Two heights in the design, and which one you get is per screen: 88px for the
 * bar alone, 152px when a screen supplies the sticky primary action that sits
 * above the tabs (44 frames use the first, 27 the second). `action` is that slot.
 *
 * The icons are the real `Element / Icon / *` set now that the snapshot can export
 * them — `lucide-react` lookalikes are gone from this file (decision #4).
 *
 * Selected is **Grey/100 with no background**, not the brand green this file used
 * to apply; green is an accent and never the active-tab colour. Pressed is the
 * only state with a fill (Grey/10%). Read off `Navigation / Bar / Tile`'s three
 * State variants.
 */
/**
 * **Four tabs, and Inbox is deliberately not one of them.** It shipped as a
 * fifth, disabled tab — no route, no tables — on the reasoning that the design
 * draws five and a link to a 404 is worse than an inert tile. The product owner
 * removed it on 2026-08-06 for store submission: App Store guideline 4.2 asks
 * whether the app is more than a repackaged website, and a reviewer taps every
 * tab. A tab that announces "not built yet" answers that question badly, and it
 * is the one screen a reviewer cannot avoid finding.
 *
 * **This is not a decision the design settles**, which is why removing it is
 * defensible rather than a fidelity regression: the frames draw three different
 * bars — `Home - Postcards - All new` has 5 tiles, the profile frame 3, and
 * `Rides - All rides` has no bar at all (counted, `docs/FIGMA-FIDELITY-TODO.md`
 * §Profile). A value with three shapes across three frames was never a spec.
 *
 * Inbox comes back with the epic that builds it — the route, the tables and the
 * `realtime` work — not before. Do not re-add the tile ahead of them.
 */
const navItems = [
  { href: '/postcards', label: 'Home', Icon: HomeIcon },
  { href: '/rides', label: 'Rides', Icon: BikeIcon },
  { href: '/clubs', label: 'Clubs', Icon: ClubsIcon },
  { href: '/profile', label: 'Profile', Icon: ProfileIcon },
] as const

/**
 * The sticky action belongs to the screen, but it renders *inside* the bar —
 * above the tabs and below the bar's top border — so a page cannot supply it as
 * a sibling without breaking that border. Keeping the mapping here mirrors how
 * the design defines it: a per-screen property of the navigation component, not
 * of the page content.
 */
const STICKY_ACTIONS: Record<string, { label: string; href: string }> = {
  '/postcards': { label: 'Create postcard', href: '/postcards/new' },
  '/rides': { label: 'Create ride', href: '/rides/new' },
  // Both Clubs sub-pages carry it — `Clubs - Your clubs` and `Clubs - Explore`
  // draw the same 358×40 primary above the tabs, including on their empty
  // states, which is why neither page renders a second Create button of its own.
  '/clubs': { label: 'Create club', href: '/clubs/new' },
  '/clubs/explore': { label: 'Create club', href: '/clubs/new' },
}

export function Navbar() {
  const pathname = usePathname()
  const action = STICKY_ACTIONS[pathname]

  return (
    <nav className="pb-safe fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background px-4">
      {action && (
        <div className="pt-4 pb-2">
          <Button href={action.href} size="md" className="text-base">
            {action.label}
          </Button>
        </div>
      )}

      <div className="flex">
        {navItems.map(({ href, label, Icon }) => {
          // Exact match on the segment root, then a `/` boundary — plain
          // startsWith would light up Clubs for a hypothetical `/clubsomething`,
          // the same trap `src/lib/auth/guard.ts` documents for `/legal`.
          const active = pathname === href || pathname.startsWith(`${href}/`)

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-xl pt-2 pb-1 text-2xs font-semibold transition-colors active:bg-border',
                active ? 'text-foreground' : 'text-muted'
              )}
            >
              <Icon className="h-6 w-6" />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
