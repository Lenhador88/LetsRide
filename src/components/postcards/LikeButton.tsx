'use client'

import { useState, useTransition } from 'react'
import { WaveIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { likePostcard, unlikePostcard } from '@/lib/actions/postcards'
import { cn } from '@/lib/utils'

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
 * **One icon serves both states, and that is deliberate rather than an
 * oversight.** The heart it replaced was a filled/outline pair, but a hand
 * cannot do that: a solid silhouette loses the folded fingers and thumb that
 * make the glyph legible at 24px, and a merely bolder copy is
 * indistinguishable from the outline on a phone. So the toggle is carried by
 * `text-like` (Pink/100, the design's only use of that colour) alone. That
 * leans harder on `aria-pressed` in `PostcardActionButton`, which is why the
 * label still says Like/Unlike in words.
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
        label={liked ? `Unlike, ${count} likes` : `Like, ${count} likes`}
        className={pending ? 'opacity-70' : undefined}
        icon={<WaveIcon className={cn('h-6 w-6', liked && 'text-like')} />}
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
