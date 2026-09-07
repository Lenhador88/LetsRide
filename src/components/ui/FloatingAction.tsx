'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type FloatingActionProps = {
  /** The accessible name — this is an icon-only control, so it is the ONLY
   *  name a screen reader gets. Also what a caller reads back in the "Create"
   *  test below. */
  label: string
  /** The glyph, e.g. `<PlusIcon className="h-6 w-6" />`. A `ReactNode` rather
   *  than a `ComponentType<IconProps>` — this primitive draws no icon of its
   *  own and has no default to size or colour, so there is nothing for a
   *  component-type prop to buy over the caller just rendering the element. */
  icon: ReactNode
  onClick: () => void
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'aria-label' | 'children'>

/**
 * A circular floating action, replacing a full-width sticky `Button` bar
 * above the navigation bar. Product owner, 2026-09-05, referencing a floating
 * action that expands into its actions — PD-404's ride half.
 *
 * **This is a deliberate, recorded departure from v2 (decision #4), not a
 * measurement.** `grep -ril "floating\|fab\b" design/` is 0: there is no frame
 * anywhere in the Figma to build this against, and nothing here should be read
 * as having been measured off one. What IS read from the design is the token
 * system it is built from — the geometry it inherits below, `--color-foreground`
 * for the fill, and the type/icon scale everywhere else in this file.
 *
 * This component only renders the trigger. It does not own the sheet that
 * opens under it — the caller wires `onClick` to whatever `ContextMenu`-based
 * sheet it needs (see `RideCreateSheet` for the shape this replaces on the
 * ride detail), so this stays a primitive rather than a screen.
 *
 * ## Geometry — its OWN offset, not the bar's (PD-423)
 *
 * `.bottom-floating-action` (`globals.css`), which is `.bottom-navbar` plus the
 * navigation bar's own `border-t` and a 16px gap. **It shipped inheriting
 * `.bottom-navbar` and that was the defect**, reported on DEV the same day: that
 * class puts an element's bottom edge on the nav's top edge, which is what a
 * full-width bar wants — a bar reads as continuous with the chrome — and the
 * opposite of what a circle wants. Measured before the fix, at 390×844: nav top
 * y775 against control bottom y776, so the lower arc sat *inside* the bar and
 * `--shadow-floating`'s two downward offsets fell entirely on it.
 *
 * **Do not "simplify" this back to `.bottom-navbar`.** The two classes exist
 * because one number cannot serve a bar and a circle. `RideAttendanceBar` is
 * the remaining caller of the bar's offset and keeps it for that reason — it
 * is a bar, and it is meant to read as continuous with the chrome.
 *
 * `z-40` sits under the navigation bar's `z-50`, so the tabs stay reachable if
 * the two ever overlap — and raising it was never the fix for the overlap
 * above, only a way to hide it. **No `border-t`**: irrelevant to a circle, and
 * the navigation bar already draws its own hairline — `RideCreateBar`'s
 * docstring names the doubled-line defect that a second one here would repeat.
 *
 * ## Elevation is a new token, not `shadow-lg`
 *
 * `design/TOKENS.md` carries no elevation token at all, and every existing
 * `shadow-lg` in `src/` (`Banner.tsx`, `NotificationsPanel.tsx`) sits on a
 * TRANSIENT overlay — up for seconds, then gone, where a heavy shadow reads as
 * "temporarily floating above everything". This control sits on screen for
 * the life of the page, over flat cards and a flat gradient background with
 * nothing else competing for elevation, so it is the app's first PERSISTENT
 * elevation and earns its own token: `--shadow-floating` in `globals.css`,
 * deliberately restrained — this app's surfaces read as flat by design, and a
 * heavy drop shadow on a permanent fixture would be the loudest thing on
 * every screen carrying one.
 *
 * ## Size and contrast, both measured
 *
 * 56px (`h-14 w-14`) — comfortably above the 44×44 glove floor, and the size
 * the `--floating-action-clearance` arithmetic in `globals.css` is keyed to.
 * Fill is `bg-foreground` (`Grey/100` `#1A1A1A`), never green — green is a
 * sparing accent per the design system, not a default control colour. Icon on
 * that fill is `text-white`: white on `#1A1A1A` measures **17.4:1**, the same
 * pairing `Button`'s `primary` variant and every other white-on-`Grey/100`
 * label in this app already carries (contrast is symmetric, so this is the
 * same number as `text-foreground` on white measured elsewhere in this file).
 *
 * ## It does not reserve its own clearance
 *
 * `globals.css`'s own comment carries the arithmetic: a 56px control needs
 * 1 navbar border + 16 gap + 56 control + 8 = 81px if a page reserves space for
 * it (80px before PD-423 gave it a real gap), against `--navbar-action`'s
 * 64px — nothing breaks even, so reserving clearance for this costs MORE
 * vertical room than the sticky bar it replaces, not less.
 * This component therefore assumes it sits on top of the last row of content
 * by default, which is what "floating" means; a page that wants clearance
 * instead opts in with `.pb-floating-action-extra`. The gain of this pattern
 * over a full-width bar is horizontal space — the rest of the row stays
 * usable — never vertical room, which the arithmetic above says it does not
 * give back.
 */
export function FloatingAction({ label, icon, onClick, className, ...props }: FloatingActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'bottom-floating-action fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-white shadow-floating transition-colors hover:bg-foreground/90 active:bg-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
      {...props}
    >
      {icon}
    </button>
  )
}
