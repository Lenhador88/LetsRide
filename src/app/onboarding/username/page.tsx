'use client'

import { useActionState, useEffect, useState } from 'react'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { FormError } from '@/components/auth/FormError'
import {
  normaliseUsername,
  rememberRefusal,
  usernameCheckUnanswered,
  usernameVerdict,
  type UsernameCheck,
} from '@/components/auth/username-verdict'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import {
  checkUsernameAvailability,
  setUsername,
  type UsernameActionState,
} from '@/lib/actions/onboarding'
import { USERNAME_MIN_LENGTH } from '@/lib/validation/profile'

const DEBOUNCE_MS = 400

/**
 * The action's state plus the names the unique index has already refused this
 * session — see `rememberRefusal` for why the list is carried here rather than
 * in a ref or an effect.
 */
type UsernameFormState = UsernameActionState & { refused: readonly string[] }

const initialState: UsernameFormState = { ...emptyActionState, refused: [] }

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
  const [username, setUsernameValue] = useState('')
  const [checked, setChecked] = useState<UsernameCheck | null>(null)
  // The folded value whose availability read failed, or null. See
  // `usernameCheckUnanswered` for why a failure is a third state rather than
  // `available: false`.
  const [checkFailedFor, setCheckFailedFor] = useState<string | null>(null)

  // The wrapper exists only to carry the refused list forward: `setUsername` is
  // a plain async function that a test calls the same way, and accumulating a
  // form's own history inside it would make it a reducer over UI state.
  const [state, formAction, pending] = useActionState<UsernameFormState, FormData>(
    async (previous, formData) => {
      const result = await setUsername(previous, formData)
      return { ...result, refused: rememberRefusal(previous.refused, result.taken) }
    },
    initialState
  )
  useActionRedirect(state)

  // Advisory only (per lib/actions/onboarding.ts) — setUsername still handles
  // the taken case, so this never blocks submit, only informs it. Below the
  // length floor there is nothing to check yet, so the effect simply does not
  // schedule one; any stale result is hidden at render time rather than
  // cleared here, since setting state synchronously in an effect body triggers
  // a second, avoidable render.
  const tooShort = normaliseUsername(username).length < USERNAME_MIN_LENGTH
  const verdict = usernameVerdict(username, checked, state.refused)

  // Whether the field has anything to say right now — `verdict` is exactly what
  // it renders. This is what decides where a refusal is drawn, and both of the
  // simpler rules are wrong in a way worth recording, because each looks
  // obviously right until the other case shows up:
  //
  //   - Suppress at the button whenever the last submit was refused, and a
  //     rider who edits the field between pressing Next and the response
  //     landing gets no message anywhere. The field only ever speaks about what
  //     is currently in it, so it has nothing to say about the value that was
  //     submitted, and the button has been silenced on its behalf.
  //   - Suppress only while the field is showing that same refusal, and the
  //     button keeps a message about a name the rider has already abandoned.
  //     Refused `roadking`, type a free `nightrider`, and it reads green at the
  //     field and red at the button — PD-146's own shape, moved onto the next
  //     name, and it persists until the next submit rather than clearing.
  //
  // So: the field owns the refusal whenever it can draw one, and the button
  // carries it only in the gap where the field is blank. Everything else in
  // `state.error` — a network failure, a lost session — is about the submit
  // rather than about a value, and always belongs at the button.
  //
  // A failed *check* deliberately does not count as the field speaking here.
  // This flag decides where a REFUSAL is drawn, and "we could not look it up"
  // is not one — folding it in would suppress a real submit error at the button
  // whenever the advisory read happened to be down.
  const fieldSilent = tooShort || !verdict
  const checkUnanswered = usernameCheckUnanswered(username, verdict, checkFailedFor)

  useEffect(() => {
    if (tooShort) return

    const value = normaliseUsername(username)
    let cancelled = false
    const timeout = setTimeout(() => {
      // Checked as typed, keyed as folded. The availability answer is
      // case-insensitive (056), so one entry covers every case-variant — but the
      // charset and reserved-name messages the check also returns should be
      // about the value the rider actually wrote, not a lowercased copy of it.
      checkUsernameAvailability(username)
        .then((result) => {
          if (cancelled) return
          setCheckFailedFor(null)
          setChecked({ value, ...result })
        })
        // `unwrap` throws on a PostgREST error, so this rejects on a dropped
        // connection, an expired session, or the RPC being absent — which is
        // exactly what a database running ahead of or behind this bundle looks
        // like. Without a catch the rejection notifies nothing and the field
        // stays blank for ever; the rider is not told, and the submit they can
        // still make is the only thing that would tell them.
        .catch(() => {
          if (!cancelled) setCheckFailedFor(value)
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
              {/* A refusal is suppressed here whenever the field can draw one,
                  whether about this name or another — see `fieldSilent`. */}
              <FormError message={state.taken && !fieldSilent ? null : state.error} />
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
            // NOT `off`, and not `username`. A field named `username`, alone in
            // a form, is exactly Chrome's "username-first sign-in flow" shape,
            // so a password manager offers to fill a saved credential — or to
            // save one — on a screen that has no password on it at all. Every
            // major manager documents `autocomplete="off"` as advisory and
            // ignores it here, which is why `off` did not stop it.
            //
            // `nickname` is a real WHATWG autofill token, and it is the honest
            // one: a rider signs in with their EMAIL and password, so this
            // value is not a credential in this app — it is the handle drawn on
            // bylines and member lists. Declaring it as profile data rather
            // than as a login identifier is what moves it out of the password
            // manager's scope, and it happens to be true.
            autoComplete="nickname"
            // Inert vendor opt-outs, one per manager that ignores the standard
            // token as well. They render as plain data attributes to anything
            // that does not know them.
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            // Not lowercased on the way in: 056 stores the case the rider
            // typed, so forcing it here would make `Pedro` unreachable through
            // the only screen that writes a username. `autoCapitalize="none"`
            // stays — it stops a phone keyboard capitalising the first letter on
            // the rider's behalf, which is a different thing from refusing one.
            onChange={(e) => setUsernameValue(e.target.value)}
            errorBorder={!tooShort && verdict?.available === false}
          />
          {/* Always mounted, so the flip from "available" to "taken" is
              announced. A live region added at the same moment as its content
              is not reliably read out. */}
          <div aria-live="polite">
            {!tooShort && verdict && (
              <p
                className={
                  verdict.available
                    ? 'text-sm font-medium text-accent'
                    : 'text-sm font-medium text-danger'
                }
              >
                {verdict.available ? 'Username is available.' : verdict.error}
              </p>
            )}
            {/* Muted rather than danger, and no `errorBorder`: the check failed,
                the name did not. Saying so in red would refuse a name that is
                probably free, on a step decision #5 makes unskippable. */}
            {!tooShort && checkUnanswered && (
              <p className="text-sm font-medium text-muted">
                Couldn&rsquo;t check that name right now — you can still continue.
              </p>
            )}
          </div>
        </div>
      </AuthScreen>
    </form>
  )
}
