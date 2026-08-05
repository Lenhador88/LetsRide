import { describe, expect, it } from 'vitest'
import { remainingPostcards } from '@/components/postcards/deck'

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
