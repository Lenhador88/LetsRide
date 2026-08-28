'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/actions/auth'
import type { ActionState } from '@/lib/actions/state'
import { BACK_ORIGIN_PARAM, resolveBackDestination } from '@/lib/back-navigation'
import {
  declinesSwipeBack,
  isSwipeBack,
  startsInEdgeZone,
  SWIPE_BACK_OPT_OUT,
  type SwipeBackNode,
} from '@/lib/swipe-back'

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
 *
 * **The residual cost of `replace`, stated rather than left to be rediscovered.**
 * It overwrites the current entry, so a rider who came from `/rides` ends up with
 * `[/rides, /rides]` — and their next *system* back gesture moves to index 0 and
 * renders `/rides` again. The screen does not change and the gesture reads as
 * dead, which is the same perceived failure `back-navigation.ts` calls
 * unacceptable, arriving from the OS rather than from this control.
 *
 * It is still the right trade and the alternatives are both worse: `push` sends
 * that gesture back to `/notifications`, and `router.back()` reintroduces a dead
 * in-app arrow on a cold deeplink carrying `?from=` — the failure this design
 * exists to refuse. Fixing it properly needs history the app does not own.
 */
export function useBack(): () => void {
  const router = useRouter()

  return useCallback(() => {
    const from = new URLSearchParams(window.location.search).get(BACK_ORIGIN_PARAM)
    router.replace(resolveBackDestination(from))
  }, [router])
}


/**
 * A strong swipe right from the left edge leaves a detail screen — PD-341.
 *
 * **`back` is whatever the screen's own back control is**, and the two must not
 * be allowed to differ: an href for the screens whose way back is a fixed URL,
 * the handler for `/notifications`, whose four entry points make any single href
 * wrong from three of them. That mirrors `Header`'s `backHref`/`onBack` pair
 * exactly, so a screen wires the gesture with the value it already computed.
 * `null` turns the gesture off, which is what a screen with no back control
 * passes.
 *
 * **`push` for the href form**, because that is what `Header` draws — a
 * `<Link>` — and the gesture is a second route to the same control rather than
 * a different navigation. `/notifications` gets `replace` by passing `useBack`,
 * which owns that choice and the reasoning for it.
 *
 * ## Which screens call this, and which deliberately do not
 *
 * Every **read** screen with a back control: the ride plan, crew, invite and
 * chat; the club detail, members, rides, threads and one thread; the postcard
 * thread; the profile detail; and `/notifications`.
 *
 * **Not the create and edit forms** — `/rides/new`, `/clubs/new`,
 * `/postcards/new`, both edit screens and the new-thread screen. Leaving those
 * discards typing the rider cannot get back, and an accidental gesture there
 * costs work rather than a tap. They keep the arrow, which is deliberate and
 * hard to hit by mistake. This is why the hook is opt-in per screen rather than
 * mounted inside `Header`, which would have reached every one of them for free.
 *
 * ## Why a window listener rather than a wrapper element
 *
 * The gesture belongs to the screen, not to a box inside it, and every one of
 * these screens is a fragment under a shared shell — there is no single node to
 * wrap that is not the app itself. Listening on `window` also means the gesture
 * works over the fixed header and the RSVP bar, which sit outside the scrolling
 * content.
 *
 * **Nothing is ever `preventDefault`ed and no `touch-action` is set.** A
 * declined swipe is a swipe this hook says nothing about, so the deck, the
 * strips and the page scroll exactly as they did — see `swipe-back.ts`.
 *
 * ## `chain` is the unmeasured part of this feature, and it is not the numbers
 *
 * `declinesSwipeBack` has **six** cases over hand-built nodes — six, not the
 * fifteen in that file, which is its whole suite including the two geometry
 * predicates — and by construction none of them can fail if `chain` feeds it the
 * wrong shape.
 *
 * Re-derive rather than trust that:
 * `npx vitest list --run src/lib/__tests__/swipe-back.test.ts`. Every
 * decline rests on two DOM facts nothing here has executed: that
 * `getComputedStyle(el).overflowX` answers `'auto'` for a Tailwind
 * `overflow-x-auto` element, and that `scrollWidth > clientWidth` is true for a
 * strip wider than its box. Both are ordinary and both are believed rather than
 * measured, because Chromium in the build container cannot reach Supabase and
 * the walk cannot sign in.
 *
 * That is a sharper label than the thresholds carry: a wrong threshold makes the
 * gesture feel bad and is cheap to retune, while a wrong `chain` makes the
 * gesture fire inside a strip the rider was scrolling. **First thing to check on
 * a device**, before any of the numbers.
 *
 * ## The overlay case, which is PD-317's warning
 *
 * A gesture is refused outright while any `[role="dialog"][aria-modal="true"]`
 * is mounted — the postcard viewer, the notifications panel, every
 * `ContextMenu`. The native shell's own Back already dismisses the screen
 * underneath an overlay rather than the overlay, and this must not become a
 * second control with the same defect: with the panel open, "back" means close
 * the panel, and this hook has no way to do that. Refusing is the honest
 * answer; navigating out from under an open sheet is the wrong one.
 */
