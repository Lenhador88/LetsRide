'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PostcardCard } from '@/components/postcards/PostcardCard'
import { armsDrag, remainingPostcards, resolveSwipe } from '@/components/postcards/deck'
import { claimSwipeCoach, swipeCoachStore } from '@/components/postcards/coachMark'
import { SwipeCoach } from '@/components/postcards/SwipeCoach'
import { cn } from '@/lib/utils'
import type { Postcard } from '@/types'
import { MarkFeedSeen } from '@/components/postcards/MarkFeedSeen'

/**
 * The home screen's card stack — `Postcard Stack` in
 * `Home - Postcards - All new`, measured from the committed snapshot.
 *
 * Three cards sit at the same centre, 342×448, and the two behind the front one
 * are rotated. The rotations are exact: −2° for the middle card and +2° for the
 * deepest, read from the raw node and now carried in the snapshot (the pruned
 * tree used to drop `rotation`, which made the fan look like three
 * differently-sized cards).
 *
 * **Swiping in either direction advances to the next postcard**, which is the
 * behaviour the product owner described. That means the deck only ever moves
 * forward; "Start over" at the end is the only way back, because a back
 * affordance would be UI the design does not draw.
 *
 * **No touch advances the deck except a lift, and only in the direction the
 * card is drawn in** (PD-221) — the sr-only "Next postcard" button below is
 * the one deliberate non-touch route. Both halves were one defect:
 * `pointercancel` was wired straight to the release handler, so a gesture the
 * platform took away mid-touch committed as though the rider had finished it,
 * judged on a coordinate that need not agree with what was drawn. See
 * `onPointerCancel` below and `resolveSwipe` in `./deck`.
 *
 * **A swipe starts anywhere on the card, controls included.** Pointer capture
 * is taken on distance rather than at `pointerdown` (`armsDrag` in `./deck`),
 * which is what lets the like, comment, share and overflow controls keep their
 * clicks while the strip they sit in still drags. The card's photo is under
 * half its height, so refusing a gesture that began on a control — the shape
 * this deck carried until then — read to a rider as swiping working only on
 * the picture.
 *
 * **Nothing drew that gesture until PD-324**, so the deck now coaches it once
 * per device on first sight of a card — `SwipeCoach` for the overlay,
 * `./coachMark` for the flag. The overlay takes no pointer input and this
 * component owns its dismissal, which is what keeps it clear of both
 * behaviours above and of PD-316's tap-to-open photo button.
 */
const BEHIND = [
  { rotate: -2, scale: 1, z: 20 },
  { rotate: 2, scale: 1, z: 10 },
]

/**
 * How long the swipe coach mark stays up with nothing touching the deck
 * (PD-324). Long enough to be read at a glance on a screen the rider has just
 * arrived at, short enough that it is gone before it becomes furniture — and it
 * is a *ceiling*, not a duration: any pointer on the card takes it away sooner.
 */
const COACH_TIMEOUT = 4000

/**
 * How long after the first card the pill appears. `/postcards` gives this deck
 * `motion-safe:animate-fade-in` (230ms), so a hint drawn immediately lands on a
 * card still fading up.
 */
const COACH_ARRIVE = 400

/** The pill's fade-out, matching `SwipeCoach`'s own `duration-200`. */
const COACH_FADE = 200

/**
 * `shown` is the pill up and animating; `leaving` is the fade a dismissal
 * starts, kept mounted so the pill fades rather than vanishing under the
 * finger that dismissed it.
 */
type CoachPhase = 'hidden' | 'shown' | 'leaving'

/**
 * `offset` is the authority on where the card is, and `dx` is its mirror for
 * rendering — not the other way round. A release is decided from the ref
 * because `pointermove` is a continuous event: React is free to batch its
 * `setDx`, so the `pointerup` handler can be a closure over a `dx` one move
 * out of date. The ref is written synchronously and cannot be.
 *
 * `frontId` is the card the gesture *started* on. The feed revalidates
 * underneath the deck — a block, a hide, a delete — so the front card can be a
 * different postcard by the time the finger lifts, and dismissing whichever
 * card happens to be there is the same defect `advance` already guards its
 * timeout against.
 */
type DragState = {
  pointerId: number
  startX: number
  offset: number
  frontId: string
  /**
   * True once the pointer has travelled `DRAG_ARM_THRESHOLD` and the deck has
   * captured it. Before that the gesture is still potentially a tap and the
   * card is not drawn as moving, so a press on a control behaves exactly as it
   * did before the deck existed.
   */
  armed: boolean
} | null

