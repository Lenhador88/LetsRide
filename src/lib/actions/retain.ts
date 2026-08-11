'use client'

import { useEffect, type RefObject } from 'react'
import type { ActionState } from '@/lib/actions/state'

/**
 * Keeping what the rider typed when an action comes back with an error.
 *
 * ## The defect this exists to close
 *
 * React resets a `<form action={fn}>` once the action resolves — `form.reset()`
 * in the commit phase — so every *uncontrolled* field reverts to its
 * `defaultValue`. React cannot know whether the action succeeded, so this runs
 * on the error return exactly as it does on the success one, and an error
 * return is precisely the case where the rider is still on the form and needs
 * what they typed. PD-196 was the login screen losing an email; the create-ride
 * form loses seven fields the same way.
 *
 * ## Why the value is put back rather than held
 *
 * The obvious fix is a controlled input, and it is what React's own
 * documentation suggests. **It fails for a rider with a password manager**, and
 * that was measured rather than reasoned about (PD-196): a fill assigns the DOM
 * value, and if it lands before hydration or dispatches no `input` event React
 * is listening for, component state never learns of it — then `updateInput`
 * compares its prop against the *live DOM value* and overwrites the box from
 * its own stale state on the very next render. The field empties on click.
 *
 * `FormData` has no such blind spot. It is read from the DOM at submit time, so
 * typing, autofill, a paste and a script assignment are indistinguishable to
 * it. Recording it into the action's own state and feeding it back as
 * `defaultValue` therefore *aims* the reset instead of fighting it: the reset
 * still happens, and it restores the submitted value.
 *
 * ## Using it
 *
 * ```tsx
 * const [state, formAction, pending] = useActionState(
 *   retaining(createRide, ['title', 'is_public']),
 *   seedRetained(emptyActionState)
 * )
 * <Input name="title" defaultValue={state.retained.title} />
 * <Checkbox name="is_public" defaultChecked={wasChecked(state.retained, 'is_public', true)} />
 * ```
 *
 * An edit form falls back to the stored value, which is only ever used before
 * the first submit: `defaultValue={state.retained.bio ?? profile.bio ?? ''}`.
 * `??` and not `||` — a rider who cleared a field submitted `''`, and that is
 * an answer rather than an absence.
 *
 * ## `<select>` is the exception, and it must be controlled instead
 *
 * **A restored `defaultValue` does not reach a `<select>`.** React implements it
 * by setting `option.selected`, while `form.reset()` restores every option from
 * its `defaultSelected` — the `selected` *attribute* — which React never
 * writes. So the reset drops the choice back to the first option no matter what
 * value is fed back, and on this app's two selects the first option is the
 * *widest* audience: "No club" and "Everyone on LetsRide".
 *
 * This is measured rather than inferred. The walk's `refused create` phase was
 * written against a form where the select used `defaultValue` like every other
 * field, and it reported seven fields and a checkbox passing with the select
 * reading `""`.
 *
 * **Controlling it is necessary and not sufficient**, which is the second half
 * of the same measurement. Component state does survive the reset — the reset
 * touches the DOM, not React — but React writes a host element's DOM only when
 * its props *change*, and `clubId` is the same string before and after a
 * refusal. No re-render carries it back, so the box keeps showing the option
 * `form.reset()` left there. The phase reported `read ""` for a controlled
 * select exactly as it had for an uncontrolled one.
 *
 * `useRestoreSelection` closes it: an effect keyed on the action state runs
 * after the commit that performed the reset, and puts the value back. All three
 * selects use it, and none is named in a `retaining` call.
 *
 * **A controlled *checkbox* needs the same treatment**, via `useRestoreChecked`
 * below — and the way that was established is worth more than the conclusion. A
 * review pass predicted it and labelled the prediction inferred. A first
 * measurement appeared to refute it, so the hook was deleted. That measurement
 * was itself vacuous: the phase accepted `role="alert"` as proof of a refusal,
 * and both edit forms draw one live the moment the box is unticked, so nothing
 * had actually been submitted. With the assertion narrowed to the action's own
 * `role="status"`, the box came back ticked — `wanted false, read true`.
 *
 * **A green assertion is only as good as the precondition it asserted**, which
 * is the same lesson as the sign-in phase's refusal check, learned twice.
 *
 * **A password is not retained by default and each form decides.** `/auth/login`
 * deliberately drops it: the only error `signIn` returns means that password was
 * refused, and a rejected value sitting in the box invites an identical
 * resubmit. `/auth/signup` keeps it, because there the usual error is about the
 * *email* and retyping a long password the rider got right is pure cost.
 *
 * **A retained password moves from a DOM property into a DOM attribute**, which
 * is a small but real change rather than none: `defaultValue` reflects the
 * `value` content attribute, so the plaintext now appears in `input.outerHTML`
 * where before it lived only in `.value`, which is not serialized. Same-origin
 * script could always read `.value`, so this is not a new reader — what it adds
 * is every DOM-*serializing* consumer: a "save page", a Playwright trace, and
 * any error tracker that captures DOM snapshots. Error tracking is listed as
 * deliberately undecided in CLAUDE.md; whoever decides it should know this.
 */

