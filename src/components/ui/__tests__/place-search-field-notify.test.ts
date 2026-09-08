import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isForwardableLookupFailure } from '@/components/ui/PlaceSearchField'

/**
 * That the notify effect actually CONSULTS the allowlist — PD-445.
 *
 * **This exists because the predicate being correct proves nothing.** Its own
 * three cases in `place-search-field.test.tsx` pass whether or not anything
 * calls it: measured, deleting `if (!isForwardableLookupFailure(failure)) return`
 * from the effect left **3755/3755 green**, and the exact regression the guard
 * was added for — a rider opening the onboarding escape by toggling airplane
 * mode — would have come back silently.
 *
 * **Read off comment-stripped source, which is this repo's idiom for it** —
 * `lib/actions/__tests__/writers-invalidate.test.ts` reads every action module
 * the same way and for the same reason. The alternative is mounting the field
 * under jsdom, faking a 400ms debounce and mocking a metered vendor call, to
 * assert one branch; this asserts the same branch at a fraction of the cost and
 * cannot be defeated by a comment that merely describes the guard, since the
 * comments are stripped first.
 *
 * Verified both ways, per §Working Principles: the detector is checked against
 * source that does NOT satisfy it, so a regex that quietly stops matching fails
 * here rather than passing for ever.
 */
const SOURCE = readFileSync('src/components/ui/PlaceSearchField.tsx', 'utf8')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const stripped = stripComments(SOURCE)

/** The effect body — from the `useEffect` that closes over `onLookupFailure`
 *  to its dependency array. */
const NOTIFY_EFFECT = /useEffect\(\(\) => \{([\s\S]*?)\}, \[failure, onLookupFailure\]\)/

describe('the notify effect is gated on the allowlist', () => {
  it('finds the effect at all', () => {
    // The half that keeps the assertion below from passing vacuously: a renamed
    // dependency array or a refactor to a custom hook makes this regex stop
    // matching, and an unmatched body would make every claim about it trivially
    // true.
    expect(stripped).toMatch(NOTIFY_EFFECT)
  })

  it('calls the predicate before it calls the callback', () => {
    const body = stripped.match(NOTIFY_EFFECT)?.[1] ?? ''
    expect(body).toContain('isForwardableLookupFailure(failure)')
    expect(body).toContain('onLookupFailure(failure)')
    // Order matters, not merely presence: a guard placed after the call
    // forwards first and filters afterwards, which is no guard at all.
    expect(body.indexOf('isForwardableLookupFailure(failure)')).toBeLessThan(
      body.indexOf('onLookupFailure(failure)')
    )
  })

  it('guards with an early return rather than only reading the predicate', () => {
    const body = stripped.match(NOTIFY_EFFECT)?.[1] ?? ''
    // `isForwardableLookupFailure(failure)` appearing in a log line, or its
    // result being assigned and never branched on, would satisfy the case above
    // and forward everything.
    expect(body).toMatch(/if\s*\(\s*!isForwardableLookupFailure\(failure\)\s*\)\s*return/)
  })

  it('the detector fails against a body that forwards unconditionally', () => {
    // The both-ways half, against literal source rather than the file: this is
    // what the effect looked like before the guard, and every assertion above
    // must reject it.
    const ungated = `
      useEffect(() => {
        if (!failure || !onLookupFailure) return
        if (notifiedFailure.current === failure) return
        notifiedFailure.current = failure
        onLookupFailure(failure)
      }, [failure, onLookupFailure])
    `
    const body = ungated.match(NOTIFY_EFFECT)?.[1] ?? ''
    expect(body).not.toBe('')
    expect(body).not.toContain('isForwardableLookupFailure(failure)')
    expect(body).not.toMatch(/if\s*\(\s*!isForwardableLookupFailure\(failure\)\s*\)\s*return/)
  })

  it('the stripper removes a comment that only describes the guard', () => {
    // The comment trap, which this repo pays for repeatedly: the effect's real
    // comment names `isForwardableLookupFailure`, so an unstripped read would
    // pass against a body whose guard had been deleted and whose comment
    // survived.
    const commentOnly = `
      // if (!isForwardableLookupFailure(failure)) return
      /* isForwardableLookupFailure(failure) */
      const x = 1
    `
    expect(stripComments(commentOnly)).not.toContain('isForwardableLookupFailure')
  })
})

describe('the predicate the effect consults', () => {
  it('is the same function the field exports', () => {
    // Ties the source-level assertion to the behavioural one next door: if this
    // import broke, the three predicate cases would still pass against a
    // different function than the effect calls.
    const unavailable = new Error('x')
    unavailable.name = 'PlaceSearchUnavailableError'
    expect(isForwardableLookupFailure(unavailable)).toBe(true)

    const offline = new Error('x')
    offline.name = 'PlaceSearchOfflineError'
    expect(isForwardableLookupFailure(offline)).toBe(false)
  })
})
