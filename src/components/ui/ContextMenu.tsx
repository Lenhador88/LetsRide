'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * `v2 / Component / Context Menu` — a bottom sheet over a `Grey/70%` scrim,
 * measured from `Ride - Ride plan - Sub pages` (`2375:9114`): 390 wide, flush
 * to the bottom edge, 16px radius on the top corners only, padding 16/24/32/24.
 *
 * Built here rather than in `rides/` because it is a library component with a
 * second caller already specified: the postcard overflow menu (`Postcard
 * options`, `2302:5395`) is the same sheet with `Hide postcard for me`, `Block
 * account` and `Report post` in it, and `Type=Warning` exists for exactly that
 * screen's destructive row.
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

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Moving focus into the sheet is what makes Escape reachable at all: the
    // trigger stays in the DOM behind the scrim, so without this the keyboard
    // user is still on the button and tabbing walks the page underneath.
    sheetRef.current?.focus()

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
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
    </>
  )
}

type ItemProps = {
  icon?: React.ReactNode
  children: React.ReactNode
  /** `Type=Warning` — the destructive row, `Warning/100` on both icon and label. */
  variant?: 'regular' | 'warning'
  /** Marks the row as the current one. Rendered as a check, not a fill. */
  selected?: boolean
  className?: string
}

// 56px tall, 4px radius, 16px horizontal padding, Poppins/16/Medium. `State=Down`
// is `Grey/10%`, which is `active:` here rather than `hover:` — this is a touch
// surface and a sticky hover state on mobile reads as a stuck selection.
const itemBase =
  'flex h-14 items-center gap-4 rounded px-4 text-base font-medium transition-colors active:bg-border'

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
  const content = (
    <>
      {icon}
      <span className="flex-1 text-left">{children}</span>
      {selected && <span aria-hidden="true">•</span>}
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
