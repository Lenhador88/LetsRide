import { describe, expect, it } from 'vitest'
import {
  normaliseUsername,
  rememberRefusal,
  usernameCheckUnanswered,
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
   * The field carries whatever the rider typed — since `056` that includes
   * capitals, and nothing stops a paste or a trailing space. The refused set is
   * keyed by `normaliseUsername`, so the lookup has to fold too or the refusal
   * is lost silently.
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
   * PD-226. `setUsername` reports the refusal with the rider's own capitals,
   * because that is what the index refused. The list is keyed folded, so this
   * has to fold on the way in — and `RoadKing` after `roadking` is the same
   * refusal, not a second one.
   */
  it('folds the value it stores, so capitals do not open a second entry', () => {
    expect(rememberRefusal([], 'RoadKing')).toEqual(['roadking'])

    const refused = ['roadking']
    expect(rememberRefusal(refused, 'RoadKing')).toBe(refused)
    expect(rememberRefusal(refused, 'ROADKING')).toBe(refused)
  })

  it('round-trips with usernameVerdict', () => {
    const refused = rememberRefusal([], normaliseUsername('  RoadKing  '))
    expect(usernameVerdict('roadking', free('roadking'), refused)?.available).toBe(false)
  })
})

/**
 * The invariant the whole mechanism rests on, and the one thing neither module's
 * own tests can see.
 *
 * `setUsername` hands `rememberRefusal` exactly what `usernameSchema` produced;
 * `usernameVerdict` reads the list back through `normaliseUsername`. Nothing but
 * this ties the two — and `rememberRefusal`'s own tests cannot catch a
 * divergence, because they use string literals rather than the schema.
 *
 * **The two sides deliberately no longer agree, and that is the change PD-226
 * made.** The schema preserves case; the key folds it. So the invariant is not
 * "these produce the same string" — it is "a refusal written from the schema's
 * output is found again under every case the rider might retype". Add any step
 * to the schema — an NFKC pass, a stripped separator — and this goes red, which
 * is the point: the field would otherwise flip back to green for a name that can
 * never be saved, PD-146 reintroduced with every other test still passing.
 */
describe('a refusal written from usernameSchema is found by usernameVerdict', () => {
  const cases = ['roadking', '  RoadKing  ', 'ROADKING', 'Road_King_99', '\tNightRider\n']

  it.each(cases)('survives the schema and every case-variant of %j', (raw) => {
    const stored = usernameSchema.parse(raw)
    const refused = rememberRefusal([], stored)

    // What the rider had in the field when they were refused.
    expect(usernameVerdict(raw, free(normaliseUsername(raw)), refused)?.available).toBe(false)
    // And every case they might retype it in — the index cannot tell these
    // apart, so neither may the field.
    expect(usernameVerdict(stored.toLowerCase(), null, refused)?.available).toBe(false)
    expect(usernameVerdict(stored.toUpperCase(), null, refused)?.available).toBe(false)
  })
})

describe('usernameCheckUnanswered', () => {
  it('says nothing when no check has failed', () => {
    expect(usernameCheckUnanswered('roadking', null, null)).toBe(false)
  })

  it('speaks when the check for what is in the field failed', () => {
    expect(usernameCheckUnanswered('roadking', null, 'roadking')).toBe(true)
  })

  /**
   * The whole reason the failure is keyed by value rather than a bare boolean.
   * A rider whose check failed on `roadking` and who then types `nightrider`
   * must not be told the app could not check the name they are now looking at —
   * nothing has failed for that one yet.
   */
  it('goes quiet the moment the rider edits the field', () => {
    expect(usernameCheckUnanswered('nightrider', null, 'roadking')).toBe(false)
  })

  it('folds the way the index does, so a retyped case-variant is still the same failure', () => {
    expect(usernameCheckUnanswered('  RoadKing ', null, 'roadking')).toBe(true)
  })

  /**
   * A verdict outranks a failure in both directions, and the refusal case is
   * the one that matters: PD-146's remembered `23505` is the authority, and a
   * later failed read must not downgrade "that name is taken" to "we could not
   * check". The rider would retype it for ever.
   */
  it('is outranked by a remembered refusal', () => {
    const refused = rememberRefusal([], 'roadking')
    const verdict = usernameVerdict('roadking', null, refused)

    expect(verdict?.available).toBe(false)
    expect(usernameCheckUnanswered('roadking', verdict, 'roadking')).toBe(false)
  })

  it('is outranked by a landed answer, which is fresher than the read that failed', () => {
    expect(usernameCheckUnanswered('roadking', free('roadking'), 'roadking')).toBe(false)
    expect(usernameCheckUnanswered('roadking', taken('roadking'), 'roadking')).toBe(false)
  })
})

describe('normaliseUsername', () => {
  it('trims and folds, matching profiles_username_lower_key', () => {
    expect(normaliseUsername('  RoadKing  ')).toBe('roadking')
  })

  /**
   * The line that would silently undo PD-226 if it were "simplified" to match
   * the schema again. The schema keeps `Pedro`; this key must not.
   */
  it('does not agree with usernameSchema, and must not', () => {
    expect(usernameSchema.parse('Pedro')).toBe('Pedro')
    expect(normaliseUsername('Pedro')).toBe('pedro')
  })
})
