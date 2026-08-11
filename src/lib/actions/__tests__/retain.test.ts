import { describe, expect, it } from 'vitest'
import { retaining, seedRetained, wasChecked } from '@/lib/actions/retain'
import { emptyActionState, type ActionState } from '@/lib/actions/state'

const refuse = async (): Promise<ActionState> => ({ error: 'no' })
const succeed = async (): Promise<ActionState> => ({ error: null, redirectTo: '/postcards' })

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(entries)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one)
  }
  return data
}

describe('seedRetained', () => {
  it('retains nothing before the first submit', () => {
    expect(seedRetained(emptyActionState)).toEqual({ error: null, retained: {} })
  })

  it('keeps the seeded state intact', () => {
    expect(seedRetained({ error: 'boom', sent: true }).error).toBe('boom')
  })
})

describe('retaining', () => {
  it('returns the wrapped action’s own state unchanged', async () => {
    const state = await retaining(succeed, [])(seedRetained(emptyActionState), form({}))
    expect(state.error).toBeNull()
    expect(state.redirectTo).toBe('/postcards')
  })

  it('carries the submitted values back on an error return', async () => {
    const state = await retaining(refuse, ['title', 'meeting_point'])(
      seedRetained(emptyActionState),
      form({ title: 'Dawn run', meeting_point: 'Kanaalweg' })
    )
    expect(state.error).toBe('no')
    expect(state.retained).toEqual({ title: 'Dawn run', meeting_point: 'Kanaalweg' })
  })

  it('records a requested field that arrived absent, rather than omitting it', async () => {
    // The whole point: an unticked checkbox sends nothing, and a map holding
    // only what was present cannot tell that from "never asked for".
    const state = await retaining(refuse, ['is_public'])(
      seedRetained(emptyActionState),
      form({ title: 'Dawn run' })
    )
    expect('is_public' in state.retained).toBe(true)
    expect(state.retained.is_public).toBe('')
  })

  it('does not record a field it was not asked for', async () => {
    const state = await retaining(refuse, ['title'])(
      seedRetained(emptyActionState),
      form({ title: 'Dawn run', password: 'hunter2' })
    )
    expect(state.retained).toEqual({ title: 'Dawn run' })
  })

  it('keeps an empty string, because clearing a field is an answer', async () => {
    const state = await retaining(refuse, ['bio'])(
      seedRetained(emptyActionState),
      form({ bio: '' })
    )
    expect(state.retained.bio).toBe('')
  })

  it('replaces the previous submit’s values rather than merging them', async () => {
    // A merge would resurrect a field the rider has since cleared.
    const first = await retaining(refuse, ['title'])(
      seedRetained(emptyActionState),
      form({ title: 'Dawn run' })
    )
    const second = await retaining(refuse, ['title'])(first, form({ title: '' }))
    expect(second.retained.title).toBe('')
  })

  it('records a File as the empty string rather than an object', async () => {
    const data = new FormData()
    data.append('image', new File(['x'], 'x.jpg', { type: 'image/jpeg' }))
    const state = await retaining(refuse, ['image'])(seedRetained(emptyActionState), data)
    expect(state.retained.image).toBe('')
  })

  it('takes the first value when a name appears twice', async () => {
    const state = await retaining(refuse, ['tag'])(
      seedRetained(emptyActionState),
      form({ tag: ['one', 'two'] })
    )
    expect(state.retained.tag).toBe('one')
  })

  it('passes the previous state through to the wrapped action', async () => {
    let seen: ActionState | null = null
    const spy = async (previous: ActionState): Promise<ActionState> => {
      seen = previous
      return { error: null }
    }
    const previous = { ...seedRetained(emptyActionState), error: 'earlier' }
    await retaining(spy, [])(previous, form({}))
    expect(seen).toBe(previous)
  })
})

describe('wasChecked', () => {
  it('falls back before the first submit', () => {
    expect(wasChecked({}, 'is_public', true)).toBe(true)
    expect(wasChecked({}, 'is_public', false)).toBe(false)
  })

  it('is true when the box was ticked', () => {
    expect(wasChecked({ is_public: 'on' }, 'is_public', false)).toBe(true)
  })

  it('is false when the box was cleared, whatever the fallback says', () => {
    // The defect this guards: re-ticking a box the rider deliberately cleared
    // would restore a public default on a ride they wanted private.
    expect(wasChecked({ is_public: '' }, 'is_public', true)).toBe(false)
  })

  it('is true for a checkbox carrying its own value attribute', () => {
    expect(wasChecked({ is_public: 'yes' }, 'is_public', false)).toBe(true)
  })
})
