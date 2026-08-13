'use client'

import { useCallback, useRef, useState } from 'react'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { remainingPostcards, resolveSwipe } from '@/components/postcards/deck'
import { cn } from '@/lib/utils'
import type { Postcard } from '@/types'
import { MarkFeedSeen } from '@/components/postcards/MarkFeedSeen'

/**
 * The home screen's card stack — `Postcard Stack` in
 * `Home - Postcards - All new`, measured from the committed snapshot.
 *
 * Three cards sit at the same centre, 342×448, and the two behind the front one
 * are rotated. The rotations are exact: −2° for the middle card and +2° for the
 * deepest, read from the raw node and now carried in the snapshot (the pruned
 * tree used to drop `rotation`, which made the fan look like three
 * differently-sized cards).
 *
 * **Swiping in either direction advances to the next postcard**, which is the
 * behaviour the product owner described. That means the deck only ever moves
 * forward; "Start over" at the end is the only way back, because a back
 * affordance would be UI the design does not draw.
 *
 * **Only a lift advances the deck, and only in the direction the card is drawn
 * in** (PD-221). Both halves were one defect: `pointercancel` was wired
 * straight to the release handler, so a gesture the platform took away
 * mid-touch committed as though the rider had finished it, judged on
 * coordinates a cancelled event is under no obligation to populate. See
 * `onPointerCancel` below and `resolveSwipe` in `./deck`.
 */
const BEHIND = [
  { rotate: -2, scale: 1, z: 20 },
  { rotate: 2, scale: 1, z: 10 },
]

/**
 * `offset` is the authority on where the card is, and `dx` is its mirror for
 * rendering — not the other way round. A release is decided from the ref
 * because `pointermove` is a continuous event: React is free to batch its
 * `setDx`, so the `pointerup` handler can be a closure over a `dx` one move
 * out of date. The ref is written synchronously and cannot be.
 *
 * `frontId` is the card the gesture *started* on. The feed revalidates
 * underneath the deck — a block, a hide, a delete — so the front card can be a
 * different postcard by the time the finger lifts, and dismissing whichever
 * card happens to be there is the same defect `advance` already guards its
 * timeout against.
 */
type DragState = { pointerId: number; startX: number; offset: number; frontId: string } | null

