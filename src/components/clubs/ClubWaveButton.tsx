'use client'

import { WaveIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { OptimisticToggle } from '@/components/ui/OptimisticToggle'
import type { ClubWaveState } from '@/lib/data/club-waves'
import { cn } from '@/lib/utils'

/**
 * The club timeline's wave control — a thread's or a join's — on
 * `LikeButton`'s glyph, colour and rules, extracted into `OptimisticToggle`
 * so both share exactly one copy of the rollback and the `aria-pressed` rule
 * (`092`, PD-356; `client-render-shell`'s "the toggle exists once").
 *
 * `state` is `undefined` while the batched read (`attachClubWaveState`) has
 * not resolved yet — `client-render-shell`'s Loading row: the control still
 * RENDERS, disabled, with no count, rather than being held behind the read or
 * omitted. It is the caller's job to omit this component entirely for a case
 * where the affordance must be ABSENT rather than merely disabled — a
 * self-wave, or a `reply` entry that already has one on its `thread` — since
 * "disabled" and "absent" are different answers to different questions (a
 * decoration not yet loaded, versus a write that can never succeed here).
 */
export function ClubWaveButton({
  state,
  onWave,
  onUnwave,
  className,
}: {
  state: ClubWaveState | undefined
  onWave: () => Promise<{ error: string | null }>
  onUnwave: () => Promise<{ error: string | null }>
  className?: string
}) {
  if (!state) {
    return (
      <PostcardActionButton
        icon={<WaveIcon className="h-6 w-6" />}
        label="Wave"
        disabled
        className={cn('opacity-50', className)}
      />
    )
  }

  return (
    <OptimisticToggle
      pressed={state.waved}
      count={state.count}
      label={(count) => `Wave, ${count} waves`}
      icon={(pressed) => <WaveIcon className={pressed ? 'h-6 w-6 text-like' : 'h-6 w-6'} />}
      onToggle={(next) => (next ? onWave() : onUnwave())}
      className={className}
    />
  )
}