export function useSwipeBack(back: string | (() => void) | null): void {
  const router = useRouter()

  // The destination must not re-arm the listeners on every render — a caller
  // passing an inline arrow would otherwise detach and reattach on each pass,
  // losing an in-flight gesture. The ref is read inside the listener, so the
  // listener effect depends on nothing that changes per render.
  //
  // Written in its own effect rather than during render: a ref mutated in a
  // render body is read by React Compiler and the lint rule as a side effect,
  // and the listeners only ever read it after a commit anyway.
  const target = useRef(back)
  useEffect(() => {
    target.current = back
  }, [back])

  useEffect(() => {
    // The gesture in flight, or null. A ref rather than state: nothing renders
    // from it, and a `setState` per `pointerdown` would re-render every screen
    // that mounts this on every tap.
    let gesture: { x: number; y: number; at: number } | null = null

    const chain = (node: EventTarget | null): SwipeBackNode | null => {
      // A synthetic or detached target is not something to reason about. The
      // gesture is dropped rather than allowed, which is the safe direction:
      // the rider keeps the arrow.
      if (!(node instanceof Element)) return null

      let head: SwipeBackNode | null = null
      let tail: SwipeBackNode | null = null

      for (let el: Element | null = node; el; el = el.parentElement) {
        const style = getComputedStyle(el)
        const link: SwipeBackNode = {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: style.overflowX,
          optOut: el.getAttribute(SWIPE_BACK_OPT_OUT),
          tagName: el.tagName,
          isContentEditable: el instanceof HTMLElement && el.isContentEditable,
          parent: null,
        }
        if (tail) tail.parent = link
        else head = link
        tail = link
      }

      return head
    }

    const onDown = (event: PointerEvent) => {
      gesture = null
      if (!target.current) return
      // Touch and pen only. A mouse drag from the left edge is a text selection
      // or a scrollbar, never a back gesture, and there is a visible arrow for
      // anyone holding a mouse.
      if (event.pointerType === 'mouse') return
      // A second finger is a pinch or a two-handed hold, not this.
      if (!event.isPrimary) return
      if (!startsInEdgeZone(event.clientX)) return
      // PD-317 — see the header. `document` rather than a tracked flag: any
      // overlay in the app answers this, including ones added later.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (declinesSwipeBack(chain(event.target))) return

      gesture = { x: event.clientX, y: event.clientY, at: event.timeStamp }
    }

    const onUp = (event: PointerEvent) => {
      const started = gesture
      gesture = null
      const destination = target.current
      if (!started || !destination) return

      if (
        !isSwipeBack({
          startX: started.x,
          startY: started.y,
          endX: event.clientX,
          endY: event.clientY,
          elapsedMs: event.timeStamp - started.at,
        })
      ) {
        return
      }

      if (typeof destination === 'string') router.push(destination)
      else destination()
    }

    // `pointercancel` is what the browser sends once it takes the gesture for a
    // scroll, so this is not merely tidy: without it a vertical scroll that
    // began at the left edge would still be measured at its `pointerup` and
    // could clear the axis test on the way back up.
    const onCancel = () => {
      gesture = null
    }

    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onCancel, { passive: true })

    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
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
