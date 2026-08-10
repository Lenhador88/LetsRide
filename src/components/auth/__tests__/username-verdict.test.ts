import { describe, expect, it } from 'vitest'
import {
  normaliseUsername,
  rememberRefusal,
  usernameVerdict,
  type UsernameCheck,
} from '@/components/auth/username-verdict'
import { USERNAME_TAKEN_MESSAGE, usernameSchema } from '@/lib/validation/profile'

const free = (value: string): UsernameCheck => ({ value, available: true, error: null })
const taken = (value: string): UsernameCheck => ({
  value,
  available: false,
  error: USERNAME_TAKEN_MESSAGE,
})

const nothingRefused: readonly string[] = []

describe('usernameVerdict', () => {
  it('shows the live verdict when it belongs to what is in the field', () => {
    expect(usernameVerdict('roadking', free('roadking'), nothingRefused)).toEqual(free('roadking'))
    expect(usernameVerdict('roadking', taken('roadking'), nothingRefused)).toEqual(
      taken('roadking')
    )
  })

  it('hides a verdict computed for a different value', () => {
    // The debounce window: "abc" was checked, the rider has typed "abcd".
    expect(usernameVerdict('abcd', free('abc'), nothingRefused)).toBeNull()
  })

  it('says nothing when no check has landed', () => {
    expect(usernameVerdict('roadking', null, nothingRefused)).toBeNull()
  })

  it('says nothing for an empty field even if the last check was for one', () => {
    expect(usernameVerdict('   ', free(''), nothingRefused)).toBeNull()
  })

  /**
   * PD-146. The unique index is global; the availability read is block-aware.
   * A rider blocked by the holder of `roadking` is told it is free, submits,
   * and is refused 23505 — so the refusal has to outrank the check, and keep
   * outranking it, because asking again returns "free" every time.
   */
  it('lets a refusal outrank an "available" for the same name', () => {
    const verdict = usernameVerdict('roadking', free('roadking'), ['roadking'])
    expect(verdict).toEqual({
      value: 'roadking',
      available: false,
      error: USERNAME_TAKEN_MESSAGE,
    })
  })

  it('keeps outranking it after the rider leaves the name and comes back', () => {
    const refused = ['roadking']

    // Away: a different name, freshly checked, is unaffected.
    expect(usernameVerdict('nightrider', free('nightrider'), refused)).toEqual(free('nightrider'))

    // Back: the debounce refires and the block-aware read answers "free" again.
    // The verdict must not flip back to green — that is the dead end returning.
    expect(usernameVerdict('roadking', free('roadking'), refused)?.available).toBe(false)
  })

  it('reports a refusal even when no check has landed for the value yet', () => {
    expect(usernameVerdict('roadking', null, ['roadking'])?.error).toBe(
      USERNAME_TAKEN_MESSAGE
    )
  })

  /**
   * The action refuses the value `usernameSchema` produced, which is trimmed and
   * lowercased. The field is not: it lowercases on change but a trailing space
   * survives, and nothing stops a paste. Looking the set up under a different
   * normalisation than it was written with would lose the refusal silently.
   */
  it('matches a refusal through the same normalisation the schema applies', () => {
    const refused = ['roadking']
    expect(usernameVerdict('  RoadKing  ', null, refused)?.available).toBe(false)
    expect(usernameVerdict('ROADKING', null, refused)?.available).toBe(false)
  })

  it('reports the refusal against the normalised value, not the raw input', () => {
    expect(usernameVerdict('  RoadKing ', null, ['roadking'])?.value).toBe('roadking')
  })
})

describe('rememberRefusal', () => {
  it('records the value the index refused', () => {
    expect(rememberRefusal([], 'roadking')).toEqual(['roadking'])
    expect(rememberRefusal(['nightrider'], 'roadking')).toEqual(['nightrider', 'roadking'])
  })

  it('returns the same list when the submit was not a refusal', () => {
    const refused = ['roadking']
    // Identity, not equality: a new array on every unrelated submit would hand
    // the field a fresh `refused` for no reason.
    expect(rememberRefusal(refused, undefined)).toBe(refused)
  })

  it('returns the same list when the value is already in it', () => {
    const refused = ['roadking']
    expect(rememberRefusal(refused, 'roadking')).toBe(refused)
  })

  /**
   * The two halves have to agree on normalisation or the refusal is written
   * under one key and looked up under another. `setUsername` returns
   * `usernameSchema`'s output, so this is what that pairing looks like.
   */
  it('round-trips with usernameVerdict', () => {
    const refused = rememberRefusal([], normaliseUsername('  RoadKing  '))
    expect(usernameVerdict('roadking', free('roadking'), refused)?.available).toBe(false)
  })
})

/**
 * The invariant the whole mechanism rests on, and the one thing neither module's
 * own tests can see.
 *
 * `setUsername` writes the refused key as `usernameSchema`'s output;
 * `usernameVerdict` reads it back through `normaliseUsername`. Nothing but this
 * ties the two, and the test above cannot catch a divergence because it uses the
 * *reader* on both sides. Add any step to the schema — an NFKC pass, a stripped
 * separator — and the refusal is stored under one string and looked up under
 * another: the field flips straight back to green for a name that can never be
 * saved, PD-146 reintroduced with every other test still passing.
 */
describe('normaliseUsername against usernameSchema', () => {
  const cases = ['roadking', '  RoadKing  ', 'ROADKING', 'road_king_99', '\tnightrider\n']

  it.each(cases)('produces exactly what the schema stores for %j', (raw) => {
    expect(normaliseUsername(raw)).toBe(usernameSchema.parse(raw))
  })
})

describe('normaliseUsername', () => {
  it('trims and lowercases, matching usernameSchema', () => {
    expect(normaliseUsername('  RoadKing  ')).toBe('roadking')
  })
})
