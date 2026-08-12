import { describe, expect, it } from 'vitest'
import { resolveBackDestination } from '@/lib/back-navigation'

describe('resolveBackDestination', () => {
  it('pops the history when the rider navigated to the screen', () => {
    expect(resolveBackDestination(2, '/postcards')).toEqual({ kind: 'history' })
  })

  it('pops the history from deep in a session', () => {
    expect(resolveBackDestination(9, '/postcards')).toEqual({ kind: 'history' })
  })

  // The cold-deeplink case, and the whole reason the fallback exists: a push
  // notification opening a fresh webview leaves one history entry, where
  // `history.back()` does nothing and the rider is stranded on the screen.
  it('falls back when the screen is the only history entry', () => {
    expect(resolveBackDestination(1, '/postcards')).toEqual({
      kind: 'replace',
      href: '/postcards',
    })
  })

  it('falls back rather than popping when the count is unreadable', () => {
    expect(resolveBackDestination(0, '/rides')).toEqual({ kind: 'replace', href: '/rides' })
  })
})