/**
 * **Parameterised by the field names**, so `state.retained.meeting_pont` is a
 * compile error rather than an empty box. Without the type variable the keys
 * are `string` and a typo type-checks as `undefined` — which renders exactly
 * like a field the reset was supposed to restore, and is the one miswiring
 * this whole mechanism invites.
 */
export type RetainedFields<N extends string = string> = Readonly<Partial<Record<N, string>>>

/** An action state carrying what the last submit actually sent. */
export type WithRetained<S extends ActionState, N extends string = string> = S & {
  retained: RetainedFields<N>
}

/** The seed for `useActionState` — nothing submitted yet, so nothing retained. */
export function seedRetained<S extends ActionState, N extends string = string>(
  state: S
): WithRetained<S, N> {
  return { ...state, retained: {} as RetainedFields<N> }
}

/**
 * Wraps a form action so the named fields come back on its state.
 *
 * **A wrapper rather than a change to the actions themselves.** Every module
 * under `lib/actions/` is a plain async function that a test, an event handler
 * and a `useActionState` transition all call the same way, and what a form
 * needs in order to redraw itself is that screen's business rather than the
 * mutation's. `/onboarding/username` carries its refusal list the same way.
 *
 * **Every requested name is recorded, including the ones that arrived absent.**
 * An unticked checkbox sends nothing at all, so a map holding only what was
 * present cannot tell "unticked" from "never asked for" — and the fallback in
 * `wasChecked` would then re-tick a box the rider deliberately cleared, quietly
 * restoring a *public* default on a ride they wanted private.
 *
 * A `File` value records as `''`. Only name fields whose value is text; an
 * upload's identity belongs in the state the uploader already keeps.
 */
export function retaining<S extends ActionState, N extends string>(
  action: (previous: S, formData: FormData) => Promise<S>,
  names: readonly N[]
): (previous: WithRetained<S, N>, formData: FormData) => Promise<WithRetained<S, N>> {
  return async (previous, formData) => {
    const result = await action(previous, formData)
    const retained = {} as Record<N, string>
    for (const name of names) {
      const value = formData.get(name)
      retained[name] = typeof value === 'string' ? value : ''
    }
    return { ...result, retained }
  }
}

/**
 * Puts a controlled `<select>`'s value back after the post-action form reset.
 *
 * **Precondition the type cannot state: the action must return a fresh object
 * each submit.** `retaining` guarantees it and every action here returns an
 * object literal, but `state` is `unknown` and a memoised state would make this
 * effect fire once and never again.
 *
 * The reset is a DOM operation with no React render behind it, and React writes
 * a host element only when its props change — so a controlled select whose
 * value is unchanged across the submit is never re-applied, and the box is left
 * showing whatever `form.reset()` selected. On this app's two selects that is
 * the widest audience in the list, which makes it a privacy defect rather than
 * a cosmetic one.
 *
 * Keyed on the **state object's identity**, not on `value` — `value` is by
 * definition unchanged in the case this exists for, so a value dependency
 * would never fire. Same trap as `useActionRedirect`'s, for the same reason.
 *
 * This is the one place in this file that fights the reset rather than aiming
 * it, and only because a `<select>` gives it nothing to aim at.
 */
export function useRestoreSelection(
  ref: RefObject<HTMLSelectElement | null>,
  value: string,
  state: unknown
): void {
  useEffect(() => {
    const element = ref.current
    if (element && element.value !== value) element.value = value
    // `state` rather than `state.something` — see the identity note above.
  }, [ref, value, state])
}

/**
 * The same restore for a controlled checkbox, and it costs more when missing.
 *
 * `form.reset()` restores a checkbox from its `checked` **attribute**, which
 * React writes at mount rather than on every update, so a box the rider cleared
 * comes back ticked while React state still says `false`. Nothing looks wrong —
 * the box shows what it showed when the screen opened.
 *
 * **The consequence is data, not display.** `updateRide` and `updateClub` build
 * `is_public` from `FormData`, so the retry the rider makes after fixing
 * whatever was refused re-publishes the thing they had just made private, and
 * succeeds silently.
 *
 * An *uncontrolled* checkbox uses `wasChecked` below instead: `defaultChecked`
 * does survive the reset, which the create phase measured.
 */
export function useRestoreChecked(
  ref: RefObject<HTMLInputElement | null>,
  checked: boolean,
  state: unknown
): void {
  useEffect(() => {
    const element = ref.current
    if (element && element.checked !== checked) element.checked = checked
  }, [ref, checked, state])
}

/**
 * Whether a checkbox was ticked on the last submit, or `fallback` before there
 * has been one.
 *
 * A checkbox sends `'on'` when ticked and nothing when not, so the absent case
 * has to be told apart from the never-submitted one — see `retaining`. The
 * value is compared against `''` rather than `'on'` so a `value=` attribute on
 * the input does not silently turn every restore into `false`.
 */
export function wasChecked<N extends string>(
  retained: RetainedFields<N>,
  name: N,
  fallback: boolean
): boolean {
  const value = retained[name]
  return value === undefined ? fallback : value !== ''
}
