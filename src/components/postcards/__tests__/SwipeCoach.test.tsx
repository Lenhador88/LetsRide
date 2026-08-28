import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SwipeCoach } from '@/components/postcards/SwipeCoach'

/**
 * The coach mark's one invariant that another change can silently break: **it
 * takes no pointer input.** Two live behaviours sit underneath it — the deck
 * arming its drag on distance so the card's controls keep their clicks, and
 * PD-316's tap-to-open button across the photo — and an overlay that
 * intercepted either would break the gesture it exists to teach, or make the
 * rider tap twice to open a postcard. Neither failure is visible from the
 * markup unless something asserts the class is still there.
 *
 * `renderToStaticMarkup` and no jsdom, the same trade `PostcardAction.test.tsx`
 * names: this asserts the rule rather than the pixels, and `vitest.config.ts`
 * is `environment: 'node'` for the whole suite. What it cannot see — that
 * `pointer-events: none` actually lets a tap through, or that `z-40` really
 * clears the front card's `zIndex: 30` — is the browser's arithmetic and is
 * taken on trust.
 */
describe('SwipeCoach', () => {
  it('never takes a pointer, so the tap underneath it reaches the card', () => {
    expect(renderToStaticMarkup(<SwipeCoach leaving={false} />)).toContain('pointer-events-none')
  })

  it('is hidden from assistive technology, which has the sr-only button instead', () => {
    // The instruction is pointer-only; the deck exposes the same action to a
    // screen reader and a keyboard as "Next postcard". Announcing this would
    // offer a route that path cannot follow.
    expect(renderToStaticMarkup(<SwipeCoach leaving={false} />)).toContain('aria-hidden="true"')
  })

  it('names both directions, because either one advances the deck', () => {
    const markup = renderToStaticMarkup(<SwipeCoach leaving={false} />)

    expect(markup).toContain('Swipe either way for the next postcard')
    // Two arrows: the deck has no "back", so one arrow would promise a
    // direction that means something.
    expect(markup.match(/<svg/g)).toHaveLength(2)
  })

  it('keeps the instruction under reduced motion, and only the motion is gated', () => {
    // `prefers-reduced-motion` is exactly what an animated coach mark is about,
    // so the drift is behind `motion-safe:` — but the pill, the arrows and the
    // sentence are not, which is the static instruction the reduced-motion path
    // is owed rather than nothing at all.
    const markup = renderToStaticMarkup(<SwipeCoach leaving={false} />)

    expect(markup).toContain('motion-safe:animate-swipe-hint')
    expect(markup).not.toContain('"animate-swipe-hint')
    expect(markup).not.toContain(' animate-swipe-hint')
  })

  it('fades on dismissal rather than vanishing under the finger', () => {
    expect(renderToStaticMarkup(<SwipeCoach leaving={false} />)).toContain('opacity-100')
    expect(renderToStaticMarkup(<SwipeCoach leaving />)).toContain('opacity-0')
  })
})
