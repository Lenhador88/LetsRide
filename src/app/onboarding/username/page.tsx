'use client'

import { useActionState, useEffect, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { emptyActionState } from '@/lib/actions/state'
import { checkUsernameAvailability, setUsername } from '@/lib/actions/onboarding'
import { USERNAME_MIN_LENGTH } from '@/lib/validation/profile'

const DEBOUNCE_MS = 400

// Carries the value it was computed for. Without that, editing the field keeps
// the previous verdict on screen for the whole debounce window — type "abc",
// see "available", add a "d", and it still reads available for a name nobody
// checked.
type Availability = { value: string; available: boolean; error: string | null }

/**
 * Step 1 of 2 (decision #5, spec recommendation: the photo step is deferred
 * to a `media` follow-up). No back link — there is no previous step, and
 * "back" to signup is meaningless once the account already exists (Q12).
 *
 * The Figma screen this replaces is titled "What's your name?" over a plain
 * `Name` input — copy drawn before decision #7 moved this step to collecting
 * a unique `username`. Q4 says as much: "it was drawn as a display name."
 * Carrying that copy verbatim would label a field that enforces username
 * charset rules as a name field, so the title and input label below diverge
 * from the verified-measurements table on this one screen.
 */
export default function OnboardingUsernamePage() {
  const [state, formAction, pending] = useActionState(setUsername, emptyActionState)
  const [username, setUsernameValue] = useState('')
  const [availability, setAvailability] = useState<Availability | null>(null)

  // Advisory only (per lib/actions/onboarding.ts) — setUsername still handles
  // the taken case, so this never blocks submit, only informs it. Below the
  // length floor there is nothing to check yet, so the effect simply does not
  // schedule one; any stale result is hidden at render time rather than
  // cleared here, since setting state synchronously in an effect body triggers
  // a second, avoidable render.
  const tooShort = username.trim().length < USERNAME_MIN_LENGTH
  // Only show a verdict that belongs to what is currently in the field.
  const current = availability?.value === username.trim() ? availability : null

  useEffect(() => {
    if (tooShort) return

    const value = username.trim()
    let cancelled = false
    const timeout = setTimeout(() => {
      checkUsernameAvailability(value).then((result) => {
        if (!cancelled) setAvailability({ value, ...result })
      })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [username, tooShort])

  return (
    <form action={formAction}>
      <AuthScreen
        title="Choose a username"
        footer={
          <div className="flex flex-col gap-6">
            <Pagination total={2} current={0} />
            <div className="flex flex-col gap-2">
              <FormError message={state.error} />
              <Button type="submit" size="lg" loading={pending}>
                Next
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <Input
            name="username"
            label="Username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsernameValue(e.target.value.toLowerCase())}
            errorBorder={!tooShort && current?.available === false}
          />
          {!tooShort && current && (
            <p
              className={
                current.available
                  ? 'text-sm font-medium text-accent'
                  : 'text-sm font-medium text-danger'
              }
            >
              {current.available ? 'Username is available.' : current.error}
            </p>
          )}
        </div>
      </AuthScreen>
    </form>
  )
}
