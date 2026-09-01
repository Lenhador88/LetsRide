'use client'

import { WaveIcon } from '@/components/icons/generated'
import { OptimisticToggle } from '@/components/ui/OptimisticToggle'
import { likePostcard, unlikePostcard } from '@/lib/actions/postcards'

type LikeButtonProps = {
  postcardId: string
  likesCount: number
  isLiked: boolean
}

/**
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
 * the 3:1 a colour-only distinction owes.
 *
 * The optimistic toggle itself — the state machine, the rollback, the
 * `aria-pressed` rule and the constant accessible name — moved to
 * `OptimisticToggle` (`club-timeline-engagement`, PD-356), extracted rather
 * than copied when the club timeline's wave needed the identical rules on a
 * second table. This file is now only what is specific to a postcard's own
 * like: which two actions it calls, and the glyph's colour.
 */
export function LikeButton({ postcardId, likesCount, isLiked }: LikeButtonProps) {
  return (
    <OptimisticToggle
      pressed={isLiked}
      count={likesCount}
      label={(count) => `Like, ${count} likes`}
      icon={(pressed) => <WaveIcon className={pressed ? 'h-6 w-6 text-like' : 'h-6 w-6'} />}
      onToggle={(next) => (next ? likePostcard(postcardId) : unlikePostcard(postcardId))}
    />
  )
}
