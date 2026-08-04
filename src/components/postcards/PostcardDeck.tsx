'use client'

import { useCallback, useRef, useState } from 'react'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import type { Postcard } from '@/types'

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
 */
const SWIPE_THRESHOLD = 56
const BEHIND = [
  { rotate: -2, scale: 1, z: 20 },
  { rotate: 2, scale: 1, z: 10 },
]

type DragState = { pointerId: number; startX: number; startY: number } | null

export function PostcardDeck({ postcards }: { postcards: Postcard[] }) {
  const [index, setIndex] = useState(0)
  const [dx, setDx] = useState(0)
  // Set while the swiped card animates off, so the next render does not snap it
  // back to centre before the transition finishes.
  const [leaving, setLeaving] = useState<number | null>(null)
  // Mirrors `drag.current` as state: the transition has to be suppressed while a
  // finger is down, and a ref read during render would not re-run this component
  // when it changed.
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState>(null)

  const advance = useCallback(
    (direction: 1 | -1) => {
      setLeaving(direction)
      setDx(direction * 600)
      window.setTimeout(() => {
        setIndex((i) => i + 1)
        setDx(0)
        setLeaving(null)
      }, 220)
    },
    []
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (leaving !== null) return
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    setDx(event.clientX - state.startX)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null

    setDragging(false)
    const travelled = event.clientX - state.startX
    if (Math.abs(travelled) >= SWIPE_THRESHOLD) advance(travelled > 0 ? 1 : -1)
    else setDx(0)
  }

  const remaining = postcards.slice(index)

  if (remaining.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm font-medium text-muted">
          {postcards.length === 0
            ? 'There are no new postcards, yet!'
            : "That's every new postcard."}
        </p>
        {postcards.length > 0 && (
          <button
            type="button"
            onClick={() => setIndex(0)}
            className="text-sm font-semibold text-foreground underline underline-offset-4"
          >
            Start over
          </button>
        )}
      </div>
    )
  }

  const visible = remaining.slice(0, 3)

  return (
    <div className="relative flex h-full items-center justify-center px-6">
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
              onPointerCancel={isFront ? onPointerUp : undefined}
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
        onClick={() => advance(1)}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-0 focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Next postcard
      </button>
    </div>
  )
}
