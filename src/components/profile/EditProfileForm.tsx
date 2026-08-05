'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/auth/FormError'
import { updateProfile } from '@/lib/actions/profile'
import { emptyActionState } from '@/lib/actions/state'
import type { ActionState } from '@/lib/actions/state'
import { BIKE_MODEL_MAX_LENGTH, BIO_MAX_LENGTH } from '@/lib/validation/profile'
import type { Profile } from '@/types'

/**
 * Editing the three fields a rider owns on their own profile.
 *
 * The v1 version of this called `supabase.from('profiles').update()` from the
 * browser and then `router.refresh()`, validating nothing. It is now
 * `useActionState` over the `updateProfile` server action, which parses the
 * same Zod schema the fields advertise — see CLAUDE.md §Technology Decisions on
 * why both sides share one schema rather than two hand-written copies.
 *
 * **The design has no edit screen.** `Profile / View your profile` draws the
 * profile and `Login / Onboarding` draws the fields being *first* filled in, but
 * nothing draws changing them afterwards. So the placement — a form under the
 * profile rather than a separate route or a sheet — is ours, not the design's,
 * and it is logged as such in docs/FIGMA-FIDELITY-TODO.md §Profile rather than
 * left to look measured.
 *
 * `username` and the avatar are absent, and that is deliberate: see
 * `profileEditSchema`.
 *
 * `defaultValue` rather than controlled state, because there is nothing to
 * derive while typing — no live availability check as onboarding's username step
 * has, no counter the design specifies. Uncontrolled inputs also survive the
 * action's re-render with what the rider typed.
 */
export function EditProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction, pending] = useActionState(updateProfile, emptyActionState)

  // "Saved" has to survive the action's re-render and then *stop* being true the
  // moment the rider edits again — otherwise it sits over an unsubmitted change,
  // claiming work that has not happened. The deleted v1 form cleared it on every
  // keystroke; this is the same rule with the flag on the form rather than on
  // each field.
  //
  // Derived, not synchronised: `dismissed` records *which* result the rider has
  // typed over, so `saved` is a comparison rather than a second copy of the
  // truth. The obvious `useEffect(() => setSaved(true), [state])` is what this
  // avoids — ESLint rejects setState inside an effect, and rightly: it is a
  // cascading render to compute something already knowable during this one.
  //
  // Identity, not value. `ActionState` documents why: two consecutive successes
  // are indistinguishable by value, so a second save after an edit would not
  // re-show "Saved" if this compared `sent`.
  const [dismissed, setDismissed] = useState<ActionState | null>(null)
  const saved = state.sent === true && !state.error && dismissed !== state

  return (
    <form
      action={formAction}
      onChange={() => setDismissed(state)}
      className="flex flex-col gap-4 px-6"
    >
      <Input
        name="location"
        label="Where you ride from"
        defaultValue={profile.location ?? ''}
        maxLength={100}
        required
      />
      <Input
        name="bike_model"
        label="Your bike"
        placeholder="e.g. Kawasaki Z900"
        defaultValue={profile.bike_model ?? ''}
        maxLength={BIKE_MODEL_MAX_LENGTH}
      />
      <Textarea
        name="bio"
        label="About you"
        placeholder="Tell other riders about yourself…"
        rows={4}
        defaultValue={profile.bio ?? ''}
        maxLength={BIO_MAX_LENGTH}
      />

      {/* `FormError` renders nothing when there is no message, so this region is
          created at the moment it has content. That is fine for its `role="alert"`
          — insertion is what an alert announces — and is *not* the pattern
          `RideAttendanceBar` needed, where a `role="status"` region has to
          pre-exist its content to be read at all. The two are different roles
          with different rules; the shared component is already correct. */}
      <FormError message={state.error} />

      <Button type="submit" loading={pending}>
        Save changes
      </Button>

      {/* The region is always mounted and only its text changes. A `role="status"`
          node inserted together with its content is the case assistive tech
          reliably misses — the live region has to exist *before* the text
          appears — which is the same fix `RideAttendanceBar` carries. Rendering
          it conditionally would have made the one piece of success feedback the
          silent one. */}
      <p
        role="status"
        className="min-h-5 text-center text-sm font-medium text-accent-strong"
      >
        {saved ? 'Saved' : ''}
      </p>
    </form>
  )
}
