'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BikeIcon,
  ClubsIcon,
  HomeIcon,
  ProfileIcon,
} from '@/components/icons/generated'
import { Button } from '@/components/ui/Button'
import { detailPaths } from '@/lib/routes'
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
 *
 * **Four tabs, and the design's fifth is deliberately absent.** Figma draws Inbox
 * between Clubs and Profile; it has no route and no tables, so it shipped as an
 * `aria-disabled` stub until 2026-08-07, when the product owner chose to drop it
 * rather than build the epic before store submission (PD-100). A visible tab that
 * goes nowhere is an App Store guideline 4.2 rejection, and a disabled one still
 * reads as broken. It comes back with the Inbox epic — restore the row and the
 * `MailboxIcon` import together, and do not re-add it from the design alone.
 */
const navItems = [
  // PD-244 renamed this label from `Home` so it names its content like the
  // other three. The icon deliberately did not follow: `HomeIcon` is a house,
  // the generated set has no postcard glyph, and `MailboxIcon` is reserved for
  // the Inbox tab this file's header comment describes. PD-250 carries the
  // glyph question. The design still says `Home` — see `CLAUDE.md` §Product
  // Scope before "correcting" it back.
  { href: '/postcards', label: 'Postcards', Icon: HomeIcon },
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

/**
 * Screens that replace the bar rather than scrolling under it.
 *
 * One so far — the ride chat. `Ride - Chat` (`2226:4999`) draws no navigation
 * bar at all: header 120 + content 644 + reply 80 = 844, the whole frame. Its
 * fixed reply bar sits where this one would, so rendering both would stack two
 * fixed bars and put the composer behind the tabs on the one screen a rider is
 * typing on.
 *
 * Note how this differs from `RideAttendanceBar`, which is *also* a fixed bar on
 * a ride screen and does **not** belong here: that one is drawn on top of the
 * navigation bar (y836 against y931 in `2375:8771`) and the ride plan keeps its
 * tabs. Replacing versus stacking is a per-screen fact the design states, not a
 * rule about bars.
 *
 * An exact list of pathnames. It was `/^\/rides\/[^\/]+\/chat$/` while the ride
 * id was a path segment; PD-142 moved the id into `?id=`, so the path is now a
 * constant and a wildcard segment would match `/rides/anything/chat` for no
 * reason. It still needs to be a *list* rather than a set membership on the
 * whole path, because a second barless screen is a matter of time — and equality
 * rather than a prefix for the reason the old regex was anchored at both ends: a
 * hypothetical `/rides/detail/chat/settings` should decide for itself.
 */
const BARLESS: string[] = [detailPaths.rideChat]

export function Navbar() {
  const pathname = usePathname()
  const action = STICKY_ACTIONS[pathname]

  if (BARLESS.includes(pathname)) return null

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