export function PostcardDeck({
  postcards,
  className,
}: {
  postcards: Postcard[]
  /** Merged onto whichever root renders — the empty state and the fanned
   * stack both need it applied at the same node `SkeletonDeck` shares
   * `h-full` with, rather than on a wrapper that would break that chain.
   *
   * **The fade therefore plays once, on arrival, and not again when the
   * rider swipes the last card away.** Both roots are a `div` at one
   * position, so React updates in place and `animation-name` never changes
   * — which is the behaviour wanted here: a swipe is not a load, and
   * re-fading on it would read as the flash this animation exists to
   * remove. */
  className?: string
}) {
  // The ids the rider has swiped past — see `remainingPostcards` for why this is
  // a set of ids rather than a position. The feed is bounded by FEED_PAGE_SIZE,
  // so this cannot grow beyond a page.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [dx, setDx] = useState(0)
  // Set while the swiped card animates off, so the next render does not snap it
  // back to centre before the transition finishes.
  const [leaving, setLeaving] = useState<number | null>(null)
  // Mirrors `drag.current` as state: the transition has to be suppressed while a
  // finger is down, and a ref read during render would not re-run this component
  // when it changed.
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState>(null)

  /**
   * `frontId` is captured at the call rather than read when the timeout fires.
   * A revalidation landing mid-animation can change which card is at the front,
   * and dismissing whichever card happens to be there 220ms later would skip an
   * unseen one — the same defect this component is being fixed for, reintroduced
   * through the back door.
   */
  const advance = useCallback((direction: 1 | -1, frontId: string) => {
    setLeaving(direction)
    setDx(direction * 600)
    window.setTimeout(() => {
      // Adding an id that is already present is a no-op, so a double-tap on the
      // keyboard control cannot dismiss two cards.
      setDismissed((previous) => new Set(previous).add(frontId))
      setDx(0)
      setLeaving(null)
    }, 220)
  }, [])

  // Computed before the handlers because they need the front card's id, and
  // recomputed every render so a revalidation that removes cards is reflected
  // immediately rather than at the next swipe.
  const remaining = remainingPostcards(postcards, dismissed)
  const front = remaining[0]

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (leaving !== null || !front) return

    /**
     * A gesture starting on a control is that control's, not the deck's.
     *
     * `setPointerCapture` below retargets every subsequent pointer event to the
     * card, so the browser never delivers a `click` to whatever was pressed —
     * which made **every button on the front card dead**: the overflow menu,
     * like, comment and share. Verified against the real app on 2026-08-05: a
     * pointer click left `aria-expanded` false with no dialog in the DOM, while
     * dispatching `.click()` from JS opened the sheet correctly. The React
     * handlers were never the problem.
     *
     * Bailing out here rather than calling `releasePointerCapture` later,
     * because capture has to not happen at all — releasing it mid-gesture does
     * not resurrect the click the browser already withheld.
     */
    if ((event.target as HTMLElement).closest('button, a')) return

    drag.current = { pointerId: event.pointerId, startX: event.clientX, offset: 0, frontId: front.id }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    // Written to the ref first, mirrored to state for the transform. The two are
    // the same number, so the card cannot commit in a direction it was never drawn in.
    state.offset = event.clientX - state.startX
    setDx(state.offset)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null

    setDragging(false)
    const direction = resolveSwipe(state.offset)
    // A revalidation can swap the front card mid-drag. Advancing then would
    // dismiss a postcard that was never under the finger, so the gesture is
    // spent returning the deck to centre instead.
    if (direction !== null && front && front.id === state.frontId) advance(direction, state.frontId)
    else setDx(0)
  }

  /**
   * **A cancel aborts the gesture; it does not complete it.** The two are
   * opposite intents and the deck used to route both here: `pointercancel`
   * means the platform took the touch away *while the finger was still down* —
   * iOS and WKWebView's left-edge back-swipe, a second touch landing, or this
   * card unmounting under its own pointer capture when the feed revalidates —
   * so treating it as a release flung the card away mid-touch and marked a
   * postcard the rider never finished reading as seen.
   */
  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null

    setDragging(false)
    setDx(0)
  }

  if (!front) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-4 px-8 text-center', className)}>
        <p className="text-sm font-medium text-muted">
          {postcards.length === 0
            ? 'There are no new postcards, yet!'
            : "That's every new postcard."}
        </p>
        {postcards.length > 0 && (
          <>
            {/* Reaching the end is what "seen" means for the app-wide feed —
                see MarkFeedSeen, and 015 for why a watermark may only advance
                on a finished surface. */}
            <MarkFeedSeen />
            <button
              type="button"
              onClick={() => setDismissed(new Set())}
              className="text-sm font-semibold text-foreground underline underline-offset-4"
            >
              Start over
            </button>
          </>
        )}
      </div>
    )
  }

  const visible = remaining.slice(0, 3)

  return (
    <div className={cn('relative flex h-full items-center justify-center px-6', className)}>
      {/* The stack is 342×448 in a 390 frame — 24px either side. Capped rather
          than fixed so it still fits a 320px phone. */}
      <div className="relative aspect-[342/448] w-full max-w-[342px]">
        {visible.map((postcard, depth) => {
          const isFront = depth === 0
          const behind = BEHIND[depth - 1]

          return (
            <div
              key={postcard.id}
              // Vertical panning is not wanted here — the home screen fills the
              // viewport and does not scroll — so the front card owns the gesture.
              className={isFront ? 'absolute inset-0 touch-none' : 'absolute inset-0'}
              style={{
                zIndex: isFront ? 30 : behind.z,
                transform: isFront
                  ? `translateX(${dx}px) rotate(${dx / 40}deg)`
                  : `rotate(${behind.rotate}deg)`,
                transition: dragging
                  ? undefined
                  : 'transform 220ms ease-out, opacity 220ms ease-out',
                opacity: isFront && leaving !== null ? 0 : 1,
                // Only the front card takes pointer input; the fanned corners
                // behind it must not swallow a drag that starts over them.
                pointerEvents: isFront ? 'auto' : 'none',
              }}
              onPointerDown={isFront ? onPointerDown : undefined}
              onPointerMove={isFront ? onPointerMove : undefined}
              onPointerUp={isFront ? onPointerUp : undefined}
              onPointerCancel={isFront ? onPointerCancel : undefined}
            >
              <PostcardCard postcard={postcard} fill />
            </div>
          )
        })}
      </div>

      {/* Keyboard and screen-reader path to the same action: the deck is a drag
          gesture, which is unreachable without a pointer. */}
      <button
        type="button"
        onClick={() => advance(1, front.id)}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-0 focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Next postcard
      </button>
    </div>
  )
}
