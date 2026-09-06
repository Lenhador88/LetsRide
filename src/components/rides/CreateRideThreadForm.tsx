'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createRideThread } from '@/lib/actions/ride-threads'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { RIDE_THREAD_TITLE_MAX } from '@/lib/validation/rides'

/**
 * `Start a thread` on a ride — one field (`108`, PD-402).
 *
 * **`CreateThreadForm`'s composition one domain over.** There is no v2 frame for
 * this screen, so the composition is ours: the v2 `Input` primitive and the
 * app's near-black primary `Button` (`Grey/100` `#1A1A1A`, never green), which
 * is what every other create form in this app already is.
 *
 * ## A title and no first message, deliberately
 *
 * A second field would be a second write with no transaction behind it —
 * PostgREST offers none and the client owns the mutation path — so a failure
 * between them leaves a thread whose first message never landed and an error the
 * rider cannot act on. The empty thread is reachable however this form is drawn,
 * so requiring a first message would buy an invariant nothing enforces.
 *
 * Hand-rolled and controlled, per CLAUDE.md: no React Hook Form, and the pending
 * and error states come from `useActionState`. The counter is live because 80 is
 * short enough to reach by accident; `maxLength` stops the rider passing it, and
 * `108`'s CHECK is what actually refuses one that gets past this.
 */
export function CreateRideThreadForm({ rideId }: { rideId: string }) {
  const [state, formAction, pending] = useActionState(createRideThread, emptyActionState)
  useActionRedirect(state)
  // Controlled rather than retained through `seedRetained`: it is one field, and
  // the action returns its error without navigating, so this survives a failed
  // submit on its own.
  const [title, setTitle] = useState('')

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="ride_id" value={rideId} />

      <Input
        name="title"
        label="What is it about?"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={RIDE_THREAD_TITLE_MAX}
        autoFocus
        placeholder="Where are we meeting?"
        error={state.error ?? undefined}
      />

      <p className="text-xs font-medium text-muted">
        {title.trim().length}/{RIDE_THREAD_TITLE_MAX} · A title cannot be changed once the
        thread exists — delete it and start again instead.
      </p>

      <Button type="submit" loading={pending} disabled={title.trim().length === 0}>
        Start thread
      </Button>
    </form>
  )
}
