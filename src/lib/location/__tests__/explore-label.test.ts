import { describe, expect, it } from 'vitest'
import { exploreLabel, nearSectionHeading } from '@/lib/location/explore-label'

/**
 * PD-427. The property under test is **agreement**, not wording: the two strips
 * drew the same logic with two different sentences, and the defect was that
 * nothing made them equal. So the assertions that matter are the ones comparing
 * `rides` against `clubs`, and they would still hold if the owner changed the
 * verb tomorrow.
 *
 * Mutation-checked: making `exploreLabel` return `Explore public ${subject}`
 * for `rides` alone fails *the two subjects differ only in the subject word*
 * and nothing else — which is the assertion that pins the whole story.
 */
const UTRECHT = { name: 'Utrecht' }
const YOU = { name: 'you' }

describe('exploreLabel', () => {
  it('names the place when the position resolved and rows are near it', () => {
    expect(exploreLabel('rides', UTRECHT, 3)).toBe('Explore rides near Utrecht')
    expect(exploreLabel('clubs', UTRECHT, 3)).toBe('Explore clubs near Utrecht')
  })

  it('says `near you` for a device fix, which stores no town name', () => {
    expect(exploreLabel('rides', YOU, 1)).toBe('Explore rides near you')
  })

  it('the two subjects differ only in the subject word', () => {
    // The whole of PD-427. `Explore public rides near X` beside `Explore clubs
    // near X` was the defect; anything that reintroduces an asymmetry — a
    // stray adjective on one, a different preposition — fails here.
    for (const count of [undefined, 0, 1, 9]) {
      for (const near of [null, UTRECHT, YOU]) {
        const rides = exploreLabel('rides', near, count)
        const clubs = exploreLabel('clubs', near, count)
        expect(rides.replace(' rides', ' §')).toBe(clubs.replace(' clubs', ' §'))
      }
    }
  })

  it('drops the clause when nothing is near the place, rather than claiming it', () => {
    // PD-258's trap: `Explore rides near Hoorn` over a screen with nothing near
    // Hoorn is a claim the rider cannot check until they tap.
    expect(exploreLabel('rides', UTRECHT, 0)).toBe('Explore rides')
    expect(exploreLabel('clubs', UTRECHT, 0)).toBe('Explore clubs')
  })

  it('drops the clause while the count is still undecided', () => {
    // `undefined` is "no answer yet" and is NOT zero — the position has not
    // resolved, or the list read has not landed. Drawing the clause here
    // invents the answer a tick before it arrives.
    expect(exploreLabel('rides', UTRECHT, undefined)).toBe('Explore rides')
  })

  it('drops the clause when there is no place to name, whatever the count', () => {
    // `nearLabel` answers null when the name would not match the number. A
    // count alone never earns the clause.
    expect(exploreLabel('rides', null, 5)).toBe('Explore rides')
    expect(exploreLabel('clubs', null, 5)).toBe('Explore clubs')
  })

  it('makes no claim about a country', () => {
    // Deliberate, and the module header carries the reasoning: no query in this
    // app is scoped to a country, so `Explore rides in the Netherlands` would
    // be a promise the build cannot keep. This pins the absence so that adding
    // the clause has to come with the query that earns it.
    expect(exploreLabel('rides', UTRECHT, 3)).not.toMatch(/\bin\b/)
    expect(exploreLabel('rides', null, undefined)).not.toMatch(/\bin\b/)
  })
})

describe('nearSectionHeading', () => {
  it('names the same place the strip clause named', () => {
    // PD-258's second trap: the number a rider taps and the heading they land
    // on have to name the same place. One module is what makes that structural
    // rather than a convention two files happen to share, so the assertion
    // derives the heading's place from the strip's own sentence.
    expect(nearSectionHeading(UTRECHT)).toBe('Near Utrecht')

    const strip = exploreLabel('clubs', UTRECHT, 2)
    const heading = nearSectionHeading(UTRECHT)
    expect(strip.endsWith(heading.replace('Near ', 'near '))).toBe(true)
  })

  it('falls back to `you` rather than rendering a gap', () => {
    // The lists only draw this behind a `near` guard, so the fallback is
    // unreachable today. It is here because `Near ` with nothing after it is
    // the worst available render and costs one word to make impossible.
    expect(nearSectionHeading(null)).toBe('Near you')
  })
})