export function PostcardDeck({
  postcards,
  className,
}: {
  postcards: Postcard[]
  /** Merged onto whichever root renders — the empty state and the fanned
   * stack both need it applied at the same node `SkeletonDeck` shares
   * `h-full` with, rather than on a wrapper that would break that chain.
   *
   * **The fade therefore plays once, on arrival, and not again when the
   * rider swipes the last card away.** Both roots are a `div` at one
   * position, so React updates in place and `animation-name` never changes
   * — which is the behaviour wanted here: a swipe is not a load, and
   * re-fading on it would read as the flash this animation exists to
   * remove. */
  className?: string
}) {
  // The ids the rider has swiped past — see `remainingPostcards` for why this is
  // a set of ids rather than a position. The feed is bounded by FEED_PAGE_SIZE,
  // so this cannot grow beyond a page.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [dx, setDx] = useState(0)
  // Set while the swiped card animates off, so the next render does not snap it
  // back to centre before the transition finishes.
  const [leaving, setLeaving] = useState<number | null>(null)
  // Mirrors `drag.current` as state: the transition has to be suppressed while a
  // finger is down, and a ref read during render would not re-run this component
  // when it changed.
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState>(null)
  /**
   * Set when a gesture became a drag, so the click the browser fires afterwards
   * is swallowed rather than reaching whatever the finger started on. A drag
   * that begins on the like button must not also like the postcard.
   *
   * Cleared on the next `pointerdown` as well as on use, because a drag does
   * not always produce a click — leaving the flag set would eat the next real
   * tap instead.
   */
  const suppressClick = useRef(false)

  // The one-time swipe coach mark (PD-324). `hidden` is both the initial state
  // and the resting one: the pill is decided in an effect, never during render,
  // because the first render is the SSR/prerender pass where there is no
  // `localStorage` to read the flag out of.
  const [coach, setCoach] = useState<CoachPhase>('hidden')
  /**
   * The pending arrival, so a touch can cancel a pill that has not appeared
   * yet — see `dismissCoach`. `null` whenever nothing is scheduled.
   */
  const coachArrival = useRef<number | null>(null)
  /**
   * Set once this mount has decided, either by putting the pill up or by a
   * touch that cancelled it. The effect below re-runs whenever the deck goes
   * from having no card to having one, and "Start over" at the end of the deck
   * is exactly that transition — without this, finishing the deck and starting
   * over would coach the rider a second time on a gesture they just used.
   *
   * Deliberately **not** set before the arrival timer fires, which is what
   * makes the effect safe to run twice: React StrictMode runs every effect
   * twice in development — mount, cleanup, mount — and a flag set up front
   * would let the cleanup cancel the only scheduled pill while the second pass
   * declined to schedule another, so the coach mark would never appear in
   * `npm run dev` while being correct in production.
   */
  const coachDecided = useRef(false)

  /**
   * Takes the coach mark away on the rider's first touch, whatever that touch
   * turns out to be — a tap that opens the postcard, or the first millimetre of
   * the swipe it is teaching.
   *
   * **The overlay has no pointer surface of its own**, so this is the only
   * route: `SwipeCoach` is `pointer-events-none` precisely so it cannot take
   * the tap that PD-316's photo button and this deck's own controls are
   * expecting. That is also what makes the issue's *"never require a second
   * interaction to get past"* true by construction — the dismissing touch is
   * never spent on the dismissal.
   *
   * **It cancels a pill that has not arrived yet as well as one that has**, and
   * that half is not symmetry for its own sake: without it a rider who touches
   * the card inside `COACH_ARRIVE` gets told how to swipe ~400ms *after*
   * swiping, and then waits out the full `COACH_TIMEOUT` because their one
   * touch is already spent. The flag is deliberately left unclaimed on that
   * path — nothing was shown, so nothing should be recorded as shown.
   */
  const dismissCoach = useCallback(() => {
    if (coachArrival.current !== null) {
      window.clearTimeout(coachArrival.current)
      coachArrival.current = null
      coachDecided.current = true
    }
    setCoach((phase) => (phase === 'shown' ? 'leaving' : phase))
  }, [])

  /**
   * `frontId` is captured at the call rather than read when the timeout fires.
   * A revalidation landing mid-animation can change which card is at the front,
   * and dismissing whichever card happens to be there 220ms later would skip an
   * unseen one — the same defect this component is being fixed for, reintroduced
   * through the back door.
   */
  const advance = useCallback((direction: 1 | -1, frontId: string) => {
    setLeaving(direction)
    setDx(direction * 600)
    window.setTimeout(() => {
      // Adding an id that is already present is a no-op, so a double-tap on the
      // keyboard control cannot dismiss two cards.
      setDismissed((previous) => new Set(previous).add(frontId))
      setDx(0)
      setLeaving(null)
    }, 220)
  }, [])

  // Computed before the handlers because they need the front card's id, and
  // recomputed every render so a revalidation that removes cards is reflected
  // immediately rather than at the next swipe.
  const remaining = remainingPostcards(postcards, dismissed)
  const front = remaining[0]

  /**
   * First sight of a card is what the coach mark is for, so this is gated on
   * there being one rather than on mounting: the empty state and the
   * end-of-deck state both draw no card, and coaching a gesture over "There are
   * no new postcards, yet!" would spend the one showing this device ever gets
   * on a screen with nothing to swipe.
   *
   * **The pill arrives a beat after the card does**, which is `COACH_ARRIVE`
   * and is two things at once. It reads better — `/postcards` hands this deck
   * `motion-safe:animate-fade-in`, and a hint drawn during that fade lands on a
   * card that is not there yet — and it is what keeps `setCoach` out of an
   * effect body, which `react-hooks/set-state-in-effect` rejects for the
   * cascading render it causes.
   *
   * **`claimSwipeCoach` is called inside the timer, not beside it, and the
   * difference is the whole once-per-device guarantee.** It both answers and
   * spends (see its header for why the flag is written at first sight rather
   * than at dismissal) — so calling it here in the effect body would spend the
   * device's one showing `COACH_ARRIVE` before anything is drawn, and every
   * teardown inside that window would leave the flag written and the rider
   * coached zero times, for ever: a filter tap, which remounts this deck
   * because `/postcards` keys it on the filter; a bottom-bar tap, on what is
   * the first screen after sign-in; or the last card leaving. Claiming when the
   * pill actually goes up makes the cancelled cases cost nothing, and the flag
   * is still spent before any of the three dismissal routes can run.
   *
   * Keyed on *whether* there is a card rather than on which one, so a
   * revalidation swapping the front postcard does not run this cleanup at all.
   */
  const hasCard = front !== undefined
  useEffect(() => {
    if (coachDecided.current || !hasCard) return
    const timer = window.setTimeout(() => {
      coachArrival.current = null
      coachDecided.current = true
      if (claimSwipeCoach(swipeCoachStore())) setCoach('shown')
    }, COACH_ARRIVE)
    coachArrival.current = timer
    return () => {
      window.clearTimeout(timer)
      coachArrival.current = null
    }
  }, [hasCard])

  /**
   * The pill's own clock: up to `COACH_TIMEOUT` on screen, then
   * `COACH_FADE` fading, then gone. One timer at a time and cleared on unmount,
   * so a rider who leaves the screen mid-hint does not have `setCoach` called
   * on a component that no longer exists.
   *
   * A dismissal from `dismissCoach` re-enters this effect at `leaving`, which
   * cancels the timeout above rather than racing it.
   */
  useEffect(() => {
    if (coach === 'hidden') return
    const timer = window.setTimeout(
      () => setCoach(coach === 'shown' ? 'leaving' : 'hidden'),
      coach === 'shown' ? COACH_TIMEOUT : COACH_FADE
    )
    return () => window.clearTimeout(timer)
  }, [coach])

  /**
   * The front card can be replaced *under an active drag* — `useQuery` refetches
   * on reconnect and on tab focus, and the feed can come back without it. React
   * unmounts that card's div and every pointer handler on it, `onPointerCancel`
   * included, so no event can ever arrive to end the gesture: without this the
   * deck sits at the vanished card's offset with transitions still suppressed
   * until the rider touches it again.
   *
   * This is the half `onPointerCancel` structurally cannot cover, because the
   * node it is attached to is the one being removed.
   */
  useEffect(() => {
    if (!drag.current) return
    drag.current = null
    // A drag that never armed cannot have set this, but a click can still be on
    // its way from before the card changed. Cleared here so it cannot swallow a
    // control's click — including a keyboard Enter, which arrives as a `click`
    // with no `pointerdown` in front of it to clear the flag.
    suppressClick.current = false
    setDragging(false)
    setDx(0)
  }, [front?.id])

  /**
   * **An unarmed gesture holds no capture, so its end may never reach this
   * card — and without this the deck jams.**
   *
   * Touch and pen get *implicit* capture at `pointerdown` (Pointer Events L3),
   * so a finger always delivers its own `pointerup`. **A mouse does not**: its
   * events are hit-tested, so a press on the card followed by a flick off it —
   * one `pointermove` sample is ~8ms, so an ordinary brisk gesture leaves in a
   * single step — delivers no further move, no up and no cancel. `drag.current`
   * would then stay set for ever, and everything downstream of it is worse than
   * a stuck flag:
   *
   *   - every later `pointerdown` bails on `drag.current`, so the deck accepts
   *     no swipes at all until the front card changes, which needs a swipe;
   *   - a mouse's `pointerId` is stable, so a later *hover* move matches the
   *     dead gesture, arms it against the old `startX`, and the card starts
   *     tracking a cursor with no button held;
   *   - the next click then arrives as a `pointerup` on an armed gesture with a
   *     large offset, and **dismisses a postcard nobody swiped** — which breaks
   *     this component's own invariant that only a lift advances the deck.
   *
   * Listening on the window is the fix rather than capturing earlier, because
   * capturing earlier is what took the controls' clicks away in the first
   * place. An unarmed gesture has drawn nothing and captured nothing, so
   * forgetting it is the whole cleanup.
   */
  useEffect(() => {
    const forgetUnarmed = () => {
      if (!drag.current || drag.current.armed) return
      drag.current = null
    }
    window.addEventListener('pointerup', forgetUnarmed)
    window.addEventListener('pointercancel', forgetUnarmed)
    return () => {
      window.removeEventListener('pointerup', forgetUnarmed)
      window.removeEventListener('pointercancel', forgetUnarmed)
    }
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Ahead of every guard below, because the coach mark goes away on the
    // rider's first touch of the card whether or not that touch becomes a
    // gesture this deck accepts — a second finger, or a press while the last
    // card is animating out, still means they have found the deck.
    dismissCoach()

    // A second finger landing must not re-anchor the gesture: overwriting the
    // drag state moves `startX` to the new touch while the card keeps the first
    // one's offset, which makes the card jump.
    // Only an ARMED gesture blocks a new one. A second finger landing mid-swipe
    // must not re-anchor `startX` — the card would jump — but an unarmed entry
    // has drawn nothing and captured nothing, so replacing it is free and is a
    // second line of defence against one being stranded (see `forgetUnarmed`).
    if (leaving !== null || !front || drag.current?.armed) return

    suppressClick.current = false

    /**
     * **Capture is deliberately NOT taken here**, and that is the whole fix for
     * a card whose bottom half would not swipe.
     *
     * `setPointerCapture` retargets every later pointer event to the card, so
     * the browser never delivers a `click` to whatever was pressed — which once
     * made every control on the front card dead: the overflow menu, like,
     * comment and share (verified against the real app 2026-08-05; a pointer
     * click left `aria-expanded` false with no dialog in the DOM). The fix then
     * was to refuse the gesture whenever it began on a `button` or `a`.
     *
     * That traded one defect for a quieter one. The photo is under half the
     * card's 448px, and the action row plus its controls is a wide strip across
     * the rest, so a rider swiping anywhere but the picture was often starting
     * on a control and getting nothing at all.
     *
     * Arming on distance keeps both behaviours: no capture until the pointer
     * has plainly stopped being a tap, so a press on a control is never
     * retargeted and its click arrives intact, and once `armsDrag` is true the
     * deck takes the gesture and suppresses the click that would have followed.
     */
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      offset: 0,
      frontId: front.id,
      armed: false,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    // Written to the ref first, mirrored to state for the transform. The two are
    // the same number, so the card cannot commit in a direction it was never drawn in.
    state.offset = event.clientX - state.startX

    if (!state.armed) {
      // Still inside the slop: the card is not drawn as moving, so a tap that
      // wobbles a pixel or two does not nudge the deck.
      //
      if (!armsDrag(state.offset)) return
      state.armed = true
      setDragging(true)
      // Taken now rather than at `pointerdown`, which is what lets a control
      // keep its click. From here the gesture is the deck's and every later
      // event arrives at the card even if the finger leaves it.
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    setDx(state.offset)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null

    // Never armed, so this was a tap. The deck neither moved nor captured, and
    // the click is on its way to whatever was pressed — leave both alone.
    if (!state.armed) return

    // It became a drag, so the click the browser is about to fire is a phantom
    // of where the finger landed. A swipe that started on the like button must
    // not also like the postcard.
    suppressClick.current = true

    setDragging(false)
    // A lift's own coordinate is authoritative and can be a frame of travel
    // ahead of the last `pointermove`; `resolveSwipe` lets it extend the travel
    // without letting it choose the direction.
    const direction = resolveSwipe(state.offset, event.clientX - state.startX)
    // A revalidation can swap the front card mid-drag. Advancing then would
    // dismiss a postcard that was never under the finger, so the gesture is
    // spent returning the deck to centre instead.
    if (direction !== null && front && front.id === state.frontId) advance(direction, state.frontId)
    else setDx(0)
  }

  /**
   * **A cancel aborts the gesture; it does not complete it.** The two are
   * opposite intents and the deck used to route both here, so a touch the
   * platform took away *while the finger was still down* flung the card off
   * and marked a postcard the rider never finished reading as seen.
   *
   * **Which platform behaviours actually raise it here is INFERRED, not
   * measured** — iOS Safari's left-edge back-swipe is the likeliest (the deck's
   * left edge sits ~24px in, inside the edge region), and a Capacitor WKWebView
   * has `allowsBackForwardNavigationGestures` off by default, so the shell may
   * never see it at all. The fix does not depend on which is true: a cancel is
   * not a release whatever caused it. Do not repeat this list as established.
   */
  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null

    if (!state.armed) return

    setDragging(false)
    setDx(0)
  }

  /**
   * Swallows the click that follows a drag, in the capture phase so it never
   * reaches the control the gesture started on.
   *
   * `preventDefault` as well as `stopPropagation` because `CommentsLink` is an
   * anchor: stopping React's propagation leaves the browser's own navigation
   * untouched, and a swipe would open the thread it swiped past.
   */
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (!front) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-4 px-8 text-center', className)}>
        <p className="text-sm font-medium text-muted">
          {postcards.length === 0
            ? 'There are no new postcards, yet!'
            : "That's every new postcard."}
        </p>
        {postcards.length > 0 && (
          <>
            {/* Reaching the end is what "seen" means for the app-wide feed —
                see MarkFeedSeen, and 015 for why a watermark may only advance
                on a finished surface. */}
            <MarkFeedSeen />
            <button
              type="button"
              onClick={() => setDismissed(new Set())}
              className="text-sm font-semibold text-foreground underline underline-offset-4"
            >
              Start over
            </button>
          </>
        )}
      </div>
    )
  }

  const visible = remaining.slice(0, 3)

  return (
    <div className={cn('relative flex h-full items-center justify-center px-6', className)}>
      {/* The stack is 342×448 in a 390 frame — 24px either side. Capped rather
          than fixed so it still fits a 320px phone. */}
      <div className="relative aspect-[342/448] w-full max-w-[342px]">
        {visible.map((postcard, depth) => {
          const isFront = depth === 0
          const behind = BEHIND[depth - 1]

          return (
            <div
              key={postcard.id}
              // Vertical panning is not wanted here — the home screen fills the
              // viewport and does not scroll — so the front card owns the gesture.
              className={isFront ? 'absolute inset-0 touch-none' : 'absolute inset-0'}
              style={{
                zIndex: isFront ? 30 : behind.z,
                transform: isFront
                  ? `translateX(${dx}px) rotate(${dx / 40}deg)`
                  : `rotate(${behind.rotate}deg)`,
                transition: dragging
                  ? undefined
                  : 'transform 220ms ease-out, opacity 220ms ease-out',
                opacity: isFront && leaving !== null ? 0 : 1,
                // Only the front card takes pointer input; the fanned corners
                // behind it must not swallow a drag that starts over them.
                pointerEvents: isFront ? 'auto' : 'none',
              }}
              onPointerDown={isFront ? onPointerDown : undefined}
              onPointerMove={isFront ? onPointerMove : undefined}
              onPointerUp={isFront ? onPointerUp : undefined}
              onPointerCancel={isFront ? onPointerCancel : undefined}
              onClickCapture={isFront ? onClickCapture : undefined}
            >
              <PostcardCard postcard={postcard} fill />
            </div>
          )
        })}

        {/* Inside the stack rather than beside it, so the pill is positioned
            against the card it describes and not against the padded row the
            card sits in. Kept mounted through its own fade — `coach` reaches
            `hidden` only after it. */}
        {coach !== 'hidden' && <SwipeCoach leaving={coach === 'leaving'} />}
      </div>

      {/* Keyboard and screen-reader path to the same action: the deck is a drag
          gesture, which is unreachable without a pointer. */}
      <button
        type="button"
        onClick={() => {
          // The pointer route dismisses from `onPointerDown`; this is the same
          // dismissal for the route that never produces one.
          dismissCoach()
          advance(1, front.id)
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-0 focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Next postcard
      </button>
    </div>
  )
}
