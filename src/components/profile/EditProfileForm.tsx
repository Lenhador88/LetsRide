'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { FormError } from '@/components/auth/FormError'
import { updateProfile } from '@/lib/actions/profile'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained } from '@/lib/actions/retain'

import type { ActionState } from '@/lib/actions/state'
import { BIKE_MODEL_MAX_LENGTH, BIO_MAX_LENGTH, profileEditSchema } from '@/lib/validation/profile'
import type { Profile } from '@/types'

// The edit forms fail differently from the create ones: their `defaultValue` is
// the *stored* value, so the reset does not blank the form, it silently rolls
// every edit back to what was already saved — which looks like the save worked.
const retainProfile = retaining(updateProfile, ['location', 'bike_model', 'bio'])
const initialState = seedRetained(emptyActionState)

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
 * has, no counter the design specifies.
 *
 * **This used to add "uncontrolled inputs also survive the action's re-render
 * with what the rider typed". They do not** — measured 2026-08-06: React resets
 * an uncontrolled field to its `defaultValue` once a `useActionState` action
 * settles, on an error return as much as on success, because nothing was
 * thrown. Typing into `bike_model` and then failing validation on `location`
 * wipes the typed `bike_model` back to the saved value.
 *
 * Two consequences, both now handled. The focus effect below reads a `FormData`
 * snapshot captured in `onSubmit` rather than re-reading the DOM, which by then
 * describes the saved profile instead of the rejected submission — the same ref
 * is in `CreateRideForm` and `CreateClubForm` for the same reason. And the
 * revert itself is closed by `retaining` (PD-199): each field's `defaultValue`
 * is what the last submit actually sent, falling back to the stored value only
 * before there has been one.
 *
 * **It was closed by feeding the submission back, not by controlled state**,
 * which is what this paragraph used to prescribe. `lib/actions/retain.ts`
 * carries why controlled is the wrong fix for a text input — it loses a
 * password-manager fill React never observed — and which two controls need the
 * opposite treatment.
 */
export function EditProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction, pending] = useActionState(retainProfile, initialState)

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

  const formRef = useRef<HTMLFormElement>(null)
  // What was on the form at submission, not what is on it now — see the same
  // ref in `CreateRideForm`. React resets uncontrolled fields to their
  // `defaultValue` once a form action settles, including on an error return,
  // so re-reading the live DOM here would parse the *saved* profile rather
  // than what the rider just typed, and could focus a field the error is not
  // about.
  const submittedData = useRef<FormData | null>(null)

  // Same reasoning as `CreateRideForm`: a disabled Save read as the resting
  // state of a form nobody had touched yet (worse here, since `location`
  // almost always arrives pre-filled — the disable only ever fired on a rider
  // who *cleared* it), and it left the tab order early for AT. `noValidate`
  // below turns off the browser's own bubble, so this moves focus to the
  // schema-rejected field instead, off the same `profileEditSchema` the action
  // parses.
  useEffect(() => {
    if (!state.error) return
    const data = submittedData.current
    const form = formRef.current
    if (!data || !form) return
    const parsed = profileEditSchema.safeParse({
      location: data.get('location'),
      bio: data.get('bio'),
      bike_model: data.get('bike_model'),
    })
    const field = parsed.success ? undefined : parsed.error.issues[0]?.path[0]
    if (typeof field === 'string') {
      const el = form.elements.namedItem(field)
      if (el instanceof HTMLElement) el.focus()
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        submittedData.current = new FormData(event.currentTarget)
      }}
      onChange={() => setDismissed(state)}
      noValidate
      className="flex flex-col gap-4 px-6"
    >
      <Input
        name="location"
        label="Where you ride from"
        defaultValue={state.retained.location ?? profile.location ?? ''}
        maxLength={100}
        required
      />
      <Input
        name="bike_model"
        label="Your bike"
        placeholder="e.g. Kawasaki Z900"
        defaultValue={state.retained.bike_model ?? profile.bike_model ?? ''}
        maxLength={BIKE_MODEL_MAX_LENGTH}
      />
      <Textarea
        name="bio"
        label="About you"
        placeholder="Tell other riders about yourself…"
        rows={4}
        defaultValue={state.retained.bio ?? profile.bio ?? ''}
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
