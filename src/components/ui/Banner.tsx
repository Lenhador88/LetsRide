'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckIcon, CloseIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'

/**
 * The confirmation toast — measured from `Account blocked banner` (`2303:6169`):
 * 358×64 at 16px inset, radius 8, `White/100`, 16px padding, 12px gap, with a
 * 32×32 `Accent Brand/100` circle carrying a white check, then the message in
 * Poppins/16/Semibold `Grey/100`.
 *
 * **It is owned by a provider at the app shell, not by the component that
 * raises it, and that is load-bearing rather than tidy.** Every action that
 * raises one — hide, block, delete — removes the card that triggered it from
 * the feed, so state held inside that card unmounts before it can paint. The
 * design draws all three confirmations as their own frames, so losing them is
 * the specified behaviour going missing.
 *
 * The design also places it as a sibling of `Main Container` on the 390×844
 * frame, not inside the postcard — which is the same conclusion arrived at from
 * the layout side: `PostcardDeck` gives each card a `transform`, and a
 * transformed ancestor becomes the containing block for `position: fixed`, so a
 * banner rendered inside a card anchors to the card.
 *
 * **No dismiss control and no drawn duration.** All three frames show it in one
 * state with nothing to close it, so the timeout is ours; logged in
 * docs/FIGMA-FIDELITY-TODO.md.
 */
const DISMISS_AFTER_MS = 4000

type BannerTone = 'success' | 'error'
type BannerState = { message: string; tone: BannerTone } | null

const BannerContext = createContext<((message: string, tone?: BannerTone) => void) | null>(null)

/**
 * Raises a confirmation from anywhere under the app shell.
 *
 * Returns a stable function, so a caller may list it in an effect's deps
 * without re-running the effect on every render.
 */
export function useBanner() {
  const show = useContext(BannerContext)
  if (!show) throw new Error('useBanner must be used within <BannerProvider>')
  return show
}

export function BannerProvider({ children }: { children: React.ReactNode }) {
  const [banner, setBanner] = useState<BannerState>(null)

  const show = useCallback((message: string, tone: BannerTone = 'success') => {
    setBanner({ message, tone })
  }, [])

  return (
    <BannerContext.Provider value={show}>
      {children}
      {/*
        The live region is mounted for the lifetime of the app and only its
        contents change. A `role="status"` created in the same commit as its
        text is the one case assistive tech reliably misses — the same defect
        the ride-detail review caught in `RideAttendanceBar`, which is why it is
        structural here rather than a prop on the visible element.
      */}
      <div role="status" aria-live="polite">
        {banner && (
          <Banner
            message={banner.message}
            tone={banner.tone}
            onDismiss={() => setBanner(null)}
          />
        )}
      </div>
    </BannerContext.Provider>
  )
}

function Banner({
  message,
  tone,
  onDismiss,
}: {
  message: string
  /**
   * The design only ever draws the success form — a green circle and a check.
   * `error` reuses the same geometry with `Warning/100` and a cross, because a
   * failed action reported under a green tick is worse than an undrawn state.
   */
  tone: BannerTone
  onDismiss: () => void
}) {
  // Held in a ref rather than listed as a dependency. Naming it re-armed the
  // timer on every parent render, so dragging the deck — which calls setDx on
  // every pointer move — kept the banner alive indefinitely. Identical to the
  // `onClose` fix in ContextMenu one epic earlier.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
    // `message` restarts the clock so a second confirmation gets its own full
    // reading time rather than the remainder of the first one's.
  }, [message])

  return (
    <div className="pt-safe fixed inset-x-4 top-0 z-[80] flex items-center gap-3 rounded-lg bg-surface p-4 shadow-lg">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent-foreground',
          tone === 'error' ? 'bg-danger' : 'bg-accent'
        )}
      >
        {tone === 'error' ? <CloseIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
      </span>
      <p className="text-base font-semibold text-foreground">{message}</p>
    </div>
  )
}
