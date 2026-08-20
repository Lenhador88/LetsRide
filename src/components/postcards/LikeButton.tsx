'use client'

import { useState, useTransition } from 'react'
import { WaveFilledIcon } from '@/components/icons/derived'
import { WaveIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { likePostcard, unlikePostcard } from '@/lib/actions/postcards'

type LikeButtonProps = {
  postcardId: string
  likesCount: number
  isLiked: boolean
}

/**
 * Optimistic: a like is a two-state toggle a rider taps while scrolling, and
 * waiting a round trip before the count moves reads as a dropped tap. The
 * server action is still the authority — a refused write (blocked, signed out,
 * RLS) rolls the local state back and surfaces the message.
 *
 * The glyph is the motorcycle wave rather than a heart (PD-228) — the one
 * gesture every rider already knows.
 *
 * **Filled when liked, outline when not** — product owner, 2026-08-20. This
 * file used to argue for one glyph in two colours, on the grounds that a solid
 * hand loses the folded fingers that make the gesture legible at 24px. That
 * cost is real and is now paid deliberately; what it buys is a state
 * distinction that survives a rider who cannot tell Pink/100 from Grey. The
 * colour is kept alongside it, so the two states differ in shape *and* in
 * colour rather than trading one for the other.
 *
 * `WaveFilledIcon` is the same exported asset with its interior subpath
 * dropped, not a second drawing — see `src/components/icons/derived.tsx`.
 *
 * `aria-pressed` is still the whole of the non-visual signal, which is why the
 * accessible name is **constant**. It used to flip to "Unlike…" when liked, and
 * a toggle button that both reports `pressed` and renames itself to the undo
 * action announces "Unlike, 5 likes, pressed" — a control named for undoing,
 * reported as done. Pick one mechanism: this is the `aria-pressed` one, so the
 * name states what the control is, never what the next tap does.
 */
export function LikeButton({ postcardId, likesCount, isLiked }: LikeButtonProps) {
  const [liked, setLiked] = useState(isLiked)
  const [count, setCount] = useState(likesCount)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !liked
    setLiked(next)
    setCount((current) => current + (next ? 1 : -1))
    setError(null)

    startTransition(async () => {
      const result = next ? await likePostcard(postcardId) : await unlikePostcard(postcardId)
      if (result.error) {
        setLiked(!next)
        setCount((current) => current + (next ? -1 : 1))
        setError(result.error)
      }
    })
  }

  return (
    <>
      <PostcardActionButton
        onClick={toggle}
        pressed={liked}
        count={count}
        label={`Like, ${count} likes`}
        className={pending ? 'opacity-70' : undefined}
        icon={
          liked ? (
            <WaveFilledIcon className="h-6 w-6 text-like" />
          ) : (
            <WaveIcon className="h-6 w-6" />
          )
        }
      />
      {error && (
        // Absolutely placed so a failed like cannot reflow the action row and
        // shift the controls beside it out from under a rider's thumb.
        <p role="status" className="absolute -top-5 left-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  )
}
