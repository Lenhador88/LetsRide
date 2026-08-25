'use client'

import { useState, useTransition } from 'react'
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
 * **One glyph in two colours: the outline always, `text-like` when liked.**
 * It was filled-when-liked for four days (PD-266, 2026-08-20) and the product
 * owner reversed it on 2026-08-24 (PD-287). The argument the fill overrode is
 * the argument that stands again — a solid hand loses the folded fingers that
 * make the gesture legible at 24px — and `WaveFilledIcon` came out with it,
 * `src/components/icons/derived.tsx` having had no other caller.
 *
 * **Colour is therefore the only visual signal again**, which the two states
 * are allowed to be: `Pink/100` against the default measures 4.51:1, clearing
 * the 3:1 a colour-only distinction owes. `aria-pressed` below is the
 * non-visual half and is not optional.
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
        icon={<WaveIcon className={liked ? 'h-6 w-6 text-like' : 'h-6 w-6'} />}
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
