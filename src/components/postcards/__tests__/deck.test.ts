import { describe, expect, it } from 'vitest'
import { SWIPE_THRESHOLD, remainingPostcards, resolveSwipe } from '@/components/postcards/deck'

const card = (id: string) => ({ id })
const feed = (...ids: string[]) => ids.map(card)

describe('remainingPostcards', () => {
  it('drops the cards already swiped past and keeps the rest in order', () => {
    const remaining = remainingPostcards(feed('a', 'b', 'c'), new Set(['a']))
    expect(remaining.map((p) => p.id)).toEqual(['b', 'c'])
  })

  it('never skips an unseen card when earlier ones vanish from the feed', () => {
    // The defect this replaced an index for. The rider is on `c` having swiped
    // past `a` and `b`; blocking the author of `a` removes it server-side. With
    // `postcards.slice(index)` the window was still slicing from position 2 of a
    // now-shorter list, which is `d` — `c` was never shown.
    const afterBlock = remainingPostcards(feed('b', 'c', 'd'), new Set(['a', 'b']))
    expect(afterBlock.map((p) => p.id)).toEqual(['c', 'd'])
    expect(afterBlock[0].id).toBe('c')
  })

  it('moves to the next card when the front one is the card removed', () => {
    // Hiding, blocking or deleting from the card's own overflow menu removes
    // the card the rider is looking at. It should advance, not error.
    const remaining = remainingPostcards(feed('c', 'd'), new Set(['a', 'b']))
    expect(remaining.map((p) => p.id)).toEqual(['c', 'd'])
  })

  it('is empty once every card is dismissed, which is the "start over" state', () => {
    expect(remainingPostcards(feed('a', 'b'), new Set(['a', 'b']))).toEqual([])
  })

  it('restores the whole feed when the dismissed set is cleared', () => {
    const postcards = feed('a', 'b', 'c')
    expect(remainingPostcards(postcards, new Set()).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores dismissed ids that are no longer in the feed', () => {
    // A card can be dismissed and *then* removed server-side. The stale id must
    // not shift or drop anything that is still there.
    const remaining = remainingPostcards(feed('c'), new Set(['a', 'b', 'gone']))
    expect(remaining.map((p) => p.id)).toEqual(['c'])
  })

  it('does not mutate its inputs', () => {
    const postcards = feed('a', 'b')
    const dismissed = new Set(['a'])
    remainingPostcards(postcards, dismissed)
    expect(postcards.map((p) => p.id)).toEqual(['a', 'b'])
    expect([...dismissed]).toEqual(['a'])
  })
})

describe('resolveSwipe', () => {
  it('leaves the way the card was pushed', () => {
    expect(resolveSwipe(SWIPE_THRESHOLD)).toBe(1)
    expect(resolveSwipe(-SWIPE_THRESHOLD)).toBe(-1)
    expect(resolveSwipe(600)).toBe(1)
    expect(resolveSwipe(-600)).toBe(-1)
  })

  it('returns to centre below the threshold, in both directions', () => {
    expect(resolveSwipe(0)).toBeNull()
    expect(resolveSwipe(SWIPE_THRESHOLD - 1)).toBeNull()
    expect(resolveSwipe(-(SWIPE_THRESHOLD - 1))).toBeNull()
  })

  it('returns to centre when the offset is not a number', () => {
    // The reported "I swipe right and it exits left". A terminating event that
    // populates no coordinate yields NaN, and the obvious `offset > 0 ? 1 : -1`
    // resolves that to a confident left swipe: `NaN > 0` is false, and the
    // magnitude test does not catch it either because `NaN < 56` is false too.
    expect(resolveSwipe(Number.NaN)).toBeNull()
    expect(resolveSwipe(Number.POSITIVE_INFINITY)).toBeNull()
    expect(resolveSwipe(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('treats -0 as no movement rather than a left swipe', () => {
    expect(resolveSwipe(-0)).toBeNull()
  })
})
