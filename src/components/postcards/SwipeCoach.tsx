import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons/generated'
import { cn } from '@/lib/utils'

/**
 * The one-time hint that the home screen's deck is swipeable — PD-324, product
 * owner 2026-08-27: *"Swipping postcards shows a tutorial on the 1st time they
 * are displayed indicating they can be swipped left or right."*
 *
 * The problem it solves is that the deck's only way forward is a gesture with
 * no affordance drawn anywhere, so a rider who does not try it sees one
 * postcard and concludes the feed is empty.
 *
 * **`pointer-events-none` on the root, and it is load-bearing rather than
 * tidy.** Two live behaviours run underneath this overlay and an intercepting
 * layer breaks both:
 *
 *   - `PostcardDeck` arms its drag on *distance* rather than at `pointerdown`
 *     (`armsDrag` in `./deck`), which is what lets the card's like, comment,
 *     share and overflow controls keep their clicks while the strip they sit in
 *     still drags. A coach mark that swallowed `pointerdown` would take the
 *     swipe away on the very gesture it is teaching.
 *   - PD-316 put a tap-to-open button across the photo (`PostcardCard`), so the
 *     first tap opens the postcard as a popup. A coach mark that ate the first
 *     tap would make the rider tap twice for it.
 *
 * With no pointer surface of its own this cannot dismiss itself, so **the deck
 * owns dismissal** — see `PostcardDeck`'s `dismissCoach`. That is also what
 * satisfies the issue's *"it must never require a second interaction to get
 * past"*: the tap that dismisses this is the same tap that opens the postcard.
 *
 * **Hidden from assistive technology.** The gesture it describes is
 * pointer-only and the deck already exposes the same action to a screen reader
 * and a keyboard as its sr-only "Next postcard" button, so announcing this
 * would offer an instruction that route cannot follow. It is the visual half of
 * an affordance that already has an accessible half.
 */
export function SwipeCoach({
  leaving,
  className,
}: {
  /**
   * True once the deck has dismissed it, so the pill fades rather than
   * vanishing mid-gesture. The deck keeps it mounted for the length of that
   * fade and then drops it; nothing here schedules its own removal.
   */
  leaving: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // `z-40` clears the front card's own `zIndex: 30` — the two behind it
        // are 20 and 10 — so the pill sits over the photo rather than under it.
        'pointer-events-none absolute inset-0 z-40 flex items-center justify-center',
        'transition-opacity duration-200 ease-out',
        leaving ? 'opacity-0' : 'opacity-100',
        className
      )}
    >
      {/* The horizontal drift is on this element rather than on the root so it
          composes with the root's `flex` centring instead of fighting it: the
          keyframe translates from a centred origin either way.

          `motion-safe:` because an animated coach mark is precisely what
          `prefers-reduced-motion` is about — and what remains under that
          setting is the same pill with the same arrows and the same sentence,
          which is the static instruction the issue asks for rather than
          nothing at all. */}
      <p
        className={cn(
          'flex items-center gap-2 rounded-full bg-scrim px-3 py-2 text-xs font-medium text-white',
          'motion-safe:animate-swipe-hint'
        )}
      >
        {/* Both arrows, because the deck advances on a swipe in *either*
            direction — there is no "back", and drawing one arrow would promise
            a direction that means something. */}
        <ArrowLeftIcon className="h-4 w-4 shrink-0" />
        Swipe either way for the next postcard
        <ArrowRightIcon className="h-4 w-4 shrink-0" />
      </p>
    </div>
  )
}
