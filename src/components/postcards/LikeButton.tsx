'use client'

import { useState, useTransition } from 'react'
import { HeartFilledIcon, HeartOutlineIcon } from '@/components/icons/generated'
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
 * The icons are now the real ones. This file used to carry a text label because
 * `Element / Icon / Heart *` could not be exported through the rate limit and
 * decision #4 forbids a `lucide-react` lookalike; the snapshot has them, so the
 * fallback is retired. Toggled-on is Heart Filled in Pink/100 — the design's
 * only use of that colour.
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
        icon={
          liked ? (
            <HeartFilledIcon className="h-6 w-6 text-like" />
          ) : (
            <HeartOutlineIcon className="h-6 w-6" />
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
