'use client'

import { useCallback, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/actions/auth'
import type { ActionState } from '@/lib/actions/state'
import { BACK_ORIGIN_PARAM, resolveBackDestination } from '@/lib/back-navigation'

/**
 * The honouring half of `ActionState.redirectTo` — task 5.8.
 *
 * Before the render migration a successful write called `redirect()` inside a
 * Server Action, which navigates by throwing on the server. Nothing in the
 * browser had to participate. Now the write returns a destination and something
 * has to act on it, and that something must be a hook: navigation is React
 * state, and the action itself is a plain async function that a test, an event
 * handler and a `useActionState` transition all call the same way.
 *
 * **In an effect, not in the transition.** `useActionState`'s reducer runs
 * inside a transition React may replay; pushing a route from there navigates on
 * the replay too. An effect keyed on the state object runs once per committed
 * state, which is the guarantee this needs.
 *
 * **Keyed on the state object's identity, not on `redirectTo`'s value.** Two
 * consecutive submits that both resolve to `/postcards` produce equal strings
 * and distinct objects — `state.ts` says the same thing about `sent`, and it is
 * the same trap. A value dependency would skip the second navigation, which is
 * exactly the case a rider hits by pressing Back and submitting again.
 *
 * `replace` rather than `push`, matching what `redirect()` did: a completed
 * signup, a created club or a posted postcard must not sit in the history for
 * Back to resubmit.
 */
export function useActionRedirect(state: ActionState): void {
  const router = useRouter()

  useEffect(() => {
    if (!state.redirectTo) return
    router.replace(state.redirectTo)
    // `state` rather than `state.redirectTo` — see the identity note above.
  }, [state, router])
}

/**
 * The handler behind `Header`'s `onBack` — a back control for a screen with more
 * than one way in, where a static `backHref` would have to guess which.
 * `@/lib/back-navigation` carries the whole decision, including why this
 * navigates to a carried origin rather than popping the history.
 *
 * **`window.location` is read inside the handler, never during render**, which
 * is also why this reads the parameter itself instead of `useSearchParams()`.
 * That hook is the right tool for the ten detail routes, which need their id
 * *during* render to issue a read and therefore pay for a `<Suspense>` boundary
 * Next requires of a prerendered route. Nothing here is wanted until the rider
 * taps, so the boundary would buy nothing — and `/notifications` keeps
 * prerendering static, which is the check that this stayed true.
 *
 * `replace` rather than `push`: the rider is leaving this screen, and pushing
 * would leave it one entry back for their next system-back gesture to return to.
 */
export function useBack(): () => void {
  const router = useRouter()

  return useCallback(() => {
    const from = new URLSearchParams(window.location.search).get(BACK_ORIGIN_PARAM)
    router.replace(resolveBackDestination(from))
  }, [router])
}

/**
 * Sign-out, for the two controls that offer it: the profile overflow sheet and
 * the consent prompt's way out.
 *
 * It is a hook rather than a bare call because both sites render a pending
 * label, and because sign-out is the one action whose navigation must not go
 * through `useActionRedirect` — that hook waits for a committed
 * `useActionState`, and these are buttons, not forms. `signOut` was a
 * `<form action>` at the consent prompt for exactly that reason and cannot stay
 * one: it returns a value now, which a form action may not.
 *
 * `router.replace` **and** `router.refresh()`. The replace is the navigation;
 * the refresh is what discards the Next router's own client-side route cache,
 * which `clearQueryCache()` inside the action knows nothing about. Without it a
 * Back press can paint the previous rider's rendered screen from that cache
 * before the guard runs — the shared-device case of task 4.6, and the one piece
 * of rider A's state that does not live in the query cache.
 */
export function useSignOut(): { signOut: () => void; pending: boolean } {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const run = useCallback(() => {
    // The callback is async and awaited. A sync callback discarding the promise
    // ends the transition on the same tick, so `pending` flips back before the
    // action has done anything and the label flashes.
    startTransition(async () => {
      const { redirectTo } = await signOut()
      router.refresh()
      if (redirectTo) router.replace(redirectTo)
    })
  }, [router])

  return { signOut: run, pending }
}
