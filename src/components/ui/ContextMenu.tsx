'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Context Menu` — a bottom sheet over a `Grey/70%` scrim,
 * measured from `Ride - Ride plan - Sub pages` (`2375:9114`): 390 wide, flush
 * to the bottom edge, 16px radius on the top corners only, padding 16/24/32/24.
 *
 * Its second caller is the postcard overflow menu — `Content / Context Menu /
 * Postcard` (`2303:5963`) — which is what the icon slot and `Type=Warning`
 * variant on `ContextMenuItem` exist for.
 *
 * **Rendered through a portal to `document.body`, and that is required rather
 * than tidy.** `PostcardDeck` gives each card a `transform`, and any transform
 * other than `none` makes that element the containing block for every
 * `position: fixed` descendant. Rendered in place, the scrim covered the 342px
 * card instead of the screen, the sheet became 342 wide anchored to the card's
 * bottom edge, and the z-indices resolved inside the card's stacking context —
 * so the sheet painted *under* the nav bar. The portal also fixes the
 * pre-existing case where this sheet shared `z-50` with a later-in-DOM Navbar.
 */
export function ContextMenu({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Names the sheet for screen readers — it has no visible heading. */
  label: string
  children: React.ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  // Where focus was before the sheet opened, so it can go back there on close.
  const triggerRef = useRef<Element | null>(null)

  // `onClose` is an inline arrow at every call site, so its identity changes on
  // every render. Held in a ref rather than listed as a dependency: naming it
  // one re-ran the whole effect each render, which re-fired `.focus()` and
  // yanked focus off whatever item the keyboard user had tabbed to.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return

    triggerRef.current = document.activeElement

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // Without this, Tab walks the page behind the scrim — the scrim is a
      // sibling of the sheet, not a wrapper, so `aria-hidden` on it hides
      // nothing that matters here. A modal that leaks focus is a modal in
      // appearance only.
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])'
      )
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    // Moving focus into the sheet is what makes Escape and the trap reachable:
    // the trigger stays in the DOM behind the scrim, so without this the
    // keyboard user is still standing on the button.
    sheetRef.current?.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      // The sheet unmounts with focus inside it, which drops focus to <body>
      // and restarts the next Tab at the top of the document. Put it back on
      // the control that opened it.
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open])

  // No `mounted` guard is needed for the portal: `open` starts false and can
  // only become true from a client event, so `document` always exists by the
  // time this renders anything. The typeof check is belt-and-braces for a
  // future caller that opens on mount.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-scrim"
        onClick={onClose}
        // The scrim is a convenience for pointer users; Escape and the items
        // themselves are the real exits, so it is hidden rather than given a
        // role no keyboard user can reach.
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl bg-surface px-6 pt-4 outline-none',
          // 32px in the design, plus whatever the device's home indicator needs.
          'pb-[max(2rem,env(safe-area-inset-bottom))]'
        )}
      >
        <div className="mx-auto flex max-w-lg flex-col">{children}</div>
      </div>
    </>,
    document.body
  )
}

type ItemProps = {
  /**
   * The 24×24 leading icon. Optional because a menu is allowed to hide its
   * icons — `Ride - Ride plan - Sub pages` toggles the slot off on all three
   * rows, which is why the label there is 310 wide against this menu's 270.
   * That frame's own consumer (`RidePageMenu`) was deleted by PD-254; the
   * measurement is kept because it is what sized the iconless variant, and
   * `ClubDetailPageMenu` still draws it.
   */
  icon?: React.ReactNode
  children: React.ReactNode
  /**
   * `Type=Warning` — `Warning/100` on both icon and label.
   *
   * Note the postcard menu does **not** use it: `Content / Context Menu /
   * Postcard` draws `Block account` and `Report post` in ordinary `Grey/100`,
   * so destructive-looking tone there would be invention. It exists for rows
   * that genuinely destroy something.
   */
  variant?: 'regular' | 'warning'
  /**
   * Marks the row as the current page for assistive tech. Deliberately has no
   * visual: the ride switcher draws all three rows identically, and its trigger
   * button already names the current page.
   */
  selected?: boolean
  className?: string
}

// 56px tall, 4px radius, 16px horizontal padding, Poppins/16/Medium. `State=Down`
// is `Grey/10%`, which is `active:` here rather than `hover:` — this is a touch
// surface and a sticky hover state on mobile reads as a stuck selection.
//
// The sheet already traps focus and is reachable by keyboard (see the effect
// above), so its rows need their own visible indicator rather than the
// browser default — same reasoning as `ButtonGroup`.
const itemBase =
  'flex h-14 w-full items-center gap-4 rounded px-4 text-left text-base font-medium transition-colors active:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

export function ContextMenuItem({
  icon,
  children,
  variant = 'regular',
  selected,
  className,
  ...props
}: ItemProps &
  (
    | ({ href: string } & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>)
    | ({ href?: never } & Omit<React.ComponentProps<'button'>, 'className'>)
  )) {
  const tone = variant === 'warning' ? 'text-danger' : 'text-foreground'
  // The icon inherits `currentColor` from the row, which is what makes the
  // warning variant one class rather than two — see the generator note in
  // CLAUDE.md §Design System.
  const content = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  )

  if ('href' in props && props.href) {
    const { href, ...rest } = props as { href: string }
    return (
      <Link
        href={href}
        aria-current={selected ? 'page' : undefined}
        className={cn(itemBase, tone, className)}
        {...rest}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={cn(itemBase, tone, className)}
      {...(props as React.ComponentProps<'button'>)}
    >
      {content}
    </button>
  )
}
