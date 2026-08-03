'use client'

import { useState, useTransition } from 'react'
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
 * There is no icon here. The design's like affordance is `Element / Icon /
 * Heart Filled` and `Heart Outline`, which cannot be exported while the Figma
 * render endpoint is rate limited, and decision #4 forbids substituting a
 * lookalike from `lucide-react`. A labelled control is the honest fallback and
 * swapping the icon in later touches only this file.
 * See docs/FIGMA-FIDELITY-TODO.md §Home / Postcards feed.
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
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={liked}
        // 44px minimum touch target — CLAUDE.md's glove-friendly floor. The
        // negative margin keeps the *visual* row tight while the hit area stays
        // full size.
        className={cn(
          '-ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          liked ? 'text-accent' : 'text-muted hover:text-foreground',
          pending && 'opacity-70'
        )}
      >
        <span>{liked ? 'Liked' : 'Like'}</span>
        {count > 0 && (
          <span className="tabular-nums" aria-label={`${count} ${count === 1 ? 'like' : 'likes'}`}>
            {count}
          </span>
        )}
      </button>
      {error && (
        <p role="status" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
